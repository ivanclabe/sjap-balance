import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import { formatNumero, formatFechaLarga } from '../../lib/format.js';
import KpiCard from '../../components/KpiCard.jsx';

export default function PromotorReporteTab({ estacionId, desde, hasta }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [diaSel, setDiaSel] = useState(null);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_ventas_promotor_turno')
        .select('fecha, promotor_nombre, turno, isla, galones, numero_clientes')
        .eq('estacion_id', estacionId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha');
      if (!activo) return;
      setFilas(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, desde, hasta]);

  const ranking = useMemo(() => {
    const por = {};
    for (const f of filas) {
      const key = f.promotor_nombre;
      por[key] = por[key] || {
        nombre: key,
        galones: 0,
        clientes: 0,
        turnos: 0,
        sumT1T2: 0,
        cntT1T2: 0,
        sumT3: 0,
        cntT3: 0,
        sumT4: 0,
        cntT4: 0,
      };
      const r = por[key];
      const g = Number(f.galones || 0);
      r.galones += g;
      r.clientes += Number(f.numero_clientes || 0);
      r.turnos += 1;
      if (f.turno === 'T1' || f.turno === 'T2') {
        r.sumT1T2 += g;
        r.cntT1T2 += 1;
      } else if (f.turno === 'T3') {
        r.sumT3 += g;
        r.cntT3 += 1;
      } else if (f.turno === 'T4') {
        r.sumT4 += g;
        r.cntT4 += 1;
      }
    }
    return Object.values(por)
      .map((r) => ({
        ...r,
        promT1T2: r.cntT1T2 ? r.sumT1T2 / r.cntT1T2 : null,
        promT3: r.cntT3 ? r.sumT3 / r.cntT3 : null,
        promT4: r.cntT4 ? r.sumT4 / r.cntT4 : null,
      }))
      .sort((a, b) => b.galones - a.galones);
  }, [filas]);

  const dias = useMemo(() => [...new Set(filas.map((f) => f.fecha))].sort(), [filas]);

  useEffect(() => {
    setDiaSel((d) => (d && dias.includes(d) ? d : dias[dias.length - 1] ?? null));
  }, [dias]);

  const detalleDia = useMemo(() => {
    if (!diaSel) return [];
    return filas
      .filter((f) => f.fecha === diaSel)
      .sort((a, b) => (a.turno || '').localeCompare(b.turno || '') || (a.isla || '').localeCompare(b.isla || ''));
  }, [filas, diaSel]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  const totalGalones = ranking.reduce((s, r) => s + r.galones, 0);
  const totalClientes = ranking.reduce((s, r) => s + r.clientes, 0);
  const promedioDiario = dias.length ? totalGalones / dias.length : 0;
  const top = ranking[0];
  const maxGalones = Math.max(1, ...ranking.map((r) => r.galones));
  const idxDia = dias.indexOf(diaSel);

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <KpiCard
          label="GALONES DEL MES"
          value={formatNumero(totalGalones, 0)}
          sublabel={`${ranking.length} promotor(es) activos`}
          tone="accent"
        />
        <KpiCard label="CLIENTES ATENDIDOS" value={formatNumero(totalClientes, 0)} />
        <KpiCard label="PROMEDIO DIARIO" value={`${formatNumero(promedioDiario, 0)} gal`} sublabel={`${dias.length} día(s) con turnos`} />
        <KpiCard
          label="TOP DEL MES"
          value={top ? top.nombre.split('/')[0] : '—'}
          sublabel={top ? `${formatNumero(top.galones, 0)} galones` : undefined}
          tone="good"
        />
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2>Ranking de promotores</h2>
          <span className="panel__hint">galones y clientes del mes · promedio de galones por tipo de turno</span>
        </div>
        <div className="subnote">
          Confirmado con el cliente (sesión del 10 sep 2026): el detalle por turno (T1–T4) e isla lo asigna Javier
          manualmente cada día — el sistema del punto de venta no lo entrega. Ya no hace falta escribirlo en el
          Excel: desde <Link to="/promotores">Promotores</Link> se puede asignar promotor, isla y turno con un
          menú desplegable, tal como lo pidió el cliente.
        </div>
        {ranking.length === 0 ? (
          <div className="empty-state">Sin datos en este período.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Promotor</th>
                  <th className="num">Galones</th>
                  <th className="num">Clientes</th>
                  <th className="num">Prom. T1–T2</th>
                  <th className="num">Prom. T3</th>
                  <th className="num">Prom. T4</th>
                  <th className="num">Turnos</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.nombre}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="rank-row__pos">{String(i + 1).padStart(2, '0')}</span>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.nombre}</div>
                          <div className="rank-bar" style={{ marginTop: 5 }}>
                            <div className="rank-bar__fill" style={{ width: `${(r.galones / maxGalones) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num mono">{formatNumero(r.galones, 0)}</td>
                    <td className="num mono">{formatNumero(r.clientes, 0)}</td>
                    <td className="num mono">{r.promT1T2 != null ? formatNumero(r.promT1T2, 0) : '—'}</td>
                    <td className="num mono">{r.promT3 != null ? formatNumero(r.promT3, 0) : '—'}</td>
                    <td className="num mono">{r.promT4 != null ? formatNumero(r.promT4, 0) : '—'}</td>
                    <td className="num mono">{r.turnos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Detalle por día</h2>
          <span className="panel__hint">isla, turno y galones asignados a cada promotor</span>
        </div>
        {dias.length === 0 ? (
          <div className="empty-state">Sin datos en este período.</div>
        ) : (
          <>
            <div className="turnos-toolbar">
              <div className="turnos-toolbar__fecha">
                <button
                  className="turnos-toolbar__nav"
                  disabled={idxDia <= 0}
                  onClick={() => setDiaSel(dias[idxDia - 1])}
                  aria-label="Día anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <div style={{ fontWeight: 600, fontSize: 13, minWidth: 210, textAlign: 'center', textTransform: 'capitalize' }}>
                  {formatFechaLarga(diaSel)}
                </div>
                <button
                  className="turnos-toolbar__nav"
                  disabled={idxDia >= dias.length - 1}
                  onClick={() => setDiaSel(dias[idxDia + 1])}
                  aria-label="Día siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Turno</th>
                    <th>Isla</th>
                    <th>Promotor</th>
                    <th className="num">Galones</th>
                    <th className="num">Clientes</th>
                  </tr>
                </thead>
                <tbody>
                  {detalleDia.map((f, i) => (
                    <tr key={i}>
                      <td>
                        <span className="badge badge--muted">{f.turno || '—'}</span>
                      </td>
                      <td className="mono">{f.isla || '—'}</td>
                      <td>{f.promotor_nombre}</td>
                      <td className="num mono">{formatNumero(f.galones, 0)}</td>
                      <td className="num mono">{f.numero_clientes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
