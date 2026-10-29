import {hookRecipientPhone,metaRecipient,safeMetaError} from './diagnostics.mjs';
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function verifyHook(payload: string, headers: Headers, rawSecrets: string) {
  const headerObject = Object.fromEntries(headers.entries());
  const candidates = rawSecrets
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const secret = candidate.replace(/^v1,whsec_/, "");
    try {
      return new Webhook(secret).verify(payload, headerObject) as {
        user?: { phone?: string };
        sms?: { otp?: string; phone?: string };
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Invalid hook signature");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  try {
    const payload = await req.text();
    const hookSecret = env("SEND_SMS_HOOK_SECRET");
    const event = verifyHook(payload, req.headers, hookSecret);

    // Supabase Auth supplies sms.phone as the destination, including phone_change.
    // user.phone remains the old number until phone_change is verified.
    let phone: string;
    try {
      phone = hookRecipientPhone(event);
    } catch {
      return Response.json({ error: "invalid phone" }, { status: 400 });
    }
    const otp = event?.sms?.otp;
    if (!otp || !/^\d{6}$/.test(otp)) {
      return Response.json({ error: "invalid otp" }, { status: 400 });
    }

    const accessToken = env("META_WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = env("META_WHATSAPP_PHONE_NUMBER_ID");
    const templateName = env("META_WHATSAPP_OTP_TEMPLATE");
    const languageCode = Deno.env.get("META_WHATSAPP_OTP_LANGUAGE")?.trim() || "es_AR";
    const graphVersion = Deno.env.get("META_GRAPH_API_VERSION")?.trim() || "v25.0";
    const buttonSubtype = Deno.env.get("META_WHATSAPP_OTP_BUTTON_SUBTYPE")?.trim() || "url";

    const to = metaRecipient(phone, phoneNumberId);

    const metaResponse = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: otp }],
              },
              {
                type: "button",
                sub_type: buttonSubtype,
                index: "0",
                parameters: [{ type: "text", text: otp }],
              },
            ],
          },
        }),
      },
    );

    if (!metaResponse.ok) {
      const body = await metaResponse.json().catch(() => null);
      console.error("Meta WhatsApp OTP send failed", {reason: safeMetaError(metaResponse.status,body)});
      return Response.json(
        { error: "whatsapp_delivery_failed" },
        { status: 502 },
      );
    }

    return Response.json({});
  } catch (error) {
    console.error("CITHELA WhatsApp OTP hook failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "hook_failed" }, { status: 500 });
  }
});
