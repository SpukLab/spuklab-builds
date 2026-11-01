# CITHELA commercial foundation — DISABLED / review only

01/11/2026. No frontend imports, deployed endpoint, credentials, provider calls or database migrations.

## Implemented
- `selfservice-draft.sql`: additive private storage, disabled release gate, server email verification, consent versions, actor lock shared with existing `bootstrap_tenant`, atomic tenant/trial creation and immutable 168-hour deadline on retries. Existing memberships/patient links cannot be automatically converted. Owner status query computes expiry using server time, without deleting records.
- `mercadopago.mjs`: server-only adapter for pending subscription checkout, lookup and cancellation; explicit consent, fixed API origin, timeout, no network while disabled. HMAC verification binds resource/request/time, five-minute replay window. Payment matching checks merchant, reference, environment, currency, amount and approval time. An authorized subscription alone grants nothing.
- `mercadopago.test.mjs`: 21 payment tests using synthetic data and mocked network, plus a PostgreSQL fixture test covering release gate, identity, consent, patient exclusion, trial idempotency, owner isolation, expiry and role-denied writes. Run `npm install --prefix cithela/commercial --ignore-scripts`, then `node --test cithela/commercial/*.test.mjs` from repository root. PGlite is a development-only test dependency.

## Not implemented / release blockers
This is NOT an operational subscription system. SQL is tested with disposable in-memory PostgreSQL (PGlite), using minimal operational table/bootstrap fixtures. It has NOT been applied to Supabase. No public signup/payment button may be connected to it yet.
1. Block direct legacy bootstrap bypass for commercial accounts without breaking existing pilots. Add entitlement checks inside ALL mutation/bookings/channel RPCs, including patient reservations. A status query alone does not restrict writes.
2. Finish wizard using existing service catalog, working hours and branding commands. Existing name-only setup remains pilot-only; no duplicate Auth/tenant implementation is required.
3. Persist checkout under owner lock before external call; reconcile ambiguous create timeouts using external_reference. Never retry create blindly. Add unique provider subscription/payment IDs, event ledger, transactional event consumption, ordering/replay protection and reconciliation. A valid HMAC alone is not idempotency.
4. Handle subscription_authorized_payment by retrieving authorized payment then its actual payment and subscription; validate linkage to the stored checkout. The matching helper is only a predicate, not a complete webhook handler. Confirm actual payload fields with sandbox responses. Refunded/charged-back payments must revoke the appropriate period; historical payments must not extend it again.
5. Implement owner-authorized cancellation and its confirmation/retry, paid-through dates, past_due grace policy and export/read retention. `cancel()` alone is not a self-service portal.
6. Real tests: two JWT sessions/RPC writes, OTP/email recovery, iPhone/iPad/PC, backup restore, concurrent trial requests, expiry and sandbox payment/renewal/refund/cancellation. Do not use real patient records.
7. Complete legal provider identity, privacy/retention, terms, consent, easy cancellation/withdrawal and fiscal invoicing. No terms are accepted by reading this draft.

## Read-only production audit evidence
Project mcqknmqhtmihegmifuka healthy; 2 tenants / 2 memberships; all 15 public CITHELA tables have RLS. Metadata-only inspection of policies shows membership-scoped reads.
On 01/11/2026, two separate `BEGIN READ ONLY` transactions selected each membership's user internally, set transaction-local JWT subject, switched to `authenticated`, and queried only aggregate cross-tenant counts. Both yielded: authenticated_context=true, visible_memberships=1; cross_tenants/people/appointments/services/resources/hours/channels=0. Both transactions rolled back. No IDs, names or patient values returned.
This validates database read policies under simulated Auth context, not genuine JWT validation, RPC writes, session recovery, WhatsApp or browser isolation. No full A/B PASS is claimed.
Advisor: leaked-password protection disabled. RLS-without-policy informational findings on outbox/invites/links are default-deny direct access, not evidence of public disclosure. Verify intended RPC boundaries before changing any grants.
Existing bootstrap authenticates uid and serializes on auth.users but does not itself check email_confirmed_at or reject patient-linked users; current patient exclusion is in UI. The draft commercial path adds both server checks, but legacy path still needs review.

## Mercado Pago / costs — researched 01/11/2026
- Pending subscription supports hosted completion without a card at creation: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments
- Cancellation: PUT /preapproval/{id}, status canceled: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
- Webhook signatures and events: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
  Documentation says dashboard configuration is not available for subscriptions; verify creation-time notification configuration and actual signed delivery in sandbox. Do not enable unsigned fallback.
- Public subscription fees: 6.99% + IVA immediately; 4.49% + IVA at 10 days; 3.39% + IVA at 18 days; 1.49% + IVA at 35 days. Provincial taxes/account conditions can vary: https://www.mercadopago.com.ar/herramientas-para-vender/suscripciones?code=V1C70X
- ARS 18,000 is still proposed. At 6.99% plus 21% IVA on that fee: fee ARS 1,522.42 and remainder ARS 16,477.58 BEFORE any other taxes, withholding, messaging, infrastructure or support. This is an illustrative calculation, not the merchant's verified net proceeds.
- Fiscal status is unknown. If monotributista, ARCA says electronic C invoices for domestic operations; MP payment receipt does not implement tax invoicing: https://www.arca.gob.ar/facturacion/monotributo/comprobantes.asp
- Supabase changelog.md retrieval was attempted but search transport rejected text/markdown; no claim of complete changelog review. No deployed Supabase change was made.

## Next executable block
Extend the existing isolated PGlite harness with actual operational RPC definitions and multi-connection concurrency testing, then add enforcement to existing RPCs and connect a gated wizard. Configure sandbox MP only after the durable ledger is implemented. Public commercial signup stays closed until all P0 gates pass.

Fixture limitations: PGlite runs one connection; genuine concurrent sessions, deployed Auth verification, real bootstrap side effects and full operational schema compatibility remain untested.
