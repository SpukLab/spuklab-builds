# CITHELA · Conciliación de suscripciones y cancelación

Estado al 2/11/2026: **código de consulta sin desplegar ni ejecutar pagos reales.**

## Controles implementados

El módulo `cithela/payments/mercadopago-reconciliation.mjs` consulta recursos a la API de Mercado Pago, usando únicamente identificadores y referencias previamente registrados por un backend confiable.

1. Comprueba el ID de suscripción, el comercio, la referencia única, el monto en centavos, la moneda ARS y la frecuencia mensual.
2. Consulta las facturas autorizadas vinculadas y detecta discrepancias y exceso de resultados.
3. Reconsulta por separado cada pago aprobado y acreditado; no confía en el estado de suscripción como evidencia de cobro.
4. Devuelve un resultado reducido, sin credenciales ni información del pagador. No altera el estado comercial, no activa acceso y no crea cobros.

**Importante:** el reconocimiento de un pago histórico no equivale a un período vigente. Falta establecer períodos abonados, reembolsos/contracargos y conciliación de eventos fuera de orden antes de actualizar `active`.

La función `prepareMercadoPagoCancellation` comprueba si la suscripción corresponde al pedido esperado y si se encuentra en estado cancelable. Es una **consulta previa**: no realiza cancelaciones. La futura baja deberá requerir identidad, confirmación explícita, llamada al proveedor, verificación del resultado y registro de auditoría.

## Verificaciones

Los tests con respuestas simuladas cubren: cobro confirmado, pago pendiente, pago autorizado sin captura, reembolso, factura ajena, referencia cruzada, comerciante incorrecto, monto/moneda discordantes, error de API, paginación incompleta y cancelación preliminar. No se solicita ningún cobro a la cuenta del usuario.

## Estado de integración

La bandeja de eventos privados está activa y vacía. El receptor Edge permanece sin desplegar. No se crearon suscripciones ni se modificaron reservas. Los dos establecimientos conservan el estado `legacy`.

Para abrir contratación falta: establecer precio y condiciones, crear orden y checkout autorizados, configurar y probar la cuenta comercial, recuperar recursos con credenciales privadas, conciliar períodos de servicio, registrar renovaciones y permitir baja confirmada.

Documentación oficial:
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval/get
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-authorized-payment/get
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/get-payment/get
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management
