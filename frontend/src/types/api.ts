/**
 * Tipos da API da MA STORE.
 * Espelham exatamente o contrato descrito em /API.md - nada inventado.
 */

export type Role = "CLIENT" | "ADMIN" | "DELIVERY_PERSON";
export type UserStatus = "ACTIVE" | "BLOCKED" | "PENDING";

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_REVIEW"
  | "PAID"
  | "PREPARING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELED"
  | "REFUNDED";

export type PaymentMethod = "PIX" | "CREDIT_CARD" | "BOLETO" | "MANUAL";
export type PaymentStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELED" | "EXPIRED" | "REFUNDED";
export type ModerationStatus = "PENDING" | "APPROVED" | "REJECTED";
export type FeedbackType = "PRODUCT" | "DELIVERY" | "EXPERIENCE";
export type ConversationStatus = "OPEN" | "ARCHIVED" | "RESOLVED";

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AuthSession = {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type Brand = { id: string; name: string; slug: string; logoUrl?: string | null; active?: boolean; isDemo?: boolean; productCount?: number };

export type Category = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  position?: number;
  productCount?: number;
  active?: boolean;
  isDemo?: boolean;
};

export type ProductImage = {
  id?: string;
  url: string;
  alt?: string | null;
  position?: number;
  /** Enquadramento CSS (object-position). Ex.: "center", "50% 30%". */
  focalPoint?: string | null;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  description: string | null;
  price: number;
  comparePrice: number | null;
  costPrice?: number | null;
  volume: string | null;
  weightGrams?: number | null;
  /** Dimensoes logisticas (cm) usadas pelo Shipping Engine proprio. */
  heightCm?: number | null;
  widthCm?: number | null;
  lengthCm?: number | null;
  stock: number;
  reservedStock?: number;
  soldStock?: number;
  minStock?: number;
  hasShipping: boolean;
  allowCoupon: boolean;
  isLaunch: boolean;
  isFeatured: boolean;
  isBestSeller: boolean;
  active: boolean;
  isDemo?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  createdAt: string;
  updatedAt?: string;
  brandId?: string | null;
  categoryId?: string | null;
  brand?: { id: string; name: string; slug: string } | null;
  category?: { id: string; name: string; slug: string } | null;
  images: ProductImage[];
};

export type PaginationMeta = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type CartItem = {
  id: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    slug: string;
    sku: string;
    price: number;
    comparePrice: number | null;
    volume: string | null;
    stock: number;
    active: boolean;
    hasShipping: boolean;
    allowCoupon: boolean;
    brand: { id: string; name: string; slug: string } | null;
    category: { id: string; name: string; slug: string } | null;
    images: Array<{ url: string; alt: string | null }>;
  };
  unitPrice: number;
  lineTotal: number;
  available: boolean;
  stock: number;
};

export type Cart = {
  id: string;
  items: CartItem[];
  summary: {
    subtotal: number;
    totalItems: number;
    shipping: number;
    discount: number;
    total: number;
    hasIssues: boolean;
  };
};

export type Address = {
  id: string;
  label: string | null;
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
  country: string;
  isDefault: boolean;
  createdAt?: string;
};

export type ShippingOption = {
  id: string;
  name: string;
  description: string | null;
  carrier: string | null;
  price: number;
  originalPrice: number;
  freeAbove: number | null;
  isFree: boolean;
  minDays: number;
  maxDays: number;
  region: string | null;
};

export type ShippingQuote = {
  cep: string;
  region: string | null;
  required: boolean;
  subtotal: number;
  options: ShippingOption[];
};

/* -------------------------------------------------------------------------- */
/* Guest Checkout + Rastreamento                                              */
/* -------------------------------------------------------------------------- */

/** Os cinco estados oficiais do pedido (fonte unica: backend). */
export type OrderStatusPt =
  | "Aguardando Pagamento"
  | "Empacotando Produto"
  | "Pronto para Envio"
  | "Saiu para Entrega"
  | "Entregue";

/** Opcao retornada pelo motor de frete (padrao unico). */
export type ShippingEngineOption = {
  id: string;
  nome: string;
  valor: number;
  prazo: string;
  carrier: string | null;
  descricao: string | null;
  /** Cliente paga direto a transportadora (ex.: Correios). */
  pagoDireto: boolean;
  incluirNoTotal: boolean;
};

export type ShippingEngineQuote = {
  success: boolean;
  cep: string;
  pesoTotal: number;
  options: ShippingEngineOption[];
  warnings: string[];
  retryable: boolean;
};

/* -------------------------------------------------------------------------- */
/* Shipping Engine proprio (regras locais)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cotacao do motor proprio (multi-modalidade). `price`/prazo/peso vem SEMPRE do
 * backend; o `quoteId` e obrigatorio no fechamento do pedido.
 */
export type LocalShippingQuoteOption = {
  methodId: string;
  code: string | null;
  name: string;
  description: string | null;
  price: number;
  deliveryDays: number | null;
  zoneId: string | null;
  ruleId: string | null;
};

export type LocalShippingQuote = {
  success: true;
  available: true;
  quoteId: string;
  expiresAt: string;
  normalizedZipCode: string;
  zone: { id: string; name: string } | null;
  weightGrams: number;
  subtotal: number;
  isFreeShipping: boolean;
  requiresShipping: boolean;
  isEstimate: true;
  disclaimer: string;
  currency: "BRL";
  options: LocalShippingQuoteOption[];
};

export type LocalShippingStatus = {
  enabled: boolean;
  originZipCode: string | null;
  hasZones: boolean;
  activeZones: number;
  activeWeightRules: number;
  activeMethods: number;
  freeShippingEnabled: boolean;
  configured: boolean;
};

export type ShippingZone = {
  id: string;
  name: string;
  description: string | null;
  state: string | null;
  zipCodeFrom: number;
  zipCodeTo: number;
  active: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type ShippingWeightRule = {
  id: string;
  zoneId: string;
  shippingMethodId: string | null;
  minWeightGrams: number;
  maxWeightGrams: number;
  price: number;
  deliveryDays: number | null;
  estimatedMinBusinessDays: number | null;
  estimatedMaxBusinessDays: number | null;
  priority: number;
  active: boolean;
  zone?: { id: string; name: string } | null;
  shippingMethod?: { id: string; name: string; code: string | null } | null;
};

export type ShippingCepException = {
  id: string;
  cep: string;
  shippingMethodId: string;
  priceOverride: number | null;
  deliveryDaysOverride: number | null;
  active: boolean;
  shippingMethod?: { id: string; name: string; code: string | null } | null;
};

export type ShippingEngineSettings = {
  enabled: boolean;
  originZipCode: string | null;
  packagePaddingGrams: number | null;
  defaultHandlingDays: number | null;
  defaultDeliveryDays: number | null;
  freeShippingEnabled: boolean;
  freeShippingMinimumOrderValue: number | null;
  showEstimateDisclaimer: boolean;
  configVersion: number;
  configured: boolean;
};

export type PedidoTimelineStep = {
  status: OrderStatusPt;
  done: boolean;
  current: boolean;
  future: boolean;
};

export type PedidoSnapshotItem = {
  id: string;
  nome: string;
  quantidade: number;
  preco: number;
  peso_unitario: number;
};

export type GuestPedido = {
  id: number;
  token_rastreio_unico: string;
  status_atual: string;
  cliente_nome: string;
  cliente_whatsapp: string;
  endereco_completo: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    cidade: string;
    uf: string;
  } | null;
  produtos_carrinho: PedidoSnapshotItem[];
  frete_escolhido_nome: string | null;
  frete_escolhido_valor: number | null;
  frete_escolhido_prazo: string | null;
  frete_zona_id?: string | null;
  frete_regra_id?: string | null;
  frete_estimado?: boolean;
  frete_prazo_min_dias?: number | null;
  frete_prazo_max_dias?: number | null;
  metodo_pagamento: string | null;
  pagamento_status: string;
  pagamento_payload: string | null;
  pagamento_expira_em: string | null;
  pagamento_provider?: string | null;
  pagamento_provider_ref?: string | null;
  pagamento_provider_status?: string | null;
  pagamento_metodo_detalhe?: string | null;
  pagamento_qr_code_base64?: string | null;
  pagamento_boleto_url?: string | null;
  pagamento_boleto_barcode?: string | null;
  pago_em?: string | null;
  pagamento_erro?: string | null;
  recebido_por: string | null;
  data_entrega: string | null;
  criado_em: string;
  subtotal: number;
  total: number;
  timeline: PedidoTimelineStep[];
};

export type OrderItem = {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  skuSnapshot: string;
  imageSnapshot: string | null;
  unitPrice: number;
  quantity: number;
  total: number;
};

export type OrderStatusHistory = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
  changedBy?: { name: string; email: string } | null;
};

export type Payment = {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  provider: string;
  providerRef?: string | null;
  expiresAt: string | null;
  approvedAt?: string | null;
  createdAt: string;
  attempts?: Array<{ status: PaymentStatus; errorMessage: string | null; createdAt: string; durationMs: number | null }>;
};

export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  couponCode?: string | null;
  notes?: string | null;
  shippingAddress?: Record<string, string | null>;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  items?: OrderItem[];
  statusHistory?: OrderStatusHistory[];
  payments?: Payment[];
  shipment?: {
    id: string;
    trackingCode: string | null;
    carrier: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    shippingMethod?: { name: string; carrier: string | null } | null;
  } | null;
  user?: { id: string; name: string; email: string; phone?: string | null };
  _count?: { items: number };
};

export type Receipt = {
  number: string;
  status: OrderStatus;
  createdAt: string;
  customer: { name: string; email: string; phone?: string | null };
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
  couponCode: string | null;
  paymentMethod: PaymentMethod | null;
  payments: Array<{ method: PaymentMethod; status: PaymentStatus; amount: number; createdAt: string; approvedAt?: string | null }>;
  shippingAddress: Record<string, string | null>;
  shipment: Order["shipment"];
  notes: string | null;
};

export type CouponValidation = {
  valid: boolean;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  discount: number;
  shippingDiscount: number;
  appliesToShipping: boolean;
  subtotal: number;
  total: number;
};

export type Coupon = {
  id: string;
  code: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrderValue: number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  usesCount: number;
  appliesToAll: boolean;
  appliesToShipping: boolean;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  isDemo?: boolean;
  usageCount?: number;
  productsCount?: number;
  categoriesCount?: number;
};

export type ShippingMethod = {
  id: string;
  name: string;
  /** Codigo estavel da modalidade (motor proprio). */
  code?: string | null;
  description: string | null;
  carrier: string | null;
  price: number;
  freeAbove: number | null;
  minDays: number;
  maxDays: number;
  regions: string[];
  active: boolean;
  position: number;
  /** Prioridade no motor proprio (maior = antes). */
  priority?: number;
};

/* -------------------------------------------------------------------------- */
/* Módulo de entrega / motoboy                                                */
/* -------------------------------------------------------------------------- */

export type DeliveryStatus =
  | "PENDING"
  | "ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export type DeliveryFailureReason =
  | "CLIENTE_AUSENTE"
  | "ENDERECO_NAO_LOCALIZADO"
  | "RECUSA_DO_RECEBEDOR"
  | "AREA_INACESSIVEL"
  | "PROBLEMA_DE_ACESSO"
  | "OUTRO";

export type DeliveryEventItem = {
  id: string;
  status: DeliveryStatus;
  notes: string | null;
  failureReason: DeliveryFailureReason | null;
  createdAt: string;
};

export type DeliveryEndereco = {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

export type DeliveryData = {
  id: string;
  pedidoId: number;
  orderNumber: number;
  status: DeliveryStatus;
  cliente: { nome: string; telefone: string };
  endereco: DeliveryEndereco;
  itens: Array<{ nome?: string; quantidade?: number; preco?: number }>;
  observacoes: string | null;
  failureReason: DeliveryFailureReason | null;
  recipientName: string | null;
  hasProof: boolean;
  proofEndpoint: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  assignedAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  driver: { id: string; name: string; phone: string | null } | null;
  events: DeliveryEventItem[];
};

export type DeliveryListItem = {
  id: string;
  pedidoId: number;
  orderNumber: number;
  status: DeliveryStatus;
  clienteNome: string;
  endereco: string;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  observacoes: string | null;
  driver: { id: string; name: string } | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type DriverCounters = {
  pending: number;
  assigned: number;
  outForDelivery: number;
  delivered: number;
  failed: number;
  total: number;
};

export type Driver = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "BLOCKED" | "PENDING";
  mustChangePassword?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  deliveriesCount: number;
};

export type DeliveryReportRow = {
  driverId: string | null;
  driverName: string;
  total: number;
  delivered: number;
  failed: number;
  inProgress: number;
  successRate: number;
};

export type DeliveryReport = {
  from: string | null;
  to: string | null;
  rows: DeliveryReportRow[];
  totals: { total: number; delivered: number; failed: number; inProgress: number };
};

export type PendingAssignmentPedido = {
  id: number;
  clienteNome: string;
  statusAtual: string;
  enderecoCompleto: Record<string, unknown> | null;
  criadoEm: string;
};

export type Conversation = {
  id: string;
  subject: string | null;
  status: ConversationStatus;
  unreadForAdmin: number;
  unreadForClient: number;
  lastMessageAt: string;
  createdAt: string;
  orderId: string | null;
  order?: { id?: string; number: string; status?: OrderStatus; total?: number } | null;
  lastMessage?: { body: string; senderRole: "CLIENT" | "ADMIN" | "SYSTEM"; createdAt: string } | null;
  messages?: Message[];
  user?: { id: string; name: string; email: string; phone?: string | null };
};

export type Message = {
  id: string;
  body: string;
  senderRole: "CLIENT" | "ADMIN" | "SYSTEM";
  authorName: string | null;
  createdAt: string;
  readAt: string | null;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type Review = {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: ModerationStatus;
  createdAt: string;
  author?: string;
  product?: { id: string; name: string; slug: string };
  user?: { id: string; name: string; email: string };
  order?: { number: string } | null;
};

export type ReviewSummary = { items: Review[]; average: number; total: number };

export type Feedback = {
  id: string;
  type: FeedbackType;
  rating: number | null;
  comment: string | null;
  contact?: string | null;
  status: ModerationStatus;
  createdAt: string;
  user?: { id: string; name: string; email: string } | null;
  order?: { number: string } | null;
};

export type Banner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
  position: string;
  order: number;
};

export type SiteContentEntry = {
  id?: string;
  key: string;
  value: string | null;
  group: string;
  label: string | null;
  isPublic: boolean;
};

export type SiteContentResponse = {
  values: Record<string, string | null>;
  entries: SiteContentEntry[];
};

export type ThemeSettings = {
  primaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  surfaceColor?: string;
  textColor?: string;
  buttonRadius?: number;
  cardRadius?: number;
  buttonStyle?: "solid" | "outline" | "pill";
  logoUrl?: string;
  faviconUrl?: string;
};

export type Theme = {
  published: boolean;
  id?: string;
  name?: string | null;
  settings?: ThemeSettings | null;
  publishedAt?: string | null;
  message?: string;
};

export type DashboardData = {
  orders: { today: number; month: number; pending: number };
  revenue: { month: number; total: number };
  customers: { total: number; newThisMonth: number };
  catalog: {
    active: number;
    outOfStock: number;
    withMinStock: number;
    lowStockList: Array<{ id: string; name: string; sku: string; stock: number; minStock: number }>;
  };
  moderation: { pendingReviews: number; pendingFeedback: number };
  messages: { conversationsWithUnread: number };
  coupons: { active: number };
  chart: { salesByDay: Array<{ day: string; orders: number; revenue: number }> };
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  recentOrders: Array<{ id: string; number: string; status: OrderStatus; total: number; createdAt: string; user: { name: string; email: string } }>;
};

export type AuditLog = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string } | null;
};

export type LabCheck = {
  id?: string;
  name: string;
  category: string;
  status: "PASS" | "WARN" | "FAIL";
  durationMs: number;
  endpoint: string | null;
  requestId: string | null;
  errorMessage: string | null;
  stackTrace: string | null;
  createdAt?: string;
};

export type TestRun = {
  id: string;
  suite: string;
  status: "PASS" | "WARN" | "FAIL";
  environment: string;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  total?: number;
  summary?: { total?: number; pass: number; warn: number; fail: number };
  results?: LabCheck[];
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  isDemo?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  ordersCount: number;
  totalSpent: number;
};

export type AdminUserDetail = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  isDemo?: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  addresses: Address[];
  totalSpent: number;
  recentOrders: Array<{ id: string; number: string; status: OrderStatus; total: number; createdAt: string; paidAt: string | null }>;
  activeSessions: Array<{ id: string; userAgent: string | null; ip: string | null; createdAt: string; lastUsedAt: string; expiresAt: string }>;
  passwordVisible: false;
  _count: { orders: number; conversations: number; reviews: number; feedbacks: number };
};

export type CatalogFacets = {
  volumes: string[];
  priceMin: number | null;
  priceMax: number | null;
};
