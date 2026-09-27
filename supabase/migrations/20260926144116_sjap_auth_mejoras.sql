-- Mejoras de autenticación y gestión de usuarios (2026-09-26).
--
-- 1. sjap_usuarios gana estado (activo), nombre visible y la marca
--    debe_cambiar_password (contraseña temporal asignada por un master).
-- 2. Un usuario desactivado deja de ver datos de inmediato: las funciones que
--    usan todas las políticas RLS solo reconocen usuarios activos. Además la
--    Edge Function sjap-usuarios lo bloquea en Supabase Auth (ban).
-- 3. Una estación nunca puede quedarse sin un master activo.
-- 4. Parámetro de cierre de sesión por inactividad.
-- 5. Endurecimiento señalado por los advisors de Supabase: las funciones de
--    rol/estación ya no se pueden ejecutar sin sesión, y el trigger de turnos
--    fija su search_path.

alter table public.sjap_usuarios
  add column if not exists activo boolean not null default true,
  add column if not exists nombre text,
  add column if not exists debe_cambiar_password boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.sjap_usuarios.activo is 'false = usuario desactivado: no inicia sesión (ban en Auth) y las políticas RLS no le devuelven datos.';
comment on column public.sjap_usuarios.debe_cambiar_password is 'true cuando un master asignó una contraseña temporal: la app obliga a cambiarla al entrar.';

-- Solo usuarios ACTIVOS obtienen estación/rol → todas las políticas existentes
-- quedan cerradas para un usuario desactivado sin tener que tocarlas una a una.
create or replace function public.sjap_estacion_de_usuario()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select estacion_id from public.sjap_usuarios where auth_user_id = auth.uid() and activo limit 1;
$$;

create or replace function public.sjap_rol_de_usuario()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.sjap_usuarios where auth_user_id = auth.uid() and activo limit 1;
$$;

revoke execute on function public.sjap_estacion_de_usuario() from public, anon;
revoke execute on function public.sjap_rol_de_usuario() from public, anon;
grant execute on function public.sjap_estacion_de_usuario() to authenticated, service_role;
grant execute on function public.sjap_rol_de_usuario() to authenticated, service_role;

alter function public.sjap_validar_turno_tipo() set search_path = public;

-- Nunca dejar una estación sin master activo (por cambio de rol, desactivación
-- o eliminación), venga el cambio de la app, del SQL Editor o de la API.
create or replace function public.sjap_proteger_ultimo_master()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.rol = 'master' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'master' or not new.activo) then
    if not exists (
      select 1 from public.sjap_usuarios
      where estacion_id = old.estacion_id and rol = 'master' and activo and id <> old.id
    ) then
      raise exception 'La estación debe conservar al menos un usuario master activo.'
        using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sjap_usuarios_proteger_master on public.sjap_usuarios;
create trigger sjap_usuarios_proteger_master
  before update or delete on public.sjap_usuarios
  for each row execute function public.sjap_proteger_ultimo_master();

-- Minutos sin actividad antes de cerrar la sesión (equipos compartidos).
insert into public.sjap_estacion_config (estacion_id, clave, valor, descripcion)
select id, 'sesion_inactividad_minutos', '30', 'Minutos sin actividad antes de cerrar la sesión automáticamente (0 = nunca)'
from public.sjap_estaciones
on conflict (estacion_id, clave) do nothing;
