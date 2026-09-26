import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';

// Usuario y rol de la sesión activa (sjap_usuarios) — para ocultar acciones de
// configuración a un usuario 'dependiente' en la UI (RLS ya lo bloquea en el
// servidor; esto solo evita mostrar un botón que de todas formas fallaría).
export function useUsuarioActual() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      const { data: sesion } = await supabase.auth.getSession();
      const authUserId = sesion?.session?.user?.id;
      if (!authUserId) {
        if (activo) setCargando(false);
        return;
      }
      const { data } = await supabase.from('sjap_usuarios').select('username, rol, estacion_id').eq('auth_user_id', authUserId).maybeSingle();
      if (!activo) return;
      setUsuario(data);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, []);

  return { usuario, esMaster: usuario?.rol === 'master', cargando };
}
