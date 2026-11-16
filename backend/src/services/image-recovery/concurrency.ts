/** Executa tarefas com concorrencia limitada, sem disparar todas de uma vez. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<{ processed: number; stopped: boolean }> {
  const concurrency = Math.max(1, Math.min(16, Math.floor(limit)));
  let cursor = 0;
  let processed = 0;
  let stopped = false;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) {
        stopped = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]!);
      processed += 1;
    }
  });

  await Promise.all(runners);
  return { processed, stopped };
}

/** Divide em lotes (usado para updates em massa no banco). */
export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
