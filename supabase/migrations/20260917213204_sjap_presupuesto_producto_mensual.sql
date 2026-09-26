
-- Presupuesto por producto, normalizado (reemplaza el supuesto de "siempre 3
-- productos fijos" que vivía como 3 columnas en sjap_presupuesto_mensual).
create table sjap_presupuesto_producto_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  producto_id uuid not null references sjap_productos(id),
  anio integer not null,
  mes integer not null check (mes >= 1 and mes <= 12),
  presupuesto numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (estacion_id, producto_id, anio, mes)
);

alter table sjap_presupuesto_producto_mensual enable row level security;
create policy sjap_presupuesto_producto_mensual_scope on sjap_presupuesto_producto_mensual for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Migra los datos existentes de las 3 columnas fijas a filas por producto.
-- Las columnas viejas se dejan intactas (no se rompe nada que las lea todavía),
-- simplemente dejan de ser la fuente de verdad hacia adelante.
insert into sjap_presupuesto_producto_mensual (estacion_id, producto_id, anio, mes, presupuesto)
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_corriente
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'CORRIENTE'
where pm.presupuesto_corriente is not null
union all
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_acpm
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'BIOACEM'
where pm.presupuesto_acpm is not null
union all
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_extra
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'EXTRA'
where pm.presupuesto_extra is not null;
