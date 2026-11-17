import test from "node:test";
import assert from "node:assert/strict";
import {normalizeDentalCoverage,dentalPaymentBreakdown,dentalCoverageNote} from "./odontologia.mjs";
const base={kind:"obra_social",provider:"Obra social ficticia",plan:"A",status:"pendiente"};
test("particular sin cobertura reconocida y sin datos residuales",()=>{
  const b=dentalPaymentBreakdown(3500000,{kind:"particular",provider:"X",coveredMinor:3500000});
  assert.equal(b.patientMinor,3500000);
  assert.equal(b.coverage.provider,"");
  assert.equal(b.coveredMinor,null);
});
test("obra social pendiente no calcula copago ni confunde precio con cobertura",()=>{
  const b=dentalPaymentBreakdown(3500000,base);
  assert.equal(b.patientMinor,null);
  assert.equal(b.coveredMinor,null);
  assert.match(dentalCoverageNote(3500000,base,n=>String(n)),/no está confirmado/);
});
test("solo la autorización asentada manualmente habilita una diferencia estimada",()=>{
  const b=dentalPaymentBreakdown(3500000,{...base,status:"autorizada",coveredMinor:2000000});
  assert.equal(b.patientMinor,1500000);
  assert.equal(b.coveredMinor,2000000);
  assert.match(dentalCoverageNote(3500000,b.coverage,n=>String(n)),/registrada manualmente/);
});
test("rechaza importes indebidos, planes o nombres malformados",()=>{
  assert.throws(()=>normalizeDentalCoverage({...base,status:"pendiente",coveredMinor:500},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,status:"autorizada",coveredMinor:1100},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,status:"autorizada",coveredMinor:-1},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,status:"autorizada",coveredMinor:12.1},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,provider:"X"},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,plan:"X".repeat(81)},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,status:"pagada"},1000));
  assert.throws(()=>normalizeDentalCoverage({...base,kind:"seguro"},1000));
});
test("acepta prepaga con monto cero explícito y no adjudica cobertura",()=>{
  const b=dentalPaymentBreakdown(5000,{kind:"prepaga",provider:"Plan ficticio",status:"autorizada",coveredMinor:0});
  assert.equal(b.patientMinor,5000);
});
