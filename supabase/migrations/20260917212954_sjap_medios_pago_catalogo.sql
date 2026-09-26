
create table sjap_medios_pago (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

alter table sjap_medios_pago enable row level security;
create policy sjap_medios_pago_scope on sjap_medios_pago for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Backfill: todos los medios de pago que ya existen en los datos reales,
-- incluyendo los que el arreglo hardcodeado de CierreTab.jsx no contemplaba
-- (EFECTIVO, CREDITO, CREDITO CLIENTES, TARJETA DEBITO, TRANSFERENCIA).
insert into sjap_medios_pago (estacion_id, nombre, orden)
select e.id, m.medio_pago, row_number() over (order by m.medio_pago)
from sjap_estaciones e
cross join (select distinct medio_pago from sjap_ventas_medio_pago) m;
