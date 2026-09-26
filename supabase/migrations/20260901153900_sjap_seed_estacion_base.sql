-- Semilla base de la estación, para poder levantar un entorno NUEVO desde cero
-- con `supabase db push` / `supabase db reset`.
--
-- Agregada el 2026-09-23. En el proyecto original estos registros se crearon a
-- mano (fuera de migraciones) el 2026-09-01; este archivo los reproduce con los
-- MISMOS ids porque la migración 20260910174944 referencia el id de la estación
-- de forma fija. Es idempotente: en una base que ya tiene los datos no hace nada.
--
-- Para otra estación distinta a EDS LA FLORIDA: cambia nombre/ciudad aquí, pero
-- conserva el id (o ajusta también 20260910174944 antes de aplicar).

insert into public.sjap_estaciones (id, nombre, razon_social, ciudad, bandera, activa)
values ('884b3769-2c20-4a0b-8019-6972bf5e4caa', 'EDS LA FLORIDA', 'EDS JAP S.A.S.', 'Cota', 'Terpel', true)
on conflict (id) do nothing;

insert into public.sjap_productos (id, estacion_id, codigo, nombre_visible, unidad, orden, activo, alias)
values
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'CORRIENTE', 'Corriente', 'GALONES', 1, true, '{}'),
  ('6e896414-4056-4171-89ca-5320b71776a7', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'BIOACEM', 'ACPM / Diésel (Bioacem)', 'GALONES', 2, true, array['DIESEL']),
  ('092f4120-f868-4d4e-9d5b-470436512899', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'EXTRA', 'Extra', 'GALONES', 3, true, '{}')
on conflict (estacion_id, codigo) do nothing;

-- Precios históricos usados por los cierres de ene–feb 2026. En un entorno
-- nuevo, agrega aquí (o por SQL) los precios vigentes reales.
insert into public.sjap_precios_producto (producto_id, precio, vigente_desde)
values
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', 15590, '2026-02-01'),
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', 15190, '2026-02-05'),
  ('6e896414-4056-4171-89ca-5320b71776a7', 10750, '2026-01-21'),
  ('092f4120-f868-4d4e-9d5b-470436512899', 19770, '2026-01-01'),
  ('092f4120-f868-4d4e-9d5b-470436512899', 18070, '2026-02-07')
on conflict (producto_id, vigente_desde) do nothing;
