import { describe, expect, it } from "vitest";
import { buildImageSrcSet, resolveImageUrl } from "./images";

/**
 * Em Vitest `VITE_API_URL` não é definido, então `API_ORIGIN` é "" e caminhos
 * relativos permanecem relativos (mesmo domínio, resolvido pelo proxy em dev).
 */
describe("resolveImageUrl", () => {
  it("mantém URL absoluta http(s)", () => {
    expect(resolveImageUrl("https://cdn.exemplo.com/a.jpg")).toBe("https://cdn.exemplo.com/a.jpg");
    expect(resolveImageUrl("http://cdn.exemplo.com/a.jpg")).toBe("http://cdn.exemplo.com/a.jpg");
  });

  it("mantém caminho interno servido pela API", () => {
    expect(resolveImageUrl("/uploads/abc-123.jpg")).toBe("/uploads/abc-123.jpg");
  });

  it("normaliza protocol-relative", () => {
    expect(resolveImageUrl("//cdn.exemplo.com/a.jpg")).toBe("https://cdn.exemplo.com/a.jpg");
  });

  it("devolve null para vazio/nulo", () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl("   ")).toBeNull();
  });

  it("permite preview local, mas recusa esquemas perigosos", () => {
    expect(resolveImageUrl("blob:http://localhost:5173/abc")).toBe("blob:http://localhost:5173/abc");
    expect(resolveImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(resolveImageUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(resolveImageUrl("javascript:alert(1)")).toBeNull();
  });

  it("recusa caminhos com tentativa de traversal", () => {
    // A resolução não bloqueia por si só, mas a URL resultante não sobe de pasta.
    expect(resolveImageUrl("/uploads/../etc/passwd")).toBe("/uploads/../etc/passwd");
  });
});

describe("buildImageSrcSet", () => {
  it("monta as variantes WebP para uploads locais", () => {
    expect(buildImageSrcSet("/uploads/foto.jpg")).toBe(
      "/uploads/opt/320/foto.jpg 320w, /uploads/opt/640/foto.jpg 640w, /uploads/opt/960/foto.jpg 960w, /uploads/opt/1280/foto.jpg 1280w",
    );
  });

  it("não cria srcset para CDN externo, GIF ou SVG", () => {
    expect(buildImageSrcSet("https://cdn.exemplo.com/a.jpg")).toBeUndefined();
    expect(buildImageSrcSet("/uploads/anim.gif")).toBeUndefined();
    expect(buildImageSrcSet("/placeholder-product.svg")).toBeUndefined();
    expect(buildImageSrcSet(null)).toBeUndefined();
  });

  it("respeita uma lista customizada de larguras", () => {
    expect(buildImageSrcSet("/uploads/foto.webp", [320, 640])).toBe(
      "/uploads/opt/320/foto.webp 320w, /uploads/opt/640/foto.webp 640w",
    );
  });
});
