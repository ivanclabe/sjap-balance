import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEstacion } from '../context/EstacionContext.jsx';
import { supabase } from '../supabase/client.js';
import { formatCOP, formatNumero, formatFecha } from '../lib/format.js';

const ESTADO_LABEL = { completo: 'OK', pendiente_insumos: 'Insumos pendientes', con_alertas: 'Con alertas' };
const ESTADO_TONE = { completo: 'good', pendiente_insumos: 'accent', con_alertas: 'danger' };

export default function DailyBalancesListPage() {
  const { estacionId } = useEstacion();
  const [cierres, setCierres] = useState([]);
  const [cargando, setCargando] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_cierre_diario')
        .select('fecha, venta_total, venta_galones_total, estado, numero_clientes')
        .eq('estacion_id', estacionId)
        .order('fecha', { ascending: false });
      if (!activo) return;
      setCierres(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId]);

  return (
    <>
      <div className="page-header">
        <h1>Balances diarios</h1>
        <p>Un registro por día — el "cierre único" que reemplaza los Excel manuales.</p>
      </div>

      <div className="panel">
        {cargando ? (
          <div className="empty-state">Cargando…</div>
        ) : cierres.length === 0 ? (
          <div className="empty-state">No hay balances diarios cargados todavía.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="num">Venta total</th>
                  <th className="num">Galones</th>
                  <th className="num"># Clientes</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.fecha} className="clickable" onClick={() => navigate(`/diarios/${c.fecha}`)}>
                    <td className="mono">{formatFecha(c.fecha, { weekday: 'short', year: 'numeric' })}</td>
                    <td className="num mono">{formatCOP(c.venta_total)}</td>
                    <td className="num mono">{formatNumero(c.venta_galones_total)}</td>
                    <td className="num mono">{c.numero_clientes ?? '—'}</td>
                    <td>
                      <span className={`badge badge--${ESTADO_TONE[c.estado] ?? 'muted'}`}>
                        {ESTADO_LABEL[c.estado] ?? c.estado}
                      </span>
                    </td>
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
