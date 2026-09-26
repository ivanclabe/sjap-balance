export function formatCOP(n) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

export function formatCOPCorto(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function formatNumero(n, dec = 2) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: dec }).format(n);
}

export function formatFecha(fecha, opts = {}) {
  if (!fecha) return '—';
  const d = new Date(`${fecha}T00:00:00`);
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', ...opts }).format(d);
}

export function formatFechaLarga(fecha) {
  if (!fecha) return '—';
  const d = new Date(`${fecha}T00:00:00`);
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

export function nombreMes(anio, mes) {
  const d = new Date(anio, mes - 1, 1);
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(d);
}
