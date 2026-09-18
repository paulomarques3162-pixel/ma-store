import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Drawer,
  EmptyState,
  Icon,
  LoadingBlock,
  ProductImage,
  QuantitySelector,
} from "@/components/ui";
import {
  useCart,
  useRemoveCartItem,
  useUpdateCartItem,
  useToast,
} from "@/hooks";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { EMPTY_MESSAGES } from "@/lib/constants";
import { errorMessage, errorRequestId } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { ApiError } from "@/lib/api";

/**
 * Gaveta do carrinho (atalho 🛒).
 *
 * Todas as alterações chamam o backend; o carrinho local nunca é a fonte da
 * verdade. Quantidades inválidas retornam erro tratado com o `requestId`.
 */
export function CartDrawer() {
  const open = useUiStore((s) => s.cartDrawerOpen);
  const close = useUiStore((s) => s.closeCartDrawer);
  const navigate = useNavigate();
  const toast = useToast();
  const status = useAuthStore((s) => s.status);

  const isAuthenticated = status === "authenticated";
  const { data: cart, isLoading, error, refetch } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  const handleUpdate = (itemId: string, quantity: number) => {
    updateItem.mutate(
      { itemId, quantity },
      {
        onError: (mutationError) => {
          toast.error("Não foi possível atualizar", errorMessage(mutationError));
        },
      },
    );
  };

  const handleRemove = (itemId: string) => {
    removeItem.mutate(itemId, {
      onSuccess: () => toast.success("Item removido do carrinho"),
      onError: (mutationError) => toast.error("Não foi possível remover", errorMessage(mutationError)),
    });
  };

  const goTo = (path: string) => {
    close();
    navigate(path);
  };

  const items = cart?.items ?? [];
  const hasIssues = cart?.summary.hasIssues ?? false;

  return (
    <Drawer
      open={open}
      onClose={close}
      title={`Carrinho${cart ? ` (${cart.summary.totalItems})` : ""}`}
      footer={
        items.length > 0 ? (
          <div className="stack stack-3">
            <div className="summary-row summary-row--total">
              <span className="summary-row__label">Total</span>
              <span className="summary-row__value">{formatCurrency(cart?.summary.subtotal ?? 0)}</span>
            </div>
            <Button
              block
              onClick={() => goTo("/checkout")}
              disabled={hasIssues || !isAuthenticated}
              iconRight="arrowRight"
            >
              Finalizar compra
            </Button>
            <Button variant="ghost" block onClick={() => goTo("/carrinho")}>
              Ver carrinho completo
            </Button>
            {!isAuthenticated ? (
              <p className="text-xs text-muted text-center">
                É necessário entrar na sua conta para finalizar.
              </p>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {!isAuthenticated ? (
        <div className="stack stack-4">
          <Alert tone="info" title="Entre para usar o carrinho">
            A compra exige uma conta para que você acompanhe seus pedidos.
          </Alert>
          <Button block onClick={() => goTo("/login")} icon="user">
            Entrar ou criar conta
          </Button>
        </div>
      ) : isLoading ? (
        <LoadingBlock label="Carregando carrinho…" />
      ) : error ? (
        <Alert tone="danger" title="Não foi possível carregar o carrinho">
          {errorMessage(error)}
          {errorRequestId(error) ? <p className="text-xs mt-2">Código: {errorRequestId(error)}</p> : null}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          icon="cart"
          title={EMPTY_MESSAGES.cart.title}
          text={EMPTY_MESSAGES.cart.text}
          action={
            <Button onClick={() => goTo("/produtos")} icon="grid">
              Ver produtos
            </Button>
          }
        />
      ) : (
        <div className="stack stack-3">
          {hasIssues ? (
            <Alert tone="warning" title="Alguns itens mudaram">
              Há itens sem estoque suficiente. Ajuste as quantidades para continuar.
            </Alert>
          ) : null}

          {items.map((item) => (
            <div key={item.id} className="row row-3" style={{ alignItems: "flex-start" }}>
              <Link
                to={`/produto/${item.product.slug}`}
                onClick={close}
                style={{ width: 64, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "var(--color-surface-2)" }}
              >
                <ProductImage src={item.product.images[0]?.url} alt={item.product.name} aspectRatio="1 / 1" />
              </Link>

              <div className="stack stack-2" style={{ flex: 1, minWidth: 0 }}>
                <Link to={`/produto/${item.product.slug}`} onClick={close} className="text-sm text-strong clamp-2">
                  {item.product.name}
                </Link>
                <span className="text-xs text-muted">
                  {formatCurrency(item.unitPrice)}
                  {item.product.volume ? ` • ${item.product.volume}` : ""}
                </span>
                {!item.available ? (
                  <span className="text-xs" style={{ color: "var(--color-danger)" }}>
                    Estoque insuficiente (disponível: {item.stock})
                  </span>
                ) : null}
                <div className="row row-2 row-between">
                  <QuantitySelector
                    value={item.quantity}
                    onChange={(quantity) => handleUpdate(item.id, quantity)}
                    max={item.stock}
                    disabled={updateItem.isPending}
                    label={`Quantidade de ${item.product.name}`}
                  />
                  <button
                    type="button"
                    className="btn btn--link btn--sm"
                    onClick={() => handleRemove(item.id)}
                    disabled={removeItem.isPending}
                  >
                    <Icon name="trash" size={14} /> Remover
                  </button>
                </div>
              </div>

              <span className="text-sm text-strong tabular" style={{ whiteSpace: "nowrap" }}>
                {formatCurrency(item.lineTotal)}
              </span>
            </div>
          ))}
        </div>
      )}

      {error instanceof ApiError ? null : null}
    </Drawer>
  );
}
