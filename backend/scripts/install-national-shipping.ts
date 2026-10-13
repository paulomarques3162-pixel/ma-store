/**
 * Instala/verifica a tabela nacional de frete pre-cadastrada.
 *
 * Uso:
 *   npm run shipping:national            # respeita configuracoes personalizadas
 *   npm run shipping:national -- --force # aplica mesmo com zonas do admin
 *
 * E idempotente: rodar novamente nao duplica nem sobrescreve nada.
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { installNationalShippingTable } from "../src/shipping-local/bootstrap/prisma-store.js";
import { validateNationalTable } from "../src/shipping-local/bootstrap/national-table.js";

const prisma = new PrismaClient();

async function main() {
  const force = process.argv.includes("--force");
  const validation = validateNationalTable();
  console.log("=== MA STORE — tabela nacional de frete ===");
  console.log(`  zonas validadas: ${validation.zones}`);
  console.log(`  regras previstas: ${validation.rules}`);
  console.log(`  UFs cobertas: ${validation.states.length}`);
  console.log(`  faixa de CEP: ${validation.coveredZipFrom}–${validation.coveredZipTo}`);

  const result = await installNationalShippingTable(prisma, { force });
  if (result.skipped) {
    console.log(`\n  NAO aplicada: ${result.reason}`);
    console.log(`  zonas personalizadas encontradas: ${result.customZonesDetected}`);
  } else {
    console.log("\n  aplicada com sucesso (somente o que faltava):");
    console.log(`  modalidades criadas: ${result.methodsCreated}`);
    console.log(`  zonas criadas:       ${result.zonesCreated}`);
    console.log(`  regras criadas:      ${result.rulesCreated}`);
    console.log(`  configuracoes:       ${result.settingsCreated ? "criadas" : "preservadas"}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("Falha ao instalar a tabela nacional de frete:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
