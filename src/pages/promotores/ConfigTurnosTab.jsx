import { useEffect, useMemo, useState } from 'react';
import ConfirmarAccion from '../../components/ConfirmarAccion.jsx';
import { Plus, Trash2, Star, Moon } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import InfoTip from '../../components/InfoTip.jsx';
import TurnoTimeline from './TurnoTimeline.jsx';
import {
  DIAS_SEMANA,
  PLANTILLAS,
  cruzaMedianoche,
  describirRegla,
  duracionMin,
  formatDuracion,
  minutosAHora,
  ordenarTurnos,
  resolverEsquema,
  tramosSinCubrir,
  validarTurnos,
  horaCorta,
} from './turnos-util.js';

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sumarDias(fechaISO, delta) {
  const d = new Date(`${fechaISO}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mensajeError(error) {
  if (error?.code === '23505') return 'Ya existe un registro con ese nombre o alcance.';
  return error?.message || 'No se pudo guardar.';
}

// ---------------------------------------------------------------- esquema

function EsquemaCard({ esquema, turnos, reglasDelEsquema, onCambio, soloLectura }) {
  const inicial = useMemo(
    () => ordenarTurnos(turnos).map((t) => ({ id: t.id, nombre: t.nombre, hora_inicio: horaCorta(t.hora_inicio), hora_fin: horaCorta(t.hora_fin) })),
    [turnos],
  );
  const [nombre, setNombre] = useState(esquema.nombre);
  const [borrador, setBorrador] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  // Cuando llegan datos nuevos del servidor (tras guardar), el borrador se
  // alinea con ellos sin remontar la tarjeta, para no perder el mensaje.
  const firma = `${esquema.nombre}|${JSON.stringify(inicial)}`;
  useEffect(() => {
    setNombre(esquema.nombre);
    setBorrador(inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);

  const errores = validarTurnos(borrador);
  const sucio = nombre.trim() !== esquema.nombre || JSON.stringify(borrador) !== JSON.stringify(inicial);
  const validos = borrador.filter((t) => t.hora_inicio && t.hora_fin && t.hora_inicio !== t.hora_fin);
  const huecos = tramosSinCubrir(validos);
  const horasCubiertas = validos.reduce((s, t) => s + duracionMin(t), 0);

  function editar(i, campo, valor) {
    setBorrador((prev) => prev.map((t, j) => (j === i ? { ...t, [campo]: valor } : t)));
  }

  function agregarTurno() {
    const ultimo = borrador[borrador.length - 1];
    const inicio = ultimo?.hora_fin || '06:00';
    setBorrador((prev) => [...prev, { nombre: `Turno ${prev.length + 1}`, hora_inicio: inicio, hora_fin: inicio === '06:00' ? '14:00' : '' }]);
  }

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    if (nombre.trim() !== esquema.nombre) {
      const { error } = await supabase.from('sjap_esquemas_turno').update({ nombre: nombre.trim() }).eq('id', esquema.id);
      if (error) {
        setGuardando(false);
        setMensaje({ tipo: 'error', texto: mensajeError(error) });
        return;
      }
    }
    const quitados = inicial.filter((t) => !borrador.some((b) => b.id === t.id)).length;
    const { error } = await supabase.rpc('sjap_guardar_esquema_turnos', {
      p_esquema_id: esquema.id,
      p_turnos: borrador.map((t) => ({ id: t.id ?? null, nombre: t.nombre.trim(), hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })),
    });
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    setMensaje({
      tipo: 'ok',
      texto: quitados
        ? 'Guardado. Los turnos quitados que tenían asignaciones quedaron inactivos para conservar el historial.'
        : 'Guardado.',
    });
    onCambio();
  }

  async function hacerPredeterminado() {
    // Una sola operación en la base: quita el predeterminado anterior y marca este.
    const { error } = await supabase.rpc('sjap_esquema_predeterminado', { p_esquema_id: esquema.id });
    if (error) {
      setMensaje({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    onCambio();
  }

  async function eliminar() {
    setMensaje(null);
    if (esquema.es_predeterminado) {
      setMensaje({ tipo: 'error', texto: 'No se puede eliminar el esquema predeterminado. Marca otro como predeterminado primero.' });
      return;
    }
    if (reglasDelEsquema.length > 0) {
      setMensaje({ tipo: 'error', texto: `Este esquema se usa en ${reglasDelEsquema.length} regla(s). Quítalas primero.` });
      return;
    }
    const ids = turnos.map((t) => t.id);
    if (ids.length) {
      const { count } = await supabase.from('sjap_turnos_programados').select('id', { count: 'exact', head: true }).in('turno_tipo_id', ids);
      if (count > 0) {
        setMensaje({ tipo: 'error', texto: `Tiene ${count} asignación(es) en el historial — no se puede eliminar sin perderlas.` });
        return;
      }
      const { error: errTurnos } = await supabase.from('sjap_turno_tipos').delete().in('id', ids);
      if (errTurnos) {
        setMensaje({ tipo: 'error', texto: mensajeError(errTurnos) });
        return;
      }
    }
    const { error } = await supabase.from('sjap_esquemas_turno').delete().eq('id', esquema.id);
    if (error) {
      setMensaje({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    onCambio();
  }

  return (
    <fieldset className="esquema-card" disabled={soloLectura}>
      <div className="esquema-card__header">
        <input className="esquema-card__nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del esquema" />
        {esquema.es_predeterminado ? (
          <span className="badge badge--good">
            <Star size={11} /> Predeterminado
          </span>
        ) : (
          <button className="btn btn--sm" onClick={hacerPredeterminado}>
            Usar como predeterminado
          </button>
        )}
      </div>
      <div className="esquema-card__meta">
        {validos.length} turno(s) · {formatDuracion(Math.min(horasCubiertas, 1440))} de 24 h
        {huecos.length > 0 && (
          <span className="esquema-card__huecos">
            {' '}· sin turno: {huecos.map(([a, b]) => `${minutosAHora(a)}–${b === 1440 ? '24:00' : minutosAHora(b)}`).join(', ')}
          </span>
        )}
      </div>

      <TurnoTimeline turnos={validos} />

      <div className="esquema-card__turnos">
        {borrador.map((t, i) => (
          <div className="esquema-turno" key={t.id ?? `nuevo-${i}`}>
            <input className="field-input esquema-turno__nombre" value={t.nombre} onChange={(e) => editar(i, 'nombre', e.target.value)} aria-label="Nombre del turno" />
            <input className="field-input esquema-turno__hora" type="time" value={t.hora_inicio} onChange={(e) => editar(i, 'hora_inicio', e.target.value)} aria-label="Hora de inicio" />
            <span className="esquema-turno__sep">–</span>
            <input className="field-input esquema-turno__hora" type="time" value={t.hora_fin} onChange={(e) => editar(i, 'hora_fin', e.target.value)} aria-label="Hora de fin" />
            <span className="esquema-turno__dur">
              {t.hora_inicio && t.hora_fin && t.hora_inicio !== t.hora_fin ? formatDuracion(duracionMin(t)) : '—'}
              {t.hora_inicio && t.hora_fin && t.hora_inicio !== t.hora_fin && cruzaMedianoche(t) && (
                <Moon size={12} aria-label="cruza la medianoche" title="Cruza la medianoche: termina al día siguiente" />
              )}
            </span>
            <button className="icon-btn" onClick={() => setBorrador((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${t.nombre}`} title="Quitar turno">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {borrador.length === 0 && <div className="empty-state" style={{ padding: '8px 0' }}>Sin turnos — agrega al menos uno.</div>}
      </div>

      {errores.length > 0 && (
        <ul className="esquema-card__errores">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="esquema-card__acciones">
        <button className="btn btn--sm" onClick={agregarTurno}>
          <Plus size={13} /> Agregar turno
        </button>
        <div style={{ flex: 1 }} />
        {sucio && (
          <button
            className="btn btn--sm"
            onClick={() => {
              setNombre(esquema.nombre);
              setBorrador(inicial);
              setMensaje(null);
            }}
          >
            Descartar
          </button>
        )}
        <button className="btn btn--sm btn--accent" onClick={guardar} disabled={!sucio || errores.length > 0 || borrador.length === 0 || guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        {!soloLectura && (
          <ConfirmarAccion className="icon-btn" pregunta={`¿Eliminar el esquema "${esquema.nombre}"?`} onConfirmar={eliminar} ariaLabel="Eliminar esquema" title="Eliminar esquema">
            <Trash2 size={15} />
          </ConfirmarAccion>
        )}
      </div>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </fieldset>
  );
}

function NuevoEsquema({ estacionId, onCreado, onCancelar }) {
  const [nombre, setNombre] = useState('');
  const [plantilla, setPlantilla] = useState('3x8');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function crear(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    setMensaje(null);
    const { data, error } = await supabase.from('sjap_esquemas_turno').insert({ estacion_id: estacionId, nombre: nombre.trim() }).select('id').single();
    if (error) {
      setGuardando(false);
      setMensaje({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    const turnos = PLANTILLAS.find((p) => p.key === plantilla)?.turnos ?? [];
    if (turnos.length) {
      const { error: errTurnos } = await supabase.rpc('sjap_guardar_esquema_turnos', { p_esquema_id: data.id, p_turnos: turnos });
      if (errTurnos) {
        await supabase.from('sjap_esquemas_turno').delete().eq('id', data.id);
        setGuardando(false);
        setMensaje({ tipo: 'error', texto: mensajeError(errTurnos) });
        return;
      }
    }
    setGuardando(false);
    onCreado();
  }

  return (
    <form className="esquema-card esquema-card--nuevo" onSubmit={crear}>
      <div className="field-row">
        <label className="field-label" htmlFor="ne-nombre">Nombre del esquema</label>
        <input id="ne-nombre" className="field-input" placeholder="ej. Fin de semana" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="ne-plantilla">Empezar desde</label>
        <select id="ne-plantilla" className="select" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
          {PLANTILLAS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <p style={{ fontSize: 12, margin: 0 }}>Los horarios de la plantilla se pueden ajustar después de crearlo.</p>
      <div className="esquema-card__acciones">
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn--sm" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--sm btn--accent" disabled={!nombre.trim() || guardando}>
          {guardando ? 'Creando…' : 'Crear esquema'}
        </button>
      </div>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </form>
  );
}

// ---------------------------------------------------------------- reglas

const ESPECIFICIDAD = (r) => (r.fecha ? (r.isla_id ? 0 : 1) : r.dia_semana != null ? (r.isla_id ? 2 : 3) : 4);

function Reglas({ estacionId, islas, esquemas, reglas, onCambio, conteoTurnos, soloLectura }) {
  const [cuando, setCuando] = useState('dia');
  const [dia, setDia] = useState('0');
  const [fecha, setFecha] = useState(hoyISO());
  const [islaId, setIslaId] = useState('');
  const [esquemaId, setEsquemaId] = useState('');
  const [mensaje, setMensaje] = useState(null);

  const islasActivas = islas.filter((i) => i.activo);
  const ordenadas = reglas.slice().sort((a, b) => ESPECIFICIDAD(a) - ESPECIFICIDAD(b) || String(a.fecha ?? a.dia_semana).localeCompare(String(b.fecha ?? b.dia_semana)));

  async function agregar(e) {
    e.preventDefault();
    setMensaje(null);
    if (!esquemaId) return;
    if (cuando === 'siempre' && !islaId) {
      setMensaje({ tipo: 'error', texto: 'Para todos los días y todas las islas, marca ese esquema como predeterminado.' });
      return;
    }
    const { error } = await supabase.from('sjap_esquema_reglas').insert({
      estacion_id: estacionId,
      esquema_id: esquemaId,
      isla_id: islaId || null,
      dia_semana: cuando === 'dia' ? Number(dia) : null,
      fecha: cuando === 'fecha' ? fecha : null,
    });
    if (error) {
      setMensaje({
        tipo: 'error',
        texto: error.code === '23505' ? 'Ya hay una regla para ese mismo día e isla. Quítala antes de crear otra.' : mensajeError(error),
      });
      return;
    }
    setMensaje({ tipo: 'ok', texto: 'Regla agregada.' });
    onCambio();
  }

  async function quitar(id) {
    const { error } = await supabase.from('sjap_esquema_reglas').delete().eq('id', id);
    if (error) {
      setMensaje({ tipo: 'error', texto: mensajeError(error) });
      return;
    }
    setMensaje({ tipo: 'ok', texto: 'Regla quitada.' });
    onCambio();
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel__header">
        <h2>Cuándo aplica cada esquema</h2>
        <InfoTip side="left">
          Gana la regla más específica: una fecha antes que un día de la semana, y una isla concreta antes que todas las
          islas. Orden completo: fecha + isla, fecha, día + isla, día, isla, y si nada aplica, el esquema predeterminado.
        </InfoTip>
      </div>

      {!soloLectura && (
      <form className="regla-form" onSubmit={agregar}>
        <div className="field-row">
          <label className="field-label" htmlFor="rg-cuando">Cuándo</label>
          <select id="rg-cuando" className="select" value={cuando} onChange={(e) => setCuando(e.target.value)}>
            <option value="dia">Un día de la semana</option>
            <option value="fecha">Una fecha específica</option>
            <option value="siempre">Todos los días</option>
          </select>
        </div>
        {cuando === 'dia' && (
          <div className="field-row">
            <label className="field-label" htmlFor="rg-dia">Día</label>
            <select id="rg-dia" className="select" value={dia} onChange={(e) => setDia(e.target.value)}>
              {DIAS_SEMANA.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        {cuando === 'fecha' && (
          <div className="field-row">
            <label className="field-label" htmlFor="rg-fecha">Fecha</label>
            <input id="rg-fecha" className="field-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        )}
        <div className="field-row">
          <label className="field-label" htmlFor="rg-isla">Isla</label>
          <select id="rg-isla" className="select" value={islaId} onChange={(e) => setIslaId(e.target.value)}>
            <option value="">Todas las islas</option>
            {islasActivas.map((i) => (
              <option key={i.id} value={i.id}>
                Isla {i.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="rg-esquema">Esquema</label>
          <select id="rg-esquema" className="select" value={esquemaId} onChange={(e) => setEsquemaId(e.target.value)}>
            <option value="">Selecciona…</option>
            {esquemas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} ({conteoTurnos(e.id)} turnos)
              </option>
            ))}
          </select>
        </div>
        <div className="field-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--accent" type="submit" disabled={!esquemaId}>
            <Plus size={14} /> Agregar regla
          </button>
        </div>
      </form>
      )}
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`} style={{ marginBottom: 12 }}>{mensaje.texto}</div>}

      {ordenadas.length === 0 ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>
          Sin reglas: todas las islas usan el esquema predeterminado todos los días.
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Aplica a</th>
                <th>Esquema</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((r) => {
                const esq = esquemas.find((e) => e.id === r.esquema_id);
                return (
                  <tr key={r.id}>
                    <td>{describirRegla(r, islas) || 'Todos los días'}</td>
                    <td>
                      {esq?.nombre ?? '—'} <span className="text-ink-soft">· {conteoTurnos(r.esquema_id)} turnos</span>
                    </td>
                    <td style={{ width: 40 }}>
                      {!soloLectura && (
                        <ConfirmarAccion className="icon-btn" pregunta="¿Quitar esta regla?" textoConfirmar="Sí, quitar" onConfirmar={() => quitar(r.id)} ariaLabel="Quitar regla" title="Quitar regla">
                          <Trash2 size={14} />
                        </ConfirmarAccion>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- vista previa

function VistaPrevia({ islas, esquemas, reglas, conteoTurnos }) {
  const inicio = hoyISO();
  const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i));
  const islasActivas = islas.filter((i) => i.activo);

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel__header">
        <h2>Próximos 7 días</h2>
        <span className="panel__hint">cuántos turnos tendrá cada isla según las reglas</span>
      </div>
      <div className="table-scroll">
        <table className="preview-turnos">
          <thead>
            <tr>
              <th>Isla</th>
              {fechas.map((f) => {
                const d = new Date(`${f}T00:00:00`);
                return (
                  <th key={f} className="r">
                    {DIAS_SEMANA[d.getDay()].slice(0, 3)} {d.getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {islasActivas.map((isla) => (
              <tr key={isla.id}>
                <td>Isla {isla.nombre}</td>
                {fechas.map((f) => {
                  const { esquema, regla } = resolverEsquema({ fecha: f, islaId: isla.id, reglas, esquemas });
                  return (
                    <td key={f} className={`r ${regla ? 'preview-turnos__especial' : ''}`} title={`${esquema?.nombre ?? '—'} · ${describirRegla(regla, islas)}`}>
                      <strong>{esquema ? conteoTurnos(esquema.id) : '—'}</strong>
                      <span className="preview-turnos__nombre">{esquema?.nombre ?? 'sin esquema'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pestaña

export default function ConfigTurnosTab({ estacionId, islas, esquemas, turnoTipos, reglas, onCambio, soloLectura }) {
  const [creando, setCreando] = useState(false);
  const turnosActivosDe = (esquemaId) => turnoTipos.filter((t) => t.esquema_id === esquemaId && t.activo);
  const conteoTurnos = (esquemaId) => turnosActivosDe(esquemaId).length;
  const ordenados = esquemas.slice().sort((a, b) => Number(b.es_predeterminado) - Number(a.es_predeterminado) || a.nombre.localeCompare(b.nombre));

  return (
    <>
      <div className="panel">
        <div className="panel__header">
          <h2>Esquemas de turno</h2>
          <InfoTip side="left">
            Un esquema es un conjunto de turnos — por ejemplo 3 turnos de 8 h, o 2 de 12 h. Cada día y cada isla usa un
            esquema: el predeterminado, o el que indiquen las reglas de abajo. Un turno cuya hora de fin es menor o igual a
            la de inicio cruza la medianoche y termina al día siguiente.
          </InfoTip>
          <div style={{ flex: 1 }} />
          {!creando && !soloLectura && (
            <button className="btn btn--accent" onClick={() => setCreando(true)}>
              <Plus size={14} /> Nuevo esquema
            </button>
          )}
        </div>
        <div className="esquemas-grid">
          {creando && (
            <NuevoEsquema
              estacionId={estacionId}
              onCancelar={() => setCreando(false)}
              onCreado={() => {
                setCreando(false);
                onCambio();
              }}
            />
          )}
          {ordenados.map((e) => (
            <EsquemaCard
              key={e.id}
              esquema={e}
              turnos={turnosActivosDe(e.id)}
              reglasDelEsquema={reglas.filter((r) => r.esquema_id === e.id)}
              onCambio={onCambio}
              soloLectura={soloLectura}
            />
          ))}
        </div>
      </div>

      {soloLectura && (
        <div className="subnote subnote--lectura" style={{ marginTop: 16 }}>
          Solo un usuario master puede cambiar los esquemas de turno y sus reglas.
        </div>
      )}
      <Reglas estacionId={estacionId} islas={islas} esquemas={esquemas} reglas={reglas} onCambio={onCambio} conteoTurnos={conteoTurnos} soloLectura={soloLectura} />
      <VistaPrevia islas={islas} esquemas={esquemas} reglas={reglas} conteoTurnos={conteoTurnos} />
    </>
  );
}
