/**
 * Implementacao Prisma do repositorio do Shipping Engine proprio.
 * A fonte oficial dos dados e SEMPRE o PostgreSQL (nunca arquivo local).
 */
import { prisma } from "../../db.js";
import { decimalToNumber } from "../../lib/serialize.js";
import type {
  CreateQuoteInput,
  LocalShippingRepository,
  ProductLogistics,
  ShippingCepExceptionRecord,
  ShippingMethodRecord,
  ShippingSettingsRecord,
  ShippingWeightRuleRecord,
  ShippingZoneRecord,
} from "../domain/types.js";

export const DEFAULT_SETTINGS: ShippingSettingsRecord = {
  enabled: false,
  originZipCode: null,
  packagePaddingGrams: null,
  defaultHandlingDays: null,
  defaultDeliveryDays: null,
  freeShippingEnabled: false,
  freeShippingMinimumOrderValue: null,
  showEstimateDisclaimer: true,
  configVersion: 1,
};

export class PrismaLocalShippingRepository implements LocalShippingRepository {
  async getSettings(): Promise<ShippingSettingsRecord> {
    const row = await prisma.shippingSettings.findUnique({ where: { id: "default" } });
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      enabled: row.enabled,
      originZipCode: row.originZipCode,
      packagePaddingGrams: row.packagePaddingGrams,
      defaultHandlingDays: row.defaultHandlingDays,
      defaultDeliveryDays: row.defaultDeliveryDays,
      freeShippingEnabled: row.freeShippingEnabled,
      freeShippingMinimumOrderValue:
        row.freeShippingMinimumOrderValue === null ? null : decimalToNumber(row.freeShippingMinimumOrderValue),
      showEstimateDisclaimer: row.showEstimateDisclaimer,
      configVersion: row.configVersion,
    };
  }

  async countActiveZones(): Promise<number> {
    return prisma.shippingZone.count({ where: { active: true } });
  }

  async findActiveZonesByZip(zipCodeInt: number): Promise<ShippingZoneRecord[]> {
    const rows = await prisma.shippingZone.findMany({
      where: { active: true, zipCodeFrom: { lte: zipCodeInt }, zipCodeTo: { gte: zipCodeInt } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      state: row.state,
      zipCodeFrom: row.zipCodeFrom,
      zipCodeTo: row.zipCodeTo,
      active: row.active,
      priority: row.priority,
    }));
  }

  async findWeightRules(zoneId: string): Promise<ShippingWeightRuleRecord[]> {
    const rows = await prisma.shippingWeightRule.findMany({ where: { zoneId, active: true } });
    return rows.map((row) => ({
      id: row.id,
      zoneId: row.zoneId,
      shippingMethodId: row.shippingMethodId,
      minWeightGrams: row.minWeightGrams,
      maxWeightGrams: row.maxWeightGrams,
      price: decimalToNumber(row.price),
      deliveryDays: row.deliveryDays,
      estimatedMinBusinessDays: row.estimatedMinBusinessDays,
      estimatedMaxBusinessDays: row.estimatedMaxBusinessDays,
      active: row.active,
      priority: row.priority,
    }));
  }

  async findActiveMethods(): Promise<ShippingMethodRecord[]> {
    const rows = await prisma.shippingMethod.findMany({ where: { active: true } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      active: row.active,
      priority: row.priority,
      position: row.position,
    }));
  }

  async findCepExceptions(cep: string): Promise<ShippingCepExceptionRecord[]> {
    const rows = await prisma.shippingCepException.findMany({ where: { cep, active: true } });
    return rows.map((row) => ({
      id: row.id,
      cep: row.cep,
      shippingMethodId: row.shippingMethodId,
      priceOverride: row.priceOverride === null ? null : decimalToNumber(row.priceOverride),
      deliveryDaysOverride: row.deliveryDaysOverride,
      active: row.active,
    }));
  }

  async findProducts(ids: string[]): Promise<ProductLogistics[]> {
    const rows = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        active: true,
        price: true,
        weightGrams: true,
        heightCm: true,
        widthCm: true,
        lengthCm: true,
        hasShipping: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      price: decimalToNumber(row.price),
      weightGrams: row.weightGrams,
      heightCm: row.heightCm,
      widthCm: row.widthCm,
      lengthCm: row.lengthCm,
      hasShipping: row.hasShipping,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async createQuote(input: CreateQuoteInput): Promise<{ quoteId: string; expiresAt: string }> {
    const quote = await prisma.shippingQuote.create({
      data: {
        sessionId: input.sessionId,
        cep: input.cep,
        subtotal: input.subtotal.toFixed(2),
        totalWeightGrams: input.totalWeightGrams,
        zoneId: input.zoneId,
        expiresAt: input.expiresAt,
        options: {
          create: input.options.map((option) => ({
            shippingMethodId: option.methodId,
            code: option.code,
            name: option.name,
            description: option.description,
            price: option.price.toFixed(2),
            deliveryDays: option.deliveryDays,
            zoneId: option.zoneId,
            ruleId: option.ruleId,
          })),
        },
      },
      select: { id: true, expiresAt: true },
    });
    return { quoteId: quote.id, expiresAt: quote.expiresAt.toISOString() };
  }
}
