# CITHELA — Verificación comercial y multitenant, 2026-11-02

## Alcance y fuentes reales

- **Proyecto:** Supabase CITHELA existente `mcqknmqhtmihegmifuka` (activo).
- **Aplicación:** `SpukLab/spuklab-builds/cithela/index.html`. Sin modificaciones en base de datos, WhatsApp, Meta, pagos ni credenciales durante esta comprobación.
- **Método:** consultas SQL en transacciones `BEGIN READ ONLY` con `SET LOCAL ROLE authenticated` y el reclamo `request.jwt.claim.sub` temporal de cada uno de los dos usuarios profesionales existentes, seguido de `ROLLBACK`.
- **Privacidad:** solo cantidades agregadas y recuentos de registros del otro establecimiento. No se consultaron valores personales, nombres, teléfonos, emails, notas ni tokens para el informe.

## Resultado observado

| Control | Perfil profesional A | Perfil profesional B |
| --- | ---: | ---: |
| Cuenta autenticada bajo rol RLS | Sí | Sí |
| Establecimientos visibles | 1 | 1 |
| Membresías visibles | 1 | 1 |
| Pacientes/fichas visibles | 3 | 1 |
| Servicios visibles | 4 | 2 |
| Recursos visibles | 1 | 1 |
| Turnos visibles | 14 | 1 |
| Horarios semanales visibles | 11 | 10 |
| Eventos operativos visibles | 81 | 21 |
| Registros ajenos visibles en las 10 tablas probadas | **0** | **0** |

Se evaluaron: `cithela_tenants`, `cithela_tenant_memberships`, `cithela_people`, `cithela_services`, `cithela_resources`, `cithela_appointments`, `cithela_availability_blocks`, `cithela_operational_events`, `cithela_working_hours` y `cithela_channel_connections`. Los conteos son una instantánea del momento de la auditoría, no expectativas permanentes.

**Resultado: PASS para el aislamiento de lecturas SQL de esas tablas bajo rol `authenticated` y ambos identificadores de usuario.** NO equivale a una prueba completa de dos sesiones reales en navegadores ni de operaciones RPC y WhatsApp. Aún resta confirmar que se rechacen identificadores cruzados en RPC, sin provocar cambios sobre datos reales.

Intento de lectura de `cithela_tenants` como `anon`: PostgreSQL devolvió `permission denied` (denegación esperada). No es una falla del sistema.

## Integridad adicional observada

- En Supabase existen 2 establecimientos y 2 membresías correspondientes a 2 profesionales distintos.
- Ambos profesionales existentes tienen correo confirmado.
- `cithela_private.bootstrap_tenant` usa `SECURITY DEFINER` con `search_path` vacío, `auth.uid()`, serializa por usuario con `FOR UPDATE`, devuelve `workspace_exists` si ya tiene membresía y crea servicio/recurso inicial. No se recreó ni se ejecutó ningún alta durante este control.
- Las 15 tablas públicas `cithela_*` tienen RLS habilitado. Las tres tablas sin políticas directas (`cithela_channel_outbox`, `cithela_patient_invites`, `cithela_patient_links`) se encuentran denegadas por defecto al acceso directo.
- La restricción de exclusión de turnos activos impide solapamientos por establecimiento y recurso.
- Advisor de seguridad: advertencia [Leaked Password Protection desactivada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Es recomendable habilitarla desde la configuración de Supabase Auth antes de abrir registros de profesionales; comprobar disponibilidad/costos y comportamiento de usuarios existentes.

## Bloqueante de alta resuelto en servidor (02/11/2026)

Se detectó que la compuerta `?pilotTenant=1` era únicamente visual. Se creó la autorización de altas de servidor en Supabase como migración **`cithela_commercial_onboarding_guard_20261102`**, usando el archivo versionado `cithela/supabase/commercial-onboarding-activation-20261102.sql`.

**Ensayo previo reversible**: una transacción con `CREATE TABLE` y `CREATE OR REPLACE FUNCTION` reprodujo los casos `workspace_exists`, `onboarding_not_authorized`, `email_unverified`, autorización válida con creación única, y reintento idempotente. Todas las comprobaciones fueron aserciones SQL; al finalizar se ejecutó `ROLLBACK`. Posteriormente persistían **2 establecimientos, 2 membresías y 15 reservas**. Este ensayo fue transaccional sobre el proyecto actual, **no un clon aislado**.

**Despliegue real**: la migración devolvió `success=true`. No se generó ningún permiso inicial de alta: la tabla `cithela_private.cithela_onboarding_grants` quedó con **0 filas** y RLS activo. Se verificó `has_table_privilege` para `authenticated` y `anon`: **sin lectura** y sin inserción para clientes. La función conserva `SECURITY DEFINER` y `search_path` vacío, igual que antes, con el control nuevo de autorización.

**Ensayo posterior**: en transacciones revertidas, un miembro antiguo devuelve `workspace_exists`, un usuario sin permiso devuelve `onboarding_not_authorized` y el email sin confirmar devuelve `email_unverified`. Recuento final inalterado: 2 establecimientos, 2 membresías, 15 turnos. **No se alteraron reservas existentes, ni flujos de WhatsApp, ni pagos.**

**Operación actual**: para una incorporación supervisada, un administrador de confianza debe verificar identidad y consentimiento, emitir una autorización limitada a ese `auth.users.id`, `terms_version` y vencimiento; el navegador jamás puede emitirla. La autorización se consume dentro de la misma transacción de `bootstrap_tenant`. Una cuenta nueva sin permiso no puede crear establecimiento aunque invoque el RPC directamente.

**Reversión de emergencia**: restauración de la función anterior disponible en `cithela/sql-review/rollback-onboarding-gate-20261102.sql`. Sólo para incidencia crítica: quitar esta protección reabriría altas de usuarios autenticados no autorizados. No eliminar la tabla de autorizaciones para mantener trazabilidad. Verificar conteos y comportamiento tras cualquier intervención.

**Importante**: este guard NO implementa ni abre alta autoservicio comercial ni prueba gratuita. Tampoco significa que se probó la navegación completa con dos sesiones reales.

### Seguridad y costos
El advisor señaló `auth_leaked_password_protection`. Según la documentación de Supabase, esa protección requiere **plan Pro o superior**; por lo tanto no debe suponerse disponible en el plan gratuito ni provocar una actualización de plan sin presupuesto. Mantener mín. ocho caracteres y estudiar el endurecimiento de contraseñas disponible sin pago antes de abrir el registro. Referencia: https://supabase.com/docs/guides/auth/password-security

## Pendientes ordenados para apertura

| Prioridad | Condición | Estado |
| --- | --- | --- |
| P0 | Aislamiento de lectura RLS en 2 perfiles | **PASS, SQL role simulado** |
| P0 | Dos sesiones reales, permisos y RPC cruzados | **Pendiente** |
| P0 | Autorización del servidor antes de crear tenant | **APLICADA Y VERIFICADA; emisión supervisada, no autoservicio** |
| P0 | Auth de producción, SMTP estable, políticas de contraseña | **Pendiente** |
| P0 | Privacidad, responsable, términos, retención y soporte | **Pendiente** |
| P0 | Respaldo/restauración comprobados sin afectar datos reales | **Pendiente** |
| P0 | Entitlement, expiración de 7 días y restricción de reservas por servidor | **No implementado** |
| P0 | Mercado Pago/webhook verificado, alta, baja y facturación | **No implementado** |
| P1 | Wizard mínimo iPhone/iPad/PC y primera reserva del cliente | **Por ensayar** |

**Criterio de salida:** se puede planificar una incorporación **supervisada** después de probar sesiones reales, revisar Auth/privacidad y documentar el procedimiento de autorización supervisada. No anunciar autoservicio, trial ni pagos como disponibles hasta cumplir los demás bloqueantes P0. No agregar odontograma ni funciones de nicho antes de vender la agenda básica.

Referencias: `selfservice-commercial-onboarding-20261101.md` y `spuklab-web-second-tenant-pilot-20261029.md`.
