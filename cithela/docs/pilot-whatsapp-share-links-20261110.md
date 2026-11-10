# CITHELA — invitaciones compartibles por WhatsApp (piloto controlado)

Fecha: 2026-11-10. Alcance: **piloto de hasta 5 profesionales por enlace, 7 días**, con límites adicionales. No es el alta pública ilimitada descrita en `selfservice-whatsapp-public-booking-20261109.md`.

## Recorrido
1. El administrador autenticado entra a `/cithela/invitar-profesionales.html` y genera un enlace de 2, 3 o 5 cupos.
2. Toca «Compartir por WhatsApp». No necesita conocer ni cargar el correo profesional.
3. El destinatario abre `alta-whatsapp.html#invitacion=<token aleatorio>`, se registra e identifica mediante verificación de correo Supabase.
4. La Edge Function `cithela-pilot-share-links` valida JWT, correo confirmado y el hash del secreto del enlace. La RPC limita fechas/cupos y crea exactamente un permiso de onboarding privado. La aplicación existente consume ese permiso al crear su tenant con un único trial de 7 días.
5. Al crear la agenda, el profesional configura servicios/horarios y puede registrar pacientes. Si SpukLab desea sumar cortesía, la gestiona **después del alta** en Centro comercial. Nada aquí procesa pagos ni modifica señas.
6. Si el usuario verificó el mail en otro navegador que perdió el fragmento, debe **reabrir el enlace original recibido por WhatsApp**, iniciar sesión y tocar Activar prueba. No se comparte la contraseña.

## Seguridad
- La URL lleva 256 bits aleatorios en **fragmento**, no en la consulta HTTP. La base de datos almacena exclusivamente su hash SHA-256.
- Enlaces de un máximo de 5 usos, 7 días de validez, 4 emisiones por administrador cada 24 h y 15 redenciones globales cada 24 h. Verificados server-side, bajo cerrojo de transacción.
- Solo JWT de un administrador de SpukLab previamente confirmado puede emitir/revocar. Cualquier profesional con email confirmado puede canjear un enlace válido **una sola vez** si no posee agenda, permiso previo ni trial histórico.
- Las tablas son privadas, con RLS y REVOKE para `anon`/`authenticated`; la RPC está restringida al rol de servicio, llamado desde Edge. El usuario nunca elige la autorización ni el precio.
- La revocación invalida permisos **no consumidos** de ese enlace, sin modificar agendas ya creadas. Sin acceso a otros tenants, sin habilitación de cobros, sin cambios a las reservas.
- La Edge requiere `CITHELA_COMMERCIAL_CONSOLE_ENABLED=true` y `CITHELA_PILOT_INVITES_ENABLED=true`, ya usados en el flujo piloto existente. `CITHELA_PILOT_SHARE_LINKS_ENABLED=false` es un interruptor adicional de cierre.
- No se recupera un enlace ya creado desde el panel: solo se registra su hash. Si se pierde, emití otro y revocá el anterior. Compartirlo equivale a compartir una invitación limitada; no publicarlo en redes generales.
- Las nuevas cuentas de Supabase siguen sujetas a cuotas SMTP y Auth. Para el lanzamiento público se mantiene pendiente Turnstile/CAPTCHA y términos legales completos, además de un límite ampliable de trial y garantía de costes.

## Verificaciones
- SQL: `BEGIN` / `ROLLBACK` (sin persistencia): emisión, canje, idempotencia, lista, revocación y verificación `authenticated` sin EXECUTE.
- GitHub Actions: `node --test cithela/pilot-whatsapp-share.test.mjs cithela/pilot-invitations.test.mjs`; protege el circuito por correo existente.
- Falta prueba funcional completa con dos móviles y dos correos reales distintos, más confirmación del primer turno y separación de tenants. El piloto sigue siendo supervisado.

## Despliegue
Orden: 1. fusionar código validado; 2. aplicar migración nueva; 3. desplegar Edge con `verify_jwt=true`; 4. comprobar revocación/lectura y que el panel viejo siga operativo; 5. que el administrador emita un enlace nuevo de 2 cupos y complete prueba en iPhone/iPad. No habilitar contratación ni pagos desde este desarrollo.

## Estado de despliegue verificado (10/11/2026)
- PR #140 fusionada en `main`: commit `49f36bbb26c45d3b87b67cd55410c8387607db7e`.
- GitHub Actions `pages build and deployment`, `CITHELA WhatsApp share-link pilot` y `CITHELA commercial admin safety`: **success**.
- SQL aplicada como migración `cithela_pilot_whatsapp_share_links_20261110`; dos tablas privadas presentes, `anon`/`authenticated` sin permiso de ejecutar el RPC.
- Edge `cithela-pilot-share-links` **ACTIVE**, versión 1, con `verify_jwt=true`.
- Prueba transaccional con rollback sobre DB: `issue`, `redeem`, segundo `redeem` idempotente, `list`, `revoke` y expiración de permiso no consumido, todo correcto.
- Al cerrar la verificación: **0 enlaces emitidos reales**, **0 canjes reales** y 3 establecimientos existentes sin cambios.
- Falta **QA del recorrido real desde dos cuentas de correo y dos móviles**. El hecho de que la función esté activa no constituye una confirmación extremo a extremo de correos/WhatsApp.
- **No se activaron pagos, precios públicos, señas ni auto-confirmación de turnos**. El registro general ilimitado sigue pendiente de Turnstile y controles del documento de alta pública.
