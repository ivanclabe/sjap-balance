import { useAuth } from '../context/AuthContext.jsx';

// Usuario y rol de la sesión activa (sjap_usuarios) — para ocultar acciones de
// configuración a un usuario 'dependiente' en la UI (RLS ya lo bloquea en el
// servidor; esto solo evita mostrar un botón que de todas formas fallaría).
// El perfil lo carga una sola vez AuthProvider.
export function useUsuarioActual() {
  const { perfil, esMaster, estado } = useAuth();
  return { usuario: perfil, esMaster, cargando: estado !== 'listo' };
}
