// Protected endpoint for the professional pilot invitation lifecycle.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handlePilotInvitations} from '../../commercial/pilot-invitations-handler.mjs';
function serverKey(){
 try{const values=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
 if(typeof values.default==='string'&&values.default)return values.default;
 }catch{}
 return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||null;
}
Deno.serve(async request=>{
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=serverKey();
 const adminId=Deno.env.get('CITHELA_COMMERCIAL_ADMIN_USER_ID')||'';
 const enabled=Deno.env.get('CITHELA_COMMERCIAL_CONSOLE_ENABLED')==='true'
  && Deno.env.get('CITHELA_PILOT_INVITES_ENABLED')==='true'
  && !!url && !!key;
 const client=enabled?createClient(url,key!,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 }):null;
 return handlePilotInvitations(request,{
  enabled,adminId,
  async resolveUser(jwt){
   if(!client)return null;
   const {data:{user},error}=await client.auth.getUser(jwt);
   if(error||!user)return null;
   return {id:user.id,emailConfirmed:!!user.email_confirmed_at};
  },
  async execute(id,action,email){
   if(!client)throw Error('disabled');
   const {data,error}=await client.rpc('cithela_pilot_invitation_command',{
    p_actor:id,p_action:action,p_email:email
   });
   if(error)throw Error('command_failed');
   return data;
  }
 });
});