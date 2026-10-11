# SpukLab Hub — CITHELA commercial integration gate (2026-10-11)
**Document only; not an active checkout or tenant provisioner.**

Hub owns: customer organizations, product catalog, plan selection, subscription records, billing provider adapters, payment status, entitlement issuance, professional onboarding, support and administrative integrations. CITHELA owns: clinics/salons, professionals, services, appointment availability, patients, consent and booking data. Never share raw patient notes/appointment content with Hub.

Lifecycle: `lead` → `organization_registered` → `plan_selected` → `payment_pending` → `active` → `past_due` or `cancelled`. Do not create a paid entitlement from frontend data. A verified server-side billing event must be idempotently matched to an organization and plan. Webhook retries must not duplicate tenant provision.

Minimal provisioning contract: `organization_id`, `product=cithela`, `plan_id`, `subscription_id`, `entitlement_status`, `requested_by`, `idempotency_key`. CITHELA returns `tenant_id` and provisioning status; no patient records cross the boundary. Tenant ownership, professional membership and initial role must be verified before opening the operational app.

Before first external subscription: confirm trademark, privacy and data-handling notices (health-related notes are sensitive), tested tenant isolation, professional onboarding/recovery, custom SMTP or validated phone auth, WhatsApp production number/template policy, billing provider fees/tax invoices, cancellation/refund policy, payment and subscription failure states. The free Meta test phone is exclusively for development and permitted test recipients.

Pilot recommendation: manually invited professionals first, with explicit test-mode entitlement; automate customer signup and billing only after a second independent tenant and end-to-end reservation test are verified. OSDE integration remains research backlog, not product commitment.
