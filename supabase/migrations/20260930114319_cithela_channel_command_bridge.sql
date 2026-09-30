create function cithela_private.channel_availability_core(
  p_tenant_id uuid,p_service_id uuid,p_resource_id uuid,p_date date
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
      v_slot_local:=v_slot_local+interval '30 minutes';
    end loop;
  end loop;

  return jsonb_build_object(
    'ok',true,'code','availability','date',p_date,'timezone',v_tz,
    'service',jsonb_build_object('id',v_svc.id,'name',v_svc.name,'duration_min',v_svc.duration_min),
    'resource',jsonb_build_object('id',v_res.id,'name',v_res.name),
    'slots',v_slots
  );
end $$;
revoke all on function cithela_private.channel_availability_core(uuid,uuid,uuid,date)
  from public,anon,authenticated,service_role;

create function cithela_private.channel_command(
  p_channel text,p_external_account_id text,p_request_id text,p_command text,p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function cithela_private.channel_command(text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function cithela_private.channel_command(text,text,text,text,jsonb)
  to service_role;

create function public.cithela_channel_command(
  p_channel text,p_external_account_id text,p_request_id text,p_command text,p_payload jsonb
) returns jsonb
language sql security invoker set search_path='' as $$
  select cithela_private.channel_command(
    p_channel,p_external_account_id,p_request_id,p_command,p_payload
  );
$$;
revoke all on function public.cithela_channel_command(text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.cithela_channel_command(text,text,text,text,jsonb)
  to service_role;
