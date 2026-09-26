-- =============================================================================
-- SJAP Balance · Script 02 de 03 · ACTIVAR EL USUARIO MASTER
-- =============================================================================
-- ANTES de ejecutar este script, crea el usuario en la pantalla de Supabase:
--   Authentication → Users → Add user → Create new user
--     Email:    master@sjap.local
--     Password: la contraseña que usará el administrador de la app
--     Marca la casilla "Auto Confirm User"
--
-- Luego: SQL Editor → New query → pega este archivo → Run.
-- Resultado esperado: una fila que dice  master | master | master@sjap.local
-- Si no aparece ninguna fila, el usuario del paso anterior no existe o el
-- correo quedó mal escrito.
-- =============================================================================

insert into public.sjap_usuarios (auth_user_id, estacion_id, username, rol)
select u.id, '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'master', 'master'
from auth.users u
where u.email = 'master@sjap.local'
  and not exists (select 1 from public.sjap_usuarios s where s.auth_user_id = u.id);

select s.username as usuario, s.rol, u.email
from public.sjap_usuarios s
join auth.users u on u.id = s.auth_user_id
where s.username = 'master';
