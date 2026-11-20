import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDraft, makeField, addField, removeField, publishForm,
  listFormsForService, validateAnswers, simulateSubmission, MAX_FIELDS
} from './form-model.mjs';

const admin = { tenantId: 'peluqueria-a', role: 'admin' };
const field = (id, type = 'text', required = true, options = []) =>
  ({ id, label: 'Pregunta ' + id, type, required, options });
function draft(tenantId = admin.tenantId) {
  return createDraft({ id: 'f-1', tenantId, serviceId: 'coloracion', title: 'Antes de tu turno', role: 'owner' });
}
function published() {
  let form = draft();
  form = addField(form, field('preferencias'), admin);
  form = addField(form, field('opciones', 'select', true, ['Mañana', 'Tarde']), admin);
  form = addField(form, field('confirmo', 'checkbox'), admin);
  return publishForm(form, { ...admin, expectedVersion: form.version });
}

test('propietario/administrador pueden crear y publicar borradores', () => {
  const form = published();
  assert.equal(form.status, 'published');
  assert.equal(form.fields.length, 3);
});
test('operadores y personas ajenas no editan formularios', () => {
  assert.throws(() => createDraft({ id: 'a', tenantId: 'a', serviceId: 'b', title: 'C', role: 'operator' }), { message: 'forbidden' });
  assert.throws(() => addField(draft(), field('a'), { ...admin, role: 'operator' }), { message: 'forbidden' });
  assert.throws(() => addField(draft(), field('a'), { role: 'owner', tenantId: 'otro' }), { message: 'tenant_mismatch' });
});
test('servicio y establecimiento aíslan listados', () => {
  const forms = [draft(), draft('peluqueria-b'), { ...draft(), serviceId: 'corte' }];
  assert.equal(listFormsForService(forms, { tenantId: 'peluqueria-a', serviceId: 'coloracion' }).length, 1);
  assert.equal(listFormsForService(forms, { tenantId: 'peluqueria-b', serviceId: 'coloracion' }).length, 1);
});
test('no se publica un formulario vacío', () => {
  assert.throws(() => publishForm(draft(), { ...admin, expectedVersion: 1 }), { message: 'empty_form' });
});
test('se rechazan cambios de una versión desactualizada', () => {
  const form = addField(draft(), field('a'), admin);
  assert.throws(() => publishForm(form, { ...admin, expectedVersion: 1 }), { message: 'stale_write' });
});
test('no se modifica un formulario publicado', () => {
  assert.throws(() => addField(published(), field('otra'), admin), { message: 'published_is_immutable' });
});
test('el borrador permite quitar campos, pero no inventados', () => {
  const form = addField(draft(), field('a'), admin);
  const after = removeField(form, 'a', admin);
  assert.equal(after.fields.length, 0);
  assert.throws(() => removeField(after, 'a', admin), { message: 'field_not_found' });
});
test('identificadores duplicados y límite de campos', () => {
  let form = addField(draft(), field('a'), admin);
  assert.throws(() => addField(form, field('a'), admin), { message: 'duplicate_field' });
  for (let i = 1; i < MAX_FIELDS; i++) form = addField(form, field('f-' + i), admin);
  assert.throws(() => addField(form, field('extra'), admin), { message: 'field_limit' });
});
test('opciones de selección deben ser únicas y válidas', () => {
  assert.throws(() => makeField(field('a', 'select', true, ['Si', 'si'])), { message: 'duplicate_options' });
  assert.throws(() => makeField(field('a', 'select', true, ['Única'])), { message: 'invalid_options' });
  assert.throws(() => makeField(field('a', 'text', false, ['No permitido'])), { message: 'unexpected_options' });
});
test('campos obligatorios y selección inválida se rechazan', () => {
  const form = published();
  assert.equal(validateAnswers(form, {}).errors.preferencias, 'required');
  assert.equal(validateAnswers(form, { preferencias: 'Hola', opciones: 'Noche', confirmo: true }).errors.opciones, 'invalid_option');
  assert.equal(validateAnswers(form, { preferencias: 'Hola', opciones: 'Tarde', confirmo: false }).errors.confirmo, 'required');
});
test('rechaza campos extra, objetos y respuestas excesivas', () => {
  const form = published();
  assert.equal(validateAnswers(form, { arbitrario: 'x' }).errors._form, 'unknown_field');
  assert.equal(validateAnswers(form, { preferencias: {}, opciones: 'Mañana', confirmo: true }).errors.preferencias, 'invalid_type');
  assert.equal(validateAnswers(form, { preferencias: 'a'.repeat(201), opciones: 'Mañana', confirmo: true }).errors.preferencias, 'too_long');
});
test('respuestas válidas producen un resumen sin contenido personal', () => {
  const form = published();
  const out = simulateSubmission({
    form, tenantId: 'peluqueria-a', serviceId: 'coloracion',
    personId: 'persona-ficticia', answers: { preferencias: 'Sin perfume', opciones: 'Mañana', confirmo: true }
  });
  assert.equal(out.ok, true);
  assert.equal(out.previewOnly, true);
  assert.equal(out.summary.answerCount, 3);
  assert.doesNotMatch(JSON.stringify(out), /Sin perfume/);
});
test('no simula envío a un servicio o establecimiento distinto', () => {
  const form = published();
  assert.throws(() => simulateSubmission({ form, tenantId: 'otro', serviceId: 'coloracion', personId: 'p', answers: {} }), { message: 'tenant_mismatch' });
  assert.throws(() => simulateSubmission({ form, tenantId: 'peluqueria-a', serviceId: 'corte', personId: 'p', answers: {} }), { message: 'service_mismatch' });
});
test('un borrador nunca admite respuestas', () => {
  assert.equal(validateAnswers(draft(), {}).errors._form, 'not_published');
});
