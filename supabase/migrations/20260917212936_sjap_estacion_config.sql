
create table sjap_estacion_config (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  clave text not null,
  valor text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estacion_id, clave)
);

alter table sjap_estacion_config enable row level security;
create policy sjap_estacion_config_scope on sjap_estacion_config for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Semillas: los umbrales que hoy viven como literales dispersos en el código.
-- umbral_fluctuacion_galones: se documentaron dos valores distintos (5 y 100) para
-- la misma métrica en archivos distintos. Se elige 100 con base en los datos reales
-- de producción (fluctuaciones diarias de bioacem llegaron a ~1.700 galones en un
-- solo día en feb-2026; un corte de 5 marcaría como "peligroso" casi cualquier día).
insert into sjap_estacion_config (estacion_id, clave, valor, descripcion)
select id, 'umbral_fluctuacion_galones', '100', 'Fluctuación diaria de producto (galones) que se marca como alerta'
from sjap_estaciones
union all
select id, 'umbral_diferencia_caja_cop', '5000', 'Diferencia de caja (COP) que se marca como alerta'
from sjap_estaciones
union all
select id, 'umbral_sicom_galones', '50', 'Diferencia de inventario Sicom (galones) que se marca como alerta'
from sjap_estaciones
union all
select id, 'corte_cumplimiento_presupuesto', '1.0', 'Fracción de cumplimiento (compra/presupuesto) desde la cual se considera cumplido'
from sjap_estaciones;
