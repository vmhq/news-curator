# Daily Brief

Aplicación web de curación de noticias de tecnología e IA, generadas y servidas diariamente. Acceso privado — no indexada por buscadores.

**URL:** https://dailyb.vmhq.cl

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Hono](https://hono.dev)
- **Renderizado:** HTML server-side puro, sin build step
- **Tipografía:** Inter (Google Fonts)
- **Fuente de datos:** archivos Markdown en `/home/ai/llm-wiki/raw/curations/`

## Comandos

```bash
bun install        # Instalar dependencias
bun run server.ts  # Iniciar servidor en http://localhost:8080
PORT=3000 bun run server.ts  # Puerto personalizado
```

## Estructura

```
news-curator/
├── server.ts          # Servidor principal (rutas, parseo MD, HTML)
├── public/
│   ├── style.css      # Estilos (light/dark, responsive, sky-blue)
│   ├── app.js         # JS cliente (tema, búsqueda, menú móvil)
│   ├── favicon.svg
│   ├── cover.svg      # Imagen de portada por defecto (fallback hero)
│   └── robots.txt     # Bloqueo de indexación (Disallow: /)
├── CLAUDE.md          # Instrucciones para Claude Code
├── package.json
└── README.md
```

## Fuente de datos

Los archivos de curación se leen desde `/home/ai/llm-wiki/raw/curations/` en cada request. Sin caché ni base de datos.

**Nombres de archivo soportados:**
- `YYYY-MM-DD.md` — edición estándar
- `YYYY-MM-DD_HH-MM.md` — múltiples ediciones por día (la más reciente se muestra primero)

**Formato esperado del markdown:**
```
---
image_url: https://...   ← portada personalizada (opcional)
---
# Título
*Generado ...*
---
## 🔥 Featured Story: TITULAR   ← hero + se renderiza también en el cuerpo
...
## Sección
### Ítem con [enlace](url)
```

**Prioridad de imagen hero:** `image_url` en frontmatter → og:image extraído del artículo destacado → `cover.svg` por defecto

## Rutas

| Ruta | Descripción |
|------|-------------|
| `GET /` | Edición más reciente de hoy (o la última disponible); `?p=N` pagina el sidebar (8/página) |
| `GET /curacion/:date` | Edición específica (soporta `YYYY-MM-DD` y `YYYY-MM-DD_HH-MM`) |
| `GET /ediciones` | Lista completa — sin sidebar, layout centrado |
| `GET /api/curations?page=&limit=` | JSON paginado de ediciones |
| `GET /api/search?q=` | Búsqueda full-text en todos los markdown |
| `GET /robots.txt` | `Disallow: /` — bloqueo total de indexación |

## Características

- HTML server-rendered — sin frameworks frontend
- Múltiples ediciones por día con soporte de sufijo horario en el nombre de archivo
- Timezone `America/Santiago` para determinar la edición del día
- Imagen hero desde frontmatter, og:image del artículo, o portada por defecto
- Filtrado de logos/iconos como imágenes de portada
- Tema claro/oscuro (localStorage + `prefers-color-scheme`)
- Búsqueda full-text con debounce (mínimo 2 caracteres)
- Diseño responsivo (single column < 768px)
- Texto del artículo justificado con `hyphens: auto`
- Sidebar paginado en `/` (8 ediciones/página)
- `/ediciones` usa layout sin sidebar, ancho máximo 860px
- No indexable — `noindex, nofollow` + `robots.txt`
- Puerto configurable via variable de entorno `PORT`
