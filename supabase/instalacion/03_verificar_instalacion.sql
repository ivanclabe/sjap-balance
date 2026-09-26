-- =============================================================================
-- SJAP Balance · Script 03 de 03 · VERIFICAR LA INSTALACIÓN
-- =============================================================================
-- SQL Editor → New query → pega este archivo → Run.
-- Resultado esperado: 11 filas y TODAS con "OK" en la columna estado.
-- Si alguna dice "REVISAR", envía una captura de pantalla al equipo técnico.
-- =============================================================================

with chequeos(orden, elemento, esperado, encontrado) as (
  values
    (1,  'Tablas de SJAP',          32, (select count(*)::int from pg_tables where schemaname = 'public' and tablename like 'sjap\_%')),
    (2,  'Reglas de seguridad',     56, (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'sjap\_%')),
    (3,  'Funciones',                4, (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'sjap\_%')),
    (4,  'Estación',                 1, (select count(*)::int from public.sjap_estaciones)),
    (5,  'Productos',                3, (select count(*)::int from public.sjap_productos)),
    (6,  'Medios de pago',          17, (select count(*)::int from public.sjap_medios_pago)),
    (7,  'Turnos (T1–T4)',           4, (select count(*)::int from public.sjap_turno_tipos)),
    (8,  'Esquema de turnos',        1, (select count(*)::int from public.sjap_esquemas_turno)),
    (9,  'Parámetros de alertas',    6, (select count(*)::int from public.sjap_estacion_config)),
    (10, 'Permisos de la API',      32, (select count(*)::int from pg_tables where schemaname = 'public' and tablename like 'sjap\_%'
                                             and has_table_privilege('authenticated', format('public.%I', tablename), 'select')
                                             and has_table_privilege('authenticated', format('public.%I', tablename), 'insert')
                                             and has_table_privilege('authenticated', format('public.%I', tablename), 'update')
                                             and has_table_privilege('authenticated', format('public.%I', tablename), 'delete'))),
    (11, 'Usuario master activado',  1, (select count(*)::int from public.sjap_usuarios where rol = 'master'))
)
select elemento, esperado, encontrado,
       case when encontrado = esperado then 'OK' else 'REVISAR' end as estado
from chequeos
order by orden;
