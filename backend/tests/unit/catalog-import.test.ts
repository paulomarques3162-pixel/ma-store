import { describe, expect, it } from "vitest";
import { normalizeCatalogSource, planCatalogImport } from "../../src/services/catalog-import";

const source = [
  { nome: "Perfume Asad Bourbon Árabe Original – 100ml", preco: 380 },
  { nome: "Kit Asad Duo – Bourbon + Elixir", preco: 680, preco_antigo: 760 },
  { nome: "Perfume sem preço" },
  { nome: "Preço negativo", preco: -10 },
];

describe("normalizeCatalogSource", () => {
  it("valida os itens e descarta os inválidos", () => {
    const { valid, invalid } = normalizeCatalogSource(source);
    expect(valid).toHaveLength(2);
    expect(invalid).toHaveLength(2);
    expect(valid[0]?.price).toBe(380);
    expect(valid[1]?.comparePrice).toBe(760);
  });

  it("ignora preço promocional menor que o preço", () => {
    const { valid } = normalizeCatalogSource([{ nome: "Promo errada", preco: 100, preco_antigo: 80 }]);
    expect(valid[0]?.comparePrice).toBeNull();
  });

  it("rejeita fonte que não é lista", () => {
    expect(normalizeCatalogSource({}).invalid).toHaveLength(1);
  });
});

describe("planCatalogImport", () => {
  it("separa novos, atualizações e duplicados sem apagar nada", () => {
    const { valid } = normalizeCatalogSource(source);
    const existing = [
      { id: "p1", name: "Perfume Asad Bourbon Árabe Original – 100ml", sku: "MA-EXISTENTE", slug: "perfume-asad-bourbon-arabe-original-100ml", price: 350 },
    ];

    const plan = planCatalogImport(valid, existing);
    expect(plan.toCreate).toHaveLength(1); // kit (novo)
    expect(plan.toUpdate).toHaveLength(1); // asad (preço divergente 350 -> 380)
    expect(plan.summary.priceDivergent).toBe(1);
    expect(plan.toUpdate[0]?.changes.join()).toContain("preco");
  });

  it("detecta duplicidade dentro da própria fonte", () => {
    const { valid } = normalizeCatalogSource([{ nome: "Produto Duplicado", preco: 10 }, { nome: "Produto Duplicado", preco: 10 }]);
    const plan = planCatalogImport(valid, []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });
});
