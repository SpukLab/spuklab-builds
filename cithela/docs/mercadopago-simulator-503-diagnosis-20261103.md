# CITHELA — diagnóstico Mercado Pago Webhooks 503 (03/11/2026)

## Evidencia

La simulación de Mercado Pago del 03/11/2026, 18:29:53 (Argentina), aparece en los registros de Edge Functions como POST 503. En ese momento la bandeja de eventos tenía 0 registros, y las dos cuentas CITHELA conservaban sus turnos.

La configuración del receptor es deliberadamente **fail-closed**: devuelve `not_configured` (503) mientras no estén configurados `CITHELA_MP_WEBHOOK_ENABLED=true`, la Firma secreta, el User ID numérico y la clave de servidor disponible. El registro de acceso solo muestra 503; **no permite concluir cuál condición falta**.

## Revisión del simulador de Mercado Pago

La captura de prueba muestra URL `type=subscription_authorized_payment`, pero el cuerpo contiene `type: subscription_preapproval`, `entity: preapproval`, `action: updated` y NO incluye `user_id` ni `live_mode`. El receptor originalmente exigía coincidencia exacta, así que, una vez habilitado, ese formato sería rechazado con 403.

Se agrega una excepción **solamente para esa forma de simulación**, después de validar HMAC, timestamp y recurso. Se guarda en la bandeja privada como prueba, con ID `sim_` + request ID firmado. No se compara el ID de aplicación ficticio del simulador con el real, pero NO se infiere ninguna suscripción; nunca modifica permisos, pagos ni entitlements. Notificaciones productivas, firma incorrecta, cuerpo distinto o ambiente incorrecto siguen siendo rechazados.

## Verificación de configuración

Se incorpora `GET ?health=1`, que devuelve únicamente:

- `200 webhook_configured` cuando está habilitado y existen las condiciones mínimas.
- `503 not_configured` si aún falta configuración.

No devuelve nombres ni valores de secretos, identificador de vendedor o credenciales. El endpoint no registra pagos. Un GET ordinario sigue devolviendo 405.

URL de salud: `https://mcqknmqhtmihegmifuka.supabase.co/functions/v1/cithela-mercadopago-webhook?health=1`

## Pasos de verificación

1. Comprobar URL de salud. Con 503, revisar **Supabase → Edge Functions → Secrets** y confirmar exactamente los nombres `CITHELA_MP_WEBHOOK_SECRET`, `CITHELA_MP_MERCHANT_USER_ID`, `CITHELA_MP_WEBHOOK_ENABLED` (valor `true`), sin compartir sus valores.
2. Al obtener 200, reintentar la simulación del panel de Mercado Pago en entorno **Prueba**, evento **Planes y suscripciones**.
3. Confirmar HTTP 200 y una fila de simulación en la bandeja privada, sin modificar reservas ni subscripciones.

La integración comercial continúa cerrada: no existen cobros ni webhook productivo habilitado.
