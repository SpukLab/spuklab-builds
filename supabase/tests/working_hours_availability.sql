-- Run with the database owner. Entire fixture rolls back.
begin;
do $$
declare
  u uuid:=gen_random_uuid(); v uuid:=gen_random_uuid();
  ta uuid; tb uuid; pa uuid; s uuid; r uuid; aid uuid;
  answer jsonb; payload jsonb; ts timestamptz:=date_trunc('day',now())+interval '30 days 12 hours';
  local_date date; dow integer;
begin
  insert into auth.users(id) values(u),(v);
  insert into public.cithela_tenants(display_name) values('Hours A') returning id into ta;
  insert into public.cithela_tenants(display_name) values('Hours B') returning id into tb;
  insert into public.cithela_tenant_memberships values(ta,u,'owner',now()),(tb,v,'viewer',now());
  insert into public.cithela_people(tenant_id,display_name) values(ta,'A') returning id into pa;
  insert into public.cithela_services(tenant_id,name,duration_min) values(ta,'Test',30) returning id into s;
  insert into public.cithela_resources(tenant_id,name) values(ta,'Test') returning id into r;
  insert into public.cithela_availability_blocks(tenant_id,starts_at,ends_at)
    values(ta,ts+interval '2 hours',ts+interval '3 hours');
  local_date:=(ts at time zone 'America/Argentina/Buenos_Aires')::date;
  dow:=extract(isodow from local_date)::integer;

  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  answer:=public.cithela_configuration_command(ta,'hours','working_hours.set_day',
    jsonb_build_object('weekday',dow,'periods',jsonb_build_array(jsonb_build_object('start','08:00','end','18:00'))));
  if answer->>'code' is distinct from 'working_hours_updated' then raise exception 'hours setup failed: %',answer; end if;
  answer:=public.cithela_configuration_command(ta,'hours','working_hours.set_day',
    jsonb_build_object('weekday',dow,'periods',jsonb_build_array(jsonb_build_object('start','08:00','end','18:00'))));
  if answer->>'replayed' is distinct from 'true' then raise exception 'hours replay failed'; end if;
  answer:=public.cithela_configuration_command(ta,'overlap','working_hours.set_day',
    jsonb_build_object('weekday',dow,'periods',jsonb_build_array(
      jsonb_build_object('start','08:00','end','12:00'),jsonb_build_object('start','11:00','end','13:00'))));
  if answer->>'code' is distinct from 'overlapping_hours' then raise exception 'overlap accepted: %',answer; end if;

  payload:=jsonb_build_object('person_id',pa,'service_id',s,'resource_id',r,
    'starts_at',to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z');
  answer:=public.cithela_reservation_command(ta,'create','appointment.create',payload);
  if answer->>'code' is distinct from 'appointment_created' then raise exception 'create failed: %',answer; end if;
  aid:=(answer#>>'{appointment,id}')::uuid;

  answer:=public.cithela_reservation_command(ta,'outside','appointment.create',
    payload||jsonb_build_object('starts_at',to_char((ts+interval '12 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'));
  if answer->>'code' is distinct from 'outside_working_hours' then raise exception 'outside hours accepted: %',answer; end if;

  answer:=public.cithela_availability_query(ta,s,r,local_date);
  if answer->>'code' is distinct from 'availability' then raise exception 'availability failed: %',answer; end if;
  if not ((answer->'slots') ? '08:00') then raise exception '08:00 missing: %',answer; end if;
  if ((answer->'slots') ? '09:00') then raise exception 'occupied slot leaked: %',answer; end if;
  if ((answer->'slots') ? '11:00') then raise exception 'blocked slot leaked: %',answer; end if;

  perform set_config('request.jwt.claim.sub',v::text,true);
  answer:=public.cithela_configuration_command(tb,'viewer','working_hours.set_day',
    jsonb_build_object('weekday',dow,'periods','[]'::jsonb));
  if answer->>'code' is distinct from 'forbidden' then raise exception 'viewer changed hours'; end if;
  answer:=public.cithela_availability_query(ta,s,r,local_date);
  if answer->>'code' is distinct from 'forbidden' then raise exception 'cross-tenant availability leaked: %',answer; end if;
  execute 'reset role';
end $$;
rollback;
