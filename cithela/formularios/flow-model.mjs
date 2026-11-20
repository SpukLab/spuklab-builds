// CITHELA · flujo de formularios previo al turno, SOLO DEMOSTRACIÓN EN MEMORIA.
// Requiere backend real: autenticación, RLS/RPC, expiración server-side e idempotencia.
import { validateAnswers } from './form-model.mjs';

const err = code => { const e = new Error(code); e.code = code; throw e; };
const validId = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v);
const copy = v => JSON.parse(JSON.stringify(v));
const strictTime = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
function enforceTenant(record, tenantId) {
  if (!record || !validId(tenantId) || record.tenantId !== tenantId) err('tenant_mismatch');
}
function enforcePerson(request, { tenantId, personId }) {
  enforceTenant(request, tenantId);
  if (!validId(personId) || request.personId !== personId) err('person_mismatch');
}
function enforceStaff(request, { tenantId, role }) {
  enforceTenant(request, tenantId);
  if (!['owner', 'admin', 'operator'].includes(role)) err('forbidden');
}
function ensureClock(now) {
  if (!strictTime(now)) err('invalid_time');
  return Date.parse(now);
}
function asSubmitted(answers) {
  return JSON.stringify(Object.keys(answers).sort().map(id => [id, answers[id]]));
}

export function createFormRequest({
  requestId, form, tenantId, personId, serviceId, appointmentId = null,
  expiresAt, now, actorRole
}) {
  if (!['owner', 'admin', 'operator'].includes(actorRole)) err('forbidden');
  if (!validId(requestId) || !validId(personId) || !validId(serviceId)) err('invalid_id');
  if (appointmentId !== null && !validId(appointmentId)) err('invalid_appointment');
  if (!form || form.tenantId !== tenantId) err('tenant_mismatch');
  if (form.serviceId !== serviceId) err('service_mismatch');
  if (form.status !== 'published' || !Array.isArray(form.fields) || !form.fields.length) err('form_not_published');
  const current = ensureClock(now);
  const expiry = ensureClock(expiresAt);
  if (expiry <= current || expiry > current + 30 * 86400000) err('invalid_expiry');
  return {
    requestId, tenantId, personId, serviceId, appointmentId,
    createdAt: now, expiresAt,
    status: 'pending', revision: 1, submittedAt: null,
    template: copy({ id: form.id, version: form.version, title: form.title, status: 'published', fields: form.fields }),
    answerData: null
  };
}

// La identidad del cliente es ficticia en el prototipo. En producción tiene que
// provenir de auth.uid() y cithela_patient_links, nunca de personId enviado por navegador.
export function viewRequestForPerson(request, { tenantId, personId, now }) {
  enforcePerson(request, { tenantId, personId });
  const current = ensureClock(now);
  const status = request.status === 'pending' && current >= Date.parse(request.expiresAt)
    ? 'expired' : request.status;
  return {
    requestId: request.requestId,
    serviceId: request.serviceId,
    title: request.template.title,
    fields: status === 'pending' ? copy(request.template.fields) : [],
    expiresAt: request.expiresAt,
    status
  };
}

export function submitFormRequest(request, { tenantId, personId, now, expectedRevision, answers }) {
  enforcePerson(request, { tenantId, personId });
  const current = ensureClock(now);
  if (current >= Date.parse(request.expiresAt)) err('expired');
  if (request.status === 'revoked') err('revoked');
  if (request.status === 'submitted') {
    const validated = validateAnswers(request.template, answers);
    if (validated.ok && asSubmitted(validated.values) === asSubmitted(request.answerData)) {
      return { request, replayed: true };
    }
    err('already_submitted');
  }
  if (request.status !== 'pending') err('invalid_status');
  if (!Number.isInteger(expectedRevision) || expectedRevision !== request.revision) err('stale_write');
  const validated = validateAnswers(request.template, answers);
  if (!validated.ok) return { ok: false, errors: validated.errors, request };
  return {
    ok: true,
    replayed: false,
    request: {
      ...request,
      status: 'submitted',
      revision: request.revision + 1,
      submittedAt: now,
      answerData: copy(validated.values)
    }
  };
}
export function revokeFormRequest(request, { tenantId, actorRole, expectedRevision }) {
  enforceStaff(request, { tenantId, role: actorRole });
  if (request.status !== 'pending') err('cannot_revoke');
  if (request.revision !== expectedRevision) err('stale_write');
  return { ...request, status: 'revoked', revision: request.revision + 1 };
}
export function viewSubmittedForStaff(request, { tenantId, actorRole }) {
  enforceStaff(request, { tenantId, role: actorRole });
  if (request.status !== 'submitted') return null;
  // Se devuelve exclusivamente desde la vista autorizada del profesional.
  return {
    requestId: request.requestId,
    personId: request.personId,
    serviceId: request.serviceId,
    appointmentId: request.appointmentId,
    submittedAt: request.submittedAt,
    items: request.template.fields.map(f => ({
      fieldId: f.id, label: f.label, value: request.answerData[f.id]
    }))
  };
}
