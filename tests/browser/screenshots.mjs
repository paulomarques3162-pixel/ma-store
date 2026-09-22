/**
 * Capturas para inspeção visual do redesign (MA STORE).
 * Uso: AUDIT_URL=http://127.0.0.1:4174 node /home/user/audit/shots.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.AUDIT_URL ?? "http://127.0.0.1:4174";
const OUT = "/tmp/final";

const CAPTURAS = [
  { path: "/", name: "home", w: 1440, h: 1050 },
  { path: "/", name: "home-mobile", w: 390, h: 844 },
  { path: "/produtos", name: "catalogo", w: 1440, h: 1000 },
  { path: "/produtos", name: "catalogo-mobile", w: 390, h: 844 },
  { path: "/carrinho", name: "carrinho", w: 1440, h: 900 },
  { path: "/como-comprar", name: "como-comprar", w: 1440, h: 900 },
  { path: "/admin/login", name: "admin-login", w: 1440, h: 900 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  for (const captura of CAPTURAS) {
    const page = await browser.newPage();
    await page.setViewport({ width: captura.w, height: captura.h });
    await page.goto(`${BASE}${captura.path}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: `${OUT}/${captura.name}.png` });
    console.log(`  capturado ${captura.name} (${captura.w}px)`);
    await page.close();
  }

  // Painel administrativo autenticado
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle2" });
  await page.type('input[autocomplete="email"]', "admin@teste.local");
  await page.type('input[autocomplete="current-password"]', "Teste@Admin123");

  const entrar = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Entrar no painel")) ?? null,
  );
  await entrar.asElement()?.click();

  await page.waitForFunction(() => location.pathname.includes("/admin/dashboard"), { timeout: 25_000 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `${OUT}/admin-dashboard.png` });
  console.log("  capturado admin-dashboard");

  await page.goto(`${BASE}/admin/produtos`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${OUT}/admin-produtos.png` });
  console.log("  capturado admin-produtos");

  await page.goto(`${BASE}/admin/testes`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}/admin-laboratorio.png` });
  console.log("  capturado admin-laboratorio");

  await browser.close();
  console.log(`\ncapturas em ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
