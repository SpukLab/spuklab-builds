# CITHELA · Administración comercial y conservación de pruebas
Fecha: 2026-11-04. Estado actualizado: **Edge Function activa y acceso web administrativo verificado en iPhone el 04/11/2026; sin cobros ni purgas**.

## Objetivo

Administrar sin escribir código: selección de precios mensuales, profesionales invitados sin cargo, períodos de gracia y revisión manual de pruebas que nunca se contrataron.

## Ubicación

Interfaz interna (misma identidad de Supabase Auth que la agenda):
`https://spuklab.github.io/spuklab-builds/cithela/comercial-admin.html`.

Es deliberadamente una URL no enlazada desde la agenda normal, pero **la seguridad no depende de ocultar la URL**: la Edge Function `cithela-commercial-admin` requiere JWT verificado, email confirmado, coincidencia exacta con `CITHELA_COMMERCIAL_ADMIN_USER_ID`, y `CITHELA_COMMERCIAL_CONSOLE_ENABLED=true`. Falla cerrada si no se configura explícitamente. El acceso fue habilitado por el responsable y comprobado en el navegador el 04/11/2026. El navegador usa exclusivamente la clave `sb_publishable_...` ya pública en CITHELA; nunca usa service_role, MP Access Token o firmas HMAC.

Configuración posterior y supervisada: Supabase → Edge Functions → Secrets
- `CITHELA_COMMERCIAL_ADMIN_USER_ID` = UUID del usuario profesional de **SpukLab** autorizado para gestión comercial (Supabase → Authentication → Users).
- `CITHELA_COMMERCIAL_CONSOLE_ENABLED` = `true`.

El usuario configuró estos secretos y validó el acceso con su sesión profesional el 04/11/2026. No enviar nunca ningún token privado; el portal público no debe almacenar ni presentar estos valores.

## Tarifas

`cithela_private.cithela_price_options`: selector único de una referencia por plan `cithela_monthly` ARS/mes, importe expresado en centavos en DB. Incluye dos **alternativas históricas internas, NO públicas ni aprobadas**: 15.000 y 18.000 ARS; ambas sin seleccionar.

Puede añadirse otra referencia con etiqueta e importe ARS desde la pantalla. Elegir un importe no cambia contratos existentes ni modifica por sí solo el secreto `CITHELA_MP_TEST_AMOUNT_MINOR` de los ensayos. **No se ha conectado todavía el selector con la creación de una suscripción de producción**; esa conexión requerirá confirmación comercial, términos e impuestos, y copia inmutable del precio elegido en cada nuevo contrato. El esquema impide publicar cualquiera de estas referencias (`is_published=false`).

## Cortesías

`cithela_private.cithela_complimentary_grants` registra los permisos gratuitos con establecimiento, titular, autor, motivo, inicio, vencimiento opcional y revocación. Conserva historial de invitaciones revocadas. Solo se permite una cortesía no revocada por tenant. No se aplica a pilotos `legacy`, cuentas `active` ni suspendidas.

El evaluador `commercial_entitlement_snapshot` reconoce `complimentary` mientras la autorización esté vigente; de esa función dependen la barrera de nuevas reservas y el estado de servicio del profesional. Un vencimiento o revocación retira el acceso gratis, pero nunca borra personas, servicios ni turnos.

La versión inicial otorga cortesías **a establecimientos ya creados y verificados**. La invitación antes de registrar una cuenta es un paso posterior, vinculado con el flujo de alta autoservicio; no saltear la verificación de identidad ni habilitar el onboarding público antes de esa integración.

## Revisión de pruebas vencidas

`cithela_private.cithela_retention_settings`: revisión inicial a 30 días y posible evaluación de purga a 90 días desde el vencimiento. Son parámetros editables desde la consola y **no son todavía condiciones contractuales**.

La consulta de solo lectura `cithela_trial_cleanup_preview` identifica exclusivamente trials vencidos sin intención comercial, suscripción previa, cortesía vigente, conservación bloqueada ni futuros turnos. Excluye pilotos legacy, cuentas de pago y casos con preservación legal.

`cithela_retention_holds` permite marcar retención documental por un motivo legal o contractual (actualmente solo desde administración privilegiada, sin botón de borrado).

**No hay job automático, DELETE, DROP de datos, suspensión, eliminación de usuarios Auth ni limpieza de archivos Storage.** La base incluye muchos vínculos a datos de personas, turnos y mensajes, por lo que borrar solo un tenant no sería correcto y puede fallar por claves foráneas.

Antes de habilitar una purga debe implementarse: aviso previo al responsable de la agenda, acceso a descarga/exportación, plazo contractual, comprobación de que no haya obligaciones o disputas, purga de datos relacionados y archivos Storage, auditoría, límites por lote y aprobación doble. Política de conservación y legalidad a revisar (Argentina, Ley 25.326).

## Autorización y auditoría

- Tabla, grants, settings, hold y auditoría en esquema `cithela_private`, RLS activo y permisos para clientes revocados.
- `public.cithela_commercial_admin_command`: RPC ejecutable solo por `service_role`; Edge Function verifica sesión Auth y allowlist de UUID antes de invocar. Todas las operaciones de escritura generan `cithela_commercial_admin_audit`.
- Un usuario de un tenant no puede seleccionar precios, otorgarse acceso gratis ni borrar su propia agenda.
- El control comercial no cambia las integraciones WhatsApp, los webhooks de Mercado Pago ni las reservas.

## Validación

En producción Supabase se ejecutaron pruebas **dentro de BEGIN/ROLLBACK** para verificar: rechazo de doble tarifa seleccionada, legacy intacto, trial vencido bloqueado, cortesía activa y su vencimiento, revocación inmediata, re-invitación con auditoría y candidato excluido por retención documental. Sin ningún cambio persistente tras las pruebas.

**Despliegue efectuado 04/11/2026:**
- Migración `cithela_commercial_controls_price_free_retention_20261104`: `success=true`.
- Migración `cithela_commercial_admin_command_20261104`: `success=true`.
- Edge Function `cithela-commercial-admin`: versión 3, `ACTIVE`, `verify_jwt=true` según verificación directa del 04/11/2026. La sesión del administrador fue comprobada desde la interfaz.
- Consultas posteriores: 2 establecimientos, 15 reservas, 2 `legacy` con `can_book=true`, 0 intentos de cobro, 0 cortesías, 0 candidatos de limpieza, 2 tarifas borrador, 0 seleccionadas, 0 publicadas, `automatic_purge=false`.
- Ejecución de `read` con rol `service_role` dentro de transacción reversible: `ok=true`, 2 opciones, 2 establecimientos, 0 candidatos, purga automática desactivada. La sesión web del administrador fue comprobada posteriormente desde iPhone.
- `anon`/`authenticated` no pueden invocar la RPC de administración directamente.

El código de consola/Edge está sujeto a Node CI (controles de origen, JWT, permisos, validación de parámetros y ausencia de operaciones destructivas). Acceso administrativo verificado por el responsable desde iPhone, sin publicar datos de pacientes.

## Continuidad comercial

Mantener apagados checkout y alta automática hasta aprobación de oferta, prueba autónoma de contratación y conciliación de Mercado Pago. La selección de precios no implica aprobación del valor de venta.

## Validación posterior del 04/11/2026 — entorno real

- Acceso de la cuenta administradora: **verificado por el responsable en iPhone**; la consola presentó tarifas, cortesías y conservación.
- Consulta directa de solo lectura al comando administrativo: `ok=true`, código `snapshot`, 2 tarifas borrador, 2 establecimientos, 0 candidatos a revisión, 0 cortesías, 0 auditorías de escritura, 0 tarifas seleccionadas, 0 tarifas publicadas, `automatic_purge=false`.
- Permisos de la función RPC `cithela_commercial_admin_command`: `anon=false`, `authenticated=false`; solo invocable desde el contexto servidor autorizado. El acceso en navegador requiere identidad Auth confirmada y coincidencia con UUID permitido.
- Hub público actual (`/hub/`) no tiene autenticación y **no es apropiado para exponer controles**. Conservar la gestión en `/cithela/comercial-admin.html` hasta disponer de una consola SpukLab protegida que conserve los controles server-side.
- PR de seguridad UX `cithela/admin-console-ux-20261104`: deshabilita Otorgar/Revocar cuando el establecimiento elegido no corresponde; impide gestionar el piloto legacy desde esos botones; exige confirmación también al crear tarifas y cambiar plazos de revisión. Pendiente de fusionar y comprobar en Safari tras pasar CI.

### Verificaciones pendientes antes de cualquier contratación

1. Probar escrituras con una cuenta comercial de prueba elegible y un procedimiento reversible: seleccionar tarifa borrador, otorgar/revocar cortesía, guardar plazos, comprobar registros de auditoría y confirmar que se conservan turnos; **no usar los pilotos reales para la prueba**. No habilitar precio público, Mercado Pago de producción ni checkout.
2. Controlar el flujo autoservicio de registro y recuperación, las notificaciones y las credenciales en dispositivos reales.
3. Aprobar oferta, soporte, privacidad y conservación de datos antes de habilitar contratación y purga. `automatic_purge` debe permanecer en `false`.
