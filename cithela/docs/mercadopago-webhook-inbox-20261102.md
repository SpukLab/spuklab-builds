# CITHELA — recepción durable de notificaciones de Mercado Pago

Fecha: 2026-11-02. Objetivo: registrar y deduplicar eventos **firmados**, sin activar pagos, suscripciones ni abrir contratación.

## Arquitectura implementada en código

- `cithela/payments/mercadopago-webhook-handler.mjs`: recibe POST, verifica HMAC con el validador existente, exige `type` y `data.id` en URL, coincide `data.id` y `type` del body, comprueba `user_id` contra el comercio configurado y `live_mode` contra el entorno. Limita entrada a 16 KiB y no almacena body, emails ni claves. Respuesta 200 únicamente después de persistir o reconocer un evento ya guardado; 503 si falla la base para que el proveedor pueda reintentar.
- `cithela/edge/cithela-mercadopago-webhook/index.ts`: adaptador futuro a Supabase Edge Functions, con `CITHELA_MP_WEBHOOK_ENABLED=true` como habilitación explícita y secretos **solo servidor**. Usa la misma versión del cliente Supabase que CITHELA WhatsApp. **NO desplegado** (sin URL pública ni credenciales). Requiere configurar `verify_jwt=false` solo para esta función webhook (la autenticación es HMAC del proveedor). No se publicó una URL de webhooks.
- `cithela/supabase/mercadopago-signed-webhook-inbox-20261102.sql`: tabla privada, RLS sin acceso a cliente, RPC `public.cithela_mp_record_signed_event` con permiso `EXECUTE` exclusivo del rol de servidor, y llaves únicas por identificador de evento y por solicitud firmada+recurso. Cuando se repite un evento devuelve `duplicate`; si alguien intenta reutilizar el identificador con otros datos devuelve `event_id_conflict`.
- La tabla solo guarda metadatos indispensables. No tiene referencias a `tenant_id` ni permisos de modificar `cithela_commercial_entitlements`, para impedir que una notificación produzca activación por sí sola.

## Evidencias

- Ensayo SQL previo `BEGIN/ROLLBACK`: rol `service_role` puede registrar, recibir repetición y distinguir conflictos; `anon` / `authenticated` sin permiso, tópico inválido rechazado. Terminó con 15 turnos y **sin tabla nueva** antes de aplicarse.
- **Despliegue realizado:** migración `cithela_mp_signed_webhook_inbox_20261102` aplicada en Supabase con `success=true`. Ensayo posterior con rol servidor, duplicados y conflictos rechazados; todo bajo `BEGIN/ROLLBACK` para no guardar eventos falsos. Resultado: **0 eventos**, 2 establecimientos, 15 turnos, 2 entitlements `legacy`, 0 trials. La función Edge receptora sigue sin desplegarse.
- Advisor: RLS sin políticas en esta tabla privada es intencional; se registran aparte la protección de contraseñas filtradas y un aviso de `SECURITY DEFINER` de la RPC de estado comercial, accesible solo a propietarios/administradores gracias a su verificación interna de membresía (riesgo revisado y documentado).
- Suite Node de firmas + receptor verifica firma buena, ID alterado, comercio ajeno, entorno incorrecto, tópico fuera de contrato, body malformado, duplicados, conflicto, indisponibilidad de la base y errores de configuración.

## Barreras que restan antes de activar pagos

1. Definir precio/moneda/impuestos, aceptación de términos y titular de cuenta Mercado Pago.
2. Configurar credenciales y secreto webhook en Supabase (nunca en GitHub/frontend), comprobar que `live_mode` corresponda a pruebas/producción y merchant ID.
3. Implementar recuperación del recurso de Mercado Pago autenticada **desde servidor** (`preapproval`, `authorized_payments`, `payments`), cotejar recurso+vendedor+plan+estado+período+monto+moneda contra consentimiento/orden registrada en la base. El contenido de webhook NO acredita un cobro por sí solo.
4. Consumidor/reconciliador idempotente y auditable, reintentos y recuperación de eventos detenidos. No se cambia `active` sin esa verificación. Mantener cancelaciones, exportación de datos y baja del débito en Mercado Pago.
5. Solo entonces desplegar Edge Function con `verify_jwt=false`, configurar URL y tópicos en Mercado Pago, simular eventos desde dashboard y verificar idempotencia con registros reales. **No habilitarla únicamente por la existencia del módulo.**

### Tópicos previstos
`subscription_preapproval`, `subscription_authorized_payment`, `payment`. Mercado Pago documenta esos tópicos para suscripciones y pagos; también debe configurarse `payments` aunque se usen notificaciones de suscripción.

### Documentación
- Firma y notificaciones: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/optional-notifications
- Notificaciones de suscripciones: https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/your-integrations/notifications/additional-info
- Supabase JWT por función: https://supabase.com/docs/guides/functions/function-configuration

**Costos:** no se contrató infraestructura nueva. **Seguridad:** no se activaron cobros ni se alteraron agendas.

**Separación de fases:** la existencia de la tabla NO significa que CITHELA reciba notificaciones de Mercado Pago. El secreto, la URL receptora y la conciliación de pagos todavía están ausentes; el sistema no puede activar un plan por este medio.
