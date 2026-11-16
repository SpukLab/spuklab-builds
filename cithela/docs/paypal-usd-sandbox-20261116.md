# CITHELA / SpukLab — PayPal en USD (preparación sin cobros)
**16/11/2026 — rama de desarrollo; NO desplegado ni activo.**

## Decisión
- Argentina: Mercado Pago / ARS, sin modificar opciones existentes.
- Internacional: PayPal / USD. El precio en USD **no está aprobado**: cualquier importe de los tests es ficticio.
- La prueba de CITHELA sigue sin tarjeta y no genera suscripción al caducar.
- El flujo será *Contratar expresamente → crear solicitud desde backend → PayPal aprueba → verificar pagos y períodos → habilitar acceso*. Ni el enlace, ni el estado ACTIVE, ni el webhook por sí solos acreditan una cuota.
- No cobrar señas de pacientes: PayPal se reserva a SpukLab por sus servicios.

## Archivos preparados
1. payments/paypal-sandbox-subscription.mjs: valida titular confirmado, tenant, plan verificado, precio USD congelado, consentimiento fresco y entorno SANDBOX. Construye solicitud para PayPal Subscriptions v1 y exige URL de aprobación auténtica. Sin red ni escrituras.
2. payments/paypal-sandbox-webhook.mjs: comprueba la firma de notificaciones contra la API oficial de PayPal SANDBOX. Solo devuelve metadatos mínimos verificados para una bandeja idempotente futura. No escribe en la base ni habilita acceso.
3. Tests Node y GitHub Actions específicos.
4. sql-review/paypal-usd-catalog-review-20261116.sql: revisión para permitir precios por moneda; NO aplicar todavía.

## Estado real de CITHELA comprobado
- En Supabase la columna cithela_private.cithela_price_options.currency_id tiene CHECK(currency_id='ARS').
- La selección de precio es única por plan_code, sin distinción de moneda. La administración comercial vigente presupone ARS.
- Los contratos Mercado Pago están separados y no se deben reemplazar ni convertir automáticamente.
- No se verificaron credenciales PayPal Business ni app PayPal para este producto; tampoco hay un endpoint de PayPal desplegado, precio internacional definitivo, webhook registrado o suscripción PayPal de CITHELA.

## Configuración necesaria de PayPal
PayPal exige cuenta **Business** para poner una integración de API en producción. Tener una cuenta personal no acredita esa condición. En https://developer.paypal.com/dashboard/applications una vez confirmada la cuenta Business:
1. Crear/elegir la app REST en pestaña **Sandbox**; obtener **Client ID** y **Client Secret**. Nunca pegarlos en chat, archivos, GitHub ni frontend.
2. Crear un producto de software y un plan mensual **USD** de prueba. Registrar el Plan ID (P-...), verificando que coincida con la oferta aprobada. Usar compradores ficticios en Sandbox.
3. Registrar el webhook del backend **cuando exista su endpoint de staging**; obtener Webhook ID, no confundirlo con Client ID. Suscribirse a eventos BILLING.SUBSCRIPTION.* y PAYMENT.SALE.* necesarios.

Secretos previstos, exclusivamente en backend (NO establecidos):
- CITHELA_PAYPAL_ENV=sandbox
- CITHELA_PAYPAL_SANDBOX_CLIENT_ID
- CITHELA_PAYPAL_SANDBOX_CLIENT_SECRET
- CITHELA_PAYPAL_SANDBOX_WEBHOOK_ID
- CITHELA_PAYPAL_SANDBOX_PLAN_ID
- CITHELA_PAYPAL_CHECKOUT_ENABLED=false

## Bloqueantes antes de un cobro real
- Migración multimoneda revisada y probada, adaptación del RPC comercial para seleccionar precios por país/moneda. No asignar precio USD mediante conversión ARS.
- Precio final en USD, impuestos y condiciones versionadas visibles antes de pagar.
- Tabla privada de intenciones PayPal con titular, tenant, consentimiento, monto y plan inmutables. Consultar al proveedor el producto/plan y confirmar divisa y mensualidad antes de crear suscripción.
- Backend autenticado crea la suscripción **una sola vez** por intención; clave idempotente, resultado persistido y conciliación antes de reintentar.
- Receptor firmado, bandeja idempotente, inspección autenticada de suscripción, transacciones acreditadas, reembolsos, impagos, contracargos, suspensión y baja por período.
- Titular puede ver estado, próxima renovación y cancelar en PayPal; conservar reservas/datos conforme política de retención.
- Verificar contratos, factura E/impuestos de exportación, comisiones, disponibilidad de retiros y QA en móvil/escritorio. Producción requiere habilitación explícita.
- No existe actualmente un SpukLab Hub transaccional en producción; estos contratos se mantienen en CITHELA para poder reutilizarlos después.

## Referencias oficiales
- https://developer.paypal.com/api/get-started/
- https://developer.paypal.com/api/subscriptions/v1
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/docs/subscriptions/reference/webhooks/

**Pruebas:** node --test cithela/paypal-sandbox-*.test.mjs

**No alterado:** Supabase productivo, Mercado Pago, suscripciones, sesiones, agendas, pacientes, precios públicos ni CTA de checkout.
