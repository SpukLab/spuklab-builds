import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("./admin.html",import.meta.url),"utf8");

test("configuración muestra servicios, convenio, planes y vigencia",()=>{
  for(const id of ["tenant","role","service","kind","provider","plan","status","amount","valid-until",
    "list","save","new","archive","restore","preview-price","preview-warning"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/CONFIGURACIÓN \/ SERVICIOS \/ PRECIOS Y COBERTURAS/);
  assert.match(html,/createDemoEditor/);
  assert.match(html,/moneyToMinor/);
});
test("los roles simulados son claros y el operador no puede guardar",()=>{
  assert.match(html,/<option value="operator">Operador \(lectura\)<\/option>/);
  assert.match(html,/const editable=!!store\?\.canEdit/);
  assert.match(html,/\$\("save"\)/);
  assert.match(html,/store\.archive/);
  assert.match(html,/store\.changeActivity/);
});
test("la demo se declara sin datos reales ni persistencia",()=>{
  assert.match(html,/datos son ficticios/);
  assert.match(html,/simulación no guarda en la nube/);
  assert.doesNotMatch(html,/supabase|service_role|localStorage|fetch\(|XMLHttpRequest|navigator\.sendBeacon/i);
  assert.doesNotMatch(html,/<input[^>]*type="(?:email|tel|file)"/i);
});
