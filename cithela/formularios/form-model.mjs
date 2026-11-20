// CITHELA · formularios multirrubro (v1) — lógica pura, sin I/O ni persistencia.
// La autorización real deberá implementarse en Supabase antes de habilitar usuarios.
export const FIELD_TYPES = Object.freeze(['text', 'textarea', 'select', 'checkbox']);
export const MAX_FIELDS = 15;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function requiredString(value, max = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) fail('invalid_text');
  return result;
}
function requireEditor(role) {
  if (!['owner', 'admin'].includes(role)) fail('forbidden');
}
function ensureTenant(form, tenantId) {
  if (!form || !tenantId || form.tenantId !== tenantId) fail('tenant_mismatch');
}

export function createDraft({ id, tenantId, serviceId, title, role }) {
  requireEditor(role);
  return {
    id: requiredString(id, 80),
    tenantId: requiredString(tenantId, 80),
    serviceId: requiredString(serviceId, 80),
    title: requiredString(title, 120),
    status: 'draft',
    version: 1,
    fields: []
  };
}

export function makeField({ id, label, type = 'text', required = false, options = [] }) {
  if (!FIELD_TYPES.includes(type)) fail('invalid_field_type');
  if (typeof required !== 'boolean') fail('invalid_required');
  const safeId = requiredString(id, 64);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(safeId)) fail('invalid_field_id');
  if (!Array.isArray(options)) fail('invalid_options');
  const normalized = {
    id: safeId,
    label: requiredString(label, 120),
    type,
    required,
    options: []
  };
  if (type === 'select') {
    if (!Array.isArray(options) || options.length < 2 || options.length > 12) fail('invalid_options');
    normalized.options = options.map(option => requiredString(option, 80));
    if (new Set(normalized.options.map(o => o.toLowerCase())).size !== normalized.options.length) fail('duplicate_options');
  } else if (options.length) fail('unexpected_options');
  return normalized;
}

export function addField(form, field, { tenantId, role }) {
  requireEditor(role);
  ensureTenant(form, tenantId);
  if (form.status !== 'draft') fail('published_is_immutable');
  if (form.fields.length >= MAX_FIELDS) fail('field_limit');
  const normalized = makeField(field);
  if (form.fields.some(existing => existing.id === normalized.id)) fail('duplicate_field');
  return { ...form, version: form.version + 1, fields: [...form.fields, normalized] };
}

export function removeField(form, fieldId, { tenantId, role }) {
  requireEditor(role);
  ensureTenant(form, tenantId);
  if (form.status !== 'draft') fail('published_is_immutable');
  if (!form.fields.some(field => field.id === fieldId)) fail('field_not_found');
  return { ...form, version: form.version + 1, fields: form.fields.filter(field => field.id !== fieldId) };
}

export function publishForm(form, { tenantId, role, expectedVersion }) {
  requireEditor(role);
  ensureTenant(form, tenantId);
  if (form.status !== 'draft') fail('already_published');
  if (!form.fields.length) fail('empty_form');
  if (form.version !== expectedVersion) fail('stale_write');
  return { ...form, status: 'published', version: form.version + 1 };
}

export function listFormsForService(forms, { tenantId, serviceId }) {
  return forms.filter(form => form.tenantId === tenantId && form.serviceId === serviceId);
}

// Solo para maquetar el circuito de envío. No sustituye verificación de identidad,
// consentimiento, backend, políticas RLS ni control de acceso a respuestas.
export function validateAnswers(form, answers) {
  if (form?.status !== 'published') return { ok: false, errors: { _form: 'not_published' }, values: {} };
  const values = {}, errors = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { ok: false, errors: { _form: 'invalid_answers' }, values };
  const known = new Set(form.fields.map(f => f.id));
  if (Object.keys(answers).some(key => !known.has(key))) return { ok: false, errors: { _form: 'unknown_field' }, values };
  for (const field of form.fields) {
    const raw = answers[field.id];
    if (field.type === 'checkbox') {
      if (raw !== undefined && typeof raw !== 'boolean') { errors[field.id] = 'invalid_type'; continue; }
      values[field.id] = raw === true;
      if (field.required && !values[field.id]) errors[field.id] = 'required';
    } else {
      if (raw !== undefined && typeof raw !== 'string') { errors[field.id] = 'invalid_type'; continue; }
      const value = String(raw ?? '').trim();
      if (value.length > (field.type === 'textarea' ? 1200 : 200)) { errors[field.id] = 'too_long'; continue; }
      if (field.required && !value) errors[field.id] = 'required';
      if (field.type === 'select' && value && !field.options.includes(value)) errors[field.id] = 'invalid_option';
      values[field.id] = value;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

export function simulateSubmission({ form, tenantId, serviceId, personId, answers }) {
  ensureTenant(form, tenantId);
  if (form.serviceId !== serviceId) fail('service_mismatch');
  const verified = validateAnswers(form, answers);
  if (!verified.ok) return { ok: false, errors: verified.errors };
  return {
    ok: true,
    previewOnly: true,
    // En este prototipo no se transmite ni almacena la respuesta.
    summary: {
      formId: form.id,
      version: form.version,
      tenantId,
      serviceId,
      personId: requiredString(personId, 80),
      answerCount: Object.keys(verified.values).length
    }
  };
}
