import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/client.js';
import { formatCOP } from '../../lib/format.js';

export default function RankingClientesTab({ estacionId, desde, hasta }) {
  const [ranking, setRanking] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_movimientos_cuenta_cliente')
        .select('monto, tipo, fecha, sjap_cuentas_cliente!inner(nombre, estacion_id)')
        .eq('sjap_cuentas_cliente.estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (!activo) return;
      const porCuenta = {};
      for (const m of data || []) {
        const nombre = m.sjap_cuentas_cliente.nombre;
        porCuenta[nombre] = porCuenta[nombre] || { nombre, combustible: 0, urea: 0, lubricantes: 0, total: 0, movimientos: 0 };
        const clave = m.tipo === 'UREA' ? 'urea' : m.tipo === 'LUBRICANTES' ? 'lubricantes' : 'combustible';
        porCuenta[nombre][clave] += Number(m.monto || 0);
        porCuenta[nombre].total += Number(m.monto || 0);
        porCuenta[nombre].movimientos += 1;
      }
      setRanking(Object.values(porCuenta).sort((a, b) => b.total - a.total));
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  const max = Math.max(1, ...ranking.map((r) => r.total));

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Clientes propios — movimientos del mes</h2>
        <span className="panel__hint">{ranking.length} cuenta(s) con actividad</span>
      </div>
      <div className="subnote">
        Confirmado con el cliente (sesión del 10 sep 2026): "QR" es un canal de pago en efectivo, no un cliente
        corporativo — se mantiene junto a los clientes propios porque así está estructurado en el Excel de origen y
        porque hoy se registra igual, día a día, en la misma hoja "Ventas efectivo". Ya se puede capturar directo en
        la app desde el detalle de cada día (pestaña "Ventas efectivo / QR").
      </div>
      {ranking.length === 0 ? (
        <div className="empty-state">Sin movimientos en este período.</div>
      ) : (
        <div className="rank-list">
          {ranking.map((r, i) => (
            <div className="rank-row" key={r.nombre}>
              <span className="rank-row__pos">{String(i + 1).padStart(2, '0')}</span>
              <div className="rank-row__body">
                <div className="rank-row__top">
                  <span className="rank-row__name">{r.nombre}</span>
                  <span className="rank-row__value">{formatCOP(r.total)}</span>
                </div>
                <div className="rank-bar">
                  <div className="rank-bar__fill" style={{ width: `${(r.total / max) * 100}%` }} />
                </div>
                <div className="rank-row__meta">
                  {r.movimientos} movimiento(s)
                  {r.urea > 0 ? ` · urea ${formatCOP(r.urea)}` : ''}
                  {r.lubricantes > 0 ? ` · lubricantes ${formatCOP(r.lubricantes)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
