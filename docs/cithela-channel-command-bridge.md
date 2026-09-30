# CITHELA — Server-only channel command bridge

Estado: aplicado y verificado el 2026-09-30.

## Propósito

Este checkpoint completa el límite de dominio que necesita un futuro webhook WhatsApp **después** de validar la firma/evento del proveedor.

El webhook no recibe autoridad para elegir tenant. Primero se resuelve:

`canal + external_account_id -> tenant`

y recién entonces se ejecuta un comando.

## Entrada pública servidor

`public.cithela_channel_command(channel, external_account_id, request_id, command, payload)`

Sólo `service_role` puede ejecutarla. Está revocada para `anon` y `authenticated`.

Comandos soportados:

- `catalog.services`
- `catalog.resources`
- `person.resolve`
- `appointments.list`
- `availability.query`
- `appointment.create`
- `appointment.confirm`
- `appointment.cancel`
- `appointment.reschedule`

## Identidad del cliente

Los comandos personales usan `sender_phone` en E.164.

Para crear una persona hace falta:
- `create_if_missing=true`;
- `sender_name` válido.

No se crea silenciosamente una identidad sólo por recibir un mensaje.

## Propiedad del turno

Confirmar, cancelar o reprogramar busca el turno por:

- tenant resuelto desde el canal;
- id de turno;
- person resuelta desde `sender_phone`.

Si el turno pertenece a otro teléfono, responde `appointment_not_found`. Así no filtra si el turno ajeno existe.

## Concurrencia

Las mutaciones:
- adquieren el lock del tenant;
- reutilizan horarios y bloqueos autoritativos;
- respetan la exclusión de doble reserva;
- requieren `expected_version` para cambios;
- usan idempotencia con request id namespaced por canal/cuenta.

## Datos expuestos al adaptador

La respuesta de persona excluye notas/alertas. Las respuestas de turnos contienen únicamente los datos operativos necesarios para la conversación.

## Lo que NO hace

- no recibe webhooks Meta;
- no verifica firmas de Meta;
- no guarda tokens ni secretos;
- no envía mensajes;
- no interpreta lenguaje natural.

Es deliberadamente un bridge de dominio, no el adaptador de proveedor.

## Verificación

PASS:
- catálogo servicios/recursos;
- alta explícita por teléfono;
- disponibilidad;
- rechazo fuera de horario;
- create + replay idempotente;
- listado de turnos propios;
- intento de operar turno ajeno;
- confirm;
- reschedule;
- cancel;
- cuenta de canal inexistente;
- llamada desde authenticated bloqueada.

Migración: `20260930114319_cithela_channel_command_bridge`.

Security advisors post-migration: 0 hallazgos.
