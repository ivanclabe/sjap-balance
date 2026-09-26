import * as XLSX from 'xlsx';

/**
 * Carga un workbook desde un Buffer/ArrayBuffer y devuelve cada hoja como
 * matriz de filas (array de arrays), tal cual aparece en Excel. No asume
 * ninguna estructura todavía — eso lo hace section-finder.mjs.
 *
 * Solo usa APIs seguras para el navegador (sin node:fs) para que Vite pueda
 * empaquetar este módulo sin externalizar nada.
 */
export function readWorkbook(fileData) {
  const wb = XLSX.read(fileData, { type: fileData instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }
  return { sheetNames: wb.SheetNames, sheets };
}
