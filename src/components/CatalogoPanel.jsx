import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Power, Check, X } from 'lucide-react';
import { supabase } from '../supabase/client.js';
import ConfirmarAccion from './ConfirmarAccion.jsx';

// Catálogo con CRUD completo (promotores, islas, medios de pago):
//   crear · editar nombre · activar/desactivar · eliminar.
// Eliminar solo se ofrece si el elemento no tiene historia (turnos, ventas,
// ausencias, reglas); si la tiene, se desactiva para no romper la
// trazabilidad. La base de datos aplica las mismas reglas (RLS + triggers).
const DESCRIPCION_USO = {
  promotor: (u) => [u.turnos && `${u.turnos} turno(s)`, u.ventas && `${u.ventas} registro(s) de venta`, u.ausencias && `${u.ausencias} ausencia(s)`],
  isla: (u) => [u.turnos && `${u.turnos} turno(s)`, u.ventas && `${u.ventas} registro(s) de venta`, u.reglas && `${u.reglas} regla(s) de turnos`],
  medio_pago: (u) => [u.ventas && `${u.ventas} registro(s) de venta`],
};

function mensajeError(error) {
  if (error?.code === '23505') return 'Ya existe un registro con ese nombre (sin importar mayúsculas o espacios).';
  if (error?.code === '23503') return 'Tiene registros asociados y no se puede eliminar. Desactívalo en su lugar.';
  if (error?.code === '42501' || /row-level security/i.test(error?.message ?? '')) return 'Tu usuario no tiene permiso para esta acción.';
  return error?.message || 'No se pudo completar la operación.';
}

export default function CatalogoPanel({
  titulo,
  hint,
  tabla,
  tipoUso,
  estacionId,
  items,
  onCambio,
  placeholder,
  soloLectura,
  normalizar = (s) => s,
  etiquetaNombre = 'Nombre',
  notaRenombrar,
  extraAlCrear,
}) {
  const [nuevo, setNuevo] = useState('');
  const [editando, setEditando] = useState(null); // { id, nombre }
  const [uso, setUso] = useState(new Map());
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [verInactivos, setVerInactivos] = useState(true);

  async function cargarUso() {
    const { data } = await supabase.rpc('sjap_uso_catalogos');
    setUso(new Map((data || []).filter((u) => u.tipo === tipoUso).map((u) => [u.id, u])));
  }

  useEffect(() => {
    cargarUso();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function avisar(tipo, texto) {
    setMensaje({ tipo, texto });
    if (tipo === 'ok') setTimeout(() => setMensaje((m) => (m?.texto === texto ? null : m)), 4000);
  }

  const existe = (nombre, exceptoId = null) =>
    items.some((it) => it.id !== exceptoId && it.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());

  async function agregar(e) {
    e?.preventDefault();
    const nombre = normalizar(nuevo.trim());
    if (!nombre) return avisar('error', `Escribe el ${etiquetaNombre.toLowerCase()}.`);
    if (existe(nombre)) return avisar('error', `"${nombre}" ya existe en la lista.`);
    setGuardando(true);
    const { error } = await supabase.from(tabla).insert({ estacion_id: estacionId, nombre, ...(extraAlCrear?.(items) ?? {}) });
    setGuardando(false);
    if (error) return avisar('error', mensajeError(error));
    setNuevo('');
    avisar('ok', `"${nombre}" agregado.`);
    onCambio();
  }

  async function guardarEdicion() {
    const nombre = normalizar(editando.nombre.trim());
    const original = items.find((it) => it.id === editando.id);
    if (!nombre) return avisar('error', `El ${etiquetaNombre.toLowerCase()} no puede quedar vacío.`);
    if (nombre === original.nombre) return setEditando(null);
    if (existe(nombre, editando.id)) return avisar('error', `"${nombre}" ya existe en la lista.`);
    setGuardando(true);
    const { error } = await supabase.from(tabla).update({ nombre }).eq('id', editando.id);
    setGuardando(false);
    if (error) return avisar('error', mensajeError(error));
    setEditando(null);
    avisar('ok', `Renombrado a "${nombre}".`);
    onCambio();
  }

  async function alternar(it) {
    const { error } = await supabase.from(tabla).update({ activo: !it.activo }).eq('id', it.id);
    if (error) return avisar('error', mensajeError(error));
    avisar('ok', `"${it.nombre}" ${it.activo ? 'desactivado' : 'reactivado'}.`);
    onCambio();
  }

  async function eliminar(it) {
    const { error } = await supabase.from(tabla).delete().eq('id', it.id);
    if (error) return avisar('error', mensajeError(error));
    avisar('ok', `"${it.nombre}" eliminado.`);
    onCambio();
  }

  const visibles = items.filter((it) => verInactivos || it.activo);
  const activos = items.filter((it) => it.activo).length;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>{titulo}</h2>
        <span className="panel__hint">{hint ?? `${activos} activo(s) · ${items.length - activos} inactivo(s)`}</span>
      </div>

      {!soloLectura && (
        <form className="catalogo-nuevo" onSubmit={agregar}>
          <input
            className="field-input"
            placeholder={placeholder}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            aria-label={`Nuevo ${etiquetaNombre.toLowerCase()}`}
          />
          <button className="btn btn--accent" type="submit" disabled={guardando || !nuevo.trim()} style={{ flex: 'none' }}>
            <Plus size={15} /> Agregar
          </button>
        </form>
      )}
      {mensaje && (
        <div className={`field-msg field-msg--${mensaje.tipo}`} role={mensaje.tipo === 'error' ? 'alert' : 'status'} style={{ margin: '0 0 12px' }}>
          {mensaje.texto}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">Sin registros todavía.</div>
      ) : (
        <>
          {items.some((it) => !it.activo) && (
            <label className="catalogo-filtro">
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar inactivos
            </label>
          )}
          <div className="table-scroll">
            <table className="catalogo-tabla">
              <thead>
                <tr>
                  <th>{etiquetaNombre}</th>
                  <th>Estado</th>
                  <th>Uso en el historial</th>
                  {!soloLectura && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {visibles.map((it) => {
                  const u = uso.get(it.id);
                  const partes = u ? DESCRIPCION_USO[tipoUso](u).filter(Boolean) : [];
                  const conHistoria = partes.length > 0;
                  const enEdicion = editando?.id === it.id;
                  return (
                    <tr key={it.id} className={it.activo ? '' : 'catalogo-tabla__inactivo'}>
                      <td>
                        {enEdicion ? (
                          <span className="catalogo-editar">
                            <input
                              className="field-input"
                              value={editando.nombre}
                              autoFocus
                              aria-label={`Nuevo nombre para ${it.nombre}`}
                              onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') guardarEdicion();
                                if (e.key === 'Escape') setEditando(null);
                              }}
                            />
                            <button className="icon-btn icon-btn--ok" onClick={guardarEdicion} disabled={guardando} aria-label="Guardar">
                              <Check size={15} />
                            </button>
                            <button className="icon-btn" onClick={() => setEditando(null)} aria-label="Cancelar">
                              <X size={15} />
                            </button>
                          </span>
                        ) : (
                          <strong>{it.nombre}</strong>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge--${it.activo ? 'good' : 'muted'}`}>{it.activo ? 'Activo' : 'Inactivo'}</span>
                      </td>
                      <td className="text-ink-soft" style={{ fontSize: 12 }}>
                        {!u ? '…' : conHistoria ? partes.join(' · ') : 'Sin historial'}
                      </td>
                      {!soloLectura && (
                        <td>
                          <div className="catalogo-acciones">
                            {!enEdicion && (
                              <button
                                className="btn btn--sm"
                                onClick={() => {
                                  setMensaje(null);
                                  setEditando({ id: it.id, nombre: it.nombre });
                                }}
                                title={conHistoria && notaRenombrar ? notaRenombrar : 'Editar nombre'}
                              >
                                <Pencil size={13} /> Editar
                              </button>
                            )}
                            <button className="btn btn--sm" onClick={() => alternar(it)}>
                              <Power size={13} /> {it.activo ? 'Desactivar' : 'Reactivar'}
                            </button>
                            {u && !conHistoria && (
                              <ConfirmarAccion pregunta={`¿Eliminar "${it.nombre}"?`} onConfirmar={() => eliminar(it)} ariaLabel={`Eliminar ${it.nombre}`}>
                                <Trash2 size={13} /> Eliminar
                              </ConfirmarAccion>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!soloLectura && (
            <p className="subnote" style={{ marginTop: 12, marginBottom: 0 }}>
              Solo se puede eliminar lo que nunca se ha usado. Lo que tiene historial se desactiva: deja de aparecer para nuevas
              asignaciones pero se conserva en reportes y cierres.
            </p>
          )}
        </>
      )}
    </div>
  );
}
