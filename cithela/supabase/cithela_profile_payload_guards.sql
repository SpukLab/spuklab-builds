-- Harden payload validation: reject unexpected or omitted fields.
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
    (select count(*) from jsonb_object_keys(p_payload) as fields(field)
      where field not in ('display_name','phone_e164','contact_email','notes','alerts'))>0 then
    return jsonb_build_object('ok',false,'code','invalid_payload');
  end if;
  if jsonb_typeof(p_payload->'display_name') is distinct from 'string'
    or jsonb_typeof(p_payload->'notes') is distinct from 'string'
    or jsonb_typeof(p_payload->'alerts') is distinct from 'string'
    or coalesce(jsonb_typeof(p_payload->'phone_e164'),'absent') not in ('string','null')
    or coalesce(jsonb_typeof(p_payload->'contact_email'),'absent') not in ('string','null') then
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

