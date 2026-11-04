// CITHELA — disabled-by-default, TEST-ONLY opt-in intent endpoint.
// No Mercado Pago API call. No money movement. NEVER add public production mode.
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {handleCithelaMpTestIntent} from "../../payments/mercadopago-test-intent-handler.mjs";

function secretKey():string|null{
 try{
  const v=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
  if(typeof v.default==="string"&&v.default)return v.default;
 }catch{}
 return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||null;
}
Deno.serve(async(request:Request)=>{
 const url=Deno.env.get("SUPABASE_URL")||"";
 const key=secretKey();
 const merchantUserId=Deno.env.get("CITHELA_MP_MERCHANT_USER_ID")||"";
 const amountString=Deno.env.get("CITHELA_MP_TEST_AMOUNT_MINOR")||"";
 const amountMinor=/^[1-9][0-9]{2,10}$/.test(amountString)?Number(amountString):NaN;
 // Not configured or enabled on any existing public subscription.
 const enabled=Deno.env.get("CITHELA_MP_TEST_INTENT_ENABLED")==="true" &&
   !!url && !!key && Number.isSafeInteger(amountMinor) &&
   /^[0-9]{1,30}$/.test(merchantUserId);

 const admin=enabled?createClient(url,key!,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 }):null;
 return handleCithelaMpTestIntent(request,{
   enabled,merchantUserId,amountMinor,
   randomUUID:()=>crypto.randomUUID(),
   async resolveActor(token:string){
     if(!admin)return null;
     const {data:{user},error}=await admin.auth.getUser(token);
     if(error||!user)return null;
     return {id:user.id,emailConfirmed:!!user.email_confirmed_at};
   },
   async prepareIntent(intent:any){
     if(!admin)throw Error("disabled");
     const {data,error}=await admin.rpc('cithela_mp_prepare_test_intent',{
       p_tenant_id:intent.tenantId,
       p_owner_user_id:intent.ownerUserId,
       p_external_reference:intent.externalReference,
       p_collector_id:intent.collectorId,
       p_amount_minor:intent.amountMinor,
       p_terms_version:intent.termsVersion
     });
     if(error)throw Error("intent_unavailable");
     return data;
   }
 });
});
