import { useMemo } from 'react';
import { useUltimoCierre } from './useUltimoCierre.js';
import { useEstacionConfig } from './useEstacionConfig.js';
import { formatFechaLarga } from '../lib/format.js';

function diasEntre(fechaISO) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(`${fechaISO}T00:00:00`);
  return Math.round((hoy - fecha) / 86400000);
}

/**
 * Fuente única de verdad sobre qué tan reciente es la información disponible.
 * Reutiliza useUltimoCierre (mismo dato que ya alimenta la barra superior y el
 * dashboard) — no vuelve a consultar sjap_cierre_diario por su cuenta.
 *
 * Los umbrales (data_freshness_warning_days / _critical_days) viven en
 * sjap_estacion_config, no hardcodeados — configurables por estación porque la
 * cadencia real de carga (ej. "se sube el lunes todo el fin de semana junto")
 * varía de una operación a otra.
 */
export function useFreshness(estacionId) {
  const { cierre, cargando: cargandoCierre } = useUltimoCierre(estacionId);
  const { config, cargando: cargandoConfig } = useEstacionConfig(estacionId);

  return useMemo(() => {
    const cargando = cargandoCierre || cargandoConfig;
    if (cargando || !cierre) {
      return {
        cargando,
        ultimaFecha: null,
        diasSinCierre: null,
        nivel: cargando ? 'cargando' : 'sin_datos',
        mensaje: cargando ? null : 'No se ha registrado ningún cierre todavía.',
      };
    }

    const dias = diasEntre(cierre.fecha);
    const nivel = dias <= config.data_freshness_warning_days ? 'ok' : dias <= config.data_freshness_critical_days ? 'advertencia' : 'critico';

    const fechaLarga = formatFechaLarga(cierre.fecha);
    let mensaje;
    if (nivel === 'ok') {
      mensaje = `Datos al día — último cierre registrado el ${fechaLarga}.`;
    } else if (nivel === 'advertencia') {
      mensaje = `El último cierre registrado es del ${fechaLarga} — ${dias} días sin cierres nuevos. Los indicadores podrían no reflejar los últimos días de operación.`;
    } else {
      mensaje = `No se han registrado cierres en ${dias} días. El último disponible es del ${fechaLarga} — la información mostrada probablemente no representa la operación actual.`;
    }

    return { cargando: false, ultimaFecha: cierre.fecha, diasSinCierre: dias, nivel, mensaje };
  }, [cierre, cargandoCierre, cargandoConfig, config.data_freshness_warning_days, config.data_freshness_critical_days]);
}

// Un mes/año consultado es "histórico deliberado" si termina antes del mes
// actual — no debe disparar la alerta de desactualización solo porque hoy es
// una fecha posterior. Solo el mes actual (o uno futuro, ej. mal seleccionado)
// hereda la alerta global.
export function esPeriodoActualOFuturo(anio, mes) {
  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  return anio > anioActual || (anio === anioActual && mes >= mesActual);
}
