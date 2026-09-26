// Prueba end-to-end del parser contra los archivos reales del cliente:
//   CIERRE DIARIO (1).xlsx  → día 12/02/2026
//   BALANCE EJEMPLO.xlsx    → fila "Día 12" de la hoja Cierre (valor esperado)
//
// No es un test automatizado con framework — es una verificación manual
// deliberada ("prueba contra los Excel de referencia") antes de conectar
// nada a Supabase ni a la UI.

import { readWorkbookFromPath } from './xlsx-reader-node.mjs';
import { parseCierreDiario } from './parse-cierre-diario.mjs';

const FIXTURE_DIR = new URL('../../test-fixtures/', import.meta.url);
const cierrePath = new URL('cierre-diario-2026-02-12.xlsx', FIXTURE_DIR).pathname;

const { sheets } = readWorkbookFromPath(cierrePath);
const resultado = parseCierreDiario(sheets);

function fmt(n) {
  return Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

let checks = 0;
let passed = 0;
function check(label, actual, expected, tolerancia = 0) {
  checks++;
  const diff = Math.abs(Number(actual) - Number(expected));
  const ok = diff <= tolerancia;
  if (ok) passed++;
  console.log(`${ok ? '✅' : '❌'} ${label}: obtenido=${fmt(actual)}  esperado=${fmt(expected)}${diff ? `  (diff=${fmt(diff)})` : ''}`);
}

console.log('='.repeat(78));
console.log('PARSER — CIERRE DIARIO (1).xlsx');
console.log('='.repeat(78));
console.log('Fecha detectada:', resultado.fecha);
console.log('Advertencias:', resultado.warnings.length ? resultado.warnings : 'ninguna');
console.log('Transacciones extraídas (todas las categorías):', resultado.transacciones.length);

const porCategoria = {};
for (const t of resultado.transacciones) {
  porCategoria[t.categoria] = (porCategoria[t.categoria] || 0) + 1;
}
console.log('  por categoría:', porCategoria);

console.log('\n--- 1. Ventas por medio de pago (bloque propio del archivo) ---');
console.log(resultado.ventasMedioPago);

console.log('\n--- 2. Ventas por promotor (bloque propio del archivo) ---');
console.log(resultado.ventasPromotorResumen);

console.log('\n--- 3. Despachos por producto (galones) ---');
console.log(resultado.despachosProducto);

console.log('\n' + '='.repeat(78));
console.log('VALIDACIÓN CONTRA NÚMEROS REALES');
console.log('='.repeat(78));

// --- contra el propio archivo (fila TOTALES de VENTAS COMBUSTIBLE) ---
const combustible = resultado.transacciones.filter((t) => t.categoria === 'COMBUSTIBLE');
const sumaCombustible = combustible.reduce((s, t) => s + (t.total || 0), 0);
check('Suma transacciones COMBUSTIBLE (vs. fila TOTALES: 109.952.718)', sumaCombustible, 109952718, 1);
check('# transacciones COMBUSTIBLE (filas 12–1335 del archivo)', combustible.length, 1324);

// --- medios de pago: valores exactos leídos a mano del archivo ---
const medioPago = Object.fromEntries(resultado.ventasMedioPago.map((m) => [m.medio_pago, m.total_ventas]));
check('MI EMPRESA', medioPago['MI EMPRESA'], 5490777);
check('EFECTIVO', medioPago['EFECTIVO'], 43217805);
check('BONO VIVE TERPEL', medioPago['BONO VIVE TERPEL'], 432000);
check('GOPASS', medioPago['GOPASS'], 418636);
check('APP TERPEL', medioPago['APP TERPEL'], 30380);
check('CREDITO', medioPago['CREDITO'], 16226184);
check('CREDITO CLIENTES', medioPago['CREDITO CLIENTES'], 4482331);
check('TARJETA DEBITO', medioPago['TARJETA DEBITO'], 38828801);
check('TRANSFERENCIA', medioPago['TRANSFERENCIA'], 1397497);

// --- despachos por producto ---
const despachos = Object.fromEntries(resultado.despachosProducto.map((d) => [d.producto_nombre_original, d]));
check('CORRIENTE — galones despachados', despachos['CORRIENTE']?.cantidad, 3262.24, 0.01);
check('CORRIENTE — venta total', despachos['CORRIENTE']?.venta_total, 49551357);
check('DIESEL — galones despachados', despachos['DIESEL']?.cantidad, 5109.38, 0.01);
check('DIESEL — venta total', despachos['DIESEL']?.venta_total, 54925435);
check('EXTRA — galones despachados', despachos['EXTRA']?.cantidad, 303.04, 0.01);
check('EXTRA — venta total', despachos['EXTRA']?.venta_total, 5475926);

// --- contra BALANCE EJEMPLO, fila "Día 12" de la hoja Cierre ---
// Estas 4 SÍ deben calzar exacto: son las únicas que el Excel mensual copia
// 1:1 desde el bloque "VENTAS MEDIO DE PAGO" del archivo diario.
console.log('\n--- Cruce contra BALANCE EJEMPLO (Cierre!fila 14 = "Día 12") ---');
check('Mi Emp (Cierre) == MI EMPRESA (archivo diario)', medioPago['MI EMPRESA'], 5490777);
check('App Terpel (Cierre) == APP TERPEL (archivo diario)', medioPago['APP TERPEL'], 30380);
check('Go Pass (Cierre) == GOPASS (archivo diario)', medioPago['GOPASS'], 418636);
check('Vive Terpel (Cierre) == BONO VIVE TERPEL (archivo diario)', medioPago['BONO VIVE TERPEL'], 432000);

const galonesTotales = resultado.despachosProducto.reduce((s, d) => s + d.cantidad, 0);
check('Vta Gl (Cierre: 8.674,65) vs. suma despachos', galonesTotales, 8674.65, 0.05);

console.log('\n' + '='.repeat(78));
console.log(`RESULTADO: ${passed}/${checks} validaciones OK`);
console.log('='.repeat(78));

console.log(`
NOTA IMPORTANTE (no es un fallo del parser, es un hallazgo de negocio):
Las columnas "Rumbo", "Datáfono", "Clientes Propios", "QR" y "Urea" de la hoja
Cierre del balance mensual NO se derivan 1:1 de ningún bloque de este archivo
diario — se probó matemáticamente que no calzan con TARJETA DEBITO, CREDITO,
CREDITO CLIENTES, etc. tomados solos o combinados. Esto confirma la pregunta
abierta #2/#3 de la sesión de análisis: esas columnas dependen de la hoja
"Vtas efectivo" (cuentas de clientes propios) y posiblemente de otro reporte
de Rumbo/Datáfono que Javier no nos ha compartido. El modelo de datos ya
quedó preparado para eso (sjap_cuentas_cliente / sjap_movimientos_cuenta_cliente),
pero el parser NO debe inventar esa reconciliación hasta confirmarlo con él.
`);
