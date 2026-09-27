import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Edge Function: chat-asistente
// Asistente de chat para SJAP Balance. Recibe una pregunta del usuario, la
// responde usando Claude con herramientas de solo-lectura sobre las tablas
// sjap_* (cierres diarios y balance mensual) para no inventar cifras.
//
// Requiere el secreto ANTHROPIC_API_KEY configurado en el proyecto de Supabase:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// SUPABASE_URL y SUPABASE_ANON_KEY los inyecta la plataforma automáticamente.
// Las consultas usan la sesión del usuario que pregunta (RLS), nunca la clave
// de servicio: el asistente solo ve lo que ese usuario puede ver.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-opus-5";
const MAX_TURNOS = 6;

const SYSTEM_PROMPT = `Eres el asistente de datos de SJAP Balance, el panel de cierres diarios y balance mensual de una estación de servicio Terpel (EDS LA FLORIDA, Cota, Colombia).

Respondes siempre en español, de forma breve y directa, citando cifras en pesos colombianos (formato $1.234.567) o en galones/litros según corresponda.

Usa las herramientas disponibles para consultar la base de datos real antes de responder cualquier pregunta sobre cifras — nunca inventes ni estimes números que puedas consultar. Si una herramienta no devuelve datos para lo pedido, dilo directamente en vez de asumir o rellenar con supuestos.

Para preguntas de rango de fechas usa formato YYYY-MM-DD. Si el usuario no da fechas explícitas, asume el mes en curso salvo que el contexto indique otra cosa.

Responde siempre en texto plano, sin formato Markdown: nada de asteriscos para negrilla, nada de encabezados con #, nada de tablas con barras verticales. Para listas usa un guion simple al inicio de línea, y usa saltos de línea para separar ideas. El chat solo muestra texto plano, así que cualquier símbolo de formato aparece literalmente en pantalla.

Ten en cuenta estas particularidades conocidas del origen de los datos, y menciónalas solo si son relevantes a la pregunta del usuario (no las repitas si no vienen al caso):
- "QR" aparece como una cuenta de "cliente propio" en el Excel de origen; probablemente es un canal de pago y no un cliente corporativo — aún sin confirmar con el cliente.
- El detalle de ventas por turno/isla del promotor no tiene un origen confirmado con el cliente; se muestra tal cual viene del archivo.
- Las fechas de la hoja de Facturas vienen en 2025 en el archivo original, mientras el resto del balance está en 2026 (mismos días calendario) — es una inconsistencia real del archivo de origen, no un error de la app.
- El combustible se expande y contrae con la temperatura, así que la fluctuación de inventario (real vs. teórico) casi nunca da exactamente cero; solo es una señal de alerta cuando es inusualmente alta.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "listar_cierres_diarios",
    description:
      "Lista el resumen de cierres diarios (venta total, galones, número de clientes, diferencia de caja, estado) en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicial YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha final YYYY-MM-DD" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "detalle_dia",
    description:
      "Trae el detalle completo de un día: cierre, ventas por medio de pago, ventas por promotor e inventario/fluctuación por producto.",
    input_schema: {
      type: "object",
      properties: { fecha: { type: "string", description: "YYYY-MM-DD" } },
      required: ["fecha"],
    },
  },
  {
    name: "ventas_por_medio_pago",
    description:
      "Suma las ventas por medio de pago (efectivo, datáfono, QR, RUMBO, app Terpel, etc.) en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string" },
        hasta: { type: "string" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "inventario_producto",
    description:
      "Trae inventario diario, ventas en galones y fluctuación (real vs. teórico) por producto de combustible en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string" },
        hasta: { type: "string" },
        producto: {
          type: "string",
          description:
            "Nombre del producto (opcional, ej. 'Corriente', 'Extra', 'Bioacem'). Si se omite trae todos los productos.",
        },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "clientes_propios",
    description:
      "Ranking de cuentas de clientes propios por monto total de movimientos (combustible, urea, lubricantes) en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: { desde: { type: "string" }, hasta: { type: "string" } },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "urea",
    description: "Detalle diario de inventario y ventas de urea (litros y valor) en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: { desde: { type: "string" }, hasta: { type: "string" } },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "facturas_compra",
    description:
      "Lista las facturas de compra de combustible registradas. Nota: las fechas del archivo de origen están en 2025 aunque el resto del balance esté en 2026.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ventas_promotor",
    description: "Ranking y detalle diario de galones vendidos por promotor en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: { desde: { type: "string" }, hasta: { type: "string" } },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "presupuesto_mensual",
    description: "Presupuesto de compra/venta y cumplimiento de un mes específico.",
    input_schema: {
      type: "object",
      properties: {
        anio: { type: "integer", description: "Año, ej. 2026" },
        mes: { type: "integer", description: "Mes 1-12" },
      },
      required: ["anio", "mes"],
    },
  },
  {
    name: "sicom_mensual",
    description:
      "Informe regulatorio Sicom (inventario, compras, ventas, faltantes, evaporación) por producto de un mes específico.",
    input_schema: {
      type: "object",
      properties: {
        anio: { type: "integer" },
        mes: { type: "integer" },
      },
      required: ["anio", "mes"],
    },
  },
];

async function ejecutarHerramienta(
  supabase: ReturnType<typeof createClient>,
  estacionId: string,
  nombre: string,
  input: Record<string, unknown>,
) {
  switch (nombre) {
    case "listar_cierres_diarios": {
      const { data, error } = await supabase
        .from("sjap_cierre_diario")
        .select("fecha, venta_total, venta_galones_total, numero_clientes, diferencia_caja, estado")
        .eq("estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta)
        .order("fecha");
      if (error) throw error;
      return data;
    }

    case "detalle_dia": {
      const fecha = input.fecha as string;
      const [cierre, medioPago, promotores, balanceProducto] = await Promise.all([
        supabase.from("sjap_cierre_diario").select("*").eq("estacion_id", estacionId).eq("fecha", fecha).maybeSingle(),
        supabase
          .from("sjap_ventas_medio_pago")
          .select("medio_pago, numero_ventas, total_ventas")
          .eq("estacion_id", estacionId)
          .eq("fecha", fecha)
          .order("total_ventas", { ascending: false }),
        supabase
          .from("sjap_ventas_promotor_resumen")
          .select("promotor_nombre, numero_ventas, total_ventas")
          .eq("estacion_id", estacionId)
          .eq("fecha", fecha)
          .order("total_ventas", { ascending: false }),
        supabase
          .from("sjap_balance_diario_producto")
          .select(
            "inventario_teorico, inventario_final_real, fluctuacion_dia, ventas_galones, estado, sjap_productos(nombre_visible)",
          )
          .eq("estacion_id", estacionId)
          .eq("fecha", fecha),
      ]);
      if (cierre.error) throw cierre.error;
      return {
        cierre: cierre.data,
        ventas_por_medio_pago: medioPago.data ?? [],
        ventas_por_promotor: promotores.data ?? [],
        inventario_por_producto: balanceProducto.data ?? [],
      };
    }

    case "ventas_por_medio_pago": {
      const { data, error } = await supabase
        .from("sjap_ventas_medio_pago")
        .select("medio_pago, numero_ventas, total_ventas")
        .eq("estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta);
      if (error) throw error;
      const porMedio: Record<string, { medio_pago: string; numero_ventas: number; total_ventas: number }> = {};
      for (const fila of data ?? []) {
        const clave = fila.medio_pago as string;
        porMedio[clave] = porMedio[clave] || { medio_pago: clave, numero_ventas: 0, total_ventas: 0 };
        porMedio[clave].numero_ventas += Number(fila.numero_ventas || 0);
        porMedio[clave].total_ventas += Number(fila.total_ventas || 0);
      }
      return Object.values(porMedio).sort((a, b) => b.total_ventas - a.total_ventas);
    }

    case "inventario_producto": {
      let query = supabase
        .from("sjap_balance_diario_producto")
        .select(
          "fecha, inventario_inicial, ventas_galones, recibos_galones, inventario_teorico, inventario_final_real, fluctuacion_dia, fluctuacion_acumulada, fluctuacion_valor, sjap_productos!inner(nombre_visible)",
        )
        .eq("estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta);
      if (input.producto) {
        query = query.ilike("sjap_productos.nombre_visible", `%${input.producto}%`);
      }
      const { data, error } = await query.order("fecha");
      if (error) throw error;
      return data;
    }

    case "clientes_propios": {
      const { data, error } = await supabase
        .from("sjap_movimientos_cuenta_cliente")
        .select("monto, tipo, fecha, sjap_cuentas_cliente!inner(nombre, estacion_id)")
        .eq("sjap_cuentas_cliente.estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta);
      if (error) throw error;
      const porCuenta: Record<string, { nombre: string; total: number; movimientos: number }> = {};
      for (const m of data ?? []) {
        const nombre = (m.sjap_cuentas_cliente as { nombre: string }).nombre;
        porCuenta[nombre] = porCuenta[nombre] || { nombre, total: 0, movimientos: 0 };
        porCuenta[nombre].total += Number(m.monto || 0);
        porCuenta[nombre].movimientos += 1;
      }
      return Object.values(porCuenta).sort((a, b) => b.total - a.total);
    }

    case "urea": {
      const { data, error } = await supabase
        .from("sjap_urea_diario")
        .select("*")
        .eq("estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta)
        .order("fecha");
      if (error) throw error;
      return data;
    }

    case "facturas_compra": {
      const { data, error } = await supabase
        .from("sjap_facturas_compra")
        .select("fecha, numero_factura, cantidad, sjap_productos(nombre_visible)")
        .eq("estacion_id", estacionId)
        .order("fecha");
      if (error) throw error;
      return data;
    }

    case "ventas_promotor": {
      const { data, error } = await supabase
        .from("sjap_ventas_promotor_turno")
        .select("fecha, promotor_nombre, turno, isla, galones, numero_clientes")
        .eq("estacion_id", estacionId)
        .gte("fecha", input.desde)
        .lte("fecha", input.hasta)
        .order("fecha");
      if (error) throw error;
      return data;
    }

    case "presupuesto_mensual": {
      const { data, error } = await supabase
        .from("sjap_presupuesto_mensual")
        .select("*")
        .eq("estacion_id", estacionId)
        .eq("anio", input.anio)
        .eq("mes", input.mes)
        .maybeSingle();
      if (error) throw error;
      return data ?? { info: "sin presupuesto cargado para ese mes" };
    }

    case "sicom_mensual": {
      const { data, error } = await supabase
        .from("sjap_sicom_mensual")
        .select("*")
        .eq("estacion_id", estacionId)
        .eq("anio", input.anio)
        .eq("mes", input.mes)
        .order("producto_nombre_original");
      if (error) throw error;
      return data;
    }

    default:
      throw new Error(`Herramienta desconocida: ${nombre}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Falta configurar el secreto ANTHROPIC_API_KEY en el proyecto de Supabase (supabase secrets set ANTHROPIC_API_KEY=...).",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const noAutorizado = (error: string, status: number) =>
      new Response(JSON.stringify({ ok: false, error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // Las consultas corren con la sesión del usuario (clave pública + su JWT),
    // así que las políticas RLS limitan todo a su estación. La estación sale
    // de su perfil, nunca del cuerpo de la petición.
    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.replace(/^Bearer\s+/i, "");
    if (!jwt) return noAutorizado("Sesión requerida.", 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: sesion, error: errSesion } = await supabase.auth.getUser(jwt);
    if (errSesion || !sesion?.user) return noAutorizado("Sesión inválida o vencida. Vuelve a iniciar sesión.", 401);

    const { data: perfil } = await supabase
      .from("sjap_usuarios")
      .select("estacion_id, activo")
      .eq("auth_user_id", sesion.user.id)
      .maybeSingle();
    if (!perfil?.activo) return noAutorizado("Tu usuario no tiene acceso a SJAP Balance.", 403);
    const estacionId: string = perfil.estacion_id;

    const { mensaje, historial } = await req.json();
    if (!mensaje) return noAutorizado("Falta el mensaje.", 400);

    const anthropic = new Anthropic({ apiKey });

    const historialPrevio: Anthropic.MessageParam[] = Array.isArray(historial)
      ? historial.map((h: { role: "user" | "assistant"; texto: string }) => ({
          role: h.role,
          content: h.texto,
        }))
      : [];

    const messages: Anthropic.MessageParam[] = [...historialPrevio, { role: "user", content: mensaje }];

    let respuestaFinal = "";
    for (let turno = 0; turno < MAX_TURNOS; turno++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      respuestaFinal = textBlocks.map((b) => b.text).join("\n").trim();

      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolUseBlocks) {
        try {
          const resultado = await ejecutarHerramienta(
            supabase,
            estacionId,
            tool.name,
            tool.input as Record<string, unknown>,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify(resultado ?? []),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tool.id,
            is_error: true,
            content: err instanceof Error ? err.message : String(err),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }

    return new Response(JSON.stringify({ ok: true, respuesta: respuestaFinal || "No obtuve respuesta." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Error interno del asistente." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
