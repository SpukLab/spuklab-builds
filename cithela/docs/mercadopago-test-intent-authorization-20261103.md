# CITHELA — autorización de intento de suscripción de prueba

Fecha: 03/11/2026. Fase: **backend preparado, cobros y contratación pública inhabilitados**.

## Qué se implementa

`public.cithela_mp_prepare_test_intent`, RPC `SECURITY DEFINER` con `search_path` vacío y `EXECUTE` **exclusivo** de `service_role`, escribe un registro en `cithela_private.cithela_mp_subscription_intents` SOLO para cuentas comerciales nuevas, nunca para los dos pilotos `legacy`. Exige:

- titular `owner` del mismo tenant y titular del entitlement;
- email del titular verificado por Supabase;
- estado `trialing`, `payment_pending` o `past_due`, con bloqueo transaccional;
- referencia única `cithela_...`, vendedor numérico, importe válido expresado en centavos ARS;
- términos de demostración **`internal-test-only-v1`**, que no son condiciones comerciales y no autorizan cargos ni un contrato productivo;
- ningún intent abierto preexistente (si existe y tiene idéntico precio, dueño y versión, devuelve el mismo pedido; si no coincide, rechaza).

El esquema `cithela_mp_subscription_intents` ya cuenta con RLS y una restricción de un intent abierto por establecimiento. No se cambia ningún entitlement, reserva, paciente ni mensaje.

`cithela/payments/mercadopago-test-intent-handler.mjs` implementa un endpoint HTTP puro: exige origen web permitido, método POST, `tenantId` válido, `consent: true`, versión exacta de test y JWT autenticado. **El usuario no puede enviar ni elegir precio, vendedor ni titular**. El backend los obtiene de configuración y `auth.getUser()`; una petición con cualquier campo extra es rechazada. La respuesta puede incluir referencia de prueba, pero NO una URL de pago.

El adaptador `cithela/edge/cithela-mp-test-intent/index.ts` requiere **`verify_jwt=true`**. Está bloqueado por defecto hasta que se configuren explícitamente `CITHELA_MP_TEST_INTENT_ENABLED=true` y el importe de test `CITHELA_MP_TEST_AMOUNT_MINOR` por servidor. **No se deben configurar todavía**. Usa el `CITHELA_MP_MERCHANT_USER_ID` existente. No necesita ni utiliza Access Token de Mercado Pago y **no hace ningún POST a Mercado Pago**.

## Evidencia

Se aplicó el SQL en `BEGIN/ROLLBACK` contra la BD real para comprobar: permisos `anon`/`authenticated` denegados, usuario `legacy` denegado, cruce de tenant denegado, términos incorrectos rechazados, intención aceptada solo bajo estado comercial temporal, reintento idempotente con misma referencia, conflicto de precio rechazado y ausencia de pedidos duplicados.

**Rollback verificado:** 2 establecimientos, 15 turnos, 2 `legacy`, 0 intentos reales, 1 simulación webhook. No se tocó el servidor de mensajería ni se registró una suscripción.

Tests automatizados Node verifican consentimiento, origen, JWT, email y respuesta sin fuga de credenciales.

## Qué falta

1. Aprobar precio, condiciones, política de cancelación/facturación y versión de contrato que vea el cliente. Hasta entonces no publicar una opción de pago ni una pantalla de consentimiento contractual.
2. Construir la interfaz de revisión de oferta y consentimiento explícito en la web CITHELA antes del endpoint de producción. No confundir esta demostración técnica con términos aceptados.
3. Probar una cuenta comercial nueva (no las `legacy`), en entorno test; solo después evaluar activar el endpoint de intención.
4. Integrar `POST /preapproval` con token exclusivamente del servidor y consentimiento real, asociar el ID al intent y reconciliar facturas y pagos acreditados. `status=pending` de Mercado Pago no equivale a pago.
5. Cancelación real con confirmación del proveedor, tratamiento de reembolsos y períodos activos, auditoría e idempotencia. No declarar un cliente `active` solo por webhook firmado.

Docs: https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post y https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management

**Esta fase no ejecuta cobros, no abre suscripciones, no habilita trial público y no requiere cambios en las credenciales.**
