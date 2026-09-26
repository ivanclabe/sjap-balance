import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase/client.js';
import { formatCOP, formatNumero } from '../../lib/format.js';
import KpiCard from '../../components/KpiCard.jsx';

const CATEGORIAS = ['CANASTILLA', 'KIOSCO', 'CDL', 'COMPLEMENTARIOS'];
const LABEL_CATEGORIA = { CANASTILLA: 'Canastilla', KIOSCO: 'Kiosco', CDL: 'CDL', COMPLEMENTARIOS: 'Complementarios' };

// Estas 4 categorías ya llegan del archivo diario del POS y se guardan en
// sjap_transacciones desde el primer día de la app — nunca se habían mostrado
// en ningún reporte ni en el dashboard.
export default function VentasTiendaTab({ estacionId, desde, hasta }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_transacciones')
        .select('categoria, producto_nombre, cantidad, total')
        .eq('estacion_id', estacionId)
        .in('categoria', CATEGORIAS)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (!activo) return;
      setFilas(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  const porCategoria = useMemo(() => {
    const acc = Object.fromEntries(CATEGORIAS.map((c) => [c, { total: 0, transacciones: 0 }]));
    for (const f of filas) {
      if (!acc[f.categoria]) continue;
      acc[f.categoria].total += Number(f.total || 0);
      acc[f.categoria].transacciones += 1;
    }
    return acc;
  }, [filas]);

  const rankingProductos = useMemo(() => {
    const acc = {};
    for (const f of filas) {
      const clave = `${f.categoria}__${f.producto_nombre}`;
      acc[clave] = acc[clave] || { categoria: f.categoria, producto: f.producto_nombre, total: 0, cantidad: 0 };
      acc[clave].total += Number(f.total || 0);
      acc[clave].cantidad += Number(f.cantidad || 0);
    }
    return Object.values(acc).sort((a, b) => b.total - a.total).slice(0, 25);
  }, [filas]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  const totalGeneral = Object.values(porCategoria).reduce((s, c) => s + c.total, 0);

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        {CATEGORIAS.map((c) => (
          <KpiCard key={c} label={LABEL_CATEGORIA[c].toUpperCase()} value={formatCOP(porCategoria[c].total)} sublabel={`${porCategoria[c].transacciones} transacción(es)`} />
        ))}
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2>Ventas de tienda — detalle por producto</h2>
          <span className="panel__hint">canastilla, kiosco, CDL y complementarios · {formatCOP(totalGeneral)} en el mes</span>
        </div>
        <div className="subnote">
          Este dato ya se captura desde el archivo diario del POS junto con las ventas de combustible — no requiere
          ningún cambio en el proceso de carga, solo no se estaba mostrando en ningún reporte hasta ahora.
        </div>
        {rankingProductos.length === 0 ? (
          <div className="empty-state">Sin ventas de tienda en este período.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rankingProductos.map((r) => (
                  <tr key={`${r.categoria}__${r.producto}`}>
                    <td>
                      <span className="badge badge--muted">{LABEL_CATEGORIA[r.categoria]}</span>
                    </td>
                    <td>{r.producto}</td>
                    <td className="num">{formatNumero(r.cantidad)}</td>
                    <td className="num">{formatCOP(r.total)}</td>
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
