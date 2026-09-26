import { Fragment, useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import { formatCOP, formatFecha } from '../../lib/format.js';

function HistorialCliente({ cuentaId }) {
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_movimientos_cuenta_cliente')
        .select('fecha, tipo, monto, origen')
        .eq('cuenta_id', cuentaId)
        .order('fecha', { ascending: false })
        .limit(200);
      setMovimientos(data || []);
      setCargando(false);
    })();
  }, [cuentaId]);

  if (cargando) return <div className="empty-state">Cargando historial…</div>;
  if (movimientos.length === 0) return <div className="empty-state">Sin movimientos registrados para este cliente.</div>;

  const total = movimientos.reduce((s, m) => s + Number(m.monto || 0), 0);

  return (
    <div style={{ padding: '4px 0 12px' }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginBottom: 10 }}>
        {movimientos.length} movimiento(s) · {formatCOP(total)} acumulado (últimos 200)
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th className="num">Monto</th>
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m, i) => (
              <tr key={i}>
                <td className="mono">{formatFecha(m.fecha, { year: 'numeric' })}</td>
                <td>{m.tipo}</td>
                <td className="num">{formatCOP(m.monto)}</td>
                <td>
                  <span className="badge badge--muted">{m.origen}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GestionClientesPanel({ estacionId, soloLectura }) {
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState({ nombre: '', nit: '' });
  const [expandido, setExpandido] = useState(null);
  const [editando, setEditando] = useState(null);
  const [valores, setValores] = useState({});
  const [mensaje, setMensaje] = useState(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from('sjap_cuentas_cliente').select('*').eq('estacion_id', estacionId).order('nombre');
    setClientes(data || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!estacionId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function agregar() {
    const nombre = nuevo.nombre.trim();
    if (!nombre) return;
    setMensaje(null);
    const { error } = await supabase.from('sjap_cuentas_cliente').insert({ estacion_id: estacionId, nombre, nit: nuevo.nit.trim() || null });
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message });
      return;
    }
    setNuevo({ nombre: '', nit: '' });
    cargar();
  }

  async function toggleActivo(c) {
    await supabase.from('sjap_cuentas_cliente').update({ activo: !c.activo }).eq('id', c.id);
    cargar();
  }

  function iniciarEdicion(c) {
    setEditando(c.id);
    setValores({ nombre: c.nombre, nit: c.nit ?? '' });
  }

  async function guardarEdicion(c) {
    await supabase.from('sjap_cuentas_cliente').update({ nombre: valores.nombre, nit: valores.nit || null }).eq('id', c.id);
    setEditando(null);
    cargar();
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Clientes propios — catálogo</h2>
        <span className="panel__hint">cuentas corporativas de crédito · {clientes.length} registrado(s)</span>
      </div>

      {!soloLectura && (
        <div className="field-grid" style={{ marginBottom: 20 }}>
          <div className="field-row">
            <label className="field-label">Nombre</label>
            <input className="field-input" placeholder="Nombre del cliente" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">NIT (opcional)</label>
            <input className="field-input" value={nuevo.nit} onChange={(e) => setNuevo({ ...nuevo, nit: e.target.value })} />
          </div>
          <div className="field-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--accent" onClick={agregar}>
              <Plus size={15} /> Agregar cliente
            </button>
          </div>
        </div>
      )}
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}

      {clientes.length === 0 ? (
        <div className="empty-state">Sin clientes registrados todavía.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Nombre</th>
                <th>NIT</th>
                <th>Estado</th>
                {!soloLectura && <th></th>}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <Fragment key={c.id}>
                  <tr className="clickable" onClick={() => setExpandido(expandido === c.id ? null : c.id)}>
                    <td style={{ width: 20 }}>{expandido === c.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td onClick={(e) => editando === c.id && e.stopPropagation()}>
                      {editando === c.id ? (
                        <input className="field-input" value={valores.nombre} onClick={(e) => e.stopPropagation()} onChange={(e) => setValores({ ...valores, nombre: e.target.value })} />
                      ) : (
                        c.nombre
                      )}
                    </td>
                    <td onClick={(e) => editando === c.id && e.stopPropagation()}>
                      {editando === c.id ? (
                        <input className="field-input" value={valores.nit} onClick={(e) => e.stopPropagation()} onChange={(e) => setValores({ ...valores, nit: e.target.value })} />
                      ) : (
                        c.nit ?? '—'
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span
                        className={`badge badge--${c.activo ? 'good' : 'muted'}`}
                        style={{ cursor: soloLectura ? 'default' : 'pointer' }}
                        onClick={soloLectura ? undefined : () => toggleActivo(c)}
                      >
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {!soloLectura && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {editando === c.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn--accent" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => guardarEdicion(c)}>
                              Guardar
                            </button>
                            <button className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditando(null)}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => iniciarEdicion(c)}>
                            Editar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {expandido === c.id && (
                    <tr>
                      <td colSpan={soloLectura ? 4 : 5} style={{ background: 'var(--surface-2)' }}>
                        <HistorialCliente cuentaId={c.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
