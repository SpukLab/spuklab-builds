# CITHELA · Tarifa promocional y circuito de cobro de SpukLab (09/11/2026)

Estado: **decisión comercial registrada, NO habilita producción ni cobro automático**. Revisión obligatoria antes de la primera transacción real.

## Tarifa de lanzamiento aprobada
- **CITHELA: ARS 15.000 mensuales por establecimiento**, como tarifa inicial promocional para nuevas altas. El importe se expresa al cliente en pesos argentinos y con frecuencia **mensual**. Cualquier dato fiscal (impuestos incluidos, tipo de factura, costo neto, contribuciones) se verificará antes de mostrarlo como precio total definitivo en la web o realizar el cobro.
- **Prueba: 7 días**, única por identidad/establecimiento conforme controles antiabuso, sin tarjeta ni conversión automática.
- Sin calendario ficticio de vencimiento de la promoción: la tarifa permanece ofertada mientras SpukLab la seleccione. Un cambio de selector afecta **solo nuevas contrataciones**; no reescribe contratos, montos ni renovaciones vigentes. Cambios a un suscriptor necesitan gestión contractual expresa y aviso/consentimiento adecuados.
- El valor ya existe en `cithela_private.cithela_price_options` como `amount_minor=1500000` (`ARS`, `month`); existe también una opción interna de ARS 18.000. **No crear duplicados.** Seleccionar la opción de ARS 15.000 desde el Centro comercial con la cuenta administradora y constatar el registro de auditoría. La selección interna **NO publica una oferta, ni crea pagos**: `is_published=false` sigue siendo una barrera.
- Tarifas excepcionales acordadas para un cliente se registrarán por contrato/suscripción y nunca como cambio global del precio.

## Circuito de autoservicio objetivo (aún NO activo)
1. Profesional se registra mediante enlace universal (compartible por WhatsApp), verifica identidad y configura su establecimiento; se habilita una única prueba sin pago. Mientras la inscripción pública no esté implementada, **se mantiene la autorización por invitación**.
2. La web muestra funciones y precio total verificado, frecuencia, condiciones, privacidad, baja y situación del trial. **No solicitar medios de pago para iniciar la prueba.**
3. Cuando el profesional elige **Contratar**, el servidor identifica al dueño del establecimiento, toma un snapshot inmutable del precio y de los términos aceptados, y crea una intención idempotente con referencia única. No aceptar monto, establecimiento ni autorización de cobro enviados libremente por el navegador.
4. Crear una suscripción de Mercado Pago **sin plan asociado, pendiente** mediante un adaptador servidoral con credenciales privadas de PRODUCCIÓN y consentimiento explícito. Validar `collector_id`, `external_reference`, periodicidad, importe, moneda, propietario y checkout del proveedor. No permitir dos suscripciones activas para un mismo establecimiento. Enviar al enlace oficial devuelto por MP; no inventar URLs.
5. Verificar eventos **firmados** y almacenados en bandeja idempotente. Corroborar el estado consultando MP en servidor; un `preapproval` pendiente, un redireccionamiento o una notificación aislada **NO acreditan** un pago. Solo pagos efectivamente aprobados y conciliados actualizan derechos de acceso y fechas de período en transacciones protegidas; conciliar reintentos, duplicados, cancelaciones, devoluciones, impagos y contracargos.
6. Permitir al titular consultar estado, importe contratado, próxima fecha de renovación y cancelar con confirmación; conservar sus turnos/datos según política de retención. Nunca borrar agendas automáticamente ante un pago fallido.

## Cortesías: acceso ≠ facturación
- El Centro comercial ya suma días gratuitamente desde el vencimiento más lejano de prueba/período contratado/cortesía previa, sin reducir tiempo.
- **Advertencia:** con una suscripción de Mercado Pago activa, añadir días de acceso **NO** detiene sus débitos recurrentes. Hasta implementar pausa/crédito/reprogramación verificada y conciliada con MP, una cortesía a suscriptor pago **no se anunciará como mes sin cobro**. No hacer cambios de cobro solo por una edición administrativa del entitlement.
- Los pilotos protegidos no cambian y las cortesías no alteran importes de servicios/señas de terceros.

## Límite financiero irrevocable
Mercado Pago es **únicamente** para cobrar productos de **SpukLab** (CITHELA y, después, DAHZEA u otros). CITHELA no recibe, procesa ni verifica señas entre el establecimiento y sus pacientes. Sus reservas y estados de seña son independientes.

## Puertas para habilitar ventas reales
- Credenciales de PRODUCCIÓN y webhook privado verificados, separadas de TEST. No cargar secretos en repositorio ni browser.
- Implementar adaptador de cobro de producción y cierre completo de la conciliación con idempotencia (el código de hoy implementa solo pruebas e inspección de lectura). Simular fallos/reintentos y probar cancelación y recuperación, duplicidad y multiempresa.
- Validar comisiones reales de MP según cuenta/plazo, impuestos, facturación, términos, privacidad, soporte y precio final visible.
- Confirmar pruebas de iPhone/iPad/escritorio; sólo entonces habilitar `Contratar` y el onboarding público. La web hoy informa disponibilidad; no afirmar que ya cobra o da de alta libremente.

## Referencias
- `cithela/supabase/commercial-controls-price-free-retention-20261104.sql`
- `cithela/supabase/commercial-admin-command-20261104.sql`
- `cithela/supabase/commercial-additive-grace-20261109.sql`
- `cithela/payments/mercadopago-pending-preapproval.mjs`
- `cithela/payments/mercadopago-reconciliation.mjs`
- `cithela/docs/selfservice-whatsapp-public-booking-20261109.md`
- [Mercado Pago: suscripciones sin plan asociado y pago pendiente](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments)
- [Mercado Pago: notificaciones de suscripciones y pagos](https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/your-integrations/notifications/additional-info)
