# Skill: Publicar curación de noticias en Daily Brief

Genera y publica una nueva edición de Daily Brief. Cubre las noticias más
relevantes del día en tecnología e inteligencia artificial.

---

## Proceso

1. **Recopilar** noticias relevantes publicadas hoy (o las últimas 24h).
2. **Seleccionar** la noticia principal (Featured Story) — la más impactante del día.
3. **Organizar** el resto en secciones temáticas.
4. **Añadir** Quick Links con recursos complementarios.
5. **Publicar** via `POST /api/publish`.

---

## Categorías objetivo

Cubrir al menos 3 de estas áreas por edición:

- **Inteligencia Artificial** — modelos, papers, benchmarks, lanzamientos
- **Tecnología** — productos, plataformas, infraestructura
- **Startups y Negocios** — rondas, adquisiciones, estrategia
- **Seguridad** — vulnerabilidades, ataques, defensas
- **Herramientas para Devs** — librerías, IDEs, CLIs, frameworks
- **Hardware** — chips, dispositivos, manufactura
- **Ciencia y Research** — papers destacados, descubrimientos

---

## Formato del archivo markdown

```
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

## [Sección 1]

### [Titular del artículo](https://url.com)
Resumen de 2–3 oraciones. Contexto, impacto, por qué importa.

### [Titular del artículo](https://url.com)
Resumen de 2–3 oraciones.

---

## [Sección 2]

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

## Reglas críticas de formato

| Elemento | Regla |
|----------|-------|
| `## 🔥` | El emoji `🔥` es **obligatorio** — es lo que dispara el hero/banner. Cualquier otro emoji (⭐, etc.) no genera hero. |
| `Featured Story:` | Convencional pero **opcional**. El parser acepta `## 🔥 TITULAR` directamente. |
| Cuerpo de Featured | **Línea en blanco obligatoria** entre el `## 🔥 ...` y el primer párrafo. |
| Primera URL en Featured | Usada para extraer imagen si no hay `image_url`. Siempre incluirla. |
| Artículos de sección | `### [Titular](url)` — el link va en el propio titular, no separado. |
| Separadores | `---` entre cada sección, incluyendo después del bloque intro. |
| Quick Links | `**[Nombre](url)** — descripción` — negrita en el nombre, em dash antes de la descripción. |
| Cantidad de Quick Links | Entre 4 y 8 items. |
| image_url | Imagen editorial representativa (~1200×630px). **No logos, no favicons.** |

---

## Publicar nueva edición

```bash
curl -X POST http://localhost:8391/api/publish \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

También aceptado como JSON:

```bash
curl -X POST http://localhost:8391/api/publish \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$(cat curación.md | jq -Rs .)\"}"
```

**Respuesta exitosa (201):**
```json
{
  "success": true,
  "edition": "2026-04-09_14-30",
  "url": "/curacion/2026-04-09_14-30"
}
```

La edición queda publicada inmediatamente en http://localhost:8391.

---

## Leer markdown raw de una edición

```bash
curl http://localhost:8391/api/curations/2026-04-09_14-30
# → { "edition": "2026-04-09_14-30", "content": "---\nimage_url: ...\n---\n..." }
```

Flujo típico para corregir una edición: GET → editar el campo → PUT.

---

## Editar edición completa (PUT)

```bash
curl -X PUT http://localhost:8391/api/curations/2026-04-09_14-30 \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación-corregida.md
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "edition": "2026-04-09_14-30",
  "url": "/curacion/2026-04-09_14-30"
}
```

Si `image_url` en el frontmatter no es accesible o no devuelve `image/*`, la respuesta incluye un campo `warning` (no bloquea el guardado).

> `PUT` solo edita — no crea. Si el ID no existe, responde `404`.

---

## Editar solo el frontmatter (PATCH meta)

Útil para cambiar la imagen, sin tocar el cuerpo markdown:

```bash
curl -X PATCH http://localhost:8391/api/curations/2026-04-09_14-30/meta \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://nueva-imagen.com/foto.jpg"}'
```

- Enviar `null` o `""` en un campo lo **elimina** del frontmatter.
- El cuerpo del markdown queda intacto.

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "edition": "2026-04-09_14-30",
  "meta": { "image_url": "https://nueva-imagen.com/foto.jpg" }
}
```

---

## Verificar

```bash
curl http://localhost:8391/health
# {"status":"ok","uptime":...}
```

Navegar a la URL devuelta en la respuesta para confirmar que la edición
se renderiza correctamente con hero, secciones y Quick Links.
