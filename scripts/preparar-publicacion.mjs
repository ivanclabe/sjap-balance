// Asistente para generar la carpeta `dist/` lista para publicar, sin editar
// archivos ocultos: pregunta la URL y la clave pública del proyecto Supabase y
// compila la app con ellas. Uso: `npm run preparar`.
//
// También acepta las variables ya definidas en el entorno
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), en cuyo caso no pregunta.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, exit } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rolDeJwt(clave) {
  try {
    const payload = JSON.parse(Buffer.from(clave.split('.')[1], 'base64url').toString('utf8'));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function validarUrl(url) {
  if (!/^https:\/\/\S+$/.test(url)) return 'Debe empezar por https:// (ejemplo: https://abcd1234.supabase.co).';
  return null;
}

function validarClave(clave) {
  if (!clave) return 'La clave está vacía.';
  if (clave.startsWith('sb_secret_') || rolDeJwt(clave) === 'service_role') {
    return 'Esa es la clave SECRETA (service_role / secret). Usa la clave pública: "anon" o "publishable".';
  }
  if (!clave.startsWith('sb_publishable_') && rolDeJwt(clave) !== 'anon') {
    return 'No parece una clave pública de Supabase. Copia la clave "anon public" o la "publishable".';
  }
  return null;
}

// Se leen las respuestas línea por línea (en vez de rl.question) para que el
// asistente también funcione si las respuestas llegan pegadas de una vez.
async function preguntar(lineas, texto, validar) {
  for (;;) {
    stdout.write(texto);
    const { value, done } = await lineas.next();
    if (done) {
      console.log('\n✗ No se recibió respuesta. Vuelve a ejecutar: npm run preparar');
      exit(1);
    }
    const valor = value.trim();
    const error = validar(valor);
    if (!error) return valor;
    console.log(`  ✗ ${error}\n`);
  }
}

console.log('\nSJAP Balance · Preparar la app para publicar\n');

if (!existsSync(path.join(raiz, 'node_modules', 'vite'))) {
  console.log('Primero instala las dependencias con:  npm install');
  exit(1);
}

let url = process.env.VITE_SUPABASE_URL?.trim();
let clave = process.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!url || !clave || validarUrl(url) || validarClave(clave)) {
  const rl = createInterface({ input: stdin, terminal: false });
  const lineas = rl[Symbol.asyncIterator]();
  console.log('Copia estos dos datos desde Supabase → Project Settings → API.\n');
  url = await preguntar(lineas, '1) Project URL: ', validarUrl);
  clave = await preguntar(lineas, '2) Clave pública (anon / publishable): ', validarClave);
  rl.close();
}

// Vite da prioridad a las variables que ya existen en el entorno sobre los
// archivos .env, así que la compilación usa exactamente estos valores.
process.env.VITE_SUPABASE_URL = url.replace(/\/+$/, '');
process.env.VITE_SUPABASE_ANON_KEY = clave;

console.log('\nCompilando… (tarda menos de un minuto)\n');
const { build } = await import('vite');
try {
  await build({ root: raiz, logLevel: 'warn', build: { chunkSizeWarningLimit: 4000 } });
} catch (err) {
  console.error('\n✗ La compilación falló:', err.message);
  exit(1);
}

console.log('✓ Listo. La app quedó en la carpeta:');
console.log(`  ${path.join(raiz, 'dist')}\n`);
console.log('Siguiente paso: arrastra esa carpeta "dist" a https://app.netlify.com/drop');
console.log('(o entrégala a quien administre el servidor web).\n');
