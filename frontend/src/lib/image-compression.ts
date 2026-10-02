/**
 * Compressão de imagem no cliente, antes do upload.
 *
 * - Redimensiona para no máximo `maxDimension` (mantém proporção).
 * - Converte para WebP quando o navegador suporta (fallback para JPEG).
 * - Preserva GIF/AVIF (animação/formatos que não devem ser reencodados).
 * - Se a compressão não reduzir o tamanho, devolve o arquivo original.
 *
 * O backend continua validando magic bytes/tamanho/dimensões — isto é só
 * otimização, nunca substitui a validação do servidor.
 */
export type CompressImageOptions = {
  maxDimension?: number;
  quality?: number;
  preferWebp?: boolean;
};

type LoadedImage = {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    }));
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () =>
      resolve({
        image: element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        dispose: () => URL.revokeObjectURL(url),
      });
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Falha ao ler a imagem."));
    };
    element.src = url;
  });
}

let webpSupport: boolean | null = null;

function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { maxDimension = 1600, quality = 0.82, preferWebp = true } = options;

  if (typeof document === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/avif") return file;

  try {
    const loaded = await loadImage(file);
    try {
      const scale = Math.min(1, maxDimension / Math.max(loaded.width, loaded.height));
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;

      context.drawImage(loaded.image, 0, 0, width, height);

      const type = preferWebp && supportsWebp() ? "image/webp" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      if (!blob || blob.size >= file.size) return file;

      const extension = type === "image/webp" ? "webp" : "jpg";
      const name = `${file.name.replace(/\.[^.]+$/, "")}.${extension}`;
      return new File([blob], name, { type });
    } finally {
      loaded.dispose();
    }
  } catch {
    return file;
  }
}
