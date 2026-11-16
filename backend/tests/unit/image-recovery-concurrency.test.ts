import { describe, expect, it } from "vitest";
import { chunk, runPool } from "../../src/services/image-recovery/concurrency";

describe("runPool", () => {
  it("respeita o limite de concorrencia e processa todos os itens", async () => {
    let active = 0;
    let maxActive = 0;
    const processed: number[] = [];

    const result = await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(item);
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(processed).toHaveLength(9);
    expect(result.processed).toBe(9);
    expect(result.stopped).toBe(false);
  });

  it("para de puxar novos itens quando shouldStop fica verdadeiro (pausa)", async () => {
    let processed = 0;
    let stop = false;
    const result = await runPool(
      Array.from({ length: 20 }, (_, index) => index),
      2,
      async () => {
        processed += 1;
        if (processed >= 4) stop = true;
      },
      () => stop,
    );

    expect(result.stopped).toBe(true);
    expect(processed).toBeLessThan(20);
  });

  it("lida com lista vazia", async () => {
    const result = await runPool([], 3, async () => undefined);
    expect(result.processed).toBe(0);
  });
});

describe("chunk", () => {
  it("divide em lotes do tamanho pedido", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
