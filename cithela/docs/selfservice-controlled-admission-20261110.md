# Alta autoservicio controlada · candidata, NO activada · 10/11/2026

## Implementación revisable
El servidor reutiliza `cithela_pilot_invitation_command` (issue/redeem) y el `bootstrap_tenant` existente. No se reconstruye Auth ni el sistema de invitaciones. Nueva autorización con correo Auth confirmado, consentimiento versionado, captcha verificado por servidor y reserva atómica de cupo. Una admisión por UID y correo; reintentos no amplían vigencia. Se preservan invitaciones manuales. La autorización dura 24 h por defecto (configurable 1–48); el trial existente sigue siendo 7 días desde creación efectiva del establecimiento.

Límites iniciales propuestos, no aplicados: 5 nuevas autorizaciones por 24 h y 20 pruebas activas/autorizaciones pendientes. Administración puede configurar 1–20 diarias, 1–100 activas y 1–48 h de vencimiento sin código. El techo de 20 diarias respeta el límite del emisor del sistema existente. Un lock transaccional serializa revisión de límites y emisión/canje. Los grants pendientes también consumen capacidad. Reducir un cupo no suspende establecimientos existentes.

`alta-autoservicio.html` oculta el registro hasta que el servidor anuncie disponibilidad; exige correo verificado y captcha al activar. No está enlazada desde la web comercial. La consola candidata muestra ajustes solamente si el endpoint privado está disponible. Los límites son del servidor; la UI no concede permisos.

## Evidencia
- 8 pruebas HTTP adversariales: gate cerrado, identidad no verificada, captcha rechazado/caído, inyección de UID/tenant/precio/duración, permisos de administrador, límites y minimización de respuesta.
- SQL real en CITHELA dentro de BEGIN/ROLLBACK: creación candidata, cuatro identidades ficticias `invalid.example`, cierre por defecto, administrador vs otro usuario, correo no verificado, términos antiguos, issue/redeem existente, idempotencia, cuota diaria y ausencia de grant para el rechazo; permisos authenticated denegados. PASS. Todo revertido: no quedan usuarios, tablas o autorizaciones de ese ensayo.
- No acredita concurrencia con conexiones independientes, envío de correo real, captcha productivo, restauración ni Safari.

## Retención explícita propuesta (sin borrado activado)
Al vencer la prueba se bloquean nuevas reservas mediante el evaluador existente; agendas, historial y reservas existentes se conservan. Revisar a los 30 días de vencimiento y considerar limpieza recién desde los 90 días, con aviso previo de al menos 15 días y posibilidad de exportación. Excluir cuentas pagas, pilotos protegidos, cortesías vigentes, reservas futuras, reclamos y conservación requerida. Todo borrado requiere revisión individual y verificación específica; este desarrollo no contiene DELETE ni job de purga. La política debe aceptarse/publicarse antes del alta abierta. Conservación del ledger de prueba/consentimiento y minimización del correo necesitan revisión antes de cualquier eliminación de identidad para no permitir reactivar trials ni conservar datos sin plazo.

## Puertas antes de activar
1. Configurar y verificar Turnstile real para spuklab.github.io; secretos solo en servidor. Verificar antispam del registro de Supabase Auth (captcha y límites de email) además del captcha de admisión. No habilitar registro público con el segundo captcha como única protección de SMTP.
2. Validar SQL fuera de producción con dos conexiones concurrentes, expiración, rollback y el bootstrap completo. Generar migración con CLI, revisar advisors y aplicar coordinadamente; el archivo sql-review es propuesta, no migración ya instalada.
3. Desplegar endpoint cerrado y configurar `CITHELA_SELFSERVICE_ENABLED=false`. Estado público requiere gateway verify_jwt=false; read/configure/admit validan JWT explícitamente con auth.getUser y read/configure verifican UID administrativo. Verificar la ruta y origin, no inferir permisos del JWT enviado por el navegador.
4. Probar entrega y retorno del correo a alta-autoservicio.html (allowlist Auth), crear un establecimiento ficticio, servicios/horarios/logo, validar acceso A/B entre dos usuarios reales, vencimiento y nuevas reservas bloqueadas sin afectar las existentes.
5. Validar sesiones administrativas y profesionales simultáneas en Safari iPhone/iPad/escritorio. Ningún cierre global de sesión debe revocar el otro acceso.
6. Publicar condiciones/retención y aprobar todo el recorrido. Solo entonces habilitar servidor y cupos, y cambiar CTA comercial a Comenzar prueba. No pagos automáticos ni eliminación.

Bloqueante actual: no hay captcha productivo ni verificación E2E de esta ruta. La web publicada mantiene solicitud por WhatsApp. No presentar el servicio como autoservicio ya operativo.
