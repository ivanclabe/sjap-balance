// Regenera supabase/instalacion/01_crear_tablas.sql a partir de TODAS las
// migraciones de supabase/migrations/ (en orden), para instalar desde el SQL
// Editor de Supabase sin usar la terminal. Ejecutar después de agregar una
// migración:  npm run generar:instalacion
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirMigraciones = path.join(raiz, 'supabase', 'migrations');
const destino = path.join(raiz, 'supabase', 'instalacion', '01_crear_tablas.sql');

const archivos = readdirSync(dirMigraciones).filter((f) => f.endsWith('.sql')).sort();
const hoy = new Date().toISOString().slice(0, 10);

const encabezado = `-- =============================================================================
-- SJAP Balance · Script 01 de 03 · CREAR TABLAS
-- =============================================================================
-- Qué hace: crea la estructura completa de la base de datos de SJAP Balance
-- (32 tablas, reglas de seguridad y funciones) en un proyecto Supabase NUEVO.
--
-- NO copia datos históricos (cierres, ventas, facturas…). Solo deja la
-- configuración mínima para arrancar: la estación EDS LA FLORIDA, sus 3
-- productos, 17 medios de pago, los turnos T1–T4 y los parámetros de alertas.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO este archivo →
-- Run. Resultado esperado: "Success. No rows returned".
--
-- Si algo falla, no se aplica nada (todo o nada). Si la base ya tenía SJAP
-- instalado, el script se detiene sin tocar nada.
--
-- Generado el ${hoy} a partir de supabase/migrations/ (${archivos.length} archivos, en orden)
-- con: npm run generar:instalacion  — no editar a mano.
-- =============================================================================

do $$
begin
  if to_regclass('public.sjap_estaciones') is not null then
    raise exception 'SJAP Balance ya está instalado en esta base de datos (existe la tabla sjap_estaciones). No se hizo ningún cambio.';
  end if;
end $$;
`;

const permisos = `

-- -----------------------------------------------------------------------------
-- Permisos para la API (por si el proyecto se creó sin "exponer tablas nuevas").
-- La seguridad real la dan las reglas RLS de arriba: cada usuario solo ve los
-- datos de su estación.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'sjap\\_%' loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
  end loop;
  -- Funciones: solo usuarios con sesión (nunca anon).
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sjap\\_%' loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end $$;
`;

const partes = [encabezado];
for (const f of archivos) {
  const sql = readFileSync(path.join(dirMigraciones, f), 'utf8').trimEnd();
  partes.push(`\n\n-- -----------------------------------------------------------------------------\n-- ${f}\n-- -----------------------------------------------------------------------------\n${sql}\n;`);
}
partes.push(permisos, '\n\n-- Fin del script 01. Continúa con 02_crear_usuario_master.sql\n');

writeFileSync(destino, partes.join(''), 'utf8');
console.log(`✓ ${path.relative(raiz, destino)} — ${archivos.length} migraciones`);
