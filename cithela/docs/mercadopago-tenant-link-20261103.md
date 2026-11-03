# CITHELA — relación privada entre cliente, agenda y suscripción MP
Fecha: 03/11/2026 · Estado: **esquema privado DESPLEGADO y comprobado en Supabase; sin cargos ni nuevas altas**.

## Estado confirmado

- Mercado Pago Developers / CITHELA tiene Access Token de prueba en secreto de Supabase y Webhooks firmados de prueba funcionando. El 03/11 a las 19:11:23 ART, el simulador devolvió HTTP 200. Hay **1 evento simulado**, `live_mode=false`, estado `received`. Ninguna factura ni pago real se creó.
- Supabase mantiene 2 establecimientos y 15 turnos; sus 2 entitlements son `legacy`, 0 `trialing`. La contratación pública aún está cerrada.
- El código `mercadopago-reconciliation.mjs` lee suscripción, facturas y pagos desde Mercado Pago, pero **no activa ni cancela servicios**.

## Nueva tabla privada

`cithela_private.cithela_mp_subscription_intents` tiene `tenant_id`, `owner_user_id`, `external_reference`, `collector_id`, monto fijo en centavos ARS, aceptación explícita con versión y fecha, y el identificador de la suscripción del proveedor cuando existe.

Protecciones:
1. Datos en esquema privado con RLS; los roles `anon` y `authenticated` no tienen acceso. **Tampoco hay permiso directo `INSERT` de `service_role`**: la futura alta exigirá un RPC privilegiado limitado y una solicitud autenticada del titular. Hoy nadie puede abrir pedidos desde la aplicación.
2. Al preparar un pedido, el titular debe tener rol `owner` en **ese establecimiento** y ser propietario de un entitlement comercial nuevo (`trialing`, `payment_pending` o `past_due`). Las cuentas `legacy` quedan excluidas, sin pedirles pagar.
3. Consentimiento reciente y versión de términos. El backend que se implemente después **deberá verificar la acción real del propietario**; los campos enviados no bastan para acreditar aceptación.
4. Referencia comercial única y suscripción MP única. Solo un pedido no cancelado por establecimiento, sin cruce de tenants.
5. La identidad del cliente, comercio, precio y consentimiento se vuelven inmutables. Los únicos cambios posteriores admisibles son `prepared → linked → cancel_requested → canceled`.
6. Tabla restringida al **entorno de prueba** (`live_mode=false`), sin forma de crear pedidos productivos con esta versión.

## Triage de notificaciones

`public.cithela_mp_classify_inbox_event(id bigint)` solo permite `EXECUTE` a `service_role` y **no escribe nada**:

- Evento `sim_...` de la prueba del panel: `simulated_ignore`.
- Notificación de pago: `payment_requires_provider_lookup`; hay que consultar el pago al proveedor para determinar a qué suscripción pertenece y verificar su estado.
- Suscripción no vinculada a un pedido confiable: `unmatched_requires_review`.
- Suscripción cuyo identificador, comercio y entorno coinciden con un pedido preparado y vinculado: `matched_unverified`. **Coincidir no confirma pago**: aún requiere recuperar recursos desde la API de Mercado Pago.

No se actualiza `cithela_commercial_entitlements`, no se modifica `can_book`, ni se cancela el débito en Mercado Pago.

## Evidencia de pruebas

Se ejecutó la migración propuesta en el Supabase real **solo dentro de `BEGIN/ROLLBACK`**. Pasaron:

- Rechazo de intent de la cuenta `legacy`.
- Creación de un intent test con entitlement simulado temporalmente `payment_pending`, preservando titular/tenant.
- Rechazo de segundo intent abierto en la misma agenda.
- Evento de prueba sin vínculo → `unmatched_requires_review`; vinculado → `matched_unverified`.
- Denegación de cambio de tenant y sucesión estricta de baja.
- Evento simulado original → `simulated_ignore`.
- Sin permisos de clientes al registro o clasificación.

Después del rollback quedaron **2 tenants, 15 turnos, 2 legacy, 1 evento simulado y 0 intentos reales**.

**Despliegue posterior:** migración `cithela_mp_tenant_billing_link_20261103` aplicada con `success=true`. Verificación en vivo: 2 tenants, 2 membresías, 15 turnos, 2 entitlements `legacy`, 0 `trialing`, 1 evento de prueba registrado y 0 filas en `cithela_mp_subscription_intents`. El clasificador devolvió `simulated_ignore` para el evento existente. Los roles `anon` y `authenticated` no pueden ejecutar el clasificador ni leer la tabla. El rol `service_role` puede ejecutar la clasificación, pero no insertar pedidos directamente. No se modificó el receptor Edge ni las reservas.

## Pendiente para activar la comercialización

**No habilitar checkout todavía.** Faltan precio final y términos de contratación, endpoint autenticado de consentimiento y creación de pedido, suscripción de prueba realmente creada en Mercado Pago, reconciliación por período (con reembolsos y contracargos), idempotencia de cobranzas, cancelación efectiva confirmada por API y activación auditable de `entitlement`.

El siguiente bloque debería construir un **RPC restringido al servidor** y un endpoint de consentimiento/autorización con sesión real del titular, y después probar un pedido simulado en el entorno de Mercado Pago sin recurrir a `legacy`. No usar credenciales productivas.

Documentación oficial:
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/authorized-payment-search/get
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
