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

## Bloqueante nuevo detectado

La compuerta `?pilotTenant=1` solo está en el HTML. La función interna `bootstrap_tenant` actualmente permite crear un establecimiento a **cualquier usuario Auth válido sin membresía**, aunque no exista una autorización comercial emitida por el servidor. Eso deja abierta la creación por llamada directa al RPC, independientemente de cómo se oculte el formulario.

Se preparó `cithela/sql-review/commercial-onboarding-gate.sql` como **propuesta, NO aplicada**:

1. Una tabla privada de autorizaciones de onboarding emitidas por un administrador/backend de confianza, sin permisos de lectura/escritura para `anon` ni `authenticated`.
2. La función mantiene el comportamiento idempotente `workspace_exists` para los profesionales existentes; nuevos espacios requieren correo confirmado, autorización vigente y sin consumir.
3. El registro de autorización se marca consumido en la misma transacción del alta, sin confiar en un parámetro del navegador.
4. El frontend reconoce los posibles códigos `onboarding_not_authorized` y `email_unverified` con mensajes legibles, sin abrir el registro público.

**No aplicar la propuesta de SQL automáticamente**: primero ensayar en un clon de prueba sin datos sensibles y validar el caso de recuperación, dos altas simultáneas, profesional sin autorización, autorización vencida y reintentos. No copiar identificadores, contraseñas ni keys a Git.

## Pendientes ordenados para apertura

| Prioridad | Condición | Estado |
| --- | --- | --- |
| P0 | Aislamiento de lectura RLS en 2 perfiles | **PASS, SQL role simulado** |
| P0 | Dos sesiones reales, permisos y RPC cruzados | **Pendiente** |
| P0 | Autorización del servidor antes de crear tenant | **SQL preparado, no desplegado** |
| P0 | Auth de producción, SMTP estable, políticas de contraseña | **Pendiente** |
| P0 | Privacidad, responsable, términos, retención y soporte | **Pendiente** |
| P0 | Respaldo/restauración comprobados sin afectar datos reales | **Pendiente** |
| P0 | Entitlement, expiración de 7 días y restricción de reservas por servidor | **No implementado** |
| P0 | Mercado Pago/webhook verificado, alta, baja y facturación | **No implementado** |
| P1 | Wizard mínimo iPhone/iPad/PC y primera reserva del cliente | **Por ensayar** |

**Criterio de salida:** se puede planificar una incorporación **supervisada** después de probar sesión y RPC con otra cuenta e implementar autorización real del servidor. No anunciar autoservicio, trial ni pagos como disponibles hasta cumplir los demás bloqueantes P0. No agregar odontograma ni funciones de nicho antes de vender la agenda básica.

Referencias: `selfservice-commercial-onboarding-20261101.md` y `spuklab-web-second-tenant-pilot-20261029.md`.
