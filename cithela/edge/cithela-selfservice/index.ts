// Closed-by-default endpoint. Every non-public action resolves its own JWT via Auth.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleSelfservice} from '../../commercial/selfservice-handler.mjs';
function serverKey(){
 try{const v=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');if(typeof v.default==='string'&&v.default)return v.default}catch{}
 return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')||'',key=serverKey();
 const adminId=Deno.env.get('CITHELA_COMMERCIAL_ADMIN_USER_ID')||'';
 const captchaSecret=Deno.env.get('CITHELA_TURNSTILE_SECRET')||'';
 const sitekey=Deno.env.get('CITHELA_TURNSTILE_SITEKEY')||'';
 const authCaptchaRequired=Deno.env.get('CITHELA_AUTH_CAPTCHA_ENABLED')==='true';
 const ready=!!url&&!!key&&!!adminId;
 const testReady=ready&&authCaptchaRequired&&!!captchaSecret&&!!sitekey;
 const enabled=testReady&&Deno.env.get('CITHELA_SELFSERVICE_ENABLED')==='true';
 const client=ready?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
 return handleSelfservice(req,{
  ready,enabled,adminId,sitekey,authCaptchaRequired,testReady,
  async resolveUser(jwt:string){const {data:{user},error}=await client!.auth.getUser(jwt);return error||!user?null:{id:user.id,emailConfirmed:!!user.email_confirmed_at}},
  async verifyCaptcha(token:string){
   if(!testReady)return false;
   const res=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:captchaSecret,response:token}),signal:AbortSignal.timeout(8000)});
   if(!res.ok)return false;
   const data=await res.json();
   return data.success===true&&data.hostname==='spuklab.github.io'&&data.action==='cithela-admission';
  },
  async execute(actor:string|null,action:string,payload:unknown){
   const {data,error}=await client!.rpc('cithela_selfservice_command',{p_actor:actor,p_admin:adminId,p_action:action,p_payload:payload});
   if(error)throw Error('command_failed');
   if(['read','configure'].includes(action)&&data?.ok===true)data.runtime={captcha_configured:!!captchaSecret&&!!sitekey,auth_captcha_required:authCaptchaRequired,server_gate_enabled:enabled};
   return data;
  }
 });
});
