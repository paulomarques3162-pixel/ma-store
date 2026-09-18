import { useEffect, useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useUiStore } from "@/stores/ui";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Convite para instalar o WebApp (PWA).
 *
 * Aparece apenas quando o navegador dispara `beforeinstallprompt` — ou seja,
 * só quando a instalação é realmente possível. Se o usuário dispensar, não
 * insistimos (a preferência fica salva).
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const dismissed = useUiStore((s) => s.installPromptDismissed);
  const dismiss = useUiStore((s) => s.dismissInstallPrompt);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice;
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
