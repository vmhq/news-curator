# Skill: Publicar curación de noticias en Daily Brief

Genera y publica una nueva edición de Daily Brief. Cubre las noticias más
relevantes del día en tecnología e inteligencia artificial.

Este es el documento único de referencia para cualquier agente AI que publique,
edite o gestione contenido en Daily Brief — tanto la estructura del archivo
markdown como la API completa de publicación.

---

## Configuración del agente

### Variables de entorno necesarias

| Variable | Uso |
|----------|-----|
| `DAILY_BRIEF_API_KEY` | Header `X-Api-Key` para todos los endpoints de escritura |
| `DAILY_BRIEF_URL` | URL base del servidor (ej: `https://dailyb.vmhq.cl` o `http://localhost:8391`) |

Si `DAILY_BRIEF_URL` no está definida, usar `http://localhost:8391` como fallback.

### Autenticación

Todos los endpoints de escritura requieren el header:
```
X-Api-Key: $DAILY_BRIEF_API_KEY
```
También aceptado como `Authorization: Bearer $DAILY_BRIEF_API_KEY`.

---

## Flujo autónomo completo

```
1. Recopilar noticias (Miniflux RSS, WebSearch, o fuentes directas)
   └─ Usar skill anthropic-skills:miniflux si está disponible

2. Seleccionar Featured Story — la noticia más impactante del día

3. Opcionalmente subir imagen de portada propia (POST /api/images)

4. Redactar el archivo markdown según la especificación de este documento

5. Validar via POST /api/validate y corregir cualquier `error`

6. Crear borrador via POST /api/drafts y revisar el `previewUrl`

7. Publicar el borrador via POST /api/drafts/:id/publish

8. Verificar la edición publicada visitando la URL devuelta
```

### Categorías objetivo

Cubrir al menos 3 de estas áreas por edición:

- **Inteligencia Artificial** — modelos, papers, benchmarks, lanzamientos
- **Tecnología** — productos, plataformas, infraestructura
- **Startups y Negocios** — rondas, adquisiciones, estrategia
- **Seguridad** — vulnerabilidades, ataques, defensas
- **Herramientas para Devs** — librerías, IDEs, CLIs, frameworks
- **Hardware** — chips, dispositivos, manufactura
- **Ciencia y Research** — papers destacados, descubrimientos

---

## Estructura del archivo markdown

### Reglas generales

- El archivo se procesa y muestra tal como está — la calidad del texto impacta directamente en el sitio.
- Cada sección de noticias va separada por `---`.
- Los artículos individuales van como `### [Titular](URL)`.
- Los titulares deben ser en español, claros y directos.
- El primer `### ` o `## ` que aparezca en el archivo se usa como título corto en el sidebar — que sea descriptivo.

---

### Plantilla completa

```markdown
---
image_url: https://url-de-imagen-editorial.com/foto.jpg
---
# Curación diaria — [Día] [D] de [mes] de [año]
*Generado el [día] [D] de [mes] de [año] a las [HH:MM]*
---

## 🔥 Featured Story: [TITULAR DE LA NOTICIA PRINCIPAL]

[Primer párrafo autónomo: 2–4 oraciones. Incluir el enlace principal aquí: [texto](https://url.com).]

[Párrafo adicional opcional con más contexto.]

---

## [Nombre de Sección]

### [Titular del artículo](https://url.com)
Resumen de 2–3 oraciones. Contexto, impacto, por qué importa.

### [Titular del artículo](https://url.com)
Resumen de 2–3 oraciones.

---

## [Otra Sección]

### [Titular](https://url.com)
Resumen.

---

## 🔗 Quick Links

- **[Nombre del recurso](https://url.com)** — una frase sobre su valor.
- **[Nombre del recurso](https://url.com)** — una frase sobre su valor.
- **[Nombre del recurso](https://url.com)** — una frase sobre su valor.
- **[Nombre del recurso](https://url.com)** — una frase sobre su valor.
```

---

### Frontmatter

```yaml
---
image_url: https://ejemplo.com/imagen.jpg
---
```

- Es la imagen que aparece en el hero de la página y en el OG tag al compartir.
- Usar una imagen representativa de la noticia principal (~1200×630 px ideal). **No logos, no favicons.**
- Si no hay `image_url`, el servidor intentará extraer `og:image` desde la primera URL de la Featured Story.
- Se puede usar una imagen subida directamente via `POST /api/images` (ver sección API):
  ```yaml
  image_url: /static/uploads/1713123456789-abc123.jpg
  ```

### Título e identificación

```markdown
# Curación diaria — Miércoles 9 de abril de 2026
*Generado el miércoles 9 de abril de 2026 a las 14:30*
```

- El `# Título` es eliminado por el servidor antes de renderizar — sirve solo como referencia interna.
- La línea `*Generado ...*` también se elimina — sirve como metadata interna.

### Featured Story (obligatorio)

```markdown
## 🔥 Featured Story: OpenAI lanza GPT-5 con capacidades multimodales avanzadas

El nuevo modelo de OpenAI supera en benchmarks a todos sus competidores actuales.
[Leer artículo completo](https://example.com/openai-gpt5).

La compañía afirma que GPT-5 puede procesar hasta 1 millón de tokens de contexto y
genera código funcional con una tasa de error inferior al 2%.
```

**Reglas:**
- El emoji `🔥` es **obligatorio** — es lo que el servidor detecta para generar el hero/banner. Cualquier otro emoji (⭐, 📌, etc.) **no genera hero**.
- El texto `Featured Story:` es convencional pero opcional; el parser acepta `## 🔥 TITULAR` directamente.
- El titular va en la misma línea que el `## 🔥`.
- Debe haber una **línea en blanco** entre el titular y el cuerpo.
- El **primer párrafo** (hasta el primer doble salto de línea) es el extracto que aparece en el hero — debe ser autónomo y atractivo (máx. ~280 caracteres).
- La **primera URL** en el cuerpo se usa para intentar obtener la imagen de portada si no hay `image_url` en el frontmatter. Siempre incluirla.
- La sección termina en `---` o en el siguiente `## ` que no sea Featured Story.

### Secciones de noticias

```markdown
## Inteligencia Artificial

### Anthropic publica Claude 4 con mejoras en razonamiento largo](https://example.com)
El nuevo modelo destaca por mantener coherencia en conversaciones de más de 100 turnos.
Anthropic afirma haber reducido las alucinaciones en un 40% respecto a Claude 3.5.

### Google DeepMind presenta Gemini Ultra 2](https://example.com)
La nueva versión supera a GPT-4 en tareas de código y matemáticas según los benchmarks
publicados hoy. Estará disponible en Google Cloud a partir de mayo.
```

**Nombres de sección recomendados:** Inteligencia Artificial · Tecnología · Negocios y Startups · Ciencia · Seguridad · Política Tech · Hardware · Herramientas · Industria

**Reglas:**
- Mínimo 2 artículos por sección, máximo ~6.
- El `### Titular` debe ir con URL entre paréntesis directamente — no separados.
- El resumen va en las líneas siguientes, sin bullet point, en prosa.
- Separar secciones con `---`.

### Quick Links (obligatorio, al final)

```markdown
## 🔗 Quick Links

- **[The Pragmatic Engineer: AI in 2026](https://example.com)** — análisis profundo del mercado laboral tech.
- **[Hacker News top thread hoy](https://example.com)** — debate sobre el futuro de los LLMs open source.
- **[Paper: Scaling Laws revisited](https://arxiv.org/...)** — investigadores de Stanford cuestionan los supuestos de escalado.
- **[Tool: Cursor 2.0 changelog](https://example.com)** — novedades del IDE de IA más popular entre devs.
```

**Reglas:**
- Entre 4 y 8 links.
- El nombre del link en **negrita** dentro del enlace markdown.
- Después del enlace, `—` (em dash) seguido de una frase corta explicando el valor.
- Mix de: papers, threads, herramientas, videos, posts largos, recursos técnicos.
- Son distintos a los artículos de las secciones — aquí van cosas más nicho, técnicas o complementarias.

---

## Reglas críticas de formato

| Elemento | Regla |
|----------|-------|
| `## 🔥` | El emoji `🔥` es **obligatorio**. Cualquier otro emoji no genera hero. |
| Espacio tras emoji | `## 🔥 Featured Story:` — siempre espacio entre el emoji y el texto. |
| Cuerpo de Featured | **Línea en blanco obligatoria** entre el `## 🔥 ...` y el primer párrafo. |
| Primera URL en Featured | Siempre incluirla — se usa para extraer imagen si no hay `image_url`. |
| Artículos de sección | `### [Titular](url)` — el link va en el propio titular. |
| Separadores | `---` entre cada sección y después del bloque intro. |
| Quick Links | `**[Nombre](url)** — descripción` — negrita en el nombre, em dash antes de la descripción. |
| Cantidad de Quick Links | Entre 4 y 8 items. |
| `image_url` | Imagen editorial representativa. **No logos, no favicons.** |

## Errores comunes a evitar

| ❌ Incorrecto | ✅ Correcto |
|---|---|
| `## ⭐ Historia Destacada: ...` | `## 🔥 Featured Story: ...` — solo `🔥` activa el hero |
| `## 🔥Featured Story: ...` | `## 🔥 Featured Story: ...` (espacio después del emoji) |
| Sin línea en blanco entre titular y cuerpo de la Featured | Siempre línea en blanco entre `## 🔥 ...` y el texto |
| `### Titular` sin URL | `### [Titular](https://url.com)` |
| Quick Links sin em dash | `- **[Link](url)** — descripción` |
| Secciones sin `---` entre ellas | Siempre `---` entre secciones |
| `image_url` apuntando a un logo o favicon | Imagen editorial de la noticia, mínimo ~600 px de ancho |

---

## API Reference

### Validar markdown antes de publicar (`POST /api/validate`)

Usar este endpoint antes de crear borrador o publicar directamente. Devuelve `errors`,
`warnings` y estadísticas editoriales para que el agente pueda autocorregirse.

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/validate" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

**Respuesta válida (200):**
```json
{
  "valid": true,
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [],
    "stats": {
      "headings": 8,
      "sections": 4,
      "stories": 12,
      "links": 17,
      "duplicateLinks": 0,
      "readingTime": 6
    }
  }
}
```

**Respuesta con errores (422):**
```json
{
  "error": "Validation failed",
  "validation": {
    "valid": false,
    "errors": [
      {
        "severity": "error",
        "code": "featured_missing",
        "message": "Falta la sección destacada con heading ## 🔥 Featured Story: ..."
      }
    ],
    "warnings": [],
    "stats": { "headings": 2, "sections": 1, "stories": 0, "links": 0, "duplicateLinks": 0, "readingTime": 1 }
  }
}
```

Si hay `errors`, no publicar. Corregir el markdown y volver a validar.

---

### Subir imagen propia (`POST /api/images`)

Cuando se dispone de una imagen propia (no externa), se puede subir antes de publicar:

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/images" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -F "image=@/ruta/a/foto.jpg"
```

**Restricciones:** tipos permitidos `jpeg`, `png`, `webp`, `gif`, `avif`; tamaño máximo **10 MB**.

**Respuesta (201):**
```json
{ "success": true, "url": "/static/uploads/1713123456789-abc123.jpg" }
```

Usar el `url` devuelto como `image_url` en el frontmatter de la curación.

---

### Publicar nueva edición (`POST /api/publish`)

Publica inmediatamente. El servidor valida el markdown y rechaza la publicación
con `422` si hay errores estructurales. Para flujos autónomos, preferir
`POST /api/drafts` → preview → `POST /api/drafts/:id/publish`.

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/publish" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

También aceptado como JSON:

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/publish" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$(cat curación.md | jq -Rs .)\"}"
```

**Respuesta (201):**
```json
{
  "success": true,
  "edition": "2026-04-09_14-30",
  "url": "/curacion/2026-04-09_14-30"
}
```

También se puede publicar desde un borrador existente:

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/publish" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"draft_id": "00000000-0000-0000-0000-000000000000"}'
```

La edición queda publicada inmediatamente. Navegar a `$DAILY_BRIEF_URL` + el `url` devuelto para verificar.

---

### Crear borrador validado (`POST /api/drafts`)

Guarda una edición como borrador y devuelve una URL de preview HTML. El borrador
solo se crea si la validación no tiene `errors`; los `warnings` no bloquean.

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/drafts" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

**Respuesta (201):**
```json
{
  "success": true,
  "draft": "00000000-0000-0000-0000-000000000000",
  "previewUrl": "/drafts/00000000-0000-0000-0000-000000000000",
  "publish": {
    "method": "POST",
    "path": "/api/publish",
    "body": { "draft_id": "00000000-0000-0000-0000-000000000000" }
  },
  "validation": { "valid": true, "errors": [], "warnings": [], "stats": {} }
}
```

Abrir `$DAILY_BRIEF_URL` + `previewUrl` para revisar visualmente antes de publicar.

---

### Leer borrador raw (`GET /api/drafts/:id`)

```bash
curl "${DAILY_BRIEF_URL:-http://localhost:8391}/api/drafts/00000000-0000-0000-0000-000000000000" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY"
```

Devuelve el markdown del borrador y el resultado de validación actual.

---

### Publicar borrador (`POST /api/drafts/:id/publish`)

```bash
curl -X POST "${DAILY_BRIEF_URL:-http://localhost:8391}/api/drafts/00000000-0000-0000-0000-000000000000/publish" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY"
```

**Respuesta (201):**
```json
{
  "success": true,
  "draft": "00000000-0000-0000-0000-000000000000",
  "edition": "2026-04-09_14-30",
  "url": "/curacion/2026-04-09_14-30",
  "validation": { "valid": true, "errors": [], "warnings": [], "stats": {} }
}
```

---

### Leer markdown raw (`GET /api/curations/:date`)

```bash
curl "${DAILY_BRIEF_URL:-http://localhost:8391}/api/curations/2026-04-09_14-30"
# → { "edition": "2026-04-09_14-30", "content": "---\nimage_url: ...\n---\n..." }
```

Flujo típico para corregir una edición: GET → editar el contenido → PUT.

---

### Reemplazar edición completa (`PUT /api/curations/:date`)

```bash
curl -X PUT "${DAILY_BRIEF_URL:-http://localhost:8391}/api/curations/2026-04-09_14-30" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación-corregida.md
```

> `PUT` solo edita — no crea. Si el ID no existe, responde `404`.
> Antes de sobrescribir, el servidor guarda un snapshot automático en `.versions`.
> El contenido corregido también se valida; si hay `errors`, responde `422`.

---

### Editar solo el frontmatter (`PATCH /api/curations/:date/meta`)

Útil para cambiar la imagen sin tocar el cuerpo markdown:

```bash
curl -X PATCH "${DAILY_BRIEF_URL:-http://localhost:8391}/api/curations/2026-04-09_14-30/meta" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://nueva-imagen.com/foto.jpg"}'
```

- Enviar `null` o `""` en un campo lo **elimina** del frontmatter.
- El cuerpo del markdown queda intacto.
- Antes de modificar el frontmatter, el servidor guarda un snapshot automático en `.versions`.

**Respuesta (200):**
```json
{
  "success": true,
  "edition": "2026-04-09_14-30",
  "meta": { "image_url": "https://nueva-imagen.com/foto.jpg" }
}
```

---

### Listar snapshots de una edición (`GET /api/curations/:date/versions`)

Cada `PUT` y `PATCH /meta` guarda automáticamente la versión anterior. Usar este
endpoint para auditar o recuperar contenido previo.

```bash
curl "${DAILY_BRIEF_URL:-http://localhost:8391}/api/curations/2026-04-09_14-30/versions" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY"
```

**Respuesta (200):**
```json
{
  "edition": "2026-04-09_14-30",
  "versions": [
    {
      "id": "2026-04-23T12-34-56-789Z-put",
      "file": "2026-04-23T12-34-56-789Z-put.md",
      "path": "/api/curations/2026-04-09_14-30/versions/2026-04-23T12-34-56-789Z-put"
    }
  ]
}
```

---

### Leer snapshot raw (`GET /api/curations/:date/versions/:version`)

```bash
curl "${DAILY_BRIEF_URL:-http://localhost:8391}/api/curations/2026-04-09_14-30/versions/2026-04-23T12-34-56-789Z-put" \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY"
```

Devuelve `{ "edition", "version", "content" }`.

---

### Verificar estado del servidor

```bash
curl "${DAILY_BRIEF_URL:-http://localhost:8391}/health"
# {"status":"ok","uptime":...}
```

---

## Manejo de errores

| Código | Causa | Acción |
|--------|-------|--------|
| `401` | API key inválida o ausente | Verificar `DAILY_BRIEF_API_KEY` |
| `400` | Cuerpo malformado, campo faltante o tipo de imagen no permitido | Revisar formato según esta spec |
| `404` | Edición no encontrada (en PUT/PATCH) | Verificar el ID de la edición |
| `422` | Markdown inválido según validación editorial | Revisar `validation.errors`, corregir y reintentar |
| `413` | Imagen mayor a 10 MB | Reducir tamaño antes de subir |
| `503` | `API_KEY` no configurada en el servidor | Contactar al administrador |
| `warning` en respuesta | `image_url` no accesible o no es imagen | No bloquea; la edición se publica igual |

---

## Resumen del flujo recomendado para agentes

1. Redactar markdown completo.
2. `POST /api/validate`.
3. Si hay `errors`, corregir y volver al paso 2.
4. `POST /api/drafts`.
5. Revisar `previewUrl` si hay supervisión humana disponible.
6. `POST /api/drafts/:id/publish`.
7. Abrir la URL publicada y verificar render final.
