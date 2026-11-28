import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {processDentrix} from "../shared/cithela-mp-dentrix-reconcile.ts";
const origin="https://spuklab.github.io";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Cache-Control":"no-store","Vary":"Origin"};
const reply=(status:number,data:object)=>Response.json(data,{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply(405,{ok:false,code:"method_not_allowed"});
 if(req.headers.get("origin")!==origin)return reply(403,{ok:false,code:"origin_not_allowed"});
 const jwt=/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")||"")?.[1];
 if(!jwt)return reply(401,{ok:false,code:"unauthenticated"});
 try{
  const raw=await req.text();if(raw.length>128)return reply(400,{ok:false,code:"invalid_request"});
  const body=JSON.parse(raw);
  if(!body||Object.keys(body).join(",")!=="action"||body.action!=="reconcile")return reply(400,{ok:false,code:"invalid_request"});
  const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
  const key=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)return reply(503,{ok:false,code:"server_unavailable"});
  const db=createClient(Deno.env.get("SUPABASE_URL")||"",key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(jwt);
  if(error||!user?.email_confirmed_at||user.email?.toLowerCase()!=="dentrix.8m@gmail.com")return reply(403,{ok:false,code:"internal_owner_only"});
  const result=await processDentrix(db,undefined,user.id);
  return reply(200,result);
 }catch{return reply(503,{ok:false,code:"reconciliation_unavailable"});}
});
