-- =============================================================================
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
-- Generado el 2026-09-24 a partir de supabase/migrations/ (21 archivos, en orden).
-- =============================================================================

do $$
begin
  if to_regclass('public.sjap_estaciones') is not null then
    raise exception 'SJAP Balance ya está instalado en esta base de datos (existe la tabla sjap_estaciones). No se hizo ningún cambio.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 20260901151847_sjap_balance_schema_core.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- SJAP — Balance diario/mensual de estaciones de servicio (multi-EDS)
-- Prefijo sjap_ para aislar de las demás tablas de la cuenta.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Estaciones (multi-EDS desde el día 1)
-- ---------------------------------------------------------------------------
create table public.sjap_estaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  razon_social text,
  nit text,
  ciudad text,
  bandera text default 'Terpel',
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (nombre)
);
comment on table public.sjap_estaciones is 'Cada estación de servicio (EDS) gestionada en la app. Todo el resto del modelo cuelga de aquí.';

-- ---------------------------------------------------------------------------
-- 2. Catálogo de productos por estación (NO es un enum fijo: cada EDS puede
--    nombrar sus productos distinto — ej. "Bioacem" vs "ACPM" — sin confirmar aún).
-- ---------------------------------------------------------------------------
create table public.sjap_productos (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  codigo text not null,              -- tal como aparece en los archivos (p.ej. 'CORRIENTE','BIOACEM','EXTRA')
  nombre_visible text not null,      -- nombre a mostrar en UI (editable, p.ej. 'ACPM / Diésel')
  unidad text not null default 'GALONES',
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, codigo)
);
comment on table public.sjap_productos is 'Catálogo de combustibles por estación. codigo debe calzar con el texto que trae el archivo diario (PRODUCTO / DESPACHOS PRODUCTOS).';

-- Historial de precios por producto (el precio cambia a mitad de mes en los
-- archivos reales — cada movimiento debe valorarse al precio vigente en su fecha).
create table public.sjap_precios_producto (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.sjap_productos(id) on delete cascade,
  precio numeric(14,2) not null,
  vigente_desde date not null,
  created_at timestamptz not null default now(),
  unique (producto_id, vigente_desde)
);
comment on table public.sjap_precios_producto is 'Historial de precio por producto. El precio vigente para una fecha es el de mayor vigente_desde <= fecha.';
create index idx_sjap_precios_producto_lookup on public.sjap_precios_producto (producto_id, vigente_desde desc);

-- ---------------------------------------------------------------------------
-- 3. Archivos de cierre diario cargados (auditoría / trazabilidad de origen)
-- ---------------------------------------------------------------------------
create table public.sjap_archivos_cierre (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  nombre_archivo text not null,
  tamano_bytes bigint,
  hash_archivo text,                 -- para detectar recargas del mismo archivo
  estado text not null default 'recibido'
    check (estado in ('recibido','procesando','procesado','con_errores','error')),
  hojas_detectadas jsonb,            -- snapshot de qué hojas/tablas encontró el parser
  errores jsonb,
  version int not null default 1,    -- se incrementa en cada reprocesamiento
  subido_por text,
  procesado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (estacion_id, fecha)
);
comment on table public.sjap_archivos_cierre is 'Un registro por (estación, fecha): el archivo diario vigente para ese día. Reprocesar incrementa version y re-dispara la extracción.';

create table public.sjap_archivos_cierre_historial (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.sjap_archivos_cierre(id) on delete cascade,
  version int not null,
  hash_archivo text,
  estado_resultado text not null,
  errores jsonb,
  procesado_en timestamptz not null default now()
);
comment on table public.sjap_archivos_cierre_historial is 'Historial completo de cada intento de procesamiento de un archivo (incluye reprocesos), para auditoría.';

-- ---------------------------------------------------------------------------
-- 4. Transacciones crudas extraídas (nivel más fino: 1 fila por venta)
-- ---------------------------------------------------------------------------
create table public.sjap_transacciones (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.sjap_archivos_cierre(id) on delete cascade,
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  categoria text not null check (categoria in ('COMBUSTIBLE','CANASTILLA','KIOSCO','CDL','COMPLEMENTARIOS')),
  consecutivo text,
  prefijo text,
  fecha date not null,
  hora time,
  promotor_nombre text,
  tipo_factura text,                 -- 'ELECTRONICA','CREDITO', etc. (abierto, no enum)
  producto_nombre text,
  cantidad numeric(14,3),
  unidad text,
  subtotal numeric(14,2),
  descuento numeric(14,2) default 0,
  impuesto_total numeric(14,2) default 0,
  total numeric(14,2),
  created_at timestamptz not null default now()
);
comment on table public.sjap_transacciones is 'Detalle transaccional extraído de las tablas de venta item-a-item del archivo diario (COMBUSTIBLE, CANASTILLA, KIOSCO, CDL, VENTAS COMPLEMENTARIOS). Base para trazabilidad total.';
create index idx_sjap_transacciones_estacion_fecha on public.sjap_transacciones (estacion_id, fecha);
create index idx_sjap_transacciones_archivo on public.sjap_transacciones (archivo_id);

-- Resumen "VENTAS POR PROMOTOR" que ya viene calculado dentro del archivo diario
create table public.sjap_ventas_promotor_resumen (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.sjap_archivos_cierre(id) on delete cascade,
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  promotor_nombre text not null,
  numero_ventas int not null default 0,
  total_ventas numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (archivo_id, promotor_nombre)
);
comment on table public.sjap_ventas_promotor_resumen is 'Bloque "VENTAS POR PROMOTOR" tal cual viene en el archivo diario (agregado, sin turno/isla).';

-- Resumen "VENTAS MEDIO DE PAGO" que ya viene calculado dentro del archivo diario
create table public.sjap_ventas_medio_pago (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.sjap_archivos_cierre(id) on delete cascade,
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  medio_pago text not null,          -- texto libre: 'EFECTIVO','RUMBO','DATAFONO','QR','VIVE TERPEL', etc.
  numero_ventas int not null default 0,
  total_ventas numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (archivo_id, medio_pago)
);
comment on table public.sjap_ventas_medio_pago is 'Bloque "VENTAS MEDIO DE PAGO" tal cual viene en el archivo diario. medio_pago es texto libre porque cada EDS puede tener medios distintos.';

-- Resumen "DESPACHOS PRODUCTOS" (galones por producto) — insumo clave del inventario
create table public.sjap_despachos_producto (
  id uuid primary key default gen_random_uuid(),
  archivo_id uuid not null references public.sjap_archivos_cierre(id) on delete cascade,
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid references public.sjap_productos(id),
  producto_nombre_original text not null,  -- texto tal cual venía en el archivo (por si no calzó con el catálogo)
  fecha date not null,
  unidad text,
  cantidad numeric(14,3) not null default 0,
  precio numeric(14,2),
  descuento numeric(14,2) default 0,
  venta_total numeric(14,2),
  created_at timestamptz not null default now(),
  unique (archivo_id, producto_nombre_original)
);
comment on table public.sjap_despachos_producto is 'Bloque "DESPACHOS PRODUCTOS": ventas en galones por producto, tal cual viene en el archivo. Alimenta sjap_balance_diario.ventas_galones.';
;

-- -----------------------------------------------------------------------------
-- 20260901151934_sjap_balance_schema_manual_capture_and_balances.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- SJAP — Insumos manuales, balance calculado, cuentas de clientes, auditoría
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5. Insumos manuales — NO vienen en el archivo diario. Se deja el modelo
--    diseñado a la espera de definir con el cliente cómo se capturan
--    (formulario en la app vs. otro archivo). Todos son nullable/editable
--    y quedan vinculados a estación+producto+fecha o estación+fecha.
-- ---------------------------------------------------------------------------

create table public.sjap_lecturas_inventario (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid not null references public.sjap_productos(id) on delete cascade,
  fecha date not null,
  inventario_final_real numeric(14,3) not null,  -- lectura física con vara de tanque
  origen text not null default 'manual' check (origen in ('manual','importado')),
  capturado_por text,
  capturado_en timestamptz not null default now(),
  notas text,
  unique (estacion_id, producto_id, fecha)
);
comment on table public.sjap_lecturas_inventario is 'Lectura física de inventario (vara de tanque) al cierre del día. Insumo manual — pendiente de definir flujo de captura exacto con el cliente.';

create table public.sjap_facturas_compra (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid not null references public.sjap_productos(id) on delete cascade,
  fecha date not null,
  numero_factura text,
  cantidad numeric(14,3) not null,
  origen text not null default 'manual' check (origen in ('manual','importado')),
  capturado_por text,
  capturado_en timestamptz not null default now(),
  notas text
);
comment on table public.sjap_facturas_compra is 'Facturas de compra/recibo de combustible del proveedor. Insumo manual — pendiente de definir si se digita, se sube un PDF/foto, o llega en otro archivo.';
create index idx_sjap_facturas_compra_estacion_fecha on public.sjap_facturas_compra (estacion_id, fecha);

create table public.sjap_efectivo_diario (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  efectivo_real numeric(14,2),          -- efectivo contado físicamente
  certificacion_bancaria numeric(14,2), -- consignación certificada por el banco (esporádica, no todos los días)
  origen text not null default 'manual' check (origen in ('manual','importado')),
  capturado_por text,
  capturado_en timestamptz not null default now(),
  notas text,
  unique (estacion_id, fecha)
);
comment on table public.sjap_efectivo_diario is 'Efectivo real contado y certificación bancaria del día. Insumo manual — determina el descuadre de caja (Diferencia) en sjap_cierre_diario.';

-- ---------------------------------------------------------------------------
-- 6. Cuentas de clientes propios (registro abierto — se desconoce el origen
--    de los datos día a día; se deja el modelo listo para cargarlos manual
--    o por archivo cuando se aclare con el cliente).
-- ---------------------------------------------------------------------------
create table public.sjap_cuentas_cliente (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  nombre text not null,
  nit text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);
comment on table public.sjap_cuentas_cliente is 'Cuentas corporativas de crédito ("clientes propios"): CRC, EASY CEM, COLEG NUEVA INGLATERRA, etc. Lista abierta y creciente, no un enum.';

create table public.sjap_movimientos_cuenta_cliente (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.sjap_cuentas_cliente(id) on delete cascade,
  archivo_id uuid references public.sjap_archivos_cierre(id) on delete set null,
  fecha date not null,
  tipo text not null check (tipo in ('COMBUSTIBLE','UREA','LUBRICANTES')),
  monto numeric(14,2) not null default 0,
  origen text not null default 'manual' check (origen in ('manual','importado')),
  created_at timestamptz not null default now()
);
comment on table public.sjap_movimientos_cuenta_cliente is 'Consumo diario por cuenta de cliente propio, separado por tipo. origen=importado cuando se defina la fuente real.';
create index idx_sjap_mov_cuenta_cliente_fecha on public.sjap_movimientos_cuenta_cliente (cuenta_id, fecha);

-- ---------------------------------------------------------------------------
-- 7. Venta por promotor con turno/isla — fuente desconocida hoy (no viene en
--    el archivo diario). Se deja el modelo con "origen" para diferenciar
--    datos derivados automáticamente (agrupando por hora) de datos reales.
-- ---------------------------------------------------------------------------
create table public.sjap_ventas_promotor_turno (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  promotor_nombre text not null,
  turno text check (turno in ('T1','T2','T3','T4')),
  isla text,
  galones numeric(14,3),
  numero_clientes int,
  origen text not null default 'derivado' check (origen in ('manual','derivado','importado')),
  created_at timestamptz not null default now()
);
comment on table public.sjap_ventas_promotor_turno is 'Detalle de venta por promotor/turno/isla en galones. origen=derivado cuando se infiere agrupando transacciones por hora; ajustar cuando se conozca la fuente real.';
create index idx_sjap_ventas_promotor_turno_fecha on public.sjap_ventas_promotor_turno (estacion_id, fecha);

-- ---------------------------------------------------------------------------
-- 8. Balance diario calculado por producto (espeja G. Corriente / Bioacem / G. Extra)
-- ---------------------------------------------------------------------------
create table public.sjap_balance_diario_producto (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid not null references public.sjap_productos(id) on delete cascade,
  fecha date not null,
  inventario_inicial numeric(14,3),
  ventas_galones numeric(14,3) not null default 0,
  recibos_galones numeric(14,3) not null default 0,
  inventario_teorico numeric(14,3),
  inventario_final_real numeric(14,3),      -- copiado de sjap_lecturas_inventario cuando exista
  fluctuacion_dia numeric(14,3),
  fluctuacion_acumulada numeric(14,3),
  precio_vigente numeric(14,2),
  fluctuacion_valor numeric(14,2),
  estado text not null default 'pendiente_insumos'
    check (estado in ('pendiente_insumos','completo')),
  calculado_en timestamptz not null default now(),
  unique (estacion_id, producto_id, fecha)
);
comment on table public.sjap_balance_diario_producto is 'Reconciliación diaria de inventario por producto. inventario_inicial = inventario_final_real del día anterior (o teórico si aún no hay lectura real). Se recalcula cuando cambian sus insumos.';
create index idx_sjap_balance_diario_producto_fecha on public.sjap_balance_diario_producto (estacion_id, fecha);

-- ---------------------------------------------------------------------------
-- 9. Cierre diario consolidado (espeja la hoja "Cierre": 1 fila por día)
-- ---------------------------------------------------------------------------
create table public.sjap_cierre_diario (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  archivo_id uuid references public.sjap_archivos_cierre(id) on delete set null,
  fecha date not null,
  venta_total numeric(14,2) not null default 0,
  venta_galones_total numeric(14,3) not null default 0,
  numero_clientes int,
  efectivo_calculado numeric(14,2),   -- residual: total - suma(otros medios de pago)
  efectivo_real numeric(14,2),        -- de sjap_efectivo_diario
  diferencia_caja numeric(14,2),      -- efectivo_calculado - efectivo_real
  diferencia_caja_acumulada numeric(14,2),
  certificacion_bancaria numeric(14,2),
  diferencia_certificacion numeric(14,2),
  estado text not null default 'pendiente_insumos'
    check (estado in ('pendiente_insumos','completo','con_alertas')),
  calculado_en timestamptz not null default now(),
  unique (estacion_id, fecha)
);
comment on table public.sjap_cierre_diario is 'Balance diario consolidado (equivalente a la hoja "Cierre" del Excel). Los medios de pago viven en sjap_ventas_medio_pago en vez de columnas fijas.';

-- ---------------------------------------------------------------------------
-- 10. Auditoría / historial de procesamiento
-- ---------------------------------------------------------------------------
create table public.sjap_auditoria (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid references public.sjap_estaciones(id) on delete cascade,
  archivo_id uuid references public.sjap_archivos_cierre(id) on delete cascade,
  entidad text not null,
  entidad_id uuid,
  accion text not null,
  nivel text not null default 'info' check (nivel in ('info','warning','error')),
  detalle jsonb,
  created_by text,
  created_at timestamptz not null default now()
);
comment on table public.sjap_auditoria is 'Bitácora de procesamiento: qué se extrajo, qué falló, qué se recalculó y por qué.';
create index idx_sjap_auditoria_archivo on public.sjap_auditoria (archivo_id);
;

-- -----------------------------------------------------------------------------
-- 20260901151948_sjap_balance_schema_rls.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- SJAP — RLS: habilitado en todas las tablas, política permisiva para
-- usuarios autenticados mientras se define el modelo de acceso real
-- (multi-EDS con permisos por estación queda pendiente de diseño).
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'sjap_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;
;

-- -----------------------------------------------------------------------------
-- 20260901153813_sjap_allow_anon_for_poc.sql
-- -----------------------------------------------------------------------------
-- POC: la app aún no tiene login propio, así que se permite también al rol
-- anon (usa la publishable key). Antes de exponer esto a más usuarios que
-- Iván/Javier hay que: (1) agregar autenticación real y (2) restringir estas
-- políticas a `authenticated` con reglas por estación.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'sjap_%'
  loop
    execute format(
      'create policy %I on public.%I for all to anon using (true) with check (true)',
      t || '_anon_poc', t
    );
  end loop;
end $$;
;

-- -----------------------------------------------------------------------------
-- 20260901153818_sjap_productos_alias.sql
-- -----------------------------------------------------------------------------
alter table public.sjap_productos add column if not exists alias text[] not null default '{}';
comment on column public.sjap_productos.alias is 'Otros nombres con los que este producto puede aparecer en los archivos (ej. BIOACEM tiene alias {DIESEL}). El parser resuelve producto_id contra codigo o cualquier alias.';

update public.sjap_productos set alias = array['DIESEL'] where codigo = 'BIOACEM';
;

-- -----------------------------------------------------------------------------
-- 20260901153900_sjap_seed_estacion_base.sql
-- -----------------------------------------------------------------------------
-- Semilla base de la estación, para poder levantar un entorno NUEVO desde cero
-- con `supabase db push` / `supabase db reset`.
--
-- Agregada el 2026-09-23. En el proyecto original estos registros se crearon a
-- mano (fuera de migraciones) el 2026-09-01; este archivo los reproduce con los
-- MISMOS ids porque la migración 20260910174944 referencia el id de la estación
-- de forma fija. Es idempotente: en una base que ya tiene los datos no hace nada.
--
-- Para otra estación distinta a EDS LA FLORIDA: cambia nombre/ciudad aquí, pero
-- conserva el id (o ajusta también 20260910174944 antes de aplicar).

insert into public.sjap_estaciones (id, nombre, razon_social, ciudad, bandera, activa)
values ('884b3769-2c20-4a0b-8019-6972bf5e4caa', 'EDS LA FLORIDA', 'EDS JAP S.A.S.', 'Cota', 'Terpel', true)
on conflict (id) do nothing;

insert into public.sjap_productos (id, estacion_id, codigo, nombre_visible, unidad, orden, activo, alias)
values
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'CORRIENTE', 'Corriente', 'GALONES', 1, true, '{}'),
  ('6e896414-4056-4171-89ca-5320b71776a7', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'BIOACEM', 'ACPM / Diésel (Bioacem)', 'GALONES', 2, true, array['DIESEL']),
  ('092f4120-f868-4d4e-9d5b-470436512899', '884b3769-2c20-4a0b-8019-6972bf5e4caa', 'EXTRA', 'Extra', 'GALONES', 3, true, '{}')
on conflict (estacion_id, codigo) do nothing;

-- Precios históricos usados por los cierres de ene–feb 2026. En un entorno
-- nuevo, agrega aquí (o por SQL) los precios vigentes reales.
insert into public.sjap_precios_producto (producto_id, precio, vigente_desde)
values
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', 15590, '2026-02-01'),
  ('84a8ba37-2e42-46a3-9d7c-b0d4edebfa79', 15190, '2026-02-05'),
  ('6e896414-4056-4171-89ca-5320b71776a7', 10750, '2026-01-21'),
  ('092f4120-f868-4d4e-9d5b-470436512899', 19770, '2026-01-01'),
  ('092f4120-f868-4d4e-9d5b-470436512899', 18070, '2026-02-07')
on conflict (producto_id, vigente_desde) do nothing;
;

-- -----------------------------------------------------------------------------
-- 20260901173017_sjap_balance_schema_urea_presupuesto_sicom.sql
-- -----------------------------------------------------------------------------
-- ============================================================================
-- SJAP — Hojas adicionales del balance mensual: Urea, Presupuesto, Sicom.
-- Se agregan tal como existen en el Excel de referencia, sin inventar
-- reglas de negocio para lo que aún no está confirmado con el cliente.
-- ============================================================================

create table public.sjap_urea_diario (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  fecha date not null,
  inventario_inicial numeric(14,3),
  inventario_final numeric(14,3),
  inventario_teorico numeric(14,3),
  diferencia numeric(14,3),
  recibo numeric(14,3),
  rumbo_litros numeric(14,3),
  clientes_propios_litros numeric(14,3),
  valor numeric(14,2),
  valor_rumbo numeric(14,2),
  valor_propios numeric(14,2),
  total numeric(14,2),
  costo_unitario numeric(14,2),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, fecha)
);
comment on table public.sjap_urea_diario is 'Espeja la hoja "Urea": inventario/recibo/valor diario de urea (AdBlue), paralelo al de combustible.';

create table public.sjap_presupuesto_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  ventas numeric(14,2),
  compra numeric(14,2),
  rumbo numeric(14,2),
  clientes_propios numeric(14,2),
  clientes_paso numeric(14,2),
  presupuesto_total numeric(14,2),
  presupuesto_corriente numeric(14,2),
  presupuesto_acpm numeric(14,2),
  presupuesto_extra numeric(14,2),
  cumplimiento numeric(8,4),
  pct_rumbo numeric(8,4),
  pct_clientes_propios numeric(8,4),
  pct_clientes_paso numeric(8,4),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, anio, mes)
);
comment on table public.sjap_presupuesto_mensual is 'Espeja la hoja "Presupuesto": una fila por mes con ventas/compra reales vs. presupuestadas por producto.';

create table public.sjap_sicom_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references public.sjap_estaciones(id) on delete cascade,
  producto_id uuid references public.sjap_productos(id),
  producto_nombre_original text not null,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  inventario_inicial numeric(14,3),
  compras numeric(14,3),
  ventas numeric(14,3),
  faltantes numeric(14,3),
  evaporacion numeric(14,3),
  inventario_final_calculado numeric(14,3),
  inventario_final_real numeric(14,3),
  origen text not null default 'importado' check (origen in ('manual','importado')),
  created_at timestamptz not null default now(),
  unique (estacion_id, anio, mes, producto_nombre_original)
);
comment on table public.sjap_sicom_mensual is 'Espeja la hoja "Sicom": informe regulatorio mensual de inventario por producto, con la fórmula de evaporación.';

do $$
declare
  t text;
begin
  for t in select unnest(array['sjap_urea_diario','sjap_presupuesto_mensual','sjap_sicom_mensual'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    execute format('create policy %I on public.%I for all to anon using (true) with check (true)', t || '_anon_poc', t);
  end loop;
end $$;
;

-- -----------------------------------------------------------------------------
-- 20260910154227_create_sjap_promotores_e_islas.sql
-- -----------------------------------------------------------------------------
create table if not exists sjap_promotores (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

create table if not exists sjap_islas (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

alter table sjap_promotores enable row level security;
alter table sjap_islas enable row level security;

create policy sjap_promotores_authenticated_all on sjap_promotores for all to authenticated using (true) with check (true);
create policy sjap_promotores_anon_poc on sjap_promotores for all to anon using (true) with check (true);

create policy sjap_islas_authenticated_all on sjap_islas for all to authenticated using (true) with check (true);
create policy sjap_islas_anon_poc on sjap_islas for all to anon using (true) with check (true);

-- semilla desde los nombres que ya existen en el histórico, para no partir de cero
insert into sjap_promotores (estacion_id, nombre)
select distinct estacion_id, promotor_nombre
from sjap_ventas_promotor_turno
where promotor_nombre is not null
on conflict (estacion_id, nombre) do nothing;

insert into sjap_islas (estacion_id, nombre)
select distinct estacion_id, isla
from sjap_ventas_promotor_turno
where isla is not null and isla ~ '^[0-9]+$'
on conflict (estacion_id, nombre) do nothing;
;

-- -----------------------------------------------------------------------------
-- 20260910174944_create_turno_tipos_ausencias_programados.sql
-- -----------------------------------------------------------------------------
create table if not exists sjap_turno_tipos (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  hora_inicio time not null,
  hora_fin time not null,
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

create table if not exists sjap_ausencias (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  promotor_id uuid not null references sjap_promotores(id),
  fecha_desde date not null,
  fecha_hasta date not null,
  tipo text not null check (tipo in ('vacaciones','incapacidad','permiso','ausencia','dia_libre')),
  nota text,
  created_at timestamptz not null default now(),
  check (fecha_hasta >= fecha_desde)
);

create table if not exists sjap_turnos_programados (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  fecha date not null,
  promotor_id uuid not null references sjap_promotores(id),
  isla_id uuid not null references sjap_islas(id),
  turno_tipo_id uuid not null references sjap_turno_tipos(id),
  estado text not null default 'programado' check (estado in ('programado','ausente','reemplazado')),
  created_at timestamptz not null default now()
);

create index if not exists idx_sjap_turnos_programados_fecha on sjap_turnos_programados (estacion_id, fecha);
create index if not exists idx_sjap_ausencias_rango on sjap_ausencias (estacion_id, promotor_id, fecha_desde, fecha_hasta);

alter table sjap_turno_tipos enable row level security;
alter table sjap_ausencias enable row level security;
alter table sjap_turnos_programados enable row level security;

create policy sjap_turno_tipos_authenticated_all on sjap_turno_tipos for all to authenticated using (true) with check (true);
create policy sjap_turno_tipos_anon_poc on sjap_turno_tipos for all to anon using (true) with check (true);

create policy sjap_ausencias_authenticated_all on sjap_ausencias for all to authenticated using (true) with check (true);
create policy sjap_ausencias_anon_poc on sjap_ausencias for all to anon using (true) with check (true);

create policy sjap_turnos_programados_authenticated_all on sjap_turnos_programados for all to authenticated using (true) with check (true);
create policy sjap_turnos_programados_anon_poc on sjap_turnos_programados for all to anon using (true) with check (true);

insert into sjap_turno_tipos (estacion_id, nombre, hora_inicio, hora_fin, orden)
select '884b3769-2c20-4a0b-8019-6972bf5e4caa', v.nombre, v.hora_inicio::time, v.hora_fin::time, v.orden
from (values
  ('T1','06:00','12:00',1),
  ('T2','12:00','18:00',2),
  ('T3','18:00','23:59',3),
  ('T4','00:00','06:00',4)
) as v(nombre, hora_inicio, hora_fin, orden)
on conflict (estacion_id, nombre) do nothing;
;

-- -----------------------------------------------------------------------------
-- 20260910181013_create_sjap_usuarios.sql
-- -----------------------------------------------------------------------------
create table if not exists sjap_usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  estacion_id uuid not null references sjap_estaciones(id),
  username text not null unique,
  rol text not null default 'dependiente' check (rol in ('master','dependiente')),
  created_at timestamptz not null default now()
);

alter table sjap_usuarios enable row level security;

create policy sjap_usuarios_authenticated_all on sjap_usuarios for all to authenticated using (true) with check (true);
create policy sjap_usuarios_anon_poc on sjap_usuarios for all to anon using (true) with check (true);
;

-- -----------------------------------------------------------------------------
-- 20260917212709_sjap_rls_estacion_scope.sql
-- -----------------------------------------------------------------------------

-- Helper: estación del usuario autenticado actual (SECURITY DEFINER para poder
-- leer sjap_usuarios sin depender de la política de esa misma tabla).
create or replace function sjap_estacion_de_usuario()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select estacion_id from sjap_usuarios where auth_user_id = auth.uid() limit 1;
$$;

-- sjap_estaciones (tabla raíz: es la estación, no tiene estacion_id)
drop policy if exists sjap_estaciones_anon_poc on sjap_estaciones;
drop policy if exists sjap_estaciones_authenticated_all on sjap_estaciones;
create policy sjap_estaciones_scope on sjap_estaciones for all to authenticated
  using (id = sjap_estacion_de_usuario())
  with check (id = sjap_estacion_de_usuario());

-- Tablas con estacion_id directo
do $$
declare
  t text;
  tablas text[] := array[
    'sjap_productos','sjap_archivos_cierre','sjap_transacciones',
    'sjap_ventas_promotor_resumen','sjap_ventas_medio_pago','sjap_despachos_producto',
    'sjap_lecturas_inventario','sjap_facturas_compra','sjap_efectivo_diario',
    'sjap_cuentas_cliente','sjap_ventas_promotor_turno','sjap_balance_diario_producto',
    'sjap_cierre_diario','sjap_urea_diario','sjap_presupuesto_mensual','sjap_sicom_mensual',
    'sjap_promotores','sjap_islas','sjap_turno_tipos','sjap_ausencias',
    'sjap_turnos_programados','sjap_usuarios','sjap_auditoria'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists %I on %I', t || '_anon_poc', t);
    execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (estacion_id = sjap_estacion_de_usuario()) with check (estacion_id = sjap_estacion_de_usuario())',
      t || '_scope', t
    );
  end loop;
end $$;

-- Tablas escaladas via join (no tienen estacion_id propio)
drop policy if exists sjap_precios_producto_anon_poc on sjap_precios_producto;
drop policy if exists sjap_precios_producto_authenticated_all on sjap_precios_producto;
create policy sjap_precios_producto_scope on sjap_precios_producto for all to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()));

drop policy if exists sjap_archivos_cierre_historial_anon_poc on sjap_archivos_cierre_historial;
drop policy if exists sjap_archivos_cierre_historial_authenticated_all on sjap_archivos_cierre_historial;
create policy sjap_archivos_cierre_historial_scope on sjap_archivos_cierre_historial for all to authenticated
  using (exists (select 1 from sjap_archivos_cierre a where a.id = sjap_archivos_cierre_historial.archivo_id and a.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_archivos_cierre a where a.id = sjap_archivos_cierre_historial.archivo_id and a.estacion_id = sjap_estacion_de_usuario()));

drop policy if exists sjap_movimientos_cuenta_cliente_anon_poc on sjap_movimientos_cuenta_cliente;
drop policy if exists sjap_movimientos_cuenta_cliente_authenticated_all on sjap_movimientos_cuenta_cliente;
create policy sjap_movimientos_cuenta_cliente_scope on sjap_movimientos_cuenta_cliente for all to authenticated
  using (exists (select 1 from sjap_cuentas_cliente c where c.id = sjap_movimientos_cuenta_cliente.cuenta_id and c.estacion_id = sjap_estacion_de_usuario()))
  with check (exists (select 1 from sjap_cuentas_cliente c where c.id = sjap_movimientos_cuenta_cliente.cuenta_id and c.estacion_id = sjap_estacion_de_usuario()));
;

-- -----------------------------------------------------------------------------
-- 20260917212936_sjap_estacion_config.sql
-- -----------------------------------------------------------------------------

create table sjap_estacion_config (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  clave text not null,
  valor text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estacion_id, clave)
);

alter table sjap_estacion_config enable row level security;
create policy sjap_estacion_config_scope on sjap_estacion_config for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Semillas: los umbrales que hoy viven como literales dispersos en el código.
-- umbral_fluctuacion_galones: se documentaron dos valores distintos (5 y 100) para
-- la misma métrica en archivos distintos. Se elige 100 con base en los datos reales
-- de producción (fluctuaciones diarias de bioacem llegaron a ~1.700 galones en un
-- solo día en feb-2026; un corte de 5 marcaría como "peligroso" casi cualquier día).
insert into sjap_estacion_config (estacion_id, clave, valor, descripcion)
select id, 'umbral_fluctuacion_galones', '100', 'Fluctuación diaria de producto (galones) que se marca como alerta'
from sjap_estaciones
union all
select id, 'umbral_diferencia_caja_cop', '5000', 'Diferencia de caja (COP) que se marca como alerta'
from sjap_estaciones
union all
select id, 'umbral_sicom_galones', '50', 'Diferencia de inventario Sicom (galones) que se marca como alerta'
from sjap_estaciones
union all
select id, 'corte_cumplimiento_presupuesto', '1.0', 'Fracción de cumplimiento (compra/presupuesto) desde la cual se considera cumplido'
from sjap_estaciones;
;

-- -----------------------------------------------------------------------------
-- 20260917212954_sjap_medios_pago_catalogo.sql
-- -----------------------------------------------------------------------------

create table sjap_medios_pago (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);

alter table sjap_medios_pago enable row level security;
create policy sjap_medios_pago_scope on sjap_medios_pago for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Backfill: todos los medios de pago que ya existen en los datos reales,
-- incluyendo los que el arreglo hardcodeado de CierreTab.jsx no contemplaba
-- (EFECTIVO, CREDITO, CREDITO CLIENTES, TARJETA DEBITO, TRANSFERENCIA).
insert into sjap_medios_pago (estacion_id, nombre, orden)
select e.id, m.medio_pago, row_number() over (order by m.medio_pago)
from sjap_estaciones e
cross join (select distinct medio_pago from sjap_ventas_medio_pago) m;
;

-- -----------------------------------------------------------------------------
-- 20260917212955_sjap_seed_medios_pago.sql
-- -----------------------------------------------------------------------------
-- Semilla del catálogo de medios de pago, para entornos NUEVOS.
--
-- Agregada el 2026-09-23. La migración 20260917212954 llena el catálogo copiando
-- los medios que ya existían en sjap_ventas_medio_pago; en una base vacía eso no
-- inserta nada. Esta lista reproduce el catálogo real de EDS LA FLORIDA.
-- Idempotente: en una base que ya tiene los medios no hace nada.

insert into public.sjap_medios_pago (estacion_id, nombre, orden)
select '884b3769-2c20-4a0b-8019-6972bf5e4caa', v.nombre, v.orden
from (values
  ('APP TERPEL', 1), ('BONO VIVE TERPEL', 2), ('CLIENTES PROPIOS', 3), ('CONSUMOS TERPEL', 4),
  ('CREDITO', 5), ('CREDITO CLIENTES', 6), ('DATAFONO', 7), ('EFECTIVO', 8), ('GOPASS', 9),
  ('MI EMPRESA', 10), ('QR', 11), ('RUMBO', 12), ('TARJETA DEBITO', 13), ('TRANSFERENCIA', 14),
  ('UREA', 15), ('UREA RUMBO', 16), ('VIVE TERPEL', 17)
) as v(nombre, orden)
where exists (select 1 from public.sjap_estaciones where id = '884b3769-2c20-4a0b-8019-6972bf5e4caa')
on conflict (estacion_id, nombre) do nothing;
;

-- -----------------------------------------------------------------------------
-- 20260917213002_sjap_ventas_promotor_turno_fk.sql
-- -----------------------------------------------------------------------------

alter table sjap_ventas_promotor_turno
  add column turno_tipo_id uuid references sjap_turno_tipos(id),
  add column promotor_id uuid references sjap_promotores(id);

-- Backfill turno: los 4 códigos T1-T4 coinciden 1:1 con sjap_turno_tipos.nombre.
update sjap_ventas_promotor_turno v
set turno_tipo_id = t.id
from sjap_turno_tipos t
where t.estacion_id = v.estacion_id and t.nombre = v.turno;

-- Backfill promotor: solo donde el nombre coincide exactamente con un promotor
-- individual del catálogo. Los nombres compuestos históricos ("ANGIE RUIZ/CAMILO
-- SANCHEZ", "SAMUEL MORENO/SANTIAGO LEON", "VALENTINA COSSIO /DANIEL ARGEL")
-- representan 2 personas en una sola fila del Excel original y deliberadamente
-- quedan sin promotor_id (ambigüedad real, no se fuerza un match incorrecto) —
-- promotor_nombre se conserva intacto para no perder esos datos históricos.
update sjap_ventas_promotor_turno v
set promotor_id = p.id
from sjap_promotores p
where p.estacion_id = v.estacion_id and p.nombre = v.promotor_nombre;
;

-- -----------------------------------------------------------------------------
-- 20260917213010_sjap_auditoria_estacion_not_null.sql
-- -----------------------------------------------------------------------------
alter table sjap_auditoria alter column estacion_id set not null;
;

-- -----------------------------------------------------------------------------
-- 20260917213204_sjap_presupuesto_producto_mensual.sql
-- -----------------------------------------------------------------------------

-- Presupuesto por producto, normalizado (reemplaza el supuesto de "siempre 3
-- productos fijos" que vivía como 3 columnas en sjap_presupuesto_mensual).
create table sjap_presupuesto_producto_mensual (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  producto_id uuid not null references sjap_productos(id),
  anio integer not null,
  mes integer not null check (mes >= 1 and mes <= 12),
  presupuesto numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (estacion_id, producto_id, anio, mes)
);

alter table sjap_presupuesto_producto_mensual enable row level security;
create policy sjap_presupuesto_producto_mensual_scope on sjap_presupuesto_producto_mensual for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Migra los datos existentes de las 3 columnas fijas a filas por producto.
-- Las columnas viejas se dejan intactas (no se rompe nada que las lea todavía),
-- simplemente dejan de ser la fuente de verdad hacia adelante.
insert into sjap_presupuesto_producto_mensual (estacion_id, producto_id, anio, mes, presupuesto)
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_corriente
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'CORRIENTE'
where pm.presupuesto_corriente is not null
union all
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_acpm
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'BIOACEM'
where pm.presupuesto_acpm is not null
union all
select pm.estacion_id, p.id, pm.anio, pm.mes, pm.presupuesto_extra
from sjap_presupuesto_mensual pm
join sjap_productos p on p.estacion_id = pm.estacion_id and p.codigo = 'EXTRA'
where pm.presupuesto_extra is not null;
;

-- -----------------------------------------------------------------------------
-- 20260917215852_sjap_estaciones_campos_config.sql
-- -----------------------------------------------------------------------------

alter table sjap_estaciones
  add column direccion text,
  add column telefono text,
  add column email text,
  add column moneda text not null default 'COP',
  add column zona_horaria text not null default 'America/Bogota';
;

-- -----------------------------------------------------------------------------
-- 20260917215933_sjap_rls_roles_config_master.sql
-- -----------------------------------------------------------------------------

create or replace function sjap_rol_de_usuario()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from sjap_usuarios where auth_user_id = auth.uid() limit 1;
$$;

do $$
declare
  t text;
  tablas_config text[] := array[
    'sjap_productos','sjap_medios_pago',
    'sjap_estacion_config','sjap_presupuesto_mensual','sjap_presupuesto_producto_mensual',
    'sjap_estaciones','sjap_usuarios'
  ];
begin
  foreach t in array tablas_config loop
    execute format('drop policy if exists %I on %I', t || '_scope', t);
    execute format(
      'create policy %I on %I for select to authenticated using (%s)',
      t || '_select', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for insert to authenticated with check (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_write', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for update to authenticated using (%s and sjap_rol_de_usuario() = ''master'') with check (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_update', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
    execute format(
      'create policy %I on %I for delete to authenticated using (%s and sjap_rol_de_usuario() = ''master'')',
      t || '_delete', t,
      case when t in ('sjap_estaciones') then 'id = sjap_estacion_de_usuario()' else 'estacion_id = sjap_estacion_de_usuario()' end
    );
  end loop;
end $$;

drop policy if exists sjap_precios_producto_scope on sjap_precios_producto;
create policy sjap_precios_producto_select on sjap_precios_producto for select to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()));
create policy sjap_precios_producto_write on sjap_precios_producto for insert to authenticated
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
create policy sjap_precios_producto_update on sjap_precios_producto for update to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master')
  with check (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
create policy sjap_precios_producto_delete on sjap_precios_producto for delete to authenticated
  using (exists (select 1 from sjap_productos p where p.id = sjap_precios_producto.producto_id and p.estacion_id = sjap_estacion_de_usuario()) and sjap_rol_de_usuario() = 'master');
;

-- -----------------------------------------------------------------------------
-- 20260917222050_sjap_estacion_config_freshness.sql
-- -----------------------------------------------------------------------------

insert into sjap_estacion_config (estacion_id, clave, valor, descripcion)
select id, 'data_freshness_warning_days', '3', 'Días sin cierre nuevo desde los que se muestra advertencia de datos desactualizados'
from sjap_estaciones
union all
select id, 'data_freshness_critical_days', '7', 'Días sin cierre nuevo desde los que se muestra alerta crítica de datos desactualizados'
from sjap_estaciones
on conflict (estacion_id, clave) do nothing;
;

-- -----------------------------------------------------------------------------
-- 20260923211204_sjap_esquemas_turno_y_reglas.sql
-- -----------------------------------------------------------------------------

-- 1. Esquemas de turno: un conjunto de turnos (2, 3, 4 o los que sean) que
--    se puede asignar por defecto, por día de la semana, por isla o por fecha.
create table sjap_esquemas_turno (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  nombre text not null,
  es_predeterminado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (estacion_id, nombre)
);
create unique index sjap_esquemas_turno_un_predeterminado on sjap_esquemas_turno (estacion_id) where es_predeterminado;

alter table sjap_esquemas_turno enable row level security;
create policy sjap_esquemas_turno_scope on sjap_esquemas_turno for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- Los 4 turnos existentes pasan a un esquema predeterminado "Estándar":
-- ninguna asignación existente cambia de significado.
insert into sjap_esquemas_turno (estacion_id, nombre, es_predeterminado)
select id, 'Estándar', true from sjap_estaciones;

alter table sjap_turno_tipos add column esquema_id uuid references sjap_esquemas_turno(id);
update sjap_turno_tipos t set esquema_id = e.id
from sjap_esquemas_turno e where e.estacion_id = t.estacion_id and e.es_predeterminado;
alter table sjap_turno_tipos alter column esquema_id set not null;

-- El nombre deja de ser único por estación (dos esquemas pueden tener "Turno 1")
-- y pasa a ser único dentro del esquema. Diferible para permitir renombrar/
-- intercambiar nombres dentro de una misma transacción.
alter table sjap_turno_tipos drop constraint sjap_turno_tipos_estacion_id_nombre_key;
alter table sjap_turno_tipos add constraint sjap_turno_tipos_esquema_nombre_key
  unique (esquema_id, nombre) deferrable initially deferred;

-- 2. Reglas: qué esquema aplica. La más específica gana:
--    fecha+isla > fecha > día+isla > día > isla > esquema predeterminado.
create table sjap_esquema_reglas (
  id uuid primary key default gen_random_uuid(),
  estacion_id uuid not null references sjap_estaciones(id),
  esquema_id uuid not null references sjap_esquemas_turno(id) on delete cascade,
  isla_id uuid references sjap_islas(id),
  dia_semana smallint check (dia_semana between 0 and 6),
  fecha date,
  created_at timestamptz not null default now(),
  check (not (dia_semana is not null and fecha is not null)),
  check (isla_id is not null or dia_semana is not null or fecha is not null)
);
comment on column sjap_esquema_reglas.dia_semana is '0 = domingo … 6 = sábado (misma convención que Date.getDay())';
create unique index sjap_esquema_reglas_un_alcance on sjap_esquema_reglas (
  estacion_id,
  coalesce(isla_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(dia_semana, -1),
  coalesce(fecha, '0001-01-01'::date)
);

alter table sjap_esquema_reglas enable row level security;
create policy sjap_esquema_reglas_scope on sjap_esquema_reglas for all to authenticated
  using (estacion_id = sjap_estacion_de_usuario())
  with check (estacion_id = sjap_estacion_de_usuario());

-- 3. Validación: dentro de un esquema los turnos activos no pueden cruzarse
--    (incluidos los que pasan la medianoche) ni durar cero. Se evalúa al
--    cerrar la transacción, sobre el estado final.
create or replace function sjap_validar_turno_tipo() returns trigger
language plpgsql as $$
declare
  t record; o record;
  a1 int; a2 int; b1 int; b2 int;
begin
  select * into t from sjap_turno_tipos where id = new.id;
  if not found then return null; end if;

  a1 := extract(hour from t.hora_inicio)::int * 60 + extract(minute from t.hora_inicio)::int;
  a2 := extract(hour from t.hora_fin)::int * 60 + extract(minute from t.hora_fin)::int;
  if a1 = a2 then
    raise exception 'El turno "%" empieza y termina a la misma hora (%).', t.nombre, to_char(t.hora_inicio, 'HH24:MI');
  end if;
  if not t.activo then return null; end if;
  if a2 < a1 then a2 := a2 + 1440; end if;

  for o in select * from sjap_turno_tipos where esquema_id = t.esquema_id and activo and id <> t.id loop
    b1 := extract(hour from o.hora_inicio)::int * 60 + extract(minute from o.hora_inicio)::int;
    b2 := extract(hour from o.hora_fin)::int * 60 + extract(minute from o.hora_fin)::int;
    if b2 <= b1 then b2 := b2 + 1440; end if;
    if (a1 < b2 and b1 < a2) or (a1 < b2 + 1440 and b1 + 1440 < a2) or (a1 + 1440 < b2 and b1 < a2 + 1440) then
      raise exception 'El turno "%" (%–%) se cruza con "%" (%–%) en el mismo esquema.',
        t.nombre, to_char(t.hora_inicio, 'HH24:MI'), to_char(t.hora_fin, 'HH24:MI'),
        o.nombre, to_char(o.hora_inicio, 'HH24:MI'), to_char(o.hora_fin, 'HH24:MI');
    end if;
  end loop;
  return null;
end $$;

create constraint trigger sjap_turno_tipos_validar
  after insert or update on sjap_turno_tipos
  deferrable initially deferred
  for each row execute function sjap_validar_turno_tipo();

-- 4. Guardar un esquema completo en una sola transacción. Corre con los
--    permisos del usuario (RLS aplica). Los turnos que se quitan del esquema se
--    borran si no tienen asignaciones; si tienen, se desactivan para no perder
--    historial.
create or replace function sjap_guardar_esquema_turnos(p_esquema_id uuid, p_turnos jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estacion uuid;
  item jsonb;
  ids_conservados uuid[] := '{}';
  v_id uuid;
  i int := 0;
begin
  select estacion_id into v_estacion from sjap_esquemas_turno where id = p_esquema_id;
  if v_estacion is null then
    raise exception 'Esquema no encontrado.';
  end if;

  for item in select * from jsonb_array_elements(p_turnos) loop
    i := i + 1;
    if coalesce(trim(item->>'nombre'), '') = '' then
      raise exception 'Cada turno necesita un nombre.';
    end if;
    if nullif(item->>'id', '') is not null then
      update sjap_turno_tipos
        set nombre = trim(item->>'nombre'),
            hora_inicio = (item->>'hora_inicio')::time,
            hora_fin = (item->>'hora_fin')::time,
            orden = i,
            activo = true
        where id = (item->>'id')::uuid and esquema_id = p_esquema_id
        returning id into v_id;
      if v_id is null then
        raise exception 'Turno no encontrado en este esquema.';
      end if;
    else
      insert into sjap_turno_tipos (estacion_id, esquema_id, nombre, hora_inicio, hora_fin, orden, activo)
        values (v_estacion, p_esquema_id, trim(item->>'nombre'), (item->>'hora_inicio')::time, (item->>'hora_fin')::time, i, true)
        returning id into v_id;
    end if;
    ids_conservados := ids_conservados || v_id;
  end loop;

  update sjap_turno_tipos set activo = false
    where esquema_id = p_esquema_id and not (id = any(ids_conservados))
      and exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id);
  delete from sjap_turno_tipos
    where esquema_id = p_esquema_id and not (id = any(ids_conservados))
      and not exists (select 1 from sjap_turnos_programados p where p.turno_tipo_id = sjap_turno_tipos.id);
end $$;
;

-- -----------------------------------------------------------------------------
-- Permisos para la API (por si el proyecto se creó sin "exponer tablas nuevas").
-- La seguridad real la dan las reglas RLS de arriba: cada usuario solo ve los
-- datos de su estación.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and tablename like 'sjap\_%' loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
  end loop;
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'sjap\_%' loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end $$;


-- Fin del script 01. Continúa con 02_crear_usuario_master.sql
