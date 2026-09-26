import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { supabase } from '../supabase/client.js';
import { formatFecha, formatNumero } from '../lib/format.js';
import KpiCard from '../components/KpiCard.jsx';
import InfoTip from '../components/InfoTip.jsx';

export default function FacturasPage() {
  const { estacionId } = useEstacion();
  const [facturas, setFacturas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroProducto, setFiltroProducto] = useState('todos');
  const [nueva, setNueva] = useState({ fecha: '', numero_factura: '', producto_id: '', cantidad: '' });
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function cargar() {
    setCargando(true);
    const [{ data: f }, { data: p }] = await Promise.all([
      supabase
        .from('sjap_facturas_compra')
        .select('fecha, numero_factura, cantidad, origen, producto_id, sjap_productos(nombre_visible)')
        .eq('estacion_id', estacionId)
        .order('fecha', { ascending: false }),
      supabase.from('sjap_productos').select('id, nombre_visible').eq('estacion_id', estacionId).eq('activo', true).order('orden'),
    ]);
    setFacturas(f || []);
    setProductos(p || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!estacionId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function registrar() {
    if (!nueva.fecha || !nueva.producto_id || !nueva.cantidad) return;
    setGuardando(true);
    setMensaje(null);
    const { error } = await supabase.from('sjap_facturas_compra').insert({
      estacion_id: estacionId,
      fecha: nueva.fecha,
      numero_factura: nueva.numero_factura.trim() || null,
      producto_id: nueva.producto_id,
      cantidad: Number(nueva.cantidad),
      origen: 'manual',
    });
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message });
      return;
    }
    setNueva({ fecha: '', numero_factura: '', producto_id: '', cantidad: '' });
    cargar();
  }

  const filasAgrupadas = useMemo(() => {
    const porFactura = {};
    for (const f of facturas) {
      if (filtroProducto !== 'todos' && f.producto_id !== filtroProducto) continue;
      const key = `${f.fecha}__${f.numero_factura}`;
      porFactura[key] = porFactura[key] || { fecha: f.fecha, numero_factura: f.numero_factura, items: [] };
      porFactura[key].items.push({ producto: f.sjap_productos?.nombre_visible ?? '—', cantidad: f.cantidad });
    }
    return Object.values(porFactura);
  }, [facturas, filtroProducto]);

  const totalesPorProducto = useMemo(() => {
    const acc = {};
    for (const f of facturas) {
      const nombre = f.sjap_productos?.nombre_visible ?? '—';
      acc[nombre] = (acc[nombre] || 0) + Number(f.cantidad || 0);
    }
    return acc;
  }, [facturas]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <>
      <div className="page-header">
        <h1>Facturas</h1>
        <p>Facturas de compra de combustible al proveedor — recibos de restock, no facturación a clientes.</p>
      </div>

      <div className="subnote" style={{ marginBottom: 16 }}>
        Este módulo registra las facturas de <strong>compra</strong> de combustible (lo que Terpel despacha a la
        estación), tal como en la hoja "Facturas" del Excel de origen — no tiene relación con clientes propios, esos
        se gestionan en el módulo <a href="/clientes-propios">Clientes propios</a>. Las facturas también se pueden
        registrar día a día desde el detalle de cada cierre ("Completar insumos → Facturas").
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <KpiCard label="FACTURAS REGISTRADAS" value={formatNumero(filasAgrupadas.length, 0)} tone="accent" />
        {Object.entries(totalesPorProducto).slice(0, 3).map(([nombre, total]) => (
          <KpiCard key={nombre} label={nombre.toUpperCase()} value={`${formatNumero(total, 0)} gal`} sublabel="recibido histórico" />
        ))}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel__header">
          <h2>Registrar factura</h2>
          <span className="panel__hint">carga puntual — para el día a día usa "Completar insumos"</span>
        </div>
        <div className="field-grid">
          <div className="field-row">
            <label className="field-label">Fecha</label>
            <input className="field-input" type="date" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">N.° factura (opcional)</label>
            <input className="field-input" value={nueva.numero_factura} onChange={(e) => setNueva({ ...nueva, numero_factura: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">Producto</label>
            <select className="select" value={nueva.producto_id} onChange={(e) => setNueva({ ...nueva, producto_id: e.target.value })}>
              <option value="">Selecciona…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre_visible}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label className="field-label">Cantidad (galones)</label>
            <input className="field-input" type="number" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} />
          </div>
          <div className="field-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--accent" onClick={registrar} disabled={guardando}>
              <Plus size={15} /> {guardando ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </div>
        {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2>Historial de facturas</h2>
          <span className="panel__hint">
            {filasAgrupadas.length} recibo(s)
            <InfoTip side="left">
              Las facturas de febrero vienen del Excel con año 2025, mientras el resto del balance está en 2026
              (mismos días calendario) — es una inconsistencia real del archivo original, aún sin confirmar con el
              cliente, y por eso esta lista no se filtra por mes. Las facturas registradas desde ahora en la app sí
              quedan con la fecha correcta.
            </InfoTip>
          </span>
          <select className="select" value={filtroProducto} onChange={(e) => setFiltroProducto(e.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="todos">Todos los productos</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre_visible}
              </option>
            ))}
          </select>
        </div>
        {filasAgrupadas.length === 0 ? (
          <div className="empty-state">Sin facturas registradas.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha (tal cual el archivo)</th>
                  <th>N.° factura</th>
                  <th>Productos recibidos</th>
                </tr>
              </thead>
              <tbody>
                {filasAgrupadas.map((f) => (
                  <tr key={`${f.fecha}-${f.numero_factura}`}>
                    <td className="mono">{formatFecha(f.fecha, { year: 'numeric' })}</td>
                    <td className="mono">{f.numero_factura ?? '—'}</td>
                    <td>{f.items.map((it) => `${it.producto}: ${formatNumero(it.cantidad)} gal`).join(' · ')}</td>
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
