import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16 } from "../../src/services/pix";

describe("PIX BR Code", () => {
  it("calcula o CRC16/CCITT-FALSE corretamente", () => {
    // Vetor de teste clássico: "123456789" -> 0x29B1
    expect(crc16("123456789")).toBe("29B1");
  });

  it("gera um payload EMV válido com chave, recebedor e valor", () => {
    const payload = buildPixPayload({
      key: "teste@exemplo.com",
      merchantName: "MA STORE",
      merchantCity: "PIRASSUNUNGA",
      amount: 225.9,
      txid: "ABC123",
    });

    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain("teste@exemplo.com");
    expect(payload).toContain("MA STORE");
    expect(payload).toContain("PIRASSUNUNGA");
    expect(payload).toContain("5406225.90"); // campo 54 (valor) com tamanho
    // Os 4 últimos dígitos são o CRC do restante.
    const body = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it("recusa chave vazia e cidade ausente (não inventa dados)", () => {
    expect(() => buildPixPayload({ key: "", merchantName: "X", merchantCity: "Y" })).toThrow();
    expect(() => buildPixPayload({ key: "k", merchantName: "X", merchantCity: "" })).toThrow();
  });
});
