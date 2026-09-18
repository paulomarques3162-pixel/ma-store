import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, tokenStore, onSessionExpired } from "@/lib/api";
import type { AuthSession, User } from "@/types/api";

/**
 * Estado de autenticação.
 *
 * - Os tokens ficam no `tokenStore` (localStorage) e são usados pelo cliente HTTP.
 * - O perfil do usuário é persistido para evitar "flash" de deslogado no reload;
 *   ele é SEMPRE revalidado contra `GET /api/auth/me` na inicialização.
 * - Se a API recusar o token, o estado é limpo automaticamente.
 */

export type AuthStatus = "loading" | "authenticated" | "guest";

type AuthState = {
  user: User | null;
  status: AuthStatus;
  /** Sessão marcada como expirada enquanto o usuário navegava. */
  sessionExpired: boolean;

  setSession: (session: AuthSession) => void;
  setUser: (user: User) => void;
  clear: () => void;
  acknowledgeSessionExpired: () => void;
  /** Revalida o perfil junto à API. */
  refresh: () => Promise<User | null>;
  isAdmin: () => boolean;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      status: "loading",
      sessionExpired: false,

      setSession(session) {
        tokenStore.set(session.accessToken, session.refreshToken);
        set({ user: session.user, status: "authenticated", sessionExpired: false });
      },

      setUser(user) {
        set({ user, status: "authenticated" });
      },

      clear() {
        tokenStore.clear();
        set({ user: null, status: "guest" });
      },

      acknowledgeSessionExpired() {
        set({ sessionExpired: false });
      },

      async refresh() {
        if (!tokenStore.getAccess()) {
          set({ user: null, status: "guest" });
          return null;
        }

        try {
          const user = await api.get<User>("/auth/me");
          set({ user, status: "authenticated" });
          return user;
        } catch {
          tokenStore.clear();
          set({ user: null, status: "guest" });
          return null;
        }
      },

      isAdmin: () => get().user?.role === "ADMIN",
    }),
    {
      name: "mastore.auth",
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        // Sem usuário persistido, já começa como visitante.
        if (state && !state.user) state.status = "guest";
      },
    },
  ),
);

// Se o refresh token falhar durante uma requisição qualquer, derruba a sessão
// e sinaliza para a UI (que mostra um aviso amigável e redireciona ao login).
onSessionExpired(() => {
  const state = useAuthStore.getState();
  if (state.user) {
    useAuthStore.setState({ user: null, status: "guest", sessionExpired: true });
  } else {
    useAuthStore.setState({ user: null, status: "guest" });
  }
});

export function getAccessToken(): string | null {
  return tokenStore.getAccess();
}
