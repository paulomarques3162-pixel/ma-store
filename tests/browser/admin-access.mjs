/**
 * TESTE DE ACESSO ADMINISTRATIVO — MA STORE
 *
 * Valida, em navegador real, exatamente o checklist da auditoria de /admin:
 *
 *   1. /admin, /admin/login e demais rotas NÃO retornam 404
 *   2. quem não está autenticado vai para /admin/login (sem loop)
 *   3. cliente autenticado NÃO entra no painel
 *   4. administrador entra em /admin/dashboard
 *   5. refresh nas páginas administrativas continua funcionando
 *   6. o backend continua sendo a autoridade (cliente recebe 403 na API)
 *   7. logout encerra a sessão e volta para /admin/login
 *   8. nenhum erro de console e nenhum segredo na URL
 *
 * Requer o servidor de validação (aplica o vercel.json):
 *   node tests/browser/local-server.mjs
 *
 * Uso: AUDIT_URL=http://127.0.0.1:4174 node tests/browser/admin-access.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.AUDIT_URL ?? "http://127.0.0.1:4174";
const OUT = "/tmp/admin-test";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@teste.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Teste@Admin123";
const CLIENT_EMAIL = `adm-${Date.now()}@teste.local`;
const CLIENT_PASSWORD = "Cliente@12345";

const ROTAS_ADMIN = [
  "/admin",
  "/admin/login",
  "/admin/dashboard",
  "/admin/produtos",
  "/admin/produtos/novo",
  "/admin/categorias",
  "/admin/pedidos",
  "/admin/usuarios",
  "/admin/cupons",
  "/admin/pagamentos",
  "/admin/fretes",
  "/admin/mensagens",
  "/admin/feedbacks",
  "/admin/conteudo",
  "/admin/layout",
  "/admin/notificacoes",
  "/admin/testes",
  "/admin/logs",
  "/admin/configuracoes",
];

const ROTAS_PUBLICAS = ["/", "/login", "/cadastro", "/produtos", "/carrinho", "/checkout", "/minha-conta", "/meus-pedidos", "/mensagens", "/notificacoes"];

const resultados = [];
const registra = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok, detalhe });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function servidorResponde(caminho) {
  const resposta = await fetch(`${BASE}${caminho}`, { redirect: "manual" });
  return { status: resposta.status, tipo: resposta.headers.get("content-type") ?? "" };
}

/**
 * Preenche um campo pelo rótulo (independe da ordem no DOM).
 * Espera o formulário existir antes de preencher — evita corrida entre a
 * navegação e a montagem do React.
 */
async function preencher(page, rotulo, valor) {
  await page
    .waitForFunction(
      (texto) =>
        Array.from(document.querySelectorAll("label")).some((l) =>
          (l.textContent ?? "").trim().toLowerCase().startsWith(texto.toLowerCase()),
        ),
      { timeout: 20_000 },
      rotulo,
    )
    .catch(() => undefined);

  const id = await page.evaluate((texto) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().toLowerCase().startsWith(texto.toLowerCase()),
    );
    return label?.getAttribute("for") ?? null;
  }, rotulo);
  if (!id) {
    const disponiveis = await page.evaluate(() =>
      Array.from(document.querySelectorAll("label")).map((l) => (l.textContent ?? "").trim()).join(" | "),
    );
    throw new Error(`campo "${rotulo}" não encontrado. Labels na tela: ${disponiveis || "(nenhum)"}`);
  }
  await page.click(`#${id}`, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(`#${id}`, valor);
}

async function clicarPorTexto(page, texto) {
  const handle = await page.evaluateHandle(
    (t) => Array.from(document.querySelectorAll("button, a")).find((el) => (el.textContent ?? "").toLowerCase().includes(t.toLowerCase())) ?? null,
    texto,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`elemento "${texto}" não encontrado`);
  await el.click();
}

async function textoDaPagina(page) {
  return page.evaluate(() => document.body.innerText ?? "");
}

async function main() {
  await mkdir(OUT, { recursive: true });

  /* ======================================================================
   * 1) NÍVEL HTTP — nenhuma rota pode devolver 404 (é aqui que a Vercel
   *    falhava: sem rewrite, /admin virava "NOT_FOUND").
   * ==================================================================== */
  console.log("\n1) Resposta HTTP das rotas (sem rewrite da Vercel = 404)");

  let falhasHttp = 0;
  for (const rota of ROTAS_ADMIN) {
    const { status, tipo } = await servidorResponde(rota);
    const ok = status === 200 && tipo.includes("text/html");
    if (!ok) falhasHttp += 1;
    registra(`HTTP ${rota}`, ok, `${status} ${tipo.split(";")[0]}`);
  }

  let falhasPublicas = 0;
  for (const rota of ROTAS_PUBLICAS) {
    const { status, tipo } = await servidorResponde(rota);
    const ok = status === 200 && tipo.includes("text/html");
    if (!ok) falhasPublicas += 1;
    if (!ok) registra(`HTTP ${rota}`, false, `${status}`);
  }
  registra("Rotas públicas continuam respondendo", falhasPublicas === 0, `${ROTAS_PUBLICAS.length - falhasPublicas}/${ROTAS_PUBLICAS.length}`);

  const assets = ["/assets/", "/logo.webp", "/manifest.webmanifest", "/sw.js", "/favicon-32.png"];
  let falhasAssets = 0;
  for (const asset of assets) {
    const resposta = await fetch(`${BASE}${asset}`);
    const ok = resposta.status === 200 && !(resposta.headers.get("content-type") ?? "").includes("text/html");
    if (!ok) falhasAssets += 1;
    if (!ok) registra(`Asset ${asset}`, false, `${resposta.status}`);
  }
  registra("Assets estáticos NÃO são reescritos para o index.html", falhasAssets === 0, `${assets.length} verificados`);

  const api = await servidorResponde("/api/health");
  registra("/api NÃO é reescrito (vai para a API)", !api.tipo.includes("text/html"), `${api.status}`);

  /* ======================================================================
   * 2) NAVEGADOR
   * ==================================================================== */
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  /**
   * Só erro de JavaScript NÃO capturado reprova este teste.
   * Respostas 4xx do próprio app são comportamento esperado (ex.: `/api/admin/*`
   * devolve 403 para cliente) e aparecem como "Failed to load resource".
   */
  const errosConsole = [];
  page.on("pageerror", (e) => errosConsole.push(String(e).slice(0, 160)));

  try {
    /* ---------------------------------------------- 2.1 não autenticado */
    console.log("\n2) Visitante sem sessão");

    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await espera(900);
    let url = new URL(page.url());
    registra("/admin redireciona para o login (sem 404)", url.pathname === "/admin/login", `→ ${url.pathname}`);
    registra("A tela é o login do painel (não a 404)", (await textoDaPagina(page)).includes("Painel"), "");
    await page.screenshot({ path: `${OUT}/1-admin-sem-sessao.png` });

    const semQuerySensivel = !/token|senha|password|jwt|email=/i.test(page.url());
    registra("Nenhuma credencial na URL", semQuerySensivel, "");

    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "networkidle2" });
    await espera(900);
    url = new URL(page.url());
    registra("/admin/dashboard sem sessão → login", url.pathname === "/admin/login", `→ ${url.pathname}`);

    /* --------------------------------------------- 2.2 login do CLIENTE */
    console.log("\n3) Cliente comum tentando o painel");

    const registro = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Cliente Teste Admin",
        email: CLIENT_EMAIL,
        password: CLIENT_PASSWORD,
        confirmPassword: CLIENT_PASSWORD,
        acceptTerms: true,
      }),
    });
    registra("Conta de cliente criada para o teste", registro.status === 201, `HTTP ${registro.status}`);

    await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle2" });
    await preencher(page, "E-mail", CLIENT_EMAIL);
    await preencher(page, "Senha", CLIENT_PASSWORD);
    await page.click('form.auth-form button[type="submit"]');
    await espera(2500);

    const textoAcessoNegado = await textoDaPagina(page);
    const urlAposLoginCliente = new URL(page.url()).pathname;
    const semSessaoAdmin = await page.evaluate(() => localStorage.getItem("mastore.accessToken") === null);
    registra(
      "Cliente vê a mensagem de acesso negado no login",
      textoAcessoNegado.includes("não possui acesso administrativo"),
      textoAcessoNegado.includes("não possui acesso administrativo") ? "" : "mensagem não encontrada",
    );
    registra("Cliente permanece em /admin/login (não entra no painel)", urlAposLoginCliente === "/admin/login", `→ ${urlAposLoginCliente}`);
    registra("O painel NÃO grava sessão para não-administrador", semSessaoAdmin, semSessaoAdmin ? "" : "sessão foi gravada");
    registra("Cliente NÃO é levado ao dashboard", !new URL(page.url()).pathname.includes("dashboard"), `→ ${new URL(page.url()).pathname}`);
    await page.screenshot({ path: `${OUT}/2-cliente-negado.png` });

    // Cliente autenticado tentando abrir uma página administrativa direto
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "networkidle2" });
    await espera(1200);
    const textoRestrita = await textoDaPagina(page);
    registra(
      "Cliente autenticado vê a tela de área restrita",
      textoRestrita.includes("Área restrita") || textoRestrita.includes("não tem permissão"),
      "",
    );
    await page.screenshot({ path: `${OUT}/3-area-restrita.png` });

    // A API precisa bloquear de verdade (o frontend não é a autoridade)
    const tokenCliente = await page.evaluate(() => localStorage.getItem("mastore.accessToken"));
    const apiCliente = await fetch(`${BASE}/api/admin/dashboard`, { headers: { authorization: `Bearer ${tokenCliente}` } });
    registra("Backend bloqueia o cliente na API administrativa", apiCliente.status === 403, `HTTP ${apiCliente.status}`);

    // Encerra a sessão do cliente
    await page.evaluate(() => {
      localStorage.removeItem("mastore.accessToken");
      localStorage.removeItem("mastore.refreshToken");
      localStorage.removeItem("mastore.auth");
    });

    /* -------------------------------------------- 2.3 login do ADMIN */
    console.log("\n4) Administrador");

    await page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle2" });
    await page.reload({ waitUntil: "networkidle2" });
    await preencher(page, "E-mail", ADMIN_EMAIL);
    await preencher(page, "Senha", ADMIN_PASSWORD);
    await page.click('form.auth-form button[type="submit"]');

    await page.waitForFunction(() => location.pathname.includes("/admin/dashboard"), { timeout: 25_000 });
    registra("Administrador entra em /admin/dashboard", true, `→ ${new URL(page.url()).pathname}`);
    await espera(1500);

    const painel = await textoDaPagina(page);
    registra("Painel renderiza o menu administrativo", painel.includes("Dashboard") && painel.includes("Produtos"), "");
    registra("Nome do administrador aparece no topo", painel.includes("Administrador"), "");
    await page.screenshot({ path: `${OUT}/4-admin-dashboard.png` });

    /* ------------------------------------------------- 2.4 refresh/reload */
    console.log("\n5) Refresh nas páginas administrativas");

    const paginasParaRefrescar = ["/admin/dashboard", "/admin/produtos", "/admin/usuarios", "/admin/pedidos", "/admin/configuracoes", "/admin/testes"];
    for (const rota of paginasParaRefrescar) {
      await page.goto(`${BASE}${rota}`, { waitUntil: "networkidle2" });
      await espera(600);
      await page.reload({ waitUntil: "networkidle2" });
      await espera(1400);
      const texto = await textoDaPagina(page);
      const naoEh404 = !texto.includes("404: NOT_FOUND") && !texto.includes("NOT_FOUND");
      const continuaLogado = !new URL(page.url()).pathname.includes("/admin/login");
      registra(`Refresh em ${rota}`, naoEh404 && continuaLogado, continuaLogado ? "sessão mantida" : "caiu para o login");
    }

    /* --------------------------------------------------------- 2.5 logout */
    console.log("\n6) Logout do painel");
    await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "networkidle2" });
    await espera(1200);
    // O painel tem o botão "Sair" no topo; a confirmação fica no modal.
    // Clicar por texto pegaria o botão do topo duas vezes — por isso a seleção
    // é feita por contexto (.admin-topbar e .modal__footer).
    await page.click(".admin-topbar button:last-of-type");
    await page.waitForSelector(".modal__footer", { visible: true, timeout: 10_000 });
    await page.evaluate(() => {
      const botoes = Array.from(document.querySelectorAll(".modal__footer button"));
      const confirmar = botoes.find((b) => (b.textContent ?? "").trim().toLowerCase() === "sair");
      (confirmar ?? botoes[0])?.click();
    });
    await espera(2000);
    registra("Logout volta para /admin/login", new URL(page.url()).pathname === "/admin/login", `→ ${new URL(page.url()).pathname}`);

    const tokenDepois = await page.evaluate(() => localStorage.getItem("mastore.accessToken"));
    registra("Token removido do navegador no logout", tokenDepois === null, "");

    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await espera(1000);
    registra("Após logout, /admin exige login novamente", new URL(page.url()).pathname === "/admin/login", "");
    await page.screenshot({ path: `${OUT}/5-apos-logout.png` });

    /* ------------------------------------------------------- 2.6 console */
    registra("Nenhum erro de JavaScript durante todo o fluxo", errosConsole.length === 0, errosConsole.slice(0, 2).join(" | "));
  } catch (error) {
    registra("Fluxo interrompido", false, String(error).split("\n")[0]);
    await page.screenshot({ path: `${OUT}/99-erro.png` }).catch(() => undefined);
  } finally {
    await browser.close();
  }

  const oks = resultados.filter((r) => r.ok).length;
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n=== ACESSO ADMINISTRATIVO: ${oks} OK · ${falhas} FALHA(S) ===`);
  console.log(`screenshots: ${OUT}\n`);
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
