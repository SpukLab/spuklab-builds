# SpukLab Hub — alcance comercial e integración segura (29/10/2026)

Estado: propuesta en rama, **sin altas públicas, pagos ni automatización de DAHZEA**.

## Propósito

SpukLab Hub es el catálogo y punto de entrada comercial para CITHELA, DAHZEA, SURKARA y productos futuros. Cada producto dispone de una web de presentación propia y mantiene su aplicación operativa independiente. No hay un nuevo backend comercial activo en esta etapa.

### Rutas actuales

- Hub institucional: `/hub/`.
- CITHELA comercial (propuesta): `/hub/productos/cithela/`.
- CITHELA operativa: `/cithela/`; no modificar ni exponer credenciales.
- DAHZEA comercial: enlace externo publicado desde la tarjeta del Hub; comprobar acceso anónimo antes de difundir.
- SURKARA: tarjeta informativa; web comercial propia pendiente.

No reemplazar `/cithela/` con una landing. La comercial y la operativa cumplen funciones distintas.

## Propiedad de datos y autorización

1. **Hub**: catálogo, leads comerciales consentidos, futuras organizaciones comerciales, planes, suscripciones, estados de pago y vínculos de acceso. Nunca almacenar agendas, notas clínicas, chats operativos o ventas detalladas.
2. **CITHELA**: `tenant_id` propio, turnos, personas, servicios, horarios, WhatsApp y pertenencias. No compartir pacientes, enlaces de invitación ni OTP con el Hub. Las políticas RLS, RPC, autenticación y pruebas A/B son la barrera efectiva; la UI no es barrera.
3. **DAHZEA**: datos de tiendas, pedidos y operaciones bajo su propio control de autorización; ningún usuario del Hub obtiene credenciales de Mercado Libre por visitar la web.
4. **SURKARA**: recursos, operadores y registros del campo aislados de los otros productos.
5. **Datos de un cliente frente a otro**: autorización server-side siempre ligada a identidad autenticada y organización; fallar cerrado ante dudas, revocación, suspensión o errores de provisión.

El uso de un único login futuro no significa acceso cruzado a datos. No poner claves de servicio, `service_role`, tokens OAuth, secretos Meta o credenciales de clientes en HTML público.

## Contrato de contratación futuro

`organization_id`, `product_id`, `plan_id`, `subscription_id`, `entitlement_status`, `requested_by`, `idempotency_key`.

El Hub registra la compra, verifica el pago **en servidor**, emite una habilitación y solicita el alta idempotente al producto. El producto devuelve su `tenant_id` y el estado. Los reintentos no pueden crear dos establecimientos ni habilitar acceso por un estado inventado en el navegador.

Estados previstos: `lead` → `registered` → `trial` / `payment_pending` → `active` → `past_due` / `cancelled`. Son un diseño, no funcionalidad desplegada.

## DAHZEA como asistente comercial

Una capa conversacional reutilizable puede operar dentro del Hub y de cada web pública, pero debe consultar **solo** catálogo, preguntas frecuentes, precios/condiciones publicados y estado de una compra verificado para esa sesión.

- Permitido: orientar, explicar un producto, derivar a contacto, preparar una solicitud de contratación.
- Sujeto a verificación del servidor: precios, disponibilidad de plan, cobros, estados, titularidad y activación de servicio.
- Prohibido: leer datos de pacientes/ventas/operadores de otro tenant, ejecutar SQL abierto, autorizar un tenant desde texto generado, manipular un cobro sin confirmación.
- Registrar acciones, gestionar abuso/rate limits y distinguir conversación de la operación transaccional.

## Puertas de salida del piloto

1. Dos cuentas profesionales CITHELA distintas; tenant A/B con reservas, personas, branding y WhatsApp independientes.
2. Pruebas RLS + RPC con IDs ajenos, sin modificar datos reales del piloto. Cualquier fuga es bloqueante.
3. Onboarding profesional/recovery y WhatsApp verificados; correo comercial fiable como respaldo.
4. Política de privacidad, baja/borrado, soporte, retención y presupuestos de uso revisados.
5. Solo después: automatización de contratación, cobro y soporte conversacional.

Referencias: `cithela/docs/spuklab-web-second-tenant-pilot-20261029.md` y `cithela/docs/spuklab-hub-commercial-contract-20261011.md`.
