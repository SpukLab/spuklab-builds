# CITHELA — Backend v1

Estado: **PROJECT PROVISIONED · SCHEMA PENDING**. Diseño para migrar el prototipo local a un backend multiusuario sin cambiar el contrato de canales.

## Objetivos

1. conservar `TurnosChannel v1` como frontera estable;
2. soportar varios operadores y dispositivos sobre el mismo tenant;
3. impedir doble reserva por concurrencia real, no solo por validación de UI;
4. mantener CITHELA autónoma respecto de DAHZEA;
5. permitir WhatsApp oficial sin exponer secretos en el navegador;
6. poder importar el backup local existente.

## Stack objetivo

- Supabase Postgres 17;
- Supabase Auth para operadores;
- Row Level Security por tenant;
- Data API para la UI autenticada;
- Realtime para agenda/bloqueos cuando se habilite el modo multiusuario;
- Storage privado para archivos de clientes/pacientes en una etapa posterior;
- Edge Function o backend de canal para WhatsApp oficial.

No se usa `service_role` ni secret key en el navegador.

## Identidad y tenancy

### tenant

Una empresa/consultorio/salón que usa CITHELA.

Campos mínimos:
- `id uuid`;
- `display_name text`;
- `timezone text`;
- `status active | suspended | closed`;
- `created_at timestamptz`.

### tenant_membership

Vincula usuario de Supabase Auth con un tenant.

Campos:
- `tenant_id uuid`;
- `user_id uuid -> auth.users.id`;
- `role owner | admin | operator | viewer`;
- `created_at timestamptz`.

Regla inicial: la UI solo ve tenants donde el usuario autenticado tiene membership.

No usar `user_metadata` para autorización. La autoridad es la relación persistida de membership.

## Entidades operativas

### people

Reemplaza progresivamente `cl_p`.

- `id uuid`;
- `tenant_id uuid`;
- `display_name text`;
- `phone_e164 text`;
- `notes text`;
- `alerts text`;
- `created_at timestamptz`;
- `updated_at timestamptz`.

Restricción recomendada:
- identidad telefónica única por tenant cuando exista teléfono normalizado.

### services

- `id uuid`;
- `tenant_id uuid`;
- `name text`;
- `duration_min integer`;
- `active boolean`;
- timestamps.

`duration_min` debe ser positivo y múltiplo del slot base configurado.

### resources

Profesional, box, sillón u otra unidad de agenda.

- `id uuid`;
- `tenant_id uuid`;
- `name text`;
- `active boolean`;
- timestamps.

### appointments

- `id uuid`;
- `tenant_id uuid`;
- `person_id uuid`;
- `resource_id uuid`;
- `service_id uuid nullable`;
- `starts_at timestamptz`;
- `ends_at timestamptz`;
- `status pending | confirmed | cancelled | attended | no_show`;
- snapshots `service_name`, `duration_min`, `resource_name`;
- `reason text`;
- metadata de confirmación/reprogramación/recordatorio;
- timestamps.

El snapshot histórico se conserva aunque servicio o recurso se desactive.

### availability_blocks

- `id uuid`;
- `tenant_id uuid`;
- `resource_id uuid nullable`;
- `starts_at timestamptz`;
- `ends_at timestamptz`;
- `reason text`;
- timestamps.

`resource_id=null` puede representar cierre general del tenant.

### operational_events

Auditoría append-only del producto.

- `id uuid`;
- `tenant_id uuid`;
- `actor_user_id uuid nullable`;
- `event_type text`;
- `entity_type text`;
- `entity_id uuid nullable`;
- `payload jsonb`;
- `created_at timestamptz`.

### channel_requests

Idempotencia durable para webhooks/API.

- `tenant_id uuid`;
- `request_id text`;
- `command text`;
- `response jsonb`;
- `created_at timestamptz`;
- `expires_at timestamptz nullable`.

Clave única: `(tenant_id, request_id)`.

Reutilizar el mismo request id para otro command debe ser conflicto.

## Concurrencia: regla crítica

La disponibilidad mostrada al usuario es informativa. La autoridad final es Postgres en el momento de escribir.

Para impedir que dos operadores creen reservas superpuestas, la tabla `appointments` debe tener una exclusión de rango temporal por tenant + recurso para estados activos:

```sql
-- diseño conceptual; generar la migración real con Supabase CLI
create extension if not exists btree_gist;

exclude using gist (
  tenant_id with =,
  resource_id with =,
  tstzrange(starts_at, ends_at, '[)') with &&
)
where (status in ('pending','confirmed'));
```

La restricción debe implementarse como constraint nombrada en la migración real.

Consecuencia: aunque dos clientes lean el mismo slot libre simultáneamente, solo una escritura puede quedar confirmada.

## RLS v1

Todas las tablas expuestas deben tener RLS habilitado.

Patrón de lectura:
```sql
exists (
  select 1
  from tenant_memberships m
  where m.tenant_id = <tabla>.tenant_id
    and m.user_id = (select auth.uid())
)
```

Permisos previstos:
- `viewer`: lectura;
- `operator`: agenda/personas/recordatorios;
- `admin`: catálogo/configuración + operación;
- `owner`: administración del tenant.

El alta de memberships y provisioning no se expone como una escritura genérica del cliente v1.

Data API grants y RLS se configuran juntos; RLS no sustituye a los grants.

## Realtime

Primera suscripción prevista:
- appointments del tenant;
- availability_blocks del tenant.

Objetivo UX:
- un turno creado/cancelado/reprogramado en un dispositivo aparece en los demás;
- un slot recién ocupado desaparece sin recargar la página;
- Realtime mejora la sincronización, pero la exclusión en Postgres sigue siendo la autoridad de concurrencia.

## Auth v1

Operadores:
- email + password inicialmente;
- sesión Supabase Auth;
- tenant seleccionado desde memberships.

Paciente/cliente:
- no necesita cuenta para la primera versión de WhatsApp;
- un portal autenticado para clientes puede añadirse luego sin cambiar Appointment.

## WhatsApp

El webhook oficial nunca escribe directo saltándose el dominio.

Flujo:
```text
WhatsApp provider
  -> backend channel adapter
  -> tenant resolve
  -> TurnosChannel-compatible command
  -> persistence/transaction
  -> structured result
  -> WhatsApp renderer
```

Secretos y tokens del proveedor quedan en backend/secret store, nunca en HTML, localStorage ni backup.

## Frontera de persistencia

La migración no debe convertir toda la UI a Supabase de una vez.

Fases:
1. **LOCAL** — estado actual estable;
2. **REMOTE SHADOW** — backend conectado para importar/leer y validar equivalencia;
3. **REMOTE PRIMARY** — Supabase autoridad; localStorage deja de ser autoridad;
4. **LOCAL CACHE** opcional — caché de experiencia, nunca fuente de verdad para concurrencia.

Capacidades que la aplicación debe poder declarar:

```text
persistence: local | remote
multiUser: boolean
realtime: boolean
serverIdempotency: boolean
authoritativeConcurrency: boolean
```

## Migración desde backup local

El backup actual `turnos-local-backup v3` sigue siendo fuente válida de importación.

Orden:
1. tenant;
2. usuario/membership;
3. resources;
4. services;
5. people;
6. appointments;
7. availability_blocks;
8. operational_events.

Los IDs locales se guardan temporalmente en `legacy_id` o en una tabla de mapping durante la importación. No deben convertirse en PK del backend.

## Criterios para pasar a REMOTE PRIMARY

- Auth real;
- RLS + grants verificados;
- aislamiento entre dos tenants probado;
- choque simultáneo sobre el mismo slot: exactamente uno gana;
- create/confirm/cancel/reschedule compatibles con Channel Contract v1;
- idempotencia durable probada;
- dos dispositivos reflejan cambios;
- import de backup v3 probado;
- ningún secreto en cliente;
- advisors de seguridad sin hallazgos críticos.

## Proyecto provisionado

CITHELA tiene un proyecto Supabase propio (`mcqknmqhtmihegmifuka`, región `sa-east-1`) en la organización de SpukLab. No se reutiliza SURKARA ni Spk_Multidev como backend productivo.

Al 2026-09-28, el proyecto figura activo, sin tablas públicas ni migraciones. La web privada sigue en modo local y no está conectada a este proyecto. Los siguientes pasos son implementar y verificar esquema, RLS, Auth y comandos de reserva antes de habilitar `REMOTE SHADOW`.
