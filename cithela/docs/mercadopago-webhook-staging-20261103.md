# CITHELA · Mercado Pago Webhooks — habilitación supervisada de PRUEBAS

Actualizado: 2026-11-03. **Sin pagos ni suscripciones reales.**

## Receptor preparado

- Nombre Supabase Edge Function: `cithela-mercadopago-webhook`.
- URL HTTPS para la pestaña **Prueba** de Mercado Pago:
  `https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-mercadopago-webhook`
- Configuración de despliegue: `verify_jwt=false` únicamente aquí. Mercado Pago no envía un JWT de usuario; el receptor se autentica exclusivamente por `x-signature` HMAC y `x-request-id`.
- Fail-closed: `CITHELA_MP_WEBHOOK_ENABLED` debe ser la cadena `true`, debe existir la firma secreta, el ID de vendedor y la conexión a Supabase. Ausencia de configuración produce HTTP 503, sin registros ni cobros.
- **Solo modo prueba:** el adaptador fuerza `liveMode:false`, rechaza cualquier notificación con `live_mode:true`. Una integración productiva requerirá un endpoint y credenciales separados.
- Firma: datos `data.id` en query, `x-request-id` y `ts/v1`; firma HMAC-SHA256, ventana de ±5 minutos, sin logs de secretos. Notificaciones duplicadas devuelven confirmación solo si ya están almacenadas en la bandeja privada.
- Persistencia: `cithela_private.cithela_mp_webhook_inbox` privada con RLS y escritura de servidor. **No cambia** `cithela_commercial_entitlements`, agenda, pacientes ni historial.

## Pasos de usuario en Mercado Pago Developers

1. En **CITHELA → Notificaciones → Webhooks** (NO seleccionar IPN), ingresar a **Configurar notificaciones**.
2. Activar exclusivamente la pestaña **Prueba**, no Producción. Pegar la URL HTTPS anterior en **URL modo prueba**.
3. Seleccionar eventos **Planes y suscripciones** (las actualizaciones de suscripciones) y **Pagos**. Guardar. El panel genera una **Firma secreta** para autenticar las llamadas.
4. En Supabase `https://supabase.com/dashboard/project/mcqknmqhtmihegmifuka`, menú **Edge Functions → Secrets**, guardar:
   - `CITHELA_MP_WEBHOOK_SECRET`: la **Firma secreta** de Mercado Pago (no su Access Token).
   - `CITHELA_MP_MERCHANT_USER_ID`: ID del vendedor de Mercado Pago (visible como User ID en Información general de la aplicación).
   - `CITHELA_MP_WEBHOOK_ENABLED`: `true` **solo tras verificar los dos anteriores y confirmar la URL de prueba**.
5. Volver a **Webhooks → Simular notificación**, seleccionar **Prueba** y el tópico de suscripción. Después comprobar recepción firmada e idempotencia en `cithela_private.cithela_mp_webhook_inbox`, sin alta de cobro ni estado `active`.

**No compartir en el chat ni en capturas:** Firma secreta, Access Token, contraseñas de prueba, claves de servidor. No guardar tokens en HTML, GitHub ni notas de aplicación.

## Validaciones obligatorias

- `GET` retorna 405 y nunca un webhook aceptado.
- Un POST sin firma correcta retorna 401 (si está habilitado) o 503 (si está deshabilitado).
- Firma válida pero antigua (fuera de cinco minutos): 401.
- Evento de producción: rechazado.
- Notificación válida de prueba: registra solamente `event_id`, `topic`, `resource_id`, `request_id`, merchant id y fecha. Nunca modifica suscripciones.
- Repetición idéntica: `duplicate` sin segunda fila; conflicto de identificador: 409.
- Fallo de base: 503 para que Mercado Pago reintente.

**Bloqueantes de comercialización:** conciliación de pagos acreditados con período, autorización de suscripción del titular, precio definitivo, baja confirmada, facturación y legales. Hasta completarlos, mantener la contratación pública cerrada.

Referencias oficiales:
- https://www.mercadopago.com.ar/developers/es/docs/prestashop/additional-content/your-integrations/notifications/webhooks
- https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/your-integrations/notifications/additional-info
- https://supabase.com/docs/guides/functions/function-configuration
