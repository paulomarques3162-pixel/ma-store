import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheStats, cachedJson, invalidateCache, resetCacheForTests } from "../../src/lib/cache.js";

describe("cache de leituras públicas", () => {
  beforeEach(() => resetCacheForTests());

  it("executa o loader uma vez e reaproveita o valor", async () => {
    const loader = vi.fn(async () => JSON.stringify({ n: 1 }));

    const first = await cachedJson("catalog:products", 60_000, loader);
    const second = await cachedJson("catalog:products", 60_000, loader);

    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("deduplica requisições concorrentes (singleflight)", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return JSON.stringify({ calls });
    };

    const results = await Promise.all([
      cachedJson("catalog:facets", 60_000, loader),
      cachedJson("catalog:facets", 60_000, loader),
      cachedJson("catalog:facets", 60_000, loader),
    ]);

    expect(calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it("respeita o TTL e recarrega depois de expirar", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const loader = async () => JSON.stringify({ calls: ++calls });

      await cachedJson("catalog:product:x", 1_000, loader);
      vi.advanceTimersByTime(500);
      await cachedJson("catalog:product:x", 1_000, loader);
      expect(calls).toBe(1);

      vi.advanceTimersByTime(600);
      await cachedJson("catalog:product:x", 1_000, loader);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalida por prefixo sem apagar outras chaves", async () => {
    await cachedJson("catalog:products:a", 60_000, async () => "a");
    await cachedJson("other:key", 60_000, async () => "b");
    invalidateCache("catalog:");

    expect(cacheStats().entries).toBe(1);
  });
});
