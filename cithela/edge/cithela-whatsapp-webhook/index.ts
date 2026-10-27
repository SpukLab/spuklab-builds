import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readAdminKey(): string | null {
  const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretMap) {
    try {
      const parsed = JSON.parse(secretMap) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed).find((value) => typeof value === "string" && value.length > 0);
      if (first) return first;
    } catch {
      // Fall through to the legacy variable.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function constantTimeEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  const max = Math.max(aa.length, bb.length);
  for (let i = 0; i < max; i++) {
    diff |= (aa[i % Math.max(aa.length, 1)] ?? 0) ^ (bb[i % Math.max(bb.length, 1)] ?? 0);
  }
  return diff === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyMetaSignature(
  rawBody: ArrayBuffer,
  signature: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  return constantTimeEqual(signature, `sha256=${hex(new Uint8Array(digest))}`);
}

function e164(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

function isoFromUnixSeconds(value: unknown): string | null {
  const seconds = typeof value === "string" || typeof value === "number"
    ? Number(value)
    : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedMessage(message: Record<string, unknown>, entryId: unknown) {
  const type = typeof message.type === "string" ? message.type : "unknown";
  const typed = message[type];
  const typedObject = typed && typeof typed === "object"
    ? typed as Record<string, unknown>
    : {};
  const context = message.context && typeof message.context === "object"
    ? message.context as Record<string, unknown>
    : {};
  const interactive = message.interactive && typeof message.interactive === "object"
    ? message.interactive as Record<string, unknown>
    : {};
  const buttonReply = interactive.button_reply && typeof interactive.button_reply === "object"
    ? interactive.button_reply as Record<string, unknown>
    : {};
  const listReply = interactive.list_reply && typeof interactive.list_reply === "object"
    ? interactive.list_reply as Record<string, unknown>
    : {};

  return {
    entry_id: typeof entryId === "string" ? entryId : null,
    message_id: typeof message.id === "string" ? message.id : null,
    type,
    context_message_id: typeof context.id === "string" ? context.id : null,
    media_id: typeof typedObject.id === "string" ? typedObject.id : null,
    interactive_id:
      typeof buttonReply.id === "string" ? buttonReply.id
      : typeof listReply.id === "string" ? listReply.id
      : null,
  };
}

function textBody(message: Record<string, unknown>): string | null {
  if (message.type === "text" && message.text && typeof message.text === "object") {
    const body = (message.text as Record<string, unknown>).body;
    return typeof body === "string" ? body.slice(0, 5000) : null;
  }
  const type = typeof message.type === "string" ? message.type : "";
  const typed = message[type];
  if (typed && typeof typed === "object") {
    const caption = (typed as Record<string, unknown>).caption;
    if (typeof caption === "string") return caption.slice(0, 5000);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const verifyToken = Deno.env.get("META_WHATSAPP_VERIFY_TOKEN");
    if (!verifyToken) return new Response("webhook not configured", { status: 503 });

    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      token &&
      challenge &&
      constantTimeEqual(token, verifyToken)
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const appSecret = Deno.env.get("META_WHATSAPP_APP_SECRET");
  if (!appSecret) return new Response("webhook not configured", { status: 503 });

  const rawBody = await req.arrayBuffer();
  const valid = await verifyMetaSignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
    appSecret,
  );
  if (!valid) return new Response("invalid signature", { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(decoder.decode(rawBody)) as Record<string, unknown>;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (body.object !== "whatsapp_business_account") {
    return Response.json({ ok: true, ingested: 0, duplicates: 0, ignored: 1 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const adminKey = readAdminKey();
  if (!supabaseUrl || !adminKey) {
    console.error("Supabase admin environment is unavailable");
    return new Response("server configuration error", { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let ingested = 0;
  let duplicates = 0;
  let ignored = 0;

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entryValue of entries) {
    if (!entryValue || typeof entryValue !== "object") {
      ignored++;
      continue;
    }
    const entry = entryValue as Record<string, unknown>;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const changeValue of changes) {
      if (!changeValue || typeof changeValue !== "object") {
        ignored++;
        continue;
      }
      const change = changeValue as Record<string, unknown>;
      if (change.field !== "messages" || !change.value || typeof change.value !== "object") {
        ignored++;
        continue;
      }

      const value = change.value as Record<string, unknown>;
      const metadata = value.metadata && typeof value.metadata === "object"
        ? value.metadata as Record<string, unknown>
        : {};
      const externalAccountId = typeof metadata.phone_number_id === "string"
        ? metadata.phone_number_id
        : null;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      if (!externalAccountId || messages.length === 0) {
        ignored++;
        continue;
      }

      for (const messageValue of messages) {
        if (!messageValue || typeof messageValue !== "object") {
          ignored++;
          continue;
        }
        const message = messageValue as Record<string, unknown>;
        const eventId = typeof message.id === "string" ? message.id : null;
        const senderPhone = e164(message.from);
        const messageType = typeof message.type === "string" ? message.type : "unknown";

        if (!eventId || !senderPhone) {
          ignored++;
          continue;
        }

        let senderName: string | null = null;
        const rawFrom = typeof message.from === "string" ? message.from.replace(/\D/g, "") : "";
        for (const contactValue of contacts) {
          if (!contactValue || typeof contactValue !== "object") continue;
          const contact = contactValue as Record<string, unknown>;
          if (typeof contact.wa_id !== "string" || contact.wa_id.replace(/\D/g, "") !== rawFrom) continue;
          const profile = contact.profile && typeof contact.profile === "object"
            ? contact.profile as Record<string, unknown>
            : {};
          if (typeof profile.name === "string") senderName = profile.name.slice(0, 160);
          break;
        }

        const { data, error } = await supabaseAdmin.rpc("cithela_channel_ingest", {
          p_channel: "whatsapp",
          p_external_account_id: externalAccountId,
          p_external_event_id: eventId,
          p_sender_phone: senderPhone,
          p_sender_name: senderName,
          p_message_type: messageType,
          p_text_body: textBody(message),
          p_provider_timestamp: isoFromUnixSeconds(message.timestamp),
          p_normalized_payload: normalizedMessage(message, entry.id),
        });

        if (error) {
          console.error("Channel inbox RPC failed", { eventId, code: error.code });
          return new Response("temporary ingest failure", { status: 500 });
        }

        if (data?.code === "event_ingested") ingested++;
        else if (data?.code === "event_duplicate") duplicates++;
        else {
          ignored++;
          console.warn("Channel event ignored", { eventId, code: data?.code ?? "unknown" });
        }
      }
    }
  }

  return Response.json({ ok: true, ingested, duplicates, ignored });
});
