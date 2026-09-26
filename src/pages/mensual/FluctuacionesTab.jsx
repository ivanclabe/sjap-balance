import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client.js';
import { formatNumero, formatFecha } from '../../lib/format.js';
import { useEstacionConfig } from '../../hooks/useEstacionConfig.js';
import FluctuacionChart from '../../components/FluctuacionChart.jsx';

export default function FluctuacionesTab({ estacionId, desde, hasta }) {
  const { config } = useEstacionConfig(estacionId);
  const [productos, setProductos] = useState([]);
  const [porFecha, setPorFecha] = useState({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data: prods } = await supabase
        .from('sjap_productos')
        .select('id, codigo, nombre_visible, orden')
        .eq('estacion_id', estacionId)
        .order('orden');

      const { data: filas } = await supabase
        .from('sjap_balance_diario_producto')
        .select('fecha, producto_id, fluctuacion_dia, fluctuacion_acumulada')
        .eq('estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha');

      if (!activo) return;
      setProductos(prods || []);
      const map = {};
      for (const f of filas || []) {
        if (!map[f.fecha]) map[f.fecha] = { fecha: f.fecha };
        map[f.fecha][`acum_${f.producto_id}`] = f.fluctuacion_acumulada;
        map[f.fecha][`dia_${f.producto_id}`] = f.fluctuacion_dia;
      }
      setPorFecha(map);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  const data = Object.values(porFecha).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const series = productos.map((p) => ({ key: `acum_${p.id}`, label: p.nombre_visible }));

  return (
    <>
      <div className="panel">
        <div className="panel__header">
          <h2>Fluctuación acumulada por producto</h2>
          <span className="panel__hint">galones — hoja "Fluctuaciones"</span>
        </div>
        {cargando ? (
          <div className="empty-state">Cargando…</div>
        ) : data.length < 2 ? (
          <div className="empty-state">No hay suficientes días para graficar.</div>
        ) : (
          <FluctuacionChart data={data} series={series} />
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Detalle por día</h2>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                {productos.map((p) => (
                  <th className="num" key={p.id}>
                    {p.nombre_visible}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.fecha}>
                  <td className="mono">{formatFecha(row.fecha, { weekday: 'short' })}</td>
                  {productos.map((p) => {
                    const v = row[`dia_${p.id}`];
                    return (
                      <td className={`num ${Math.abs(v || 0) > config.umbral_fluctuacion_galones ? 'text-danger' : ''}`} key={p.id}>
                        {formatNumero(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
