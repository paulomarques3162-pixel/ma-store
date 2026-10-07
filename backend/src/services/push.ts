import webpush from "web-push";
import { prisma } from "../db.js";
import { env } from "../env.js";

/**
 * Web Push real (PWA) — sem simulação.
 *
 * - As chaves VAPID vêm do ambiente. Sem elas, o push fica DESATIVADO e a loja
 *   continua funcionando normalmente (nenhum erro, nenhum dado falso).
 * - A inscrição é anônima (Guest Checkout): guardamos endpoint + chaves do
 *   navegador, nunca dados de conta.
 * - O envio remove inscrições expiradas (404/410) e nunca derruba a operação
 *   de publicação do produto: push é best-effort.
 */

let configured = false;

/** Configura o web-push uma única vez. Devolve `false` se faltar chave. */
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
    return true;
  } catch {
    return false;
  }
}

/** Push está pronto para uso (chaves configuradas e válidas)? */
export function isPushEnabled(): boolean {
  return ensureConfigured();
}

/** Chave pública VAPID (pode ir para o frontend). `null` quando desativado. */
export function getVapidPublicKey(): string | null {
  return isPushEnabled() ? env.VAPID_PUBLIC_KEY : null;
}

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Cria/atualiza a inscrição de um navegador (idempotente por endpoint). */
export async function savePushSubscription(
  input: PushSubscriptionInput,
  userAgent?: string | null,
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent ?? null },
    create: {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: userAgent ?? null,
    },
  });
}

/** Remove a inscrição (o usuário revogou o consentimento). */
export async function removePushSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export type PushPayload = {
  title: string;
  body: string;
  /** Caminho relativo aberto ao clicar na notificação. */
  url?: string;
  /** Agrupa notificações do mesmo assunto. */
  tag?: string;
};

export type PushSendResult = { sent: number; removed: number; failed: number };

/** Envia uma notificação para TODAS as inscrições ativas. */
export async function sendPushToAll(payload: PushPayload): Promise<PushSendResult> {
  if (!isPushEnabled()) return { sent: 0, removed: 0, failed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany();
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        sent += 1;
        await prisma.pushSubscription
          .update({ where: { id: subscription.id }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Inscrição expirada/cancelada no navegador: limpar.
          removed += 1;
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        } else {
          failed += 1;
        }
      }
    }),
  );

  return { sent, removed, failed };
}

/**
 * Reivindica, de forma ATÔMICA e PERSISTENTE, o direito de avisar que este
 * produto foi publicado.
 *
 * Por que existe: a regra "um produto novo gera UM aviso" não pode depender de
 * o frontend não repetir a requisição. Dois cliques rápidos, um retry de rede
 * ou duas ativações simultâneas fazem duas requisições lerem `active=false`
 * antes de qualquer uma gravar `active=true` — e ambas disparariam o push.
 *
 * Aqui a decisão é tomada pelo banco, em uma única instrução:
 * `UPDATE products SET notifiedAt = now() WHERE id = ? AND notifiedAt IS NULL`.
 * Só a requisição que alterar 1 linha recebe `true`; as demais recebem `false`.
 *
 * O carimbo é gravado ANTES do envio, então uma queda no meio do envio não
 * gera reenvio em massa — a política é "no máximo uma vez" (at-most-once),
 * que é o comportamento correto para um aviso de novidade.
 */
export async function claimProductNotification(productId: string): Promise<boolean> {
  const claimed = await prisma.product.updateMany({
    where: { id: productId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  return claimed.count === 1;
}

/**
 * Notifica os usuários inscritos que um produto novo entrou na loja.
 * Nunca lança: uma falha de push não pode impedir a publicação do produto.
 */
export async function notifyNewProduct(product: { name: string; slug: string }): Promise<PushSendResult> {
  try {
    return await sendPushToAll({
      title: "Novo produto na MA STORE",
      body: "Confira a novidade que acabou de chegar!",
      url: `/produto/${product.slug}`,
      tag: `product-${product.slug}`,
    });
  } catch {
    return { sent: 0, removed: 0, failed: 0 };
  }
}
