-- Integridad de datos (2026-09-27). Parte 3 de 3: carga del archivo e insumos.

-- ---------------------------------------------------------------------------
-- 7. Carga del archivo de cierre en UNA transacción
-- ---------------------------------------------------------------------------
-- Reemplaza la secuencia de ~10 llamadas del navegador. Al reprocesar un día:
--   * reemplaza solo lo que viene del archivo (transacciones, resúmenes,
--     medios de pago, despachos, venta y galones del cierre);
--   * CONSERVA lo capturado o importado: efectivo real, diferencia de caja,
--     certificación, número de clientes, estado, recibos y lecturas reales.
-- SECURITY DEFINER para que un dependiente pueda reprocesar sin tener permiso
-- de borrar historia; la estación siempre es la del usuario que llama.

create or replace function public.sjap_procesar_archivo_cierre(
  p_fecha date,
  p_archivo jsonb,
  p_transacciones jsonb,
  p_ventas_promotor jsonb,
  p_ventas_medio_pago jsonb,
  p_despachos jsonb,
  p_advertencias jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estacion uuid := sjap_estacion_de_usuario();
  v_usuario text;
  v_archivo_id uuid;
  v_version int := 1;
  v_existia boolean := false;
  v_sin_resolver text[] := '{}';
  v_venta numeric;
  v_galones numeric;
  r record;
  v_precio numeric;
  v_ini numeric;
  v_recibos numeric;
  v_real numeric;
  v_teorico numeric;
  v_fluct numeric;
  v_acum_prev numeric;
  v_acum numeric;
begin
  if v_estacion is null then
    raise exception 'Tu usuario no tiene acceso a SJAP Balance.' using errcode = '42501';
  end if;
  if p_fecha is null then
    raise exception 'El archivo no trae una fecha reconocible en sus transacciones.';
  end if;
  select username into v_usuario from sjap_usuarios where auth_user_id = auth.uid();
  perform set_config('sjap.origen', 'carga', true);

  -- 1) archivo del día (uno por estación y fecha)
  select id, version into v_archivo_id, v_version
    from sjap_archivos_cierre where estacion_id = v_estacion and fecha = p_fecha for update;
  if found then
    v_existia := true;
    v_version := v_version + 1;
    delete from sjap_transacciones where archivo_id = v_archivo_id;
    delete from sjap_ventas_promotor_resumen where archivo_id = v_archivo_id;
    delete from sjap_ventas_medio_pago where archivo_id = v_archivo_id;
    delete from sjap_despachos_producto where archivo_id = v_archivo_id;
    update sjap_archivos_cierre set
      nombre_archivo = coalesce(p_archivo->>'nombre_archivo', nombre_archivo),
      tamano_bytes = (p_archivo->>'tamano_bytes')::bigint,
      hash_archivo = p_archivo->>'hash_archivo',
      estado = 'procesando', version = v_version, procesado_en = null,
      subido_por = v_usuario
    where id = v_archivo_id;
  else
    v_version := 1;
    insert into sjap_archivos_cierre (estacion_id, fecha, nombre_archivo, tamano_bytes, hash_archivo, estado, version, subido_por)
    values (v_estacion, p_fecha, coalesce(p_archivo->>'nombre_archivo', 'archivo.xlsx'), (p_archivo->>'tamano_bytes')::bigint,
            p_archivo->>'hash_archivo', 'procesando', 1, v_usuario)
    returning id into v_archivo_id;
  end if;

  -- 2) detalle y resúmenes tal como vienen en el archivo
  insert into sjap_transacciones (archivo_id, estacion_id, categoria, consecutivo, prefijo, fecha, hora, promotor_nombre,
                                  tipo_factura, producto_nombre, cantidad, unidad, subtotal, descuento, impuesto_total, total)
  select v_archivo_id, v_estacion, x.categoria, x.consecutivo, x.prefijo, x.fecha, x.hora, x.promotor_nombre,
         x.tipo_factura, x.producto_nombre, x.cantidad, x.unidad, x.subtotal, coalesce(x.descuento, 0), coalesce(x.impuesto_total, 0), x.total
  from jsonb_populate_recordset(null::sjap_transacciones, coalesce(p_transacciones, '[]'::jsonb)) x;

  insert into sjap_ventas_promotor_resumen (archivo_id, estacion_id, fecha, promotor_nombre, numero_ventas, total_ventas)
  select v_archivo_id, v_estacion, p_fecha, x.promotor_nombre, coalesce(x.numero_ventas, 0), coalesce(x.total_ventas, 0)
  from jsonb_populate_recordset(null::sjap_ventas_promotor_resumen, coalesce(p_ventas_promotor, '[]'::jsonb)) x;

  insert into sjap_ventas_medio_pago (archivo_id, estacion_id, fecha, medio_pago, numero_ventas, total_ventas)
  select v_archivo_id, v_estacion, p_fecha, x.medio_pago, coalesce(x.numero_ventas, 0), coalesce(x.total_ventas, 0)
  from jsonb_populate_recordset(null::sjap_ventas_medio_pago, coalesce(p_ventas_medio_pago, '[]'::jsonb)) x;

  -- 3) despachos, resolviendo el producto por código o alias (sin mayúsculas)
  insert into sjap_despachos_producto (archivo_id, estacion_id, producto_id, producto_nombre_original, fecha, unidad, cantidad, precio, descuento, venta_total)
  select v_archivo_id, v_estacion,
         (select p.id from sjap_productos p
           where p.estacion_id = v_estacion
             and (upper(btrim(p.codigo)) = upper(btrim(x.producto_nombre_original))
                  or upper(btrim(x.producto_nombre_original)) = any (select upper(btrim(a)) from unnest(p.alias) a))
           limit 1),
         x.producto_nombre_original, p_fecha, x.unidad, coalesce(x.cantidad, 0), x.precio, coalesce(x.descuento, 0), x.venta_total
  from jsonb_populate_recordset(null::sjap_despachos_producto, coalesce(p_despachos, '[]'::jsonb)) x;

  select coalesce(array_agg(distinct producto_nombre_original), '{}') into v_sin_resolver
    from sjap_despachos_producto where archivo_id = v_archivo_id and producto_id is null;

  -- 4) balance por producto. Un producto puede venir en varias filas (cambio
  --    de precio a mitad del día): se suman. Se conservan recibos y lectura
  --    real ya registrados, y se recalcula la fluctuación con la fórmula del
  --    balance de referencia (valor = fluctuación acumulada × precio).
  --    Incluye los productos que ya tenían balance ese día y el archivo
  --    nuevo no trae: quedan con ventas 0 en vez de conservar ventas viejas.
  for r in
    select s.producto_id, sum(s.cantidad) as ventas
    from (
      select producto_id, cantidad from sjap_despachos_producto where archivo_id = v_archivo_id and producto_id is not null
      union all
      select producto_id, 0 from sjap_balance_diario_producto where estacion_id = v_estacion and fecha = p_fecha
    ) s
    group by s.producto_id
  loop
    select precio into v_precio from sjap_precios_producto
      where producto_id = r.producto_id and vigente_desde <= p_fecha order by vigente_desde desc limit 1;

    -- inventario inicial = inventario final REAL del día anterior
    select coalesce(
      (select b.inventario_final_real from sjap_balance_diario_producto b
        where b.estacion_id = v_estacion and b.producto_id = r.producto_id and b.fecha < p_fecha and b.inventario_final_real is not null
        order by b.fecha desc limit 1),
      (select l.inventario_final_real from sjap_lecturas_inventario l
        where l.estacion_id = v_estacion and l.producto_id = r.producto_id and l.fecha < p_fecha
        order by l.fecha desc limit 1),
      (select b.inventario_inicial from sjap_balance_diario_producto b
        where b.estacion_id = v_estacion and b.producto_id = r.producto_id and b.fecha = p_fecha))
    into v_ini;

    select b.recibos_galones, b.inventario_final_real into v_recibos, v_real
      from sjap_balance_diario_producto b
      where b.estacion_id = v_estacion and b.producto_id = r.producto_id and b.fecha = p_fecha;
    v_recibos := coalesce(v_recibos, 0);
    if v_real is null then
      select l.inventario_final_real into v_real from sjap_lecturas_inventario l
        where l.estacion_id = v_estacion and l.producto_id = r.producto_id and l.fecha = p_fecha;
    end if;

    v_teorico := case when v_ini is not null then v_ini + v_recibos - r.ventas end;
    v_fluct := case when v_real is not null and v_teorico is not null then v_real - v_teorico end;
    select b.fluctuacion_acumulada into v_acum_prev from sjap_balance_diario_producto b
      where b.estacion_id = v_estacion and b.producto_id = r.producto_id and b.fecha < p_fecha and b.fluctuacion_acumulada is not null
      order by b.fecha desc limit 1;
    v_acum := case when v_fluct is not null then coalesce(v_acum_prev, 0) + v_fluct end;

    insert into sjap_balance_diario_producto as b (estacion_id, producto_id, fecha, inventario_inicial, ventas_galones, recibos_galones,
      inventario_teorico, inventario_final_real, fluctuacion_dia, fluctuacion_acumulada, precio_vigente, fluctuacion_valor, estado, calculado_en)
    values (v_estacion, r.producto_id, p_fecha, v_ini, r.ventas, v_recibos, v_teorico, v_real, v_fluct, v_acum, v_precio,
            case when v_acum is not null and v_precio is not null then v_acum * v_precio end,
            case when v_real is not null then 'completo' else 'pendiente_insumos' end, now())
    on conflict (estacion_id, producto_id, fecha) do update set
      inventario_inicial = excluded.inventario_inicial,
      ventas_galones = excluded.ventas_galones,
      inventario_teorico = excluded.inventario_teorico,
      inventario_final_real = excluded.inventario_final_real,
      fluctuacion_dia = excluded.fluctuacion_dia,
      fluctuacion_acumulada = excluded.fluctuacion_acumulada,
      precio_vigente = excluded.precio_vigente,
      fluctuacion_valor = excluded.fluctuacion_valor,
      estado = excluded.estado,
      calculado_en = now();
  end loop;

  -- 5) cierre del día: solo se reemplaza lo que viene del archivo
  select coalesce(sum(venta_total), 0), coalesce(sum(cantidad), 0) into v_venta, v_galones
    from sjap_despachos_producto where archivo_id = v_archivo_id;

  insert into sjap_cierre_diario (estacion_id, archivo_id, fecha, venta_total, venta_galones_total, estado, calculado_en)
  values (v_estacion, v_archivo_id, p_fecha, v_venta, v_galones, 'pendiente_insumos', now())
  on conflict (estacion_id, fecha) do update set
    archivo_id = excluded.archivo_id,
    venta_total = excluded.venta_total,
    venta_galones_total = excluded.venta_galones_total,
    calculado_en = now();

  perform sjap_recalcular_estado_cierre(v_estacion, p_fecha);

  -- 6) trazabilidad
  update sjap_archivos_cierre set
    estado = case when jsonb_array_length(coalesce(p_advertencias, '[]'::jsonb)) > 0 or cardinality(v_sin_resolver) > 0 then 'con_errores' else 'procesado' end,
    procesado_en = now(),
    errores = case when jsonb_array_length(coalesce(p_advertencias, '[]'::jsonb)) > 0 or cardinality(v_sin_resolver) > 0
                   then jsonb_build_object('advertencias', p_advertencias, 'sinResolver', to_jsonb(v_sin_resolver)) end
  where id = v_archivo_id;

  insert into sjap_archivos_cierre_historial (archivo_id, version, hash_archivo, estado_resultado, errores)
  values (v_archivo_id, v_version, p_archivo->>'hash_archivo', 'ok',
          case when jsonb_array_length(coalesce(p_advertencias, '[]'::jsonb)) > 0 or cardinality(v_sin_resolver) > 0
               then jsonb_build_object('advertencias', p_advertencias, 'sinResolver', to_jsonb(v_sin_resolver)) end);

  insert into sjap_auditoria (estacion_id, archivo_id, entidad, entidad_id, accion, nivel, detalle, created_by)
  values (v_estacion, v_archivo_id, 'sjap_archivos_cierre', v_archivo_id,
          case when v_existia then 'reprocesado' else 'procesado' end,
          case when jsonb_array_length(coalesce(p_advertencias, '[]'::jsonb)) > 0 or cardinality(v_sin_resolver) > 0 then 'warning' else 'info' end,
          jsonb_build_object('transacciones', jsonb_array_length(coalesce(p_transacciones, '[]'::jsonb)),
                             'advertenciasParser', p_advertencias, 'productosSinResolver', to_jsonb(v_sin_resolver), 'version', v_version),
          v_usuario);

  return jsonb_build_object('archivo_id', v_archivo_id, 'version', v_version, 'reprocesado', v_existia,
                            'productos_sin_resolver', to_jsonb(v_sin_resolver));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Insumos manuales del día (lectura de tanque y efectivo) atómicos
-- ---------------------------------------------------------------------------

-- Completo = cada producto ACTIVO tiene lectura real ese día + efectivo real.
create or replace function public.sjap_recalcular_estado_cierre(p_estacion uuid, p_fecha date)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_inventario boolean;
  v_efectivo boolean;
begin
  select bool_and(
           exists (select 1 from sjap_balance_diario_producto b where b.estacion_id = p_estacion and b.producto_id = p.id and b.fecha = p_fecha and b.inventario_final_real is not null)
           or exists (select 1 from sjap_lecturas_inventario l where l.estacion_id = p_estacion and l.producto_id = p.id and l.fecha = p_fecha))
    into v_inventario
    from sjap_productos p where p.estacion_id = p_estacion and p.activo;
  select efectivo_real is not null into v_efectivo from sjap_cierre_diario where estacion_id = p_estacion and fecha = p_fecha;
  update sjap_cierre_diario
    set estado = case when coalesce(v_inventario, false) and coalesce(v_efectivo, false) then 'completo' else 'pendiente_insumos' end
    where estacion_id = p_estacion and fecha = p_fecha and estado <> 'con_alertas';
end;
$$;

create or replace function public.sjap_registrar_inventario(p_fecha date, p_lecturas jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estacion uuid := sjap_estacion_de_usuario();
  v_usuario text;
  item jsonb;
  v_producto uuid;
  v_valor numeric;
  v_teorico numeric;
  v_precio numeric;
  v_fluct numeric;
  v_acum numeric;
begin
  if v_estacion is null then
    raise exception 'Tu usuario no tiene acceso a SJAP Balance.' using errcode = '42501';
  end if;
  select username into v_usuario from sjap_usuarios where auth_user_id = auth.uid();
  for item in select * from jsonb_array_elements(p_lecturas) loop
    v_producto := (item->>'producto_id')::uuid;
    v_valor := (item->>'valor')::numeric;
    if v_valor is null or v_valor < 0 then
      raise exception 'La lectura de inventario debe ser un número mayor o igual a cero.';
    end if;
    if not exists (select 1 from sjap_productos where id = v_producto and estacion_id = v_estacion) then
      raise exception 'Producto no encontrado en la estación.';
    end if;

    insert into sjap_lecturas_inventario (estacion_id, producto_id, fecha, inventario_final_real, origen, capturado_por, capturado_en)
    values (v_estacion, v_producto, p_fecha, v_valor, 'manual', v_usuario, now())
    on conflict (estacion_id, producto_id, fecha) do update
      set inventario_final_real = excluded.inventario_final_real, origen = 'manual',
          capturado_por = excluded.capturado_por, capturado_en = now();

    select inventario_teorico, precio_vigente into v_teorico, v_precio
      from sjap_balance_diario_producto where estacion_id = v_estacion and producto_id = v_producto and fecha = p_fecha;
    if found then
      v_fluct := case when v_teorico is not null then v_valor - v_teorico end;
      select coalesce(fluctuacion_acumulada, 0) into v_acum from sjap_balance_diario_producto
        where estacion_id = v_estacion and producto_id = v_producto and fecha < p_fecha and fluctuacion_acumulada is not null
        order by fecha desc limit 1;
      v_acum := case when v_fluct is not null then coalesce(v_acum, 0) + v_fluct end;
      update sjap_balance_diario_producto set
        inventario_final_real = v_valor,
        fluctuacion_dia = v_fluct,
        fluctuacion_acumulada = v_acum,
        fluctuacion_valor = case when v_acum is not null and v_precio is not null then v_acum * v_precio end,
        estado = 'completo',
        calculado_en = now()
      where estacion_id = v_estacion and producto_id = v_producto and fecha = p_fecha;
    end if;
  end loop;
  perform sjap_recalcular_estado_cierre(v_estacion, p_fecha);
end;
$$;

create or replace function public.sjap_registrar_efectivo(p_fecha date, p_efectivo numeric)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estacion uuid := sjap_estacion_de_usuario();
  v_usuario text;
begin
  if v_estacion is null then
    raise exception 'Tu usuario no tiene acceso a SJAP Balance.' using errcode = '42501';
  end if;
  if p_efectivo is null or p_efectivo < 0 then
    raise exception 'El efectivo real debe ser un número mayor o igual a cero.';
  end if;
  if not exists (select 1 from sjap_cierre_diario where estacion_id = v_estacion and fecha = p_fecha) then
    raise exception 'Primero carga el archivo de cierre de ese día.';
  end if;
  select username into v_usuario from sjap_usuarios where auth_user_id = auth.uid();
  insert into sjap_efectivo_diario (estacion_id, fecha, efectivo_real, origen, capturado_por, capturado_en)
  values (v_estacion, p_fecha, p_efectivo, 'manual', v_usuario, now())
  on conflict (estacion_id, fecha) do update
    set efectivo_real = excluded.efectivo_real, origen = 'manual', capturado_por = excluded.capturado_por, capturado_en = now();
  update sjap_cierre_diario set efectivo_real = p_efectivo where estacion_id = v_estacion and fecha = p_fecha;
  perform sjap_recalcular_estado_cierre(v_estacion, p_fecha);
end;
$$;

revoke execute on function public.sjap_procesar_archivo_cierre(date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.sjap_recalcular_estado_cierre(uuid, date) from public, anon;
-- INVOKER: la RLS limita la actualización a la estación del usuario.
grant execute on function public.sjap_recalcular_estado_cierre(uuid, date) to authenticated;
revoke execute on function public.sjap_registrar_inventario(date, jsonb) from public, anon;
revoke execute on function public.sjap_registrar_efectivo(date, numeric) from public, anon;
revoke execute on function public.sjap_uso_texto_isla(uuid, text) from public, anon;
grant execute on function public.sjap_procesar_archivo_cierre(date, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.sjap_registrar_inventario(date, jsonb) to authenticated;
grant execute on function public.sjap_registrar_efectivo(date, numeric) to authenticated;
grant execute on function public.sjap_uso_texto_isla(uuid, text) to authenticated;
revoke execute on function public.sjap_guardar_esquema_turnos(uuid, jsonb) from public, anon;
grant execute on function public.sjap_guardar_esquema_turnos(uuid, jsonb) to authenticated;
