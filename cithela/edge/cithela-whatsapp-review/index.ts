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
function matchingServices(text, services) {
  const haystack = " " + clean(text) + " ";
  return services.filter(s => {
    const needle = clean(s.name);
    const direct = needle && haystack.includes(" " + needle + " ");
    // Conservative Spanish hair-service synonyms, resolved only against the
    // tenant's actual catalog. Multiple candidate services remain ambiguous.
    const dyeIntent = /\b(tintura|tinte|tenir|tenirme|tenido)\b/.test(haystack);
    const hairColor = /\b(coloracion|color)\b/.test(needle);
    const cutIntent = /\b(cortarme|cortarte|cortarse|cortarnos|cortarme el pelo|cortar(?:me|te|se|nos)? (?:el )?(?:pelo|cabello))\b/.test(haystack);
    const haircut = /\bcorte\b/.test(needle);
    return direct || (dyeIntent && hairColor) || (cutIntent && haircut);
  });
}
function matchService(text, services) {
  const found = matchingServices(text, services);
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


function selectedOption(message) {
  const value = clean(message);
  const selected = /^(?:(?:elijo|prefiero|quiero|selecciono|tomo|me quedo con) )?(?:(?:la|el) )?(?:opcion )?([123])$/.exec(value);
  if (selected) return Number(selected[1]);
  const ordinal = /^(?:(?:elijo|prefiero|quiero) )?(?:la )?(primera|segunda|tercera)$/.exec(value);
  return ordinal ? { primera: 1, segunda: 2, tercera: 3 }[ordinal[1]] : null;
}
const OFFER_MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function recoverOffer(replyText, sentAt) {
  // Accept ONLY the numbered format produced by CITHELA, not arbitrary free text.
  const lines = String(replyText || "").split(/\r?\n/);
  const title = /^Estos horarios están disponibles para ([^\n:]{1,100}):$/.exec(lines[0]?.trim() || "");
  if (!title || !lines.some(x => x.includes("¿Cuál preferís?"))) return null;
  const anchor = new Date(sentAt);
  if (!Number.isFinite(anchor.getTime())) return null;
  const origin = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const slots = [];
  for (const line of lines.slice(1)) {
    const found = /^([123])\.\s+(.+?)\s+a las\s+([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(line.trim());
    if (!found) continue;
    const ordinal = Number(found[1]);
    if (slots.some(x => x.ordinal === ordinal)) return null;
    const label = clean(found[2]).replace(/^(lun|mar|mie|jue|vie|sab|dom) /,"");
    let date = null;
    const iso = /^(\d{4}) (\d{2}) (\d{2})$/.exec(label);
    if (iso) date = iso[1] + "-" + iso[2] + "-" + iso[3];
    else {
      const named = /^(\d{1,2}) (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/.exec(label);
      if (!named) return null;
      const month = OFFER_MONTHS.indexOf(named[2]) + 1, day = Number(named[1]);
      for (const year of [anchor.getUTCFullYear(), anchor.getUTCFullYear() + 1]) {
        const dt = new Date(Date.UTC(year, month - 1, day));
        if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) continue;
        const distance = dt.getTime() - origin;
        if (distance >= -86400000 && distance <= 31 * 86400000) {
          date = dt.toISOString().slice(0, 10); break;
        }
      }
    }
    if (!date || Number.isNaN(Date.parse(date + "T00:00:00Z"))) return null;
    slots.push({ ordinal, date, hour: found[3].padStart(2, "0") + ":" + found[4] });
  }
  if (!slots.length || slots.some((x,i) => x.ordinal !== i+1)) return null;
  return { serviceName: title[1], slots };
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
      .order("received_at", { ascending: false }).limit(20);
    if (error) return json({ ok: false, code: "inbox_unavailable" }, 503);
    const items = data || [];
    let outbox = [];
    if (items.length) {
      const { data: outgoing, error: outgoingError } = await admin.from("cithela_channel_outbox")
        .select("inbox_event_id,reply_text,status,attempted_at,sent_at")
        .eq("tenant_id", tenantId).in("inbox_event_id", items.map(x => x.id));
      // A missing status must never be presented as "not yet answered".
      if (outgoingError) return json({ ok: false, code: "outbox_unavailable" }, 503);
      outbox = outgoing || [];
    }
    const byEvent = new Map(outbox.map(x => [x.inbox_event_id, x]));
    return json({
      ok: true, items: items.map(x => {
        const outgoing = byEvent.get(x.id);
        return {
          id: x.id,
          sender_name: boundedText(x.sender_name, 80),
          message_type: x.message_type,
          text_body: boundedText(x.text_body, 1500),
          received_at: x.received_at,
          outbound: outgoing ? {
            status: ["sent", "unknown", "sending"].includes(outgoing.status)
              ? outgoing.status : "unknown",
            reply_text: boundedText(outgoing.reply_text, 1000),
            attempted_at: outgoing.attempted_at,
            sent_at: outgoing.sent_at,
          } : null,
        };
      }),
    });
  }
  if (body.action !== "prepare" || !UUID.test(body.event_id))
    return json({ ok: false, code: "unsupported_action" }, 400);
  const { data: event, error: eventError } = await admin.from("cithela_channel_inbox")
    .select("id,tenant_id,connection_id,channel,external_event_id,message_type,text_body,received_at,sender_phone_e164")
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

    const optionNumber = selectedOption(text);
    if (optionNumber !== null) {
      const sourceTime = Date.parse(event.received_at);
      if (!Number.isFinite(sourceTime)) throw new Error("invalid_message_time");
      // Resolve latest accepted outbound to SAME verified sender and tenant.
      const cutoff = new Date(sourceTime - 48 * 3600000).toISOString();
      const { data: sent, error: sentError } = await admin.from("cithela_channel_outbox")
        .select("id,inbox_event_id,reply_text,sent_at").eq("tenant_id", tenantId)
        .eq("connection_id", event.connection_id).eq("status", "sent")
        .gte("sent_at", cutoff).lt("sent_at", event.received_at)
        .order("sent_at", { ascending: false }).limit(20);
      if (sentError) throw new Error("offer_history_unavailable");
      const options = sent || [];
      if (!options.length) return json({
        ok: true, code: "manual_review",
        draft: "No encontré una propuesta anterior confirmada para elegir. ¿Podés contarme qué servicio necesitás?",
      });
      const { data: sources, error: sourceError } = await admin.from("cithela_channel_inbox")
        .select("id,sender_phone_e164").eq("tenant_id", tenantId)
        .eq("connection_id", event.connection_id)
        .in("id", options.map(x => x.inbox_event_id));
      if (sourceError) throw new Error("offer_sender_unavailable");
      const sourceIds = new Set((sources || [])
        .filter(x => x.sender_phone_e164 === event.sender_phone_e164).map(x => x.id));
      const latest = options.find(x => sourceIds.has(x.inbox_event_id));
      if (!latest) return json({
        ok: true, code: "manual_review",
        draft: "No encontré una propuesta anterior para este contacto. ¿Qué servicio necesitás?",
      });
      const offer = recoverOffer(latest.reply_text, latest.sent_at);
      if (!offer) return json({
        ok: true, code: "manual_review",
        draft: "No pude identificar con seguridad las opciones del último mensaje. Un profesional revisará tu elección.",
      });
      const picked = offer.slots.find(x => x.ordinal === optionNumber);
      if (!picked) return json({
        ok: true, code: "manual_review",
        draft: "Esa opción no figura en la propuesta anterior. ¿Podés elegir una de las opciones ofrecidas?",
      });
      const services = await command("catalog.services");
      const matching = (services.items || []).filter(x => clean(x.name) === clean(offer.serviceName));
      const resources = await command("catalog.resources");
      if (matching.length !== 1 || !Array.isArray(resources.items) || resources.items.length !== 1) {
        return json({ ok: true, code: "manual_review",
          draft: "Un profesional revisará el servicio y la disponibilidad antes de confirmar el turno." });
      }
      const service = matching[0], resource = resources.items[0];
      const available = await command("availability.query", {
        date: picked.date, service_id: service.id, resource_id: resource.id
      });
      if (available.date !== picked.date || !Array.isArray(available.slots)) throw new Error("invalid_availability");
      const stillAvailable = available.slots.includes(picked.hour);
      const formatter = new Intl.DateTimeFormat("es-AR", {
        weekday: "long", day: "numeric", month: "long", timeZone: "UTC"
      });
      const when = formatter.format(new Date(picked.date + "T12:00:00Z")) + " a las " + picked.hour;
      return json({
        ok: true,
        code: stillAvailable ? "selection_preview" : "manual_review",
        chosen: { service: service.name, date: picked.date, hour: picked.hour,
          option: optionNumber, offer_inbox_id: latest.inbox_event_id },
        draft: stillAvailable
          ? "Elegiste la opción " + optionNumber + ": " + service.name + " el " + when +
            ". El horario sigue disponible por ahora. Un profesional revisará la solicitud y confirmará el turno; todavía no está reservado."
          : "La opción " + optionNumber + " para " + service.name + " el " + when +
            " ya no está disponible. ¿Querés que te ofrezcamos otros horarios?",
      });
    }
    const services = await command("catalog.services");
    if (!Array.isArray(services.items)) throw new Error("services_unavailable");
    const matched = matchingServices(text, services.items);
    if (matched.length > 1) {
      // Multiple catalog matches are a real request, not an unknown service.
      // Do not guess a combined duration or offer slots sized for one service.
      if (matched.length > 4) return json({
        ok: true, code: "manual_review",
        draft: "Recibimos tu pedido de varios servicios. Un profesional revisará los detalles antes de ofrecerte un horario."
      });
      const names = matched.map(s => boundedText(s.name, 80));
      const label = names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
      return json({
        ok: true, code: "needs_service", clarification: "multiple_services",
        services: names,
        draft: "Entiendo que necesitás " + label +
          ". Para coordinarlos en una misma visita, un profesional revisará la duración total " +
          "y los horarios disponibles. Todavía no hay ningún turno reservado."
      });
    }
    const service = matched.length === 1 ? matched[0] : null;
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
        /^([01]\d|2[0-3]):[0-5]\d$/.test(hour) &&
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
