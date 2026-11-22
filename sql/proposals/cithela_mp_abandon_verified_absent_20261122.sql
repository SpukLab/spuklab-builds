-- DRAFT only: do not execute without the trusted Mercado Pago verification endpoint.
-- Read-only provider searches must cover payer ID, email and unfiltered seller inventory.
BEGIN;
ALTER TABLE cithela_private.cithela_mp_subscription_intents
 DROP CONSTRAINT cithela_mp_subscription_intents_stage_check,
 DROP CONSTRAINT cithela_mp_intent_stage_dates;
ALTER TABLE cithela_private.cithela_mp_subscription_intents
 ADD CONSTRAINT cithela_mp_subscription_intents_stage_check
 CHECK (stage IN ('prepared','linked','cancel_requested','canceled','abandoned')),
 ADD CONSTRAINT cithela_mp_intent_stage_dates CHECK (
 (stage='prepared' AND provider_subscription_id IS NULL AND linked_at IS NULL AND cancel_requested_at IS NULL AND canceled_at IS NULL)
 OR (stage='abandoned' AND provider_subscription_id IS NULL AND linked_at IS NULL AND cancel_requested_at IS NULL AND canceled_at IS NULL)
 OR (stage='linked' AND provider_subscription_id IS NOT NULL AND linked_at IS NOT NULL AND cancel_requested_at IS NULL AND canceled_at IS NULL)
 OR (stage='cancel_requested' AND provider_subscription_id IS NOT NULL AND linked_at IS NOT NULL AND cancel_requested_at IS NOT NULL AND canceled_at IS NULL)
 OR (stage='canceled' AND provider_subscription_id IS NOT NULL AND linked_at IS NOT NULL AND cancel_requested_at IS NOT NULL AND canceled_at IS NOT NULL));
DROP INDEX cithela_private.cithela_mp_one_open_intent_per_tenant;
CREATE UNIQUE INDEX cithela_mp_one_open_intent_per_tenant
 ON cithela_private.cithela_mp_subscription_intents(tenant_id)
 WHERE stage NOT IN ('canceled','abandoned');
CREATE TABLE cithela_private.cithela_mp_abandon_audit(
 intent_id uuid PRIMARY KEY REFERENCES cithela_private.cithela_mp_subscription_intents(intent_id),
 abandoned_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 reason text NOT NULL CHECK (reason='verified_absent_from_provider'),
 evidence_checked_at timestamptz NOT NULL,
 email_search_complete boolean NOT NULL CHECK(email_search_complete),
 payer_id_search_complete boolean NOT NULL CHECK(payer_id_search_complete),
 email_match_count integer NOT NULL CHECK(email_match_count=0),
 payer_id_match_count integer NOT NULL CHECK(payer_id_match_count=0)
);
ALTER TABLE cithela_private.cithela_mp_abandon_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_mp_abandon_audit FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION cithela_private.cithela_mp_intent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      OR (OLD.stage='prepared' AND NEW.stage='abandoned' AND NEW.provider_subscription_id IS NULL)
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
$function$
;
CREATE OR REPLACE FUNCTION public.cithela_mp_prepare_test_intent(p_tenant_id uuid, p_owner_user_id uuid, p_external_reference text, p_collector_id text, p_amount_minor bigint, p_terms_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_entitlement cithela_private.cithela_commercial_entitlements%ROWTYPE;
  v_current cithela_private.cithela_mp_subscription_intents%ROWTYPE;
  v_created_id uuid;
BEGIN
  -- No caller-controlled values may ever select production credentials.
  IF p_tenant_id IS NULL OR p_owner_user_id IS NULL
     OR p_external_reference IS NULL
     OR p_external_reference !~ '^cithela_[A-Za-z0-9_-]{12,100}$'
     OR p_collector_id IS NULL OR p_collector_id !~ '^[0-9]{1,30}$'
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 100 AND 100000000000
     OR p_terms_version IS DISTINCT FROM 'internal-test-only-v1'
  THEN RETURN jsonb_build_object('ok',false,'code','invalid_test_intent'); END IF;

  -- This function is granted exclusively to service_role, but privilege
  -- alone does NOT prove owner consent: the Edge handler must authenticate
  -- the user's bearer JWT, match tenant and require explicit test consent.
  SELECT e.* INTO v_entitlement
  FROM cithela_private.cithela_commercial_entitlements e
  INNER JOIN public.cithela_tenant_memberships m
    ON m.tenant_id=e.tenant_id AND m.user_id=p_owner_user_id
  INNER JOIN auth.users u ON u.id=m.user_id
  WHERE e.tenant_id=p_tenant_id AND e.owner_user_id=p_owner_user_id
    AND m.role='owner' AND u.email_confirmed_at IS NOT NULL
    AND e.status IN ('trialing','payment_pending','past_due')
  FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','not_eligible');
  END IF;

  SELECT * INTO v_current
    FROM cithela_private.cithela_mp_subscription_intents i
    WHERE i.tenant_id=p_tenant_id AND i.stage NOT IN ('canceled','abandoned')
    FOR UPDATE;
  IF FOUND THEN
    IF v_current.owner_user_id=p_owner_user_id
       AND v_current.collector_id=p_collector_id
       AND v_current.amount_minor=p_amount_minor
       AND v_current.currency_id='ARS'
       AND v_current.live_mode=false
       AND v_current.terms_version=p_terms_version
    THEN
      RETURN jsonb_build_object(
        'ok',true,'code','already_prepared',
        'intent_id',v_current.intent_id,
        'external_reference',v_current.external_reference
      );
    END IF;
    RETURN jsonb_build_object('ok',false,'code','existing_intent_conflict');
  END IF;

  INSERT INTO cithela_private.cithela_mp_subscription_intents
    (tenant_id,owner_user_id,external_reference,collector_id,
     amount_minor,currency_id,live_mode,terms_version,opted_in_at)
  VALUES
    (p_tenant_id,p_owner_user_id,p_external_reference,p_collector_id,
     p_amount_minor,'ARS',false,p_terms_version,statement_timestamp())
  RETURNING intent_id INTO v_created_id;
  RETURN jsonb_build_object('ok',true,'code','prepared',
    'intent_id',v_created_id,'external_reference',p_external_reference);
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent submissions must never create another open intent.
    RETURN jsonb_build_object('ok',false,'code','already_in_progress');
END
$function$
;
CREATE OR REPLACE FUNCTION public.cithela_mp_test_subscription_snapshot(p_tenant_id uuid, p_owner_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v cithela_private.cithela_mp_subscription_intents%rowtype;
begin
 if not exists(select 1 from public.cithela_tenant_memberships m
 join cithela_private.cithela_commercial_entitlements e
 on e.tenant_id=m.tenant_id
 where m.tenant_id=p_tenant_id and m.user_id=p_owner_user_id
 and m.role='owner' and e.owner_user_id=p_owner_user_id)
 then return jsonb_build_object('ok',false,'code','not_tenant_owner'); end if;
 select * into v from cithela_private.cithela_mp_subscription_intents
 where tenant_id=p_tenant_id and owner_user_id=p_owner_user_id
 and stage NOT IN ('canceled','abandoned') order by created_at desc limit 1;
 if not found then return jsonb_build_object('ok',true,'code','no_subscription'); end if;
 return jsonb_build_object('ok',true,'code','snapshot',
 'stage',v.stage,'intent_id',v.intent_id,'external_reference',v.external_reference,
 'provider_subscription_id',v.provider_subscription_id,
 'live_mode',v.live_mode,'currency_id',v.currency_id,
 'amount_minor',v.amount_minor,'collector_id',v.collector_id);
end $function$
;
-- This RPC requires a trusted server that has independently queried Mercado Pago.
-- Never expose to browser users; it does NOT create a new subscription.
CREATE OR REPLACE FUNCTION public.cithela_mp_abandon_verified_absent_test_intent(
 p_intent_id uuid,p_evidence_checked_at timestamptz,
 p_email_complete boolean,p_payer_id_complete boolean,
 p_email_count integer,p_payer_id_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $recover$
DECLARE v cithela_private.cithela_mp_subscription_intents%rowtype;
BEGIN
 IF p_evidence_checked_at IS NULL OR p_evidence_checked_at < statement_timestamp()-interval '2 minutes'
 OR p_evidence_checked_at > statement_timestamp()+interval '10 seconds'
 OR p_email_complete IS DISTINCT FROM true OR p_payer_id_complete IS DISTINCT FROM true
 OR p_email_count IS DISTINCT FROM 0 OR p_payer_id_count IS DISTINCT FROM 0
 THEN RETURN jsonb_build_object('ok',false,'code','provider_evidence_required'); END IF;
 SELECT * INTO v FROM cithela_private.cithela_mp_subscription_intents
 WHERE intent_id=p_intent_id AND tenant_id='e680ebd3-a031-4968-905a-e829ab3b5dfe'
 AND stage='prepared' AND provider_subscription_id IS NULL AND live_mode=false
 AND terms_version='internal-test-only-v1' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','intent_not_recoverable'); END IF;
 IF v.created_at > statement_timestamp()-interval '10 minutes'
 THEN RETURN jsonb_build_object('ok',false,'code','claim_too_recent'); END IF;
 IF NOT EXISTS(SELECT 1 FROM cithela_private.cithela_mp_checkout_claims c WHERE c.intent_id=v.intent_id)
 THEN RETURN jsonb_build_object('ok',false,'code','claim_missing'); END IF;
 IF EXISTS(SELECT 1 FROM cithela_private.cithela_mp_pilot_payments x WHERE x.intent_id=v.intent_id)
 OR EXISTS(SELECT 1 FROM cithela_private.cithela_mp_pilot_activations x WHERE x.intent_id=v.intent_id)
 THEN RETURN jsonb_build_object('ok',false,'code','payment_or_activation_exists'); END IF;
 IF EXISTS(SELECT 1 FROM cithela_private.cithela_mp_webhook_inbox e
 WHERE e.merchant_user_id=v.collector_id AND e.live_mode=false
 AND (e.resource_id=v.external_reference OR e.received_at >= v.created_at))
 THEN RETURN jsonb_build_object('ok',false,'code','provider_event_requires_review'); END IF;
 INSERT INTO cithela_private.cithela_mp_abandon_audit
 (intent_id,reason,evidence_checked_at,email_search_complete,payer_id_search_complete,email_match_count,payer_id_match_count)
 VALUES(v.intent_id,'verified_absent_from_provider',p_evidence_checked_at,true,true,0,0);
 UPDATE cithela_private.cithela_mp_subscription_intents SET stage='abandoned' WHERE intent_id=v.intent_id;
 RETURN jsonb_build_object('ok',true,'code','intent_abandoned','payment_created',false);
END $recover$;
REVOKE ALL ON FUNCTION public.cithela_mp_abandon_verified_absent_test_intent(uuid,timestamptz,boolean,boolean,integer,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_mp_abandon_verified_absent_test_intent(uuid,timestamptz,boolean,boolean,integer,integer) TO service_role;
COMMIT;
