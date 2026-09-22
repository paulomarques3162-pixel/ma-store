/**
 * TESTE END-TO-END NO NAVEGADOR — MA STORE
 *
 * Percorre o fluxo real de compra em um Chromium de verdade, interagindo com a
 * interface (não chama a API direto para executar a ação). É a evidência que a
 * auditoria exige: uma funcionalidade só é FUNCIONAL quando há execução
 * comprovada no fluxo completo.
 *
 *   cadastro → sessão persistente → catálogo/filtro → produto → carrinho (gaveta)
 *   → checkout (endereço → entrega → pagamento → revisão) → pedido → comprovante
 *   → histórico → proteção contra duplo clique
 *
 * Uso: AUDIT_URL=http://127.0.0.1:4174 node /home/user/audit/e2e.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";

const BASE = process.env.AUDIT_URL ?? "http://127.0.0.1:4174";
const OUT = "/tmp/e2e";
const EMAIL = `e2e-${Date.now()}@teste.local`;
const SENHA = "E2e@12345";

const passos = [];
const ok = (nome, detalhe = "") => {
  passos.push({ nome, resultado: "OK", detalhe });
  console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};
const falha = (nome, detalhe) => {
  passos.push({ nome, resultado: "FALHOU", detalhe });
  console.log(`  ✗ ${nome} — ${detalhe}`);
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, selector, timeout = 15_000) {
  return page.waitForSelector(selector, { visible: true, timeout });
}

/** Preenche um campo pelo RÓTULO (independe de ordem/índice no DOM). */
async function preencher(page, rotulo, valor) {
  const id = await page.evaluate((texto) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().toLowerCase().startsWith(texto.toLowerCase()),
    );
    return label?.getAttribute("for") ?? null;
  }, rotulo);

  if (!id) throw new Error(`campo "${rotulo}" não encontrado`);
  await page.click(`#${id}`, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(`#${id}`, valor);
  return true;
}

/** Clica no primeiro elemento (button/a/span) cujo texto contenha o alvo. */
async function clicarTexto(page, texto, seletor = "button") {
  const handle = await page.evaluateHandle(
    (t, sel) => Array.from(document.querySelectorAll(sel)).find((el) => (el.textContent ?? "").toLowerCase().includes(t.toLowerCase())) ?? null,
    texto,
    seletor,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`elemento "${texto}" (${seletor}) não encontrado`);
  await el.click();
}

async function pedidosDoUsuario(page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem("mastore.accessToken");
    const res = await fetch("/api/orders?perPage=50", { headers: { authorization: `Bearer ${token}` } });
    const json = await res.json();
    return json?.meta?.total ?? 0;
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) erros.push(m.text().slice(0, 160));
  });

  try {
    /* ------------------------------------------------------------ CADASTRO */
    console.log("\n1) Cadastro");
    await page.goto(`${BASE}/cadastro`, { waitUntil: "networkidle2" });
    await waitFor(page, "form.auth-form");

    await preencher(page, "Nome completo", "Cliente E2E Navegador");
    await preencher(page, "E-mail", EMAIL);
    await preencher(page, "Senha", SENHA);
    await preencher(page, "Confirmar senha", SENHA);

    await page.click('input[type="checkbox"]');
    const aceitou = await page.$eval('input[type="checkbox"]', (el) => el.checked);
    aceitou ? ok("aceite dos termos marca o checkbox") : falha("aceite dos termos", "checkbox não marcou");

    await page.screenshot({ path: `${OUT}/1-cadastro.png` });
    await clicarTexto(page, "Criar conta");
    await page.waitForFunction(() => location.pathname.startsWith("/minha-conta"), { timeout: 20_000 });
    ok("cadastro cria a conta e entra", "rota /minha-conta");

    /* ----------------------------------------------------- SESSÃO PERSISTE */
    console.log("\n2) Sessão");
    await page.reload({ waitUntil: "networkidle2" });
    await espera(1200);
    page.url().includes("/login")
      ? falha("sessão persiste após reload", "redirecionou para /login")
      : ok("sessão persiste após recarregar");

    /* -------------------------------------------------------------- CATÁLOGO */
    console.log("\n3) Catálogo e filtros");
    await page.goto(`${BASE}/produtos`, { waitUntil: "networkidle2" });
    await waitFor(page, ".product-card");
    const total = await page.$$eval(".product-card", (els) => els.length);
    ok("vitrine lista produtos", `${total} cards`);

    await page.click(".filters .checkbox input"); // "Somente produtos em estoque"
    await espera(1400);
    const filtrado = await page.$$eval(".product-card", (els) => els.length);
    filtrado > 0 && filtrado <= total ? ok("filtro de estoque aplicado", `${filtrado} cards`) : falha("filtro de estoque", `${filtrado} cards`);

    const semEstoque = await page.$$eval(".product-card", (els) =>
      els.filter((el) => el.textContent?.includes("Produto indisponível")).length,
    );
    semEstoque === 0 ? ok("filtro esconde produtos sem estoque") : falha("filtro", `${semEstoque} indisponíveis visíveis`);
    await page.screenshot({ path: `${OUT}/2-produtos.png` });

    /* ------------------------------------------------- PRODUTO E CARRINHO */
    console.log("\n4) Produto e carrinho");
    await page.click(".product-card__name");
    await waitFor(page, ".product-info__title");
    const nome = await page.$eval(".product-info__title", (el) => (el.textContent ?? "").trim());
    ok("página do produto abre", nome.slice(0, 42));
    await page.screenshot({ path: `${OUT}/3-produto.png` });

    await page.click(".qty-selector button:last-child"); // aumenta para 2
    await espera(300);
    await clicarTexto(page, "Adicionar ao carrinho");
    await espera(1800);
    const gaveta = await page.$(".drawer");
    gaveta ? ok("gaveta do carrinho abre") : falha("gaveta do carrinho", "não abriu");

    const qtdCarrinho = await page.$$eval(".drawer .qty-selector__value", (els) => els[0]?.textContent?.trim() ?? "");
    qtdCarrinho === "2" ? ok("quantidade respeitada no carrinho", "2 unidades") : falha("quantidade", `carrinho mostra ${qtdCarrinho}`);
    await page.screenshot({ path: `${OUT}/4-carrinho.png` });

    /* ------------------------------------------------------------ CHECKOUT */
    console.log("\n5) Checkout");
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
    await waitFor(page, ".checkout-steps");
    ok("checkout abre");

    // Quando o cliente ainda não tem endereço, o formulário já vem aberto.
    const temFormularioCep = await page.evaluate(() =>
      Array.from(document.querySelectorAll("label")).some((l) => (l.textContent ?? "").trim().startsWith("CEP")),
    );
    if (!temFormularioCep) {
      await clicarTexto(page, "novo endereço", ".option-item");
      await espera(700);
    }

    await preencher(page, "CEP", "01310100");
    await preencher(page, "Rua", "Avenida de Teste");
    await preencher(page, "Número", "100");
    await preencher(page, "Bairro", "Bela Vista");
    await preencher(page, "Cidade", "Sao Paulo");
    await page.screenshot({ path: `${OUT}/5-endereco.png` });

    await clicarTexto(page, "Continuar");
    await espera(3000);
    const etapa = await page.$eval(".checkout-step--active", (el) => (el.textContent ?? "").trim());
    etapa.includes("Entrega") ? ok("endereço salvo e avançou para entrega") : falha("avanço de etapa", etapa);

    const frete = await page.$(".option-list .option-item");
    frete ? await frete.click() : falha("frete", "nenhuma modalidade listada");
    await page.screenshot({ path: `${OUT}/6-entrega.png` });

    await clicarTexto(page, "Continuar");
    await espera(1500);
    const pagamento = await page.$(".option-list .option-item");
    pagamento ? await pagamento.click() : falha("pagamento", "nenhuma forma listada");
    await page.screenshot({ path: `${OUT}/7-pagamento.png` });

    await clicarTexto(page, "Continuar");
    await espera(1500);
    await page.screenshot({ path: `${OUT}/8-revisao.png` });

    const temRevisao = await page.evaluate(() => document.body.textContent?.includes("Revise seu pedido") ?? false);
    temRevisao ? ok("revisão com itens, endereço e pagamento") : falha("revisão", "não chegou na etapa");

    await clicarTexto(page, "Finalizar pedido");
    await page.waitForFunction(() => /\/meus-pedidos\/.+/.test(location.pathname), { timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector(".page-header__title")?.textContent ?? "").includes("MA-"), { timeout: 20_000 });
    const numeroPedido = await page.$eval(".page-header__title", (el) => (el.textContent ?? "").trim());
    ok("pedido criado no navegador", numeroPedido);
    await page.screenshot({ path: `${OUT}/9-pedido.png`, fullPage: true });

    /* --------------------------------------------------- COMPROVANTE/HISTÓRICO */
    console.log("\n6) Comprovante e histórico");
    (await page.$("#comprovante")) ? ok("comprovante presente na página do pedido") : falha("comprovante", "não encontrado");

    await page.goto(`${BASE}/meus-pedidos`, { waitUntil: "networkidle2" });
    await waitFor(page, ".order-card");
    ok("histórico lista o pedido", `${await page.$$eval(".order-card", (e) => e.length)} pedido(s)`);
    await page.screenshot({ path: `${OUT}/10-meus-pedidos.png` });

    /* --------------------------------------------- PROTEÇÃO CONTRA DUPLO CLIQUE */
    console.log("\n7) Duplo clique em finalizar");
    const antes = await pedidosDoUsuario(page);
    await page.goto(`${BASE}/produtos`, { waitUntil: "networkidle2" });
    await waitFor(page, ".product-card");
    await clicarTexto(page, "Comprar");
    await espera(1800);

    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle2" });
    await waitFor(page, ".checkout-steps");
    await waitFor(page, ".option-item", 20_000); // aguarda os endereços carregarem
    await page.click(".option-item"); // endereço salvo
    await clicarTexto(page, "Continuar");
    await espera(2500);
    const frete2 = await page.$(".option-list .option-item");
    if (frete2) await frete2.click();
    await clicarTexto(page, "Continuar");
    await espera(1200);
    const pag2 = await page.$(".option-list .option-item");
    if (pag2) await pag2.click();
    await clicarTexto(page, "Continuar");
    await espera(1200);

    const botao = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Finalizar pedido")) ?? null,
    );
    const el = botao.asElement();
    if (el) {
      await Promise.all([el.click().catch(() => undefined), el.click().catch(() => undefined)]);
      await espera(5000);
      const depois = await pedidosDoUsuario(page);
      depois === antes + 1
        ? ok("duplo clique criou exatamente 1 pedido", `${antes} → ${depois}`)
        : falha("idempotência do checkout", `${antes} → ${depois}`);
    } else {
      falha("duplo clique", "botão não encontrado");
    }

    erros.length === 0 ? ok("nenhum erro de console/JS no fluxo") : falha("erros de console", erros.slice(0, 3).join(" | "));
  } catch (error) {
    falha("fluxo interrompido", String(error).split("\n")[0]);
    await page.screenshot({ path: `${OUT}/99-erro.png` }).catch(() => undefined);
  } finally {
    await browser.close();
  }

  const oks = passos.filter((p) => p.resultado === "OK").length;
  const falhas = passos.filter((p) => p.resultado === "FALHOU").length;
  console.log(`\n=== E2E NO NAVEGADOR: ${oks} OK · ${falhas} FALHA(S) ===`);
  console.log(`screenshots: ${OUT}`);
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
