import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CampoPassword, ReglasPassword } from '../components/CampoPassword.jsx';
import { mensajeDeFuncion, validarPassword } from '../lib/password.js';

// Se muestra al abrir el enlace "Olvidé mi contraseña" del correo: Supabase ya
// abrió una sesión de recuperación y aquí se fija la contraseña nueva (la
// política la valida el servidor en la función sjap-usuarios).
export default function RestablecerPasswordPage() {
  const { perfil, cerrarSesion, recargarPerfil, terminarRecuperacion } = useAuth();
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setError(null);
    const invalida = validarPassword(nueva, perfil.username);
    if (invalida) return setError(invalida);
    if (nueva !== confirmacion) return setError('La confirmación no coincide con la nueva contraseña.');

    setGuardando(true);
    const { error: errFn } = await supabase.functions.invoke('sjap-usuarios', { body: { accion: 'nueva_password_recuperacion', nueva } });
    setGuardando(false);
    if (errFn) return setError(await mensajeDeFuncion(errFn));
    await recargarPerfil();
    terminarRecuperacion();
  }

  return (
    <div className="auth-pantalla">
      <form onSubmit={guardar} className="panel auth-tarjeta auth-tarjeta--ancha" noValidate>
        <div className="auth-tarjeta__marca">
          <div className="rail__mark" style={{ marginBottom: 0 }}>
            <KeyRound size={19} />
          </div>
          <div className="auth-tarjeta__titulo">Crea una contraseña nueva</div>
          <div className="auth-tarjeta__sub">
            Usuario <strong>{perfil.nombre || perfil.username}</strong>. El enlace de recuperación es válido por 15 minutos.
          </div>
        </div>

        <div className="auth-campos">
          <CampoPassword id="rp-nueva" label="Nueva contraseña" value={nueva} onChange={setNueva} autoComplete="new-password" autoFocus />
          <ReglasPassword password={nueva} username={perfil.username} />
          <CampoPassword id="rp-confirmacion" label="Repite la nueva contraseña" value={confirmacion} onChange={setConfirmacion} autoComplete="new-password" />
        </div>

        <button className="btn btn--accent" type="submit" disabled={guardando || !nueva || !confirmacion} style={{ width: '100%', justifyContent: 'center' }}>
          {guardando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        {error && (
          <div className="field-msg field-msg--error" role="alert">
            {error}
          </div>
        )}
        <button type="button" className="auth-tarjeta__salir" onClick={() => cerrarSesion()}>
          Cancelar
        </button>
      </form>
    </div>
  );
}
