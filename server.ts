import { createApp } from "./app.ts";
import { stopDirWatcher } from "./lib/curations.ts";

const port = Number.parseInt(process.env.PORT || "8391", 10);
const app = createApp();

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Daily Brief corriendo en http://localhost:${port}`);

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  stopDirWatcher();
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { createApp };
