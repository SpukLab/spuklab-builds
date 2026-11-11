BEGIN;
ALTER TABLE cithela_private.cithela_commercial_entitlements
  DROP CONSTRAINT cithela_commercial_entitlements_check,
  ADD CONSTRAINT cithela_commercial_entitlements_trial_duration_check CHECK (
    (trial_started_at IS NULL AND trial_ends_at IS NULL)
    OR (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL
        AND trial_ends_at IN (trial_started_at + interval '7 days', trial_started_at + interval '15 days'))
  );

CREATE OR REPLACE FUNCTION cithela_private.bootstrap_tenant(p_display_name text, p_timezone text DEFAULT 'America/Argentina/Buenos_Aires'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  existing_tenant uuid;
  existing_name text;
  v_tenant uuid;
  v_service uuid;
  v_resource uuid;
  clean_name text := btrim(coalesce(p_display_name,''));
  clean_tz text := btrim(coalesce(p_timezone,''));
BEGIN
  IF actor IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','unauthenticated');
  END IF;
  IF length(clean_name) NOT BETWEEN 1 AND 160 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_name');
  END IF;
  IF clean_tz='' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=clean_tz
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_timezone');
  END IF;

  -- Serialize bootstrap attempts per authenticated user. No client-chosen tenant.
  PERFORM 1 FROM auth.users u WHERE u.id=actor FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','unauthenticated');
  END IF;

  -- Preserve existing owners; this is an additive safety gate for NEW tenants.
  SELECT t.id,t.display_name INTO existing_tenant,existing_name
  FROM public.cithela_tenant_memberships m
  JOIN public.cithela_tenants t ON t.id=m.tenant_id
  WHERE m.user_id=actor ORDER BY m.created_at,t.created_at LIMIT 1;
  IF existing_tenant IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',true,'code','workspace_exists',
      'tenant',jsonb_build_object('id',existing_tenant,'display_name',existing_name)
    );
  END IF;

  -- Phase 1 of commercial release: email verification is mandatory for owners.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','email_unverified');
  END IF;

  -- A query-string flag is not authorization. Only a server-granted, unexpired,
  -- unconsumed permission can create a new tenant in supervised onboarding.
  IF NOT EXISTS (
    SELECT 1 FROM cithela_private.cithela_onboarding_grants g
    WHERE g.user_id=actor AND g.expires_at>now()
      AND g.consumed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','onboarding_not_authorized');
  END IF;

  INSERT INTO public.cithela_tenants(display_name,timezone)
    VALUES(clean_name,clean_tz) RETURNING id INTO v_tenant;
  INSERT INTO public.cithela_tenant_memberships(tenant_id,user_id,role)
    VALUES(v_tenant,actor,'owner');
  INSERT INTO public.cithela_services(tenant_id,name,duration_min)
    VALUES(v_tenant,'Consulta',30) RETURNING id INTO v_service;
  INSERT INTO public.cithela_resources(tenant_id,name)
    VALUES(v_tenant,'Profesional principal') RETURNING id INTO v_resource;
  -- Trial is created only for an administrator-authorized professional.
  -- Dates and terms are read from the trusted server grant, never client fields.
  INSERT INTO cithela_private.cithela_commercial_entitlements
    (tenant_id,owner_user_id,status,terms_version,trial_started_at,trial_ends_at)
  SELECT v_tenant, actor, 'trialing', g.terms_version,
         statement_timestamp(), statement_timestamp()+interval '15 days'
  FROM cithela_private.cithela_onboarding_grants g
  WHERE g.user_id=actor AND g.consumed_at IS NULL AND g.expires_at>statement_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cithela_missing_onboarding_grant' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) VALUES (
    v_tenant,actor,'workspace_created','tenant',v_tenant,
    jsonb_build_object('service_id',v_service,'resource_id',v_resource,'timezone',clean_tz)
  );
  UPDATE cithela_private.cithela_onboarding_grants
  SET consumed_at=now()
  WHERE user_id=actor AND consumed_at IS NULL;

  RETURN jsonb_build_object(
    'ok',true,'code','workspace_created',
    'tenant',jsonb_build_object(
      'id',v_tenant,'display_name',clean_name,'timezone',clean_tz
    ),
    'default_service_id',v_service,'default_resource_id',v_resource
  );
END
$function$;

ALTER TABLE cithela_private.cithela_selfservice_settings
  ALTER COLUMN terms_version SET DEFAULT 'selfservice-trial-20261111';
UPDATE cithela_private.cithela_selfservice_settings
SET terms_version='selfservice-trial-20261111' WHERE singleton;
COMMIT;
