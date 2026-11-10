// CITHELA — share a limited professional pilot link through WhatsApp.
// Deploy with feature flag OFF. An issued link conveys no tenant or payment data.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handlePilotShareLinks} from '../../commercial/pilot-share-links-handler.mjs';
function serverKey(){
 try{const v=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  if(typeof v.default==='string'&&v.default)return v.default;}catch{}
 return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||null;
}
function generateToken():string{
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}
async function digestToken(token:string):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=serverKey();
 const adminId=Deno.env.get('CITHELA_COMMERCIAL_ADMIN_USER_ID')||'';
 const enabled= Deno.env.get('CITHELA_PILOT_SHARE_LINKS_ENABLED')==='true'
   && Deno.env.get('CITHELA_COMMERCIAL_CONSOLE_ENABLED')==='true' && !!url && !!key;
 const client=enabled?createClient(url,key!,{auth:{
   persistSession:false,autoRefreshToken:false,detectSessionInUrl:false
 }}):null;
 return handlePilotShareLinks(req,{
  enabled,adminId,generateToken,digestToken,
  async resolveUser(jwt:string){
   if(!client)return null;
   const {data:{user},error}=await client.auth.getUser(jwt);
   if(error||!user)return null;
   return {id:user.id,emailConfirmed:!!user.email_confirmed_at};
  },
  async execute(actor:string,action:string,payload:unknown){
   if(!client)throw Error('disabled');
   const {data,error}=await client.rpc('cithela_pilot_share_link_command',{
      p_actor:actor,p_action:action,p_payload:payload
   });
   if(error)throw Error('command_unavailable');
   return data;
  }
 });
});
