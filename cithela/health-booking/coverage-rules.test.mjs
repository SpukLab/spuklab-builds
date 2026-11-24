import test from "node:test";
import assert from "node:assert/strict";
import {resolveConsultationRate,validateRate,availableServices} from "./coverage-rules.mjs";
import {sampleTenants,sampleRules} from "./sample-data.mjs";
const req={tenantId:"dental_demo",serviceId:"consulta",rules:sampleRules,today:"2026-11-17"};
test("precio particular es orientativo y no equivale a prepaga",()=>{
  const r=resolveConsultationRate(req);
  assert.equal(r.state,"estimated");
  assert.equal(r.amountMinor,3000000);
  assert.match(r.label,/Precio particular de referencia/);
});
test("obra social y plan exactos: importe orientativo y verificación requerida",()=>{
  const r=resolveConsultationRate({...req,kind:"obra_social",providerId:"entidad_a",planId:"basico"});
  assert.equal(r.amountMinor,600000);
  assert.match(r.warning,/verificación/);
  assert.doesNotMatch(r.warning,/garantiza cobertura\./);
});
test("ninguna tarifa por falta de coincidencia, sin heredar particular",()=>{
  const r=resolveConsultationRate({...req,kind:"prepaga",providerId:"entidad_b",planId:"principal"});
  assert.equal(r.amountMinor,null);
  assert.equal(r.state,"contact");
});
test("plan o entidad ausente: solicitar selección, sin precio",()=>{
  const r=resolveConsultationRate({...req,kind:"obra_social"});
  assert.equal(r.state,"requires_selection");
  assert.equal(r.amountMinor,null);
});
test("estado a confirmar no muestra monto aun con plan",()=>{
  const r=resolveConsultationRate({...req,kind:"obra_social",providerId:"entidad_a",planId:"plus"});
  assert.equal(r.state,"contact");
});
test("tarifa vencida o desactivada no se divulga",()=>{
  const r=resolveConsultationRate({...req,today:"2028-01-01",kind:"obra_social",providerId:"entidad_a",planId:"basico"});
  assert.equal(r.amountMinor,null);
  const disabled=resolveConsultationRate({...req,rules:sampleRules.map(x=>({...x,active:false}))});
  assert.equal(disabled.amountMinor,null);
});
test("un mismo plan y servicio de otro consultorio no comparte tarifa",()=>{
  const r=resolveConsultationRate({...req,tenantId:"psych_demo",kind:"obra_social",providerId:"entidad_a",planId:"basico"});
  assert.equal(r.amountMinor,null);
  assert.equal(r.state,"contact");
});
test("tarifas duplicadas se cierran sin dar precio arbitrario",()=>{
  const r=resolveConsultationRate({...req,rules:[...sampleRules,sampleRules[0]]});
  assert.equal(r.amountMinor,null);
});
test("importes inválidos, tipos extraños y asociación contaminada se rechazan",()=>{
  assert.throws(()=>validateRate({...sampleRules[0],amountMinor:-1}));
  assert.throws(()=>validateRate({...sampleRules[0],amountMinor:1.5}));
  assert.throws(()=>validateRate({...sampleRules[0],kind:"obra_social"}));
  assert.throws(()=>validateRate({...sampleRules[1],status:"a_confirmar"}));
  assert.throws(()=>resolveConsultationRate({...req,tenantId:"../demo"}));
});
test("servicios no aparecen en otros tenants",()=>{
  const s=availableServices(sampleTenants[0]);
  assert.equal(s.length,2);
  assert.ok(s.every(v=>v.tenantId==="dental_demo"));
  assert.throws(()=>availableServices({...sampleTenants[0],profile:"no_seguro"}));
});
test("precio cero requiere configuración; nunca inferir gratuidad",()=>{
  const rule={...sampleRules[0],amountMinor:0};
  const r=resolveConsultationRate({...req,rules:[rule]});
  assert.equal(r.amountMinor,0);
  assert.match(r.warning,/confirmar/);
});

test("no admitir vigencias inventadas ni calendarios ambiguos",()=>{
  assert.throws(()=>validateRate({...sampleRules[0],validUntil:"2026-02-31"}),/Fecha de convenio/);
  assert.throws(()=>validateRate({...sampleRules[0],validUntil:"2027-02-29"}),/Fecha de convenio/);
  assert.throws(()=>resolveConsultationRate({...req,today:"2026-02-30"}),/Selección inválida/);
  assert.equal(validateRate({...sampleRules[0],validUntil:"2028-02-29"}).validUntil,"2028-02-29");
});
test("agenda de salud respeta intervalos de 15 minutos",()=>{
  const t={...sampleTenants[0],services:[
    ...sampleTenants[0].services,
    {id:"invalid20",tenantId:"dental_demo",name:"Duración incompatible",durationMin:20,active:true}
  ]};
  assert.equal(availableServices(t).length,2);
});
