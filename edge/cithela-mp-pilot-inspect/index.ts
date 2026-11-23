import {createClient} from "npm:@supabase/supabase-js@2.117.2";
/** Read-only inspection of a potentially created Mercado Pago test preapproval.
 * Never changes CITHELA/MP state, exposes provider IDs, or creates payment requests.
 */
const ORIGIN="https://spuklab.github.io";
const TENANT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER="alma.y.pampa@gmail.com";
const HEADERS={
 "Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Cache-Control":"no-store","Vary":"Origin"
};
const output=(status:number,code:string,checks?:Record<string,unknown>)=>
 Response.json({ok:status===200,code,...(checks?{checks}:{})},{status,headers:HEADERS});
const env=(key:string)=>Deno.env.get(key)?.trim()||"";
const validId=(x:unknown)=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,120}$/.test(x);
const sellerTest=(s:any,id:string)=>String(s?.id)===id&&s?.site_id==="MLA"&&
 Array.isArray(s?.tags)&&s.tags.includes("test_user");
const mode=(x:unknown)=>x===true?"true":x===false?"false":"not_returned";
const money=(x:unknown)=>{
 if(typeof x==="number"&&Number.isFinite(x))return x;
 if(typeof x==="string"&&/^\d+(?:\.\d{1,2})?$/.test(x))return Number(x);
 return null;
};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="POST")return output(405,"method_not_allowed");
 if(req.headers.get("origin")!==ORIGIN)return output(403,"origin_not_allowed");
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return output(401,"unauthenticated");
 let body:any;
 try{const raw=await req.text();if(raw.length>256)return output(413,"request_too_large");
  body=JSON.parse(raw)}catch{return output(400,"invalid_request")}
 if(!body||Object.keys(body).join(",")!=="tenantId"||body.tenantId!==TENANT)
   return output(403,"internal_pilot_only");
 try{
  const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
  const key=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return output(503,"server_configuration_missing");
  const db=createClient(env("SUPABASE_URL"),key,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authErr}=await db.auth.getUser(jwt);
  if(authErr||!user)return output(401,"unauthenticated");
  if(!user.email_confirmed_at||user.email?.toLowerCase()!==OWNER)
    return output(403,"owner_only");
  const pre=await db.rpc("cithela_mp_test_preflight",
    {p_tenant_id:TENANT,p_owner_user_id:user.id});
  if(pre.error||pre.data?.code!=="eligible")return output(403,"preflight_required");
  const state=await db.rpc("cithela_mp_test_subscription_snapshot",
    {p_tenant_id:TENANT,p_owner_user_id:user.id});
  const i=state.data;
  if(state.error||i?.code!=="snapshot"||i.stage!=="prepared"||
      i.provider_subscription_id!==null||i.live_mode!==false)
    return output(409,"no_unlinked_test_intent");
  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
  const sellerId=env("CITHELA_MP_MERCHANT_USER_ID");
  const buyerId=env("CITHELA_MP_TEST_BUYER_ID");
  const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||
     !/^\d{1,30}$/.test(sellerId)||!/^\d{1,30}$/.test(buyerId)||
     buyerId===sellerId||!buyerEmail||i.collector_id!==sellerId)
    return output(503,"test_configuration_missing");
  async function get(path:string){
   const response=await fetch("https://api.mercadopago.com"+path,{
    headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    signal:AbortSignal.timeout(12000),redirect:"error"
   });
   if(!response.ok)throw Error("provider_error");
   return response.json();
  }
  const [seller,buyer]=await Promise.all([get("/users/me"),get("/users/"+buyerId)]);
  if(!sellerTest(seller,sellerId)||String(buyer?.id)!==buyerId||
    buyer?.site_id!=="MLA"||
    (buyer?.email!=null&&buyer.email.toLowerCase()!==buyerEmail.toLowerCase()))
    return output(403,"test_accounts_unverified");
  async function search(filter:Record<string,string>){
   const items:any[]=[];let total:number|null=null;
   for(let offset=0;offset<1000;offset+=100){
     const qs=new URLSearchParams({...filter,limit:"100",offset:String(offset)});
     const page=await get("/preapproval/search?"+qs);
     if(!Array.isArray(page?.results)||!Number.isSafeInteger(page?.paging?.total)||
       page.paging.total<0||(total!==null&&total!==page.paging.total))
       return {items,complete:false};
     total=page.paging.total;items.push(...page.results);
     if(items.length===total)return {items,complete:true};
     if(items.length>total||page.results.length===0)return {items,complete:false};
   }
   return {items,complete:false};
  }
  const [a,b,c]=await Promise.all([
    search({payer_email:buyerEmail}),search({payer_id:buyerId}),search({})
  ]);
  if(!a.complete||!b.complete||!c.complete)return output(409,"provider_lookup_incomplete");
  const matches=new Map<string,any>();
  for(const item of [...a.items,...b.items,...c.items]){
   if(item?.external_reference===i.external_reference&&validId(item?.id))
     matches.set(item.id,item);
  }
  if(matches.size===0)return output(409,"no_match_do_not_retry");
  if(matches.size!==1)return output(409,"multiple_matches_manual_review");
  const providerId=[...matches.keys()][0];
  const detail=await get("/preapproval/"+encodeURIComponent(providerId));
  const amt=money(detail?.auto_recurring?.transaction_amount);
  const checks={
    provider_record_found:true,
    id_matches:detail?.id===providerId,
    reference_matches:detail?.external_reference===i.external_reference,
    seller_matches:String(detail?.collector_id)===sellerId,
    currency_matches:detail?.auto_recurring?.currency_id==="ARS",
    amount_matches:amt!==null&&Math.round(amt*100)===i.amount_minor,
    amount_returned:amt!==null,
    live_mode:mode(detail?.live_mode),
    payer_id_mode:detail?.payer_id==null?"not_returned":
      String(detail.payer_id)===buyerId?"matches":"mismatch",
    status:["pending","authorized","paused","cancelled","canceled"].includes(detail?.status)?
      detail.status:"other",
    checkout_url_present:typeof detail?.init_point==="string"
  };
  // Log only booleans and known enum values. No IDs, payloads, buyer data, token or URL.
  console.info("cithela_mp_readonly_inspection",JSON.stringify(checks));
  return output(200,"provider_record_inspected",checks);
 }catch{
  return output(503,"read_only_inspection_unavailable");
 }
});
