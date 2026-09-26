create table if not exists sjap_promotores (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

create table if not exists sjap_islas (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

alter table sjap_promotores enable row level security;
alter table sjap_islas enable row level security;

create policy sjap_promotores_authenticated_all on sjap_promotores for all to authenticated using (true) with check (true);
create policy sjap_promotores_anon_poc on sjap_promotores for all to anon using (true) with check (true);

create policy sjap_islas_authenticated_all on sjap_islas for all to authenticated using (true) with check (true);
create policy sjap_islas_anon_poc on sjap_islas for all to anon using (true) with check (true);

-- semilla desde los nombres que ya existen en el histórico, para no partir de cero
insert into sjap_promotores (estacion_id, nombre)
select distinct estacion_id, promotor_nombre
from sjap_ventas_promotor_turno
where promotor_nombre is not null
on conflict (estacion_id, nombre) do nothing;

insert into sjap_islas (estacion_id, nombre)
select distinct estacion_id, isla
from sjap_ventas_promotor_turno
where isla is not null and isla ~ '^[0-9]+$'
on conflict (estacion_id, nombre) do nothing;
