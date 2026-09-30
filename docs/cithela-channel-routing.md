# CITHELA — Channel routing checkpoint

Estado: aplicado y verificado el 2026-09-30.

## Motivo

Un webhook futuro de WhatsApp no debe aceptar un `tenant_id` externo como autoridad. Primero debe resolver un identificador de cuenta/canal conocido hacia el tenant propietario.

## Tabla

`cithela_channel_connections` contiene solamente routing operativo:

- tenant;
- canal;
- identificador externo de la cuenta;
- etiqueta opcional;
- estado.

No almacena access tokens, app secrets, verify tokens ni secretos de Meta.

## Configuración humana

`cithela_channel_configuration_command(..., 'channel.bind', payload)`:

- sólo owner/admin;
- idempotente;
- evita que un mismo identificador externo quede vinculado a dos tenants;
- registra auditoría;
- viewer no puede leer la conexión.

## Routing servidor

`cithela_channel_route(channel, external_account_id)`:

- está revocado para `anon` y `authenticated`;
- sólo `service_role` puede ejecutarlo;
- devuelve tenant, timezone y connection id sólo si conexión y tenant están activos.

Esto prepara el primer paso del futuro webhook:

**evento externo -> identificador de cuenta -> tenant -> lógica CITHELA**

Todavía no se aceptan ni envían mensajes de WhatsApp.

## Verificación

- bind owner: PASS;
- replay idempotente: PASS;
- viewer read: bloqueado;
- authenticated route: bloqueado por privilegios;
- duplicate cross-tenant: bloqueado;
- service-role route: PASS;
- post-migration test: PASS;
- security advisors: 0 hallazgos.

Migración: `20260930113517_cithela_channel_routing`.

## Siguiente paso del canal

Crear la capa servidor que, después de verificar el webhook del proveedor, convierta un evento entrante en comandos internos. Esa capa no debe compartir secretos con el navegador.
