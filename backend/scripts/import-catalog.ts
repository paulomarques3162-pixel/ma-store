/**
 * Importador seguro de catálogo (dry-run por padrão).
 *
 * Uso:
 *   npm run catalog:validate -- --file=catalog/mastoree-listing.json
 *   npm run catalog:import   -- --file=catalog/mastoree-listing.json --apply
 *   npm run catalog:import   -- --file=... --apply --update-prices
 *
 * NUNCA apaga produtos. Novos produtos entram INATIVOS e com estoque 0
 * (o administrador revisa e ativa) — evita publicar dado incompleto.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeCatalogSource, planCatalogImport } from "../src/services/catalog-import.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const file = resolve(arg("file") ?? "catalog/mastoree-listing.json");
  const apply = has("apply");
  const validateOnly = has("validate-only");
  const updatePrices = has("update-prices");
  const activate = has("activate");
  const defaultStock = Number(arg("default-stock") ?? 0);

  if (!existsSync(file)) {
    console.error(`[catalog] Arquivo não encontrado: ${file}`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const { valid, invalid } = normalizeCatalogSource(raw);

  console.log(`[catalog] Fonte: ${file}`);
  console.log(`[catalog] Itens válidos: ${valid.length} • inválidos: ${invalid.length}`);
  for (const bad of invalid.slice(0, 10)) console.warn(`  - item ${bad.sourceIndex}: ${bad.reason}`);

  if (validateOnly) return;

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.product.findMany({
      select: { id: true, name: true, sku: true, slug: true, price: true },
    });
    const existingNormalized = existing.map((p) => ({ ...p, price: Number(p.price.toString()) }));

    const plan = planCatalogImport(valid, existingNormalized);
    plan.invalid = invalid;

    console.log("\n===== RELATÓRIO DE IMPORTAÇÃO =====");
    console.log(`NOVOS:            ${plan.toCreate.length}`);
    console.log(`ATUALIZAÇÕES:     ${plan.toUpdate.length} (preço divergente: ${plan.summary.priceDivergent})`);
    console.log(`DUPLICADOS:       ${plan.duplicates.length}`);
    console.log(`DADOS FALTANTES:  ${plan.invalid.length}`);

    if (plan.toCreate.length > 0) {
      console.log("\n-- NOVOS --");
      for (const item of plan.toCreate.slice(0, 20)) console.log(`  + ${item.name} — R$ ${item.price.toFixed(2)} (${item.sku})`);
    }
    if (plan.toUpdate.length > 0) {
      console.log("\n-- ATUALIZAÇÕES (preço) --");
      for (const entry of plan.toUpdate.slice(0, 20)) console.log(`  ~ ${entry.existing.name} :: ${entry.changes.join(", ")}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      applied: apply,
      source: file,
      summary: plan.summary,
      toCreate: plan.toCreate.map((i) => ({ nome: i.name, sku: i.sku, preco: i.price })),
      toUpdate: plan.toUpdate.map((u) => ({ id: u.existing.id, nome: u.existing.name, changes: u.changes })),
      duplicates: plan.duplicates.map((d) => ({ nome: d.item.name, motivo: d.reason })),
      invalid: plan.invalid,
    };
    writeFileSync(resolve("catalog/import-report.json"), `${JSON.stringify(report, null, 2)}\n`);

    if (!apply) {
      console.log("\n[catalog] DRY-RUN. Nada foi gravado. Use --apply para aplicar.");
      return;
    }

    let created = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of plan.toCreate) {
        await tx.product.create({
          data: {
            name: item.name,
            slug: item.slug,
            sku: item.sku,
            shortDescription: item.description?.slice(0, 280) ?? null,
            description: item.description,
            price: item.price,
            comparePrice: item.comparePrice,
            volume: item.volume,
            weightGrams: item.weightGrams,
            stock: Number.isFinite(defaultStock) && defaultStock >= 0 ? Math.floor(defaultStock) : 0,
            active: activate,
            metaTitle: item.name.slice(0, 160),
            images: item.imageUrls.length
              ? { create: item.imageUrls.map((url, index) => ({ url, alt: item.name, position: index })) }
              : undefined,
          },
        });
        created += 1;
      }

      for (const entry of plan.toUpdate) {
        const data: Record<string, unknown> = {};
        if (updatePrices && entry.priceDivergent) {
          data.price = entry.item.price;
          data.comparePrice = entry.item.comparePrice;
        }
        if (Object.keys(data).length === 0) continue;
        await tx.product.update({ where: { id: entry.existing.id }, data });
        updated += 1;
      }
    });

    console.log(`\n[catalog] APLICADO: ${created} novo(s), ${updated} atualizado(s). Nenhum produto foi apagado.`);
    console.log("[catalog] Produtos novos entram INATIVOS por padrão (revisar no painel antes de publicar).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[catalog] Falha na importação:", error instanceof Error ? error.message : error);
  process.exit(1);
});
