// CITHELA / Mercado Pago. Read-only connectivity probe for TEST secret.
// Never returns provider payload, account data or the Access Token.
export async function checkMercadoPagoTestConnection(token, fetchImpl=globalThis.fetch) {
  if (typeof token!=='string' || !/^APP_USR-[A-Za-z0-9-]{16,}$/.test(token))
    return {ok:false,code:'test_token_missing_or_invalid_format'};
  if(typeof fetchImpl!=='function')return {ok:false,code:'network_unavailable'};
  try {
    const response=await fetchImpl('https://api.mercadopago.com/preapproval/search',{
      method:'GET',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
    if(response.status===401)return {ok:false,code:'credential_rejected'};
    if(response.status===403)return {ok:false,code:'subscription_permission_denied'};
    if(response.status===429)return {ok:false,code:'provider_rate_limited'};
    if(!response.ok)return {ok:false,code:'provider_unavailable'};
    const body=await response.json();
    if(!body||!Array.isArray(body.results)||!body.paging||
      !Number.isSafeInteger(body.paging.total)||body.paging.total<0)
      return {ok:false,code:'unexpected_provider_response'};
    return {ok:true,code:'test_api_connected'};
  }catch{
    return {ok:false,code:'provider_unavailable'};
  }
}
