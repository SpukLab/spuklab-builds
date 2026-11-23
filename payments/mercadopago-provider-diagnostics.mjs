/**
 * Server-only, bounded diagnostic categories for Mercado Pago READ endpoints.
 * Do not log or return URL paths, IDs, tokens, response JSON or headers.
 */
export function classifyProviderRead(path,status){
 const stage=path==='/users/me'?'seller':
   /^\/preapproval\/[A-Za-z0-9_-]{1,120}$/.test(path)?'subscription':
   /^\/authorized_payments\/search\?/.test(path)?'invoice_search':
   /^\/authorized_payments\/[0-9]{1,30}$/.test(path)?'invoice':
   /^\/v1\/payments\/[0-9]{1,30}$/.test(path)?'payment':'unknown';
 const statusClass=status===401?'401':status===403?'403':
  status===404?'404':status===429?'429':
  status===400?'400':status>=500&&status<=599?'5xx':
  status>=400&&status<=499?'4xx':'unexpected';
 return 'mp_'+stage+'_http_'+statusClass;
}
export function classifyProviderTransport(path){
 const stage=path==='/users/me'?'seller':
   /^\/preapproval\/[A-Za-z0-9_-]{1,120}$/.test(path)?'subscription':
   /^\/authorized_payments\/search\?/.test(path)?'invoice_search':
   /^\/authorized_payments\/[0-9]{1,30}$/.test(path)?'invoice':
   /^\/v1\/payments\/[0-9]{1,30}$/.test(path)?'payment':'unknown';
 return 'mp_'+stage+'_transport';
}
export function safeProviderReadCode(error){
 const code=error instanceof Error?error.message:'';
 return /^mp_(seller|subscription|invoice_search|invoice|payment|unknown)_(transport|invalid_json|http_(400|401|403|404|429|4xx|5xx|unexpected))$/.test(code)?
  code:'provider_read_only_unavailable';
}
