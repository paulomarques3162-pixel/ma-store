/**
 * Instalador IDEMPOTENTE da tabela nacional de frete pre-cadastrada.
 *
 * Objetivo: no primeiro deploy (ou em uma atualização), o motor próprio já sai
 * funcionando, sem o administrador precisar cadastrar estados, faixas, preços e
 * prazos. Reexecutar é seguro:
 *
 *  - cria apenas o que ainda não existe (marcadores `seedKey` únicos);
 *  - NUNCA altera nem apaga uma zona/faixa/preço já existente (preserva edições);
 *  - se o banco já tiver zonas cadastradas pelo proprietário (`seedKey = null`),
 *    a instalação é ABORTADA por padrão, para não misturar duas tabelas. Use
 *    `force: true` (script/seed) apenas quando souber o que está fazendo.
 *
 * O instalador é a única forma de carregar valores comerciais iniciais: a lógica
 * fica em `national-table.ts` e aqui apenas a persistência.
 */
import {
  NATIONAL_METHODS,
  NATIONAL_TABLE_META,
  NATIONAL_ZONES,
  buildZoneRules,
  validateNationalTable,
  type NationalTableValidation,
} from "./national-table.js";

export { validateNationalTable } from "./national-table.js";
export type { NationalTableValidation } from "./national-table.js";

export type InstallNationalTableResult = {
  skipped: boolean;
  reason: string | null;
  methodsCreated: number;
  zonesCreated: number;
  rulesCreated: number;
  settingsCreated: boolean;
  customZonesDetected: number;
  validation: NationalTableValidation;
};

export type InstallNationalTableOptions = {
  /** Ignora a detecção de zonas personalizadas (uso em scripts/seed). */
  force?: boolean;
};

/** Interface mínima de persistência — permite testar o instalador sem banco. */
export type NationalTableStore = {
  countCustomZones(): Promise<number>;
  hasSettings(): Promise<boolean>;
  createSettings(): Promise<void>;
  findMethodIdByCode(code: string): Promise<string | null>;
  createMethod(input: { code: string; name: string; description: string; priority: number; position: number }): Promise<string>;
  findZoneIdBySeedKey(seedKey: string): Promise<string | null>;
  createZone(input: {
    seedKey: string;
    name: string;
    description: string;
    state: string;
    zipCodeFrom: number;
    zipCodeTo: number;
  }): Promise<string>;
  findRuleIdBySeedKey(seedKey: string): Promise<string | null>;
  createRule(input: {
    seedKey: string;
    zoneId: string;
    shippingMethodId: string;
    minWeightGrams: number;
    maxWeightGrams: number;
    price: string;
    deliveryDays: number;
    estimatedMinBusinessDays: number;
    estimatedMaxBusinessDays: number;
  }): Promise<string>;
  bumpConfigVersion(): Promise<void>;
};

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Executa a instalação sobre qualquer `NationalTableStore` (testável).
 */
export async function installNationalTableWithStore(
  store: NationalTableStore,
  options: InstallNationalTableOptions = {},
): Promise<InstallNationalTableResult> {
  // 1) A própria tabela precisa ser válida (cobertura, faixas, preços).
  const validation = validateNationalTable();

  // 2) Estratégia de mesclagem segura: não misturar com configuração própria.
  const customZonesDetected = await store.countCustomZones();
  if (customZonesDetected > 0 && !options.force) {
    return {
      skipped: true,
      reason:
        "O banco já possui regiões cadastradas pelo administrador. A tabela inicial não foi aplicada para não sobrescrever a configuração existente.",
      methodsCreated: 0,
      zonesCreated: 0,
      rulesCreated: 0,
      settingsCreated: false,
      customZonesDetected,
      validation,
    };
  }

  let methodsCreated = 0;
  let zonesCreated = 0;
  let rulesCreated = 0;
  let settingsCreated = false;

  // 3) Configurações: só cria se ainda não existir (nunca altera as do admin).
  if (!(await store.hasSettings())) {
    await store.createSettings();
    settingsCreated = true;
  }

  // 4) Modalidades: reaproveita por `code`; cria apenas as ausentes.
  const methodIds = new Map<string, string>();
  for (const method of NATIONAL_METHODS) {
    const existing = await store.findMethodIdByCode(method.code);
    if (existing) {
      methodIds.set(method.code, existing);
      continue;
    }
    try {
      methodIds.set(method.code, await store.createMethod(method));
      methodsCreated += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await store.findMethodIdByCode(method.code);
      if (!raced) throw error;
      methodIds.set(method.code, raced);
    }
  }

  // 5) Zonas e faixas: cria o que falta, preserva o que existe.
  for (const zone of NATIONAL_ZONES) {
    let zoneId = await store.findZoneIdBySeedKey(zone.seedKey);
    if (!zoneId) {
      try {
        zoneId = await store.createZone({
          seedKey: zone.seedKey,
          name: zone.name,
          description: `Tabela inicial MA STORE (estimativa). ${NATIONAL_TABLE_META.provisionalOriginLabel}.`,
          state: zone.state,
          zipCodeFrom: zone.zipCodeFrom,
          zipCodeTo: zone.zipCodeTo,
        });
        zonesCreated += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        zoneId = await store.findZoneIdBySeedKey(zone.seedKey);
        if (!zoneId) throw error;
      }
    }

    for (const { methodCode, rule } of buildZoneRules(zone)) {
      const methodId = methodIds.get(methodCode);
      if (!methodId) throw new Error(`Modalidade ausente após instalação: ${methodCode}.`);
      const existingRule = await store.findRuleIdBySeedKey(rule.seedKey);
      if (existingRule) continue;
      try {
        await store.createRule({
          seedKey: rule.seedKey,
          zoneId,
          shippingMethodId: methodId,
          minWeightGrams: rule.minWeightGrams,
          maxWeightGrams: rule.maxWeightGrams,
          price: rule.price.toFixed(2),
          deliveryDays: rule.deliveryDays,
          estimatedMinBusinessDays: rule.estimatedMinBusinessDays,
          estimatedMaxBusinessDays: rule.estimatedMaxBusinessDays,
        });
        rulesCreated += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }

  // 6) Invalida o cache de cotação de forma natural.
  if (methodsCreated + zonesCreated + rulesCreated + (settingsCreated ? 1 : 0) > 0) {
    await store.bumpConfigVersion();
  }

  return {
    skipped: false,
    reason: null,
    methodsCreated,
    zonesCreated,
    rulesCreated,
    settingsCreated,
    customZonesDetected,
    validation,
  };
}

