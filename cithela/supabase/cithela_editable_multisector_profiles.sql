-- CITHELA: tenant-scoped editable profiles and voluntary patient-shared information.
-- contact_email is for contacting the person; it NEVER changes auth.users.email
-- or an existing patient invitation/link. Internal notes/alerts stay staff-only.

alter table public.cithela_people
  add column if not exists contact_email text,
  add column if not exists patient_shared_note text not null default '';

create or replace function cithela_private.person_profile_update(
  p_tenant_id uuid,p_person_id uuid,p_expected_updated_at timestamptz,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_person public.cithela_people%rowtype;
  v_name text;v_phone text;v_contact text;v_notes text;v_alerts text;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select m.role into v_role from public.cithela_tenant_memberships m
    where m.tenant_id=p_tenant_id and m.user_id=v_actor;
  if v_role is null or v_role not in ('owner','admin','operator') then
    return jsonb_build_object('ok',false,'code','forbidden');
  end if;
  if not exists(select 1 from public.cithela_tenants t
    where t.id=p_tenant_id and t.status='active') then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  if p_expected_updated_at is null or p_payload is null
    or jsonb_typeof(p_payload)<>'object' or
    octet_length(p_payload::text)>16000 or
    (select count(*) from jsonb_object_keys(p_payload) k
      where k not in ('display_name','phone_e164','contact_email','notes','alerts'))>0 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if jsonb_typeof(p_payload->'display_name') is distinct from 'string'
    or jsonb_typeof(p_payload->'notes') is distinct from 'string'
    or jsonb_typeof(p_payload->'alerts') is distinct from 'string'
    or jsonb_typeof(p_payload->'phone_e164') not in ('string','null')
    or jsonb_typeof(p_payload->'contact_email') not in ('string','null') then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  v_name:=btrim(p_payload->>'display_name');
  v_phone:=nullif(btrim(coalesce(p_payload->>'phone_e164','')),'');
  v_contact:=nullif(lower(btrim(coalesce(p_payload->>'contact_email',''))),'');
  v_notes:=btrim(p_payload->>'notes');
  v_alerts:=btrim(p_payload->>'alerts');
  if length(v_name) not between 1 and 160 or length(v_notes)>3000
    or length(v_alerts)>1200 or
    (v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$') or
    (v_contact is not null and
      (length(v_contact)>254 or v_contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  select * into v_person from public.cithela_people p
    where p.tenant_id=p_tenant_id and p.id=p_person_id for update;
  if not found then return jsonb_build_object('ok',false,'code','person_not_found'); end if;
  if v_person.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  begin
    update public.cithela_people p set
      display_name=v_name,phone_e164=v_phone,contact_email=v_contact,
      notes=v_notes,alerts=v_alerts,updated_at=clock_timestamp()
    where p.tenant_id=p_tenant_id and p.id=p_person_id returning * into v_person;
  exception when unique_violation then
    return jsonb_build_object('ok',false,'code','phone_in_use');
  end;
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,'person_profile_updated','person',p_person_id,
    jsonb_build_object('fields',jsonb_build_array(
      'display_name','phone_e164','contact_email','notes','alerts')));
  return jsonb_build_object('ok',true,'code','person_profile_updated',
    'person',jsonb_build_object('id',v_person.id,'display_name',v_person.display_name,
      'phone_e164',v_person.phone_e164,'contact_email',v_person.contact_email,
      'notes',v_person.notes,'alerts',v_person.alerts,
      'patient_shared_note',v_person.patient_shared_note,
      'updated_at',v_person.updated_at));
end
$fn$;

create or replace function cithela_private.patient_shared_note_update(
  p_tenant_id uuid,p_person_id uuid,p_expected_updated_at timestamptz,p_note text
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare
  v_actor uuid:=auth.uid();
  v_verified timestamptz;
  v_person public.cithela_people%rowtype;
  v_note text:=btrim(coalesce(p_note,''));
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
  if p_expected_updated_at is null or length(v_note)>1200 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if not exists(select 1 from public.cithela_tenants t
    where t.id=p_tenant_id and t.status='active') then
    return jsonb_build_object('ok',false,'code','tenant_inactive');
  end if;
  select p.* into v_person from public.cithela_people p
    join public.cithela_patient_links l on l.tenant_id=p.tenant_id
      and l.person_id=p.id and l.user_id=v_actor
    where p.tenant_id=p_tenant_id and p.id=p_person_id for update of p;
  if not found then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if v_person.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','stale_write');
  end if;
  update public.cithela_people p set patient_shared_note=v_note,
    updated_at=clock_timestamp()
    where p.tenant_id=p_tenant_id and p.id=p_person_id
    returning * into v_person;
  insert into public.cithela_operational_events(
    tenant_id,actor_user_id,event_type,entity_type,entity_id,payload
  ) values(p_tenant_id,v_actor,'patient_shared_note_updated','person',p_person_id,
    jsonb_build_object('note_present',length(v_note)>0));
  return jsonb_build_object('ok',true,'code','patient_shared_note_updated',
    'patient_shared_note',v_person.patient_shared_note,
    'updated_at',v_person.updated_at);
end
$fn$;

-- The patient sees their own voluntary note and profile version only.
-- Contact information, internal notes and staff alerts are excluded.
create or replace function cithela_private.patient_portal()
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
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
        reason,row_version from public.cithela_appointments
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
$fn$;

create or replace function public.cithela_person_profile_update(
  p_tenant_id uuid,p_person_id uuid,p_expected_updated_at timestamptz,p_payload jsonb
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.person_profile_update(
    p_tenant_id,p_person_id,p_expected_updated_at,p_payload);
$fn$;
create or replace function public.cithela_patient_shared_note_update(
  p_tenant_id uuid,p_person_id uuid,p_expected_updated_at timestamptz,p_note text
) returns jsonb language sql security invoker set search_path to ''
as $fn$
  select cithela_private.patient_shared_note_update(
    p_tenant_id,p_person_id,p_expected_updated_at,p_note);
$fn$;

revoke all on function cithela_private.person_profile_update(uuid,uuid,timestamptz,jsonb) from public,anon;
revoke all on function cithela_private.patient_shared_note_update(uuid,uuid,timestamptz,text) from public,anon;
revoke all on function public.cithela_person_profile_update(uuid,uuid,timestamptz,jsonb) from public,anon;
revoke all on function public.cithela_patient_shared_note_update(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function cithela_private.person_profile_update(uuid,uuid,timestamptz,jsonb) to authenticated;
grant execute on function cithela_private.patient_shared_note_update(uuid,uuid,timestamptz,text) to authenticated;
grant execute on function public.cithela_person_profile_update(uuid,uuid,timestamptz,jsonb) to authenticated;
grant execute on function public.cithela_patient_shared_note_update(uuid,uuid,timestamptz,text) to authenticated;
