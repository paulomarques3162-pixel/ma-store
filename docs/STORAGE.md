# Armazenamento de imagens — local e objetos (S3)

O MA STORE valida toda imagem por **magic bytes** (não confia em MIME/extensão),
com limite de tamanho e dimensões. A gravação passa por **um único ponto**
(`saveUpload`) que escolhe o driver por `STORAGE_DRIVER`.

## Drivers

| Driver | Quando usar | Persistência |
| --- | --- | --- |
| `local` (padrão) | dev; Render **com disco persistente** | depende do disco |
| `s3` | produção/serverless | **persistente** |

O driver `s3` é compatível com a API S3: **AWS S3, Cloudflare R2, Backblaze B2,
MinIO, DigitalOcean Spaces**.

## Variáveis (`STORAGE_DRIVER=s3`)

```
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=ma-store
STORAGE_S3_REGION=sa-east-1
STORAGE_S3_ENDPOINT=              # R2/MinIO/Spaces (vazio = AWS)
STORAGE_S3_ACCESS_KEY_ID=
STORAGE_S3_SECRET_ACCESS_KEY=
STORAGE_S3_FORCE_PATH_STYLE=false # true em MinIO/R2 quando necessário
STORAGE_S3_PREFIX=uploads/
STORAGE_PUBLIC_URL=https://cdn.sualoja.com   # domínio público do bucket (recomendado)
```

> Em produção, `STORAGE_DRIVER=s3` **sem bucket** faz a aplicação **não subir**
> (fail fast) — evita gravar imagens em disco efêmero por engano.

## Interface

- `saveUpload(buffer)` → grava no driver ativo e devolve URL pública.
- `listUploads({ search, page, perPage })` → biblioteca de imagens.
- `deleteUpload(url)` → remove do driver ativo (best-effort; nunca lança).
- `resolveStoredUploadUrl` / `resolveImageUrl` (frontend) → resolvem a origem.

A URL gravada no banco é **portátil** quando possível (caminho relativo no driver
local; URL pública do bucket no S3), evitando o problema de `localhost` fixo no
banco.

## Limpeza de órfãos

`uploads-cleanup` continua funcionando com qualquer driver via `deleteUpload`.
