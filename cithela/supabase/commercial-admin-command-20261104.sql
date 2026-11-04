-- CITHELA · commercial administration for a trusted server-only endpoint.
-- Requires installed commercial-controls-price-free-retention-20261104.sql.
-- Only service_role can EXECUTE. The separate Edge endpoint must authenticate
-- a verified user and match their UUID to the configured platform-admin secret.
-- No prices are published and no bookings, payments or tenants are deleted.
CREATE TABLE cithela_private.cithela_commercial_admin_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'create_price','choose_price','grant_free','revoke_free','set_retention')),
  tenant_id uuid,
  price_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE cithela_private.cithela_commercial_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cithela_private.cithela_commercial_admin_audit
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cithela_commercial_admin_command(
 p_actor uuid,p_action text,p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $admin$
DECLARE
  pid uuid;
  tid uuid;
  owner_id uuid;
  option_label text;
  amount_value bigint;
  expiry timestamptz;
  grant_reason text;
  n int;
  after_review int;
  after_purge int;
  prices jsonb;
  tenants jsonb;
  candidates jsonb;
  settings jsonb;
BEGIN
  -- This RPC is server-only; the Edge caller must already have verified
  -- p_actor's JWT and the platform administrator allowlist. Fail closed.
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL
  ) THEN RETURN jsonb_build_object('ok',false,'code','admin_not_verified'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR
     length(p_payload::text)>3500 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_payload'); END IF;

  IF p_action='read' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',p.price_id,'label',p.label,'amount_minor',p.amount_minor,
      'selected',p.is_selected,'published',p.is_published,
      'currency',p.currency_id,'interval',p.interval_unit
    ) ORDER BY p.amount_minor,p.label),'[]'::jsonb)
    INTO prices FROM cithela_private.cithela_price_options p;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'name',t.display_name,
      'status',e.status,'trial_ends_at',e.trial_ends_at,
      'complimentary',EXISTS (
         SELECT 1 FROM cithela_private.cithela_complimentary_grants g
         WHERE g.tenant_id=t.id AND g.revoked_at IS NULL
           AND g.starts_at<=statement_timestamp()
           AND (g.expires_at IS NULL OR g.expires_at>statement_timestamp())
      ),
      'has_unrevoked_grant',EXISTS (
         SELECT 1 FROM cithela_private.cithela_complimentary_grants g
         WHERE g.tenant_id=t.id AND g.revoked_at IS NULL
      ),
      'complimentary_until',(
         SELECT g.expires_at FROM cithela_private.cithela_complimentary_grants g
         WHERE g.tenant_id=t.id AND g.revoked_at IS NULL
           AND g.starts_at<=statement_timestamp()
           AND (g.expires_at IS NULL OR g.expires_at>statement_timestamp())
         LIMIT 1
      )
    ) ORDER BY t.created_at),'[]'::jsonb)
    INTO tenants FROM public.cithela_tenants t
      JOIN cithela_private.cithela_commercial_entitlements e
        ON e.tenant_id=t.id;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tenant_id',c.tenant_id,'days_expired',c.days_expired,
      'stage',c.stage,'historical_appointments',c.historical_appointments
    ) ORDER BY c.days_expired DESC),'[]'::jsonb)
    INTO candidates FROM (
      SELECT * FROM cithela_private.cithela_trial_cleanup_preview(
        statement_timestamp()) LIMIT 100
    ) c;
    SELECT jsonb_build_object(
     'review_after_days',r.review_after_days,
     'purge_review_after_days',r.purge_review_after_days,
     'automatic_purge',r.automatic_purge)
    INTO settings FROM cithela_private.cithela_retention_settings r
    WHERE r.id=1;
    RETURN jsonb_build_object('ok',true,'code','snapshot',
       'prices',prices,'tenants',tenants,'candidates',candidates,
       'retention',settings);
  END IF;

  IF p_action='create_price' THEN
    option_label:=btrim(coalesce(p_payload->>'label',''));
    IF length(option_label) NOT BETWEEN 3 AND 70
       OR coalesce(p_payload->>'amount_minor','') !~ '^[1-9][0-9]{2,11}$'
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_price'); END IF;
    amount_value:=(p_payload->>'amount_minor')::bigint;
    IF amount_value NOT BETWEEN 100 AND 100000000000
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_price'); END IF;
    INSERT INTO cithela_private.cithela_price_options
     (label,amount_minor) VALUES(option_label,amount_value)
    ON CONFLICT (plan_code,amount_minor) DO NOTHING
    RETURNING price_id INTO pid;
    IF pid IS NULL THEN
      RETURN jsonb_build_object('ok',false,'code','price_already_exists'); END IF;
    INSERT INTO cithela_private.cithela_commercial_admin_audit
      (actor_user_id,action,price_id,detail)
    VALUES (p_actor,'create_price',pid,
      jsonb_build_object('amount_minor',amount_value,'currency','ARS'));
    RETURN jsonb_build_object('ok',true,'code','price_created','price_id',pid);
  END IF;

  IF p_action='choose_price' THEN
    IF coalesce(p_payload->>'price_id','') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_price'); END IF;
    pid:=(p_payload->>'price_id')::uuid;
    PERFORM pg_catalog.pg_advisory_xact_lock(1449031873);
    IF NOT EXISTS(SELECT 1 FROM cithela_private.cithela_price_options p
      WHERE p.price_id=pid) THEN
      RETURN jsonb_build_object('ok',false,'code','price_not_found'); END IF;
    UPDATE cithela_private.cithela_price_options SET
      is_selected=false,updated_at=statement_timestamp()
      WHERE is_selected=true AND price_id<>pid;
    UPDATE cithela_private.cithela_price_options SET
      is_selected=true,updated_at=statement_timestamp()
      WHERE price_id=pid AND is_selected=false;
    INSERT INTO cithela_private.cithela_commercial_admin_audit
      (actor_user_id,action,price_id) VALUES(p_actor,'choose_price',pid);
    RETURN jsonb_build_object('ok',true,'code','price_selected','price_id',pid);
  END IF;

  IF p_action IN ('grant_free','revoke_free') THEN
    IF coalesce(p_payload->>'tenant_id','') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_tenant'); END IF;
    tid:=(p_payload->>'tenant_id')::uuid;
    IF p_action='grant_free' THEN
      grant_reason:=btrim(coalesce(p_payload->>'reason',''));
      IF length(grant_reason) NOT BETWEEN 5 AND 240
      THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason'); END IF;
      IF p_payload ? 'expires_at'
        AND jsonb_typeof(p_payload->'expires_at') <> 'null' THEN
        BEGIN expiry:=(p_payload->>'expires_at')::timestamptz;
        EXCEPTION WHEN others THEN
          RETURN jsonb_build_object('ok',false,'code','invalid_expiry');
        END;
        IF expiry<=statement_timestamp() OR
          expiry>statement_timestamp()+interval '10 years' THEN
          RETURN jsonb_build_object('ok',false,'code','invalid_expiry'); END IF;
      END IF;
      SELECT e.owner_user_id INTO owner_id
       FROM cithela_private.cithela_commercial_entitlements e
       JOIN public.cithela_tenant_memberships m
        ON m.tenant_id=e.tenant_id AND m.user_id=e.owner_user_id
       WHERE e.tenant_id=tid AND m.role='owner' AND e.status IN
         ('trialing','payment_pending','past_due','canceled');
      IF owner_id IS NULL THEN
        RETURN jsonb_build_object('ok',false,'code','tenant_not_eligible');END IF;
      IF EXISTS (
       SELECT 1 FROM cithela_private.cithela_complimentary_grants g
       WHERE g.tenant_id=tid AND g.revoked_at IS NULL
      ) THEN RETURN jsonb_build_object('ok',false,'code','grant_already_exists'); END IF;
      INSERT INTO cithela_private.cithela_complimentary_grants
       (tenant_id,owner_user_id,granted_by,grant_reason,expires_at)
      VALUES (tid,owner_id,p_actor,grant_reason,expiry);
      INSERT INTO cithela_private.cithela_commercial_admin_audit
        (actor_user_id,action,tenant_id,detail)
      VALUES(p_actor,'grant_free',tid,
        jsonb_build_object('expires_at',expiry,'reason',grant_reason));
      RETURN jsonb_build_object('ok',true,'code','grant_created');
    ELSE
      UPDATE cithela_private.cithela_complimentary_grants
      SET revoked_at=statement_timestamp()
      WHERE tenant_id=tid AND revoked_at IS NULL;
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n=0 THEN RETURN jsonb_build_object('ok',false,'code','grant_not_found');END IF;
      INSERT INTO cithela_private.cithela_commercial_admin_audit
        (actor_user_id,action,tenant_id)
      VALUES(p_actor,'revoke_free',tid);
      RETURN jsonb_build_object('ok',true,'code','grant_revoked');
    END IF;
  END IF;

  IF p_action='set_retention' THEN
    IF coalesce(p_payload->>'review_days','') !~ '^[0-9]{1,3}$'
       OR coalesce(p_payload->>'purge_review_days','') !~ '^[0-9]{1,3}$'
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_retention'); END IF;
    after_review:=(p_payload->>'review_days')::int;
    after_purge:=(p_payload->>'purge_review_days')::int;
    IF after_review<7 OR after_review>365 OR after_purge<30
       OR after_purge>730 OR after_purge<=after_review
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_retention'); END IF;
    UPDATE cithela_private.cithela_retention_settings
      SET review_after_days=after_review,
          purge_review_after_days=after_purge,
          updated_at=statement_timestamp()
      WHERE id=1;
    INSERT INTO cithela_private.cithela_commercial_admin_audit
      (actor_user_id,action,detail)
    VALUES(p_actor,'set_retention',jsonb_build_object(
      'review_days',after_review,'purge_review_days',after_purge));
    RETURN jsonb_build_object('ok',true,'code','retention_updated');
  END IF;
  RETURN jsonb_build_object('ok',false,'code','unknown_action');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
END
$admin$;
REVOKE ALL ON FUNCTION public.cithela_commercial_admin_command(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cithela_commercial_admin_command(uuid,text,jsonb)
 TO service_role;
