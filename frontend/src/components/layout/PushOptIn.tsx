import { useEffect, useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useToast } from "@/hooks";
import {
  getPushPublicKey,
  hasPushSubscription,
  isIos,
  isStandaloneDisplay,
  pushSupported,
  subscribeToPush,
} from "@/lib/push";

type OptInStatus = "loading" | "hidden" | "available" | "active";

const DISMISS_KEY = "mastore.pushOptInDismissed";

/**
 * Consentimento de notificações (Web Push).
 *
 * O usuário primeiro ENTENDE para que serve e só então decide. O pedido nativo
 * do navegador acontece exclusivamente no clique de "Ativar" — nunca sozinho.
 * Se ele recusar (no nosso aviso ou no navegador), não insistimos.
 */
export function PushOptIn() {
  const toast = useToast();
  const [status, setStatus] = useState<OptInStatus>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!pushSupported()) return setStatus("hidden");

      // No iOS o push só funciona com o app INSTALADO na tela de início
      // (iOS 16.4+). Antes disso, orientamos a instalar (InstallPrompt) em vez
      // de oferecer algo que falharia.
      if (isIos() && !isStandaloneDisplay()) return setStatus("hidden");

      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return setStatus("hidden");
      } catch {
        /* storage indisponível */
      }

      // Respeita uma recusa anterior no navegador.
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        return setStatus("hidden");
      }

      // Já consentiu e já tem inscrição ativa: nada a pedir.
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && (await hasPushSubscription())) {
        return setStatus("hidden");
      }

      // Só oferece se o backend tiver o push realmente configurado.
      try {
        const { enabled } = await getPushPublicKey();
        if (cancelled) return;
        setStatus(enabled ? "available" : "hidden");
      } catch {
        if (!cancelled) setStatus("hidden");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading" || status === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignora */
    }
    setStatus("hidden");
  };

  const activate = async () => {
    setBusy(true);
    try {
      const ok = await subscribeToPush();
      if (ok) {
        setStatus("active");
        toast.success("Notificações ativadas", "Você será avisado quando chegar produto novo.");
      } else {
        toast.info("Notificações não ativadas", "Você pode permitir depois nas configurações do navegador.");
        setStatus("hidden");
      }
    } catch {
      toast.error("Não foi possível ativar", "Tente novamente mais tarde.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "active") {
    return (
      <div className="push-optin push-optin--done no-print">
        <Icon name="bell" size={16} />
        <span>Notificações ativadas. Avisaremos quando chegar novidade.</span>
      </div>
    );
  }

  return (
    <section className="push-optin no-print" aria-label="Notificações de novidades">
      <span className="push-optin__icon">
        <Icon name="bell" size={20} />
      </span>
      <div className="push-optin__text">
        <strong>Receber novidades da MA STORE?</strong>
        <p>Avisamos no seu celular quando um produto novo chegar. Você escolhe e pode desativar quando quiser.</p>
      </div>
      <div className="push-optin__actions">
        <Button size="sm" loading={busy} onClick={() => void activate()}>
          Ativar
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Agora não
        </Button>
      </div>
    </section>
  );
}
