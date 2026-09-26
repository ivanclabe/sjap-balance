import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '../../supabase/client.js';
import { formatNumero } from '../../lib/format.js';
import { exportarExcel } from '../../lib/export-excel.js';
import { useEstacionConfig } from '../../hooks/useEstacionConfig.js';

export default function SicomReporteTab({ estacionId, anio, mes }) {
  const { config } = useEstacionConfig(estacionId);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!estacionId) return;
    let activo = true;
    setCargando(true);
    (async () => {
      const { data } = await supabase
        .from('sjap_sicom_mensual')
        .select('*')
        .eq('estacion_id', estacionId)
        .eq('anio', anio)
        .eq('mes', mes)
        .order('producto_nombre_original');
      if (!activo) return;
      setFilas(data || []);
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [estacionId, anio, mes]);

  if (cargando) return <div className="empty-state">Cargando…</div>;

  function descargar() {
    exportarExcel(
      `sicom_${anio}-${String(mes).padStart(2, '0')}.xlsx`,
      filas.map((f) => ({
        Producto: f.producto_nombre_original,
        'Inv. inicial': f.inventario_inicial,
        Compras: f.compras,
        Ventas: f.ventas,
        Faltantes: f.faltantes,
        Evaporación: f.evaporacion,
        'Inv. final calculado': f.inventario_final_calculado,
        'Inv. final real': f.inventario_final_real,
        Diferencia: (f.inventario_final_calculado ?? 0) - (f.inventario_final_real ?? 0),
      })),
      'Sicom',
    );
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Informe Sicom</h2>
        <span className="panel__hint">reporte regulatorio mensual · galones</span>
        {filas.length > 0 && (
          <button className="btn" onClick={descargar}>
            <Download size={14} /> Descargar Excel
          </button>
        )}
      </div>
      {filas.length === 0 ? (
        <div className="empty-state">No hay informe Sicom cargado para este mes.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Inv. inicial</th>
                <th className="num">Compras</th>
                <th className="num">Ventas</th>
                <th className="num">Faltantes</th>
                <th className="num">Evaporación</th>
                <th className="num">Inv. final calc.</th>
                <th className="num">Inv. final real</th>
                <th className="num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.producto_nombre_original}>
                  <td>{f.producto_nombre_original}</td>
                  <td className="num">{formatNumero(f.inventario_inicial)}</td>
                  <td className="num">{formatNumero(f.compras)}</td>
                  <td className="num">{formatNumero(f.ventas)}</td>
                  <td className="num">{formatNumero(f.faltantes)}</td>
                  <td className="num">{formatNumero(f.evaporacion)}</td>
                  <td className="num">{formatNumero(f.inventario_final_calculado)}</td>
                  <td className="num">{formatNumero(f.inventario_final_real)}</td>
                  <td className={`num ${Math.abs((f.inventario_final_calculado ?? 0) - (f.inventario_final_real ?? 0)) > config.umbral_sicom_galones ? 'text-danger' : ''}`}>
                    {formatNumero((f.inventario_final_calculado ?? 0) - (f.inventario_final_real ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
