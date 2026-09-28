import { useEffect, useState } from 'react';

// Botón de dos pasos para acciones destructivas: el primer clic pide
// confirmación en el mismo lugar (sin ventanas emergentes) y se cancela solo
// a los pocos segundos si la persona no confirma.
export default function ConfirmarAccion({
  children,
  pregunta = '¿Seguro?',
  textoConfirmar = 'Sí, eliminar',
  onConfirmar,
  className = 'btn btn--sm btn--peligro',
  disabled = false,
  title,
  ariaLabel,
}) {
  const [pidiendo, setPidiendo] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    if (!pidiendo) return undefined;
    const t = setTimeout(() => setPidiendo(false), 6000);
    return () => clearTimeout(t);
  }, [pidiendo]);

  if (!pidiendo) {
    return (
      <button type="button" className={className} onClick={() => setPidiendo(true)} disabled={disabled} title={title} aria-label={ariaLabel}>
        {children}
      </button>
    );
  }

  return (
    <span className="confirmar-accion" role="group" aria-label={pregunta}>
      <span className="confirmar-accion__pregunta">{pregunta}</span>
      <button
        type="button"
        className="btn btn--sm btn--peligro-solido"
        disabled={trabajando}
        autoFocus
        onClick={async () => {
          setTrabajando(true);
          try {
            await onConfirmar();
          } finally {
            setTrabajando(false);
            setPidiendo(false);
          }
        }}
      >
        {trabajando ? '…' : textoConfirmar}
      </button>
      <button type="button" className="btn btn--sm" onClick={() => setPidiendo(false)} disabled={trabajando}>
        Cancelar
      </button>
    </span>
  );
}
