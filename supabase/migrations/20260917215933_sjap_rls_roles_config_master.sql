
create or replace function sjap_rol_de_usuario()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from sjap_usuarios where auth_user_id = auth.uid() limit 1;
$$;

do $$
declare
  t text;
  tablas_config text[] := array[
    'sjap_productos','sjap_medios_pago',
    'sjap_estacion_config','sjap_presupuesto_mensual','sjap_presupuesto_producto_mensual',
    'sjap_estaciones','sjap_usuarios'
  ];
begin
  foreach t in array tablas_config loop
    execute format('drop policy if exists %I on %I', t || '_scope', t);
    execute format(
      'create policy %I on %I for select to authenticated using (%s)',
      t || '_select', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for insert to authenticated with check (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_write', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for update to authenticated using (%s and sjap_rol_de_usuario() = ''master'') with check (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_update', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for delete to authenticated using (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_delete', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
  end loop;
end $$;

drop policy if exists sjap_precios_producto_scope on sjap_precios_producto;
create policy sjap_precios_producto_select on sjap_precios_producto for select to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()));
create policy sjap_precios_producto_write on sjap_precios_producto for insert to authenticated
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
create policy sjap_precios_producto_update on sjap_precios_producto for update to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master')
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
create policy sjap_precios_producto_delete on sjap_precios_producto for delete to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
