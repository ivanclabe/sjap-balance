import json

d = json.load(open('extracted.json'))

EST = '884b3769-2c20-4a0b-8019-6972bf5e4caa'
PROD = {
    'CORRIENTE': '84a8ba37-2e42-46a3-9d7c-b0d4edebfa79',
    'BIOACEM': '6e896414-4056-4171-89ca-5320b71776a7',
    'EXTRA': '092f4120-f868-4d4e-9d5b-470436512899',
}
DAY12_ARCHIVO = 'dc0f2ba8-22db-437f-b627-c097d26f006c'


def sq(v):
    if v is None:
        return 'null'
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    return str(v)


def fecha(dia):
    return f"2026-02-{dia:02d}"


def write(name, sql):
    with open(name, 'w') as f:
        f.write(sql)
    print(name, len(sql), 'bytes')


def archivo_expr(dia):
    if dia == 12:
        return f"'{DAY12_ARCHIVO}'"
    return f"(select id from public.sjap_archivos_cierre where estacion_id='{EST}' and fecha='{fecha(dia)}')"


# 00: archivos placeholder
vals = [f"('{EST}', '{fecha(dia)}', 'BALANCE EJEMPLO.xlsx (importación mensual)', 'procesado')"
        for dia in range(1, 29) if dia != 12]
write('sql_00_archivos.sql',
      "insert into public.sjap_archivos_cierre (estacion_id, fecha, nombre_archivo, estado) values\n"
      + ",\n".join(vals) + "\non conflict (estacion_id, fecha) do nothing;")

# 01: balance_diario_producto
vals = []
for codigo, dias in d['producto_dias'].items():
    for r in dias:
        vals.append(
            f"('{EST}','{PROD[codigo]}','{fecha(r['dia'])}',{sq(r['inventario_inicial'])},{sq(r['ventas'])},"
            f"{sq(r['recibos'])},{sq(r['inventario_teorico'])},{sq(r['inventario_final'])},{sq(r['fluctuacion_dia'])},"
            f"{sq(r['fluctuacion_acum'])},{sq(r['fluctuacion_valor'])},'completo')"
        )
write('sql_01_balance_producto.sql',
      "insert into public.sjap_balance_diario_producto (estacion_id, producto_id, fecha, inventario_inicial, "
      "ventas_galones, recibos_galones, inventario_teorico, inventario_final_real, fluctuacion_dia, "
      "fluctuacion_acumulada, fluctuacion_valor, estado) values\n" + ",\n".join(vals)
      + "\non conflict (estacion_id, producto_id, fecha) do update set inventario_inicial=excluded.inventario_inicial,"
      "ventas_galones=excluded.ventas_galones, recibos_galones=excluded.recibos_galones, "
      "inventario_teorico=excluded.inventario_teorico, inventario_final_real=excluded.inventario_final_real, "
      "fluctuacion_dia=excluded.fluctuacion_dia, fluctuacion_acumulada=excluded.fluctuacion_acumulada, "
      "fluctuacion_valor=excluded.fluctuacion_valor, estado=excluded.estado;")

# 02: cierre_diario
vals = []
for r in d['cierre_dias']:
    vals.append(
        f"('{EST}','{fecha(r['dia'])}',{sq(r['vta_total'])},{sq(r['vta_gl'])},{sq(r['num_clientes'])},"
        f"{sq(r['efectivo'])},{sq(r['efectivo_real'])},{sq(r['diferencia_efectivo'])},{sq(r['diferencia_efectivo_acum'])},"
        f"{sq(r['certificacion'])},{sq(r['diferencia_certificacion'])},'completo')"
    )
write('sql_02_cierre.sql',
      "insert into public.sjap_cierre_diario (estacion_id, fecha, venta_total, venta_galones_total, numero_clientes, "
      "efectivo_calculado, efectivo_real, diferencia_caja, diferencia_caja_acumulada, certificacion_bancaria, "
      "diferencia_certificacion, estado) values\n" + ",\n".join(vals)
      + "\non conflict (estacion_id, fecha) do update set venta_total=excluded.venta_total, "
      "venta_galones_total=excluded.venta_galones_total, numero_clientes=excluded.numero_clientes, "
      "efectivo_calculado=excluded.efectivo_calculado, efectivo_real=excluded.efectivo_real, "
      "diferencia_caja=excluded.diferencia_caja, diferencia_caja_acumulada=excluded.diferencia_caja_acumulada, "
      "certificacion_bancaria=excluded.certificacion_bancaria, diferencia_certificacion=excluded.diferencia_certificacion, "
      "estado=excluded.estado;")

# 03: medios de pago (chunk by 10 days per file)
MEDIOS = [
    ('rumbo', 'RUMBO'), ('urea_rumbo', 'UREA RUMBO'), ('cons_terpel', 'CONSUMOS TERPEL'),
    ('mi_emp', 'MI EMPRESA'), ('clien_propios', 'CLIENTES PROPIOS'), ('app_terpel', 'APP TERPEL'),
    ('go_pass', 'GOPASS'), ('datafono', 'DATAFONO'), ('qr', 'QR'), ('ajustes', 'AJUSTES'),
    ('vive_terpel', 'VIVE TERPEL'), ('urea', 'UREA'),
]
chunks = [d['cierre_dias'][i:i + 10] for i in range(0, len(d['cierre_dias']), 10)]
for idx, chunk in enumerate(chunks):
    vals = []
    for r in chunk:
        archivo = archivo_expr(r['dia'])
        for field, label in MEDIOS:
            v = r.get(field)
            if v is None:
                continue
            vals.append(f"({archivo},'{EST}','{fecha(r['dia'])}',{sq(label)},{sq(v)})")
    write(f'sql_03_medios_{idx}.sql',
          "insert into public.sjap_ventas_medio_pago (archivo_id, estacion_id, fecha, medio_pago, total_ventas) values\n"
          + ",\n".join(vals) + "\non conflict (archivo_id, medio_pago) do nothing;")

print('DONE batch 1')
