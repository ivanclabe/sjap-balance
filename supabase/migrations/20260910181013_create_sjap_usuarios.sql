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
