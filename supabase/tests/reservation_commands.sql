-- Run with the database owner. Entire fixture (including Auth identities) rolls
-- back; these users have no password/email and never become live accounts.
begin;
do $$
declare
  u uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  ta uuid; tb uuid; pa uuid; pb uuid; s uuid; r uuid; aid uuid;
  answer jsonb; payload jsonb; ts timestamptz := date_trunc('day',now()) + interval '30 days 12 hours';
  n integer;
begin
  insert into auth.users(id) values (u),(v);
  insert into public.cithela_tenants(display_name) values('Probe A') returning id into ta;
  insert into public.cithela_tenants(display_name) values('Probe B') returning id into tb;
  insert into public.cithela_tenant_memberships values(ta,u,'operator',now()),(tb,v,'viewer',now());
  insert into public.cithela_people(tenant_id,display_name) values(ta,'A') returning id into pa;
  insert into public.cithela_people(tenant_id,display_name) values(tb,'B') returning id into pb;
  insert into public.cithela_services(tenant_id,name,duration_min) values(ta,'Test',30) returning id into s;
  insert into public.cithela_resources(tenant_id,name) values(ta,'Test') returning id into r;
  insert into public.cithela_availability_blocks(tenant_id,starts_at,ends_at) values(ta,ts+interval '2 hours',ts+interval '3 hours');
  payload := jsonb_build_object('person_id',pa,'service_id',s,'resource_id',r,'starts_at',to_char(ts,'YYYY-MM-DD"T"HH24:MI:SSOF'));
  -- to_char OF may omit :00; build an explicit UTC offset instead.
  payload := payload || jsonb_build_object('starts_at',to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z');
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  select count(*) into n from public.cithela_people;
  if n is distinct from 1 then raise exception 'RLS leaked another tenant'; end if;
  answer := public.cithela_reservation_command(ta,'create','appointment.create',payload);
  if answer->>'code' is distinct from 'appointment_created' then raise exception 'create failed: %',answer; end if;
  aid := (answer#>>'{appointment,id}')::uuid;
  answer := public.cithela_reservation_command(ta,'create','appointment.create',payload);
  if answer->>'replayed' is distinct from 'true' then raise exception 'retry not replayed'; end if;
  answer := public.cithela_reservation_command(ta,'create','appointment.create',payload||'{"reason":"different"}');
  if answer->>'code' is distinct from 'idempotency_conflict' then raise exception 'changed retry accepted'; end if;
  answer := public.cithela_reservation_command(ta,'overlap','appointment.create',payload);
  if answer->>'code' is distinct from 'slot_unavailable' then raise exception 'overlap accepted'; end if;
  answer := public.cithela_reservation_command(ta,'bad-person','appointment.create',payload||jsonb_build_object('person_id',pb));
  if answer->>'code' is distinct from 'patient_not_found' then raise exception 'cross-tenant person accepted'; end if;
  answer := public.cithela_reservation_command(tb,'cross','appointment.confirm',jsonb_build_object('id',aid,'expected_version',1));
  if answer->>'code' is distinct from 'forbidden' then raise exception 'cross tenant command accepted'; end if;
  answer := public.cithela_reservation_command(ta,'confirm','appointment.confirm',jsonb_build_object('id',aid,'expected_version',1));
  if answer->>'code' is distinct from 'appointment_confirmed' or answer#>>'{appointment,row_version}' is distinct from '2' then raise exception 'confirm failed'; end if;
  answer := public.cithela_reservation_command(ta,'stale','appointment.cancel',jsonb_build_object('id',aid,'expected_version',1));
  if answer->>'code' is distinct from 'stale_write' then raise exception 'stale write accepted'; end if;
  answer := public.cithela_reservation_command(ta,'block','appointment.reschedule',jsonb_build_object('id',aid,'expected_version',2,'starts_at',to_char((ts+interval '2 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'));
  if answer->>'code' is distinct from 'slot_unavailable' then raise exception 'general block ignored'; end if;
  answer := public.cithela_reservation_command(ta,'move','appointment.reschedule',jsonb_build_object('id',aid,'expected_version',2,'starts_at',to_char((ts+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'Z'));
  if answer->>'code' is distinct from 'appointment_rescheduled' or answer#>>'{appointment,status}' is distinct from 'pending' or answer#>>'{appointment,row_version}' is distinct from '3' then raise exception 'reschedule failed'; end if;
  answer := public.cithela_reservation_command(ta,'cancel','appointment.cancel',jsonb_build_object('id',aid,'expected_version',3));
  if answer->>'code' is distinct from 'appointment_cancelled' then raise exception 'cancel failed'; end if;
  answer := public.cithela_reservation_command(ta,'cancel-again','appointment.cancel',jsonb_build_object('id',aid,'expected_version',4));
  if answer->>'code' is distinct from 'appointment_already_cancelled' or answer#>>'{appointment,row_version}' is distinct from '4' then raise exception 'cancel no-op changed version'; end if;
  answer := public.cithela_reservation_command(ta,'terminal','appointment.confirm',jsonb_build_object('id',aid,'expected_version',4));
  if answer->>'code' is distinct from 'invalid_state' then raise exception 'terminal state reopened'; end if;
  select count(*) into n from public.cithela_operational_events;
  if n is distinct from 4 then raise exception 'duplicate or missing audit events: %',n; end if;
  begin
    insert into public.cithela_people(tenant_id,display_name) values(ta,'Unauthorized direct write');
    raise exception 'direct write accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',v::text,true);
  select count(*) into n from public.cithela_appointments;
  if n is distinct from 0 then raise exception 'viewer saw other tenant appointment'; end if;
  answer := public.cithela_reservation_command(tb,'viewer','appointment.create',payload);
  if answer->>'code' is distinct from 'forbidden' then raise exception 'viewer wrote'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  answer := public.cithela_reservation_command(ta,'no-user','appointment.create',payload);
  if answer->>'code' is distinct from 'unauthenticated' then raise exception 'missing identity accepted'; end if;
  execute 'reset role';
end $$;
rollback;
