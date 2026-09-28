import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../supabase/client.js';

export default function ProductosPanel({ estacionId, soloLectura }) {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState({ codigo: '', nombre_visible: '', unidad: 'GALONES' });
  const [editando, setEditando] = useState(null); // id
  const [valores, setValores] = useState({});
  const [mensaje, setMensaje] = useState(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from('sjap_productos').select('*').eq('estacion_id', estacionId).order('orden');
    setProductos(data || []);
    setCargando(false);
  }

  useEffect(() => {
    if (!estacionId) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId]);

  async function agregar() {
    const codigo = nuevo.codigo.trim().toUpperCase();
    const nombreVisible = nuevo.nombre_visible.trim();
    if (!codigo || !nombreVisible) return;
    setMensaje(null);
    const { error } = await supabase.from('sjap_productos').insert({
      estacion_id: estacionId,
      codigo,
      nombre_visible: nombreVisible,
      unidad: nuevo.unidad.trim() || 'GALONES',
      orden: productos.length,
    });
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message });
      return;
    }
    setNuevo({ codigo: '', nombre_visible: '', unidad: 'GALONES' });
    cargar();
  }

  async function toggleActivo(p) {
    const { error } = await supabase.from('sjap_productos').update({ activo: !p.activo }).eq('id', p.id);
    if (error) return setMensaje({ tipo: 'error', texto: error.message });
    cargar();
  }

  function iniciarEdicion(p) {
    setEditando(p.id);
    setValores({ nombre_visible: p.nombre_visible, unidad: p.unidad, orden: p.orden });
  }

  async function guardarEdicion(p) {
    const nombre = valores.nombre_visible.trim();
    if (!nombre) return setMensaje({ tipo: 'error', texto: 'El nombre visible no puede quedar vacío.' });
    const { error } = await supabase
      .from('sjap_productos')
      .update({ nombre_visible: nombre, unidad: valores.unidad.trim() || 'GALONES', orden: Number(valores.orden) || 0 })
      .eq('id', p.id);
    if (error) return setMensaje({ tipo: 'error', texto: error.message });
    setEditando(null);
    cargar();
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Combustibles y productos</h2>
        <span className="panel__hint">catálogo de la estación · el código debe calzar con el nombre que trae el archivo diario</span>
      </div>

      {!soloLectura && (
        <div className="field-grid" style={{ marginBottom: 20 }}>
          <div className="field-row">
            <label className="field-label">Código</label>
            <input className="field-input" placeholder="CORRIENTE" value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} />
          </div>
          <div className="field-row">
            <label className="field-label">Nombre visible</label>
            <input
              className="field-input"
              placeholder="Gasolina Corriente"
              value={nuevo.nombre_visible}
              onChange={(e) => setNuevo({ ...nuevo, nombre_visible: e.target.value })}
            />
          </div>
          <div className="field-row">
            <label className="field-label">Unidad</label>
            <input className="field-input" value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} />
          </div>
          <div className="field-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--accent" onClick={agregar}>
              <Plus size={15} /> Agregar producto
            </button>
          </div>
        </div>
      )}
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}

      {productos.length === 0 ? (
        <div className="empty-state">Sin productos todavía.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre visible</th>
                <th>Unidad</th>
                <th className="num">Orden</th>
                <th>Estado</th>
                {!soloLectura && <th></th>}
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.codigo}</td>
                  <td>
                    {editando === p.id ? (
                      <input
                        className="field-input"
                        value={valores.nombre_visible}
                        onChange={(e) => setValores({ ...valores, nombre_visible: e.target.value })}
                      />
                    ) : (
                      p.nombre_visible
                    )}
                  </td>
                  <td>
                    {editando === p.id ? (
                      <input className="field-input" value={valores.unidad} onChange={(e) => setValores({ ...valores, unidad: e.target.value })} />
                    ) : (
                      p.unidad
                    )}
                  </td>
                  <td className="num">
                    {editando === p.id ? (
                      <input
                        className="field-input"
                        type="number"
                        style={{ width: 64, textAlign: 'right' }}
                        value={valores.orden}
                        onChange={(e) => setValores({ ...valores, orden: e.target.value })}
                      />
                    ) : (
                      p.orden
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge badge--${p.activo ? 'good' : 'muted'}`}
                      style={{ cursor: soloLectura ? 'default' : 'pointer' }}
                      onClick={soloLectura ? undefined : () => toggleActivo(p)}
                    >
                      {p.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {!soloLectura && (
                    <td>
                      {editando === p.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn--accent" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => guardarEdicion(p)}>
                            Guardar
                          </button>
                          <button className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setEditando(null)}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => iniciarEdicion(p)}>
                          Editar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
