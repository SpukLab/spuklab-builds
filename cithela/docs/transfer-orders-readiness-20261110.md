# CITHELA / cobro por transferencia a SpukLab — preparación 10/11/2026

## Alcance de este cambio
La cuenta comercial de SpukLab usará el alias `alma.pampa`, declarado por el administrador como perteneciente al titular que informó. **Declaración no equivale a verificación de titularidad mediante Mercado Pago.** El alias y el nombre no se insertan en el SQL ni se publican en la aplicación de pacientes. Deben configurarse en las variables `CITHELA_TRANSFER_ALIAS` y `CITHELA_TRANSFER_HOLDER` únicamente al activar el entorno de cobros, después de verificar cuenta receptora y facturación.

Este PR incorpora un **borrador seguro** de órdenes para transferencia:
- Tabla de órdenes privada con snapshot del precio oficial seleccionado, siempre bajo `cithela_private`, RLS y revocación de acceso a los roles públicos.
- Una única orden pendiente por establecimiento; 72 horas para usarla; solicitudes repetidas devuelven la misma sin duplicar.
- Solo propietario verificado por Supabase puede solicitarla a través de Edge con JWT, confirmación explícita y versión de términos obligatoria. Ni importe, ni dueño, ni estado de pago, ni alias vienen del navegador.
- **Sin publicar oferta ni activar suscripciones:** en producción `cithela_price_options.is_published` permanece restringido a `false`. La función devuelve `offer_not_published` hasta una migración de lanzamiento revisada, y el Edge solo funciona si `CITHELA_TRANSFER_REQUESTS_ENABLED=true` y se configuran alias/titular.
- La orden solo puede estar `pending`, `expired` o `rejected`: `credited` está prohibido por CHECK y trigger. No cambia `cithela_commercial_entitlements` ni el derecho a reservar.
- **No se desplegó Edge ni se aplicó SQL en vivo.** Se validó sintaxis con `BEGIN/ROLLBACK` en Supabase y se comprobó que `authenticated` no tiene EXECUTE.

## Próximos trabajos antes de levantar el bloqueo
1. Confirmar titular y alias desde la cuenta receptora de Mercado Pago, verificando también el destino de la transferencia. Los datos aportados son una declaración de SpukLab; no se han obtenido mediante la API. No iniciar transferencias de prueba reales sin revisar comisiones, titularidad y cuenta de destino.
2. Completar texto legal de contratación (impuestos, total, duración, renovación voluntaria, facturación, baja y soporte), prueba de 7 días sin medio de pago y aceptación versionada.
3. Desarrollar consola administrativa de **conciliación manual** con referencia única de operación bancaria, monto, receptor y fecha de acreditación. No aceptar una foto de comprobante ni un mensaje de WhatsApp como prueba suficiente. Registrar evento auditado e idempotente, permitir reversión y proteger contra doble aplicación. Habilitar el servicio sólo entonces.
4. Preparar pago único alternativo con Mercado Pago **Checkout Pro Orders API** (`POST /v1/orders`), `X-Idempotency-Key`, `checkout_url` servido desde backend; conciliar webhook firmado más lectura del estado en API, sin confiar en el redirect. La integración anterior de `preapproval` queda **solo para pruebas de suscripciones**, no forma parte de la venta inicial sin débito automático.
5. Terminar alta profesional abierta desde WhatsApp con controles antiabuso; comprobar móvil iPhone, iPad y escritorio; desplegar y habilitar cobros sólo después de tests y aprobación.

## Prohibiciones expresas
No procesar ni recibir señas de pacientes. No compartir credenciales. No actualizar el estado de un establecimiento como pagado desde datos del navegador, un comprobante, un chat o un webhook aislado. No modificar la fecha anterior de vencimiento al otorgar meses. No cobrar recurrentemente sin consentimiento expreso.

## Documentación actualizada
- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/create-order?scope=prod
- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications?scope=prod
- `cithela/docs/commercial-launch-pricing-20261109.md`
- `cithela/supabase/cithela_transfer_orders_staged_20261110.sql`
