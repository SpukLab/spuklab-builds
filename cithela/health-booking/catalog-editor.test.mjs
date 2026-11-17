import test from "node:test";
import assert from "node:assert/strict";
import {createDemoEditor,moneyToMinor} from "./catalog-editor.mjs";
import {sampleTenants,sampleProviders,sampleRules} from "./sample-data.mjs";

const make=(tenantId="dental_demo",role="owner")=>createDemoEditor({
  tenantId,role,tenants:sampleTenants,providers:sampleProviders,rules:sampleRules
});
const form={tenantId:"dental_demo",serviceId:"control",kind:"obra_social",
  providerId:"entidad_a",planId:"basico",amountMinor:900000,status:"orientativo",validUntil:"2027-12-31"};
test("administra tarifas por servicio, entidad y plan",()=>{
  const m=make();const before=m.list().length;
  const saved=m.save(form);
  assert.equal(saved.active,true);
  assert.equal(saved.version,1);
  assert.equal(m.list().length,before+1);
  assert.equal(m.preview({serviceId:"control",kind:"obra_social",providerId:"entidad_a",planId:"basico"}).amountMinor,900000);
});
test("propietario puede modificar y archivar con revisión optimista",()=>{
  const m=make(); const saved=m.save(form);
  const updated=m.save({...form,id:saved.id,expectedVersion:saved.version,amountMinor:600000});
  assert.equal(updated.version,2);
  assert.equal(m.preview({serviceId:"control",kind:"obra_social",providerId:"entidad_a",planId:"basico"}).amountMinor,600000);
  assert.throws(()=>m.archive(saved.id,saved.version),/Otro cambio/);
  const closed=m.archive(updated.id,updated.version);
  assert.equal(closed.active,false);
  assert.equal(m.preview({serviceId:"control",kind:"obra_social",providerId:"entidad_a",planId:"basico"}).amountMinor,null);
});
test("múltiples tarifas activas para misma combinación se rechazan",()=>{
  const m=make();
  assert.throws(()=>m.save({...form,serviceId:"consulta"}),/Ya existe/);
});
test("no permite permisos de operador para crear o archivar",()=>{
  const m=make("dental_demo","operator");
  assert.equal(m.canEdit,false);
  assert.throws(()=>m.save(form),/propietarios y administradores/);
  assert.throws(()=>m.archive(m.list()[0].id,1),/propietarios y administradores/);
});
test("un establecimiento no puede editar tarifas de otro",()=>{
  const m=make("med_demo","admin");
  assert.throws(()=>m.save(form),/otro establecimiento/);
  const saved=m.save({...form,tenantId:"med_demo",serviceId:"control"});
  assert.equal(saved.tenantId,"med_demo");
  assert.equal(m.list().every(x=>x.tenantId==="med_demo"),true);
  assert.throws(()=>m.archive("seed_999",1),/inexistente/);
  assert.equal(m.list().every(x=>x.tenantId==="med_demo"),true);
});
test("el administrador requiere servicio vigente, entidad y plan compatibles",()=>{
  const m=make();
  assert.throws(()=>m.save({...form,serviceId:"consulta_otro"}),/no pertenece/);
  assert.throws(()=>m.save({...form,providerId:"entidad_b"}),/Entidad o plan/);
  assert.throws(()=>m.save({...form,planId:"fake"}),/Entidad o plan/);
});
test("no permite un precio no confirmado",()=>{
  const m=make();
  const r=m.save({...form,status:"a_confirmar",amountMinor:900000});
  assert.equal(r.amountMinor,null);
  assert.equal(m.preview({serviceId:"control",kind:"obra_social",providerId:"entidad_a",planId:"basico"}).state,"contact");
});
test("evita sobrescritura de tarifa ajena y carrera de edición",()=>{
  const m=make();
  assert.throws(()=>m.save({...form,id:"rate_from_other_tenant",expectedVersion:1}),/no existe/);
  const old=m.list()[0];
  assert.throws(()=>m.save({...old,expectedVersion:12345}),/Otro cambio/);
});
test("dinero argentino: centavos exactos, sin miles ni conversiones silenciosas",()=>{
  assert.equal(moneyToMinor("12500"),1250000);
  assert.equal(moneyToMinor("0,50"),50);
  assert.equal(moneyToMinor("12500.25"),1250025);
  assert.equal(moneyToMinor("0"),0);
  for(const invalid of ["12.000,50","1e3","-50","0,123","","250.000","1000000000"]){
    assert.throws(()=>moneyToMinor(invalid));
  }
});
test("la simulación no altera los datos de muestra usados por la reserva",()=>{
  const m=make(); const n=sampleRules.length;
  m.save(form);
  assert.equal(sampleRules.length,n);
  assert.equal(sampleRules.some(r=>r.serviceId==="control"&&r.kind==="obra_social"),false);
});
