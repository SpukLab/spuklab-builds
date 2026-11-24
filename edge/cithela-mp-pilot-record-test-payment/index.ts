import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {inspectExistingPilotPayment} from "../../payments/mercadopago-pilot-payment-audit.mjs";

/** Owner-consented recording of already-approved test-account payment.
 * Only GETs Mercado Pago. Service-only DB RPC stores idempotent audit,
 * never grants entitlement, never initiates a charge or opens checkout.
 */
const ORIGIN="https://spuklab.github.io";
const TENANT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER="alma.y.pampa@gmail.com";
const BUYER_DIGEST="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f";
const HEADERS={"Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Cache-Control":"no-store","Vary":"Origin"};
const response=(status:number,code:string,n=0)=>Response.json({
 ok:status===200,code,recorded_count:n,entitlement_activated:false,
 payment_created:false,subscription_created:false
},{status,headers:HEADERS});
const env=(key:string)=>Deno.env.get(key)?.trim()||"";
async function digest(s:string){
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
 return [...hash].map(b=>b.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="POST")return response(405,"method_not_allowed");
 if(req.headers.get("origin")!==ORIGIN)return response(403,"origin_not_allowed");
 if(env("CITHELA_MP_PILOT_CHECKOUT_ENABLED")!=="true")return response(503,"pilot_disabled");
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return response(401,"unauthenticated");
 let body:any;
 try{
  const text=await req.text();
  if(text.length>256)return response(413,"request_too_large");
  body=JSON.parse(text);
 }catch{return response(400,"invalid_request");}
 if(!body||Object.keys(body).sort().join(",")!=="consent,tenantId"||
   body.tenantId!==TENANT||body.consent!==true)
  return response(403,"owner_consent_required");
 try{
  const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
  const key=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return response(503,"server_unavailable");
  const db=createClient(env("SUPABASE_URL"),key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(jwt);
  if(authError||!user)return response(401,"unauthenticated");
  if(!user.email_confirmed_at||user.email?.toLowerCase()!==OWNER)
   return response(403,"internal_owner_only");
  const {data:intent,error:snapError}=await db.rpc("cithela_mp_test_subscription_snapshot",{
   p_tenant_id:TENANT,p_owner_user_id:user.id
  });
  if(snapError||intent?.code!=="snapshot"||intent.stage!=="linked"||
    intent.live_mode!==false||intent.amount_minor!==100000||intent.currency_id!=="ARS")
   return response(409,"linked_test_subscription_required");

  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
  const sellerId=env("CITHELA_MP_MERCHANT_USER_ID");
  const buyerId=env("CITHELA_MP_TEST_BUYER_ID");
  const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||
     !/^\d{1,30}$/.test(sellerId)||!/^\d{1,30}$/.test(buyerId)||
     sellerId===buyerId||sellerId!==intent.collector_id||!buyerEmail||
     (await digest(buyerId+":"+buyerEmail.toLowerCase()))!==BUYER_DIGEST)
   return response(503,"test_credentials_unverified");

  const audited=await inspectExistingPilotPayment({
   intent,buyerId,buyerEmail,includeEvidence:true,
   async getProvider(path:string){
    if(!path.startsWith("/")||path.includes(".."))throw Error("invalid_read_path");
    const res=await fetch("https://api.mercadopago.com"+path,{
     method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
     signal:AbortSignal.timeout(12000),redirect:"error"
    });
    if(!res.ok)throw Error("provider_unavailable");
    return res.json();
   }
  });
  if(!audited.ok||audited.code!=="approved_test_payment_verified_read_only")
   return response(409,"approved_test_payment_not_verified");
  const evidence=audited.evidence;
  if(!Array.isArray(evidence)||evidence.length!==1||
     audited.verified_payments!==1||audited.provider_live_mode_true!==true||
     evidence[0]?.provider_live_mode!==true)
   return response(409,"single_test_payment_evidence_required");

  // Called only from authenticated server with service-role credential.
  // DB hardcodes internal pilot, test buyer/seller, amount, ownership and mode.
  const item=evidence[0];
  const {data:write,error:writeError}=await db.rpc(
   "cithela_mp_record_test_account_verified_payment",{
    p_subscription_id:intent.provider_subscription_id,
    p_invoice_id:item.invoice_id,
    p_payment_id:item.payment_id,
    p_approved_at:item.approved_at,
    p_collector_id:intent.collector_id,
    p_amount_minor:intent.amount_minor,
    p_owner_user_id:user.id,
    p_buyer_id:buyerId,
    p_observed_live_mode:true
   });
  if(writeError)return response(503,"test_audit_storage_unavailable");
  if(write?.ok!==true)return response(409,write?.code||"test_payment_identity_conflict");
  const acceptable=["test_payment_recorded_no_activation","already_recorded_no_activation"];
  if(!acceptable.includes(write.code))return response(409,"test_audit_status_unexpected");
  console.info("cithela_mp_test_account_payment_audited",JSON.stringify({
   source:"independent_provider_GET",signed_event_required_for_commercial:false,
   approval_verified:true,record_only:true,entitlement_activation:false
  }));
  return response(200,write.code,1);
 }catch{
  return response(503,"test_payment_verification_unavailable");
 }
});