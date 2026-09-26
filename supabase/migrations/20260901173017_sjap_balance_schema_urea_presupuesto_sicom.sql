-- ============================================================================
-- SJAP — Hojas adicionales del balance mensual: Urea, Presupuesto, Sicom.
-- Se agregan tal como existen en el Excel de referencia, sin inventar
-- reglas de negocio para lo que aún no está confirmado con el cliente.
-- ============================================================================

create table public.sjap_urea_diario (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  inventario_inicial numeric(14,3),
  inventario_final numeric(14,3),
  inventario_teorico numeric(14,3),
  diferencia numeric(14,3),
  recibo numeric(14,3),
  rumbo_litros numeric(14,3),
  clientes_propios_litros numeric(14,3),
  valor numeric(14,2),
  valor_rumbo numeric(14,2),
  valor_propios numeric(14,2),
  total numeric(14,2),
  costo_unitario numeric(14,2),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, fecha)
);
comment on table public.sjap_urea_diario is 'Espeja la hoja "Urea": inventario/recibo/valor diario de urea (AdBlue), paralelo al de combustible.';

create table public.sjap_presupuesto_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  ventas numeric(14,2),
  compra numeric(14,2),
  rumbo numeric(14,2),
  clientes_propios numeric(14,2),
  clientes_paso numeric(14,2),
  presupuesto_total numeric(14,2),
  presupuesto_corriente numeric(14,2),
  presupuesto_acpm numeric(14,2),
  presupuesto_extra numeric(14,2),
  cumplimiento numeric(8,4),
  pct_rumbo numeric(8,4),
  pct_clientes_propios numeric(8,4),
  pct_clientes_paso numeric(8,4),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, anio, mes)
);
comment on table public.sjap_presupuesto_mensual is 'Espeja la hoja "Presupuesto": una fila por mes con ventas/compra reales vs. presupuestadas por producto.';

create table public.sjap_sicom_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid references public.sjap_productos(id),
  producto_nombre_original text not null,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  inventario_inicial numeric(14,3),
  compras numeric(14,3),
  ventas numeric(14,3),
  faltantes numeric(14,3),
  evaporacion numeric(14,3),
  inventario_final_calculado numeric(14,3),
  inventario_final_real numeric(14,3),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, anio, mes, producto_nombre_original)
);
comment on table public.sjap_sicom_mensual is 'Espeja la hoja "Sicom": informe regulatorio mensual de inventario por producto, con la fórmula de evaporación.';

do $$
declare
  t text;
begin
  for t in select unnest(array['sjap_urea_diario','sjap_presupuesto_mensual','sjap_sicom_mensual'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to anon using (true) with check (true)', t || '_anon_poc', t);
  end loop;
end $$;
