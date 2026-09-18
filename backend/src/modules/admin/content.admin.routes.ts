import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { diffFields, writeAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { created, ok, parse } from "../../lib/http.js";

const idParam = z.object({ id: z.string().min(1) });

/**
 * Chaves de configuracao/conteudo que o sistema espera.
 *
 * Elas nascem VAZIAS (value = null) de proposito: o painel mostra o campo
 * rotulado e o site publico exibe um placeholder, em vez de inventar dados da
 * loja (CNPJ, PIX, endereco, redes sociais...).
 */
export const DEFAULT_CONTENT_KEYS: Array<{ key: string; group: string; label: string; isPublic: boolean }> = [
  // Identidade / contato
  { key: "store.name", group: "loja", label: "Nome da loja", isPublic: true },
  { key: "store.tagline", group: "loja", label: "Slogan / descricao curta", isPublic: true },
  { key: "store.legalName", group: "loja", label: "Razao social", isPublic: false },
  { key: "store.cnpj", group: "loja", label: "CNPJ", isPublic: true },
  { key: "store.email", group: "loja", label: "E-mail de contato", isPublic: true },
  { key: "store.phone", group: "loja", label: "Telefone", isPublic: true },
  { key: "store.whatsapp", group: "loja", label: "WhatsApp (somente numeros com DDI)", isPublic: true },
  { key: "store.address", group: "loja", label: "Endereco completo", isPublic: true },
  { key: "store.hours", group: "loja", label: "Horario de atendimento", isPublic: true },
  // Redes sociais
  { key: "social.instagram", group: "redes", label: "Instagram", isPublic: true },
  { key: "social.facebook", group: "redes", label: "Facebook", isPublic: true },
  { key: "social.tiktok", group: "redes", label: "TikTok", isPublic: true },
  { key: "social.youtube", group: "redes", label: "YouTube", isPublic: true },
  // Pagamento / recebimento
  { key: "payment.pixKey", group: "pagamento", label: "Chave PIX", isPublic: false },
  { key: "payment.pixHolder", group: "pagamento", label: "Titular da chave PIX", isPublic: false },
  { key: "payment.bankAccount", group: "pagamento", label: "Conta de recebimento", isPublic: false },
  { key: "payment.notes", group: "pagamento", label: "Instrucoes de pagamento", isPublic: true },
  { key: "payment.pixEnabled", group: "pagamento", label: "PIX habilitado (true/false)", isPublic: true },
  { key: "payment.cardEnabled", group: "pagamento", label: "Cartao habilitado (true/false)", isPublic: true },
  { key: "payment.boletoEnabled", group: "pagamento", label: "Boleto habilitado (true/false)", isPublic: true },
  { key: "payment.maxInstallments", group: "pagamento", label: "Maximo de parcelas", isPublic: true },
  { key: "payment.installmentMinValue", group: "pagamento", label: "Valor minimo da parcela", isPublic: true },
  // Frete
  { key: "shipping.originCep", group: "frete", label: "CEP de origem (despacho)", isPublic: false },
  { key: "shipping.freeAbove", group: "frete", label: "Frete gratis acima de (R$)", isPublic: true },
  { key: "shipping.notes", group: "frete", label: "Observacoes de entrega", isPublic: true },
  { key: "shipping.pickupEnabled", group: "frete", label: "Retirada habilitada (true/false)", isPublic: true },
  // Politicas / paginas
  { key: "policy.privacy", group: "politicas", label: "Politica de privacidade", isPublic: true },
  { key: "policy.terms", group: "politicas", label: "Termos de uso", isPublic: true },
  { key: "policy.exchange", group: "politicas", label: "Trocas e devolucoes", isPublic: true },
  { key: "page.how_to_buy", group: "politicas", label: "Como comprar", isPublic: true },
  { key: "page.contact", group: "politicas", label: "Texto da pagina de contato", isPublic: true },
  // Textos da home
  { key: "home.hero.title", group: "home", label: "Titulo do hero", isPublic: true },
  { key: "home.hero.subtitle", group: "home", label: "Subtitulo do hero", isPublic: true },
  { key: "home.hero.ctaLabel", group: "home", label: "Texto do botao do hero", isPublic: true },
  { key: "home.hero.ctaLink", group: "home", label: "Link do botao do hero", isPublic: true },
  { key: "home.section.featured", group: "home", label: "Titulo da secao Destaques", isPublic: true },
  { key: "home.section.launches", group: "home", label: "Titulo da secao Lancamentos", isPublic: true },
  { key: "home.section.offers", group: "home", label: "Titulo da secao Ofertas", isPublic: true },
  { key: "home.section.bestSellers", group: "home", label: "Titulo da secao Mais vendidos", isPublic: true },
  // Rodape
  { key: "footer.about", group: "rodape", label: "Texto sobre a loja (rodape)", isPublic: true },
  { key: "footer.copyright", group: "rodape", label: "Texto de copyright", isPublic: true },
  { key: "newsletter.title", group: "rodape", label: "Titulo da newsletter", isPublic: true },
  { key: "newsletter.subtitle", group: "rodape", label: "Subtitulo da newsletter", isPublic: true },
];

/** Cria as chaves de conteudo que ainda nao existem (sem sobrescrever valores). */
async function ensureContentKeys() {
  await prisma.siteContent.createMany({
    data: DEFAULT_CONTENT_KEYS.map((k) => ({ ...k, value: null })),
    skipDuplicates: true,
  });
}

const bannerBody = z.object({
  title: z.string().trim().max(160).optional().or(z.literal("")),
  subtitle: z.string().trim().max(300).optional().or(z.literal("")),
  imageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  linkUrl: z.string().trim().max(500).optional().or(z.literal("")),
  ctaLabel: z.string().trim().max(60).optional().or(z.literal("")),
  position: z.string().trim().max(40).default("hero"),
  order: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

const themeBody = z.object({
  name: z.string().trim().min(1, "Informe o nome do tema.").max(80),
  settings: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

/** CMS: conteudo, banners, tema visual (com rascunho x publicado) e configuracoes. */
export async function contentAdminRoutes(app: FastifyInstance): Promise<void> {
  // ---- Conteudo -------------------------------------------------------------
  app.get("/content", async (_request, reply) => {
    await ensureContentKeys();
    const items = await prisma.siteContent.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
    return ok(reply, items);
  });

  app.put("/content", async (request, reply) => {
    const input = parse(
      z.object({
        entries: z
          .array(
            z.object({
              key: z.string().trim().min(1).max(120),
              value: z.string().max(20000).nullable().optional(),
            }),
          )
          .min(1),
      }),
      request.body,
    );

    const before = await prisma.siteContent.findMany({
      where: { key: { in: input.entries.map((e) => e.key) } },
      select: { key: true, value: true },
    });

    await prisma.$transaction(
      input.entries.map((entry) =>
        prisma.siteContent.upsert({
          where: { key: entry.key },
          update: { value: entry.value ?? null },
          create: { key: entry.key, value: entry.value ?? null, group: "custom", isPublic: true },
        }),
      ),
    );

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE_CONTENT",
      entity: "SiteContent",
      before,
      after: input.entries,
      ip: request.ip,
      requestId: request.id,
    });

    const items = await prisma.siteContent.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
    return ok(reply, items);
  });

  app.delete("/content/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const current = await prisma.siteContent.findUnique({ where: { id } });
    if (!current) throw notFound("Conteudo nao encontrado.");

    await prisma.siteContent.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE_CONTENT",
      entity: "SiteContent",
      entityId: id,
      before: { key: current.key },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true });
  });

  // ---- Configuracoes (atalho para o grupo de configuracao) -------------------
  app.get("/settings", async (_request, reply) => {
    await ensureContentKeys();
    const items = await prisma.siteContent.findMany({
      where: { group: { in: ["loja", "redes", "pagamento", "frete", "politicas"] } },
      orderBy: [{ group: "asc" }, { key: "asc" }],
      select: { id: true, key: true, value: true, group: true, label: true, isPublic: true },
    });

    const grouped: Record<string, typeof items> = {};
    for (const item of items) {
      grouped[item.group] = grouped[item.group] ?? [];
      grouped[item.group]!.push(item);
    }

    return ok(reply, { items, grouped });
  });

  // ---- Banners --------------------------------------------------------------
  app.get("/banners", async (_request, reply) => {
    const banners = await prisma.banner.findMany({ orderBy: [{ position: "asc" }, { order: "asc" }] });
    return ok(reply, banners);
  });

  app.post("/banners", async (request, reply) => {
    const input = parse(bannerBody, request.body);
    const banner = await prisma.banner.create({
      data: {
        title: input.title || null,
        subtitle: input.subtitle || null,
        imageUrl: input.imageUrl || null,
        linkUrl: input.linkUrl || null,
        ctaLabel: input.ctaLabel || null,
        position: input.position,
        order: input.order,
        active: input.active,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE",
      entity: "Banner",
      entityId: banner.id,
      after: { title: banner.title, position: banner.position },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, banner);
  });

  app.patch("/banners/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(bannerBody.partial(), request.body);

    const current = await prisma.banner.findUnique({ where: { id } });
    if (!current) throw notFound("Banner nao encontrado.");

    const updated = await prisma.banner.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title || null } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle || null } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl || null } : {}),
        ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl || null } : {}),
        ...(input.ctaLabel !== undefined ? { ctaLabel: input.ctaLabel || null } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
      },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE",
      entity: "Banner",
      entityId: id,
      before: { title: current.title, active: current.active, order: current.order },
      after: { title: updated.title, active: updated.active, order: updated.order },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/banners/reorder", async (request, reply) => {
    const input = parse(
      z.object({ items: z.array(z.object({ id: z.string(), order: z.coerce.number().int().min(0) })).min(1) }),
      request.body,
    );

    await prisma.$transaction(
      input.items.map((item) => prisma.banner.update({ where: { id: item.id }, data: { order: item.order } })),
    );

    return ok(reply, { updated: input.items.length });
  });

  app.delete("/banners/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const current = await prisma.banner.findUnique({ where: { id }, select: { title: true } });
    if (!current) throw notFound("Banner nao encontrado.");

    await prisma.banner.delete({ where: { id } });
    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE",
      entity: "Banner",
      entityId: id,
      before: { title: current.title },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true });
  });

  // ---- Tema (rascunho x publicado) -----------------------------------------
  app.get("/theme", async (_request, reply) => {
    const [draft, active, history] = await Promise.all([
      prisma.siteTheme.findFirst({ where: { isDraft: true }, orderBy: { updatedAt: "desc" } }),
      prisma.siteTheme.findFirst({ where: { isActive: true } }),
      prisma.siteTheme.findMany({
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, name: true, isDraft: true, isActive: true, publishedAt: true, updatedAt: true },
      }),
    ]);

    return ok(reply, { draft, active, history });
  });

  app.post("/theme", async (request, reply) => {
    const input = parse(themeBody, request.body);

    const theme = await prisma.siteTheme.create({
      data: { name: input.name, settings: input.settings, isDraft: true, isActive: false },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CREATE_THEME_DRAFT",
      entity: "SiteTheme",
      entityId: theme.id,
      after: { name: theme.name },
      ip: request.ip,
      requestId: request.id,
    });

    return created(reply, theme);
  });

  app.patch("/theme/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(themeBody.partial(), request.body);

    const current = await prisma.siteTheme.findUnique({ where: { id } });
    if (!current) throw notFound("Tema nao encontrado.");
    if (current.isActive) {
      throw badRequest("O tema publicado nao pode ser editado. Crie um rascunho para alterar.");
    }

    const updated = await prisma.siteTheme.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.settings ? { settings: input.settings } : {}),
      },
    });

    const diff = diffFields({ settings: JSON.stringify(current.settings) }, { settings: JSON.stringify(updated.settings) });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE_THEME_DRAFT",
      entity: "SiteTheme",
      entityId: id,
      before: { name: current.name, ...(diff.before.settings ? { settings: diff.before.settings } : {}) },
      after: { name: updated.name, ...(diff.after.settings ? { settings: diff.after.settings } : {}) },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.post("/theme/:id/publish", async (request, reply) => {
    const { id } = parse(idParam, request.params);

    const theme = await prisma.siteTheme.findUnique({ where: { id } });
    if (!theme) throw notFound("Tema nao encontrado.");

    const published = await prisma.$transaction(async (tx) => {
      await tx.siteTheme.updateMany({ where: { isActive: true }, data: { isActive: false, isDraft: false } });
      return tx.siteTheme.update({
        where: { id },
        data: { isActive: true, isDraft: false, publishedAt: new Date() },
      });
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "PUBLISH_THEME",
      entity: "SiteTheme",
      entityId: id,
      after: { name: published.name, publishedAt: published.publishedAt },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, published);
  });

  /** Duplica um tema para edicao sem afetar o publicado. */
  app.post("/theme/:id/draft", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const source = await prisma.siteTheme.findUnique({ where: { id } });
    if (!source) throw notFound("Tema nao encontrado.");

    const draft = await prisma.siteTheme.create({
      data: {
        name: `${source.name} (rascunho)`,
        settings: source.settings as object,
        isDraft: true,
        isActive: false,
      },
    });

    return created(reply, draft);
  });

  app.delete("/theme/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const theme = await prisma.siteTheme.findUnique({ where: { id } });
    if (!theme) throw notFound("Tema nao encontrado.");
    if (theme.isActive) throw badRequest("Nao e possivel excluir o tema publicado.");

    await prisma.siteTheme.delete({ where: { id } });
    return ok(reply, { deleted: true });
  });
}
