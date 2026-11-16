import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    job: {} as Record<string, unknown>,
    items: [] as Array<Record<string, unknown>>,
  };

  const merge = (target: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as object)) {
        target[key] = Number(target[key] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        target[key] = value;
      }
    }
    return target;
  };

  const prisma = {
    imageRecoveryJob: {
      findUnique: vi.fn(async () => state.job),
      findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
        state.job.status === where.status ? [state.job] : [],
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => merge(state.job, data)),
    },
    imageRecoveryJobItem: {
      findFirst: vi.fn(async ({ where }: { where: { status: string } }) =>
        state.items.find((item) => item.status === where.status) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { status: string } }) =>
        state.items.filter((item) => item.status === where.status),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const item of state.items) {
          if (where.id && item.id !== where.id) continue;
          if (where.jobId && item.jobId !== where.jobId) continue;
          if (where.status && item.status !== where.status) continue;
          merge(item, data);
          count += 1;
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const item = state.items.find((entry) => entry.id === where.id)!;
        return merge(item, data);
      }),
      count: vi.fn(async ({ where }: { where: { status: string } }) =>
        state.items.filter((item) => item.status === where.status).length,
      ),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };

  return { state, prisma };
});

vi.mock("../../src/db.js", () => ({ prisma: h.prisma }));
vi.mock("../../src/services/image-recovery/recovery.service.js", () => ({
  recoverAsset: vi.fn(),
  confirmAsset: vi.fn(),
}));

import { recoverAsset, confirmAsset } from "../../src/services/image-recovery/recovery.service";
import { resumeInterruptedJobs, runJob } from "../../src/services/image-recovery/job.service";

function resetJob(itemCount: number, autoConfirm: boolean) {
  h.state.job = {
    id: "job-1",
    status: "PENDING",
    concurrency: 2,
    autoConfirm,
    adminId: "admin-1",
    total: itemCount,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
  h.state.items = Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${index}`,
    jobId: "job-1",
    assetId: `asset-${index}`,
    label: `Produto ${index}`,
    originalUrl: `https://old.example.com/${index}.jpg`,
    status: "PENDING",
    result: null,
    message: null,
    newUrl: null,
    publicId: null,
    createdAt: new Date(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recoverAsset).mockImplementation(async (assetId: string) => ({
    ok: true,
    message: "ok",
    asset: {
      id: assetId,
      status: "PENDING_CONFIRMATION",
      newUrl: `https://res.cloudinary.com/demo/image/upload/${assetId}.jpg`,
      publicId: `ma-store/recuperadas/${assetId}`,
    },
  }) as never);
  vi.mocked(confirmAsset).mockResolvedValue({ ok: true, message: "confirmado", updatedTarget: true } as never);
});

describe("runJob", () => {
  it("processa em lote e aguarda confirmacao quando autoConfirm=false", async () => {
    resetJob(4, false);

    await runJob("job-1");

    expect(h.state.job.status).toBe("COMPLETED");
    expect(h.state.job.processed).toBe(4);
    expect(h.state.job.succeeded).toBe(4);
    expect(h.state.items.every((item) => item.status === "AWAITING_CONFIRMATION")).toBe(true);
    expect(confirmAsset).not.toHaveBeenCalled();
  });

  it("confirma automaticamente SOMENTE quando o admin marcou a opcao", async () => {
    resetJob(3, true);

    await runJob("job-1");

    expect(confirmAsset).toHaveBeenCalledTimes(3);
    expect(h.state.items.every((item) => item.status === "CONFIRMED")).toBe(true);
    expect(h.state.job.status).toBe("COMPLETED");
  });

  it("conta falhas sem interromper o restante do lote", async () => {
    resetJob(3, false);
    vi.mocked(recoverAsset)
      .mockResolvedValueOnce({
        ok: true,
        message: "ok",
        asset: { id: "a", status: "PENDING_CONFIRMATION", newUrl: "https://cdn/x.jpg", publicId: "x" },
      } as never)
      .mockResolvedValueOnce({ ok: false, message: "404", asset: { id: "b", status: "NOT_FOUND", newUrl: null, publicId: null } } as never)
      .mockResolvedValueOnce({
        ok: true,
        message: "ok",
        asset: { id: "c", status: "PENDING_CONFIRMATION", newUrl: "https://cdn/z.jpg", publicId: "z" },
      } as never);

    await runJob("job-1");

    expect(h.state.job.processed).toBe(3);
    expect(h.state.job.failed).toBe(1);
    expect(h.state.job.succeeded).toBe(2);
    expect(h.state.items.find((item) => item.status === "FAILED")).toBeTruthy();
  });

  it("retoma itens travados em PROCESSING apos um restart", async () => {
    resetJob(2, false);
    h.state.job.status = "RUNNING";
    h.state.items[0]!.status = "PROCESSING";

    const result = await resumeInterruptedJobs();

    expect(result.resumed).toBe(1);
    expect(result.reset).toBe(1);
    await vi.waitFor(() => expect(h.state.job.status).toBe("COMPLETED"));
    expect(recoverAsset).toHaveBeenCalledTimes(2);
    expect(h.state.items.every((item) => item.status === "AWAITING_CONFIRMATION")).toBe(true);
  });

  it("nao reprocessa itens ja concluidos (retomada idempotente)", async () => {
    resetJob(2, false);
    h.state.items[0]!.status = "AWAITING_CONFIRMATION";

    await runJob("job-1");

    expect(recoverAsset).toHaveBeenCalledTimes(1);
    expect(h.state.job.processed).toBe(1);
  });
});
