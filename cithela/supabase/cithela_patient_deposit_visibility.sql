CREATE OR REPLACE FUNCTION cithela_private.patient_booking_catalog(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_verified timestamptz;
  v_tenant_name text;
  v_services jsonb;
  v_resources jsonb;
begin
  if v_actor is null then return jsonb_build_object('ok',false,'code','unauthenticated'); end if;
  select u.email_confirmed_at into v_verified from auth.users u where u.id=v_actor;
  if v_verified is null then return jsonb_build_object('ok',false,'code','email_not_verified'); end if;
  select t.display_name into v_tenant_name
    from public.cithela_tenants t where t.id=p_tenant_id and t.status='active';
  if v_tenant_name is null then return jsonb_build_object('ok',false,'code','tenant_inactive'); end if;
  if not exists(
    select 1 from public.cithela_patient_links l
    where l.tenant_id=p_tenant_id and l.user_id=v_actor
  ) then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'duration_min',s.duration_min,
    'deposit_amount_minor',s.deposit_amount_minor,'deposit_currency',s.deposit_currency
  ) order by s.name),'[]'::jsonb) into v_services
  from public.cithela_services s where s.tenant_id=p_tenant_id and s.active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'name',r.name
  ) order by r.name),'[]'::jsonb) into v_resources
  from public.cithela_resources r where r.tenant_id=p_tenant_id and r.active;
  return jsonb_build_object('ok',true,'code','patient_catalog',
    'tenant_id',p_tenant_id,'tenant_name',v_tenant_name,
    'services',v_services,'resources',v_resources);
end
$function$
;
