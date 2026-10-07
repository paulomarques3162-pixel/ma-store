/**
 * Seed de PRODUCAO do Shipping Engine proprio.
 *
 * REGRA: NAO inserir precos, CEPs, prazos ou transportadoras ficticias.
 * Este seed apenas garante a linha de configuracao NEUTRA (motor desligado).
 * A tabela comercial real e cadastrada pelo administrador no painel.
 *
 * Uso: npm run seed:production
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[MA STORE] seed:production normalmente roda com NODE_ENV=production.");
  }

  console.log("=== seed:production — Shipping Engine (configuracao neutra) ===");

  await prisma.shippingSettings.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: false, freeShippingEnabled: false },
    // Nunca sobrescreve uma configuracao real ja cadastrada.
    update: {},
  });

  console.log("  configuracoes neutras garantidas (motor desligado).");
  console.log("  Nenhuma modalidade/zona/regra/preco foi criado.");
  console.log("\nProximo passo: Admin > Frete (motor proprio) para cadastrar a tabela real.\n");
}

main()
  .catch((error) => {
    console.error("Falha no seed:production:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
