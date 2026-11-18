import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
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

test("módulos en prueba que vencen generan avisos distintos de los vencimientos de cuenta",async()=>{
 const html=read("comercial-admin.html");
 const start=html.indexOf("function renderExpiryNotices(){");
 const end=html.indexOf("async function saveSelectedModule(){",start);
 assert.ok(start>0&&end>start,"la consola debe declarar los avisos antes de guardar");
 const source=html.slice(start,end);
 const copied=[];
 const elements={
  "expiry-list":{children:[],replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}},
  "expiry-empty":{hidden:false}
 };
 const document={
  createElement(tag){
   return {tag,children:[],className:"",textContent:"",
    handlers:{},append(...nodes){this.children.push(...nodes)},
    addEventListener(name,handler){this.handlers[name]=handler}};
  }
 };
 const moduleSnapshot={
  accounts:[{tenant_id:"clinic-pilot",name:"Consultorio ficticio",access_status:"complimentary",
    expires_at:new Date(Date.now()+50*86400000).toISOString()}],
  catalog:[{code:"salud",label:"Coberturas de salud"}],
  grants:[{tenant_id:"clinic-pilot",code:"salud",state:"pilot",
    expires_at:new Date(Date.now()+4*86400000).toISOString()}]
 };
 runInNewContext(source+"\nrenderExpiryNotices();",{
  moduleSnapshot,document,$:id=>elements[id],packageSay:()=>{},
  navigator:{clipboard:{writeText:async text=>copied.push(text)}},
  formatDay:x=>x.slice(0,10),Date,Map
 });
 assert.equal(elements["expiry-empty"].hidden,true);
 assert.equal(elements["expiry-list"].children.length,1,
   "una prueba de salud debe advertirse, aunque la cuenta siga vigente");
 const row=elements["expiry-list"].children[0];
 assert.match(row.children[0].textContent,/Módulo/);
 assert.match(row.children[1].textContent,/Coberturas de salud/);
 await row.children[2].handlers.click();
 assert.match(copied[0],/piloto del módulo Coberturas de salud/);
 assert.match(copied[0],/agenda y los datos existentes no se eliminan/);
});
test("una tarifa nueva no presupone precio gratuito",()=>{
 const html=read("configurar-coberturas.html");
 assert.match(html,/id="amount"[^>]*placeholder="Ej\. 8500,00" autocomplete="off"/);
 assert.match(html,/\$\('amount'\)\.value='';\$\('valid-until'\)\.value='';/);
 assert.match(html,/Ingresá un importe válido sin separadores de miles/);
});
