-- Crea el perfil del PRIMER usuario master en un entorno nuevo.
--
-- Paso previo (no se puede hacer por SQL de forma segura):
--   Supabase Dashboard → Authentication → Users → "Add user" → "Create new user"
--     Email:    master@sjap.local      (la app convierte el usuario "master" en ese correo)
--     Password: <contraseña fuerte>
--     Marcar "Auto Confirm User".
--
-- Luego ejecuta este script en el SQL Editor. Los siguientes usuarios se crean
-- desde la app (Configuración → Usuarios), que usa la Edge Function
-- admin-crear-usuario.

insert into public.sjap_usuarios (auth_user_id, estacion_id, username, rol)
select u.id, '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'master', 'master'
from auth.users u
where u.email = 'master@sjap.local'
  and not exists (select 1 from public.sjap_usuarios s where s.auth_user_id = u.id);

-- Verificación: debe devolver una fila con rol = master.
select s.username, s.rol, u.email
from public.sjap_usuarios s
join auth.users u on u.id = s.auth_user_id
where s.username = 'master';
