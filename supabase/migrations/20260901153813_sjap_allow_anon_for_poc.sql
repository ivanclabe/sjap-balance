-- POC: la app aún no tiene login propio, así que se permite también al rol
-- anon (usa la publishable key). Antes de exponer esto a más usuarios que
-- Iván/Javier hay que: (1) agregar autenticación real y (2) restringir estas
-- políticas a `authenticated` con reglas por estación.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'sjap_%'
  loop
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t || '_anon_poc', t
    );
  end loop;
end $$;
