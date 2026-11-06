# CITHELA · invitaciones supervisadas para profesionales — 06/11/2026

Estado: **BORRADOR; NO DESPLEGAR; NO ESTÁ OPERATIVO**. Los dos establecimientos `legacy` no se modificaron.

## Objetivo práctico
Un administrador de SpukLab autoriza el correo de un profesional desde su panel privado, copia un enlace de alta y lo comparte por WhatsApp. El profesional registra **ese mismo correo**, lo confirma en Supabase Auth, inicia sesión y crea una agenda aislada. El servidor habilita el alta exactamente una vez. El enlace público nunca es una autorización; el permiso sólo vale para el correo confirmado. No hay cobros.

## Implementación propuesta y alcance de esta PR
- `cithela/supabase/pilot-invitation-table-20261106.sql`: tabla privada con correo, emisor, vencimiento y aceptación, con RLS y sin políticas públicas.
- `cithela/supabase/pilot-invitation-command-20261106.sql`: RPC restringida a `service_role` para emitir, listar, revocar y canjear una invitación. Un canje sólo acepta el email **confirmado** de `auth.users` y genera un permiso `cithela_onboarding_grants` consumible por `bootstrap_tenant`.
- **Todavía faltan:** Edge Function con verificación de JWT y UUID de administrador; interfaz privada «Invitar profesional» con listado y revocación; canje desde el alta profesional actual; tests automatizados y de SQL.

**Estas dos sentencias SQL no deben desplegarse por separado para activar usuarios; faltan el servidor y la UX.** No abrir el alta comercial por URL ni por configuración de JavaScript.

## Condiciones para aprobar
1. El frontend nunca dispone de `service_role`, ni ejecuta directamente la RPC privilegiada. La Edge valida Auth real, correo confirmado y UUID exacto para toda operación de administración.
2. Un usuario no invitado recibe denegación aunque use `?pilotTenant=1`. Un invitado con otro correo no puede aceptar. La invitación revocada/vencida tampoco.
3. La misma invitación no crea dos establecimientos; el alta real sigue protegida por `bootstrap_tenant` y consume el permiso.
4. Los dos pilotos originales permanecen en `legacy`, sin nuevas cortesías ni modificación de reservas.
5. Se ensaya en iPhone Safari, iPad Safari y PC: registro, correo de confirmación, primer ingreso, agenda, reserva del paciente, WhatsApp y regreso a CITHELA.
6. Se comprueba backup/restauración y se revisan legalidad/consentimiento antes de apertura masiva. No se habilitan Mercado Pago, purgas ni registros comerciales automáticos.
7. Las nuevas cuentas generadas por `bootstrap_tenant` reciben 7 días de prueba desde el servidor. Una eventual extensión se otorga después desde la consola de cortesías a la agenda elegible; nunca desde parámetros URL.

## Alternativa manual temporal (no confundir con el flujo automatizado)
- El invitado abre `https://spuklab.github.io/spuklab-builds/cithela/?pilotTenant=1`, crea su cuenta profesional y confirma su correo.
- Antes de crear el establecimiento, personal autorizado verifica el usuario en Supabase Auth y emite un `cithela_onboarding_grants` por UUID, con consentimiento y vencimiento. **No compartir UUID, tokens ni contraseñas en el chat**.
- Reingresa con su cuenta, crea el establecimiento y realiza un turno de prueba.
- Si el correo de confirmación no llega, detener el alta. El SMTP sigue bajo revisión independiente.

## Dependencias
- `cithela/docs/selfservice-commercial-onboarding-20261101.md`
- `cithela/docs/commercial-admin-pricing-free-retention-20261104.md`
- PR #123: mejoras UX de la consola comercial, aún sin fusionar.
- SpukLab-web PR #21: web con capturas reales, aún sin fusionar.
