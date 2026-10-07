/**
 * Seed de DESENVOLVIMENTO do Shipping Engine proprio.
 *
 * ATENCAO: este seed cria dados de EXEMPLO (modalidades, zonas, faixas de peso,
 * precos e prazos ficticios). Ele NAO deve ser executado em producao — a loja
 * real e configurada pelo administrador no painel.
 *
 * Uso: npm run seed:dev
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

// Entregadores de DESENVOLVIMENTO (nunca criados em producao).
const TEST_MOTOBOY_PASSWORD = "Motoboy@Test123";
const MOTOBOYS = [
  { name: "[TESTE] Motoboy 1", email: "motoboy1@test.local" },
  { name: "[TESTE] Motoboy 2", email: "motoboy2@test.local" },
];

const METHODS = [
  { code: "PICKUP", name: "Retirar na loja", description: "Retirada sem custo.", priority: 30, position: 0 },
  { code: "SAME_DAY", name: "Frete Super Expresso", description: "Entrega em 24 horas (quando disponivel).", priority: 25, position: 1 },
  { code: "EXPRESS", name: "Frete Expresso", description: "Entrega mais rapida.", priority: 20, position: 2 },
  { code: "STANDARD", name: "Frete Padrao", description: "Entrega padrao.", priority: 10, position: 3 },
  { code: "ECONOMIC", name: "Frete Economico", description: "Entrega economica.", priority: 5, position: 4 },
];

const ZONES = [
  { name: "Capital SP", state: "SP", from: 1000000, to: 5999999 },
  { name: "Interior SP", state: "SP", from: 11000000, to: 19999999 },
  { name: "Rio de Janeiro", state: "RJ", from: 20000000, to: 28999999 },
  { name: "Sudeste (MG/ES)", state: null, from: 29000000, to: 39999999 },
  { name: "Nordeste", state: null, from: 40000000, to: 65999999 },
  { name: "Norte", state: null, from: 66000000, to: 69999999 },
  { name: "Centro-Oeste", state: null, from: 70000000, to: 79999999 },
  { name: "Sul", state: null, from: 80000000, to: 99999999 },
];

// Faixas de peso de EXEMPLO (gramas) e preco/prazo base por modalidade.
const BANDS = [
  { min: 0, max: 1000 },
  { min: 1001, max: 3000 },
  { min: 3001, max: 10000 },
];

const PRICES: Record<string, number[]> = {
  PICKUP: [0, 0, 0],
  SAME_DAY: [49.9, 59.9, 79.9],
  EXPRESS: [34.9, 44.9, 64.9],
  STANDARD: [21.9, 27.9, 39.9],
  ECONOMIC: [14.9, 19.9, 29.9],
};

const DAYS: Record<string, number> = {
  PICKUP: 0,
  SAME_DAY: 1,
  EXPRESS: 2,
  STANDARD: 4,
  ECONOMIC: 7,
};

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("\n[MA STORE] seed:dev NAO deve rodar com NODE_ENV=production. Abortando.\n");
    process.exit(1);
  }

  console.log("=== seed:dev — Shipping Engine (dados de EXEMPLO) ===");

  // 1) Configuracoes gerais (exemplo).
  await prisma.shippingSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enabled: true,
      packagePaddingGrams: 100,
      defaultHandlingDays: 1,
      defaultDeliveryDays: 5,
      freeShippingEnabled: false,
      freeShippingMinimumOrderValue: "199.00",
      showEstimateDisclaimer: true,
    },
    update: {
      enabled: true,
      packagePaddingGrams: 100,
      defaultHandlingDays: 1,
      defaultDeliveryDays: 5,
      freeShippingEnabled: false,
      freeShippingMinimumOrderValue: "199.00",
      showEstimateDisclaimer: true,
      configVersion: { increment: 1 },
    },
  });

  // 2) Modalidades.
  const methodByCode = new Map<string, { id: string }>();
  for (const method of METHODS) {
    const row = await prisma.shippingMethod.upsert({
      where: { code: method.code },
      create: {
        name: method.name,
        code: method.code,
        description: method.description,
        price: "0.00",
        active: true,
        priority: method.priority,
        position: method.position,
      },
      update: {
        name: method.name,
        description: method.description,
        active: true,
        priority: method.priority,
        position: method.position,
      },
    });
    methodByCode.set(method.code, { id: row.id });
  }

  // 3) Zonas (exemplo). Nao cria duplicadas pelo nome.
  const zoneByName = new Map<string, { id: string }>();
  for (const zone of ZONES) {
    const existing = await prisma.shippingZone.findFirst({ where: { name: zone.name } });
    const row = existing
      ? await prisma.shippingZone.update({
          where: { id: existing.id },
          data: { state: zone.state, zipCodeFrom: zone.from, zipCodeTo: zone.to, active: true },
        })
      : await prisma.shippingZone.create({
          data: { name: zone.name, state: zone.state, zipCodeFrom: zone.from, zipCodeTo: zone.to, active: true },
        });
    zoneByName.set(zone.name, { id: row.id });
  }

  // 4) Regras de peso: recria as faixas das zonas de exemplo.
  const zoneIds = [...zoneByName.values()].map((zone) => zone.id);
  await prisma.shippingWeightRule.deleteMany({ where: { zoneId: { in: zoneIds } } });

  let ruleCount = 0;
  for (const zoneId of zoneIds) {
    for (const method of METHODS) {
      const methodId = methodByCode.get(method.code)!.id;
      const prices = PRICES[method.code]!;
      for (let index = 0; index < BANDS.length; index += 1) {
        await prisma.shippingWeightRule.create({
          data: {
            zoneId,
            shippingMethodId: methodId,
            minWeightGrams: BANDS[index]!.min,
            maxWeightGrams: BANDS[index]!.max,
            price: prices[index]!.toFixed(2),
            deliveryDays: DAYS[method.code]!,
            active: true,
          },
        });
        ruleCount += 1;
      }
    }
  }

  // 5) Excecao de CEP de exemplo (CEP da loja + Expresso com preco especial).
  const expressId = methodByCode.get("EXPRESS")!.id;
  const existingException = await prisma.shippingCepException.findFirst({
    where: { cep: "01001000", shippingMethodId: expressId },
  });
  if (!existingException) {
    await prisma.shippingCepException.create({
      data: { cep: "01001000", shippingMethodId: expressId, priceOverride: "29.90", deliveryDaysOverride: 1, active: true },
    });
  }

  // 6) Entregadores de teste (login: motoboy1@test.local / Motoboy@Test123).
  for (const motoboy of MOTOBOYS) {
    await prisma.user.upsert({
      where: { email: motoboy.email },
      create: {
        name: motoboy.name,
        email: motoboy.email,
        passwordHash: await bcrypt.hash(TEST_MOTOBOY_PASSWORD, 12),
        role: "DELIVERY_PERSON",
        status: "ACTIVE",
        isDemo: true,
        mustChangePassword: true,
      },
      update: { role: "DELIVERY_PERSON", status: "ACTIVE" },
    });
  }

  console.log(`  modalidades: ${METHODS.length}`);
  console.log(`  zonas: ${ZONES.length}`);
  console.log(`  regras de peso: ${ruleCount}`);
  console.log("  excecao de CEP: 01001000 / EXPRESSO (exemplo)");
  console.log("\n[AVISO] Dados de EXEMPLO. Nao usar em producao.\n");
}

main()
  .catch((error) => {
    console.error("Falha no seed:dev:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
