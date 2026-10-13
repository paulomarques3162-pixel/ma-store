/**
 * Persistência Prisma da tabela nacional de frete.
 *
 * Fica separado do instalador puro (`install.service.ts`) para que scripts
 * (seed de produção, instalação manual) possam usar o próprio `PrismaClient`
 * sem depender de `src/db.ts`/validação de ambiente da aplicação.
 */
import type { PrismaClient } from "@prisma/client";
import { NATIONAL_TABLE_META } from "./national-table.js";
import {
  installNationalTableWithStore,
  type InstallNationalTableOptions,
  type InstallNationalTableResult,
  type NationalTableStore,
} from "./install.service.js";

/** Store real, ligado a um `PrismaClient` específico. */
export function createPrismaNationalTableStore(client: PrismaClient): NationalTableStore {
  return {
    async countCustomZones() {
      return client.shippingZone.count({ where: { seedKey: null } });
    },
    async hasSettings() {
      return (await client.shippingSettings.count({ where: { id: "default" } })) > 0;
    },
    async createSettings() {
      await client.shippingSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          enabled: true,
          originZipCode: NATIONAL_TABLE_META.provisionalOriginZipCode,
          originZipCodeProvisional: true,
          packagePaddingGrams: NATIONAL_TABLE_META.packagePaddingGrams,
          defaultHandlingDays: NATIONAL_TABLE_META.defaultHandlingDays,
          defaultDeliveryDays: null,
          freeShippingEnabled: NATIONAL_TABLE_META.freeShippingEnabled,
          freeShippingMinimumOrderValue: NATIONAL_TABLE_META.freeShippingMinimumOrderValue.toFixed(2),
          showEstimateDisclaimer: NATIONAL_TABLE_META.showEstimateDisclaimer,
        },
        // Nunca sobrescreve: se a linha apareceu em paralelo, mantém a existente.
        update: {},
      });
    },
    async findMethodIdByCode(code) {
      const row = await client.shippingMethod.findUnique({ where: { code }, select: { id: true } });
      return row?.id ?? null;
    },
    async createMethod(input) {
      const row = await client.shippingMethod.create({
        data: {
          name: input.name,
          code: input.code,
          description: input.description,
          price: "0.00",
          active: true,
          priority: input.priority,
          position: input.position,
        },
        select: { id: true },
      });
      return row.id;
    },
    async findZoneIdBySeedKey(seedKey) {
      const row = await client.shippingZone.findUnique({ where: { seedKey }, select: { id: true } });
      return row?.id ?? null;
    },
    async createZone(input) {
      const row = await client.shippingZone.create({
        data: {
          seedKey: input.seedKey,
          name: input.name,
          description: input.description,
          state: input.state,
          zipCodeFrom: input.zipCodeFrom,
          zipCodeTo: input.zipCodeTo,
          active: true,
          priority: 0,
        },
        select: { id: true },
      });
      return row.id;
    },
    async findRuleIdBySeedKey(seedKey) {
      const row = await client.shippingWeightRule.findUnique({ where: { seedKey }, select: { id: true } });
      return row?.id ?? null;
    },
    async createRule(input) {
      const row = await client.shippingWeightRule.create({
        data: {
          seedKey: input.seedKey,
          zoneId: input.zoneId,
          shippingMethodId: input.shippingMethodId,
          minWeightGrams: input.minWeightGrams,
          maxWeightGrams: input.maxWeightGrams,
          price: input.price,
          deliveryDays: input.deliveryDays,
          estimatedMinBusinessDays: input.estimatedMinBusinessDays,
          estimatedMaxBusinessDays: input.estimatedMaxBusinessDays,
          priority: 0,
          active: true,
        },
        select: { id: true },
      });
      return row.id;
    },
    async bumpConfigVersion() {
      await client.shippingSettings.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: { configVersion: { increment: 1 } },
      });
    },
  };
}

/** Instala a tabela nacional usando um `PrismaClient` já existente. */
export async function installNationalShippingTable(
  client: PrismaClient,
  options: InstallNationalTableOptions = {},
): Promise<InstallNationalTableResult> {
  return installNationalTableWithStore(createPrismaNationalTableStore(client), options);
}
