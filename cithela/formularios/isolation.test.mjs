import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('./prototype.mjs', import.meta.url), 'utf8');
const model = readFileSync(new URL('./form-model.mjs', import.meta.url), 'utf8');

test('prototipo señala claramente la ausencia de persistencia y datos reales', () => {
  assert.match(html, /Prototipo aislado/);
  assert.match(html, /No conecta con Supabase/);
  assert.match(html, /No ingreses datos personales/);
});
test('la interfaz no llama APIs ni usa almacenamiento persistente', () => {
  for (const source of [js, model]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|\.rpc\s*\(/);
  }
});
test('las respuestas se muestran como texto y no se interpolan en HTML', () => {
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
});
test('vista previa no usa canal paciente real ni carga ficha cloud', () => {
  assert.match(js, /persona-ficticia/);
  assert.doesNotMatch(js, /cithela_people|cithela_patient_links|service_role|anon_key/);
});
