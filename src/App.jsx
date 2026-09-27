import { useState } from 'react';
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
  UserRound,
} from 'lucide-react';
import { useEstacion } from './context/EstacionContext.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { useUltimoCierre } from './hooks/useUltimoCierre.js';
import { useEstacionConfig } from './hooks/useEstacionConfig.js';
import { useInactividad } from './hooks/useInactividad.js';
import { formatCOP } from './lib/format.js';
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
import CambioPasswordPage from './pages/CambioPasswordPage.jsx';
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

function PantallaCentrada({ children }) {
  return <div className="auth-pantalla auth-pantalla--texto">{children}</div>;
}

export default function App() {
  const { estado, perfil, esMaster, cerrarSesion, recargarPerfil } = useAuth();
  const { estaciones, estacionId, setEstacionId, estacion } = useEstacion();
  const { cierre: ultimo } = useUltimoCierre(estacionId);
  const { config } = useEstacionConfig(estacionId);
  const [mostrarSaldo, setMostrarSaldo] = useState(true);
  const navigate = useNavigate();

  // Equipos compartidos en la estación: la sesión se cierra sola tras N
  // minutos sin actividad (sjap_estacion_config.sesion_inactividad_minutos).
  const { segundosRestantes, seguir } = useInactividad({
    activo: estado === 'listo' && !perfil?.debe_cambiar_password,
    minutos: config.sesion_inactividad_minutos,
    onExpira: () => cerrarSesion('Se cerró la sesión por inactividad. Vuelve a iniciar sesión para continuar.'),
  });

  const hayAlerta = ultimo?.estado && ultimo.estado !== 'completo';

  if (estado === 'verificando' || estado === 'cargando') return <PantallaCentrada>Cargando…</PantallaCentrada>;
  if (estado === 'anonimo') return <LoginPage />;
  if (estado === 'error') {
    return (
      <PantallaCentrada>
        <p>No se pudo cargar tu perfil de usuario. Revisa la conexión a internet.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--accent" onClick={recargarPerfil}>
            Reintentar
          </button>
          <button className="btn" onClick={() => cerrarSesion()}>
            Salir
          </button>
        </div>
      </PantallaCentrada>
    );
  }
  if (perfil.debe_cambiar_password) return <CambioPasswordPage />;

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
            <div className="topbar__usuario" title={`Sesión iniciada como ${perfil.username}`}>
              <UserRound size={15} />
              <div>
                <div className="topbar__usuario-nombre">{perfil.nombre || perfil.username}</div>
                <div className="topbar__usuario-rol">{esMaster ? 'Master' : 'Dependiente'}</div>
              </div>
            </div>
            <button className="topbar__action" onClick={() => navigate('/cargar')}>
              <span className="topbar__action-icon">
                <UploadCloud />
              </span>
              Cargar
            </button>
            <button className="topbar__action" onClick={() => cerrarSesion()}>
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

      {segundosRestantes != null && (
        <div className="inactividad" role="alertdialog" aria-live="assertive" aria-label="Cierre de sesión por inactividad">
          <div className="inactividad__tarjeta">
            <strong>¿Sigues ahí?</strong>
            <p>Por seguridad, la sesión se cerrará en {segundosRestantes} s por inactividad.</p>
            <div className="inactividad__acciones">
              <button className="btn btn--accent" onClick={seguir} autoFocus>
                Seguir conectado
              </button>
              <button className="btn" onClick={() => cerrarSesion()}>
                Salir ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
