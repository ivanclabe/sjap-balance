// Variante SOLO para Node (scripts de prueba / seeding). No importar esto
// desde código que corre en el navegador — usa node:fs, que Vite no puede
// empaquetar para el cliente. La app web usa xlsx-reader.mjs (readWorkbook).
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

export function readWorkbookFromPath(path) {
  const buffer = readFileSync(path);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  }
  return { sheetNames: wb.SheetNames, sheets };
}
