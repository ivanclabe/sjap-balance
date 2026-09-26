import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';

// El cierre más reciente de la estación activa — usado en la barra superior
// (estado + venta) y como semilla del dashboard.
export function useUltimoCierre(estacionId) {
  const [cierre, setCierre] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_cierre_diario')
        .select('*')
        .eq('estacion_id', estacionId)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!activo) return;
      setCierre(data);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId]);

  return { cierre, cargando };
}
