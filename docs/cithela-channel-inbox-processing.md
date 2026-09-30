# CITHELA — channel inbox processing checkpoint

Estado: aplicado y verificado el 2026-09-30.

## Objetivo

Preparar la inbox durable para procesamiento concurrente server-only antes de conectar un webhook real de WhatsApp.

## Lease de procesamiento

Cada evento puede ser reclamado mediante:

`public.cithela_channel_inbox_claim(limit, lease_seconds)`

La función:

- sólo puede ejecutarse con `service_role`;
- usa `FOR UPDATE SKIP LOCKED` para evitar doble claim concurrente;
- asigna un `lease_token` nuevo;
- incrementa `attempt_count`;
- fija `lease_until`;
- permite reclamar nuevamente un evento `processing` cuyo lease expiró;
- ignora eventos terminales.

El lease queda limitado entre 15 y 900 segundos; el batch entre 1 y 50 eventos.

## Cierre seguro

`public.cithela_channel_inbox_complete(event_id, lease_token, outcome, error_code)`

Outcomes válidos:

- `processed`
- `ignored`
- `failed`

El token debe coincidir con el claim vigente y no estar vencido. Un worker viejo recibe `stale_claim` y no puede cerrar el trabajo de un worker que recuperó el evento.

## Persistencia adicional

La inbox incorpora:

- `attempt_count`
- `last_attempt_at`
- `lease_until`
- `lease_token`

También agrega un índice orientado al claim y limita `error_code` a 120 caracteres.

## Verificación

Fixture transaccional: PASS.

Cubre:

- claim inicial;
- token incorrecto rechazado;
- expiración simulada;
- reclaim con token nuevo;
- incremento de intento 1 -> 2;
- token anterior rechazado;
- cierre `processed`;
- evento terminal no reclamado;
- claim/complete bloqueados para `authenticated`;
- rollback final con 0 filas.

Security Advisors post-migration: 0 hallazgos.

Migración: `20260930155305_cithela_channel_inbox_processing`.

## Límite

Este checkpoint no conecta Meta, no verifica firmas de webhook, no interpreta texto y no envía mensajes. Deja preparada la capa durable y concurrente para que el adaptador real pueda añadirse sin meter lógica de negocio dentro del endpoint HTTP.
