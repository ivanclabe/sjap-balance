import { useEffect, useState } from 'react';
import { useEstacion } from '../../context/EstacionContext.jsx';
import { supabase } from '../../supabase/client.js';

const CAMPOS = [
  { key: 'nombre', label: 'Nombre de la estación' },
  { key: 'razon_social', label: 'Razón social' },
  { key: 'nit', label: 'NIT' },
  { key: 'bandera', label: 'Bandera' },
  { key: 'ciudad', label: 'Ciudad' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Correo de contacto' },
  { key: 'moneda', label: 'Moneda' },
  { key: 'zona_horaria', label: 'Zona horaria' },
];

export default function GeneralPanel({ estacionId, soloLectura }) {
  const { estaciones } = useEstacion();
  const estacionActual = estaciones.find((e) => e.id === estacionId);
  const [valores, setValores] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    if (!estacionId) return;
    setCargando(true);
    (async () => {
      const { data } = await supabase.from('sjap_estaciones').select('*').eq('id', estacionId).maybeSingle();
      setValores(data || {});
      setCargando(false);
    })();
  }, [estacionId]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const { error } = await supabase
      .from('sjap_estaciones')
      .update({
        nombre: valores.nombre,
        razon_social: valores.razon_social || null,
        nit: valores.nit || null,
        bandera: valores.bandera || null,
        ciudad: valores.ciudad || null,
        direccion: valores.direccion || null,
        telefono: valores.telefono || null,
        email: valores.email || null,
        moneda: valores.moneda || 'COP',
        zona_horaria: valores.zona_horaria || 'America/Bogota',
      })
      .eq('id', estacionId);
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message });
      return;
    }
    setMensaje({ tipo: 'ok', texto: 'Guardado.' });
  }

  if (cargando) return <div className="empty-state">Cargando…</div>;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Datos de la estación</h2>
        <span className="panel__hint">{estacionActual?.nombre ?? '—'}</span>
      </div>
      <div className="field-grid">
        {CAMPOS.map((c) => (
          <div className="field-row" key={c.key}>
            <label className="field-label">{c.label}</label>
            <input
              className="field-input"
              value={valores[c.key] ?? ''}
              disabled={soloLectura}
              onChange={(e) => setValores({ ...valores, [c.key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      {!soloLectura && (
        <button className="btn btn--accent" style={{ marginTop: 8 }} onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      )}
      {mensaje && <div className={`field-msg field-msg--${mensaje.tipo}`}>{mensaje.texto}</div>}
    </div>
  );
}
