// CITHELA: platform-admin-only, READ-ONLY Mercado Pago credential probe.
// No professional/tenant credentials can request infrastructure diagnostics.
// No checkout, subscriptions, payment writes, webhook subscription, or token output.
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {checkMercadoPagoTestConnection} from "./connection.mjs";

const ORIGIN="https://spuklab.github.io";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Vary":"Origin"};
function respond(code:string,status=200) {
  return Response.json({ok:code==="test_api_connected",code},{status,headers:{
    ...CORS,"Cache-Control":"no-store","Pragma":"no-cache"
  }});
}
function serverKey():string|null{
  try {
    const map=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    if(typeof map.default==="string"&&map.default)return map.default;
  }catch{ /* fallback for existing project */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||null;
}
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return respond("method_not_allowed",405);
  if(req.headers.get("origin")&&req.headers.get("origin")!==ORIGIN)
    return respond("invalid_origin",403);
  const bearer=/^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization")||"")?.[1];
  if(!bearer)return respond("unauthenticated",401);
  const url=Deno.env.get("SUPABASE_URL");
  const key=serverKey();
  const adminId=Deno.env.get("CITHELA_COMMERCIAL_ADMIN_USER_ID")?.trim()||"";
  const enabled=Deno.env.get("CITHELA_COMMERCIAL_CONSOLE_ENABLED")==="true";
  if(!url||!key||!enabled||!UUID.test(adminId))return respond("server_unavailable",503);
  try{
    const admin=createClient(url,key,{auth:{
      persistSession:false,autoRefreshToken:false,detectSessionInUrl:false
    }});
    const {data:{user},error}=await admin.auth.getUser(bearer);
    if(error||!user?.id)return respond("unauthenticated",401);
    if(!user.email_confirmed_at||user.id.toLowerCase()!==adminId.toLowerCase())
      return respond("forbidden",403);
    const testToken=Deno.env.get("CITHELA_MP_TEST_ACCESS_TOKEN")?.trim();
    const result=await checkMercadoPagoTestConnection(testToken);
    return respond(result.code,result.ok?200:result.code==="test_token_missing_or_invalid_format"?503:502);
  }catch{return respond("server_unavailable",503);}
});
