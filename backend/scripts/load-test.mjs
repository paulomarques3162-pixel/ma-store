#!/usr/bin/env node
/**
 * MA STORE - teste de carga (regra #37 / #75 do projeto).
 *
 * Mede RPS, p50/p95/p99, erros 4xx/5xx e timeouts da API sob concorrencia
 * crescente. NAO execute contra producao: ele cria e remove produtos de teste.
 *
 * Uso:
 *   API_URL=http://127.0.0.1:3333 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/load-test.mjs
 *
 * Saida: relatorio em texto + JSON em ./var/load-report.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3333";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@teste.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Teste@Admin123";
const CONCURRENCY = (process.env.LOAD_CONCURRENCY ?? "10,25,50,100,250").split(",").map(Number);
const DURATION_MS = Number(process.env.LOAD_DURATION_MS ?? 6000);
const PRODUCTS = Number(process.env.LOAD_PRODUCTS ?? 120);

async function request(method, url, { token, body } = {}) {
  const started = Date.now();
  try {
    const response = await fetch(`${API_URL}${url}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    return { status: response.status, ms: Date.now() - started, text };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error), text: "" };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function scenario(name, path, concurrency, durationMs, token) {
  const latencies = [];
  let ok = 0;
  let c4xx = 0;
  let c5xx = 0;
  let networkErrors = 0;

  const deadline = Date.now() + durationMs;

  async function worker() {
    while (Date.now() < deadline) {
      const result = await request("GET", path, { token });
      latencies.push(result.ms);
      if (result.status === 0) networkErrors += 1;
      else if (result.status >= 500) c5xx += 1;
      else if (result.status >= 400) c4xx += 1;
      else ok += 1;
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = Date.now() - startedAt;

  latencies.sort((a, b) => a - b);
  const total = latencies.length;

  return {
    scenario: name,
    endpoint: path,
    concurrency,
    requests: total,
    rps: Number((total / (elapsedMs / 1000)).toFixed(1)),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[total - 1] ?? 0,
    ok,
    errors4xx: c4xx,
    errors5xx: c5xx,
    networkErrors,
    elapsedMs,
  };
}

async function main() {
  console.log(`\nMA STORE - teste de carga`);
  console.log(`Alvo: ${API_URL}\n`);

  const health = await request("GET", "/api/health");
  if (health.status !== 200) {
    console.error("API indisponivel. Suba o servidor antes de rodar o teste.");
    process.exit(1);
  }

  const login = await request("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const token = JSON.parse(login.text)?.data?.accessToken;
  if (!token) {
    console.error("Nao foi possivel autenticar o admin. Verifique ADMIN_EMAIL/ADMIN_PASSWORD.");
    process.exit(1);
  }

  // Massa de dados: produtos ativos marcados para remocao no final.
  console.log(`Criando ${PRODUCTS} produtos de carga...`);
  const created = [];
  for (let i = 0; i < PRODUCTS; i += 1) {
    const sku = `LOAD-${Date.now()}-${i}`;
    const response = await request("POST", "/api/admin/products", {
      token,
      body: {
        name: `[CARGA] Produto ${i}`,
        sku,
        price: (10 + (i % 90)).toFixed(2),
        stock: 100,
        active: true,
      },
    });
    if (response.status === 201) created.push(JSON.parse(response.text).data.id);
  }
  console.log(`  ${created.length} produtos criados.\n`);

  const results = [];
  const scenarios = [
    { name: "Listagem de produtos (paginada)", path: "/api/products?perPage=20" },
    { name: "Busca com filtro + ordenacao", path: "/api/products?search=Perfume&sort=price_asc&inStock=true" },
    { name: "Categorias (cacheavel)", path: "/api/categories" },
    { name: "Health check", path: "/api/health" },
  ];

  for (const scenarioDef of scenarios) {
    console.log(`--- ${scenarioDef.name} ---`);
    for (const concurrency of CONCURRENCY) {
      const result = await scenario(scenarioDef.name, scenarioDef.path, concurrency, DURATION_MS, token);
      results.push(result);
      console.log(
        `  ${String(concurrency).padStart(3)} usuarios | ` +
          `RPS ${String(result.rps).padStart(7)} | ` +
          `p50 ${String(result.p50).padStart(4)}ms | ` +
          `p95 ${String(result.p95).padStart(4)}ms | ` +
          `p99 ${String(result.p99).padStart(4)}ms | ` +
          `4xx ${result.errors4xx} | 5xx ${result.errors5xx} | timeout ${result.networkErrors}`,
      );
    }
    console.log("");
  }

  // Limpeza
  console.log("Removendo produtos de carga...");
  for (const id of created) {
    await request("DELETE", `/api/admin/products/${id}?hard=true`, { token });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    target: API_URL,
    environment: process.env.NODE_ENV ?? "development",
    host: {
      cpuCores: (await import("node:os")).cpus().length,
      totalMemoryMb: Math.round((await import("node:os")).totalmem() / 1024 / 1024),
      platform: (await import("node:os")).platform(),
      node: process.version,
    },
    catalogueSize: created.length,
    results,
  };

  const outDir = path.join(process.cwd(), "var");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "load-report.json"), JSON.stringify(report, null, 2));

  const worst5xx = results.reduce((acc, r) => acc + r.errors5xx, 0);
  console.log(`\nRelatorio salvo em var/load-report.json`);
  console.log(worst5xx === 0 ? "Nenhum erro 5xx detectado.\n" : `ATENCAO: ${worst5xx} respostas 5xx.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
