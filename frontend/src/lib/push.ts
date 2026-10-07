import { api } from "./api";

/**
 * Web Push no cliente.
 *
 * Regras do projeto:
 *  - NUNCA pedimos permissão sem uma ação explícita do usuário (o pedido nativo
 *    só acontece depois de ele clicar em "Ativar");
 *  - se a permissão for negada, respeitamos e não insistimos;
 *  - a chave privada VAPID vive apenas no backend; aqui só usamos a pública.
 */

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** É um dispositivo iOS/iPadOS? */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Já está aberto como app instalado (standalone)? */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) output[index] = rawData.charCodeAt(index);
  return output;
}

/** O backend tem chaves VAPID configuradas? */
export async function getPushPublicKey(): Promise<{ enabled: boolean; key: string | null }> {
  return api.get<{ enabled: boolean; key: string | null }>("/push/public-key");
}

/** O navegador já tem uma inscrição ativa? */
export async function hasPushSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Fluxo completo de inscrição:
 * 1. pede a permissão nativa (só é chamado após o clique do usuário);
 * 2. obtém a chave pública no backend;
 * 3. inscreve no push manager;
 * 4. registra a inscrição no backend.
 *
 * Devolve `true` só quando tudo deu certo.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const { enabled, key } = await getPushPublicKey();
  if (!enabled || !key) return false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    }));

  await api.post("/push/subscribe", subscription.toJSON());
  return true;
}

/** Cancela a inscrição no navegador e remove no backend (best-effort). */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await api.post("/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    /* ignora */
  }
}
