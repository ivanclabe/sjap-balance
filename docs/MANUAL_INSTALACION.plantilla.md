# SJAP Balance — Manual de instalación paso a paso

Guía para instalar SJAP Balance en un servidor nuevo sin conocimientos de programación. Todo se hace desde el navegador, salvo un paso corto en el que copiarás dos comandos. Tiempo estimado: entre 1 y 2 horas.

---

## 1. Antes de empezar

### Qué vas a instalar

SJAP Balance tiene dos partes:

| Parte | Qué es | Dónde vivirá |
|---|---|---|
| **La base de datos** | Donde se guardan los cierres, ventas, turnos y usuarios. | **Supabase** (servicio en la nube) |
| **La página web** | Lo que el personal abre en el navegador para usar la app. | **Netlify** (servicio de publicación web) |

Este manual instala la app **vacía**: crea todas las tablas y la configuración básica de la estación, pero **no copia los datos históricos** (cierres, ventas, facturas). Si también hay que trasladar esos datos, pídelo al equipo técnico después de terminar.

### Lista de lo que necesitas

- [ ] Un computador (Windows o Mac) con Chrome, Edge o Firefox y conexión a internet.
- [ ] Un correo electrónico de la empresa para crear las cuentas.
- [ ] La **carpeta del proyecto** `sjap-balance` (un archivo `.zip`). Pídela al responsable técnico; hoy el código está solo en el computador de desarrollo.
- [ ] Una contraseña fuerte para el usuario administrador de la app (**master**).
- [ ] Un lugar seguro para anotar claves (un gestor de contraseñas o un documento protegido).

> [!TIP]
> Descomprime el `.zip` en una ubicación fácil de encontrar, por ejemplo el **Escritorio**. Al terminar deberías ver una carpeta llamada `sjap-balance` que contiene, entre otras, las carpetas `src` y `supabase`.

### Glosario rápido

| Palabra | Qué significa |
|---|---|
| **Proyecto** (Supabase) | Tu base de datos en la nube. Cada proyecto tiene su propia dirección. |
| **SQL Editor** | Pantalla de Supabase donde se pegan y ejecutan los scripts. |
| **Script** | Un archivo de texto con instrucciones para la base de datos. Solo hay que copiarlo y pegarlo. |
| **Clave pública (anon)** | Clave que la página web usa para hablar con la base de datos. Es pública, no es secreta. |
| **Clave secreta (service_role)** | Clave con acceso total. **Nunca** la copies en ningún formulario de este manual. |
| **Terminal** | Ventana donde se escriben comandos. Solo la usarás en la parte 7. |

---

## 2. Crear la base de datos en Supabase

1. Entra a https://supabase.com y pulsa **Start your project**. Crea la cuenta con el correo de la empresa (o con **Continue with GitHub** si la empresa usa GitHub).
2. Si te pide crear una **organización**, ponle el nombre de la empresa (por ejemplo `EDS JAP`) y elige el plan. El plan gratuito sirve para probar; para uso real se recomienda el plan **Pro**, que incluye copias de seguridad diarias.
3. Pulsa **New project** y completa:
   - **Name:** `sjap-balance`
   - **Database Password:** pulsa **Generate a password** y **anótala en tu lugar seguro**. No se vuelve a mostrar.
   - **Region:** `South America (São Paulo)`, o `East US` si São Paulo no está disponible.
   - Si aparece una sección **Security options**, deja marcadas las opciones que vienen por defecto (**Data API** activado).
4. Pulsa **Create new project** y espera 1 o 2 minutos hasta que el panel deje de decir *Setting up project*.

> [!NOTE]
> Supabase cambia a veces los nombres de sus botones. Si un nombre no coincide exactamente con este manual, busca uno parecido en el mismo lugar de la pantalla.

---

## 3. Crear las tablas (scripts de Supabase)

En esta parte vas a ejecutar tres scripts que vienen dentro de la carpeta del proyecto, en `sjap-balance/supabase/instalacion/`:

| Script | Qué hace | Cuándo |
|---|---|---|
| `01_crear_tablas.sql` | Crea las 32 tablas, las reglas de seguridad y la configuración básica de la estación. **No copia datos históricos.** | Ahora (paso 3.1) |
| `02_crear_usuario_master.sql` | Activa al usuario administrador de la app. | En la parte 4 |
| `03_verificar_instalacion.sql` | Revisa que todo quedó bien instalado. | En la parte 4 |

### 3.1 Ejecutar el script 01 (crear tablas)

1. En la carpeta del proyecto, abre `supabase/instalacion/01_crear_tablas.sql` con el **Bloc de notas** (Windows) o **TextEdit** (Mac): clic derecho → *Abrir con*.
2. Selecciona todo el texto (**Ctrl + A** en Windows, **Cmd + A** en Mac) y cópialo (**Ctrl + C** / **Cmd + C**).
3. En Supabase, en el menú izquierdo, entra a **SQL Editor** y pulsa **New query** (o el botón **+**).
4. Haz clic dentro del área de texto, pega (**Ctrl + V** / **Cmd + V**) y pulsa **Run** (abajo a la derecha, o **Ctrl + Enter**).
5. Si aparece un aviso sobre *destructive operations* (operaciones destructivas), pulsa **Run this query** para confirmar. Es normal: el script reemplaza unas reglas de seguridad temporales por las definitivas.
6. Espera unos segundos. Debe aparecer abajo **Success. No rows returned**.

> [!IMPORTANT]
> Copia el script **desde el archivo**, no desde este PDF. El texto del anexo A es solo de referencia; al copiarlo desde un PDF se pueden colar saltos de línea o caracteres que rompen el script.

> [!TIP]
> **¿Salió un error?** No pasa nada: el script es de *todo o nada*, así que si falla no deja la base a medias. Si el error dice **«SJAP Balance ya está instalado en esta base de datos»**, las tablas ya existían y no hay que hacer nada más en este paso. Para cualquier otro error, toma una captura de pantalla y envíala al equipo técnico.

---

## 4. Activar el usuario administrador (master)

### 4.1 Crear el usuario

1. En Supabase, entra a **Authentication** → **Users** → **Add user** → **Create new user**.
2. Completa exactamente:
   - **Email:** `master@sjap.local` (así, aunque no sea un correo real; la app lo usa internamente)
   - **Password:** la contraseña del administrador: mínimo 8 caracteres, con letras y números. **Anótala.**
   - Marca la casilla **Auto Confirm User**.
3. Pulsa **Create user**.

### 4.2 Ejecutar el script 02

Igual que antes: abre `02_crear_usuario_master.sql`, copia todo, y en **SQL Editor** → **New query** pega y pulsa **Run**. El resultado debe mostrar una fila: `master | master | master@sjap.local`.

Contenido del script, como referencia:

```sql
{{02}}
```

### 4.3 Cerrar el registro público

Así nadie puede crearse una cuenta por su cuenta. Los usuarios nuevos los crea el master desde la app.

1. Entra a **Authentication** → **Sign In / Providers** (en algunas versiones: **Authentication** → **Settings**).
2. Desactiva **Allow new users to sign up** y pulsa **Save**.

### 4.4 Verificar la instalación (script 03)

Abre `03_verificar_instalacion.sql`, cópialo, pégalo en **SQL Editor** → **New query** y pulsa **Run**. Deben aparecer **11 filas, todas con OK** en la columna *estado*:

| Elemento | Esperado |
|---|---|
| Tablas de SJAP | 32 |
| Reglas de seguridad | 124 |
| Funciones | 19 |
| Estación | 1 |
| Productos | 3 |
| Medios de pago | 17 |
| Turnos (T1–T4) | 4 |
| Esquema de turnos | 1 |
| Parámetros de la estación | 7 |
| Permisos de la API | 32 |
| Usuario master activado | 1 |

Contenido del script, como referencia:

```sql
{{03}}
```

> [!WARNING]
> Si **Usuario master activado** dice **REVISAR**, revisa que el correo del paso 4.1 sea exactamente `master@sjap.local` y vuelve a ejecutar el script 02. Si otra fila dice **REVISAR**, envía una captura al equipo técnico.

---

## 5. Instalar las funciones del servidor

### 5.1 Función de usuarios (obligatoria)

Con esta función el master crea usuarios, restablece contraseñas, cambia roles y desactiva cuentas desde *Configuración → Usuarios*, y cada persona cambia su propia contraseña.

1. En Supabase, entra a **Edge Functions** (menú izquierdo) → **Deploy a new function** → **Via Editor**.
2. En el nombre de la función escribe exactamente: `sjap-usuarios`
3. Borra el código de ejemplo que aparece en el editor.
4. En la carpeta del proyecto, abre `supabase/functions/sjap-usuarios/index.ts` con el Bloc de notas o TextEdit, copia todo y pégalo en el editor de Supabase.
5. Pulsa **Deploy function** y espera el mensaje de éxito.
6. Si la función muestra la opción **Verify JWT** (o *Enforce JWT verification*), déjala **activada**.

### 5.2 Asistente de chat (opcional)

El botón verde de la app abre un asistente que responde preguntas sobre las cifras. Necesita una clave de Anthropic (servicio de pago por uso). Si no la vas a usar, salta este paso: el resto de la app funciona igual y el botón solo mostrará un error.

1. Repite los pasos de la parte 5.1 con el nombre `chat-asistente` y el archivo `supabase/functions/chat-asistente/index.ts`.
2. En **Edge Functions** → **Secrets** (o *Manage secrets*), agrega un secreto llamado `ANTHROPIC_API_KEY` con la clave que te entregue el equipo técnico, y pulsa **Save**.

---

## 6. Copiar los dos datos de conexión

La página web necesita saber a qué base de datos conectarse. Busca estos dos datos y pégalos temporalmente en tu documento seguro:

1. **Project URL:** en Supabase, **Project Settings** (engranaje, abajo a la izquierda) → **Data API** (o **API**). Tiene la forma `https://abcdefghijklmnop.supabase.co`.
2. **Clave pública:** en **Project Settings** → **API Keys**. Copia la clave marcada como **anon public** o **publishable** (empieza por `eyJ` o por `sb_publishable_`).

> [!CAUTION]
> **No copies** la clave **service_role** ni ninguna marcada como **secret**. Si por error la pegas en el paso siguiente, el asistente la rechazará.

---

## 7. Preparar la página web

Este es el único paso con comandos: solo hay que copiar y pegar.

### 7.1 Instalar Node.js (una sola vez)

1. Entra a https://nodejs.org y descarga la versión marcada como **LTS**.
2. Abre el instalador y pulsa **Siguiente / Continuar** hasta terminar, aceptando las opciones por defecto.

### 7.2 Abrir la terminal dentro de la carpeta del proyecto

- **Windows:** abre la carpeta `sjap-balance` en el Explorador de archivos, haz clic en la barra de dirección (arriba), escribe `cmd` y pulsa **Enter**. Se abre una ventana negra.
- **Mac:** abre la aplicación **Terminal**, escribe `cd ` (con un espacio al final), **arrastra la carpeta** `sjap-balance` a la ventana y pulsa **Enter**.

### 7.3 Ejecutar los dos comandos

Escribe (o pega) este comando y pulsa **Enter**. Descarga los componentes de la app y tarda 1 o 2 minutos:

```
npm install
```

Luego este otro, y pulsa **Enter**:

```
npm run preparar
```

El asistente te hará dos preguntas. Pega cada dato de la parte 6 y pulsa **Enter**:

```
SJAP Balance · Preparar la app para publicar

1) Project URL: https://abcdefghijklmnop.supabase.co
2) Clave pública (anon / publishable): eyJhbGciOi...

Compilando… (tarda menos de un minuto)

✓ Listo. La app quedó en la carpeta:
  .../sjap-balance/dist
```

Al terminar aparece una carpeta nueva llamada **`dist`** dentro de `sjap-balance`. Esa carpeta **es la página web** lista para publicar.

> [!TIP]
> Si escribes mal un dato, el asistente te lo dice y te lo vuelve a pedir. Para pegar en la ventana de Windows usa **clic derecho**; en Mac, **Cmd + V**.

---

## 8. Publicar la página web en Netlify

1. Entra a https://app.netlify.com y crea una cuenta gratuita con el correo de la empresa.
2. En el panel, pulsa **Add new site** (o **Add new project**) → **Deploy manually**.
3. **Arrastra la carpeta `dist`** (la del paso 7) al recuadro que dice *Drag and drop your site output folder here*.
4. Espera unos segundos. Netlify te dará una dirección como `https://nombre-al-azar-123.netlify.app`.
5. Para cambiar esa dirección por una más clara: **Site configuration** → **Change site name** → por ejemplo `sjap-eds-la-florida`. La dirección quedará `https://sjap-eds-la-florida.netlify.app`.

> [!NOTE]
> Si la empresa tiene su propio servidor web o dominio (por ejemplo `sjap.miempresa.com`), entrega la carpeta `dist` al área de sistemas junto con el documento técnico **SJAP-Balance-Despliegue.pdf**, que explica cómo configurarlo.

---

## 9. Primer ingreso y pruebas

- [ ] Abre la dirección de Netlify. Debe aparecer la pantalla **SJAP Balance** con los campos *Usuario* y *Contraseña*.
- [ ] Entra con usuario `master` y la contraseña del paso 4.1.
- [ ] Ve a **Configuración** → **General** y completa los datos de la estación (NIT, dirección, teléfono). Pulsa **Guardar**.
- [ ] En **Configuración** → **Usuarios**, crea un usuario para cada persona del equipo (rol **Dependiente** para la operación diaria). Usa **Generar** para la contraseña temporal y entrégasela; la app le pedirá cambiarla al entrar por primera vez.
- [ ] Entra a **Cargar** y sube el archivo del cierre de un día. Debe terminar en **completado**.
- [ ] Recarga la página con **F5** estando en **Diarios**. Debe seguir mostrando la app (no un error 404).

Si todo lo anterior funciona, **la instalación está terminada**. Comparte la dirección con el personal junto con el **Manual de usuario**.

---

## 10. Si algo sale mal

| Qué ves | Qué hacer |
|---|---|
| El script 01 dice «ya está instalado» | Las tablas ya existen; sigue con la parte 4. |
| El script 01 muestra otro error | No se aplicó nada. Envía una captura del mensaje al equipo técnico. |
| El script 03 dice «REVISAR» en *Usuario master* | Revisa el correo `master@sjap.local` (parte 4.1) y repite el script 02. |
| `npm` no se reconoce como comando | Node.js no quedó instalado: repite la parte 7.1 y **cierra y vuelve a abrir** la terminal. |
| El asistente rechaza la clave | Estás copiando la clave secreta. Copia la **anon public / publishable** (parte 6). |
| La página abre pero «Usuario o contraseña incorrectos» | Revisa la contraseña. Si una persona olvidó la suya, el master le asigna una temporal en **Configuración → Usuarios → Restablecer contraseña**. Si el que la olvidó es el único master, el equipo técnico debe asignarle una nueva desde Supabase (la recuperación por correo no funciona: el correo `@sjap.local` no existe). |
| «Este usuario está desactivado» | Un master lo desactivó. Puede reactivarlo en **Configuración → Usuarios**. |
| «Se cerró la sesión por inactividad» | Normal: tras 30 minutos sin uso la sesión se cierra por seguridad. Vuelve a entrar. |
| Error 404 al recargar una página | La carpeta publicada no fue `dist`, o se publicó su contenido incompleto. Vuelve a arrastrar la carpeta `dist` completa. |
| El botón verde del asistente da error | Es normal si no instalaste el asistente (parte 5.2) o falta el secreto `ANTHROPIC_API_KEY`. |
| Olvidaste la contraseña de la base de datos | Supabase → Project Settings → Database → *Reset database password*. |

### Qué guardar al terminar

- [ ] La contraseña de la base de datos (parte 2).
- [ ] La contraseña del usuario master (parte 4).
- [ ] La dirección de la app en Netlify (parte 8).
- [ ] Las cuentas de Supabase y Netlify, con el correo con el que se crearon.
- [ ] La carpeta del proyecto `sjap-balance` (para futuras actualizaciones).

---

## Anexo A. Script 01 — crear tablas (referencia)

Este es el contenido completo de `supabase/instalacion/01_crear_tablas.sql`. **Para instalar, cópialo desde el archivo, no desde aquí** (ver parte 3.1). Se incluye para que el equipo técnico pueda revisarlo. En la versión PDF, las líneas muy largas aparecen partidas en dos: la continuación se marca con `↳`.

```sql
{{01}}
```
