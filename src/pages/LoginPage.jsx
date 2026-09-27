import { useEffect, useState } from 'react';
import { Fuel, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CampoPassword } from '../components/CampoPassword.jsx';

const DOMINIO = '@sjap.local';
const MAX_INTENTOS = 5;
const ESPERA_SEG = 30;

// El usuario escribe su nombre de usuario; internamente Supabase Auth lo
// identifica como <usuario>@sjap.local. Si alguien pega el correo completo,
// también funciona.
function emailDeUsuario(texto) {
  const limpio = texto.trim().toLowerCase();
  return limpio.endsWith(DOMINIO) ? limpio : `${limpio}${DOMINIO}`;
}

function mensajeDeError(error) {
  const codigo = error?.code ?? '';
  const texto = (error?.message ?? '').toLowerCase();
  if (codigo === 'user_banned' || texto.includes('banned')) {
    return 'Este usuario está desactivado. Habla con el administrador de la estación.';
  }
  if (error?.status === 429 || codigo.includes('rate_limit') || texto.includes('rate limit')) {
    return 'Demasiados intentos seguidos. Espera unos minutos antes de volver a intentar.';
  }
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0 || texto.includes('fetch')) {
    return 'No hay conexión con el servidor. Revisa internet e intenta de nuevo.';
  }
  return 'Usuario o contraseña incorrectos.';
}

export default function LoginPage() {
  const { aviso, limpiarAviso } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [fallidos, setFallidos] = useState(0);
  const [esperaHasta, setEsperaHasta] = useState(0);
  const [ahora, setAhora] = useState(Date.now());

  // Tras varios intentos fallidos se pide una pausa corta. Supabase también
  // limita los intentos en el servidor; esto evita llegar a ese bloqueo.
  const bloqueado = esperaHasta > ahora;
  useEffect(() => {
    if (!bloqueado) return undefined;
    const t = setInterval(() => setAhora(Date.now()), 500);
    return () => clearInterval(t);
  }, [bloqueado]);

  async function iniciarSesion(e) {
    e.preventDefault();
    setError(null);
    if (!usuario.trim()) {
      setError('Escribe tu usuario.');
      return;
    }
    if (!password) {
      setError('Escribe tu contraseña.');
      return;
    }
    if (bloqueado) return;
    setCargando(true);
    limpiarAviso();
    const { error: errAuth } = await supabase.auth.signInWithPassword({ email: emailDeUsuario(usuario), password });
    setCargando(false);
    if (!errAuth) return; // AuthProvider toma el control desde aquí.

    setError(mensajeDeError(errAuth));
    setPassword('');
    const n = fallidos + 1;
    setFallidos(n);
    if (n >= MAX_INTENTOS) {
      setFallidos(0);
      setEsperaHasta(Date.now() + ESPERA_SEG * 1000);
      setAhora(Date.now());
    }
  }

  const segundos = Math.ceil((esperaHasta - ahora) / 1000);

  return (
    <div className="auth-pantalla">
      <form onSubmit={iniciarSesion} className="panel auth-tarjeta" noValidate>
        <div className="auth-tarjeta__marca">
          <div className="rail__mark" style={{ marginBottom: 0 }}>
            <Fuel size={19} />
          </div>
          <div className="auth-tarjeta__titulo">SJAP Balance</div>
          <div className="auth-tarjeta__sub">EDS LA FLORIDA · Cota</div>
        </div>

        {aviso && (
          <div className="auth-aviso" role="status">
            <AlertTriangle size={14} /> {aviso}
          </div>
        )}

        <div className="field-row" style={{ marginBottom: 14 }}>
          <label className="field-label" htmlFor="login-usuario">
            Usuario
          </label>
          <input
            id="login-usuario"
            name="username"
            className="field-input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoFocus
            placeholder="ej. operador1"
          />
        </div>
        <div style={{ marginBottom: 18 }}>
          <CampoPassword id="login-password" label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>

        <button className="btn btn--accent" type="submit" disabled={cargando || bloqueado} style={{ width: '100%', justifyContent: 'center' }}>
          {cargando ? 'Entrando…' : bloqueado ? `Espera ${segundos} s` : 'Entrar'}
        </button>
        {error && (
          <div className="field-msg field-msg--error" role="alert">
            {error}
          </div>
        )}
        <p className="auth-tarjeta__ayuda">¿Olvidaste tu contraseña? Pídele al administrador (usuario master) que te asigne una temporal.</p>
      </form>
    </div>
  );
}
