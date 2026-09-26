import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Fuel } from 'lucide-react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { useDiasFaltantes } from '../hooks/useDiasFaltantes.js';
import { supabase } from '../supabase/client.js';
import { formatCOP, formatNumero, formatFechaLarga, formatFecha } from '../lib/format.js';
import KpiCard from '../components/KpiCard.jsx';
import VentasChart from '../components/VentasChart.jsx';
import InfoTip from '../components/InfoTip.jsx';
import FreshnessBanner from '../components/FreshnessBanner.jsx';

const RANGOS = [
  { key: '7d', label: '7D', dias: 7 },
  { key: '1m', label: '1M', dias: 30 },
  { key: '3m', label: '3M', dias: 90 },
  { key: 'todo', label: 'TODO', dias: null },
];

export default function DashboardPage() {
  const { estacionId, estacion } = useEstacion();
  const [cierres, setCierres] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [rango, setRango] = useState('1m');
  const navigate = useNavigate();

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_cierre_diario')
        .select('fecha, venta_total, venta_galones_total, numero_clientes, diferencia_caja, estado')
        .eq('estacion_id', estacionId)
        .order('fecha', { ascending: false })
        .limit(180);
      if (!activo) return;
      setCierres((data || []).slice().reverse());
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId]);

  const rangoActivo = RANGOS.find((r) => r.key === rango) ?? RANGOS[1];
  const cierresRango = useMemo(() => {
    if (!rangoActivo.dias) return cierres;
    return cierres.slice(-rangoActivo.dias);
  }, [cierres, rangoActivo]);

  const diasFaltantes = useDiasFaltantes(estacionId);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  const ultimo = cierres[cierres.length - 1];
  const anterior = cierres[cierres.length - 2];
  const delta = ultimo && anterior ? ultimo.venta_total - anterior.venta_total : null;
  const deltaPct = delta != null && anterior?.venta_total ? (delta / anterior.venta_total) * 100 : null;
  const subio = delta != null && delta >= 0;

  const hoy = new Date().toISOString().slice(0, 10);
  const mesActual = hoy.slice(0, 7);
  const conAlertas = cierres.filter((c) => c.estado !== 'completo').length;

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>{estacion ? `${estacion.nombre}${estacion.ciudad ? ` · ${estacion.ciudad}` : ''}` : ''}</p>
      </div>

      <FreshnessBanner estacionId={estacionId} />

      {!ultimo ? (
        <div className="panel">
          <div className="empty-state">
            Aún no hay balances diarios cargados para esta estación.
            <div style={{ marginTop: 14 }}>
              <button className="btn btn--accent" onClick={() => navigate('/cargar')}>
                Cargar el primer balance diario
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <section className="ticker">
            <div className="ticker__side">
              <div className="ticker__instrument">
                <span className="ticker__badge">
                  <Fuel size={17} />
                </span>
                <div>
                  <div className="ticker__instrument-name">{estacion?.nombre ?? 'Estación'}</div>
                  <div className="ticker__instrument-sub">Cierre diario consolidado</div>
                </div>
              </div>

              <div>
                <div className="ticker__price">{formatCOP(ultimo.venta_total)}</div>
                <div className="ticker__delta-label" style={{ fontSize: 12.5, marginTop: 2, textTransform: 'capitalize' }}>
                  {formatFechaLarga(ultimo.fecha)}
                </div>
                {delta != null && (
                  <div className={`ticker__delta ${subio ? 'ticker__delta--up' : 'ticker__delta--down'}`} style={{ marginTop: 6 }}>
                    {subio ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                    {subio ? '+' : ''}
                    {formatCOP(delta)} ({subio ? '+' : ''}
                    {formatNumero(deltaPct, 1)}%)
                    <span className="ticker__delta-label">vs. día anterior</span>
                  </div>
                )}
              </div>

              <button className="cta-buy" onClick={() => navigate('/cargar')}>
                + Cargar balance diario
              </button>

              <div className="ticker__stats">
                <div className="ticker__stat">
                  <span className="ticker__stat-label">Cierre anterior</span>
                  <span className="ticker__stat-value">{anterior ? formatCOP(anterior.venta_total) : '—'}</span>
                </div>
                <div className="ticker__stat">
                  <span className="ticker__stat-label">Galones del día</span>
                  <span className="ticker__stat-value">{formatNumero(ultimo.venta_galones_total)}</span>
                </div>
                <div className="ticker__stat">
                  <span className="ticker__stat-label"># Clientes</span>
                  <span className="ticker__stat-value">{ultimo.numero_clientes ?? '—'}</span>
                </div>
                <div className="ticker__stat">
                  <span className="ticker__stat-label">
                    Diferencia de caja
                    <InfoTip>Efectivo calculado menos efectivo real contado. Positivo: sobró. Negativo: faltó.</InfoTip>
                  </span>
                  <span className="ticker__stat-value">
                    {ultimo.diferencia_caja != null ? formatCOP(ultimo.diferencia_caja) : 'pendiente'}
                  </span>
                </div>
              </div>
            </div>

            <div className="ticker__chart">
              <div className="chart-toolbar">
                <span className="panel__hint">VENTA DIARIA</span>
                <div className="chart-toolbar__group">
                  {RANGOS.map((r) => (
                    <button
                      key={r.key}
                      className={`chart-toolbar__btn ${rango === r.key ? 'active' : ''}`}
                      onClick={() => setRango(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {cierresRango.length < 2 ? (
                <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  Carga más días para ver la tendencia.
                </div>
              ) : (
                <VentasChart cierres={cierresRango} onPointClick={(fecha) => navigate(`/diarios/${fecha}`)} />
              )}
            </div>
          </section>

          <section className="grid-4" style={{ marginTop: 16 }}>
            <KpiCard
              label="VENTA DEL MES"
              value={formatCOP(cierres.filter((c) => c.fecha.startsWith(mesActual)).reduce((s, c) => s + Number(c.venta_total || 0), 0))}
              sublabel={`${cierres.filter((c) => c.fecha.startsWith(mesActual)).length} día(s) cargado(s)`}
            />
            <KpiCard label="DÍAS EN EL SISTEMA" value={cierres.length} sublabel="balances diarios cargados" />
            <KpiCard
              label="CON INSUMOS PENDIENTES"
              value={conAlertas}
              sublabel="inventario / efectivo real sin capturar"
              tone={conAlertas > 0 ? 'danger' : 'good'}
              info="Días cuyo cierre se calculó con el archivo, pero aún les falta la lectura de tanque, las facturas de compra o el efectivo real contado."
            />
            <KpiCard
              label="SIN CARGAR"
              value={diasFaltantes.length}
              sublabel={diasFaltantes.length > 0 ? 'clic para ver cuáles' : 'al día'}
              tone={diasFaltantes.length > 0 ? 'danger' : 'good'}
              info="Días que nunca tuvieron un archivo de cierre subido al sistema — distinto de insumos pendientes. Revísalos en Cargar."
              onClick={() => navigate('/cargar')}
            />
          </section>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel__header">
              <h2>Últimos cierres</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="num">Venta total</th>
                    <th className="num">Galones</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cierres
                    .slice()
                    .reverse()
                    .slice(0, 10)
                    .map((c) => (
                      <tr key={c.fecha} className="clickable" onClick={() => navigate(`/diarios/${c.fecha}`)}>
                        <td className="mono">{formatFecha(c.fecha, { weekday: 'short' })}</td>
                        <td className="num">{formatCOP(c.venta_total)}</td>
                        <td className="num">{formatNumero(c.venta_galones_total)}</td>
                        <td>
                          <span className={`badge badge--${c.estado === 'completo' ? 'good' : 'accent'}`}>
                            {c.estado === 'completo' ? 'OK' : 'Insumos pendientes'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
