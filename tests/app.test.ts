import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "../app.ts";
import { resetMetrics } from "../lib/observability.ts";

const validEdition = `---
image_url: ""
---
# Daily Brief - 23 de abril de 2026

*Generado a las 09:00*

---

## Noticia principal: OpenAI presenta una mejora importante para agentes

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

describe("app integration", () => {
  let rootDir: string;
  let curationsDir: string;
  let uploadsDir: string;
  let draftsDir: string;
  let versionsDir: string;

  beforeEach(async () => {
    resetMetrics();
    rootDir = await mkdtemp(join(tmpdir(), "news-curator-"));
    curationsDir = join(rootDir, "curations");
    uploadsDir = join(rootDir, "uploads");
    draftsDir = join(rootDir, "drafts");
    versionsDir = join(rootDir, "versions");

    await mkdir(curationsDir, { recursive: true });
    await writeFile(join(curationsDir, "2026-04-23.md"), validEdition, "utf-8");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp({
      apiKey: "secret-key",
      curationsDir,
      uploadsDir,
      draftsDir,
      versionsDir,
      siteUrl: "http://localhost:8391",
      enableWatcher: false,
      draftTtlHours: 1,
      maxVersionsPerEdition: 2,
      rateLimits: {
        search: { limit: 2, windowMs: 60_000 },
      },
    });
  }

  test("reports operational health and readiness", async () => {
    const app = buildApp();

    const health = await app.request("/health");
    const ready = await app.request("/ready");

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);

    const healthJson = await health.json();
    const readyJson = await ready.json();

    expect(healthJson.status).toBe("ok");
    expect(healthJson.files.total).toBe(1);
    expect(healthJson.config).toBeUndefined();
    expect(readyJson.status).toBe("ready");

    const internalHealth = await app.request("/health/internal", {
      headers: { "X-Api-Key": "secret-key" },
    });
    expect(internalHealth.status).toBe(200);
    const internalJson = await internalHealth.json();
    expect(internalJson.config.apiKeyConfigured).toBe(true);
  });

  test("redirects preview bots and /latest to the most recent edition URL", async () => {
    await writeFile(
      join(curationsDir, "2026-04-23_15-06.md"),
      validEdition.replace("09:00", "15:06"),
      "utf-8"
    );

    const app = buildApp();

    const latest = await app.request("/latest", { redirect: "manual" });
    expect(latest.status).toBe(302);
    expect(latest.headers.get("location")).toBe("/curacion/2026-04-23_15-06");
    expect(latest.headers.get("cache-control")).toBe("no-store");

    const preview = await app.request("/", {
      headers: { "user-agent": "TelegramBot (like TwitterBot)" },
      redirect: "manual",
    });
    expect(preview.status).toBe(302);
    expect(preview.headers.get("location")).toBe("/curacion/2026-04-23_15-06");
    expect(preview.headers.get("cache-control")).toBe("no-store");
  });

  test("returns ETag and supports conditional requests for public edition API", async () => {
    const app = buildApp();

    const first = await app.request("/api/curations/2026-04-23");
    expect(first.status).toBe(200);

    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await app.request("/api/curations/2026-04-23", {
      headers: { "If-None-Match": etag! },
    });
    expect(second.status).toBe(304);
  });

  test("rate limits repeated searches", async () => {
    const app = buildApp();

    expect((await app.request("/api/search?q=openai")).status).toBe(200);
    expect((await app.request("/api/search?q=openai")).status).toBe(200);
    expect((await app.request("/api/search?q=openai")).status).toBe(429);
  });

  test("keeps only the recent draft and cleans expired ones", async () => {
    const oldDraftId = "11111111-1111-1111-1111-111111111111";
    await mkdir(draftsDir, { recursive: true });
    const oldDraftPath = join(draftsDir, `${oldDraftId}.md`);
    await writeFile(oldDraftPath, validEdition, "utf-8");
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(oldDraftPath, oldDate, oldDate);

    const app = buildApp();
    const response = await app.request("/api/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": "secret-key",
      },
      body: JSON.stringify({ content: validEdition }),
    });

    expect(response.status).toBe(201);
    expect(existsSync(oldDraftPath)).toBe(false);

    const recent = await app.request("/api/drafts/recent", {
      headers: { "X-Api-Key": "secret-key" },
    });
    expect(recent.status).toBe(200);

    const recentJson = await recent.json();
    expect(recentJson.draft).toBeTruthy();
    expect(recentJson.previewUrl).toContain("/drafts/");
  });

  test("stores bounded version history and exposes diff with the latest snapshot", async () => {
    const app = buildApp();
    const headers = {
      "Content-Type": "application/json",
      "X-Api-Key": "secret-key",
    };

    const updatedOne = validEdition.replace("mejora importante", "mejora operacional");
    const updatedTwo = updatedOne.replace("flujos de trabajo largos", "flujos de trabajo extensos");
    const updatedThree = updatedTwo.replace("Nuevas técnicas", "Nuevos enfoques");

    expect(
      (await app.request("/api/curations/2026-04-23", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: updatedOne }),
      })).status
    ).toBe(200);

    expect(
      (await app.request("/api/curations/2026-04-23", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: updatedTwo }),
      })).status
    ).toBe(200);

    expect(
      (await app.request("/api/curations/2026-04-23", {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: updatedThree }),
      })).status
    ).toBe(200);

    const versionFiles = await readdir(join(versionsDir, "2026-04-23"));
    expect(versionFiles.filter((file) => file.endsWith(".md")).length).toBeLessThanOrEqual(2);

    const diff = await app.request("/api/curations/2026-04-23/diff/latest", {
      headers: { "X-Api-Key": "secret-key" },
    });
    expect(diff.status).toBe(200);

    const diffJson = await diff.json();
    expect(diffJson.diff).toContain("+Nuevos enfoques");
    expect(diffJson.diff).toContain("-Nuevas técnicas");
  });
});
