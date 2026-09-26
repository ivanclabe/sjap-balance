import { useEffect, useState } from 'react';
import { UserPlus, KeyRound } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import { formatFecha } from '../../lib/format.js';

const MIN_PASSWORD = 6;

async function mensajeDeError(error) {
  // Si la función responde con error, el detalle viene en el cuerpo de la respuesta.
  const cuerpo = await error?.context?.json?.().catch(() => null);
  return cuerpo?.error || error?.message || 'No se pudo completar la operación.';
}

function CambiarPassword({ usuario }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setMensaje(null);
    if (nueva.length < MIN_PASSWORD) {
      setMensaje({ tipo: 'error', texto: `La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
      return;
    }
    if (nueva !== confirmacion) {
      setMensaje({ tipo: 'error', texto: 'La confirmación no coincide con la nueva contraseña.' });
      return;
    }
    if (nueva === actual) {
      setMensaje({ tipo: 'error', texto: 'La nueva contraseña debe ser distinta de la actual.' });
      return;
    }

    setGuardando(true);
    // Se verifica la contraseña actual antes de cambiarla: una sesión abierta
    // en un equipo compartido no basta para cambiar la clave.
    const { error: errActual } = await supabase.auth.signInWithPassword({ email: `${usuario.username}@sjap.local`, password: actual });
    if (errActual) {
      setGuardando(false);
      setMensaje({ tipo: 'error', texto: 'La contraseña actual no es correcta.' });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: nueva });
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message });
      return;
    }
    setActual('');
    setNueva('');
    setConfirmacion('');
    setMensaje({ tipo: 'ok', texto: 'Contraseña actualizada. Úsala la próxima vez que inicies sesión.' });
  }

  return (
    <form className="panel" onSubmit={guardar}>
      <div className="panel__header">
        <h2>Cambiar mi contraseña</h2>
        <span className="panel__hint">usuario: {usuario.username}</span>
      </div>
      <div className="field-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="pw-actual">Contraseña actual</label>
          <input id="pw-actual" className="field-input" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="pw-nueva">Nueva contraseña</label>
          <input id="pw-nueva" className="field-input" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="pw-confirmacion">Confirmar nueva contraseña</label>
          <input id="pw-confirmacion" className="field-input" type="password" autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
        </div>
      </div>
      <button className="btn btn--accent" type="submit" disabled={guardando || !actual || !nueva || !confirmacion}>
        <KeyRound size={15} /> {guardando ? 'Actualizando…' : 'Actualizar contraseña'}
      </button>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </form>
  );
}

function GestionUsuarios({ estacionId }) {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState({ username: '', password: '', rol: 'dependiente' });
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from('sjap_usuarios').select('id, username, rol, created_at').eq('estacion_id', estacionId).order('username');
    setUsuarios(data || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!estacionId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function crear(e) {
    e.preventDefault();
    setMensaje(null);
    if (nuevo.password.length < MIN_PASSWORD) {
      setMensaje({ tipo: 'error', texto: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` });
      return;
    }
    setGuardando(true);
    const { data, error } = await supabase.functions.invoke('admin-crear-usuario', { body: nuevo });
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: 'error', texto: await mensajeDeError(error) });
      return;
    }
    setNuevo({ username: '', password: '', rol: 'dependiente' });
    setMensaje({ tipo: 'ok', texto: `Usuario "${data.username}" creado como ${data.rol}. Ya puede iniciar sesión con la contraseña asignada.` });
    cargar();
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel__header">
        <h2>Usuarios de la estación</h2>
        <span className="panel__hint">{usuarios.length} usuario(s)</span>
      </div>

      <form onSubmit={crear} className="field-grid" style={{ marginBottom: 12 }}>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-username">Usuario</label>
          <input
            id="nu-username"
            className="field-input"
            placeholder="ej. operador1"
            autoComplete="off"
            value={nuevo.username}
            onChange={(e) => setNuevo({ ...nuevo, username: e.target.value.toLowerCase() })}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-password">Contraseña inicial</label>
          <input id="nu-password" className="field-input" type="password" autoComplete="new-password" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-rol">Rol</label>
          <select id="nu-rol" className="select" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
            <option value="dependiente">Dependiente — opera, no modifica configuración</option>
            <option value="master">Master — acceso total</option>
          </select>
        </div>
        <div className="field-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--accent" type="submit" disabled={guardando || !nuevo.username || !nuevo.password}>
            <UserPlus size={15} /> {guardando ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`} style={{ marginBottom: 12 }}>{mensaje.texto}</div>}

      {cargando ? (
        <div className="empty-state">Cargando…</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Creado</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.username}</td>
                  <td>
                    <span className={`badge badge--${u.rol === 'master' ? 'good' : 'muted'}`}>{u.rol}</span>
                  </td>
                  <td className="mono">{formatFecha(u.created_at.slice(0, 10), { year: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function UsuariosPanel({ estacionId, usuario, esMaster }) {
  if (!usuario) return <div className="empty-state">Cargando…</div>;
  return (
    <>
      <CambiarPassword usuario={usuario} />
      {esMaster ? (
        <GestionUsuarios estacionId={estacionId} />
      ) : (
        <div className="subnote" style={{ marginTop: 16 }}>
          Solo un usuario <strong>master</strong> puede crear usuarios nuevos.
        </div>
      )}
    </>
  );
}
