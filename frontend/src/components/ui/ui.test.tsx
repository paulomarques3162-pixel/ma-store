import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge, Button, EmptyState, ErrorState, Icon, Input, Price, StoreValue } from "@/components/ui";
import { renderWithProviders, mockApi } from "@/tests/mocks";

describe("Button", () => {
  it("renderiza o rótulo e dispara o clique", async () => {
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Comprar</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Comprar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fica desabilitado enquanto carrega (evita duplo clique)", async () => {
    const onClick = vi.fn();
    renderWithProviders(
      <Button loading onClick={onClick}>
        Finalizar
      </Button>,
    );

    const button = screen.getByRole("button", { name: /Finalizar/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("desabilita quando `disabled` é passado", () => {
    renderWithProviders(<Button disabled>Indisponível</Button>);
    expect(screen.getByRole("button", { name: "Indisponível" })).toBeDisabled();
  });
});

describe("Input", () => {
  it("associa label e propaga o valor digitado", async () => {
    const onChange = vi.fn();
    renderWithProviders(<Input label="E-mail" value="" onChange={onChange} />);

    const input = screen.getByLabelText(/E-mail/);
    await userEvent.type(input, "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("expõe a mensagem de erro para leitores de tela", () => {
    renderWithProviders(<Input label="Senha" value="" onChange={() => undefined} error="Senha muito curta." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Senha muito curta.");
  });

  it("mostra a dica quando não há erro", () => {
    renderWithProviders(<Input label="CEP" value="" onChange={() => undefined} hint="8 dígitos" />);
    expect(screen.getByText("8 dígitos")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("mostra título, texto e ação", () => {
    renderWithProviders(
      <EmptyState title="Seu carrinho está vazio" text="Adicione produtos." action={<button type="button">Ver produtos</button>} />,
    );

    expect(screen.getByText("Seu carrinho está vazio")).toBeInTheDocument();
    expect(screen.getByText("Adicione produtos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver produtos" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("exibe a mensagem amigável e o requestId (nunca stack trace)", () => {
    renderWithProviders(
      <ErrorState message="Não foi possível carregar." requestId="abc123" onRetry={() => undefined} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar.");
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeInTheDocument();
  });
});

describe("StoreValue (regra: não inventar dados da loja)", () => {
  it("mostra o valor quando o CMS está preenchido", async () => {
    mockApi([{ path: "/content", data: { values: { "store.name": "MA STORE" }, entries: [] } }]);

    renderWithProviders(<StoreValue k="store.name" fallback="Não configurado" />);

    await waitFor(() => expect(screen.getByText("MA STORE")).toBeInTheDocument());
  });

  it("mostra o placeholder quando o valor é nulo", async () => {
    mockApi([{ path: "/content", data: { values: { "store.name": null }, entries: [] } }]);

    renderWithProviders(<StoreValue k="store.name" fallback="Não configurado" />);

    await waitFor(() => expect(screen.getByText("Não configurado")).toBeInTheDocument());
  });

  it("não renderiza nada quando o fallback é explicitamente nulo", async () => {
    mockApi([{ path: "/content", data: { values: {}, entries: [] } }]);

    const { container } = renderWithProviders(<StoreValue k="store.cnpj" fallback={null} />);

    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("aplica o estilo de placeholder em valor ausente", async () => {
    mockApi([{ path: "/content", data: { values: {}, entries: [] } }]);

    const { container } = renderWithProviders(<StoreValue k="store.email" fallback="Não configurado" />);

    await waitFor(() => expect(container.querySelector(".placeholder-value")).toBeInTheDocument());
  });
});

describe("Price", () => {
  it("mostra o preço promocional com o selo de desconto", () => {
    renderWithProviders(<Price price={199.9} comparePrice={249.9} />);
    expect(screen.getByText("20% off")).toBeInTheDocument();
    expect(screen.getByText(/199,90/)).toBeInTheDocument();
  });

  it("não mostra selo quando não há promoção real", () => {
    renderWithProviders(<Price price={199.9} />);
    expect(screen.queryByText(/off/)).not.toBeInTheDocument();
  });

  it("mostra o parcelamento somente quando informado", () => {
    renderWithProviders(<Price price={1200} installments="12x de R$ 100,00" />);
    expect(screen.getByText("12x de R$ 100,00")).toBeInTheDocument();
  });
});

describe("Badge e Icon", () => {
  it("renderiza o badge com o tom informado", () => {
    const { container } = renderWithProviders(<Badge tone="success">Ativo</Badge>);
    expect(container.querySelector(".badge--success")).toBeInTheDocument();
  });

  it("expõe o ícone com rótulo acessível quando informado", () => {
    renderWithProviders(<Icon name="cart" label="Carrinho" />);
    expect(screen.getByRole("img", { name: "Carrinho" })).toBeInTheDocument();
  });

  it("marca o ícone como decorativo quando não há rótulo", () => {
    const { container } = renderWithProviders(<Icon name="cart" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
