import { prisma } from "../db.js";
import { deleteUpload } from "./storage.js";

/**
 * Limpeza segura de arquivos de upload.
 *
 * PROBLEMA QUE ISTO RESOLVE (causa raiz das imagens que "somem"):
 * o formulário de produto e a biblioteca permitem REAPROVEITAR a mesma URL em
 * vários lugares — produtos duplicados compartilham as mesmas URLs, a biblioteca
 * reusa o arquivo e imagens também podem estar em banners, categorias, marcas e
 * snapshots de pedidos. Ao remover a foto de UM produto, a versão anterior
 * apagava o arquivo físico direto, quebrando todos os demais registros que
 * apontavam para ele.
 *
 * A regra agora é: só apagar o arquivo quando NENHUMA referência (em nenhuma
 * tabela) ainda apontar para a URL. Se ainda houver referência, o arquivo
 * permanece no disco e continua válido para os outros produtos/páginas.
 */

/** Conta quantos registros (em qualquer tabela) ainda referenciam a URL. */
export async function countUploadReferences(url: string): Promise<number> {
  const [images, orderSnapshots, categories, brands, banners] = await Promise.all([
    prisma.productImage.count({ where: { url } }),
    prisma.orderItem.count({ where: { imageSnapshot: url } }),
    prisma.category.count({ where: { imageUrl: url } }),
    prisma.brand.count({ where: { logoUrl: url } }),
    prisma.banner.count({ where: { imageUrl: url } }),
  ]);
  return images + orderSnapshots + categories + brands + banners;
}

/**
 * Remove o arquivo físico SOMENTE quando não existe mais nenhuma referência.
 * Devolve `true` quando o arquivo foi removido, `false` quando foi preservado
 * (ainda referenciado) ou quando a remoção física falhou.
 *
 * Nunca lança: a consistência do banco é prioridade e um arquivo órfão é apenas
 * lixo de disco, nunca um dado quebrado.
 */
export async function deleteUploadIfUnreferenced(url: string): Promise<boolean> {
  const references = await countUploadReferences(url);
  if (references > 0) return false;
  return deleteUpload(url);
}
