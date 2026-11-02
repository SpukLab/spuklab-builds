# CITHELA · período gratuito de siete días, contrato de servidor V0

Estado: **propuesta validada en transacción y revertida; NO desplegada**. Fecha: 02/11/2026.

## Objetivo comercial
El profesional se registra, verifica su correo y recibe autorización de alta por backend. La creación de establecimiento inicia una sola prueba de **7 días**, sin tarjeta ni cobro; el servidor calcula inicio y fin. Al finalizar, puede ingresar, revisar y descargar información, pero no crear ni reprogramar reservas hasta aceptar una suscripción. El pago solo activa acceso después de validación del proveedor por webhook y nunca por parámetros del frontend.

## Qué se comprobó
Se preparó `cithela/sql-review/commercial-trial-entitlements-v0.sql` con tabla privada de entitlement, estado `legacy` de los establecimientos actuales, estados `trialing`, `active`, `past_due`, `canceled`, y evaluador de vencimiento con `statement_timestamp()`. Las tablas privadas tienen RLS y no conceden acceso directo a `anon` ni `authenticated`.

El SQL se ejecutó **dentro de BEGIN/ROLLBACK en el Supabase actual**, con comprobaciones dinámicas:
- Ambos establecimientos actuales reciben en la transacción estado `legacy` con acceso.
- Una prueba con vencimiento siete días después está vigente hasta el instante previo al límite.
- En el instante de vencimiento el resultado pasa a `trial_expired` y `can_book=false`, sin cron.
- Después del rollback no existe tabla comercial nueva; se conservan **2 establecimientos y 15 turnos**.

El ensayo transaccional **NO** reemplaza un entorno de staging aislado ni una prueba de pagos reales.

## Antes de implementar una prueba gratuita real

1. La migración debe incorporar el inicio del trial en **la misma transacción** que `bootstrap_tenant`, a partir de `terms_version` validado por un backend y una autorización no consumida. Los valores de fecha no pueden venir del cliente. El índice único previene reiterar trial al mismo usuario.
2. Hay que actualizar los caminos de creación/reprogramación de turnos, tanto profesionales como pacientes, y WhatsApp. Un simple bloqueo en el HTML **no cumple** el control comercial. Verificar también consulta de disponibilidad para no ofrecer turnos si la cuenta ya venció.
3. Deben permanecer permitidos: acceso del usuario, cancelaciones, exportación y consulta de datos, información de facturación, comunicación de soporte y baja.
4. Para pagos, la confirmación del webhook debe validar firma e idempotencia, moneda y monto acordados; `active` requiere período y referencia del proveedor comprobados. Una URL de éxito o mensaje de la IA no concede entitlements.
5. No borrar pacientes ni reservas cuando expire la prueba. Separar los datos de la agenda del estado comercial.
6. No presentar la prueba de siete días como disponible en la web hasta completar pruebas reales, correo de producción, condiciones legales y comprobación de pago y baja.

## Estado real al cierre
- **Ya aplicado:** protección de altas nuevas mediante `cithela_commercial_onboarding_guard_20261102`.
- **Solo diseño probado reversiblemente:** período de prueba y entitlement (este archivo).
- **No implementado:** activación transaccional de trial en nuevos tenants, restricción en todas las reservas, webhooks Mercado Pago, facturación, baja automatizada.
- **No contratado:** infraestructura adicional. No cambiar de plan de Supabase por una advertencia del advisor sin presupuesto.
