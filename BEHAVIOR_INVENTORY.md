# Inventario de Comportamiento

Proyecto auditado: `news-curator` / Daily Brief.

Fecha de auditoria: 2026-04-25.

Alcance: comportamiento observable en codigo, documentacion, tests, Docker y assets estaticos. Esta fase describe que hace el sistema, no evalua calidad.

## 1. Features User-Facing

- Publica una aplicacion web privada de curacion diaria de noticias de tecnologia, IA y ciencia.
- Muestra la edicion de hoy en `/` cuando existe; si no hay edicion de hoy, muestra la edicion mas reciente disponible.
- Redirige `/latest` a la URL canonica de la edicion mas reciente.
- Muestra una edicion especifica por ID en `/curacion/:date`, aceptando IDs `YYYY-MM-DD` y `YYYY-MM-DD_HH-MM`.
- Lista todas las ediciones disponibles en `/ediciones`.
- Permite navegar entre ediciones anterior/siguiente desde la pagina de detalle.
- Muestra una historia principal destacada como hero editorial cuando el markdown contiene `## Noticia principal: ...` o el formato legado `## 🔥 Featured Story: ...`.
- Calcula y muestra tiempo estimado de lectura.
- Muestra imagen hero desde `image_url` en frontmatter, desde `og:image` de la historia principal o desde `/static/cover.svg` como fallback.
- Genera metatags Open Graph y Twitter Card para previews sociales.
- Detecta bots de preview en `/` y los redirige a `/curacion/:date`.
- Ofrece vista tipo revista y vista tipo feed en paginas de edicion.
- Ofrece tema claro/oscuro/auto con persistencia en `localStorage`.
- Ofrece busqueda de ediciones desde command palette con atajo `Cmd/Ctrl+K`.
- Ofrece tabla de contenidos de secciones en desktop y panel flotante en mobile.
- Ofrece boton de volver arriba y barra de progreso de lectura.
- Sirve assets estaticos desde `/static/*` y uploads desde `/static/uploads/*`.
- Expone API JSON para listar ediciones con paginacion por pagina o cursor.
- Expone API JSON para leer markdown raw de una edicion.
- Expone API de busqueda full-text por contenido de ediciones.
- Expone API autenticada para validar markdown editorial antes de publicar.
- Expone API autenticada para publicar ediciones nuevas desde contenido raw o desde un draft.
- Expone API autenticada para crear, leer, previsualizar y publicar drafts.
- Expone preview HTML publica de drafts en `/drafts/:id`.
- Expone API autenticada para subir imagenes propias.
- Expone API autenticada para reemplazar una edicion existente con snapshot previo.
- Expone API autenticada para modificar solo frontmatter de una edicion con snapshot previo.
- Expone API autenticada para listar y leer snapshots de versiones.
- Expone API autenticada para ver diff entre la edicion actual y el snapshot mas reciente.
- Expone `/health` publico con estado operativo, metricas y cache stats sin configuracion sensible.
- Expone `/health/internal` autenticado con configuracion efectiva.
- Expone `/ready` para readiness de directorios y watcher.
- Bloquea indexacion con metatags `noindex, nofollow` y `/robots.txt` con `Disallow: /`.

## 2. Flujos Criticos

| Flujo | Que hace | Rutas o modulos principales | Impacto si se rompe | Confianza |
|---|---|---|---|---|
| Publicacion de edicion nueva | Recibe markdown validado, genera ID con fecha/hora local, escribe archivo `.md`, invalida caches y devuelve URL publica | `POST /api/publish`, `routes/api.ts`, `lib/curations.ts`, `lib/frontmatter.ts` | Alto: deja de entrar contenido nuevo a produccion | Alta |
| Publicacion desde draft | Lee draft por UUID, valida, escribe edicion final, invalida caches y devuelve URL publica | `POST /api/drafts/:id/publish`, `POST /api/publish` con `draft_id`, `routes/api.ts` | Alto: afecta flujo editorial asistido por agentes | Alta |
| Render publico de edicion | Lee markdown, renderiza HTML, extrae principal, imagen, sidebar y navegacion | `/`, `/curacion/:date`, `routes/public.ts`, `lib/curations.ts`, `templates/layout.ts` | Alto: usuarios no pueden leer ediciones | Alta |
| Busqueda | Indexa markdown en memoria, devuelve snippets resaltados y command palette consume `/api/search` | `/api/search`, `public/app.js`, `lib/curations.ts` | Medio: afecta descubrimiento pero no publicacion | Alta |
| Edicion de una edicion existente | Valida reemplazo o frontmatter, guarda snapshot, actualiza archivo e invalida cache parcial | `PUT /api/curations/:date`, `PATCH /api/curations/:date/meta`, `routes/api.ts` | Alto: riesgo de perdida o corrupcion editorial | Alta |
| Versionado y diff | Crea snapshots antes de editar, lista snapshots y genera diff contra el ultimo | `saveVersionSnapshot`, `GET /api/curations/:date/versions`, `GET /api/curations/:date/diff/latest`, `lib/diff.ts` | Medio-alto: afecta recuperacion de errores editoriales | Media |
| Upload de imagenes | Valida multipart, tipo MIME, tamano, escribe archivo y devuelve URL local | `POST /api/images`, `/static/uploads/*`, `routes/api.ts`, `app.ts` | Medio: afecta portadas propias | Alta |
| Imagen hero remota | Extrae `og:image` de URL destacada con proteccion SSRF, timeout y cache | `extractOgImage`, `isBlockedResolvedUrl`, `resolveOgImageCandidate` | Medio: afecta visuales y previews, no contenido textual | Media |
| Readiness y health | Reporta uptime, total de archivos, caches, metricas, watcher y directorios | `/health`, `/health/internal`, `/ready`, `app.ts` | Medio: afecta operacion y monitoreo | Alta |
| Retencion de drafts/versiones | Limpia drafts expirados y recorta snapshots por edicion | `runRetentionPass`, `cleanupExpiredDrafts`, `trimVersionHistory`, `lib/retention.ts` | Medio: crecimiento de disco o perdida de drafts viejos esperada | Media |

## 3. Integraciones Externas

| Integracion | Uso observable | Libreria o API | Version |
|---|---|---|---|
| Bun runtime | Servidor, tests, fetch, File/FormData, crypto UUID | Bun | Definido por entorno; `bun-types` `^1.3.13` |
| Hono | Routing HTTP, middleware, context y server static | `hono` | `^4.12.15` |
| Marked | Render de markdown a HTML con renderer personalizado | `marked` | `^18.0.2` |
| Filesystem local | Persistencia principal de ediciones, drafts, versiones y uploads | `fs`, `fs/promises`, `path` | Node/Bun built-in |
| DNS publico | Resolucion de hostnames para SSRF antes de fetch de imagenes | `node:dns/promises.Resolver` con `1.1.1.1` y `8.8.8.8` | Built-in |
| HTTP remoto | Fetch HEAD de `image_url` y fetch GET de paginas para `og:image` | `fetch`, `AbortController` | Built-in |
| Docker | Ejecucion productiva con volumenes para curaciones y uploads | `Dockerfile`, `docker-compose.yml` | `oven/bun:1-alpine` |
| GitHub Container Registry | Imagen Docker esperada en compose | `ghcr.io/vmhq/news-curator:latest` | N/A |
| Google Fonts | Carga de tipografias en HTML | `fonts.googleapis.com`, `fonts.gstatic.com` | N/A |
| Agentes AI externos | Publicacion/edicion via API key y comando `.claude/commands/curar.md` | Variables `DAILY_BRIEF_URL`, `DAILY_BRIEF_API_KEY` | N/A |

No se observa base de datos relacional, cola, OAuth, pagos, email, analytics externo ni almacenamiento cloud. La persistencia es filesystem.

## 4. Modelos de Datos

### Edicion / Curation

- Identificador: `YYYY-MM-DD` o `YYYY-MM-DD_HH-MM`.
- Persistencia: archivo `${CURATIONS_DIR}/${id}.md`.
- Orden: lexicografico descendente por ID.
- Campos derivados: `summary`, `featured`, `readingTime`, `coverImage`, `html`, `raw`.
- Validaciones de ID: regex `^\d{4}-\d{2}-\d{2}(_\d{2}-\d{2})?$`.
- Validaciones editoriales: longitud 10 a 1.000.000 caracteres, frontmatter opcional recomendado, H1 recomendado, noticia principal obligatoria, al menos una seccion H2 adicional, al menos una historia H3, protocolos de links `http:`/`https:`.

### Markdown editorial

- Frontmatter opcional entre `---`.
- Campo reconocido de facto: `image_url`.
- H1 recomendado como titulo de edicion.
- Metadato textual generado: `*Generado ...*` o `*Generated at ...*`.
- Separadores `---` usados como chrome editorial.
- Seccion destacada esperada: `## Noticia principal: TITULAR`.
- Formatos legados aceptados: `## 🔥 Featured Story: ...` y `## 🔥`.
- Historias regulares esperadas: `### [Titulo](https://...)` dentro de secciones H2.

### Draft

- Identificador: UUID v4 textual validado por regex amplia `^[a-f0-9-]{36}$`.
- Persistencia: `${DRAFTS_DIR}/${draftId}.md`.
- Relacion: puede publicarse como una nueva edicion.
- Retencion: se eliminan drafts con `mtime` anterior a `DRAFT_TTL_HOURS`.
- Preview: `/drafts/:id` renderiza markdown y panel de validacion.

### Version snapshot

- Identificador: `${timestamp}-${reason}` sin extension.
- Persistencia: `${VERSIONS_DIR}/${editionId}/${version}.md`.
- Relacion: pertenece a una edicion existente.
- Creacion: antes de `PUT` completo y antes de `PATCH` de frontmatter.
- Retencion: maximo `MAX_VERSIONS_PER_EDITION` por edicion.

### Upload de imagen

- Identificador: nombre `${Date.now()}-${random}.${ext}`.
- Persistencia: `${UPLOADS_DIR}/${filename}`.
- URL publica: `/static/uploads/${filename}`.
- Tipos aceptados: jpeg, png, webp, gif, avif.
- Tamano maximo default: 10 MB.

### Configuracion runtime

- `apiKey`: habilita endpoints autenticados.
- `curationsDir`, `uploadsDir`, `draftsDir`, `versionsDir`.
- `siteUrl`: base para canonical y OG.
- `enableWatcher`: controla `fs.watch`.
- `rateLimits`: buckets `search`, `images`, `publish`, `drafts`, `edits`.

### Observabilidad

- Contadores en memoria: `totalRequests`, `searches`, `publishes`, `draftCreates`, `draftPublishes`, `uploads`, `updates`, `rateLimited`.
- Logs estructurados JSON por eventos editoriales y operativos.

### Inconsistencias de datos observables

- El mismo concepto de edicion aparece como `date` en rutas/API, `edition` en respuestas de escritura y `fileId` en helpers de formato.
- El mismo concepto de draft aparece como `draft_id` en entrada JSON de publish, `draft` en respuestas y `id` en rutas.
- `image_url` usa snake_case en frontmatter, mientras el codigo usa `coverImage`, `heroImage` y `imageExt` en camelCase.
- La validacion de UUID de draft acepta cualquier string hex con guiones de largo 36, no valida version/variant de UUID.

## 5. Edge Cases Conocidos

- Si `CURATIONS_DIR` no existe o falla `readdir`, la app devuelve lista vacia de ediciones.
- Si no hay ediciones, `/` muestra estado vacio y `/latest` redirige a `/`.
- Si no existe la edicion pedida, `/curacion/:date` devuelve HTML 404 con sidebar reciente.
- Si el ID de edicion no cumple formato, rutas publicas devuelven texto 400 y API devuelve JSON 400.
- Si `API_KEY` no esta configurada, endpoints autenticados devuelven 503.
- Si la API key es invalida o falta, endpoints autenticados devuelven 401.
- Busquedas de menos de 2 caracteres devuelven resultados vacios.
- Query de busqueda se recorta a 200 caracteres.
- Rate limiting por IP se aplica a busqueda, imagenes, publish, drafts y edits.
- En entorno sin IP de request disponible, rate limiting usa la key `anonymous`.
- Markdown con HTML raw se escapa al renderizar.
- Links markdown con protocolos no `http:`/`https:` se rechazan en validacion o se renderizan como texto en el renderer.
- `image_url` local debe apuntar a `/static/uploads/<filename>` existente.
- `image_url` remoto se valida con HEAD, timeout de 3 segundos y sin redirects.
- Extraccion de OG image remota usa DNS anti-SSRF, timeout de 5 segundos, redirects deshabilitados y limite de lectura de 50 KB.
- Hosts privados, loopback, link-local, `.internal`, `.local` y `.localhost` se bloquean para fetch de imagenes.
- Si OG image no existe, no es HTML o falla fetch, se cachea `null` y se usa fallback.
- Cache de summaries se limita a 1000 entradas; cache de OG images a 500 entradas.
- `fs.watch` invalida caches por cambios en directorio, pero si no hay filename limpia summaries de forma completa.
- Draft cleanup ignora archivos que desaparecen durante la limpieza.
- Version trimming borra snapshots excedentes por orden lexicografico descendente.
- Publicacion y edicion rechazan contenido menor a 10 o mayor a 1.000.000 caracteres.
- Upload multipart invalido devuelve 400.
- Tipos MIME no permitidos o imagenes demasiado grandes devuelven 400.
- La app incluye CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` y HSTS solo si `SITE_URL` es HTTPS.
- `/health` no expone configuracion efectiva; `/health/internal` si la expone con API key.
- Tests existentes cubren 17 casos de integracion y helpers, y pasan en esta auditoria.
