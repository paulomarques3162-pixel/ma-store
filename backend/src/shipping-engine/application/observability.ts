/**
 * Observabilidade do motor. Só métricas — nunca tokens, headers ou payloads.
 */
export type ShippingMetric = {
  provider: string;
  service?: string;
  success: boolean;
  durationMs: number;
  errorType?: string;
  statusCode?: number;
  cacheHit?: boolean;
  totalLatencyMs?: number;
  timestamp: string;
};

export interface ShippingMetricsSink {
  record(metric: ShippingMetric): void;
}

export type ShippingMetricsSnapshot = {
  total: number;
  success: number;
  failure: number;
  cacheHits: number;
  cacheMisses: number;
  avgDurationMs: number;
  byProvider: Record<string, { total: number; success: number; failure: number; avgDurationMs: number }>;
  lastError?: { provider: string; errorType: string; timestamp: string };
};

export class InMemoryShippingMetrics implements ShippingMetricsSink {
  private readonly metrics: ShippingMetric[] = [];

  constructor(private readonly maxEntries = 500) {}

  record(metric: ShippingMetric): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxEntries) this.metrics.splice(0, this.metrics.length - this.maxEntries);
  }

  snapshot(): ShippingMetricsSnapshot {
    const byProvider: ShippingMetricsSnapshot["byProvider"] = {};
    let success = 0;
    let failure = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let durationSum = 0;
    let lastError: ShippingMetricsSnapshot["lastError"];

    for (const metric of this.metrics) {
      if (metric.success) success += 1;
      else failure += 1;
      if (metric.cacheHit === true) cacheHits += 1;
      if (metric.cacheHit === false) cacheMisses += 1;
      durationSum += metric.durationMs;

      const entry = byProvider[metric.provider] ?? { total: 0, success: 0, failure: 0, avgDurationMs: 0 };
      entry.total += 1;
      if (metric.success) entry.success += 1;
      else {
        entry.failure += 1;
        if (metric.errorType) lastError = { provider: metric.provider, errorType: metric.errorType, timestamp: metric.timestamp };
      }
      entry.avgDurationMs = Math.round(
        (entry.avgDurationMs * (entry.total - 1) + metric.durationMs) / entry.total,
      );
      byProvider[metric.provider] = entry;
    }

    return {
      total: this.metrics.length,
      success,
      failure,
      cacheHits,
      cacheMisses,
      avgDurationMs: this.metrics.length > 0 ? Math.round(durationSum / this.metrics.length) : 0,
      byProvider,
      ...(lastError ? { lastError } : {}),
    };
  }
}

/** Sink inerte (produção sem coletor configurado). */
export class NullShippingMetrics implements ShippingMetricsSink {
  record(): void {
    /* no-op */
  }
}
