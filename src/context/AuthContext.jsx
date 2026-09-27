import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase/client.js';

// Sesión de Supabase Auth + perfil SJAP (sjap_usuarios) en un solo lugar.
// Una cuenta de Auth sin perfil activo NO entra a la app: el proyecto de
// Supabase permite registros públicos (lo usan otras apps), así que tener
// sesión no basta para ser usuario de SJAP.
const AuthContext = createContext(null);

const SIN_ACCESO = 'Tu usuario no tiene acceso a SJAP Balance. Habla con el administrador de la estación.';

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(undefined); // undefined = verificando
  const [perfil, setPerfil] = useState(null);
  const [estadoPerfil, setEstadoPerfil] = useState('inactivo'); // inactivo | cargando | listo | error
  const [aviso, setAviso] = useState(null); // motivo que ve la pantalla de ingreso
  const cierreIntencional = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((evento, session) => {
      setSesion(session ?? null);
      if (evento === 'SIGNED_OUT') {
        // Si no la cerró el usuario (token vencido, usuario desactivado,
        // sesión cerrada en otro equipo) se le explica al volver al ingreso.
        if (!cierreIntencional.current) setAviso((prev) => prev ?? 'Tu sesión terminó. Vuelve a iniciar sesión.');
        cierreIntencional.current = false;
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const cerrarSesion = useCallback(async (motivo = null) => {
    cierreIntencional.current = true;
    setAviso(motivo);
    setPerfil(null);
    // scope local: cierra solo este equipo, no las sesiones del usuario en otros.
    await supabase.auth.signOut({ scope: 'local' });
  }, []);

  const userId = sesion?.user?.id ?? null;

  const cargarPerfil = useCallback(async () => {
    if (!userId) return;
    // Al recargar un perfil ya cargado (p. ej. tras cambiar la contraseña) no se
    // vuelve a "cargando", para no desmontar la app.
    setEstadoPerfil((prev) => (prev === 'listo' ? 'listo' : 'cargando'));
    const { data, error } = await supabase
      .from('sjap_usuarios')
      .select('id, username, nombre, rol, estacion_id, activo, debe_cambiar_password')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (error) {
      setEstadoPerfil('error');
      return;
    }
    // Un usuario desactivado tampoco obtiene fila: la RLS ya no le devuelve nada.
    if (!data || !data.activo) {
      setEstadoPerfil('inactivo');
      await cerrarSesion(SIN_ACCESO);
      return;
    }
    setPerfil(data);
    setEstadoPerfil('listo');
  }, [userId, cerrarSesion]);

  useEffect(() => {
    if (!userId) {
      setPerfil(null);
      setEstadoPerfil('inactivo');
      return;
    }
    cargarPerfil();
  }, [userId, cargarPerfil]);

  let estado;
  if (sesion === undefined) estado = 'verificando';
  else if (!sesion) estado = 'anonimo';
  else if (estadoPerfil === 'error') estado = 'error';
  else if (estadoPerfil !== 'listo' || !perfil) estado = 'cargando';
  else estado = 'listo';

  const valor = {
    estado,
    sesion,
    perfil,
    esMaster: perfil?.rol === 'master',
    aviso,
    limpiarAviso: () => setAviso(null),
    cerrarSesion,
    recargarPerfil: cargarPerfil,
  };

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
