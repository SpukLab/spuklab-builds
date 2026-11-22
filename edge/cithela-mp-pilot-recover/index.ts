import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {assessProviderAbsence} from "../../payments/mercadopago-safe-abandon.mjs";

// Internal-only recovery. Does not create, modify or cancel Mercado Pago subscriptions.
const ORIGIN="https://spuklab.github.io";
const PILOT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER_EMAIL="alma.y.pampa@gmail.com";
const HEADERS={"Access-Control-Allow-Origin":ORIGIN,
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Cache-Control":"no-store","Vary":"Origin"};
const out=(status:number,code:string)=>Response.json({ok:status===200,code},{status,headers:HEADERS});
const env=(key:string)=>Deno.env.get(key)?.trim()||"";
const digits=(x:string)=>/^\d{1,30}$/.test(x);
const isTest=(a:any,id:string)=>String(a?.id)===id && a?.site_id==="MLA" &&
  Array.isArray(a?.tags) && a.tags.includes("test_user");

async function digest(s:string) {
  const bytes=new TextEncoder().encode(s);
  const result=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return Array.from(result,b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
  if(req.method!=="POST")return out(405,"method_not_allowed");
  if(req.headers.get("origin")!==ORIGIN)return out(403,"origin_not_allowed");
  // Separate explicit recovery switch, disabled by default.
  if(env("CITHELA_MP_PILOT_CHECKOUT_ENABLED")!=="true")return out(503,"recovery_disabled");
  const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
  if(!jwt)return out(401,"unauthenticated");
  let body:any;
  try{const raw=await req.text();if(raw.length>400)return out(413,"request_too_large");
    body=JSON.parse(raw);}catch{return out(400,"invalid_request");}
  if(!body||Object.keys(body).sort().join(",")!=="consent,tenantId"||
     body.tenantId!==PILOT||body.consent!==true)return out(403,"explicit_recovery_consent_required");

  try{
    const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
    const serviceKey=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
    if(!serviceKey)return out(503,"server_unavailable");
    const db=createClient(env("SUPABASE_URL"),serviceKey,
      {auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await db.auth.getUser(jwt);
    if(authError||!user)return out(401,"unauthenticated");
    if(!user.email_confirmed_at||user.email?.toLowerCase()!==OWNER_EMAIL)
      return out(403,"internal_owner_only");
    const preflight=await db.rpc("cithela_mp_test_preflight",
      {p_tenant_id:PILOT,p_owner_user_id:user.id});
    if(preflight.error||preflight.data?.code!=="eligible")return out(403,"preflight_required");
    const snap=await db.rpc("cithela_mp_test_subscription_snapshot",
      {p_tenant_id:PILOT,p_owner_user_id:user.id});
    const intent=snap.data;
    if(snap.error||intent?.code!=="snapshot"||intent.stage!=="prepared"||
       intent.provider_subscription_id!==null||intent.live_mode!==false)
      return out(409,"intent_not_recoverable");

    const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
    const merchant=env("CITHELA_MP_MERCHANT_USER_ID");
    const buyer=env("CITHELA_MP_TEST_BUYER_ID");
    const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
    if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||!digits(merchant)||
      !digits(buyer)||buyer===merchant||!buyerEmail||
      intent.collector_id!==merchant)return out(503,"test_configuration_missing");
    if(await digest(buyer+":"+buyerEmail.toLowerCase())!==
       "933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f")
      return out(403,"test_accounts_unverified");

    async function get(path:string) {
      const response=await fetch("https://api.mercadopago.com"+path,{
        headers:{Authorization:"Bearer "+token,Accept:"application/json"},
        signal:AbortSignal.timeout(10000),redirect:"error"});
      if(!response.ok)throw Error("provider_http_error");
      return response.json();
    }
    const [seller,buyerAccount]=await Promise.all([get("/users/me"),get("/users/"+buyer)]);
    if(!isTest(seller,merchant)||String(buyerAccount?.id)!==buyer||
       buyerAccount.site_id!=="MLA"||
       (buyerAccount.email!=null&&buyerAccount.email.toLowerCase()!==buyerEmail.toLowerCase()))
      return out(403,"test_accounts_unverified");

    async function search(filter:Record<string,string>) {
      const items:any[]=[];let total:number|null=null;
      for(let offset=0;offset<1000;offset+=100){
        const qs=new URLSearchParams({...filter,limit:"100",offset:String(offset)});
        const page=await get("/preapproval/search?"+qs);
        if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total)||
          page.paging.total<0|| (total!==null && total!==page.paging.total))
          return {complete:false,items};
        total=page.paging.total;items.push(...page.results);
        if(items.length===total)return {complete:true,items};
        if(total===null||items.length>total||page.results.length===0)return {complete:false,items};
      }
      return {complete:false,items};
    }

    // Query by both payer identities and seller inventory: never infer absence from one filter.
    const [byEmail,byId,bySeller]=await Promise.all([
      search({payer_email:buyerEmail}),search({payer_id:buyer}),search({})
    ]);
    const complete=byEmail.complete&&byId.complete&&bySeller.complete;
    const reference=intent.external_reference;
    const match=(items:any[])=>items.filter(x=>x?.external_reference===reference);
    const emailMatches=match(byEmail.items),idMatches=match(byId.items),sellerMatches=match(bySeller.items);
    console.info("cithela_mp_recovery_audit",JSON.stringify({
      phase:"provider_reconcile",email_complete:byEmail.complete,id_complete:byId.complete,
      seller_complete:bySeller.complete,email_matches:emailMatches.length,
      id_matches:idMatches.length,seller_matches:sellerMatches.length
    }));
    const decision=assessProviderAbsence({
      reference,email:byEmail,id:byId,seller:bySeller
    });
    if(!decision.ok)return out(409,decision.code);

    // No subscriber data, credentials, or provider IDs are submitted by the browser.
    // The database re-checks intent, claim, linked payment, and webhook state inside a transaction.
    const intentRow=await db.rpc("cithela_mp_abandon_verified_absent_test_intent",{
      p_intent_id:intent.intent_id,
      p_evidence_checked_at:new Date().toISOString(),
      p_email_complete:true,p_payer_id_complete:true,
      p_email_count:0,p_payer_id_count:0
    });
    if(intentRow.error)return out(503,"storage_unavailable");
    return intentRow.data?.ok===true?
      out(200,"verified_absent_intent_abandoned"):
      out(409,intentRow.data?.code||"reconciliation_rejected");
  }catch{
    return out(503,"reconciliation_unavailable");
  }
});
