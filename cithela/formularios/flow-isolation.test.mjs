import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./flow-preview.html',import.meta.url),'utf8');
const js=readFileSync(new URL('./flow-preview.mjs',import.meta.url),'utf8');
const model=readFileSync(new URL('./flow-model.mjs',import.meta.url),'utf8');
const unified=readFileSync(new URL('./unified-profile-model.mjs',import.meta.url),'utf8');

test('advertencia explícita: no usar datos personales ni clínicos',()=>{
  assert.match(html,/Solo una demostración/);
  assert.match(html,/No ingreses datos personales o médicos reales/);
  assert.match(html,/no guarda respuestas/);
});
test('sin acceso a cuenta, red, pagos ni almacenamiento persistente',()=>{
  for(const content of [html,js,model,unified]){
    assert.doesNotMatch(content,/\bfetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|localStorage|sessionStorage|indexedDB|service_role|createClient\s*\(|\.rpc\s*\(/i);
    assert.doesNotMatch(content,/https?:\/\//i);
  }
});
test('sin interpolaciones inseguras de respuestas en HTML',()=>{
  assert.match(js,/textContent/);
  assert.doesNotMatch(js,/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
test('tres pestañas y tres vistas conectadas al modelo puro',()=>{
  for(const key of ['profesional','cliente','ficha']){
    assert.match(html,new RegExp('id="tab-'+key+'"'));
    assert.match(html,new RegExp('id="panel-'+key+'"'));
  }
  assert.match(js,/createFormRequest/);
  assert.match(js,/viewRequestForPerson/);
  assert.match(js,/submitFormRequest/);
  assert.match(js,/buildUnifiedProfile/);
  assert.match(unified,/viewSubmittedForStaff/);
});
test('sin identificadores o datos reales del negocio',()=>{
  assert.match(js,/persona-demo-01/);
  assert.match(js,/turno-demo-01/);
  assert.doesNotMatch(js,/auth\.users|patient_links|cithela_people/i);
});
