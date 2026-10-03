-- CITHELA service duration granularity: 15 minutes across all cloud booking paths.
-- Existing records are untouched; catalog durations remain capped at 720 minutes.
alter table public.cithela_services
  drop constraint cithela_services_duration_min_check;
alter table public.cithela_services
  add constraint cithela_services_duration_min_check
  check (duration_min>0 and duration_min<=720 and duration_min%15=0);

create or replace function cithela_private.service_catalog_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_role text;v_status text;
  v_prior public.cithela_channel_requests%rowtype;
  v_service public.cithela_services%rowtype;
  v_name text;v_duration integer;
  v_id uuid;v_expected timestamptz;
  v_result jsonb;v_code text;v_changed boolean:=true;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>4096 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if p_command is null or p_command not in
    ('service.create','service.update','service.deactivate','service.reactivate') then
    return jsonb_build_object('ok',false,'code','unsupported_command');
  end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor for share;
  if v_role is null or v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  -- This lock is shared with staff/patient bookings, reschedules and blocks.
  select t.status into v_status from public.cithela_tenants t
    where t.id=p_tenant_id for update;
  if v_status is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  select * into v_prior from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if v_prior.actor_user_id is distinct from v_actor
      or v_prior.command<>p_command
      or v_prior.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');
    end if;
    return v_prior.response || jsonb_build_object('replayed',true);
  end if;
  if (select count(*) from jsonb_object_keys(p_payload) as fields(field)
      where field not in ('id','expected_updated_at','name','duration_min'))>0 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  begin
    if p_command='service.create' then
      if p_payload ? 'id' or p_payload ? 'expected_updated_at' then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    else
      if jsonb_typeof(p_payload->'id') is distinct from 'string'
        or jsonb_typeof(p_payload->'expected_updated_at') is distinct from 'string' then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      v_id:=(p_payload->>'id')::uuid;
      v_expected:=(p_payload->>'expected_updated_at')::timestamptz;
      if v_id is null or v_expected is null or not isfinite(v_expected) then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    end if;
    if p_command in ('service.create','service.update') then
      if jsonb_typeof(p_payload->'name') is distinct from 'string'
        or jsonb_typeof(p_payload->'duration_min') is distinct from 'number' then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      v_name:=btrim(p_payload->>'name');
      v_duration:=(p_payload->>'duration_min')::integer;
      if length(v_name) not between 1 and 160
        or v_duration not between 15 and 720 or v_duration%15<>0 then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    elsif p_payload ? 'name' or p_payload ? 'duration_min' then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
  exception when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  if p_command='service.create' then
    if (select count(*) from public.cithela_services
      where tenant_id=p_tenant_id)>=40 then
      return jsonb_build_object('ok',false,'code','catalog_limit'); end if;
    if exists(select 1 from public.cithela_services
      where tenant_id=p_tenant_id and lower(btrim(name))=lower(v_name)) then
      return jsonb_build_object('ok',false,'code','service_name_exists'); end if;
    insert into public.cithela_services(tenant_id,name,duration_min)
      values(p_tenant_id,v_name,v_duration) returning * into v_service;
    v_code:='service_created';
  else
    select * into v_service from public.cithela_services s
      where s.tenant_id=p_tenant_id and s.id=v_id for update;
    if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
    if v_service.updated_at is distinct from v_expected then
      return jsonb_build_object('ok',false,'code','stale_write'); end if;
    if p_command='service.update' then
      if exists(select 1 from public.cithela_services s
        where s.tenant_id=p_tenant_id and s.id<>v_id
          and lower(btrim(s.name))=lower(v_name)) then
        return jsonb_build_object('ok',false,'code','service_name_exists'); end if;
      if v_name=v_service.name and v_duration=v_service.duration_min then
        v_code:='service_unchanged';v_changed:=false;
      else
        update public.cithela_services s set name=v_name,duration_min=v_duration,
          updated_at=greatest(clock_timestamp(),s.updated_at+interval '1 microsecond')
          where s.id=v_id and s.tenant_id=p_tenant_id returning * into v_service;
        v_code:='service_updated';
      end if;
    elsif p_command='service.deactivate' then
      if not v_service.active then
        v_code:='service_already_inactive';v_changed:=false;
      else
        if (select count(*) from public.cithela_services s
          where s.tenant_id=p_tenant_id and s.active)<=1 then
          return jsonb_build_object('ok',false,'code','last_active_service');end if;
        -- Existing reservations still refer to the current service for rescheduling.
        if exists(select 1 from public.cithela_appointments a
          where a.tenant_id=p_tenant_id and a.service_id=v_id
            and a.status in ('pending','confirmed')
            and a.ends_at>statement_timestamp()) then
          return jsonb_build_object('ok',false,'code','service_has_future_bookings');
        end if;
        update public.cithela_services s set active=false,
          updated_at=greatest(clock_timestamp(),s.updated_at+interval '1 microsecond')
          where s.id=v_id and s.tenant_id=p_tenant_id returning * into v_service;
        v_code:='service_deactivated';
      end if;
    else
      if v_service.active then
        v_code:='service_already_active';v_changed:=false;
      else
        update public.cithela_services s set active=true,
          updated_at=greatest(clock_timestamp(),s.updated_at+interval '1 microsecond')
          where s.id=v_id and s.tenant_id=p_tenant_id returning * into v_service;
        v_code:='service_reactivated';
      end if;
    end if;
  end if;
  v_result:=jsonb_build_object('ok',true,'code',v_code,'service',
    jsonb_build_object('id',v_service.id,'name',v_service.name,
      'duration_min',v_service.duration_min,'active',v_service.active,
      'updated_at',v_service.updated_at),'replayed',false);
  if v_changed then
    insert into public.cithela_operational_events(
      tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
    ) values(p_tenant_id,v_actor,v_code,'service',v_service.id,
      jsonb_build_object('request_id',p_request_id,
        'duration_min',v_service.duration_min,'active',v_service.active));
  end if;
  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(p_tenant_id,p_request_id,p_command,v_result,v_actor,p_payload);
  return v_result;
end $fn$;



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
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
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

