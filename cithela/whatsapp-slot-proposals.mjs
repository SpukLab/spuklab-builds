// CITHELA — pure, supervised WhatsApp proposal utilities.
// No network access, messages or appointment writes are performed here.
export function classifyRequest(message) {
  const text = String(message ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(cancelar|anular|dar de baja)\b/.test(text)) return "cancel";
  if (/\b(reprogramar|cambiar|mover)\b/.test(text) && /\b(turno|cita|reserva)\b/.test(text)) return "reschedule";
  if (/\b(reservar|turno|cita|agenda|horario|disponibilidad)\b/.test(text)) return "book";
  return "unknown";
}
export function matchService(message, services) {
  const text = normalize(message);
  const candidates = services.filter((service) => {
    const name = normalize(service.name);
    return name && new RegExp("(^|[^a-z0-9])" + escapeRegex(name) + "($|[^a-z0-9])").test(text);
  });
  // Never guess when multiple services match.
  return candidates.length === 1 ? candidates[0] : null;
}
function normalize(v) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function escapeRegex(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// availability is an array of trusted {date:"YYYY-MM-DD", slots:["HH:MM", ...]} results
// returned by CITHELA's channel availability query. Never fabricate slots.
export function proposeSlots(availability, { limit = 3, requestedDate = null, afterTime = null } = {}) {
  const bounded = Math.min(Math.max(Number.isInteger(limit) ? limit : 3, 1), 3);
  const all = [];
  for (const day of Array.isArray(availability) ? availability : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date ?? "")) continue;
    if (requestedDate && day.date !== requestedDate) continue;
    for (const time of Array.isArray(day.slots) ? day.slots : []) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
      if (afterTime && time < afterTime) continue;
      all.push({ date: day.date, time });
    }
  }
  const unique = new Map(all.map(x => [x.date + "T" + x.time, x]));
  return [...unique.values()].sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, bounded);
}
export function draftProposal(service, slots) {
  if (!service?.name) return { status: "needs_service", text: "¿Qué servicio necesitás? Puedo mostrarte las opciones disponibles." };
  if (!slots?.length) return { status: "no_slots", text: "No encontré horarios disponibles en ese rango. ¿Querés probar otra fecha?" };
  const lines = slots.map((slot,i) => `${i + 1}. ${slot.date} a las ${slot.time}`);
  return { status: "awaiting_choice", text: `Para ${service.name}, estos horarios están disponibles ahora:\n${lines.join("\n")}\n¿Cuál preferís? Volveremos a comprobarlo antes de confirmar la reserva.` };
}
