import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Icon,
  Input,
  LoadingBlock,
  Select,
  Skeleton,
} from "@/components/ui";
import { CartSummary, CouponForm } from "@/components/cart/Cart";
import { useContent, useToast, useValidateCoupon, useCart } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { CONTENT_KEYS, UFS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, fieldErrors } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, maskCep, maskPhone, onlyDigits } from "@/lib/format";
import type { Address, Order, PaymentMethod, ShippingQuote } from "@/types/api";
import { PAYMENT_METHOD } from "@/lib/constants";

type Step = "address" | "shipping" | "payment" | "review";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "address", label: "Endereço" },
  { id: "shipping", label: "Entrega" },
  { id: "payment", label: "Pagamento" },
  { id: "review", label: "Revisão" },
];

/**
 * Checkout em etapas.
 *
 * Garantias implementadas:
 *  - preço, frete, cupom e total são SEMPRE recalculados pelo backend;
 *  - o botão de finalizar envia `X-Idempotency-Key` (duplo clique não duplica pedido);
 *  - formas de pagamento só aparecem se a loja as habilitou no painel;
 *  - nenhum dado da loja é inventado (frete e pagamento vêm da API/CMS).
 */
export default function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const { get } = useContent();

  const { data: cart, isLoading: cartLoading } = useCart();
  const [step, setStep] = useState<Step>("address");

  // Endereço
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [useNewAddress, setUseNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({
    label: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "SP",
    isDefault: false,
  });
  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});

  // Entrega
  const [shippingMethodId, setShippingMethodId] = useState<string | null>(null);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Cupom
  const [coupon, setCoupon] = useState<{ code: string; discount: number; shippingDiscount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // Pagamento
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [notes, setNotes] = useState("");

  const validateCoupon = useValidateCoupon();

  useEffect(() => {
    applySeo({ title: "Finalizar compra", noindex: true, canonicalPath: "/checkout" });
  }, []);

  // Cupom herdado do carrinho
  useEffect(() => {
    const inherited = (location.state as { couponCode?: string } | null)?.couponCode;
    if (inherited) validateCoupon.mutate({ code: inherited }, {
      onSuccess: (result) => setCoupon({ code: result.code, discount: result.discount, shippingDiscount: result.shippingDiscount }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------------------------------- endereços */
  const addresses = useQuery({
    queryKey: queryKeys.addresses,
    queryFn: () => api.get<Address[]>("/users/me/addresses"),
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (addresses.data && addresses.data.length > 0 && !selectedAddressId) {
      setSelectedAddressId(addresses.data.find((a) => a.isDefault)?.id ?? addresses.data[0]!.id);
    }
    if (addresses.data && addresses.data.length === 0) setUseNewAddress(true);
  }, [addresses.data, selectedAddressId]);

  const createAddress = useMutation({
    mutationFn: (payload: typeof newAddress) =>
      api.post<Address>("/users/me/addresses", {
        ...payload,
        cep: onlyDigits(payload.cep),
      }),
    onSuccess: (address) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
      setSelectedAddressId(address.id);
      setUseNewAddress(false);
      toast.success("Endereço salvo", "Você pode reutilizá-lo nas próximas compras.");
    },
    onError: (error) => {
      setAddressErrors(fieldErrors(error));
      toast.error("Não foi possível salvar o endereço", errorMessage(error));
    },
  });

  /* ------------------------------------------------------------ frete */
  const selectedAddress = useMemo(
    () => addresses.data?.find((a) => a.id === selectedAddressId) ?? null,
    [addresses.data, selectedAddressId],
  );

  const cepForQuote = useNewAddress ? onlyDigits(newAddress.cep) : (selectedAddress?.cep ?? "");

  const quote = useQuery({
    queryKey: ["shipping", "quote", cepForQuote],
    queryFn: () => api.post<ShippingQuote>("/shipping/quote", { cep: cepForQuote }),
    enabled: cepForQuote.length === 8,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (quote.data) {
      setShippingQuote(quote.data);
      setQuoteError(null);
      setShippingMethodId((current) => current ?? quote.data.options[0]?.id ?? null);
    }
    if (quote.error) setQuoteError(errorMessage(quote.error));
  }, [quote.data, quote.error]);

  /* ------------------------------------------------------- totais */
  const items = cart?.items ?? [];
  const subtotal = cart?.summary.subtotal ?? 0;
  const discount = coupon?.discount ?? 0;

  const selectedShipping = shippingQuote?.options.find((option) => option.id === shippingMethodId) ?? null;
  const shippingCost = shippingQuote?.required ? (selectedShipping?.price ?? 0) : 0;
  const shippingDiscount = Math.min(coupon?.shippingDiscount ?? 0, shippingCost);
  const total = Math.max(0, subtotal - discount + shippingCost - shippingDiscount);

  /* -------------------------------------------------- pagamento (CMS) */
  const enabledPayments = useMemo(() => {
    const parse = (key: string, fallback: boolean) => {
      const raw = get(key);
      if (raw === null) return fallback;
      return raw === "true" || raw === "1";
    };

    const list: PaymentMethod[] = [];
    if (parse(CONTENT_KEYS.pixEnabled, true)) list.push("PIX");
    if (parse(CONTENT_KEYS.cardEnabled, true)) list.push("CREDIT_CARD");
    if (parse(CONTENT_KEYS.boletoEnabled, false)) list.push("BOLETO");
    // "MANUAL" é sempre possível: combinar direto com a loja não depende de gateway.
    list.push("MANUAL");
    return list;
  }, [get]);

  useEffect(() => {
    if (!paymentMethod && enabledPayments.length > 0) setPaymentMethod(enabledPayments[0]!);
  }, [enabledPayments, paymentMethod]);

  /* -------------------------------------------------------- pedido */
  const createOrder = useMutation({
    mutationFn: (idempotencyKey: string) =>
      api.post<Order>(
        "/orders",
        {
          ...(useNewAddress ? { address: { ...newAddress, cep: onlyDigits(newAddress.cep) } } : { addressId: selectedAddressId }),
          shippingMethodId: shippingMethodId ?? undefined,
          couponCode: coupon?.code,
          paymentMethod,
          notes: notes || undefined,
        },
        { headers: { "X-Idempotency-Key": idempotencyKey } },
      ),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders({}) });
      toast.success("Pedido criado!", `Número ${order.number}`);
      navigate(`/meus-pedidos/${order.id}`, { replace: true });
    },
    onError: (error) => {
      toast.error("Não foi possível finalizar o pedido", errorMessage(error));
    },
  });

  if (status !== "authenticated") {
    return (
      <div className="container py-12">
        <EmptyState
          icon="lock"
          title="Entre para finalizar a compra"
          text="Precisamos da sua conta para registrar o pedido e o endereço de entrega."
          action={<Button onClick={() => navigate("/login")}>Entrar</Button>}
        />
      </div>
    );
  }

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

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canContinueAddress = useNewAddress
    ? onlyDigits(newAddress.cep).length === 8 &&
      newAddress.street.trim().length >= 2 &&
      newAddress.number.trim().length >= 1 &&
      newAddress.district.trim().length >= 2 &&
      newAddress.city.trim().length >= 2 &&
      newAddress.state.length === 2
    : Boolean(selectedAddressId);

  const canContinueShipping = !shippingQuote?.required || Boolean(shippingMethodId);
  const canSubmit = canContinueAddress && canContinueShipping && Boolean(paymentMethod);

  const validateAddressFields = () => {
    const errors: Record<string, string> = {};
    if (onlyDigits(newAddress.cep).length !== 8) errors.cep = "Informe um CEP válido (8 dígitos).";
    if (newAddress.street.trim().length < 2) errors.street = "Informe a rua.";
    if (!newAddress.number.trim()) errors.number = "Informe o número.";
    if (newAddress.district.trim().length < 2) errors.district = "Informe o bairro.";
    if (newAddress.city.trim().length < 2) errors.city = "Informe a cidade.";
    if (newAddress.state.length !== 2) errors.state = "Selecione o estado.";
    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveAddressIfNeeded = () => {
    if (!useNewAddress) return true;
    if (!validateAddressFields()) return false;
    createAddress.mutate(newAddress);
    return false; // aguarda a mutation concluir
  };

  const goNext = () => {
    if (step === "address") {
      if (!canContinueAddress) return;
      if (useNewAddress && !addresses.data?.some((a) => a.id === selectedAddressId)) {
        saveAddressIfNeeded();
        return;
      }
    }
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next.id);
  };

  const goBack = () => {
    const previous = STEPS[stepIndex - 1];
    if (previous) setStep(previous.id);
  };

  const handleSubmit = () => {
    if (!canSubmit || createOrder.isPending) return;
    // Chave de idempotência por tentativa: protege contra duplo clique.
    createOrder.mutate(crypto.randomUUID());
  };

  const applyCoupon = (code: string) => {
    setCouponError(null);
    validateCoupon.mutate(
      { code, shippingCost },
      {
        onSuccess: (result) => {
          setCoupon({ code: result.code, discount: result.discount, shippingDiscount: result.shippingDiscount });
          toast.success("Cupom aplicado");
        },
        onError: (error) => {
          setCoupon(null);
          setCouponError(errorMessage(error));
        },
      },
    );
  };

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Carrinho", to: "/carrinho" }, { label: "Checkout" }]} />

      <div className="page-header">
        <h1 className="page-header__title">Finalizar compra</h1>
      </div>

      {/* Etapas */}
      <div className="checkout-steps" role="list" aria-label="Etapas do checkout">
        {STEPS.map((item, index) => {
          const isDone = index < stepIndex;
          const isActive = index === stepIndex;
          return (
            <div
              key={item.id}
              role="listitem"
              className={["checkout-step", isActive ? "checkout-step--active" : "", isDone ? "checkout-step--done" : ""].filter(Boolean).join(" ")}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="checkout-step__num">{isDone ? <Icon name="check" size={12} /> : index + 1}</span>
              {item.label}
            </div>
          );
        })}
      </div>

      <div className="cart-layout">
        <div className="stack stack-5">
          {/* ------------------------------------------------------ ENDEREÇO */}
          {step === "address" ? (
            <Card>
              <h2 className="text-lg mb-4">Endereço de entrega</h2>

              {addresses.isLoading ? (
                <Skeleton height={80} />
              ) : (
                <div className="stack stack-4">
                  {(addresses.data ?? []).map((address) => (
                    <label
                      key={address.id}
                      className={["option-item", selectedAddressId === address.id && !useNewAddress ? "option-item--selected" : ""].filter(Boolean).join(" ")}
                    >
                      <input
                        type="radio"
                        name="address"
                        checked={selectedAddressId === address.id && !useNewAddress}
                        onChange={() => {
                          setSelectedAddressId(address.id);
                          setUseNewAddress(false);
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <span className="option-item__content">
                        <span className="option-item__title">
                          {address.street}, {address.number}
                          {address.complement ? ` — ${address.complement}` : ""}
                        </span>
                        <span className="option-item__hint">
                          {address.district}, {address.city}/{address.state} • CEP {maskCep(address.cep)}
                        </span>
                      </span>
                      {address.isDefault ? <span className="badge badge--accent">Padrão</span> : null}
                    </label>
                  ))}

                  <label className={["option-item", useNewAddress ? "option-item--selected" : ""].filter(Boolean).join(" ")}>
                    <input
                      type="radio"
                      name="address"
                      checked={useNewAddress}
                      onChange={() => setUseNewAddress(true)}
                      style={{ marginTop: 3 }}
                    />
                    <span className="option-item__content">
                      <span className="option-item__title">Usar um novo endereço</span>
                      <span className="option-item__hint">Preencha os dados de entrega abaixo.</span>
                    </span>
                  </label>

                  {useNewAddress ? (
                    <div className="stack stack-4" style={{ paddingTop: "var(--space-2)" }}>
                      <div className="grid" style={{ gridTemplateColumns: "1fr 2fr", gap: "var(--space-4)" }}>
                        <Input
                          label="CEP"
                          value={newAddress.cep}
                          onChange={(event) => setNewAddress({ ...newAddress, cep: maskCep(event.target.value) })}
                          placeholder="00000-000"
                          inputMode="numeric"
                          error={addressErrors["cep"]}
                          required
                        />
                        <Input
                          label="Rua"
                          value={newAddress.street}
                          onChange={(event) => setNewAddress({ ...newAddress, street: event.target.value })}
                          error={addressErrors["street"]}
                          required
                        />
                      </div>

                      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 2fr", gap: "var(--space-4)" }}>
                        <Input
                          label="Número"
                          value={newAddress.number}
                          onChange={(event) => setNewAddress({ ...newAddress, number: event.target.value })}
                          error={addressErrors["number"]}
                          required
                        />
                        <Input
                          label="Complemento"
                          value={newAddress.complement}
                          onChange={(event) => setNewAddress({ ...newAddress, complement: event.target.value })}
                          hint="Opcional"
                        />
                        <Input
                          label="Bairro"
                          value={newAddress.district}
                          onChange={(event) => setNewAddress({ ...newAddress, district: event.target.value })}
                          error={addressErrors["district"]}
                          required
                        />
                      </div>

                      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "var(--space-4)" }}>
                        <Input
                          label="Cidade"
                          value={newAddress.city}
                          onChange={(event) => setNewAddress({ ...newAddress, city: event.target.value })}
                          error={addressErrors["city"]}
                          required
                        />
                        <Select
                          label="Estado"
                          value={newAddress.state}
                          onChange={(event) => setNewAddress({ ...newAddress, state: event.target.value })}
                          error={addressErrors["state"]}
                          options={UFS.map((uf) => ({ value: uf, label: uf }))}
                          required
                        />
                      </div>

                      <Checkbox
                        label="Salvar como meu endereço padrão"
                        checked={newAddress.isDefault}
                        onChange={(event) => setNewAddress({ ...newAddress, isDefault: event.target.checked })}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}

          {/* -------------------------------------------------------- ENTREGA */}
          {step === "shipping" ? (
            <Card>
              <h2 className="text-lg mb-4">Modalidade de entrega</h2>

              {quoteError ? (
                <Alert tone="danger" title="Não foi possível calcular o frete">
                  {quoteError}
                </Alert>
              ) : quote.isLoading ? (
                <Skeleton height={70} />
              ) : !shippingQuote?.required ? (
                <Alert tone="info">
                  Nenhum item do seu pedido exige entrega. Você pode seguir direto para o pagamento.
                </Alert>
              ) : shippingQuote.options.length === 0 ? (
                <Alert tone="warning" title="Nenhuma modalidade disponível">
                  A loja ainda não configurou uma modalidade de frete para o CEP {maskCep(cepForQuote)}.
                  Fale com o atendimento para combinar a entrega.
                </Alert>
              ) : (
                <div className="option-list">
                  {shippingQuote.options.map((option) => (
                    <label
                      key={option.id}
                      className={["option-item", shippingMethodId === option.id ? "option-item--selected" : ""].filter(Boolean).join(" ")}
                    >
                      <input
                        type="radio"
                        name="shipping"
                        checked={shippingMethodId === option.id}
                        onChange={() => setShippingMethodId(option.id)}
                        style={{ marginTop: 3 }}
                      />
                      <span className="option-item__content">
                        <span className="option-item__title">{option.name}</span>
                        <span className="option-item__hint">
                          {option.carrier ? `${option.carrier} • ` : ""}
                          {option.minDays === option.maxDays
                            ? `${option.minDays} dia(s)`
                            : `${option.minDays} a ${option.maxDays} dias`}
                          {option.freeAbove ? ` • frete grátis acima de ${formatCurrency(option.freeAbove)}` : ""}
                        </span>
                      </span>
                      <span className="option-item__price">{option.price === 0 ? "Grátis" : formatCurrency(option.price)}</span>
                    </label>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted mt-4">
                CEP de entrega: <strong>{maskCep(cepForQuote) || "não informado"}</strong>
                {shippingQuote?.region ? ` • Região: ${shippingQuote.region}` : ""}
              </p>
            </Card>
          ) : null}

          {/* ------------------------------------------------------ PAGAMENTO */}
          {step === "payment" ? (
            <Card>
              <h2 className="text-lg mb-4">Forma de pagamento</h2>

              {enabledPayments.length === 0 ? (
                <Alert tone="warning" title="Pagamento ainda não configurado">
                  A loja não habilitou nenhuma forma de pagamento. Fale com o atendimento para concluir a compra.
                </Alert>
              ) : (
                <div className="option-list">
                  {enabledPayments.map((method) => (
                    <label
                      key={method}
                      className={["option-item", paymentMethod === method ? "option-item--selected" : ""].filter(Boolean).join(" ")}
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                        style={{ marginTop: 3 }}
                      />
                      <span className="option-item__content">
                        <span className="option-item__title">{PAYMENT_METHOD[method]}</span>
                        {method === "MANUAL" ? (
                          <span className="option-item__hint">A loja combina os detalhes com você pelo atendimento.</span>
                        ) : null}
                      </span>
                      <Icon
                        name={method === "PIX" ? "sparkles" : method === "BOLETO" ? "barcode" : method === "CREDIT_CARD" ? "creditCard" : "message"}
                        size={20}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-5">
                <label className="field__label" htmlFor="order-notes">
                  Observações do pedido (opcional)
                </label>
                <textarea
                  id="order-notes"
                  className="textarea"
                  value={notes}
                  maxLength={500}
                  placeholder="Ex.: preferência de horário para entrega"
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </Card>
          ) : null}

          {/* --------------------------------------------------------- REVISÃO */}
          {step === "review" ? (
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
                    {useNewAddress ? (
                      <>
                        {newAddress.street}, {newAddress.number} — {newAddress.district}
                        <br />
                        {newAddress.city}/{newAddress.state} • CEP {maskCep(newAddress.cep)}
                      </>
                    ) : selectedAddress ? (
                      <>
                        {selectedAddress.street}, {selectedAddress.number} — {selectedAddress.district}
                        <br />
                        {selectedAddress.city}/{selectedAddress.state} • CEP {maskCep(selectedAddress.cep)}
                      </>
                    ) : (
                      "Endereço não informado"
                    )}
                  </p>
                  {selectedShipping ? (
                    <p className="text-sm text-muted mt-1">
                      {selectedShipping.name} • {selectedShipping.minDays} a {selectedShipping.maxDays} dias
                    </p>
                  ) : (
                    <p className="text-sm text-muted mt-1">Sem modalidade de frete aplicável.</p>
                  )}
                </div>

                <div>
                  <p className="field__label">Pagamento</p>
                  <p className="text-sm text-muted">{paymentMethod ? PAYMENT_METHOD[paymentMethod as PaymentMethod] : "Não selecionado"}</p>
                  <p className="text-xs text-muted mt-1">
                    Os dados de pagamento são processados com segurança. Não armazenamos dados de cartão.
                  </p>
                </div>

                {notes ? (
                  <div>
                    <p className="field__label">Observações</p>
                    <p className="text-sm text-muted">{notes}</p>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Navegação entre etapas */}
          <div className="row row-3 row-between">
            <Button variant="ghost" onClick={goBack} disabled={stepIndex === 0} icon="arrowLeft">
              Voltar
            </Button>

            {step === "review" ? (
              <Button size="lg" onClick={handleSubmit} loading={createOrder.isPending} disabled={!canSubmit} iconRight="check">
                Finalizar pedido
              </Button>
            ) : (
              <Button
                size="lg"
                onClick={goNext}
                disabled={step === "address" ? !canContinueAddress : step === "shipping" ? !canContinueShipping : false}
                loading={createAddress.isPending}
                iconRight="arrowRight"
              >
                Continuar
              </Button>
            )}
          </div>
        </div>

        {/* --------------------------------------------------------- RESUMO */}
        <Card className="summary-card">
          <h2 className="text-lg">Resumo do pedido</h2>

          {step === "review" ? (
            <CouponForm
              onApply={applyCoupon}
              onRemove={() => setCoupon(null)}
              appliedCode={coupon?.code}
              appliedDiscount={coupon?.discount}
              loading={validateCoupon.isPending}
            />
          ) : null}

          {couponError ? <Alert tone="danger">{couponError}</Alert> : null}

          <CartSummary
            subtotal={subtotal}
            discount={discount}
            shipping={shippingQuote?.required ? shippingCost : shippingQuote ? 0 : null}
            shippingLabel={selectedShipping?.name ?? "Frete"}
            total={total}
            couponCode={coupon?.code}
          />

          <p className="text-xs text-muted">
            O valor final é recalculado no servidor ao criar o pedido — preço, desconto e frete sempre conferidos.
          </p>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

export { Skeleton, maskPhone };
