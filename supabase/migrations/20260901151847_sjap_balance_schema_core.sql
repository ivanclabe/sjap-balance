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
