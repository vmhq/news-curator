import { createApp } from "./app.ts";

const port = Number.parseInt(process.env.PORT || "8391", 10);
const app = createApp();

console.log(`Daily Brief corriendo en http://localhost:${port}`);

export { createApp };
export default {
  port,
  fetch: app.fetch,
};
