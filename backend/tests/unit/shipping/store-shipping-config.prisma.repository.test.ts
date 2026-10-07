import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  PrismaStoreShippingConfigRepository,
  rowFreeShipping,
  rowPricing,
  rowToStoreShippingConfig,
  type ShippingProviderConfigRow,
  type StoreShippingConfigRow,
} from "../../../src/modules/shipping/store-shipping-config.prisma.repository.js";
import { createStoreShippingConfig } from "../../../src/shipping-engine/index.js";

type FakeConfigRow = StoreShippingConfigRow & { active: boolean };
type FakeProviderRow = ShippingProviderConfigRow;

/**
 * Client Prisma fake, com a mesma forma das chamadas usadas pelo adapter.
 * Permite testar o mapeamento e o upsert sem PostgreSQL.
 */
class FakePrisma {
  readonly configs = new Map<string, FakeConfigRow>();
  providers: FakeProviderRow[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  storeShippingConfig = {
    findUnique: async ({ where }: { where: { storeId: string } }) => this.configs.get(where.storeId) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { storeId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = this.configs.get(where.storeId);
      if (existing) {
        const merged = { ...existing, ...update } as FakeConfigRow;
        this.configs.set(where.storeId, merged);
        return merged;
      }
      const row = { id: this.nextId("cfg"), active: true, ...create } as FakeConfigRow;
      this.configs.set(where.storeId, row);
      return row;
    },
    update: async ({ where, data }: { where: { storeId: string }; data: { active: boolean } }) => {
      const existing = this.configs.get(where.storeId);
      if (!existing) throw new Error("config não encontrada");
      const merged = { ...existing, active: data.active };
      this.configs.set(where.storeId, merged);
      return merged;
    },
  };

  shippingProviderConfig = {
    findMany: async ({ where }: { where: { storeId: string } }) =>
      this.providers.filter((provider) => provider.storeId === where.storeId),
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { storeId_provider: { storeId: string; provider: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const { storeId, provider } = where.storeId_provider;
      const index = this.providers.findIndex((row) => row.storeId === storeId && row.provider === provider);
      if (index >= 0) {
        const merged = { ...this.providers[index], ...update } as FakeProviderRow;
        this.providers[index] = merged;
        return merged;
      }
      const row = { id: this.nextId("prov"), environment: "production", ...create } as FakeProviderRow;
      this.providers.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: { storeId: string; provider?: { notIn: string[] } } }) => {
      const before = this.providers.length;
      this.providers = this.providers.filter((row) => {
        if (row.storeId !== where.storeId) return true;
        if (!where.provider?.notIn) return false;
        return where.provider.notIn.includes(row.provider);
      });
      return { count: before - this.providers.length };
    },
  };

  async $transaction<T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function repository(): { repo: PrismaStoreShippingConfigRepository; fake: FakePrisma } {
  const fake = new FakePrisma();
  const repo = new PrismaStoreShippingConfigRepository(fake as unknown as PrismaClient);
  return { repo, fake };
}

describe("PrismaStoreShippingConfigRepository", () => {
  it("retorna null quando não existe configuração", async () => {
    const { repo } = repository();
    expect(await repo.get("loja-x")).toBeNull();
  });

  it("faz round-trip de upsert/get (preço, frete grátis e serviços)", async () => {
    const { repo } = repository();
    const saved = await repo.upsert(
      createStoreShippingConfig({
        storeId: "loja-1",
        originPostalCode: "01310100",
        providers: [
          { provider: "correios", services: ["04510", "04014"] },
          { provider: "retirada" },
        ],
        pricing: { fee: { type: "fixed", value: 5 }, subsidy: { type: "percent", value: 10 } },
        freeShipping: { enabled: true, minimumOrderValue: 199.9, regionPrefixes: ["13"] },
      }),
    );

    expect(saved.providers).toHaveLength(2);

    const loaded = await repo.get("loja-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.originPostalCode).toBe("01310100");
    expect(loaded!.pricing.fee).toEqual({ type: "fixed", value: 5 });
    expect(loaded!.pricing.subsidy).toEqual({ type: "percent", value: 10 });
    expect(loaded!.freeShipping).toMatchObject({ enabled: true, minimumOrderValue: 199.9, regionPrefixes: ["13"] });
    expect(loaded!.providers).toEqual([
      { provider: "correios", services: ["04510", "04014"] },
      { provider: "retirada" },
    ]);
  });

  it("atualiza a configuração existente sem duplicar provedores", async () => {
    const { repo, fake } = repository();
    await repo.upsert(createStoreShippingConfig({ storeId: "loja-1", providers: [{ provider: "correios" }] }));
    await repo.upsert(
      createStoreShippingConfig({
        storeId: "loja-1",
        providers: [{ provider: "correios", services: ["04014"] }],
      }),
    );

    expect(fake.providers.filter((row) => row.storeId === "loja-1")).toHaveLength(1);
    const loaded = await repo.get("loja-1");
    expect(loaded!.providers).toEqual([{ provider: "correios", services: ["04014"] }]);
  });

  it("remove provedores que saíram da configuração", async () => {
    const { repo, fake } = repository();
    await repo.upsert(
      createStoreShippingConfig({
        storeId: "loja-1",
        providers: [{ provider: "correios" }, { provider: "jadlog" }],
      }),
    );
    await repo.upsert(createStoreShippingConfig({ storeId: "loja-1", providers: [{ provider: "correios" }] }));

    expect(fake.providers.map((row) => row.provider)).toEqual(["correios"]);
  });

  it("respeita a allowlist e ignora provedor desabilitado", async () => {
    const { repo, fake } = repository();
    await repo.upsert(
      createStoreShippingConfig({
        storeId: "loja-1",
        providers: [{ provider: "correios" }, { provider: "jadlog" }],
      }),
    );
    // Desabilita jadlog diretamente na tabela de provedores.
    fake.providers = fake.providers.map((row) =>
      row.provider === "jadlog" ? { ...row, enabled: false } : row,
    );

    const loaded = await repo.get("loja-1");
    expect(loaded!.providers).toEqual([{ provider: "correios" }]);
  });

  it("ignora configuração inativa", async () => {
    const { repo } = repository();
    await repo.upsert(createStoreShippingConfig({ storeId: "loja-1", providers: [{ provider: "correios" }] }));
    await repo.setActive("loja-1", false);
    expect(await repo.get("loja-1")).toBeNull();
  });
});

describe("mapeamento de linhas", () => {
  it("tolera JSON malformado e aplica defaults seguros", () => {
    const row = {
      id: "c1",
      storeId: "loja-1",
      originPostalCode: null,
      enabledProviders: [],
      enabledServices: null,
      pricing: "valor-invalido",
      freeShipping: { enabled: "sim", minimumOrderValue: "abc" },
      declaredValueEnabled: true,
      presentationOrder: [],
      active: true,
    } as unknown as StoreShippingConfigRow;

    expect(rowPricing(row)).toEqual({});
    expect(rowFreeShipping(row)).toEqual({ enabled: false, minimumOrderValue: null });
    const config = rowToStoreShippingConfig(row, []);
    expect(config.providers).toEqual([]);
    expect(config.pricing).toEqual({});
    expect(config.freeShipping.enabled).toBe(false);
  });

  it("usa a allowlist da loja quando não há linhas de provedor", () => {
    const row = {
      id: "c1",
      storeId: "loja-1",
      originPostalCode: "01310100",
      enabledProviders: ["correios", "retirada"],
      enabledServices: null,
      pricing: null,
      freeShipping: null,
      declaredValueEnabled: true,
      presentationOrder: ["correios"],
      active: true,
    } as StoreShippingConfigRow;

    const config = rowToStoreShippingConfig(row, []);
    expect(config.providers).toEqual([{ provider: "correios" }, { provider: "retirada" }]);
    expect(config.presentationOrder).toEqual(["correios"]);
  });
});
