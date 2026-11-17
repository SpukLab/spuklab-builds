import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handleCithelaCommercialAdmin} from "./commercial-admin-handler.mjs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const admin="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function request(action,payload={},token="real"){
 return new Request("https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-commercial-admin",{
  method:"POST",headers:{"origin":"https://spuklab.github.io","authorization":"Bearer "+token},
  body:JSON.stringify({action,payload})
 });
}
const setup=(id=admin)=>({enabled:true,adminId:admin,
  resolveUser:async()=>({id,emailConfirmed:true}),
  execute:async(_id,action,payload)=>({ok:true,code:action==="modules_read"?"modules_snapshot":"module_saved",action,payload})});
test("rechaza módulo consultado por persona no administradora",async()=>{
 const resp=await handleCithelaCommercialAdmin(request("modules_read"),setup(user));
 assert.equal(resp.status,403);
 const body=await resp.json();assert.equal(body.code,"not_platform_admin");
});
test("rechaza payload ajeno y campos inesperados",async()=>{
 const resp=await handleCithelaCommercialAdmin(request("modules_set",{tenant_id:"x",inject:"sql"}),setup());
 assert.equal(resp.status,400);
 const obj=await resp.json();assert.equal(obj.code,"unexpected_field");
});
test("lectura y escritura se delegan al servidor, no al navegador",async()=>{
 const readResp=await handleCithelaCommercialAdmin(request("modules_read",{}),setup());
 assert.equal(readResp.status,200);
 const writeResp=await handleCithelaCommercialAdmin(request("modules_set",{
  tenant_id:admin,code:"salud",state:"requested",expires_at:null,
  quoted_minor:null,quoted_currency:null,note:"Sin habilitar",expected_version:0
 }),setup());
 assert.equal(writeResp.status,200);
 const value=await writeResp.json();assert.equal(value.action,"modules_set");
});
test("los cambios de paquetes no permiten pagos, contraseñas ni datos de pacientes",async()=>{
 for(const field of ["service_role","patient_id","diagnosis","card_number","paypal","charge_now","owner_user_id"]){
  const r=await handleCithelaCommercialAdmin(request("modules_set",{[field]:"test"}),setup());
  assert.equal(r.status,400,field);
 }
});
test("nueva estructura contiene RLS y acceso solo servidor para escritura",()=>{
 const sql=read("supabase/cithela_account_packages_20261117.sql");
 assert.match(sql,/alter table cithela_private\.cithela_tenant_package_access enable row level security/);
 assert.match(sql,/revoke all on function public\.cithela_package_admin_command\(uuid,text,jsonb\)/);
 assert.match(sql,/grant execute on function public\.cithela_package_admin_command\(uuid,text,jsonb\)\s+to service_role/);
 assert.match(sql,/v_state in \('pilot','active'\) and v_ready is distinct from true/);
 assert.match(sql,/version=version\+1/);
 assert.doesNotMatch(sql,/\bdelete\s+from\b|\bdrop\s+table\b/i);
});
test("el profesional solo puede consultar módulos de su propio establecimiento",()=>{
 const sql=read("supabase/cithela_account_packages_20261117.sql");
 assert.match(sql,/m\.tenant_id=p_tenant_id and m\.user_id=v_actor/);
 assert.match(sql,/commercial_entitlement_snapshot\(p_tenant_id\)/);
 assert.match(sql,/grant execute on function public\.cithela_professional_packages\(uuid\) to authenticated/);
});
test("la consola separa tarifas contractuales de pacientes y no envía WhatsApp",()=>{
 const html=read("comercial-admin.html");
 assert.match(html,/id="package-controls"/);
 assert.match(html,/id="expiry-notices"/);
 assert.match(html,/id="package-currency"/);
 assert.match(html,/id="package-amount"/);
 assert.match(html,/id="package-save"/);
 assert.match(html,/Copiar aviso para WhatsApp/);
 assert.match(html,/navigator\.clipboard\.writeText/);
 assert.doesNotMatch(html,/https:\/\/api\.whatsapp\.com\/send|whatsapp\.sendMessage/);
});
test("enrutado de Edge conduce módulos solo al RPC separado",()=>{
 const code=read("edge/cithela-commercial-admin/index.ts");
 assert.match(code,/modules=\['modules_read','modules_set'\]\.includes\(action\)/);
 assert.match(code,/cithela_package_admin_command/);
});
