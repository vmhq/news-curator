# Especificación de Curación — Daily Brief

Instrucciones para el agente AI que genera y publica ediciones en Daily Brief.

---

## Cómo publicar

Enviar un `POST /api/publish` con el contenido del archivo markdown:

```bash
curl -X POST https://dailyb.vmhq.cl/api/publish \
  -H "X-Api-Key: TU_API_KEY" \
  -H "Content-Type: text/markdown" \
  --data-binary @curación.md
```

La respuesta devuelve la URL de la edición publicada:
```json
{ "success": true, "edition": "2026-04-09_14-30", "url": "/curacion/2026-04-09_14-30" }
```

---

## Estructura del archivo markdown

### Reglas generales

- El archivo se procesa y muestra tal como está — la calidad del texto impacta directamente en el sitio.
- Cada sección de noticias va separada por `---`.
- Los artículos individuales van como `### [Titular](URL)`.
- Los titulares deben ser en español, claros y directos.
- El primer `### ` o `## ` que aparezca en el archivo se usa como título corto en el sidebar — que sea descriptivo.

---

### Formato completo

```markdown
---
image_url: https://ejemplo.com/imagen-portada.jpg
---
# Curación diaria — [fecha en español, ej: "Miércoles 9 de abril de 2026"]
*Generado el [fecha y hora completa]*
---

## 🔥 Featured Story: [TITULAR DE LA NOTICIA PRINCIPAL]

[Primer párrafo: 2–4 oraciones describiendo la noticia. Incluir aquí el enlace principal: [texto del enlace](https://url-del-artículo.com).]

[Párrafo adicional opcional con más contexto o datos relevantes.]

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

- **[Nombre corto](https://url.com)** — una frase explicando qué es y por qué vale la pena.
- **[Nombre corto](https://url.com)** — una frase.
- **[Nombre corto](https://url.com)** — una frase.
```

---

## Cada sección explicada

### Frontmatter (requerido si hay imagen de portada)

```
---
image_url: https://ejemplo.com/imagen.jpg
---
```

- Es la imagen que aparece en el hero de la página y en el OG tag al compartir.
- Usar una imagen representativa de la noticia principal (1200×630px ideal).
- Si no hay una buena imagen disponible, omitir el bloque `---` completo — el servidor buscará automáticamente en la URL de la Featured Story.

---

### Título e identificación

```markdown
# Curación diaria — Miércoles 9 de abril de 2026
*Generado el miércoles 9 de abril de 2026 a las 14:30*
```

- El `# Título` es eliminado por el servidor antes de renderizar — sirve solo como referencia.
- La línea `*Generado ...*` también se elimina — sirve como metadata interna.

---

### Featured Story (requerido)

```markdown
## 🔥 Featured Story: OpenAI lanza GPT-5 con capacidades multimodales avanzadas

El nuevo modelo de OpenAI supera en benchmarks a todos sus competidores actuales.
[Leer artículo completo](https://example.com/openai-gpt5).

La compañía afirma que GPT-5 puede procesar hasta 1 millón de tokens de contexto y
genera código funcional con una tasa de error inferior al 2%.
```

**Reglas importantes:**
- El emoji `🔥` y el texto `Featured Story:` deben aparecer exactamente así.
- El titular va en la misma línea que `## 🔥 Featured Story:`.
- Debe haber una **línea en blanco** entre el titular y el cuerpo.
- El **primer párrafo** (hasta el primer doble salto de línea) es el extracto que aparece en el hero — debe ser autónomo y atractivo (máx. ~280 caracteres).
- La **primera URL** en el cuerpo se usa para intentar obtener la imagen de portada si no hay `image_url` en el frontmatter.
- La sección termina en `---` o en el siguiente `## ` que no sea Featured Story.

---

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
- El `### Titular` debe ir con URL entre paréntesis directamente.
- El resumen va en las líneas siguientes, sin bullet point, en prosa.
- Separar secciones con `---`.

---

### Quick Links (requerido, al final)

```markdown
## 🔗 Quick Links

- **[The Pragmatic Engineer: AI in 2026](https://example.com)** — análisis profundo del mercado laboral tech.
- **[Hacker News top thread hoy](https://example.com)** — debate sobre el futuro de los LLMs open source.
- **[Paper: Scaling Laws revisited](https://arxiv.org/...)** — investigadores de Stanford cuestionan los supuestos de escalado.
- **[Tool: Cursor 2.0 changelog](https://example.com)** — novedades del IDE de IA más popular entre devs.
- **[Video: Entrevista a Sam Altman](https://youtube.com/...)** — 45 min sobre AGI y regulación.
```

**Reglas:**
- Entre 4 y 8 links.
- El nombre del link en **negrita** dentro del enlace markdown.
- Después del enlace, `—` (em dash) seguido de una frase corta explicando el valor.
- Mix de: papers, threads, herramientas, videos, posts largos, recursos.
- Son distintos a los artículos de las secciones — aquí van cosas más nicho, técnicas o complementarias.

---

## Ejemplo completo mínimo válido

```markdown
---
image_url: https://images.example.com/ai-chip.jpg
---
# Curación diaria — Miércoles 9 de abril de 2026
*Generado el miércoles 9 de abril de 2026 a las 14:30*
---

## 🔥 Featured Story: TSMC anuncia chip de 1nm para 2027 en alianza con Apple y NVIDIA

La compañía taiwanesa presentó hoy su hoja de ruta para el proceso de fabricación N1,
prometiendo un salto del 40% en eficiencia energética. [Más detalles aquí](https://example.com/tsmc-1nm).

El anuncio coincide con la aprobación de subsidios del gobierno de EE.UU. por 15.000
millones de dólares para la planta de Arizona que entra en operación en 2026.

---

## Inteligencia Artificial

### Los modelos de lenguaje aprenden a mentir menos con nueva técnica de RLHF](https://example.com)
Investigadores de UC Berkeley publican un método que reduce alucinaciones en un 60%.
El paper está disponible en arXiv y ya tiene más de 200 citas en una semana.

### Mistral lanza modelo de 7B parámetros que supera a Llama 3](https://example.com)
Disponible bajo licencia Apache 2.0, el modelo destaca en tareas de código y razonamiento
lógico con un contexto de 128K tokens.

---

## Tecnología y Startups

### Stripe alcanza valoración de 100.000 millones tras ronda Serie I](https://example.com)
La fintech vuelve a ser la startup privada más valiosa del mundo. La ronda estuvo liderada
por Sequoia y fondos soberanos de Medio Oriente.

---

## 🔗 Quick Links

- **[Paper: Attention is all you need, 7 años después](https://arxiv.org/example)** — reflexión sobre el impacto del transformer.
- **[Thread: Por qué los RAG systems siguen fallando](https://example.com)** — análisis técnico honesto de un eng de Cohere.
- **[Tool: uv 0.5 — el pip killer ya es production-ready](https://example.com)** — gestor de paquetes Python 10x más rápido.
- **[Video: Lex Fridman entrevista a Yann LeCun](https://youtube.com/example)** — 3 horas sobre el futuro del deep learning.
```

---

## Errores comunes a evitar

| ❌ Incorrecto | ✅ Correcto |
|---|---|
| `## 🔥Featured Story: ...` | `## 🔥 Featured Story: ...` (espacio después del emoji) |
| Sin línea en blanco entre titular y cuerpo de la Featured | Siempre línea en blanco entre `## 🔥 ...` y el texto |
| `### Titular` sin URL | `### [Titular](https://url.com)` |
| Quick Links sin em dash | `- **[Link](url)** — descripción` |
| Secciones sin `---` entre ellas | Siempre `---` entre secciones |
| `image_url` apuntando a un logo o favicon | Imagen editorial de la noticia, mínimo ~600px de ancho |
