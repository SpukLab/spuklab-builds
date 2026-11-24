import {createClient} from "npm:@supabase/supabase-js@2.117.2";
const ORIGIN="https://spuklab.github.io";
const HEADERS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Cache-Control":"no-store","Vary":"Origin"};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const out=(status,code,details={})=>Response.json({ok:status===200,code,...details},{status,headers:HEADERS});
function serverKey(){try{const o=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");if(typeof o.default==="string"&&o.default)return o.default;}catch{}return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
 if(req.method!=="POST")return out(405,"method_not_allowed");
 if(req.headers.get("origin")!==ORIGIN)return out(403,"origin_not_allowed");
 const token=/^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!token)return out(401,"unauthenticated");
 let body;try{const raw=await req.text();if(raw.length>1024)return out(413,"request_too_large");body=JSON.parse(raw);}catch{return out(400,"invalid_request");}
 if(!body||!["tenantId","action,tenantId"].includes(Object.keys(body).sort().join(","))||!UUID.test(body.tenantId||"")||(body.action!==undefined&&body.action!=="status"))return out(400,"invalid_tenant");
 const url=Deno.env.get("SUPABASE_URL")||"",key=serverKey();
 if(!url||!key)return out(503,"server_unavailable");
 try{
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user?.id)return out(401,"unauthenticated");
  if(!user.email_confirmed_at)return out(403,"email_not_verified");
  const {data:membership,error:memberError}=await client.from("cithela_tenant_memberships").select("role").eq("tenant_id",body.tenantId).eq("user_id",user.id).maybeSingle();
  if(memberError)return out(503,"membership_unavailable");
  if(membership?.role!=="owner")return out(403,"not_tenant_owner");
  if(body.action==="status"){
   const {data:snapshot,error:snapshotError}=await client.rpc("cithela_mp_test_subscription_snapshot",{p_tenant_id:body.tenantId,p_owner_user_id:user.id});
   if(snapshotError)return out(503,"snapshot_unavailable");
   if(!snapshot?.ok)return out(403,snapshot?.code||"not_eligible");
   // Return only non-sensitive state, never merchant identity, tokens or amounts.
   return out(200,snapshot.code,{stage:snapshot.stage||null,
    linked:!!snapshot.provider_subscription_id,live_mode:snapshot.live_mode??false,
    payment_verified:false,entitlement_activation_allowed:false});
  }
  // Private entitlements are not exposed to the public Data API; use a
  // service-role RPC instead of selecting an unexposed schema.
  const {data:prepared,error:rpcError}=await client.rpc("cithela_mp_test_preflight",{p_tenant_id:body.tenantId,p_owner_user_id:user.id});
  if(rpcError)return out(503,"preflight_unavailable");
  if(!prepared?.ok)return out(403,prepared?.code||"not_eligible");
  return out(200,"eligible_no_payment_created",{test_only:true,subscription_created:false,
    checkout_enabled:false,requires_explicit_consent:true});
 }catch{return out(503,"server_unavailable");}
});