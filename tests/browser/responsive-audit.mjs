/**
 * AUDITORIA RESPONSIVA AUTOMATIZADA — MA STORE
 *
 * Roda o app real em um Chromium headless e coleta EVIDÊNCIA:
 *  - overflow horizontal em 9 larguras (320 a 1920 px);
 *  - elementos interativos sem rótulo acessível;
 *  - imagens sem atributo alt;
 *  - erros de console;
 *  - requisições que falharam (4xx/5xx);
 *  - screenshots para inspeção visual.
 *
 * Uso: node /home/user/audit/run-audit.mjs [--shots]
 */
import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.AUDIT_URL ?? "http://127.0.0.1:4173";
const OUT = "/tmp/shots";
const WIDTHS = [
  { w: 320, h: 640, label: "320 (mínimo)" },
  { w: 375, h: 812, label: "375 (iPhone SE/8)" },
  { w: 390, h: 844, label: "390 (iPhone 14)" },
  { w: 414, h: 896, label: "414 (iPhone Plus)" },
  { w: 768, h: 1024, label: "768 (tablet)" },
  { w: 1024, h: 768, label: "1024 (tablet grande)" },
  { w: 1280, h: 800, label: "1280 (notebook)" },
  { w: 1440, h: 900, label: "1440 (desktop)" },
  { w: 1920, h: 1080, label: "1920 (grande)" },
];
const PAGES = [
  { path: "/", name: "home" },
  { path: "/produtos", name: "produtos" },
  { path: "/buscar?q=perfume", name: "buscar" },
  { path: "/carrinho", name: "carrinho" },
  { path: "/login", name: "login" },
  { path: "/cadastro", name: "cadastro" },
  { path: "/como-comprar", name: "como-comprar" },
  { path: "/admin/login", name: "admin-login" },
];

const shot = process.argv.includes("--shots");

async function auditPage(browser, path, label, width, height) {
  const page = await browser.newPage();
  const problems = [];

  page.on("console", (message) => {
    if (message.type() === "error") problems.push({ kind: "console", detail: message.text().slice(0, 220) });
  });
  page.on("pageerror", (error) => problems.push({ kind: "js", detail: String(error).slice(0, 220) }));
  page.on("requestfailed", (request) => {
    problems.push({ kind: "net", detail: `${request.method()} ${request.url().replace(BASE, "")} — ${request.failure()?.errorText}` });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400 && response.url().startsWith(BASE)) {
      problems.push({ kind: "http", detail: `${status} ${response.url().replace(BASE, "")}` });
    }
  });

  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 700));

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - window.innerWidth;

    // Elementos que ultrapassam a largura da viewport (causa de rolagem lateral).
    const culprits = [];
    if (overflowX > 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right > window.innerWidth + 1 || rect.left < -1) {
          const style = getComputedStyle(el);
          if (style.position === "fixed" || style.visibility === "hidden") continue;
          culprits.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""}`);
        }
      }
    }

    // Botões/links sem nome acessível (para leitores de tela)
    const semNome = [];
    for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const nome =
        el.getAttribute("aria-label")?.trim() ||
        el.textContent?.trim() ||
        el.querySelector("img")?.getAttribute("alt")?.trim() ||
        "";
      if (!nome) semNome.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] ?? ""}`);
    }

    // Imagens sem alt
    const semAlt = Array.from(document.querySelectorAll("img:not([alt])")).map((img) => img.getAttribute("src"));

    // Campos de formulário sem rótulo
    const camposSemLabel = [];
    for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
      const id = el.id;
      const temLabel = (id && document.querySelector(`label[for="${id}"]`)) || el.closest("label") || el.getAttribute("aria-label");
      if (!temLabel) camposSemLabel.push(`${el.tagName.toLowerCase()}[type=${el.getAttribute("type") ?? "-"}]`);
    }

    return {
      overflowX,
      culprits: [...new Set(culprits)].slice(0, 6),
      semNome: [...new Set(semNome)].slice(0, 6),
      semAlt: [...new Set(semAlt)].slice(0, 6),
      camposSemLabel: [...new Set(camposSemLabel)].slice(0, 6),
      titulo: document.title,
      h1: document.querySelector("h1")?.textContent?.trim().slice(0, 70) ?? null,
      alturaPagina: doc.scrollHeight,
    };
  });

  if (shot) {
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${label}-${width}.png`, fullPage: false });
  }

  await page.close();
  return { path, label, width, metrics, problems };
}

function launchBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions"],
  });
}

async function main() {
  let browser = await launchBrowser();

  const results = [];
  console.log(`\n=== AUDITORIA RESPONSIVA (${BASE}) ===\n`);

  for (const target of PAGES) {
    const perPage = [];
    for (const { w, h, label } of WIDTHS) {
      try {
        perPage.push(await auditPage(browser, target.path, target.name, w, h));
      } catch (error) {
        // O Chromium deste sandbox eventualmente cai; recria e continua a auditoria.
        console.log(`   ! falha em ${target.name}@${w}px: ${String(error).split("\n")[0]} — recriando navegador`);
        try { await browser.close(); } catch { /* ignorado */ }
        browser = await launchBrowser();
        try {
          perPage.push(await auditPage(browser, target.path, target.name, w, h));
        } catch (retry) {
          console.log(`   !! desistindo de ${target.name}@${w}px: ${String(retry).split("\n")[0]}`);
        }
      }
    }
    results.push({ ...target, runs: perPage });

    const comOverflow = perPage.filter((r) => r.metrics.overflowX > 1);
    const semNome = perPage.filter((r) => r.metrics.semNome.length > 0);
    const semAlt = perPage.filter((r) => r.metrics.semAlt.length > 0);
    const semLabel = perPage.filter((r) => r.metrics.camposSemLabel.length > 0);
    const problemas = perPage.flatMap((r) => r.problems);

    console.log(`${target.name.padEnd(18)} overflow: ${comOverflow.length === 0 ? "OK" : comOverflow.map((r) => r.width).join(",") + "px"} | botão sem rótulo: ${semNome.length === 0 ? "OK" : semNome[0].metrics.semNome.join(",")} | img sem alt: ${semAlt.length === 0 ? "OK" : semAlt[0].metrics.semAlt.join(",")} | campo sem label: ${semLabel.length === 0 ? "OK" : semLabel[0].metrics.camposSemLabel.join(",")} | erros: ${problemas.length}`);
    if (comOverflow.length > 0) {
      console.log(`   ↳ causadores em ${comOverflow[0].width}px: ${comOverflow[0].metrics.culprits.join(", ")}`);
    }
    for (const problema of [...new Set(problemas.map((p) => `${p.kind}: ${p.detail}`))].slice(0, 4)) {
      console.log(`   ↳ ${problema}`);
    }
  }

  await browser.close();
  await writeFile("/tmp/audit-result.json", JSON.stringify(results, null, 2));
  console.log(`\nrelatório completo: /tmp/audit-result.json`);

  const totalOverflow = results.reduce((acc, p) => acc + p.runs.filter((r) => r.metrics.overflowX > 1).length, 0);
  const totalSemNome = results.reduce((acc, p) => acc + p.runs.filter((r) => r.metrics.semNome.length > 0).length, 0);
  const totalSemAlt = results.reduce((acc, p) => acc + p.runs.filter((r) => r.metrics.semAlt.length > 0).length, 0);
  const totalSemLabel = results.reduce((acc, p) => acc + p.runs.filter((r) => r.metrics.camposSemLabel.length > 0).length, 0);
  const totalErros = results.reduce((acc, p) => acc + p.runs.reduce((a, r) => a + r.problems.length, 0), 0);

  console.log(`\nRESUMO: ${results.length} páginas × ${WIDTHS.length} larguras`);
  console.log(`  overflow horizontal ....... ${totalOverflow}`);
  console.log(`  botões sem rótulo ......... ${totalSemNome}`);
  console.log(`  imagens sem alt ........... ${totalSemAlt}`);
  console.log(`  campos sem label .......... ${totalSemLabel}`);
  console.log(`  erros (console/js/rede) ... ${totalErros}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
