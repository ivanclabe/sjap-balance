alter table public.sjap_productos add column if not exists alias text[] not null default '{}';
comment on column public.sjap_productos.alias is 'Otros nombres con los que este producto puede aparecer en los archivos (ej. BIOACEM tiene alias {DIESEL}). El parser resuelve producto_id contra codigo o cualquier alias.';

update public.sjap_productos set alias = array['DIESEL'] where codigo = 'BIOACEM';
