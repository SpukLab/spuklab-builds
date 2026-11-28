import {
  authorizeInternalTestCheckout, buildTestPreapproval, createTestPreapproval,
  readTestPreapproval, verifyTestProviderIdentity
} from './mercadopago-test-provider.mjs';
import {decideTestCheckoutRecovery} from './mercadopago-test-recovery.mjs';

const failure = (code) => ({ok:false, code});
const returnUrl = 'https://spuklab.github.io/spuklab-builds/cithela/suscripcion-prueba.html';

function checkoutUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password &&
        /(^|\.)mercadopago\.(com|com\.ar)$/.test(url.hostname)) return url.href;
  } catch {}
  return null;
}

export async function runPilotCheckout({request, actor, services, token, fetchImpl = fetch, backUrl=returnUrl}) {
  const {tenantId, consent} = request;
  const preflight = await services.preflight(tenantId, actor.id);
  const accounts = await services.verifyAccounts();
  const gate = authorizeInternalTestCheckout({
    tenantId, ownerEmail:actor.email, confirmedOwner:actor.emailConfirmed,
    preflight, explicitConsent:consent, serverFeatureEnabled:services.enabled,
    verifiedTestSeller:accounts.sellerVerified, verifiedTestBuyer:accounts.buyerVerified
  });
  if (!gate.ok) return gate;

  const intent = await services.prepare(tenantId, actor.id, accounts.sellerId);
  if (!intent?.ok) return failure(intent?.code || 'intent_unavailable');
  const built = buildTestPreapproval(intent, accounts.buyerEmail, backUrl);
  if (!built.ok) return built;
  if (intent.stage === 'linked') return failure('subscription_already_linked');

  const claim = await services.claim(intent.intent_id, actor.id);
  if (!claim?.ok || claim.external_reference !== intent.external_reference)
    return failure('claim_unavailable');

  let candidate;
  if (claim.code === 'claimed') {
    const created = await createTestPreapproval({
      intent, payerEmail:accounts.buyerEmail, backUrl, token, fetchImpl
    });
    if (!created.ok) {
      // A failed POST can have an ambiguous provider outcome; never retry creation automatically.
      // Only emit an allowlisted internal error code. No provider payload, token or payer data.
      console.warn('cithela_mp_checkout_diagnostic',JSON.stringify({
        phase:'create_preapproval',category:created.code || 'unknown_failure',
        retry_allowed:false
      }));
      return failure('provider_outcome_pending');
    }
    candidate = created;
  } else if (claim.code === 'recover_only') {
    const search = await services.searchSubscriptions(intent.external_reference, accounts.buyerEmail);
    const recovered = decideTestCheckoutRecovery({
      intent, providerSnapshots:search.results, lookupComplete:search.complete,
      verifiedTestSeller:accounts.sellerVerified
    });
    console.info('cithela_mp_checkout_diagnostic',JSON.stringify({
      phase:'recover_preapproval',category:recovered.code,
      lookup_complete:search.complete===true,
      candidate_count:Array.isArray(search.results)?search.results.length:0,
      retry_allowed:false
    }));
    if (!recovered.ok) return recovered;
    const match = search.results.find(item => item.id === recovered.provider_subscription_id);
    candidate = {...recovered, checkout_url:match?.init_point};
  } else {
    return failure('claim_unavailable');
  }

  const snapshot = await readTestPreapproval({
    subscriptionId:candidate.provider_subscription_id, token, fetchImpl
  });
  const proof = verifyTestProviderIdentity(intent, snapshot,
    {verifiedTestSeller:accounts.sellerVerified});
  if (!proof.ok || (services.expectedApplicationId && String(snapshot.application_id)!==services.expectedApplicationId) || (snapshot.payer_id != null &&
      String(snapshot.payer_id) !== String(accounts.buyerId))) return failure('provider_identity_mismatch');
  const url = snapshot.status === 'pending' ? checkoutUrl(candidate.checkout_url) : null;
  if (snapshot.status === 'pending' && !url) return failure('checkout_url_unavailable');
  const linked = await services.link(intent, snapshot.provider_subscription_id);
  if (!linked?.ok) return failure('link_unavailable');
  return {ok:true, code:url ? 'checkout_ready' : 'subscription_linked', checkout_url:url};
}
