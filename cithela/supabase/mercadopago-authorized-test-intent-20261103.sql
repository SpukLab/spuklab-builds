-- CITHELA — server-only TEST subscription intent authorization.
-- Never calls Mercado Pago, never creates payments, never activates service.
-- Production terms, price and payment checkout are NOT defined or enabled.
CREATE OR REPLACE FUNCTION public.cithela_mp_prepare_test_intent(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_external_reference text,
  p_collector_id text,
  p_amount_minor bigint,
  p_terms_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
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
    WHERE i.tenant_id=p_tenant_id AND i.stage<>'canceled'
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
$fn$;
REVOKE ALL ON FUNCTION public.cithela_mp_prepare_test_intent(
 uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_mp_prepare_test_intent(
 uuid,uuid,text,text,bigint,text) TO service_role;
-- The client has no EXECUTE, no direct table access, and there is no
-- paid checkout, entitlement update, subscription creation or API write.
