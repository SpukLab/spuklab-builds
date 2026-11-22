// CITHELA · modelo de lectura para una ficha unificada, SOLO datos ficticios.
// Reutiliza los campos existentes de persona/turnos y el flujo de formularios demo.
// En producción la autorización debe hacerse en SQL/RPC, nunca en este JS.
import { viewSubmittedForStaff } from './flow-model.mjs';
const failure = code => { const error = new Error(code); error.code = code; throw error; };
const clone = value => JSON.parse(JSON.stringify(value));
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const apptStates = Object.freeze({
  pending: 'Pendiente', confirmed: 'Confirmado', cancelled: 'Cancelado',
  attended: 'Atendido', no_show: 'Ausente'
});
const reqStates = Object.freeze({
  pending: 'Pendiente de respuesta', submitted: 'Respondido', revoked: 'Revocado',
  expired: 'Vencido'
});

/**
 * El caller debe proveer registros previamente autorizados del mismo tenant.
 * Nunca utilizar este filtro frontend como defensa para datos personales reales.
 */
export function buildUnifiedProfile({ tenantId, person, appointments = [], requests = [], actorRole = 'owner', now }) {
  if (!tenantId || !person || person.tenantId !== tenantId) failure('tenant_mismatch');
  if (!person.id || !validDate(now)) failure('invalid_context');
  if (!['owner', 'admin', 'operator', 'viewer'].includes(actorRole)) failure('forbidden');
  if (!Array.isArray(appointments) || !Array.isArray(requests)) failure('invalid_data');
  const currentTime = Date.parse(now);
  const personAppointments = appointments
    .filter(a => a.tenantId === tenantId && a.personId === person.id)
    .filter(a => validDate(a.startsAt))
    .map(a => ({
      id: String(a.id),
      serviceId: a.serviceId ?? null,
      startsAt: a.startsAt,
      status: apptStates[a.status] || 'Sin estado',
      statusCode: a.status,
      service: String(a.service || 'Servicio sin nombre'),
      professional: String(a.professional || 'Sin profesional')
    }))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const future = personAppointments
    .filter(a => Date.parse(a.startsAt) >= currentTime && ['pending', 'confirmed'].includes(a.statusCode))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const history = personAppointments
    .filter(a => !future.some(f => f.id === a.id));

  // La vista pública NO incluye información interna. En esta demo, el viewer
  // ve únicamente datos administrativos (no respuestas).
  const canSeeAnswers = ['owner', 'admin'].includes(actorRole);
  const forms = requests
    .filter(r => r.tenantId === tenantId && r.personId === person.id)
    .map(r => {
      // Un formulario NO puede mostrar una respuesta bajo un turno ajeno
      // o de un servicio diferente, aunque el caller mezcle fixtures.
      const appointment = r.appointmentId
        ? personAppointments.find(a => a.id === r.appointmentId && a.serviceId === r.serviceId)
        : null;
      if (r.appointmentId && !appointment) return null;
      if (!r.template || typeof r.template.title !== 'string') return null;
      const expired = r.status === 'pending' && validDate(r.expiresAt) && Date.parse(r.expiresAt) <= currentTime;
      const statusCode = expired ? 'expired' : r.status;
      const answer = canSeeAnswers && statusCode === 'submitted'
        ? viewSubmittedForStaff(r, { tenantId, actorRole }) : null;
      return {
        requestId: String(r.requestId),
        title: String(r.template.title),
        serviceId: String(r.serviceId),
        statusCode,
        status: reqStates[statusCode] || 'Sin estado',
        appointmentId: r.appointmentId || null,
        submittedAt: r.submittedAt || null,
        items: answer ? clone(answer.items) : []
      };
    })
    .filter(Boolean);

  return {
    tenantId,
    person: {
      id: String(person.id),
      name: String(person.displayName || 'Sin nombre'),
      phone: String(person.phone || ''),
      email: String(person.email || ''),
      sharedNote: canSeeAnswers ? String(person.sharedNote || '') : '',
      staffNotes: canSeeAnswers ? String(person.staffNotes || '') : ''
    },
    totalAppointments: personAppointments.length,
    nextAppointment: future[0] || null,
    upcoming: future,
    history,
    forms,
    canSeeAnswers
  };
}
