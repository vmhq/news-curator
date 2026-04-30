const counters = {
  totalRequests: 0,
  searches: 0,
  publishes: 0,
  draftCreates: 0,
  draftPublishes: 0,
  uploads: 0,
  updates: 0,
  rateLimited: 0,
};

const latencyStats = {
  count: 0,
  sum: 0,
  min: Infinity,
  max: 0,
  samples: [] as number[],
  maxSamples: 1000,
};

function calculatePercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function recordRequest(latencyMs?: number) {
  counters.totalRequests++;
  if (latencyMs === undefined) return;
  latencyStats.count++;
  latencyStats.sum += latencyMs;
  if (latencyMs < latencyStats.min) latencyStats.min = latencyMs;
  if (latencyMs > latencyStats.max) latencyStats.max = latencyMs;
  latencyStats.samples.push(latencyMs);
  if (latencyStats.samples.length > latencyStats.maxSamples) {
    latencyStats.samples.shift();
  }
}

export function incrementCounter(counter: keyof typeof counters) {
  counters[counter]++;
}

export function getMetricsSnapshot() {
  const avg = latencyStats.count > 0 ? Math.round(latencyStats.sum / latencyStats.count) : 0;
  return {
    ...counters,
    latency: {
      avgMs: avg,
      minMs: latencyStats.count > 0 ? latencyStats.min : 0,
      maxMs: latencyStats.max,
      p95Ms: calculatePercentile(latencyStats.samples, 95),
      samples: latencyStats.samples.length,
    },
  };
}

export function resetMetrics() {
  for (const key of Object.keys(counters) as Array<keyof typeof counters>) {
    counters[key] = 0;
  }
  latencyStats.count = 0;
  latencyStats.sum = 0;
  latencyStats.min = Infinity;
  latencyStats.max = 0;
  latencyStats.samples = [];
}
