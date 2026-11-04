// CITHELA — protected SpukLab commercial console, not a public customer API.
// Remains inactive until both a verified admin UID and the explicit enable flag
// are saved as Supabase Edge secrets. No data deletion and no Mercado Pago writes.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleCithelaCommercialAdmin} from '../../commercial/commercial-admin-handler.mjs';

function serverKey():string|null {
  try {
    const values=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    if(typeof values.default==='string'&&values.default)return values.default;
  }catch{}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||null;
}
Deno.serve(async(request:Request)=>{
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=serverKey();
  const adminId=Deno.env.get('CITHELA_COMMERCIAL_ADMIN_USER_ID')||'';
  const enabled=Deno.env.get('CITHELA_COMMERCIAL_CONSOLE_ENABLED')==='true'
    && !!url && !!key;
  const client=enabled?createClient(url,key!,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  }):null;
  return handleCithelaCommercialAdmin(request,{
    enabled,adminId,
    async resolveUser(jwt:string) {
      if(!client)return null;
      const {data:{user},error}=await client.auth.getUser(jwt);
      if(error||!user)return null;
      return {id:user.id,emailConfirmed:!!user.email_confirmed_at};
    },
    async execute(actorId:string,action:string,payload:unknown){
      if(!client)throw Error('console_disabled');
      const {data,error}=await client.rpc('cithela_commercial_admin_command',{
        p_actor:actorId,p_action:action,p_payload:payload
      });
      if(error)throw Error('command_unavailable');
      return data;
    }
  });
});
