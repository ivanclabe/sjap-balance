import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';
import { useAuth } from './AuthContext.jsx';

const EstacionContext = createContext(null);

export function EstacionProvider({ children }) {
  const { estado, perfil } = useAuth();
  const [estaciones, setEstaciones] = useState([]);
  const [estacionId, setEstacionId] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Las estaciones se leen con la sesión del usuario (RLS), así que se cargan
  // cuando hay perfil — y se vuelven a cargar si cambia el usuario.
  const usuarioListo = estado === 'listo' ? perfil.id : null;

  useEffect(() => {
    if (!usuarioListo) {
      setEstaciones([]);
      setEstacionId(null);
      setCargando(true);
      return;
    }
    let activo = true;
    (async () => {
      const { data, error } = await supabase
        .from('sjap_estaciones')
        .select('id, nombre, ciudad, bandera')
        .eq('activa', true)
        .order('nombre');
      if (!activo) return;
      if (error) {
        setError(error.message);
      } else {
        setEstaciones(data || []);
        const propia = data?.find((e) => e.id === perfil.estacion_id);
        setEstacionId(propia?.id ?? data?.[0]?.id ?? null);
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioListo]);

  const estacion = estaciones.find((e) => e.id === estacionId) ?? null;

  return (
    <EstacionContext.Provider value={{ estaciones, estacionId, setEstacionId, estacion, cargando, error }}>
      {children}
    </EstacionContext.Provider>
  );
}

export function useEstacion() {
  const ctx = useContext(EstacionContext);
  if (!ctx) throw new Error('useEstacion debe usarse dentro de <EstacionProvider>');
  return ctx;
}
