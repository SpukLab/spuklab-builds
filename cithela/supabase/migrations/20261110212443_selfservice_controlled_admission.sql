-- Closed-by-default selfservice admission. Public enablement requires E2E, captcha and SMTP validation.
-- Reuses the existing invitation issue/redeem command and bootstrap gate.
CREATE TABLE cithela_private.cithela_selfservice_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 daily_limit integer NOT NULL DEFAULT 5 CHECK(daily_limit BETWEEN 1 AND 20),
 active_limit integer NOT NULL DEFAULT 20 CHECK(active_limit BETWEEN 1 AND 100),
 invitation_hours integer NOT NULL DEFAULT 24 CHECK(invitation_hours BETWEEN 1 AND 48),
 terms_version text NOT NULL DEFAULT 'selfservice-trial-20261110' CHECK(length(terms_version) BETWEEN 1 AND 120),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO cithela_private.cithela_selfservice_settings DEFAULT VALUES;
CREATE TABLE cithela_private.cithela_selfservice_admissions (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 email text NOT NULL UNIQUE,
 terms_version text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at>accepted_at)
);
CREATE INDEX cithela_selfservice_admissions_accepted ON cithela_private.cithela_selfservice_admissions(accepted_at);
ALTER TABLE cithela_private.cithela_selfservice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cithela_private.cithela_selfservice_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_selfservice_settings,cithela_private.cithela_selfservice_admissions FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cithela_selfservice_command(
 p_actor uuid,p_admin uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $body$
DECLARE
 cfg cithela_private.cithela_selfservice_settings%ROWTYPE;
 actor_email text;
 verified timestamptz;
 prior cithela_private.cithela_selfservice_admissions%ROWTYPE;
 out jsonb;
 exp_at timestamptz;
 active_count integer;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>500 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_request');
 END IF;
 -- Same lock for admission and configuration; quota decisions and grants are atomic.
 IF p_action IN ('admit','configure') THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cithela-selfservice',0));
 END IF;
 SELECT * INTO STRICT cfg FROM cithela_private.cithela_selfservice_settings WHERE singleton;
 IF p_action IN ('read','configure') THEN
  IF p_actor IS NULL OR p_actor IS DISTINCT FROM p_admin OR NOT EXISTS(
   SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL
  ) THEN RETURN jsonb_build_object('ok',false,'code','forbidden'); END IF;
  IF p_action='configure' THEN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
    IS DISTINCT FROM ARRAY['active_limit','daily_limit','enabled','invitation_hours']::text[]
    OR jsonb_typeof(p_payload->'enabled')<>'boolean'
    OR coalesce(p_payload->>'daily_limit','')!~'^[0-9]{1,2}$'
    OR coalesce(p_payload->>'active_limit','')!~'^[0-9]{1,3}$'
    OR coalesce(p_payload->>'invitation_hours','')!~'^[0-9]{1,2}$'
    OR (p_payload->>'daily_limit')::int NOT BETWEEN 1 AND 20
    OR (p_payload->>'active_limit')::int NOT BETWEEN 1 AND 100
    OR (p_payload->>'invitation_hours')::int NOT BETWEEN 1 AND 48
   THEN RETURN jsonb_build_object('ok',false,'code','invalid_limits'); END IF;
   UPDATE cithela_private.cithela_selfservice_settings SET
    enabled=(p_payload->>'enabled')::boolean,daily_limit=(p_payload->>'daily_limit')::int,
    active_limit=(p_payload->>'active_limit')::int,invitation_hours=(p_payload->>'invitation_hours')::int,
    updated_at=statement_timestamp() WHERE singleton RETURNING * INTO cfg;
  END IF;
  RETURN jsonb_build_object('ok',true,'code','settings','settings',to_jsonb(cfg)-'singleton');
 END IF;
 IF p_action='resume' THEN
  IF p_payload<>'{}'::jsonb THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL) THEN
   RETURN jsonb_build_object('ok',false,'code','email_unverified'); END IF;
  IF EXISTS(SELECT 1 FROM public.cithela_tenant_memberships WHERE user_id=p_actor) THEN
   RETURN jsonb_build_object('ok',true,'code','workspace_exists'); END IF;
  IF EXISTS(SELECT 1 FROM cithela_private.cithela_selfservice_admissions a
    JOIN cithela_private.cithela_onboarding_grants g USING(user_id)
    WHERE a.user_id=p_actor AND g.consumed_at IS NULL AND g.expires_at>statement_timestamp()
     AND a.expires_at>statement_timestamp()) THEN
   RETURN jsonb_build_object('ok',true,'code','grant_ready'); END IF;
  RETURN jsonb_build_object('ok',false,'code','no_pending_admission');
 END IF;
 IF p_action NOT IN ('status','admit') OR (p_action='status' AND p_payload<>'{}'::jsonb) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_action');
 END IF;
 IF NOT cfg.enabled THEN RETURN jsonb_build_object('ok',false,'code','admissions_closed'); END IF;
 -- Reserve capacity for unconsumed invitations as well as existing active trials.
 SELECT (SELECT count(*) FROM cithela_private.cithela_commercial_entitlements e
   WHERE e.status='trialing' AND e.trial_ends_at>statement_timestamp())+
  (SELECT count(*) FROM cithela_private.cithela_onboarding_grants g
   WHERE g.consumed_at IS NULL AND g.expires_at>statement_timestamp()) INTO active_count;
 IF p_action='status' THEN
  IF active_count>=cfg.active_limit OR (SELECT count(*) FROM cithela_private.cithela_selfservice_admissions WHERE accepted_at>statement_timestamp()-interval '24 hours')>=cfg.daily_limit THEN
   RETURN jsonb_build_object('ok',false,'code','capacity_reached'); END IF;
  RETURN jsonb_build_object('ok',true,'code','available','terms_version',cfg.terms_version);
 END IF;
 IF (SELECT array_agg(k) FROM jsonb_object_keys(p_payload) k) IS DISTINCT FROM ARRAY['terms_version']::text[]
  OR p_payload->>'terms_version' IS DISTINCT FROM cfg.terms_version THEN
  RETURN jsonb_build_object('ok',false,'code','terms_required'); END IF;
 -- Auth identity, verified email and user lock are server-owned.
 SELECT lower(btrim(email)),email_confirmed_at INTO actor_email,verified FROM auth.users WHERE id=p_actor FOR UPDATE;
 IF verified IS NULL OR actor_email IS NULL THEN RETURN jsonb_build_object('ok',false,'code','email_unverified'); END IF;
 IF EXISTS(SELECT 1 FROM public.cithela_tenant_memberships WHERE user_id=p_actor) THEN
  RETURN jsonb_build_object('ok',true,'code','workspace_exists'); END IF;
 SELECT * INTO prior FROM cithela_private.cithela_selfservice_admissions WHERE user_id=p_actor OR email=actor_email;
 IF FOUND THEN
  IF prior.user_id=p_actor AND EXISTS(SELECT 1 FROM cithela_private.cithela_onboarding_grants WHERE user_id=p_actor AND consumed_at IS NULL AND expires_at>statement_timestamp()) THEN
   RETURN jsonb_build_object('ok',true,'code','grant_ready'); END IF;
  RETURN jsonb_build_object('ok',false,'code','trial_already_used');
 END IF;
 IF EXISTS(SELECT 1 FROM cithela_private.cithela_commercial_entitlements WHERE owner_user_id=p_actor AND trial_started_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','trial_already_used'); END IF;
 -- Preserve manual authorizations instead of rewriting or extending them.
 IF EXISTS(SELECT 1 FROM cithela_private.cithela_onboarding_grants WHERE user_id=p_actor)
  OR EXISTS(SELECT 1 FROM cithela_private.cithela_pilot_invites WHERE email=actor_email) THEN
  RETURN jsonb_build_object('ok',false,'code','existing_invitation'); END IF;
 IF active_count>=cfg.active_limit OR (SELECT count(*) FROM cithela_private.cithela_selfservice_admissions WHERE accepted_at>statement_timestamp()-interval '24 hours')>=cfg.daily_limit THEN
  RETURN jsonb_build_object('ok',false,'code','capacity_reached'); END IF;
 -- Nested block rolls back issue/redeem together on any failed operation.
 BEGIN
  out:=public.cithela_pilot_invitation_command(p_admin,'issue',actor_email);
  IF out->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'invitation_failed'; END IF;
  exp_at:=statement_timestamp()+make_interval(hours=>cfg.invitation_hours);
  UPDATE cithela_private.cithela_pilot_invites SET expires_at=exp_at WHERE email=actor_email;
  out:=public.cithela_pilot_invitation_command(p_actor,'redeem',NULL);
  IF out->>'ok' IS DISTINCT FROM 'true' OR out->>'code'<>'invite_accepted' THEN RAISE EXCEPTION 'redemption_failed'; END IF;
  UPDATE cithela_private.cithela_onboarding_grants SET terms_version=cfg.terms_version WHERE user_id=p_actor;
  INSERT INTO cithela_private.cithela_selfservice_admissions(user_id,email,terms_version,expires_at)
   VALUES(p_actor,actor_email,cfg.terms_version,exp_at);
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','admission_unavailable'); END;
 RETURN jsonb_build_object('ok',true,'code','grant_ready');
END $body$;
REVOKE ALL ON FUNCTION public.cithela_selfservice_command(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_selfservice_command(uuid,uuid,text,jsonb) TO service_role;
