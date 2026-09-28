-- Carga de archivo: nunca borrar lo que el archivo nuevo no reemplaza (2026-09-27).
--
-- Hallado al reprocesar el 12-feb con la versión anterior (y con el código
-- previo del navegador, que hacía lo mismo): los medios de pago que solo
-- existen en el balance mensual importado (RUMBO, DATAFONO, QR…) se borraban
-- porque compartían archivo con los del POS. Ahora:
--   * medios de pago y resumen por promotor se actualizan por nombre; lo que
--     el archivo no trae se conserva;
--   * si el día ya está CERRADO (completo) el archivo solo actualiza su
--     detalle: no cambia los totales ni el balance conciliados y devuelve la
--     diferencia entre el archivo y el cierre para que el usuario la vea.

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
  v_cerrado boolean := false;
  v_venta_actual numeric;
  v_galones_actual numeric;
  v_diferencias jsonb := null;
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
  from jsonb_populate_recordset(null::sjap_ventas_promotor_resumen, coalesce(p_ventas_promotor, '[]'::jsonb)) x
  on conflict (archivo_id, promotor_nombre) do update
    set numero_ventas = excluded.numero_ventas, total_ventas = excluded.total_ventas;

  insert into sjap_ventas_medio_pago (archivo_id, estacion_id, fecha, medio_pago, numero_ventas, total_ventas)
  select v_archivo_id, v_estacion, p_fecha, x.medio_pago, coalesce(x.numero_ventas, 0), coalesce(x.total_ventas, 0)
  from jsonb_populate_recordset(null::sjap_ventas_medio_pago, coalesce(p_ventas_medio_pago, '[]'::jsonb)) x
  on conflict (archivo_id, medio_pago) do update
    set numero_ventas = excluded.numero_ventas, total_ventas = excluded.total_ventas;

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

  -- Día ya cerrado (completo): el archivo solo actualiza su detalle. Los
  -- totales y el balance conciliados no se tocan; se informa la diferencia.
  select estado = 'completo', venta_total, venta_galones_total into v_cerrado, v_venta_actual, v_galones_actual
    from sjap_cierre_diario where estacion_id = v_estacion and fecha = p_fecha;
  v_cerrado := coalesce(v_cerrado, false);
  select coalesce(sum(venta_total), 0), coalesce(sum(cantidad), 0) into v_venta, v_galones
    from sjap_despachos_producto where archivo_id = v_archivo_id;
  if v_cerrado and (v_venta is distinct from v_venta_actual or v_galones is distinct from v_galones_actual) then
    v_diferencias := jsonb_build_object('venta_archivo', v_venta, 'venta_cierre', v_venta_actual,
                                        'galones_archivo', v_galones, 'galones_cierre', v_galones_actual);
  end if;

  -- 4) balance por producto (solo si el día no está cerrado). Un producto puede venir en varias filas (cambio
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
    where not v_cerrado
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
  insert into sjap_cierre_diario (estacion_id, archivo_id, fecha, venta_total, venta_galones_total, estado, calculado_en)
  values (v_estacion, v_archivo_id, p_fecha, v_venta, v_galones, 'pendiente_insumos', now())
  on conflict (estacion_id, fecha) do update set
    archivo_id = excluded.archivo_id,
    venta_total = case when v_cerrado then sjap_cierre_diario.venta_total else excluded.venta_total end,
    venta_galones_total = case when v_cerrado then sjap_cierre_diario.venta_galones_total else excluded.venta_galones_total end,
    calculado_en = now();

  if not v_cerrado then
    perform sjap_recalcular_estado_cierre(v_estacion, p_fecha);
  end if;

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
                             'advertenciasParser', p_advertencias, 'productosSinResolver', to_jsonb(v_sin_resolver), 'version', v_version,
                             'diaCerrado', v_cerrado, 'diferencias', v_diferencias),
          v_usuario);

  return jsonb_build_object('archivo_id', v_archivo_id, 'version', v_version, 'reprocesado', v_existia,
                            'productos_sin_resolver', to_jsonb(v_sin_resolver),
                            'dia_cerrado', v_cerrado, 'diferencias', v_diferencias);
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
