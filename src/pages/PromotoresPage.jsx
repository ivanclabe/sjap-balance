import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, AlertTriangle, X, GripVertical, Download, Settings2, Moon } from 'lucide-react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { supabase } from '../supabase/client.js';
import { formatFecha, nombreMes } from '../lib/format.js';
import { exportarExcel } from '../lib/export-excel.js';
import InfoTip from '../components/InfoTip.jsx';
import CatalogoPanel from '../components/CatalogoPanel.jsx';
import ConfigTurnosTab from './promotores/ConfigTurnosTab.jsx';
import TurnoTimeline from './promotores/TurnoTimeline.jsx';
import {
  cruzaMedianoche,
  describirRegla,
  duracionMin,
  formatDuracion,
  horaCorta,
  intervaloAbsoluto,
  intervalosSeSolapan,
  minutos,
  ordenarTurnos,
  resolverEsquema,
} from './promotores/turnos-util.js';

const TABS = [
  { key: 'turnos', label: 'Gestión de turnos' },
  { key: 'config', label: 'Turnos y horarios' },
  { key: 'promotores', label: 'Promotores' },
  { key: 'islas', label: 'Islas' },
  { key: 'ausencias', label: 'Ausencias' },
];

const TIPOS_AUSENCIA = [
  { value: 'dia_libre', label: 'Día libre', tono: 'muted' },
  { value: 'vacaciones', label: 'Vacaciones', tono: 'good' },
  { value: 'incapacidad', label: 'Incapacidad', tono: 'danger' },
  { value: 'permiso', label: 'Permiso', tono: 'accent' },
  { value: 'ausencia', label: 'Ausencia', tono: 'danger' },
];

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sumarDias(fechaISO, delta) {
  const d = new Date(`${fechaISO}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- gestión de turnos

function GestionTurnos({ estacionId, promotores, islas, turnoTipos, esquemas, reglas, onConfigurar }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [asignaciones, setAsignaciones] = useState([]); // fecha-1 … fecha+1
  const [ausentesFecha, setAusentesFecha] = useState([]);
  const [cargandoDia, setCargandoDia] = useState(true);

  const [promotorId, setPromotorId] = useState('');
  const [islaId, setIslaId] = useState('');
  const [turnoTipoId, setTurnoTipoId] = useState('');
  const [mensaje, setMensaje] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [arrastrandoId, setArrastrandoId] = useState(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [descargandoMes, setDescargandoMes] = useState(false);
  const temporizadorMensaje = useRef(null);

  // Muestra un mensaje y lo oculta pasado un rato; un mensaje nuevo reinicia
  // el temporizador para que el anterior no lo borre antes de tiempo.
  function avisar(msg, ms = 5000) {
    clearTimeout(temporizadorMensaje.current);
    setMensaje(msg);
    temporizadorMensaje.current = setTimeout(() => setMensaje(null), ms);
  }
  useEffect(() => () => clearTimeout(temporizadorMensaje.current), []);

  const promotoresActivos = useMemo(() => promotores.filter((p) => p.activo), [promotores]);
  const islasActivas = useMemo(() => islas.filter((i) => i.activo), [islas]);
  const turnoTipoDe = (id) => turnoTipos.find((t) => t.id === id);

  // Esquema y turnos que aplican a cada isla en la fecha seleccionada.
  const planPorIsla = useMemo(() => {
    const mapa = new Map();
    for (const isla of islasActivas) {
      const { esquema, regla } = resolverEsquema({ fecha, islaId: isla.id, reglas, esquemas });
      const turnos = esquema ? ordenarTurnos(turnoTipos.filter((t) => t.esquema_id === esquema.id && t.activo)) : [];
      mapa.set(isla.id, { esquema, regla, turnos });
    }
    return mapa;
  }, [islasActivas, fecha, reglas, esquemas, turnoTipos]);

  const programados = useMemo(() => asignaciones.filter((a) => a.fecha === fecha), [asignaciones, fecha]);

  useEffect(() => {
    setPromotorId((prev) => (promotoresActivos.some((p) => p.id === prev) ? prev : promotoresActivos[0]?.id ?? ''));
  }, [promotoresActivos]);
  useEffect(() => {
    setIslaId((prev) => (islasActivas.some((i) => i.id === prev) ? prev : islasActivas[0]?.id ?? ''));
  }, [islasActivas]);
  const turnosIslaFormulario = planPorIsla.get(islaId)?.turnos ?? [];
  useEffect(() => {
    setTurnoTipoId((prev) => (turnosIslaFormulario.some((t) => t.id === prev) ? prev : turnosIslaFormulario[0]?.id ?? ''));
  }, [turnosIslaFormulario]);

  async function cargarDia() {
    setCargandoDia(true);
    const [{ data: prog }, { data: aus }] = await Promise.all([
      supabase
        .from('sjap_turnos_programados')
        .select('id, fecha, promotor_id, isla_id, turno_tipo_id, estado')
        .eq('estacion_id', estacionId)
        .gte('fecha', sumarDias(fecha, -1))
        .lte('fecha', sumarDias(fecha, 1)),
      supabase
        .from('sjap_ausencias')
        .select('id, promotor_id, tipo, nota')
        .eq('estacion_id', estacionId)
        .lte('fecha_desde', fecha)
        .gte('fecha_hasta', fecha),
    ]);
    setAsignaciones(prog || []);
    setAusentesFecha(aus || []);
    setCargandoDia(false);
  }

  useEffect(() => {
    if (!estacionId || !fecha) return;
    cargarDia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId, fecha]);

  const ausentesIds = useMemo(() => new Set(ausentesFecha.filter((a) => a.tipo !== 'dia_libre').map((a) => a.promotor_id)), [ausentesFecha]);
  const descansoIds = useMemo(() => new Set(ausentesFecha.filter((a) => a.tipo === 'dia_libre').map((a) => a.promotor_id)), [ausentesFecha]);

  const nombrePromotor = (id) => promotores.find((p) => p.id === id)?.nombre ?? '—';
  const nombreIsla = (id) => islas.find((i) => i.id === id)?.nombre ?? '—';

  const cobertura = useMemo(() => {
    const mapa = new Map();
    for (const p of programados) {
      const key = `${p.isla_id}__${p.turno_tipo_id}`;
      if (!mapa.has(key)) mapa.set(key, []);
      mapa.get(key).push(p);
    }
    return mapa;
  }, [programados]);

  const { huecos, totalTurnosIsla } = useMemo(() => {
    let sinCubrir = 0;
    let total = 0;
    for (const isla of islasActivas) {
      for (const tt of planPorIsla.get(isla.id)?.turnos ?? []) {
        total += 1;
        if (!cobertura.get(`${isla.id}__${tt.id}`)?.length) sinCubrir += 1;
      }
    }
    return { huecos: sinCubrir, totalTurnosIsla: total };
  }, [islasActivas, planPorIsla, cobertura]);

  // Esquemas en uso hoy, para el resumen del encabezado.
  const esquemasHoy = useMemo(() => {
    const cuenta = new Map();
    for (const { esquema, turnos } of planPorIsla.values()) {
      if (!esquema) continue;
      cuenta.set(esquema.id, { esquema, turnos: turnos.length, islas: (cuenta.get(esquema.id)?.islas ?? 0) + 1 });
    }
    return [...cuenta.values()];
  }, [planPorIsla]);

  const nombreMesFecha = useMemo(() => {
    const [anio, mes] = fecha.split('-').map(Number);
    return nombreMes(anio, mes);
  }, [fecha]);

  const esHoy = fecha === hoyISO();
  const ahoraMin = useMemo(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, []);

  // Activos ahora: turnos de hoy en curso + turnos de ayer que cruzan la
  // medianoche y aún no terminan.
  const activosAhora = useMemo(() => {
    if (!esHoy) return 0;
    const ayer = sumarDias(fecha, -1);
    const ids = new Set();
    for (const a of asignaciones) {
      if (ausentesIds.has(a.promotor_id)) continue;
      const tt = turnoTipoDe(a.turno_tipo_id);
      if (!tt) continue;
      const ini = minutos(tt.hora_inicio);
      const fin = ini + duracionMin(tt);
      if (a.fecha === fecha && ahoraMin >= ini && ahoraMin < fin) ids.add(a.promotor_id);
      if (a.fecha === ayer && fin > 1440 && ahoraMin < fin - 1440) ids.add(a.promotor_id);
    }
    return ids.size;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignaciones, esHoy, ahoraMin, ausentesIds, fecha, turnoTipos]);

  // Intervalos reales ocupados por cada promotor (ayer, hoy y mañana).
  function ocupacionDe(pPromotorId, excluirId = null) {
    return asignaciones
      .filter((a) => a.promotor_id === pPromotorId && a.id !== excluirId)
      .map((a) => ({ a, tt: turnoTipoDe(a.turno_tipo_id) }))
      .filter(({ tt }) => tt)
      .map(({ a, tt }) => ({ a, tt, rango: intervaloAbsoluto(a.fecha, fecha, tt) }));
  }

  function cruceCon(pPromotorId, tt, excluirId = null) {
    const rango = intervaloAbsoluto(fecha, fecha, tt);
    return ocupacionDe(pPromotorId, excluirId).find((o) => intervalosSeSolapan(o.rango, rango)) ?? null;
  }

  const conflictosAusencia = useMemo(
    () => programados.filter((p) => ausentesIds.has(p.promotor_id) && p.estado !== 'reemplazado'),
    [programados, ausentesIds],
  );

  const disponibles = useMemo(() => promotoresActivos.filter((p) => !ausentesIds.has(p.id)), [promotoresActivos, ausentesIds]);
  const turnosPorPromotor = useMemo(() => {
    const mapa = new Map();
    for (const p of programados) mapa.set(p.promotor_id, (mapa.get(p.promotor_id) ?? 0) + 1);
    return mapa;
  }, [programados]);

  function describirCruce(cruce) {
    const dia = cruce.a.fecha === fecha ? '' : cruce.a.fecha < fecha ? ' (desde ayer)' : ' (mañana)';
    return `isla ${nombreIsla(cruce.a.isla_id)}, ${cruce.tt.nombre} ${horaCorta(cruce.tt.hora_inicio)}–${horaCorta(cruce.tt.hora_fin)}${dia}`;
  }

  async function crearAsignacion(pPromotorId, pIslaId, pTurnoTipoId) {
    const promotor = promotores.find((p) => p.id === pPromotorId);
    const isla = islas.find((i) => i.id === pIslaId);
    const tt = turnoTipoDe(pTurnoTipoId);
    if (!promotor || !isla || !tt) return;

    if (cobertura.get(`${pIslaId}__${pTurnoTipoId}`)?.some((a) => a.promotor_id === pPromotorId)) {
      avisar({ tipo: 'warn', texto: `${promotor.nombre} ya está en isla ${isla.nombre} · ${tt.nombre}.` });
      return;
    }

    // Un cruce de horario no se bloquea: en la operación real un promotor puede
    // cubrir dos islas a la vez (histórico "isla 2 Y 3"), pero se avisa.
    const cruce = cruceCon(pPromotorId, tt);

    const { error } = await supabase.from('sjap_turnos_programados').insert({
      estacion_id: estacionId,
      fecha,
      promotor_id: pPromotorId,
      isla_id: pIslaId,
      turno_tipo_id: pTurnoTipoId,
      estado: 'programado',
    });
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message || 'No se pudo programar el turno.' });
      return;
    }
    avisar(
      cruce
        ? { tipo: 'warn', texto: `${promotor.nombre} quedó en isla ${isla.nombre} · ${tt.nombre}, pero su horario se cruza con ${describirCruce(cruce)}. Revisa si cubre ambas islas a propósito.` }
        : { tipo: 'ok', texto: `${promotor.nombre} programado en isla ${isla.nombre} · ${tt.nombre}.` },
      cruce ? 9000 : 5000,
    );
    cargarDia();
  }

  function registrarTurno() {
    crearAsignacion(promotorId, islaId, turnoTipoId);
  }

  async function eliminarTurno(id) {
    await supabase.from('sjap_turnos_programados').delete().eq('id', id);
    cargarDia();
  }

  async function asignarReemplazo(conflicto, reemplazoId) {
    await supabase.from('sjap_turnos_programados').update({ promotor_id: reemplazoId, estado: 'reemplazado' }).eq('id', conflicto.id);
    cargarDia();
  }

  async function descargarMes() {
    setDescargandoMes(true);
    try {
      const [anioStr, mesStr] = fecha.split('-');
      const anio = Number(anioStr);
      const mes = Number(mesStr);
      const desde = `${anioStr}-${mesStr}-01`;
      const ultimoDia = new Date(anio, mes, 0).getDate();
      const hasta = `${anioStr}-${mesStr}-${String(ultimoDia).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('sjap_turnos_programados')
        .select('fecha, sjap_promotores(nombre), sjap_islas(nombre), sjap_turno_tipos(nombre, hora_inicio, hora_fin, sjap_esquemas_turno(nombre))')
        .eq('estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      if (error) throw error;

      if (!data || data.length === 0) {
        avisar({ tipo: 'error', texto: `No hay turnos programados en ${nombreMes(anio, mes)}.` });
        return;
      }

      const filas = data
        .slice()
        .sort((a, b) => {
          if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
          const isla = (a.sjap_islas?.nombre ?? '').localeCompare(b.sjap_islas?.nombre ?? '', undefined, { numeric: true });
          if (isla !== 0) return isla;
          return (a.sjap_turno_tipos?.hora_inicio ?? '').localeCompare(b.sjap_turno_tipos?.hora_inicio ?? '');
        })
        .map((r) => ({
          Día: formatFecha(r.fecha, { weekday: 'short', year: 'numeric' }),
          Turno: r.sjap_turno_tipos?.nombre ?? '—',
          Horario: `${horaCorta(r.sjap_turno_tipos?.hora_inicio)}–${horaCorta(r.sjap_turno_tipos?.hora_fin)}`,
          Esquema: r.sjap_turno_tipos?.sjap_esquemas_turno?.nombre ?? '—',
          Isla: r.sjap_islas?.nombre ?? '—',
          Promotor: r.sjap_promotores?.nombre ?? '—',
        }));

      exportarExcel(`turnos_${anioStr}-${mesStr}.xlsx`, filas, 'Turnos', [16, 12, 14, 16, 8, 26]);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'No se pudo generar el Excel.' });
    } finally {
      setDescargandoMes(false);
    }
  }

  function soltarEn(key, pIslaId, pTurnoTipoId) {
    return {
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (dragOverKey !== key) setDragOverKey(key);
      },
      onDragLeave: () => setDragOverKey((prev) => (prev === key ? null : prev)),
      onDrop: (e) => {
        e.preventDefault();
        setDragOverKey(null);
        const droppedId = e.dataTransfer.getData('text/promotor-id');
        if (droppedId) crearAsignacion(droppedId, pIslaId, pTurnoTipoId);
      },
    };
  }

  function badgeAsignacion(a) {
    const ausente = ausentesIds.has(a.promotor_id);
    const tt = turnoTipoDe(a.turno_tipo_id);
    const cruce = tt && !ausente ? cruceCon(a.promotor_id, tt, a.id) : null;
    const tono = ausente ? 'danger' : cruce ? 'warn' : 'good';
    return (
      <span
        key={a.id}
        className={`badge badge--removable badge--${tono}`}
        title={ausente ? 'Ausente ese día' : cruce ? `Horario cruzado con ${describirCruce(cruce)}` : undefined}
      >
        {nombrePromotor(a.promotor_id)}
        {ausente ? ' (ausente)' : ''}
        {cruce && <AlertTriangle size={11} aria-label="horario cruzado" />}
        <button className="badge__remove" onClick={() => eliminarTurno(a.id)} aria-label={`Quitar a ${nombrePromotor(a.promotor_id)}`}>
          <X size={11} />
        </button>
      </span>
    );
  }

  return (
    <>
      <div className="turnos-toolbar">
        <div className="turnos-toolbar__fecha">
          <button className="turnos-toolbar__nav" onClick={() => setFecha((f) => sumarDias(f, -1))} aria-label="Día anterior">
            <ChevronLeft size={16} />
          </button>
          <input className="field-input" type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Fecha" />
          <button className="turnos-toolbar__nav" onClick={() => setFecha((f) => sumarDias(f, 1))} aria-label="Día siguiente">
            <ChevronRight size={16} />
          </button>
          {!esHoy && (
            <button className="btn" onClick={() => setFecha(hoyISO())}>
              Hoy
            </button>
          )}
        </div>
        <div className="turnos-toolbar__actions">
          <button className="btn" onClick={descargarMes} disabled={descargandoMes} title={`Descargar turnos de ${nombreMesFecha}`}>
            <Download size={14} /> {descargandoMes ? 'Generando…' : 'Descargar mes'}
          </button>
          <button className="btn" onClick={onConfigurar}>
            <Settings2 size={14} /> Configurar turnos
          </button>
          <InfoTip side="left">
            Cada isla usa el esquema de turnos que le corresponde ese día (se configura en "Turnos y horarios"). Una isla
            sin nadie asignado en un turno es un hueco de cobertura. Una isla puede tener varios promotores en el mismo
            turno. Si un promotor queda con horarios cruzados entre islas, se marca en amarillo. Esto es la programación —
            el balance mensual sigue mostrando lo que realmente pasó.
          </InfoTip>
        </div>
      </div>

      <div className="grid-4" style={{ marginTop: 16, marginBottom: 16 }}>
        <div className="kpi-card">
          <div className="kpi-card__label">PROGRAMADOS</div>
          <div className="kpi-card__value">{new Set(programados.map((p) => p.promotor_id)).size}</div>
        </div>
        <div className="kpi-card kpi-card--accent">
          <div className="kpi-card__label">ACTIVOS AHORA</div>
          <div className="kpi-card__value">{esHoy ? activosAhora : '—'}</div>
          {!esHoy && <div className="kpi-card__sublabel">solo aplica para hoy</div>}
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">DESCANSO / AUSENTES</div>
          <div className="kpi-card__value">
            {descansoIds.size} / {ausentesIds.size}
          </div>
        </div>
        <div className={`kpi-card ${huecos > 0 ? 'kpi-card--danger' : 'kpi-card--good'}`}>
          <div className="kpi-card__label">TURNOS SIN CUBRIR</div>
          <div className="kpi-card__value">{huecos}</div>
          <div className="kpi-card__sublabel">de {totalTurnosIsla} turnos en todas las islas</div>
        </div>
      </div>

      {conflictosAusencia.length > 0 && (
        <div className="alert alert--danger" style={{ marginBottom: 16 }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {conflictosAusencia.length} conflicto(s): promotor ausente pero programado
          </strong>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {conflictosAusencia.map((c) => {
              const tt = turnoTipoDe(c.turno_tipo_id);
              const candidatos = tt
                ? promotoresActivos.filter((p) => p.id !== c.promotor_id && !ausentesIds.has(p.id) && !cruceCon(p.id, tt))
                : [];
              return (
                <div key={c.id} style={{ fontSize: 12.5 }}>
                  <div style={{ marginBottom: 4 }}>
                    <strong>{nombrePromotor(c.promotor_id)}</strong> está ausente pero sigue asignado a isla {nombreIsla(c.isla_id)}, turno {tt?.nombre} (
                    {horaCorta(tt?.hora_inicio)}–{horaCorta(tt?.hora_fin)}).
                  </div>
                  {candidatos.length === 0 ? (
                    <span style={{ color: 'var(--ink-faint)' }}>Nadie libre en ese horario.</span>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>Libres en ese horario:</span>
                      {candidatos.map((cand) => (
                        <button key={cand.id} className="btn btn--sm" onClick={() => asignarReemplazo(c, cand.id)}>
                          Asignar {cand.nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel__header">
          <h2>Asignación del día</h2>
          <span className="panel__hint">{formatFecha(fecha, { weekday: 'long', year: 'numeric' })}</span>
        </div>

        {esquemasHoy.length > 0 && (
          <div className="esquemas-hoy">
            {esquemasHoy.map(({ esquema, turnos: nTurnos, islas: n }) => (
              <span key={esquema.id} className="esquemas-hoy__item">
                <strong>{esquema.nombre}</strong> · {nTurnos} turnos ·{' '}
                {n === islasActivas.length ? 'todas las islas' : `${n} isla(s)`}
              </span>
            ))}
          </div>
        )}

        {islasActivas.length === 0 ? (
          <div className="empty-state">Activa al menos una isla en la pestaña "Islas".</div>
        ) : cargandoDia ? (
          <div className="empty-state">Cargando…</div>
        ) : (
          <div className="turnos-layout">
            <div className="promotores-lista">
              <div className="promotores-lista__header">
                <span className="promotores-lista__title">Disponibles · arrastra a un turno</span>
                <button className="promotores-lista__toggle-form" onClick={() => setMostrarFormulario((v) => !v)}>
                  {mostrarFormulario ? 'Ocultar formulario' : '+ Asignar sin arrastrar'}
                </button>
              </div>
              {disponibles.length === 0 ? (
                <div className="empty-state" style={{ padding: '6px 0', fontSize: 12 }}>
                  Nadie disponible — revisa ausencias o activa promotores.
                </div>
              ) : (
                <div className="promotores-lista__chips">
                  {disponibles.map((p) => (
                    <div
                      key={p.id}
                      className={`promotor-chip ${arrastrandoId === p.id ? 'promotor-chip--dragging' : ''} ${descansoIds.has(p.id) ? 'promotor-chip--descanso' : ''}`}
                      draggable
                      title={descansoIds.has(p.id) ? 'Tiene día libre hoy' : undefined}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/promotor-id', p.id);
                        e.dataTransfer.effectAllowed = 'copy';
                        setArrastrandoId(p.id);
                      }}
                      onDragEnd={() => setArrastrandoId(null)}
                    >
                      <GripVertical size={12} className="promotor-chip__grip" />
                      <span>{p.nombre}</span>
                      {turnosPorPromotor.get(p.id) > 0 && <span className="promotor-chip__count">{turnosPorPromotor.get(p.id)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              {mostrarFormulario && (
                <div className="panel panel--sub" style={{ marginBottom: 16 }}>
                  <div className="field-grid">
                    <div className="field-row">
                      <label className="field-label" htmlFor="as-promotor">Promotor</label>
                      <select id="as-promotor" className="select field-input" value={promotorId} onChange={(e) => setPromotorId(e.target.value)}>
                        {promotoresActivos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-row">
                      <label className="field-label" htmlFor="as-isla">Isla</label>
                      <select id="as-isla" className="select field-input" value={islaId} onChange={(e) => setIslaId(e.target.value)}>
                        {islasActivas.map((i) => (
                          <option key={i.id} value={i.id}>
                            Isla {i.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-row">
                      <label className="field-label" htmlFor="as-turno">Turno</label>
                      <select id="as-turno" className="select field-input" value={turnoTipoId} onChange={(e) => setTurnoTipoId(e.target.value)}>
                        {turnosIslaFormulario.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nombre} ({horaCorta(t.hora_inicio)}–{horaCorta(t.hora_fin)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button className="btn btn--accent" onClick={registrarTurno} disabled={!promotorId || !islaId || !turnoTipoId}>
                    Programar turno
                  </button>
                </div>
              )}

              <div className="islas-grid">
                {islasActivas.map((isla) => {
                  const plan = planPorIsla.get(isla.id);
                  const idsPlan = new Set(plan.turnos.map((t) => t.id));
                  const fueraDeEsquema = programados.filter((p) => p.isla_id === isla.id && !idsPlan.has(p.turno_tipo_id));
                  const cubiertos = plan.turnos.filter((t) => cobertura.get(`${isla.id}__${t.id}`)?.length).length;
                  return (
                    <div key={isla.id} className="isla-card">
                      <div className="isla-card__top">
                        <div className="isla-card__header">Isla {isla.nombre}</div>
                        <span className={`isla-card__estado ${cubiertos === plan.turnos.length && plan.turnos.length ? 'isla-card__estado--ok' : ''}`}>
                          {cubiertos}/{plan.turnos.length} cubiertos
                        </span>
                      </div>
                      <div className="isla-card__esquema">
                        {plan.esquema ? (
                          <>
                            {plan.esquema.nombre} · {plan.turnos.length} turnos
                            {plan.regla && <span className="isla-card__regla"> · por {describirRegla(plan.regla, islas)}</span>}
                          </>
                        ) : (
                          'Sin esquema de turnos'
                        )}
                      </div>

                      <TurnoTimeline
                        compacta
                        turnos={plan.turnos}
                        estado={(t) => (cobertura.get(`${isla.id}__${t.id}`)?.length ? 'cubierto' : 'sin-cubrir')}
                      />

                      {plan.turnos.length === 0 && (
                        <div className="empty-state" style={{ padding: '10px 0', fontSize: 12 }}>
                          El esquema no tiene turnos. <button className="link-btn" onClick={onConfigurar}>Configurar</button>
                        </div>
                      )}

                      {plan.turnos.map((tt) => {
                        const asignados = cobertura.get(`${isla.id}__${tt.id}`) ?? [];
                        const key = `${isla.id}__${tt.id}`;
                        return (
                          <div className={`isla-card__slot ${dragOverKey === key ? 'isla-card__slot--dragover' : ''}`} key={tt.id} {...soltarEn(key, isla.id, tt.id)}>
                            <div className="isla-card__turno-label">
                              <span>{tt.nombre}</span>
                              <span className="mono">
                                {horaCorta(tt.hora_inicio)}–{horaCorta(tt.hora_fin)}
                                {cruzaMedianoche(tt) && <Moon size={10} style={{ marginLeft: 4, verticalAlign: '-1px' }} aria-label="termina al día siguiente" />}
                                <span className="isla-card__dur"> · {formatDuracion(duracionMin(tt))}</span>
                              </span>
                            </div>
                            <div className="isla-card__promotores">
                              {asignados.length === 0 ? <span className="badge badge--danger">sin cobertura</span> : asignados.map(badgeAsignacion)}
                            </div>
                          </div>
                        );
                      })}

                      {fueraDeEsquema.length > 0 && (
                        <div className="isla-card__fuera">
                          <div className="isla-card__fuera-titulo">
                            <AlertTriangle size={12} /> Fuera del esquema de hoy
                          </div>
                          <p>Asignadas antes de cambiar los turnos de este día. Quítalas o reasígnalas.</p>
                          <div className="isla-card__promotores">
                            {fueraDeEsquema.map((a) => {
                              const tt = turnoTipoDe(a.turno_tipo_id);
                              return (
                                <span key={a.id} className="badge badge--removable badge--muted">
                                  {nombrePromotor(a.promotor_id)} · {tt?.nombre} {horaCorta(tt?.hora_inicio)}–{horaCorta(tt?.hora_fin)}
                                  <button className="badge__remove" onClick={() => eliminarTurno(a.id)} aria-label="Quitar">
                                    <X size={11} />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {mensaje && (
          <div className={`field-msg field-msg--${mensaje.tipo}`} style={{ marginTop: 14 }} role="status">
            {mensaje.texto}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- ausencias

function AusenciasTab({ estacionId, promotores }) {
  const [ausencias, setAusencias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const promotoresActivos = useMemo(() => promotores.filter((p) => p.activo), [promotores]);
  const [promotorId, setPromotorId] = useState('');
  const [tipo, setTipo] = useState('dia_libre');
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [nota, setNota] = useState('');
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    setPromotorId((prev) => (promotoresActivos.some((p) => p.id === prev) ? prev : promotoresActivos[0]?.id ?? ''));
  }, [promotoresActivos]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('sjap_ausencias')
      .select('id, promotor_id, fecha_desde, fecha_hasta, tipo, nota')
      .eq('estacion_id', estacionId)
      .gte('fecha_hasta', hoyISO())
      .order('fecha_desde');
    setAusencias(data || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!estacionId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function registrar() {
    if (!promotorId || !desde || !hasta || hasta < desde) {
      setMensaje({ tipo: 'error', texto: 'Revisa las fechas — "hasta" no puede ser anterior a "desde".' });
      return;
    }
    try {
      await supabase.from('sjap_ausencias').insert({
        estacion_id: estacionId,
        promotor_id: promotorId,
        fecha_desde: desde,
        fecha_hasta: hasta,
        tipo,
        nota: nota || null,
      });
      setNota('');
      setMensaje({ tipo: 'ok', texto: 'Ausencia registrada — revisa "Gestión de turnos" en esas fechas por si hay turnos afectados.' });
      setTimeout(() => setMensaje(null), 6000);
      setMostrarFormulario(false);
      cargar();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'No se pudo registrar la ausencia.' });
    }
  }

  async function eliminar(id) {
    await supabase.from('sjap_ausencias').delete().eq('id', id);
    cargar();
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Ausencias</h2>
        <button className="btn btn--accent" onClick={() => setMostrarFormulario((v) => !v)}>
          <Plus size={14} /> Registrar
        </button>
      </div>

      {mostrarFormulario && (
        <div className="panel panel--sub" style={{ marginBottom: 16 }}>
          <div className="field-grid">
            <div className="field-row">
              <label className="field-label">Promotor</label>
              <select className="select field-input" value={promotorId} onChange={(e) => setPromotorId(e.target.value)}>
                {promotoresActivos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Tipo</label>
              <select className="select field-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_AUSENCIA.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Desde</label>
              <input className="field-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="field-row">
              <label className="field-label">Hasta</label>
              <input className="field-input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="field-row">
              <label className="field-label">Nota (opcional)</label>
              <input className="field-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="detalle" />
            </div>
          </div>
          <button className="btn btn--accent" onClick={registrar} disabled={!promotoresActivos.length}>
            Guardar
          </button>
          {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
        </div>
      )}

      {ausencias.length === 0 ? (
        <div className="empty-state">Sin ausencias vigentes ni próximas.</div>
      ) : (
        <div className="ausencia-lista">
          {ausencias.map((a) => {
            const tipoInfo = TIPOS_AUSENCIA.find((t) => t.value === a.tipo);
            const mismoDia = a.fecha_desde === a.fecha_hasta;
            return (
              <div className="ausencia-row" key={a.id}>
                <span className={`badge badge--${tipoInfo?.tono ?? 'muted'}`}>{tipoInfo?.label ?? a.tipo}</span>
                <span className="ausencia-row__nombre">{promotores.find((p) => p.id === a.promotor_id)?.nombre ?? '—'}</span>
                <span className="ausencia-row__fechas mono">
                  {mismoDia ? formatFecha(a.fecha_desde, { year: 'numeric' }) : `${formatFecha(a.fecha_desde)} – ${formatFecha(a.fecha_hasta, { year: 'numeric' })}`}
                </span>
                {a.nota && <span className="ausencia-row__nota">{a.nota}</span>}
                <button className="ausencia-row__eliminar" onClick={() => eliminar(a.id)} title="Eliminar">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- página

export default function PromotoresPage() {
  const { estacionId } = useEstacion();
  const [tab, setTab] = useState('turnos');
  const [promotores, setPromotores] = useState([]);
  const [islas, setIslas] = useState([]);
  const [turnoTipos, setTurnoTipos] = useState([]);
  const [esquemas, setEsquemas] = useState([]);
  const [reglas, setReglas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);

  async function cargarCatalogos() {
    const respuestas = await Promise.all([
      supabase.from('sjap_promotores').select('id, nombre, activo').eq('estacion_id', estacionId).order('nombre'),
      supabase.from('sjap_islas').select('id, nombre, activo').eq('estacion_id', estacionId).order('nombre'),
      supabase
        .from('sjap_turno_tipos')
        .select('id, nombre, hora_inicio, hora_fin, orden, activo, esquema_id')
        .eq('estacion_id', estacionId)
        .order('orden'),
      supabase.from('sjap_esquemas_turno').select('id, nombre, es_predeterminado, created_at').eq('estacion_id', estacionId).order('created_at'),
      supabase.from('sjap_esquema_reglas').select('id, esquema_id, isla_id, dia_semana, fecha').eq('estacion_id', estacionId),
    ]);
    // Si alguna consulta falla (p. ej. un corte de red) se conservan los datos
    // que ya había en pantalla en vez de vaciar los catálogos.
    const fallo = respuestas.find((r) => r.error);
    if (fallo) {
      setErrorCarga(fallo.error.message || 'No se pudieron cargar los datos.');
      return;
    }
    setErrorCarga(null);
    const [{ data: prom }, { data: isl }, { data: tt }, { data: esq }, { data: reg }] = respuestas;
    setPromotores(prom || []);
    setIslas(isl || []);
    setTurnoTipos(tt || []);
    setEsquemas(esq || []);
    setReglas(reg || []);
  }

  useEffect(() => {
    if (!estacionId) return;
    setCargando(true);
    cargarCatalogos().finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function agregarPromotor(nombre) {
    await supabase.from('sjap_promotores').insert({ estacion_id: estacionId, nombre });
    cargarCatalogos();
  }

  async function agregarIsla(nombre) {
    await supabase.from('sjap_islas').insert({ estacion_id: estacionId, nombre });
    cargarCatalogos();
  }

  async function toggleActivo(tabla, item) {
    await supabase.from(tabla).update({ activo: !item.activo }).eq('id', item.id);
    cargarCatalogos();
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <>
      <div className="page-header">
        <h1>Promotores e islas</h1>
        <p>Planifica y controla los turnos día a día — cada isla y cada día pueden tener su propio número de turnos.</p>
      </div>

      <div className="sheet-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`sheet-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {errorCarga && (
        <div className="alert alert--danger" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>No se pudieron actualizar los datos ({errorCarga}). Lo que ves puede estar desactualizado.</span>
          <button className="btn btn--sm" onClick={cargarCatalogos}>
            Reintentar
          </button>
        </div>
      )}

      {tab === 'turnos' && (
        <GestionTurnos
          estacionId={estacionId}
          promotores={promotores}
          islas={islas}
          turnoTipos={turnoTipos}
          esquemas={esquemas}
          reglas={reglas}
          onConfigurar={() => setTab('config')}
        />
      )}

      {tab === 'config' && (
        <ConfigTurnosTab
          estacionId={estacionId}
          islas={islas.filter((i) => i.activo)}
          esquemas={esquemas}
          turnoTipos={turnoTipos}
          reglas={reglas}
          onCambio={cargarCatalogos}
        />
      )}

      {tab === 'promotores' && (
        <CatalogoPanel
          titulo="Promotores"
          hint={`${promotores.filter((p) => p.activo).length} activo(s)`}
          items={promotores}
          onAgregar={agregarPromotor}
          onToggle={(item) => toggleActivo('sjap_promotores', item)}
          placeholder="Nombre del promotor"
        />
      )}

      {tab === 'islas' && (
        <CatalogoPanel
          titulo="Islas"
          hint={`${islas.filter((i) => i.activo).length} activa(s)`}
          items={islas}
          onAgregar={agregarIsla}
          onToggle={(item) => toggleActivo('sjap_islas', item)}
          placeholder="Ej. 1, 2, 3…"
        />
      )}

      {tab === 'ausencias' && <AusenciasTab estacionId={estacionId} promotores={promotores} />}
    </>
  );
}
