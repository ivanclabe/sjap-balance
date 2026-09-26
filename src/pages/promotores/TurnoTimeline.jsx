import { horaCorta, intervalo } from './turnos-util.js';

const MARCAS = [0, 6, 12, 18, 24];

// Barra de 24 h con un segmento por turno. Un turno que cruza la medianoche
// se dibuja en dos tramos (hasta las 24:00 y desde las 00:00).
// `estado(turno)` opcional: 'cubierto' | 'sin-cubrir' para colorear cobertura.
export default function TurnoTimeline({ turnos, estado, compacta = false }) {
  const segmentos = [];
  for (const t of turnos) {
    const [ini, fin] = intervalo(t);
    const tramos = fin <= 1440 ? [[ini, fin]] : [[ini, 1440], [0, fin - 1440]];
    const tono = estado ? estado(t) : 'neutro';
    for (const [a, b] of tramos) segmentos.push({ t, a, b, tono });
  }

  const resumen = turnos.map((t) => `${t.nombre} ${horaCorta(t.hora_inicio)}–${horaCorta(t.hora_fin)}`).join(', ');

  return (
    <div className={`timeline ${compacta ? 'timeline--compacta' : ''}`} role="img" aria-label={`Turnos en 24 horas: ${resumen || 'ninguno'}`}>
      <div className="timeline__barra">
        {segmentos.map(({ t, a, b, tono }, i) => (
          <div
            key={`${t.id ?? t.nombre}-${i}`}
            className={`timeline__seg timeline__seg--${tono}`}
            style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` }}
            title={`${t.nombre}: ${horaCorta(t.hora_inicio)}–${horaCorta(t.hora_fin)}`}
          >
            {!compacta && b - a >= 150 && <span className="timeline__seg-label">{t.nombre}</span>}
          </div>
        ))}
      </div>
      {!compacta && (
        <div className="timeline__marcas" aria-hidden="true">
          {MARCAS.map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
