import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../supabase/client.js';
import { formatCOP, formatNumero, formatFechaLarga } from '../lib/format.js';
import { useEstacionConfig } from '../hooks/useEstacionConfig.js';
import KpiCard from '../components/KpiCard.jsx';
import InfoTip from '../components/InfoTip.jsx';
import CompletarInsumos from '../components/CompletarInsumos.jsx';

function EditorCierre({ estacionId, fecha, cierre, onGuardado, onCancelar, usuario }) {
  const [ventaTotal, setVentaTotal] = useState(cierre.venta_total ?? '');
  const [ventaGalones, setVentaGalones] = useState(cierre.venta_galones_total ?? '');
  const [numeroClientes, setNumeroClientes] = useState(cierre.numero_clientes ?? '');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function guardar() {
    setMensaje(null);
    const venta = Number(ventaTotal);
    const galones = Number(ventaGalones);
    const clientes = numeroClientes === '' ? null : Number(numeroClientes);
    if (ventaTotal === '' || !Number.isFinite(venta) || venta < 0) return setMensaje({ tipo: 'error', texto: 'La venta total debe ser un número mayor o igual a cero.' });
    if (ventaGalones === '' || !Number.isFinite(galones) || galones < 0) return setMensaje({ tipo: 'error', texto: 'Los galones deben ser un número mayor o igual a cero.' });
    if (clientes != null && (!Number.isInteger(clientes) || clientes < 0)) return setMensaje({ tipo: 'error', texto: 'El número de clientes debe ser un entero mayor o igual a cero.' });

    setGuardando(true);
    const nuevo = { venta_total: venta, venta_galones_total: galones, numero_clientes: clientes };
    const { error } = await supabase.from('sjap_cierre_diario').update(nuevo).eq('estacion_id', estacionId).eq('fecha', fecha);
    if (error) {
      setGuardando(false);
      return setMensaje({ tipo: 'error', texto: error.message || 'No se pudo guardar la corrección.' });
    }
    // Trazabilidad: quién corrigió qué, con el valor anterior.
    await supabase.from('sjap_auditoria').insert({
      estacion_id: estacionId,
      entidad: 'sjap_cierre_diario',
      entidad_id: cierre.id,
      accion: 'correccion_manual',
      nivel: 'warning',
      detalle: {
        fecha,
        antes: { venta_total: cierre.venta_total, venta_galones_total: cierre.venta_galones_total, numero_clientes: cierre.numero_clientes },
        despues: nuevo,
      },
      created_by: usuario?.username ?? null,
    });
    setGuardando(false);
    onGuardado();
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel__header">
        <h2>Corregir valores del cierre</h2>
        <span className="panel__hint">edición manual — usar solo para corregir un error de extracción</span>
      </div>
      <div className="field-grid">
        <div className="field-row">
          <label className="field-label">Venta total (COP)</label>
          <input className="field-input" type="number" value={ventaTotal} onChange={(e) => setVentaTotal(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="field-label">Galones vendidos</label>
          <input className="field-input" type="number" step="0.01" value={ventaGalones} onChange={(e) => setVentaGalones(e.target.value)} />
        </div>
        <div className="field-row">
          <label className="field-label"># Clientes</label>
          <input className="field-input" type="number" value={numeroClientes} onChange={(e) => setNumeroClientes(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--accent" onClick={guardar} disabled={guardando}>
          Guardar
        </button>
        <button className="btn" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </div>
  );
}

export default function DailyBalanceDetailPage() {
  const { fecha } = useParams();
  const { estacionId } = useEstacion();
  const { perfil, esMaster } = useAuth();
  const { config } = useEstacionConfig(estacionId);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [editandoCierre, setEditandoCierre] = useState(false);

  const cargar = useCallback(async () => {
    if (!estacionId || !fecha) return;
    const [cierre, medioPago, promotores, despachos, balanceProducto, archivo] = await Promise.all([
      supabase.from('sjap_cierre_diario').select('*').eq('estacion_id', estacionId).eq('fecha', fecha).maybeSingle(),
      supabase
        .from('sjap_ventas_medio_pago')
        .select('medio_pago, numero_ventas, total_ventas')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha)
        .order('total_ventas', { ascending: false }),
      supabase
        .from('sjap_ventas_promotor_resumen')
        .select('promotor_nombre, numero_ventas, total_ventas')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha)
        .order('total_ventas', { ascending: false }),
      supabase
        .from('sjap_despachos_producto')
        .select('producto_nombre_original, unidad, cantidad, precio, venta_total, producto_id')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha),
      supabase
        .from('sjap_balance_diario_producto')
        .select('producto_id, inventario_inicial, ventas_galones, recibos_galones, inventario_teorico, inventario_final_real, fluctuacion_dia, estado, sjap_productos(nombre_visible)')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha),
      supabase
        .from('sjap_archivos_cierre')
        .select('nombre_archivo, version, estado, procesado_en, created_at')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha)
        .maybeSingle(),
    ]);
    setDatos({
      cierre: cierre.data,
      medioPago: medioPago.data || [],
      promotores: promotores.data || [],
      despachos: despachos.data || [],
      balanceProducto: balanceProducto.data || [],
      archivo: archivo.data,
    });
    setCargando(false);
  }, [estacionId, fecha]);

  useEffect(() => {
    setCargando(true);
    cargar();
  }, [cargar]);

  if (cargando) return <div className="empty-state">Cargando…</div>;
  if (!datos?.cierre) {
    return (
      <>
        <div className="page-header">
          <h1>{formatFechaLarga(fecha)}</h1>
        </div>
        <div className="empty-state">No hay balance cargado para este día en esta estación.</div>
      </>
    );
  }

  const { cierre, medioPago, promotores, despachos, balanceProducto, archivo } = datos;
  const totalMedioPago = medioPago.reduce((s, m) => s + Number(m.total_ventas || 0), 0);

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ textTransform: 'capitalize' }}>{formatFechaLarga(cierre.fecha)}</h1>
          <p>
            <Link to="/diarios">← volver a balances diarios</Link>
          </p>
        </div>
        {!editandoCierre && esMaster && (
          <button className="btn" onClick={() => setEditandoCierre(true)} title="Solo para corregir un error de extracción del archivo">
            <Pencil size={14} /> Corregir valores
          </button>
        )}
      </div>

      {editandoCierre && (
        <EditorCierre
          usuario={perfil}
          estacionId={estacionId}
          fecha={fecha}
          cierre={cierre}
          onGuardado={() => {
            setEditandoCierre(false);
            cargar();
          }}
          onCancelar={() => setEditandoCierre(false)}
        />
      )}

      <section className="grid-3">
        <KpiCard
          label="VENTA TOTAL"
          value={formatCOP(cierre.venta_total)}
          sublabel={`${formatNumero(cierre.venta_galones_total)} galones`}
          tone="accent"
        />
        <KpiCard
          label="EFECTIVO REAL"
          value={cierre.efectivo_real != null ? formatCOP(cierre.efectivo_real) : '—'}
          sublabel={cierre.efectivo_real != null ? 'capturado' : 'pendiente de captura manual'}
          info="Lo que el asistente cuenta físicamente al cierre de caja. La diferencia de caja se muestra cuando el efectivo esperado también esté definido — esa fórmula aún está pendiente de confirmar con el cliente."
        />
        <KpiCard
          label="ESTADO"
          value={cierre.estado === 'completo' ? 'Completo' : 'Insumos pendientes'}
          sublabel={cierre.estado !== 'completo' ? 'falta inventario físico y/o efectivo real' : null}
          tone={cierre.estado === 'completo' ? 'good' : undefined}
          info="Completo = ya se capturó la lectura de inventario de cada producto y el efectivo real contado. Las facturas se registran cuando aplique — no todos los días llegan."
        />
      </section>

      <CompletarInsumos estacionId={estacionId} fecha={fecha} balanceProducto={balanceProducto} onGuardado={cargar} />

      <div className="panel">
        <div className="panel__header">
          <h2>Ventas por medio de pago</h2>
          <span className="panel__hint mono">extraído del archivo diario</span>
        </div>
        {medioPago.length === 0 ? (
          <div className="empty-state">Sin datos.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Medio de pago</th>
                  <th className="num"># ventas</th>
                  <th className="num">Total</th>
                  <th className="num">% del total</th>
                </tr>
              </thead>
              <tbody>
                {medioPago.map((m) => (
                  <tr key={m.medio_pago}>
                    <td>{m.medio_pago}</td>
                    <td className="num mono">{m.numero_ventas}</td>
                    <td className="num mono">{formatCOP(m.total_ventas)}</td>
                    <td className="num mono">{totalMedioPago ? formatNumero((m.total_ventas / totalMedioPago) * 100, 1) : '0'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel__header">
            <h2>Venta por promotor</h2>
          </div>
          {promotores.length === 0 ? (
            <div className="empty-state">Sin datos.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Promotor</th>
                    <th className="num"># ventas</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {promotores.map((p) => (
                    <tr key={p.promotor_nombre}>
                      <td>{p.promotor_nombre}</td>
                      <td className="num mono">{p.numero_ventas}</td>
                      <td className="num mono">{formatCOP(p.total_ventas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2>Inventario por producto</h2>
          </div>
          {balanceProducto.length === 0 ? (
            <div className="empty-state">
              {despachos.length === 0
                ? 'Sin datos.'
                : 'Aún no hay lectura física de inventario para calcular la fluctuación.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Ventas (gal)</th>
                    <th className="num">Teórico</th>
                    <th className="num">Real</th>
                    <th className="num">
                      Fluctuación
                      <InfoTip side="left">Real menos teórico. El combustible se expande y contrae con la temperatura, así que casi nunca da cero.</InfoTip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balanceProducto.map((b) => (
                    <tr key={b.producto_id}>
                      <td>{b.sjap_productos?.nombre_visible ?? '—'}</td>
                      <td className="num mono">{formatNumero(b.ventas_galones)}</td>
                      <td className="num mono">{b.inventario_teorico != null ? formatNumero(b.inventario_teorico) : '—'}</td>
                      <td className="num mono">{b.inventario_final_real != null ? formatNumero(b.inventario_final_real) : '—'}</td>
                      <td className={`num mono ${b.fluctuacion_dia != null && Math.abs(b.fluctuacion_dia) > config.umbral_fluctuacion_galones ? 'text-danger' : ''}`}>
                        {b.fluctuacion_dia != null ? formatNumero(b.fluctuacion_dia) : 'pendiente'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {archivo && (
        <div className="panel">
          <div className="panel__header">
            <h2>Trazabilidad</h2>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>
            Origen: <strong style={{ color: 'var(--ink)' }}>{archivo.nombre_archivo}</strong> (versión {archivo.version}) ·
            procesado el {archivo.procesado_en ? new Date(archivo.procesado_en).toLocaleString('es-CO') : '—'} ·
            estado <span className="badge badge--muted">{archivo.estado}</span>
          </p>
        </div>
      )}
    </>
  );
}
