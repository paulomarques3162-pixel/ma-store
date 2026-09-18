import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { queryClient } from "./lib/queryClient";

// Design system — a ordem importa (tokens -> base -> utilitários -> componentes)
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/utilities.css";
import "./styles/ui.css";
import "./styles/layout.css";
import "./styles/catalog.css";
import "./styles/pages.css";

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
