import { useEffect, useRef, useState } from 'react';

const CLAVE = 'sjap_ultima_actividad';
const EVENTOS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
const AVISO_SEG = 60;

function leerCompartida() {
  try {
    return Number(localStorage.getItem(CLAVE)) || 0;
  } catch {
    return 0;
  }
}

function guardarCompartida(ts) {
  try {
    localStorage.setItem(CLAVE, String(ts));
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): cada pestaña cuenta sola.
  }
}

// Cierra la sesión tras `minutos` sin actividad (0 = nunca). Avisa 60 s antes
// para que la persona pueda seguir. La actividad se comparte entre pestañas
// abiertas, así que trabajar en una mantiene viva la otra. Usa la hora real
// (Date.now), por lo que también funciona si el equipo estuvo suspendido.
export function useInactividad({ activo, minutos, onExpira }) {
  const [segundosRestantes, setSegundosRestantes] = useState(null);
  const ultima = useRef(Date.now());
  const onExpiraRef = useRef(onExpira);
  onExpiraRef.current = onExpira;

  useEffect(() => {
    if (!activo || !minutos) {
      setSegundosRestantes(null);
      return undefined;
    }
    const limiteMs = minutos * 60 * 1000;
    ultima.current = Date.now();
    guardarCompartida(ultima.current);

    let ultimoGuardado = 0;
    const registrar = () => {
      const ahora = Date.now();
      ultima.current = ahora;
      // Escribir en localStorage a lo sumo cada 5 s (pointermove es muy frecuente).
      if (ahora - ultimoGuardado > 5000) {
        guardarCompartida(ahora);
        ultimoGuardado = ahora;
      }
    };
    EVENTOS.forEach((e) => window.addEventListener(e, registrar, { passive: true }));

    const revisar = () => {
      const referencia = Math.max(ultima.current, leerCompartida());
      const restanteMs = limiteMs - (Date.now() - referencia);
      if (restanteMs <= 0) {
        setSegundosRestantes(null);
        onExpiraRef.current?.();
      } else if (restanteMs <= AVISO_SEG * 1000) {
        setSegundosRestantes(Math.ceil(restanteMs / 1000));
      } else {
        setSegundosRestantes(null);
      }
    };
    const intervalo = setInterval(revisar, 1000);
    document.addEventListener('visibilitychange', revisar);

    return () => {
      EVENTOS.forEach((e) => window.removeEventListener(e, registrar));
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, [activo, minutos]);

  const seguir = () => {
    ultima.current = Date.now();
    guardarCompartida(ultima.current);
    setSegundosRestantes(null);
  };

  return { segundosRestantes, seguir };
}
