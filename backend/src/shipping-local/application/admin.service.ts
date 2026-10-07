/**
 * Regras de negocio administrativas do Shipping Engine proprio.
 *
 * Toda escrita e validada aqui (o HTTP apenas traduz). Nenhum valor comercial
 * e embutido: o administrador informa CEP, pesos, precos e prazos.
 */
import { prisma } from "../../db.js";
import { shippingError, validationError } from "../../lib/errors.js";
import { decimalToNumber } from "../../lib/serialize.js";
import { normalizeZipCode } from "../domain/cep.js";
import { assertWeightRange } from "../domain/weight.js";
import { findOverlappingZones } from "../domain/zone.js";
import type { ShippingZoneRecord } from "../domain/types.js";
import { DEFAULT_SETTINGS } from "./prisma.repository.js";

/* -------------------------------------------------------------------------- */
/* Configuracoes                                                               */
/* -------------------------------------------------------------------------- */

export type ShippingSettingsInput = {
  enabled?: boolean;
  originZipCode?: string | null;
  packagePaddingGrams?: number | null;
  defaultHandlingDays?: number | null;
  defaultDeliveryDays?: number | null;
  freeShippingEnabled?: boolean;
  freeShippingMinimumOrderValue?: number | null;
  showEstimateDisclaimer?: boolean;
};

export async function getShippingSettings() {
  const row = await prisma.shippingSettings.findUnique({ where: { id: "default" } });
  if (!row) return { ...DEFAULT_SETTINGS, configured: false };
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
    configured: true,
  };
}

export async function updateShippingSettings(input: ShippingSettingsInput) {
  const current = await getShippingSettings();

  const originZipCode =
    input.originZipCode === undefined
      ? current.originZipCode
      : input.originZipCode === null || input.originZipCode === ""
        ? null
        : normalizeZipCode(input.originZipCode);

  if (input.packagePaddingGrams != null && input.packagePaddingGrams < 0) {
    throw validationError("O peso de embalagem nao pode ser negativo.");
  }
  for (const [value, label] of [
    [input.defaultHandlingDays, "dias de manuseio"],
    [input.defaultDeliveryDays, "prazo padrao"],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      throw validationError(`Os ${label} nao podem ser negativos.`);
    }
  }
  if (input.freeShippingMinimumOrderValue != null && input.freeShippingMinimumOrderValue < 0) {
    throw validationError("O valor minimo para frete gratis nao pode ser negativo.");
  }
  if (input.freeShippingEnabled && input.freeShippingMinimumOrderValue === null && current.freeShippingMinimumOrderValue === null) {
    throw validationError("Informe o valor minimo para ativar o frete gratis.");
  }

  const row = await prisma.shippingSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enabled: input.enabled ?? false,
      originZipCode,
      packagePaddingGrams: input.packagePaddingGrams ?? null,
      defaultHandlingDays: input.defaultHandlingDays ?? null,
      defaultDeliveryDays: input.defaultDeliveryDays ?? null,
      freeShippingEnabled: input.freeShippingEnabled ?? false,
      freeShippingMinimumOrderValue:
        input.freeShippingMinimumOrderValue != null
          ? input.freeShippingMinimumOrderValue.toFixed(2)
          : null,
      showEstimateDisclaimer: input.showEstimateDisclaimer ?? true,
    },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      originZipCode,
      ...(input.packagePaddingGrams !== undefined ? { packagePaddingGrams: input.packagePaddingGrams } : {}),
      ...(input.defaultHandlingDays !== undefined ? { defaultHandlingDays: input.defaultHandlingDays } : {}),
      ...(input.defaultDeliveryDays !== undefined ? { defaultDeliveryDays: input.defaultDeliveryDays } : {}),
      ...(input.freeShippingEnabled !== undefined ? { freeShippingEnabled: input.freeShippingEnabled } : {}),
      ...(input.freeShippingMinimumOrderValue !== undefined
        ? {
            freeShippingMinimumOrderValue:
              input.freeShippingMinimumOrderValue != null
                ? input.freeShippingMinimumOrderValue.toFixed(2)
                : null,
          }
        : {}),
      ...(input.showEstimateDisclaimer !== undefined
        ? { showEstimateDisclaimer: input.showEstimateDisclaimer }
        : {}),
      // Sobe a versao: invalida o cache de cotacao de forma natural.
      configVersion: { increment: 1 },
    },
  });

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
    configured: true,
  };
}

/**
 * Sobe a versao de configuracao. A chave de cache inclui essa versao, entao
 * qualquer alteracao (inclusive em outra instancia) deixa o cache antigo
 * inalcancavel — nunca devolvemos frete desatualizado.
 */
export async function bumpShippingConfigVersion(): Promise<void> {
  await prisma.shippingSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: { configVersion: { increment: 1 } },
  });
}

/* -------------------------------------------------------------------------- */
/* Modalidades                                                                 */
/* -------------------------------------------------------------------------- */

export type MethodInput = {
  name: string;
  code?: string | null;
  description?: string | null;
  active?: boolean;
  priority?: number;
  position?: number;
  /** Preco legado da modalidade; no motor proprio o preco vem da regra de peso. */
  price?: number;
};

export async function listMethods() {
  return prisma.shippingMethod.findMany({
    orderBy: [{ priority: "desc" }, { position: "asc" }, { name: "asc" }],
  });
}

async function assertMethodCodeAvailable(code: string | null | undefined, ignoreId?: string) {
  if (!code) return;
  const existing = await prisma.shippingMethod.findFirst({ where: { code, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
  if (existing) throw shippingError("SHIPPING_CONFLICT", "Ja existe uma modalidade com este codigo.");
}

export async function createMethod(input: MethodInput) {
  const code = input.code?.trim().toUpperCase() || null;
  await assertMethodCodeAvailable(code);
  return prisma.shippingMethod.create({
    data: {
      name: input.name.trim(),
      code,
      description: input.description?.trim() || null,
      // No motor proprio o preco vem da regra de peso; a coluna legada existe e
      // recebe 0 (valor neutro) quando nao informada.
      price: (input.price ?? 0).toFixed(2),
      active: input.active ?? true,
      priority: input.priority ?? 0,
      position: input.position ?? 0,
    },
  });
}

export async function updateMethod(id: string, input: Partial<MethodInput>) {
  const current = await prisma.shippingMethod.findUnique({ where: { id } });
  if (!current) throw validationError("Modalidade nao encontrada.");
  if (input.code !== undefined) await assertMethodCodeAvailable(input.code?.trim().toUpperCase() || null, id);

  return prisma.shippingMethod.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim().toUpperCase() || null } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
}

export async function deleteMethod(id: string) {
  const current = await prisma.shippingMethod.findUnique({
    where: { id },
    select: { id: true, _count: { select: { shipments: true } } },
  });
  if (!current) throw validationError("Modalidade nao encontrada.");
  if (current._count.shipments > 0) {
    // Nunca apagar modalidade usada em envio: desativa.
    return { deleted: false, deactivated: true, method: await prisma.shippingMethod.update({ where: { id }, data: { active: false } }) };
  }
  await prisma.shippingMethod.delete({ where: { id } });
  return { deleted: true, deactivated: false };
}

/* -------------------------------------------------------------------------- */
/* Zonas                                                                       */
/* -------------------------------------------------------------------------- */

async function loadZoneRecords(): Promise<ShippingZoneRecord[]> {
  const rows = await prisma.shippingZone.findMany();
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

export async function listZones() {
  const rows = await prisma.shippingZone.findMany({ orderBy: [{ priority: "desc" }, { zipCodeFrom: "asc" }] });
  return rows;
}

export type ZoneInput = {
  name: string;
  description?: string | null;
  state?: string | null;
  zipCodeFrom: string;
  zipCodeTo: string;
  active?: boolean;
  priority?: number;
};

function normalizeState(state: string | null | undefined): string | null {
  const clean = state?.trim().toUpperCase() || "";
  if (!clean) return null;
  if (!/^[A-Z]{2}$/.test(clean)) throw validationError("UF invalida (use 2 letras).");
  return clean;
}

export async function createZone(input: ZoneInput) {
  const zipCodeFrom = Number.parseInt(normalizeZipCode(input.zipCodeFrom), 10);
  const zipCodeTo = Number.parseInt(normalizeZipCode(input.zipCodeTo), 10);
  if (zipCodeFrom > zipCodeTo) {
    throw validationError("O CEP inicial nao pode ser maior que o CEP final.");
  }

  const overlaps = findOverlappingZones(await loadZoneRecords(), { zipCodeFrom, zipCodeTo });
  if (overlaps.length > 0) {
    throw shippingError(
      "SHIPPING_CONFLICT",
      "A faixa de CEP se sobrepoe a uma regiao ativa existente. Ajuste os CEPs ou desative a outra regiao.",
      { overlaps },
    );
  }

  return prisma.shippingZone.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      state: normalizeState(input.state),
      zipCodeFrom,
      zipCodeTo,
      active: input.active ?? true,
      priority: input.priority ?? 0,
    },
  });
}

export async function updateZone(id: string, input: Partial<ZoneInput>) {
  const current = await prisma.shippingZone.findUnique({ where: { id } });
  if (!current) throw validationError("Regiao nao encontrada.");

  const zipCodeFrom =
    input.zipCodeFrom !== undefined ? Number.parseInt(normalizeZipCode(input.zipCodeFrom), 10) : current.zipCodeFrom;
  const zipCodeTo =
    input.zipCodeTo !== undefined ? Number.parseInt(normalizeZipCode(input.zipCodeTo), 10) : current.zipCodeTo;
  if (zipCodeFrom > zipCodeTo) {
    throw validationError("O CEP inicial nao pode ser maior que o CEP final.");
  }

  const active = input.active ?? current.active;
  if (active) {
    const overlaps = findOverlappingZones(await loadZoneRecords(), { zipCodeFrom, zipCodeTo }, id);
    if (overlaps.length > 0) {
      throw shippingError(
        "SHIPPING_CONFLICT",
        "A faixa de CEP se sobrepoe a uma regiao ativa existente.",
        { overlaps },
      );
    }
  }

  return prisma.shippingZone.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.state !== undefined ? { state: normalizeState(input.state) } : {}),
      zipCodeFrom,
      zipCodeTo,
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    },
  });
}

export async function deleteZone(id: string) {
  const current = await prisma.shippingZone.findUnique({ where: { id } });
  if (!current) throw validationError("Regiao nao encontrada.");
  await prisma.shippingZone.delete({ where: { id } });
  return { deleted: true, id };
}

/* -------------------------------------------------------------------------- */
/* Regras de peso (zona + modalidade + faixa)                                  */
/* -------------------------------------------------------------------------- */

export type WeightRuleInput = {
  zoneId: string;
  shippingMethodId?: string | null;
  minWeightGrams: number;
  maxWeightGrams: number;
  price: number;
  deliveryDays?: number | null;
  estimatedMinBusinessDays?: number | null;
  estimatedMaxBusinessDays?: number | null;
  priority?: number;
  active?: boolean;
};

function validateWeightRule(input: WeightRuleInput) {
  assertWeightRange(input.minWeightGrams, input.maxWeightGrams);
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw validationError("O preco do frete nao pode ser negativo.");
  }
  for (const days of [input.deliveryDays, input.estimatedMinBusinessDays, input.estimatedMaxBusinessDays]) {
    if (days != null && (!Number.isInteger(days) || days < 0)) {
      throw validationError("Os prazos devem ser numeros inteiros de dias nao negativos.");
    }
  }
  if (
    input.estimatedMinBusinessDays != null &&
    input.estimatedMaxBusinessDays != null &&
    input.estimatedMinBusinessDays > input.estimatedMaxBusinessDays
  ) {
    throw validationError("O prazo minimo nao pode ser maior que o prazo maximo.");
  }
}

/** Detecta faixas de peso ambiguas (sobrepostas) na mesma zona+modalidade. */
async function assertNoWeightOverlap(
  input: { zoneId: string; shippingMethodId: string | null; minWeightGrams: number; maxWeightGrams: number },
  ignoreId?: string,
) {
  const rules = await prisma.shippingWeightRule.findMany({
    where: {
      zoneId: input.zoneId,
      shippingMethodId: input.shippingMethodId,
      active: true,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    select: { id: true, minWeightGrams: true, maxWeightGrams: true },
  });
  const conflicting = rules.filter(
    (rule) => input.minWeightGrams <= rule.maxWeightGrams && rule.minWeightGrams <= input.maxWeightGrams,
  );
  if (conflicting.length > 0) {
    throw shippingError(
      "SHIPPING_CONFLICT",
      "A faixa de peso se sobrepoe a outra regra ativa da mesma zona e modalidade.",
      { conflicts: conflicting },
    );
  }
}

export async function listWeightRules(zoneId?: string) {
  return prisma.shippingWeightRule.findMany({
    where: zoneId ? { zoneId } : undefined,
    orderBy: [{ zoneId: "asc" }, { priority: "desc" }, { minWeightGrams: "asc" }],
    include: {
      zone: { select: { id: true, name: true } },
      shippingMethod: { select: { id: true, name: true, code: true } },
    },
  });
}

export async function createWeightRule(input: WeightRuleInput) {
  validateWeightRule(input);
  const zone = await prisma.shippingZone.findUnique({ where: { id: input.zoneId } });
  if (!zone) throw validationError("Selecione uma regiao valida para a faixa de peso.");

  const methodId = input.shippingMethodId ?? null;
  if (methodId) {
    const method = await prisma.shippingMethod.findUnique({ where: { id: methodId } });
    if (!method) throw validationError("Selecione uma modalidade valida para a faixa de peso.");
  }
  await assertNoWeightOverlap({
    zoneId: input.zoneId,
    shippingMethodId: methodId,
    minWeightGrams: input.minWeightGrams,
    maxWeightGrams: input.maxWeightGrams,
  });

  return prisma.shippingWeightRule.create({
    data: {
      zoneId: input.zoneId,
      shippingMethodId: methodId,
      minWeightGrams: input.minWeightGrams,
      maxWeightGrams: input.maxWeightGrams,
      price: input.price.toFixed(2),
      deliveryDays: input.deliveryDays ?? null,
      estimatedMinBusinessDays: input.estimatedMinBusinessDays ?? null,
      estimatedMaxBusinessDays: input.estimatedMaxBusinessDays ?? null,
      priority: input.priority ?? 0,
      active: input.active ?? true,
    },
  });
}

export async function updateWeightRule(id: string, input: Partial<WeightRuleInput>) {
  const current = await prisma.shippingWeightRule.findUnique({ where: { id } });
  if (!current) throw validationError("Regra nao encontrada.");

  const merged: WeightRuleInput = {
    zoneId: input.zoneId ?? current.zoneId,
    shippingMethodId: input.shippingMethodId !== undefined ? input.shippingMethodId : current.shippingMethodId,
    minWeightGrams: input.minWeightGrams ?? current.minWeightGrams,
    maxWeightGrams: input.maxWeightGrams ?? current.maxWeightGrams,
    price: input.price ?? decimalToNumber(current.price),
    deliveryDays: input.deliveryDays !== undefined ? input.deliveryDays : current.deliveryDays,
    estimatedMinBusinessDays:
      input.estimatedMinBusinessDays !== undefined
        ? input.estimatedMinBusinessDays
        : current.estimatedMinBusinessDays,
    estimatedMaxBusinessDays:
      input.estimatedMaxBusinessDays !== undefined
        ? input.estimatedMaxBusinessDays
        : current.estimatedMaxBusinessDays,
    priority: input.priority ?? current.priority,
    active: input.active ?? current.active,
  };
  validateWeightRule(merged);

  if (merged.active) {
    await assertNoWeightOverlap(
      {
        zoneId: merged.zoneId,
        shippingMethodId: merged.shippingMethodId ?? null,
        minWeightGrams: merged.minWeightGrams,
        maxWeightGrams: merged.maxWeightGrams,
      },
      id,
    );
  }

  return prisma.shippingWeightRule.update({
    where: { id },
    data: {
      ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {}),
      ...(input.shippingMethodId !== undefined ? { shippingMethodId: input.shippingMethodId } : {}),
      ...(input.minWeightGrams !== undefined ? { minWeightGrams: input.minWeightGrams } : {}),
      ...(input.maxWeightGrams !== undefined ? { maxWeightGrams: input.maxWeightGrams } : {}),
      ...(input.price !== undefined ? { price: input.price.toFixed(2) } : {}),
      ...(input.deliveryDays !== undefined ? { deliveryDays: input.deliveryDays } : {}),
      ...(input.estimatedMinBusinessDays !== undefined
        ? { estimatedMinBusinessDays: input.estimatedMinBusinessDays }
        : {}),
      ...(input.estimatedMaxBusinessDays !== undefined
        ? { estimatedMaxBusinessDays: input.estimatedMaxBusinessDays }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function deleteWeightRule(id: string) {
  const current = await prisma.shippingWeightRule.findUnique({ where: { id } });
  if (!current) throw validationError("Regra nao encontrada.");
  await prisma.shippingWeightRule.delete({ where: { id } });
  return { deleted: true, id };
}

/* -------------------------------------------------------------------------- */
/* Excecoes de CEP                                                             */
/* -------------------------------------------------------------------------- */

export type CepExceptionInput = {
  cep: string;
  shippingMethodId: string;
  priceOverride?: number | null;
  deliveryDaysOverride?: number | null;
  active?: boolean;
};

export async function listCepExceptions(cep?: string) {
  const normalized = cep ? normalizeZipCode(cep) : undefined;
  return prisma.shippingCepException.findMany({
    where: normalized ? { cep: normalized } : undefined,
    orderBy: [{ cep: "asc" }],
    include: { shippingMethod: { select: { id: true, name: true, code: true } } },
  });
}

function validateCepException(input: CepExceptionInput) {
  if (input.priceOverride != null && input.priceOverride < 0) {
    throw validationError("O preco especial nao pode ser negativo.");
  }
  if (input.deliveryDaysOverride != null && (!Number.isInteger(input.deliveryDaysOverride) || input.deliveryDaysOverride < 0)) {
    throw validationError("O prazo especial deve ser um numero inteiro de dias nao negativos.");
  }
}

export async function createCepException(input: CepExceptionInput) {
  validateCepException(input);
  const cep = normalizeZipCode(input.cep);
  const method = await prisma.shippingMethod.findUnique({ where: { id: input.shippingMethodId } });
  if (!method) throw validationError("Selecione uma modalidade valida para a excecao de CEP.");

  const existing = await prisma.shippingCepException.findFirst({
    where: { cep, shippingMethodId: input.shippingMethodId },
  });
  if (existing) throw shippingError("SHIPPING_CONFLICT", "Ja existe uma excecao para este CEP e modalidade.");

  return prisma.shippingCepException.create({
    data: {
      cep,
      shippingMethodId: input.shippingMethodId,
      priceOverride: input.priceOverride != null ? input.priceOverride.toFixed(2) : null,
      deliveryDaysOverride: input.deliveryDaysOverride ?? null,
      active: input.active ?? true,
    },
  });
}

export async function updateCepException(id: string, input: Partial<CepExceptionInput>) {
  const current = await prisma.shippingCepException.findUnique({ where: { id } });
  if (!current) throw validationError("Excecao nao encontrada.");

  const merged: CepExceptionInput = {
    cep: input.cep ?? current.cep,
    shippingMethodId: input.shippingMethodId ?? current.shippingMethodId,
    priceOverride: input.priceOverride !== undefined ? input.priceOverride : current.priceOverride === null ? null : decimalToNumber(current.priceOverride),
    deliveryDaysOverride:
      input.deliveryDaysOverride !== undefined ? input.deliveryDaysOverride : current.deliveryDaysOverride,
    active: input.active ?? current.active,
  };
  validateCepException(merged);

  return prisma.shippingCepException.update({
    where: { id },
    data: {
      ...(input.cep !== undefined ? { cep: normalizeZipCode(input.cep) } : {}),
      ...(input.shippingMethodId !== undefined ? { shippingMethodId: input.shippingMethodId } : {}),
      ...(input.priceOverride !== undefined
        ? { priceOverride: input.priceOverride != null ? input.priceOverride.toFixed(2) : null }
        : {}),
      ...(input.deliveryDaysOverride !== undefined ? { deliveryDaysOverride: input.deliveryDaysOverride } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function deleteCepException(id: string) {
  const current = await prisma.shippingCepException.findUnique({ where: { id } });
  if (!current) throw validationError("Excecao nao encontrada.");
  await prisma.shippingCepException.delete({ where: { id } });
  return { deleted: true, id };
}
