import { useEffect, useState } from 'react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { useUsuarioActual } from '../hooks/useUsuarioActual.js';
import { supabase } from '../supabase/client.js';
import CatalogoPanel from '../components/CatalogoPanel.jsx';
import GeneralPanel from './configuracion/GeneralPanel.jsx';
import ProductosPanel from './configuracion/ProductosPanel.jsx';
import UsuariosPanel from './configuracion/UsuariosPanel.jsx';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'productos', label: 'Productos' },
  { key: 'medios', label: 'Medios de pago' },
  { key: 'usuarios', label: 'Usuarios' },
];

export default function ConfiguracionPage() {
  const { estacionId } = useEstacion();
  const { usuario, esMaster, cargando: cargandoUsuario } = useUsuarioActual();
  const [tab, setTab] = useState('general');
  const [medios, setMedios] = useState([]);
  const [cargandoMedios, setCargandoMedios] = useState(true);

  async function cargarMedios() {
    setCargandoMedios(true);
    const { data } = await supabase.from('sjap_medios_pago').select('*').eq('estacion_id', estacionId).order('orden');
    setMedios(data || []);
    setCargandoMedios(false);
  }

  useEffect(() => {
    if (!estacionId || tab !== 'medios') return;
    cargarMedios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estacionId, tab]);

  const soloLectura = !cargandoUsuario && !esMaster;

  return (
    <>
      <div className="page-header">
        <h1>Configuración</h1>
        <p>Datos de la estación, productos y medios de pago — sin depender de cambios de código.</p>
      </div>

      {soloLectura && (
        <div className="subnote" style={{ marginBottom: 16 }}>
          Tu usuario no tiene permiso para modificar la configuración — solo el usuario <strong>master</strong> puede
          editar estos datos. Puedes consultarlos libremente.
        </div>
      )}

      <div className="sheet-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`sheet-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralPanel estacionId={estacionId} soloLectura={soloLectura} />}
      {tab === 'productos' && <ProductosPanel estacionId={estacionId} soloLectura={soloLectura} />}
      {tab === 'usuarios' && <UsuariosPanel estacionId={estacionId} usuario={usuario} esMaster={esMaster} />}
      {tab === 'medios' &&
        (cargandoMedios ? (
          <div className="empty-state">Cargando…</div>
        ) : (
          <CatalogoPanel
            titulo="Medios de pago"
            hint="catálogo de la estación · usado en Balance mensual → Cierre detallado"
            tabla="sjap_medios_pago"
            tipoUso="medio_pago"
            estacionId={estacionId}
            items={medios}
            onCambio={cargarMedios}
            placeholder="Nombre del medio de pago"
            etiquetaNombre="Medio de pago"
            soloLectura={soloLectura}
            normalizar={(s) => s.replace(/\s+/g, ' ').toUpperCase()}
            extraAlCrear={(lista) => ({ orden: lista.length + 1 })}
            notaRenombrar="Un medio que aparece por nombre en ventas históricas no se puede renombrar."
          />
        ))}
    </>
  );
}
