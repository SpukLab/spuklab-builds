import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {checkProductionReadiness} from "../../payments/mercadopago-production-readiness.mjs";
const origin="https://spuklab.github.io";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store","Vary":"Origin"};
const reply=(status:number,data:object)=>Response.json(data,{status,headers});
const fail=(status:number,code:string)=>reply(status,{ok:false,code,checkoutEnabled:false,chargeCreated:false});
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return fail(405,"method_not_allowed");
 if(req.headers.get("origin")!==origin)return fail(403,"origin_not_allowed");
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return fail(401,"unauthenticated");
 try{
  const raw=await req.text();if(raw.length>128)return fail(400,"invalid_request");
  const body=JSON.parse(raw);if(!body||Object.keys(body).join(",")!=="action"||body.action!=="check")return fail(400,"invalid_request");
  const keys=JSON.parse(env("SUPABASE_SECRET_KEYS")||"{}");
  const secret=keys.default||env("SUPABASE_SERVICE_ROLE_KEY");if(!secret)return fail(503,"server_unavailable");
  const db=createClient(env("SUPABASE_URL"),secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(jwt);
  if(error||!user?.email_confirmed_at||user.email?.toLowerCase()!=="dentrix.8m@gmail.com")return fail(403,"internal_owner_only");
  const {data:snapshot,error:ownerError}=await db.rpc("cithela_mp_test_subscription_snapshot",{p_tenant_id:"50b3e3eb-77a5-413d-af3b-9aa5b56e833e",p_owner_user_id:user.id});
  if(ownerError||snapshot?.ok!==true||!["snapshot","no_subscription"].includes(snapshot.code))return fail(403,"not_tenant_owner");
  const config={token:env("CITHELA_MP_PROD_ACCESS_TOKEN"),secret:env("CITHELA_MP_PROD_WEBHOOK_SECRET"),merchant:env("CITHELA_MP_PROD_MERCHANT_USER_ID"),testToken:env("CITHELA_MP_TEST_ACCESS_TOKEN"),testSecret:env("CITHELA_MP_WEBHOOK_SECRET")};
  const result=await checkProductionReadiness(config,async()=>{
   const res=await fetch("https://api.mercadopago.com/users/me",{method:"GET",headers:{Authorization:"Bearer "+config.token,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error"});
   if(!res.ok)throw Error("provider_unavailable");return await res.json();
  });
  return reply(200,result);
 }catch{return fail(503,"readiness_unavailable");}
});
