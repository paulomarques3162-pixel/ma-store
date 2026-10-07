import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PushOptIn } from "./PushOptIn";
import { getPushPublicKey, hasPushSubscription, isIos, isStandaloneDisplay, pushSupported, subscribeToPush } from "@/lib/push";

vi.mock("@/lib/push", () => ({
  pushSupported: vi.fn(() => true),
  isIos: vi.fn(() => false),
  isStandaloneDisplay: vi.fn(() => false),
  hasPushSubscription: vi.fn(async () => false),
  getPushPublicKey: vi.fn(async () => ({ enabled: true, key: "public-key" })),
  subscribeToPush: vi.fn(async () => true),
  unsubscribeFromPush: vi.fn(async () => undefined),
}));

const mocked = {
  pushSupported: vi.mocked(pushSupported),
  hasPushSubscription: vi.mocked(hasPushSubscription),
  getPushPublicKey: vi.mocked(getPushPublicKey),
  subscribeToPush: vi.mocked(subscribeToPush),
};

function setNotificationPermission(permission: NotificationPermission) {
  Object.defineProperty(globalThis, "Notification", {
    value: { permission, requestPermission: vi.fn(async () => permission) },
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(isIos).mockReturnValue(false);
  vi.mocked(isStandaloneDisplay).mockReturnValue(false);
  mocked.pushSupported.mockReturnValue(true);
  mocked.hasPushSubscription.mockResolvedValue(false);
  mocked.getPushPublicKey.mockResolvedValue({ enabled: true, key: "public-key" });
  mocked.subscribeToPush.mockResolvedValue(true);
  setNotificationPermission("default");
});

describe("PushOptIn (consentimento)", () => {
  it("mostra o convite quando o push está disponível e o usuário ainda não decidiu", async () => {
    render(<PushOptIn />);
    await waitFor(() => expect(screen.getByText(/Receber novidades da MA STORE/i)).toBeInTheDocument());
  });

  it("NÃO mostra quando o navegador já negou a permissão (respeita a recusa)", async () => {
    setNotificationPermission("denied");
    render(<PushOptIn />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Receber novidades da MA STORE/i)).not.toBeInTheDocument();
  });

  it("NÃO mostra quando o push não é suportado", async () => {
    mocked.pushSupported.mockReturnValue(false);
    render(<PushOptIn />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Receber novidades da MA STORE/i)).not.toBeInTheDocument();
  });

  it("NÃO mostra quando o backend não tem chaves VAPID configuradas", async () => {
    mocked.getPushPublicKey.mockResolvedValue({ enabled: false, key: null });
    render(<PushOptIn />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Receber novidades da MA STORE/i)).not.toBeInTheDocument();
  });

  it("NÃO mostra no iPhone antes de instalar (iOS exige o app instalado para push)", async () => {
    vi.mocked(isIos).mockReturnValue(true);
    vi.mocked(isStandaloneDisplay).mockReturnValue(false);
    render(<PushOptIn />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Receber novidades da MA STORE/i)).not.toBeInTheDocument();
  });

  it("só chama subscribeToPush depois do clique em Ativar", async () => {
    const user = userEvent.setup();
    render(<PushOptIn />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Ativar" })).toBeInTheDocument());

    expect(mocked.subscribeToPush).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ativar" }));

    await waitFor(() => expect(mocked.subscribeToPush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Notificações ativadas/i)).toBeInTheDocument());
  });

  it("respeita a dispensa e não insiste", async () => {
    const user = userEvent.setup();
    render(<PushOptIn />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Agora não" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Agora não" }));

    expect(screen.queryByText(/Receber novidades da MA STORE/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("mastore.pushOptInDismissed")).toBe("1");
  });
});
