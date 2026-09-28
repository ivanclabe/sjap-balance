import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatCOP, formatNumero } from '../lib/format.js';
import InfoTip from './InfoTip.jsx';
import ConfirmarAccion from './ConfirmarAccion.jsx';

const TABS = [
  { key: 'inventario', label: 'Inventario' },
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'facturas', label: 'Facturas' },
  { key: 'ventas', label: 'Ventas efectivo / QR' },
];

const TIPOS_MOVIMIENTO = { COMBUSTIBLE: 'Combustible', UREA: 'Urea', LUBRICANTES: 'Lubricantes' };

// Lectura de tanque y efectivo se guardan con funciones de la base de datos
// (sjap_registrar_inventario / sjap_registrar_efectivo): son atómicas,
// permiten corregir un valor ya capturado y recalculan el estado del cierre
// (completo = cada producto ACTIVO con lectura + efectivo real).
export default function CompletarInsumos({ estacionId, fecha, balanceProducto, onGuardado }) {
  const { esMaster } = useAuth();
  const [tab, setTab] = useState('inventario');
  const [productos, setProductos] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [facturasDia, setFacturasDia] = useState([]);
  const [movimientosDia, setMovimientosDia] = useState([]);
  const [recarga, setRecarga] = useState(0);

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
        supabase.from('sjap_productos').select('id, nombre_visible, orden').eq('estacion_id', estacionId).eq('activo', true).order('orden'),
        supabase.from('sjap_cuentas_cliente').select('id, nombre').eq('estacion_id', estacionId).eq('activo', true).order('nombre'),
      ]);
      setProductos(prods || []);
      setCuentas(ctas || []);
      const qr = (ctas || []).find((c) => c.nombre === 'QR');
      if (qr) setVentaCuentaId(qr.id);
      else if (ctas?.length) setVentaCuentaId(ctas[0].id);
    })();
  }, [estacionId]);

  useEffect(() => {
    if (!estacionId || !fecha) return;
    (async () => {
      const [{ data: facturas }, { data: movimientos }] = await Promise.all([
        supabase
          .from('sjap_facturas_compra')
          .select('id, numero_factura, cantidad, origen, sjap_productos(nombre_visible)')
          .eq('estacion_id', estacionId)
          .eq('fecha', fecha)
          .order('numero_factura'),
        supabase
          .from('sjap_movimientos_cuenta_cliente')
          .select('id, tipo, monto, origen, sjap_cuentas_cliente!inner(nombre, estacion_id)')
          .eq('sjap_cuentas_cliente.estacion_id', estacionId)
          .eq('fecha', fecha)
          .order('created_at'),
      ]);
      setFacturasDia(facturas || []);
      setMovimientosDia(movimientos || []);
    })();
  }, [estacionId, fecha, recarga]);

  function avisar(tipo, texto) {
    setMensaje({ tipo, texto });
    if (tipo === 'ok') setTimeout(() => setMensaje((m) => (m?.texto === texto ? null : m)), 4000);
  }

  function terminar(texto) {
    avisar('ok', texto);
    setRecarga((n) => n + 1);
    onGuardado?.();
  }

  async function ejecutar(fn, textoOk) {
    setGuardando(true);
    setMensaje(null);
    const { error } = await fn();
    setGuardando(false);
    if (error) {
      avisar('error', error.message || 'No se pudo guardar.');
      return false;
    }
    terminar(textoOk);
    return true;
  }

  async function guardarInventario() {
    const lecturas = Object.entries(inventarioValores)
      .filter(([, v]) => v !== '' && v != null)
      .map(([producto_id, v]) => ({ producto_id, valor: Number(v) }));
    if (lecturas.length === 0) return avisar('error', 'Escribe al menos una lectura.');
    if (lecturas.some((l) => !Number.isFinite(l.valor) || l.valor < 0)) {
      return avisar('error', 'Las lecturas deben ser números mayores o iguales a cero.');
    }
    const ok = await ejecutar(() => supabase.rpc('sjap_registrar_inventario', { p_fecha: fecha, p_lecturas: lecturas }), 'Inventario guardado.');
    if (ok) setInventarioValores({});
  }

  async function guardarEfectivo() {
    const valor = Number(efectivoValor);
    if (efectivoValor === '' || !Number.isFinite(valor) || valor < 0) return avisar('error', 'Escribe un valor en pesos mayor o igual a cero.');
    const ok = await ejecutar(() => supabase.rpc('sjap_registrar_efectivo', { p_fecha: fecha, p_efectivo: valor }), 'Efectivo real guardado.');
    if (ok) setEfectivoValor('');
  }

  async function guardarFactura() {
    const entradas = Object.entries(facturaCantidades).filter(([, v]) => v !== '' && v != null);
    if (entradas.some(([, v]) => !(Number(v) > 0))) return avisar('error', 'Las cantidades deben ser mayores que cero.');
    if (entradas.length === 0) return avisar('error', 'Escribe la cantidad recibida de al menos un producto.');
    const numero = facturaNumero.trim() || null;
    if (numero && facturasDia.some((f) => f.numero_factura === numero)) {
      return avisar('error', `La factura ${numero} ya está registrada para este día.`);
    }
    const filas = entradas.map(([productoId, v]) => ({
      estacion_id: estacionId,
      producto_id: productoId,
      fecha,
      numero_factura: numero,
      cantidad: Number(v),
      origen: 'manual',
    }));
    const ok = await ejecutar(() => supabase.from('sjap_facturas_compra').insert(filas), 'Factura registrada.');
    if (ok) {
      setFacturaNumero('');
      setFacturaCantidades({});
    }
  }

  async function guardarVenta() {
    const monto = Number(ventaMonto);
    if (!ventaCuentaId) return avisar('error', 'Elige la cuenta.');
    if (ventaMonto === '' || !(monto > 0)) return avisar('error', 'El monto debe ser mayor que cero.');
    const ok = await ejecutar(
      () => supabase.from('sjap_movimientos_cuenta_cliente').insert({ cuenta_id: ventaCuentaId, fecha, tipo: ventaTipo, monto, origen: 'manual' }),
      'Movimiento registrado.',
    );
    if (ok) setVentaMonto('');
  }

  async function eliminarRegistro(tabla, id, texto) {
    await ejecutar(() => supabase.from(tabla).delete().eq('id', id), texto);
  }

  const balancePorProducto = new Map((balanceProducto || []).map((b) => [b.producto_id, b]));
  const puedeBorrar = (fila) => esMaster && fila.origen === 'manual';

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
          <p className="field-help">Lectura de tanque al cierre del día (tabla de aforo), por producto. Si ya hay una lectura, la nueva la reemplaza.</p>
          <div className="field-grid">
            {productos.map((p) => {
              const actual = balancePorProducto.get(p.id);
              return (
                <div className="field-row" key={p.id}>
                  <label className="field-label" htmlFor={`inv-${p.id}`}>
                    {p.nombre_visible}
                    {actual?.inventario_final_real != null && <span className="text-good"> · capturado ({formatNumero(actual.inventario_final_real)})</span>}
                  </label>
                  <input
                    id={`inv-${p.id}`}
                    className="field-input"
                    type="number"
                    min="0"
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
            {guardando ? 'Guardando…' : 'Guardar inventario'}
          </button>
        </div>
      )}

      {tab === 'efectivo' && (
        <div>
          <p className="field-help">
            Efectivo contado físicamente al cierre de caja. Si ya había un valor, el nuevo lo reemplaza.
            <InfoTip side="right">
              Por ahora solo se guarda el valor contado. La comparación contra el efectivo esperado (diferencia de caja) queda pendiente
              hasta confirmar con el cliente cómo se calcula ese esperado.
            </InfoTip>
          </p>
          <div className="field-grid" style={{ maxWidth: 240 }}>
            <div className="field-row">
              <label className="field-label" htmlFor="ef-valor">Efectivo real (COP)</label>
              <input id="ef-valor" className="field-input" type="number" min="0" step="1" placeholder="pesos" value={efectivoValor} onChange={(e) => setEfectivoValor(e.target.value)} />
            </div>
          </div>
          <button className="btn btn--accent" onClick={guardarEfectivo} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar efectivo'}
          </button>
        </div>
      )}

      {tab === 'facturas' && (
        <div>
          <p className="field-help">Una factura puede traer varios productos: se registra un número de factura y la cantidad recibida por cada uno.</p>

          {facturasDia.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>N.° factura</th>
                    <th>Producto</th>
                    <th className="num">Cantidad</th>
                    <th>Origen</th>
                    {esMaster && <th aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {facturasDia.map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{f.numero_factura ?? '—'}</td>
                      <td>{f.sjap_productos?.nombre_visible ?? '—'}</td>
                      <td className="num mono">{formatNumero(f.cantidad)}</td>
                      <td className="text-ink-soft">{f.origen}</td>
                      {esMaster && (
                        <td>
                          {puedeBorrar(f) && (
                            <ConfirmarAccion className="icon-btn" pregunta="¿Eliminar esta línea de factura?" onConfirmar={() => eliminarRegistro('sjap_facturas_compra', f.id, 'Línea de factura eliminada.')} ariaLabel="Eliminar línea de factura">
                              <Trash2 size={14} />
                            </ConfirmarAccion>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="field-row" style={{ maxWidth: 240, marginBottom: 14 }}>
            <label className="field-label" htmlFor="fa-numero">N.° de factura</label>
            <input id="fa-numero" className="field-input" value={facturaNumero} onChange={(e) => setFacturaNumero(e.target.value)} placeholder="ej. 12345" />
          </div>
          <div className="field-grid">
            {productos.map((p) => (
              <div className="field-row" key={p.id}>
                <label className="field-label" htmlFor={`fa-${p.id}`}>{p.nombre_visible}</label>
                <input
                  id={`fa-${p.id}`}
                  className="field-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="galones"
                  value={facturaCantidades[p.id] ?? ''}
                  onChange={(e) => setFacturaCantidades((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <button className="btn btn--accent" onClick={guardarFactura} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Registrar factura'}
          </button>
        </div>
      )}

      {tab === 'ventas' && (
        <div>
          <p className="field-help">Ventas en efectivo por cuenta (incluye QR), la misma pestaña "Ventas efectivo" que hoy se llena en el Excel.</p>

          {movimientosDia.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Tipo</th>
                    <th className="num">Monto</th>
                    <th>Origen</th>
                    {esMaster && <th aria-label="Acciones" />}
                  </tr>
                </thead>
                <tbody>
                  {movimientosDia.map((m) => (
                    <tr key={m.id}>
                      <td>{m.sjap_cuentas_cliente?.nombre ?? '—'}</td>
                      <td>{TIPOS_MOVIMIENTO[m.tipo] ?? m.tipo}</td>
                      <td className="num mono">{formatCOP(m.monto)}</td>
                      <td className="text-ink-soft">{m.origen}</td>
                      {esMaster && (
                        <td>
                          {puedeBorrar(m) && (
                            <ConfirmarAccion className="icon-btn" pregunta="¿Eliminar este movimiento?" onConfirmar={() => eliminarRegistro('sjap_movimientos_cuenta_cliente', m.id, 'Movimiento eliminado.')} ariaLabel="Eliminar movimiento">
                              <Trash2 size={14} />
                            </ConfirmarAccion>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="field-grid" style={{ maxWidth: 480 }}>
            <div className="field-row">
              <label className="field-label" htmlFor="mv-cuenta">Cuenta</label>
              <select id="mv-cuenta" className="select field-input" value={ventaCuentaId} onChange={(e) => setVentaCuentaId(e.target.value)}>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="mv-tipo">Tipo</label>
              <select id="mv-tipo" className="select field-input" value={ventaTipo} onChange={(e) => setVentaTipo(e.target.value)}>
                {Object.entries(TIPOS_MOVIMIENTO).map(([valor, texto]) => (
                  <option key={valor} value={valor}>
                    {texto}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="mv-monto">Monto (COP)</label>
              <input id="mv-monto" className="field-input" type="number" min="0" step="1" placeholder="pesos" value={ventaMonto} onChange={(e) => setVentaMonto(e.target.value)} />
            </div>
          </div>
          <button className="btn btn--accent" onClick={guardarVenta} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Registrar movimiento'}
          </button>
        </div>
      )}

      {mensaje && (
        <div className={`field-msg field-msg--${mensaje.tipo}`} role={mensaje.tipo === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </div>
      )}
    </div>
  );
}
