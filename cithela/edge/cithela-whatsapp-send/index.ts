// CITHELA — explicit, audited WhatsApp send. Never invoked by webhooks or cron.
// Requires signed-in owner/admin, a recent inbound message, identical server preview,
// and a unique outbox record BEFORE any Meta request.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const ORIGIN = "https://spuklab.github.io";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const reply = (payload: unknown, status = 200) =>
  Response.json(payload, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

function adminKey() {
  try {
    const map = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (typeof map.default === "string" && map.default) return map.default;
  } catch { /* use legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
function freshInbound(providerTime: unknown) {
  const time = Date.parse(String(providerTime || ""));
  const age = Date.now() - time;
  // Extra one-hour safety buffer before the WhatsApp 24-hour service window ends.
  return Number.isFinite(time) && age >= -120000 && age < 23 * 60 * 60 * 1000;
}
function e164(value: unknown) {
  const str = String(value ?? "");
  return /^\+[1-9][0-9]{7,14}$/.test(str) ? str : null;
}
// Meta's Argentina test-recipient allowlist may use +54 without the mobile 9,
// although inbound webhooks provide +549. Limit the workaround to THIS test sender.
// Never mutate the stored patient phone or production sender behavior.
function metaRecipient(to: string, senderId: string) {
  const CITHELA_META_TEST_SENDER = "1300517359820775";
  if (senderId === CITHELA_META_TEST_SENDER && /^\+549[0-9]{10}$/.test(to)) {
    return "54" + to.slice(4);
  }
  return to.slice(1);
}
// Keep Meta error details on the server only. Strip URLs, phone/IDs, mail and token-like values.
function diagnosticMetaText(input) {
  if (typeof input !== "string") return null;
  const clean = input.slice(0, 450)
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/\b(?:EAA|EAAG|EAAF)[A-Za-z0-9_-]{12,}\b/g, "[token]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\b\d{4,}\b/g, "[id]")
    .replace(/[\r\n\t]/g, " ");
  return clean || null;
}
function logMetaSendRejection(response, errorPayload) {
  // No access token, phone number, patient text, URL, or full API response in logs.
  const err = errorPayload && typeof errorPayload === "object" ? errorPayload.error : undefined;
  const code = typeof err?.code === "number" && Number.isInteger(err.code) ? err.code : null;
  const subcode = typeof err?.error_subcode === "number" && Number.isInteger(err.error_subcode)
    ? err.error_subcode : null;
  const type = typeof err?.type === "string" && /^(OAuthException|GraphMethodException|GraphAPIException|APIException)$/.test(err.type)
    ? err.type : "other";
  const trace = typeof err?.fbtrace_id === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(err.fbtrace_id)
    ? err.fbtrace_id : null;
  const data = err?.error_data;
  const details = data && typeof data === "object" ? data.details : null;
  console.error("CITHELA_META_SEND_REJECTED " + JSON.stringify({
    http_status: response.status, code, subcode, type,
    message: diagnosticMetaText(err?.message),
    details: diagnosticMetaText(details), fbtrace_id: trace,
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, code: "method_not_allowed" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN)
    return reply({ ok: false, code: "invalid_origin" }, 403);
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return reply({ ok: false, code: "unauthenticated" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const secret = adminKey();
  if (!url || !secret) return reply({ ok: false, code: "server_unavailable" }, 503);
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: identity, error: authError } = await admin.auth.getUser(token);
  if (authError || !identity?.user?.id) return reply({ ok: false, code: "unauthenticated" }, 401);
  let request: Record<string, unknown>;
  try { request = await req.json(); } catch { return reply({ ok: false, code: "invalid_json" }, 400); }
  if (!request || !["send", "check_credentials"].includes(String(request.action)) ||
    !UUID.test(String(request.tenant_id)) ||
    (request.action === "send" && (!UUID.test(String(request.event_id)) ||
      typeof request.draft !== "string" || !request.draft.trim() || request.draft.length > 1000 ||
       (request.note !== undefined && (typeof request.note !== "string" || request.note.length > 240))))) {
    return reply({ ok: false, code: "invalid_payload" }, 400);
  }
  const tenantId = String(request.tenant_id);
  const eventId = String(request.event_id ?? "");
  const { data: membership, error: memberError } = await admin.from("cithela_tenant_memberships")
    .select("role").eq("tenant_id", tenantId).eq("user_id", identity.user.id).maybeSingle();
  if (memberError || !["owner", "admin"].includes(membership?.role))
    return reply({ ok: false, code: "forbidden" }, 403);
  const { data: tenant, error: tenantError } = await admin.from("cithela_tenants")
    .select("status").eq("id", tenantId).maybeSingle();
  if (tenantError || tenant?.status !== "active") return reply({ ok: false, code: "inactive_tenant" }, 403);

  if (request.action === "check_credentials") {
    // Read-only check using the actual Supabase Meta token; no message, outbox, or patient access.
    const senderId = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID");
    const metaToken = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
    if (!senderId || !metaToken) return reply({ ok: false, code: "sender_not_configured" }, 503);
    const { data: connection, error: connectionError } = await admin.from("cithela_channel_connections")
      .select("id").eq("tenant_id", tenantId).eq("channel", "whatsapp")
      .eq("external_account_id", senderId).eq("status", "active").maybeSingle();
    if (connectionError || !connection) return reply({ ok: false, code: "connection_not_found" }, 403);
    const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v25.0";
    try {
      const response = await fetch(
        "https://graph.facebook.com/" + graphVersion + "/" + senderId +
        "?fields=id,display_phone_number,quality_rating",
        {
          method: "GET",
          headers: { Authorization: "Bearer " + metaToken },
          signal: AbortSignal.timeout(10000),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const metaCode = body?.error?.code;
        const diagnostic = Number.isInteger(metaCode) && metaCode > 0 && metaCode < 1000000
          ? "meta_code_" + metaCode : "meta_http_" + response.status;
        return reply({
          ok: false, code: "meta_credential_check_failed", diagnostic_code: diagnostic
        }, 502);
      }
      if (body?.id !== senderId) return reply({ ok: false, code: "meta_number_mismatch" }, 502);
      return reply({
        ok: true, code: "meta_number_accessible", diagnostic: "read_only",
        quality_rating: ["GREEN", "YELLOW", "RED"].includes(body?.quality_rating)
          ? body.quality_rating : null,
      });
    } catch {
      return reply({ ok: false, code: "meta_check_unavailable" }, 503);
    }
  }

  const { data: event, error: eventError } = await admin.from("cithela_channel_inbox")
    .select("id,connection_id,channel,message_type,sender_phone_e164,provider_timestamp,received_at")
    .eq("tenant_id", tenantId).eq("id", eventId).eq("channel", "whatsapp").maybeSingle();
  if (eventError || !event || event.message_type !== "text")
    return reply({ ok: false, code: "event_not_found" }, 404);
  const to = e164(event.sender_phone_e164);
  if (!to || !freshInbound(event.provider_timestamp || event.received_at))
    return reply({ ok: false, code: "conversation_window_expired" }, 409);

  const { data: conn, error: connError } = await admin.from("cithela_channel_connections")
    .select("external_account_id").eq("tenant_id", tenantId).eq("id", event.connection_id)
    .eq("channel", "whatsapp").eq("status", "active").maybeSingle();
  if (connError || !conn) return reply({ ok: false, code: "connection_not_found" }, 403);
  const senderId = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID");
  const metaToken = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
  if (!senderId || !metaToken || senderId !== conn.external_account_id)
    return reply({ ok: false, code: "sender_not_configured" }, 503);

  // Get a fresh, signed-in, tenant-authorized draft from the read-only review function.
  // The browser cannot send arbitrary text or reuse an outdated availability proposal.
  let preview: Record<string, unknown>;
  try {
    const p = await fetch(url + "/functions/v1/cithela-whatsapp-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || secret,
      },
      body: JSON.stringify({ action: "prepare", tenant_id: tenantId, event_id: eventId }),
      signal: AbortSignal.timeout(12000),
    });
    preview = await p.json();
    if (!p.ok || preview.ok !== true) throw new Error("review_unavailable");
  } catch {
    return reply({ ok: false, code: "preview_unavailable" }, 503);
  }
  if (!["needs_service", "slots_preview", "no_slots", "selection_preview"].includes(String(preview.code)) ||
      typeof preview.draft !== "string" || preview.draft !== request.draft) {
    return reply({ ok: false, code: "stale_or_unsupported_draft" }, 409);
  }

  // The automated availability/selection text is immutable. The professional can only
  // append one short, single-line note. Reject language claiming a booking is confirmed.
  const note = typeof request.note === "string" ? request.note.trim() : "";
  const notePlain = note.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (note && (/\p{C}/u.test(note) ||
    /\b(confirmad[oa]s?|reservad[oa]s?|agendad[oa]s?|asegurad[oa]s?|garantizad[oa]s?)\b/.test(notePlain) ||
    /\bya (?:tenes|tienes|tiene) (?:el |tu )?turno\b/.test(notePlain))) {
    return reply({ ok: false, code: "invalid_professional_note" }, 400);
  }
  const approvedText = preview.draft + (note ? "\n\nNota del profesional: " + note : "");

  // A single inbound message authorizes at most ONE response. A new patient message
  // supplies the next event. Never retry uncertain network deliveries automatically.
  const { data: record, error: reserveError } = await admin.from("cithela_channel_outbox")
    .insert({
      tenant_id: tenantId, inbox_event_id: eventId, connection_id: event.connection_id,
      actor_user_id: identity.user.id, reply_text: approvedText, status: "sending",
    }).select("id").single();
  if (reserveError) return reply({
    ok: false, code: reserveError.code === "23505" ? "already_attempted" : "outbox_unavailable",
  }, reserveError.code === "23505" ? 409 : 503);
  const outboxId = record.id;
  const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v25.0";
  let resultStatus = "unknown";
  let providerMessageId: string | null = null;
  let errCode: string | null = null;
  try {
    const res = await fetch("https://graph.facebook.com/" + graphVersion + "/" + senderId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + metaToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: metaRecipient(to, senderId), type: "text",
        text: { preview_url: false, body: approvedText },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const result = await res.json();
      providerMessageId = typeof result?.messages?.[0]?.id === "string"
        ? result.messages[0].id : null;
      resultStatus = providerMessageId ? "sent" : "unknown";
      errCode = providerMessageId ? null : "missing_provider_receipt";
    } else {
      // Preserve only Meta's numeric code in the outbox. Record a redacted
      // server-side diagnostic for resolving permission issues safely.
      // No automatic retry: any uncertain delivery remains uniquely reserved.
      const errorBody = await res.json().catch(() => null);
      logMetaSendRejection(res, errorBody);
      const numericCode = errorBody?.error?.code;
      const validCode = Number.isInteger(numericCode) && numericCode > 0 && numericCode < 1000000;
      resultStatus = "unknown";
      errCode = validCode ? "meta_code_" + numericCode : "meta_http_" + res.status;
    }
  } catch { errCode = "meta_delivery_uncertain"; }
  const { error: updateError } = await admin.from("cithela_channel_outbox")
    .update({
      status: resultStatus, provider_message_id: providerMessageId,
      error_code: errCode, sent_at: resultStatus === "sent" ? new Date().toISOString() : null,
    }).eq("id", outboxId).eq("tenant_id", tenantId);
  if (updateError) console.error("CITHELA outbox status persistence failed");
  if (resultStatus !== "sent")
    return reply({
      ok: false,
      code: errCode === "meta_http_401" || errCode === "meta_code_190" ? "meta_unauthorized"
        : errCode === "meta_code_131030" ? "test_recipient_not_allowed"
        : errCode === "meta_code_131005" ? "meta_access_denied"
        : "delivery_unconfirmed",
      diagnostic_code: errCode,
      outbox_id: outboxId,
    }, 502);
  return reply({ ok: true, code: "submitted_to_meta", outbox_id: outboxId });
});
