import { useEffect, useMemo, useRef, useState } from 'react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { supabase } from '../supabase/client.js';
import { formatNumero, nombreMes } from '../lib/format.js';
import { useEstacionConfig } from '../hooks/useEstacionConfig.js';
import KpiCard from '../components/KpiCard.jsx';
import InfoTip from '../components/InfoTip.jsx';
import FreshnessBanner from '../components/FreshnessBanner.jsx';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const DB_COLUMN = {
  ventas: 'ventas',
  compra: 'compra',
  rumbo: 'rumbo',
  clientesPropios: 'clientes_propios',
  clientesPaso: 'clientes_paso',
};

function mesesDelTrimestre(anio, mes) {
  const inicio = Math.floor((mes - 1) / 3) * 3 + 1;
  return [0, 1, 2].map((i) => ({ anio, mes: inicio + i }));
}

export default function PresupuestoPage() {
  const { estacionId } = useEstacion();
  const { config } = useEstacionConfig(estacionId);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [productos, setProductos] = useState([]);
  const [presupuestos, setPresupuestos] = useState([]);
  const [presupuestoProducto, setPresupuestoProducto] = useState([]);
  const [producto, setProducto] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [celdaEditando, setCeldaEditando] = useState(null); // { mes, tipo, key|productoId }
  const [valorEditando, setValorEditando] = useState('');
  const [guardandoCelda, setGuardandoCelda] = useState(null);
  const [sugerenciaTrimestre, setSugerenciaTrimestre] = useState(null);
  const canceladoRef = useRef(false);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const [{ data: prods }, { data: pres }, { data: presProd }, { data: prod }] = await Promise.all([
        supabase.from('sjap_productos').select('id, codigo, nombre_visible, orden').eq('estacion_id', estacionId).eq('activo', true).order('orden'),
        supabase.from('sjap_presupuesto_mensual').select('*').eq('estacion_id', estacionId).eq('anio', anio),
        supabase.from('sjap_presupuesto_producto_mensual').select('*').eq('estacion_id', estacionId).eq('anio', anio),
        supabase
          .from('sjap_balance_diario_producto')
          .select('fecha, producto_id, ventas_galones, recibos_galones')
          .eq('estacion_id', estacionId)
          .gte('fecha', `${anio}-01-01`)
          .lte('fecha', `${anio}-12-31`),
      ]);
      if (!activo) return;
      setProductos(prods || []);
      setPresupuestos(pres || []);
      setPresupuestoProducto(presProd || []);
      setProducto(prod || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, anio]);

  function actualizarLocalMes(mes, campos) {
    setPresupuestos((prev) => {
      const idx = prev.findIndex((p) => p.mes === mes);
      if (idx === -1) return [...prev, { estacion_id: estacionId, anio, mes, ...campos }];
      const copia = [...prev];
      copia[idx] = { ...copia[idx], ...campos };
      return copia;
    });
  }

  function actualizarLocalProducto(mes, productoId, presupuesto) {
    setPresupuestoProducto((prev) => {
      const idx = prev.findIndex((p) => p.mes === mes && p.producto_id === productoId);
      if (idx === -1) return [...prev, { estacion_id: estacionId, producto_id: productoId, anio, mes, presupuesto }];
      const copia = [...prev];
      copia[idx] = { ...copia[idx], presupuesto };
      return copia;
    });
  }

  // Real (ventas/compra) por mes y por producto — clave por producto_id, no por
  // el código hardcodeado del producto, así soporta cualquier catálogo.
  const porProductoMes = useMemo(() => {
    const acc = {};
    for (const r of producto) {
      const mes = Number(r.fecha.slice(5, 7));
      acc[mes] = acc[mes] || {};
      acc[mes][r.producto_id] = acc[mes][r.producto_id] || { ventas: 0, compra: 0 };
      acc[mes][r.producto_id].ventas += Number(r.ventas_galones || 0);
      acc[mes][r.producto_id].compra += Number(r.recibos_galones || 0);
    }
    return acc;
  }, [producto]);

  const presupuestoProductoMes = useMemo(() => {
    const acc = {};
    for (const p of presupuestoProducto) {
      acc[p.mes] = acc[p.mes] || {};
      acc[p.mes][p.producto_id] = Number(p.presupuesto);
    }
    return acc;
  }, [presupuestoProducto]);

  const porMes = useMemo(() => {
    const idx = {};
    for (const p of presupuestos) idx[p.mes] = p;
    const out = {};
    for (let mes = 1; mes <= 12; mes++) {
      const p = idx[mes];
      const ventasTotal = p?.ventas ?? null;
      const presupuestosDelMes = presupuestoProductoMes[mes] || {};
      const presupuestoTotal = Object.values(presupuestosDelMes).reduce((s, v) => s + (v || 0), 0);
      const realDelMes = porProductoMes[mes] || {};

      const porProducto = {};
      for (const prod of productos) {
        const presupuestoProd = presupuestosDelMes[prod.id] ?? null;
        const real = realDelMes[prod.id];
        porProducto[prod.id] = {
          presupuesto: presupuestoProd,
          pctCumplimiento: real && presupuestoProd ? real.compra / presupuestoProd : null,
          pctMezcla: real && ventasTotal ? real.ventas / ventasTotal : null,
        };
      }

      out[mes] = {
        registrado: !!p,
        ventas: p?.ventas ?? null,
        compra: p?.compra ?? null,
        rumbo: p?.rumbo ?? null,
        clientesPropios: p?.clientes_propios ?? null,
        clientesPaso: p?.clientes_paso ?? null,
        presupuestoTotal: presupuestoTotal || null,
        cumplimiento: presupuestoTotal > 0 && p?.compra != null ? p.compra / presupuestoTotal : null,
        pctRumbo: p?.pct_rumbo ?? null,
        pctClientesPropios: p?.pct_clientes_propios ?? null,
        pctClientesPaso: p?.pct_clientes_paso ?? null,
        porProducto,
      };
    }
    return out;
  }, [presupuestos, porProductoMes, presupuestoProductoMes, productos]);

  // Filas de la tabla: las de campo fijo son estáticas, las de producto se
  // generan del catálogo activo — agregar o desactivar un producto cambia esta
  // tabla sin tocar código.
  const filas = useMemo(() => {
    const out = [{ seccion: 'Volumen del mes (galones) — editable' }];
    out.push({ tipo: 'campo', key: 'ventas', label: 'Ventas', dec: 0, editable: true });
    out.push({ tipo: 'campo', key: 'compra', label: 'Compra', dec: 0, editable: true });
    out.push({ tipo: 'campo', key: 'rumbo', label: 'Rumbo', dec: 0, editable: true });
    out.push({ tipo: 'campo', key: 'clientesPropios', label: 'Clientes propios', dec: 0, editable: true });
    out.push({ tipo: 'campo', key: 'clientesPaso', label: 'Clientes de paso', dec: 0, editable: true });

    out.push({ seccion: 'Presupuesto asignado por Terpel (galones) — editable' });
    for (const p of productos) out.push({ tipo: 'presupuesto_producto', productoId: p.id, label: p.nombre_visible, dec: 0, editable: true });
    out.push({ tipo: 'presupuesto_total', label: 'Total', dec: 0, fuerte: true });

    out.push({ seccion: 'Cumplimiento' });
    out.push({ tipo: 'campo', key: 'cumplimiento', label: 'Cumplimiento (compra / presupuesto)', pct: true, semaforo: true });
    out.push({ tipo: 'campo', key: 'pctRumbo', label: '% Rumbo sobre ventas', pct: true });
    out.push({ tipo: 'campo', key: 'pctClientesPropios', label: '% Clientes propios sobre ventas', pct: true });
    out.push({ tipo: 'campo', key: 'pctClientesPaso', label: '% Clientes de paso sobre ventas', pct: true });

    out.push({ seccion: 'Cumplimiento por producto (compra / presupuesto)' });
    for (const p of productos) out.push({ tipo: 'cumplimiento_producto', productoId: p.id, label: p.nombre_visible, pct: true, semaforo: true });

    out.push({ seccion: 'Mezcla de ventas por producto' });
    for (const p of productos) out.push({ tipo: 'mezcla_producto', productoId: p.id, label: p.nombre_visible, pct: true });

    return out;
  }, [productos]);

  function iniciarEdicion(fila, mes, valorActual) {
    canceladoRef.current = false;
    setValorEditando(valorActual != null ? String(valorActual) : '');
    setCeldaEditando({ mes, tipo: fila.tipo, key: fila.key, productoId: fila.productoId });
  }

  async function guardarCeldaCampo(mes, key, rawValue) {
    const dbCol = DB_COLUMN[key];
    const valor = rawValue.trim() === '' ? null : Number(rawValue);
    if (rawValue.trim() !== '' && Number.isNaN(valor)) return;

    const base = presupuestos.find((p) => p.mes === mes) || {};
    const merged = { ...base, [dbCol]: valor };
    const presupuestoTotal = Object.values(presupuestoProductoMes[mes] || {}).reduce((s, v) => s + (v || 0), 0);
    const cumplimiento = presupuestoTotal > 0 && merged.compra != null ? merged.compra / presupuestoTotal : null;
    const ventasNum = merged.ventas;
    const pctRumbo = ventasNum > 0 && merged.rumbo != null ? merged.rumbo / ventasNum : null;
    const pctClientesPropios = ventasNum > 0 && merged.clientes_propios != null ? merged.clientes_propios / ventasNum : null;
    const pctClientesPaso = ventasNum > 0 && merged.clientes_paso != null ? merged.clientes_paso / ventasNum : null;

    const payload = {
      estacion_id: estacionId,
      anio,
      mes,
      ventas: merged.ventas ?? null,
      compra: merged.compra ?? null,
      rumbo: merged.rumbo ?? null,
      clientes_propios: merged.clientes_propios ?? null,
      clientes_paso: merged.clientes_paso ?? null,
      cumplimiento,
      pct_rumbo: pctRumbo,
      pct_clientes_propios: pctClientesPropios,
      pct_clientes_paso: pctClientesPaso,
    };

    setGuardandoCelda({ mes, key });
    const { error } = await supabase.from('sjap_presupuesto_mensual').upsert(payload, { onConflict: 'estacion_id,anio,mes' });
    setGuardandoCelda(null);
    if (error) {
      setSugerenciaTrimestre({ error: error.message || 'No se pudo guardar la celda.' });
      return;
    }
    actualizarLocalMes(mes, payload);
    setSugerenciaTrimestre(null);
  }

  async function guardarCeldaProducto(mes, productoId, rawValue) {
    const valor = rawValue.trim() === '' ? 0 : Number(rawValue);
    if (rawValue.trim() !== '' && Number.isNaN(valor)) return;

    setGuardandoCelda({ mes, productoId });
    const { error } = await supabase
      .from('sjap_presupuesto_producto_mensual')
      .upsert(
        { estacion_id: estacionId, producto_id: productoId, anio, mes, presupuesto: valor },
        { onConflict: 'estacion_id,producto_id,anio,mes' },
      );
    setGuardandoCelda(null);
    if (error) {
      setSugerenciaTrimestre({ error: error.message || 'No se pudo guardar la celda.' });
      return;
    }
    actualizarLocalProducto(mes, productoId, valor);

    const trimestre = mesesDelTrimestre(anio, mes).filter((m) => m.mes !== mes);
    setSugerenciaTrimestre({ mes, productoId, trimestre, valor });
  }

  async function aplicarATrimestre() {
    if (!sugerenciaTrimestre?.trimestre) return;
    const { trimestre, productoId, valor } = sugerenciaTrimestre;
    const { error } = await Promise.all(
      trimestre.map((m) =>
        supabase
          .from('sjap_presupuesto_producto_mensual')
          .upsert(
            { estacion_id: estacionId, producto_id: productoId, anio: m.anio, mes: m.mes, presupuesto: valor },
            { onConflict: 'estacion_id,producto_id,anio,mes' },
          ),
      ),
    ).then((resultados) => ({ error: resultados.find((r) => r.error)?.error }));
    setSugerenciaTrimestre(null);
    if (error) return;
    for (const m of trimestre) actualizarLocalProducto(m.mes, productoId, valor);
  }

  function valorCelda(fila, mes) {
    const datosMes = porMes[mes];
    if (fila.tipo === 'presupuesto_producto') return datosMes.porProducto[fila.productoId]?.presupuesto;
    if (fila.tipo === 'cumplimiento_producto') return datosMes.porProducto[fila.productoId]?.pctCumplimiento;
    if (fila.tipo === 'mezcla_producto') return datosMes.porProducto[fila.productoId]?.pctMezcla;
    if (fila.tipo === 'presupuesto_total') return datosMes.presupuestoTotal;
    return datosMes[fila.key];
  }

  function celda(fila, mes) {
    const v = valorCelda(fila, mes);
    if (v == null) return '—';
    if (fila.pct) return `${formatNumero(v * 100, 1)}%`;
    return formatNumero(v, fila.dec ?? 2);
  }

  function toneClass(fila, mes) {
    if (!fila.semaforo) return '';
    const v = valorCelda(fila, mes);
    if (v == null) return '';
    return v >= config.corte_cumplimiento_presupuesto ? 'text-good' : 'text-danger';
  }

  function celdaJSX(fila, mes) {
    const editando =
      celdaEditando &&
      celdaEditando.mes === mes &&
      celdaEditando.tipo === fila.tipo &&
      (fila.tipo === 'presupuesto_producto' ? celdaEditando.productoId === fila.productoId : celdaEditando.key === fila.key);
    const guardando =
      guardandoCelda &&
      guardandoCelda.mes === mes &&
      (fila.tipo === 'presupuesto_producto' ? guardandoCelda.productoId === fila.productoId : guardandoCelda.key === fila.key);

    if (editando) {
      return (
        <td className="num" key={mes}>
          <input
            className="cell-edit-input"
            type="number"
            autoFocus
            value={valorEditando}
            onChange={(e) => setValorEditando(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                canceladoRef.current = true;
                e.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (canceladoRef.current) {
                canceladoRef.current = false;
                return;
              }
              setCeldaEditando(null);
              if (fila.tipo === 'presupuesto_producto') guardarCeldaProducto(mes, fila.productoId, valorEditando);
              else guardarCeldaCampo(mes, fila.key, valorEditando);
            }}
          />
        </td>
      );
    }

    return (
      <td
        className={`num ${toneClass(fila, mes)} ${fila.editable ? 'cell-editable' : ''} ${guardando ? 'cell-editable--saving' : ''}`}
        key={mes}
        style={fila.fuerte ? { fontWeight: 700 } : undefined}
        onClick={fila.editable && !guardando ? () => iniciarEdicion(fila, mes, valorCelda(fila, mes)) : undefined}
        title={fila.editable ? 'Clic para editar' : undefined}
      >
        {guardando ? '…' : celda(fila, mes)}
      </td>
    );
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  const mesHoy = hoy.getFullYear() === anio ? hoy.getMonth() + 1 : null;
  const mesesConDatos = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => porMes[m].registrado);
  const mesResumen = mesHoy ?? mesesConDatos[mesesConDatos.length - 1] ?? 1;
  const datosResumen = porMes[mesResumen];

  return (
    <>
      <div className="page-header">
        <h1>Presupuesto — {anio}</h1>
        <p>Presupuesto trimestral fijado por Terpel, comparado mes a mes con la compra y venta reales.</p>
      </div>

      <FreshnessBanner estacionId={estacionId} anio={anio} mes={hoy.getMonth() + 1} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <select className="select" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <section className="grid-3" style={{ marginBottom: 16 }}>
        <KpiCard
          label={`VENTAS · ${nombreMes(anio, mesResumen).split(' ')[0].toUpperCase()}`}
          value={datosResumen.ventas != null ? `${formatNumero(datosResumen.ventas, 0)} gal` : '—'}
          sublabel={datosResumen.compra != null ? `compra: ${formatNumero(datosResumen.compra, 0)} gal` : undefined}
          tone="accent"
        />
        <KpiCard
          label="CUMPLIMIENTO"
          value={datosResumen.cumplimiento != null ? `${formatNumero(datosResumen.cumplimiento * 100, 1)}%` : '—'}
          sublabel="compra vs. presupuesto"
          tone={datosResumen.cumplimiento != null ? (datosResumen.cumplimiento >= config.corte_cumplimiento_presupuesto ? 'good' : 'danger') : undefined}
          info="Compra real del mes dividida entre el presupuesto total asignado por Terpel."
        />
        <KpiCard
          label="% CLIENTES DE PASO"
          value={datosResumen.pctClientesPaso != null ? `${formatNumero(datosResumen.pctClientesPaso * 100, 1)}%` : '—'}
          sublabel="del total de ventas"
        />
      </section>

      <div className="panel">
        <div className="panel__header">
          <h2>Presupuesto vs. real — {anio}</h2>
          <span className="panel__hint">hoja "Presupuesto" · mes a mes · {productos.length} producto(s) activo(s)</span>
          <InfoTip side="left">
            Haz clic sobre cualquier celda de "Volumen del mes" o "Presupuesto asignado" para registrarla o editarla
            directamente — no hace falta un formulario aparte. Presiona Enter para guardar o Escape para cancelar.
            Las filas de producto se toman del catálogo de productos activos — agregar o desactivar uno ahí cambia
            esta tabla sin tocar código. El resto de filas se calculan solas.
          </InfoTip>
        </div>

        {sugerenciaTrimestre?.error && (
          <div className="field-msg field-msg--error" style={{ marginBottom: 12 }}>
            {sugerenciaTrimestre.error}
          </div>
        )}

        {sugerenciaTrimestre?.trimestre && (
          <div className="budget-hint" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--green-dim)' }}>
            <span>
              Terpel fija este presupuesto por trimestre — ¿aplicar el mismo valor a{' '}
              {sugerenciaTrimestre.trimestre.map((t) => nombreMes(t.anio, t.mes).split(' ')[0]).join(' y ')}?
            </span>
            <div className="budget-hint__actions">
              <button className="btn btn--accent" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={aplicarATrimestre}>
                Aplicar
              </button>
              <button className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => setSugerenciaTrimestre(null)}>
                Descartar
              </button>
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table className="table--sticky-col">
            <thead>
              <tr>
                <th>Indicador</th>
                {MESES.map((m, i) => (
                  <th className="num" key={m} style={mesHoy === i + 1 ? { color: 'var(--ink)' } : undefined}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) =>
                fila.seccion ? (
                  <tr className="table-section-row" key={`s${i}`}>
                    <td colSpan={13}>{fila.seccion}</td>
                  </tr>
                ) : (
                  <tr key={`${fila.tipo}-${fila.key ?? fila.productoId}`}>
                    <td style={fila.fuerte ? { fontWeight: 700 } : undefined}>{fila.label}</td>
                    {MESES.map((_, mIdx) => celdaJSX(fila, mIdx + 1))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
