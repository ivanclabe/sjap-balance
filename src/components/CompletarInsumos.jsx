import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client.js';
import { formatNumero } from '../lib/format.js';
import InfoTip from './InfoTip.jsx';

const TABS = [
  { key: 'inventario', label: 'Inventario' },
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'facturas', label: 'Facturas' },
  { key: 'ventas', label: 'Ventas efectivo / QR' },
];

// Recalcula el estado del cierre: completo cuando ya hay lectura de
// inventario para cada producto y efectivo real capturado. Las facturas no
// bloquean el estado — no todos los días llegan facturas de compra.
async function recomputarEstadoCierre(estacionId, fecha) {
  const [{ data: productos }, { data: balance }, { data: cierre }] = await Promise.all([
    supabase.from('sjap_productos').select('id').eq('estacion_id', estacionId),
    supabase.from('sjap_balance_diario_producto').select('producto_id, inventario_final_real').eq('estacion_id', estacionId).eq('fecha', fecha),
    supabase.from('sjap_cierre_diario').select('efectivo_real').eq('estacion_id', estacionId).eq('fecha', fecha).maybeSingle(),
  ]);
  const balancePorProducto = new Map((balance || []).map((b) => [b.producto_id, b]));
  const inventarioCompleto =
    (productos || []).length > 0 && (productos || []).every((p) => balancePorProducto.get(p.id)?.inventario_final_real != null);
  const efectivoCompleto = cierre?.efectivo_real != null;
  const nuevoEstado = inventarioCompleto && efectivoCompleto ? 'completo' : 'pendiente_insumos';
  await supabase.from('sjap_cierre_diario').update({ estado: nuevoEstado }).eq('estacion_id', estacionId).eq('fecha', fecha);
}

export default function CompletarInsumos({ estacionId, fecha, balanceProducto, onGuardado }) {
  const [tab, setTab] = useState('inventario');
  const [productos, setProductos] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [facturasDia, setFacturasDia] = useState([]);

  const [inventarioValores, setInventarioValores] = useState({});
  const [efectivoValor, setEfectivoValor] = useState('');
  const [facturaNumero, setFacturaNumero] = useState('');
  const [facturaCantidades, setFacturaCantidades] = useState({});
  const [ventaCuentaId, setVentaCuentaId] = useState('');
  const [ventaTipo, setVentaTipo] = useState('COMBUSTIBLE');
  const [ventaMonto, setVentaMonto] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    if (!estacionId) return;
    (async () => {
      const [{ data: prods }, { data: ctas }] = await Promise.all([
        supabase.from('sjap_productos').select('id, nombre_visible, orden').eq('estacion_id', estacionId).order('orden'),
        supabase.from('sjap_cuentas_cliente').select('id, nombre').eq('estacion_id', estacionId).order('nombre'),
      ]);
      setProductos(prods || []);
      setCuentas(ctas || []);
      const qr = (ctas || []).find((c) => c.nombre === 'QR');
      if (qr) setVentaCuentaId(qr.id);
    })();
  }, [estacionId]);

  useEffect(() => {
    if (!estacionId || !fecha) return;
    (async () => {
      const { data } = await supabase
        .from('sjap_facturas_compra')
        .select('numero_factura, cantidad, sjap_productos(nombre_visible)')
        .eq('estacion_id', estacionId)
        .eq('fecha', fecha)
        .order('numero_factura');
      setFacturasDia(data || []);
    })();
  }, [estacionId, fecha, mensaje]);

  function avisar(tipo, texto) {
    setMensaje({ tipo, texto });
    setTimeout(() => setMensaje(null), 4000);
  }

  async function guardarInventario() {
    const filas = Object.entries(inventarioValores).filter(([, v]) => v !== '' && v != null);
    if (filas.length === 0) return;
    setGuardando(true);
    try {
      for (const [productoId, valorStr] of filas) {
        const valor = Number(valorStr);
        await supabase
          .from('sjap_lecturas_inventario')
          .insert({ estacion_id: estacionId, producto_id: productoId, fecha, inventario_final_real: valor, origen: 'manual' });

        const { data: fila } = await supabase
          .from('sjap_balance_diario_producto')
          .select('inventario_teorico, precio_vigente')
          .eq('estacion_id', estacionId)
          .eq('producto_id', productoId)
          .eq('fecha', fecha)
          .maybeSingle();

        const inventarioTeorico = Number(fila?.inventario_teorico ?? 0);
        const precioVigente = fila?.precio_vigente != null ? Number(fila.precio_vigente) : null;
        const fluctuacionDia = valor - inventarioTeorico;
        const fluctuacionValor = precioVigente != null ? fluctuacionDia * precioVigente : null;

        const { data: anterior } = await supabase
          .from('sjap_balance_diario_producto')
          .select('fluctuacion_acumulada')
          .eq('estacion_id', estacionId)
          .eq('producto_id', productoId)
          .lt('fecha', fecha)
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle();
        const fluctuacionAcumulada = Number(anterior?.fluctuacion_acumulada ?? 0) + fluctuacionDia;

        await supabase
          .from('sjap_balance_diario_producto')
          .update({
            inventario_final_real: valor,
            fluctuacion_dia: fluctuacionDia,
            fluctuacion_valor: fluctuacionValor,
            fluctuacion_acumulada: fluctuacionAcumulada,
            estado: 'completo',
          })
          .eq('estacion_id', estacionId)
          .eq('producto_id', productoId)
          .eq('fecha', fecha);
      }
      await recomputarEstadoCierre(estacionId, fecha);
      setInventarioValores({});
      avisar('ok', 'Inventario guardado.');
      onGuardado?.();
    } catch (err) {
      avisar('error', err.message || 'No se pudo guardar el inventario.');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEfectivo() {
    if (efectivoValor === '') return;
    setGuardando(true);
    try {
      const valor = Number(efectivoValor);
      await supabase.from('sjap_efectivo_diario').insert({ estacion_id: estacionId, fecha, efectivo_real: valor, origen: 'manual' });
      await supabase.from('sjap_cierre_diario').update({ efectivo_real: valor }).eq('estacion_id', estacionId).eq('fecha', fecha);
      await recomputarEstadoCierre(estacionId, fecha);
      setEfectivoValor('');
      avisar('ok', 'Efectivo real guardado.');
      onGuardado?.();
    } catch (err) {
      avisar('error', err.message || 'No se pudo guardar el efectivo.');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarFactura() {
    const filas = Object.entries(facturaCantidades)
      .filter(([, v]) => v !== '' && v != null && Number(v) > 0)
      .map(([productoId, v]) => ({
        estacion_id: estacionId,
        producto_id: productoId,
        fecha,
        numero_factura: facturaNumero || null,
        cantidad: Number(v),
        origen: 'manual',
      }));
    if (filas.length === 0) return;
    setGuardando(true);
    try {
      await supabase.from('sjap_facturas_compra').insert(filas);
      setFacturaNumero('');
      setFacturaCantidades({});
      avisar('ok', 'Factura registrada.');
      onGuardado?.();
    } catch (err) {
      avisar('error', err.message || 'No se pudo guardar la factura.');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarVenta() {
    if (!ventaCuentaId || ventaMonto === '') return;
    setGuardando(true);
    try {
      await supabase
        .from('sjap_movimientos_cuenta_cliente')
        .insert({ cuenta_id: ventaCuentaId, fecha, tipo: ventaTipo, monto: Number(ventaMonto), origen: 'manual' });
      setVentaMonto('');
      avisar('ok', 'Movimiento registrado.');
      onGuardado?.();
    } catch (err) {
      avisar('error', err.message || 'No se pudo guardar el movimiento.');
    } finally {
      setGuardando(false);
    }
  }

  const balancePorProducto = new Map((balanceProducto || []).map((b) => [b.producto_id, b]));

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Completar insumos manuales</h2>
        <span className="panel__hint">se guardan directo en el sistema, sin volver a subir el archivo</span>
      </div>

      <div className="sheet-tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`sheet-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventario' && (
        <div>
          <p className="field-help">Lectura de tanque al cierre del día (tabla de aforo), por producto.</p>
          <div className="field-grid">
            {productos.map((p) => {
              const actual = balancePorProducto.get(p.id);
              return (
                <div className="field-row" key={p.id}>
                  <label className="field-label">
                    {p.nombre_visible}
                    {actual?.inventario_final_real != null && (
                      <span className="text-good"> · ya capturado ({formatNumero(actual.inventario_final_real)})</span>
                    )}
                  </label>
                  <input
                    className="field-input"
                    type="number"
                    step="0.01"
                    placeholder={actual?.inventario_final_real != null ? String(actual.inventario_final_real) : 'galones'}
                    value={inventarioValores[p.id] ?? ''}
                    onChange={(e) => setInventarioValores((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
          <button className="btn btn--accent" onClick={guardarInventario} disabled={guardando}>
            Guardar inventario
          </button>
        </div>
      )}

      {tab === 'efectivo' && (
        <div>
          <p className="field-help">
            Efectivo contado físicamente al cierre de caja.
            <InfoTip side="right">
              Por ahora solo se guarda el valor contado. La comparación contra el efectivo esperado (diferencia de caja) queda pendiente
              hasta confirmar con el cliente cómo se calcula ese esperado.
            </InfoTip>
          </p>
          <div className="field-grid" style={{ maxWidth: 240 }}>
            <div className="field-row">
              <label className="field-label">Efectivo real (COP)</label>
              <input
                className="field-input"
                type="number"
                step="1"
                placeholder="pesos"
                value={efectivoValor}
                onChange={(e) => setEfectivoValor(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn--accent" onClick={guardarEfectivo} disabled={guardando}>
            Guardar efectivo
          </button>
        </div>
      )}

      {tab === 'facturas' && (
        <div>
          <p className="field-help">Una factura puede traer varios productos — se registra un número de factura y la cantidad recibida por cada uno.</p>

          {facturasDia.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>N.° factura</th>
                    <th>Producto</th>
                    <th className="num">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {facturasDia.map((f, i) => (
                    <tr key={i}>
                      <td className="mono">{f.numero_factura ?? '—'}</td>
                      <td>{f.sjap_productos?.nombre_visible ?? '—'}</td>
                      <td className="num mono">{formatNumero(f.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="field-row" style={{ maxWidth: 240, marginBottom: 14 }}>
            <label className="field-label">N.° de factura</label>
            <input className="field-input" value={facturaNumero} onChange={(e) => setFacturaNumero(e.target.value)} placeholder="ej. 12345" />
          </div>
          <div className="field-grid">
            {productos.map((p) => (
              <div className="field-row" key={p.id}>
                <label className="field-label">{p.nombre_visible}</label>
                <input
                  className="field-input"
                  type="number"
                  step="0.01"
                  placeholder="galones"
                  value={facturaCantidades[p.id] ?? ''}
                  onChange={(e) => setFacturaCantidades((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button className="btn btn--accent" onClick={guardarFactura} disabled={guardando}>
            Registrar factura
          </button>
        </div>
      )}

      {tab === 'ventas' && (
        <div>
          <p className="field-help">Ventas en efectivo por cuenta (incluye QR) — la misma pestaña "Ventas efectivo" que hoy se llena en el Excel.</p>
          <div className="field-grid" style={{ maxWidth: 480 }}>
            <div className="field-row">
              <label className="field-label">Cuenta</label>
              <select className="select field-input" value={ventaCuentaId} onChange={(e) => setVentaCuentaId(e.target.value)}>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Tipo</label>
              <select className="select field-input" value={ventaTipo} onChange={(e) => setVentaTipo(e.target.value)}>
                <option value="COMBUSTIBLE">Combustible</option>
                <option value="UREA">Urea</option>
                <option value="LUBRICANTES">Lubricantes</option>
              </select>
            </div>
            <div className="field-row">
              <label className="field-label">Monto (COP)</label>
              <input className="field-input" type="number" step="1" placeholder="pesos" value={ventaMonto} onChange={(e) => setVentaMonto(e.target.value)} />
            </div>
          </div>
          <button className="btn btn--accent" onClick={guardarVenta} disabled={guardando}>
            Registrar movimiento
          </button>
        </div>
      )}

      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </div>
  );
}
