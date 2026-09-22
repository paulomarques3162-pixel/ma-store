import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LoadingBlock, ToastRegion } from "@/components/ui";
import { MobileBottomNav, MobileMenu, SiteFooter, SiteHeader } from "@/components/layout/SiteChrome";
import { CartDrawer } from "@/components/layout/CartDrawer";
import { FloatingShortcuts } from "@/components/layout/FloatingShortcuts";
import { InstallPrompt } from "@/components/layout/InstallPrompt";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  NotFoundPage,
  RequireAdmin,
  RequireAuth,
  SessionExpiredWatcher,
  useSessionBootstrap,
} from "@/components/layout/guards";
import { useTheme } from "@/hooks";

/* -------------------------------------------------------------------------- */
/* Rotas carregadas sob demanda (code splitting)                               */
/* -------------------------------------------------------------------------- */

// Loja
const HomePage = lazy(() => import("@/pages/HomePage"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const ProductPage = lazy(() => import("@/pages/ProductPage"));
const CategoryPage = lazy(() => import("@/pages/CategoryPage"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));
const CartPage = lazy(() => import("@/pages/CartPage"));
const CheckoutPage = lazy(() => import("@/pages/CheckoutPage"));
const TrackingPage = lazy(() => import("@/pages/TrackingPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/RegisterPage"));
const AccountPage = lazy(() => import("@/pages/AccountPage"));
const OrdersPage = lazy(() => import("@/pages/OrdersPage"));
const OrderDetailPage = lazy(() => import("@/pages/OrderDetailPage"));
const FavoritesPage = lazy(() => import("@/pages/FavoritesPage"));
const MessagesPage = lazy(() => import("@/pages/MessagesPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const FeedbackPage = lazy(() => import("@/pages/FeedbackPage"));
const ContactPage = lazy(() => import("@/pages/ContactPage"));
const HowToBuyPage = lazy(() => import("@/pages/HowToBuyPage"));
const ExchangesPage = lazy(() => import("@/pages/ExchangesPage"));
const LegalPage = lazy(() => import("@/pages/LegalPage"));

// Painel administrativo
const AdminLoginPage = lazy(() => import("@/pages/admin/AdminLoginPage"));
const DashboardPage = lazy(() => import("@/pages/admin/DashboardPage"));
const AdminProductsPage = lazy(() => import("@/pages/admin/ProductsPage"));
const AdminProductFormPage = lazy(() => import("@/pages/admin/ProductFormPage"));
const AdminCategoriesPage = lazy(() => import("@/pages/admin/CategoriesPage"));
const AdminPedidosPage = lazy(() => import("@/pages/admin/PedidosPage"));
const AdminPedidoDetailPage = lazy(() => import("@/pages/admin/PedidoDetailPage"));
const AdminUsersPage = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetailPage = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminCouponsPage = lazy(() => import("@/pages/admin/CouponsPage"));
const AdminPaymentsPage = lazy(() => import("@/pages/admin/PaymentsPage"));
const AdminShippingPage = lazy(() => import("@/pages/admin/ShippingPage"));
const AdminMessagesPage = lazy(() => import("@/pages/admin/MessagesPage"));
const AdminFeedbacksPage = lazy(() => import("@/pages/admin/FeedbacksPage"));
const AdminContentPage = lazy(() => import("@/pages/admin/ContentPage"));
const AdminLayoutEditorPage = lazy(() => import("@/pages/admin/LayoutEditorPage"));
const AdminNotificationsPage = lazy(() => import("@/pages/admin/NotificationsPage"));
const AdminLabPage = lazy(() => import("@/pages/admin/LabPage"));
const AdminLogsPage = lazy(() => import("@/pages/admin/LogsPage"));
const AdminSettingsPage = lazy(() => import("@/pages/admin/SettingsPage"));

/* -------------------------------------------------------------------------- */
/* Layouts                                                                     */
/* -------------------------------------------------------------------------- */

function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo" className="app-main">
        {children}
      </main>
      <SiteFooter />
      <MobileBottomNav />
      <MobileMenu />
      <CartDrawer />
      <FloatingShortcuts />
      <InstallPrompt />
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <StoreLayout>{children}</StoreLayout>;
}

/* -------------------------------------------------------------------------- */
/* Aplicação                                                                   */
/* -------------------------------------------------------------------------- */

export function App() {
  useSessionBootstrap();
  useTheme();

  return (
    <>
      <SessionExpiredWatcher />
      <ToastRegion />

      <Suspense fallback={<LoadingBlock label="Carregando…" />}>
        <Routes>
          {/* ------------------------------------------------------------- Loja */}
          <Route path="/" element={<Page><HomePage /></Page>} />
          <Route path="/produtos" element={<Page><ProductsPage /></Page>} />
          <Route path="/produto/:slug" element={<Page><ProductPage /></Page>} />
          <Route path="/categoria/:slug" element={<Page><CategoryPage /></Page>} />
          <Route path="/buscar" element={<Page><SearchPage /></Page>} />
          <Route path="/carrinho" element={<Page><CartPage /></Page>} />
          <Route path="/checkout" element={<Page><CheckoutPage /></Page>} />
          <Route path="/rastreio/:token" element={<Page><TrackingPage /></Page>} />
          <Route path="/favoritos" element={<Page><FavoritesPage /></Page>} />
          <Route path="/como-comprar" element={<Page><HowToBuyPage /></Page>} />
          <Route path="/trocas-e-devolucoes" element={<Page><ExchangesPage /></Page>} />
          <Route path="/contato" element={<Page><ContactPage /></Page>} />
          <Route path="/politica-de-privacidade" element={<Page><LegalPage kind="privacy" /></Page>} />
          <Route path="/termos-de-uso" element={<Page><LegalPage kind="terms" /></Page>} />

          {/* Autenticação (layout próprio, sem o chrome da loja) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />

          {/* Área do cliente */}
          <Route path="/minha-conta" element={<Page><RequireAuth><AccountPage /></RequireAuth></Page>} />
          <Route path="/meus-pedidos" element={<Page><RequireAuth><OrdersPage /></RequireAuth></Page>} />
          <Route path="/meus-pedidos/:id" element={<Page><RequireAuth><OrderDetailPage /></RequireAuth></Page>} />
          <Route path="/mensagens" element={<Page><RequireAuth><MessagesPage /></RequireAuth></Page>} />
          <Route path="/notificacoes" element={<Page><RequireAuth><NotificationsPage /></RequireAuth></Page>} />
          <Route path="/feedback" element={<Page><RequireAuth><FeedbackPage /></RequireAuth></Page>} />

          {/* ----------------------------------------------------- Administração */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="produtos" element={<AdminProductsPage />} />
            <Route path="produtos/novo" element={<AdminProductFormPage />} />
            <Route path="produtos/:id" element={<AdminProductFormPage />} />
            <Route path="categorias" element={<AdminCategoriesPage />} />
            <Route path="pedidos" element={<AdminPedidosPage />} />
            <Route path="pedidos/:id" element={<AdminPedidoDetailPage />} />
            <Route path="usuarios" element={<AdminUsersPage />} />
            <Route path="usuarios/:id" element={<AdminUserDetailPage />} />
            <Route path="cupons" element={<AdminCouponsPage />} />
            <Route path="pagamentos" element={<AdminPaymentsPage />} />
            <Route path="fretes" element={<AdminShippingPage />} />
            <Route path="mensagens" element={<AdminMessagesPage />} />
            <Route path="feedbacks" element={<AdminFeedbacksPage />} />
            <Route path="conteudo" element={<AdminContentPage />} />
            <Route path="layout" element={<AdminLayoutEditorPage />} />
            <Route path="notificacoes" element={<AdminNotificationsPage />} />
            <Route path="testes" element={<AdminLabPage />} />
            <Route path="logs" element={<AdminLogsPage />} />
            <Route path="configuracoes" element={<AdminSettingsPage />} />
          </Route>

          {/* -------------------------------------------------------------- 404 */}
          <Route path="*" element={<Page><NotFoundPage /></Page>} />
        </Routes>
      </Suspense>
    </>
  );
}
