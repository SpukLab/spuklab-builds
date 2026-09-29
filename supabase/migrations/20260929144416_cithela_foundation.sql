-- CITHELA foundation. Client writes stay closed until command transactions and
-- role-specific write policies are implemented and verified.
create extension if not exists btree_gist;

create table public.cithela_tenants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now()
);

create table public.cithela_tenant_memberships (
  tenant_id uuid not null references public.cithela_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index cithela_memberships_user_idx on public.cithela_tenant_memberships(user_id, tenant_id);

create table public.cithela_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  phone_e164 text,
  notes text not null default '',
  alerts text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint cithela_phone_format check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create unique index cithela_people_phone_per_tenant on public.cithela_people(tenant_id, phone_e164)
  where phone_e164 is not null;

create table public.cithela_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  duration_min integer not null check (duration_min > 0 and duration_min <= 720 and duration_min % 30 = 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.cithela_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  name text not null check (length(btrim(name)) between 1 and 160),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.cithela_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  person_id uuid not null,
  resource_id uuid not null,
  service_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'attended', 'no_show')),
  service_name text not null,
  duration_min integer not null check (duration_min > 0),
  resource_name text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, person_id) references public.cithela_people(tenant_id, id),
  foreign key (tenant_id, resource_id) references public.cithela_resources(tenant_id, id),
  foreign key (tenant_id, service_id) references public.cithela_services(tenant_id, id),
  constraint cithela_appointment_positive_window check (ends_at > starts_at),
  constraint cithela_appointment_duration check (ends_at = starts_at + duration_min * interval '1 minute'),
  constraint cithela_appointment_no_overlap exclude using gist (
    tenant_id with =,
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create index cithela_appointments_tenant_start_idx on public.cithela_appointments(tenant_id, starts_at);
create index cithela_appointments_person_idx on public.cithela_appointments(tenant_id, person_id, starts_at);

create table public.cithela_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  resource_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, resource_id) references public.cithela_resources(tenant_id, id),
  constraint cithela_block_positive_window check (ends_at > starts_at)
);
create index cithela_blocks_tenant_start_idx on public.cithela_availability_blocks(tenant_id, starts_at);

create table public.cithela_operational_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cithela_tenants(id),
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index cithela_events_tenant_created_idx on public.cithela_operational_events(tenant_id, created_at desc);

create table public.cithela_channel_requests (
  tenant_id uuid not null references public.cithela_tenants(id),
  request_id text not null,
  command text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (tenant_id, request_id)
);

alter table public.cithela_tenants enable row level security;
alter table public.cithela_tenant_memberships enable row level security;
alter table public.cithela_people enable row level security;
alter table public.cithela_services enable row level security;
alter table public.cithela_resources enable row level security;
alter table public.cithela_appointments enable row level security;
alter table public.cithela_availability_blocks enable row level security;
alter table public.cithela_operational_events enable row level security;
alter table public.cithela_channel_requests enable row level security;

-- Membership provisioning is server-owned. The membership read policy has no
-- recursive subquery; all other reads use the caller's visible memberships.
create policy cithela_membership_self_read on public.cithela_tenant_memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy cithela_tenant_member_read on public.cithela_tenants
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = id and m.user_id = (select auth.uid()))
  );

create policy cithela_people_member_read on public.cithela_people
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_people.tenant_id and m.user_id = (select auth.uid()))
  );
create policy cithela_services_member_read on public.cithela_services
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_services.tenant_id and m.user_id = (select auth.uid()))
  );
create policy cithela_resources_member_read on public.cithela_resources
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_resources.tenant_id and m.user_id = (select auth.uid()))
  );
create policy cithela_appointments_member_read on public.cithela_appointments
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_appointments.tenant_id and m.user_id = (select auth.uid()))
  );
create policy cithela_blocks_member_read on public.cithela_availability_blocks
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_availability_blocks.tenant_id and m.user_id = (select auth.uid()))
  );
create policy cithela_events_member_read on public.cithela_operational_events
  for select to authenticated using (
    exists (select 1 from public.cithela_tenant_memberships m
      where m.tenant_id = cithela_operational_events.tenant_id and m.user_id = (select auth.uid()))
  );

-- Channel request responses can contain private payloads and stay server-only.
revoke all on public.cithela_tenants, public.cithela_tenant_memberships,
  public.cithela_people, public.cithela_services, public.cithela_resources,
  public.cithela_appointments, public.cithela_availability_blocks,
  public.cithela_operational_events, public.cithela_channel_requests
  from anon, authenticated;
grant select on public.cithela_tenants, public.cithela_tenant_memberships,
  public.cithela_people, public.cithela_services, public.cithela_resources,
  public.cithela_appointments, public.cithela_availability_blocks,
  public.cithela_operational_events to authenticated;
