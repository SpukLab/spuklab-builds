-- CITHELA / Mercado Pago — private, TEST-ONLY tenant-to-subscription binding.
-- This migration DOES NOT create subscriptions, validate payments, activate
-- entitlements, process events, or change booking rights.
--
-- A trusted, authenticated checkout backend must obtain the owner action
-- and explicit recurring-billing consent before creating an intent.
-- There is intentionally NO client-writable API for this table.
CREATE TABLE cithela_private.cithela_mp_subscription_intents (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.cithela_tenants(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  external_reference text NOT NULL UNIQUE
    CHECK (external_reference ~ '^cithela_[A-Za-z0-9_-]{12,100}$'),
  collector_id text NOT NULL CHECK (collector_id ~ '^[0-9]{1,30}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 100 AND 100000000000),
  currency_id text NOT NULL DEFAULT 'ARS' CHECK (currency_id='ARS'),
  live_mode boolean NOT NULL DEFAULT false CHECK (live_mode=false),
  terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 120),
  opted_in_at timestamptz NOT NULL,
  provider_subscription_id text UNIQUE
    CHECK (provider_subscription_id IS NULL OR
           provider_subscription_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  stage text NOT NULL DEFAULT 'prepared'
    CHECK (stage IN ('prepared','linked','cancel_requested','canceled')),
  linked_at timestamptz,
  cancel_requested_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT cithela_mp_intent_stage_dates CHECK (
    (stage='prepared' AND provider_subscription_id IS NULL
      AND linked_at IS NULL AND cancel_requested_at IS NULL AND canceled_at IS NULL)
    OR
    (stage='linked' AND provider_subscription_id IS NOT NULL
      AND linked_at IS NOT NULL AND cancel_requested_at IS NULL AND canceled_at IS NULL)
    OR
    (stage='cancel_requested' AND provider_subscription_id IS NOT NULL
      AND linked_at IS NOT NULL AND cancel_requested_at IS NOT NULL AND canceled_at IS NULL)
    OR
    (stage='canceled' AND provider_subscription_id IS NOT NULL
      AND linked_at IS NOT NULL AND cancel_requested_at IS NOT NULL AND canceled_at IS NOT NULL)
  )
);
-- No simultaneous pending subscriptions for the same tenant. Prior canceled
-- records remain for audit and cannot be overwritten.
CREATE UNIQUE INDEX cithela_mp_one_open_intent_per_tenant
  ON cithela_private.cithela_mp_subscription_intents (tenant_id)
  WHERE stage<>'canceled';
ALTER TABLE cithela_private.cithela_mp_subscription_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_mp_subscription_intents
  FROM PUBLIC,anon,authenticated;
-- Existing service_role database access is sufficient; no browser grants.

CREATE OR REPLACE FUNCTION cithela_private.cithela_mp_intent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    -- Explicit opt-in is recorded but MUST be checked against the actual user
    -- interaction by the future trusted checkout endpoint. Not client input.
    IF NEW.stage<>'prepared' OR NEW.provider_subscription_id IS NOT NULL
      OR NEW.opted_in_at<statement_timestamp()-interval '15 minutes'
      OR NEW.opted_in_at>statement_timestamp()+interval '1 minute'
      OR NOT EXISTS (
        SELECT 1 FROM public.cithela_tenant_memberships m
        JOIN cithela_private.cithela_commercial_entitlements e
          ON e.tenant_id=m.tenant_id
        WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.owner_user_id
          AND m.role='owner' AND e.owner_user_id=NEW.owner_user_id
          AND e.status IN ('trialing','payment_pending','past_due')
      ) THEN
      RAISE EXCEPTION 'commercial_intent_not_authorized';
    END IF;
  ELSE
    IF (NEW.tenant_id,NEW.owner_user_id,NEW.external_reference,
        NEW.collector_id,NEW.amount_minor,NEW.currency_id,
        NEW.live_mode,NEW.terms_version,NEW.opted_in_at,NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.owner_user_id,OLD.external_reference,
        OLD.collector_id,OLD.amount_minor,OLD.currency_id,
        OLD.live_mode,OLD.terms_version,OLD.opted_in_at,OLD.created_at) THEN
      RAISE EXCEPTION 'immutable_commercial_intent';
    END IF;
    IF NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id
       AND NOT (
         OLD.stage='prepared' AND NEW.stage='linked'
         AND OLD.provider_subscription_id IS NULL
         AND NEW.provider_subscription_id IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'provider_id_already_bound';
    END IF;
    IF NOT (
      (OLD.stage='prepared' AND NEW.stage='linked')
      OR (OLD.stage='linked' AND NEW.stage='cancel_requested')
      OR (OLD.stage='cancel_requested' AND NEW.stage='canceled')
    ) THEN
      RAISE EXCEPTION 'invalid_commercial_stage_transition';
    END IF;
    IF (OLD.stage<>'prepared' AND NEW.linked_at IS DISTINCT FROM OLD.linked_at)
       OR (OLD.stage<>'linked'
            AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at)
       OR (OLD.stage<>'cancel_requested'
            AND NEW.canceled_at IS DISTINCT FROM OLD.canceled_at)
       OR (NEW.linked_at IS NOT NULL AND NEW.linked_at<NEW.opted_in_at)
       OR (NEW.cancel_requested_at IS NOT NULL
            AND NEW.cancel_requested_at<NEW.linked_at)
       OR (NEW.canceled_at IS NOT NULL
            AND NEW.canceled_at<NEW.cancel_requested_at)
       THEN
      RAISE EXCEPTION 'invalid_commercial_audit_dates';
    END IF;
    NEW.updated_at:=statement_timestamp();
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION cithela_private.cithela_mp_intent_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cithela_mp_subscription_intent_guard
  BEFORE INSERT OR UPDATE ON cithela_private.cithela_mp_subscription_intents
  FOR EACH ROW EXECUTE FUNCTION cithela_private.cithela_mp_intent_guard();

-- Triage only. A signed webhook, even when associated with an order, is
-- not proof of an accredited payment. Payment IDs require provider GET.
CREATE OR REPLACE FUNCTION public.cithela_mp_classify_inbox_event(p_event_row_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  ev cithela_private.cithela_mp_webhook_inbox%ROWTYPE;
  intent_id uuid;
BEGIN
  SELECT * INTO ev FROM cithela_private.cithela_mp_webhook_inbox
  WHERE id=p_event_row_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','not_found');
  END IF;
  IF ev.live_mode=false AND left(ev.event_id,4)='sim_' THEN
    RETURN jsonb_build_object('ok',true,'code','simulated_ignore',
      'requires_provider_fetch',false);
  END IF;
  IF ev.topic='payment' THEN
    RETURN jsonb_build_object('ok',true,'code','payment_requires_provider_lookup',
      'requires_provider_fetch',true);
  END IF;
  SELECT i.intent_id INTO intent_id
  FROM cithela_private.cithela_mp_subscription_intents i
  WHERE i.provider_subscription_id=ev.resource_id
    AND i.collector_id=ev.merchant_user_id
    AND i.live_mode=ev.live_mode
    AND i.stage IN ('linked','cancel_requested');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'code','unmatched_requires_review',
      'requires_provider_fetch',true);
  END IF;
  RETURN jsonb_build_object('ok',true,'code','matched_unverified',
    'intent_id',intent_id,'requires_provider_fetch',true);
END
$fn$;
REVOKE ALL ON FUNCTION public.cithela_mp_classify_inbox_event(bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_mp_classify_inbox_event(bigint)
  TO service_role;
-- No UPDATE of entitlements; no API call to Mercado Pago; no checkout.
