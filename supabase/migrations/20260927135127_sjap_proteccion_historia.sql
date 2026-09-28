-- Integridad de datos (2026-09-27). Parte 2 de 3: protección de la historia.

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
