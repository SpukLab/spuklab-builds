# CITHELA — Control de reservas durante y después del trial

Actualizado: 2026-11-02. **Estado: propuesta probada en transacciones reversibles; aún no desplegada.**

## Hallazgo de arquitectura
La tabla central `public.cithela_appointments` recibe altas y cambios desde profesional, paciente y canales externos. El enfoque más seguro combina un control común en **BEFORE INSERT OR UPDATE** con respuestas explícitas `subscription_required` desde los RPC que usa la aplicación.

Se localizaron y preservaron las funciones de Supabase del proyecto activo:

| Función privada | Control introducido |
| --- | --- |
| `reservation_command` | Crear y reprogramar turno profesional |
| `patient_booking_create` | Reservar turno desde paciente |
| `patient_appointment_command` | Reprogramar; conserva confirmación y cancelación |
| `patient_reschedule_slots` | No ofrecer horarios de reprogramación tras vencimiento |
| `channel_command` | Crear y reprogramar a través del canal WhatsApp/conexión autorizada |
| `channel_availability_core` | No publicar disponibilidad cuando falta entitlement vigente |
| `bootstrap_tenant` | Al conceder alta del servidor, crea un solo trial de 7 días junto con el nuevo espacio |

El trigger de tabla `appointment_commercial_guard` detecta inserciones activas, reactivaciones desde estado inactivo y cambios de día/hora, servicio, recurso, paciente o duración. Impide también cambiar el `tenant_id` de un turno. **No bloquea cancelar, marcar atendido/ausente o confirmar un turno existente sin cambiar horario.**

## Seguridad
- Tabla comercial en esquema privado, RLS y revocación completa para roles de navegador.
- Una fila `legacy` por tenant preexistente, conservando acceso completo a la agenda del piloto.
- Trials con `trial_started_at` y `trial_ends_at` calculados por el servidor en la misma transacción de alta, sin parámetros de fechas desde el cliente.
- Se consumen permisos de alta emitidos por backend de confianza (como la protección ya activa de 02/11/2026).
- La función `commercial_entitlement_snapshot` devuelve `can_book=false` si no existe un entitlement, si el trial terminó, si la suscripción no está activa o si hay suspensión. No requiere cron.
- No incluye cobro ni activación de pago. Nunca convertir un redirect, correo o parámetro URL en `active`.

## Pruebas SQL realmente realizadas, sin persistencia
Se cargó **toda** la migración propuesta en una transacción `BEGIN`, se ejecutaron aserciones y se finalizó con `ROLLBACK`.

1. Se generaron exactamente dos entitlements `legacy` en el ensayo, ambos con `can_book=true`.
2. Con un tenant temporalmente en `trialing` cuyo fin ya pasó, el evaluador devolvió `trial_expired`, `can_book=false`; una reprogramación directa de la tabla produjo `cithela_subscription_required`.
3. El mismo turno vencido pudo pasar a `cancelled` (no fue bloqueado por el control comercial).
4. Con un usuario Auth confirmado sin tenant, se creó una autorización **exclusivamente de ensayo dentro de la transacción**; `cithela_bootstrap_tenant` creó un espacio con trial válido y siete días calculados por servidor. Repetir el alta con la misma sesión devolvió `workspace_exists`; el permiso quedó consumido, sin duplicar trial.
5. Al completar ambos rollbacks: **2 tenants, 2 membresías, 15 turnos, 0 grants** y **sin tabla comercial instalada**.

La segunda ejecución se ajustó para que la verificación privada corriera como administrador: `authenticated` no puede ejecutar `commercial_entitlement_snapshot`, correctamente. Los tests anteriores con lectura de función privada desde `authenticated` fallaron por protección de permisos, no por fallas de onboarding.

## Pendientes de la fase posterior
- Comprobar UI en Safari iPhone/iPad, dos sesiones, y tratamiento de `subscription_required` en mensajes.
- Completar reglas legales de aceptación, retención, privacidad, respaldo y correo de producción.
- Incorporar cobro explícito verificado (Mercado Pago/webhook), facturación y baja. Ningún trial debe renovarse automáticamente.
- No habilitar página pública de alta gratuita ni emitir permisos masivos hasta completar estos puntos.

**Decisión de despliegue:** desplegar solo tras completar revisión de la PR y aserciones de regresión con ambos tenants. Mantener habilitada la migración de bloqueo de altas de 02/11/2026 durante todo el proceso.
