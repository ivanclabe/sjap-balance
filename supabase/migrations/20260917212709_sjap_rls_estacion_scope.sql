
-- Helper: estación del usuario autenticado actual (SECURITY DEFINER para poder
-- leer sjap_usuarios sin depender de la política de esa misma tabla).
create or replace function sjap_estacion_de_usuario()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select estacion_id from sjap_usuarios where auth_user_id = auth.uid() limit 1;
$$;

-- sjap_estaciones (tabla raíz: es la estación, no tiene estacion_id)
drop policy if exists sjap_estaciones_anon_poc on sjap_estaciones;
drop policy if exists sjap_estaciones_authenticated_all on sjap_estaciones;
create policy sjap_estaciones_scope on sjap_estaciones for all to authenticated
  using (id = sjap_estacion_de_usuario())
  with check (id = sjap_estacion_de_usuario());

-- Tablas con estacion_id directo
do $$
declare
  t text;
  tablas text[] := array[
    'sjap_productos','sjap_archivos_cierre','sjap_transacciones',
    'sjap_ventas_promotor_resumen','sjap_ventas_medio_pago','sjap_despachos_producto',
    'sjap_lecturas_inventario','sjap_facturas_compra','sjap_efectivo_diario',
    'sjap_cuentas_cliente','sjap_ventas_promotor_turno','sjap_balance_diario_producto',
    'sjap_cierre_diario','sjap_urea_diario','sjap_presupuesto_mensual','sjap_sicom_mensual',
    'sjap_promotores','sjap_islas','sjap_turno_tipos','sjap_ausencias',
    'sjap_turnos_programados','sjap_usuarios','sjap_auditoria'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists %I on %I', t || '_anon_poc', t);
    execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (estacion_id = sjap_estacion_de_usuario()) with check (estacion_id = sjap_estacion_de_usuario())',
      t || '_scope', t
    );
  end loop;
end $$;

-- Tablas escaladas via join (no tienen estacion_id propio)
drop policy if exists sjap_precios_producto_anon_poc on sjap_precios_producto;
drop policy if exists sjap_precios_producto_authenticated_all on sjap_precios_producto;
create policy sjap_precios_producto_scope on sjap_precios_producto for all to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()));

drop policy if exists sjap_archivos_cierre_historial_anon_poc on sjap_archivos_cierre_historial;
drop policy if exists sjap_archivos_cierre_historial_authenticated_all on sjap_archivos_cierre_historial;
create policy sjap_archivos_cierre_historial_scope on sjap_archivos_cierre_historial for all to authenticated
  using (exists (select 1 from sjap_archivos_cierre a where a.id = sjap_archivos_cierre_historial.archivo_id and a.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_archivos_cierre a where a.id = sjap_archivos_cierre_historial.archivo_id and a.estacion_id = sjap_estacion_de_usuario()));

drop policy if exists sjap_movimientos_cuenta_cliente_anon_poc on sjap_movimientos_cuenta_cliente;
drop policy if exists sjap_movimientos_cuenta_cliente_authenticated_all on sjap_movimientos_cuenta_cliente;
create policy sjap_movimientos_cuenta_cliente_scope on sjap_movimientos_cuenta_cliente for all to authenticated
  using (exists (select 1 from sjap_cuentas_cliente c where c.id = sjap_movimientos_cuenta_cliente.cuenta_id and c.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_cuentas_cliente c where c.id = sjap_movimientos_cuenta_cliente.cuenta_id and c.estacion_id = sjap_estacion_de_usuario()));
