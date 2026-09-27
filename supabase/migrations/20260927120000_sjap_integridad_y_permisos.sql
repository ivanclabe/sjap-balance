-- Integridad de datos y permisos por rol (2026-09-27).
--
-- Resultado de la auditoría de módulos:
--   * Casi todas las tablas permitían a cualquier usuario de la estación
--     (incluido un dependiente) insertar, editar y BORRAR por la API, incluso
--     catálogos, datos importados y la auditoría.
--   * Re-subir el archivo de un día borraba y recreaba el cierre, perdiendo el
--     efectivo real, la diferencia de caja y demás datos capturados o
--     importados, y no era transaccional.
--   * Guardar dos veces la lectura de tanque o el efectivo de un día fallaba
--     en silencio (restricción única) y un producto inactivo impedía cerrar.
--   * Los nombres únicos distinguían mayúsculas/espacios; los turnos
--     programados no tenían control de duplicados.
--
-- Matriz de permisos resultante (siempre limitada a la estación del usuario):
--   master       → todo.
--   dependiente  → lee todo; opera el día (carga de archivos, insumos,
--                  facturas, movimientos, turnos y ausencias de hoy en
--                  adelante); no modifica catálogos, configuración, datos
--                  importados ni borra historia.

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares
-- ---------------------------------------------------------------------------

create or replace function public.sjap_es_master()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(public.sjap_rol_de_usuario() = 'master', false);
$$;

-- Fecha de hoy en la zona horaria de la estación (por defecto Bogotá).
create or replace function public.sjap_hoy()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select zona_horaria from public.sjap_estaciones where id = public.sjap_estacion_de_usuario()),
    'America/Bogota'))::date;
$$;

revoke execute on function public.sjap_es_master() from public, anon;
revoke execute on function public.sjap_hoy() from public, anon;
grant execute on function public.sjap_es_master() to authenticated, service_role;
grant execute on function public.sjap_hoy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Políticas RLS por rol
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  alcance text;
  -- tabla → expresión de alcance por estación
  alcances jsonb := jsonb_build_object(
    'sjap_archivos_cierre_historial', 'exists (select 1 from sjap_archivos_cierre a where a.id = archivo_id and a.estacion_id = sjap_estacion_de_usuario())',
    'sjap_movimientos_cuenta_cliente', 'exists (select 1 from sjap_cuentas_cliente c where c.id = cuenta_id and c.estacion_id = sjap_estacion_de_usuario())'
  );
  -- catálogos, esquemas y datos importados sin captura en la app: solo master escribe
  solo_master text[] := array[
    'sjap_promotores','sjap_islas','sjap_esquemas_turno','sjap_turno_tipos','sjap_esquema_reglas',
    'sjap_cuentas_cliente','sjap_ventas_promotor_turno','sjap_sicom_mensual','sjap_urea_diario'];
  -- operación diaria: todos crean/editan, solo master borra
  operativas text[] := array[
    'sjap_archivos_cierre','sjap_transacciones','sjap_ventas_promotor_resumen','sjap_ventas_medio_pago',
    'sjap_despachos_producto','sjap_balance_diario_producto','sjap_cierre_diario',
    'sjap_lecturas_inventario','sjap_efectivo_diario'];
  -- bitácoras: solo se agregan filas, nadie las edita ni las borra
  bitacoras text[] := array['sjap_auditoria','sjap_archivos_cierre_historial'];
  -- registros manuales: todos crean; solo master corrige/borra y nunca lo importado
  manuales text[] := array['sjap_facturas_compra','sjap_movimientos_cuenta_cliente'];
  -- planificación: todos, con bloqueo de fechas pasadas por trigger
  planificacion text[] := array['sjap_turnos_programados','sjap_ausencias'];
  todas text[];
begin
  todas := solo_master || operativas || bitacoras || manuales || planificacion;
  foreach t in array todas loop
    alcance := coalesce(alcances->>t, 'estacion_id = sjap_estacion_de_usuario()');
    execute format('drop policy if exists %I on %I', t || '_scope', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select to authenticated using (%s)', t || '_select', t, alcance);

    if t = any(solo_master) then
      execute format('create policy %I on %I for insert to authenticated with check ((%s) and sjap_es_master())', t || '_write', t, alcance);
      execute format('create policy %I on %I for update to authenticated using ((%s) and sjap_es_master()) with check ((%s) and sjap_es_master())', t || '_update', t, alcance, alcance);
      execute format('create policy %I on %I for delete to authenticated using ((%s) and sjap_es_master())', t || '_delete', t, alcance);
    elsif t = any(operativas) then
      execute format('create policy %I on %I for insert to authenticated with check (%s)', t || '_write', t, alcance);
      execute format('create policy %I on %I for update to authenticated using (%s) with check (%s)', t || '_update', t, alcance, alcance);
      execute format('create policy %I on %I for delete to authenticated using ((%s) and sjap_es_master())', t || '_delete', t, alcance);
    elsif t = any(bitacoras) then
      execute format('create policy %I on %I for insert to authenticated with check (%s)', t || '_write', t, alcance);
    elsif t = any(manuales) then
      execute format('create policy %I on %I for insert to authenticated with check ((%s) and origen = ''manual'')', t || '_write', t, alcance);
      execute format('create policy %I on %I for update to authenticated using ((%s) and sjap_es_master() and origen = ''manual'') with check ((%s) and origen = ''manual'')', t || '_update', t, alcance, alcance);
      execute format('create policy %I on %I for delete to authenticated using ((%s) and sjap_es_master() and origen = ''manual'')', t || '_delete', t, alcance);
    else -- planificación
      execute format('create policy %I on %I for insert to authenticated with check (%s)', t || '_write', t, alcance);
      execute format('create policy %I on %I for update to authenticated using (%s) with check (%s)', t || '_update', t, alcance, alcance);
      execute format('create policy %I on %I for delete to authenticated using (%s)', t || '_delete', t, alcance);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Nombres únicos sin distinguir mayúsculas/espacios y turnos sin duplicar
-- ---------------------------------------------------------------------------

create unique index if not exists sjap_promotores_nombre_ci on public.sjap_promotores (estacion_id, lower(btrim(nombre)));
create unique index if not exists sjap_islas_nombre_ci on public.sjap_islas (estacion_id, lower(btrim(nombre)));
create unique index if not exists sjap_medios_pago_nombre_ci on public.sjap_medios_pago (estacion_id, lower(btrim(nombre)));
create unique index if not exists sjap_cuentas_cliente_nombre_ci on public.sjap_cuentas_cliente (estacion_id, lower(btrim(nombre)));
create unique index if not exists sjap_turnos_programados_unico
  on public.sjap_turnos_programados (estacion_id, fecha, isla_id, turno_tipo_id, promotor_id);

alter table public.sjap_promotores add constraint sjap_promotores_nombre_no_vacio check (btrim(nombre) <> '') not valid;
alter table public.sjap_islas add constraint sjap_islas_nombre_no_vacio check (btrim(nombre) <> '') not valid;
alter table public.sjap_cuentas_cliente add constraint sjap_cuentas_cliente_nombre_no_vacio check (btrim(nombre) <> '') not valid;
alter table public.sjap_medios_pago add constraint sjap_medios_pago_nombre_no_vacio check (btrim(nombre) <> '') not valid;
alter table public.sjap_facturas_compra add constraint sjap_facturas_compra_cantidad_positiva check (cantidad > 0) not valid;

-- ---------------------------------------------------------------------------
-- 4. Protección de la historia
-- ---------------------------------------------------------------------------

-- Turnos programados: los días anteriores a hoy quedan de solo lectura para
-- quien no es master. Sin sesión (SQL Editor / servicios) no aplica.
create or replace function public.sjap_turnos_proteger_pasado()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hoy date;
begin
  if auth.uid() is null or sjap_es_master() then
    return coalesce(new, old);
  end if;
  v_hoy := sjap_hoy();
  if (tg_op in ('UPDATE', 'DELETE') and old.fecha < v_hoy) or (tg_op in ('INSERT', 'UPDATE') and new.fecha < v_hoy) then
    raise exception 'Los turnos de días anteriores a hoy ya no se pueden modificar. Pídeselo a un usuario master.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sjap_turnos_programados_pasado on public.sjap_turnos_programados;
create trigger sjap_turnos_programados_pasado
  before insert or update or delete on public.sjap_turnos_programados
  for each row execute function public.sjap_turnos_proteger_pasado();

-- Ausencias ya terminadas: solo un master puede corregirlas o borrarlas.
create or replace function public.sjap_ausencias_proteger_pasado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or sjap_es_master() then
    return coalesce(new, old);
  end if;
  if old.fecha_hasta < sjap_hoy() then
    raise exception 'Esta ausencia ya terminó y forma parte del historial. Solo un master puede modificarla.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sjap_ausencias_pasado on public.sjap_ausencias;
create trigger sjap_ausencias_pasado
  before update or delete on public.sjap_ausencias
  for each row execute function public.sjap_ausencias_proteger_pasado();

-- Corregir los valores extraídos del archivo (venta, galones, clientes) es
-- solo para master; la carga de archivos lo hace a través de su función.
create or replace function public.sjap_cierre_proteger_correcciones()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or sjap_es_master() or current_setting('sjap.origen', true) = 'carga' then
    return new;
  end if;
  if new.venta_total is distinct from old.venta_total
     or new.venta_galones_total is distinct from old.venta_galones_total
     or new.numero_clientes is distinct from old.numero_clientes
     or new.fecha is distinct from old.fecha
     or new.estacion_id is distinct from old.estacion_id then
    raise exception 'Solo un usuario master puede corregir la venta, los galones o el número de clientes de un cierre.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists sjap_cierre_diario_correcciones on public.sjap_cierre_diario;
create trigger sjap_cierre_diario_correcciones
  before update on public.sjap_cierre_diario
  for each row execute function public.sjap_cierre_proteger_correcciones();

-- Catálogos referenciados por TEXTO en datos históricos: renombrar o borrar
-- rompería el cruce (ventas_medio_pago.medio_pago, ventas_promotor_turno.isla).
create or replace function public.sjap_uso_texto_isla(p_estacion uuid, p_nombre text)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*) from public.sjap_ventas_promotor_turno v
  where v.estacion_id = p_estacion
    and (upper(btrim(v.isla)) = upper(btrim(p_nombre))
         or upper(btrim(p_nombre)) = any (regexp_split_to_array(upper(btrim(v.isla)), '\s*(?:\sY\s|,|/|-|&)\s*')));
$$;

create or replace function public.sjap_catalogo_proteger_texto()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_uso bigint;
begin
  if tg_op = 'UPDATE' and lower(btrim(new.nombre)) = lower(btrim(old.nombre)) then
    return new;
  end if;
  if tg_table_name = 'sjap_medios_pago' then
    select count(*) into v_uso from public.sjap_ventas_medio_pago
      where estacion_id = old.estacion_id and upper(btrim(medio_pago)) = upper(btrim(old.nombre));
  else
    v_uso := public.sjap_uso_texto_isla(old.estacion_id, old.nombre);
  end if;
  if v_uso > 0 then
    raise exception '"%" aparece en % registro(s) históricos con ese nombre: no se puede % sin romper los reportes. Desactívalo en su lugar.',
      old.nombre, v_uso, case when tg_op = 'DELETE' then 'eliminar' else 'renombrar' end
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sjap_medios_pago_texto on public.sjap_medios_pago;
create trigger sjap_medios_pago_texto
  before update of nombre or delete on public.sjap_medios_pago
  for each row execute function public.sjap_catalogo_proteger_texto();

drop trigger if exists sjap_islas_texto on public.sjap_islas;
create trigger sjap_islas_texto
  before update of nombre or delete on public.sjap_islas
  for each row execute function public.sjap_catalogo_proteger_texto();

-- Productos y cuentas de cliente borran en cascada su historia (balances,
-- facturas, lecturas, precios, movimientos): se impide borrarlos si la tienen.
create or replace function public.sjap_proteger_borrado_con_historia()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tiene boolean;
begin
  if tg_table_name = 'sjap_productos' then
    v_tiene := exists (select 1 from public.sjap_balance_diario_producto where producto_id = old.id)
      or exists (select 1 from public.sjap_facturas_compra where producto_id = old.id)
      or exists (select 1 from public.sjap_lecturas_inventario where producto_id = old.id)
      or exists (select 1 from public.sjap_despachos_producto where producto_id = old.id);
  else
    v_tiene := exists (select 1 from public.sjap_movimientos_cuenta_cliente where cuenta_id = old.id);
  end if;
  if v_tiene then
    raise exception '"%" tiene historial asociado y no se puede eliminar. Desactívalo en su lugar.',
      coalesce(to_jsonb(old)->>'nombre_visible', to_jsonb(old)->>'nombre') using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists sjap_productos_borrado on public.sjap_productos;
create trigger sjap_productos_borrado
  before delete on public.sjap_productos
  for each row execute function public.sjap_proteger_borrado_con_historia();

drop trigger if exists sjap_cuentas_cliente_borrado on public.sjap_cuentas_cliente;
create trigger sjap_cuentas_cliente_borrado
  before delete on public.sjap_cuentas_cliente
  for each row execute function public.sjap_proteger_borrado_con_historia();

-- ---------------------------------------------------------------------------
-- 5. Uso de cada elemento de catálogo (para decidir editar/borrar/desactivar)
-- ---------------------------------------------------------------------------

create or replace function public.sjap_uso_catalogos()
returns table (tipo text, id uuid, turnos bigint, ventas bigint, ausencias bigint, reglas bigint)
language sql
stable
set search_path = public
as $$
  select 'promotor', p.id,
    (select count(*) from sjap_turnos_programados t where t.promotor_id = p.id),
    (select count(*) from sjap_ventas_promotor_turno v where v.promotor_id = p.id),
    (select count(*) from sjap_ausencias a where a.promotor_id = p.id),
    0::bigint
  from sjap_promotores p where p.estacion_id = sjap_estacion_de_usuario()
  union all
  select 'isla', i.id,
    (select count(*) from sjap_turnos_programados t where t.isla_id = i.id),
    sjap_uso_texto_isla(i.estacion_id, i.nombre),
    0::bigint,
    (select count(*) from sjap_esquema_reglas r where r.isla_id = i.id)
  from sjap_islas i where i.estacion_id = sjap_estacion_de_usuario()
  union all
  select 'medio_pago', m.id, 0::bigint,
    (select count(*) from sjap_ventas_medio_pago v where v.estacion_id = m.estacion_id and upper(btrim(v.medio_pago)) = upper(btrim(m.nombre))),
    0::bigint, 0::bigint
  from sjap_medios_pago m where m.estacion_id = sjap_estacion_de_usuario();
$$;

revoke execute on function public.sjap_uso_catalogos() from public, anon;
grant execute on function public.sjap_uso_catalogos() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Esquemas de turno: un turno usado en ventas históricas se desactiva, no
--    se borra (antes fallaba por la llave foránea).
-- ---------------------------------------------------------------------------

create or replace function public.sjap_guardar_esquema_turnos(p_esquema_id uuid, p_turnos jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_estacion uuid;
  item jsonb;
  ids_conservados uuid[] := '{}';
  v_id uuid;
  i int := 0;
begin
  select estacion_id into v_estacion from sjap_esquemas_turno where id = p_esquema_id;
  if v_estacion is null then
    raise exception 'Esquema no encontrado.';
  end if;

  for item in select * from jsonb_array_elements(p_turnos) loop
    i := i + 1;
    if coalesce(trim(item->>'nombre'), '') = '' then
      raise exception 'Cada turno necesita un nombre.';
    end if;
    if nullif(item->>'id', '') is not null then
      update sjap_turno_tipos
        set nombre = trim(item->>'nombre'),
            hora_inicio = (item->>'hora_inicio')::time,
            hora_fin = (item->>'hora_fin')::time,
            orden = i,
            activo = true
        where id = (item->>'id')::uuid and esquema_id = p_esquema_id
        returning id into v_id;
      if v_id is null then
        raise exception 'Turno no encontrado en este esquema.';
      end if;
    else
      insert into sjap_turno_tipos (estacion_id, esquema_id, nombre, hora_inicio, hora_fin, orden, activo)
        values (v_estacion, p_esquema_id, trim(item->>'nombre'), (item->>'hora_inicio')::time, (item->>'hora_fin')::time, i, true)
        returning id into v_id;
    end if;
    ids_conservados := ids_conservados || v_id;
  end loop;

  update sjap_turno_tipos set activo = false
    where esquema_id = p_esquema_id and not (id = any(ids_conservados))
      and (exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id)
           or exists (select 1 from sjap_ventas_promotor_turno v where v.turno_tipo_id = sjap_turno_tipos.id));
  delete from sjap_turno_tipos
    where esquema_id = p_esquema_id and not (id = any(ids_conservados))
      and not exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id)
      and not exists (select 1 from sjap_ventas_promotor_turno v where v.turno_tipo_id = sjap_turno_tipos.id);
end $function$;

-- Marcar un esquema como predeterminado en una sola operación (antes eran dos
-- updates desde el navegador y el primero filtraba por una estación indefinida).
create or replace function public.sjap_esquema_predeterminado(p_esquema_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estacion uuid;
begin
  select estacion_id into v_estacion from sjap_esquemas_turno where id = p_esquema_id;
  if v_estacion is null then
    raise exception 'Esquema no encontrado.';
  end if;
  update sjap_esquemas_turno set es_predeterminado = false where estacion_id = v_estacion and es_predeterminado and id <> p_esquema_id;
  update sjap_esquemas_turno set es_predeterminado = true where id = p_esquema_id;
end;
$$;

revoke execute on function public.sjap_esquema_predeterminado(uuid) from public, anon;
grant execute on function public.sjap_esquema_predeterminado(uuid) to authenticated;

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
