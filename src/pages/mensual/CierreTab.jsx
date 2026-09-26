import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import { formatCOP, formatFecha } from '../../lib/format.js';
import { exportarExcel } from '../../lib/export-excel.js';
import { useEstacionConfig } from '../../hooks/useEstacionConfig.js';

export default function CierreTab({ estacionId, desde, hasta }) {
  const { config } = useEstacionConfig(estacionId);
  const [cierres, setCierres] = useState([]);
  const [medios, setMedios] = useState({});
  const [mediosOrden, setMediosOrden] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const [{ data: c }, { data: m }, { data: catalogo }] = await Promise.all([
        supabase
          .from('sjap_cierre_diario')
          .select('fecha, venta_total, venta_galones_total, numero_clientes, efectivo_calculado, efectivo_real, diferencia_caja, diferencia_caja_acumulada, certificacion_bancaria')
          .eq('estacion_id', estacionId)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha'),
        supabase
          .from('sjap_ventas_medio_pago')
          .select('fecha, medio_pago, total_ventas')
          .eq('estacion_id', estacionId)
          .gte('fecha', desde)
          .lte('fecha', hasta),
        supabase.from('sjap_medios_pago').select('nombre').eq('estacion_id', estacionId).eq('activo', true).order('orden'),
      ]);
      if (!activo) return;
      setCierres(c || []);
      const map = {};
      for (const row of m || []) {
        map[row.fecha] = map[row.fecha] || {};
        map[row.fecha][row.medio_pago] = row.total_ventas;
      }
      setMedios(map);
      setMediosOrden((catalogo || []).map((r) => r.nombre));
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  function descargar() {
    exportarExcel(
      `cierre_${desde}_a_${hasta}.xlsx`,
      cierres.map((c) => ({
        Día: c.fecha,
        'Venta total': c.venta_total,
        Galones: c.venta_galones_total,
        '# Clientes': c.numero_clientes,
        'Efectivo calc.': c.efectivo_calculado,
        'Efectivo real': c.efectivo_real,
        Diferencia: c.diferencia_caja,
        'Dif. acumulada': c.diferencia_caja_acumulada,
        Certificación: c.certificacion_bancaria,
        ...Object.fromEntries(mediosOrden.map((m) => [m, medios[c.fecha]?.[m] ?? null])),
      })),
      'Cierre',
    );
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Cierre — detalle completo</h2>
        <span className="panel__hint">todas las columnas de la hoja "Cierre"</span>
        {cierres.length > 0 && (
          <button className="btn" onClick={descargar}>
            <Download size={14} /> Descargar Excel
          </button>
        )}
      </div>
      {cierres.length === 0 ? (
        <div className="empty-state">No hay datos en este período.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th className="num">Venta total</th>
                <th className="num">Galones</th>
                <th className="num"># Clientes</th>
                <th className="num">Efectivo calc.</th>
                <th className="num">Efectivo real</th>
                <th className="num">Diferencia</th>
                <th className="num">Dif. acum.</th>
                <th className="num">Certificación</th>
                {mediosOrden.map((m) => (
                  <th className="num" key={m}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cierres.map((c) => (
                <tr key={c.fecha}>
                  <td className="mono">
                    <Link to={`/diarios/${c.fecha}`}>{formatFecha(c.fecha, { weekday: 'short' })}</Link>
                  </td>
                  <td className="num">{formatCOP(c.venta_total)}</td>
                  <td className="num">{c.venta_galones_total}</td>
                  <td className="num">{c.numero_clientes ?? '—'}</td>
                  <td className="num">{formatCOP(c.efectivo_calculado)}</td>
                  <td className="num">{formatCOP(c.efectivo_real)}</td>
                  <td className={`num ${c.diferencia_caja != null && Math.abs(c.diferencia_caja) > config.umbral_diferencia_caja_cop ? 'text-danger' : ''}`}>
                    {formatCOP(c.diferencia_caja)}
                  </td>
                  <td className="num">{formatCOP(c.diferencia_caja_acumulada)}</td>
                  <td className="num">{c.certificacion_bancaria != null ? formatCOP(c.certificacion_bancaria) : '—'}</td>
                  {mediosOrden.map((m) => (
                    <td className="num" key={m}>
                      {medios[c.fecha]?.[m] != null ? formatCOP(medios[c.fecha][m]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
