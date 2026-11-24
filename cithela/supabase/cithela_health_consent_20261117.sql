-- CITHELA · consentimiento de obra social/prepaga durante reserva.
-- Aditivo sobre cithela_health_rates_live_20261117, sin activar tenants.
alter table cithela_private.cithela_health_booking_selections
  add column consent_at timestamptz;
alter table cithela_private.cithela_health_booking_selections
  add constraint cithela_health_booking_consent_required
  check ((kind='particular' and consent_at is null)
     or (kind in ('obra_social','prepaga') and consent_at is not null));

create or replace function public.cithela_health_booking_create(
 p_tenant_id uuid,p_request_id text,p_payload jsonb,
 p_rate_id uuid,p_rate_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_actor uuid:=auth.uid();v_service uuid;v_timezone text;v_rate cithela_private.cithela_health_rates%rowtype;
  v_response jsonb;v_appointment uuid;v_selection cithela_private.cithela_health_booking_selections%rowtype;
begin
 if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated');end if;
 if p_tenant_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or p_rate_id is null or p_rate_version is null or p_rate_version<1 then
   return jsonb_build_object('ok',false,'code','invalid_rate');end if;
 if coalesce(p_payload->>'service_id','')!~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then return jsonb_build_object('ok',false,'code','invalid_service');end if;
 v_service:=(p_payload->>'service_id')::uuid;
 select timezone into v_timezone from public.cithela_tenants t where t.id=p_tenant_id;
 if v_timezone is null then return jsonb_build_object('ok',false,'code','tenant_inactive');end if;
 if not cithela_private.cithela_health_ready(p_tenant_id) then
   return jsonb_build_object('ok',false,'code','module_not_enabled');end if;
 select * into v_rate from cithela_private.cithela_health_rates r
   where r.id=p_rate_id and r.tenant_id=p_tenant_id and r.service_id=v_service
     and r.active for share;
 if not found or v_rate.version<>p_rate_version or
    (v_rate.valid_until is not null and v_rate.valid_until<
       (statement_timestamp() at time zone v_timezone)::date) then
   return jsonb_build_object('ok',false,'code','rate_changed');end if;
 -- La modalidad sanitaria requiere una elección afirmativa y auditable
 -- del paciente, y se almacena solo en el canal de solicitud protegido.
 if v_rate.kind in ('obra_social','prepaga')
   and p_payload->'coverage_consent' is distinct from 'true'::jsonb then
   return jsonb_build_object('ok',false,'code','coverage_consent_required');
 end if;
 -- La rutina existente verifica email/teléfono, vínculo, disponibilidad, tenant,
 -- duplicados e idempotencia. No se confía en un importe enviado por el navegador.
 v_response:=cithela_private.patient_booking_create(p_tenant_id,p_request_id,p_payload);
 if not coalesce((v_response->>'ok')::boolean,false) then return v_response;end if;
 v_appointment:=(v_response->'appointment'->>'id')::uuid;
 if v_appointment is null then raise exception 'booking_response_missing_appointment';end if;
 if coalesce((v_response->>'replayed')::boolean,false) then
   select * into v_selection from cithela_private.cithela_health_booking_selections s
     where s.appointment_id=v_appointment and s.tenant_id=p_tenant_id;
   if not found or v_selection.rate_id<>p_rate_id
     or v_selection.rate_version<>p_rate_version then
     return jsonb_build_object('ok',false,'code','selection_conflict');end if;
 else
   insert into cithela_private.cithela_health_booking_selections
     (appointment_id,tenant_id,rate_id,rate_version,kind,provider,plan,price_status,amount_minor,consent_at)
   values(v_appointment,p_tenant_id,v_rate.id,v_rate.version,v_rate.kind,
     v_rate.provider,v_rate.plan,v_rate.price_status,v_rate.amount_minor,
     case when v_rate.kind='particular' then null else statement_timestamp() end);
 end if;
 return v_response || jsonb_build_object(
   'coverage',jsonb_build_object('kind',v_rate.kind,'provider',v_rate.provider,
      'plan',v_rate.plan,'price_status',v_rate.price_status,
      'amount_minor',v_rate.amount_minor,'currency','ARS'));
end
$function$;
