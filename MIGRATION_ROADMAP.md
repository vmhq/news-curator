# Roadmap de Migracion Incremental

Objetivo: estabilizar y modularizar sin reescribir desde cero. La aplicacion es pequena; el plan realista es 4 fases con cambios medidos y tests antes de tocar flujos criticos.

## Fase 1: Semana 1, Stop the Bleeding

Meta: reducir riesgo inmediato en produccion y cerrar inconsistencias que pueden causar datos stale o regresiones editoriales.

### Cambios propuestos

- Agregar helper unico `isDraftId` y reemplazar regex duplicadas en `routes/api.ts` y `routes/public.ts`.
- Eliminar import muerto `utimes` en `routes/api.ts`.
- Eliminar o usar helper muerto `esc` en `public/app.js`.
- Decidir si `findTodayCuration`, `groupByDay` y export publico de `CURATION_FILE_ID_RE` se eliminan o se vuelven internos.
- Corregir invalidacion de search index tras `PUT /api/curations/:date` y `PATCH /api/curations/:date/meta`.
- Unificar respuesta de errores esperados en API con helper local pequeno, sin introducir framework grande.
- Reemplazar `console.log/warn/error` backend por `logEvent` donde sea seguro.
- Actualizar `AGENTS.md` con rutas/modulos reales, especialmente `/latest`, `/health/internal`, `auth`, `diff`, `logging`, `observability`.

### Archivos/modulos involucrados

- `routes/api.ts`
- `routes/public.ts`
- `lib/curations.ts`
- `lib/logging.ts`
- `public/app.js`
- `AGENTS.md`
- `tests/app.test.ts`
- `tests/curations.test.ts`

### Tests que deben existir antes

- Test de publicacion raw: `POST /api/publish` crea edicion, invalida lista y devuelve URL.
- Test de publicacion desde draft: `POST /api/drafts/:id/publish` crea edicion equivalente.
- Test de busqueda despues de `PUT`: editar contenido y verificar que `/api/search` ve el contenido nuevo con watcher deshabilitado.
- Test de `PATCH /meta`: guarda snapshot, modifica frontmatter y no rompe contenido body.
- Test de auth para `/health/internal`, `/api/curations/:date/versions` y `/api/curations/:date/diff/latest`.
- Test de draft ID invalido consistente en API y preview publica.

### Riesgo de ruptura en produccion

Medio. Son cambios pequenos pero tocan publish/edit/search. El mayor riesgo es invalidar cache de mas, afectando rendimiento, no comportamiento.

### Rollback strategy

- Mantener commits pequenos por subtema.
- Si falla publish/edit, revertir solo commit de helpers o invalidacion.
- Como persistencia es filesystem, rollback de codigo no requiere migracion de datos.
- Antes de deploy, conservar backup/volumen de `CURATIONS_DIR`, `DRAFTS_DIR`, `VERSIONS_DIR` y `UPLOADS_DIR`.

## Fase 2: Semana 2-3, Extraer Utilidades Comunes

Meta: sacar duplicacion y crear boundaries estables sin cambiar rutas publicas.

### Cambios propuestos

- Crear `src/shared/html.ts` o `lib/html.ts` temporal con `escapeHtml` unico.
- Crear `src/shared/ids.ts` o `lib/ids.ts` temporal con `isCurationFileId`, `dateFromFileId`, `isDraftId`, `isVersionId`.
- Crear parser unico de frontmatter y usarlo en render, check image URL y patch meta.
- Extraer caso comun `publishEditionContent(content, source)` desde ramas `/api/publish` y `/api/drafts/:id/publish`.
- Extraer `buildEditionViewModel(editionId, options)` para compartir logica entre `/` y `/curacion/:date`.
- Crear wrapper `ImageUrlValidator` o modulo `og-image-client` para `validateImageUrl`, `checkImageUrl`, `extractOgImage` y SSRF guard.
- Crear repository filesystem minimo para curations: `list/read/write/exists/stat`.
- Mantener imports legacy re-exportando si hace falta para reducir diff.

### Archivos/modulos involucrados

- `lib/curations.ts`
- `lib/frontmatter.ts`
- `templates/layout.ts`
- `routes/api.ts`
- `routes/public.ts`
- Nuevos modulos temporales bajo `lib/` o definitivos bajo `src/shared/` y `src/infrastructure/`
- `tests/app.test.ts`
- `tests/curations.test.ts`

### Tests que deben existir antes

- Tests de `renderCurationContent` con `image_url` con comillas, sin comillas, vacio y ausente.
- Tests de `checkImageUrl` para `/static/uploads/<file>` existente/no existente.
- Tests de home y detalle generando mismo hero metadata para una misma edicion.
- Tests de publish raw y publish draft verificando forma de respuesta compatible.
- Tests de busqueda con HTML escaping y `<mark>` esperado.

### Riesgo de ruptura en produccion

Medio-alto. Extraer helpers puede cambiar detalles de render, metadata o validacion de frontmatter si no se hace con snapshots de comportamiento.

### Rollback strategy

- Feature flag no necesario si se mantienen firmas antiguas.
- Hacer extracciones mecanicas en commits separados: IDs, HTML escape, frontmatter, publish, view model.
- Si una extraccion falla, revertir solo esa extraccion y conservar tests agregados.
- No cambiar formato de markdown ni payloads API en esta fase.

## Fase 3: Semana 4-6, Modularizar por Dominio

Meta: mover de arquitectura plana a capas sin cambiar producto.

### Cambios propuestos

- Crear estructura `src/domain`, `src/application`, `src/infrastructure`, `src/presentation`.
- Mover reglas puras a `src/domain`: validacion editorial, featured extraction, frontmatter puro, fechas, reading time, ID parsing.
- Mover filesystem a repositories en `src/infrastructure`.
- Mover SSRF/fetch remoto a `src/infrastructure/og-image-client.ts`.
- Mover casos de uso a `src/application`: publish, draft workflow, edit, list, search, resolve hero image, retention.
- Convertir `routes/api.ts` y `routes/public.ts` en adaptadores finos que llaman application.
- Pasar `config`, repositories, logger, metrics y rate limiter por dependency injection desde `createApp`.
- Eliminar `export let` globales `CURATIONS_DIR`, `SITE_URL`, `DEFAULT_COVER` o encapsularlos en config inyectada.
- Dividir `templates/layout.ts` en componentes HTML server-side mas pequenos, sin introducir frontend build.

### Archivos/modulos involucrados

- `app.ts`
- `server.ts`
- `routes/api.ts`
- `routes/public.ts`
- `templates/layout.ts`
- Todo `lib/`
- Nuevos `src/domain/*`, `src/application/*`, `src/infrastructure/*`, `src/presentation/*`, `src/shared/*`
- `tests/*`

### Tests que deben existir antes

- Suite de integracion HTTP completa para rutas publicas principales: `/`, `/latest`, `/curacion/:date`, `/ediciones`, `/drafts/:id`.
- Suite de integracion API completa para publish, drafts, validate, upload, PUT, PATCH, versions, diff, search.
- Tests unitarios de domain sin filesystem: IDs, frontmatter, validation, featured extraction, dates, reading time.
- Tests de repositories con temp dirs.
- Tests de app con dos instancias `createApp` y configs distintas para detectar contaminacion global.

### Riesgo de ruptura en produccion

Alto si se hace en un solo PR. Medio si se hace modulo por modulo con compatibilidad y tests.

### Rollback strategy

- Mantener rutas y payloads sin cambios.
- Introducir nueva capa detras de handlers existentes y migrar endpoint por endpoint.
- Mantener modulos legacy como facade temporal re-exportando funciones migradas.
- Deployar primero endpoints read-only migrados, luego drafts, luego publish/edit.
- Si falla una ruta migrada, revertir el commit de esa ruta sin tocar datos.

## Fase 4: Continuo, Refactorizacion Dirigida

Meta: cada cambio funcional deja el area mejor cubierta y mas modular.

### Cambios propuestos

- Cuando se toque un handler, mover una pequena parte a application si aun esta legacy.
- Cuando se toque una regla editorial, agregar test unitario de domain primero.
- Cuando se toque filesystem, agregar test repository con temp dir primero.
- Cuando se toque UI server-rendered, agregar test de HTML minimo o snapshot estructural de fragmentos criticos.
- Revisar limites de diff para evitar DP sobre archivos gigantes.
- Revisar rate limiting para proxies reales y multiples replicas.
- Agregar script de lint/typecheck si el proyecto crece: por ejemplo `bunx tsc --noEmit` si se incorpora TypeScript checking formal.
- Actualizar `AGENTS.md` tras cada fase completada.

### Archivos/modulos involucrados

- Modulos legacy restantes.
- Nuevos modulos `src/*`.
- `AGENTS.md`.
- Tests relacionados con cada area tocada.

### Tests que deben existir antes

- Test de regresion especifico para cada bug o feature antes del refactor asociado.
- Test de contrato API si cambia cualquier respuesta JSON.
- Test de render si cambia layout, hero, archive, sidebar, feed o draft preview.
- Test de seguridad si cambia SSRF, path handling, auth, CSP o escaping.

### Riesgo de ruptura en produccion

Bajo por cambio individual si se respeta el principio de tests primero. Acumulado medio si no se actualiza documentacion y ownership.

### Rollback strategy

- Cambios pequenos y revertibles.
- Deploy canario si existe infraestructura para hacerlo; si no, deploy manual con health/readiness y smoke tests.
- Smoke tests post-deploy: `/health`, `/ready`, `/`, `/latest`, `/api/curations`, `/api/search?q=test`, validacion autenticada y preview de draft.
- Mantener backups regulares de volumenes de datos.

## Orden Recomendado de PRs

1. Tests faltantes de cache/search/edit/auth.
2. Limpieza segura: imports/helpers muertos y `AGENTS.md` actualizado.
3. Invalidacion de search index tras edit/meta.
4. Helpers unicos de IDs y frontmatter.
5. Extraccion de publish workflow.
6. Extraccion de view model publico.
7. Repository filesystem para curations.
8. Separacion de domain validation/dates/frontmatter.
9. Application services para publish, drafts y edit.
10. Division de templates y cierre de globals mutables.

## Criterios de Exito

- `bun test` pasa en cada fase.
- No cambian rutas ni payloads sin documentacion explicita.
- `AGENTS.md` refleja la realidad tras cada fase.
- `routes/api.ts`, `routes/public.ts`, `lib/curations.ts` y `templates/layout.ts` bajan de tamano y responsabilidades gradualmente.
- Nuevas reglas de negocio viven en domain/application, no directamente en handlers.
- Fallos de filesystem/fetch importantes quedan logueados de forma estructurada.
