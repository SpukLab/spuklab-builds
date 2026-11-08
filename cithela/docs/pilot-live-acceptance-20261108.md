# CITHELA — Estado verificable del piloto y puerta de cobro
**Fecha:** 2026-11-08. **Alcance:** comprobaciones de solo lectura en Supabase + revisión de `main` y documentación + confirmación manual del primer alta por el propietario. Sin pagos, altas ni cambios en el servidor por esta auditoría.

## 1. Recorrido de invitación validado

Una invitación emitida y canjeada; correo profesional confirmado; establecimiento **Alma y Pampa** creado con rol `owner`, 2 servicios activos y 11 tramos horarios. La prueba comercial comenzó el 2026-11-08, estado `trialing`, y vence el **2026-11-15 a las 11:02 aproximadamente (America/Argentina/Buenos_Aires)**. No necesita tarjeta ni genera renovación automática.

La cuenta comprobó recepción de invitación por WhatsApp, confirmación de email, creación de espacio, acceso y configuración en Safari. Esta evidencia **no** equivale a un paciente ya registrado ni reserva completada. SMTP Gmail confirmó anteriormente recuperación de contraseña; entregar a Spam sigue siendo un riesgo.

Estado read-only verificado:
- 3 establecimientos en total; los dos anteriores conservan `legacy`.
- `Alma y Pampa`: **0 pacientes, 0 turnos**.
- 1 invitación emitida, 1 canjeada, 0 revocadas.
- 0 intents de suscripción de Mercado Pago.
- 2 tarifas internas (ARS 15.000 y 18.000/mes), ninguna seleccionada ni publicada.
- El portal de paciente y el acceso profesional siguen separados. Compartir URL de invitación, sin permiso en servidor y email confirmado, no crea establecimientos.

## 2. Aislamiento SQL: PASS limitado al alcance probado

El 2026-11-08 se usaron transacciones `BEGIN ... READ ONLY` + `SET LOCAL ROLE authenticated` y `request.jwt.claim.sub` correspondientes a cada profesional, terminadas en `ROLLBACK`. Se consultaron **solo conteos** de membresías, servicios, pacientes y turnos, sin nombres ni datos privados.

| Establecimiento | Membresías visibles | Servicios | Personas | Turnos | Servicios/personas/turnos de otros establecimientos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Alma y Pampa | 1 | 2 | 0 | 0 | 0 |
| ODonto D | 1 | 2 | 1 | 1 | 0 |
| Defro tattoo | 1 | 4 | 3 | 14 | 0 |

Las políticas para `cithela_people`, `cithela_appointments`, `cithela_services` usan comprobación de membresía del mismo `tenant_id`. El comando del paciente relaciona `tenant_id + person_id + user_id` antes de modificar una reserva. El control de trial vigila nuevas reservas y reprogramaciones en servidor, sin bloquear las cancelaciones permitidas. Ver `trial-booking-enforcement-20261102.md` y `rpc-isolation-first-use-20261102.md`.

**Pendiente:** probar A/B con tokens reales y Safari, OTP WhatsApp y todas las rutas de RPC de reserva, no solo permisos de lectura.

## 3. Primer ensayo funcional: paciente de Alma y Pampa — PASS parcial (08/11)

Sin datos sensibles ni pagos:
1. Abrir sesión del **profesional** Alma y Pampa → **Pacientes → Agregar persona**. Crear una ficha de prueba con nombre ficticio y un teléfono/correo de prueba que se pueda verificar.
2. Desde la **ficha**, enviar **invitación personal** por WhatsApp o correo. El paciente debe usar ese mismo identificador, validar su identidad (OTP WhatsApp o email) y acceder a **Mis turnos**.
3. Desde el **paciente**, reservar un servicio con horario disponible; verificar en la sesión profesional que el turno nuevo aparece como pendiente. Confirmar desde el profesional, actualizar en el paciente y comprobar la coincidencia.
4. Intentar reprogramar o cancelar según reglas de antelación. Confirmar actualización en ambas vistas y que la agenda no duplica la reserva; probar también el caso de horario ya ocupado. No realizar operaciones destructivas fuera de la cuenta piloto.
5. En una sesión de los otros establecimientos, verificar que no aparezcan la nueva persona ni sus reservas. Repetir acceso desde Safari iPhone/iPad.
6. Registrar resultado `PASS/FAIL` y hora de la prueba. No incluir nombres, teléfonos, códigos OTP ni capturas con datos personales en GitHub.

**Resultado real informado por el titular (08/11):** se agregó una persona en Alma y Pampa, reservó un turno desde paciente y se actualizó en agenda profesional. Lectura adicional posterior en Supabase: **1 paciente, 1 turno confirmado** para ese tenant; los tres establecimientos siguen independientes y las pruebas RLS A/B/C arrojan cero registros cruzados. No registrar nombre, email ni teléfono del paciente en GitHub.

**Estado:** PASS para alta paciente, reserva y confirmación/sincronización. AÚN PENDIENTE probar cancelación/reprogramación de ese paciente, OTP y RPC de escritura desde dos sesiones y el manejo de turnos al vencer el trial. Esos pasos no deben darse por aprobados solo por el conteo SQL.

**Criterio de aceptación restante:** cancelación o reprogramación autorizada reflejada en ambas vistas y ninguna operación visible en otros tenants. No generar otro turno si el usuario ya validó el principal.

## 4. Mercado Pago: qué existe y qué falta

Existe infraestructura de **ensayo**, no checkout en producción. Las funciones `cithela-mp-test-connection`, `cithela-mp-test-intent` y `cithela-mercadopago-webhook` están desplegadas. El webhook está explícitamente limitado a **inbox de prueba**, con `liveMode:false`, y **no activa `cithela_commercial_entitlements`**. `cithela-mp-test-intent` no hace llamadas a la API de MP ni mueve dinero. La PR #104 de cimientos comerciales continúa en borrador y no debe fusionarse como si habilitara ventas.

Dos caminos posibles:
- **Piloto comercial supervisado:** usar `Planes de suscripción` de Mercado Pago (sin integración técnica) para cobrar recurrentemente fuera de CITHELA; requiere mecanismo administrativo **auditable y seguro** para vincular pago verificado al establecimiento y su período; actualmente no está validado. No activar acceso por captura, promesa de pago ni cortesía presentada como suscripción pagada.
- **Autoservicio completo futuro:** autorización explícita del propietario → crear suscripción con ID externo desde backend → checkout → webhook firmado → consulta autenticada al proveedor y conciliación de pago/período → habilitar entitlement idempotente → suspensión/baja/contracargo con auditoría. Esta opción requiere pruebas de producción y documentación fiscal, de privacidad, soporte y baja.

Mercado Pago documenta planes recurrentes sin programación: https://www.mercadopago.com.ar/developers/es/docs/subscription-plans/overview. API de suscripciones: https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post. Webhooks para suscripciones (configuración en la creación del pago): https://www.mercadopago.com.ar/developers/es/docs/mp-delivery/additional-content/your-integrations/notifications/webhooks.

## 5. Decisiones y bloqueantes

| Área | Estado | Criterio siguiente |
| --- | --- | --- |
| Alta profesional por invitación | PASS una cuenta | Prueba de segunda invitación real sin datos compartidos |
| SMTP recuperación | PASS con Gmail provisional | Vigilar Spam y cuotas compartidas |
| Identidad visual | PASS por capturas previas | Verificar nuevo establecimiento si carga marca |
| RLS lectura A/B/C | PASS tres cuentas | Completar RPC y navegador real |
| Paciente → reserva → confirmación → cancelación | **PENDIENTE** | Ejecutar escenario §3 |
| Prueba de 7 días | Trial creado por servidor | Verificar expiración sin borrar historial ni impedir acciones permitidas |
| Precio/condiciones fiscales | Borrador | Aprobación expresa antes de publicar |
| MP recurrente / habilitación por pago | **NO VALIDADO** | Verificación cobro, período, cancelación y auditoría |
| Backup/restauración y privacidad | **PENDIENTE** | Procedimiento aprobado para venta pública |
| Web comercial | PR #21 en borrador | Revisar Safari/capturas auténticas antes de publicar en producción |

**Regla:** mantener invitación supervisada; no abrir registro público ni cobrar automáticamente hasta pasar el circuito de pago y cancelación. Ninguna prueba de esta auditoría modificó reservas, datos personales, entitlements, precios o secretos.

## 6. Ensayo de Mercado Pago de bajo riesgo — plan aprobado 08/11

Estado 08/11 read-only: `cithela_private.cithela_mp_subscription_intents`=0, `cithela_private.cithela_mp_webhook_inbox`=1 (simulada), 0 tarifas publicadas, 0 entitlements de pago `active`. Permanecen separadas las invitaciones, la prueba y las cuentas legacy.

**Verificación técnica desde SpukLab, no desde clientes (actualizado 08/11):** abrir `https://spuklab.github.io/spuklab-builds/cithela/comercial-admin.html` con la cuenta **administradora global** de SpukLab → **04 / Integraciones → Mercado Pago · Diagnóstico → Comprobar conexión de prueba**. El endpoint `cithela-mp-test-connection` requiere el UUID global validado por Supabase Auth, cuenta con correo confirmado y consola comercial habilitada; ejecuta únicamente una consulta GET al proveedor con el token de prueba almacenado en el servidor. La aplicación operativa CITHELA ya no expone el diagnóstico, ni siquiera con `?mpTest=1`. Mostrar a profesionales únicamente `Estado del servicio`, hasta contar con suscripción real y conciliación verificadas. No se crean cargos ni se habilitan suscripciones mediante esta prueba.

**Vía alternativa de exploración sin código:** Mercado Pago web → Planes de suscripción → Crear nuevo plan. En cuenta comercial real, **crear/compartir enlaces puede habilitar cobros auténticos**: limitarse a examinar formulario, precios, opciones y cancelar sin completar publicación, envío o checkout hasta autorizar condiciones. Mercado Pago permite planes mensuales y prueba gratis configurable. Dado que CITHELA ya tiene 7 días gratis internos, **no duplicar una segunda prueba gratis en Mercado Pago**, y no establecer débito automático sin consentimiento expreso. Consultar tarifas y facturación fiscal antes de venta.

**Separación imprescindible:** un plan sin programación de Mercado Pago no enlaza automáticamente `tenant_id`, periodos abonados y entitlements de CITHELA. La integración API de suscripciones es la meta para autoservicio, pero el receptor actual solo archiva webhooks firmados de **prueba** y jamás habilita un plan por sí solo. No usar pantallazo/redirección como prueba de pago. La PR #104 permanece en borrador.

Fuentes públicas comprobadas:
- https://www.mercadopago.com.ar/developers/es/docs/subscription-plans/create-subscription-plan
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-test/payment-approval
