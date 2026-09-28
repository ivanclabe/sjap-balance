-- =============================================================================
-- SOLO DESARROLLO · Alta automática en SJAP de toda cuenta nueva de Supabase Auth
-- =============================================================================
-- Con esto, cualquier usuario creado en Authentication → Users (o registrado
-- por la API) obtiene al instante un perfil SJAP con rol "dependiente" en la
-- estación activa, y puede entrar a la app sin pasos adicionales.
--
-- NO aplicar en producción: el registro público de Supabase permitiría que
-- cualquiera con un correo entre a ver los datos de la estación. Por eso este
-- archivo no está en supabase/migrations ni en supabase/instalacion.
--
-- Excepciones:
--   * cuentas creadas desde la app (Configuración → Usuarios): traen
--     user_metadata.username y la función sjap-usuarios crea su propio perfil;
--   * cuentas que ya tienen perfil SJAP.
--
-- Para quitarlo:
--   drop trigger if exists sjap_dev_alta_automatica on auth.users;
--   drop function if exists public.sjap_dev_alta_automatica();
-- =============================================================================

create or replace function public.sjap_dev_alta_automatica()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estacion uuid;
  v_base text;
  v_username text;
  v_n int := 1;
begin
  if coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'username'
     or exists (select 1 from sjap_usuarios where auth_user_id = new.id) then
    return new;
  end if;

  select id into v_estacion from sjap_estaciones where activa order by created_at limit 1;
  if v_estacion is null then
    return new;
  end if;

  -- usuario = parte local del correo, con los caracteres que admite la app
  v_base := left(regexp_replace(lower(split_part(coalesce(new.email, 'usuario'), '@', 1)), '[^a-z0-9._-]', '', 'g'), 26);
  if length(v_base) < 3 then
    v_base := rpad(v_base, 3, '0');
  end if;
  v_username := v_base;
  while exists (select 1 from sjap_usuarios where username = v_username) loop
    v_n := v_n + 1;
    v_username := v_base || v_n::text;
  end loop;

  insert into sjap_usuarios (auth_user_id, estacion_id, username, nombre, rol)
  values (new.id, v_estacion, v_username,
          nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), ''),
          'dependiente');

  insert into sjap_auditoria (estacion_id, entidad, accion, nivel, detalle, created_by)
  values (v_estacion, 'usuario', 'alta_automatica_dev', 'info',
          jsonb_build_object('usuario', v_username, 'rol', 'dependiente'), 'sistema');
  return new;
end;
$$;

revoke execute on function public.sjap_dev_alta_automatica() from public, anon, authenticated;

drop trigger if exists sjap_dev_alta_automatica on auth.users;
create trigger sjap_dev_alta_automatica
  after insert on auth.users
  for each row execute function public.sjap_dev_alta_automatica();
