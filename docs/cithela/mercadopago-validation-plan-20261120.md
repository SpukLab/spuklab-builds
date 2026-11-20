# CITHELA — Mercado Pago: plan de validación de suscripción (2026-11-20)

## Estado comprobado
- `cithela-mp-test-connection`: conexión de lectura con credencial de prueba confirmada por la administración.
- `cithela-mp-test-intent`: función desplegada, deshabilitada por defecto; **solo prepara una intención**. No llama a Mercado Pago ni cobra.
- `cithela_mp_subscription_intents`: estructura privada disponible; no usarla como prueba de pago.
- `cithela-mp-webhook`: recepción no equivale a verificación del pago.
- Autoservicio público: desactivado. No habilitarlo con este cambio.

## Etapas obligatorias
1. **Intención controlada**: seleccionar establecimiento de pruebas propiedad del actor autenticado, consentimiento explícito, monto y moneda definidos en servidor; verificar que la función solo permita pruebas y que la cuenta comercial de Mercado Pago corresponda al vendedor esperado.
2. **Creación en entorno de prueba**: implementar endpoint administrativo separado; exigir sesión validada, entorno test, idempotencia y registro previo; usar API de suscripciones de Mercado Pago y guardar identificador remoto; nunca aceptar precio ni collector_id del navegador.
3. **Confirmación independiente**: consultar el estado remoto con credenciales de servidor; no habilitar por retorno del navegador ni por webhook sin verificación. Verificar firma del webhook y consultar API para reconciliar el recurso.
4. **Acceso y vencimiento**: actualizar derecho comercial solo tras evidencia de estado aprobado/activo y vínculo exacto de tenant, dueño, referencia externa, monto y modo test; bloquear cruces de establecimientos.
5. **Casos negativos**: pago rechazado, pendiente, cancelado, duplicado, notificación repetida/fuera de orden, expiración, renovación fallida y falta de red.
6. **Activación comercial**: recién con pruebas repetibles y revisión de producción; credenciales de producción separadas, consentimiento y precio final aprobados.

## Reglas
- No copiar tokens a GitHub ni al frontend.
- No generar cargos reales en pruebas.
- Mantener la contratación pública apagada hasta la validación completa.
- La prueba de conectividad exitosa **no** prueba el circuito de cobro.
