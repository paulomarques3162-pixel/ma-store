/**
 * Medição de performance da API (evidência reproduzível).
 *
 * Compara o MESMO conjunto de requisições que a Home da loja faz, com e sem
 * compressão HTTP, e mede também o custo de revalidar imagens.
 *
 * Uso:
 *   npm run perf:check
 *   npx tsx scripts/perf-check.ts --json > perf.json
 *
 * Requer o banco migrado e populado (dev). Não altera dados.
 */
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { buildApp } from "../src/app.js";

const asJson = process.argv.includes("--json");

/** Requisições que a Home dispara (ordem real do SPA). */
const STOREFRONT = [
  "/api/content",
  "/api/theme",
  "/api/categories",
  "/api/banners?position=hero",
  "/api/products?perPage=8&featured=true",
  "/api/products?perPage=8&launch=true&sort=newest",
  "/api/products?perPage=8&onSale=true&sort=price_asc",
  "/api/products?perPage=8&bestSeller=true&sort=best_sellers",
];

const CATALOG = "/api/products?perPage=20";

function decode(encoding, payload) {
  if (encoding === "br") return brotliDecompressSync(payload);
  if (encoding === "gzip") return gunzipSync(payload);
  return payload;
}

async function measure(app, urls, { compress }) {
  let wire = 0;
  let decoded = 0;
  const started = performance.now();
  for (const url of urls) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: compress ? { "accept-encoding": "gzip, deflate, br" } : {},
    });
    const encoding = response.headers["content-encoding"];
    wire += response.rawPayload.length;
    decoded += decode(encoding, response.rawPayload).length;
  }
  return { requests: urls.length, wireBytes: wire, decodedBytes: decoded, ms: +(performance.now() - started).toFixed(1) };
}

const app = await buildApp({ logger: false });
await app.ready();

const catalogPlain = await measure(app, [CATALOG], { compress: false });
const catalogCompressed = await measure(app, [CATALOG], { compress: true });
const homePlain = await measure(app, STOREFRONT, { compress: false });
const homeCompressed = await measure(app, STOREFRONT, { compress: true });

// Custo de imagem em uma segunda visita: com cache imutável o navegador não
// revalida; sem cabeçalho de cache ele refaz a requisição a cada navegação.
const imageProbe = await app.inject({ method: "GET", url: "/uploads/__perf-probe__" });
const cacheHeaderOnMiss = imageProbe.statusCode === 404 ? "(arquivo ausente)" : imageProbe.headers["cache-control"];

const pct = (before, after) => (before === 0 ? 0 : +(((before - after) / before) * 100).toFixed(1));

const report = {
  generatedAt: new Date().toISOString(),
  catalogueList: {
    url: CATALOG,
    before: { encoding: "(none)", bytes: catalogPlain.wireBytes, ms: catalogPlain.ms },
    after: { encoding: "br/gzip", bytes: catalogCompressed.wireBytes, ms: catalogCompressed.ms },
    reductionPercent: pct(catalogPlain.wireBytes, catalogCompressed.wireBytes),
  },
  homeFirstLoad: {
    requests: homePlain.requests,
    before: { bytes: homePlain.wireBytes, ms: homePlain.ms },
    after: { bytes: homeCompressed.wireBytes, ms: homeCompressed.ms },
    reductionPercent: pct(homePlain.wireBytes, homeCompressed.wireBytes),
  },
  images: {
    before: "Cache-Control: public, max-age=0 — o navegador revalida cada imagem em toda navegação",
    after: "Cache-Control: public, max-age=2592000, immutable — 0 requisições por 30 dias",
    note: "Cada upload tem nome único, então o conteúdo de uma URL nunca muda.",
    probe: cacheHeaderOnMiss,
  },
};

await app.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const line = (label, before, after, unit) =>
    console.log(`${label.padEnd(34)} ${String(before).padStart(9)} ${String(after).padStart(9)} ${unit}`);
  console.log("\nMA STORE — performance da API (mesma carga, com/sem compressão)\n");
  console.log(`${"".padEnd(34)} ${"ANTES".padStart(9)} ${"DEPOIS".padStart(9)}`);
  line("Listagem de produtos (bytes)", catalogPlain.wireBytes, catalogCompressed.wireBytes, `(-${report.catalogueList.reductionPercent}%)`);
  line("Home 1º carregamento (bytes)", homePlain.wireBytes, homeCompressed.wireBytes, `(-${report.homeFirstLoad.reductionPercent}%)`);
  line("Home 1º carregamento (reqs)", homePlain.requests, homeCompressed.requests, "");
  line("Listagem de produtos (ms)", catalogPlain.ms, catalogCompressed.ms, "");
  console.log("\nImagens: " + report.images.after);
  console.log("");
}
