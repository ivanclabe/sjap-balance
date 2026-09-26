import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client.js';
import { formatCOP, formatNumero, formatFecha } from '../../lib/format.js';
import FluctuacionChart from '../../components/FluctuacionChart.jsx';

export default function UreaTab({ estacionId, desde, hasta }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_urea_diario')
        .select('*')
        .eq('estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha');
      if (!activo) return;
      setFilas(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <>
      <div className="panel">
        <div className="panel__header">
          <h2>Diferencia diaria de inventario</h2>
          <span className="panel__hint">litros — hoja "Urea"</span>
        </div>
        <div className="subnote">
          Sesión del 10 sep 2026: esta hoja muestra las ventas a crédito (registradas por el sistema). Las ventas en
          efectivo el cliente las llena aparte, manual. El propio Javier no está seguro de que esta pestaña refleje
          bien esa separación — queda pendiente de confirmar con más detalle antes de automatizar este dato.
        </div>
        {filas.length < 2 ? (
          <div className="empty-state">No hay suficientes días para graficar.</div>
        ) : (
          <FluctuacionChart data={filas.map((f) => ({ fecha: f.fecha, diferencia: f.diferencia }))} series={[{ key: 'diferencia', label: 'Diferencia' }]} />
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Detalle diario</h2>
        </div>
        {filas.length === 0 ? (
          <div className="empty-state">Sin datos en este período.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th className="num">Inv. inicial</th>
                  <th className="num">Inv. final</th>
                  <th className="num">Diferencia</th>
                  <th className="num">Rumbo (L)</th>
                  <th className="num">Propios (L)</th>
                  <th className="num">Valor rumbo</th>
                  <th className="num">Valor propios</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fecha}>
                    <td className="mono">{formatFecha(f.fecha, { weekday: 'short' })}</td>
                    <td className="num">{formatNumero(f.inventario_inicial)}</td>
                    <td className="num">{formatNumero(f.inventario_final)}</td>
                    <td className="num">{formatNumero(f.diferencia)}</td>
                    <td className="num">{formatNumero(f.rumbo_litros)}</td>
                    <td className="num">{formatNumero(f.clientes_propios_litros)}</td>
                    <td className="num">{formatCOP(f.valor_rumbo)}</td>
                    <td className="num">{formatCOP(f.valor_propios)}</td>
                    <td className="num">{formatCOP(f.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
