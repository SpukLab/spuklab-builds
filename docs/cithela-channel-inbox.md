# CITHELA — inbound channel inbox checkpoint

Estado: aplicado y verificado el 2026-09-30.

## Propósito

Agregar la primera bandeja durable de entrada para un futuro adaptador WhatsApp sin exponerla al navegador ni mezclar todavía proveedor, interpretación y dominio.

El límite queda:

`webhook proveedor -> validación/adaptador servidor -> cithela_channel_ingest -> inbox durable -> procesamiento posterior -> cithela_channel_command`

## Persistencia

Nueva tabla `public.cithela_channel_inbox`:

- tenant y conexión resueltos desde `channel + external_account_id`;
- `external_event_id` idempotente;
- teléfono remitente normalizado E.164;
- tipo de mensaje, texto opcional, timestamp del proveedor y payload normalizado;
- estados `new | processing | processed | ignored | failed`;
- índices por tenant/estado y tenant/conexión;
- RLS activa y sin acceso de lectura/escritura para `anon` o `authenticated`.

La migración de hardening agrega además una política deny explícita para `authenticated`.

## Entrada servidor

`public.cithela_channel_ingest(...)` sólo puede ejecutarse con `service_role`.

Antes de persistir:

1. valida forma y límites del payload;
2. resuelve el tenant mediante el routing de canal existente;
3. inserta una sola vez por `channel + external_event_id`;
4. una repetición idéntica devuelve `event_duplicate`;
5. una repetición incompatible devuelve `event_conflict`.

No se crea persona, no se interpreta lenguaje natural y no se ejecuta una reserva en esta etapa.

## Seguridad

- No existe grant para navegador.
- El wrapper público es `security invoker`.
- La función privilegiada vive en `cithela_private`.
- La tabla conserva RLS aunque el acceso operativo esperado sea server-only.
- No se almacenan tokens ni secretos del proveedor.

## Verificación

Fixture transaccional: PASS.

Cubre:

- primera ingestión;
- replay idempotente;
- conflicto con mismo event id;
- cuenta de canal inexistente;
- una sola fila persistida antes del rollback;
- ejecución bloqueada para `authenticated`;
- lectura de inbox bloqueada para `authenticated`;
- rollback final con 0 filas.

Security advisors post-migration: 0 hallazgos.

Migraciones:
- `20260930114812_cithela_channel_inbox`
- `20260930114849_cithela_channel_inbox_explicit_deny`

## Próximo gate

Implementar el adaptador real de proveedor sólo cuando exista una URL estable y pueda verificarse firma/autenticidad del webhook. El adaptador debe normalizar el evento y llamar a `cithela_channel_ingest`; el procesamiento de la bandeja debe permanecer separado de la recepción HTTP.
