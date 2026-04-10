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
| `## 🔥 Featured Story:` | Espacio entre emoji y texto. El titular va en la misma línea. |
| Cuerpo de Featured | **Línea en blanco obligatoria** entre el `## 🔥` y el primer párrafo. |
| Primera URL en Featured | Usada para extraer imagen si no hay `image_url`. Siempre incluirla. |
| Artículos de sección | `### [Titular](url)` — el link va en el propio titular, no separado. |
| Separadores | `---` entre cada sección, incluyendo después del bloque intro. |
| Quick Links | `**[Nombre](url)** — descripción` — negrita en el nombre, em dash antes de la descripción. |
| Cantidad de Quick Links | Entre 4 y 8 items. |
| image_url | Imagen editorial representativa (~1200×630px). **No logos, no favicons.** |

---

## Publicar

```bash
curl -X POST https://dailyb.vmhq.cl/api/publish \
  -H "X-Api-Key: $DAILY_BRIEF_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

También aceptado como JSON:

```bash
curl -X POST https://dailyb.vmhq.cl/api/publish \
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

La edición queda publicada inmediatamente en https://dailyb.vmhq.cl.

---

## Verificar

```bash
curl https://dailyb.vmhq.cl/health
# {"status":"ok","uptime":...}
```

Navegar a la URL devuelta en la respuesta para confirmar que la edición
se renderiza correctamente con hero, secciones y Quick Links.
