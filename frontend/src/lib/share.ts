/**
 * Compartilhamento (Web Share API + fallback de copiar link).
 *
 * Regra: nunca exigir login. Se a Web Share API não existir (desktop, alguns
 * navegadores), copiamos o link para a área de transferência.
 */

export type SharePayload = {
  title: string;
  text?: string;
  url: string;
};

export type ShareResult = "shared" | "copied" | "failed";

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* segue para o fallback */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Tenta compartilhar nativamente; cai para "copiar link" quando não houver suporte. */
export async function shareOrCopy(payload: SharePayload): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (error) {
      // Usuário cancelou: não tratamos como erro.
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
      // Qualquer outra falha cai para o fallback.
    }
  }

  return (await copyToClipboard(payload.url)) ? "copied" : "failed";
}

/** Monta a mensagem padrão de compartilhamento de produto. */
export function buildProductShare(product: { name: string; price: number; slug: string }): SharePayload {
  return {
    title: product.name,
    text: `Olha esse produto na MA STORE! ${product.name}`,
    url: `${window.location.origin}/produto/${product.slug}`,
  };
}

/** Compartilhamento da própria loja. */
export function buildStoreShare(): SharePayload {
  return {
    title: "MA STORE",
    text: "Conheça a MA STORE — perfumes árabes e importados selecionados.",
    url: `${window.location.origin}/`,
  };
}
