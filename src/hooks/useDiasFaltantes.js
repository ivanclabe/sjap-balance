import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase/client.js';

// Días entre el primer cierre cargado y ayer que no tienen ningún balance
// diario en sjap_cierre_diario — archivo nunca subido, no insumos pendientes.
export function useDiasFaltantes(estacionId) {
  const [fechas, setFechas] = useState([]);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    (async () => {
      const { data } = await supabase
        .from('sjap_cierre_diario')
        .select('fecha')
        .eq('estacion_id', estacionId)
        .order('fecha');
      if (!activo) return;
      setFechas((data || []).map((c) => c.fecha));
    })();
    return () => {
      activo = false;
    };
  }, [estacionId]);

  return useMemo(() => {
    if (fechas.length === 0) return [];
    const cargados = new Set(fechas);
    const cursor = new Date(`${fechas[0]}T00:00:00`);
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    ayer.setHours(0, 0, 0, 0);
    const faltantes = [];
    while (cursor <= ayer) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const iso = `${y}-${m}-${d}`;
      if (!cargados.has(iso)) faltantes.push(iso);
      cursor.setDate(cursor.getDate() + 1);
    }
    return faltantes.reverse();
  }, [fechas]);
}
