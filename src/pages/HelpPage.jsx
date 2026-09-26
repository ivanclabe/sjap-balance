import { UploadCloud, ScanSearch, Database, LayoutDashboard, ArrowRight } from 'lucide-react';

const FLUJO = [
  { icon: UploadCloud, titulo: 'Cargar', desc: 'Subes el .xlsx que exporta el POS al cierre del turno.' },
  { icon: ScanSearch, titulo: 'Extraer', desc: 'El parser ubica cada tabla dentro de las hojas y lee sus valores.' },
  { icon: Database, titulo: 'Consolidar', desc: 'Se guarda en Supabase; si el día ya existía, se reemplaza (no se duplica).' },
  { icon: LayoutDashboard, titulo: 'Revisar', desc: 'Dashboard, Diarios y Mensual muestran los datos ya consolidados.' },
];

const GLOSARIO = [
  {
    term: 'Insumos pendientes',
    def: 'El cierre del día se calculó con lo que trae el archivo, pero todavía falta al menos uno de estos tres datos que hoy se capturan a mano: la lectura física del tanque, las facturas de combustible recibido, o el efectivo real contado.',
  },
  {
    term: 'Completo',
    def: 'Los tres insumos manuales ya están cargados, así que el inventario y la caja del día quedaron totalmente reconciliados.',
  },
  {
    term: 'Diferencia de caja',
    def: 'Efectivo calculado (venta total menos los demás medios de pago) menos el efectivo real contado. Positivo significa que sobró dinero; negativo, que faltó.',
  },
  {
    term: 'Fluctuación',
    def: 'Diferencia entre el inventario teórico (inicial + recibos − ventas) y el inventario real medido con vara en el tanque. El combustible se mueve con la temperatura, así que rara vez da exactamente cero.',
  },
  {
    term: 'Cumplimiento',
    def: 'Compra real del mes dividida entre el presupuesto de compra. 100% o más significa que se alcanzó la meta.',
  },
  {
    term: 'Origen: manual vs. importado',
    def: '"Importado" quiere decir que el dato vino de un archivo (el cierre diario o el balance mensual de referencia). "Manual" significa que alguien lo escribió directamente en la app.',
  },
  {
    term: '"Tal cual" / dato sin confirmar',
    def: 'Algunas cifras (como las cuentas de "Clientes propios", el detalle de turno del promotor, o las fechas de Facturas) se muestran exactamente como están en el Excel de origen porque aún no sabemos con certeza de dónde salen día a día. Vienen marcadas con una nota amarilla en la pestaña correspondiente — no se inventó ninguna regla para "corregirlas".',
  },
];

export default function HelpPage() {
  return (
    <>
      <div className="page-header">
        <h1>Cómo funciona SJAP</h1>
        <p>Una guía corta del flujo de datos y de los términos que vas a encontrar en el resto de la app.</p>
      </div>

      <div className="panel">
        <div className="panel__header">
          <h2>Flujo general</h2>
        </div>
        <div className="help-flow">
          {FLUJO.map((f, i) => (
            <>
              <div className="help-flow__step" key={f.titulo}>
                <f.icon size={16} color="var(--green)" />
                <div className="help-flow__title" style={{ marginTop: 8 }}>
                  {f.titulo}
                </div>
                <div className="help-flow__desc">{f.desc}</div>
              </div>
              {i < FLUJO.length - 1 && (
                <div className="help-flow__arrow" key={`arrow-${f.titulo}`}>
                  <ArrowRight size={16} />
                </div>
              )}
            </>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Glosario</h2>
        </div>
        <div className="glossary">
          {GLOSARIO.map((g) => (
            <div className="glossary__item" key={g.term}>
              <div className="glossary__term">{g.term}</div>
              <div className="glossary__def">{g.def}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel__header">
          <h2>Balance mensual — qué es cada pestaña</h2>
        </div>
        <div className="glossary">
          <div className="glossary__item">
            <div className="glossary__term">Inventario</div>
            <div className="glossary__def">Un producto a la vez: inventario inicial, ventas, recibos, teórico vs. real y fluctuación, día por día.</div>
          </div>
          <div className="glossary__item">
            <div className="glossary__term">Fluctuaciones</div>
            <div className="glossary__def">Los tres productos juntos, para comparar de un vistazo qué producto se está descuadrando más.</div>
          </div>
          <div className="glossary__item">
            <div className="glossary__term">Cierre detallado</div>
            <div className="glossary__def">La tabla ancha con cada medio de pago (Rumbo, Datáfono, QR, etc.) como columna, un día por fila.</div>
          </div>
          <div className="glossary__item">
            <div className="glossary__term">Clientes propios</div>
            <div className="glossary__def">Ranking de las cuentas corporativas de crédito por consumo del mes.</div>
          </div>
          <div className="glossary__item">
            <div className="glossary__term">Promotor</div>
            <div className="glossary__def">Ranking de venta en galones por promotor, más el detalle día a día.</div>
          </div>
        </div>
      </div>
    </>
  );
}
