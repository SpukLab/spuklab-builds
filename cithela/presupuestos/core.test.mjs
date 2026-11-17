import test from "node:test";
import assert from "node:assert/strict";
import {pesosToMinor,moneyARS,makeLine,calculateQuote,transitionStatus,whatsappSummary} from "./core.mjs";

test("ARS sin errores de punto flotante",()=>{
  assert.equal(pesosToMinor("1000,05"),100005);
  assert.equal(pesosToMinor("0.10"),10);
  assert.match(moneyARS(100005), /1.000,05/);
});
test("no admite cifras negativas, importes con formato ambiguo ni exponentes",()=>{
  for(const v of ["-10","1.000,00","1e5","10.999","", "NaN"]) assert.throws(()=>pesosToMinor(v));
});
test("total de varios servicios y descuento",()=>{
  const quote=calculateQuote([
    makeLine({name:"Limpieza",unitMinor:3500000,quantity:1}),
    makeLine({name:"Restauración",unitMinor:3000000,quantity:2})
  ],500000);
  assert.equal(quote.subtotalMinor,9500000);
  assert.equal(quote.totalMinor,9000000);
  assert.equal(quote.lines[1].totalMinor,6000000);
});
test("no admite presupuesto vacío, cantidades inválidas ni descuento excesivo",()=>{
  assert.throws(()=>calculateQuote([]));
  assert.throws(()=>makeLine({name:"Servicio",unitMinor:100,quantity:0}));
  assert.throws(()=>calculateQuote([makeLine({name:"Servicio",unitMinor:100})],101));
});
test("snapshot de precios y mensaje supervisado",()=>{
  const line=makeLine({name:"Tratamiento",unitMinor:150000});
  const quote=calculateQuote([line]);
  assert.ok(Object.isFrozen(quote.lines[0]));
  const msg=whatsappSummary({professional:"Consultorio demo",patient:"Paciente ficticio",reference:"DEMO-001",validity:"7 días",quote});
  assert.match(msg,/DEMO-001/);
  assert.match(msg,/confirmación profesional/);
});
test("aceptación solo desde enviado; estados terminales",()=>{
  assert.equal(transitionStatus("borrador","enviado"),"enviado");
  assert.equal(transitionStatus("enviado","aceptado"),"aceptado");
  assert.throws(()=>transitionStatus("borrador","aceptado"));
  assert.throws(()=>transitionStatus("aceptado","enviado"));
});
