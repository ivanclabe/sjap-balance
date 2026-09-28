import { useEffect, useState } from 'react';
import { Fuel, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CampoPassword } from '../components/CampoPassword.jsx';

const DOMINIO = '@sjap.local';
const MAX_INTENTOS = 5;
const ESPERA_SEG = 30;

// Se entra con el correo registrado o, si la persona no tiene correo, con su
// nombre de usuario (Supabase Auth lo identifica como <usuario>@sjap.local).
function emailDeUsuario(texto) {
  const limpio = texto.trim().toLowerCase();
  return limpio.includes('@') ? limpio : `${limpio}${DOMINIO}`;
}

// "Olvidé mi contraseña": Supabase envía un enlace al correo. La respuesta es
// la misma exista o no la cuenta, para no revelar qué correos están registrados.
function Recuperar({ onVolver }) {
  const [correo, setCorreo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    const limpio = correo.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio)) {
      setResultado({ tipo: 'error', texto: 'Escribe el correo con el que ingresas a la app.' });
      return;
    }
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(limpio, { redirectTo: `${window.location.origin}/` });
    setEnviando(false);
    if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
      setResultado({ tipo: 'error', texto: 'Se enviaron demasiados correos seguidos. Espera unos minutos e intenta de nuevo.' });
      return;
    }
    setResultado({
      tipo: 'ok',
      texto: 'Si ese correo está registrado, te llegará un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.',
    });
  }

  return (
    <form onSubmit={enviar} noValidate>
      <p className="auth-tarjeta__ayuda" style={{ marginTop: 0, marginBottom: 14, textAlign: 'left' }}>
        Escribe el correo registrado en tu usuario. Si ingresas con un nombre de usuario (sin correo), pídele a un usuario master que te
        asigne una contraseña temporal.
      </p>
      <div className="field-row" style={{ marginBottom: 16 }}>
        <label className="field-label" htmlFor="rec-correo">Correo</label>
        <input id="rec-correo" className="field-input" type="email" autoComplete="email" autoFocus value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </div>
      <button className="btn btn--accent" type="submit" disabled={enviando} style={{ width: '100%', justifyContent: 'center' }}>
        {enviando ? 'Enviando…' : 'Enviarme el enlace'}
      </button>
      {resultado && (
        <div className={`field-msg field-msg--${resultado.tipo}`} role={resultado.tipo === 'error' ? 'alert' : 'status'}>
          {resultado.texto}
        </div>
      )}
      <button type="button" className="auth-tarjeta__salir" onClick={onVolver}>
        Volver al ingreso
      </button>
    </form>
  );
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
  const [modo, setModo] = useState('ingreso'); // ingreso | recuperar

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
      setError('Escribe tu correo o usuario.');
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
      <div className="panel auth-tarjeta">
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

        {modo === 'recuperar' ? (
          <Recuperar onVolver={() => setModo('ingreso')} />
        ) : (
        <form onSubmit={iniciarSesion} noValidate>
        <div className="field-row" style={{ marginBottom: 14 }}>
          <label className="field-label" htmlFor="login-usuario">
            Correo o usuario
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
            placeholder="ej. ana@miempresa.com u operador1"
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
        <button type="button" className="auth-tarjeta__salir" onClick={() => setModo('recuperar')}>
          ¿Olvidaste tu contraseña?
        </button>
        </form>
        )}
      </div>
    </div>
  );
}
