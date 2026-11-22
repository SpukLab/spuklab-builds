import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {runPilotCheckout} from "../../payments/mercadopago-pilot-checkout.mjs";

const origin = "https://spuklab.github.io";
const pilot = "e680ebd3-a031-4968-905a-e829ab3b5dfe";
const headers = {
  "Access-Control-Allow-Origin":origin, "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
  "Cache-Control":"no-store", "Vary":"Origin"
};
const env = (name:string) => Deno.env.get(name)?.trim() || "";
const respond = (status:number, result:object) => Response.json(result,{status,headers});
const fail = (status:number, code:string) => respond(status,{ok:false,code});

Deno.serve(async (req:Request) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers});
  if (req.method !== "POST") return fail(405,"method_not_allowed");
  if (req.headers.get("origin") !== origin) return fail(403,"origin_not_allowed");
  if (env("CITHELA_MP_PILOT_CHECKOUT_ENABLED") !== "true") return fail(503,"checkout_disabled");
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!jwt) return fail(401,"unauthenticated");

  try {
    const raw = await req.text();
    if (raw.length > 512) return fail(413,"request_too_large");
    let body;
    try { body = JSON.parse(raw); } catch { return fail(400,"invalid_request"); }
    if (!body || Object.keys(body).sort().join(",") !== "consent,tenantId" ||
        body.tenantId !== pilot || body.consent !== true) return fail(403,"pilot_consent_required");

    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    const db = createClient(env("SUPABASE_URL"),keys.default || env("SUPABASE_SERVICE_ROLE_KEY"),
      {auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error} = await db.auth.getUser(jwt);
    if (error || !user) return fail(401,"unauthenticated");
    if (!user.email_confirmed_at || user.email?.toLowerCase() !== "alma.y.pampa@gmail.com")
      return fail(403,"internal_owner_only");

    const token = env("CITHELA_MP_TEST_ACCESS_TOKEN");
    const sellerId = env("CITHELA_MP_MERCHANT_USER_ID");
    const buyerId = env("CITHELA_MP_TEST_BUYER_ID");
    const buyerEmail = env("CITHELA_MP_TEST_BUYER_EMAIL");
    const amount = Number(env("CITHELA_MP_TEST_AMOUNT_MINOR"));
    if (!/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token) || !/^\d{1,30}$/.test(sellerId) ||
        !/^\d{1,30}$/.test(buyerId) || buyerId === sellerId || !buyerEmail ||
        !Number.isSafeInteger(amount) || amount < 100 || amount > 100000000000)
      return fail(503,"test_configuration_missing");

    async function provider(path:string) {
      const response = await fetch("https://api.mercadopago.com"+path,{
        headers:{Authorization:"Bearer "+token,Accept:"application/json"},
        signal:AbortSignal.timeout(8000),redirect:"error"
      });
      if (!response.ok) throw new Error("provider_unavailable");
      return await response.json();
    }
    async function rpc(name:string,args:Record<string,unknown>) {
      const {data,error} = await db.rpc(name,args);
      if (error) throw new Error("storage_unavailable");
      return data;
    }
    // Buyer identity reviewed in the Mercado Pago test-account dashboard.
    // The seller credential cannot read the buyer's private email or tags.
    const buyerIdentity = new TextEncoder().encode(buyerId+":"+buyerEmail.toLowerCase());
    const buyerDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buyerIdentity)),
      byte => byte.toString(16).padStart(2,"0")).join("");
    const verifiedBuyerConfig = buyerDigest === "933230db26d5348de49b6db383412ca1a403b8f4e2caaa5450136075fb28547f";
    const testAccount = (account:any,id:string) => String(account?.id) === id &&
      account.site_id === "MLA" && Array.isArray(account.tags) && account.tags.includes("test_user");
    const result = await runPilotCheckout({
      request:body,actor:{id:user.id,email:user.email,emailConfirmed:true},token,
      services:{
        enabled:true,
        preflight:(tenantId:string,ownerId:string) => rpc("cithela_mp_test_preflight",
          {p_tenant_id:tenantId,p_owner_user_id:ownerId}),
        async verifyAccounts() {
          const [seller,buyer] = await Promise.all([provider("/users/me"), provider("/users/"+buyerId)]);
          return {sellerId,buyerId,buyerEmail,sellerVerified:testAccount(seller,sellerId),
            buyerVerified:verifiedBuyerConfig && String(buyer?.id) === buyerId && buyer.site_id === "MLA" &&
              (buyer.email == null || buyer.email.toLowerCase() === buyerEmail.toLowerCase())};
        },
        async prepare(tenantId:string,ownerId:string,collectorId:string) {
          const owner = {p_tenant_id:tenantId,p_owner_user_id:ownerId};
          const prepared = await rpc("cithela_mp_prepare_test_intent",{
            ...owner,p_external_reference:"cithela_"+crypto.randomUUID().replaceAll("-",""),
            p_collector_id:collectorId,p_amount_minor:amount,p_terms_version:"internal-test-only-v1"
          });
          if (!prepared?.ok) return prepared;
          const snapshot = await rpc("cithela_mp_test_subscription_snapshot",owner);
          if (snapshot?.code !== "snapshot" || snapshot.external_reference !== prepared.external_reference)
            return {ok:false,code:"intent_unavailable"};
          return {...snapshot,intent_id:prepared.intent_id,terms_version:"internal-test-only-v1"};
        },
        claim:(id:string,owner:string) => rpc("cithela_mp_claim_test_checkout",
          {p_intent_id:id,p_owner_user_id:owner}),
        async searchSubscriptions(_reference:string,email:string) {
          // A pending subscription may be discoverable under payer ID even if
          // its email search index has not populated. Both searches are read-only.
          const searchAll = async (filter:Record<string,string>) => {
            const results:any[] = [];
            let total:number|null = null;
            for (let offset=0;offset<1000;offset+=100) {
              const query = new URLSearchParams({...filter,limit:"100",offset:String(offset)});
              const page = await provider("/preapproval/search?"+query);
              if (!Array.isArray(page?.results) ||
                  !Number.isSafeInteger(page?.paging?.total) || page.paging.total < 0)
                return {results,complete:false};
              if (total===null) total=page.paging.total;
              if (total!==page.paging.total) return {results,complete:false};
              results.push(...page.results);
              if (results.length>=total) return {results,complete:results.length===total};
              if (page.results.length===0) return {results,complete:false};
            }
            return {results,complete:false};
          };
          const [byEmail,byId] = await Promise.all([
            searchAll({payer_email:email}),searchAll({payer_id:buyerId})
          ]);
          const unique = new Map<string,any>();
          for (const item of [...byEmail.results,...byId.results]) {
            if (typeof item?.id==="string") unique.set(item.id,item);
          }
          console.info('cithela_mp_lookup_diagnostic',JSON.stringify({
            phase:'recover_preapproval',email_complete:byEmail.complete,
            id_complete:byId.complete,
            email_count:byEmail.results.length,id_count:byId.results.length,
            distinct_count:unique.size
          }));
          return {results:[...unique.values()],complete:byEmail.complete && byId.complete};
        },
        link:(intent:{intent_id:string,external_reference:string},id:string) =>
          rpc("cithela_mp_link_verified_test_subscription",{
            p_intent_id:intent.intent_id,p_tenant_id:pilot,p_owner_user_id:user.id,
            p_external_reference:intent.external_reference,p_provider_subscription_id:id
          })
      }
    });
    return respond(result.ok ? 200 : 409,result);
  } catch {
    return fail(503,"checkout_unavailable");
  }
});
