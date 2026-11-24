import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
test("demo interactiva, selección de servicio, obra social, entidad y plan",()=>{
  for(const id of ["profile","service","kind","provider","plan","price","warning","request","result-panel"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/resolveConsultationRate/);
  assert.match(html,/availableServices/);
});
test("página no solicita información personal ni presenta botón para cobrar",()=>{
  assert.match(html,/Demostración sin datos reales/);
  assert.match(html,/no realiza una reserva ni envía información al servidor/);
  assert.doesNotMatch(html,/<input[^>]*type="(?:email|tel|file)"/i);
  assert.doesNotMatch(html,/supabase|service_role|Mercado Pago|PayPal|fetch\(/i);
});
test("el producto vigente no se altera en este prototipo",()=>{
  assert.match(html,/Prototipo para odontología, medicina y psicología/);
  assert.match(html,/Sin verificación de afiliación ni cobros automáticos/);
});
