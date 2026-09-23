import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  LoadingBlock,
  Select,
  Skeleton,
} from "@/components/ui";
import { CartSummary } from "@/components/cart/Cart";
import { useCart, useClearCart, useToast } from "@/hooks";
import { useGuestCartStore } from "@/stores/cart";
import { UFS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatCurrency, maskCep, maskPhone, onlyDigits } from "@/lib/format";
import type { GuestPedido, ShippingEngineQuote } from "@/types/api";

type Step = "dados" | "endereco" | "entrega" | "revisao";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "dados", label: "Seus dados" },
  { id: "endereco", label: "Endereço" },
  { id: "entrega", label: "Entrega" },
  { id: "revisao", label: "Revisão" },
];

type Cliente = { nome: string; whatsapp: string; email: string };
type Endereco = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

const EMPTY_CLIENTE: Cliente = { nome: "", whatsapp: "", email: "" };
const EMPTY_ENDERECO: Endereco = {
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "SP",
};

/**
 * Checkout Guest — SEM cadastro.
 *
 * Fluxo: Carrinho -> Dados -> Endereço -> Entrega (frete) -> Pedido.
 * O servidor recalcula preço/peso/frete e devolve o token de rastreamento.
 */
export default function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const clearCart = useClearCart();
  const guestItems = useGuestCartStore((s) => s.items);

  const { data: cart, isLoading: cartLoading } = useCart();
  const [step, setStep] = useState<Step>("dados");

  const [cliente, setCliente] = useState<Cliente>(EMPTY_CLIENTE);
  const [endereco, setEndereco] = useState<Endereco>(EMPTY_ENDERECO);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [shippingOptionId, setShippingOptionId] = useState<string | null>(null);
  const [pagamentoMetodo, setPagamentoMetodo] = useState<"PIX" | "COMBINAR">("COMBINAR");

  useEffect(() => {
    applySeo({ title: "Finalizar compra", noindex: true, canonicalPath: "/checkout" });
  }, []);

  const items = cart?.items ?? [];
  const subtotal = cart?.summary.subtotal ?? 0;

  /** Itens no formato aceito pelo motor de frete (com peso unitário real). */
  const shippingItems = useMemo(
    () =>
      items.map((item) => {
        const guest = guestItems.find((entry) => entry.productId === item.product.id);
        return {
          id: item.product.id,
          nome: item.product.name,
          quantidade: item.quantity,
          peso_unitario: guest?.weightKg ?? 0.3,
        };
      }),
    [items, guestItems],
  );

  const cepDigits = onlyDigits(endereco.cep);
  const itemsSignature = shippingItems.map((i) => `${i.id}:${i.quantidade}`).join(",");

  /* --------------------------------------------------------------- frete */
  const quote = useQuery({
    queryKey: ["shipping", "engine", cepDigits, itemsSignature],
    queryFn: () =>
      api.post<ShippingEngineQuote>("/shipping", { cep: cepDigits, items: shippingItems }, { auth: false }),
    enabled: cepDigits.length === 8 && shippingItems.length > 0,
    staleTime: 60_000,
    retry: 1,
  });

  const shippingOptions = quote.data?.options ?? [];

  useEffect(() => {
    if (shippingOptions.length === 0) {
      setShippingOptionId(null);
      return;
    }
    setShippingOptionId((current) =>
      current && shippingOptions.some((option) => option.id === current) ? current : shippingOptions[0]!.id,
    );
  }, [shippingOptions]);

  /* ---------------------------------------------------------- pagamento */
  const paymentMethods = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () =>
      api.get<{
        methods: Array<{ id: "PIX" | "COMBINAR"; label: string; enabled: boolean; configured: boolean; note: string | null }>;
      }>("/payment-methods", { auth: false }),
    staleTime: 5 * 60_000,
  });

  const pixMethod = paymentMethods.data?.methods.find((method) => method.id === "PIX");
  const pixAvailable = Boolean(pixMethod?.enabled && pixMethod?.configured);

  useEffect(() => {
    // PIX só é pré-selecionado quando está realmente habilitado e configurado.
    if (pixAvailable) setPagamentoMetodo("PIX");
  }, [pixAvailable]);

  const selectedShipping = shippingOptions.find((option) => option.id === shippingOptionId) ?? null;
  const shippingCost = selectedShipping ? selectedShipping.valor : 0;
  const shippingCharged = selectedShipping?.incluirNoTotal ? shippingCost : 0;
  const total = Math.max(0, subtotal + shippingCharged);

  /* ------------------------------------------------------------- pedido */
  const createPedido = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; pedido: GuestPedido }>(
        "/pedidos",
        {
          cliente: {
            nome: cliente.nome.trim(),
            whatsapp: cliente.whatsapp.trim(),
            email: cliente.email.trim() || undefined,
          },
          endereco: {
            cep: cepDigits,
            logradouro: endereco.logradouro.trim(),
            numero: endereco.numero.trim(),
            complemento: endereco.complemento.trim() || undefined,
            bairro: endereco.bairro.trim(),
            cidade: endereco.cidade.trim(),
            uf: endereco.uf,
          },
          produtos: shippingItems,
          frete: selectedShipping ? { id: selectedShipping.id } : undefined,
          pagamento: { metodo: pagamentoMetodo },
        },
        { auth: false },
      ),
    onSuccess: (result) => {
      clearCart.mutate(undefined);
      toast.success("Pedido criado!", "Guarde o link de rastreamento.");
      navigate(`/rastreio/${result.pedido.token_rastreio_unico}`, { replace: true });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error("Não foi possível finalizar o pedido", errorMessage(error));
    },
  });

  /* -------------------------------------------------------- validações */
  const validateDados = () => {
    const next: Record<string, string> = {};
    if (cliente.nome.trim().length < 3) next["cliente.nome"] = "Informe seu nome completo.";
    if (onlyDigits(cliente.whatsapp).length < 10) next["cliente.whatsapp"] = "Informe um WhatsApp com DDD.";
    if (cliente.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email.trim())) {
      next["cliente.email"] = "Informe um e-mail válido.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateEndereco = () => {
    const next: Record<string, string> = {};
    if (cepDigits.length !== 8) next["endereco.cep"] = "Informe um CEP válido (8 dígitos).";
    if (endereco.logradouro.trim().length < 2) next["endereco.logradouro"] = "Informe o logradouro.";
    if (!endereco.numero.trim()) next["endereco.numero"] = "Informe o número.";
    if (endereco.bairro.trim().length < 2) next["endereco.bairro"] = "Informe o bairro.";
    if (endereco.cidade.trim().length < 2) next["endereco.cidade"] = "Informe a cidade.";
    if (!UFS.includes(endereco.uf as (typeof UFS)[number])) next["endereco.uf"] = "Selecione o estado.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  if (cartLoading) return <LoadingBlock label="Preparando seu checkout…" />;

  if (items.length === 0) {
    return (
      <div className="container py-12">
        <EmptyState
          icon="cart"
          title="Seu carrinho está vazio"
          text="Adicione produtos para finalizar uma compra."
          action={<Button onClick={() => navigate("/produtos")}>Ver produtos</Button>}
        />
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  const dadosValidos =
    cliente.nome.trim().length >= 3 &&
    onlyDigits(cliente.whatsapp).length >= 10 &&
    (!cliente.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email.trim()));

  const enderecoValido =
    cepDigits.length === 8 &&
    endereco.logradouro.trim().length >= 2 &&
    endereco.numero.trim().length > 0 &&
    endereco.bairro.trim().length >= 2 &&
    endereco.cidade.trim().length >= 2 &&
    UFS.includes(endereco.uf as (typeof UFS)[number]);

  const canContinue =
    step === "dados"
      ? dadosValidos
      : step === "endereco"
        ? enderecoValido
        : step === "entrega"
          ? Boolean(shippingOptionId)
          : true;

  const goNext = () => {
    if (step === "dados") {
      if (!validateDados()) return;
      setStep("endereco");
      return;
    }
    if (step === "endereco") {
      if (!validateEndereco()) return;
      setStep("entrega");
      return;
    }
    if (step === "entrega") {
      if (!shippingOptionId) return;
      setStep("revisao");
    }
  };

  const goBack = () => {
    const previous = STEPS[stepIndex - 1];
    if (previous) setStep(previous.id);
  };

  const handleSubmit = () => {
    if (createPedido.isPending) return;
    if (cepDigits.length !== 8 || shippingItems.length === 0) return;
    createPedido.mutate();
  };

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Carrinho", to: "/carrinho" }, { label: "Checkout" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Finalizar compra</h1>
        <p className="page-header__subtitle">Compra rápida, sem cadastro. Só precisamos dos dados de entrega.</p>
      </div>

      <div className="checkout-steps" role="list" aria-label="Etapas do checkout">
        {STEPS.map((entry, index) => {
          const isDone = index < stepIndex;
          const isActive = index === stepIndex;
          return (
            <div
              key={entry.id}
              role="listitem"
              className={["checkout-step", isActive ? "checkout-step--active" : "", isDone ? "checkout-step--done" : ""]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="checkout-step__num">{isDone ? <Icon name="check" size={12} /> : index + 1}</span>
              {entry.label}
            </div>
          );
        })}
      </div>

      <div className="cart-layout">
        <div className="stack stack-5">
          {/* ---------------------------------------------------------- DADOS */}
          {step === "dados" ? (
            <Card>
              <h2 className="text-lg mb-4">Seus dados</h2>
              <div className="stack stack-4">
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
                  <Input
                    label="Nome completo"
                    value={cliente.nome}
                    onChange={(event) => setCliente({ ...cliente, nome: event.target.value })}
                    error={errors["cliente.nome"]}
                    autoComplete="name"
                    required
                  />
                  <Input
                    label="WhatsApp"
                    value={cliente.whatsapp}
                    onChange={(event) => setCliente({ ...cliente, whatsapp: maskPhone(event.target.value) })}
                    placeholder="(00) 00000-0000"
                    inputMode="tel"
                    error={errors["cliente.whatsapp"]}
                    hint="Usamos para avisar sobre o pedido."
                    required
                  />
                  <Input
                    label="E-mail"
                    type="email"
                    value={cliente.email}
                    onChange={(event) => setCliente({ ...cliente, email: event.target.value })}
                    error={errors["cliente.email"]}
                    hint="Opcional"
                    autoComplete="email"
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {/* -------------------------------------------------------- ENDEREÇO */}
          {step === "endereco" ? (
            <Card>
              <h2 className="text-lg mb-4">Endereço de entrega</h2>
              <div className="stack stack-4">
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-4)" }}>
                  <Input
                    label="CEP"
                    value={endereco.cep}
                    onChange={(event) => setEndereco({ ...endereco, cep: maskCep(event.target.value) })}
                    placeholder="00000-000"
                    inputMode="numeric"
                    error={errors["endereco.cep"]}
                    required
                  />
                  <Input
                    label="Número"
                    value={endereco.numero}
                    onChange={(event) => setEndereco({ ...endereco, numero: event.target.value })}
                    error={errors["endereco.numero"]}
                    required
                  />
                  <Input
                    label="Complemento"
                    value={endereco.complemento}
                    onChange={(event) => setEndereco({ ...endereco, complemento: event.target.value })}
                    error={errors["endereco.complemento"]}
                    hint="Opcional"
                  />
                </div>

                <Input
                  label="Logradouro"
                  value={endereco.logradouro}
                  onChange={(event) => setEndereco({ ...endereco, logradouro: event.target.value })}
                  error={errors["endereco.logradouro"]}
                  autoComplete="street-address"
                  required
                />

                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-4)" }}>
                  <Input
                    label="Bairro"
                    value={endereco.bairro}
                    onChange={(event) => setEndereco({ ...endereco, bairro: event.target.value })}
                    error={errors["endereco.bairro"]}
                    required
                  />
                  <Input
                    label="Cidade"
                    value={endereco.cidade}
                    onChange={(event) => setEndereco({ ...endereco, cidade: event.target.value })}
                    error={errors["endereco.cidade"]}
                    required
                  />
                  <Select
                    label="Estado (UF)"
                    value={endereco.uf}
                    onChange={(event) => setEndereco({ ...endereco, uf: event.target.value })}
                    error={errors["endereco.uf"]}
                    options={UFS.map((uf) => ({ value: uf, label: uf }))}
                    required
                  />
                </div>
              </div>
            </Card>
          ) : null}

          {/* --------------------------------------------------------- ENTREGA */}
          {step === "entrega" ? (
            <Card>
              <h2 className="text-lg mb-4">Escolha a forma de entrega</h2>

              {cepDigits.length !== 8 ? (
                <Alert tone="info">Volte à etapa anterior e informe um CEP válido para calcular a entrega.</Alert>
              ) : quote.isLoading ? (
                <Skeleton height={90} />
              ) : quote.error ? (
                <Alert tone="danger" title="Não foi possível calcular o frete">
                  {errorMessage(quote.error)}
                  <div className="mt-3">
                    <Button size="sm" variant="ghost" onClick={() => void quote.refetch()}>
                      Tentar novamente
                    </Button>
                  </div>
                </Alert>
              ) : shippingOptions.length === 0 ? (
                <Alert tone="warning" title="Nenhuma modalidade disponível">
                  Não encontramos opções de entrega para o CEP {maskCep(cepDigits)}. Fale com o atendimento pelo
                  WhatsApp para combinar a entrega.
                </Alert>
              ) : (
                <div className="stack stack-3">
                  {quote.data?.warnings?.map((warning) => (
                    <Alert key={warning} tone="warning">
                      {warning}
                    </Alert>
                  ))}

                  <div className="option-list">
                    {shippingOptions.map((option) => (
                      <label
                        key={option.id}
                        className={["option-item", shippingOptionId === option.id ? "option-item--selected" : ""]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <input
                          type="radio"
                          name="shipping"
                          checked={shippingOptionId === option.id}
                          onChange={() => setShippingOptionId(option.id)}
                          style={{ marginTop: 3 }}
                        />
                        <span className="option-item__content">
                          <span className="option-item__title">{option.nome}</span>
                          <span className="option-item__hint">
                            {option.prazo}
                            {option.pagoDireto ? " • pago direto à transportadora" : ""}
                            {option.descricao && !option.pagoDireto ? ` • ${option.descricao}` : ""}
                          </span>
                        </span>
                        <span className="option-item__price">
                          {option.valor === 0 ? "Grátis" : formatCurrency(option.valor)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          {/* --------------------------------------------------------- REVISÃO */}
          {step === "revisao" ? (
            <Card>
              <h2 className="text-lg mb-4">Revise seu pedido</h2>
              <div className="stack stack-4">
                <div>
                  <p className="field__label">Itens</p>
                  <div className="stack stack-2">
                    {items.map((item) => (
                      <div key={item.id} className="row row-between text-sm">
                        <span>
                          {item.quantity}x {item.product.name}
                        </span>
                        <span className="tabular text-strong">{formatCurrency(item.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="field__label">Entrega</p>
                  <p className="text-sm text-muted">
                    {endereco.logradouro}, {endereco.numero}
                    {endereco.complemento ? ` — ${endereco.complemento}` : ""}
                    <br />
                    {endereco.bairro}, {endereco.cidade}/{endereco.uf} • CEP {maskCep(cepDigits)}
                  </p>
                  {selectedShipping ? (
                    <p className="text-sm text-muted mt-1">
                      {selectedShipping.nome} • {selectedShipping.prazo}
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="field__label">Forma de pagamento</p>
                  <div className="option-list">
                    {pixAvailable ? (
                      <label
                        className={["option-item", pagamentoMetodo === "PIX" ? "option-item--selected" : ""].filter(Boolean).join(" ")}
                      >
                        <input
                          type="radio"
                          name="pagamento"
                          checked={pagamentoMetodo === "PIX"}
                          onChange={() => setPagamentoMetodo("PIX")}
                          style={{ marginTop: 3 }}
                        />
                        <span className="option-item__content">
                          <span className="option-item__title">PIX</span>
                          <span className="option-item__hint">
                            O QR Code e o copia e cola aparecem na página do pedido. A confirmação é feita pela loja.
                          </span>
                        </span>
                      </label>
                    ) : null}

                    <label
                      className={["option-item", pagamentoMetodo === "COMBINAR" ? "option-item--selected" : ""].filter(Boolean).join(" ")}
                    >
                      <input
                        type="radio"
                        name="pagamento"
                        checked={pagamentoMetodo === "COMBINAR"}
                        onChange={() => setPagamentoMetodo("COMBINAR")}
                        style={{ marginTop: 3 }}
                      />
                      <span className="option-item__content">
                        <span className="option-item__title">Combinar com a loja (WhatsApp)</span>
                        <span className="option-item__hint">A loja combina o pagamento com você pelo atendimento.</span>
                      </span>
                    </label>
                  </div>

                  {pixMethod && !pixMethod.configured ? (
                    <p className="text-xs text-muted mt-2">{pixMethod.note}</p>
                  ) : null}
                </div>

                <div>
                  <p className="field__label">Contato</p>
                  <p className="text-sm text-muted">
                    {cliente.nome} • {cliente.whatsapp}
                    {cliente.email ? ` • ${cliente.email}` : ""}
                  </p>
                </div>
              </div>
            </Card>
          ) : null}

          <div className="row row-3 row-between">
            <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0} icon="arrowLeft">
              Voltar
            </Button>

            {step === "revisao" ? (
              <Button
                size="lg"
                onClick={handleSubmit}
                loading={createPedido.isPending}
                disabled={!shippingOptionId}
                iconRight="check"
              >
                Finalizar pedido
              </Button>
            ) : (
              <Button size="lg" onClick={goNext} disabled={!canContinue} iconRight="arrowRight">
                Continuar
              </Button>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------ RESUMO */}
        <Card className="summary-card">
          <h2 className="text-lg">Resumo do pedido</h2>

          <CartSummary
            subtotal={subtotal}
            discount={0}
            shipping={step === "entrega" || step === "revisao" ? shippingCharged : null}
            shippingLabel={selectedShipping?.nome ?? "Entrega"}
            total={total}
          />

          {selectedShipping?.pagoDireto ? (
            <Alert tone="info">
              O frete {selectedShipping.nome} é pago diretamente à transportadora no momento do envio.
            </Alert>
          ) : null}

          <p className="text-xs text-muted">
            O valor final é recalculado no servidor ao criar o pedido — preço, peso e frete sempre conferidos.
          </p>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
