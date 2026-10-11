-- CITHELA: deduplicated, audited operator-approved WhatsApp sends.
-- Do not apply before reviewing tenant isolation and Meta sender configuration.
create table if not exists public.cithela_channel_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  connection_id uuid not null,
  inbox_event_id uuid not null references public.cithela_channel_inbox(id),
  actor_user_id uuid not null references auth.users(id),
  reply_text text not null check (char_length(reply_text) between 1 and 1000),
  status text not null check (status in ('sending','sent','unknown')),
  provider_message_id text,
  error_code text,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint cithela_channel_outbox_event_unique unique (tenant_id, inbox_event_id),
  constraint cithela_channel_outbox_connection_fk foreign key (tenant_id, connection_id)
    references public.cithela_channel_connections(tenant_id,id)
);
create index if not exists cithela_channel_outbox_recent_idx
  on public.cithela_channel_outbox(tenant_id, attempted_at desc);
alter table public.cithela_channel_outbox enable row level security;
revoke all on public.cithela_channel_outbox from anon, authenticated;
grant select, insert, update on public.cithela_channel_outbox to service_role;
-- No anon or authenticated RLS policies: only authenticated server-side admins via service role.
