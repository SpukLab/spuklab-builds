import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {inspectExistingPilotPayment} from "../../payments/mercadopago-pilot-payment-audit.mjs";
import {classifyProviderRead,classifyProviderTransport,safeProviderReadCode} from "../../payments/mercadopago-provider-diagnostics.mjs";

/** No payment creation. No DB writes. Owner-only, internal pilot, test seller. */
const ORIGIN="https://spuklab.github.io";
const TENANT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER="alma.y.pampa@gmail.com";
const BUYER_DIGEST="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f";
const HEADERS={
 "Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Cache-Control":"no-store","Vary":"Origin"
};
const CHECKS=new Set([
 "payment_evidence_missing","payment_reference_mismatch","payment_status_not_approved",
 "payment_approval_date_missing","payment_currency_mismatch","payment_amount_mismatch",
 "payment_seller_mismatch","payment_mode_missing","payment_mode_true","payment_mode_unexpected"
]);
const out=(status:number,code:string,count?:number,checks:string[]=[],providerModeTrue=false)=> 
 Response.json({ok:status===200,code,...(count===undefined?{}:{verified_payments:count}),
  ...(status!==200&&checks.length?{failed_checks:checks.filter(c=>CHECKS.has(c)).slice(0,10)}:{}),
  ...(status===200&&providerModeTrue?{provider_live_mode_true:true}:{}),
  modifies_payment:false,modifies_subscription:false,activates_service:false},
 {status,headers:HEADERS});
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
async function digest(s:string){
 const bytes=new TextEncoder().encode(s);
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="POST")return out(405,"method_not_allowed");
 if(req.headers.get("origin")!==ORIGIN)return out(403,"origin_not_allowed");
 if(env("CITHELA_MP_PILOT_CHECKOUT_ENABLED")!=="true")return out(503,"pilot_disabled");

 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return out(401,"unauthenticated");
 let body:any;
 try{
  const raw=await req.text();if(raw.length>256)return out(413,"request_too_large");
  body=JSON.parse(raw);
 }catch{return out(400,"invalid_request");}
 if(!body||Object.keys(body).join(",")!=="tenantId"||body.tenantId!==TENANT)
  return out(403,"pilot_only");

 try{
  const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
  const serviceKey=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)return out(503,"server_unavailable");
  const db=createClient(env("SUPABASE_URL"),serviceKey,
   {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(jwt);
  if(authError||!user)return out(401,"unauthenticated");
  if(!user.email_confirmed_at||user.email?.toLowerCase()!==OWNER)
   return out(403,"internal_owner_only");

  const {data:intent,error:snapshotError}=await db.rpc("cithela_mp_test_subscription_snapshot",{
   p_tenant_id:TENANT,p_owner_user_id:user.id
  });
  if(snapshotError||intent?.code!=="snapshot"||intent.stage!=="linked"||
    intent.live_mode!==false||intent.amount_minor!==100000||intent.currency_id!=="ARS")
   return out(409,"linked_test_subscription_not_found");

  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
  const sellerId=env("CITHELA_MP_MERCHANT_USER_ID");
  const buyerId=env("CITHELA_MP_TEST_BUYER_ID");
  const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||
     !/^\d{1,30}$/.test(sellerId)||!/^\d{1,30}$/.test(buyerId)||
     sellerId===buyerId||sellerId!==intent.collector_id||!buyerEmail||
     (await digest(buyerId+":"+buyerEmail.toLowerCase()))!==BUYER_DIGEST)
   return out(503,"test_credentials_unverified");

  const result=await inspectExistingPilotPayment({
   intent,buyerId,buyerEmail,
   async getProvider(path:string){
    if(!path.startsWith("/")||path.includes(".."))throw Error("provider_path_invalid");
    let response:Response;
    try{
     response=await fetch("https://api.mercadopago.com"+path,{
      method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(12000),redirect:"error"
     });
    }catch{
     throw Error(classifyProviderTransport(path));
    }
    if(!response.ok)throw Error(classifyProviderRead(path,response.status));
    try{
     return await response.json();
    }catch{
     const stage=classifyProviderTransport(path).replace(/_transport$/,"_invalid_json");
     throw Error(stage);
    }
   }
  });
  if(!result.ok){
   const expected=[
    "invoice_not_found","no_approved_invoice","invoice_no_payment_reference",
    "payment_not_verified","subscription_mismatch","invoice_mismatch",
    "invoice_identity_ambiguous","invoice_wrong_subscription",
    "invoice_search_incomplete","too_many_invoices_for_pilot",
    "test_seller_not_verified","subscription_identity_mismatch","invalid_approval_date"
   ];
   const code=expected.includes(result.code)?result.code:"payment_read_only_unverified";
   return out(409,code,undefined,
     "checks" in result && Array.isArray(result.checks)?result.checks:[]);
  }
  if(!("verified_payments" in result)||
     !Number.isSafeInteger(result.verified_payments)||
     result.verified_payments<1)
   return out(503,"payment_read_only_unverified");
  console.info("cithela_mp_pilot_payment_audited_read_only",{verified:true,write:false});
  return out(200,"approved_test_payment_verified_read_only",
   result.verified_payments,[],result.provider_live_mode_true===true);
 }catch(error){
  const code=safeProviderReadCode(error);
  // Only a fixed enum goes to Edge logs and the authenticated owner.
  // Never expose body, token, payment identifiers, headers or exception text.
  console.info("cithela_mp_pilot_provider_read_diagnostic",code);
  return out(503,code);
 }
});
