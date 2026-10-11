# CITHELA · Catálogo de servicios y duración

## Entregado en esta fase

- **Configuración → Servicios:** propietario y administrador pueden crear, editar, desactivar y reactivar los servicios de su establecimiento. El operador puede consultarlos, pero no modificar el catálogo.
- Nombre de hasta 160 caracteres y duración de **15 a 720 minutos**, en incrementos de 15 minutos.
- Un servicio es una tarea reservable. El paciente y el profesional seleccionan un servicio del catálogo activo y un profesional/recurso; la disponibilidad en CITHELA Cloud se calcula en intervalos de 15 minutos y comprueba el intervalo completo antes de guardar.
- En el portal, el paciente ve inicio y fin estimado del turno (por ejemplo, 09:15–10:00 para un servicio de 45 minutos).
- Los turnos ya existentes guardan su propio nombre, duración, hora de inicio y hora de fin: editar el catálogo no modifica las reservas anteriores. Reprogramar un turno anterior conserva **su duración histórica**.
- Desactivar un servicio no lo borra y no se permite mientras tenga turnos futuros pendientes o confirmados; tampoco se puede desactivar el último servicio activo. La acción inversa reactiva el mismo registro.
- Las mutaciones del catálogo usan autorización por tenant y rol, bloqueo transaccional compartido con las reservas, idempotencia y control de versión por `updated_at`.
- El modo local de demostración también utiliza intervalos de 15 minutos. El catálogo cloud es la fuente autorizada en modo cloud.

## Piloto de peluquería

Configurar en el espacio independiente de la peluquería, por ejemplo:

| Servicio | Duración ilustrativa |
|---|---:|
| Corte | 45 minutos |
| Coloración | 120 minutos |
| Corte + coloración | 150 minutos |

Para reservar varias tareas juntas **en esta fase se crea un servicio combinado** con su duración total. El selector de múltiples servicios independientes y el cálculo automático de combinaciones quedan para una siguiente iteración. La agenda reserva de forma conservadora el tiempo completo del mismo profesional: las pausas de procesamiento en las que el profesional podría atender a otro cliente aún no se modelan.

### Prueba manual

1. Como propietario, entrar en **Configuración → Servicios**. Crear «Corte · prueba» de 45 minutos. Editarlo a 60 y devolverlo a 45.
2. En una cuenta de paciente vinculada, entrar en **Mis turnos → Reservar nuevo turno** y seleccionar «Corte · prueba». Revisar que se ofrecen horarios con inicio y fin separados por 45 minutos; elegir uno libre.
3. En la agenda profesional, verificar que el turno aparece y que un segundo paciente no puede reservar un intervalo superpuesto. Probar una reprogramación.
4. Intentar desactivar «Corte · prueba» mientras tenga un turno futuro activo: CITHELA debe impedirlo. Una vez atendido o cancelado el turno, podrá desactivarse y reactivarse.

## Próxima fase · señas

Diseñar una preferencia por establecimiento/servicio: sin seña, importe fijo o porcentaje; importe y moneda explícitos, vencimiento y política de cancelación. Estado de seña separado del estado del turno (solicitada / declarada / verificada / devuelta). La primera versión será **registro manual de transferencias u otros pagos recibidos**; no marcar dinero como acreditado automáticamente ni recoger tarjetas en la interfaz. Los pagos por pasarela, sus webhooks y la conciliación requerirán integración y pruebas independientes.
