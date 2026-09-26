import { useState } from 'react';
import { Info } from 'lucide-react';

// Ícono "i" que muestra una explicación corta al pasar el mouse o al tocar
// (para pantallas táctiles). Úsalo junto a cualquier etiqueta o cifra que no
// sea obvia a primera vista.
export default function InfoTip({ children, side = 'right' }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <span
      className="info-tip"
      onMouseEnter={() => setAbierto(true)}
      onMouseLeave={() => setAbierto(false)}
      onClick={(e) => {
        e.stopPropagation();
        setAbierto((v) => !v);
      }}
    >
      <Info size={12} />
      {abierto && <span className={`info-tip__bubble info-tip__bubble--${side}`}>{children}</span>}
    </span>
  );
}
