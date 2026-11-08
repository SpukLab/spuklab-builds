# CITHELA — Mercado Pago: preapproval sin plan, pago pendiente (preparación segura)
**2026-11-08** · Estado: **código puro + tests automatizados; no despliegue del creador, ninguna suscripción ni cobro ejecutados**.

## Decisión de arquitectura
Modelo futuro: **subscriptions / without-plan / pending**, ARS mensual, valor congelado por cada solicitud con aceptación explícita del titular (no plan global modificable de forma implícita). Mercado Pago devuelve `init_point` para que el profesional autorice el medio de pago. El trial CITHELA de 7 días **no** se sustituye por free_trial en Mercado Pago. El alta profesional continúa sin tarjeta.

Documentación oficial:
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post
- https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management

El modelo tiene estado `pending` hasta que el pagador autorice el cobro; **ni el link, ni la preapproval, ni el webhook son prueba de pago**. La autorización y los pagos acreditados se concilian consultando los recursos al proveedor. Para finalizar se necesita manejar renovaciones, fallos, reembolsos, contracargos y baja en MP.

## Nuevo módulo preparado
`payments/mercadopago-pending-preapproval.mjs` es **solo un constructor y validador**, no endpoint y sin `fetch` ni `INSERT`. La única respuesta aceptable:
- solicitud de prueba expresamente habilitada, con `cithela_mp_subscription_intents` previamente preparado en `cithela_private`;
- titular autenticado, correo confirmado, misma cuenta, misma referencia, vendedor, centavos ARS y versión de aceptación **`internal-test-only-v1`**;
- consentimiento fresco (máximo 15 minutos), `stage=prepared`, `live_mode=false`;
- `status=pending`, `frequency=1`, `frequency_type=months` y sin `card_token_id` ni prueba gratuita de MP;
- respuesta del proveedor con ID, comercio, referencia, estado, moneda, importe y frecuencia coincidentes;
- `init_point` auténtico en `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=...`, no URL construida en browser.

El módulo devuelve `payment_confirmed:false` y `entitlement_activated:false` aun si toda la validación preliminar pasa. Una respuesta a `POST /preapproval` requiere **GET /preapproval/{id}** posterior antes de vincular ID/mostrar link, y cotejar el merchant/test mode del recurso devuelto. En particular, no se permite que el navegador mande `amount`, `tenant_id` ajeno, `merchant` ni un `init_point` inventado.

## Puertas restantes antes de cualquier llamada real a API
1. Definir valor mensual final, política de cancelación, período cobrado, impuestos/comisiones, términos/versionado, y texto de consentimiento del cliente. La tarifa elegida en Centro comercial sigue siendo **borrador**; un acuerdo individual deberá fijar su importe en un contrato no editable retroactivamente.
2. Implementar endpoint privado que reciba acción inequívoca del `owner`, compruebe JWT con `auth.getUser()`, lea intent desde el servidor, verifique el consentimiento y aplique **bloqueo/idempotencia durable por tenant+intent**. **NO reintentar POST a ciegas** ante timeout: se debe reconciliar/revisar la solicitud anterior para evitar doble creación. La documentación pública consultada no garantiza una clave de idempotencia para `preapproval`.
3. Conectar test-user/credenciales de prueba compatibles con **suscripciones**; no asumir por prefijo `TEST-` vs `APP_USR-` que una cuenta es sandbox. Validar el entorno y el vendedor a través de MP; no habilitarlo aún. No consumir Access Token en browser ni meter secretos en repositorio.
4. Tras crear el recurso con el proveedor: `GET /preapproval/{id}` autenticado; vincularlo a un único intent sin duplicados; consultar facturas y pagos; habilitar periodos pagos **solo tras conciliación** y con auditoría. Si vincular falla, no volver a crear otro preapproval; reconciliar y poner revisión manual.
5. Configurar baja efectiva con `PUT /preapproval/{id}`, recuperar el estado y diferenciar cancelación inmediata de fin del período pago. No borrar agendas.
6. Validar flujo móvil iPhone/iPad y PC, errores, webhooks fuera de orden, enlaces maliciosos, cuentas cruzadas y expiraciones con cuentas de prueba y cero cargos reales antes del lanzamiento público.

## No se modifica ahora
- `cithela_mp_subscription_intents`, `cithela_commercial_entitlements`, `cithela_price_options`, API de invitaciones y cortesías.
- Web pública, selector de precios, secret de producción, webhook y operaciones de cobro.
- Ningún cliente con cuenta `legacy`, `trialing` o `complimentary` paga ni pierde acceso por este cambio.

### Verificación
`node --test cithela/mercadopago-pending-preapproval.test.mjs`; workflow `CITHELA Mercado Pago pending-preapproval contract`.
