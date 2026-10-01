-- CITHELA operator realtime: authenticated tenant members retain RLS SELECT policies.
-- Only the five tenant-scoped tables needed by the professional UI are published.
-- Safe to reapply: publication membership is checked for each table.
do $cithela$
declare
  v_table text;
begin
  for v_table in
    select unnest(array[
      'cithela_appointments',
      'cithela_people',
      'cithela_working_hours',
      'cithela_services',
      'cithela_resources'
    ]::text[])
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$cithela$;
