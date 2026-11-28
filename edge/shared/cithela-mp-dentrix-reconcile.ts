import {reconcileDentrix,TENANT,OWNER,SELLER,BUYER} from "../../payments/mercadopago-dentrix-reconciliation.mjs";
const env=(name:string)=>Deno.env.get(name)?.trim()||"";
// Called with the service credential only, after HMAC acceptance or owner JWT verification.
export async function processDentrix(db:any,eventPaymentId?:string,expectedOwner?:string){
 const fail=(code:string)=>({ok:false,code,entitlement_activated:false});
 if(env("CITHELA_MP_PILOT_CHECKOUT_ENABLED")!=="true")return fail("pilot_disabled");
 if(eventPaymentId!==undefined&&!/^\d{1,30}$/.test(eventPaymentId))return fail("invalid_resource");
 const token=env("CITHELA_MP_TEST_ACCESS_TOKEN"),buyerEmail=env("CITHELA_MP_TEST_BUYER_EMAIL");
 if(!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token)||env("CITHELA_MP_MERCHANT_USER_ID")!==SELLER||env("CITHELA_MP_TEST_BUYER_ID")!==BUYER||!buyerEmail)return fail("test_configuration_missing");
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(BUYER+":"+buyerEmail.toLowerCase())));
 if([...hash].map(n=>n.toString(16).padStart(2,"0")).join("")!=="933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f")return fail("test_configuration_missing");
 const {data:owner,error}=await db.from("cithela_tenant_memberships").select("user_id").eq("tenant_id",TENANT).eq("role","owner").single();
 if(error||!owner||(expectedOwner&&owner.user_id!==expectedOwner))return fail("not_tenant_owner");
 const {data:{user},error:ownerError}=await db.auth.admin.getUserById(owner.user_id);
 if(ownerError||!user?.email_confirmed_at||user.email?.toLowerCase()!==OWNER)return fail("not_tenant_owner");
 const {data:intent,error:storageError}=await db.rpc("cithela_mp_test_subscription_snapshot",{p_tenant_id:TENANT,p_owner_user_id:owner.user_id});
 if(storageError||intent?.code!=="snapshot")return fail("linked_test_intent_required");
 try{
  return await reconcileDentrix({intent,buyerEmail,eventPaymentId,
   async getProvider(path:string){
    if(!path.startsWith("/")||path.includes(".."))throw Error("invalid_read_path");
    const res=await fetch("https://api.mercadopago.com"+path,{method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:AbortSignal.timeout(8000),redirect:"error"});
    if(!res.ok)throw Error(path.startsWith("/authorized_payments/search?")&&res.status===400?"mp_invoice_search_http_400":"provider_read_unavailable");
    return await res.json();
   },
   async commit(evidence:any){
    const {data,error}=await db.rpc("cithela_mp_reconcile_dentrix_test",{p_subscription_id:intent.provider_subscription_id,p_invoice_id:evidence.invoice_id,p_payment_id:evidence.payment_id,p_approved_at:evidence.approved_at,p_owner_user_id:owner.user_id});
    if(error)throw Error("reconciliation_storage_unavailable");
    return data;
   }
  });
 }catch(error){return fail(error instanceof Error&&["provider_application_mismatch","provider_read_unavailable","reconciliation_storage_unavailable"].includes(error.message)?error.message:"reconciliation_unavailable");}
}
