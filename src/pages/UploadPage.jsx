import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useEstacion } from '../context/EstacionContext.jsx';
import { useDiasFaltantes } from '../hooks/useDiasFaltantes.js';
import { readWorkbook } from '../parser/xlsx-reader.mjs';
import { parseCierreDiario } from '../parser/parse-cierre-diario.mjs';
import { persistCierreDiario } from '../supabase/persist-cierre-diario.js';
import { formatFecha, formatFechaLarga } from '../lib/format.js';

export default function UploadPage() {
  const { estacionId } = useEstacion();
  const [arrastrando, setArrastrando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [cola, setCola] = useState([]); // [{ nombre, estado: 'pendiente'|'procesando'|'completado'|'error', fecha, warnings, error }]
  const inputRef = useRef(null);

  const [expandido, setExpandido] = useState(false);
  const diasFaltantes = useDiasFaltantes(estacionId);

  const procesarUnArchivo = useCallback(
    async (file, idx) => {
      setCola((prev) => prev.map((it, i) => (i === idx ? { ...it, estado: 'procesando' } : it)));
      try {
        const buffer = await file.arrayBuffer();
        const { sheets } = readWorkbook(buffer);
        const parsed = parseCierreDiario(sheets);
        if (!parsed.fecha) {
          throw new Error('No se pudo determinar la fecha del cierre: ninguna transacción trae un valor de FECHA reconocible.');
        }
        const { productosSinResolver, diaCerrado, diferencias, reprocesado } = await persistCierreDiario({
          parsed,
          archivoMeta: { nombreArchivo: file.name, tamanoBytes: file.size },
        });
        const cop = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
        const warnings = [
          ...parsed.warnings,
          ...(productosSinResolver.length ? [`Productos sin resolver contra el catálogo (revisar alias): ${productosSinResolver.join(', ')}`] : []),
          ...(diaCerrado
            ? [
                diferencias
                  ? `El día ya estaba cerrado: se actualizó solo el detalle del archivo. El archivo suma $${cop(diferencias.venta_archivo)} y ${cop(diferencias.galones_archivo)} gal; el cierre conciliado conserva $${cop(diferencias.venta_cierre)} y ${cop(diferencias.galones_cierre)} gal. Si el cierre debe cambiar, un master puede corregirlo en el detalle del día.`
                  : 'El día ya estaba cerrado: se actualizó solo el detalle del archivo (los totales coinciden).',
              ]
            : reprocesado
              ? ['El día ya existía: se reprocesó conservando el efectivo, las lecturas y demás datos capturados.']
              : []),
        ];
        setCola((prev) => prev.map((it, i) => (i === idx ? { ...it, estado: 'completado', fecha: parsed.fecha, warnings } : it)));
      } catch (err) {
        setCola((prev) => prev.map((it, i) => (i === idx ? { ...it, estado: 'error', error: err.message } : it)));
      }
    },
    [estacionId],
  );

  const procesarArchivos = useCallback(
    async (files) => {
      const nuevos = files.map((f) => ({ nombre: f.name, estado: 'pendiente', fecha: null, warnings: [], error: null }));
      const offset = cola.length;
      setCola((prev) => [...prev, ...nuevos]);
      setProcesando(true);
      // secuencial — evita condiciones de carrera al escribir en Supabase
      for (let i = 0; i < files.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await procesarUnArchivo(files[i], offset + i);
      }
      setProcesando(false);
    },
    [cola.length, procesarUnArchivo],
  );

  const onDrop = (e) => {
    e.preventDefault();
    setArrastrando(false);
    const files = [...(e.dataTransfer.files || [])].filter((f) => f.name.endsWith('.xlsx'));
    if (files.length) procesarArchivos(files);
  };

  const completados = cola.filter((c) => c.estado === 'completado');
  const conError = cola.filter((c) => c.estado === 'error');

  return (
    <>
      <div className="page-header">
        <h1>Cargar balance diario</h1>
        <p>Sube el archivo .xlsx que exporta el sistema del punto de venta al cierre del turno.</p>
      </div>

      <div
        className={`dropzone ${arrastrando ? 'dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{ cursor: 'pointer' }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          Arrastra aquí uno o varios archivos del cierre diario
        </p>
        <p style={{ margin: '6px 0 0' }}>o haz clic para seleccionarlos — formato .xlsx. Puedes subir varios días a la vez (ej. el lunes, todo el fin de semana).</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = [...(e.target.files || [])];
            if (files.length) procesarArchivos(files);
            e.target.value = '';
          }}
        />
      </div>

      {diasFaltantes.length > 0 && (
        <div className="gap-banner">
          <button className="gap-banner__row" onClick={() => setExpandido((v) => !v)}>
            <AlertTriangle size={15} />
            <span className="gap-banner__text">
              {diasFaltantes.length} día{diasFaltantes.length === 1 ? '' : 's'} sin cierre cargado — el más reciente:{' '}
              {formatFecha(diasFaltantes[0], { year: 'numeric' })}
            </span>
            <ChevronDown size={15} className={`gap-banner__chevron ${expandido ? 'gap-banner__chevron--open' : ''}`} />
          </button>

          {expandido && (
            <div className="gap-banner__body">
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
                A estos días nunca se les subió el archivo de cierre — sube el .xlsx correspondiente arriba para
                completarlos.
              </p>
              <div className="gap-banner__list">
                {diasFaltantes.map((f) => (
                  <div className="gap-banner__item" key={f}>
                    <span className="mono">{formatFecha(f, { weekday: 'short', year: 'numeric' })}</span>
                    <span className="badge badge--danger">Sin cargar</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {cola.length > 0 && (
        <div className="panel">
          <div className="panel__header">
            <h2>{procesando ? 'Procesando archivos…' : 'Resultado de la carga'}</h2>
            <span className="panel__hint">
              {completados.length} de {cola.length} completado(s){conError.length > 0 ? ` · ${conError.length} con error` : ''}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Estado</th>
                  <th>Fecha detectada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cola.map((item, i) => (
                  <tr key={i}>
                    <td>{item.nombre}</td>
                    <td>
                      {item.estado === 'pendiente' && <span className="badge badge--muted">en cola</span>}
                      {item.estado === 'procesando' && (
                        <span className="badge badge--accent">
                          <Loader2 size={11} /> procesando
                        </span>
                      )}
                      {item.estado === 'completado' && (
                        <span className="badge badge--good">
                          <CheckCircle2 size={11} /> completado
                        </span>
                      )}
                      {item.estado === 'error' && (
                        <span className="badge badge--danger">
                          <XCircle size={11} /> error
                        </span>
                      )}
                    </td>
                    <td className="mono">{item.fecha ? formatFechaLarga(item.fecha) : '—'}</td>
                    <td>
                      {item.estado === 'completado' && (
                        <Link to={`/diarios/${item.fecha}`} className="btn" style={{ padding: '5px 10px', fontSize: 12 }}>
                          Ver día
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {conError.length > 0 && (
            <div className="alert alert--danger" style={{ marginTop: 14 }}>
              <strong>Archivos con error:</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {conError.map((item, i) => (
                  <li key={i}>
                    {item.nombre}: {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {completados.some((c) => c.warnings.length > 0) && (
            <div className="alert alert--warning" style={{ marginTop: 14 }}>
              <strong>Advertencias durante la extracción:</strong>
              {completados
                .filter((c) => c.warnings.length > 0)
                .map((c, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <span className="mono" style={{ fontSize: 11.5 }}>{c.nombre}</span>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {c.warnings.map((w, j) => (
                        <li key={j}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
