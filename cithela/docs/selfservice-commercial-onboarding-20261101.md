# CITHELA · Alta autoservicio y activación comercial (contrato V0)
Fecha: 2026-11-01 · Estado: diseño de implementación / NO habilitado en producción

## Objetivo
Cliente que llega desde SpukLab Web → resuelve dudas frecuentes SIN IA → conoce planes → verifica identidad profesional → crea un establecimiento aislado → configura agenda → comienza una prueba gratuita → decide pagar ARS 18.000/mes (precio propuesto; impuestos/condiciones por verificar) → mantiene acceso según su suscripción. Sin intervención humana habitual. Soporte humano para excepciones.

## Evidencia técnica comprobada (sin consultar datos personales)
- App actual: `https://spuklab.github.io/spuklab-builds/cithela/`, en este repositorio (`cithela/index.html`).
- El registro profesional y creación de establecimientos YA EXISTEN, pero están limitados a `?pilotTenant=1`; gate visual de piloto, no una oferta comercial ni una medida de autorización.
- `cithela_private.bootstrap_tenant` y wrapper `cithela_bootstrap_tenant`: crean tenant, rol owner, servicio y recurso bajo sesión Auth autenticada, si el usuario todavía no tiene membresía. No llamar desde SpukLab Web con service-role.
- A 2026-11-01, Supabase CITHELA tiene 2 tenants y 2 memberships (conteos agregados). Existencia de 2 tenants NO acredita una prueba A/B de aislamiento.
- Auth de profesional hoy usa correo/contraseña/confirmación de correo. WhatsApp OTP ya se probó para acceso de pacientes; no atribuirlo automáticamente al alta del profesional sin adaptar/verificar la función.
- Sin tabla de suscripciones comerciales/entitlements en CITHELA; no activar planes a partir de parámetros URL o del navegador.
- Material previo: `docs/spuklab-web-second-tenant-pilot-20261029.md`, `docs/spuklab-hub-commercial-contract-20261011.md`.

## Experiencia deseada — 5 pasos
1. **Orientación (SpukLab Web):** FAQ gratis acerca de rubros, seña, WhatsApp, cancelaciones, recordatorios, precio, trial y privacidad. IA sólo cuando existe intención y duda puntual; respuesta de IA nunca contrata ni otorga acceso.
2. **Plan y condiciones (SpukLab Web):** mostrar alcance, precio con impuestos/medios, qué pasa tras vencer, políticas, soporte, identidad del proveedor y consentimientos. CTA `Iniciar 7 días gratis` sólo tras aprobación comercial/técnica.
3. **Identidad profesional (CITHELA):** registro verificado con correo transaccional de producción (u opción telefónica comercial auditada); mantener sesiones por usuario y no cruzar pacientes con profesionales. Registrar aceptación de condiciones y fecha/versión de política desde backend autenticado.
4. **Tenant y primera agenda (CITHELA):** backend idempotente verifica titular y ausencia de tenant propio, inicializa agenda y recursos; wizard mínimo `Nombre del espacio → Servicio/duración → Días/horarios → Enlace para reservar`. Validar que la segunda cuenta no vea datos de la primera.
5. **Prueba y cobro (backend comercial):** comenzar trial de 7 días cuando se crea/verifica espacio por primera vez. No pedir tarjeta ni cargar cobro automático durante la prueba. Al vencer, solicitar suscripción expresamente y redirigir al checkout seguro del proveedor. Con webhook autenticado e idempotencia, habilitar entitlement; no confiar en redirect de éxito ni en flags JS. Permitir cancelación/baja y exportación de datos.

## Esquema de estados de acceso (controlado por servidor)
- `pending_verification`: no puede crear agenda ni iniciar prueba; puede continuar verificación.
- `trialing`: acceso operativo, fecha `trial_ends_at` calculada por servidor; una vez por entidad profesional/tenant, política antiabuso.
- `trial_expired`: permitir iniciar sesión, revisar cuenta y exportar datos; no admitir nuevas reservas hasta que la persona acepte el pago. No eliminar pacientes/turnos al vencer.
- `payment_pending`: checkout iniciado sin habilitar acceso de pago todavía.
- `active`: confirmación fiable del proveedor tras webhook verificado.
- `past_due`: aviso claro, recuperación de pago; no borrar registros.
- `canceled`: baja efectiva con tratamiento de datos documentado.
- `suspended`: abuso/fraude, sólo por backend bajo reglas auditables.

Entitlement: `organization_id, tenant_id, product='cithela', plan_id, subscription_id, status, trial_started_at, trial_ends_at, current_period_end, terms_version, updated_at`. No mezclar historiales clínicos ni pacientes en el sistema comercial. Restricciones únicas para impedir múltiples trials de la misma organización y reintentos de webhook.

## Seguridad e idempotencia (bloqueante)
- Cualquier alta requiere `auth.uid()` real, contexto de rol autorizado, RLS y controles de tenant. No servir `service_role` en HTML/JS ni confiar en un simple query parameter.
- Crear/actualizar entitlement exclusivamente por backend autorizado (no `anon`), con auditar quién/cuándo cambió el estado.
- Doble alta simultánea y reintento deben devolver el mismo resultado; webhook de pago repetido no crea un segundo tenant.
- No crear un portal de pago dentro de CITHELA. SpukLab comercial gestiona suscripción; CITHELA únicamente consulta entitlement para operar.
- Restringir quién puede emitir invitaciones a pacientes, enviar WhatsApp y consumir servicios costosos durante el trial.
- Identidad del responsable del tratamiento y su domicilio, contactos y retención contractual deben estar terminados antes de permitir autoservicio externo.
- Para venta a distancia en Argentina: implementar medios simples de baja y el canal de arrepentimiento conforme a Disposición 954/2025, incluida confirmación de solicitud sin registro previo. Verificar aplicabilidad por categoría de cliente con asesoría.
- Precio público ARS 18.000, período de prueba 7 días SIN tarjeta y SIN renovación automática; confirmación de pago explícita al terminar. Facturación e impuestos pendientes.

## Controles previos a habilitar botón de alta
[P0] Dos sesiones reales y tenants independientes: aislamiento de personas, servicios, turnos, marca, WhatsApp, permisos, reservas cruzadas y RPC. Evidencia de PASS/FAIL.
[P0] Recuperación de contraseña y correo transaccional en producción sin cuotas de demo; WhatsApp OTP de profesional sólo si existe implementación y está validado.
[P0] Política de privacidad de CITHELA, responsable, términos, soporte, exportación/borrado y respuesta a incidentes.
[P0] Backup/restore y expiración de trial en entorno de prueba SIN alterar usuarios existentes.
[P0] Verificación de precio neto, cobro, fees Mercado Pago, facturación fiscal, baja y webhook.
[P1] Wizard ensayado móvil iPhone/iPad/PC; no exigir módulos avanzados (odontograma, etc.) durante alta.
[P1] Métricas no sensibles del embudo: `landing_view`, `trial_start`, `wizard_completed`, `checkout_started`, `subscription_activated`, `trial_expired`; métricas agregadas por día y producto, sin registros de pacientes ni conversaciones de IA.

## Conexiones sin duplicación
- `SpukLab/SpukLab-web`: catálogo, FAQ, pricing, CTA, política, analytics agregada y derivación segura.
- `SpukLab/spuklab-builds/cithela`: Auth, tenant, servicios, disponibilidad, pacientes, wizard y uso diario.
- Un backend comercial mínimo (puede ser función/Worker existente si supera límites) crea/valida trial y entitlement, integra Mercado Pago y webhooks; no implementar un Hub genérico antes de las primeras ventas.
- Correo `SpukLab@gmail.com` sólo como soporte comercial y casos excepcionales, no paso obligatorio del alta.

## Criterios de aceptación del primer cliente sin intervención
1. Profesional sin cuenta crea una sesión legítima y verifica correo; no se registra doble cuenta por reintento.
2. Crea tenant independiente y primera agenda, conserva su sesión al volver desde WhatsApp o email.
3. Enlace de turnos funciona desde otro dispositivo y no deja cruzar pacientes/roles.
4. Trial comienza exactamente una vez y vence en fecha del servidor; sin tarjeta ni cobro.
5. Se invita a convertir a pago, puede decidir no continuar y descargar sus datos.
6. Pago confirmado por webhook real en entorno autorizado; acceso activo sin operaciones manuales.
7. Baja/reembolso/arrepentimiento según condiciones aplicables, sin contactar al creador para ejecutar acciones rutinarias.

**Estado actual:** sólo contrato de implementación. NO modificar flags `pilotTenant` ni la base operativa para lanzar autoservicio hasta pasar los bloqueantes.
