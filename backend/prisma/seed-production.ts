/**
 * Seed de PRODUCAO do Shipping Engine proprio — MA STORE.
 *
 * Carrega a TABELA NACIONAL PRE-CADASTRADA (26 estados + DF) com precos e
 * prazos estimados, para o motor proprio ja funcionar sem cadastro manual.
 *
 * Regras:
 *  - idempotente: rodar novamente nao duplica nada;
 *  - preserva qualquer zona/faixa/preco que o administrador ja tenha editado;
 *  - se o banco ja tiver zonas proprias do administrador, NAO mistura a tabela
 *    inicial (a menos que rode com `--force`);
 *  - os valores sao ESTIMATIVAS COMERCIAIS INICIAIS da MA STORE, editaveis no
 *    painel (Admin > Frete motor proprio).
 *
 * Uso: npm run seed:production [-- --force]
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { installNationalShippingTable } from "../src/shipping-local/bootstrap/prisma-store.js";
import { validateNationalTable } from "../src/shipping-local/bootstrap/national-table.js";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[MA STORE] seed:production normalmente roda com NODE_ENV=production.");
  }

  console.log("=== seed:production — tabela nacional de frete (MA STORE) ===");
  const validation = validateNationalTable();
  console.log(`  zonas: ${validation.zones} | regras: ${validation.rules} | UFs: ${validation.states.length}`);

  const force = process.argv.includes("--force");
  const result = await installNationalShippingTable(prisma, { force });

  if (result.skipped) {
    console.log(`\n  NAO aplicada: ${result.reason}`);
    console.log(`  zonas personalizadas encontradas: ${result.customZonesDetected}`);
  } else {
    console.log("  tabela inicial aplicada (somente o que faltava):");
    console.log(`  modalidades criadas: ${result.methodsCreated}`);
    console.log(`  zonas criadas:       ${result.zonesCreated}`);
    console.log(`  regras criadas:      ${result.rulesCreated}`);
    console.log(`  configuracoes:       ${result.settingsCreated ? "criadas" : "preservadas"}`);
  }

  console.log("\nProximo passo: confirme o CEP de origem e cadastre o peso dos produtos.\n");
}

main()
  .catch((error) => {
    console.error("Falha no seed:production:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
