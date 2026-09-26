import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ReferenceLine } from 'recharts';
import { formatNumero, formatFecha } from '../lib/format.js';

const COLORES = ['var(--green)', 'var(--amber)', 'var(--red)'];

function TooltipPersonalizado({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{formatFecha(label, { weekday: 'short' })}</div>
      {payload.map((p) => (
        <div className="chart-tooltip__row" key={p.dataKey}>
          <span>{p.name}</span>
          <span className="chart-tooltip__value" style={{ color: p.color }}>
            {formatNumero(p.value)} gal
          </span>
        </div>
      ))}
    </div>
  );
}

// data: [{ fecha, [seriesKey]: valor, ... }], series: [{ key, label }]
export default function FluctuacionChart({ data, series }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="fecha"
          tickFormatter={(f) => formatFecha(f)}
          tick={{ fill: 'var(--ink-faint)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
          axisLine={{ stroke: 'var(--line)' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: 'var(--ink-faint)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <ReferenceLine y={0} stroke="var(--line)" />
        <Tooltip content={<TooltipPersonalizado />} />
        <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'IBM Plex Sans' }} iconType="circle" iconSize={8} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={COLORES[i % COLORES.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
