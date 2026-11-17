import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("./comercial-admin.html",import.meta.url),"utf8");

test("administración ofrece navegación accesible a módulos existentes",()=>{
  assert.match(html,/<nav class="console-nav" aria-label="Secciones de administración">/);
  for(const id of ["cuentas","selfservice-controls","pricing-controls","courtesy-controls","retention-controls","mp-diagnostics"]){
    assert.match(html,new RegExp('href="#'+id+'"'));
    assert.match(html,new RegExp('id="'+id+'"'));
  }
});

test("autoservicio está próximo a cuentas y conserva sus formularios y permisos",()=>{
  assert.ok(html.indexOf('id="cuentas"')<html.indexOf('id="selfservice-controls"'));
  assert.ok(html.indexOf('id="selfservice-controls"')<html.indexOf('id="booking-admin"'));
  for(const token of ['name="enabled"','name="daily_limit"','name="active_limit"','id="selfservice-test-form"']){
    assert.ok(html.includes(token),token);
  }
  assert.match(html,/Agenda → Mis reservas online/);
  assert.match(html,/Herramienta de soporte excepcional/);
});

test("sin modificaciones a acciones administrativas de servidor",()=>{
  for(const id of ["select-price","grant-free","revoke-free","reload","booking-copy","mp-test-check","retry"]){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.doesNotMatch(html,/delete\s+from\s+cithela_/i);
});
