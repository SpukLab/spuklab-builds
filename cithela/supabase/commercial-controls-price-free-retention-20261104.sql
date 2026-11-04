-- CITHELA commercial controls v1 · non-destructive staging
-- No checkout, automatic cleanup, new account, billed user, or paid entitlement.
-- Existing 'legacy' accounts remain untouched and fully operational.

-- Commercial price choices are editable data, not hard-coded constants.
-- A choice being marked selected does not publish an offer or bill anyone.
CREATE TABLE cithela_private.cithela_price_options (
  price_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text NOT NULL DEFAULT 'cithela_monthly'
    CHECK (plan_code='cithela_monthly'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 3 AND 70),
  amount_minor bigint NOT NULL
    CHECK (amount_minor BETWEEN 100 AND 100000000000),
  currency_id text NOT NULL DEFAULT 'ARS' CHECK (currency_id='ARS'),
  interval_unit text NOT NULL DEFAULT 'month' CHECK (interval_unit='month'),
  is_selected boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false
    CHECK (is_published=false),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (plan_code,amount_minor)
);
CREATE UNIQUE INDEX cithela_single_selected_price
 ON cithela_private.cithela_price_options(plan_code)
 WHERE is_selected;
ALTER TABLE cithela_private.cithela_price_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_price_options
 FROM PUBLIC,anon,authenticated;
-- Historical price alternatives, ALL draft and unpublished.
INSERT INTO cithela_private.cithela_price_options
 (label,amount_minor)
VALUES ('Referencia interna ARS 15.000',1500000),
       ('Referencia interna ARS 18.000',1800000);

-- A complimentary client is never a payment and has no provider subscription.
-- A grant overrides expired trial booking only while explicitly valid and
-- only for non-suspended, non-legacy entitlements.
CREATE TABLE cithela_private.cithela_complimentary_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.cithela_tenants(id)
    ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  grant_reason text NOT NULL CHECK (length(btrim(grant_reason)) BETWEEN 5 AND 240),
  starts_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (expires_at IS NULL OR expires_at>starts_at),
  CHECK (revoked_at IS NULL OR revoked_at>=starts_at)
);
CREATE UNIQUE INDEX cithela_one_unrevoked_complimentary_grant
 ON cithela_private.cithela_complimentary_grants(tenant_id)
 WHERE revoked_at IS NULL;
ALTER TABLE cithela_private.cithela_complimentary_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_complimentary_grants
 FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION cithela_private.cithela_complimentary_grant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(
      SELECT 1
      FROM cithela_private.cithela_commercial_entitlements e
      JOIN public.cithela_tenant_memberships m
       ON m.tenant_id=e.tenant_id AND m.user_id=e.owner_user_id
      WHERE e.tenant_id=NEW.tenant_id
       AND e.owner_user_id=NEW.owner_user_id
       AND m.role='owner'
       AND e.status IN ('trialing','payment_pending','past_due','canceled')
    ) THEN
      RAISE EXCEPTION 'complimentary_owner_or_state_invalid';
    END IF;
  ELSE
    -- Prevent silently moving a free grant to another establishment or
    -- relabeling who approved it. Revocation is permanent for that record.
    IF (NEW.tenant_id,NEW.owner_user_id,NEW.granted_by,NEW.starts_at,NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.owner_user_id,OLD.granted_by,OLD.starts_at,OLD.created_at)
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    THEN
      RAISE EXCEPTION 'complimentary_grant_immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION cithela_private.cithela_complimentary_grant_guard()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cithela_complimentary_grant_safety
 BEFORE INSERT OR UPDATE ON cithela_private.cithela_complimentary_grants
 FOR EACH ROW EXECUTE FUNCTION cithela_private.cithela_complimentary_grant_guard();

-- Existing booking-guard and commercial-status RPC call this single evaluator.
-- This does not change any existing rows, trial period or paid subscriptions.
CREATE OR REPLACE FUNCTION cithela_private.commercial_entitlement_snapshot(
 p_tenant_id uuid,p_check_at timestamptz DEFAULT statement_timestamp())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $snapshot$
DECLARE
  e cithela_private.cithela_commercial_entitlements%ROWTYPE;
  g cithela_private.cithela_complimentary_grants%ROWTYPE;
  s text;
  allowed boolean:=false;
BEGIN
  IF p_tenant_id IS NULL OR p_check_at IS NULL OR NOT isfinite(p_check_at) THEN
    RETURN jsonb_build_object('status','invalid_request','can_book',false);
  END IF;
  SELECT * INTO e FROM cithela_private.cithela_commercial_entitlements x
   WHERE x.tenant_id=p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_configured','can_book',false);
  END IF;
  s:=e.status;
  IF s='legacy' THEN
    allowed:=true;
  ELSIF s='active' THEN
    IF e.current_period_end>p_check_at THEN allowed:=true;
    ELSE s:='past_due'; END IF;
  END IF;
  -- No override of a suspended account or active paid entitlement.
  IF NOT allowed AND e.status IN
      ('trialing','payment_pending','past_due','canceled') THEN
    SELECT * INTO g FROM cithela_private.cithela_complimentary_grants y
      WHERE y.tenant_id=p_tenant_id AND y.owner_user_id=e.owner_user_id
        AND y.revoked_at IS NULL AND y.starts_at<=p_check_at
        AND (y.expires_at IS NULL OR y.expires_at>p_check_at);
    IF FOUND THEN
      s:='complimentary';
      allowed:=true;
    END IF;
  END IF;
  IF NOT allowed THEN
    IF s='trialing' THEN
      IF p_check_at<e.trial_ends_at THEN allowed:=true;
      ELSE s:='trial_expired'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'status',s,'can_book',allowed,
    'trial_ends_at',e.trial_ends_at,
    'current_period_end',e.current_period_end,
    'complimentary_until',CASE WHEN s='complimentary' THEN g.expires_at ELSE NULL END
  );
END
$snapshot$;

-- Purge is a LEGAL/DATA-RETENTION decision, not a side effect of the trial end.
-- A retention hold prevents even being surfaced as a deletion candidate.
CREATE TABLE cithela_private.cithela_retention_holds (
  tenant_id uuid PRIMARY KEY REFERENCES public.cithela_tenants(id)
    ON DELETE RESTRICT,
  hold_reason text NOT NULL CHECK(length(btrim(hold_reason)) BETWEEN 5 AND 240),
  placed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  release_at timestamptz,
  CHECK (release_at IS NULL OR release_at>placed_at)
);
ALTER TABLE cithela_private.cithela_retention_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_retention_holds
 FROM PUBLIC,anon,authenticated;

-- These periods are configurable later via the protected commercial console.
-- Not a policy of automatic deletion. Thresholds are for *preview only*.
CREATE TABLE cithela_private.cithela_retention_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  review_after_days integer NOT NULL DEFAULT 30 CHECK(review_after_days BETWEEN 7 AND 365),
  purge_review_after_days integer NOT NULL DEFAULT 90
    CHECK(purge_review_after_days BETWEEN 30 AND 730),
  automatic_purge boolean NOT NULL DEFAULT false CHECK(automatic_purge=false),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK(purge_review_after_days>review_after_days)
);
ALTER TABLE cithela_private.cithela_retention_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_retention_settings
 FROM PUBLIC,anon,authenticated;
INSERT INTO cithela_private.cithela_retention_settings(id) VALUES(1);

-- Internal preview: no DELETE, no UPDATE, no pg_cron, no user data returned.
-- Only unconverted expired trials without any billing intent, paid reference,
-- valid free grant, legal hold or future appointments are listed.
CREATE OR REPLACE FUNCTION cithela_private.cithela_trial_cleanup_preview(
 p_check_at timestamptz DEFAULT statement_timestamp())
RETURNS TABLE(
 tenant_id uuid, trial_ends_at timestamptz, days_expired integer,
 stage text, future_appointments bigint, historical_appointments bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $preview$
  SELECT e.tenant_id,e.trial_ends_at,
    FLOOR(EXTRACT(EPOCH FROM (p_check_at-e.trial_ends_at))/86400)::integer,
    CASE WHEN p_check_at >=
      e.trial_ends_at+make_interval(days=>cfg.purge_review_after_days)
      THEN 'manual_purge_review'::text
      ELSE 'notify_and_export'::text END,
    (SELECT count(*) FROM public.cithela_appointments a
      WHERE a.tenant_id=e.tenant_id AND a.starts_at>=p_check_at),
    (SELECT count(*) FROM public.cithela_appointments a
      WHERE a.tenant_id=e.tenant_id AND a.starts_at<p_check_at)
  FROM cithela_private.cithela_commercial_entitlements e
  JOIN cithela_private.cithela_retention_settings cfg ON cfg.id=1
  JOIN public.cithela_tenants t ON t.id=e.tenant_id
  WHERE p_check_at IS NOT NULL AND isfinite(p_check_at)
    AND e.status='trialing'
    AND e.trial_ends_at IS NOT NULL
    AND p_check_at>=e.trial_ends_at+make_interval(days=>cfg.review_after_days)
    AND e.provider_subscription_id IS NULL
    AND t.status='active'
    AND NOT EXISTS (
      SELECT 1 FROM cithela_private.cithela_mp_subscription_intents i
      WHERE i.tenant_id=e.tenant_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM cithela_private.cithela_complimentary_grants g
      WHERE g.tenant_id=e.tenant_id AND g.revoked_at IS NULL
        AND g.starts_at<=p_check_at
        AND (g.expires_at IS NULL OR g.expires_at>p_check_at)
    )
    AND NOT EXISTS (
      SELECT 1 FROM cithela_private.cithela_retention_holds h
      WHERE h.tenant_id=e.tenant_id
        AND (h.release_at IS NULL OR h.release_at>p_check_at)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.cithela_appointments a
      WHERE a.tenant_id=e.tenant_id AND a.starts_at>=p_check_at
    )
  ORDER BY e.trial_ends_at,e.tenant_id;
$preview$;
REVOKE ALL ON FUNCTION cithela_private.cithela_trial_cleanup_preview(timestamptz)
 FROM PUBLIC,anon,authenticated;
-- The private schema is not exposed to browser APIs.
-- No grant is issued to users or any background job for purge.
