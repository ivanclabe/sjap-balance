import { supabase } from './client.js';

/**
 * Persiste el resultado de parseCierreDiario() en Supabase con UNA llamada a
 * la función de base de datos sjap_procesar_archivo_cierre, que corre en una
 * sola transacción (todo o nada).
 *
 * Idempotente por (estación, fecha): si el día ya existe lo reprocesa sin
 * borrar lo que el archivo no reemplaza (efectivo real, diferencia de caja,
 * certificación, medios de pago que solo vienen del balance mensual, lecturas
 * y recibos). Si el día ya está cerrado ("completo"), solo actualiza el
 * detalle del archivo y devuelve la diferencia contra los totales conciliados.
 */
export async function persistCierreDiario({ parsed, archivoMeta, onProgress }) {
  if (!parsed.fecha) {
    throw new Error('El archivo no trae una fecha reconocible en sus transacciones.');
  }
  onProgress?.('consolidando');

  const { data, error } = await supabase.rpc('sjap_procesar_archivo_cierre', {
    p_fecha: parsed.fecha,
    p_archivo: {
      nombre_archivo: archivoMeta.nombreArchivo,
      tamano_bytes: archivoMeta.tamanoBytes,
      hash_archivo: archivoMeta.hash ?? null,
    },
    p_transacciones: parsed.transacciones,
    p_ventas_promotor: parsed.ventasPromotorResumen,
    p_ventas_medio_pago: parsed.ventasMedioPago,
    p_despachos: parsed.despachosProducto,
    p_advertencias: parsed.warnings,
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el cierre.');

  onProgress?.('completado');
  return {
    archivoId: data.archivo_id,
    version: data.version,
    reprocesado: data.reprocesado,
    warnings: parsed.warnings,
    productosSinResolver: data.productos_sin_resolver ?? [],
    diaCerrado: data.dia_cerrado,
    diferencias: data.diferencias,
  };
}
