// Localizador de tablas por ancla de texto. Una hoja del "cierre diario" NO es
// una sola tabla: es varias tablas apiladas verticalmente, cada una precedida
// por un título ("VENTAS COMBUSTIBLE", "VENTAS POR PROMOTOR", ...). Este módulo
// encuentra cada bloque buscando su título, ubica la fila de encabezados justo
// debajo, y lee filas de datos hasta encontrar una fila vacía o una fila de
// "TOTALES". Tolera que el número de filas de transacciones cambie cada día.

function cellText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function isRowEmpty(row) {
  if (!row) return true;
  return row.every((c) => c === null || c === undefined || String(c).trim() === '');
}

function looksLikeTotalsRow(row) {
  return row.some((c) => {
    const t = cellText(c).toUpperCase();
    return t === 'TOTALES:' || t === 'TOTALES' || t === 'TOTAL';
  });
}

/**
 * Busca la fila cuyo texto (en cualquier columna) coincide con `titleMatch`
 * (string exacto o RegExp), empezando en `fromRow` (0-indexed).
 * Devuelve el índice de fila, o -1 si no se encontró.
 */
export function findTitleRow(rows, titleMatch, fromRow = 0) {
  const matches = (text) =>
    titleMatch instanceof RegExp ? titleMatch.test(text) : text.toUpperCase() === titleMatch.toUpperCase();

  for (let r = fromRow; r < rows.length; r++) {
    const row = rows[r] || [];
    for (const cell of row) {
      if (matches(cellText(cell))) return r;
    }
  }
  return -1;
}

/**
 * Extrae un bloque de tabla: título en `titleRow`, encabezados en la fila
 * siguiente (o `headerOffset` filas después), datos hasta fila vacía o de
 * totales. Devuelve { headers, rows, totalsRow, startRow, endRow } o null
 * si el título no se encontró.
 */
export function extractSection(rows, titleMatch, { fromRow = 0, headerOffset = 1, includeTotalsRow = true } = {}) {
  const titleRow = findTitleRow(rows, titleMatch, fromRow);
  if (titleRow === -1) return null;

  const headerRowIdx = titleRow + headerOffset;
  const headerRow = rows[headerRowIdx] || [];
  const headers = headerRow.map((h) => cellText(h));

  const data = [];
  let totalsRow = null;
  let r = headerRowIdx + 1;
  for (; r < rows.length; r++) {
    const row = rows[r];
    if (isRowEmpty(row)) break;
    if (looksLikeTotalsRow(row)) {
      if (includeTotalsRow) totalsRow = rowToObject(headers, row);
      r++;
      break;
    }
    data.push(rowToObject(headers, row));
  }

  return {
    headers,
    rows: data,
    totalsRow,
    startRow: headerRowIdx + 1,
    endRow: r - 1,
    titleRow,
  };
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    if (!h) return; // columnas sin encabezado (índice numérico de referencia) se ignoran
    obj[h] = row[i] === undefined ? null : row[i];
  });
  return obj;
}
