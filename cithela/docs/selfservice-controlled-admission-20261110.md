# Alta autoservicio controlada · base instalada, apertura desactivada · 10/11/2026

## Estado verificable
Migración `20261110212443_selfservice_controlled_admission` aplicada y Edge `cithela-selfservice` v1 desplegada. Nuevas altas cerradas (`enabled=false`), 0 admisiones. Valores iniciales: 5 autorizaciones/24 h, 20 pruebas activas o autorizaciones pendientes, autorización de 24 h. El alta comercial sigue por WhatsApp hasta completar las verificaciones.

La RPC reutiliza issue/redeem de invitaciones y el bootstrap existente. Correo confirmado en Auth, aceptación versionada, captcha servidor y ledger único UID/correo. Las reservas y agendas existentes no se migran ni reescriben. Huella agregada de establecimientos y reservas antes/después idéntica: 4 establecimientos, 4 membresías, 17 reservas, 2 grants históricos. Authenticated/anon no pueden ejecutar la nueva RPC ni leer sus tablas.

## Cambios de esta iteración
- Protección previa a registro/login/OTP/recuperación en app, altas y administración, preparada para Turnstile nativo de Supabase Auth. Cada envío utiliza un token nuevo; el de la autorización posterior es independiente.
- Configuración pública mínima auth_config, sin secretos, roles o datos comerciales. Los accesos actuales siguen funcionando mientras la protección global está desactivada.
- Retomar autorización o agenda existente incluso si se completó el cupo o se pausaron nuevas altas. No se extiende vigencia ni se concede otra prueba.
- Límite de cuerpo HTTP antes de leerlo por completo y errores de cuota/captcha diferenciados.
- Cupos editables desde Administración con diagnóstico de configuración faltante.
- Página informativa de condiciones de prueba, todavía sin alta pública habilitada.

## Pruebas
- 215/215 pruebas Node de la app; incluyen 20 pruebas de Auth/captcha, HTTP y recorrido de alta.
- PostgreSQL 17.11 aislado, con dos conexiones reales y funciones existentes de invitación/bootstrap/guard comercial: 10/10 pruebas. Último cupo simultáneo y techo diario concurrente, doble solicitud del mismo usuario, pausa y reanudación, rollback sin agenda parcial, bootstrap concurrente único, trial exacto de 7 días, vencimiento, conservación/cancelación de reserva anterior y denegación de privilegios.
- La prueba aislada utiliza tablas mínimas para dependencias existentes; no acredita RLS de producción ni recepción de correo o captcha real. Nunca usa credenciales productivas. Dependencia fijada y lockfile en test-db; CI ejecuta la prueba.

## Configuración pendiente (no pegar secretos en chats o repositorio)
1. Cloudflare → Turnstile → Add widget. Nombre CITHELA, hostname spuklab.github.io, modo Managed. Crear un widget propio; no usar claves de prueba en producción.
2. Supabase CITHELA → Edge Functions → Secrets. Guardar CITHELA_TURNSTILE_SITEKEY y CITHELA_TURNSTILE_SECRET. El Sitekey es público; Secret key solo en Supabase.
3. Tras publicar todos los clientes preparados: Supabase → Authentication → Bot and Abuse Protection → CAPTCHA protection: Turnstile, misma Secret key. Establecer CITHELA_AUTH_CAPTCHA_ENABLED=true solo coordinado con esa configuración. Comprobar login profesional/admin, email/WhatsApp OTP y recuperación. No activar esta protección antes de publicar los clientes.
4. Authentication → URL Configuration: permitir exactamente https://spuklab.github.io/spuklab-builds/cithela/alta-autoservicio.html. Comprobar SMTP ya configurado, cuota de correo y confirmación real sin autoconfirmación.
5. Realizar alta y retorno del correo, creación de espacio, servicios/horarios/logo y pruebas A/B con dos identidades. Verificar caducidad y nuevas reservas bloqueadas conservando las anteriores; Safari iPhone/iPad/escritorio.
6. Definir la política final de minimización/plazo del registro de aceptación y datos identificatorios. La propuesta de revisión a 30 días, evaluación desde 90 y aviso mínimo 15 días no activa borrados. Mantener exclusiones de pilotos/cortesías/cuentas pagas/reservas futuras y exportación previa.
7. Solo con todo verificado, CITHELA_SELFSERVICE_ENABLED=true, habilitar cupos en consola y cambiar CTA web a Comenzar prueba. Sin cobros ni purgas automáticas.

Faltan claves Turnstile y recepción de correo de prueba para acreditar E2E. La apertura permanece pendiente; instalar la base cerrada no habilita el registro público.

## Seguridad existente a revisar antes de apertura
Advisor conserva avisos previos: protección de contraseñas filtradas desactivada y RPC cithela_commercial_status SECURITY DEFINER para authenticated. Esta última comprueba auth.uid y membresía owner/admin antes de devolver estado propio; no se amplían sus permisos en este cambio. Las tablas privadas con RLS sin políticas mantienen denegación a clientes.
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
