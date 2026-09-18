import { ApiError } from "./api";
import { useUiStore } from "@/stores/ui";

/**
 * Helpers de feedback ao usuário.
 *
 * Centralizam a regra: mensagem amigável + `requestId` para suporte.
 * Nunca exibimos stack trace nem detalhe técnico.
 */

function push(tone: "success" | "error" | "warning" | "info", title: string, message?: string) {
  useUiStore.getState().pushToast({ tone, title, message });
}

export function toastSuccess(title: string, message?: string) {
  push("success", title, message);
}

export function toastInfo(title: string, message?: string) {
  push("info", title, message);
}

export function toastWarning(title: string, message?: string) {
  push("warning", title, message);
}

/** Erro com o código de rastreio anexado (facilita o suporte). */
export function toastError(title: string, error: unknown) {
  const message = describeError(error);
  const requestId = error instanceof ApiError ? error.requestId : null;
  push("error", title, requestId ? `${message} (código ${requestId})` : message);
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a operação. Tente novamente.";
}

/** Erros por campo, quando o backend devolve detalhes de validação. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fieldErrors : {};
}

/** Evento enviado quando uma operação é concluída (para invalidar caches). */
export const operationCompletedEvent = "mastore:operation-completed";

export function notifyOperationCompleted(scope?: string) {
  window.dispatchEvent(new CustomEvent(operationCompletedEvent, { detail: { scope } }));
}
