-- Align professional appointment slot intervals with the patient booking flow (15 minutes).
-- Appointment lengths, working hours and existing reservations are unchanged.
CREATE OR REPLACE FUNCTION public.cithela_availability_query(p_tenant_id uuid, p_service_id uuid, p_resource_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); member_role text; tenant_status text; tz text;
  svc public.cithela_services%rowtype; res public.cithela_resources%rowtype; wh record;
  has_specific boolean; slot_local timestamp; slot_abs timestamptz; slot_end timestamptz;
  slot_text text; slots jsonb:='[]'::jsonb; dow integer;
begin
  if actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select m.role,t.status,t.timezone into member_role,tenant_status,tz
    from public.cithela_tenant_memberships m join public.cithela_tenants t on t.id=m.tenant_id
    where m.tenant_id=p_tenant_id and m.user_id=actor;
  if member_role is null then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if tenant_status is distinct from 'active' then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if p_date is null or p_date<(statement_timestamp() at time zone tz)::date then return jsonb_build_object('ok',false,'code','invalid_date'); end if;
  select * into svc from public.cithela_services s where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active;
  if not found then return jsonb_build_object('ok',false,'code','service_not_found'); end if;
  select * into res from public.cithela_resources r where r.tenant_id=p_tenant_id and r.id=p_resource_id and r.active;
  if not found then return jsonb_build_object('ok',false,'code','resource_not_found'); end if;
  dow:=extract(isodow from p_date)::integer;
  select exists(select 1 from public.cithela_working_hours w where w.tenant_id=p_tenant_id and w.resource_id=p_resource_id and w.weekday=dow) into has_specific;
  for wh in select w.starts_local,w.ends_local from public.cithela_working_hours w
    where w.tenant_id=p_tenant_id and w.weekday=dow
      and ((has_specific and w.resource_id=p_resource_id) or (not has_specific and w.resource_id is null))
    order by w.starts_local
  loop
    slot_local:=p_date+wh.starts_local;
    while slot_local+svc.duration_min*interval '1 minute'<=p_date+wh.ends_local loop
      slot_abs:=slot_local at time zone tz; slot_end:=slot_abs+svc.duration_min*interval '1 minute';
      if slot_abs>statement_timestamp()
        and not exists(select 1 from public.cithela_availability_blocks b where b.tenant_id=p_tenant_id
          and (b.resource_id is null or b.resource_id=p_resource_id) and b.starts_at<slot_end and b.ends_at>slot_abs)
        and not exists(select 1 from public.cithela_appointments a where a.tenant_id=p_tenant_id and a.resource_id=p_resource_id
          and a.status in ('pending','confirmed') and a.starts_at<slot_end and a.ends_at>slot_abs) then
        slot_text:=to_char(slot_local,'HH24:MI');
        if not (slots ? slot_text) then slots:=slots||jsonb_build_array(slot_text); end if;
      end if;
      slot_local:=slot_local+interval '15 minutes';
    end loop;
  end loop;
  return jsonb_build_object('ok',true,'code','availability','date',p_date,'timezone',tz,
    'service',jsonb_build_object('id',svc.id,'name',svc.name,'duration_min',svc.duration_min),
    'resource',jsonb_build_object('id',res.id,'name',res.name),'slots',slots);
end $function$
;
