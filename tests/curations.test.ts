import { describe, expect, test } from "bun:test";
import {
  extractFeatured,
  isBlockedResolvedUrl,
  isBlockedUrl,
  isCurationFileId,
  renderCurationContent,
  resolveOgImageCandidate,
  validateCurationContent,
} from "../lib/curations.ts";

const validEdition = `---
image_url: ""
---
# Daily Brief - 23 de abril de 2026

*Generado a las 09:00*

---

## 🔥 Featured Story: OpenAI presenta una mejora importante para agentes

La compañía anunció una nueva capacidad para agentes de IA orientada a flujos de trabajo largos, con mejor seguimiento de tareas, validación de resultados y controles para mantener acciones seguras.

[Leer más](https://example.com/openai-agents)

---

## Inteligencia Artificial

### [Nuevo benchmark mide agentes autónomos](https://example.com/benchmark)

Un grupo de investigadores publicó una evaluación enfocada en tareas de varias horas.

### [Herramientas de desarrollo suman revisión automática](https://example.com/devtools)

Las plataformas de código están agregando revisiones de seguridad y calidad.

### [Modelos pequeños ganan eficiencia](https://example.com/small-models)

Nuevas técnicas reducen latencia sin sacrificar demasiado desempeño.
`;

describe("curation validation", () => {
  test("accepts the expected Daily Brief markdown structure", () => {
    const result = validateCurationContent(validEdition);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.sections).toBe(1);
    expect(result.stats.stories).toBe(3);
  });

  test("rejects content without featured story and article items", () => {
    const result = validateCurationContent("# Daily Brief\n\nTexto suelto sin estructura.");

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("featured_missing");
    expect(result.errors.map((issue) => issue.code)).toContain("sections_missing");
    expect(result.errors.map((issue) => issue.code)).toContain("stories_missing");
  });

  test("flags unsafe markdown links", () => {
    const result = validateCurationContent(`${validEdition}\n[malicioso](javascript:alert(1))`);

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("unsafe_link_protocol");
  });
});

describe("curation rendering", () => {
  test("normalizes featured heading and strips document chrome", async () => {
    const rendered = await renderCurationContent(validEdition);

    expect(rendered.html).not.toContain("<h1>");
    expect(rendered.html).toContain("OpenAI presenta una mejora importante");
    expect(rendered.html).not.toContain("Featured Story:");
  });

  test("extracts the featured story excerpt and first URL", () => {
    const featured = extractFeatured(validEdition);

    expect(featured?.headline).toBe("OpenAI presenta una mejora importante para agentes");
    expect(featured?.firstUrl).toBe("https://example.com/openai-agents");
  });

  test("resolves relative OG image URLs against the source page", () => {
    const image = resolveOgImageCandidate(
      "https://example.com/story",
      '<html><head><meta property="og:image" content="/images/lead.png"></head></html>'
    );

    expect(image).toBe("https://example.com/images/lead.png");
  });
});

describe("security helpers", () => {
  test("accepts only expected curation file IDs", () => {
    expect(isCurationFileId("2026-04-23")).toBe(true);
    expect(isCurationFileId("2026-04-23_09-30")).toBe(true);
    expect(isCurationFileId("../2026-04-23")).toBe(false);
    expect(isCurationFileId("2026-04-23\"><script>")).toBe(false);
  });

  test("blocks local and private literal URLs before fetch", () => {
    expect(isBlockedUrl("http://127.0.0.1:8391")).toBe(true);
    expect(isBlockedUrl("http://10.0.0.5/image.png")).toBe(true);
    expect(isBlockedUrl("file:///etc/passwd")).toBe(true);
    expect(isBlockedUrl("https://example.com/image.png")).toBe(false);
  });

  test("blocks hostnames that resolve to loopback addresses", async () => {
    expect(await isBlockedResolvedUrl("http://localhost:8391/health")).toBe(true);
  });
});
