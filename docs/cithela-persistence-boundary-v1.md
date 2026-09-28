# CITHELA — Persistence Boundary v1

Estado: contrato para desacoplar el dominio del almacenamiento local y permitir Supabase sin reescribir canales.

## Principio

`TurnosChannel` es la frontera de comandos.
La persistencia es una dependencia reemplazable.

```text
UI / WhatsApp / API
        |
   TurnosChannel
        |
   Domain service
        |
 CithelaStore
   |        |
 Local     Supabase
```

## Contrato lógico

Las implementaciones deben ofrecer equivalentes de:

```text
identity
  getCurrentUser()
  listTenantMemberships()
  selectTenant(tenantId)

people
  listPeople()
  findPersonByPhone(phone)
  createPerson(input)
  updatePerson(id, patch)

catalog
  listServices()
  listResources()

availability
  listBlocks(range, resourceId)
  queryAvailability(input)

appointments
  listAppointments(range, resourceId)
  getAppointment(id)
  createAppointment(input)
  updateAppointment(id, expectedVersion, patch)

operations
  appendEvent(event)

idempotency
  findRequest(requestId)
  storeRequest(requestId, command, response)
```

## Versionado optimista

Además de la restricción de no-solapamiento, cada Appointment remoto debe tener `row_version bigint` o `updated_at` utilizable como precondición de escritura.

Objetivo:
- evitar que una pantalla vieja pise una reprogramación/cancelación hecha desde otro dispositivo;
- devolver conflicto explícito y refrescar.

La exclusión temporal resuelve doble reserva. El versionado optimista resuelve edición perdida. Son problemas distintos.

## Semántica local

El adaptador local actual continúa usando:
- `cl_p`;
- `cl_t`;
- `cl_blocks`;
- `cl_services`;
- `cl_resources`;
- `cl_requests`;
- `cl_events`;
- `cl_cfg`.

No se migran ni renombran todavía.

## Semántica remota

- todas las consultas están scoped por `tenant_id`;
- timezone del tenant es explícita;
- el backend usa timestamps absolutos;
- la UI renderiza en timezone del tenant;
- la disponibilidad se vuelve a validar en la escritura;
- errores de constraint se convierten en códigos de dominio estables como `slot_unavailable`;
- conflictos de versión se convierten en `stale_write`.

## Compatibilidad de contrato

Los códigos existentes se preservan:
- `availability`;
- `appointment_created`;
- `appointment_confirmed`;
- `appointment_cancelled`;
- `appointment_rescheduled`;
- `slot_unavailable`;
- `invalid_state`;
- `request_id_conflict`.

Códigos remotos nuevos permitidos en v1 sin romper clientes:
- `unauthenticated`;
- `forbidden`;
- `tenant_not_selected`;
- `stale_write`;
- `backend_unavailable`.

## Regla de rollout

No activar el modo remoto solo porque existe una URL de Supabase.

La aplicación pasa a `remote-primary` únicamente cuando el conjunto completo de invariantes de concurrencia, RLS, idempotencia y migración esté probado.
