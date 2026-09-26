create table if not exists sjap_turno_tipos (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  hora_inicio time not null,
  hora_fin time not null,
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

create table if not exists sjap_ausencias (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  promotor_id uuid not null references sjap_promotores(id),
  fecha_desde date not null,
  fecha_hasta date not null,
  tipo text not null check (tipo in ('vacaciones','incapacidad','permiso','ausencia','dia_libre')),
  nota text,
  created_at timestamptz not null default now(),
  check (fecha_hasta >= fecha_desde)
);

create table if not exists sjap_turnos_programados (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  fecha date not null,
  promotor_id uuid not null references sjap_promotores(id),
  isla_id uuid not null references sjap_islas(id),
  turno_tipo_id uuid not null references sjap_turno_tipos(id),
  estado text not null default 'programado' check (estado in ('programado','ausente','reemplazado')),
  created_at timestamptz not null default now()
);

create index if not exists idx_sjap_turnos_programados_fecha on sjap_turnos_programados (estacion_id, fecha);
create index if not exists idx_sjap_ausencias_rango on sjap_ausencias (estacion_id, promotor_id, fecha_desde, fecha_hasta);

alter table sjap_turno_tipos enable row level security;
alter table sjap_ausencias enable row level security;
alter table sjap_turnos_programados enable row level security;

create policy sjap_turno_tipos_authenticated_all on sjap_turno_tipos for all to authenticated using (true) with check (true);
create policy sjap_turno_tipos_anon_poc on sjap_turno_tipos for all to anon using (true) with check (true);

create policy sjap_ausencias_authenticated_all on sjap_ausencias for all to authenticated using (true) with check (true);
create policy sjap_ausencias_anon_poc on sjap_ausencias for all to anon using (true) with check (true);

create policy sjap_turnos_programados_authenticated_all on sjap_turnos_programados for all to authenticated using (true) with check (true);
create policy sjap_turnos_programados_anon_poc on sjap_turnos_programados for all to anon using (true) with check (true);

insert into sjap_turno_tipos (estacion_id, nombre, hora_inicio, hora_fin, orden)
select '884b3769-2c20-4a0b-8019-6972bf5e4caa', v.nombre, v.hora_inicio::time, v.hora_fin::time, v.orden
from (values
  ('T1','06:00','12:00',1),
  ('T2','12:00','18:00',2),
  ('T3','18:00','23:59',3),
  ('T4','00:00','06:00',4)
) as v(nombre, hora_inicio, hora_fin, orden)
on conflict (estacion_id, nombre) do nothing;
