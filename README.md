# SJAP Balance

Aplicación web para el cierre diario y el balance mensual de la estación de servicio
EDS LA FLORIDA (Terpel, Cota). React 18 + Vite 5 en el frontend, Supabase (Postgres,
Auth, Edge Functions) como backend.

## Arranque rápido (desarrollo)

```bash
cp .env.example .env        # completar URL y anon key del proyecto Supabase
npm ci
npm run dev                 # http://localhost:5173
```

## Estructura

| Ruta | Contenido |
|---|---|
| `src/` | Frontend (páginas en `src/pages`, parser del archivo del POS en `src/parser`) |
| `supabase/migrations/` | Esquema completo de la base de datos (tablas `sjap_*`, RLS, funciones) |
| `supabase/functions/` | Edge Functions: `admin-crear-usuario`, `chat-asistente` |
| `supabase/scripts/` | Scripts de arranque de un entorno nuevo (usuario master) |
| `supabase/instalacion/` | Scripts para instalar desde el SQL Editor de Supabase: 01 crear tablas, 02 usuario master, 03 verificar |
| `scripts/preparar-publicacion.mjs` | `npm run preparar`: pide URL y clave pública y genera `dist/` |
| `docs/` | Manual de instalación para personas no técnicas (`MANUAL_INSTALACION.md`, generado desde la plantilla) |
| `test-fixtures/` | Archivos de ejemplo (cierre diario, balance mensual) para pruebas |

## Despliegue en otro ambiente

Ver [DESPLIEGUE.md](DESPLIEGUE.md) (requisitos, ubicación del código, pasos y hosting). Resumen:

1. Crear un proyecto Supabase y aplicar `supabase/migrations` (`supabase db push`).
2. Crear el usuario master (`supabase/scripts/crear_usuario_master.sql`).
3. Desplegar las Edge Functions y definir el secreto `ANTHROPIC_API_KEY`.
4. `npm run build` y publicar `dist/` en un hosting estático con fallback SPA a `index.html`.
