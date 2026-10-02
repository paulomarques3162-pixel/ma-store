import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Setup dos testes do frontend (jsdom).
 * - `matchMedia` e `scrollTo` não existem no jsdom e são usados pelo layout.
 * - `crypto.randomUUID` é usado na chave de idempotência do checkout.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: { ...globalThis.crypto, randomUUID: () => `test-${Math.random().toString(16).slice(2)}` },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
