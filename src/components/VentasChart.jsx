import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { formatCOP, formatCOPCorto, formatFecha } from '../lib/format.js';

function TooltipPersonalizado({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const fila = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{formatFecha(label, { weekday: 'short' })}</div>
      <div className="chart-tooltip__row">
        <span>Venta</span>
        <span className="chart-tooltip__value">{formatCOP(fila.venta_total)}</span>
      </div>
      {fila.estado !== 'completo' && <div className="chart-tooltip__alert">● insumos pendientes</div>}
    </div>
  );
}

export default function VentasChart({ cierres, onPointClick }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={300}>
      <AreaChart
        data={cierres}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        onClick={(state) => {
          const fecha = state?.activePayload?.[0]?.payload?.fecha;
          if (fecha && onPointClick) onPointClick(fecha);
        }}
      >
        <defs>
          <linearGradient id="fillVenta" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="fecha"
          tickFormatter={(f) => formatFecha(f)}
          tick={{ fill: 'var(--ink-faint)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
          axisLine={{ stroke: 'var(--line)' }}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={formatCOPCorto}
          tick={{ fill: 'var(--ink-faint)', fontSize: 11, fontFamily: 'IBM Plex Mono' }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<TooltipPersonalizado />} cursor={{ stroke: 'var(--ink-faint)', strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey="venta_total"
          stroke="var(--green)"
          strokeWidth={2}
          fill="url(#fillVenta)"
          dot={{ r: 3, stroke: 'var(--green)', strokeWidth: 1, fill: 'var(--bg)' }}
          activeDot={{ r: 5, cursor: 'pointer' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
