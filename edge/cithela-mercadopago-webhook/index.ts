// CITHELA / Mercado Pago — credential-gated, server-only webhook receiver.
// Records signed test events and reconciles only the internal pilot.
// Deploy disabled. Only enable after saving TEST webhook HMAC secret in Supabase.
// Use verify_jwt=false for the webhook only, guarded by provider HMAC.
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {handleMercadoPagoWebhook} from "../../payments/mercadopago-webhook-handler.mjs";

import {reconcilePilotPayment} from "../../payments/mercadopago-pilot-reconciliation.mjs";

function secretKey(): string | null {
  // Follow the same secret-key preference as existing CITHELA WhatsApp functions.
  try {
    const v=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    if(typeof v.default==="string"&&v.default)return v.default;
  } catch { /* Fall back to legacy server-only service role key. */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||null;
}
Deno.serve(async (request: Request) => {
  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  const privateKey=secretKey();
  const webhookSecret=Deno.env.get("CITHELA_MP_WEBHOOK_SECRET")||"";
  const merchantUserId=Deno.env.get("CITHELA_MP_MERCHANT_USER_ID")||"";
  // Dedicated TEST endpoint: production notifications always fail closed.
  // A future production receiver must use separate secrets and explicit review.
  const enabled=Deno.env.get("CITHELA_MP_WEBHOOK_ENABLED")==="true"
    &&!!supabaseUrl&&!!privateKey&&webhookSecret.length>=16
    &&/^\d{1,30}$/.test(merchantUserId);
  return handleMercadoPagoWebhook(request,{
    enabled,secret:webhookSecret,merchantUserId,liveMode:false,
    reportValidationFailure(code: string) {
      // Security telemetry: do not include request IDs, payloads, headers,
      // cryptographic material, timestamps or user/merchant identifiers.
      if(code==='invalid_signature'||code==='signature_expired'){
        console.info('cithela_mp_webhook_hmac', code);
      }else if([
        'event_id_invalid','request_id_missing','resource_mismatch',
        'topic_mismatch','provider_mode_true','provider_mode_false',
        'provider_mode_unavailable','merchant_mismatch'
      ].includes(code)){
        // Enum only. Never dump a provider body, ID, user data or headers.
        console.info('cithela_mp_webhook_notification_mismatch', code);
      }
    },
    async storeSignedEvent(event: {eventId: string;topic: string;resourceId: string;requestId: string;merchantUserId: string;liveMode: boolean;occurredAt: string|null}) {
      if(!enabled||!privateKey)throw new Error("not_configured");
      const c=createClient(supabaseUrl,privateKey,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
      });
      const {data,error}=await c.rpc("cithela_mp_record_signed_event",{
        p_event_id:event.eventId,
        p_topic:event.topic,
        p_resource_id:event.resourceId,
        p_request_id:event.requestId,
        p_merchant_user_id:event.merchantUserId,
        p_live_mode:event.liveMode,
        p_occurred_at:event.occurredAt
      });
      if(error)throw new Error("storage_unavailable");
      if (!data?.ok || !["recorded","duplicate"].includes(data.code) ||
          event.topic !== "subscription_authorized_payment" || event.liveMode !== false) return data;

      const token = (Deno.env.get("CITHELA_MP_TEST_ACCESS_TOKEN") || "").trim();
      if (!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)) throw new Error("test_credential_unavailable");
      async function rpc(name: string, params: Record<string, unknown>) {
        const {data, error} = await c.rpc(name, params);
        if (error) throw new Error("reconciliation_unavailable");
        return data;
      }
      const result = await reconcilePilotPayment({
        invoiceId: event.resourceId,
        async getProvider(path: string) {
          const response = await fetch("https://api.mercadopago.com" + path, {
            headers: {Authorization: "Bearer " + token, Accept: "application/json"},
            signal: AbortSignal.timeout(3000),
            redirect: "error"
          });
          if (!response.ok) throw new Error("provider_unavailable");
          return response.json();
        },
        getIntent: (subscriptionId: string) => rpc("cithela_mp_pilot_reconciliation_intent",
          {p_subscription_id: subscriptionId}),
        record: (proof: Record<string, unknown>) => rpc("cithela_mp_reconcile_pilot_payment", proof)
      });
      if (!result?.ok) {
        console.info("cithela_mp_pilot_reconciliation_pending", result?.code || "unknown");
        throw new Error("reconciliation_pending");
      }
      return data;
    }
  });
});
