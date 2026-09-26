import { useNavigate } from 'react-router-dom';
import { formatCOP, formatNumero, formatFecha } from '../../lib/format.js';
import { useEstacionConfig } from '../../hooks/useEstacionConfig.js';
import KpiCard from '../../components/KpiCard.jsx';
import InfoTip from '../../components/InfoTip.jsx';

function diasEnMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

export default function ResumenTab({ cierres, anio, mes, estacionId }) {
  const navigate = useNavigate();
  const { config } = useEstacionConfig(estacionId);
  const totalDias = diasEnMes(anio, mes);
  const ventaTotal = cierres.reduce((s, c) => s + Number(c.venta_total || 0), 0);
  const galonesTotal = cierres.reduce((s, c) => s + Number(c.venta_galones_total || 0), 0);
  const completos = cierres.filter((c) => c.estado === 'completo').length;

  return (
    <>
      <section className="grid-4">
        <KpiCard label="VENTA DEL MES" value={formatCOP(ventaTotal)} sublabel={`${formatNumero(galonesTotal)} galones`} tone="accent" />
        <KpiCard label="DÍAS PROCESADOS" value={`${cierres.length}/${totalDias}`} sublabel={`${totalDias - cierres.length} día(s) sin cargar`} />
        <KpiCard label="PROMEDIO DIARIO" value={formatCOP(cierres.length ? ventaTotal / cierres.length : 0)} />
        <KpiCard
          label="CIERRES COMPLETOS"
          value={completos}
          sublabel="con inventario y efectivo confirmados"
          tone={completos === cierres.length && cierres.length > 0 ? 'good' : undefined}
          info="Días donde ya se capturó la lectura de inventario y el efectivo real, no solo lo que trae el archivo. Las facturas se registran aparte cuando aplique."
        />
      </section>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Detalle por día</h2>
          <span className="panel__hint">clic para ver el balance diario</span>
        </div>
        {cierres.length === 0 ? (
          <div className="empty-state">No hay balances diarios cargados en este período.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th className="num">Venta</th>
                  <th className="num">Galones</th>
                  <th className="num"># Clientes</th>
                  <th className="num">
                    Diferencia caja
                    <InfoTip side="left">Efectivo calculado menos efectivo real contado.</InfoTip>
                  </th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.fecha} className="clickable" onClick={() => navigate(`/diarios/${c.fecha}`)}>
                    <td className="mono">{formatFecha(c.fecha, { weekday: 'short' })}</td>
                    <td className="num">{formatCOP(c.venta_total)}</td>
                    <td className="num">{formatNumero(c.venta_galones_total)}</td>
                    <td className="num">{c.numero_clientes ?? '—'}</td>
                    <td className={`num ${c.diferencia_caja != null && Math.abs(c.diferencia_caja) > config.umbral_diferencia_caja_cop ? 'text-danger' : ''}`}>
                      {c.diferencia_caja != null ? formatCOP(c.diferencia_caja) : '—'}
                    </td>
                    <td>
                      <span className={`badge badge--${c.estado === 'completo' ? 'good' : 'accent'}`}>{c.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
