import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client.js';
import { formatCOP, formatNumero, formatFecha } from '../../lib/format.js';
import { useEstacionConfig } from '../../hooks/useEstacionConfig.js';
import FluctuacionChart from '../../components/FluctuacionChart.jsx';
import InfoTip from '../../components/InfoTip.jsx';

export default function InventarioTab({ estacionId, desde, hasta }) {
  const { config } = useEstacionConfig(estacionId);
  const [productos, setProductos] = useState([]);
  const [productoId, setProductoId] = useState(null);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    (async () => {
      const { data } = await supabase
        .from('sjap_productos')
        .select('id, nombre_visible, orden')
        .eq('estacion_id', estacionId)
        .order('orden');
      setProductos(data || []);
      setProductoId((prev) => prev ?? data?.[0]?.id ?? null);
    })();
  }, [estacionId]);

  useEffect(() => {
    if (!estacionId || !productoId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_balance_diario_producto')
        .select('fecha, inventario_inicial, ventas_galones, recibos_galones, inventario_teorico, inventario_final_real, fluctuacion_dia, fluctuacion_acumulada, fluctuacion_valor, estado')
        .eq('estacion_id', estacionId)
        .eq('producto_id', productoId)
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
  }, [estacionId, productoId, desde, hasta]);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <select className="select" value={productoId ?? ''} onChange={(e) => setProductoId(e.target.value)}>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre_visible}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2>Fluctuación acumulada</h2>
          <span className="panel__hint">galones — espeja G. Corriente / Bioacem / G. Extra</span>
        </div>
        {filas.length < 2 ? (
          <div className="empty-state">No hay suficientes días para graficar.</div>
        ) : (
          <FluctuacionChart data={filas} series={[{ key: 'fluctuacion_acumulada', label: 'Fluctuación acumulada' }]} />
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Detalle diario</h2>
        </div>
        {cargando ? (
          <div className="empty-state">Cargando…</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th className="num">Inv. inicial</th>
                  <th className="num">Ventas</th>
                  <th className="num">Recibos</th>
                  <th className="num">Inv. teórico</th>
                  <th className="num">Inv. final</th>
                  <th className="num">
                    Fluc. día
                    <InfoTip side="left">Inventario real menos teórico ese día.</InfoTip>
                  </th>
                  <th className="num">Fluc. acum</th>
                  <th className="num">Fluc. $</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fecha}>
                    <td className="mono">{formatFecha(f.fecha, { weekday: 'short' })}</td>
                    <td className="num">{formatNumero(f.inventario_inicial)}</td>
                    <td className="num">{formatNumero(f.ventas_galones)}</td>
                    <td className="num">{formatNumero(f.recibos_galones)}</td>
                    <td className="num">{formatNumero(f.inventario_teorico)}</td>
                    <td className="num">{formatNumero(f.inventario_final_real)}</td>
                    <td className={`num ${Math.abs(f.fluctuacion_dia || 0) > config.umbral_fluctuacion_galones ? 'text-danger' : ''}`}>{formatNumero(f.fluctuacion_dia)}</td>
                    <td className="num">{formatNumero(f.fluctuacion_acumulada)}</td>
                    <td className="num">{formatCOP(f.fluctuacion_valor)}</td>
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
