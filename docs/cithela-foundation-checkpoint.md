# CITHELA — foundation checkpoint (2026-09-29)

Project: `mcqknmqhtmihegmifuka` (`sa-east-1`). The private preview remains local-only.

## Applied migrations

| Remote version | Name | Scope |
| --- | --- | --- |
| `20260929144416` | `cithela_foundation` | Tenants, memberships, people, services, resources, appointments, blocks, events, channel requests; RLS and read grants |
| `20260929144551` | `cithela_security_hardening` | Extension outside public; explicit deny for channel requests |

The local migration filenames match the remote versions. Neither migration creates a tenant or operator.

## Verified on the project

- Nine CITHELA tables exist and all have RLS enabled; all are empty.
- An overlap probe inserted one active appointment and confirmed that a second overlapping appointment for the same tenant/resource raises `exclusion_violation`. The probe ran in a rolled-back transaction; tenants and appointments remained at zero rows.
- `anon` has no SELECT privilege on people; `authenticated` has no INSERT privilege on people. Client writes remain closed throughout this foundation phase.
- Supabase security advisors returned zero findings after hardening.

## Still required

1. Auth onboarding and membership provisioning, including two real test users in different tenants.
2. Role-specific transactional commands for create, confirm, cancel and reschedule; durable idempotency and event recording.
3. Two-tenant RLS verification, concurrent writes, backup v3 import, then REMOTE SHADOW and two-device sync.

Do not move the private preview to remote persistence or enter real patient data before these gates pass.
