-- CITHELA: secure multi-sector service catalog.
-- The live service is used for NEW bookings. Existing appointments keep
-- their own service_name/duration_min snapshots unchanged.
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
        or v_duration not between 30 and 720 or v_duration%30<>0 then
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

create or replace function public.cithela_service_catalog_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.service_catalog_command(p_tenant_id,p_request_id,p_command,p_payload);
$fn$;

revoke all on function cithela_private.service_catalog_command(uuid,text,text,jsonb) from public,anon;
revoke all on function public.cithela_service_catalog_command(uuid,text,text,jsonb) from public,anon;
grant execute on function cithela_private.service_catalog_command(uuid,text,text,jsonb) to authenticated;
grant execute on function public.cithela_service_catalog_command(uuid,text,text,jsonb) to authenticated;
