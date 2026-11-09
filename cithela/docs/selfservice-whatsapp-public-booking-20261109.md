# CITHELA · Alta abierta y reservas sin intervención habitual
**Fecha:** 2026-11-09 · **Estado:** diseño de implementación y puertas de seguridad; NO activar todavía el registro abierto ni la autoconfirmación en cuentas existentes.

## Decisión de producto
El enlace de CITHELA es **distribuible por WhatsApp a cualquier profesional**, sin que SpukLab tenga que cargar su email como invitación individual. El correo verificado o la identidad telefónica validada son mecanismos de autenticación, **no autorizaciones manuales**. Un profesional puede crear su espacio y comenzar una única prueba de 7 días sin tarjeta; después elige contratar. Las becas/cortesías siguen desde el Centro comercial y no se facturan.

Un profesional debe poder compartir **un enlace público propio de reserva** por WhatsApp (o QR) y el cliente debe reservar autónomamente; no se requiere que el profesional cree previamente una ficha de paciente ni que apruebe turnos rutinarios uno por uno. El enlace público NO otorga acceso a otras agendas o a datos de personas.

## Estado real verificado (9/11)
- El registro profesional usa `alta-profesional.html` y `cithela-pilot-invitations` para canjear una autorización privada, asociada al email previamente cargado por SpukLab. El paso por WhatsApp es solo el transporte del enlace.
- `cithela_private.bootstrap_tenant` exige email confirmado y `cithela_onboarding_grants` vigente, consumido en una operación atómica. El parámetro de URL `pilotTenant=1` no autoriza nada.
- `cithela_patient_booking_create` exige `cithela_patient_links` del usuario verificado: el paciente ya debe estar vinculado a una ficha del negocio. Por eso hoy un link genérico no basta para clientes nuevos.
- La reserva usa candado transaccional por establecimiento, disponibilidad calculada, antelación de 2 horas, request idempotente y exclusión GiST de solapamientos. El `status` de nueva reserva es `pending` por defecto, que **ya ocupa el horario** hasta cancelación; `confirmed` también ocupa. La confirmación humana no es necesaria técnicamente para impedir dobles turnos, pero hoy sigue siendo necesaria para cambiar el estado mostrado.
- El snapshot de seña proviene del servicio: `deposit_amount_minor>0` marca `requested`, no pago acreditado. CITHELA no procesa el cobro de la seña por sí mismo.
- La cancelación/reprogramación y las reglas comerciales actuales no deben dejarse sin protección ni modificarse durante el piloto de dos usuarios reales.

## Flujo 1: alta universal de profesionales
1. En `/cithela/` del sitio comercial, CTA **Probar CITHELA gratis** → URL de alta única para todos. Compartible por WhatsApp, redes y QR, sin datos personales embebidos.
2. En el celular el profesional registra cuenta y comprueba **email** (MVP seguro); más adelante puede añadir OTP de WhatsApp propio, auditado. El envío de link por WhatsApp **no** autentica por sí mismo.
3. Antes de crear el tenant: consentimiento/versionado de condiciones, antiabuso por IP/identidad, verificación de email, límite de una prueba por propietario, captcha/Turnstile, cuota diaria de altas, límite global concurrente de pruebas y control de presupuestos. Sin correo confirmado no hay tenant. **No publicar un endpoint abierto para crear `onboarding_grants` desde el navegador**.
4. Un Edge endpoint autenticado y rate-limited decide, en el servidor, si el usuario verificado puede obtener **un único permiso de onboarding autogestionado**; captura consentimiento y protección antiabuso, devuelve solo un resultado seguro. RPC privilegiada en schema privado, sin service role en la web. Reutiliza `bootstrap_tenant` y consume ese permiso atómicamente. Ningún client-supplied tenantId/plan/price modifica la autorización.
5. Wizard mínimo: **Nombre del espacio → Servicios y duración → Horarios → Copiar enlace para reservar**. Prueba gratis de 7 días sin tarjeta; cortesía posterior solo mediante administración SpukLab. No crear infinitos espacios por misma identidad ni reiniciar trials.

**Operativa:** conservar `alta-profesional.html` y `cithela-pilot-invitations` para piloto/invitaciones con cortesía durante la transición. No eliminarlos hasta aprobar tests de alta abierta y aislamiento multi-tenant.

## Flujo 2: enlace público del establecimiento y autoconfirmación
1. Cada establecimiento obtiene un enlace único persistente (slug o ID público no secreto) y QR. Al abrirlo, solo muestra identidad, servicios activos, profesionales habilitados, disponibilidad y condiciones del negocio; NUNCA pacientes o turnos de otros clientes. No incluir tokens de sesión ni claves de invitación.
2. El cliente elige servicio/duración, fecha y horario; verifica su identidad (preferentemente WhatsApp OTP, alternativa email). Si no existe ficha vinculada, una operación servidor **crea/vincula una persona verificada en ese tenant** con límites antiabuso, identidad y consentimiento. No permite reclamar una ficha existente por nombre; resolver colisiones de teléfono/email en backend con prueba de control del contacto.
3. Reserva idempotente, dentro de disponibilidad y sin superposiciones. En **modo automático**, crear `status='confirmed'` y responder al paciente **Turno confirmado**, **tenga o no tenga seña el servicio**: confirmado significa que el horario está reservado, **nunca que la seña esté pagada**. El profesional lo ve sincronizado y puede cancelar o reprogramar según política. En **modo manual**, conservar el flujo `pending` existente.
4. Cuando un servicio requiere seña, mostrar por separado **Turno confirmado · Seña pendiente** (`status='confirmed'` + `deposit_status='requested'`). No gestionar cobro, recepción, confirmación bancaria, plazo de transferencia ni acreditación en SpukLab/CITHELA. El profesional se comunica con su paciente y decide cómo cobrar y si desea marcar la seña como informada/verificada de forma manual; esas anotaciones **no constituyen validación de CITHELA**. Ninguna integración de Mercado Pago se usará para las señas de terceros. No cancelar ni liberar automáticamente una reserva solo porque la seña siga pendiente, a menos que en una etapa futura se apruebe expresamente una política opcional con reglas claras y garantías de aviso.
5. Opciones de establecimiento: **Confirmación automática (recomendada)** / **Revisión manual**. La opción debe ser persistente por tenant, editable solo por owner/admin con auditoría y server-side enforcement. **Mantener el modo manual por defecto para todos los tenants existentes al migrar**, y activar automático por defecto únicamente para nuevos tenant **tras** pasar pruebas. Los turnos ya creados jamás deben cambiar de estado por alterar la configuración.
6. Reprogramación desde el cliente: aplicar el mismo modo elegido y condiciones de seña para el nuevo horario. Cancelaciones: preservar ventanas de antelación, historial y notificaciones supervisadas según disponibilidad de plantillas oficiales. Recordatorio **no equivale** a confirmación: el cliente ya tiene su turno cuando lo reserva.
7. Evitar reservas maliciosas: cuotas por identidad/tenant, comprobación de actividad del servicio y del entitlement comercial, antelación configurable, protección de endpoint de disponibilidad, no reserva anónima sin verificar contacto, límite de citas activas futuras por cliente.

## Separación financiera y comercial (decisión 09/11/2026)

- **SpukLab** factura y cobra exclusivamente sus propios productos SaaS: CITHELA, DAHZEA y futuros desarrollos. **Mercado Pago es solo un proveedor de cobros de SpukLab**, no una pasarela para los pacientes de profesionales.
- Cada **establecimiento** administra el dinero de sus clientes por fuera de CITHELA. La plataforma puede mostrar un alias informado por el negocio o una nota administrativa del estado de la seña; **no procesa pagos, no custodia fondos ni certifica ingresos**.
- **Estado de reserva** y **estado económico** son independientes. Una reserva automática se confirma por disponibilidad, no por verificación manual de seña. La existencia de una deuda o seña pendiente no autoriza a CITHELA a dar por pagado el servicio.
- **Acceso comercial al SaaS**: 7 días de prueba única por profesional (sin tarjeta), después compra voluntaria o cortesía adjudicada/revocada por SpukLab, con plazo configurable. Esta cortesía es un permiso de uso sin pago, no una suscripción de Mercado Pago.
- **Tarifa personalizada por cliente SaaS**: no confundir con la cortesía; requiere acuerdo registrado y futura implementación de facturación idempotente por parte de SpukLab. No modificar el importe de un contrato existente por cambiar el selector global.

## Permisos y aislamiento
- Auth user verificado + server-owned tenant: no permitir que un UID pueda crear, buscar o reservar en nombre de otro cliente.
- Los nuevos RPC públicos exponen solo servicios/horarios comerciales y no facilitan enumeración de personas, agenda ni teléfonos. Separar catálogo de lectura pública de los RPC de escritura con verificación.
- No usar `user_metadata` para roles. `service_role` solo en Edge y secret.
- No crear reservas duplicadas por reintentos, refresh, doble clic ni solicitudes concurrentes; usar `request_id` y la exclusión GiST ya existente.
- No modificar comercial entitlement, cortesías, webhooks ni contrato Mercado Pago hasta validar específicamente estos recorridos.
- El responsable de datos, política de privacidad, consentimiento del cliente y protección de información especialmente sensible deben aparecer antes de la toma de datos. Evitar pedir datos de salud si no son necesarios.

## Despliegue / aceptación, por orden
A. Preparar separación de estados `confirmed` y `pending` y configuración por establecimiento; probar rollback/entitlements, resistencia a doble solicitud, servicios con y sin seña, reprogramación, cancelación, vista paciente/profesional iPhone+iPad+PC.
B. Preparar auto-registro seguro de paciente con tenant público, nuevo link persistente y vinculación verificada (sin depender de invitación profesional). A/B con los dos establecimientos, sin datos cruzados.
C. Preparar alta pública de profesional con Turnstile, cuotas, verificación y términos, todavía con feature flag OFF; activar solo después del piloto y de validación legal/comercial. Mantener la invitación controlada como respaldo.
D. Habilitar selectivamente las 3 funciones en 1–2 tenants reales, observar errores/rechazos/citas duplicadas, después ampliarlas.

**No se debe afirmar que el enlace universal o las reservas automáticas funcionan ya**; estos cambios requieren SQL/RPC, cliente móvil, tests y despliegue coordinado. No adelantar un cambio solo de textos.
