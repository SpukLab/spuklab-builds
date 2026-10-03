# CITHELA — Señas manuales · primera versión

## Alcance

La seña es una condición comercial configurable por servicio, independiente del estado de la reserva. No hay pasarela de pago ni transferencias ejecutadas por CITHELA. Todos los importes son **ARS**, almacenados como centavos enteros (`deposit_amount_minor`), con importe fijo opcional entre 0 y ARS 5.000.000. Se configura en **Profesional → Configuración → Servicios → Seña requerida**. `0` significa que el servicio no exige seña.

**Cada turno conserva su propia política:** al crear una reserva, un trigger del servidor copia el importe y la moneda desde el servicio y establece `requested` si hay seña o `not_required` si no la hay. Las reservas previas a esta fase quedan con seña 0. Editar posteriormente el importe del servicio afecta solo a nuevas reservas; reprogramar conserva el importe original.

El catálogo de reservas del paciente muestra el importe antes de elegir horario y en la confirmación final. **Mis turnos** muestra el importe y su estado, pero no los medios ni los datos internos de los cobros.

## Gestión manual en la agenda cloud

- **Seña pendiente (`requested`):** el profesional puede preparar «Solicitar seña» por WhatsApp con importe y horario, o abrir «Gestionar seña» y registrar un cobro **solo después de comprobar que recibió efectivamente todo el importe**. Métodos: transferencia, efectivo y otro comprobado.
- **Cobro verificado manualmente (`verified`):** un propietario o administrador puede registrar una devolución **solo después de efectuarla por fuera de CITHELA**, o corregir un cobro marcado por error cuando no se recibió dinero.
- **Seña eximida (`waived`):** el propietario o administrador puede eximir una seña pendiente. Se conserva el importe original para trazabilidad.
- **Devolución registrada manualmente (`refunded`):** registra la devolución completa. Las devoluciones parciales no están implementadas.
- **Sin seña (`not_required`):** la reserva no muestra controles de cobro.

El operador puede verificar un cobro efectivamente recibido; exenciones, devoluciones y correcciones requieren el rol owner/admin. Un registro financiero no cambia `pending` o `confirmed` en el turno. Cancelar un turno tampoco cancela ni devuelve el dinero. El portal y la agenda advierten que cualquier devolución depende del procedimiento del establecimiento.

Cada comando queda auditado con tenant, usuario, tipo de acción, importe y versión. La operación se protege mediante el bloqueo de tenant compartido con reservas, `row_version` e idempotencia por `request_id`. Las acciones se realizan en el servidor. La salida de WhatsApp permanece manual y no implica pago recibido ni mensaje entregado. **No almacenar números de tarjeta, CBU, credenciales, comprobantes ni datos bancarios en notas del turno.**

## Pruebas

1. Crear un servicio de prueba con duración 45 minutos y seña fija, por ejemplo ARS 2.000. No usar datos financieros reales para probar cambios de interfaz.
2. Comprobar desde una cuenta paciente que el importe aparece en el selector y antes de reservar; en la agenda profesional debe figurar «Seña pendiente».
3. Probar el borrador «Solicitar seña» por WhatsApp con un número que controles. Solo prepara el mensaje; no cobra ni marca la seña como recibida.
4. Registrar un cobro **únicamente si se ha recibido de verdad**. Confirmar que el turno mantiene su estado independiente. En un entorno de pruebas aislado se puede usar un ingreso de prueba efectivamente recibido.
5. Para una devolución, completarla por el medio externo primero y luego registrarla como devuelta. No usar «Registrar devolución» si todavía no se enviaron los fondos.
6. Editar el importe del servicio y comprobar que una reserva anterior conserva su importe; realizar otra reserva para verificar la política nueva.
7. Cancelar una reserva con seña verificada y comprobar la advertencia y que no hay devolución automática.

## Pendiente, fuera de esta entrega

- Política de vencimiento de seña, plazo de pago, reprogramaciones sujetas a política y términos de cancelación por establecimiento.
- Precio total del servicio, porcentaje de seña, pagos parciales, varios medios, devolución parcial, conciliación bancaria o reportes contables certificados.
- Envío automático de WhatsApp y pasarela de pago con consentimiento, webhooks verificados y conciliación.
- Política jurídica, fiscal y de protección de datos para el establecimiento y el territorio donde opere.

**No activar cobros a clientes del piloto hasta acordar el importe, el plazo, las condiciones de cancelación y el procedimiento de devolución con la peluquera.**
