// Política de contraseñas de SJAP Balance. La que manda es la de la Edge
// Function sjap-usuarios (servidor); esta copia solo sirve para avisar en
// pantalla antes de enviar. Si cambias una regla, cámbiala en ambos lados.

const COMUNES = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña', 'qwerty123',
  'abc12345', 'sjap1234', 'terpel123', 'terpel2026', 'florida123', 'admin123', 'master123',
]);

export const REGLAS_PASSWORD = [
  { id: 'largo', texto: 'Al menos 8 caracteres', cumple: (pw) => pw.length >= 8 && pw.length <= 72 },
  { id: 'mezcla', texto: 'Letras y números', cumple: (pw) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(pw) && /\d/.test(pw) },
  {
    id: 'facil',
    texto: 'Que no sea fácil de adivinar (ni tu usuario ni claves comunes)',
    cumple: (pw, username = '') => {
      const min = pw.toLowerCase();
      return pw.length > 0 && !COMUNES.has(min) && !(username.length >= 4 && min.includes(username.toLowerCase()));
    },
  },
];

export function validarPassword(pw, username = '') {
  if (!pw) return 'Escribe una contraseña.';
  if (pw.length > 72) return 'La contraseña no puede tener más de 72 caracteres.';
  const fallida = REGLAS_PASSWORD.find((r) => !r.cumple(pw, username));
  if (!fallida) return null;
  if (fallida.id === 'largo') return 'La contraseña debe tener al menos 8 caracteres.';
  if (fallida.id === 'mezcla') return 'La contraseña debe combinar letras y números.';
  return 'Esa contraseña es demasiado fácil de adivinar. Elige otra.';
}

// Contraseña temporal legible para dictar o copiar: sin caracteres que se
// confundan (0/O, 1/l/I). Ejemplo: "Kpdr-7m4Vx".
export function generarPassword() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const azar = (n) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const pick = (s) => s[azar(s.length)];
  const bloque1 = Array.from({ length: 4 }, () => pick(letras)).join('');
  const bloque2 = [pick(digitos), pick(letras), pick(digitos), pick(letras), pick(letras)].join('');
  return `${bloque1[0].toUpperCase()}${bloque1.slice(1)}-${bloque2}`;
}

export async function mensajeDeFuncion(error) {
  // Si una Edge Function responde con error, el detalle viene en el cuerpo.
  const cuerpo = await error?.context?.json?.().catch(() => null);
  return cuerpo?.error || error?.message || 'No se pudo completar la operación.';
}
