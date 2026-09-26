import { useState } from 'react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { nombreMes } from '../lib/format.js';
import FreshnessBanner from '../components/FreshnessBanner.jsx';
import PromotorReporteTab from './reporte/PromotorReporteTab.jsx';
import SicomReporteTab from './reporte/SicomReporteTab.jsx';
import VentasTiendaTab from './reporte/VentasTiendaTab.jsx';

const TABS = [
  { key: 'promotor', label: 'Promotor Reporte' },
  { key: 'sicom', label: 'Sicom' },
  { key: 'tienda', label: 'Ventas tienda' },
];

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

export default function ReportePage() {
  const { estacionId } = useEstacion();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [tab, setTab] = useState('promotor');

  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(diasEnMes(anio, mes)).padStart(2, '0')}`;

  return (
    <>
      <div className="page-header">
        <h1 style={{ textTransform: 'capitalize' }}>Reportes — {nombreMes(anio, mes)}</h1>
        <p>Reportes mensuales de la estación.</p>
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

      {tab === 'promotor' && <PromotorReporteTab estacionId={estacionId} desde={desde} hasta={hasta} />}
      {tab === 'sicom' && <SicomReporteTab estacionId={estacionId} anio={anio} mes={mes} />}
      {tab === 'tienda' && <VentasTiendaTab estacionId={estacionId} desde={desde} hasta={hasta} />}
    </>
  );
}
