# Daily Brief

Aplicación web de curación de noticias de tecnología e IA, publicadas diariamente por un agente AI. Acceso privado — no indexada por buscadores.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Hono](https://hono.dev)
- **Renderizado:** HTML server-side, sin build step
- **Contenido:** archivos Markdown en `/data/curations/` (volumen Docker)

## Despliegue con Docker

```bash
# 1. Configurar variables de entorno
cp .env.example .env
# Editar API_KEY con un valor seguro: openssl rand -hex 32

# 2. Levantar
docker compose up -d

# 3. Verificar
curl http://localhost:8391/health
```

**`docker-compose.yml`**
```yaml
services:
  app:
    image: ghcr.io/vmhq/news-curator:latest
    restart: unless-stopped
    ports:
      - "${PORT:-8391}:8391"
    environment:
      PORT: "8391"
      API_KEY: "${API_KEY}"
      CURATIONS_DIR: "/data/curations"
    volumes:
      - curations:/data/curations
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8391/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  curations:
```

**`.env`**
```bash
PORT=8391
API_KEY=             # generar con: openssl rand -hex 32
# CURATIONS_DIR=/data/curations
# SITE_URL=https://example.com
```

El contenido se almacena en el volumen Docker `curations` y persiste entre reinicios.

## Desarrollo local (sin Docker)

```bash
bun install
bun run dev          # con hot-reload
bun run start        # sin hot-reload
PORT=3000 bun run start
```

## Estructura del proyecto

```
news-curator/
├── server.ts              # Rutas y lógica principal
├── lib/
│   └── curations.ts       # I/O, caché, parsing, utilidades de fecha
├── templates/
│   └── layout.ts          # buildPage() — HTML completo
├── public/
│   ├── style.css          # Estilos (light/dark, responsive)
│   ├── app.js             # JS cliente (tema, búsqueda, menú)
│   ├── favicon.svg
│   ├── cover.svg          # Imagen de portada fallback
│   └── uploads/           # Imágenes subidas via API (creado automáticamente)
├── .claude/
│   └── commands/
│       └── curar.md       # Skill del agente AI — formato markdown + API completa
├── CLAUDE.md              # Instrucciones para Claude Code
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Integración con agentes AI

Daily Brief está diseñado para ser operado por agentes AI. El skill principal está en [`.claude/commands/curar.md`](./.claude/commands/curar.md) — es el documento único de referencia para publicar, editar y gestionar ediciones. Incluye:

- La estructura completa del archivo markdown que se debe subir
- Reglas de formato y errores comunes
- Referencia completa de la API (publicar, editar, subir imágenes)
- Flujo autónomo paso a paso

### Skills disponibles

| Skill | Invocación | Descripción |
|-------|-----------|-------------|
| Curar | `/curar` | Genera y publica una nueva edición completa desde cero |
| Daily Brief | `anthropic-skills:daily-brief` | Interactúa con Daily Brief — publicar, leer y editar ediciones |
| Miniflux | `anthropic-skills:miniflux` | Curación desde Miniflux RSS — filtra y resume noticias relevantes |

El flujo típico del agente es: **Miniflux** (recopilar noticias) → **curar** (redactar y publicar).

### Variables de entorno requeridas por el agente

```bash
DAILY_BRIEF_API_KEY=   # API key para los endpoints autenticados (= API_KEY del servidor)
DAILY_BRIEF_URL=       # URL base del servidor, ej: https://dailyb.vmhq.cl
```

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8391` | Puerto en que escucha el servidor |
| `API_KEY` | — | API key para endpoints autenticados. Generar con `openssl rand -hex 32` |
| `CURATIONS_DIR` | `/data/curations` | Directorio con los archivos Markdown de ediciones |
| `SITE_URL` | `http://localhost:8391` | URL pública — usada en canonical y OG tags |

## Seguridad

- **API key** — todos los endpoints de escritura requieren `X-Api-Key` o `Authorization: Bearer <key>`. Comparación con `timingSafeEqual` para prevenir timing attacks.
- **Rate limiting** — `/api/search` acepta máx 20 requests/10s por IP. El mapa de IPs tiene un cap de 10.000 entradas para prevenir DoS por memoria.
- **Headers de seguridad** — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Content-Security-Policy` aplicados en todos los responses. `Strict-Transport-Security` se activa automáticamente cuando `SITE_URL` usa `https://`.
- **SSRF** — la función `extractOgImage` bloquea IPs privadas, loopback, link-local e IPv6 especiales. Redirects desactivados (`redirect: "error"`). Timeout de 5s.
- **Path traversal** — los uploads se validan con `path.basename()` para rechazar cualquier componente de directorio en el nombre de archivo.
- **XSS** — el HTML renderizado desde markdown usa un renderer personalizado que escapa tags raw. Los links solo permiten protocolos `http:` y `https:`.
- **Privacidad** — `noindex, nofollow` en todas las páginas + `/robots.txt` con `Disallow: /`.

## Rutas HTTP

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Edición más reciente; `?p=N` pagina el sidebar |
| `GET` | `/curacion/:date` | Edición por ID (`YYYY-MM-DD` o `YYYY-MM-DD_HH-MM`) |
| `GET` | `/ediciones` | Lista completa de ediciones |
| `GET` | `/api/curations` | JSON paginado (`?page=&limit=` o `?before=&limit=`) |
| `GET` | `/api/search` | Búsqueda full-text (`?q=`) |
| `GET` | `/health` | Estado del servidor |
| `POST` | `/api/publish` | Publicar nueva edición (requiere `X-Api-Key`) |
| `GET` | `/api/curations/:date` | Markdown raw de una edición |
| `PUT` | `/api/curations/:date` | Reemplazar contenido de edición existente (requiere `X-Api-Key`) |
| `PATCH` | `/api/curations/:date/meta` | Actualizar solo frontmatter (requiere `X-Api-Key`) |
| `POST` | `/api/images` | Subir imagen propia para usar como portada (requiere `X-Api-Key`) |

Ver [`.claude/commands/curar.md`](./.claude/commands/curar.md) para la referencia completa de la API y el formato del contenido.

## Características

- Múltiples ediciones por día con sufijo horario en el nombre de archivo
- Timezone `America/Santiago` para determinar la edición del día
- Imagen hero desde frontmatter → og:image del artículo destacado → portada por defecto
- Subida de imágenes propias via `POST /api/images` (jpeg, png, webp, gif, avif — máx 10 MB)
- Caché en memoria con invalidación automática vía watcher de directorio
- Tema claro/oscuro (localStorage + `prefers-color-scheme`)
- Búsqueda full-text con debounce
- Sidebar paginado (8 ediciones/página)
- No indexable — `noindex, nofollow` en todas las páginas
