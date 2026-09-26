import { AlertTriangle, AlertCircle } from 'lucide-react';
import { useFreshness, esPeriodoActualOFuturo } from '../hooks/useFreshness.js';

/**
 * Alerta de actualidad de datos — solo se renderiza cuando es relevante:
 * - nivel 'ok' o 'sin_datos' con cargando: no muestra nada (no saturar la UI).
 * - Si recibe `anio`/`mes` (páginas con selector de periodo), solo se muestra
 *   cuando el periodo consultado es el actual o futuro — consultar un mes
 *   histórico a propósito nunca dispara esta alerta.
 */
export default function FreshnessBanner({ estacionId, anio, mes }) {
  const { cargando, nivel, mensaje } = useFreshness(estacionId);

  if (cargando || nivel === 'ok') return null;
  if (anio != null && mes != null && !esPeriodoActualOFuturo(anio, mes)) return null;

  const Icono = nivel === 'critico' ? AlertCircle : AlertTriangle;
  const tono = nivel === 'critico' ? 'danger' : 'warning';

  return (
    <div className={`alert alert--${tono}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icono size={16} style={{ flex: 'none', marginTop: 1 }} />
      <span>{mensaje}</span>
    </div>
  );
}
