# Daily Brief

Aplicación web de curación de noticias de tecnología e IA, publicadas diariamente por un agente AI. Acceso privado — no indexada por buscadores.

**URL:** https://dailyb.vmhq.cl

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
# Puerto expuesto al host
PORT=8391

# API key para POST /api/publish — debe ser un valor secreto
# Generar con: openssl rand -hex 32
API_KEY=

# Ruta a los archivos de curación (sobreescrita en docker-compose)
# CURATIONS_DIR=/home/ai/llm-wiki/raw/curations
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
│   └── cover.svg          # Imagen de portada fallback
├── .claude/
│   └── commands/
│       └── curar.md       # Skill del agente AI para publicar ediciones
├── CURATION_SPEC.md       # Especificación completa del formato markdown
├── CLAUDE.md              # Instrucciones para Claude Code
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Rutas HTTP

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Edición más reciente; `?p=N` pagina el sidebar |
| `GET` | `/curacion/:date` | Edición por ID (`YYYY-MM-DD` o `YYYY-MM-DD_HH-MM`) |
| `GET` | `/ediciones` | Lista completa de ediciones |
| `GET` | `/api/curations` | JSON paginado (`?page=&limit=`) |
| `GET` | `/api/search` | Búsqueda full-text (`?q=`) |
| `GET` | `/health` | Estado del servidor |
| `POST` | `/api/publish` | Publicar nueva edición (requiere `X-Api-Key`) |

## API de publicación

Autenticación via header `X-Api-Key` o `Authorization: Bearer <key>`.

**Publicar una edición:**

```bash
curl -X POST https://dailyb.vmhq.cl/api/publish \
  -H "X-Api-Key: TU_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

**Respuesta:**
```json
{ "success": true, "edition": "2026-04-09_14-30", "url": "/curacion/2026-04-09_14-30" }
```

La edición se publica de inmediato — sin reiniciar el servidor.

Ver [`CURATION_SPEC.md`](./CURATION_SPEC.md) para el formato completo del archivo markdown y [``.claude/commands/curar.md``](./.claude/commands/curar.md) para el skill del agente.

## Formato del contenido

Los archivos siguen la convención `YYYY-MM-DD_HH-MM.md`. Estructura esperada:

```markdown
---
image_url: https://...        ← imagen hero (opcional)
---
# Título de la edición
*Generado el ...*
---
## 🔥 Featured Story: TITULAR  ← noticia principal (hero + cuerpo)

Primer párrafo con [enlace principal](https://url.com).

---
## Sección de Noticias

### [Titular del artículo](https://url.com)
Resumen de 2–3 oraciones.

---
## 🔗 Quick Links

- **[Recurso](https://url.com)** — descripción breve.
```

Ver [`CURATION_SPEC.md`](./CURATION_SPEC.md) para la referencia completa.

## Características

- Múltiples ediciones por día con sufijo horario en el nombre de archivo
- Timezone `America/Santiago` para determinar la edición del día
- Imagen hero desde frontmatter → og:image del artículo destacado → portada por defecto
- Caché en memoria con invalidación automática vía watcher de directorio
- Tema claro/oscuro (localStorage + `prefers-color-scheme`)
- Búsqueda full-text con debounce
- Sidebar paginado (8 ediciones/página)
- No indexable — `noindex, nofollow` en todas las páginas
