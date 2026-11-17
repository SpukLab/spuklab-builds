import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const repo=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql=repo("supabase/cithela_health_rates_live_20261117.sql");
const page=repo("reservar.html");
const edit=repo("configurar-coberturas.html");
const home=repo("index.html");

test("barrera de acceso: servidor, establecimiento, módulo contratado y reservas activas",()=>{
 assert.match(sql,/join cithela_private\.cithela_tenant_package_access a on a.code=c.code/);
 assert.match(sql,/c\.code='salud' and c\.available/);
 assert.match(sql,/a\.state in \('pilot','active'\)/);
 assert.match(sql,/a\.expires_at is null or a\.expires_at>statement_timestamp\(\)/);
 assert.match(sql,/b\.enabled=true/);
 assert.match(sql,/commercial_entitlement_snapshot\(t\.id\)/);
 assert.match(sql,/m\.user_id=v_actor and m\.tenant_id=p_tenant_id and m\.role in \('owner','admin'\)/);
});
test("tarifas y elecciones de turnos en esquema privado, RLS y sin acceso directo",()=>{
 for(const table of ["cithela_health_rates","cithela_health_booking_selections","cithela_health_rate_audit"]){
  assert.match(sql,new RegExp("alter table cithela_private\\."+table+" enable row level security","i"));
  assert.match(sql,new RegExp("revoke all on cithela_private\\."+table+" from public,anon,authenticated","i"));
 }
 assert.match(sql,/grant execute on function public\.cithela_health_public_rates\(text,uuid\) to anon,authenticated/);
 assert.match(sql,/grant execute on function public\.cithela_health_rates_admin\(uuid,text,jsonb\) to authenticated/);
 assert.match(sql,/grant execute on function public\.cithela_health_booking_create\(uuid,text,jsonb,uuid,bigint\) to authenticated/);
});
test("reserva reusa rutina de validación original con versión de tarifa y snapshot inmutable",()=>{
 assert.match(sql,/v_rate\.version<>p_rate_version/);
 assert.match(sql,/v_rate\.valid_until/);
 assert.match(sql,/cithela_private\.patient_booking_create\(p_tenant_id,p_request_id,p_payload\)/);
 assert.match(sql,/v_response->>'replayed'/);
 assert.match(sql,/code','selection_conflict'/);
 assert.match(sql,/insert into cithela_private\.cithela_health_booking_selections/);
 assert.match(sql,/v_rate\.price_status,v_rate\.amount_minor/);
 assert.match(sql,/statement_timestamp\(\) at time zone v_timezone/);
});
test("página pública solo muestra coberturas de un tenant habilitado",()=>{
 assert.match(page,/id="health-panel" hidden/);
 assert.match(page,/cithela_health_public_rates/);
 assert.match(page,/const selectedRate=selectedHealthRate\(\)/);
 assert.match(page,/cithela_health_booking_create/);
 assert.match(page,/p_rate_id:selectedRate.id/);
 assert.match(page,/p_rate_version:selectedRate.version/);
 assert.match(page,/cithela_patient_booking_create/);
 assert.match(page,/healthEnabled=result.enabled===true/);
 assert.match(page,/id="health-price" role="status"/);
});
test("recovery de sesión y rol de cuenta a través de Auth/RPC, no de controles del navegador",()=>{
 assert.match(edit,/client\.auth\.getUser\(\)/);
 assert.match(edit,/cithela_health_my_accounts/);
 assert.match(edit,/cithela_health_rates_admin/);
 assert.doesNotMatch(edit,/SUPABASE_SERVICE_ROLE_KEY|service_role|\bfetch\('/);
 assert.match(home,/id="professional-health-settings"[^>]*hidden/);
 assert.match(home,/\['owner','admin'\]\.includes\(role\)/);
 assert.match(home,/\['requested','pilot','active'\]\.includes\(module\?\.state\)/);
});
test("los importes se presentan como referencia, no como autorización ni cobro",()=>{
 assert.match(page,/coverageWarning:'Valor orientativo/);
 assert.match(edit,/no representan una afiliación validada ni un cobro/);
 assert.match(edit,/No ingreses números de afiliación, diagnósticos ni documentación médica/);
 assert.match(sql,/No se confía en un importe enviado por el navegador/);
 assert.doesNotMatch(edit,/mercadopago\.com|paypal\.com|navigator\.share/);
});

test('la selección sanitaria exige consentimiento y registra fecha, no diagnósticos',()=>{
 const addition=repo('supabase/cithela_health_consent_20261117.sql');
 assert.match(addition,/coverage_consent' is distinct from 'true'::jsonb/);
 assert.match(addition,/add column consent_at timestamptz/);
 assert.match(addition,/cithela_health_booking_consent_required/);
 assert.match(page,/id="health-consent" type="checkbox"/);
 assert.match(page,/coverage_consent:true/);
});
