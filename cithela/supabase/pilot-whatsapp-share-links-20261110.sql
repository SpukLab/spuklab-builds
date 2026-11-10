-- CITHELA · invitación piloto multienlace desde WhatsApp · 2026-11-10.
-- Es un enlace reutilizable con cupo/vencimiento, NO alta pública ilimitada.
-- Compatible con alta individual existente. Sin cobros, sin borrar agendas.
-- Edge debe verificar JWT y admin UID. Esta RPC es service_role ONLY.
BEGIN;
CREATE TABLE cithela_private.cithela_pilot_share_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  max_uses smallint NOT NULL CHECK (max_uses BETWEEN 1 AND 5),
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at>issued_at AND expires_at<=issued_at+interval '7 days'),
  CHECK (revoked_at IS NULL OR revoked_at>=issued_at)
);
CREATE INDEX cithela_pilot_share_links_issued
  ON cithela_private.cithela_pilot_share_links(issued_by,issued_at DESC);
CREATE TABLE cithela_private.cithela_pilot_share_uses (
  link_id uuid NOT NULL REFERENCES cithela_private.cithela_pilot_share_links(link_id)
    ON DELETE RESTRICT,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  used_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(link_id,user_id)
);
CREATE INDEX cithela_pilot_share_uses_used_at
  ON cithela_private.cithela_pilot_share_uses(used_at);
ALTER TABLE cithela_private.cithela_pilot_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cithela_private.cithela_pilot_share_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_pilot_share_links FROM PUBLIC,anon,authenticated;
REVOKE ALL ON cithela_private.cithela_pilot_share_uses FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cithela_pilot_share_link_command(
  p_actor uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $share$
DECLARE
  v_hash text:=coalesce(p_payload->>'token_hash','');
  v_id uuid;
  v_uses int;
  v_limit int;
  v_verified timestamptz;
  v_grant cithela_private.cithela_onboarding_grants%ROWTYPE;
  v_link cithela_private.cithela_pilot_share_links%ROWTYPE;
  v_list jsonb;
  v_now timestamptz:=statement_timestamp();
BEGIN
  IF p_actor IS NULL OR p_payload IS NULL
    OR jsonb_typeof(p_payload)<>'object' OR length(p_payload::text)>512 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request');
  END IF;
  -- Ensures the Edge-resolved JWT belongs to an existing verified user.
  SELECT u.email_confirmed_at INTO v_verified
    FROM auth.users u WHERE u.id=p_actor;
  IF v_verified IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','email_unverified');
  END IF;

  IF p_action='issue' THEN
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
        IS DISTINCT FROM ARRAY['max_uses','token_hash']::text[]
      OR v_hash !~ '^[0-9a-f]{64}$'
      OR coalesce(p_payload->>'max_uses','') !~ '^[1-5]$' THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_request');
    END IF;
    v_limit:=(p_payload->>'max_uses')::int;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('cithela-pilot-share-global',0));
    IF (SELECT count(*) FROM cithela_private.cithela_pilot_share_links
       WHERE issued_by=p_actor AND issued_at>v_now-interval '24 hours')>=4 THEN
      RETURN jsonb_build_object('ok',false,'code','daily_limit');
    END IF;
    INSERT INTO cithela_private.cithela_pilot_share_links(
      token_hash,issued_by,max_uses,issued_at,expires_at)
    VALUES(v_hash,p_actor,v_limit,v_now,v_now+interval '7 days')
    RETURNING link_id INTO v_id;
    RETURN jsonb_build_object('ok',true,'code','link_created',
       'link_id',v_id,'expires_at',v_now+interval '7 days',
       'max_uses',v_limit);
  END IF;

  IF p_action='list' THEN
    IF p_payload<>'{}'::jsonb THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_request');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',x.link_id,'issued_at',x.issued_at,
      'expires_at',x.expires_at,'max_uses',x.max_uses,
      'used',x.used,'status',CASE
        WHEN x.revoked_at IS NOT NULL THEN 'revoked'
        WHEN x.expires_at<=v_now THEN 'expired'
        WHEN x.used>=x.max_uses THEN 'exhausted'
        ELSE 'active' END
    ) ORDER BY x.issued_at DESC),'[]'::jsonb) INTO v_list
    FROM (
      SELECT l.*,
        (SELECT count(*) FROM cithela_private.cithela_pilot_share_uses u
         WHERE u.link_id=l.link_id) AS used
      FROM cithela_private.cithela_pilot_share_links l
      WHERE l.issued_by=p_actor
      ORDER BY l.issued_at DESC LIMIT 30
    ) x;
    RETURN jsonb_build_object('ok',true,'code','links_listed','links',v_list);
  END IF;

  IF p_action='revoke' THEN
    IF (SELECT array_agg(k) FROM jsonb_object_keys(p_payload) k)
       IS DISTINCT FROM ARRAY['link_id']::text[]
       OR coalesce(p_payload->>'link_id','') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
    v_id:=(p_payload->>'link_id')::uuid;
    SELECT * INTO v_link
      FROM cithela_private.cithela_pilot_share_links l
      WHERE l.link_id=v_id AND l.issued_by=p_actor FOR UPDATE;
    IF NOT FOUND OR v_link.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'code','link_not_found');
    END IF;
    UPDATE cithela_private.cithela_pilot_share_links
      SET revoked_at=v_now WHERE link_id=v_id;
    -- Also invalidate grants not yet consumed. Existing agendas/trials remain.
    UPDATE cithela_private.cithela_onboarding_grants g
      SET expires_at=greatest(g.approved_at+interval '1 microsecond',v_now)
    WHERE g.reason='pilot_share_link' AND g.consumed_at IS NULL
      AND g.user_id IN (
        SELECT u.user_id FROM cithela_private.cithela_pilot_share_uses u
        WHERE u.link_id=v_id
      );
    RETURN jsonb_build_object('ok',true,'code','link_revoked');
  END IF;

  IF p_action='redeem' THEN
    IF (SELECT array_agg(k) FROM jsonb_object_keys(p_payload) k)
       IS DISTINCT FROM ARRAY['token_hash']::text[]
      OR v_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_request');
    END IF;
    -- Serializes simultaneous attempts by one user and link globally.
    PERFORM 1 FROM auth.users u WHERE u.id=p_actor FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'code','unauthenticated');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cithela_tenant_memberships m
      WHERE m.user_id=p_actor) THEN
      RETURN jsonb_build_object('ok',true,'code','workspace_exists');
    END IF;
    SELECT * INTO v_grant FROM cithela_private.cithela_onboarding_grants g
      WHERE g.user_id=p_actor FOR UPDATE;
    IF FOUND THEN
      IF v_grant.reason='pilot_share_link'
        AND v_grant.consumed_at IS NULL AND v_grant.expires_at>v_now
        AND EXISTS (
          SELECT 1 FROM cithela_private.cithela_pilot_share_uses u
          JOIN cithela_private.cithela_pilot_share_links l USING (link_id)
          WHERE u.user_id=p_actor AND l.token_hash=v_hash AND l.revoked_at IS NULL
        )
      THEN RETURN jsonb_build_object('ok',true,'code','grant_ready'); END IF;
      RETURN jsonb_build_object('ok',false,'code','already_authorized');
    END IF;
    IF EXISTS (
      SELECT 1 FROM cithela_private.cithela_commercial_entitlements e
      WHERE e.owner_user_id=p_actor AND e.trial_started_at IS NOT NULL
    ) THEN RETURN jsonb_build_object('ok',false,'code','trial_already_used'); END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('cithela-pilot-share-global',0));
    IF (SELECT count(*) FROM cithela_private.cithela_pilot_share_uses u
        WHERE u.used_at>v_now-interval '24 hours')>=15 THEN
      RETURN jsonb_build_object('ok',false,'code','daily_limit');
    END IF;
    SELECT * INTO v_link FROM cithela_private.cithela_pilot_share_links l
      WHERE l.token_hash=v_hash FOR UPDATE;
    IF NOT FOUND OR v_link.revoked_at IS NOT NULL OR v_link.expires_at<=v_now THEN
      RETURN jsonb_build_object('ok',false,'code','link_unavailable');
    END IF;
    SELECT count(*) INTO v_uses FROM cithela_private.cithela_pilot_share_uses u
      WHERE u.link_id=v_link.link_id;
    IF v_uses>=v_link.max_uses THEN
      RETURN jsonb_build_object('ok',false,'code','link_exhausted');
    END IF;
    IF EXISTS (SELECT 1 FROM cithela_private.cithela_pilot_share_uses u
       WHERE u.user_id=p_actor) THEN
      RETURN jsonb_build_object('ok',false,'code','already_authorized');
    END IF;
    INSERT INTO cithela_private.cithela_onboarding_grants(
      user_id,terms_version,reason,approved_at,expires_at
    ) VALUES(
      p_actor,'pilot-share-link-20261110','pilot_share_link',
      v_now,least(v_link.expires_at,v_now+interval '48 hours')
    );
    INSERT INTO cithela_private.cithela_pilot_share_uses(link_id,user_id,used_at)
      VALUES(v_link.link_id,p_actor,v_now);
    RETURN jsonb_build_object('ok',true,'code','grant_ready');
  END IF;
  RETURN jsonb_build_object('ok',false,'code','invalid_action');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
END
$share$;
REVOKE ALL ON FUNCTION public.cithela_pilot_share_link_command(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_pilot_share_link_command(uuid,text,jsonb)
  TO service_role;
COMMIT;
