# CITHELA / Mercado Pago — checkpoint interno Alma y Pampa

## Alcance
Cuenta propietaria: alma.y.pampa@gmail.com. Tenant: e680ebd3-a031-4968-905a-e829ab3b5dfe.
Entorno: test, solo lectura. No habilita checkout, no crea pagos, no cambia entitlements.

## Checkpoint A — preflight (implementado)
Abrir /cithela/suscripcion-prueba.html con sesión de Alma y Pampa.
1. Validar requisitos: respuesta eligible_no_payment_created; test_only=true, checkout_enabled=false, subscription_created=false.
2. Consultar suscripción: no_subscription mientras no exista intención; payment_verified=false.
3. Repetir ambos: mismos resultados, cero efectos en DB.
4. Sesión ajena, no propietaria o sin email confirmado: acceso denegado.
5. No presentar checkout a cuentas legacy, a otros tenants ni a usuarios sin rol owner.

## Checkpoint B — checkout de prueba (BLOQUEADO)
Antes de desbloquear: confirmar credenciales de vendedor de prueba y comprador de prueba distintos; documentación MP vigente para preapproval e init_point; back_url fija; importe test fijado en servidor; consentimiento expreso; idempotencia y recuperación de fallos de red.
Un timeout después de POST /preapproval NO autoriza reintentar ciegamente: primero reconciliar por external_reference.
Confirmar seller/collector, live_mode=false, ARS, importe, reference y estado mediante GET de proveedor antes de vincular.
No cambiar entitlements por preapproval pendiente.

## Checkpoint C — pago y conciliación (BLOQUEADO)
Procesar webhook firmado en inbox; consultar API de proveedor y validar pago efectivamente aprobado, identidad, importe y no duplicación.
Pruebas: pago aprobado, pendiente, rechazado, cancelado, webhook repetido, evento fuera de orden, timeout, desconexión, pago de otra cuenta.
Solo aprobado verificable puede activar entitlement mediante transición idempotente y auditada.

## Criterio de salida
Pruebas automáticas verdes; checkout sandbox real desde iPhone; trazabilidad de intención, preapproval y pago; ningún cargo real; ningún cambio de plan en terceros.
No fusionar/activar cobros públicos por pasar únicamente Checkpoint A.
