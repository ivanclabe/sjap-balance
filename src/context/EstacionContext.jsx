import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';

const EstacionContext = createContext(null);

export function EstacionProvider({ children }) {
  const [estaciones, setEstaciones] = useState([]);
  const [estacionId, setEstacionId] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
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
        setEstacionId((prev) => prev ?? data?.[0]?.id ?? null);
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, []);

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
