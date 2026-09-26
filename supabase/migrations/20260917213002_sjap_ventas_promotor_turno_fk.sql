
alter table sjap_ventas_promotor_turno
  add column turno_tipo_id uuid references sjap_turno_tipos(id),
  add column promotor_id uuid references sjap_promotores(id);

-- Backfill turno: los 4 códigos T1-T4 coinciden 1:1 con sjap_turno_tipos.nombre.
update sjap_ventas_promotor_turno v
set turno_tipo_id = t.id
from sjap_turno_tipos t
where t.estacion_id = v.estacion_id and t.nombre = v.turno;

-- Backfill promotor: solo donde el nombre coincide exactamente con un promotor
-- individual del catálogo. Los nombres compuestos históricos ("ANGIE RUIZ/CAMILO
-- SANCHEZ", "SAMUEL MORENO/SANTIAGO LEON", "VALENTINA COSSIO /DANIEL ARGEL")
-- representan 2 personas en una sola fila del Excel original y deliberadamente
-- quedan sin promotor_id (ambigüedad real, no se fuerza un match incorrecto) —
-- promotor_nombre se conserva intacto para no perder esos datos históricos.
update sjap_ventas_promotor_turno v
set promotor_id = p.id
from sjap_promotores p
where p.estacion_id = v.estacion_id and p.nombre = v.promotor_nombre;
