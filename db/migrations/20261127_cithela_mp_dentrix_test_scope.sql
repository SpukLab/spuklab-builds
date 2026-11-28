-- Scope legacy exception to confirmed Dentrix owner and fixed internal test amount/seller.
-- Keep current commercial entitlements unchanged; block all internal test activations.
CREATE OR REPLACE FUNCTION cithela_private.cithela_mp_block_internal_test_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from cithela_private.cithela_mp_subscription_intents i
  where i.intent_id=new.intent_id
    and i.terms_version='internal-test-only-v1')
 then
  raise exception 'internal_pilot_activation_blocked';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.cithela_mp_claim_test_checkout(p_intent_id uuid, p_owner_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pilot uuid;
  intent cithela_private.cithela_mp_subscription_intents%rowtype;
  preflight jsonb;
begin
  select i.tenant_id into pilot from cithela_private.cithela_mp_subscription_intents i where i.intent_id=p_intent_id and i.owner_user_id=p_owner_user_id and i.tenant_id in ('e680ebd3-a031-4968-905a-e829ab3b5dfe'::uuid,'50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid);
  if not found then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
  preflight := public.cithela_mp_test_preflight(pilot, p_owner_user_id);
  if (preflight->>'code') is distinct from 'eligible' then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  select i.* into intent
  from cithela_private.cithela_mp_subscription_intents i
  where i.intent_id = p_intent_id and i.tenant_id = pilot
    and i.owner_user_id = p_owner_user_id and i.live_mode = false
    and i.currency_id = 'ARS' and i.terms_version = 'internal-test-only-v1'
    and i.stage = 'prepared' and i.provider_subscription_id is null
    and i.opted_in_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'intent_not_prepared');
  end if;

  insert into cithela_private.cithela_mp_checkout_claims (intent_id)
  values (intent.intent_id) on conflict (intent_id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'recover_only', 'external_reference', intent.external_reference);
  end if;
  return jsonb_build_object('ok', true, 'code', 'claimed', 'external_reference', intent.external_reference);
end;
$function$;

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
    IF (NEW.tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid AND (NEW.terms_version<>'internal-test-only-v1' OR NEW.amount_minor<>100000 OR NEW.collector_id<>'3813812326')) OR NEW.stage<>'prepared' OR NEW.provider_subscription_id IS NOT NULL
      OR NEW.opted_in_at<statement_timestamp()-interval '15 minutes'
      OR NEW.opted_in_at>statement_timestamp()+interval '1 minute'
      OR NOT EXISTS (
        SELECT 1 FROM public.cithela_tenant_memberships m
        JOIN cithela_private.cithela_commercial_entitlements e
          ON e.tenant_id=m.tenant_id
        WHERE m.tenant_id=NEW.tenant_id AND m.user_id=NEW.owner_user_id
          AND m.role='owner' AND e.owner_user_id=NEW.owner_user_id
          AND (e.status IN ('trialing','payment_pending','past_due') OR (e.status='legacy' AND NEW.tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid AND EXISTS(SELECT 1 FROM auth.users du WHERE du.id=NEW.owner_user_id AND lower(du.email)='dentrix.8m@gmail.com' AND du.email_confirmed_at IS NOT NULL)))
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
$function$;

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
     OR p_terms_version IS DISTINCT FROM 'internal-test-only-v1' OR (p_tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid AND (p_amount_minor<>100000 OR p_collector_id<>'3813812326'))
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
    AND (e.status IN ('trialing','payment_pending','past_due') OR (e.status='legacy' AND p_tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid AND EXISTS(SELECT 1 FROM auth.users du WHERE du.id=p_owner_user_id AND lower(du.email)='dentrix.8m@gmail.com' AND du.email_confirmed_at IS NOT NULL)))
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
$function$;

CREATE OR REPLACE FUNCTION public.cithela_mp_test_preflight(p_tenant_id uuid, p_owner_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.cithela_tenant_memberships m
 join cithela_private.cithela_commercial_entitlements e on e.tenant_id=m.tenant_id
 join auth.users u on u.id=m.user_id
 where m.tenant_id=p_tenant_id and m.user_id=p_owner_user_id
 and m.role='owner' and e.owner_user_id=p_owner_user_id
 and u.email_confirmed_at is not null
 and (e.status IN ('trialing','payment_pending','past_due') OR (e.status='legacy' AND p_tenant_id='50b3e3eb-77a5-413d-af3b-9aa5b56e833e'::uuid AND EXISTS(SELECT 1 FROM auth.users du WHERE du.id=p_owner_user_id AND lower(du.email)='dentrix.8m@gmail.com' AND du.email_confirmed_at IS NOT NULL))))
 then return jsonb_build_object('ok',false,'code','not_eligible'); end if;
 return jsonb_build_object('ok',true,'code','eligible');
end $function$;
