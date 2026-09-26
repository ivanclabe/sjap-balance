import { useState } from 'react';
import { Fuel } from 'lucide-react';
import { supabase } from '../supabase/client.js';

export default function LoginPage() {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion(e) {
    e.preventDefault();
    setError(null);
    if (!usuario.trim() || !password) return;
    setCargando(true);
    const email = `${usuario.trim().toLowerCase()}@sjap.local`;
    const { error: errAuth } = await supabase.auth.signInWithPassword({ email, password });
    if (errAuth) setError('Usuario o contraseña incorrectos.');
    setCargando(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <form onSubmit={iniciarSesion} className="panel" style={{ width: 320 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div className="rail__mark" style={{ marginBottom: 0 }}>
            <Fuel size={19} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>SJAP Balance</div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>EDS LA FLORIDA · Cota</div>
        </div>

        <div className="field-row" style={{ marginBottom: 14 }}>
          <label className="field-label">Usuario</label>
          <input className="field-input" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus placeholder="master" />
        </div>
        <div className="field-row" style={{ marginBottom: 18 }}>
          <label className="field-label">Contraseña</label>
          <input className="field-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <button className="btn btn--accent" type="submit" disabled={cargando} style={{ width: '100%', justifyContent: 'center' }}>
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
        {error && <div className="field-msg field-msg--error">{error}</div>}
      </form>
    </div>
  );
}
