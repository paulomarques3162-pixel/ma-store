import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGuestOrders,
  forgetGuestOrder,
  listGuestOrderTokens,
  rememberGuestOrder,
} from "./guestOrders";

const TOKEN_A = "tok-aaaaaaaaaaaaaaaa";
const TOKEN_B = "tok-bbbbbbbbbbbbbbbb";

describe("guestOrders — histórico local de pedidos", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("começa vazio", () => {
    expect(listGuestOrderTokens()).toEqual([]);
  });

  it("guarda e lê tokens", () => {
    rememberGuestOrder(TOKEN_A);
    rememberGuestOrder(TOKEN_B);
    expect(listGuestOrderTokens()).toEqual([TOKEN_B, TOKEN_A]);
  });

  it("não duplica e mantém o mais recente no topo", () => {
    rememberGuestOrder(TOKEN_A);
    rememberGuestOrder(TOKEN_B);
    rememberGuestOrder(TOKEN_A);
    expect(listGuestOrderTokens()).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("ignora tokens curtos/inválidos", () => {
    rememberGuestOrder("curto");
    rememberGuestOrder(null);
    rememberGuestOrder("");
    expect(listGuestOrderTokens()).toEqual([]);
  });

  it("remove um token", () => {
    rememberGuestOrder(TOKEN_A);
    rememberGuestOrder(TOKEN_B);
    forgetGuestOrder(TOKEN_A);
    expect(listGuestOrderTokens()).toEqual([TOKEN_B]);
  });

  it("esvazia o histórico", () => {
    rememberGuestOrder(TOKEN_A);
    clearGuestOrders();
    expect(listGuestOrderTokens()).toEqual([]);
  });

  it("tolera conteúdo corrompido no storage", () => {
    localStorage.setItem("mastore.guestOrders.v1", "{nao-e-json");
    expect(listGuestOrderTokens()).toEqual([]);
    localStorage.setItem("mastore.guestOrders.v1", JSON.stringify({ foo: "bar" }));
    expect(listGuestOrderTokens()).toEqual([]);
  });

  it("limita o histórico a 50 pedidos", () => {
    for (let index = 0; index < 60; index += 1) {
      rememberGuestOrder(`tok-${String(index).padStart(16, "0")}`);
    }
    expect(listGuestOrderTokens()).toHaveLength(50);
    // O último inserido está no topo.
    expect(listGuestOrderTokens()[0]).toBe("tok-0000000000000059");
  });
});
