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
