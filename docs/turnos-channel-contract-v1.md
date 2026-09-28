# Turnos — Channel Contract v1

Estado: contrato conceptual estable para desacoplar UI, WhatsApp y futuros clientes del motor de agenda.

## Objetivo

Cualquier canal debe hablar con Turnos mediante comandos de dominio, no escribiendo directamente en la persistencia.

Canales posibles:
- UI web;
- WhatsApp;
- DAHZEA;
- portal SpukLab;
- integraciones futuras.

## Envelope de comando

```json
{
  "version": 1,
  "requestId": "req-...",
  "channel": "web | whatsapp | dahzea | api",
  "actor": {
    "type": "customer | operator | system",
    "id": "optional"
  },
  "command": "availability.query",
  "payload": {}
}
```

## Envelope de respuesta

```json
{
  "ok": true,
  "code": "availability",
  "requestId": "req-...",
  "data": {}
}
```

Los consumidores deben usar `code` y datos estructurados, no depender de textos de UI.

## Comandos v1

### catalog.services

Devuelve el catálogo de servicios vigente.

### catalog.resources

Devuelve profesionales/recursos disponibles.

### person.resolve

Entrada:

```json
{
  "phone": "+54...",
  "name": "Ana",
  "createIfMissing": false
}
```

El teléfono se normaliza para resolver identidad.

Códigos:
- `person_found`
- `person_created`
- `person_not_found`
- `invalid_phone`
- `name_required`

La creación automática solo ocurre cuando `createIfMissing=true`; el canal debe decidir explícitamente esa política.

### availability.query

Entrada:

```json
{
  "fecha": "2026-10-01",
  "servicioId": "S001",
  "resourceId": "R001"
}
```

Salida principal:
- servicio resuelto;
- recurso resuelto;
- lista de slots disponibles.

### appointment.create

Entrada:

```json
{
  "patientId": "1001",
  "fecha": "2026-10-01",
  "hora": "10:00",
  "servicioId": "S001",
  "resourceId": "R001",
  "motivo": "opcional"
}
```

Códigos esperados:
- `appointment_created`
- `patient_not_found`
- `invalid_date`
- `slot_unavailable`

### appointment.confirm

Entrada:
```json
{ "id": "T..." }
```

Códigos:
- `appointment_confirmed`
- `appointment_already_confirmed`
- `appointment_not_found`
- `invalid_state`

### appointment.cancel

Entrada:
```json
{ "id": "T..." }
```

Códigos:
- `appointment_cancelled`
- `appointment_already_cancelled`
- `appointment_not_found`
- `invalid_state`

### appointment.reschedule

Entrada:

```json
{
  "id": "T...",
  "fecha": "2026-10-02",
  "hora": "14:00"
}
```

Códigos:
- `appointment_rescheduled`
- `appointment_not_found`
- `invalid_state`
- `invalid_date`
- `slot_unavailable`

## Idempotencia

La capa HTTP/webhook futura deberá manejar `requestId` para evitar ejecutar dos veces el mismo comando ante reintentos del proveedor.

El prototipo local implementa una cache acotada de hasta 200 `requestId` en `localStorage` para validar la semántica:
- repetir el mismo `requestId + command` devuelve la respuesta almacenada con `replayed=true`;
- reutilizar el mismo `requestId` con otro comando devuelve `request_id_conflict`.

Esto es solo una prueba de contrato. El backend real deberá usar persistencia transaccional y una política explícita de expiración para idempotency keys antes de recibir webhooks reales.

## WhatsApp

El adaptador de WhatsApp debe:

1. identificar tenant/product instance;
2. resolver o crear identidad de cliente según la política del producto;
3. interpretar intención;
4. convertirla en uno de los comandos de este contrato;
5. ejecutar el comando;
6. renderizar una respuesta para WhatsApp.

No debe:
- modificar localStorage directamente;
- inventar disponibilidad;
- considerar un mensaje como confirmación sin una acción/intent inequívoca;
- almacenar secretos en el navegador.

Ejemplo conceptual:

```text
"¿Tenés turno mañana para corte con Juan?"
          ↓
availability.query
          ↓
slots [10:00, 10:30, 16:00]
          ↓
"Sí. Tengo 10:00, 10:30 o 16:00."
```

Luego:

```text
"10:30"
   ↓
appointment.create
   ↓
appointment_created
   ↓
"Listo. Quedó reservado..."
```

## Backend futuro

La implementación HTTP puede mapear el contrato a endpoints como:

```text
GET  /availability
POST /appointments
POST /appointments/:id/confirm
POST /appointments/:id/cancel
POST /appointments/:id/reschedule
```

La forma HTTP concreta puede cambiar sin alterar los comandos de dominio.

## Relación con TurnosDomain

El prototipo actual ya expone una fachada interna:

```text
TurnosDomain.listServices
TurnosDomain.listResources
TurnosDomain.resolvePerson
TurnosDomain.listAvailability
TurnosDomain.createAppointment
TurnosDomain.confirmAppointment
TurnosDomain.cancelAppointment
TurnosDomain.rescheduleAppointment
```

La UI web usa progresivamente esta misma fachada. El backend futuro deberá conservar la semántica, aunque cambie la implementación.

## Dispatcher local

El prototipo también expone `TurnosChannel.execute(envelope)`, que valida versión, comando y `requestId`, y traduce comandos de canal a `TurnosDomain`.

Esto permite probar la frontera sin conectar todavía Meta/WhatsApp ni un backend.

## Relación con DAHZEA

DAHZEA será un consumidor posible del contrato, no la autoridad del dominio de agenda.

Puede:
- consultar disponibilidad;
- crear/reprogramar/cancelar a pedido;
- conversar con el cliente;
- coordinar otros canales.

No debe:
- sobrescribir reglas de disponibilidad;
- decidir por sí mismo que un slot está libre;
- convertirse en requisito para que Turnos funcione.

## Versionado

Cambios incompatibles requieren una nueva versión del contrato. Los eventos persistidos deben conservar suficiente contexto para auditar qué acción ocurrió y desde qué canal.
