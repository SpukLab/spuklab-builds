// CITHELA / Mercado Pago — credential-gated, server-only webhook receiver.
// Records signed test events and reconciles only the internal pilot.
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
    async verifyTestSellerMode() {
      if(!enabled)return false;
      const token=(Deno.env.get("CITHELA_MP_TEST_ACCESS_TOKEN")||"").trim();
      if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token))return false;
      const res=await fetch("https://api.mercadopago.com/users/me",{
        method:"GET",
        headers:{Authorization:"Bearer "+token,Accept:"application/json"},
        redirect:"error",signal:AbortSignal.timeout(7000)
      });
      if(!res.ok)throw new Error("test_seller_lookup_unavailable");
      const seller=await res.json();
      return String(seller?.id)===merchantUserId&&seller?.site_id==="MLA"&&
        Array.isArray(seller?.tags)&&seller.tags.includes("test_user");
    },
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
      // This endpoint is dedicated to the internal test seller.
      // A signed notification proves delivery, never approval or entitlement.
      // Payment recording takes place through a separate provider-verified
      // owner-consented workflow; no legacy activation RPC is invoked.
      if(data?.ok && ["recorded","duplicate"].includes(data.code)){
        console.info("cithela_mp_signed_event_received",JSON.stringify({
          verified_signature:true,stored:true,auto_activation:false
        }));
      }
      return data;
    }
  });
});
