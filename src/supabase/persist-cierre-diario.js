import { supabase } from './client.js';

const CHUNK_SIZE = 500;

async function chunkedInsert(table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`Insertando en ${table}: ${error.message}`);
  }
}

async function borrarDerivadosDelArchivo(archivoId) {
  // El orden importa por las foreign keys (on delete cascade ya cubre la
  // mayoría, pero sjap_cierre_diario tiene archivo_id on delete set null,
  // así que se borra explícitamente para reprocesar limpio).
  await supabase.from('sjap_cierre_diario').delete().eq('archivo_id', archivoId);
  await supabase.from('sjap_transacciones').delete().eq('archivo_id', archivoId);
  await supabase.from('sjap_ventas_promotor_resumen').delete().eq('archivo_id', archivoId);
  await supabase.from('sjap_ventas_medio_pago').delete().eq('archivo_id', archivoId);
  await supabase.from('sjap_despachos_producto').delete().eq('archivo_id', archivoId);
}

/**
 * Resuelve el nombre de producto tal como viene en el archivo (p.ej. "DIESEL")
 * contra el catálogo de la estación (codigo o alias), sin distinguir mayúsculas.
 */
function resolverProducto(nombreOriginal, catalogo) {
  const norm = (s) => String(s || '').trim().toUpperCase();
  const objetivo = norm(nombreOriginal);
  for (const p of catalogo) {
    if (norm(p.codigo) === objetivo) return p;
    if ((p.alias || []).some((a) => norm(a) === objetivo)) return p;
  }
  return null;
}

async function precioVigente(productoId, fecha) {
  const { data, error } = await supabase
    .from('sjap_precios_producto')
    .select('precio, vigente_desde')
    .eq('producto_id', productoId)
    .lte('vigente_desde', fecha)
    .order('vigente_desde', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Consultando precio vigente: ${error.message}`);
  return data?.precio ?? null;
}

async function inventarioInicial(estacionId, productoId, fecha) {
  // El inventario inicial del día es el inventario final REAL del día anterior
  // (no el teórico) — así lo hace el Excel de referencia (D8 = +H7).
  const { data, error } = await supabase
    .from('sjap_lecturas_inventario')
    .select('inventario_final_real, fecha')
    .eq('estacion_id', estacionId)
    .eq('producto_id', productoId)
    .lt('fecha', fecha)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Consultando inventario anterior: ${error.message}`);
  return data?.inventario_final_real ?? null;
}

/**
 * Persiste el resultado de parseCierreDiario() en Supabase. Idempotente por
 * (estacion_id, fecha): si ya existe un archivo para ese día, lo reprocesa
 * (borra lo derivado y lo vuelve a insertar) en vez de duplicar.
 */
export async function persistCierreDiario({ estacionId, parsed, archivoMeta, onProgress }) {
  const progreso = (fase) => onProgress?.(fase);
  if (!parsed.fecha) {
    throw new Error('El archivo no trae una fecha reconocible en sus transacciones.');
  }

  progreso('validando');

  // 1) archivo (upsert manual por estacion+fecha para poder reprocesar)
  const { data: existente } = await supabase
    .from('sjap_archivos_cierre')
    .select('id, version')
    .eq('estacion_id', estacionId)
    .eq('fecha', parsed.fecha)
    .maybeSingle();

  let archivoId;
  let version = 1;

  if (existente) {
    version = existente.version + 1;
    archivoId = existente.id;
    await borrarDerivadosDelArchivo(archivoId);
    const { error } = await supabase
      .from('sjap_archivos_cierre')
      .update({
        nombre_archivo: archivoMeta.nombreArchivo,
        tamano_bytes: archivoMeta.tamanoBytes,
        hash_archivo: archivoMeta.hash ?? null,
        estado: 'procesando',
        version,
        procesado_en: null,
      })
      .eq('id', archivoId);
    if (error) throw new Error(`Actualizando archivo: ${error.message}`);
  } else {
    const { data, error } = await supabase
      .from('sjap_archivos_cierre')
      .insert({
        estacion_id: estacionId,
        fecha: parsed.fecha,
        nombre_archivo: archivoMeta.nombreArchivo,
        tamano_bytes: archivoMeta.tamanoBytes,
        hash_archivo: archivoMeta.hash ?? null,
        estado: 'procesando',
        version: 1,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Creando archivo: ${error.message}`);
    archivoId = data.id;
  }

  try {
    progreso('extrayendo');

    // 2) transacciones detalle
    if (parsed.transacciones.length) {
      await chunkedInsert(
        'sjap_transacciones',
        parsed.transacciones.map((t) => ({ ...t, archivo_id: archivoId, estacion_id: estacionId })),
      );
    }

    // 3) resúmenes que ya trae el archivo
    if (parsed.ventasPromotorResumen.length) {
      await chunkedInsert(
        'sjap_ventas_promotor_resumen',
        parsed.ventasPromotorResumen.map((v) => ({
          ...v,
          archivo_id: archivoId,
          estacion_id: estacionId,
          fecha: parsed.fecha,
        })),
      );
    }
    if (parsed.ventasMedioPago.length) {
      await chunkedInsert(
        'sjap_ventas_medio_pago',
        parsed.ventasMedioPago.map((v) => ({
          ...v,
          archivo_id: archivoId,
          estacion_id: estacionId,
          fecha: parsed.fecha,
        })),
      );
    }

    progreso('consolidando');

    // 4) catálogo de productos de la estación (para resolver despachos)
    const { data: catalogo, error: errCat } = await supabase
      .from('sjap_productos')
      .select('id, codigo, alias')
      .eq('estacion_id', estacionId);
    if (errCat) throw new Error(`Cargando catálogo de productos: ${errCat.message}`);

    const sinResolver = [];
    if (parsed.despachosProducto.length) {
      const despachosResueltos = parsed.despachosProducto.map((d) => {
        const producto = resolverProducto(d.producto_nombre_original, catalogo || []);
        if (!producto) sinResolver.push(d.producto_nombre_original);
        return {
          ...d,
          archivo_id: archivoId,
          estacion_id: estacionId,
          fecha: parsed.fecha,
          producto_id: producto?.id ?? null,
        };
      });
      await chunkedInsert('sjap_despachos_producto', despachosResueltos);

      // 5) balance diario por producto (reconciliación de inventario).
      //    Un mismo producto puede traer varias filas en despachos (p.ej. un
      //    cambio de precio a mitad del día produce 2 filas de "CORRIENTE")
      //    — se suman las cantidades por producto antes de calcular el
      //    teórico, para no perder la mitad del día por un upsert pisando al
      //    anterior.
      const cantidadPorProducto = new Map();
      for (const d of despachosResueltos) {
        if (!d.producto_id) continue;
        cantidadPorProducto.set(d.producto_id, (cantidadPorProducto.get(d.producto_id) || 0) + d.cantidad);
      }
      for (const [productoId, cantidadTotal] of cantidadPorProducto) {
        const precio = await precioVigente(productoId, parsed.fecha);
        const invInicial = await inventarioInicial(estacionId, productoId, parsed.fecha);
        const invTeorico = invInicial != null ? invInicial - cantidadTotal : null;

        await supabase.from('sjap_balance_diario_producto').upsert(
          {
            estacion_id: estacionId,
            producto_id: productoId,
            fecha: parsed.fecha,
            inventario_inicial: invInicial,
            ventas_galones: cantidadTotal,
            recibos_galones: 0,
            inventario_teorico: invTeorico,
            precio_vigente: precio,
            estado: 'pendiente_insumos',
            calculado_en: new Date().toISOString(),
          },
          { onConflict: 'estacion_id,producto_id,fecha' },
        );
      }
    }

    // 6) cierre diario consolidado — solo lo que es 100% derivable del archivo.
    //    Efectivo real / medios "Rumbo, Datáfono, Clientes Propios, QR" quedan
    //    fuera a propósito: no están confirmados (ver hallazgo del parser).
    const ventaTotal = parsed.despachosProducto.reduce((s, d) => s + (d.venta_total || 0), 0);
    const galonesTotal = parsed.despachosProducto.reduce((s, d) => s + (d.cantidad || 0), 0);

    const { error: errCierre } = await supabase.from('sjap_cierre_diario').insert({
      estacion_id: estacionId,
      archivo_id: archivoId,
      fecha: parsed.fecha,
      venta_total: ventaTotal,
      venta_galones_total: galonesTotal,
      estado: 'pendiente_insumos',
    });
    if (errCierre) throw new Error(`Guardando cierre diario: ${errCierre.message}`);

    // 7) auditoría del procesamiento
    await supabase.from('sjap_auditoria').insert({
      estacion_id: estacionId,
      archivo_id: archivoId,
      entidad: 'sjap_archivos_cierre',
      entidad_id: archivoId,
      accion: existente ? 'reprocesado' : 'procesado',
      nivel: parsed.warnings.length || sinResolver.length ? 'warning' : 'info',
      detalle: {
        transacciones: parsed.transacciones.length,
        advertenciasParser: parsed.warnings,
        productosSinResolver: sinResolver,
        version,
      },
    });

    await supabase
      .from('sjap_archivos_cierre')
      .update({
        estado: parsed.warnings.length || sinResolver.length ? 'con_errores' : 'procesado',
        procesado_en: new Date().toISOString(),
      })
      .eq('id', archivoId);

    await supabase.from('sjap_archivos_cierre_historial').insert({
      archivo_id: archivoId,
      version,
      estado_resultado: 'ok',
      errores: parsed.warnings.length || sinResolver.length ? { advertencias: parsed.warnings, sinResolver } : null,
    });

    progreso('completado');
    return { archivoId, warnings: parsed.warnings, productosSinResolver: sinResolver };
  } catch (err) {
    await supabase.from('sjap_archivos_cierre').update({ estado: 'error', errores: { mensaje: err.message } }).eq('id', archivoId);
    await supabase.from('sjap_archivos_cierre_historial').insert({
      archivo_id: archivoId,
      version,
      estado_resultado: 'error',
      errores: { mensaje: err.message },
    });
    throw err;
  }
}
