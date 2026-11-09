-- CITHELA · 2026-11-09 · grace is additive, never a billing change.
-- Requires commercial-controls-price-free-retention-20261104.sql
-- and commercial-admin-command-20261104.sql.
-- Installing functions does not modify tenants, contracts, payments, or grants.
BEGIN;
ALTER TABLE cithela_private.cithela_commercial_admin_audit
  DROP CONSTRAINT cithela_commercial_admin_audit_action_check;
ALTER TABLE cithela_private.cithela_commercial_admin_audit
  ADD CONSTRAINT cithela_commercial_admin_audit_action_check
  CHECK (action IN ('create_price','choose_price','grant_free',
    'extend_free','revoke_free','set_retention'));

CREATE OR REPLACE FUNCTION cithela_private.cithela_complimentary_grant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(
      SELECT 1
      FROM cithela_private.cithela_commercial_entitlements e
      JOIN public.cithela_tenant_memberships m
       ON m.tenant_id=e.tenant_id AND m.user_id=e.owner_user_id
      WHERE e.tenant_id=NEW.tenant_id
       AND e.owner_user_id=NEW.owner_user_id
       AND m.role='owner'
       AND e.status IN ('trialing','payment_pending','past_due','canceled','active')
    ) THEN
      RAISE EXCEPTION 'complimentary_owner_or_state_invalid';
    END IF;
  ELSE
    -- Prevent silently moving a free grant to another establishment or
    -- relabeling who approved it. Revocation is permanent for that record.
    IF (NEW.tenant_id,NEW.owner_user_id,NEW.granted_by,NEW.starts_at,NEW.created_at)
       IS DISTINCT FROM
       (OLD.tenant_id,OLD.owner_user_id,OLD.granted_by,OLD.starts_at,OLD.created_at)
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
        OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
        OR (OLD.expires_at IS NULL AND NEW.expires_at IS NOT NULL)
        OR (OLD.expires_at IS NOT NULL AND NEW.expires_at IS NOT NULL
            AND NEW.expires_at<OLD.expires_at)
    THEN
      RAISE EXCEPTION 'complimentary_grant_immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION cithela_private.commercial_entitlement_snapshot(
 p_tenant_id uuid,p_check_at timestamptz DEFAULT statement_timestamp())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $snapshot$
DECLARE
  e cithela_private.cithela_commercial_entitlements%ROWTYPE;
  g cithela_private.cithela_complimentary_grants%ROWTYPE;
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
  ELSIF s='active' THEN
    IF e.current_period_end>p_check_at THEN allowed:=true;
    ELSE s:='past_due'; END IF;
  END IF;
  -- Preserve active paid periods; apply grace only after the paid period expires.
  IF NOT allowed AND e.status IN
      ('trialing','payment_pending','past_due','canceled','active') THEN
    SELECT * INTO g FROM cithela_private.cithela_complimentary_grants y
      WHERE y.tenant_id=p_tenant_id AND y.owner_user_id=e.owner_user_id
        AND y.revoked_at IS NULL AND y.starts_at<=p_check_at
        AND (y.expires_at IS NULL OR y.expires_at>p_check_at);
    IF FOUND THEN
      s:='complimentary';
      allowed:=true;
    END IF;
  END IF;
  IF NOT allowed THEN
    IF s='trialing' THEN
      IF p_check_at<e.trial_ends_at THEN allowed:=true;
      ELSE s:='trial_expired'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'status',s,'can_book',allowed,
    'trial_ends_at',e.trial_ends_at,
    'current_period_end',e.current_period_end,
    'complimentary_until',CASE WHEN s='complimentary' THEN g.expires_at ELSE NULL END
  );
END
$snapshot$;

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
  trial_until timestamptz;
  paid_until timestamptz;
  previous_until timestamptz;
  baseline_until timestamptz;
  current_grant_id uuid;
  extra_days integer;
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
      'grant_unlimited',EXISTS (
         SELECT 1 FROM cithela_private.cithela_complimentary_grants g
         WHERE g.tenant_id=t.id AND g.revoked_at IS NULL
           AND g.expires_at IS NULL
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


  -- Monotonic access extension: never move a trial, paid period or grant
  -- backwards. Extension is not billing and does not alter the provider.
  IF p_action='extend_free' THEN
    IF coalesce(p_payload->>'tenant_id','') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}
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

    THEN RETURN jsonb_build_object('ok',false,'code','invalid_tenant'); END IF;
    tid:=(p_payload->>'tenant_id')::uuid;
    grant_reason:=btrim(coalesce(p_payload->>'reason',''));
    IF length(grant_reason) NOT BETWEEN 5 AND 240
    THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason'); END IF;
    IF NOT(p_payload ? 'days') THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_days');
    END IF;
    IF jsonb_typeof(p_payload->'days')='null' THEN
      extra_days:=NULL;
    ELSIF coalesce(p_payload->>'days','') ~ '^[1-9][0-9]{0,2}
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
 THEN
      extra_days:=(p_payload->>'days')::integer;
      IF extra_days>730 THEN
        RETURN jsonb_build_object('ok',false,'code','invalid_days');
      END IF;
    ELSE
      RETURN jsonb_build_object('ok',false,'code','invalid_days');
    END IF;
    SELECT e.owner_user_id,e.trial_ends_at,e.current_period_end
      INTO owner_id,trial_until,paid_until
      FROM cithela_private.cithela_commercial_entitlements e
      JOIN public.cithela_tenant_memberships m
       ON m.tenant_id=e.tenant_id AND m.user_id=e.owner_user_id
      WHERE e.tenant_id=tid AND m.role='owner'
       AND e.status IN ('trialing','payment_pending','past_due','canceled','active')
      FOR UPDATE OF e;
    IF owner_id IS NULL THEN
      RETURN jsonb_build_object('ok',false,'code','tenant_not_eligible'); END IF;
    SELECT g.grant_id,g.expires_at INTO current_grant_id,previous_until
      FROM cithela_private.cithela_complimentary_grants g
      WHERE g.tenant_id=tid AND g.owner_user_id=owner_id
       AND g.revoked_at IS NULL FOR UPDATE;
    IF current_grant_id IS NOT NULL AND previous_until IS NULL THEN
      RETURN jsonb_build_object('ok',false,'code','already_unlimited');
    END IF;
    baseline_until:=GREATEST(statement_timestamp(),
      coalesce(trial_until,statement_timestamp()),
      coalesce(paid_until,statement_timestamp()),
      coalesce(previous_until,statement_timestamp()));
    expiry:=CASE WHEN extra_days IS NULL THEN NULL
      ELSE baseline_until+make_interval(days=>extra_days) END;
    IF expiry IS NOT NULL AND (
       NOT isfinite(expiry) OR expiry>statement_timestamp()+interval '10 years'
    ) THEN RETURN jsonb_build_object('ok',false,'code','invalid_expiry'); END IF;
    IF current_grant_id IS NULL THEN
      INSERT INTO cithela_private.cithela_complimentary_grants
       (tenant_id,owner_user_id,granted_by,grant_reason,expires_at)
      VALUES(tid,owner_id,p_actor,grant_reason,expiry);
    ELSE
      UPDATE cithela_private.cithela_complimentary_grants
      SET expires_at=expiry
      WHERE grant_id=current_grant_id AND revoked_at IS NULL;
    END IF;
    INSERT INTO cithela_private.cithela_commercial_admin_audit
      (actor_user_id,action,tenant_id,detail)
    VALUES (p_actor,'extend_free',tid,jsonb_build_object(
      'previous_until',previous_until,'baseline_until',baseline_until,
      'new_until',expiry,'added_days',extra_days,'reason',grant_reason
    ));
    RETURN jsonb_build_object('ok',true,'code','access_extended',
      'new_until',expiry,'baseline_until',baseline_until);
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
COMMIT;
