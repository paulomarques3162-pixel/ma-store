# Sistema de imagens dos produtos — MA STORE

Documento de referência do fluxo `ADMIN → API → BANCO → LOJA`.

## Modelo de dados

- **Tabela:** `product_images` (model `ProductImage`).
- **Campos:** `id`, `productId`, `url`, `alt`, `position`, `focalPoint`.
- **Imagem principal:** a de **menor `position`** (índice 0). A loja usa `product.images[0]`.
- **Múltiplas imagens:** até 12 por produto (validado no Zod). Ordem controlada por `position`.
- Não existe campo `Product.image`; a fonte de verdade é a lista `product_images`.

## Fluxo de upload

1. Admin (`ProductFormPage`) escolhe arquivo e chama `uploadImage()` → `POST /api/admin/uploads` (multipart, ADMIN).
2. `saveUpload()` valida por **magic bytes** (JPEG/PNG/WEBP/GIF/AVIF), tamanho (`UPLOAD_MAX_MB`, padrão 5 MB) e dimensões (100–6000 px).
3. O arquivo é gravado no driver `local` e a API devolve `{ url, filename, mime, width, height, size }`.
4. A URL entra em `form.images` e é salva no produto via `POST/PATCH /api/admin/products`.
5. A loja lê `GET /api/products` / `GET /api/products/:slug` e renderiza `product.images[0].url`.

## URL da imagem (regra crítica)

- **O banco guarda um caminho RELATIVO** (`/uploads/<arquivo>`) por padrão. Isso evita gravar o host do backend (a causa clássica de imagem quebrada era `http://localhost:3333/...` salvo em produção).
- `STORAGE_PUBLIC_URL` é **opcional**. Se (e somente se) for um host absoluto real de CDN/S3, a URL absoluta é usada. Host de loopback é ignorado.
- O frontend resolve a origem em **`src/lib/images.ts` → `resolveImageUrl()`**, usado por `ProductImage`, banner do Home, chips de categoria, busca do header e preview do admin. Não espalhe `${API_URL}${image}` pelo código.
- Com `VITE_API_URL` absoluto (`https://api.exemplo.com/api`), `/uploads/x.jpg` vira `https://api.exemplo.com/uploads/x.jpg`.
- Em desenvolvimento, `/uploads` é encaminhado ao backend pelo proxy do Vite.

## Substituir / remover

- **Substituir:** novo upload gera um nome único (timestamp + hash); o PATCH troca as linhas de `product_images`.
- **Remover/substituir:** após o commit do banco, os arquivos locais que deixaram de ser referenciados são apagados (best-effort). A ordem garante que o banco nunca fique sem a imagem por falha de disco.
- Falhas de remoção física não quebram a operação — viram arquivo órfão, nunca inconsistência de dados.

## Biblioteca de imagens (reaproveitamento)

- `GET /api/admin/uploads?search=&page=&perPage=` (ADMIN) lista as imagens já salvas
  (arquivos do diretório de uploads, com busca e paginação). Não é preciso colar URL.
- No formulário de produto o admin tem **duas ações**: **Enviar foto** (upload do
  computador) e **Escolher imagem salva** (biblioteca visual). Adicionar por URL ficou
  em “Avançado”.
- A **primeira imagem é a capa**; cada item permite “Tornar capa”, remover (com
  confirmação) e ajustar o enquadramento.
- Remover do produto **não apaga o arquivo** da biblioteca (evita quebrar outros produtos).

## Criação de produto

- O botão de salvar é `type="submit"` de um `<form>` real; durante o envio fica
  “Criando…/Salvando…” e bloqueado (impede duplo clique).
- Validação mostra resumo no topo + erros por campo + toast.
- **SKU é opcional**: em branco, o backend gera um código único
  (`generateSku`, ex.: `PERFUME-ASAD-100ML-A1B2C`).

## Segurança

- Upload e alteração de imagem exigem **ADMIN** (`requireAdmin` no backend).
- `productImageSchema` aceita apenas `http(s)://…` ou caminho interno `/…` (sem `..`); recusa `javascript:`, `data:`, `blob:` e `//host`.
- Preview local (`blob:`) **nunca** é persistido no banco.

## Armazenamento em produção (atenção)

O driver `local` grava em disco do processo. Em containers/serverless (ex.: Render sem disco persistente), **arquivos podem desaparecer em restart/deploy**. A API emite um `warn` no boot quando `APP_ENV=production` e `STORAGE_DRIVER=local`. Para persistência real, use storage de objetos (S3/Cloudinary) implementando a mesma interface `saveUpload`.
