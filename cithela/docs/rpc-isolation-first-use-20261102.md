# CITHELA · Control de operaciones entre establecimientos + primer uso

Fecha: 02/11/2026. Repositorio: SpukLab/spuklab-builds. Supabase CITHELA existente.

## Resultado del ensayo de RPC (sin cambios persistentes)

Se repitió la separación A/B con los dos identificadores de usuarios profesionales existentes. Para cada perfil se abrió una transacción SQL, se asignó `SET LOCAL ROLE authenticated` y una identidad mediante `request.jwt.claim.sub`, y se intentó operar sobre el identificador de tenant **ajeno**. Toda la transacción terminó en `ROLLBACK`.

| Ruta/RPC pública | A sobre tenant B | B sobre tenant A |
| --- | --- | --- |
| `cithela_service_catalog_command` con `service.create` | `forbidden` | `forbidden` |
| `cithela_configuration_command` con `working_hours.set_day` | `forbidden` | `forbidden` |
| `cithela_tenant_branding_update` | `forbidden` | `forbidden` |
| `cithela_patient_booking_catalog` | `forbidden` | `forbidden` |

Se seleccionaron los UUID dentro de SQL; no se copiaron a este documento. No se consultaron nombres, teléfonos ni datos de fichas. Los resultados de RPC se limitaron al código de rechazo. La transacción se revirtió en ambos ensayos y no se modificó ningún servicio, marca, horario ni paciente.

**Conclusión:** PASS para las cuatro rutas probadas entre cuentas independientes bajo identidad simulada con rol Auth de PostgreSQL. Se suma a la prueba previa de 10 tablas con `foreign=0`. No sustituye dos sesiones válidas desde navegador, pruebas de OTP/WhatsApp ni todas las rutas RPC de reserva.

## Primera configuración del establecimiento

`cithela/index.html` incorpora una sección opcional y no intrusiva **«Prepará tu espacio»** al principio de Agenda cuando el profesional cloud aún no tiene turnos. No se muestra para usuarios en modo local ni para espacios con reservas existentes.

- **Días y horarios** lleva a Ajustes y abre el editor semanal existente.
- **Servicios y duración** lleva a Ajustes y abre el editor de servicios existente.
- **Primer paciente** lleva a Pacientes y abre el formulario ya implementado.
- Se reflejan recuentos de horarios/pacientes existentes, sin declarar completada automáticamente la revisión del servicio predeterminado.
- La sección desaparece al registrar el primer turno. No crea nuevos tenants, usuarios, entitlements ni datos de pacientes por sí sola.

Los accesos están conectados a las pantallas actuales (no a un wizard o formulario paralelo) para evitar divergencias y conservar las agendas productivas.

## Bloqueantes todavía abiertos para venta automática

1. La propuesta `cithela/sql-review/commercial-onboarding-gate.sql` **no se aplicó**. Sigue pendiente ensayarla en entorno aislado, autorizar el despliegue y restringir creación de tenants a permisos emitidos por servidor.
2. SMTP y política de contraseñas, identificación/privacidad del responsable, soporte y proceso de recuperación de datos.
3. Entitlement de prueba con duración y acceso controlados por servidor; reglas de reserva al vencer; sin borrado de datos. Un aviso HTML sin validación backend **no** basta.
4. Cobro real por Mercado Pago/webhook con verificación, facturación y cancelación. No hacer que un parámetro URL o redirección de pago active el servicio.
5. Dos sesiones auténticas en navegadores/dispositivos, recuperación, WhatsApp y flujos de reserva completos entre A/B.

No se activan nuevas altas, períodos gratis ni cobros en este PR.
