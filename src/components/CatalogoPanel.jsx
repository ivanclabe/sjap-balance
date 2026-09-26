import { useState } from 'react';
import { Plus } from 'lucide-react';

// Catálogo genérico activar/desactivar (nombre único) — usado por Promotores,
// Islas, y el Centro de Configuración (Medios de pago).
export default function CatalogoPanel({ titulo, hint, items, onAgregar, onToggle, placeholder, soloLectura }) {
  const [nuevo, setNuevo] = useState('');
  const activos = items.filter((it) => it.activo);
  const inactivos = items.filter((it) => !it.activo);

  async function agregar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    await onAgregar(nombre);
    setNuevo('');
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>{titulo}</h2>
        <span className="panel__hint">{hint}</span>
      </div>

      {!soloLectura && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <input
            className="field-input"
            placeholder={placeholder}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
          />
          <button className="btn btn--accent" onClick={agregar} style={{ flex: 'none' }}>
            <Plus size={15} /> Agregar
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">Sin registros todavía.</div>
      ) : (
        <>
          <div className="catalogo-grupo">
            <span className="catalogo-grupo__label">Activos · {activos.length}</span>
            <div className="pill-list">
              {activos.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>Ninguno activo.</span>
              ) : (
                activos.map((it) => (
                  <span
                    key={it.id}
                    className="badge badge--good"
                    style={{ cursor: soloLectura ? 'default' : 'pointer' }}
                    onClick={soloLectura ? undefined : () => onToggle(it)}
                    title={soloLectura ? undefined : 'Clic para desactivar'}
                  >
                    {it.nombre}
                  </span>
                ))
              )}
            </div>
          </div>

          {inactivos.length > 0 && (
            <div className="catalogo-grupo" style={{ marginTop: 16 }}>
              <span className="catalogo-grupo__label">Inactivos · {inactivos.length}</span>
              <div className="pill-list">
                {inactivos.map((it) => (
                  <span
                    key={it.id}
                    className="badge badge--muted"
                    style={{ cursor: soloLectura ? 'default' : 'pointer' }}
                    onClick={soloLectura ? undefined : () => onToggle(it)}
                    title={soloLectura ? undefined : 'Clic para reactivar'}
                  >
                    {it.nombre}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
