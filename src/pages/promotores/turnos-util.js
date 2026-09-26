// Lógica pura de turnos: horarios, cruces de medianoche, superposiciones y
// resolución de qué esquema aplica a una isla en una fecha.

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function minutos(horaStr) {
  if (!horaStr) return 0;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

export function horaCorta(horaStr) {
  return horaStr?.slice(0, 5) ?? '—';
}

export function cruzaMedianoche(t) {
  return minutos(t.hora_fin) <= minutos(t.hora_inicio);
}

// Intervalo en minutos desde la medianoche del día de inicio: [ini, fin) con fin > ini.
export function intervalo(t) {
  const ini = minutos(t.hora_inicio);
  let fin = minutos(t.hora_fin);
  if (fin <= ini) fin += 1440;
  return [ini, fin];
}

export function duracionMin(t) {
  const [ini, fin] = intervalo(t);
  return fin - ini;
}

export function formatDuracion(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function seCruzan([a1, a2], [b1, b2]) {
  return (a1 < b2 && b1 < a2) || (a1 < b2 + 1440 && b1 + 1440 < a2) || (a1 + 1440 < b2 && b1 < a2 + 1440);
}

// Misma regla que valida la base de datos (sjap_validar_turno_tipo), para
// avisar antes de guardar.
export function validarTurnos(turnos) {
  const errores = [];
  const nombres = new Set();
  turnos.forEach((t, i) => {
    const nombre = t.nombre.trim();
    if (!nombre) errores.push(`El turno ${i + 1} no tiene nombre.`);
    else if (nombres.has(nombre.toLowerCase())) errores.push(`Hay dos turnos llamados "${nombre}".`);
    nombres.add(nombre.toLowerCase());
    if (!t.hora_inicio || !t.hora_fin) errores.push(`"${nombre || `Turno ${i + 1}`}" necesita hora de inicio y fin.`);
    else if (minutos(t.hora_inicio) === minutos(t.hora_fin)) errores.push(`"${nombre}" empieza y termina a la misma hora.`);
  });
  for (let i = 0; i < turnos.length; i++) {
    for (let j = i + 1; j < turnos.length; j++) {
      const a = turnos[i];
      const b = turnos[j];
      if (!a.hora_inicio || !a.hora_fin || !b.hora_inicio || !b.hora_fin) continue;
      if (minutos(a.hora_inicio) === minutos(a.hora_fin) || minutos(b.hora_inicio) === minutos(b.hora_fin)) continue;
      if (seCruzan(intervalo(a), intervalo(b))) {
        errores.push(`"${a.nombre}" (${horaCorta(a.hora_inicio)}–${horaCorta(a.hora_fin)}) se cruza con "${b.nombre}" (${horaCorta(b.hora_inicio)}–${horaCorta(b.hora_fin)}).`);
      }
    }
  }
  return errores;
}

// Minutos del día (0–1440) que ningún turno cubre, como tramos [ini, fin).
export function tramosSinCubrir(turnos) {
  const cubierto = new Array(1440).fill(false);
  for (const t of turnos) {
    const [ini, fin] = intervalo(t);
    for (let m = ini; m < fin; m++) cubierto[m % 1440] = true;
  }
  const tramos = [];
  let inicio = null;
  for (let m = 0; m <= 1440; m++) {
    const libre = m < 1440 && !cubierto[m];
    if (libre && inicio === null) inicio = m;
    if (!libre && inicio !== null) {
      tramos.push([inicio, m]);
      inicio = null;
    }
  }
  return tramos;
}

export function minutosAHora(min) {
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function ordenarTurnos(turnos) {
  return turnos.slice().sort((a, b) => minutos(a.hora_inicio) - minutos(b.hora_inicio));
}

function diaSemana(fechaISO) {
  return new Date(`${fechaISO}T00:00:00`).getDay();
}

/**
 * Qué esquema aplica a una isla en una fecha. Gana la regla más específica:
 * fecha+isla, fecha, día+isla, día, isla, y si ninguna aplica, el
 * esquema predeterminado.
 */
export function resolverEsquema({ fecha, islaId, reglas, esquemas }) {
  const dow = diaSemana(fecha);
  const orden = [
    (r) => r.fecha === fecha && r.isla_id === islaId,
    (r) => r.fecha === fecha && !r.isla_id,
    (r) => !r.fecha && r.dia_semana === dow && r.isla_id === islaId,
    (r) => !r.fecha && r.dia_semana === dow && !r.isla_id,
    (r) => !r.fecha && r.dia_semana == null && r.isla_id === islaId,
  ];
  for (const coincide of orden) {
    const regla = reglas.find(coincide);
    if (regla) return { esquema: esquemas.find((e) => e.id === regla.esquema_id) ?? null, regla };
  }
  return { esquema: esquemas.find((e) => e.es_predeterminado) ?? null, regla: null };
}

export function describirRegla(regla, islas) {
  if (!regla) return 'Predeterminado';
  const partes = [];
  if (regla.fecha) {
    const d = new Date(`${regla.fecha}T00:00:00`);
    partes.push(new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }).format(d));
  } else if (regla.dia_semana != null) {
    partes.push(`${DIAS_SEMANA[regla.dia_semana]}s`);
  }
  if (regla.isla_id) partes.push(`Isla ${islas.find((i) => i.id === regla.isla_id)?.nombre ?? '—'}`);
  return partes.join(' · ');
}

// Intervalo absoluto (minutos desde la medianoche de `fechaBase`) de una
// asignación en `fecha` — para detectar superposiciones entre días.
export function intervaloAbsoluto(fecha, fechaBase, turno) {
  const dias = Math.round((new Date(`${fecha}T00:00:00`) - new Date(`${fechaBase}T00:00:00`)) / 86400000);
  const [ini, fin] = intervalo(turno);
  return [dias * 1440 + ini, dias * 1440 + fin];
}

export function intervalosSeSolapan([a1, a2], [b1, b2]) {
  return a1 < b2 && b1 < a2;
}

// Plantillas de arranque para un esquema nuevo (horarios de ejemplo que el
// usuario ajusta antes de guardar).
export const PLANTILLAS = [
  { key: 'unico', label: 'Turno único (06:00–18:00)', turnos: [{ nombre: 'Turno único', hora_inicio: '06:00', hora_fin: '18:00' }] },
  {
    key: '2x12',
    label: '2 turnos de 12 h',
    turnos: [
      { nombre: 'Turno 1', hora_inicio: '00:00', hora_fin: '12:00' },
      { nombre: 'Turno 2', hora_inicio: '12:00', hora_fin: '00:00' },
    ],
  },
  {
    key: '3x8',
    label: '3 turnos de 8 h',
    turnos: [
      { nombre: 'Turno 1', hora_inicio: '00:00', hora_fin: '08:00' },
      { nombre: 'Turno 2', hora_inicio: '08:00', hora_fin: '16:00' },
      { nombre: 'Turno 3', hora_inicio: '16:00', hora_fin: '00:00' },
    ],
  },
  {
    key: '4x6',
    label: '4 turnos de 6 h',
    turnos: [
      { nombre: 'Turno 1', hora_inicio: '00:00', hora_fin: '06:00' },
      { nombre: 'Turno 2', hora_inicio: '06:00', hora_fin: '12:00' },
      { nombre: 'Turno 3', hora_inicio: '12:00', hora_fin: '18:00' },
      { nombre: 'Turno 4', hora_inicio: '18:00', hora_fin: '00:00' },
    ],
  },
  { key: 'vacio', label: 'En blanco', turnos: [] },
];
