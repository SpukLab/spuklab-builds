-- Server-only external channel command fixture. Entire transaction rolls back.
begin;
do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_tenant uuid; v_svc uuid; v_res uuid;
  v_outsider public.cithela_people%rowtype;
  v_outsider_appt uuid; v_own_appt uuid;
  v_answer jsonb; v_replay jsonb;
  v_future_date date:=(statement_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+30;
  v_dow integer;
  v_start1 timestamptz; v_start2 timestamptz; v_start3 timestamptz; v_outside timestamptz;
begin
  insert into auth.users(id) values(v_owner);
  insert into public.cithela_tenants(display_name) values('Channel Cmd') returning id into v_tenant;
  insert into public.cithela_tenant_memberships values(v_tenant,v_owner,'owner',now());
  insert into public.cithela_services(tenant_id,name,duration_min)
    values(v_tenant,'Consulta',30) returning id into v_svc;
  insert into public.cithela_resources(tenant_id,name)
    values(v_tenant,'Principal') returning id into v_res;

  v_dow:=extract(isodow from v_future_date)::integer;
  insert into public.cithela_working_hours(tenant_id,weekday,starts_local,ends_local)
    values(v_tenant,v_dow,'08:00','18:00');
  insert into public.cithela_channel_connections(tenant_id,channel,external_account_id,display_label)
    values(v_tenant,'whatsapp','wa-cmd-001','Test');

  v_start1:=(v_future_date+time '09:00') at time zone 'America/Argentina/Buenos_Aires';
  v_start2:=(v_future_date+time '10:00') at time zone 'America/Argentina/Buenos_Aires';
  v_start3:=(v_future_date+time '11:00') at time zone 'America/Argentina/Buenos_Aires';
  v_outside:=(v_future_date+time '19:00') at time zone 'America/Argentina/Buenos_Aires';

  insert into public.cithela_people(tenant_id,display_name,phone_e164)
    values(v_tenant,'Otra Persona','+5492215552222') returning * into v_outsider;
  insert into public.cithela_appointments(
    tenant_id,person_id,service_id,resource_id,starts_at,ends_at,
    service_name,duration_min,resource_name
  ) values(
    v_tenant,v_outsider.id,v_svc,v_res,v_start2,v_start2+interval '30 minutes',
    'Consulta',30,'Principal'
  ) returning id into v_outsider_appt;

  execute 'set local role service_role';

  v_answer:=public.cithela_channel_command('whatsapp','wa-cmd-001','services','catalog.services','{}'::jsonb);
  if v_answer->>'code'<>'services' or jsonb_array_length(v_answer->'items')<>1 then raise exception 'services %',v_answer; end if;

  v_answer:=public.cithela_channel_command('whatsapp','wa-cmd-001','resources','catalog.resources','{}'::jsonb);
  if v_answer->>'code'<>'resources' or jsonb_array_length(v_answer->'items')<>1 then raise exception 'resources %',v_answer; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','resolve','person.resolve',
    jsonb_build_object('sender_phone','+5492215551111','sender_name','Ana','create_if_missing',true)
  );
  if v_answer->>'code'<>'person_created' then raise exception 'resolve %',v_answer; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','avail','availability.query',
    jsonb_build_object('service_id',v_svc,'resource_id',v_res,'date',v_future_date)
  );
  if v_answer->>'code'<>'availability' or not ((v_answer->'slots') ? '09:00') or ((v_answer->'slots') ? '10:00') then
    raise exception 'availability %',v_answer;
  end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','outside','appointment.create',
    jsonb_build_object(
      'sender_phone','+5492215551111','service_id',v_svc,'resource_id',v_res,
      'starts_at',to_char(v_outside at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'
    )
  );
  if v_answer->>'code'<>'outside_working_hours' then raise exception 'outside %',v_answer; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','create-1','appointment.create',
    jsonb_build_object(
      'sender_phone','+5492215551111','service_id',v_svc,'resource_id',v_res,
      'starts_at',to_char(v_start1 at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z','reason','Control'
    )
  );
  if v_answer->>'code'<>'appointment_created' then raise exception 'create %',v_answer; end if;
  v_own_appt:=(v_answer#>>'{appointment,id}')::uuid;

  v_replay:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','create-1','appointment.create',
    jsonb_build_object(
      'sender_phone','+5492215551111','service_id',v_svc,'resource_id',v_res,
      'starts_at',to_char(v_start1 at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z','reason','Control'
    )
  );
  if v_replay->>'replayed'<>'true' then raise exception 'replay %',v_replay; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','list','appointments.list',
    jsonb_build_object('sender_phone','+5492215551111')
  );
  if v_answer->>'code'<>'appointments' or jsonb_array_length(v_answer->'items')<>1 then raise exception 'list %',v_answer; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','steal','appointment.cancel',
    jsonb_build_object('sender_phone','+5492215551111','id',v_outsider_appt,'expected_version',1)
  );
  if v_answer->>'code'<>'appointment_not_found' then raise exception 'ownership %',v_answer; end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','confirm','appointment.confirm',
    jsonb_build_object('sender_phone','+5492215551111','id',v_own_appt,'expected_version',1)
  );
  if v_answer->>'code'<>'appointment_confirmed' or (v_answer#>>'{appointment,row_version}')::bigint<>2 then
    raise exception 'confirm %',v_answer;
  end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','move','appointment.reschedule',
    jsonb_build_object(
      'sender_phone','+5492215551111','id',v_own_appt,'expected_version',2,
      'starts_at',to_char(v_start3 at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'
    )
  );
  if v_answer->>'code'<>'appointment_rescheduled' or (v_answer#>>'{appointment,row_version}')::bigint<>3 then
    raise exception 'move %',v_answer;
  end if;

  v_answer:=public.cithela_channel_command(
    'whatsapp','wa-cmd-001','cancel','appointment.cancel',
    jsonb_build_object('sender_phone','+5492215551111','id',v_own_appt,'expected_version',3)
  );
  if v_answer->>'code'<>'appointment_cancelled' or (v_answer#>>'{appointment,row_version}')::bigint<>4 then
    raise exception 'cancel %',v_answer;
  end if;

  v_answer:=public.cithela_channel_command('whatsapp','missing-account','missing','catalog.services','{}'::jsonb);
  if v_answer->>'code'<>'channel_not_found' then raise exception 'route %',v_answer; end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  execute 'set local role authenticated';
  begin
    perform public.cithela_channel_command('whatsapp','wa-cmd-001','blocked','catalog.services','{}'::jsonb);
    raise exception 'authenticated caller accepted';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $$;
rollback;
