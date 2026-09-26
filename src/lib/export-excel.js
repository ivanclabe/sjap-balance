import * as XLSX from 'xlsx';

// Exporta un arreglo de objetos planos a un archivo .xlsx descargable —
// mismo motor (xlsx/SheetJS) que ya se usa para leer los cierres diarios.
// `anchosCol` (opcional): ancho de cada columna en caracteres, en el mismo
// orden que las llaves del primer objeto de `filas` — evita que el Excel
// resultante salga con columnas angostas e ilegibles.
export function exportarExcel(nombreArchivo, filas, nombreHoja = 'Datos', anchosCol = null) {
  const hoja = XLSX.utils.json_to_sheet(filas);
  if (anchosCol) hoja['!cols'] = anchosCol.map((w) => ({ wch: w }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  XLSX.writeFile(libro, nombreArchivo);
}
