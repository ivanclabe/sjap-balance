-- Semilla del catálogo de medios de pago, para entornos NUEVOS.
--
-- Agregada el 2026-09-23. La migración 20260917212954 llena el catálogo copiando
-- los medios que ya existían en sjap_ventas_medio_pago; en una base vacía eso no
-- inserta nada. Esta lista reproduce el catálogo real de EDS LA FLORIDA.
-- Idempotente: en una base que ya tiene los medios no hace nada.

insert into public.sjap_medios_pago (estacion_id, nombre, orden)
select '884b3769-2c20-4a0b-8019-6972bf5e4caa', v.nombre, v.orden
from (values
  ('APP TERPEL', 1), ('BONO VIVE TERPEL', 2), ('CLIENTES PROPIOS', 3), ('CONSUMOS TERPEL', 4),
  ('CREDITO', 5), ('CREDITO CLIENTES', 6), ('DATAFONO', 7), ('EFECTIVO', 8), ('GOPASS', 9),
  ('MI EMPRESA', 10), ('QR', 11), ('RUMBO', 12), ('TARJETA DEBITO', 13), ('TRANSFERENCIA', 14),
  ('UREA', 15), ('UREA RUMBO', 16), ('VIVE TERPEL', 17)
) as v(nombre, orden)
where exists (select 1 from public.sjap_estaciones where id = '884b3769-2c20-4a0b-8019-6972bf5e4caa')
on conflict (estacion_id, nombre) do nothing;
