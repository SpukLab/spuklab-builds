-- CITHELA: new appointments initiated by verified, invited patient accounts.
-- No anonymous bookings, no changes to the professional booking contract.
-- Tenant-level write lock is shared with staff booking and availability blocks.

create or replace function cithela_private.patient_booking_catalog(
  p_tenant_id uuid
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_verified timestamptz;
  v_tenant_name text;
  v_services jsonb;
  v_resources jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
  select t.display_name into v_tenant_name
    from public.cithela_tenants t where t.id=p_tenant_id and t.status='active';
  if v_tenant_name is null then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if not exists(
    select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.user_id=v_actor
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'duration_min',s.duration_min
  ) order by s.name),'[]'::jsonb) into v_services
  from public.cithela_services s where s.tenant_id=p_tenant_id and s.active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'name',r.name
  ) order by r.name),'[]'::jsonb) into v_resources
  from public.cithela_resources r where r.tenant_id=p_tenant_id and r.active;
  return jsonb_build_object('ok',true,'code','patient_catalog',
    'tenant_id',p_tenant_id,'tenant_name',v_tenant_name,
    'services',v_services,'resources',v_resources);
end
$fn$;

create or replace function cithela_private.patient_booking_slots(
  p_tenant_id uuid,p_person_id uuid,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_verified timestamptz;
  v_timezone text;
  v_response jsonb;
  v_slots jsonb;
  v_now timestamptz:=statement_timestamp();
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
  if not exists(
    select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.person_id=p_person_id and l.user_id=v_actor
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select t.timezone into v_timezone from public.cithela_tenants t
    where t.id=p_tenant_id and t.status='active';
  if v_timezone is null then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if p_date is null or p_date<(v_now at time zone v_timezone)::date
    or p_date>(v_now at time zone v_timezone)::date+365 then
    return jsonb_build_object('ok',false,'code','invalid_date');
  end if;
  v_response:=cithela_private.channel_availability_core(
    p_tenant_id,p_service_id,p_resource_id,p_date);
  if not coalesce((v_response->>'ok')::boolean,false) then return v_response; end if;
  select coalesce(jsonb_agg(x.slot order by x.slot),'[]'::jsonb)
    into v_slots
  from (
    select value as slot from jsonb_array_elements_text(v_response->'slots')
    where (p_date+value::time) at time zone v_timezone >= v_now+interval '2 hours'
  ) x;
  return v_response || jsonb_build_object('code','patient_booking_availability','slots',v_slots);
end
$fn$;

create or replace function cithela_private.patient_booking_create(
  p_tenant_id uuid,p_request_id text,p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
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
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
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
  if not coalesce(v_response->'slots','[]'::jsonb) ? v_slot then
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
$fn$;

create or replace function public.cithela_patient_booking_catalog(
  p_tenant_id uuid
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_booking_catalog(p_tenant_id);
$fn$;
create or replace function public.cithela_patient_booking_slots(
  p_tenant_id uuid,p_person_id uuid,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_booking_slots(
    p_tenant_id,p_person_id,p_service_id,p_resource_id,p_date);
$fn$;
create or replace function public.cithela_patient_booking_create(
  p_tenant_id uuid,p_request_id text,p_payload jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_booking_create(p_tenant_id,p_request_id,p_payload);
$fn$;

revoke all on function cithela_private.patient_booking_catalog(uuid) from public,anon;
revoke all on function cithela_private.patient_booking_slots(uuid,uuid,uuid,uuid,date) from public,anon;
revoke all on function cithela_private.patient_booking_create(uuid,text,jsonb) from public,anon;
revoke all on function public.cithela_patient_booking_catalog(uuid) from public,anon;
revoke all on function public.cithela_patient_booking_slots(uuid,uuid,uuid,uuid,date) from public,anon;
revoke all on function public.cithela_patient_booking_create(uuid,text,jsonb) from public,anon;
grant execute on function cithela_private.patient_booking_catalog(uuid) to authenticated;
grant execute on function cithela_private.patient_booking_slots(uuid,uuid,uuid,uuid,date) to authenticated;
grant execute on function cithela_private.patient_booking_create(uuid,text,jsonb) to authenticated;
grant execute on function public.cithela_patient_booking_catalog(uuid) to authenticated;
grant execute on function public.cithela_patient_booking_slots(uuid,uuid,uuid,uuid,date) to authenticated;
grant execute on function public.cithela_patient_booking_create(uuid,text,jsonb) to authenticated;
