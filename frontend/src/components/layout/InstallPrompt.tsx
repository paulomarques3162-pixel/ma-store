import { useEffect, useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useUiStore } from "@/stores/ui";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * O Safari do iPhone NUNCA dispara `beforeinstallprompt` (esse evento é só do
 * Chromium). Sem orientação, o usuário de iPhone não descobre como instalar.
 * Detectamos o cenário em que a instalação faz sentido (iOS + Safari + ainda não
 * instalado) para mostrar o passo a passo real de "Adicionar à Tela de Início".
 */
function isIosSafariWithoutInstall(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;

  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ se apresenta como "Mac" no user agent.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;

  // Já aberto como app instalado: nada a orientar.
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  if (standalone) return false;

  // Só o Safari permite "Adicionar à Tela de Início". Chrome/Firefox/Edge no iOS
  // não oferecem o recurso — nesses casos orientar seria enganoso.
  const isOtherIosBrowser = /crios|fxios|edgios|opios|mercury|brave/i.test(ua);
  return /safari/i.test(ua) && !isOtherIosBrowser;
}

/**
 * Convite para instalar o WebApp (PWA).
 *
 *  - Android/desktop (Chromium): usa o prompt nativo, somente quando o navegador
 *    realmente permite instalar (`beforeinstallprompt`).
 *  - iPhone/iPad (Safari): mostra o passo a passo oficial, pois o Safari não tem
 *    instalação automática.
 *  - Nunca insiste: se o usuário dispensar, a preferência fica salva.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [mobileLike, setMobileLike] = useState(true);
  const dismissed = useUiStore((s) => s.installPromptDismissed);
  const dismiss = useUiStore((s) => s.dismissInstallPrompt);

  useEffect(() => {
    setIos(isIosSafariWithoutInstall());

    // No desktop o aviso é redundante, cobre o conteúdo e o texto fala de
    // "tela inicial do celular". Só exibimos em dispositivos de toque.
    const query = window.matchMedia?.("(pointer: coarse)");
    if (query) {
      const update = () => setMobileLike(query.matches);
      update();
      query.addEventListener?.("change", update);
      return () => query.removeEventListener?.("change", update);
    }
  }, []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setDeferred(null);
      setIos(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Enquanto o aviso está na tela, ele ocupa o canto inferior no mobile —
  // os atalhos flutuantes são recolhidos para não haver sobreposição.
  const visible = !dismissed && (Boolean(deferred) || ios) && (ios || mobileLike);

  useEffect(() => {
    if (!visible) return;
    document.body.classList.add("has-install-prompt");
    return () => document.body.classList.remove("has-install-prompt");
  }, [visible]);

  if (!visible) return null;

  // iPhone/iPad: passo a passo do Safari (instalação real via Compartilhar).
  if (ios) {
    return (
      <div className="install-prompt install-prompt--ios no-print" role="dialog" aria-label="Instalar aplicativo no iPhone">
        <div className="row row-3" style={{ alignItems: "center" }}>
          <span className="empty-state__icon" style={{ width: 44, height: 44 }}>
            <Icon name="download" size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <p className="text-sm text-strong">Instalar a MA STORE no iPhone</p>
            <p className="text-xs text-muted">Acesso rápido pela tela inicial, como um aplicativo.</p>
          </div>
        </div>
        <ol className="install-prompt__steps">
          <li>
            Toque em <strong>Compartilhar</strong> (o ícone <Icon name="share" size={14} /> na barra do Safari).
          </li>
          <li>
            Escolha <strong>“Adicionar à Tela de Início”</strong>.
          </li>
          <li>
            Confirme em <strong>Adicionar</strong>.
          </li>
        </ol>
        <div className="row row-end">
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Entendi
          </Button>
        </div>
      </div>
    );
  }

  const install = async () => {
    try {
      await deferred?.prompt();
      await deferred?.userChoice;
    } finally {
      setDeferred(null);
    }
  };

  return (
    <div className="install-prompt no-print" role="dialog" aria-label="Instalar aplicativo">
      <span className="empty-state__icon" style={{ width: 44, height: 44 }}>
        <Icon name="download" size={20} />
      </span>
      <div style={{ flex: 1 }}>
        <p className="text-sm text-strong">Instalar a MA STORE</p>
        <p className="text-xs text-muted">Acesso rápido pela tela inicial do celular.</p>
      </div>
      <div className="row row-2">
        <Button size="sm" onClick={() => void install()}>
          Instalar
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Agora não">
          Depois
        </Button>
      </div>
    </div>
  );
}
