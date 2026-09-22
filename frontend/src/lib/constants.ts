/**
 * Rótulos e metadados de domínio (espelham os enums do backend).
 * Centralizados aqui para que nenhuma página invente textos próprios.
 */

import type {
  ConversationStatus,
  FeedbackType,
  ModerationStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  UserStatus,
} from "@/types/api";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone; description: string }> = {
  AWAITING_PAYMENT: { label: "Aguardando pagamento", tone: "warning", description: "Pedido criado, aguardando o pagamento." },
  PAYMENT_REVIEW: { label: "Pagamento em análise", tone: "info", description: "O pagamento está em análise." },
  PAID: { label: "Pago", tone: "success", description: "Pagamento confirmado." },
  PREPARING: { label: "Preparando pedido", tone: "info", description: "Seu pedido está sendo separado." },
  SHIPPED: { label: "Enviado", tone: "info", description: "Pedido enviado." },
  DELIVERED: { label: "Entregue", tone: "success", description: "Pedido entregue." },
  CANCELED: { label: "Cancelado", tone: "danger", description: "Pedido cancelado." },
  REFUNDED: { label: "Reembolsado", tone: "neutral", description: "Pedido reembolsado." },
};

/** Ordem cronológica usada na linha do tempo do pedido. */
export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "PAID",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
];

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de crédito",
  BOLETO: "Boleto",
  MANUAL: "Combinado com a loja",
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendente", tone: "warning" },
  APPROVED: { label: "Aprovado", tone: "success" },
  DECLINED: { label: "Recusado", tone: "danger" },
  CANCELED: { label: "Cancelado", tone: "neutral" },
  EXPIRED: { label: "Expirado", tone: "neutral" },
  REFUNDED: { label: "Reembolsado", tone: "info" },
};

export const MODERATION_STATUS: Record<ModerationStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Aguardando moderação", tone: "warning" },
  APPROVED: { label: "Publicado", tone: "success" },
  REJECTED: { label: "Não publicado", tone: "danger" },
};

export const FEEDBACK_TYPE: Record<FeedbackType, string> = {
  PRODUCT: "Produto",
  DELIVERY: "Entrega",
  EXPERIENCE: "Experiência de compra",
};

export const CONVERSATION_STATUS: Record<ConversationStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Aberta", tone: "info" },
  ARCHIVED: { label: "Arquivada", tone: "neutral" },
  RESOLVED: { label: "Resolvida", tone: "success" },
};

export const USER_STATUS: Record<UserStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Ativa", tone: "success" },
  BLOCKED: { label: "Bloqueada", tone: "danger" },
  PENDING: { label: "Pendente", tone: "warning" },
};

/** Ordenações disponíveis na vitrine (mesmos valores aceitos pela API). */
export const SORT_OPTIONS = [
  { value: "relevance", label: "Relevância" },
  { value: "newest", label: "Novidades" },
  { value: "best_sellers", label: "Mais vendidos" },
  { value: "price_asc", label: "Menor preço" },
  { value: "price_desc", label: "Maior preço" },
  { value: "name_asc", label: "Nome (A–Z)" },
] as const;

/** UFs do Brasil (mesma lista exposta por `GET /api/shipping/ufs`). */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Mensagens de estado vazio (padronizadas em todo o app). */
export const EMPTY_MESSAGES = {
  cart: { title: "Seu carrinho está vazio", text: "Adicione produtos para continuar a compra." },
  favorites: { title: "Nenhum produto favoritado", text: "Toque no coração dos produtos que você quer acompanhar." },
  orders: { title: "Você ainda não possui pedidos", text: "Quando você comprar, seus pedidos aparecem aqui." },
  messages: { title: "Nenhuma conversa", text: "Abra uma conversa para falar com o atendimento." },
  products: { title: "Nenhum produto encontrado", text: "Tente ajustar a busca ou remover alguns filtros." },
  notifications: { title: "Nenhuma notificação", text: "Você será avisado sobre seus pedidos aqui." },
  reviews: { title: "Nenhuma avaliação ainda", text: "As avaliações aparecem depois da moderação." },
  feedback: { title: "Nenhum feedback enviado", text: "Conte como foi sua experiência de compra." },
  addresses: { title: "Nenhum endereço cadastrado", text: "Cadastre um endereço para finalizar suas compras mais rápido." },
  coupons: { title: "Nenhum cupom ativo", text: "Crie cupons para suas campanhas." },
  adminProducts: { title: "Nenhum produto cadastrado", text: "Cadastre o primeiro produto para ele aparecer na loja." },
  conversations: { title: "Nenhuma conversa", text: "As mensagens dos clientes aparecem aqui." },
  payments: { title: "Nenhum pagamento registrado", text: "Os pagamentos aparecem aqui assim que houver pedidos." },
} as const;

/** Chaves de conteúdo do CMS usadas pelo frontend (todas podem vir nulas). */
export const CONTENT_KEYS = {
  storeName: "store.name",
  storeTagline: "store.tagline",
  storeEmail: "store.email",
  storePhone: "store.phone",
  storeWhatsapp: "store.whatsapp",
  storeAddress: "store.address",
  storeHours: "store.hours",
  storeCnpj: "store.cnpj",
  instagram: "social.instagram",
  facebook: "social.facebook",
  tiktok: "social.tiktok",
  youtube: "social.youtube",
  pixEnabled: "payment.pixEnabled",
  cardEnabled: "payment.cardEnabled",
  boletoEnabled: "payment.boletoEnabled",
  maxInstallments: "payment.maxInstallments",
  installmentMinValue: "payment.installmentMinValue",
  paymentNotes: "payment.notes",
  shippingNotes: "shipping.notes",
  pickupEnabled: "shipping.pickupEnabled",
  freeAbove: "shipping.freeAbove",
  policyPrivacy: "policy.privacy",
  policyTerms: "policy.terms",
  policyExchange: "policy.exchange",
  howToBuy: "page.how_to_buy",
  contactPage: "page.contact",
  heroTitle: "home.hero.title",
  heroSubtitle: "home.hero.subtitle",
  heroCtaLabel: "home.hero.ctaLabel",
  heroCtaLink: "home.hero.ctaLink",
  sectionFeatured: "home.section.featured",
  sectionLaunches: "home.section.launches",
  sectionOffers: "home.section.offers",
  sectionBestSellers: "home.section.bestSellers",
  footerAbout: "footer.about",
  footerCopyright: "footer.copyright",
  newsletterTitle: "newsletter.title",
  newsletterSubtitle: "newsletter.subtitle",
} as const;

/**
 * Os cinco status oficiais do pedido Guest (fonte unica no frontend).
 * Mantido em sincronia com `ORDER_STATUSES` do backend.
 */
export const ORDER_STATUSES_PT = [
  "Aguardando Pagamento",
  "Empacotando Produto",
  "Pronto para Envio",
  "Saiu para Entrega",
  "Entregue",
] as const;

export type OrderStatusPtValue = (typeof ORDER_STATUSES_PT)[number];
