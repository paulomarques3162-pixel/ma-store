import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";
import { newRequestId } from "./lib/crypto.js";
import { authPlugin } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

// Modulos da API
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { bannerRoutes } from "./modules/content/banner.routes.js";
import { contentRoutes } from "./modules/content/content.routes.js";
import { themeRoutes } from "./modules/content/theme.routes.js";
import { brandRoutes } from "./modules/catalog/brand.routes.js";
import { categoryRoutes } from "./modules/catalog/category.routes.js";
import { productRoutes } from "./modules/catalog/product.routes.js";
import { cartRoutes } from "./modules/cart/cart.routes.js";
import { couponRoutes } from "./modules/coupons/coupon.routes.js";
import { favoriteRoutes } from "./modules/favorites/favorite.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { labRoutes } from "./modules/lab/lab.routes.js";
import { messageRoutes } from "./modules/messages/message.routes.js";
import { notificationRoutes } from "./modules/notifications/notification.routes.js";
import { pushRoutes } from "./modules/push/push.routes.js";
import { orderRoutes } from "./modules/orders/order.routes.js";
import { pedidoRoutes } from "./modules/pedidos/pedido.routes.js";
import { trackingRoutes } from "./modules/rastreio/tracking.routes.js";
import { pedidoAdminRoutes } from "./modules/admin/pedido.admin.routes.js";
import { uploadAdminRoutes } from "./modules/admin/upload.admin.routes.js";
import { diagnosticsAdminRoutes } from "./modules/admin/diagnostics.admin.routes.js";
import { paymentMethodsRoutes } from "./modules/payments/payment-methods.routes.js";
import { paymentRoutes } from "./modules/payments/payment.routes.js";
import { reviewRoutes } from "./modules/reviews/review.routes.js";
import { deliveryRoutes } from "./modules/delivery/delivery.routes.js";
import { shippingRoutes } from "./modules/shipping/shipping.routes.js";
import { shippingEngineRoutes } from "./modules/shipping/shipping-engine.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: env.LOG_LEVEL,
            // Nunca logar dados sensiveis.
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body.password",
                "req.body.newPassword",
                "req.body.currentPassword",
                "req.body.confirmPassword",
                "req.body.cardNumber",
                "req.body.cvv",
                // Tokenizacao de cartao (Mercado Pago): nunca logar o token nem
                // dados do pagador.
                "req.body.card.token",
                "req.body.card.cvv",
                "req.body.token",
                "req.body.payer.docNumber",
                "res.headers['set-cookie']",
              ],
              censor: "[REDACTED]",
            },
            ...(env.isProduction
              ? {}
              : {
                  transport: {
                    target: "pino-pretty",
                    options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
                  },
                }),
          },
    genReqId: () => newRequestId(),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // ---- Seguranca base -------------------------------------------------------
  await app.register(helmet, {
    contentSecurityPolicy: false, // API JSON; o CSP e responsabilidade do frontend
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key", "X-Webhook-Signature"],
  });

  // Compressao HTTP (brotli > gzip > deflate).
  //
  // A vitrine e um SPA que baixa JSON em cada pagina; sem compressao o
  // payload da listagem de produtos passava de 14 KB e o navegador pagava
  // isso em 3G/4G. Aqui comprimimos apenas o que realmente ganha:
  //  - `threshold` de 1 KB evita comprimir respostas minusculas (que ficariam
  //    MAIORES depois do cabecalho de compressao);
  //  - imagens/zip ja sao comprimidos: recomprimir so gasta CPU do servidor;
  //  - uploads (multipart) sao requisicoes, nao respostas: nao passam por aqui.
  await app.register(compress, {
    global: true,
    encodings: ["br", "gzip", "deflate"],
    threshold: 1024,
  });

  // Upload de imagens (multipart) com limite de tamanho.
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 10 },
  });

  // Arquivos enviados (driver local) servidos em /uploads.
  // IMPORTANTE: `wildcard` precisa ser true (padrão) para registrar a rota
  // `GET /uploads/*`. Com `wildcard: false` o plugin registra apenas o prefixo
  // exato e NENHUM arquivo é servido — era a causa do 404 nas imagens.
  if (env.STORAGE_DRIVER === "local") {
    const uploadsDir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
    mkdirSync(uploadsDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: uploadsDir,
      prefix: "/uploads/",
      decorateReply: false,
      // Cache agressivo e seguro: cada upload recebe um nome UNICO
      // (`<timestamp>-<hash>.<ext>`), entao o conteudo de uma URL nunca muda.
      // Sem isto o @fastify/static respondia `Cache-Control: public, max-age=0`
      // e o navegador revalidava TODA imagem a cada navegacao (requisicoes
      // desnecessarias e galeria piscando). `immutable` libera o navegador de
      // revalidar por 30 dias; trocar a foto gera uma URL nova.
      cacheControl: true,
      maxAge: "30d",
      immutable: true,
    });
  }

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.ip,
    // Sem `errorResponseBuilder`: o plugin precisa lancar um erro de verdade
    // (com statusCode 429) para que o handler global o formate com requestId.
  });

  // ---- Núcleo ---------------------------------------------------------------
  registerErrorHandler(app);
  // Executado no escopo raiz (sem `register`) de proposito: os decorators
  // `authenticate` / `requireAdmin` precisam valer para TODAS as rotas, e o
  // encapsulamento do Fastify os esconderia dos plugins irmaos.
  await authPlugin(app);

  // ---- Rotas ----------------------------------------------------------------
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes, { prefix: "/users" });
      await api.register(categoryRoutes, { prefix: "/categories" });
      await api.register(brandRoutes, { prefix: "/brands" });
      await api.register(productRoutes, { prefix: "/products" });
      await api.register(cartRoutes, { prefix: "/cart" });
      await api.register(favoriteRoutes, { prefix: "/favorites" });
      await api.register(couponRoutes, { prefix: "/coupons" });
      await api.register(shippingRoutes, { prefix: "/shipping" });
      // Shipping Engine universal (novo contrato, em paralelo ao legado).
      if (env.SHIPPING_ENGINE_ENABLED) {
        await api.register(shippingEngineRoutes, { prefix: "/v1/shipping" });
      }
      await api.register(orderRoutes, { prefix: "/orders" });
      // Guest Checkout + rastreamento publico
      await api.register(pedidoRoutes, { prefix: "/pedidos" });
      // Modulo de entrega / motoboy (autenticado).
      await api.register(deliveryRoutes, { prefix: "/delivery" });
      await api.register(trackingRoutes, { prefix: "/rastreio" });
      await api.register(pedidoAdminRoutes, { prefix: "/admin/pedidos" });
      await api.register(uploadAdminRoutes, { prefix: "/admin/uploads" });
      await api.register(diagnosticsAdminRoutes, { prefix: "/admin/diagnostics" });
      await api.register(paymentRoutes, { prefix: "/payments" });
      await api.register(paymentMethodsRoutes, { prefix: "/payment-methods" });
      await api.register(messageRoutes, { prefix: "/messages" });
      await api.register(notificationRoutes, { prefix: "/notifications" });
      // Web Push (PWA) — público (consentimento é do navegador, não de conta).
      await api.register(pushRoutes, { prefix: "/push" });
      await api.register(reviewRoutes, { prefix: "/" });
      await api.register(contentRoutes, { prefix: "/content" });
      await api.register(bannerRoutes, { prefix: "/banners" });
      await api.register(themeRoutes, { prefix: "/theme" });
      await api.register(adminRoutes, { prefix: "/admin" });
      await api.register(labRoutes, { prefix: "/admin/lab" });
    },
    { prefix: "/api" },
  );

  return app;
}
