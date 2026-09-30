-- CITHELA working hours and authoritative availability.
-- Applied to project CITHELA as migration 20260930111541.
create table public.cithela_working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
  resource_id uuid,
  weekday smallint not null check (weekday between 1 and 7),
  starts_local time not null,
  ends_local time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  foreign key (tenant_id,resource_id) references public.cithela_resources(tenant_id,id),
  constraint cithela_working_hours_positive check (ends_local > starts_local)
);
create index cithela_working_hours_lookup_idx on public.cithela_working_hours(tenant_id,weekday,resource_id,starts_local);
alter table public.cithela_working_hours enable row level security;
create policy cithela_working_hours_member_read on public.cithela_working_hours
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id=cithela_working_hours.tenant_id and m.user_id=(select auth.uid()))
  );
revoke all on public.cithela_working_hours from anon,authenticated;
grant select on public.cithela_working_hours to authenticated;

create function cithela_private.working_hours_match(
  p_tenant_id uuid,p_resource_id uuid,p_start timestamptz,p_end timestamptz
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  tz text; local_start timestamp; local_end timestamp; dow integer; has_specific boolean;
begin
  select t.timezone into tz from public.cithela_tenants t where t.id=p_tenant_id;
  if tz is null or p_start is null or p_end is null or p_end<=p_start then return false; end if;
  local_start:=p_start at time zone tz; local_end:=p_end at time zone tz;
  if local_start::date<>local_end::date then return false; end if;
  dow:=extract(isodow from local_start)::integer;
  select exists(select 1 from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.resource_id=p_resource_id and w.weekday=dow) into has_specific;
  if has_specific then
    return exists(select 1 from public.cithela_working_hours w
      where w.tenant_id=p_tenant_id and w.resource_id=p_resource_id and w.weekday=dow
        and local_start::time>=w.starts_local and local_end::time<=w.ends_local);
  end if;
  return exists(select 1 from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.resource_id is null and w.weekday=dow
      and local_start::time>=w.starts_local and local_end::time<=w.ends_local);
end $$;
revoke all on function cithela_private.working_hours_match(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;

create function cithela_private.configuration_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); member_role text; tenant_status text;
  old_request public.cithela_channel_requests%rowtype; target_resource uuid; day_num integer;
  periods jsonb; clean_periods jsonb:='[]'::jsonb; item jsonb; start_t time; end_t time;
  overlap_found boolean; result jsonb;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
  if p_command<>'working_hours.set_day' then return jsonb_build_object('ok',false,'code','unsupported_command'); end if;
  select m.role into member_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=actor for share;
  if member_role is null or member_role not in ('owner','admin') then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select t.status into tenant_status from public.cithela_tenants t where t.id=p_tenant_id for update;
  if tenant_status is distinct from 'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  select * into old_request from public.cithela_channel_requests q where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if old_request.actor_user_id is distinct from actor or old_request.command<>p_command
      or old_request.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict'); end if;
    return old_request.response||jsonb_build_object('replayed',true);
  end if;
  begin
    day_num:=(p_payload->>'weekday')::integer;
    if day_num not between 1 and 7 then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    if p_payload ? 'resource_id' and nullif(btrim(p_payload->>'resource_id'),'') is not null then
      target_resource:=(p_payload->>'resource_id')::uuid;
      if not exists(select 1 from public.cithela_resources r where r.tenant_id=p_tenant_id and r.id=target_resource and r.active) then
        return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
    end if;
    periods:=coalesce(p_payload->'periods','[]'::jsonb);
    if jsonb_typeof(periods)<>'array' or jsonb_array_length(periods)>8 then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    for item in select value from jsonb_array_elements(periods) loop
      if jsonb_typeof(item)<>'object' or nullif(item->>'start','') is null or nullif(item->>'end','') is null then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      start_t:=(item->>'start')::time; end_t:=(item->>'end')::time;
      if end_t<=start_t then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      clean_periods:=clean_periods||jsonb_build_array(jsonb_build_object('start',to_char(start_t,'HH24:MI'),'end',to_char(end_t,'HH24:MI')));
    end loop;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  select exists(
    with p as (select ord,(value->>'start')::time s,(value->>'end')::time e
      from jsonb_array_elements(clean_periods) with ordinality x(value,ord))
    select 1 from p a join p b on a.ord<b.ord where a.s<b.e and a.e>b.s
  ) into overlap_found;
  if overlap_found then return jsonb_build_object('ok',false,'code','overlapping_hours'); end if;
  delete from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.weekday=day_num and w.resource_id is not distinct from target_resource;
  insert into public.cithela_working_hours(tenant_id,resource_id,weekday,starts_local,ends_local)
    select p_tenant_id,target_resource,day_num,(x->>'start')::time,(x->>'end')::time from jsonb_array_elements(clean_periods) x;
  result:=jsonb_build_object('ok',true,'code','working_hours_updated','weekday',day_num,'resource_id',target_resource,'periods',clean_periods,'replayed',false);
  insert into public.cithela_operational_events(tenant_id,actor_user_id,event_type,entity_type,entity_id,payload)
    values(p_tenant_id,actor,'working_hours_updated','working_hours',target_resource,jsonb_build_object('weekday',day_num,'periods',clean_periods,'request_id',p_request_id));
  insert into public.cithela_channel_requests(tenant_id,request_id,command,response,actor_user_id,request_payload)
    values(p_tenant_id,p_request_id,p_command,result,actor,p_payload);
  return result;
end $$;
revoke all on function cithela_private.configuration_command(uuid,text,text,jsonb) from public,anon;
grant execute on function cithela_private.configuration_command(uuid,text,text,jsonb) to authenticated;

create function public.cithela_configuration_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select cithela_private.configuration_command(p_tenant_id,p_request_id,p_command,p_payload);
$$;
revoke all on function public.cithela_configuration_command(uuid,text,text,jsonb) from public,anon;
grant execute on function public.cithela_configuration_command(uuid,text,text,jsonb) to authenticated;

create function public.cithela_availability_query(
  p_tenant_id uuid,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid(); member_role text; tenant_status text; tz text;
  svc public.cithela_services%rowtype; res public.cithela_resources%rowtype; wh record;
  has_specific boolean; slot_local timestamp; slot_abs timestamptz; slot_end timestamptz;
  slot_text text; slots jsonb:='[]'::jsonb; dow integer;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select m.role,t.status,t.timezone into member_role,tenant_status,tz
    from public.cithela_tenant_memberships m join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=actor;
  if member_role is null then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if tenant_status is distinct from 'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if p_date is null or p_date<(statement_timestamp() at time zone tz)::date then return jsonb_build_object('ok',false,'code','invalid_date'); end if;
  select * into svc from public.cithela_services s where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active;
  if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  select * into res from public.cithela_resources r where r.tenant_id=p_tenant_id and r.id=p_resource_id and r.active;
  if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
  dow:=extract(isodow from p_date)::integer;
  select exists(select 1 from public.cithela_working_hours w where w.tenant_id=p_tenant_id and w.resource_id=p_resource_id and w.weekday=dow) into has_specific;
  for wh in select w.starts_local,w.ends_local from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.weekday=dow
      and ((has_specific and w.resource_id=p_resource_id) or (not has_specific and w.resource_id is null))
    order by w.starts_local
  loop
    slot_local:=p_date+wh.starts_local;
    while slot_local+svc.duration_min*interval '1 minute'<=p_date+wh.ends_local loop
      slot_abs:=slot_local at time zone tz; slot_end:=slot_abs+svc.duration_min*interval '1 minute';
      if slot_abs>statement_timestamp()
        and not exists(select 1 from public.cithela_availability_blocks b where b.tenant_id=p_tenant_id
          and (b.resource_id is null or b.resource_id=p_resource_id) and b.starts_at<slot_end and b.ends_at>slot_abs)
        and not exists(select 1 from public.cithela_appointments a where a.tenant_id=p_tenant_id and a.resource_id=p_resource_id
          and a.status in ('pending','confirmed') and a.starts_at<slot_end and a.ends_at>slot_abs) then
        slot_text:=to_char(slot_local,'HH24:MI');
        if not (slots ? slot_text) then slots:=slots||jsonb_build_array(slot_text); end if;
      end if;
      slot_local:=slot_local+interval '30 minutes';
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'code','availability','date',p_date,'timezone',tz,
    'service',jsonb_build_object('id',svc.id,'name',svc.name,'duration_min',svc.duration_min),
    'resource',jsonb_build_object('id',res.id,'name',res.name),'slots',slots);
end $$;
revoke all on function public.cithela_availability_query(uuid,uuid,uuid,date) from public,anon;
grant execute on function public.cithela_availability_query(uuid,uuid,uuid,date) to authenticated;

create or replace function cithela_private.reservation_command(
  p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if p_command is null or p_command not in ('appointment.create','appointment.confirm','appointment.cancel','appointment.reschedule') then
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
      elsif appt.status not in ('pending','confirmed') then
        return jsonb_build_object('ok',false,'code','invalid_state');
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
        status=case p_command when 'appointment.confirm' then 'confirmed' when 'appointment.cancel' then 'cancelled' else 'pending' end,
        starts_at=case when p_command='appointment.reschedule' then start_time else a.starts_at end,
        ends_at=case when p_command='appointment.reschedule' then end_time else a.ends_at end,
        row_version=a.row_version+1, updated_at=clock_timestamp()
        where a.id=appt.id and a.tenant_id=p_tenant_id returning * into appt;
      code := case p_command when 'appointment.confirm' then 'appointment_confirmed' when 'appointment.cancel' then 'appointment_cancelled' else 'appointment_rescheduled' end;
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
end $$;
