# Turnos — Satellite Boundary v2

Estado: **satélite independiente**. Este documento define la frontera para que el módulo pueda evolucionar sin depender del runtime de DAHZEA y, más adelante, conectarse sin reescribir el dominio.

## Objetivo actual

Resolver agenda de turnos, disponibilidad, confirmaciones y operación asistida por WhatsApp en un módulo autónomo y reutilizable por distintos rubros: odontología, peluquería/barbería, tatuajes, estética, bienestar y otros servicios por cita.

La palabra **Turnos** es un nombre funcional interno. La marca visible es configurable y puede cambiar sin renombrar las entidades del dominio.

## Invariantes

1. Un turno activo ocupa un intervalo definido por `fecha + hora + duracionMin`.
2. Dos turnos activos del mismo `resourceId` no deben solaparse.
3. Un turno cancelado no bloquea disponibilidad.
4. Un bloqueo puede cerrar un día completo o un horario puntual.
5. Reservar o reprogramar siempre revalida disponibilidad al confirmar.
6. Abrir WhatsApp no significa que el mensaje fue enviado, recibido o leído.
7. El estado `recordatorioAt` solo se establece por una acción explícita del operador.
8. Reprogramar devuelve el turno a `pendiente`.
9. `atendido` y `ausente` son estados terminales operativos; no deben volver a recordatorios ni a la vista de próximo turno.
10. La marca/UI no forma parte de la identidad del dominio.
11. Servicio, recurso/profesional y marca son configurables; las reglas de agenda no dependen de un rubro concreto.
12. DAHZEA no es una dependencia de ejecución.

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


### Service
- `id`
- `nombre`
- `duracionMin` (múltiplos de 30 min en el prototipo)
- `creado`

El turno guarda además un snapshot de `servicioId`, `servicioNombre` y `duracionMin` para que un cambio posterior en el catálogo no altere el turno histórico.

### Resource
Representa la unidad cuya agenda no puede solaparse: profesional, peluquero, tatuador, box, sillón, etc.

- `id`
- `nombre`
- `creado`

El turno guarda un snapshot de `resourceId` y `resourceName`.

### Appointment
Campos principales:
- `id`
- `pacienteId`
- `fecha` (`YYYY-MM-DD`)
- `hora` (`HH:MM`)
- `servicioId`
- `servicioNombre`
- `duracionMin`
- `resourceId`
- `resourceName`
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

- Consultar slots disponibles por servicio, duración y recurso.
- Administrar catálogo de servicios.
- Administrar profesionales/recursos con agendas independientes.
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


## Perfil multi-rubro

La infraestructura debe separar **motor de agenda** de **presentación vertical**.

Elementos compartidos entre rubros:
- clientes/pacientes;
- servicios con distinta duración;
- profesionales o recursos;
- disponibilidad y bloqueos;
- creación, confirmación, reprogramación, cancelación y cierre;
- recordatorios y WhatsApp;
- auditoría, backup y diagnóstico.

Ejemplos:
- odontología: limpieza 30 min, tratamiento 60 min;
- peluquería: corte 30 min, color 120 min;
- tatuajes: consulta 30 min, sesión 180/240 min;
- estética: servicio 60/90 min.

La especialización futura debe resolverse mediante perfiles/terminología y campos opcionales, no mediante forks del motor de agenda.

La UI ya contempla terminología configurable `Paciente` / `Cliente`; internamente se mantiene compatibilidad con el modelo existente para evitar migraciones innecesarias.

## Contrato de canales

La UI, WhatsApp, DAHZEA y futuros clientes deben utilizar comandos de dominio comunes. El contrato v1 está documentado en `docs/turnos-channel-contract-v1.md`.

La implementación local ya expone la fachada `TurnosDomain` para disponibilidad, creación, confirmación, cancelación y reprogramación.

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
- `cl_services`: catálogo de servicios
- `cl_resources`: profesionales/recursos
- `cl_events`: eventos
- `cl_cfg`: configuración

Backup portable:
- schema: `turnos-local-backup`
- version actual: `3` (restaura backups v1/v2 con valores por defecto para servicios/recursos)
- la clave local de acceso se excluye del backup.

## Integración futura con plataforma SpukLab

Turnos seguirá siendo un producto autónomo. La plataforma central futura —que puede incluir a DAHZEA como gestor/orquestador— administrará identidad de tenant, usuarios, suscripciones, entitlements y conectores sin absorber el dominio de agenda.

Regla principal: **control plane ≠ runtime del producto**. Si el portal central no está disponible temporalmente, una instancia provisionada de Turnos no debería perder su capacidad operativa por ese motivo.

La estrategia completa está documentada en `docs/spuklab-control-plane-readiness.md`.

## Futura conexión con backend / DAHZEA

La migración deberá reemplazar el adaptador de persistencia, no las reglas del dominio.

Interfaz conceptual mínima:

```text
AppointmentStore
  listAppointments(range, resourceId)
  createAppointment(input)
  updateAppointment(id, patch)
  listServices()
  listResources()
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
- control de concurrencia/transacciones para intervalos y recursos;
- auditoría persistente;
- política de retención de datos;
- integración oficial de WhatsApp;
- migración versionada desde backup/localStorage.

## Validación actual

El archivo principal se mantiene parseable como JavaScript después de cada checkpoint y se evita disparar GitHub Actions durante esta fase para conservar presupuesto.
