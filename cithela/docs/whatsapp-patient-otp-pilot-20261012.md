# CITHELA: WhatsApp patient access pilot gate (12 October 2026)

## Product boundary
CITHELA's secure patient portal owns appointments and self-booking.
WhatsApp primarily delivers a personal invitation and an authentication code.
Conversational slot suggestions are optional, not a requirement for first pilot.
Do not activate unattended reservations.

## Current status
- Phone invitation and one-use redemption (48-hour expiration): implemented.
- Patient booking through authenticated portal: implemented; real two-device test pending.
- Signed Supabase Auth Send SMS Hook Edge Function: deployed; Auth hook configuration not verified.
- Meta OTP authentication template: approval/configuration not verified.
- Phone login currently chooses the native WhatsApp channel, which Supabase documents for Twilio and Twilio Verify. For the Meta custom Send SMS Hook, switch to the SMS channel only AFTER hook activation.
- Do not claim OTP sign-in works until a complete code delivery + verify + invite redemption test passes.


## Updated preflight (27 October 2026)

- Confirmed in Supabase: the `cithela-whatsapp-otp` Edge Function is deployed
  with `verify_jwt=false` because it validates Supabase Auth's signed webhook
  itself, **before** accessing Meta or attempting any message.
- Confirmed in CITHELA frontend: `signInWithOtp` uses the `sms` channel
  required for a custom Meta Send SMS Hook; `verifyOtp` uses `type:'sms'`.
  This path is still gated by `CITHELA_PHONE_OTP_ENABLED=false`.
- Confirmed in WhatsApp operational pilot: ordinary supervised messaging works.
  This **does not** validate an AUTHENTICATION template or an Auth Hook.
- Added a read-only template preflight in the authenticated professional
  **Mensajes > Diagnóstico de conexión Meta** pane. Only owner/admin can query it.
  It checks name, language, category, and approval status against the pilot WABA
  using the existing server-side Meta token. It sends no messages, changes no
  Auth settings, and never exposes the token or verification codes.
- The preflight uses the known CITHELA pilot WABA `1418360383843069` if
  `META_WHATSAPP_WABA_ID` is absent. For another tenant/sender, configure
  their WABA ID explicitly; never reuse this pilot fallback.

### Remaining gates before a real six-digit code test
1. WhatsApp Manager > Plantillas de mensajes: create an
   `AUTHENTICATION` / `COPY_CODE` template for the **SpukLab** WhatsApp
   account (not the legacy test account), wait for `APPROVED`, and record
   exact template name and language.
2. Supabase > Edge Functions > Secrets: configure
   `META_WHATSAPP_OTP_TEMPLATE`, `META_WHATSAPP_OTP_LANGUAGE` and
   `META_WHATSAPP_WABA_ID`, keeping the token secret; never paste tokens here.
   Run **Comprobar plantilla OTP (sin enviar)** in CITHELA to confirm approval.
3. Supabase > Authentication > Providers > Phone: enable phone auth without
   auto-confirm, then > Authentication > Hooks > Send SMS: configure the
   `cithela-whatsapp-otp` HTTPS function and matching
   `SEND_SMS_HOOK_SECRET` (Supabase Standard Webhooks signing secret).
   Neither dashboard configuration is observable through the current tools.
4. Run one controlled real phone OTP test **before enabling the UI gate**,
   verifying Meta submission and actual receipt on the intended WhatsApp,
   Supabase `verifyOtp`, the 48-hour invite redemption, logout and tenant
   isolation. If any prerequisite fails, **keep email as fallback and do not
   flip the gate**. Require consent and avoid sending real patient information
   during tests.

## Durable Meta access
In Meta Business Settings, create a dedicated SYSTEM USER, assign the SpukLab HuB
application and this WABA. Issue a system-user token with
whatsapp_business_management and whatsapp_business_messaging. Select a nonexpiring
token where available, otherwise use the longest allowed expiry. Tokens can still
be revoked or lose asset permissions.
Replace META_WHATSAPP_ACCESS_TOKEN in Supabase Edge Functions Secrets; never publish it.
Use the existing authenticated "Verificar conexión Meta (sin enviar)" test from CITHELA.

## OTP activation steps (manual configuration in product dashboards)
1. Meta WhatsApp Manager: create AUTHENTICATION template with COPY_CODE button
   and approved language, for example es_AR. Wait until APPROVED. Confirm the
   correct WABA and exact template name.
2. Supabase Secrets: configure META_WHATSAPP_OTP_TEMPLATE,
   META_WHATSAPP_OTP_LANGUAGE, META_WHATSAPP_OTP_BUTTON_SUBTYPE=url.
   Keep SEND_SMS_HOOK_SECRET private and aligned with the hook signing secret.
3. Supabase Dashboard -> Authentication -> Providers -> Phone:
   Enable phone authentication and configure reasonable anti-abuse rate limits.
4. Supabase Dashboard -> Authentication -> Hooks -> Send SMS:
   Enable HTTPS hook at
   https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-whatsapp-otp
   and use the corresponding Standard Webhooks signing secret.
5. After the signed hook is known to be active, change the frontend
   signInWithOtp phone channel from 'whatsapp' (native Twilio-only)
   to 'sms' (custom Send SMS Hook). Keep verifyOtp type 'sms'.
   Do not switch before hook is active, to avoid directing an OTP to a carrier
   SMS provider or producing a confusing failure.
6. Validate on two devices: invite -> SMS hook transports code over Meta
   -> patient verifies code -> can redeem invitation -> session persists
   -> patient sees ONLY own appointments -> self-books a test appointment.
   Test wrong phone, expired invite, 2nd tenant, duplicate booking, logout.
7. Until that is verified, keep email access as fallback and avoid real
   patient data or clinical notes in the Meta sandbox.

## Notes
Free Meta test sender only supports pre-approved destinations and may not support
the exact production authentication template path. Evaluate with a registered
number before external patients. Sandbox +549 -> 54 normalization is limited to
the known Meta test sender and never changes patient identity.

References:
https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
https://supabase.com/docs/guides/auth/phone-login
https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api
