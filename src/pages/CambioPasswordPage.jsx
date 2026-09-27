import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { CampoPassword, ReglasPassword } from '../components/CampoPassword.jsx';
import { mensajeDeFuncion, validarPassword } from '../lib/password.js';

// Se muestra en lugar de la app cuando un master asignó una contraseña
// temporal (usuario nuevo o contraseña restablecida).
export default function CambioPasswordPage() {
  const { perfil, cerrarSesion, recargarPerfil } = useAuth();
  const [actual, setActual] = useState('');
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
    if (nueva === actual) return setError('La nueva contraseña debe ser distinta de la temporal.');

    setGuardando(true);
    const { error: errFn } = await supabase.functions.invoke('sjap-usuarios', {
      body: { accion: 'cambiar_mi_password', actual, nueva },
    });
    setGuardando(false);
    if (errFn) return setError(await mensajeDeFuncion(errFn));
    await recargarPerfil();
  }

  return (
    <div className="auth-pantalla">
      <form onSubmit={guardar} className="panel auth-tarjeta auth-tarjeta--ancha" noValidate>
        <div className="auth-tarjeta__marca">
          <div className="rail__mark" style={{ marginBottom: 0 }}>
            <KeyRound size={19} />
          </div>
          <div className="auth-tarjeta__titulo">Crea tu contraseña</div>
          <div className="auth-tarjeta__sub">
            Hola, <strong>{perfil.nombre || perfil.username}</strong>. Estás usando una contraseña temporal; por seguridad
            cámbiala antes de continuar.
          </div>
        </div>

        <div className="auth-campos">
          <CampoPassword id="cp-actual" label="Contraseña temporal" value={actual} onChange={setActual} autoComplete="current-password" autoFocus />
          <CampoPassword id="cp-nueva" label="Nueva contraseña" value={nueva} onChange={setNueva} autoComplete="new-password" />
          <ReglasPassword password={nueva} username={perfil.username} />
          <CampoPassword id="cp-confirmacion" label="Repite la nueva contraseña" value={confirmacion} onChange={setConfirmacion} autoComplete="new-password" />
        </div>

        <button className="btn btn--accent" type="submit" disabled={guardando || !actual || !nueva || !confirmacion} style={{ width: '100%', justifyContent: 'center' }}>
          {guardando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        {error && (
          <div className="field-msg field-msg--error" role="alert">
            {error}
          </div>
        )}
        <button type="button" className="auth-tarjeta__salir" onClick={() => cerrarSesion()}>
          Salir sin cambiar
        </button>
      </form>
    </div>
  );
}
