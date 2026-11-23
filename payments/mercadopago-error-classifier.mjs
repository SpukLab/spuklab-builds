/**
 * Categorizes Mercado Pago /preapproval 400/422 responses without exposing
 * messages, identifiers, payer data, merchant data or request bodies.
 * Only a fixed enum is ever logged.
 */
export function classifyPreapprovalValidation(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return 'validation_unknown';
  const values=[response.message,response.error];
  if(Array.isArray(response.cause)) {
    for(const cause of response.cause.slice(0,10)){
      if(cause&&typeof cause==='object'){
        values.push(cause.code,cause.description);
      }
    }
  }
  const detail=values.filter(x=>typeof x==='string').map(x=>x.slice(0,350)).join(' ').toLowerCase();
  // Country restrictions sometimes arrive as {message,status:400} without error code.
  if(/different countr|countries.*different|cross.?border|country.*mismatch|different region|paises distintos|distintos paises|entre paises|diferentes paises|pais.*diferent/.test(detail))
    return 'provider_country_mismatch';
  if(/both payer and collector.*(real or test|test users)|payer.*collector.*(different.*type|real.*test|test.*real)/.test(detail))
    return 'payer_collector_mode_mismatch';
  if(/(payer_email|payer email|payer.*(not found|invalid|unknown))/.test(detail))
    return 'payer_email_invalid';
  if(/(collector_id|collector id|merchant.*(not found|invalid))/.test(detail))
    return 'seller_invalid';
  if(/(transaction_amount|amount.*(minimum|invalid|too small)|minimum.*amount)/.test(detail))
    return 'amount_invalid';
  if(/(currency_id|currency.*(invalid|unsupported))/.test(detail))
    return 'currency_invalid';
  if(/(back_url|back url|return_url)/.test(detail))
    return 'return_url_invalid';
  if(/(frequency_type|frequency|auto_recurring)/.test(detail))
    return 'recurrence_invalid';
  if(/(access|permission|application|scope)/.test(detail))
    return 'app_permission_invalid';
  if(/(status|pending)/.test(detail))
    return 'status_invalid';
  if(/(reason|description)/.test(detail))
    return 'reason_invalid';
  return 'validation_unknown';
}

/**
 * Only structural details and code-shaped identifiers are retained.
 * Never persist the free-form provider message/cause.description.
 */
export function safePreapprovalErrorMetadata(body) {
  if(!body || typeof body!=='object' || Array.isArray(body))
    return {response_shape:'non_object',provider_code:'unavailable'};
  const keys=['error','message','code','cause','status','details'];
  const response_shape=keys.filter(key=>Object.hasOwn(body,key)).join('_') || 'unknown_object';
  const codes=[body.code,body.error,
    ...(Array.isArray(body.cause) ? body.cause.slice(0,8).map(x=>x?.code) : [])];
  const code=codes.find(x=>typeof x==='string' &&
    /^[A-Za-z][A-Za-z0-9_\-]{1,60}$/.test(x) &&
    !/^(?:app_usr|test_user|bearer|token|access_token)/i.test(x) &&
    !/\d{7,}/.test(x));
  return {response_shape,provider_code:code || 'unavailable'};
}

// Only pre-approved vocabulary may reach logs; never log the raw provider message.
// This gives us clues when Mercado Pago returns only {message,status:400}.
const SAFE_HINTS = new Set(
  'cannot cant unable operate operation between different countries country countries region regional location '+
  'request create created subscription subscriptions preapproval payment payments payer collector seller buyer '+
  'user users account accounts test real production application invalid unsupported blocked forbidden restricted '+
  'not possible permission permissions parameter field value amount minimum maximum currency frequency status '+
  'pending email url back reason already exists allowed available authorized identity mismatch configuration '+
  'error required must merchant funds limit insufficient rejected expired disabled '+
  'pais paises diferente diferentes distintos entre operar operacion puede suscripcion suscripciones '+
  'usuario usuarios cuenta cuentas comprador vendedor invalido invalida no permitido permitida restringido '+
  'requerido importe monto moneda region prueba datos acceso'.split(' ')
);
export function safePreapprovalMessageHints(body) {
  if(!body || typeof body !== 'object' || Array.isArray(body))
    return [];
  const messages=[body.message,
    ...(Array.isArray(body.cause) ? body.cause.slice(0,8).map(x=>x?.description) : [])];
  const out=[];
  for (const message of messages) {
    if(typeof message!=='string') continue;
    const words=message.slice(0,900).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().match(/[a-z]{2,24}/g)||[];
    for(const word of words){
      if(SAFE_HINTS.has(word) && !out.includes(word))out.push(word);
      if(out.length>=16)return out;
    }
  }
  return out;
}
