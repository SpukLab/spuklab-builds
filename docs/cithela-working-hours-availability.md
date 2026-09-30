# CITHELA — Working hours + authoritative availability checkpoint

Estado: aplicado y verificado el 2026-09-30.

## Qué cambia

- Nueva tabla `cithela_working_hours` con RLS y lectura por membresía.
- `working_hours.set_day` se ejecuta por `cithela_configuration_command`; sólo owner/admin puede cambiar horarios.
- `cithela_availability_query` calcula slots de 30 minutos en el timezone del tenant, respetando:
  - duración del servicio;
  - recurso;
  - horarios configurados;
  - bloqueos generales o por recurso;
  - turnos pendientes/confirmados;
  - horarios ya pasados.
- `appointment.create` y `appointment.reschedule` ahora rechazan `outside_working_hours`.
- La reserva y la configuración comparten lock por tenant, para que un cambio de horario no compita con una reserva en curso.

## Semántica

Los horarios generales usan `resource_id = null`. Si existe al menos un horario específico para el recurso en ese día de semana, ese conjunto reemplaza al horario general para ese recurso/día.

Cerrar una excepción puntual se modela con `cithela_availability_blocks`; no se inventa disponibilidad desde la UI ni desde futuros canales.

## Verificación

- Prueba transaccional previa a migrar: PASS.
- Prueba sobre el esquema ya migrado: PASS.
- Idempotencia del cambio de horario: PASS.
- Rechazo de períodos superpuestos: PASS.
- Rechazo de reserva fuera de horario: PASS.
- Slot ocupado y slot bloqueado no aparecen en disponibilidad: PASS.
- Viewer no puede editar horarios: PASS.
- Lectura cruzada entre tenants: bloqueada.
- Escritura directa desde `authenticated`: bloqueada.
- Security advisors: 0 hallazgos.

Migraciones Supabase:
- `20260930111541_cithela_working_hours_availability`
- `20260930111631_cithela_working_hours_fk_index`

## Límite actual

La preview web sigue local-first. Este checkpoint completa la autoridad de horarios/disponibilidad del backend, pero todavía no activa remote-primary.

Siguiente gate: Auth/onboarding + provisioning controlado + adapter web; luego prueba real en dos dispositivos y recién después canal WhatsApp.
