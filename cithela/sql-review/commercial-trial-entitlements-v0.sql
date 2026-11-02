-- CITHELA · trial entitlement V0 / REVIEW ONLY, NOT DEPLOYED.
-- This is deliberately unexposed and separate from live booking RPC.
-- Never open signup or public free trials until *all* booking paths enforce
-- can_book on the server and existing tenants are explicitly grandfathered.
-- A 7-day trial is not a subscription and cannot become paid automatically.

CREATE TABLE IF NOT EXISTS cithela_private.cithela_commercial_entitlements (
  tenant_id uuid PRIMARY KEY REFERENCES public.cithela_tenants(id) ON DELETE RESTRICT,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (
    status IN ('legacy','trialing','payment_pending','active','past_due','canceled','suspended')
  ),
  plan_code text NOT NULL DEFAULT 'cithela-monthly',
  terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 120),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (
    (trial_started_at IS NULL AND trial_ends_at IS NULL) OR
    (trial_started_at IS NOT NULL AND trial_ends_at=trial_started_at+interval '7 days')
  ),
  CHECK (status <> 'trialing' OR (trial_started_at IS NOT NULL AND trial_ends_at IS NOT NULL)),
  CHECK (status <> 'active' OR
    (current_period_end IS NOT NULL AND provider IS NOT NULL AND provider_subscription_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS cithela_trial_once_per_verified_user
  ON cithela_private.cithela_commercial_entitlements(owner_user_id)
  WHERE trial_started_at IS NOT NULL AND owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cithela_provider_subscription_unique
  ON cithela_private.cithela_commercial_entitlements(provider,provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;
ALTER TABLE cithela_private.cithela_commercial_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_commercial_entitlements FROM PUBLIC,anon,authenticated;

-- Existing owners receive an explicit grandfathered row BEFORE enforcement.
-- This is an example of a future migration, not an automatic release action.
INSERT INTO cithela_private.cithela_commercial_entitlements
 (tenant_id,owner_user_id,status,terms_version)
SELECT m.tenant_id,m.user_id,'legacy','legacy-2026-11-02'
FROM public.cithela_tenant_memberships m
WHERE m.role='owner'
  AND NOT EXISTS (
    SELECT 1 FROM cithela_private.cithela_commercial_entitlements x
    WHERE x.tenant_id=m.tenant_id
  )
ON CONFLICT (tenant_id) DO NOTHING;

-- Internal helper; security-definer in private schema, no PUBLIC execute grant.
-- 'trial_expired' is computed on every call, not dependent on a cron job.
CREATE OR REPLACE FUNCTION cithela_private.commercial_entitlement_snapshot(
  p_tenant_id uuid,
  p_check_at timestamptz DEFAULT statement_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  e cithela_private.cithela_commercial_entitlements%ROWTYPE;
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
  ELSIF s='trialing' THEN
    IF p_check_at<e.trial_ends_at THEN allowed:=true;
    ELSE s:='trial_expired'; END IF;
  ELSIF s='active' THEN
    IF e.current_period_end>p_check_at THEN allowed:=true;
    ELSE s:='past_due'; END IF;
  END IF;
  RETURN jsonb_build_object(
    'status',s,'can_book',allowed,
    'trial_ends_at',e.trial_ends_at,
    'current_period_end',e.current_period_end
  );
END
$function$;
REVOKE ALL ON FUNCTION cithela_private.commercial_entitlement_snapshot(uuid,timestamptz)
 FROM PUBLIC,anon,authenticated;

-- When activation is approved, bootstrap must atomically consume a verified
-- onboarding grant and insert trialing with server statement_timestamp().
-- Never take trial_started_at or terms_version from query parameters/JS.
-- Do NOT deploy the helper alone as proof of trial enforcement.
-- All booking creation and reschedule entry points (professional, patient,
-- WhatsApp) and availability/read pathways must enforce can_book=false on
-- trial_expired, while allowing login, cancellation, export and support.
