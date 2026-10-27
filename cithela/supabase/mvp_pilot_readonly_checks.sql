-- CITHELA · auditoría MVP · 2026-10-27
-- SOLO LECTURA. No contiene identidades, números ni textos de pacientes.
-- Ejecutar con acceso administrativo de solo lectura en SQL Editor.
-- Las consultas de estado no sustituyen pruebas E2E / RLS con JWT de cuentas de laboratorio.

-- A. Conteos operativos, sin datos personales.
select
 (select count(*) from public.cithela_tenants) as tenants,
 (select count(*) from public.cithela_tenant_memberships) as memberships,
 (select count(*) from public.cithela_people) as people,
 (select count(*) from public.cithela_services) as services,
 (select count(*) from public.cithela_resources) as resources,
 (select count(*) from public.cithela_working_hours) as working_hours,
 (select count(*) from public.cithela_appointments) as appointments;

-- B. Invariantes de citas activas.
select
 (select count(*) from public.cithela_appointments a
   join public.cithela_appointments b
     on a.id < b.id
    and a.tenant_id=b.tenant_id and a.resource_id=b.resource_id
    and a.status in ('pending','confirmed')
    and b.status in ('pending','confirmed')
    and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(b.starts_at,b.ends_at,'[)')
 ) as overlapping_active_turns,
 (select count(*) from public.cithela_appointments
    where ends_at <= starts_at or duration_min <= 0
       or ends_at <> starts_at + duration_min * interval '1 minute') as invalid_intervals,
 (select count(*) from public.cithela_appointments where row_version < 1) as invalid_versions;

-- C. Estado de mensajería: 'sent' no prueba entrega ni lectura.
select 'inbox' as source, status, count(*) as total from public.cithela_channel_inbox group by status
union all
select 'outbox' as source, status, count(*) as total from public.cithela_channel_outbox group by status
order by source,status;

-- D. Superficie de lectura expuesta. Revisión obligatoria si aparecen true en anon_select.
select tablename, rowsecurity as rls,
  has_table_privilege('anon','public.'||tablename,'SELECT') as anon_select,
  has_table_privilege('authenticated','public.'||tablename,'SELECT') as authenticated_select
from pg_tables
where schemaname='public' and tablename like 'cithela_%'
order by tablename;

-- E. Políticas de acceso, revisables y sin extraer datos de pacientes.
select tablename,policyname,cmd,roles,qual,with_check from pg_policies
where schemaname='public' and tablename like 'cithela_%'
order by tablename,policyname;

-- F. Índices/restricciones de exclusión: comprobar la barrera de doble reserva.
select conname,pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid='public.cithela_appointments'::regclass and contype='x';
