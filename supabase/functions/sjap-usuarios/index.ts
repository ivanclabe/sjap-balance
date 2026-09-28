import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: sjap-usuarios
// Toda la gestión de cuentas de SJAP Balance pasa por aquí, con la clave de
// servicio y validaciones del lado del servidor:
//   - cualquier usuario activo: cambiar_mi_password, nueva_password_recuperacion
//   - solo master: listar, crear, restablecer_password, cambiar_rol,
//     cambiar_correo, desactivar, reactivar
// Identidad: Supabase Auth (auth.users) es la fuente de verdad del correo y la
// contraseña. sjap_usuarios guarda solo el perfil de la app (usuario, nombre,
// rol, estado). Un usuario sin correo real usa el correo interno
// <usuario>@sjap.local y no puede recuperar su contraseña por correo.
// La estación SIEMPRE se toma del perfil de quien llama, nunca del cuerpo de
// la petición. Cada acción queda en sjap_auditoria (sin contraseñas).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_DOMINIO = "sjap.local";
const BAN_DESACTIVADO = "876000h"; // ~100 años: hasta que un master lo reactive
const PASSWORDS_COMUNES = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "contraseña", "qwerty123",
  "abc12345", "sjap1234", "terpel123", "terpel2026", "florida123", "admin123", "master123",
]);

class ErrorHttp extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Misma política que src/lib/password.js (el cliente solo la usa para avisar
// antes de enviar; la que manda es esta).
function validarPassword(password: unknown, username: string): string | null {
  if (typeof password !== "string") return "Escribe una contraseña.";
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (password.length > 72) return "La contraseña no puede tener más de 72 caracteres.";
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe combinar letras y números.";
  }
  const minuscula = password.toLowerCase();
  if ((username.length >= 4 && minuscula.includes(username)) || PASSWORDS_COMUNES.has(minuscula)) {
    return "Esa contraseña es demasiado fácil de adivinar. Elige otra.";
  }
  return null;
}

function correoInterno(username: string) {
  return `${username}@${EMAIL_DOMINIO}`;
}

function normalizarCorreo(valor: unknown, username: string): string {
  const correo = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (!correo) return correoInterno(username);
  if (!EMAIL_RE.test(correo) || correo.endsWith(`@${EMAIL_DOMINIO}`)) {
    throw new ErrorHttp(400, "El correo no es válido.");
  }
  return correo;
}

// Minutos desde que la sesión se abrió con un enlace de recuperación (claim amr).
function minutosDesdeRecuperacion(jwt: string): number | null {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const metodos = Array.isArray(payload.amr) ? payload.amr : [];
    const rec = metodos.find((m: { method?: string }) => ["recovery", "otp", "magiclink"].includes(String(m?.method)));
    if (!rec?.timestamp) return null;
    return (Date.now() / 1000 - Number(rec.timestamp)) / 60;
  } catch {
    return null;
  }
}

type Perfil = { id: string; auth_user_id: string; estacion_id: string; username: string; rol: string; activo: boolean };

async function auditar(admin: SupabaseClient, llamante: Perfil, objetivo: Perfil | null, accion: string, detalle: Record<string, unknown> = {}) {
  await admin.from("sjap_auditoria").insert({
    estacion_id: llamante.estacion_id,
    entidad: "usuario",
    entidad_id: objetivo?.id ?? null,
    accion,
    nivel: "info",
    detalle: { usuario: objetivo?.username ?? null, ...detalle },
    created_by: llamante.username,
  });
}

async function perfilObjetivo(admin: SupabaseClient, llamante: Perfil, id: unknown): Promise<Perfil> {
  if (typeof id !== "string" || !id) throw new ErrorHttp(400, "Falta el usuario.");
  const { data } = await admin
    .from("sjap_usuarios")
    .select("id, auth_user_id, estacion_id, username, rol, activo")
    .eq("id", id)
    .eq("estacion_id", llamante.estacion_id)
    .maybeSingle();
  if (!data) throw new ErrorHttp(404, "El usuario no existe en esta estación.");
  return data as Perfil;
}

function exigirMaster(llamante: Perfil) {
  if (llamante.rol !== "master") throw new ErrorHttp(403, "Solo un usuario master puede administrar usuarios.");
}

function noSobreSiMismo(llamante: Perfil, objetivo: Perfil, que: string) {
  if (llamante.id === objetivo.id) throw new ErrorHttp(400, `No puedes ${que} tu propio usuario. Pídeselo a otro master.`);
}

function mensajeBd(error: { message?: string } | null): string {
  const msg = error?.message ?? "Error de base de datos.";
  return msg.includes("al menos un usuario master") ? "La estación debe conservar al menos un usuario master activo." : msg;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) throw new ErrorHttp(401, "Sesión requerida.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // La clave pública también es un JWT válido: getUser() la rechaza porque
    // no corresponde a ningún usuario.
    const { data: sesion, error: errSesion } = await admin.auth.getUser(jwt);
    if (errSesion || !sesion?.user) throw new ErrorHttp(401, "Sesión inválida o vencida. Vuelve a iniciar sesión.");

    const { data: llamanteData } = await admin
      .from("sjap_usuarios")
      .select("id, auth_user_id, estacion_id, username, rol, activo")
      .eq("auth_user_id", sesion.user.id)
      .maybeSingle();
    const llamante = llamanteData as Perfil | null;
    if (!llamante || !llamante.activo) throw new ErrorHttp(403, "Tu usuario no tiene acceso a SJAP Balance.");

    const cuerpo = await req.json().catch(() => ({}));
    const accion = String(cuerpo.accion ?? "");

    switch (accion) {
      case "cambiar_mi_password": {
        const { actual, nueva } = cuerpo;
        if (typeof actual !== "string" || !actual) throw new ErrorHttp(400, "Escribe tu contraseña actual.");
        const invalida = validarPassword(nueva, llamante.username);
        if (invalida) throw new ErrorHttp(400, invalida);
        if (nueva === actual) throw new ErrorHttp(400, "La nueva contraseña debe ser distinta de la actual.");

        // Se verifica la contraseña actual con un cliente aparte y se cierra
        // solo esa sesión de verificación (scope local), no la del usuario.
        const verificador = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
        const { error: errActual } = await verificador.auth.signInWithPassword({
          email: sesion.user.email ?? correoInterno(llamante.username),
          password: actual,
        });
        if (errActual) throw new ErrorHttp(400, "La contraseña actual no es correcta.");
        await verificador.auth.signOut({ scope: "local" });

        const { error } = await admin.auth.admin.updateUserById(llamante.auth_user_id, { password: nueva });
        if (error) throw new ErrorHttp(400, error.message);
        await admin.from("sjap_usuarios").update({ debe_cambiar_password: false }).eq("id", llamante.id);
        await auditar(admin, llamante, llamante, "cambiar_mi_password");
        return responder({ ok: true });
      }

      case "nueva_password_recuperacion": {
        // Solo desde una sesión abierta con el enlace de recuperación del correo
        // en los últimos 15 minutos.
        const minutos = minutosDesdeRecuperacion(jwt);
        if (minutos == null || minutos > 15) {
          throw new ErrorHttp(403, "El enlace de recuperación venció. Pide uno nuevo desde la pantalla de ingreso.");
        }
        const invalida = validarPassword(cuerpo.nueva, llamante.username);
        if (invalida) throw new ErrorHttp(400, invalida);
        const { error } = await admin.auth.admin.updateUserById(llamante.auth_user_id, { password: cuerpo.nueva });
        if (error) throw new ErrorHttp(400, error.message);
        await admin.from("sjap_usuarios").update({ debe_cambiar_password: false }).eq("id", llamante.id);
        await auditar(admin, llamante, llamante, "recuperar_password");
        return responder({ ok: true });
      }

      case "cambiar_correo": {
        exigirMaster(llamante);
        const objetivo = await perfilObjetivo(admin, llamante, cuerpo.id);
        const correo = normalizarCorreo(cuerpo.email, objetivo.username);
        const { error } = await admin.auth.admin.updateUserById(objetivo.auth_user_id, { email: correo, email_confirm: true });
        if (error) {
          const repetido = /already|registered|exists/i.test(error.message);
          throw new ErrorHttp(repetido ? 409 : 400, repetido ? "Ese correo ya lo usa otra cuenta." : error.message);
        }
        await auditar(admin, llamante, objetivo, "cambiar_correo", { correo_real: !correo.endsWith(`@${EMAIL_DOMINIO}`) });
        return responder({ ok: true, email: correo });
      }

      case "listar": {
        exigirMaster(llamante);
        const { data, error } = await admin
          .from("sjap_usuarios")
          .select("id, auth_user_id, username, nombre, rol, activo, debe_cambiar_password, created_at")
          .eq("estacion_id", llamante.estacion_id)
          .order("username");
        if (error) throw new ErrorHttp(500, error.message);
        const usuarios = await Promise.all(
          (data ?? []).map(async (u) => {
            const { data: auth } = await admin.auth.admin.getUserById(u.auth_user_id);
            const { auth_user_id: _omitido, ...resto } = u;
            const email = auth?.user?.email ?? null;
            return {
              ...resto,
              email: email && !email.endsWith(`@${EMAIL_DOMINIO}`) ? email : null,
              ultimo_ingreso: auth?.user?.last_sign_in_at ?? null,
              es_yo: u.id === llamante.id,
            };
          }),
        );
        return responder({ ok: true, usuarios });
      }

      case "crear": {
        exigirMaster(llamante);
        const usuario = String(cuerpo.username ?? "").trim().toLowerCase();
        if (!USERNAME_RE.test(usuario)) {
          throw new ErrorHttp(400, "El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.");
        }
        const invalida = validarPassword(cuerpo.password, usuario);
        if (invalida) throw new ErrorHttp(400, invalida);
        const rol = cuerpo.rol === "master" ? "master" : "dependiente";
        const nombre = typeof cuerpo.nombre === "string" && cuerpo.nombre.trim() ? cuerpo.nombre.trim().slice(0, 80) : null;

        const { data: existente } = await admin.from("sjap_usuarios").select("id").eq("username", usuario).maybeSingle();
        if (existente) throw new ErrorHttp(409, `El usuario "${usuario}" ya existe.`);

        const correo = normalizarCorreo(cuerpo.email, usuario);
        const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
          email: correo,
          password: cuerpo.password,
          email_confirm: true,
          user_metadata: { username: usuario },
        });
        if (errCrear) {
          const repetido = /already|registered|exists/i.test(errCrear.message);
          throw new ErrorHttp(repetido ? 409 : 400,
            repetido ? (correo.endsWith(`@${EMAIL_DOMINIO}`) ? `El usuario "${usuario}" ya existe.` : "Ese correo ya lo usa otra cuenta.") : errCrear.message);
        }

        const { data: perfil, error: errPerfil } = await admin
          .from("sjap_usuarios")
          .insert({
            auth_user_id: creado.user.id,
            estacion_id: llamante.estacion_id,
            username: usuario,
            nombre,
            rol,
            debe_cambiar_password: true,
          })
          .select("id, auth_user_id, estacion_id, username, rol, activo")
          .single();
        if (errPerfil) {
          // Sin perfil el usuario no podría operar: se deshace la cuenta de Auth.
          await admin.auth.admin.deleteUser(creado.user.id);
          throw new ErrorHttp(500, errPerfil.message);
        }
        await auditar(admin, llamante, perfil as Perfil, "crear_usuario", { rol });
        return responder({ ok: true, username: usuario, rol });
      }

      case "restablecer_password": {
        exigirMaster(llamante);
        const objetivo = await perfilObjetivo(admin, llamante, cuerpo.id);
        noSobreSiMismo(llamante, objetivo, "restablecer la contraseña de");
        const invalida = validarPassword(cuerpo.password, objetivo.username);
        if (invalida) throw new ErrorHttp(400, invalida);
        const { error } = await admin.auth.admin.updateUserById(objetivo.auth_user_id, { password: cuerpo.password });
        if (error) throw new ErrorHttp(400, error.message);
        await admin.from("sjap_usuarios").update({ debe_cambiar_password: true }).eq("id", objetivo.id);
        await auditar(admin, llamante, objetivo, "restablecer_password");
        return responder({ ok: true });
      }

      case "cambiar_rol": {
        exigirMaster(llamante);
        const objetivo = await perfilObjetivo(admin, llamante, cuerpo.id);
        noSobreSiMismo(llamante, objetivo, "cambiar el rol de");
        const rol = cuerpo.rol === "master" ? "master" : "dependiente";
        if (rol === objetivo.rol) return responder({ ok: true });
        const { error } = await admin.from("sjap_usuarios").update({ rol }).eq("id", objetivo.id);
        if (error) throw new ErrorHttp(409, mensajeBd(error));
        await auditar(admin, llamante, objetivo, "cambiar_rol", { de: objetivo.rol, a: rol });
        return responder({ ok: true });
      }

      case "desactivar": {
        exigirMaster(llamante);
        const objetivo = await perfilObjetivo(admin, llamante, cuerpo.id);
        noSobreSiMismo(llamante, objetivo, "desactivar");
        // Primero la base (el trigger impide dejar la estación sin master);
        // luego el bloqueo en Auth, que impide iniciar sesión y renovar la sesión.
        const { error } = await admin.from("sjap_usuarios").update({ activo: false }).eq("id", objetivo.id);
        if (error) throw new ErrorHttp(409, mensajeBd(error));
        const { error: errBan } = await admin.auth.admin.updateUserById(objetivo.auth_user_id, { ban_duration: BAN_DESACTIVADO });
        if (errBan) {
          await admin.from("sjap_usuarios").update({ activo: true }).eq("id", objetivo.id);
          throw new ErrorHttp(500, errBan.message);
        }
        await auditar(admin, llamante, objetivo, "desactivar_usuario");
        return responder({ ok: true });
      }

      case "reactivar": {
        exigirMaster(llamante);
        const objetivo = await perfilObjetivo(admin, llamante, cuerpo.id);
        const { error: errBan } = await admin.auth.admin.updateUserById(objetivo.auth_user_id, { ban_duration: "none" });
        if (errBan) throw new ErrorHttp(500, errBan.message);
        const { error } = await admin.from("sjap_usuarios").update({ activo: true }).eq("id", objetivo.id);
        if (error) throw new ErrorHttp(500, error.message);
        await auditar(admin, llamante, objetivo, "reactivar_usuario");
        return responder({ ok: true });
      }

      default:
        throw new ErrorHttp(400, "Acción no reconocida.");
    }
  } catch (err) {
    if (err instanceof ErrorHttp) return responder({ ok: false, error: err.message }, err.status);
    console.error(err);
    return responder({ ok: false, error: err instanceof Error ? err.message : "Error interno." }, 500);
  }
});
