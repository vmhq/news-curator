export function logEvent(event: string, details: Record<string, unknown> = {}) {
  console.info(
    JSON.stringify({
      level: "info",
      event,
      ts: new Date().toISOString(),
      ...details,
    })
  );
}
