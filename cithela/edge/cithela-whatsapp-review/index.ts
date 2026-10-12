// CITHELA — read-only, tenant-scoped WhatsApp draft review.
// No sends, appointments, inbox claim/complete, or database mutations.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const ORIGIN = "https://spuklab.github.io";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { ...cors, "Cache-Control": "no-store" } });

function secretKey() {
  try {
    const map = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (typeof map.default === "string" && map.default) return map.default;
  } catch { /* legacy fallback */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const clean = (str) => String(str ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
function matchService(text, services) {
  const haystack = " " + clean(text) + " ";
  const found = services.filter(s => {
    const needle = clean(s.name);
    const direct = needle && haystack.includes(" " + needle + " ");
    // Single, conservative hair-service synonym; never resolve ambiguous matches.
    const dyeIntent = /\b(tintura|tinte|tenir|tenirme|tenido)\b/.test(haystack);
    const hairColor = /\b(coloracion|color)\b/.test(needle);
    return direct || (dyeIntent && hairColor);
  });
  return found.length === 1 ? found[0] : null;
}
function datesFromToday(tz, length = 7) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const utc = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
  if (!Number.isFinite(utc)) throw new Error("invalid_timezone");
  return Array.from({ length }, (_, i) => new Date(utc + i * 86400000).toISOString().slice(0, 10));
}

const slotMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function parseRequestedPreferences(message, upcoming) {
  const normalized = String(message ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const today = upcoming[0];
  const daysOfWeek = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  let date = null;
  const weekdayRequests = daysOfWeek.filter(day => new RegExp("\\b" + day + "\\b").test(normalized));
  if (weekdayRequests.length > 1) return { clarification: "¿Preferís un día concreto? Podés indicarme uno." };
  if (weekdayRequests.length === 1) {
    date = upcoming.find(day => daysOfWeek[new Date(day + "T12:00:00Z").getUTCDay()] === weekdayRequests[0]) || null;
  }
  const relative = /\bpasado manana\b/.test(normalized) ? 2 :
    /\bhoy\b/.test(normalized) ? 0 :
    /\bmanana\b/.test(normalized) && !/\b(?:por|a|de|en) la manana\b/.test(normalized) ? 1 : null;
  if (relative !== null) {
    if (date && date !== upcoming[relative]) return { clarification: "¿Para qué día necesitás el turno?" };
    date = upcoming[relative];
  }
  const numericDate = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(normalized);
  if (numericDate) {
    const day = Number(numericDate[1]), month = Number(numericDate[2]);
    const startYear = Number(today.slice(0, 4));
    const years = numericDate[3] ? [Number(numericDate[3])] : [startYear, startYear + 1];
    const candidates = years.map(year => {
      const d = new Date(Date.UTC(year, month - 1, day));
      return d.getUTCDate() === day && d.getUTCMonth() === month - 1 ? d.toISOString().slice(0, 10) : null;
    }).filter(Boolean);
    const explicit = candidates.find(x => x >= today) || candidates[0];
    if (!explicit) return { clarification: "¿Podés indicarme una fecha válida?" };
    if (date && date !== explicit) return { clarification: "Mencionaste dos fechas distintas. ¿Cuál preferís?" };
    date = explicit;
  }
  if (/\b(?:semana que viene|proxima semana|mes que viene|el mes que viene)\b/.test(normalized) && !date) {
    return { clarification: "¿Qué día de esa semana preferís? Por ahora puedo consultar los próximos siete días." };
  }
  const after = /\b(?:despues de|a partir de|desde)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\b/.exec(normalized);
  const before = /\b(?:antes de|hasta)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\b/.exec(normalized);
  const exact = /\b(?:a las?|para las?)\s+(\d{1,2})(?::(\d{2}))?\b/.exec(normalized);
  const validMinutes = (match) => {
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2] || 0);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : Number.NaN;
  };
  const min = validMinutes(after), max = validMinutes(before), at = validMinutes(exact);
  if ([min, max, at].some(x => Number.isNaN(x))) return { clarification: "¿Podés indicar un horario válido, por ejemplo 16:30?" };
  const morning = /\b(?:por|a|de|en) la manana\b|\btemprano\b/.test(normalized);
  const afternoon = /\b(?:por|a|de|en) la tarde\b/.test(normalized);
  const evening = /\b(?:por|a|de|en) la noche\b/.test(normalized);
  if ([morning, afternoon, evening].filter(Boolean).length > 1) {
    return { clarification: "¿Preferís mañana, tarde o noche?" };
  }
  const lower = Math.max(min ?? 0, afternoon ? 13 * 60 : evening ? 19 * 60 : 0);
  const upper = Math.min(max ?? 24 * 60, morning ? 13 * 60 : afternoon ? 19 * 60 : 24 * 60);
  if (lower >= upper || (at !== null && (at < lower || at >= upper))) {
    return { clarification: "Las preferencias de horario se contradicen. ¿Qué franja horaria preferís?" };
  }
  return { date, lower, upper, exact: at, hasPreference: Boolean(date || min !== null || max !== null || at !== null || morning || afternoon || evening) };
}
function chooseSpreadSlots(byDay) {
  const options = byDay.filter(x => x.slots.length);
  const result = [], used = new Set();
  const add = (date, hour) => {
    if (!hour || used.has(date + hour) || result.length >= 3) return;
    used.add(date + hour);
    result.push({ date, hour });
  };
  if (!options.length) return result;
  add(options[0].date, options[0].slots[0]);
  add(options[0].date, options[0].slots.find(x => slotMinutes(x) >= 14 * 60));
  for (const day of options.slice(1)) add(day.date, day.slots[0]);
  for (const day of options) {
    for (const hour of day.slots) {
      const apart = result.filter(x => x.date === day.date)
        .every(x => Math.abs(slotMinutes(x.hour) - slotMinutes(hour)) >= 60);
      if (apart) add(day.date, hour);
    }
  }
  for (const day of options) for (const hour of day.slots) add(day.date, hour);
  return result;
}
function unsupportedConversationDetail(message) {
  const n = clean(message);
  return /\b(alergia|alergico|embarazada|medicacion|dolor|precio|cuanto sale|cuanto cuesta|descuento|factura|pagar|sena|dos turnos|con mi hermana|simultaneo|urgente)\b/.test(n);
}

function boundedText(str, max = 3600) { return String(str ?? "").slice(0, max); }

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN)
    return json({ ok: false, code: "origin_rejected" }, 403);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return json({ ok: false, code: "unauthenticated" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) return json({ ok: false, code: "server_unavailable" }, 503);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: identity, error: authError } = await admin.auth.getUser(token);
  if (authError || !identity?.user?.id) return json({ ok: false, code: "unauthenticated" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, code: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || !UUID.test(body.tenant_id))
    return json({ ok: false, code: "invalid_tenant" }, 400);
  const tenantId = body.tenant_id;
  const { data: membership, error: memberError } = await admin.from("cithela_tenant_memberships")
    .select("role").eq("tenant_id", tenantId).eq("user_id", identity.user.id).maybeSingle();
  if (memberError || !["owner", "admin"].includes(membership?.role))
    return json({ ok: false, code: "forbidden" }, 403);
  const { data: tenant, error: tenantError } = await admin.from("cithela_tenants")
    .select("id,status,timezone").eq("id", tenantId).maybeSingle();
  if (tenantError || tenant?.status !== "active")
    return json({ ok: false, code: "tenant_inactive" }, 403);

  if (body.action === "list") {
    const { data, error } = await admin.from("cithela_channel_inbox")
      .select("id,external_event_id,sender_name,message_type,text_body,status,received_at")
      .eq("tenant_id", tenantId).eq("channel", "whatsapp")
      .order("received_at", { ascending: false }).limit(12);
    if (error) return json({ ok: false, code: "inbox_unavailable" }, 503);
    return json({
      ok: true, items: (data || []).map(x => ({
        id: x.id, external_event_id: x.external_event_id,
        sender_name: boundedText(x.sender_name, 80),
        message_type: x.message_type, text_body: boundedText(x.text_body, 300),
        status: x.status, received_at: x.received_at,
      })),
    });
  }
  if (body.action !== "prepare" || !UUID.test(body.event_id))
    return json({ ok: false, code: "unsupported_action" }, 400);
  const { data: event, error: eventError } = await admin.from("cithela_channel_inbox")
    .select("id,tenant_id,connection_id,channel,external_event_id,message_type,text_body")
    .eq("id", body.event_id).eq("tenant_id", tenantId).eq("channel", "whatsapp").maybeSingle();
  if (eventError || !event) return json({ ok: false, code: "event_not_found" }, 404);
  if (event.message_type !== "text")
    return json({ ok: true, code: "manual_review", draft: "Este tipo de mensaje requiere revisión del profesional." });
  const { data: conn, error: connError } = await admin.from("cithela_channel_connections")
    .select("external_account_id").eq("id", event.connection_id)
    .eq("tenant_id", tenantId).eq("channel", "whatsapp").eq("status", "active").maybeSingle();
  if (connError || !conn) return json({ ok: false, code: "connection_inactive" }, 403);
  const text = boundedText(event.text_body, 5000);
  if (/\b(cancelar|anular|reprogramar|cambiar|mover)\b/i.test(clean(text)))
    return json({ ok: true, code: "manual_review", draft: "Recibimos tu solicitud. Un profesional revisará el cambio antes de confirmarlo." });
  if (unsupportedConversationDetail(text)) {
    return json({ ok: true, code: "manual_review",
      draft: "Recibimos tu consulta y un profesional la revisará antes de confirmar cualquier turno." });
  }

  const command = async (name, payload = {}) => {
    const { data, error } = await admin.rpc("cithela_channel_command", {
      p_channel: "whatsapp", p_external_account_id: conn.external_account_id,
      p_request_id: "preview-" + event.external_event_id.slice(0, 120),
      p_command: name, p_payload: payload,
    });
    if (error || !data?.ok) throw new Error("availability_query_failed");
    return data;
  };
  try {
    const services = await command("catalog.services");
    if (!Array.isArray(services.items)) throw new Error("services_unavailable");
    const service = matchService(text, services.items);
    if (!service) {
      const choices = services.items.slice(0, 8).map(s => s.name).join(", ");
      return json({
        ok: true, code: "needs_service",
        draft: "¡Hola! ¿Qué servicio necesitás? " + (choices ? "Podés elegir entre: " + choices + "." : "Contanos qué querés reservar."),
      });
    }
    const resources = await command("catalog.resources");
    if (!Array.isArray(resources.items) || resources.items.length !== 1)
      return json({ ok: true, code: "needs_resource", draft: "¿Con qué profesional querés reservar? Te ayudo a consultar los horarios disponibles." });
    const resource = resources.items[0];
    const timezone = tenant.timezone || services.timezone || "America/Argentina/Buenos_Aires";
    const days = datesFromToday(timezone);
    const preferences = parseRequestedPreferences(text, days);
    if (preferences.clarification) {
      return json({ ok: true, code: "manual_review", draft: preferences.clarification });
    }
    if (preferences.date && !days.includes(preferences.date)) {
      return json({ ok: true, code: "no_slots", service: service.name, slots: [],
        draft: "La fecha que pediste queda fuera de los próximos siete días. ¿Querés probar otra fecha?" });
    }
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: timezone,
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const earliestToday = slotMinutes(clock) + 15;
    const candidates = [];
    for (const date of days.filter(d => !preferences.date || d === preferences.date)) {
      const available = await command("availability.query", { date, service_id: service.id, resource_id: resource.id });
      if (!Array.isArray(available.slots) || available.date !== date) throw new Error("invalid_availability");
      const slots = [...new Set(available.slots.filter(hour =>
        /^([01]\\d|2[0-3]):[0-5]\\d$/.test(hour) &&
        (date !== days[0] || slotMinutes(hour) > earliestToday) &&
        slotMinutes(hour) >= preferences.lower && slotMinutes(hour) < preferences.upper &&
        (preferences.exact === null || slotMinutes(hour) === preferences.exact)
      ))].sort();
      candidates.push({ date, slots });
    }
    const slots = chooseSpreadSlots(candidates);
    if (!slots.length) return json({
      ok: true, code: "no_slots", service: service.name, slots: [],
      draft: preferences.hasPreference
        ? "No encontré horarios disponibles para " + service.name +
          " con el día y horario que pediste. ¿Querés consultar otra fecha o franja?"
        : "No encontré horarios disponibles para " + service.name +
          " en los próximos siete días. ¿Querés consultar otra semana?",
    });
    const formatDate = (date) => new Intl.DateTimeFormat("es-AR",
      { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
      .format(new Date(date + "T12:00:00Z"));
    const lines = slots.map((slot, i) => (i + 1) + ". " +
      formatDate(slot.date) + " a las " + slot.hour).join("\n");
    return json({
      ok: true, code: "slots_preview", service: service.name, slots,
      draft: "Estos horarios están disponibles para " + service.name + ":\n" +
        lines + "\n¿Cuál preferís? El turno se confirmará luego de comprobar nuevamente la disponibilidad.",
    });
  } catch (err) {
    console.error("WhatsApp draft review failed", String(err).slice(0, 200));
    return json({ ok: false, code: "preview_unavailable" }, 503);
  }
});
