
alter table sjap_estaciones
  add column direccion text,
  add column telefono text,
  add column email text,
  add column moneda text not null default 'COP',
  add column zona_horaria text not null default 'America/Bogota';
