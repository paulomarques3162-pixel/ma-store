import { create } from "zustand";

/**
 * Estado de interface (não persistido, exceto preferências simples).
 * Toasts, gavetas, menu mobile, sidebar do admin e aviso de instalação do PWA.
 */

export type ToastTone = "success" | "error" | "warning" | "info";

export type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
};

type UiState = {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id"> & { durationMs?: number }) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;

  cartDrawerOpen: boolean;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;

  mobileMenuOpen: boolean;
  openMobileMenu: () => void;
  closeMobileMenu: () => void;

  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;

  adminSidebarOpen: boolean;
  toggleAdminSidebar: () => void;
  closeAdminSidebar: () => void;

  installPromptDismissed: boolean;
  dismissInstallPrompt: () => void;
};

let toastCounter = 0;

export const useUiStore = create<UiState>()((set) => ({
  toasts: [],

  pushToast({ tone, title, message, durationMs = 5000 }) {
    toastCounter += 1;
    const id = `t${toastCounter}`;
    set((state) => ({ toasts: [...state.toasts, { id, tone, title, message }] }));

    if (durationMs > 0) {
      window.setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, durationMs);
    }

    return id;
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearToasts() {
    set({ toasts: [] });
  },

  cartDrawerOpen: false,
  openCartDrawer: () => set({ cartDrawerOpen: true, mobileMenuOpen: false }),
  closeCartDrawer: () => set({ cartDrawerOpen: false }),

  mobileMenuOpen: false,
  openMobileMenu: () => set({ mobileMenuOpen: true, searchOpen: false }),
  closeMobileMenu: () => set({ mobileMenuOpen: false }),

  searchOpen: false,
  openSearch: () => set({ searchOpen: true, mobileMenuOpen: false }),
  closeSearch: () => set({ searchOpen: false }),

  adminSidebarOpen: false,
  toggleAdminSidebar: () => set((state) => ({ adminSidebarOpen: !state.adminSidebarOpen })),
  closeAdminSidebar: () => set({ adminSidebarOpen: false }),

  installPromptDismissed:
    typeof localStorage !== "undefined" && localStorage.getItem("mastore.installDismissed") === "1",
  dismissInstallPrompt: () => {
    try {
      localStorage.setItem("mastore.installDismissed", "1");
    } catch {
      /* storage indisponível */
    }
    set({ installPromptDismissed: true });
  },
}));
