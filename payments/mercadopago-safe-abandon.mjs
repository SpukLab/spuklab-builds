/**
 * Pure safety decision; never creates, cancels or links provider subscriptions.
 * "Absent" is provisional evidence, not an absolute guarantee against delayed indexing.
 */
export function assessProviderAbsence({reference,email,id,seller}={}) {
  if(typeof reference!=='string'||!/^cithela_[A-Za-z0-9_-]{12,100}$/.test(reference))
    return {ok:false,code:'invalid_intent'};
  const queries=[email,id,seller];
  if(queries.some(q=>!q||q.complete!==true||!Array.isArray(q.items)))
    return {ok:false,code:'provider_lookup_incomplete'};
  const matches=queries.flatMap(q=>q.items).filter(s=>s?.external_reference===reference);
  if(matches.length)return {ok:false,code:'provider_subscription_found_requires_link'};
  return {ok:true,code:'verified_absent_for_reconciliation'};
}
