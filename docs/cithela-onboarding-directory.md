# CITHELA — Onboarding + directory checkpoint

Estado: aplicado y verificado el 2026-09-30.

## Workspace bootstrap

`cithela_bootstrap_tenant(display_name, timezone)` permite que un usuario autenticado sin membresías cree su primer espacio CITHELA.

La operación bloquea la fila Auth del actor para evitar doble creación concurrente, crea tenant + membresía `owner`, agrega el servicio inicial `Consulta` de 30 minutos y el recurso `Profesional principal`, y registra `workspace_created`.

Si el usuario ya pertenece a un tenant, devuelve `workspace_exists` y no crea otro. El MVP mantiene así un bootstrap autónomo y controlado sin abrir todavía invitaciones ni administración multitenant.

No se crean horarios por defecto: hasta que el owner/admin los configure, el backend no ofrece disponibilidad.

## Person directory

`cithela_directory_command(..., 'person.resolve', payload)` resuelve clientes/pacientes por teléfono E.164.

```json
{
  "phone": "+5492215551234",
  "name": "Ana",
  "create_if_missing": true
}
```

- owner/admin/operator pueden usar el comando;
- viewer no puede;
- la creación es explícita con `create_if_missing=true`;
- la idempotencia queda ligada a tenant, actor, request id, comando y payload;
- las escrituras directas de tablas siguen cerradas.

Esto prepara la identidad mínima del futuro adaptador WhatsApp: número entrante -> `person.resolve` -> comandos de agenda.

## Verificación

Bootstrap inicial, segundo bootstrap sin duplicación, defaults, create/find/not-found, replay idempotente y viewer denied: PASS.

Prueba post-migración en Supabase: PASS. Security advisors: 0 hallazgos.

Migración: `20260930112305_cithela_onboarding_directory`.

## Siguiente gate

Conectar Supabase Auth y un adaptador cloud a la preview web sin activar todavía `remote-primary`. Después: prueba real en dos dispositivos/sesiones y luego canal WhatsApp.
