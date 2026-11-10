// Candidate, not deployed. Gateway verify_jwt=false is required for the bounded status action.
// Every other action resolves the JWT with Auth and administration also verifies its UID.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleSelfservice} from '../../commercial/selfservice-handler.mjs';
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const adminId=Deno.env.get('CITHELA_COMMERCIAL_ADMIN_USER_ID')||'';
 const captchaSecret=Deno.env.get('CITHELA_TURNSTILE_SECRET')||'';
 const sitekey=Deno.env.get('CITHELA_TURNSTILE_SITEKEY')||'';
 const ready=!!url&&!!key&&!!adminId;
 const enabled=ready&&Deno.env.get('CITHELA_SELFSERVICE_ENABLED')==='true'&&!!captchaSecret&&!!sitekey;
 const client=ready?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
 return handleSelfservice(req,{
  ready,enabled,adminId,sitekey,
  async resolveUser(jwt:string){const {data:{user},error}=await client!.auth.getUser(jwt);return error||!user?null:{id:user.id,emailConfirmed:!!user.email_confirmed_at}},
  async verifyCaptcha(token:string){
   if(!enabled)return false;
   const res=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:captchaSecret,response:token}),signal:AbortSignal.timeout(8000)});
   if(!res.ok)return false;
   const data=await res.json();
   return data.success===true&&data.hostname==='spuklab.github.io'&&data.action==='cithela-admission';
  },
  async execute(actor:string|null,action:string,payload:unknown){const {data,error}=await client!.rpc('cithela_selfservice_command',{p_actor:actor,p_admin:adminId,p_action:action,p_payload:payload});if(error)throw Error('command_failed');return data}
 });
});
