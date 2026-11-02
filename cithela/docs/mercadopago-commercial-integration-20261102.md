# CITHELA — preparación de Mercado Pago (sin cobros habilitados)

Fecha: 2026-11-02. Estado: **solo código de verificación de firma y diseño de integración**. No se desplegó endpoint, se solicitó cobro, se creó una suscripción ni se modificó el ledger.

## Decisión de experiencia

La prueba CITHELA comienza en el servidor cuando se autoriza el alta profesional. Dura **7 días sin tarjeta ni renovación automática**. Una vez finalizada, el profesional puede decidir expresamente suscribirse. **No** activar el free-trial del plan de cobro de Mercado Pago como sustituto de nuestro trial: eso podría requerir asociar el medio de pago anticipadamente y contradice el recorrido aprobado.

## Plataforma de pagos prevista

Mercado Pago Argentina permite crear una suscripción en `POST https://api.mercadopago.com/preapproval`, con `external_reference`, `payer_email` y, cuando corresponde, plan y datos recurrentes. Su consulta autenticada usa `GET /preapproval/{id}` y la gestión de cancelación/pausa usa `PUT /preapproval/{id}`. Ver documentación actual:
- Crear suscripción: https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
- Gestión y baja: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
- Webhooks: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/optional-notifications

**Importante:** usar primero cuenta/credenciales de prueba y revisar disponibilidad exacta para el tipo de suscripción comercial contratado. No derivar una URL de cobro de datos del navegador ni publicar montos todavía.

## Qué aporta el código actual

`cithela/payments/mercadopago-webhook-signature.mjs`: función *server-only*, sin dependencias externas, basada en WebCrypto, con datos obligatorios:

- `x-signature` → `ts` y `v1` (hash hexadecimal).
- `x-request-id` de la notificación.
- `data.id` de la **URL del request**, no del cuerpo.
- Manifest firmado: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
- HMAC-SHA256 con clave secreta del backend; comparación con `crypto.subtle.verify`. Rechaza faltantes, duplicados o entradas malformadas y una firma alterada.

Su resultado es **booleano**: autentica solo el origen. No acepta un webhook como prueba de pago, no crea ni cancela suscripciones y no otorga acceso a CITHELA. El backend posterior **debe recuperar el recurso del proveedor con credenciales privadas**, cotejar merchant, tenant mapeado en el servidor, identificador único de evento, precio/moneda, estado de pago y período de la suscripción; no confiar en el cuerpo no verificado ni en redirecciones del checkout.

### No es un endpoint listo para usar

No hay URL receptora registrada ante Mercado Pago, secret configurada, credenciales ni colas de eventos. Este módulo necesita integrarse a una función Edge/Worker existente. No instalarlo en el frontend ni cargar tokens en Git.

## Operaciones mínimas siguientes

1. Confirmar cuenta comercial y monto **antes de mostrar precio**. Los valores discutidos previamente no se consideran definitivos. Relevar impuestos, comisiones, facturación y política de baja.
2. Crear desde servidor un enlace de suscripción **solo** tras intención explícita del titular y su autorización; vincularlo con su tenant sin confiar en un `tenant_id` arbitrario del cliente.
3. Registrar una notificación **firmada** en tabla privada con clave única del evento/recurso. Responder y procesar sin duplicados; obtener recurso por API oficial, correlacionar con consentimiento y suscripción del tenant. No habilitar `active` por recibir una llamada firmada: se requiere estado confirmado del proveedor.
4. Implementar suspensión/baja con sincronización, vencimiento de período, reintentos de pago y procedimiento de exportación de datos. Todo cambio en entitlement debe quedar auditado. Confirmar baja del débito en Mercado Pago, no únicamente deshabilitar CITHELA.
5. Validar casos de fraude: firma inválida, ID distinto, evento repetido, notificación tardía, pago pendiente o rechazado, tenant ajeno, cambio de precio y cancelación. El procesamiento de eventos debe tolerar reintentos.
6. Pruebas de integración con cuenta de prueba, después pilotos reales supervisados. Sin cobro real ni apertura autoservicio hasta aprobar seguridad, términos y facturación.

## Alcance en esta versión

**Completado:** utilidad criptográfica y pruebas automatizadas de HMAC y alteraciones.

**Pendiente:** implementación del endpoint, secretos, API de creación/consulta, reconciliación transaccional, idempotencia durable, cancelación automática, checkout y pruebas reales. No se incorporó ningún servicio nuevo ni costo.
