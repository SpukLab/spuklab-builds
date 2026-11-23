import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {verifyLinkedTestCheckout} from "../../payments/mercadopago-linked-checkout.mjs";

/** Only GET the already-linked internal test subscription. Never POST to Mercado Pago or modify DB. */
const ORIGIN="https://spuklab.github.io";
const TENANT="e680ebd3-a031-4968-905a-e829ab3b5dfe";
const OWNER="alma.y.pampa@gmail.com";
const BUYER_DIGEST="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f";
const HEADERS={
 "Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Cache-Control":"no-store","Vary":"Origin"
};
const out=(status:number,code:string,url?:string)=>
 Response.json({ok:status===200,code,...(url?{checkout_url:url}:{})},{status,headers:HEADERS});
const env=(s:string)=>Deno.env.get(s)?.trim()||"";
const accountIsTest=(account:any,uid:string)=>
 String(account?.id)===uid&&account?.site_id==="MLA"&&
 Array.isArray(account?.tags)&&account.tags.includes("test_user");
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
  const raw=await req.text();
  if(raw.length>256)return out(413,"request_too_large");
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

  const args={p_tenant_id:TENANT,p_owner_user_id:user.id};
  // DB RPC verifies that authenticated owner is a member and has matching entitlement.
  const {data:i,error:snapshotError}=await db.rpc("cithela_mp_test_subscription_snapshot",args);
  if(snapshotError||i?.code!=="snapshot"||i.stage!=="linked"||
    i.provider_subscription_id==null||i.live_mode!==false||i.currency_id!=="ARS")
    return out(409,"linked_subscription_not_found");

  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN");
  const sellerId=env("CITHELA_MP_MERCHANT_USER_ID");
  const buyerId=env("CITHELA_MP_TEST_BUYER_ID");
  const buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||!/^\d{1,30}$/.test(sellerId)||
     !/^\d{1,30}$/.test(buyerId)||buyerId===sellerId||
     !buyerEmail||i.collector_id!==sellerId||
     (await digest(buyerId+":"+buyerEmail.toLowerCase()))!==BUYER_DIGEST)
    return out(503,"test_configuration_missing");

  async function get(path:string){
   const response=await fetch("https://api.mercadopago.com"+path,{
    headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    signal:AbortSignal.timeout(12000),redirect:"error"
   });
   if(!response.ok)throw Error("provider_get_failed");
   return response.json();
  }
  const [seller,buyer,detail]=await Promise.all([
   get("/users/me"),
   get("/users/"+buyerId),
   get("/preapproval/"+encodeURIComponent(i.provider_subscription_id))
  ]);
  const sellerVerified=accountIsTest(seller,sellerId);
  // The buyer lookup may omit tags; its server-bound ID, country and email are sufficient.
  const buyerVerified=String(buyer?.id)===buyerId&&buyer?.site_id==="MLA"&&
    (buyer?.email==null||buyer.email.toLowerCase()===buyerEmail.toLowerCase());
  const recovered=verifyLinkedTestCheckout({
   intent:i,detail,buyerId,verifiedTestSeller:sellerVerified,verifiedTestBuyer:buyerVerified
  });
  if(!recovered.ok)return out(409,recovered.code);
  // HTTPS link only for the authenticated owner. Never log the ID, email, token or URL.
  console.info("cithela_mp_linked_checkout_retrieved",JSON.stringify({
   test:true,provider_verified:true,payment_verified:false,db_write:false
  }));
  return out(200,recovered.code,recovered.checkout_url);
 }catch{
  return out(503,"read_only_link_unavailable");
 }
});
