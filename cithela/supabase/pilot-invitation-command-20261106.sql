-- Etapa 2: RPC exclusiva de service_role. La Edge Function valida el JWT real.
CREATE OR REPLACE FUNCTION public.cithela_pilot_invitation_command(
 p_actor uuid,p_action text,p_email text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
 e text := lower(btrim(coalesce(p_email,'')));
 em text;
 confirmed timestamptz;
 i cithela_private.cithela_pilot_invites%ROWTYPE;
 allowed boolean;
 rows_json jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor) THEN
  RETURN jsonb_build_object('ok',false,'code','unauthenticated');
 END IF;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('email',v.email,
   'expires_at',v.expires_at,'issued_at',v.issued_at,'status',
   CASE WHEN v.revoked_at IS NOT NULL THEN 'revoked'
    WHEN v.redeemed_at IS NOT NULL THEN 'redeemed'
    WHEN v.expires_at<=statement_timestamp() THEN 'expired'
    ELSE 'pending' END) ORDER BY v.issued_at DESC),'[]'::jsonb)
  INTO rows_json FROM cithela_private.cithela_pilot_invites v;
  RETURN jsonb_build_object('ok',true,'code','invites_listed','invites',rows_json);
 END IF;
 IF p_action='issue' THEN
  IF length(e) NOT BETWEEN 5 AND 254 OR
    e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_email');
  END IF;
  IF (SELECT count(*) FROM cithela_private.cithela_pilot_invites
       WHERE issued_by=p_actor AND issued_at>now()-interval '24 hours')>=20 THEN
   RETURN jsonb_build_object('ok',false,'code','limit_reached');
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users u JOIN public.cithela_tenant_memberships m
    ON m.user_id=u.id WHERE lower(u.email)=e) THEN
   RETURN jsonb_build_object('ok',false,'code','workspace_exists');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cithela-invite:'||e,0));
  SELECT * INTO i FROM cithela_private.cithela_pilot_invites
    WHERE email=e FOR UPDATE;
  IF FOUND AND i.redeemed_at IS NOT NULL AND i.revoked_at IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','already_redeemed');
  END IF;
  IF FOUND AND i.revoked_at IS NULL AND i.expires_at>now() THEN
   RETURN jsonb_build_object('ok',true,'code','already_invited','expires_at',i.expires_at);
  END IF;
  INSERT INTO cithela_private.cithela_pilot_invites
    (email,issued_by,issued_at,expires_at,redeemed_by,redeemed_at,revoked_at)
  VALUES(e,p_actor,statement_timestamp(),statement_timestamp()+interval '7 days',
    NULL,NULL,NULL)
  ON CONFLICT(email) DO UPDATE SET issued_by=excluded.issued_by,
    issued_at=excluded.issued_at,expires_at=excluded.expires_at,
    redeemed_by=NULL,redeemed_at=NULL,revoked_at=NULL
  RETURNING * INTO i;
  RETURN jsonb_build_object('ok',true,'code','invite_issued','expires_at',i.expires_at);
 END IF;
 IF p_action='revoke' THEN
  SELECT * INTO i FROM cithela_private.cithela_pilot_invites
    WHERE email=e FOR UPDATE;
  IF NOT FOUND OR i.revoked_at IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','invite_not_active');
  END IF;
  IF i.redeemed_at IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','already_redeemed');
  END IF;
  UPDATE cithela_private.cithela_pilot_invites SET revoked_at=statement_timestamp()
    WHERE email=e;
  RETURN jsonb_build_object('ok',true,'code','invite_revoked');
 END IF;
 IF p_action='redeem' THEN
  -- La identidad y el correo salen de Auth, nunca de p_email ni del navegador.
  SELECT lower(btrim(u.email)),u.email_confirmed_at
    INTO em,confirmed FROM auth.users u WHERE u.id=p_actor FOR UPDATE;
  IF em IS NULL OR confirmed IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','email_unverified');
  END IF;
  IF EXISTS(SELECT 1 FROM public.cithela_tenant_memberships
      WHERE user_id=p_actor) THEN
   RETURN jsonb_build_object('ok',true,'code','workspace_exists');
  END IF;
  SELECT * INTO i FROM cithela_private.cithela_pilot_invites
    WHERE email=em FOR UPDATE;
  IF NOT FOUND OR i.revoked_at IS NOT NULL OR i.expires_at<=now() OR
     (i.redeemed_by IS NOT NULL AND i.redeemed_by<>p_actor) THEN
   RETURN jsonb_build_object('ok',false,'code','invite_invalid');
  END IF;
  INSERT INTO cithela_private.cithela_onboarding_grants
    (user_id,terms_version,reason,approved_at,expires_at)
  VALUES(p_actor,'pilot-supervised-20261106','pilot_invite',
    statement_timestamp(),i.expires_at)
  ON CONFLICT(user_id) DO NOTHING;
  SELECT EXISTS(SELECT 1 FROM cithela_private.cithela_onboarding_grants g
    WHERE g.user_id=p_actor AND g.consumed_at IS NULL AND g.expires_at>now())
  INTO allowed;
  IF NOT allowed THEN
   RETURN jsonb_build_object('ok',false,'code','onboarding_not_authorized');
  END IF;
  UPDATE cithela_private.cithela_pilot_invites
    SET redeemed_by=p_actor,redeemed_at=coalesce(redeemed_at,statement_timestamp())
    WHERE email=em;
  RETURN jsonb_build_object('ok',true,'code','invite_accepted');
 END IF;
 RETURN jsonb_build_object('ok',false,'code','invalid_action');
END $$;
REVOKE ALL ON FUNCTION public.cithela_pilot_invitation_command(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_pilot_invitation_command(uuid,text,text)
  TO service_role;