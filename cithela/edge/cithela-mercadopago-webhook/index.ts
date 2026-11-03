// CITHELA / Mercado Pago — credential-gated, server-only webhook receiver.
// TEST INBOX ONLY: not a payment processor and never updates entitlements.
// Deploy disabled. Only enable after saving TEST webhook HMAC secret in Supabase.
// Use verify_jwt=false for the webhook only, guarded by provider HMAC.
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {handleMercadoPagoWebhook} from "../../payments/mercadopago-webhook-handler.mjs";

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
    reportValidationFailure(code) {
      // Security telemetry: do not include request IDs, payloads, headers,
      // cryptographic material, timestamps or user/merchant identifiers.
      if(code==='invalid_signature'||code==='signature_expired'){
        console.info('cithela_mp_webhook_hmac', code);
      }
    },
    async storeSignedEvent(event) {
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
      return data;
    }
  });
});
