-- Manual deposit phase 1: amounts are Argentine pesos in minor units (centavos).
-- No payment provider, card data or automatic status changes.
alter table public.cithela_services
  add column if not exists deposit_amount_minor integer not null default 0,
  add column if not exists deposit_currency text not null default 'ARS';
alter table public.cithela_services
  add constraint cithela_services_deposit_amount_check
    check (deposit_amount_minor between 0 and 500000000),
  add constraint cithela_services_deposit_currency_check
    check (deposit_currency='ARS');

alter table public.cithela_appointments
  add column if not exists deposit_amount_minor integer not null default 0,
  add column if not exists deposit_currency text not null default 'ARS',
  add column if not exists deposit_status text not null default 'not_required',
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists deposit_refunded_at timestamptz,
  add column if not exists deposit_method text,
  add column if not exists deposit_recorded_by uuid;
alter table public.cithela_appointments
  add constraint cithela_appointments_deposit_amount_check
    check (deposit_amount_minor between 0 and 500000000),
  add constraint cithela_appointments_deposit_currency_check
    check (deposit_currency='ARS'),
  add constraint cithela_appointments_deposit_status_check
    check (deposit_status in ('not_required','requested','verified','waived','refunded')),
  add constraint cithela_appointments_deposit_method_check
    check (deposit_method is null or deposit_method in ('transfer','cash','other')),
  add constraint cithela_appointments_deposit_state_check
    check (
      (deposit_amount_minor=0 and deposit_status='not_required' and deposit_paid_at is null)
      or
      (deposit_amount_minor>0 and deposit_status='requested'
       and deposit_paid_at is null and deposit_refunded_at is null)
      or
      (deposit_amount_minor>0 and deposit_status='waived'
       and deposit_paid_at is null and deposit_refunded_at is null)
      or
      (deposit_amount_minor>0 and deposit_status='verified'
       and deposit_paid_at is not null and deposit_refunded_at is null and deposit_method is not null)
      or
      (deposit_amount_minor>0 and deposit_status='refunded'
       and deposit_paid_at is not null and deposit_refunded_at is not null and deposit_method is not null)
    );

create or replace function cithela_private.appointment_deposit_snapshot()
returns trigger language plpgsql security definer set search_path to ''
as $fn$
declare v_amount integer;v_currency text;
begin
  select s.deposit_amount_minor,s.deposit_currency into v_amount,v_currency
    from public.cithela_services s where s.tenant_id=new.tenant_id and s.id=new.service_id;
  new.deposit_amount_minor:=coalesce(v_amount,0);
  new.deposit_currency:=coalesce(v_currency,'ARS');
  new.deposit_status:=case when new.deposit_amount_minor>0 then 'requested' else 'not_required' end;
  new.deposit_paid_at:=null;new.deposit_refunded_at:=null;
  new.deposit_method:=null;new.deposit_recorded_by:=null;
  return new;
end $fn$;
drop trigger if exists cithela_appointment_deposit_on_insert on public.cithela_appointments;
create trigger cithela_appointment_deposit_on_insert
  before insert on public.cithela_appointments
  for each row execute function cithela_private.appointment_deposit_snapshot();

CREATE OR REPLACE FUNCTION cithela_private.service_catalog_command(p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_role text;v_status text;
  v_prior public.cithela_channel_requests%rowtype;
  v_service public.cithela_services%rowtype;
  v_name text;v_duration integer;
  v_deposit integer;v_currency text;v_policy boolean;
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
      where field not in ('id','expected_updated_at','name','duration_min','deposit_amount_minor','deposit_currency'))>0 then
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
      v_policy:=(p_payload ? 'deposit_amount_minor' or p_payload ? 'deposit_currency');
      if v_policy then
        if jsonb_typeof(p_payload->'deposit_amount_minor') is distinct from 'number'
          or jsonb_typeof(p_payload->'deposit_currency') is distinct from 'string'
          then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
        v_deposit:=(p_payload->>'deposit_amount_minor')::integer;
        v_currency:=p_payload->>'deposit_currency';
        if v_deposit<0 or v_deposit>500000000 or v_currency<>'ARS' then
          return jsonb_build_object('ok',false,'code','invalid_payload');end if;
      elsif p_command='service.create' then
        v_deposit:=0;v_currency:='ARS';
      end if;
      if length(v_name) not between 1 and 160
        or v_duration not between 15 and 720 or v_duration%15<>0 then
        return jsonb_build_object('ok',false,'code','invalid_payload'); end if;
    elsif p_payload ? 'name' or p_payload ? 'duration_min'
      or p_payload ? 'deposit_amount_minor' or p_payload ? 'deposit_currency' then
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
    insert into public.cithela_services(tenant_id,name,duration_min,deposit_amount_minor,deposit_currency)
      values(p_tenant_id,v_name,v_duration,v_deposit,v_currency) returning * into v_service;
    v_code:='service_created';
  else
    select * into v_service from public.cithela_services s
      where s.tenant_id=p_tenant_id and s.id=v_id for update;
    if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
    if v_service.updated_at is distinct from v_expected then
      return jsonb_build_object('ok',false,'code','stale_write'); end if;
    if p_command='service.update' then
      if not v_policy then v_deposit:=v_service.deposit_amount_minor;v_currency:=v_service.deposit_currency;end if;
      if exists(select 1 from public.cithela_services s
        where s.tenant_id=p_tenant_id and s.id<>v_id
          and lower(btrim(s.name))=lower(v_name)) then
        return jsonb_build_object('ok',false,'code','service_name_exists'); end if;
      if v_name=v_service.name and v_duration=v_service.duration_min
        and v_deposit=v_service.deposit_amount_minor and v_currency=v_service.deposit_currency then
        v_code:='service_unchanged';v_changed:=false;
      else
        update public.cithela_services s set name=v_name,duration_min=v_duration,
          deposit_amount_minor=v_deposit,deposit_currency=v_currency,
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
      'duration_min',v_service.duration_min,'deposit_amount_minor',v_service.deposit_amount_minor,
      'deposit_currency',v_service.deposit_currency,'active',v_service.active,
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
end $function$
;

create or replace function cithela_private.deposit_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();v_role text;v_tenant text;
  v_old public.cithela_channel_requests%rowtype;
  v_appt public.cithela_appointments%rowtype;
  v_id uuid;v_version bigint;v_method text;v_code text;
  v_result jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_request_id is null or length(btrim(p_request_id)) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>1024 then
    return jsonb_build_object('ok',false,'code','invalid_payload');end if;
  if p_command is null or p_command not in ('deposit.verify','deposit.waive','deposit.refund','deposit.undo') then
    return jsonb_build_object('ok',false,'code','unsupported_command');end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor for share;
  if v_role is null or v_role not in ('owner','admin','operator') then
    return jsonb_build_object('ok',false,'code','forbidden');end if;
  if p_command in ('deposit.waive','deposit.refund','deposit.undo') and v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'code','forbidden');end if;
  select t.status into v_tenant from public.cithela_tenants t
    where t.id=p_tenant_id for update;
  if v_tenant is distinct from 'active' then
    return jsonb_build_object('ok',false,'code','tenant_inactive');end if;
  select * into v_old from public.cithela_channel_requests q
    where q.tenant_id=p_tenant_id and q.request_id=p_request_id;
  if found then
    if v_old.actor_user_id is distinct from v_actor or v_old.command<>p_command
      or v_old.request_payload is distinct from p_payload then
      return jsonb_build_object('ok',false,'code','idempotency_conflict');end if;
    return v_old.response||jsonb_build_object('replayed',true);
  end if;
  if (select count(*) from jsonb_object_keys(p_payload) as fields(field)
      where field not in ('id','expected_version','method'))>0 then
    return jsonb_build_object('ok',false,'code','invalid_payload');end if;
  begin
    if jsonb_typeof(p_payload->'id') is distinct from 'string'
      or jsonb_typeof(p_payload->'expected_version') is distinct from 'number' then
      return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    v_id:=(p_payload->>'id')::uuid;
    v_version:=(p_payload->>'expected_version')::bigint;
    if v_id is null or v_version<1 then return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    if p_command='deposit.verify' then
      if jsonb_typeof(p_payload->'method') is distinct from 'string' then
        return jsonb_build_object('ok',false,'code','invalid_payload');end if;
      v_method:=p_payload->>'method';
      if v_method not in ('transfer','cash','other') then
        return jsonb_build_object('ok',false,'code','invalid_payload');end if;
    elsif p_payload ? 'method' then
      return jsonb_build_object('ok',false,'code','invalid_payload');
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end;
  select * into v_appt from public.cithela_appointments a
    where a.tenant_id=p_tenant_id and a.id=v_id for update;
  if not found then return jsonb_build_object('ok',false,'code','appointment_not_found');end if;
  if v_appt.row_version<>v_version then
    return jsonb_build_object('ok',false,'code','stale_write');end if;
  if v_appt.deposit_amount_minor<=0 then
    return jsonb_build_object('ok',false,'code','deposit_not_required');end if;
  if p_command='deposit.verify' then
    if v_appt.status not in ('pending','confirmed') or v_appt.deposit_status<>'requested' then
      return jsonb_build_object('ok',false,'code','invalid_state');end if;
    update public.cithela_appointments a set
      deposit_status='verified',deposit_paid_at=clock_timestamp(),
      deposit_method=v_method,deposit_recorded_by=v_actor,
      row_version=a.row_version+1,updated_at=clock_timestamp()
      where a.id=v_id and a.tenant_id=p_tenant_id returning * into v_appt;
    v_code:='deposit_verified_manually';
  elsif p_command='deposit.waive' then
    if v_appt.deposit_status<>'requested' then
      return jsonb_build_object('ok',false,'code','invalid_state');end if;
    update public.cithela_appointments a set deposit_status='waived',
      deposit_recorded_by=v_actor,row_version=a.row_version+1,updated_at=clock_timestamp()
      where a.id=v_id and a.tenant_id=p_tenant_id returning * into v_appt;
    v_code:='deposit_waived';
  elsif p_command='deposit.refund' then
    if v_appt.deposit_status<>'verified' then
      return jsonb_build_object('ok',false,'code','invalid_state');end if;
    update public.cithela_appointments a set deposit_status='refunded',
      deposit_refunded_at=clock_timestamp(),deposit_recorded_by=v_actor,
      row_version=a.row_version+1,updated_at=clock_timestamp()
      where a.id=v_id and a.tenant_id=p_tenant_id returning * into v_appt;
    v_code:='deposit_refund_recorded';
  else
    if v_appt.deposit_status<>'verified' then
      return jsonb_build_object('ok',false,'code','invalid_state');end if;
    update public.cithela_appointments a set deposit_status='requested',
      deposit_paid_at=null,deposit_method=null,deposit_recorded_by=v_actor,
      row_version=a.row_version+1,updated_at=clock_timestamp()
      where a.id=v_id and a.tenant_id=p_tenant_id returning * into v_appt;
    v_code:='deposit_verification_reversed';
  end if;
  v_result:=jsonb_build_object('ok',true,'code',v_code,
    'appointment',to_jsonb(v_appt),'replayed',false);
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,v_code,'appointment',v_id,
    jsonb_build_object('request_id',p_request_id,'row_version',v_appt.row_version,
      'amount_minor',v_appt.deposit_amount_minor,
      'currency',v_appt.deposit_currency,'payment_method',v_appt.deposit_method));
  insert into public.cithela_channel_requests(
    tenant_id,request_id,command,response,actor_user_id,request_payload
  ) values(p_tenant_id,p_request_id,p_command,v_result,v_actor,p_payload);
  return v_result;
end $fn$;

create or replace function public.cithela_deposit_command(
  p_tenant_id uuid,p_request_id text,p_command text,p_payload jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.deposit_command(p_tenant_id,p_request_id,p_command,p_payload);
$fn$;
revoke all on function cithela_private.deposit_command(uuid,text,text,jsonb) from public,anon;
revoke all on function public.cithela_deposit_command(uuid,text,text,jsonb) from public,anon;
grant execute on function cithela_private.deposit_command(uuid,text,text,jsonb) to authenticated;
grant execute on function public.cithela_deposit_command(uuid,text,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION cithela_private.patient_portal()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();
  v_row record;v_items jsonb;v_profiles jsonb:='[]'::jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  for v_row in
    select l.tenant_id,l.person_id,t.display_name as tenant_name,
      t.timezone,p.display_name as person_name,
      p.patient_shared_note,p.updated_at
    from public.cithela_patient_links l
    join public.cithela_tenants t on t.id=l.tenant_id and t.status='active'
    join public.cithela_people p on p.tenant_id=l.tenant_id and p.id=l.person_id
    where l.user_id=v_actor order by t.display_name,p.display_name
  loop
    select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at desc),'[]'::jsonb)
      into v_items
    from (
      select id,starts_at,ends_at,status,service_name,duration_min,resource_name,
        reason,row_version,deposit_amount_minor,deposit_currency,deposit_status from public.cithela_appointments
      where tenant_id=v_row.tenant_id and person_id=v_row.person_id
      order by starts_at desc limit 100
    ) a;
    v_profiles:=v_profiles||jsonb_build_array(jsonb_build_object(
      'tenant_id',v_row.tenant_id,'tenant_name',v_row.tenant_name,
      'person_id',v_row.person_id,'name',v_row.person_name,
      'timezone',v_row.timezone,'appointments',v_items,
      'patient_shared_note',v_row.patient_shared_note,
      'person_updated_at',v_row.updated_at
    ));
  end loop;
  return jsonb_build_object('ok',true,'profiles',v_profiles);
end
$function$
;
-- An appointment's booked deposit never changes when service pricing is edited.
-- Existing bookings (prior to this feature) have 0 amount and "not_required".
