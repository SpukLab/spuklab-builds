# CITHELA — WhatsApp supervised slot proposals (11 Oct 2026)
Status: **implementation candidate; not activated in production**.

Flow: inbound message already stored in `cithela_channel_inbox` → worker claims event using `channel_inbox_claim` → detect intent → retrieve `catalog.services`, `catalog.resources` and **live** `availability.query` by service/resource/day → pass **only provider-returned slots** into `proposeSlots` → persist draft for professional review → send only on explicit approval. No booking until explicit patient confirmation; on confirmation recheck availability and use the existing idempotent `appointment.create`.

The attached pure module defines request classification, conservative matching, and time-ordered at-most-three proposals. This PR does **not** add a scheduled worker, a Meta sender, a UI review queue, or persistent conversation state. Do not mark messages processed or enable background automation until all components are wired and tested. The existing inbound message stays `new`.

Acceptance gate: test duplicates; race/conflicting bookings; expired/unknown offers; different clients and tenants; daylight savings/timezone; unknown/multiple services; escalation; Meta delivery errors; opt-in and template restrictions. Keep OSDE integration in future discovery, out of MVP.
