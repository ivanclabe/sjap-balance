import { extractSection } from './section-finder.mjs';
import { parseFecha, parseHora, parseConsecutivo, toNumber } from './normalize.mjs';

function mapTransactionRow(raw, categoria) {
  const { consecutivo, prefijo } = parseConsecutivo(raw['CONSECUTIVO']);
  return {
    categoria,
    consecutivo,
    prefijo,
    fecha: parseFecha(raw['FECHA']),
    hora: parseHora(raw['HORA']),
    promotor_nombre: raw['PROMOTOR'] ?? null,
    tipo_factura: raw['TIPO FACTURA'] ?? null,
    producto_nombre: raw['PRODUCTO'] ?? null,
    cantidad: raw['CANTIDAD'] != null ? toNumber(raw['CANTIDAD']) : null,
    unidad: raw['UNIDAD'] ?? null,
    subtotal: raw['SUB TOTAL'] != null ? toNumber(raw['SUB TOTAL']) : null,
    descuento: raw['DESCUENTO'] != null ? toNumber(raw['DESCUENTO']) : 0,
    impuesto_total: raw['IMPUESTO TOTAL'] != null ? toNumber(raw['IMPUESTO TOTAL']) : 0,
    total: raw['TOTAL'] != null ? toNumber(raw['TOTAL']) : null,
  };
}

function extractTransactionBlock(rows, titleMatch, categoria, warnings) {
  const section = extractSection(rows, titleMatch);
  if (!section) {
    warnings.push(`No se encontró el bloque "${titleMatch}" — se omite (probablemente sin ventas ese día).`);
    return { transacciones: [], totalDeclarado: null };
  }
  return {
    transacciones: section.rows.map((r) => mapTransactionRow(r, categoria)),
    totalDeclarado: section.totalsRow
      ? { total: toNumber(section.totalsRow['TOTAL']), cantidad: toNumber(section.totalsRow['CANTIDAD']) }
      : null,
  };
}

/**
 * Parsea el workbook completo del "cierre diario" (export crudo del POS) y
 * devuelve una estructura normalizada, lista para persistir. No inventa
 * columnas: si un bloque esperado no existe en la hoja, se registra en
 * `warnings` en vez de fallar — el archivo real puede variar en cantidad de
 * filas de un día a otro.
 */
export function parseCierreDiario(sheets) {
  const warnings = [];
  const transacciones = [];
  let ventasPromotorResumen = [];
  let ventasMedioPago = [];
  let despachosProducto = [];

  // ---- Hoja COMBUSTIBLE: 4 bloques distintos en la misma hoja ----
  if (sheets['COMBUSTIBLE']) {
    const rows = sheets['COMBUSTIBLE'];

    const { transacciones: t } = extractTransactionBlock(rows, 'VENTAS COMBUSTIBLE', 'COMBUSTIBLE', warnings);
    transacciones.push(...t);

    const promotorSection = extractSection(rows, 'VENTAS POR PROMOTOR');
    if (promotorSection) {
      ventasPromotorResumen = promotorSection.rows
        .filter((r) => r['PROMOTOR'])
        .map((r) => ({
          promotor_nombre: r['PROMOTOR'],
          numero_ventas: toNumber(r['N. VENTAS']),
          total_ventas: toNumber(r['T. VENTAS']),
        }));
    } else {
      warnings.push('No se encontró el bloque "VENTAS POR PROMOTOR" en COMBUSTIBLE.');
    }

    const medioPagoSection = extractSection(rows, 'VENTAS MEDIO DE PAGO');
    if (medioPagoSection) {
      ventasMedioPago = medioPagoSection.rows
        .filter((r) => r['DESCRIPCION'])
        .map((r) => ({
          medio_pago: r['DESCRIPCION'],
          numero_ventas: toNumber(r['N. VENTAS']),
          total_ventas: toNumber(r['T. VENTAS']),
        }));
    } else {
      warnings.push('No se encontró el bloque "VENTAS MEDIO DE PAGO" en COMBUSTIBLE.');
    }

    const despachosSection = extractSection(rows, 'DESPACHOS PRODUCTOS');
    if (despachosSection) {
      despachosProducto = despachosSection.rows
        .filter((r) => r['PRODUCTO'])
        .map((r) => ({
          producto_nombre_original: r['PRODUCTO'],
          unidad: r['UNIDAD'] ?? null,
          cantidad: toNumber(r['CANTIDAD']),
          precio: r['PRECIO'] != null ? toNumber(r['PRECIO']) : null,
          descuento: r['DESCUENTO'] != null ? toNumber(r['DESCUENTO']) : 0,
          venta_total: toNumber(r['VENTA TOTAL']),
        }));
    } else {
      warnings.push('No se encontró el bloque "DESPACHOS PRODUCTOS" en COMBUSTIBLE.');
    }

    // Un mismo producto puede aparecer más de una vez en DESPACHOS PRODUCTOS
    // el mismo día (típicamente por un cambio de precio a mitad de jornada:
    // "CORRIENTE" a un precio y otra fila "CORRIENTE" al precio nuevo). El
    // balance de inventario suma las cantidades para no perder ventas, pero
    // se avisa siempre para que quien carga el archivo lo revise.
    if (despachosProducto.length) {
      const conteoPorProducto = new Map();
      for (const d of despachosProducto) {
        const clave = String(d.producto_nombre_original || '').trim().toUpperCase();
        conteoPorProducto.set(clave, (conteoPorProducto.get(clave) || 0) + 1);
      }
      for (const [nombre, veces] of conteoPorProducto) {
        if (veces > 1) {
          warnings.push(
            `"${nombre}" aparece ${veces} veces en DESPACHOS PRODUCTOS (posible cambio de precio a mitad del día) — las cantidades se sumaron para el balance de inventario.`,
          );
        }
      }
    }
  } else {
    warnings.push('No se encontró la hoja COMBUSTIBLE.');
  }

  // ---- Hojas de tienda: CANASTILLA / KIOSCO / CDL (mismo esquema) ----
  for (const [sheetName, categoria, titleMatch] of [
    ['CANASTILLA', 'CANASTILLA', /VENTAS CANASTILLA/i],
    ['KIOSCO', 'KIOSCO', /VENTAS KIOSCO/i],
    ['CDL', 'CDL', /VENTAS CDL/i],
  ]) {
    if (sheets[sheetName]) {
      const { transacciones: t } = extractTransactionBlock(sheets[sheetName], titleMatch, categoria, warnings);
      transacciones.push(...t);
    } else {
      warnings.push(`No se encontró la hoja ${sheetName}.`);
    }
  }

  // ---- Hoja VENTAS COMPLEMENTARIOS ----
  if (sheets['VENTAS COMPLEMENTARIOS']) {
    const { transacciones: t } = extractTransactionBlock(
      sheets['VENTAS COMPLEMENTARIOS'],
      /VENTAS COMPLEMENTARIOS/i,
      'COMPLEMENTARIOS',
      warnings,
    );
    transacciones.push(...t);
  } else {
    warnings.push('No se encontró la hoja VENTAS COMPLEMENTARIOS.');
  }

  // La fecha del cierre es la que traen las transacciones (todas deberían
  // compartir la misma fecha — si no, se marca advertencia).
  const fechasUnicas = new Set(transacciones.map((t) => t.fecha).filter(Boolean));
  if (fechasUnicas.size > 1) {
    warnings.push(`El archivo trae más de una fecha entre sus transacciones: ${[...fechasUnicas].join(', ')}`);
  }
  const fecha = fechasUnicas.size >= 1 ? [...fechasUnicas][0] : null;

  return {
    fecha,
    transacciones,
    ventasPromotorResumen,
    ventasMedioPago,
    despachosProducto,
    warnings,
  };
}
