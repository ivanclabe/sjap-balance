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
