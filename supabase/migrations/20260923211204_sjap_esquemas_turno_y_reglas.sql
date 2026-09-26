
-- 1. Esquemas de turno: un conjunto de turnos (2, 3, 4 o los que sean) que
--    se puede asignar por defecto, por día de la semana, por isla o por fecha.
create table sjap_esquemas_turno (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  es_predeterminado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);
create unique index sjap_esquemas_turno_un_predeterminado on sjap_esquemas_turno (estacion_id) where es_predeterminado;

alter table sjap_esquemas_turno enable row level security;
create policy sjap_esquemas_turno_scope on sjap_esquemas_turno for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Los 4 turnos existentes pasan a un esquema predeterminado "Estándar":
-- ninguna asignación existente cambia de significado.
insert into sjap_esquemas_turno (estacion_id, nombre, es_predeterminado)
select id, 'Estándar', true from sjap_estaciones;

alter table sjap_turno_tipos add column esquema_id uuid references sjap_esquemas_turno(id);
update sjap_turno_tipos t set esquema_id = e.id
from sjap_esquemas_turno e where e.estacion_id = t.estacion_id and e.es_predeterminado;
alter table sjap_turno_tipos alter column esquema_id set not null;

-- El nombre deja de ser único por estación (dos esquemas pueden tener "Turno 1")
-- y pasa a ser único dentro del esquema. Diferible para permitir renombrar/
-- intercambiar nombres dentro de una misma transacción.
alter table sjap_turno_tipos drop constraint sjap_turno_tipos_estacion_id_nombre_key;
alter table sjap_turno_tipos add constraint sjap_turno_tipos_esquema_nombre_key
  unique (esquema_id, nombre) deferrable initially deferred;

-- 2. Reglas: qué esquema aplica. La más específica gana:
--    fecha+isla > fecha > día+isla > día > isla > esquema predeterminado.
create table sjap_esquema_reglas (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  esquema_id uuid not null references sjap_esquemas_turno(id) on delete cascade,
  isla_id uuid references sjap_islas(id),
  dia_semana smallint check (dia_semana between 0 and 6),
  fecha date,
  created_at timestamptz not null default now(),
  check (not (dia_semana is not null and fecha is not null)),
  check (isla_id is not null or dia_semana is not null or fecha is not null)
);
comment on column sjap_esquema_reglas.dia_semana is '0 = domingo … 6 = sábado (misma convención que Date.getDay())';
create unique index sjap_esquema_reglas_un_alcance on sjap_esquema_reglas (
  estacion_id,
  coalesce(isla_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(dia_semana, -1),
  coalesce(fecha, '0001-01-01'::date)
);

alter table sjap_esquema_reglas enable row level security;
create policy sjap_esquema_reglas_scope on sjap_esquema_reglas for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- 3. Validación: dentro de un esquema los turnos activos no pueden cruzarse
--    (incluidos los que pasan la medianoche) ni durar cero. Se evalúa al
--    cerrar la transacción, sobre el estado final.
create or replace function sjap_validar_turno_tipo() returns trigger
language plpgsql as $$
declare
  t record; o record;
  a1 int; a2 int; b1 int; b2 int;
begin
  select * into t from sjap_turno_tipos where id = new.id;
  if not found then return null; end if;

  a1 := extract(hour from t.hora_inicio)::int * 60 + extract(minute from t.hora_inicio)::int;
  a2 := extract(hour from t.hora_fin)::int * 60 + extract(minute from t.hora_fin)::int;
  if a1 = a2 then
    raise exception 'El turno "%" empieza y termina a la misma hora (%).', t.nombre, to_char(t.hora_inicio, 'HH24:MI');
  end if;
  if not t.activo then return null; end if;
  if a2 < a1 then a2 := a2 + 1440; end if;

  for o in select * from sjap_turno_tipos where esquema_id = t.esquema_id and activo and id <> t.id loop
    b1 := extract(hour from o.hora_inicio)::int * 60 + extract(minute from o.hora_inicio)::int;
    b2 := extract(hour from o.hora_fin)::int * 60 + extract(minute from o.hora_fin)::int;
    if b2 <= b1 then b2 := b2 + 1440; end if;
    if (a1 < b2 and b1 < a2) or (a1 < b2 + 1440 and b1 + 1440 < a2) or (a1 + 1440 < b2 and b1 < a2 + 1440) then
      raise exception 'El turno "%" (%–%) se cruza con "%" (%–%) en el mismo esquema.',
        t.nombre, to_char(t.hora_inicio, 'HH24:MI'), to_char(t.hora_fin, 'HH24:MI'),
        o.nombre, to_char(o.hora_inicio, 'HH24:MI'), to_char(o.hora_fin, 'HH24:MI');
    end if;
  end loop;
  return null;
end $$;

create constraint trigger sjap_turno_tipos_validar
  after insert or update on sjap_turno_tipos
  deferrable initially deferred
  for each row execute function sjap_validar_turno_tipo();

-- 4. Guardar un esquema completo en una sola transacción. Corre con los
--    permisos del usuario (RLS aplica). Los turnos que se quitan del esquema se
--    borran si no tienen asignaciones; si tienen, se desactivan para no perder
--    historial.
create or replace function sjap_guardar_esquema_turnos(p_esquema_id uuid, p_turnos jsonb)
returns void
language plpgsql
set search_path = public
as $$
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
      and exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id);
  delete from sjap_turno_tipos
    where esquema_id = p_esquema_id and not (id = any(ids_conservados))
      and not exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id);
end $$;
