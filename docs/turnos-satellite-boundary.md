# Turnos — Satellite Boundary v1

Estado: **satélite independiente**. Este documento define la frontera para que el módulo pueda evolucionar sin depender del runtime de DAHZEA y, más adelante, conectarse sin reescribir el dominio.

## Objetivo actual

Resolver agenda de turnos, disponibilidad, confirmaciones y operación asistida por WhatsApp en un módulo autónomo.

La palabra **Turnos** es un nombre funcional interno. La marca visible es configurable y puede cambiar sin renombrar las entidades del dominio.

## Invariantes

1. Un turno activo ocupa exactamente un `fecha + hora`.
2. Dos turnos activos no deben ocupar el mismo slot.
3. Un turno cancelado no bloquea disponibilidad.
4. Un bloqueo puede cerrar un día completo o un horario puntual.
5. Reservar o reprogramar siempre revalida disponibilidad al confirmar.
6. Abrir WhatsApp no significa que el mensaje fue enviado, recibido o leído.
7. El estado `recordatorioAt` solo se establece por una acción explícita del operador.
8. Reprogramar devuelve el turno a `pendiente`.
9. `atendido` y `ausente` son estados terminales operativos; no deben volver a recordatorios ni a la vista de próximo turno.
10. La marca/UI no forma parte de la identidad del dominio.
11. DAHZEA no es una dependencia de ejecución.

## Entidades actuales

### Patient
Campos principales:
- `id`
- `nombre`
- `tel`
- `alergias`
- `obs`
- `archivos[]`
- `creado`

La comparación de identidad telefónica usa una versión normalizada solo con dígitos.

### Appointment
Campos principales:
- `id`
- `pacienteId`
- `fecha` (`YYYY-MM-DD`)
- `hora` (`HH:MM`)
- `motivo`
- `estado`: `pendiente | confirmado | cancelado | atendido | ausente`
- `creado`

Metadatos operativos opcionales:
- `reprogramado`
- `confirmadoPor`
- `confirmadoAt`
- `waOpenedAt`
- `waOpenedCount`
- `recordatorioAt`
- `recordatorioPor`

### AvailabilityBlock
- `id`
- `fecha`
- `hora` opcional; vacío significa día completo
- `motivo`
- `creado`

### OperationalEvent
- `id`
- `type`
- `at`
- `actor`
- `payload`

Se conservan los últimos 300 eventos en el prototipo local.

## Operaciones de dominio expuestas hoy

- Consultar slots disponibles.
- Crear turno.
- Confirmar turno.
- Cancelar turno.
- Reprogramar turno.
- Cerrar atención como `atendido` o `ausente`.
- Agregar/quitar bloqueo de disponibilidad.
- Construir recordatorio WhatsApp.
- Marcar recordatorio como enviado por el operador.
- Exportar/restaurar backup local.
- Ejecutar diagnóstico de integridad.

## Frontera WhatsApp

WhatsApp es un adaptador de canal, no la autoridad del turno.

El prototipo puede:
- construir texto con plantilla configurable;
- abrir `wa.me`;
- registrar que WhatsApp fue abierto;
- registrar manualmente que el operador considera enviado el recordatorio.

El prototipo **no debe inferir**:
- entrega;
- lectura;
- respuesta;
- confirmación automática.

Cuando exista integración oficial, esos eventos podrán provenir de un proveedor de canal sin cambiar el modelo de Appointment.

## Persistencia actual

`localStorage`:

- `cl_p`: pacientes
- `cl_t`: turnos
- `cl_blocks`: bloqueos
- `cl_events`: eventos
- `cl_cfg`: configuración

Backup portable:
- schema: `turnos-local-backup`
- version: `1`
- la clave local de acceso se excluye del backup.

## Futura conexión con backend / DAHZEA

La migración deberá reemplazar el adaptador de persistencia, no las reglas del dominio.

Interfaz conceptual mínima:

```text
AppointmentStore
  listAppointments(range)
  createAppointment(input)
  updateAppointment(id, patch)
  listPatients()
  upsertPatient(input)
  listAvailabilityBlocks(range)
  putAvailabilityBlock(input)
  removeAvailabilityBlock(id)
  appendOperationalEvent(event)

MessagingChannel
  buildReminder(appointment, patient, template)
  open/send(message)
  receiveDeliveryEvent(event)   // solo cuando exista proveedor oficial
```

DAHZEA podrá consumir o invocar estas capacidades como otro cliente/orquestador. Turnos debe seguir pudiendo funcionar por separado.

## Checklist antes de backend compartido

- autenticación real para profesional/paciente;
- control de acceso a ficha clínica;
- almacenamiento seguro de archivos;
- timezone explícita;
- IDs estables del servidor;
- control de concurrencia/transacciones para slots;
- auditoría persistente;
- política de retención de datos;
- integración oficial de WhatsApp;
- migración versionada desde backup/localStorage.

## Validación actual

El archivo principal se mantiene parseable como JavaScript después de cada checkpoint y se evita disparar GitHub Actions durante esta fase para conservar presupuesto.
