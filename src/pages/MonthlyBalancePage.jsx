import { useEffect, useState } from 'react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { supabase } from '../supabase/client.js';
import { nombreMes } from '../lib/format.js';
import FreshnessBanner from '../components/FreshnessBanner.jsx';
import ResumenTab from './mensual/ResumenTab.jsx';
import InventarioTab from './mensual/InventarioTab.jsx';
import FluctuacionesTab from './mensual/FluctuacionesTab.jsx';
import CierreTab from './mensual/CierreTab.jsx';
import UreaTab from './mensual/UreaTab.jsx';

const TABS = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'inventario', label: 'Inventario' },
  { key: 'fluctuaciones', label: 'Fluctuaciones' },
  { key: 'cierre', label: 'Cierre detallado' },
  { key: 'urea', label: 'Urea' },
];

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

export default function MonthlyBalancePage() {
  const { estacionId } = useEstacion();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [tab, setTab] = useState('resumen');
  const [cierres, setCierres] = useState([]);
  const [cargando, setCargando] = useState(true);

  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(diasEnMes(anio, mes)).padStart(2, '0')}`;

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_cierre_diario')
        .select('fecha, venta_total, venta_galones_total, numero_clientes, diferencia_caja, estado')
        .eq('estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha');
      if (!activo) return;
      setCierres(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  return (
    <>
      <div className="page-header">
        <h1 style={{ textTransform: 'capitalize' }}>Balance mensual — {nombreMes(anio, mes)}</h1>
        <p>Cada pestaña reproduce una hoja del balance mensual de referencia, con los datos tal como están en origen.</p>
      </div>

      <FreshnessBanner estacionId={estacionId} anio={anio} mes={mes} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <select className="select" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {nombreMes(2000, m).split(' ')[0]}
            </option>
          ))}
        </select>
        <select className="select" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="sheet-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`sheet-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="empty-state">Cargando…</div>
      ) : (
        <>
          {tab === 'resumen' && <ResumenTab cierres={cierres} anio={anio} mes={mes} estacionId={estacionId} />}
          {tab === 'inventario' && <InventarioTab estacionId={estacionId} desde={desde} hasta={hasta} />}
          {tab === 'fluctuaciones' && <FluctuacionesTab estacionId={estacionId} desde={desde} hasta={hasta} />}
          {tab === 'cierre' && <CierreTab estacionId={estacionId} desde={desde} hasta={hasta} />}
          {tab === 'urea' && <UreaTab estacionId={estacionId} desde={desde} hasta={hasta} />}
        </>
      )}
    </>
  );
}
