# CITHELA · Administración comercial y conservación de pruebas
Fecha: 2026-11-04. Estado inicial: **panel y controles preparados; no se autorizan cobros ni purgas**.

## Objetivo

Administrar sin escribir código: selección de precios mensuales, profesionales invitados sin cargo, períodos de gracia y revisión manual de pruebas que nunca se contrataron.

## Ubicación

Interfaz interna (misma identidad de Supabase Auth que la agenda):
`https://spuklab.github.io/spuklab-builds/cithela/comercial-admin.html`.

Es deliberadamente una URL no enlazada desde la agenda normal, pero **la seguridad no depende de ocultar la URL**: la Edge Function `cithela-commercial-admin` requiere JWT verificado, email confirmado, coincidencia exacta con `CITHELA_COMMERCIAL_ADMIN_USER_ID`, y `CITHELA_COMMERCIAL_CONSOLE_ENABLED=true`. Está desactivada hasta que se configure explícitamente. El navegador usa exclusivamente la clave `sb_publishable_...` ya pública en CITHELA; nunca usa service_role, MP Access Token o firmas HMAC.

Configuración posterior y supervisada: Supabase → Edge Functions → Secrets
- `CITHELA_COMMERCIAL_ADMIN_USER_ID` = UUID del usuario profesional de **SpukLab** autorizado para gestión comercial (Supabase → Authentication → Users).
- `CITHELA_COMMERCIAL_CONSOLE_ENABLED` = `true`.

No completar estos secretos ni habilitar la consola sin confirmar que el UUID pertenece al administrador de SpukLab. No enviar nunca ningún token privado.

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

El código de consola/Edge está sujeto a Node CI (controles de origen, JWT, permisos, validación de parámetros y ausencia de operaciones destructivas). Tras despliegue, se probará el acceso administrativo usando la cuenta designada, sin datos de pacientes.

## Continuidad comercial

Mantener apagados checkout y alta automática hasta aprobación de oferta, prueba autónoma de contratación y conciliación de Mercado Pago. La selección de precios no implica aprobación del valor de venta.
