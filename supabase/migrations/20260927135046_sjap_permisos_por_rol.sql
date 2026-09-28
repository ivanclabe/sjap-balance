-- Integridad de datos y permisos por rol (2026-09-27). Parte 1 de 3: permisos.
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
