import { Prisma, type PrismaClient } from "@prisma/client";
import {
  createStoreShippingConfig,
  type FreeShippingRule,
  type PriceAdjustment,
  type StorePricingRules,
  type StoreShippingConfig,
  type StoreShippingConfigRepository,
  type StoreShippingProviderSelection,
} from "../../shipping-engine/index.js";

/**
 * Adapter Prisma de `StoreShippingConfigRepository`.
 *
 * Fica FORA do motor (o núcleo continua agnóstico de banco). Persiste a
 * configuração de frete por loja em:
 *  - `store_shipping_configs`      -> configuração geral (origem, preço, frete grátis);
 *  - `shipping_provider_configs`   -> por provedor (habilitado + serviços em `settings`).
 *
 * Segredos NUNCA são gravados aqui: credenciais continuam em env/secret manager.
 */

export type StoreShippingConfigRow = {
  id: string;
  storeId: string;
  originPostalCode: string | null;
  enabledProviders: string[];
  enabledServices: Prisma.JsonValue | null;
  pricing: Prisma.JsonValue | null;
  freeShipping: Prisma.JsonValue | null;
  declaredValueEnabled: boolean;
  presentationOrder: string[];
  active: boolean;
};

export type ShippingProviderConfigRow = {
  id: string;
  storeId: string;
  provider: string;
  enabled: boolean;
  environment: string;
  settings: Prisma.JsonValue | null;
};

type ShippingConfigPrismaClient = Pick<
  PrismaClient,
  "storeShippingConfig" | "shippingProviderConfig" | "$transaction"
>;

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toPriceAdjustment(value: unknown): PriceAdjustment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = record.type === "percent" ? "percent" : record.type === "fixed" ? "fixed" : null;
  const amount = Number(record.value);
  if (!type || !Number.isFinite(amount)) return undefined;
  return { type, value: amount };
}

export function rowPricing(row: StoreShippingConfigRow): StorePricingRules {
  const record = asObject(row.pricing);
  const fee = toPriceAdjustment(record.fee);
  const subsidy = toPriceAdjustment(record.subsidy);
  return { ...(fee ? { fee } : {}), ...(subsidy ? { subsidy } : {}) };
}

export function rowFreeShipping(row: StoreShippingConfigRow): FreeShippingRule {
  const record = asObject(row.freeShipping);
  const services = asStringArray(record.services);
  const regionPrefixes = asStringArray(record.regionPrefixes);
  const minimum = Number(record.minimumOrderValue);
  return {
    enabled: record.enabled === true,
    minimumOrderValue: Number.isFinite(minimum) ? minimum : null,
    ...(services.length > 0 ? { services } : {}),
    ...(regionPrefixes.length > 0 ? { regionPrefixes } : {}),
  };
}

/**
 * Seleção de provedores:
 *  - linhas de `shipping_provider_configs` definem habilitado + serviços;
 *  - `enabledProviders` (allowlist da loja) restringe quando informado.
 */
export function rowProviderSelection(
  row: StoreShippingConfigRow,
  providerRows: readonly ShippingProviderConfigRow[],
): StoreShippingProviderSelection[] {
  const byProvider = new Map(providerRows.map((provider) => [provider.provider, provider]));
  const allowlist = row.enabledProviders.map((provider) => provider.trim()).filter(Boolean);

  if (allowlist.length > 0) {
    return allowlist
      .filter((provider) => byProvider.get(provider)?.enabled !== false)
      .map((provider) => {
        const settings = byProvider.get(provider);
        const services = settings ? asStringArray(asObject(settings.settings).services) : [];
        return { provider, ...(services.length > 0 ? { services } : {}) };
      });
  }

  return providerRows
    .filter((provider) => provider.enabled)
    .map((provider) => {
      const services = asStringArray(asObject(provider.settings).services);
      return { provider: provider.provider, ...(services.length > 0 ? { services } : {}) };
    });
}

/** Converte as linhas do banco para a configuração canônica do motor. */
export function rowToStoreShippingConfig(
  row: StoreShippingConfigRow,
  providerRows: readonly ShippingProviderConfigRow[],
): StoreShippingConfig {
  return createStoreShippingConfig({
    storeId: row.storeId,
    originPostalCode: row.originPostalCode,
    providers: rowProviderSelection(row, providerRows),
    pricing: rowPricing(row),
    freeShipping: rowFreeShipping(row),
    declaredValueEnabled: row.declaredValueEnabled,
    ...(row.presentationOrder.length > 0 ? { presentationOrder: row.presentationOrder } : {}),
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export type ShippingConfigWriteModel = {
  store: {
    originPostalCode: string | null;
    enabledProviders: string[];
    pricing: Prisma.InputJsonValue;
    freeShipping: Prisma.InputJsonValue;
    declaredValueEnabled: boolean;
    presentationOrder: string[];
    active: boolean;
  };
  providers: Array<{ provider: string; services: string[] }>;
};

export function configToWriteModel(config: StoreShippingConfig): ShippingConfigWriteModel {
  return {
    store: {
      originPostalCode: config.originPostalCode,
      enabledProviders: config.providers.map((provider) => provider.provider),
      pricing: toJson(config.pricing),
      freeShipping: toJson(config.freeShipping),
      declaredValueEnabled: config.declaredValueEnabled,
      presentationOrder: config.presentationOrder ?? [],
      active: true,
    },
    providers: config.providers.map((provider) => ({
      provider: provider.provider,
      services: provider.services ?? [],
    })),
  };
}

export class PrismaStoreShippingConfigRepository implements StoreShippingConfigRepository {
  constructor(private readonly prisma: ShippingConfigPrismaClient) {}

  async get(storeId: string): Promise<StoreShippingConfig | null> {
    const normalized = storeId.trim();
    if (!normalized) return null;

    const row = (await this.prisma.storeShippingConfig.findUnique({
      where: { storeId: normalized },
    })) as StoreShippingConfigRow | null;
    if (!row || !row.active) return null;

    const providerRows = (await this.prisma.shippingProviderConfig.findMany({
      where: { storeId: normalized },
    })) as ShippingProviderConfigRow[];

    return rowToStoreShippingConfig(row, providerRows);
  }

  /** Cria ou atualiza a configuração da loja (transacional). */
  async upsert(config: StoreShippingConfig): Promise<StoreShippingConfig> {
    const write = configToWriteModel(config);

    const row = await this.prisma.$transaction(async (tx) => {
      const saved = (await tx.storeShippingConfig.upsert({
        where: { storeId: config.storeId },
        create: { storeId: config.storeId, ...write.store },
        update: write.store,
      })) as StoreShippingConfigRow;

      // Remove provedores que deixaram de estar na configuração desta loja.
      const keep = write.providers.map((provider) => provider.provider);
      await tx.shippingProviderConfig.deleteMany({
        where: keep.length > 0 ? { storeId: config.storeId, provider: { notIn: keep } } : { storeId: config.storeId },
      });

      for (const provider of write.providers) {
        await tx.shippingProviderConfig.upsert({
          where: { storeId_provider: { storeId: config.storeId, provider: provider.provider } },
          create: {
            storeId: config.storeId,
            provider: provider.provider,
            enabled: true,
            settings: { services: provider.services },
          },
          update: { enabled: true, settings: { services: provider.services } },
        });
      }

      return saved;
    });

    const providerRows = (await this.prisma.shippingProviderConfig.findMany({
      where: { storeId: config.storeId },
    })) as ShippingProviderConfigRow[];

    return rowToStoreShippingConfig(row, providerRows);
  }

  /** Ativa/desativa a configuração da loja sem apagar o registro. */
  async setActive(storeId: string, active: boolean): Promise<void> {
    await this.prisma.storeShippingConfig.update({ where: { storeId: storeId.trim() }, data: { active } });
  }
}
