# Auditoria de Deuda Tecnica

Proyecto auditado: `news-curator` / Daily Brief.

Fecha de auditoria: 2026-04-25.

Resultado general: el proyecto no es un desastre. Es pequeno, funcional y tiene pruebas de los flujos principales. La deuda real viene de concentrar demasiadas responsabilidades en pocos archivos, duplicar validaciones/paths y mezclar presentacion, infraestructura y reglas editoriales. Es recuperable incrementalmente.

## A. Duplicacion y Redundancia

### Validacion de IDs duplicada

- `routes/api.ts:243`, `routes/api.ts:354`, `routes/api.ts:365` validan draft IDs con `^[a-f0-9-]{36}$` en tres lugares.
- `routes/public.ts:303` repite la misma validacion para preview HTML de drafts.
- Riesgo: si se endurece el formato de UUID, es facil cambiar un endpoint y olvidar otro.

### Escritura de ediciones duplicada

- `routes/api.ts:269-285` publica desde `/api/publish`.
- `routes/api.ts:374-390` publica desde `/api/drafts/:id/publish`.
- Ambas ramas generan `editionId`, crean `CURATIONS_DIR`, escriben archivo, invalidan cache, incrementan metricas, validan imagen y construyen respuesta casi igual.
- Riesgo: divergencia funcional entre publicar raw y publicar draft.

### Validacion de longitud duplicada e incompleta

- `lib/curations.ts:291-296` valida longitud en `validateCurationContent`.
- `routes/api.ts:256-258` valida longitud antes de publicar.
- `routes/api.ts:480-482` valida longitud antes de editar.
- `routes/api.ts:320-331` crea drafts validando solo con `validateCurationContent`; no hay guard separado para content length fuera del validador.
- Riesgo: reglas iguales repartidas entre boundary HTTP y dominio editorial.

### Frontmatter parseado con regex y parser separado

- `lib/curations.ts:230-231` extrae `image_url` con regex en `renderCurationContent`.
- `lib/frontmatter.ts:6-23` tiene `parseFrontmatter` formal.
- `lib/frontmatter.ts:75-79` vuelve a extraer `image_url` con regex en `checkImageUrl`.
- Riesgo: discrepancias con comillas, espacios, keys futuras o frontmatter multilinea.

### Escape HTML duplicado

- `lib/curations.ts:41-48` define `escapeHtmlInternal`.
- `templates/layout.ts:3-10` define `escapeHtml` equivalente.
- `public/app.js:358-361` define `esc`, aparentemente no usado dentro del archivo.
- Riesgo: seguridad dispersa y helpers duplicados.

### Lectura de resumen/listas repetida

- `routes/public.ts:34-42` implementa `getRecentCurations` localmente.
- `routes/api.ts:105-129` hace `Promise.all` similar para construir curations JSON.
- Riesgo: diferencias futuras en summary, error handling o orden.

### Construccion de pagina publica duplicada entre home y detalle

- `routes/public.ts:142-179` y `routes/public.ts:219-258` repiten extraccion de `generatedAt`, `featured`, `readingTime`, `heroImage`, `recentCurations`, `prevDate`, `nextDate` y llamada a `buildPage`.
- Riesgo: fixes visuales o de metadata pueden aplicarse solo a `/` o solo a `/curacion/:date`.

### Middleware auth/rate limit redundante para drafts

- `routes/api.ts:288-291` aplica auth/rate limit a `/api/drafts` y `/api/drafts/*` por separado.
- Es correcto operacionalmente, pero la intencion queda repetida y propensa a olvidar nuevas subrutas.

## B. Acoplamiento y Dependencias

### `lib/curations.ts` concentra demasiadas responsabilidades

- `lib/curations.ts:10-39` maneja config global mutable.
- `lib/curations.ts:66-119` maneja caches y watcher filesystem.
- `lib/curations.ts:132-186` maneja lectura e indice de busqueda.
- `lib/curations.ts:227-255` maneja render y featured extraction.
- `lib/curations.ts:286-385` maneja validacion editorial.
- `lib/curations.ts:400-498` maneja SSRF y fetch remoto de OG images.
- `lib/curations.ts:500-545` maneja fechas y formato.
- Riesgo: cambios inocentes en presentacion, storage o seguridad comparten modulo y estado global.

### Presentation toca infraestructura directamente

- `routes/api.ts:1-3` importa filesystem/path y escribe archivos directamente.
- `routes/public.ts:1-3` importa filesystem/path y lee archivos directamente.
- `app.ts:1-3` tambien sirve uploads desde filesystem.
- Segun una arquitectura por capas, rutas deberian orquestar casos de uso, no conocer paths fisicos.

### Template depende de estado de dominio/config global mutable

- `templates/layout.ts:1` importa `SITE_URL`, `DEFAULT_COVER`, `formatDateEs`, `dateFromFileId` desde `lib/curations.ts`.
- `SITE_URL` y `DEFAULT_COVER` son `export let` mutables configuradas por `configureCurationsEnv`.
- Riesgo: tests o multiples apps en el mismo proceso pueden compartir estado global inesperado.

### Configuracion depende del modulo de curaciones

- `lib/config.ts:2` importa `CURATIONS_DIR` y `SITE_URL` desde `lib/curations.ts`.
- `app.ts:19-20` carga config y luego vuelve a configurar curations env.
- Riesgo: direccion de dependencia invertida; el dominio/storage no deberia ser fuente de defaults para config.

### Dependencia circular conceptual entre frontmatter y curations

- `lib/frontmatter.ts:4` importa `isBlockedResolvedUrl` desde `lib/curations.ts`.
- `routes/api.ts:7-17` usa ambos modulos como si fueran independientes.
- Aunque no hay ciclo de import directo, `frontmatter` depende de un modulo gigante de curations para seguridad de URLs.
- Riesgo: no se puede reutilizar frontmatter sin arrastrar render, caches, filesystem y marked.

### Infraestructura mezclada con reglas de negocio

- `routes/api.ts:260-267` valida reglas editoriales dentro del handler HTTP.
- `routes/api.ts:494-508` guarda snapshot, escribe archivo, invalida cache, incrementa metricas y valida imagen en el mismo handler.
- `routes/public.ts:146-148` decide fallback de imagen llamando fetch remoto desde una ruta publica.
- Riesgo: dificil testear reglas sin servidor y dificil cambiar storage sin tocar rutas.

## C. Inconsistencias de Patrones

### Manejo de errores heterogeneo

- `app.ts:28-30` usa `.catch()` y `console.error` para retention startup.
- `app.ts:141-156` usa `try/catch`, log estructurado y JSON 503 para readiness.
- `lib/curations.ts:143-145` traga errores de `readdir` y devuelve `[]`.
- `lib/curations.ts:211-213` traga errores de summary y devuelve `date`.
- `lib/curations.ts:222-224` traga errores de lectura y devuelve `null`.
- `routes/api.ts` devuelve JSON `{ error }` en boundaries HTTP.
- `routes/public.ts:184`, `routes/public.ts:303`, `routes/public.ts:306` devuelven texto plano en errores publicos simples.
- Riesgo: observabilidad incompleta y contratos distintos segun ruta.

### Nomenclatura mezclada entre API, markdown y codigo

- `routes/api.ts:241-243` recibe `draft_id`.
- `routes/api.ts:313`, `routes/api.ts:343`, `routes/api.ts:384` responde `draft`.
- `routes/api.ts:280`, `routes/api.ts:504`, `routes/api.ts:542` responde `edition`.
- `routes/api.ts:88-143` usa `curations` y `date` para listar.
- `lib/frontmatter.ts` usa `image_url`, mientras codigo usa `coverImage` y `heroImage`.
- Riesgo: consumidores API y agentes tienen que recordar alias por endpoint.

### Async style mayormente consistente pero con excepciones

- Predomina `async/await`.
- `app.ts:28` usa `.catch()` en startup fire-and-forget.
- `lib/curations.ts:465` usa `.finally()` sobre `fetch` para timeout cleanup.
- No es grave, pero conviene documentar patron: `async/await` con helpers `Result` o excepciones controladas.

### Estructura de archivos plana para el tamano actual

- `routes/api.ts` tiene 546 lineas y contiene autenticacion por ruta, rate limit, validacion, IO, versionado, drafts, uploads y API read.
- `templates/layout.ts` tiene 439 lineas y contiene layout global, hero, sidebar, feed extraction, OG tags y SVG fallback.
- `public/app.js` tiene 506 lineas y contiene tema, TOC, busqueda, command palette, progreso, view switcher y menu mobile.
- Riesgo: cada feature nueva aumenta probabilidad de regresiones cruzadas.

## D. Codigo Muerto y Hacks

### Exports no usados en produccion ni tests

- `lib/curations.ts:508-512` exporta `findTodayCuration`, pero no hay referencias fuera de su definicion.
- `lib/curations.ts:514-521` exporta `groupByDay`, pero no hay referencias fuera de su definicion.
- `lib/curations.ts:121` exporta `CURATION_FILE_ID_RE`, pero solo se usa localmente por `isCurationFileId`.
- Riesgo: superficie publica artificial y confusion para agentes futuros.

### Import no usado

- `routes/api.ts:2` importa `utimes` desde `fs/promises`, pero no se usa en ese archivo.
- Riesgo: pequeno, senal de falta de lint/typecheck estricto.

### Helper cliente aparentemente no usado

- `public/app.js:358-361` define `esc(str)`, pero no hay usos en el archivo.
- Riesgo: pequeno, ruido.

### Comentarios de compatibilidad/hacks

- No se encontraron `TODO`, `FIXME`, `HACK` o `temporary` en codigo fuente relevante.
- Hay compatibilidad legacy intencional en `public/app.js:13-18` migrando `localStorage.theme` a `themeMode`.
- Hay compatibilidad legacy intencional en `lib/curations.ts:123-126` para heading `Featured Story` y emoji.

### Dependencias potencialmente no sobrantes

- `package.json` solo contiene `hono`, `marked` y `bun-types`; todas se usan.
- No se detectan dependencias npm muertas.

## E. Riesgos de Produccion

### Secretos o keys

- No se observan secretos reales hardcodeados en codigo fuente.
- `.env.example:6` contiene placeholder `API_KEY=change-me-to-a-strong-random-key`, correcto como ejemplo.
- `tests/app.test.ts:66` usa `secret-key` solo en tests.

### Rate limiting existe pero tiene limitaciones operativas

- `routes/api.ts:64-75` implementa middleware por bucket.
- `lib/rate-limit.ts:48-50` usa `c.env.requestIP?.address` o fallback `anonymous`.
- En Bun/Hono puede que `requestIP` no exista segun deployment; si no existe, todos los clientes comparten bucket `anonymous`.
- Rate limiter en memoria no sirve para multiples replicas y se resetea al reiniciar.

### Validacion en boundaries existe pero esta dispersa

- IDs de edicion se validan con `isCurationFileId` en varias rutas.
- Draft IDs se validan con regex duplicada.
- Version IDs se validan en `routes/api.ts:435`.
- Frontmatter patch acepta cualquier key tras sanitizar solo al serializar en `lib/frontmatter.ts:31-33`.
- Riesgo: keys desconocidas pueden entrar en metadata sin contrato explicito.

### Logs estructurados parciales

- `lib/logging.ts:1-10` provee logs JSON.
- `routes/api.ts` usa `logEvent` para publish, validation, drafts, versions y updates.
- `app.ts:29`, `app.ts:33`, `server.ts:6`, `public/app.js:391` usan `console.*` no estructurado.
- Riesgo: trazabilidad incompleta en errores de startup, API key faltante y errores cliente.

### Errores silenciosos reducen observabilidad

- `lib/curations.ts:143`, `lib/curations.ts:156`, `lib/curations.ts:211`, `lib/curations.ts:222`, `lib/curations.ts:418`, `lib/curations.ts:489` capturan errores sin log.
- Algunos son best-effort razonables, pero errores de filesystem pueden ocultar problemas reales de permisos o volumen.

### Estado global mutable

- `lib/curations.ts:10-14` exporta `CURATIONS_DIR`, `SITE_URL`, `DEFAULT_COVER` como `let` mutables.
- `configureCurationsEnv` muta estado global por app.
- Tests deshabilitan watcher, pero multiples instancias de `createApp()` en el mismo proceso comparten esos globals.
- Riesgo: contaminacion entre tests, previews o procesos embebidos.

### Consistencia de cache tras escritura parcial

- `PUT` y `PATCH` invalidan `summaryCache` por fecha, pero no invalidan `filesCache` porque el archivo ya existe.
- Si cambia contenido usado por search index, `searchIndexCache` no se invalida en `PUT` o `PATCH`.
- Evidencia: `routes/api.ts:496-498` solo llama `invalidateSummaryCache(date)`; `routes/api.ts:536-538` igual. `searchIndexCache` solo se limpia con `invalidateFilesCache` en `lib/curations.ts:72-75`.
- Riesgo: busqueda puede devolver contenido stale despues de editar una edicion hasta que watcher invalide o proceso reinicie. Si watcher esta deshabilitado, stale persiste.

### Posible problema de Hono routing por orden de rutas

- `routes/api.ts:393-400` aplica middleware a `/api/curations/:date` antes de definir subrutas como `/versions`, `/diff/latest` y `PATCH /meta`.
- Luego `routes/api.ts:402-409` aplica middleware especifico a subrutas.
- Puede estar funcionando por semantica de Hono, pero el patron es dificil de razonar y no hay tests especificos para auth/rate de todas las subrutas.

### Diff O(n*m) sin limite explicito de lineas

- `lib/diff.ts:9-20` construye matriz DP de `left.length + 1` por `right.length + 1`.
- Contenido de edicion permite hasta 1.000.000 caracteres.
- Riesgo: diff de archivos grandes puede consumir memoria/CPU excesiva.

### SSRF mitigado, pero DNS fijo tiene implicaciones

- `lib/curations.ts:6-7` fuerza resolvers `1.1.1.1` y `8.8.8.8`.
- Beneficio: evita depender de DNS interno.
- Riesgo: deployments sin salida a esos resolvers rompen extraccion/validacion remota de imagenes.

## Veredicto sobre `AGENTS.md`

`AGENTS.md` es mayormente fiel a la realidad actual, pero necesita reemplazo menor/actualizacion.

Discrepancias concretas:

- Omite `lib/auth.ts`, `lib/app-deps.ts`, `lib/diff.ts`, `lib/logging.ts` y `lib/observability.ts` en la tabla de arquitectura.
- Omite la ruta publica `GET /latest`.
- Omite la ruta autenticada `GET /health/internal`.
- Dice que `/health` incluye configuracion efectiva en `AGENTS.md:94`, pero el codigo la expone en `/health/internal` (`app.ts:129-137`), no en `/health` (`app.ts:97-110`).
- La descripcion de `public/app.js` en `AGENTS.md:148` omite command palette, vista revista/feed y barra de progreso.
- La seccion de tests no menciona cobertura de `/latest`, `/health/internal` ni version trimming/diff con suficiente precision.

Recomendacion: no hace falta rehacerlo completo, pero si conviene generar `AGENTS.md.v2` o actualizar `AGENTS.md` tras la primera fase de migracion.
