-- ============================================================================
-- SJAP — RLS: habilitado en todas las tablas, política permisiva para
-- usuarios autenticados mientras se define el modelo de acceso real
-- (multi-EDS con permisos por estación queda pendiente de diseño).
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'sjap_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
