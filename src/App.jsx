import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Fuel,
  LayoutDashboard,
  UploadCloud,
  ListChecks,
  CalendarRange,
  Users,
  FileBarChart2,
  Target,
  Settings,
  Handshake,
  Receipt,
  HelpCircle,
  Eye,
  EyeOff,
  LogOut,
} from 'lucide-react';
import { useEstacion } from './context/EstacionContext.jsx';
import { useUltimoCierre } from './hooks/useUltimoCierre.js';
import { formatCOP } from './lib/format.js';
import { supabase } from './supabase/client.js';
import DashboardPage from './pages/DashboardPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import DailyBalancesListPage from './pages/DailyBalancesListPage.jsx';
import DailyBalanceDetailPage from './pages/DailyBalanceDetailPage.jsx';
import MonthlyBalancePage from './pages/MonthlyBalancePage.jsx';
import PromotoresPage from './pages/PromotoresPage.jsx';
import ReportePage from './pages/ReportePage.jsx';
import PresupuestoPage from './pages/PresupuestoPage.jsx';
import ConfiguracionPage from './pages/ConfiguracionPage.jsx';
import ClientesPropiosPage from './pages/ClientesPropiosPage.jsx';
import FacturasPage from './pages/FacturasPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import InfoTip from './components/InfoTip.jsx';
import ChatAsistente from './components/ChatAsistente.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/cargar', label: 'Cargar', icon: UploadCloud },
  { to: '/diarios', label: 'Diarios', icon: ListChecks },
  { to: '/mensual', label: 'Mensual', icon: CalendarRange },
  { to: '/clientes-propios', label: 'Clientes propios', icon: Handshake },
  { to: '/facturas', label: 'Facturas', icon: Receipt },
  { to: '/promotores', label: 'Promotores', icon: Users },
  { to: '/reporte', label: 'Reporte', icon: FileBarChart2 },
  { to: '/presupuesto', label: 'Presupuesto', icon: Target },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
  { to: '/ayuda', label: 'Ayuda', icon: HelpCircle },
];

export default function App() {
  const { estaciones, estacionId, setEstacionId, estacion } = useEstacion();
  const { cierre: ultimo } = useUltimoCierre(estacionId);
  const [mostrarSaldo, setMostrarSaldo] = useState(true);
  const [sesion, setSesion] = useState(undefined); // undefined = verificando, null = sin sesión
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, session) => setSesion(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const hayAlerta = ultimo?.estado && ultimo.estado !== 'completo';

  if (sesion === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)' }}>
        Cargando…
      </div>
    );
  }
  if (!sesion) return <LoginPage />;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__mark">
          <Fuel size={19} />
        </div>

        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `rail__item${isActive ? ' active' : ''}`}
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}

        <div className="rail__spacer" />

        {estaciones.length > 0 && (
          <select
            className="select"
            style={{ width: 64, fontSize: 9, padding: '6px 2px', textAlign: 'center' }}
            value={estacionId ?? ''}
            onChange={(e) => setEstacionId(e.target.value)}
            title="Cambiar estación"
          >
            {estaciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__status">
            <span className={`status-dot status-dot--${hayAlerta ? 'amber' : 'good'}`} />
            <div>
              <div className="topbar__status-title">
                {ultimo ? (hayAlerta ? 'Insumos pendientes' : 'Cierre del día al corriente') : 'Sin cierres cargados'}
                {hayAlerta && (
                  <InfoTip>Falta capturar inventario físico, facturas de compra o efectivo real para completar este cierre. Ver "Ayuda" para más detalle.</InfoTip>
                )}
              </div>
              <div className="topbar__status-sub">
                {estacion ? `${estacion.nombre}${estacion.ciudad ? ` · ${estacion.ciudad}` : ''}` : '—'}
              </div>
            </div>
          </div>

          <div className="topbar__balance">
            <div className="topbar__balance-label">
              Venta del último cierre
              <button
                onClick={() => setMostrarSaldo((v) => !v)}
                style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', display: 'flex' }}
                aria-label={mostrarSaldo ? 'Ocultar valor' : 'Mostrar valor'}
              >
                {mostrarSaldo ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
            <div className="topbar__balance-value">
              {mostrarSaldo ? (ultimo ? formatCOP(ultimo.venta_total) : '—') : '••••••••'}
            </div>
          </div>

          <div className="topbar__actions">
            <button className="topbar__action" onClick={() => navigate('/cargar')}>
              <span className="topbar__action-icon">
                <UploadCloud />
              </span>
              Cargar
            </button>
            <button className="topbar__action" onClick={() => supabase.auth.signOut()}>
              <span className="topbar__action-icon">
                <LogOut />
              </span>
              Salir
            </button>
          </div>
        </header>

        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/cargar" element={<UploadPage />} />
            <Route path="/diarios" element={<DailyBalancesListPage />} />
            <Route path="/diarios/:fecha" element={<DailyBalanceDetailPage />} />
            <Route path="/mensual" element={<MonthlyBalancePage />} />
            <Route path="/clientes-propios" element={<ClientesPropiosPage />} />
            <Route path="/facturas" element={<FacturasPage />} />
            <Route path="/promotores" element={<PromotoresPage />} />
            <Route path="/reporte" element={<ReportePage />} />
            <Route path="/presupuesto" element={<PresupuestoPage />} />
            <Route path="/configuracion" element={<ConfiguracionPage />} />
            <Route path="/ayuda" element={<HelpPage />} />
          </Routes>
        </main>
      </div>

      <ChatAsistente estacionId={estacionId} />
    </div>
  );
}
