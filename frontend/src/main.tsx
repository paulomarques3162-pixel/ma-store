import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { queryClient } from "./lib/queryClient";

/**
 * CAMADAS DE CSS — a ordem importa.
 *
 * Como tudo usa a mesma especificidade (uma classe), quem vem depois vence.
 * Por isso os UTILITÁRIOS ficam no FIM: `.hide-mobile`, `.hide-desktop` e
 * `.sr-only` precisam sobrepor o `display` definido pelos componentes.
 * (Antes estavam no meio e o menu desktop aparecia no mobile.)
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/layout.css";
import "./styles/catalog.css";
import "./styles/pages.css";
import "./styles/utilities.css";

const container = document.getElementById("root");
if (!container) throw new Error("Elemento #root não encontrado no index.html");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

/* -------------------------------------------------------------------------- */
/* Service Worker (PWA) — registrado apenas em produção                        */
/* -------------------------------------------------------------------------- */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sem service worker o app continua funcionando (apenas sem modo offline).
    });
  });
}
