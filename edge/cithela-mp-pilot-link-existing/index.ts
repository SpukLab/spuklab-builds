import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {verifyTestProviderIdentity} from "../../payments/mercadopago-test-provider.mjs";

/** Only link an independently verified existing TEST preapproval. Never POST to Mercado Pago. */
const ORIGIN="https://spuklab.github.io";
const TENANT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER="alma.y.pampa@gmail.com";
const BUYER_DIGEST="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f";
const HEADERS={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Cache-Control":"no-store","Vary":"Origin"
};
const out=(status:number,code:string,checkout_url?:string)=>
 Response.json({ok:status===200,code,...(checkout_url?{checkout_url}:{})},
   {status,headers:HEADERS});
const env=(s:string)=>Deno.env.get(s)?.trim()||"";
const id=(x:unknown)=>typeof x==="string"&&/^[A-Za-z0-9_-]{1,120}$/.test(x);
const accountIsTest=(x:any,userId:string)=>
 String(x?.id)===userId&&x?.site_id==="MLA"&&
 Array.isArray(x?.tags)&&x.tags.includes("test_user");
const amount=(x:any)=>typeof x==="number"&&Number.isFinite(x)?x:
 typeof x==="string"&&/^\d+(?:\.\d{1,2})?$/.test(x)?Number(x):null;
async function digest(s:string){
 const bytes=new TextEncoder().encode(s);
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="POST")return out(405,"method_not_allowed");
 if(req.headers.get("origin")!==ORIGIN)return out(403,"origin_not_allowed");
 if(env("CITHELA_MP_PILOT_CHECKOUT_ENABLED")!=="true")
   return out(503,"pilot_disabled");
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return out(401,"unauthenticated");
 let body:any;
 try{
  const raw=await req.text();if(raw.length>300)return out(413,"request_too_large");
  body=JSON.parse(raw);
 }catch{return out(400,"invalid_request")}
 if(!body||Object.keys(body).sort().join(",")!=="consent,tenantId"||
   body.tenantId!==TENANT||body.consent!==true)
   return out(403,"explicit_link_consent_required");

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
  const args={p_tenant_id:TENANT,p_owner_user_id:user.id};
  const {data:pre,error:preError}=await db.rpc("cithela_mp_test_preflight",args);
  if(preError||pre?.code!=="eligible")return out(403,"preflight_required");
  const {data:i,error:snapshotError}=await db.rpc("cithela_mp_test_subscription_snapshot",args);
  if(snapshotError||i?.code!=="snapshot"||i.stage!=="prepared"||
    i.live_mode!==false||i.currency_id!=="ARS"||i.provider_subscription_id!==null||
    !/^cithela_[A-Za-z0-9_-]{12,100}$/.test(i.external_reference||""))
    return out(409,"intent_not_linkable");

  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
  const sellerId=env("CITHELA_MP_MERCHANT_USER_ID");
  const buyerId=env("CITHELA_MP_TEST_BUYER_ID");
  const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||!/^\d{1,30}$/.test(sellerId)||
    !/^\d{1,30}$/.test(buyerId)||buyerId===sellerId||!buyerEmail||
    sellerId!==i.collector_id||(await digest(buyerId+":"+buyerEmail.toLowerCase()))!==BUYER_DIGEST)
    return out(503,"test_configuration_missing");

  async function get(path:string){
   const response=await fetch("https://api.mercadopago.com"+path,{
    headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    signal:AbortSignal.timeout(12000),redirect:"error"
   });
   if(!response.ok)throw Error("provider_lookup_failed");
   return response.json();
  }
  const [seller,buyer]=await Promise.all([get("/users/me"),get("/users/"+buyerId)]);
  if(!accountIsTest(seller,sellerId)||String(buyer?.id)!==buyerId||
    buyer?.site_id!=="MLA"||
    (buyer.email!=null&&buyer.email.toLowerCase()!==buyerEmail.toLowerCase()))
    return out(403,"test_accounts_unverified");

  async function search(filter:Record<string,string>){
   const items:any[]=[];let total:number|null=null;
   for(let offset=0;offset<1000;offset+=100){
    const query=new URLSearchParams({...filter,limit:"100",offset:String(offset)});
    const page=await get("/preapproval/search?"+query);
    if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total)||
      page.paging.total<0||(total!==null&&total!==page.paging.total))
      return {items,complete:false};
    total=page.paging.total;
    items.push(...page.results);
    if(items.length===total)return {items,complete:true};
    if(total===null||items.length>total||page.results.length===0)
      return {items,complete:false};
   }
   return {items,complete:false};
  }

  const [byEmail,byId,bySeller]=await Promise.all([
   search({payer_email:buyerEmail}),search({payer_id:buyerId}),search({})
  ]);
  if(!byEmail.complete||!byId.complete||!bySeller.complete)
    return out(409,"provider_lookup_incomplete");
  const ids=new Set<string>();
  for(const x of [...byEmail.items,...byId.items,...bySeller.items]){
   if(x?.external_reference===i.external_reference&&id(x.id))ids.add(x.id);
  }
  if(ids.size!==1)return out(409,ids.size===0?
    "provider_record_not_found":"multiple_provider_matches");
  const providerId=[...ids][0];
  const detail=await get("/preapproval/"+encodeURIComponent(providerId));
  if(detail?.id!==providerId||detail?.status!=="pending"||
    detail?.payer_id==null||String(detail.payer_id)!==buyerId)
    return out(409,"provider_identity_mismatch");

  const proof=verifyTestProviderIdentity({
    live_mode:false,currency_id:"ARS",external_reference:i.external_reference,
    amount_minor:i.amount_minor,collector_id:i.collector_id,
    terms_version:"internal-test-only-v1"
  },{
    ok:true,code:"read_only",provider_subscription_id:detail.id,
    external_reference:detail.external_reference,
    collector_id:detail.collector_id,live_mode:detail.live_mode,
    currency_id:detail?.auto_recurring?.currency_id,
    amount:amount(detail?.auto_recurring?.transaction_amount),
    status:detail.status
  },{verifiedTestSeller:true});
  if(!proof.ok)return out(409,"provider_identity_mismatch");

  let url:URL;
  try{url=new URL(detail?.init_point||"")}catch{return out(409,"provider_checkout_url_unavailable")}
  if(url.protocol!=="https:"||url.username||url.password||
    !/(^|\.)mercadopago\.(com|com\.ar)$/.test(url.hostname)||
    !url.pathname.startsWith("/subscriptions/checkout"))
    return out(409,"provider_checkout_url_unavailable");

  // DB RPC locks intent; only links the already-existing subscription ID.
  // No payment evidence is asserted; no entitlements are activated.
  const {data:linked,error:linkError}=await db.rpc("cithela_mp_link_verified_test_subscription",{
    p_intent_id:i.intent_id,p_tenant_id:TENANT,p_owner_user_id:user.id,
    p_external_reference:i.external_reference,p_provider_subscription_id:providerId
  });
  if(linkError)return out(503,"link_storage_unavailable");
  if(linked?.ok!==true)return out(409,linked?.code||"link_rejected");
  console.info("cithela_mp_existing_subscription_linked",JSON.stringify({
    pilot:true,provider_verified:true,amount_verified:true,payment_verified:false,
    entitlement_activation_allowed:false
  }));
  return out(200,"existing_test_subscription_linked_no_payment",url.href);
 }catch{
  return out(503,"provider_reconciliation_unavailable");
 }
});
