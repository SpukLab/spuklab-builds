-- CITHELA Commercial Booking Enforcement V1.
-- DEPLOYED via Supabase migration cithela_commercial_booking_enforcement_20261102.
-- ARCHIVED historical review version. Canonical deployed SQL: ../supabase/commercial-booking-enforcement-20261102.sql.
-- Do NOT re-run this file as a new migration.
-- All live tenants become legacy (uninterrupted bookings).
-- New authorized tenants start a single 7-day trial inside bootstrap.
-- No payment integration or public signup is enabled.
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


-- Central guard protects every caller of the appointments table: professional,
-- patient, WhatsApp, and any future API path. It also catches direct SQL writes.
-- Cancellation, attendance and unchanged-slot confirmation remain possible.
CREATE OR REPLACE FUNCTION cithela_private.appointment_commercial_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  requires_access boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    requires_access:=NEW.status IN ('pending','confirmed');
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'cithela_tenant_change_forbidden' USING ERRCODE='23514';
    END IF;
    requires_access := NEW.status IN ('pending','confirmed') AND (
      OLD.status NOT IN ('pending','confirmed') OR
      NEW.starts_at IS DISTINCT FROM OLD.starts_at OR
      NEW.ends_at IS DISTINCT FROM OLD.ends_at OR
      NEW.person_id IS DISTINCT FROM OLD.person_id OR
      NEW.resource_id IS DISTINCT FROM OLD.resource_id OR
      NEW.service_id IS DISTINCT FROM OLD.service_id OR
      NEW.duration_min IS DISTINCT FROM OLD.duration_min
    );
  END IF;
  IF requires_access AND NOT COALESCE((
      cithela_private.commercial_entitlement_snapshot(NEW.tenant_id)
      ->>'can_book')::boolean,false) THEN
    RAISE EXCEPTION 'cithela_subscription_required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION cithela_private.appointment_commercial_guard()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS cithela_appointment_commercial_guard ON public.cithela_appointments;
CREATE TRIGGER cithela_appointment_commercial_guard
  BEFORE INSERT OR UPDATE ON public.cithela_appointments
  FOR EACH ROW EXECUTE FUNCTION cithela_private.appointment_commercial_guard();

-- Coordinated updates: enforce server-side denial at every entry point.
-- Patched source function: bootstrap_tenant
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
         statement_timestamp(), statement_timestamp()+interval '7 days'
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
$function$
;

-- Patched source function: channel_availability_core
CREATE OR REPLACE FUNCTION cithela_private.channel_availability_core(p_tenant_id uuid, p_service_id uuid, p_resource_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant_status text; v_tz text;
  v_svc public.cithela_services%rowtype;
  v_res public.cithela_resources%rowtype;
  v_wh record;
  v_has_specific boolean;
  v_slot_local timestamp;
  v_slot_abs timestamptz;
  v_slot_end timestamptz;
  v_slot_text text;
  v_slots jsonb:='[]'::jsonb;
  v_dow integer;
begin
  select t.status,t.timezone into v_tenant_status,v_tz
  from public.cithela_tenants t where t.id=p_tenant_id;
  if v_tenant_status is null then return jsonb_build_object('ok',false,'code','tenant_not_found'); end if;
  if v_tenant_status<>'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;
  if p_date is null or p_date<(statement_timestamp() at time zone v_tz)::date then
    return jsonb_build_object('ok',false,'code','invalid_date');
  end if;
  select * into v_svc from public.cithela_services s
    where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active;
  if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  select * into v_res from public.cithela_resources r
    where r.tenant_id=p_tenant_id and r.id=p_resource_id and r.active;
  if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;

  v_dow:=extract(isodow from p_date)::integer;
  select exists(
    select 1 from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.resource_id=p_resource_id and w.weekday=v_dow
  ) into v_has_specific;

  for v_wh in
    select w.starts_local,w.ends_local
    from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.weekday=v_dow
      and ((v_has_specific and w.resource_id=p_resource_id)
        or (not v_has_specific and w.resource_id is null))
    order by w.starts_local
  loop
    v_slot_local:=p_date+v_wh.starts_local;
    while v_slot_local+v_svc.duration_min*interval '1 minute'<=p_date+v_wh.ends_local loop
      v_slot_abs:=v_slot_local at time zone v_tz;
      v_slot_end:=v_slot_abs+v_svc.duration_min*interval '1 minute';
      if v_slot_abs>statement_timestamp()
        and not exists(
          select 1 from public.cithela_availability_blocks b
          where b.tenant_id=p_tenant_id
            and (b.resource_id is null or b.resource_id=p_resource_id)
            and b.starts_at<v_slot_end and b.ends_at>v_slot_abs
        )
        and not exists(
          select 1 from public.cithela_appointments a
          where a.tenant_id=p_tenant_id and a.resource_id=p_resource_id
            and a.status in ('pending','confirmed')
            and a.starts_at<v_slot_end and a.ends_at>v_slot_abs
        ) then
        v_slot_text:=to_char(v_slot_local,'HH24:MI');
        if not (v_slots ? v_slot_text) then
          v_slots:=v_slots||jsonb_build_array(v_slot_text);
        end if;
      end if;
      v_slot_local:=v_slot_local+interval '15 minutes';
    end loop;
  end loop;

  return jsonb_build_object(
    'ok',true,'code','availability','date',p_date,'timezone',v_tz,
    'service',jsonb_build_object('id',v_svc.id,'name',v_svc.name,'duration_min',v_svc.duration_min),
    'resource',jsonb_build_object('id',v_res.id,'name',v_res.name),
    'slots',v_slots
  );
end $function$
;

-- Patched source function: reservation_command
CREATE OR REPLACE FUNCTION cithela_private.reservation_command(p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  member_role text;
  tenant_status text;
  old_request public.cithela_channel_requests%rowtype;
  appt public.cithela_appointments%rowtype;
  svc public.cithela_services%rowtype;
  res public.cithela_resources%rowtype;
  person uuid;
  appointment_id uuid;
  expected bigint;
  start_time timestamptz;
  end_time timestamptz;
  code text;
  result jsonb;
  changed boolean := true;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command is null or p_command not in ('appointment.create','appointment.confirm','appointment.cancel','appointment.reschedule','appointment.attend','appointment.no_show') then
    return jsonb_build_object('ok',false,'code','unsupported_command');
  end if;
  select m.role into member_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=actor for share;
  if member_role is null or member_role not in ('owner','admin','operator') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  -- Serializes writes for one tenant, including duplicate request IDs. Future
  -- block/catalog commands must acquire this same lock before changing availability.
  select t.status into tenant_status from public.cithela_tenants t where t.id=p_tenant_id for update;
  if tenant_status is distinct from 'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  select * into old_request from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if old_request.actor_user_id is distinct from actor or old_request.command <> p_command
      or old_request.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return old_request.response || jsonb_build_object('replayed',true);
  end if;
  if p_command in ('appointment.create','appointment.reschedule') and
     not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;
  begin
    if p_command='appointment.create' then
      person := (p_payload->>'person_id')::uuid;
      select * into svc from public.cithela_services s where s.tenant_id=p_tenant_id and s.id=(p_payload->>'service_id')::uuid and s.active;
      if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
      select * into res from public.cithela_resources r where r.tenant_id=p_tenant_id and r.id=(p_payload->>'resource_id')::uuid and r.active;
      if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
      if not exists(select 1 from public.cithela_people p where p.tenant_id=p_tenant_id and p.id=person) then
        return jsonb_build_object('ok',false,'code','patient_not_found');
      end if;
    else
      appointment_id := (p_payload->>'id')::uuid;
      expected := (p_payload->>'expected_version')::bigint;
      if expected is null or expected < 1 then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      select * into appt from public.cithela_appointments a where a.tenant_id=p_tenant_id and a.id=appointment_id for update;
      if not found then return jsonb_build_object('ok',false,'code','appointment_not_found'); end if;
      if appt.row_version <> expected then return jsonb_build_object('ok',false,'code','stale_write'); end if;
      if p_command='appointment.confirm' and appt.status='confirmed' then
        code := 'appointment_already_confirmed'; changed := false;
      elsif p_command='appointment.cancel' and appt.status='cancelled' then
        code := 'appointment_already_cancelled'; changed := false;
      elsif p_command='appointment.attend' and appt.status='attended' then
        code := 'appointment_already_attended'; changed := false;
      elsif p_command='appointment.no_show' and appt.status='no_show' then
        code := 'appointment_already_no_show'; changed := false;
      elsif appt.status not in ('pending','confirmed') then
        return jsonb_build_object('ok',false,'code','invalid_state');
      end if;
      if changed and p_command in ('appointment.attend','appointment.no_show')
        and appt.starts_at > statement_timestamp() then
        return jsonb_build_object('ok',false,'code','appointment_not_started');
      end if;
    end if;
    if p_command in ('appointment.create','appointment.reschedule') then
      if coalesce(p_payload->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end if;
      start_time := (p_payload->>'starts_at')::timestamptz;
      if not isfinite(start_time) or start_time < statement_timestamp() then return jsonb_build_object('ok',false,'code','invalid_date'); end if;
      if p_command='appointment.reschedule' then
        select * into res from public.cithela_resources r where r.tenant_id=p_tenant_id and r.id=appt.resource_id and r.active;
        if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
        end_time := start_time + appt.duration_min * interval '1 minute';
      else
        end_time := start_time + svc.duration_min * interval '1 minute';
      end if;
      if exists(select 1 from public.cithela_availability_blocks b where b.tenant_id=p_tenant_id
        and (b.resource_id is null or b.resource_id=res.id)
        and b.starts_at < end_time and b.ends_at > start_time) then
        return jsonb_build_object('ok',false,'code','slot_unavailable');
      end if;
      if not cithela_private.working_hours_match(p_tenant_id,res.id,start_time,end_time) then
        return jsonb_build_object('ok',false,'code','outside_working_hours');
      end if;
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  begin
    if p_command='appointment.create' then
      insert into public.cithela_appointments(tenant_id,person_id,service_id,resource_id,starts_at,ends_at,service_name,duration_min,resource_name,reason)
        values(p_tenant_id,person,svc.id,res.id,start_time,end_time,svc.name,svc.duration_min,res.name,coalesce(p_payload->>'reason','')) returning * into appt;
      code := 'appointment_created';
    elsif changed then
      update public.cithela_appointments a set
        status=case p_command
          when 'appointment.confirm' then 'confirmed'
          when 'appointment.cancel' then 'cancelled'
          when 'appointment.attend' then 'attended'
          when 'appointment.no_show' then 'no_show'
          else 'pending' end,
        starts_at=case when p_command='appointment.reschedule' then start_time else a.starts_at end,
        ends_at=case when p_command='appointment.reschedule' then end_time else a.ends_at end,
        row_version=a.row_version+1, updated_at=clock_timestamp()
        where a.id=appt.id and a.tenant_id=p_tenant_id returning * into appt;
      code := case p_command
        when 'appointment.confirm' then 'appointment_confirmed'
        when 'appointment.cancel' then 'appointment_cancelled'
        when 'appointment.attend' then 'appointment_attended'
        when 'appointment.no_show' then 'appointment_no_show'
        else 'appointment_rescheduled' end;
    end if;
  exception when exclusion_violation then return jsonb_build_object('ok',false,'code','slot_unavailable');
  end;
  result := jsonb_build_object('ok',true,'code',code,'appointment',to_jsonb(appt),'replayed',false);
  if changed then
    insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
      values(p_tenant_id,actor,code,'appointment',appt.id,jsonb_build_object('request_id',p_request_id,'row_version',appt.row_version));
  end if;
  insert into public.cithela_channel_requests(tenant_id,request_id,command,response,actor_user_id,request_payload)
    values(p_tenant_id,p_request_id,p_command,result,actor,p_payload);
  return result;
end $function$
;

-- Patched source function: patient_booking_create
CREATE OR REPLACE FUNCTION cithela_private.patient_booking_create(p_tenant_id uuid, p_request_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_verified timestamptz;
  v_status text;v_timezone text;
  v_person_id uuid;v_service_id uuid;v_resource_id uuid;
  v_service public.cithela_services%rowtype;
  v_resource public.cithela_resources%rowtype;
  v_existing public.cithela_channel_requests%rowtype;
  v_appointment public.cithela_appointments%rowtype;
  v_start timestamptz;v_end timestamptz;v_local timestamp;
  v_slot text;v_response jsonb;v_result jsonb;
  v_reason text;
  v_now timestamptz:=statement_timestamp();
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select coalesce(u.email_confirmed_at,u.phone_confirmed_at) into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','identity_not_verified'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  begin
    v_person_id:=(p_payload->>'person_id')::uuid;
    v_service_id:=(p_payload->>'service_id')::uuid;
    v_resource_id:=(p_payload->>'resource_id')::uuid;
    if coalesce(p_payload->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      then return jsonb_build_object('ok',false,'code','invalid_date');
    end if;
    v_start:=(p_payload->>'starts_at')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  if v_person_id is null or v_service_id is null or v_resource_id is null
    or v_start is null or not isfinite(v_start) then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  v_reason:=btrim(coalesce(p_payload->>'reason',''));
  if length(v_reason)>500 then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;

  -- Same lock as the professional reservation and availability-block commands.
  select t.status,t.timezone into v_status,v_timezone
    from public.cithela_tenants t where t.id=p_tenant_id for update;
  if v_status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  if not exists(
    select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.person_id=v_person_id and l.user_id=v_actor
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select * into v_existing from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if v_existing.actor_user_id is distinct from v_actor
      or v_existing.command<>'patient.booking.create'
      or v_existing.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return v_existing.response || jsonb_build_object('replayed',true);
  end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;
  if v_start<v_now+interval '2 hours'
    or (v_start at time zone v_timezone)::date>
      (v_now at time zone v_timezone)::date+365 then
    return jsonb_build_object('ok',false,'code','too_late_or_too_far');
  end if;
  select * into v_service from public.cithela_services s
    where s.tenant_id=p_tenant_id and s.id=v_service_id and s.active;
  if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  select * into v_resource from public.cithela_resources r
    where r.tenant_id=p_tenant_id and r.id=v_resource_id and r.active;
  if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
  v_local:=v_start at time zone v_timezone;
  if date_part('second',v_local)<>0
    or v_start is distinct from (v_local at time zone v_timezone) then
    return jsonb_build_object('ok',false,'code','invalid_slot');
  end if;
  v_slot:=to_char(v_local,'HH24:MI');
  v_response:=cithela_private.channel_availability_core(
    p_tenant_id,v_service_id,v_resource_id,v_local::date);
  if not coalesce((v_response->>'ok')::boolean,false) then return v_response; end if;
  if not (coalesce(v_response->'slots','[]'::jsonb) ? v_slot) then
    return jsonb_build_object('ok',false,'code','slot_unavailable');
  end if;
  v_end:=v_start+v_service.duration_min*interval '1 minute';
  begin
    insert into public.cithela_appointments(
      tenant_id,person_id,service_id,resource_id,starts_at,ends_at,
      service_name,duration_min,resource_name,reason
    ) values(
      p_tenant_id,v_person_id,v_service.id,v_resource.id,v_start,v_end,
      v_service.name,v_service.duration_min,v_resource.name,v_reason
    ) returning * into v_appointment;
  exception when exclusion_violation then
    return jsonb_build_object('ok',false,'code','slot_unavailable');
  end;
  v_result:=jsonb_build_object('ok',true,'code','patient_booking_created',
    'appointment',to_jsonb(v_appointment),'replayed',false);
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,'patient_booking_created','appointment',v_appointment.id,
    jsonb_build_object('request_id',p_request_id,'row_version',v_appointment.row_version,
      'patient_initiated',true));
  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(p_tenant_id,p_request_id,'patient.booking.create',v_result,v_actor,p_payload);
  return v_result;
end
$function$
;

-- Patched source function: patient_appointment_command
CREATE OR REPLACE FUNCTION cithela_private.patient_appointment_command(p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_verified timestamptz;
  v_tenant_status text;
  v_appt public.cithela_appointments%rowtype;
  v_existing public.cithela_channel_requests%rowtype;
  v_id uuid; v_version bigint;
  v_start timestamptz; v_end timestamptz;
  v_code text; v_result jsonb;
  v_now timestamptz := statement_timestamp();
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select coalesce(u.email_confirmed_at,u.phone_confirmed_at) into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','identity_not_verified'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command not in ('patient.confirm','patient.cancel','patient.reschedule')
    or p_command is null then
    return jsonb_build_object('ok',false,'code','unsupported_command');
  end if;
  begin
    v_id:=(p_payload->>'id')::uuid;
    v_version:=(p_payload->>'expected_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  if v_id is null or v_version is null or v_version<1 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;

  -- Take the same tenant lock as the staff reservation/configuration commands.
  select t.status into v_tenant_status from public.cithela_tenants t
    where t.id=p_tenant_id for update;
  if v_tenant_status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  select a.* into v_appt from public.cithela_appointments a
    join public.cithela_patient_links l
      on l.tenant_id=a.tenant_id and l.person_id=a.person_id
      and l.user_id=v_actor
    where a.tenant_id=p_tenant_id and a.id=v_id for update of a;
  if not found then return jsonb_build_object('ok',false,'code','appointment_not_found'); end if;

  select * into v_existing from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if v_existing.actor_user_id is distinct from v_actor
      or v_existing.command<>p_command
      or v_existing.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return v_existing.response || jsonb_build_object('replayed',true);
  end if;
  if p_command='patient.reschedule' and not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;
  if v_appt.row_version<>v_version then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  if v_appt.status not in ('pending','confirmed') then
    return jsonb_build_object('ok',false,'code','invalid_state');
  end if;
  if p_command='patient.confirm' then
    if v_appt.starts_at<=v_now then
      return jsonb_build_object('ok',false,'code','appointment_started');
    end if;
    if v_appt.status='confirmed' then
      return jsonb_build_object('ok',false,'code','already_confirmed');
    end if;
    update public.cithela_appointments a set
      status='confirmed',row_version=a.row_version+1,updated_at=clock_timestamp()
      where a.tenant_id=p_tenant_id and a.id=v_id returning * into v_appt;
    v_code:='patient_appointment_confirmed';
  else
    if v_appt.starts_at<v_now+interval '2 hours' then
      return jsonb_build_object('ok',false,'code','too_late');
    end if;
    if p_command='patient.cancel' then
      update public.cithela_appointments a set
        status='cancelled',row_version=a.row_version+1,updated_at=clock_timestamp()
        where a.tenant_id=p_tenant_id and a.id=v_id returning * into v_appt;
      v_code:='patient_appointment_cancelled';
    else
      if coalesce(p_payload->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end if;
      begin
        v_start:=(p_payload->>'starts_at')::timestamptz;
      exception when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow or numeric_value_out_of_range then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end;
      if not isfinite(v_start) or v_start<v_now+interval '2 hours' then
        return jsonb_build_object('ok',false,'code','too_late');
      end if;
      if v_start=v_appt.starts_at then
        return jsonb_build_object('ok',false,'code','same_slot');
      end if;
      v_end:=v_start+v_appt.duration_min*interval '1 minute';
      if not exists (
        select 1 from public.cithela_resources r
        where r.tenant_id=p_tenant_id and r.id=v_appt.resource_id and r.active
      ) then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
      if not exists (
        select 1 from public.cithela_services s
        where s.tenant_id=p_tenant_id and s.id=v_appt.service_id and s.active
      ) then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
      if exists (
        select 1 from public.cithela_availability_blocks b
        where b.tenant_id=p_tenant_id
          and (b.resource_id is null or b.resource_id=v_appt.resource_id)
          and b.starts_at<v_end and b.ends_at>v_start
      ) then return jsonb_build_object('ok',false,'code','slot_unavailable'); end if;
      if not cithela_private.working_hours_match(
        p_tenant_id,v_appt.resource_id,v_start,v_end
      ) then return jsonb_build_object('ok',false,'code','outside_working_hours'); end if;
      begin
        update public.cithela_appointments a set
          starts_at=v_start,ends_at=v_end,status='pending',
          row_version=a.row_version+1,updated_at=clock_timestamp()
          where a.tenant_id=p_tenant_id and a.id=v_id returning * into v_appt;
      exception when exclusion_violation then
        return jsonb_build_object('ok',false,'code','slot_unavailable');
      end;
      v_code:='patient_appointment_rescheduled';
    end if;
  end if;
  v_result:=jsonb_build_object('ok',true,'code',v_code,
    'appointment',to_jsonb(v_appt),'replayed',false);
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,v_code,'appointment',v_id,
    jsonb_build_object('request_id',p_request_id,'row_version',v_appt.row_version,
      'patient_initiated',true));
  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(p_tenant_id,p_request_id,p_command,v_result,v_actor,p_payload);
  return v_result;
end
$function$
;

-- Patched source function: patient_reschedule_slots
CREATE OR REPLACE FUNCTION cithela_private.patient_reschedule_slots(p_tenant_id uuid, p_appointment_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_verified timestamptz;
  v_status text;v_tz text;
  v_appt public.cithela_appointments%rowtype;
  v_has_specific boolean;v_day integer;
  v_wh record;v_local timestamp;v_start timestamptz;v_end timestamptz;
  v_slots jsonb:='[]'::jsonb;v_slot text;
  v_now timestamptz:=statement_timestamp();
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select coalesce(u.email_confirmed_at,u.phone_confirmed_at) into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','identity_not_verified'); end if;
  select t.status,t.timezone into v_status,v_tz
    from public.cithela_tenants t where t.id=p_tenant_id;
  if v_status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  select a.* into v_appt from public.cithela_appointments a
    join public.cithela_patient_links l
      on l.tenant_id=a.tenant_id and l.person_id=a.person_id
      and l.user_id=v_actor
    where a.tenant_id=p_tenant_id and a.id=p_appointment_id;
  if not found then return jsonb_build_object('ok',false,'code','appointment_not_found'); end if;
  if not coalesce((cithela_private.commercial_entitlement_snapshot(p_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;
  if v_appt.status not in ('pending','confirmed') then
    return jsonb_build_object('ok',false,'code','invalid_state');
  end if;
  if v_appt.starts_at<v_now+interval '2 hours' then
    return jsonb_build_object('ok',false,'code','too_late');
  end if;
  if p_date is null or p_date<(v_now at time zone v_tz)::date
    or p_date>(v_now at time zone v_tz)::date+365 then
    return jsonb_build_object('ok',false,'code','invalid_date');
  end if;
  if not exists(select 1 from public.cithela_services s
    where s.tenant_id=p_tenant_id and s.id=v_appt.service_id and s.active)
    or not exists(select 1 from public.cithela_resources r
    where r.tenant_id=p_tenant_id and r.id=v_appt.resource_id and r.active) then
    return jsonb_build_object('ok',false,'code','inactive_service_or_resource');
  end if;
  v_day:=extract(isodow from p_date)::integer;
  select exists(select 1 from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.resource_id=v_appt.resource_id
      and w.weekday=v_day) into v_has_specific;
  for v_wh in select w.starts_local,w.ends_local from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.weekday=v_day
      and ((v_has_specific and w.resource_id=v_appt.resource_id)
        or (not v_has_specific and w.resource_id is null))
    order by w.starts_local
  loop
    v_local:=p_date+v_wh.starts_local;
    while v_local+v_appt.duration_min*interval '1 minute'<=p_date+v_wh.ends_local loop
      v_start:=v_local at time zone v_tz;
      v_end:=v_start+v_appt.duration_min*interval '1 minute';
      if v_start>=v_now+interval '2 hours'
        and v_start<>v_appt.starts_at
        and not exists(select 1 from public.cithela_availability_blocks b
          where b.tenant_id=p_tenant_id
            and (b.resource_id is null or b.resource_id=v_appt.resource_id)
            and b.starts_at<v_end and b.ends_at>v_start)
        and not exists(select 1 from public.cithela_appointments a
          where a.tenant_id=p_tenant_id and a.resource_id=v_appt.resource_id
            and a.id<>v_appt.id and a.status in ('pending','confirmed')
            and a.starts_at<v_end and a.ends_at>v_start) then
        v_slot:=to_char(v_local,'HH24:MI');
        if not (v_slots ? v_slot) then
          v_slots:=v_slots||jsonb_build_array(v_slot);
        end if;
      end if;
      v_local:=v_local+interval '15 minutes';
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'code','patient_availability',
    'date',p_date,'timezone',v_tz,'slots',v_slots);
end
$function$
;

-- Patched source function: channel_command
CREATE OR REPLACE FUNCTION cithela_private.channel_command(p_channel text, p_external_account_id text, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_route jsonb;
  v_tenant_id uuid;
  v_connection_id uuid;
  v_tz text;
  v_stored_request_id text;
  v_old_request public.cithela_channel_requests%rowtype;
  v_phone text;
  v_clean_name text;
  v_create_missing boolean;
  v_person public.cithela_people%rowtype;
  v_person_created boolean:=false;
  v_svc public.cithela_services%rowtype;
  v_res public.cithela_resources%rowtype;
  v_appt public.cithela_appointments%rowtype;
  v_appointment_id uuid;
  v_expected bigint;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_target_date date;
  v_code text;
  v_result jsonb;
  v_changed boolean:=true;
  v_items jsonb;
begin
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command is null or p_command not in (
    'catalog.services','catalog.resources','person.resolve','appointments.list',
    'availability.query','appointment.create','appointment.confirm',
    'appointment.cancel','appointment.reschedule'
  ) then
    return jsonb_build_object('ok',false,'code','unsupported_command');
  end if;

  v_route:=cithela_private.channel_route(p_channel,p_external_account_id);
  if coalesce((v_route->>'ok')::boolean,false) is not true then return v_route; end if;
  v_tenant_id:=(v_route->>'tenant_id')::uuid;
  v_connection_id:=(v_route->>'connection_id')::uuid;
  v_tz:=v_route->>'timezone';
  v_stored_request_id:='ext:'||lower(btrim(p_channel))||':'||
    btrim(p_external_account_id)||':'||btrim(p_request_id);

  if p_command='catalog.services' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'duration_min',s.duration_min
    ) order by s.name),'[]'::jsonb) into v_items
    from public.cithela_services s
    where s.tenant_id=v_tenant_id and s.active;
    return jsonb_build_object('ok',true,'code','services','items',v_items,'timezone',v_tz);
  end if;

  if p_command='catalog.resources' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'name',r.name
    ) order by r.name),'[]'::jsonb) into v_items
    from public.cithela_resources r
    where r.tenant_id=v_tenant_id and r.active;
    return jsonb_build_object('ok',true,'code','resources','items',v_items,'timezone',v_tz);
  end if;

  if p_command='availability.query' then
    begin
      v_target_date:=(p_payload->>'date')::date;
      return cithela_private.channel_availability_core(
        v_tenant_id,(p_payload->>'service_id')::uuid,
        (p_payload->>'resource_id')::uuid,v_target_date
      );
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end;
  end if;

  v_phone:=btrim(coalesce(p_payload->>'sender_phone',''));
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return jsonb_build_object('ok',false,'code','invalid_phone');
  end if;
  v_clean_name:=btrim(coalesce(p_payload->>'sender_name',''));
  begin
    v_create_missing:=coalesce((p_payload->>'create_if_missing')::boolean,false);
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;

  if p_command='person.resolve' and not v_create_missing then
    select * into v_person from public.cithela_people p
      where p.tenant_id=v_tenant_id and p.phone_e164=v_phone;
    if not found then return jsonb_build_object('ok',false,'code','person_not_found'); end if;
    return jsonb_build_object(
      'ok',true,'code','person_found',
      'person',jsonb_build_object(
        'id',v_person.id,'display_name',v_person.display_name,'phone_e164',v_person.phone_e164
      )
    );
  end if;

  if p_command='appointments.list' then
    select * into v_person from public.cithela_people p
      where p.tenant_id=v_tenant_id and p.phone_e164=v_phone;
    if not found then return jsonb_build_object('ok',false,'code','person_not_found'); end if;
    select coalesce(jsonb_agg(x.item order by x.starts_at),'[]'::jsonb) into v_items
    from (
      select a.starts_at,jsonb_build_object(
        'id',a.id,'row_version',a.row_version,'status',a.status,
        'starts_at',a.starts_at,'ends_at',a.ends_at,
        'service_name',a.service_name,'resource_name',a.resource_name,'reason',a.reason
      ) item
      from public.cithela_appointments a
      where a.tenant_id=v_tenant_id and a.person_id=v_person.id
        and a.status in ('pending','confirmed') and a.ends_at>=statement_timestamp()
      order by a.starts_at
      limit 10
    ) x;
    return jsonb_build_object(
      'ok',true,'code','appointments','items',v_items,'timezone',v_tz
    );
  end if;

  perform 1 from public.cithela_tenants t
    where t.id=v_tenant_id and t.status='active' for update;
  if not found then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;

  select * into v_old_request from public.cithela_channel_requests q
    where q.tenant_id=v_tenant_id and q.request_id=v_stored_request_id;
  if found then
    if v_old_request.actor_user_id is not null
      or v_old_request.command<>('external.'||p_command)
      or v_old_request.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return v_old_request.response||jsonb_build_object('replayed',true);
  end if;
  if p_command in ('appointment.create','appointment.reschedule')
     and not coalesce((cithela_private.commercial_entitlement_snapshot(v_tenant_id)->>'can_book')::boolean,false) then
    return jsonb_build_object('ok',false,'code','subscription_required');
  end if;

  select * into v_person from public.cithela_people p
    where p.tenant_id=v_tenant_id and p.phone_e164=v_phone
    for update;

  if not found then
    if p_command not in ('person.resolve','appointment.create') or not v_create_missing then
      return jsonb_build_object('ok',false,'code','person_not_found');
    end if;
    if length(v_clean_name) not between 1 and 160 then
      return jsonb_build_object('ok',false,'code','name_required');
    end if;
    insert into public.cithela_people(tenant_id,display_name,phone_e164)
      values(v_tenant_id,v_clean_name,v_phone)
      returning * into v_person;
    v_person_created:=true;
    insert into public.cithela_operational_events(
      tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
    ) values(
      v_tenant_id,null,'person_created_from_channel','person',v_person.id,
      jsonb_build_object('connection_id',v_connection_id,'request_id',p_request_id)
    );
  end if;

  if p_command='person.resolve' then
    v_code:=case when v_person_created then 'person_created' else 'person_found' end;
    v_result:=jsonb_build_object(
      'ok',true,'code',v_code,
      'person',jsonb_build_object(
        'id',v_person.id,'display_name',v_person.display_name,'phone_e164',v_person.phone_e164
      ),
      'replayed',false
    );
    insert into public.cithela_channel_requests(
      tenant_id,request_id,command,response,actor_user_id,request_payload
    ) values(
      v_tenant_id,v_stored_request_id,'external.'||p_command,v_result,null,p_payload
    );
    return v_result;
  end if;

  begin
    if p_command='appointment.create' then
      select * into v_svc from public.cithela_services s
        where s.tenant_id=v_tenant_id and s.id=(p_payload->>'service_id')::uuid and s.active;
      if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
      select * into v_res from public.cithela_resources r
        where r.tenant_id=v_tenant_id and r.id=(p_payload->>'resource_id')::uuid and r.active;
      if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
    else
      v_appointment_id:=(p_payload->>'id')::uuid;
      v_expected:=(p_payload->>'expected_version')::bigint;
      if v_expected is null or v_expected<1 then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end if;
      select * into v_appt from public.cithela_appointments a
        where a.tenant_id=v_tenant_id and a.id=v_appointment_id and a.person_id=v_person.id
        for update;
      if not found then return jsonb_build_object('ok',false,'code','appointment_not_found'); end if;
      if v_appt.row_version<>v_expected then
        return jsonb_build_object('ok',false,'code','stale_write');
      end if;
      if p_command='appointment.confirm' and v_appt.status='confirmed' then
        v_code:='appointment_already_confirmed'; v_changed:=false;
      elsif p_command='appointment.cancel' and v_appt.status='cancelled' then
        v_code:='appointment_already_cancelled'; v_changed:=false;
      elsif v_appt.status not in ('pending','confirmed') then
        return jsonb_build_object('ok',false,'code','invalid_state');
      end if;
    end if;

    if p_command in ('appointment.create','appointment.reschedule') then
      if coalesce(p_payload->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end if;
      v_start_time:=(p_payload->>'starts_at')::timestamptz;
      if not isfinite(v_start_time) or v_start_time<statement_timestamp() then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end if;
      if p_command='appointment.reschedule' then
        select * into v_res from public.cithela_resources r
          where r.tenant_id=v_tenant_id and r.id=v_appt.resource_id and r.active;
        if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
        v_end_time:=v_start_time+v_appt.duration_min*interval '1 minute';
      else
        v_end_time:=v_start_time+v_svc.duration_min*interval '1 minute';
      end if;

      if exists(
        select 1 from public.cithela_availability_blocks b
        where b.tenant_id=v_tenant_id
          and (b.resource_id is null or b.resource_id=v_res.id)
          and b.starts_at<v_end_time and b.ends_at>v_start_time
      ) then
        return jsonb_build_object('ok',false,'code','slot_unavailable');
      end if;

      if not cithela_private.working_hours_match(
        v_tenant_id,v_res.id,v_start_time,v_end_time
      ) then
        return jsonb_build_object('ok',false,'code','outside_working_hours');
      end if;
    end if;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;

  begin
    if p_command='appointment.create' then
      insert into public.cithela_appointments(
        tenant_id,person_id,service_id,resource_id,starts_at,ends_at,
        service_name,duration_min,resource_name,reason
      ) values(
        v_tenant_id,v_person.id,v_svc.id,v_res.id,v_start_time,v_end_time,
        v_svc.name,v_svc.duration_min,v_res.name,coalesce(p_payload->>'reason','')
      ) returning * into v_appt;
      v_code:='appointment_created';
    elsif v_changed then
      update public.cithela_appointments a set
        status=case p_command
          when 'appointment.confirm' then 'confirmed'
          when 'appointment.cancel' then 'cancelled'
          else 'pending' end,
        starts_at=case when p_command='appointment.reschedule' then v_start_time else a.starts_at end,
        ends_at=case when p_command='appointment.reschedule' then v_end_time else a.ends_at end,
        row_version=a.row_version+1,
        updated_at=clock_timestamp()
      where a.id=v_appt.id and a.tenant_id=v_tenant_id
      returning * into v_appt;
      v_code:=case p_command
        when 'appointment.confirm' then 'appointment_confirmed'
        when 'appointment.cancel' then 'appointment_cancelled'
        else 'appointment_rescheduled' end;
    end if;
  exception when exclusion_violation then
    return jsonb_build_object('ok',false,'code','slot_unavailable');
  end;

  v_result:=jsonb_build_object(
    'ok',true,'code',v_code,
    'appointment',jsonb_build_object(
      'id',v_appt.id,'row_version',v_appt.row_version,'status',v_appt.status,
      'starts_at',v_appt.starts_at,'ends_at',v_appt.ends_at,
      'service_name',v_appt.service_name,'resource_name',v_appt.resource_name,
      'reason',v_appt.reason
    ),
    'replayed',false
  );

  if v_changed then
    insert into public.cithela_operational_events(
      tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
    ) values(
      v_tenant_id,null,v_code||'_from_channel','appointment',v_appt.id,
      jsonb_build_object(
        'connection_id',v_connection_id,'request_id',p_request_id,'row_version',v_appt.row_version
      )
    );
  end if;

  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(
    v_tenant_id,v_stored_request_id,'external.'||p_command,v_result,null,p_payload
  );
  return v_result;
end $function$
;

-- End of migration.
