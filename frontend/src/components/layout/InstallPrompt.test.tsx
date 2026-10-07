import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { InstallPrompt } from "./InstallPrompt";
import { useUiStore } from "@/stores/ui";

/**
 * No iPhone o Safari não dispara `beforeinstallprompt`. A instalação é manual
 * (Compartilhar → Adicionar à Tela de Início), então a loja precisa ORIENTAR o
 * usuário nesse cenário — sem inventar uma instalação que o navegador não faz.
 */

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function setNavigator(options: { ua: string; platform?: string; standalone?: boolean; maxTouchPoints?: number }) {
  Object.defineProperty(window.navigator, "userAgent", { value: options.ua, configurable: true });
  Object.defineProperty(window.navigator, "platform", { value: options.platform ?? "iPhone", configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: options.maxTouchPoints ?? 5, configurable: true });
  Object.defineProperty(window.navigator, "standalone", { value: options.standalone ?? false, configurable: true });
}

/** Simula o tipo de ponteiro primário (toque = coarse, mouse = fine). */
function setCoarsePointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: coarse") ? coarse : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  useUiStore.setState({ installPromptDismissed: false });
  localStorage.clear();
  setCoarsePointer(true);
});

describe("InstallPrompt no iPhone", () => {
  it("mostra o passo a passo no Safari do iPhone", async () => {
    setNavigator({ ua: IOS_SAFARI });
    render(<InstallPrompt />);

    await waitFor(() => expect(screen.getByText(/Instalar a MA STORE no iPhone/i)).toBeInTheDocument());
    expect(screen.getByText(/Compartilhar/i)).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à Tela de Início/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirme em/i)).toBeInTheDocument();
  });

  it("não orienta quando o app já está instalado (standalone)", async () => {
    setNavigator({ ua: IOS_SAFARI, standalone: true });
    render(<InstallPrompt />);

    // Nada é renderizado; aguarda um tick para o efeito de detecção rodar.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Instalar a MA STORE no iPhone/i)).not.toBeInTheDocument();
  });

  it("não orienta no Chrome do iPhone (não permite Adicionar à Tela de Início)", async () => {
    setNavigator({ ua: IOS_CHROME });
    render(<InstallPrompt />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Instalar a MA STORE no iPhone/i)).not.toBeInTheDocument();
  });

  it("respeita a dispensa do usuário e não insiste", async () => {
    setNavigator({ ua: IOS_SAFARI });
    const user = userEvent.setup();
    render(<InstallPrompt />);

    await waitFor(() => expect(screen.getByText(/Instalar a MA STORE no iPhone/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Entendi" }));

    expect(screen.queryByText(/Instalar a MA STORE no iPhone/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("mastore.installDismissed")).toBe("1");
  });
});

describe("InstallPrompt no desktop", () => {
  it("mostra o convite nativo em dispositivo de toque", async () => {
    setCoarsePointer(true);
    setNavigator({ ua: DESKTOP_CHROME, platform: "Win32", maxTouchPoints: 0 });
    render(<InstallPrompt />);
    window.dispatchEvent(new Event("beforeinstallprompt"));

    await waitFor(() => expect(screen.getByText(/^Instalar a MA STORE$/i)).toBeInTheDocument());
  });

  it("NÃO mostra o convite nativo no desktop (ponteiro fino), para não cobrir conteúdo", async () => {
    setCoarsePointer(false);
    setNavigator({ ua: DESKTOP_CHROME, platform: "Win32", maxTouchPoints: 0 });
    render(<InstallPrompt />);
    window.dispatchEvent(new Event("beforeinstallprompt"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/^Instalar a MA STORE$/i)).not.toBeInTheDocument();
  });
});
