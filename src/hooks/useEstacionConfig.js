import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';

const DEFAULTS = {
  umbral_fluctuacion_galones: 100,
  umbral_diferencia_caja_cop: 5000,
  umbral_sicom_galones: 50,
  corte_cumplimiento_presupuesto: 1,
  data_freshness_warning_days: 3,
  data_freshness_critical_days: 7,
};

// Umbrales de negocio de la estación (sjap_estacion_config) en vez de literales
// dispersos en cada componente. Si una clave no está sembrada todavía, cae al
// default documentado aquí — nunca revienta un cálculo por falta de config.
export function useEstacionConfig(estacionId) {
  const [config, setConfig] = useState(DEFAULTS);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase.from('sjap_estacion_config').select('clave, valor').eq('estacion_id', estacionId);
      if (!activo) return;
      const porClave = { ...DEFAULTS };
      for (const fila of data || []) porClave[fila.clave] = Number(fila.valor);
      setConfig(porClave);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId]);

  return { config, cargando };
}
