-- CITHELA: patient self-service, scoped to the verified user's linked person.
-- Staff-only reservation/availability APIs remain unchanged.
-- Patient cancellation and rescheduling close 2 hours before original start.
-- New appointment times also require >=2 hours notice.
create or replace function cithela_private.patient_appointment_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
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
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
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
$fn$;

create or replace function cithela_private.patient_reschedule_slots(
  p_tenant_id uuid,p_appointment_id uuid,p_date date
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
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
      v_local:=v_local+interval '30 minutes';
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'code','patient_availability',
    'date',p_date,'timezone',v_tz,'slots',v_slots);
end
$fn$;

-- Public PostgREST entrypoints cannot bypass RLS. Privileged checks
-- remain private and are performed against auth.uid() in every RPC.
create or replace function public.cithela_patient_appointment_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_appointment_command(
    p_tenant_id,p_request_id,p_command,p_payload);
$fn$;
create or replace function public.cithela_patient_reschedule_slots(
  p_tenant_id uuid,p_appointment_id uuid,p_date date
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_reschedule_slots(
    p_tenant_id,p_appointment_id,p_date);
$fn$;

revoke all on function cithela_private.patient_appointment_command(uuid,text,text,jsonb) from public,anon;
revoke all on function cithela_private.patient_reschedule_slots(uuid,uuid,date) from public,anon;
revoke all on function public.cithela_patient_appointment_command(uuid,text,text,jsonb) from public,anon;
revoke all on function public.cithela_patient_reschedule_slots(uuid,uuid,date) from public,anon;
grant execute on function cithela_private.patient_appointment_command(uuid,text,text,jsonb) to authenticated;
grant execute on function cithela_private.patient_reschedule_slots(uuid,uuid,date) to authenticated;
grant execute on function public.cithela_patient_appointment_command(uuid,text,text,jsonb) to authenticated;
grant execute on function public.cithela_patient_reschedule_slots(uuid,uuid,date) to authenticated;
