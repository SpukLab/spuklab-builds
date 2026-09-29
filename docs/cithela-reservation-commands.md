# CITHELA reservation commands — checkpoint 2026-09-29

Migration `20260929145815_cithela_reservation_commands.sql` is applied to CITHELA. The preview is still local-only.

## Database RPC

`public.cithela_reservation_command(p_tenant_id, p_request_id, p_command, p_payload)` returns `{ok, code, appointment?, replayed?}`.

| Command | Payload |
| --- | --- |
| `appointment.create` | `person_id`, `service_id`, `resource_id`, `starts_at` (ISO with explicit timezone), optional `reason` |
| `appointment.confirm` | `id`, `expected_version` |
| `appointment.cancel` | `id`, `expected_version` |
| `appointment.reschedule` | `id`, `expected_version`, `starts_at` |

The future channel adapter must convert local `fecha`/`hora` to an absolute timestamp using the tenant timezone and map legacy IDs. This RPC is not a drop-in replacement for the browser's synchronous local contract.

## Guarantees

- Authenticated owner/admin/operator membership in an active tenant is required, including on replay.
- Row versions reject stale updates; successful state changes increment the version.
- Successful responses are stored atomically with the write and event. Replays are bound to tenant, actor, command and exact JSON payload. Failed requests are not cached and may be retried.
- A tenant row lock serializes commands; the exclusion constraint is the final overlap guard. This deliberately favors correctness over per-resource throughput in v1.
- General and resource-specific availability blocks prevent create/reschedule.
- Only active services/resources can be used for new reservations. Rescheduling preserves historical service snapshots and requires an active resource.
- Public entry point is security invoker; the privileged transaction is in an unexposed schema with explicit identity and membership checks, empty search path and limited execution grants.
- Client table writes remain closed. Future block, catalog and tenant-admin commands must coordinate their writes with the same tenant lock.

## Verification

`supabase/tests/reservation_commands.sql` passed on the project using temporary Auth identities and two tenants, entirely within a rolled-back transaction. It covers create/replay, changed-payload conflict, overlap, cross-tenant person references and reads, confirm, stale write, general block, reschedule, cancel/no-op cancel, terminal state, event count, forbidden direct table write, viewer write denial and missing identity. After rollback, Auth users, tenants, requests and events all remained empty. Security advisors reported zero findings.

This test covers sequential semantics and authorization. Independent-session race tests remain pending before remote-primary use.

## Next gates

Auth onboarding, controlled tenant/member provisioning, people/catalog commands, per-tenant working hours and timezone adapter, two-session concurrency tests, then connection of the preview and two-device testing. No production availability claim until working hours are enforced server-side.
