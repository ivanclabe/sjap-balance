// Helpers de normalización de valores tal como vienen del export del POS.

export function parseFecha(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }
  return null;
}

export function parseHora(v) {
  if (v instanceof Date) {
    return v.toISOString().slice(11, 19);
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let [, hh, mm, ampm] = m;
      hh = parseInt(hh, 10);
      if (/pm/i.test(ampm) && hh !== 12) hh += 12;
      if (/am/i.test(ampm) && hh === 12) hh = 0;
      return `${String(hh).padStart(2, '0')}:${mm}:00`;
    }
  }
  if (typeof v === 'number') {
    // fracción de día (formato hora nativo de Excel)
    const totalSeconds = Math.round(v * 24 * 60 * 60);
    const hh = Math.floor(totalSeconds / 3600) % 24;
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return null;
}

// "266103 - FELA" -> { consecutivo: "266103", prefijo: "FELA" }
// "121566 - " (sin prefijo) -> { consecutivo: "121566", prefijo: null }
export function parseConsecutivo(v) {
  if (v === null || v === undefined) return { consecutivo: null, prefijo: null };
  const s = String(v).trim();
  const m = s.match(/^(.+?)\s*-\s*(.*)$/);
  if (m) {
    const prefijo = m[2].trim();
    return { consecutivo: m[1].trim(), prefijo: prefijo || null };
  }
  return { consecutivo: s, prefijo: null };
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
