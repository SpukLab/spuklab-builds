// CITHELA / pending transfer requests. Disabled by default; no crediting.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleTransferOrder} from '../../payments/transfer-order-handler.mjs';
function serviceKey(){
 try{const v=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
     if(typeof v.default==='string' && v.default)return v.default;}catch{}
 return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||null;
}
Deno.serve(async (req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=serviceKey();
 const alias=Deno.env.get('CITHELA_TRANSFER_ALIAS')||'';
 const holder=Deno.env.get('CITHELA_TRANSFER_HOLDER')||'';
 const enabled=Deno.env.get('CITHELA_TRANSFER_REQUESTS_ENABLED')==='true'&&!!url&&!!key&&!!alias&&!!holder;
 const client=enabled?createClient(url,key!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
 return handleTransferOrder(req,{
   enabled,alias,holder,
   async resolveUser(jwt:string){
     if(!client)return null;
     const {data:{user},error}=await client.auth.getUser(jwt);
     return error||!user?null:{id:user.id,emailConfirmed:!!user.email_confirmed_at};
   },
   async prepareOrder({actorId,tenantId,consent,termsVersion}:{actorId:string,tenantId:string,consent:boolean,termsVersion:string}){
     if(!client)throw Error('disabled');
     const {data,error}=await client.rpc('cithela_prepare_transfer_order',{
       p_actor:actorId,p_tenant_id:tenantId,p_consent:consent,p_terms_version:termsVersion
     });
     if(error)throw Error('order_unavailable');
     return data;
   }
 });
});
