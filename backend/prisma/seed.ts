/**
 * Seed da MA STORE.
 *
 * REGRAS DESTE SEED:
 *  - Todo registro criado aqui e marcado como DEMONSTRACAO/TESTE (`isDemo`),
 *    com prefixo "[DEMO]" no nome e `active: false`.
 *  - Produtos, categorias, marcas e cupons de demonstracao NAO aparecem para o
 *    cliente enquanto o administrador nao os ativar de verdade.
 *  - O administrador inicial e um usuario de TESTE com senha temporaria e
 *    `mustChangePassword: true` (troca obrigatoria no primeiro acesso).
 *  - Nenhum dado real da loja (CNPJ, PIX, endereco, telefone, redes sociais) e
 *    inventado: as chaves de conteudo sao criadas VAZIAS para preenchimento.
 *
 * Uso: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

const DEMO = "[DEMO]";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@teste.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Teste@Admin123";

/**
 * Chaves de conteudo/configuracao esperadas pelo sistema.
 * Todas nascem vazias (value: null) - o admin preenche com os dados reais.
 */
const CONTENT_KEYS: Array<{ key: string; group: string; label: string; isPublic: boolean }> = [
  { key: "store.name", group: "loja", label: "Nome da loja", isPublic: true },
  { key: "store.tagline", group: "loja", label: "Slogan / descricao curta", isPublic: true },
  { key: "store.legalName", group: "loja", label: "Razao social", isPublic: false },
  { key: "store.cnpj", group: "loja", label: "CNPJ", isPublic: true },
  { key: "store.email", group: "loja", label: "E-mail de contato", isPublic: true },
  { key: "store.phone", group: "loja", label: "Telefone", isPublic: true },
  { key: "store.whatsapp", group: "loja", label: "WhatsApp (somente numeros com DDI)", isPublic: true },
  { key: "store.address", group: "loja", label: "Endereco completo", isPublic: true },
  { key: "store.hours", group: "loja", label: "Horario de atendimento", isPublic: true },
  { key: "social.instagram", group: "redes", label: "Instagram", isPublic: true },
  { key: "social.facebook", group: "redes", label: "Facebook", isPublic: true },
  { key: "social.tiktok", group: "redes", label: "TikTok", isPublic: true },
  { key: "social.youtube", group: "redes", label: "YouTube", isPublic: true },
  { key: "payment.pixKey", group: "pagamento", label: "Chave PIX", isPublic: false },
  { key: "payment.pixHolder", group: "pagamento", label: "Titular da chave PIX", isPublic: false },
  { key: "payment.bankAccount", group: "pagamento", label: "Conta de recebimento", isPublic: false },
  { key: "payment.notes", group: "pagamento", label: "Instrucoes de pagamento", isPublic: true },
  { key: "payment.pixEnabled", group: "pagamento", label: "PIX habilitado (true/false)", isPublic: true },
  { key: "payment.cardEnabled", group: "pagamento", label: "Cartao habilitado (true/false)", isPublic: true },
  { key: "payment.boletoEnabled", group: "pagamento", label: "Boleto habilitado (true/false)", isPublic: true },
  { key: "payment.maxInstallments", group: "pagamento", label: "Maximo de parcelas", isPublic: true },
  { key: "payment.installmentMinValue", group: "pagamento", label: "Valor minimo da parcela", isPublic: true },
  { key: "shipping.originCep", group: "frete", label: "CEP de origem (despacho)", isPublic: false },
  { key: "shipping.freeAbove", group: "frete", label: "Frete gratis acima de (R$)", isPublic: true },
  { key: "shipping.notes", group: "frete", label: "Observacoes de entrega", isPublic: true },
  { key: "shipping.pickupEnabled", group: "frete", label: "Retirada habilitada (true/false)", isPublic: true },
  { key: "policy.privacy", group: "politicas", label: "Politica de privacidade", isPublic: true },
  { key: "policy.terms", group: "politicas", label: "Termos de uso", isPublic: true },
  { key: "policy.exchange", group: "politicas", label: "Trocas e devolucoes", isPublic: true },
  { key: "page.how_to_buy", group: "politicas", label: "Como comprar", isPublic: true },
  { key: "page.contact", group: "politicas", label: "Texto da pagina de contato", isPublic: true },
  { key: "home.hero.title", group: "home", label: "Titulo do hero", isPublic: true },
  { key: "home.hero.subtitle", group: "home", label: "Subtitulo do hero", isPublic: true },
  { key: "home.hero.ctaLabel", group: "home", label: "Texto do botao do hero", isPublic: true },
  { key: "home.hero.ctaLink", group: "home", label: "Link do botao do hero", isPublic: true },
  { key: "home.section.featured", group: "home", label: "Titulo da secao Destaques", isPublic: true },
  { key: "home.section.launches", group: "home", label: "Titulo da secao Lancamentos", isPublic: true },
  { key: "home.section.offers", group: "home", label: "Titulo da secao Ofertas", isPublic: true },
  { key: "home.section.bestSellers", group: "home", label: "Titulo da secao Mais vendidos", isPublic: true },
  { key: "footer.about", group: "rodape", label: "Texto sobre a loja (rodape)", isPublic: true },
  { key: "footer.copyright", group: "rodape", label: "Texto de copyright", isPublic: true },
  { key: "newsletter.title", group: "rodape", label: "Titulo da newsletter", isPublic: true },
  { key: "newsletter.subtitle", group: "rodape", label: "Subtitulo da newsletter", isPublic: true },
];

const DEMO_CATEGORIES = [
  { name: `${DEMO} Decants`, slug: "demo-decants", position: 1 },
  { name: `${DEMO} Perfumes Femininos`, slug: "demo-perfumes-femininos", position: 2 },
  { name: `${DEMO} Perfumes Masculinos`, slug: "demo-perfumes-masculinos", position: 3 },
  { name: `${DEMO} Perfumes Arabes`, slug: "demo-perfumes-arabes", position: 4 },
  { name: `${DEMO} Contratipos`, slug: "demo-contratipos", position: 5 },
  { name: `${DEMO} Kits`, slug: "demo-kits", position: 6 },
];

const DEMO_BRANDS = [
  { name: `${DEMO} Marca Exemplo A`, slug: "demo-marca-a" },
  { name: `${DEMO} Marca Exemplo B`, slug: "demo-marca-b" },
];

const DEMO_PRODUCTS = [
  { name: `${DEMO} Perfume Exemplo 100ml`, slug: "demo-perfume-exemplo-100ml", sku: "DEMO-001", price: "199.90", comparePrice: "249.90", volume: "100ml", stock: 10, categorySlug: "demo-perfumes-femininos", brandSlug: "demo-marca-a", isFeatured: true },
  { name: `${DEMO} Perfume Exemplo 50ml`, slug: "demo-perfume-exemplo-50ml", sku: "DEMO-002", price: "129.90", volume: "50ml", stock: 8, categorySlug: "demo-perfumes-masculinos", brandSlug: "demo-marca-b", isLaunch: true },
  { name: `${DEMO} Decant Exemplo 10ml`, slug: "demo-decant-exemplo-10ml", sku: "DEMO-003", price: "39.90", volume: "10ml", stock: 25, categorySlug: "demo-decants", brandSlug: "demo-marca-a", isBestSeller: true },
  { name: `${DEMO} Perfume Arabe Exemplo 100ml`, slug: "demo-perfume-arabe-exemplo", sku: "DEMO-004", price: "249.90", comparePrice: "299.90", volume: "100ml", stock: 5, categorySlug: "demo-perfumes-arabes", brandSlug: "demo-marca-b" },
  { name: `${DEMO} Contratipo Exemplo 100ml`, slug: "demo-contratipo-exemplo", sku: "DEMO-005", price: "89.90", volume: "100ml", stock: 15, categorySlug: "demo-contratipos", brandSlug: "demo-marca-a" },
  { name: `${DEMO} Kit Exemplo 3x30ml`, slug: "demo-kit-exemplo", sku: "DEMO-006", price: "159.90", comparePrice: "199.90", volume: "3x30ml", stock: 6, categorySlug: "demo-kits", brandSlug: "demo-marca-b", isFeatured: true },
];

async function main() {
  console.log("\n=== MA STORE - seed ===\n");

  // 1. Administrador inicial (TESTE, com troca de senha obrigatoria) ----------
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", status: "ACTIVE", isDemo: true },
    create: {
      name: `${DEMO} Administrador`,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      isDemo: true,
      mustChangePassword: true,
    },
  });
  console.log(`  admin de TESTE: ${admin.email} (senha: ${ADMIN_PASSWORD})`);
  console.log("  -> troque a senha no primeiro acesso.\n");

  // 2. Chaves de conteudo (VAZIAS - o admin preenche) ------------------------
  const created = await prisma.siteContent.createMany({
    data: CONTENT_KEYS.map((k) => ({ ...k, value: null })),
    skipDuplicates: true,
  });
  console.log(`  chaves de conteudo/configuracao: ${created.count} criadas (valores vazios)\n`);

  // 3. Categorias de demonstracao (INATIVAS) ---------------------------------
  for (const category of DEMO_CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { ...category, active: false, isDemo: true, description: `${DEMO} Categoria de demonstracao - edite ou exclua.` },
    });
  }
  console.log(`  categorias ${DEMO}: ${DEMO_CATEGORIES.length} (inativas)\n`);

  // 4. Marcas de demonstracao (INATIVAS) -------------------------------------
  for (const brand of DEMO_BRANDS) {
    await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: {},
      create: { ...brand, active: false, isDemo: true },
    });
  }
  console.log(`  marcas ${DEMO}: ${DEMO_BRANDS.length} (inativas)\n`);

  // 5. Produtos de demonstracao (INATIVOS, sem imagem inventada) -------------
  let productCount = 0;
  for (const product of DEMO_PRODUCTS) {
    const category = await prisma.category.findUnique({ where: { slug: product.categorySlug } });
    const brand = await prisma.brand.findUnique({ where: { slug: product.brandSlug } });

    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: {
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        shortDescription: `${DEMO} Produto de demonstracao - substitua pelos dados reais.`,
        description:
          `${DEMO} Este produto existe apenas para demonstrar o funcionamento da loja. ` +
          "Ele NAO aparece para clientes enquanto nao for ativado pelo administrador.",
        price: product.price,
        comparePrice: product.comparePrice ?? null,
        volume: product.volume,
        stock: product.stock,
        minStock: 2,
        active: false,
        isDemo: true,
        isFeatured: product.isFeatured ?? false,
        isLaunch: product.isLaunch ?? false,
        isBestSeller: product.isBestSeller ?? false,
        categoryId: category?.id ?? null,
        brandId: brand?.id ?? null,
        // Sem imagens: o frontend mostra um placeholder elegante.
      },
    });
    productCount += 1;
  }
  console.log(`  produtos ${DEMO}: ${productCount} (inativos, sem imagens)\n`);

  // 6. Modalidades de frete de demonstracao (INATIVAS) -----------------------
  const existingShipping = await prisma.shippingMethod.count();
  if (existingShipping === 0) {
    await prisma.shippingMethod.createMany({
      data: [
        {
          name: `${DEMO} Entrega padrao`,
          description: `${DEMO} Configure o valor real ou exclua esta modalidade.`,
          carrier: null,
          price: "0.00",
          minDays: 3,
          maxDays: 10,
          regions: [],
          active: false,
          position: 1,
        },
        {
          name: `${DEMO} Retirada na loja`,
          description: `${DEMO} Configure o endereco real de retirada ou exclua.`,
          carrier: null,
          price: "0.00",
          minDays: 0,
          maxDays: 0,
          regions: [],
          active: false,
          position: 2,
        },
      ],
    });
    console.log(`  modalidades de frete ${DEMO}: 2 (inativas)\n`);
  }

  // 7. Cupom de demonstracao (INATIVO) ---------------------------------------
  await prisma.coupon.upsert({
    where: { code: "DEMO10" },
    update: {},
    create: {
      code: "DEMO10",
      description: `${DEMO} Cupom de demonstracao - 10% (inativo).`,
      type: "PERCENT",
      value: "10.00",
      active: false,
      appliesToAll: true,
      isDemo: true,
      maxUsesPerUser: 1,
    },
  });
  console.log("  cupom DEMO10: 1 (inativo)\n");

  console.log("=== seed concluido ===");
  console.log("\nPROXIMOS PASSOS:");
  console.log("  1. Entre no painel com o admin de teste e TROQUE A SENHA.");
  console.log("  2. Preencha Configuracoes (loja, contato, PIX, politicas, frete).");
  console.log("  3. Ative ou exclua os itens [DEMO] e cadastre os produtos reais.");
  console.log("  4. Cadastre ao menos uma modalidade de frete ATIVA antes de vender.\n");
}

main()
  .catch((error) => {
    console.error("Falha no seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
