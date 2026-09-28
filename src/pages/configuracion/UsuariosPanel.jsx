import { Fragment, useEffect, useState } from 'react';
import { UserPlus, KeyRound, Copy, RefreshCw, ShieldCheck, UserX, UserCheck, Wand2, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { supabase } from '../../supabase/client.js';
import { CampoPassword, ReglasPassword } from '../../components/CampoPassword.jsx';
import { generarPassword, mensajeDeFuncion, validarPassword } from '../../lib/password.js';

async function llamar(accion, datos = {}) {
  const { data, error } = await supabase.functions.invoke('sjap-usuarios', { body: { accion, ...datos } });
  if (error) throw new Error(await mensajeDeFuncion(error));
  return data;
}

function fechaHora(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// Muestra una contraseña temporal UNA sola vez, con botón para copiarla.
function CredencialEntregable({ usuario, password, onCerrar }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(`Usuario: ${usuario}\nContraseña temporal: ${password}`);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <div className="credencial" role="status">
      <div>
        <div className="credencial__titulo">Entrega estos datos a la persona</div>
        <div className="credencial__datos">
          <span>Usuario: <strong className="mono">{usuario}</strong></span>
          <span>Contraseña temporal: <strong className="mono">{password}</strong></span>
        </div>
        <div className="credencial__nota">Solo se muestra ahora. Al entrar, la app le pedirá crear su propia contraseña.</div>
      </div>
      <div className="credencial__acciones">
        <button type="button" className="btn btn--sm" onClick={copiar}>
          <Copy size={13} /> {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <button type="button" className="btn btn--sm" onClick={onCerrar}>
          Listo
        </button>
      </div>
    </div>
  );
}

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function CambiarPassword({ usuario }) {
  const { correo } = useAuth();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setMensaje(null);
    const invalida = validarPassword(nueva, usuario.username);
    if (invalida) return setMensaje({ tipo: 'error', texto: invalida });
    if (nueva !== confirmacion) return setMensaje({ tipo: 'error', texto: 'La confirmación no coincide con la nueva contraseña.' });
    if (nueva === actual) return setMensaje({ tipo: 'error', texto: 'La nueva contraseña debe ser distinta de la actual.' });

    setGuardando(true);
    try {
      await llamar('cambiar_mi_password', { actual, nueva });
      setActual('');
      setNueva('');
      setConfirmacion('');
      setMensaje({ tipo: 'ok', texto: 'Contraseña actualizada. Úsala la próxima vez que inicies sesión.' });
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="panel" onSubmit={guardar} noValidate>
      <div className="panel__header">
        <h2>Cambiar mi contraseña</h2>
        <span className="panel__hint">usuario: {usuario.username}</span>
      </div>
      <p className="field-help" style={{ marginTop: 0 }}>
        {correo
          ? `Ingresas con tu correo ${correo}. Si olvidas la contraseña puedes recuperarla desde la pantalla de ingreso.`
          : 'Ingresas con tu nombre de usuario. Sin un correo registrado no puedes recuperar la contraseña por tu cuenta: pídele a un master que registre tu correo.'}
      </p>
      <div className="field-grid">
        <CampoPassword id="pw-actual" label="Contraseña actual" value={actual} onChange={setActual} autoComplete="current-password" />
        <CampoPassword id="pw-nueva" label="Nueva contraseña" value={nueva} onChange={setNueva} autoComplete="new-password" />
        <CampoPassword id="pw-confirmacion" label="Confirmar nueva contraseña" value={confirmacion} onChange={setConfirmacion} autoComplete="new-password" />
      </div>
      {nueva && <ReglasPassword password={nueva} username={usuario.username} />}
      <button className="btn btn--accent" type="submit" disabled={guardando || !actual || !nueva || !confirmacion}>
        <KeyRound size={15} /> {guardando ? 'Actualizando…' : 'Actualizar contraseña'}
      </button>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </form>
  );
}

function FormularioNuevo({ onCreado }) {
  const vacio = { username: '', nombre: '', email: '', password: '', rol: 'dependiente' };
  const [nuevo, setNuevo] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function crear(e) {
    e.preventDefault();
    setError(null);
    const invalida = validarPassword(nuevo.password, nuevo.username);
    if (invalida) return setError(invalida);
    if (nuevo.email.trim() && !CORREO_RE.test(nuevo.email.trim())) return setError('El correo no es válido.');
    setGuardando(true);
    try {
      const data = await llamar('crear', nuevo);
      onCreado({ usuario: nuevo.email.trim() ? nuevo.email.trim().toLowerCase() : data.username, password: nuevo.password });
      setNuevo(vacio);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={crear} noValidate className="usuarios-nuevo">
      <div className="field-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="nu-username">Usuario</label>
          <input
            id="nu-username"
            className="field-input"
            placeholder="ej. operador1"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={nuevo.username}
            onChange={(e) => setNuevo({ ...nuevo, username: e.target.value.toLowerCase().replace(/\s/g, '') })}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-nombre">Nombre (opcional)</label>
          <input id="nu-nombre" className="field-input" placeholder="ej. Ana Pérez" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-email">Correo (opcional)</label>
          <input
            id="nu-email"
            className="field-input"
            type="email"
            autoComplete="off"
            placeholder="para ingresar y recuperar la contraseña"
            value={nuevo.email}
            onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-rol">Rol</label>
          <select id="nu-rol" className="select" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
            <option value="dependiente">Dependiente — opera, no modifica configuración</option>
            <option value="master">Master — acceso total</option>
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="nu-password">Contraseña temporal</label>
          <div className="usuarios-nuevo__pw">
            <input
              id="nu-password"
              className="field-input mono"
              autoComplete="new-password"
              spellCheck={false}
              value={nuevo.password}
              onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
            />
            <button type="button" className="btn btn--sm" onClick={() => setNuevo({ ...nuevo, password: generarPassword() })} title="Generar una contraseña segura">
              <Wand2 size={13} /> Generar
            </button>
          </div>
        </div>
      </div>
      {nuevo.password && <ReglasPassword password={nuevo.password} username={nuevo.username} />}
      <div className="usuarios-nuevo__pie">
        <span className="text-ink-soft" style={{ fontSize: 12 }}>
          La persona deberá cambiar esta contraseña la primera vez que entre.
        </span>
        <button className="btn btn--accent" type="submit" disabled={guardando || !nuevo.username || !nuevo.password}>
          <UserPlus size={15} /> {guardando ? 'Creando…' : 'Crear usuario'}
        </button>
      </div>
      {error && <div className="field-msg field-msg--error">{error}</div>}
    </form>
  );
}

function GestionUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [entregable, setEntregable] = useState(null);
  const [pendiente, setPendiente] = useState(null); // { id, accion } esperando confirmación
  const [trabajando, setTrabajando] = useState(null);
  const [passwordReset, setPasswordReset] = useState('');

  async function cargar() {
    setErrorCarga(null);
    try {
      const data = await llamar('listar');
      setUsuarios(data.usuarios);
    } catch (err) {
      setErrorCarga(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const [correoNuevo, setCorreoNuevo] = useState('');

  function pedir(u, accion) {
    setMensaje(null);
    setPendiente({ id: u.id, accion });
    if (accion === 'restablecer_password') setPasswordReset(generarPassword());
    if (accion === 'cambiar_correo') setCorreoNuevo(u.email ?? '');
  }

  async function confirmar(u) {
    const { accion } = pendiente;
    const datos = { id: u.id };
    if (accion === 'restablecer_password') {
      const invalida = validarPassword(passwordReset, u.username);
      if (invalida) return setMensaje({ tipo: 'error', texto: invalida });
      datos.password = passwordReset;
    }
    if (accion === 'cambiar_rol') datos.rol = u.rol === 'master' ? 'dependiente' : 'master';
    if (accion === 'cambiar_correo') {
      const limpio = correoNuevo.trim().toLowerCase();
      if (limpio && !CORREO_RE.test(limpio)) return setMensaje({ tipo: 'error', texto: 'El correo no es válido.' });
      datos.email = limpio;
    }

    setTrabajando(u.id);
    try {
      await llamar(accion, datos);
      const textos = {
        restablecer_password: null,
        cambiar_rol: `"${u.username}" ahora es ${datos.rol === 'master' ? 'master' : 'dependiente'}.`,
        desactivar: `"${u.username}" quedó desactivado: ya no puede entrar ni ver datos.`,
        reactivar: `"${u.username}" puede volver a entrar.`,
        cambiar_correo: datos.email
          ? `"${u.username}" ahora ingresa con ${datos.email} y puede recuperar su contraseña por correo.`
          : `"${u.username}" vuelve a ingresar con su nombre de usuario.`,
      };
      if (accion === 'restablecer_password') setEntregable({ usuario: u.username, password: passwordReset });
      else setMensaje({ tipo: 'ok', texto: textos[accion] });
      setPendiente(null);
      await cargar();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message });
    } finally {
      setTrabajando(null);
    }
  }

  const PREGUNTAS = {
    restablecer_password: (u) => `Nueva contraseña temporal para "${u.username}":`,
    cambiar_rol: (u) => (u.rol === 'master' ? `¿Quitar el rol master a "${u.username}"?` : `¿Dar acceso total (master) a "${u.username}"?`),
    desactivar: (u) => `¿Desactivar a "${u.username}"? No podrá entrar hasta que lo reactives.`,
    reactivar: (u) => `¿Reactivar a "${u.username}"?`,
    cambiar_correo: (u) => `Correo de "${u.username}" (déjalo vacío para que ingrese con su usuario):`,
  };

  const activos = usuarios.filter((u) => u.activo).length;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel__header">
        <h2>Usuarios de la estación</h2>
        <span className="panel__hint">
          {activos} activo(s) · {usuarios.length - activos} desactivado(s)
        </span>
      </div>

      <FormularioNuevo
        onCreado={(cred) => {
          setMensaje(null);
          setEntregable(cred);
          cargar();
        }}
      />

      {entregable && <CredencialEntregable {...entregable} onCerrar={() => setEntregable(null)} />}
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`} style={{ marginBottom: 12 }}>{mensaje.texto}</div>}

      {cargando ? (
        <div className="empty-state">Cargando…</div>
      ) : errorCarga ? (
        <div className="alert alert--danger" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          No se pudo cargar la lista de usuarios ({errorCarga}).
          <button className="btn btn--sm" onClick={cargar}>
            <RefreshCw size={13} /> Reintentar
          </button>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="usuarios-tabla">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Ingresa con</th>
                <th>Último ingreso</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const enConfirmacion = pendiente?.id === u.id;
                return (
                  <Fragment key={u.id}>
                    <tr className={u.activo ? '' : 'usuarios-tabla__inactivo'}>
                      <td>
                        <div className="mono">{u.username}{u.es_yo && <span className="usuarios-tabla__yo"> (tú)</span>}</div>
                        {u.nombre && <div className="text-ink-soft" style={{ fontSize: 12 }}>{u.nombre}</div>}
                      </td>
                      <td>
                        <span className={`badge badge--${u.rol === 'master' ? 'good' : 'muted'}`}>{u.rol === 'master' ? 'Master' : 'Dependiente'}</span>
                      </td>
                      <td>
                        {!u.activo ? (
                          <span className="badge badge--danger">Desactivado</span>
                        ) : u.debe_cambiar_password ? (
                          <span className="badge badge--warn" title="Tiene una contraseña temporal pendiente de cambiar">Contraseña temporal</span>
                        ) : (
                          <span className="badge badge--good">Activo</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {u.email ? <span className="mono">{u.email}</span> : <span className="text-ink-soft">usuario (sin correo)</span>}
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>{fechaHora(u.ultimo_ingreso) ?? <span className="text-ink-soft">Nunca</span>}</td>
                      <td>
                        {u.es_yo ? (
                          <span className="text-ink-soft" style={{ fontSize: 12 }}>—</span>
                        ) : (
                          <div className="usuarios-tabla__acciones">
                            {u.activo && (
                              <>
                                <button className="btn btn--sm" onClick={() => pedir(u, 'restablecer_password')} disabled={trabajando === u.id}>
                                  <KeyRound size={13} /> Restablecer contraseña
                                </button>
                                <button className="btn btn--sm" onClick={() => pedir(u, 'cambiar_correo')} disabled={trabajando === u.id}>
                                  <Mail size={13} /> Correo
                                </button>
                                <button className="btn btn--sm" onClick={() => pedir(u, 'cambiar_rol')} disabled={trabajando === u.id}>
                                  <ShieldCheck size={13} /> {u.rol === 'master' ? 'Quitar master' : 'Hacer master'}
                                </button>
                                <button className="btn btn--sm btn--peligro" onClick={() => pedir(u, 'desactivar')} disabled={trabajando === u.id}>
                                  <UserX size={13} /> Desactivar
                                </button>
                              </>
                            )}
                            {!u.activo && (
                              <button className="btn btn--sm" onClick={() => pedir(u, 'reactivar')} disabled={trabajando === u.id}>
                                <UserCheck size={13} /> Reactivar
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {enConfirmacion && (
                      <tr className="usuarios-tabla__confirmacion">
                        <td colSpan={6}>
                          <div className="confirmacion">
                            <span>{PREGUNTAS[pendiente.accion](u)}</span>
                            {pendiente.accion === 'cambiar_correo' && (
                              <input
                                className="field-input"
                                type="email"
                                aria-label="Correo"
                                placeholder="correo@empresa.com"
                                value={correoNuevo}
                                autoFocus
                                onChange={(e) => setCorreoNuevo(e.target.value)}
                                style={{ maxWidth: 280 }}
                              />
                            )}
                            {pendiente.accion === 'restablecer_password' && (
                              <span className="usuarios-nuevo__pw">
                                <input
                                  className="field-input mono"
                                  aria-label="Nueva contraseña temporal"
                                  value={passwordReset}
                                  onChange={(e) => setPasswordReset(e.target.value)}
                                  spellCheck={false}
                                />
                                <button type="button" className="btn btn--sm" onClick={() => setPasswordReset(generarPassword())}>
                                  <Wand2 size={13} /> Otra
                                </button>
                              </span>
                            )}
                            <span className="confirmacion__botones">
                              <button
                                className={`btn btn--sm ${pendiente.accion === 'desactivar' ? 'btn--peligro-solido' : 'btn--accent'}`}
                                onClick={() => confirmar(u)}
                                disabled={trabajando === u.id}
                              >
                                {trabajando === u.id ? 'Aplicando…' : 'Confirmar'}
                              </button>
                              <button className="btn btn--sm" onClick={() => setPendiente(null)} disabled={trabajando === u.id}>
                                Cancelar
                              </button>
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="subnote" style={{ marginTop: 12 }}>
        Desactivar corta el acceso de inmediato y conserva el historial de la persona. Una estación siempre debe tener al menos un
        master activo, y un master no puede desactivarse ni quitarse el rol a sí mismo.
      </p>
    </div>
  );
}

export default function UsuariosPanel({ usuario, esMaster }) {
  if (!usuario) return <div className="empty-state">Cargando…</div>;
  return (
    <>
      <CambiarPassword usuario={usuario} />
      {esMaster ? (
        <GestionUsuarios />
      ) : (
        <div className="subnote" style={{ marginTop: 16 }}>
          Solo un usuario <strong>master</strong> puede crear y administrar usuarios.
        </div>
      )}
    </>
  );
}
