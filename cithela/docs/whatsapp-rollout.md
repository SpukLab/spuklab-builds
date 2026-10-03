# CITHELA · WhatsApp rollout

## Phase 1 — implemented: supervised drafts
- Professional cloud agenda offers a contextual WhatsApp draft for pending and confirmed appointments.
- Read-only daily history offers the cancellation notice on cancelled appointments.
- Operator queue includes all future pending reservations (not only the reminder window) and confirmed appointments approaching their reminder date; shows the first 12.
- Operator chooses **new booking pending**, **confirmation**, **reschedule**, **reminder**, or **cancellation** as allowed by current appointment status, previews and can edit the draft, then explicitly opens WhatsApp and manually sends it.
- Patient first name, tenant display name, appointment local date/time, status and the CITHELA portal link are the only generated contents. No consultation reason, clinical alerts or patient notes are included.
- Sending, delivery and reading are **not** automatically observed or recorded; opening a WhatsApp chat is not proof of delivery. The portal and Supabase remain the authoritative appointment state.
- If the appointment version, tenant, time, status or recipient number changes before the operator opens WhatsApp, the draft is rejected and must be prepared again.
- No WhatsApp Business credentials, paid provider, webhook or automatic background sender have been configured.

## Phase 2 — gated: automated WhatsApp Business delivery
Do not enable automatic messaging until a tenant has a properly configured business sender and explicit patient opt-in. Before implementation, verify current Meta/provider requirements, approved templates and pricing.

1. Store per-tenant sender configuration server-side. Never expose API tokens in the static GitHub Pages frontend.
2. Record opt-in per patient and channel, with source, timestamp, scope and revocation; never infer it from merely providing a phone number.
3. Generate a transactional outbox item **after** a committed booking, confirmation, rescheduling or cancellation command. Use a stable key such as `tenant_id:appointment_id:row_version:event_type` to prevent duplicates across retries and devices.
4. Worker / Edge Function checks opt-in, recipient, current appointment version and allowed delivery window before sending, then uses the approved WhatsApp template when required. Never send obsolete reminders for cancelled or moved appointments.
5. Verify provider webhook signatures. Distinguish `queued`, `submitted`, `accepted`, `delivered`, `read`, `failed` and `unknown`; preserve provider response and retry with backoff. Do not represent `submitted` as `delivered`.
6. Limit message data to the minimum operational details, and provide a link to the authenticated patient portal. Avoid consultation reasons, patient medical notes or access tokens in messages.
7. Add per-tenant notification preferences, quiet hours, time-zone handling and an operator override. Include costs and templates in onboarding.

## Release gates
- Test one linked patient and one professional on different devices, including an appointment made ten days in advance.
- Test cancellation and rescheduling against a previously queued message, missing or revoked consent, retries, wrong tenant, stale version and invalid phone.
- Confirm that any WhatsApp delivery failure cannot change or roll back the actual appointment.
- Confirm patient access after onboarding invite expiry: invitation lasts 48 hours only until redemption; future sessions use fresh magic links and the persistent account-to-person link.
