-- Keep extension objects out of the exposed public schema. The existing
-- exclusion constraint continues to refer to the same operator class OIDs.
create schema if not exists extensions;
alter extension btree_gist set schema extensions;

-- Channel idempotency payloads remain private even if a table grant changes.
create policy cithela_channel_requests_explicit_deny
  on public.cithela_channel_requests for all to authenticated
  using (false) with check (false);
