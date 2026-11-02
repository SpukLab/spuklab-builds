-- CITHELA commercial onboarding: REVIEW-ONLY proposal, NOT DEPLOYED.
-- Apply only after explicit rollout approval, dry-run on an isolated clone,
-- and confirmation that existing two tenants and WhatsApp access are preserved.
-- This SQL is intentionally not under an auto-applied migrations directory.
--
-- Purpose: prevent any authenticated Supabase user from creating a tenant
-- merely by calling cithela_bootstrap_tenant, bypassing the pilot URL gate.
-- Manual supervised onboarding can use an administrator-issued grant.
-- Future auto-onboarding must issue grants only after server-side terms,
-- identity, anti-abuse and trial entitlement checks.
BEGIN;

CREATE TABLE IF NOT EXISTS cithela_private.cithela_onboarding_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 120),
  reason text NOT NULL DEFAULT 'supervised',
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > approved_at)
);
ALTER TABLE cithela_private.cithela_onboarding_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_onboarding_grants FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION cithela_private.bootstrap_tenant(
  p_display_name text,
  p_timezone text DEFAULT 'America/Argentina/Buenos_Aires'
) RETURNS jsonb
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
COMMIT;

-- NO GRANT to anon/authenticated on the private grant table.
-- DO NOT add service_role keys to client-side HTML.
-- No new grants are seeded by this script. Existing professional memberships
-- continue to work, but new accounts must be authorized by a trusted backend.
