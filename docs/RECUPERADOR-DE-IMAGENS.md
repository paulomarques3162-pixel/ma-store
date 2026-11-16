# Recuperador de Imagens — MA STORE

Ferramenta administrativa que localiza as URLs antigas das imagens no PostgreSQL,
verifica se ainda estão acessíveis, copia o arquivo **original** para o Cloudinary
e só substitui a referência do produto **depois da confirmação do administrador**.

## Como acessar

Painel administrativo → **Mídia → Recuperador de imagens**

Rota do SPA: `/admin/midia/recuperador`
API: `/api/admin/image-recovery/*` (todas as rotas exigem `role=ADMIN`).

## O que a ferramenta faz

1. **Auditoria** — varre `product_images.url`, `banners.imageUrl`,
   `categories.imageUrl` e `brands.logoUrl`. A auditoria **não altera** nenhuma
   tabela original: apenas cria/atualiza registros em `image_recovery_assets`.
2. **Verificação** — GET com leitura parcial (streaming), timeout, retry para
   erros temporários, validação de `Content-Type` **e** magic bytes, dimensões e
   tamanho. HEAD não é usado como método único.
3. **Recuperação individual** — baixa o arquivo com limite de bytes, valida a
   assinatura real, envia ao Cloudinary **sem redimensionar** e verifica a nova
   URL. O produto continua com a URL antiga até a confirmação.
4. **Pré-visualização** — mostra imagem antiga, imagem recuperada, URL antiga,
   URL nova, formato, dimensões, tamanho, `public_id` e provedor.
5. **Confirmação** — `replace` troca somente a referência de imagem;
   `keep`/`cancel` descartam a cópia pendente e preservam a URL antiga.
6. **Recuperação em massa** — fila persistida no PostgreSQL, concorrência
   limitada (1–8), pausar/continuar/cancelar, retomada automática após restart
   do Render e confirmação por lote (ou automática, se marcada explicitamente).
7. **Relatório** — contadores em tempo real + exportação CSV com data, produto,
   URL original, URL nova, resultado e motivo.

## Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/summary` | contadores, driver de storage, limites |
| POST | `/scan` | auditoria de todas as referências |
| GET | `/assets` | listagem com filtro de status/tipo e busca |
| GET | `/assets/:id` | detalhe/pré-visualização |
| POST | `/assets/:id/check` | verificar URL |
| POST | `/assets/:id/recover` | baixar + enviar ao Cloudinary |
| POST | `/assets/:id/confirm` | `replace` \| `keep` \| `cancel` |
| POST | `/assets/:id/manual-url` | informar outra URL (substituta) |
| POST | `/assets/:id/manual-upload` | enviar imagem manualmente (multipart) |
| GET | `/report` | relatório JSON |
| GET | `/report.csv` | exportação CSV |
| POST | `/jobs` | iniciar recuperação em massa |
| GET | `/jobs`, `/jobs/:id` | acompanhar processos |
| POST | `/jobs/:id/pause`, `/resume`, `/cancel`, `/confirm` | controle da fila |
| GET | `/duplicates` | URLs repetidas |

## Variáveis de ambiente

```env
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=ma-store
CLOUDINARY_DELIVERY_URL=          # opcional (CDN customizado)
IMAGE_RECOVERY_MAX_MB=12
IMAGE_RECOVERY_TIMEOUT_MS=15000
IMAGE_RECOVERY_MAX_REDIRECTS=3
IMAGE_RECOVERY_CONCURRENCY=3
IMAGE_RECOVERY_RECHECK_HOURS=24
IMAGE_RECOVERY_RATE_LIMIT_MAX=60
```

> O `CLOUDINARY_API_SECRET` nunca chega ao frontend: a assinatura SHA-1 do
> upload é calculada no backend (`services/cloudinary.ts`).

## Banco de dados

Migration: `backend/prisma/migrations/20261215120000_image_recovery/migration.sql`

- Adiciona colunas de rastreabilidade em `product_images`
  (`original_url`, `storage_provider`, `public_id`, `format`, `width`,
  `height`, `size_bytes`, `recovery_status`, `recovery_checked_at`).
- Cria `image_recovery_assets` (estado por referência),
  `image_recovery_logs` (histórico imutável),
  `image_recovery_jobs` e `image_recovery_job_items` (fila persistente).
- É **aditiva**: nenhum dado, preço, pedido ou imagem existente é removido.

Aplicar:

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

## Segurança (SSRF)

Todo acesso externo passa por `services/image-recovery/url-safety.ts`:

- somente HTTP/HTTPS, sem credenciais na URL;
- bloqueio de `localhost`, `.local`, `.internal` e domínios de metadata;
- bloqueio de IPv4/IPv6 privados, link-local, CGNAT, multicast, NAT64 e
  endereços de metadata de nuvem (AWS/GCP/Azure/Alibaba/Oracle);
- resolução DNS validada e conexão **pinada** no IP aprovado (anti DNS rebinding);
- cada redirect é revalidado (inclusive destino interno);
- limite de redirects, timeout e tamanho máximo;
- magic bytes + dimensões (não confia em extensão/Content-Type);
- rate limit nas rotas de verificação/recuperação e auditoria administrativa.

## Testes

```bash
cd backend
npm run typecheck
npx vitest run --config vitest.unit.config.ts
npm run build

cd ../frontend
npm run typecheck
npm test
npm run build
```

Os testes do recuperador cobrem: URL válida/inválida, imagem acessível,
arquivo inexistente, redirecionamento, timeout, servidor indisponível, arquivo
que não é imagem, extensão falsa, SSRF/IP privado, redirect para rede interna,
upload Cloudinary (mock), falha Cloudinary, confirmação administrativa,
atualização do produto sem alterar outros campos, preservação da URL original,
duplicidade e concorrência/pausa da fila.

## Limitações conhecidas

- Imagens com dimensões abaixo de 100px ou acima de 6000px são recusadas pela
  validação existente (proteção contra arquivos inválidos).
- A recuperação usa o **arquivo original**; não faz busca de substitutos por
  nome/marca. A URL/upload manual existe, mas fica marcada como substituta.
- A verificação é feita a partir do servidor (Render): URLs que só funcionam em
  uma rede específica continuam indisponíveis.
- O download é limitado por `IMAGE_RECOVERY_MAX_MB` (e por `UPLOAD_MAX_MB`).
