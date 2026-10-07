/**
 * Servidor de validação local da MA STORE.
 *
 * Reproduz a arquitetura de produção:
 *   navegador -> este servidor (estático, como a Vercel)
 *             -> proxy /api -> API Fastify (como a Render)
 *
 * IMPORTANTE: este servidor NÃO inventa um fallback próprio — ele lê o
 * `frontend/vercel.json` e aplica a MESMA regra de rewrite, com a MESMA ordem
 * da Vercel:
 *   1. se o caminho corresponde a um arquivo real em dist/ -> serve o arquivo
 *   2. senão, se casa com a regra de rewrite -> serve o index.html (SPA)
 *   3. senão -> 404
 *
 * É isso que permite testar localmente que `/admin` não retorna 404.
 *
 * Uso: node tests/browser/local-server.mjs   (PORT=4174 por padrão)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, "../..");
const DIST = process.env.DIST_DIR ?? join(REPO, "frontend/dist");
const VERCEL_JSON = join(REPO, "frontend/vercel.json");
const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:3333";
const PORT = Number(process.env.PORT ?? 4174);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

/** Lê as regras de rewrite do vercel.json do frontend. */
async function carregarRewrites() {
  try {
    const config = JSON.parse(await readFile(VERCEL_JSON, "utf8"));
    const rewrites = (config.rewrites ?? []).map((regra) => ({
      source: regra.source,
      destination: regra.destination,
      // A Vercel compila o "source" para um RegExp ancorado.
      regex: new RegExp(`^${regra.source}$`),
    }));
    return { rewrites, outputDirectory: config.outputDirectory ?? "dist" };
  } catch (error) {
    console.warn(`[servidor] não consegui ler ${VERCEL_JSON}: ${String(error)}`);
    return { rewrites: [], outputDirectory: "dist" };
  }
}

const { rewrites } = await carregarRewrites();
console.log(`[servidor] ${rewrites.length} regra(s) de rewrite carregada(s) de vercel.json`);

async function arquivoExiste(caminho) {
  try {
    const info = await stat(caminho);
    return info.isFile();
  } catch {
    return false;
  }
}

async function servirArquivo(res, caminho) {
  const content = await readFile(caminho);
  res.writeHead(200, {
    "content-type": MIME[extname(caminho)] ?? "application/octet-stream",
    "cache-control": caminho.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  res.end(content);
}

async function serveStatic(res, urlPath) {
  // Segurança: impede path traversal.
  const seguro = normalize(urlPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");

  // 1. arquivo real (equivale ao "handle: filesystem" da Vercel)
  const candidato = join(DIST, seguro);
  if (seguro && (await arquivoExiste(candidato))) return servirArquivo(res, candidato);

  // 2. regra de rewrite do vercel.json (SPA)
  const regra = rewrites.find((r) => r.regex.test(urlPath));
  if (regra) {
    const destino = join(DIST, regra.destination.replace(/^[/\\]+/, ""));
    if (await arquivoExiste(destino)) return servirArquivo(res, destino);
  }

  // 3. nada casou -> 404 (exatamente como a Vercel faria)
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("404: NOT_FOUND");
}

async function proxyApi(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  try {
    const upstream = await fetch(`${API_TARGET}${req.url}`, {
      method: req.method,
      headers: {
        ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers["x-idempotency-key"] ? { "x-idempotency-key": req.headers["x-idempotency-key"] } : {}),
        ...(req.headers["x-webhook-signature"] ? { "x-webhook-signature": req.headers["x-webhook-signature"] } : {}),
      },
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(text);
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message: String(error), requestId: "proxy" } }));
  }
}

createServer((req, res) => {
  const url = req.url ?? "/";
  const caminho = url.split("?")[0];
  if (caminho.startsWith("/api/")) return void proxyApi(req, res);
  return void serveStatic(res, caminho);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`MA STORE (validação) em http://127.0.0.1:${PORT}`);
  console.log(`  estático: ${DIST}`);
  console.log(`  proxy:    /api -> ${API_TARGET}`);
});
