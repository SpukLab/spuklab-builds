> **Estado actualizado al 08/11/2026:** las PR #127 y #128 están integradas, la primera invitación fue canjeada y Alma y Pampa completó el alta con trial de 7 días. Para los resultados verificables actuales y el ensayo de pacientes/cobros, consultar [pilot-live-acceptance-20261108.md](./pilot-live-acceptance-20261108.md). Lo siguiente conserva el histórico de planificación del 06–07/11.

# CITHELA · Alta supervisada de profesionales — 06/11/2026

**Estado: PR #127 en borrador. No fusionado ni desplegado. No enviar invitaciones externas todavía.**

## Implementación revisable

- Consola comercial existente → enlace **Invitar profesional al piloto**, en sesión administradora.
- `cithela/invitar-profesionales.html`: emitir, listar y revocar permisos por correo; copiar texto o compartirlo en WhatsApp manualmente. Vence a los **7 días**.
- `cithela/alta-profesional.html`: registro con correo/contraseña, correo confirmado, validación de invitación (RPC protegida) y redirección a la pantalla existente de creación de agenda.
- `cithela/commercial/pilot-invitations-handler.mjs` y `cithela/edge/cithela-pilot-invitations/index.ts`: Edge valida JWT de Supabase. Listar, emitir o revocar requiere admin UUID exacto; canjear requiere correo confirmado del usuario autenticado, que se consulta en Auth (no se acepta correo arbitrario del navegador).
- Dos SQL: `cithela/supabase/pilot-invitation-table-20261106.sql` y `pilot-invitation-command-20261106.sql`. Tabla con RLS sin permisos directos para clientes, RPC sólo para `service_role`. El permiso se vincula a `auth.users.email` confirmado y se consume al crear la agenda con el `bootstrap_tenant` existente, que crea una prueba de **7 días sin tarjeta**.

**La URL compartida no autoriza nada por sí sola**; únicamente presenta el formulario. El vínculo verificable es el correo confirmado y el permiso privado de servidor.

## Despliegue seguro posterior (NO realizado)

1. Fusionar PR #127 sólo tras revisión. Aplicar los dos SQL como migración versionada, en orden (tabla antes de función). Comprobar RLS, EXECUTE restringido e inexistencia de datos de otros establecimientos.
2. Desplegar Edge Function **`cithela-pilot-invitations` con `verify_jwt=true`**. Reutiliza el `CITHELA_COMMERCIAL_ADMIN_USER_ID` verificado y `CITHELA_COMMERCIAL_CONSOLE_ENABLED` del administrador actual. Además necesita **`CITHELA_PILOT_INVITES_ENABLED=true`**, que por defecto está ausente: *sin este secreto la nueva función devuelve 503 y no emite invitaciones*. Mantenerla desactivada hasta validar SMTP y Safari.
3. Supabase → **Authentication → URL Configuration → Redirect URLs**: agregar exactamente `https://spuklab.github.io/spuklab-builds/cithela/alta-profesional.html`; conservar las URLs actuales. Verificar que el email de confirmación use `{{ .RedirectTo }}` si la plantilla está personalizada.
4. Probar envío y recepción de correo real a una casilla que **no** pertenece al equipo de Supabase. Con SMTP predeterminado, Supabase restringe destinatarios y tasa (documentación 2026). SMTP se resuelve en otro chat.
5. Comprobar con un nuevo profesional voluntario y datos ficticios en iPhone Safari, iPad Safari y PC: emisión → enlace por WhatsApp → registro → confirmación → canje → creación única del establecimiento → primera reserva de paciente → cierre/reingreso → cancelación. Guardar PASS/FAIL.
6. Sólo después de pruebas completas, habilitar `CITHELA_PILOT_INVITES_ENABLED=true` y comenzar el piloto. No abrir alta pública ni pagos por este cambio.

## Resultados verificables hasta ahora

- **GitHub Actions**, 06/11: tras corrección de una aserción de test, suite de invitaciones y suite comercial anterior en verde en commit `56d621dd4f60fea272ad267a85d61818a4d84b4b`. Se añadió posteriormente control de sintaxis de scripts y feature flag; requieren CI actual.
- **Supabase**, 06/11: ejecución de ambos SQL dentro de `BEGIN … ROLLBACK`, con pruebas de emitir, repetir, listar, revocar y reemitir invitación sintética: todas las aserciones finalizaron sin error; tabla temporal **no existe** después del rollback y los 2 establecimientos `legacy` siguen intactos.
- **Ninguna** migración fue aplicada de forma persistente. Ningún envío de correo se hizo; ningún usuario, establecimiento ni turno nuevo se creó durante la prueba SQL.

## Limitaciones conocidas

- Falta verificar `emailRedirectTo` con un correo real y los navegadores Safari; no prometer alta hasta superar esas comprobaciones.
- Esta etapa sólo permite **un propietario y una agenda por alta**; no incorpora múltiples profesionales a un mismo establecimiento desde la consola.
- No hay checkout ni suscripción automática, no hay purgas de datos ni cobros, no se publica ninguna tarifa.
- La revisión de privacidad/consentimiento y respaldo/restauración permanece pendiente para apertura comercial pública. Los pacientes pueden compartir identidad entre establecimientos pero las agendas deben continuar aisladas.
- Conservar PR #123 (consola UX) y PR #21 (web comercial) independientes; revisar conflictos antes de fusionar.

## Manual para administración (cuando esté aprobada)

En CITHELA iniciá sesión como administrador de SpukLab → `comercial-admin.html` → **Invitar profesional al piloto** → correo → **Autorizar invitación** → **Compartir por WhatsApp**. La persona debe usar ese mismo correo, confirmarlo y seguir las instrucciones de alta. Si necesita más tiempo, se revisa acceso mediante la cortesía ya existente tras crear su agenda; no se altera fecha de prueba desde un parámetro de URL.


## Actualización de la revisión — 07/11/2026

- SMTP de Gmail para el proyecto CITHELA: prueba real de solicitud y recepción de recuperación, enlace y actualización de contraseña **PASS** en Safari, según ensayo del propietario. Unos mensajes llegaron a Spam; la entregabilidad sigue siendo un riesgo del piloto. No equivale todavía a confirmar un nuevo correo profesional mediante la URL de alta.
- La base actual contiene 2 establecimientos legacy, 0 permisos de onboarding, 0 cortesías, 0 intents de suscripción y 0 precios publicados. No se alteran mediante esta PR.
- Para permitir pruebas reales sin abrir invitaciones externas se admite **despliegue técnico por etapas**: fusionar únicamente después de CI, aplicar tabla/RPC versionadas y desplegar Edge con `verify_jwt=true` mientras `CITHELA_PILOT_INVITES_ENABLED` esté ausente o en `false`. En ese estado, todas las operaciones devuelven `not_enabled`; no son posibles invitaciones ni redenciones. No marcar este estado como «listo para invitar».
- Antes de habilitar, configurar manualmente en Supabase Auth la URL exacta `https://spuklab.github.io/spuklab-builds/cithela/alta-profesional.html` en **Redirect URLs**, comprobar la plantilla de confirmación y ejecutar prueba en Safari con una cuenta nueva e invitación controlada. El flag se activa sólo para esa validación supervisada, **no** para comercialización pública.
- Los cobros siguen separados: la infraestructura de Mercado Pago instalada actualmente es de prueba; no hay suscripción comercial activa, producto publicado ni conciliación de producción. No mezclar una cortesía con un pago verificado.
