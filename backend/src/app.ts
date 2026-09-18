import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
import { orderRoutes } from "./modules/orders/order.routes.js";
import { paymentRoutes } from "./modules/payments/payment.routes.js";
import { reviewRoutes } from "./modules/reviews/review.routes.js";
import { shippingRoutes } from "./modules/shipping/shipping.routes.js";
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
      await api.register(orderRoutes, { prefix: "/orders" });
      await api.register(paymentRoutes, { prefix: "/payments" });
      await api.register(messageRoutes, { prefix: "/messages" });
      await api.register(notificationRoutes, { prefix: "/notifications" });
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
