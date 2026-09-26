
insert into sjap_estacion_config (estacion_id, clave, valor, descripcion)
select id, 'data_freshness_warning_days', '3', 'Días sin cierre nuevo desde los que se muestra advertencia de datos desactualizados'
from sjap_estaciones
union all
select id, 'data_freshness_critical_days', '7', 'Días sin cierre nuevo desde los que se muestra alerta crítica de datos desactualizados'
from sjap_estaciones
on conflict (estacion_id, clave) do nothing;
