# Arquitectura de Recuperacion

Objetivo: estabilizar el proyecto sin reescritura. La app es pequena, productiva y recuperable. La arquitectura objetivo debe separar reglas editoriales, casos de uso, filesystem/fetch y rutas HTML/API, manteniendo Bun + Hono + markdown filesystem como base.

## 1. Estructura de Carpetas Objetivo

```text
src/
  domain/
    curation.ts
    draft.ts
    frontmatter.ts
    validation.ts
    dates.ts
  application/
    publish-curation.ts
    draft-workflow.ts
    edit-curation.ts
    list-curations.ts
    search-curations.ts
    resolve-hero-image.ts
    retention-policy.ts
  infrastructure/
    config.ts
    fs-curation-repository.ts
    fs-draft-repository.ts
    fs-version-repository.ts
    local-upload-storage.ts
    og-image-client.ts
    rate-limiter.ts
    http-cache.ts
    logging.ts
    metrics.ts
  presentation/
    http/
      app.ts
      server.ts
      routes-api.ts
      routes-public.ts
      middleware.ts
    html/
      layout.ts
      edition-page.ts
      archive-page.ts
      draft-preview-page.ts
  shared/
    result.ts
    html.ts
    ids.ts
    time.ts
public/
  app.js
  style.css
  theme-init.js
tests/
```

### Mapeo incremental desde el estado actual

- `lib/curations.ts` se divide gradualmente entre `domain/validation.ts`, `domain/dates.ts`, `application/search-curations.ts`, `infrastructure/fs-curation-repository.ts` y `infrastructure/og-image-client.ts`.
- `lib/frontmatter.ts` pasa a `domain/frontmatter.ts`; la validacion remota de imagen se mueve a `application/resolve-hero-image.ts` o `infrastructure/og-image-client.ts`.
- `routes/api.ts` se convierte en controlador fino dentro de `presentation/http/routes-api.ts`.
- `routes/public.ts` se convierte en controlador fino dentro de `presentation/http/routes-public.ts`.
- `templates/layout.ts` se divide en templates de pagina bajo `presentation/html/`, sin importar estado mutable desde infraestructura.
- `lib/config.ts`, `lib/rate-limit.ts`, `lib/http-cache.ts`, `lib/logging.ts`, `lib/observability.ts`, `lib/retention.ts` migran a `infrastructure/`, salvo reglas puras de retencion que pueden vivir en `application/retention-policy.ts`.

## 2. Patrones a Unificar

### Manejo de errores

Patron recomendado: `Result<T, AppError>` en application/domain y traduccion unica a HTTP en presentation.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

type AppError = {
  code: string;
  message: string;
  status?: number;
  details?: Record<string, unknown>;
};
```

Reglas:

- Domain no conoce HTTP ni `Response`.
- Application devuelve `Result` para errores esperados: invalid input, not found, validation failed, unauthorized disabled, rate limited.
- Infrastructure puede lanzar errores inesperados de filesystem/fetch, pero los adapta a `AppError` en repositories/clients.
- Presentation convierte `AppError.status` a JSON o HTML segun ruta.
- Errores best-effort como OG image pueden devolver `ok: true, value: null` con log debug/info si se agrega nivel.

### Naming

- Codigo TypeScript: `camelCase` para variables, funciones y propiedades internas.
- Tipos y clases: `PascalCase`.
- Constantes globales verdaderamente constantes: `UPPER_SNAKE_CASE`.
- Variables de entorno: `UPPER_SNAKE_CASE`.
- JSON API: `camelCase`, salvo compatibilidad explicita con payloads existentes como `draft_id` si ya hay agentes externos usandolo.
- Frontmatter markdown: mantener `snake_case` por compatibilidad, especialmente `image_url`.
- IDs de edicion: usar `editionId` internamente, no `date`, cuando el valor puede incluir sufijo horario.
- Fechas de calendario: usar `day` o `localDate`, no `date`, cuando se refiere solo a `YYYY-MM-DD`.

### Acceso a datos

Patron recomendado: repository pattern sobre filesystem.

Contratos objetivo:

```ts
interface CurationRepository {
  listIds(): Promise<CurationId[]>;
  exists(id: CurationId): Promise<boolean>;
  read(id: CurationId): Promise<string | null>;
  create(id: CurationId, content: string): Promise<void>;
  update(id: CurationId, content: string): Promise<void>;
  stat(id: CurationId): Promise<{ size: number; mtime: Date } | null>;
}

interface DraftRepository {
  create(content: string): Promise<DraftId>;
  read(id: DraftId): Promise<string | null>;
  latest(): Promise<{ id: DraftId; updatedAt: Date; content: string } | null>;
  deleteExpired(now: Date, ttlHours: number): Promise<number>;
}

interface VersionRepository {
  saveSnapshot(editionId: CurationId, content: string, reason: string): Promise<VersionId>;
  list(editionId: CurationId): Promise<VersionId[]>;
  read(editionId: CurationId, versionId: VersionId): Promise<string | null>;
  trim(editionId: CurationId, maxVersions: number): Promise<number>;
}
```

### Validacion

- Validadores puros en `src/domain/` para `CurationId`, `DraftId`, `VersionId`, markdown editorial y frontmatter.
- Validacion de request shape en presentation, antes de llamar casos de uso.
- Validacion que requiere IO remoto o filesystem en application/infrastructure, no en domain puro.

### Logging y metricas

- Usar `logEvent` para servidor y flujos backend; reemplazar `console.log/warn/error` backend por logger estructurado.
- Mantener `console.error` en cliente solo si no hay pipeline frontend de errores; documentarlo como fuera del backend.
- Contadores de application deben incrementarse dentro de casos de uso exitosos, no repartidos por handlers.

## 3. Contratos Entre Capas

### Presentation

Responsabilidad:

- Parsear HTTP: params, query, headers, content type y body.
- Ejecutar auth/rate limit middleware.
- Llamar un caso de uso de application.
- Convertir `Result` a HTML/JSON/redirect.
- Aplicar cache headers cuando corresponde.

Entrada:

- Request HTTP Hono.

Salida:

- Response Hono/Fetch.

Prohibido:

- Importar `fs`, `path`, `fetch` remoto o repositories concretos directamente desde handlers, salvo wiring en `app.ts`.
- Construir paths de archivos de dominio.

### Application

Responsabilidad:

- Orquestar casos de uso: publicar, crear draft, editar, listar, buscar, resolver hero, limpiar retencion.
- Coordinar repositories, validadores, cache invalidation, metrics y logging.
- Definir transacciones logicas: por ejemplo snapshot antes de update.

Entrada:

- DTOs internos ya parseados: `{ content }`, `{ draftId }`, `{ editionId }`, `{ patch }`.

Salida:

- DTOs de aplicacion: `{ editionId, url, validation, warning }`, `{ curations, nextCursor }`, `{ html, meta }`.

Prohibido:

- Conocer Hono `Context` o devolver `Response`.
- Renderizar HTML completo.

### Domain

Responsabilidad:

- Reglas puras: validar markdown, extraer featured, parsear/serializar frontmatter, validar IDs, calcular reading time, fechas locales.
- Tipos nominales ligeros para IDs.

Entrada:

- Strings y objetos simples.

Salida:

- Objetos puros sin IO.

Prohibido:

- `fs`, `fetch`, DNS, Hono, logging, metricas globales.

### Infrastructure

Responsabilidad:

- Implementar filesystem repositories.
- Implementar OG image HTTP client y SSRF guard.
- Implementar rate limiter, logger, metrics, config y cache HTTP.
- Conectar assets/uploads.

Entrada:

- Config runtime y DTOs de application.

Salida:

- Datos crudos o errores adaptados.

Prohibido:

- Decidir reglas editoriales.

### Shared

Responsabilidad:

- Utilidades genericas sin conocimiento del producto.
- Limite recomendado: 3 a 5 archivos.

Archivos aceptables:

- `result.ts` para `Result`.
- `html.ts` para `escapeHtml`.
- `ids.ts` para helpers de regex si son genericos o wrappers nominales.
- `time.ts` para helpers de reloj inyectable si los tests lo necesitan.

## 4. Arquitectura Real vs Objetivo para `AGENTS.md.v2`

`AGENTS.md` actual es util pero incompleto. La version v2 deberia mantener una seccion de arquitectura real mientras la migracion ocurre, y una seccion de arquitectura objetivo para guiar agentes.

Contenido recomendado para `AGENTS.md.v2`:

````md
# AGENTS.md

## Commands

```bash
bun install
bun run dev
bun run start
PORT=3000 bun run start
bun test
```

Server default: `http://localhost:8391`. No lint script is configured.

## Current Stack

- Runtime: Bun
- Framework: Hono `^4.12.15`
- Markdown: Marked `^18.0.2`
- Rendering: server-rendered HTML, no frontend build step
- Persistence: filesystem markdown, drafts, versions and uploads

## Current Architecture

| File | Responsibility |
|---|---|
| `server.ts` | Bun entrypoint; exports `{ port, fetch }` and `createApp` |
| `app.ts` | App assembly, global headers, static uploads/assets, health/readiness, route registration |
| `routes/public.ts` | Public pages: `/`, `/latest`, `/curacion/:date`, `/ediciones`, `/drafts/:id` |
| `routes/api.ts` | JSON API, authenticated writes, drafts, publish, versions, diff, uploads |
| `lib/app-deps.ts` | Shared dependency type for route registration |
| `lib/auth.ts` | API key guard via `X-Api-Key` or `Authorization: Bearer` |
| `lib/config.ts` | Runtime config and default rate limits |
| `lib/curations.ts` | Current legacy core: filesystem reads, caches, watcher, markdown render, validation, search, dates, OG image SSRF guard |
| `lib/frontmatter.ts` | Frontmatter parse/serialize and `image_url` validation |
| `lib/diff.ts` | Line diff for snapshots |
| `lib/http-cache.ts` | ETag and Last-Modified helpers |
| `lib/rate-limit.ts` | In-memory per-IP/bucket rate limiter |
| `lib/retention.ts` | Draft cleanup and version retention |
| `lib/logging.ts` | JSON structured logs |
| `lib/observability.ts` | In-memory counters exposed through health |
| `templates/layout.ts` | Full HTML page shell and escaping |
| `public/app.js` | Theme, command palette search, mobile menu, TOC, reading progress, view switcher |

## Routes

Document all routes including `/latest` and `/health/internal`. `/health` is public and does not expose effective config; `/health/internal` is authenticated and does.

## Target Architecture

Move incrementally toward `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`, and small `src/shared`. Do not rewrite from scratch. When touching legacy files, preserve behavior with tests first.
````

Nota: por la restriccion de esta auditoria, no se crea `AGENTS.md.v2` como quinto archivo. La propuesta queda aqui para copiarse en la fase de implementacion.

## 5. Principios de Recuperacion

- No mover archivos antes de tener tests de comportamiento de publicacion, lectura, busqueda, drafts y edicion.
- Primero extraer funciones puras sin cambiar rutas ni respuestas.
- Mantener rutas HTTP y payloads existentes hasta confirmar consumidores externos de agentes.
- Introducir repositories detras de interfaces, pero conservar filesystem como implementacion inicial.
- Eliminar estado global mutable gradualmente pasando `config` y repositories por dependency injection.
- Separar mejoras de seguridad/observabilidad de refactors cosmeticos.
- Documentar cada fase en `AGENTS.md` al terminarla.
