import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: admin-crear-usuario
// Crea un usuario de Supabase Auth pre-confirmado + su fila en sjap_usuarios.
// Solo un usuario 'master' autenticado puede llamarla, y el usuario nuevo
// queda en la estación del master que lo crea (la estación nunca se toma del
// cuerpo de la petición).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

function responder(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return responder({ ok: false, error: "Sesión requerida." }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // La clave anónima pública también es un JWT válido: getUser() la rechaza
    // porque no corresponde a ningún usuario.
    const { data: sesion, error: errSesion } = await admin.auth.getUser(jwt);
    if (errSesion || !sesion?.user) return responder({ ok: false, error: "Sesión inválida." }, 401);

    const { data: llamante } = await admin
      .from("sjap_usuarios")
      .select("rol, estacion_id")
      .eq("auth_user_id", sesion.user.id)
      .maybeSingle();
    if (!llamante || llamante.rol !== "master") {
      return responder({ ok: false, error: "Solo un usuario master puede crear usuarios." }, 403);
    }

    const { username, password, rol } = await req.json();
    const usuario = String(username ?? "").trim().toLowerCase();
    if (!USERNAME_RE.test(usuario)) {
      return responder(
        { ok: false, error: "El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto, guion o guion bajo." },
        400,
      );
    }
    if (typeof password !== "string" || password.length < 6) {
      return responder({ ok: false, error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    }
    const rolNuevo = rol === "master" ? "master" : "dependiente";

    const { data: existente } = await admin.from("sjap_usuarios").select("id").eq("username", usuario).maybeSingle();
    if (existente) return responder({ ok: false, error: `El usuario "${usuario}" ya existe.` }, 409);

    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email: `${usuario}@sjap.local`,
      password,
      email_confirm: true,
    });
    if (errCrear) return responder({ ok: false, error: errCrear.message }, 400);

    const { error: errPerfil } = await admin.from("sjap_usuarios").insert({
      auth_user_id: creado.user.id,
      estacion_id: llamante.estacion_id,
      username: usuario,
      rol: rolNuevo,
    });
    if (errPerfil) {
      // Sin perfil el usuario no podría operar: se deshace la cuenta de Auth.
      await admin.auth.admin.deleteUser(creado.user.id);
      throw errPerfil;
    }

    return responder({ ok: true, username: usuario, rol: rolNuevo });
  } catch (err) {
    console.error(err);
    return responder({ ok: false, error: err instanceof Error ? err.message : "Error interno." }, 500);
  }
});
