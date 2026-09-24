import { useState, type FormEvent } from "react";
import { formatCurrency } from "@/lib/format";

export type ShippingCalculatorQuote = {
  carrier: string;
  serviceCode: string;
  serviceName: string;
  type: string;
  price: number;
  currency: string;
  deliveryDays: number;
  estimatedDeliveryDate?: string | null;
};

export type ShippingCalculatorProps = {
  /** Base da API universal, ex.: "https://api.minhaloja.com/api/v1/shipping". */
  baseUrl: string;
  storeId: string;
  originPostalCode: string;
  packages: Array<{ weightGrams: number; heightCm: number; widthCm: number; lengthCm: number; quantity?: number }>;
  destinationPostalCode?: string;
  orderValue?: number;
  declaredValue?: number;
  headers?: Record<string, string>;
  onQuotes?: (quotes: ShippingCalculatorQuote[]) => void;
};

/**
 * Widget OPCIONAL de cálculo de frete.
 *
 * Não conhece nenhum provedor: apenas consome a API universal e renderiza a
 * resposta normalizada. Pode ser usado em React, Next.js, Vite, etc.
 */
export function ShippingCalculator(props: ShippingCalculatorProps) {
  const [postalCode, setPostalCode] = useState(props.destinationPostalCode ?? "");
  const [quotes, setQuotes] = useState<ShippingCalculatorQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${props.baseUrl.replace(/\/+$/, "")}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(props.headers ?? {}) },
        body: JSON.stringify({
          storeId: props.storeId,
          origin: { postalCode: props.originPostalCode },
          destination: { postalCode },
          packages: props.packages,
          ...(props.orderValue !== undefined ? { orderValue: props.orderValue } : {}),
          ...(props.declaredValue !== undefined ? { declaredValue: props.declaredValue } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { success: boolean; data?: { quotes: ShippingCalculatorQuote[] }; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message ?? "Não foi possível calcular o frete.");
      }

      const list = payload.data?.quotes ?? [];
      setQuotes(list);
      props.onQuotes?.(list);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível calcular o frete.");
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="shipping-calculator" onSubmit={submit} aria-label="Calcular frete">
      <label className="field__label" htmlFor="shipping-calculator-cep">
        Calcular frete
      </label>
      <div className="row row-2">
        <input
          id="shipping-calculator-cep"
          className="input"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="CEP de entrega"
          value={postalCode}
          onChange={(event) => setPostalCode(event.target.value)}
        />
        <button className="btn btn--primary" type="submit" disabled={loading || postalCode.trim().length < 8}>
          {loading ? "Calculando…" : "Calcular"}
        </button>
      </div>

      {error ? (
        <p className="text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {quotes.length > 0 ? (
        <ul className="shipping-calculator__options">
          {quotes.map((quote) => (
            <li key={`${quote.carrier}-${quote.serviceCode}`} className="shipping-calculator__option">
              <span>
                <strong>{quote.serviceName}</strong>
                <span className="text-xs text-muted">
                  {" "}
                  · {quote.deliveryDays === 0 ? "hoje" : `${quote.deliveryDays} dia(s) útil(eis)`}
                </span>
              </span>
              <span>{quote.price === 0 ? "Grátis" : formatCurrency(quote.price)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
