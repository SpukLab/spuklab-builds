import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {DENTRIX_TENANT,DENTRIX_OWNER,ALMA_TENANT,TEST_SELLER,TEST_BUYER,isDentrixOwner,inspectDentrixPreflight} from "../../payments/mercadopago-dentrix-preflight.mjs";
import {closePreviousTest} from "../../payments/mercadopago-close-old-test.mjs";
const origin="https://spuklab.github.io";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Cache-Control":"no-store","Vary":"Origin"};
const reply=(status:number,data:object)=>Response.json(data,{status,headers});
const fail=(status:number,code:string)=>reply(status,{ok:false,code,checkout_enabled:false,charge_created:false});
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
Deno.serve(async (req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return fail(405,"method_not_allowed");
 if(req.headers.get("origin")!==origin)return fail(403,"origin_not_allowed");
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return fail(401,"unauthenticated");
 try{
  const raw=await req.text();
  if(raw.length>128)return fail(413,"request_too_large");
  let body;try{body=JSON.parse(raw);}catch{return fail(400,"invalid_request");}
  if(!body||Object.keys(body).sort().join(",")!=="action,consent"||body.action!=="cancel_old_test"||body.consent!==true)return fail(400,"invalid_request");
  const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
  const secret=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");
  if(!secret)return fail(503,"server_unavailable");
  const db=createClient(env("SUPABASE_URL"),secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await db.auth.getUser(jwt);
  if(authError||!user)return fail(401,"unauthenticated");
  if(!user.email_confirmed_at||user.email?.toLowerCase()!=="alma.y.pampa@gmail.com")return fail(403,"internal_owner_only");
  const {data:oldIntent,error:oldError}=await db.rpc("cithela_mp_test_subscription_snapshot",{p_tenant_id:ALMA_TENANT,p_owner_user_id:user.id});
  if(oldError||oldIntent?.code!=="snapshot"||oldIntent.stage!=="linked"||!/^[A-Za-z0-9_-]{1,100}$/.test(oldIntent.provider_subscription_id||""))return fail(409,"previous_subscription_unverified");
  const token=env("CITHELA_MP_TEST_ACCESS_TOKEN"),buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
  if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||env("CITHELA_MP_MERCHANT_USER_ID")!==TEST_SELLER||env("CITHELA_MP_TEST_BUYER_ID")!==TEST_BUYER||!buyerEmail)return fail(503,"test_configuration_missing");
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(TEST_BUYER+":"+buyerEmail.toLowerCase())));
  const digest=[...hash].map(n=>n.toString(16).padStart(2,"0")).join("");
  async function get(path:string){
   const res=await fetch("https://api.mercadopago.com"+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error"});
   if(!res.ok)throw Error("provider_read_unavailable");
   return await res.json();
  }
  const [seller,buyer,oldSubscription]=await Promise.all([get("/users/me"),get("/users/"+TEST_BUYER),get("/preapproval/"+encodeURIComponent(oldIntent.provider_subscription_id))]);
  const path="/preapproval/"+encodeURIComponent(oldIntent.provider_subscription_id);
  const result=await closePreviousTest({seller,buyer,oldIntent,oldSubscription,buyerEmail,buyerDigestMatches:digest==="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f",consent:body.consent,
   read:()=>get(path),
   async update(){
    const response=await fetch("https://api.mercadopago.com"+path,{method:"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({status:"canceled"}),signal:AbortSignal.timeout(10000),redirect:"error"});
    if(!response.ok)throw Error("cancel_request_failed");
   }
  });
  return reply(result.ok?200:409,result);
 }catch{return fail(503,"provider_or_storage_unavailable");}
});
