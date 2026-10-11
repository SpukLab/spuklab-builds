-- Tenant-authorized, audited, idempotent operator availability blocks.
-- Preserves existing working_hours.set_day contract and tenant row lock.
CREATE OR REPLACE FUNCTION cithela_private.configuration_command(p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); member_role text; tenant_status text;
  old_request public.cithela_channel_requests%rowtype; target_resource uuid; day_num integer;
  periods jsonb; clean_periods jsonb:='[]'::jsonb; item jsonb; start_t time; end_t time;
  overlap_found boolean; result jsonb;
  block_id uuid; start_abs timestamptz; end_abs timestamptz;
  block_reason text; block_row public.cithela_availability_blocks%rowtype;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then
    return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
  if p_command not in ('working_hours.set_day','availability_block.create','availability_block.delete') then
    return jsonb_build_object('ok',false,'code','unsupported_command'); end if;
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
  if p_command in ('availability_block.create','availability_block.delete') then
    if p_command='availability_block.create' then
      if coalesce(p_payload->>'starts_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(p_payload->>'ends_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        return jsonb_build_object('ok',false,'code','invalid_date');
      end if;
      begin
        start_abs:=(p_payload->>'starts_at')::timestamptz;
        end_abs:=(p_payload->>'ends_at')::timestamptz;
        if nullif(btrim(p_payload->>'resource_id'),'') is not null then
          target_resource:=(p_payload->>'resource_id')::uuid;
        end if;
      exception when invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow or numeric_value_out_of_range then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end;
      block_reason:=btrim(coalesce(p_payload->>'reason',''));
      if not isfinite(start_abs) or not isfinite(end_abs)
        or start_abs<=statement_timestamp() or end_abs<=start_abs
        or end_abs>start_abs+interval '7 days' or length(block_reason)>300 then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end if;
      if target_resource is not null and not exists(
        select 1 from public.cithela_resources r
        where r.tenant_id=p_tenant_id and r.id=target_resource and r.active
      ) then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
      if exists(
        select 1 from public.cithela_availability_blocks b
        where b.tenant_id=p_tenant_id
          and (target_resource is null or b.resource_id is null or b.resource_id=target_resource)
          and b.starts_at<end_abs and b.ends_at>start_abs
      ) then return jsonb_build_object('ok',false,'code','overlapping_block'); end if;
      insert into public.cithela_availability_blocks(tenant_id,resource_id,starts_at,ends_at,reason)
        values(p_tenant_id,target_resource,start_abs,end_abs,block_reason)
        returning * into block_row;
      result:=jsonb_build_object('ok',true,'code','availability_block_created',
        'block',to_jsonb(block_row),'replayed',false);
    else
      begin block_id:=(p_payload->>'id')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('ok',false,'code','invalid_payload');
      end;
      if block_id is null then return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
      delete from public.cithela_availability_blocks b
        where b.tenant_id=p_tenant_id and b.id=block_id returning * into block_row;
      if not found then return jsonb_build_object('ok',false,'code','block_not_found'); end if;
      result:=jsonb_build_object('ok',true,'code','availability_block_deleted',
        'block',to_jsonb(block_row),'replayed',false);
    end if;
    insert into public.cithela_operational_events(
      tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
    ) values(
      p_tenant_id,actor,case p_command when 'availability_block.create'
        then 'availability_block_created' else 'availability_block_deleted' end,
      'availability_block',block_row.id,jsonb_build_object('request_id',p_request_id)
    );
    insert into public.cithela_channel_requests(
      tenant_id,request_id,command,response,actor_user_id,request_payload
    ) values(p_tenant_id,p_request_id,p_command,result,actor,p_payload);
    return result;
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
end $function$;

do $cithela$
begin
  if not exists (
    select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='cithela_availability_blocks'
  ) then
    alter publication supabase_realtime add table public.cithela_availability_blocks;
  end if;
end
$cithela$;
