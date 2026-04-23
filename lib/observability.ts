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

export function recordRequest() {
  counters.totalRequests++;
}

export function incrementCounter(counter: keyof typeof counters) {
  counters[counter]++;
}

export function getMetricsSnapshot() {
  return { ...counters };
}

export function resetMetrics() {
  for (const key of Object.keys(counters) as Array<keyof typeof counters>) {
    counters[key] = 0;
  }
}
