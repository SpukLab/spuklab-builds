-- Add operator-only, versioned attendance outcomes to the existing reservation command.
-- Preserves tenant lock, role checks, request idempotency and audit events.
CREATE OR REPLACE FUNCTION cithela_private.reservation_command(p_tenant_id uuid, p_request_id text, p_command text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_command is null or p_command not in ('appointment.create','appointment.confirm','appointment.cancel','appointment.reschedule','appointment.attend','appointment.no_show') then
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
      elsif p_command='appointment.attend' and appt.status='attended' then
        code := 'appointment_already_attended'; changed := false;
      elsif p_command='appointment.no_show' and appt.status='no_show' then
        code := 'appointment_already_no_show'; changed := false;
      elsif appt.status not in ('pending','confirmed') then
        return jsonb_build_object('ok',false,'code','invalid_state');
      end if;
      if changed and p_command in ('appointment.attend','appointment.no_show')
        and appt.starts_at > statement_timestamp() then
        return jsonb_build_object('ok',false,'code','appointment_not_started');
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
        status=case p_command
          when 'appointment.confirm' then 'confirmed'
          when 'appointment.cancel' then 'cancelled'
          when 'appointment.attend' then 'attended'
          when 'appointment.no_show' then 'no_show'
          else 'pending' end,
        starts_at=case when p_command='appointment.reschedule' then start_time else a.starts_at end,
        ends_at=case when p_command='appointment.reschedule' then end_time else a.ends_at end,
        row_version=a.row_version+1, updated_at=clock_timestamp()
        where a.id=appt.id and a.tenant_id=p_tenant_id returning * into appt;
      code := case p_command
        when 'appointment.confirm' then 'appointment_confirmed'
        when 'appointment.cancel' then 'appointment_cancelled'
        when 'appointment.attend' then 'appointment_attended'
        when 'appointment.no_show' then 'appointment_no_show'
        else 'appointment_rescheduled' end;
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
end $function$
