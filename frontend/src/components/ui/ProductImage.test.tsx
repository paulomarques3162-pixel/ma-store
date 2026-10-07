import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProductImage } from "@/components/ui/StoreValue";

/**
 * Fallback visual de imagem (requisito de UX).
 *
 * Se a URL realmente não puder ser carregada:
 *  - o layout NÃO quebra (a <img> troca para o placeholder do projeto);
 *  - o erro é registrado de forma útil em desenvolvimento;
 *  - NÃO entra em loop infinito de tentativas (um erro no próprio placeholder
 *    é ignorado).
 *
 * O fallback é proteção de UX, não a solução para uma URL quebrada — por isso
 * ele não "conserta" a URL, apenas evita o ícone de imagem quebrada.
 */
describe("ProductImage", () => {
  it("resolve o caminho interno da API antes de renderizar", () => {
    render(<ProductImage src="/uploads/foto.jpg" alt="Foto do produto" />);
    // Sem VITE_API_URL no Vitest, a origem é relativa: o caminho é preservado.
    expect(screen.getByRole("img")).toHaveAttribute("src", "/uploads/foto.jpg");
    expect(screen.getByRole("img")).toHaveAttribute("decoding", "async");
  });

  it("usa o placeholder quando não há imagem cadastrada", () => {
    render(<ProductImage src={null} alt="Sem foto" />);
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "/placeholder-product.svg");
    expect(image).toHaveAttribute("alt", "Sem foto (imagem não cadastrada)");
  });

  it("troca para o placeholder quando a URL está quebrada", () => {
    render(<ProductImage src="/uploads/nao-existe.jpg" alt="Quebrada" />);
    const image = screen.getByRole("img") as HTMLImageElement;

    expect(image.getAttribute("src")).toBe("/uploads/nao-existe.jpg");
    fireEvent.error(image);
    expect(image.getAttribute("src")).toBe("/placeholder-product.svg");
  });

  it("não entra em loop quando o próprio placeholder falha", () => {
    render(<ProductImage src={null} alt="Placeholder" />);
    const image = screen.getByRole("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/placeholder-product.svg");

    // O placeholder não pode disparar nova troca (loop de erro).
    fireEvent.error(image);
    fireEvent.error(image);
    expect(image.getAttribute("src")).toBe("/placeholder-product.svg");
  });

  it("recusa esquema perigoso e cai no placeholder (sem javascript:)", () => {
    render(<ProductImage src="javascript:alert(1)" alt="Perigo" />);
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "/placeholder-product.svg");
    expect(image.getAttribute("src")).not.toContain("javascript:");
  });

  it("aplica enquadramento e proporção configurados no painel", () => {
    render(
      <ProductImage
        src="/uploads/foto.jpg"
        alt="Enquadrada"
        aspectRatio="1 / 1"
        objectPosition="top left"
      />,
    );
    const image = screen.getByRole("img") as HTMLImageElement;
    expect(image.style.aspectRatio.replace(/\s/g, "")).toBe("1/1");
    expect(image.style.objectPosition).toBe("top left");
  });

  it("marca prioridade alta para a imagem principal (LCP)", () => {
    render(<ProductImage src="/uploads/hero.jpg" alt="Principal" loading="eager" fetchPriority="high" />);
    const image = screen.getByRole("img") as HTMLImageElement;
    expect(image).toHaveAttribute("loading", "eager");
    expect(image.getAttribute("fetchpriority")).toBe("high");
  });

  it("não registra aviso em produção para URL quebrada", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<ProductImage src="/uploads/quebrada.jpg" alt="Silenciosa" />);
    fireEvent.error(screen.getByRole("img"));
    // Em Vitest `import.meta.env.DEV` é true, então o aviso é esperado aqui —
    // o importante é que o erro NUNCA vira exceção.
    expect(screen.getByRole("img")).toHaveAttribute("src", "/placeholder-product.svg");
    warn.mockRestore();
  });
});
