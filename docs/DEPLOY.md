# Deploy — MA STORE

Arquitetura alvo:

| Componente | Plataforma |
|---|---|
| API (Node) | **Render** (Web Service) |
| Banco | **PostgreSQL** (Render) |
| Frontend (fase 2) | **Vercel** |

> ⚠️ **Nunca** comite `.env`. Todos os segredos vão em variáveis de ambiente da plataforma.

---

## 0. Deploy declarativo com `render.yaml` (recomendado)

O repositório inclui um **Blueprint** (`render.yaml`) que cria, de forma
**declarativa e reproduzível**, o banco PostgreSQL e a API com:

- **disco persistente** em `/var/data` (para os uploads não sumirem em deploy/restart);
- **healthcheck** em `/api/health`;
- **auto-deploy** a cada push na branch conectada.

### 0.1 Aplicar o blueprint

1. Render → **New** → **Blueprint Instance** → conecte o repositório.
2. O Render lê o `render.yaml` e cria `mastore-db` (Postgres) e `ma-store-api` (Web Service).
3. Preencha no painel as variáveis marcadas com `sync: false`:
   - `CORS_ORIGINS` (domínio do frontend, **sem barra final**);
   - `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET`;
   - `PUBLIC_API_URL` (a URL pública desta API, ex.: `https://ma-store-api.onrender.com`);
   - opcionais: `VAPID_*`, credenciais de frete, SMTP.
4. `JWT_SECRET` e `WEBHOOK_SECRET` são **gerados automaticamente** pelo Render
   (`generateValue: true`) — não precisam ser digitados.

> **Importante:** o bloco `disk:` do blueprint exige um **plano pago** (o
> blueprint usa `1c-2g`). No plano **Free** não há disco persistente — use
> `STORAGE_DRIVER=s3` (ver seção **Storage de imagens** abaixo).

### 0.2 Auto-deploy

`autoDeployTrigger: commit` faz o Render **republicar automaticamente** a cada
commit na branch `main`. Outros valores:

- `checksPass` — só faz deploy se os checks de CI da branch passarem;
- `off` — desativa o auto-deploy (deploy apenas manual).

> `autoDeploy: true` (forma antiga) ainda funciona, mas está **deprecado**.

### 0.3 Região

Mantenha a **mesma região** no banco e no serviço (`virginia` no blueprint).
Usar regiões diferentes adiciona latência e pode expor o banco à rede externa.

### 0.4 O que o blueprint NÃO cobre

O **frontend** continua na **Vercel** (ver [`VERCEL.md`](VERCEL.md)), com
auto-deploy próprio. O `render.yaml` cobre apenas API + banco.

---

## 1. Banco de dados no Render (caminho manual)

> Se você usou o **Blueprint** da seção 0, o banco e a API já foram criados —
> pule direto para a seção **2.3 Primeira validação**. Os passos 1 e 2 abaixo
> descrevem a criação manual, equivalente.

1. Render → **New** → **PostgreSQL**.
2. Nome: `mastore-db`. Região: a mais próxima dos usuários. Plano: comece pelo mais simples e escale depois.
3. Após criar, copie a **Internal Database URL** (usada pela API no mesmo datacenter) ou a **External** (para rodar migrations da sua máquina).
4. Guarde como `DATABASE_URL`.

> Use a **Internal URL** na API (não gasta banda externa e tem menos latência). Use a **External URL** só para operações administrativas locais.

---

## 2. API no Render

### 2.1 Criar o serviço

**New** → **Web Service** → conecte o repositório.

| Campo | Valor |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npx prisma migrate deploy && node dist/index.js` |
| Health Check Path | `/api/health` |
| Instance Type | comece com o menor; monitore e escale |

> `prisma migrate deploy` no start garante que as migrations estejam aplicadas antes da API subir. Como `deploy` é idempotente e aditivo, é seguro rodar a cada deploy.

### 2.2 Variáveis de ambiente

Preencha em **Environment** → **Add Environment Variable**:

| Variável | Valor | Observação |
|---|---|---|
| `NODE_ENV` | `production` | |
| `APP_ENV` | `production` | |
| `APP_VERSION` | `1.0.0` | ou o SHA do commit (Render expõe `RENDER_GIT_COMMIT`) |
| `PORT` | `10000` | Render injeta; deixe a plataforma mandar |
| `HOST` | `0.0.0.0` | |
| `DATABASE_URL` | *(Internal Database URL)* | segredo |
| `JWT_SECRET` | `openssl rand -hex 32` | segredo — **obrigatório** |
| `JWT_ACCESS_TTL` | `15m` | |
| `SESSION_TTL_DAYS` | `30` | |
| `CORS_ORIGINS` | `https://seudominio.com.br,https://www.seudominio.com.br` | **sem barra no final** |
| `PAYMENT_ENV` | `production` | produção real; `sandbox` só em testes |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` | segredo |
| `PAYMENT_EXPIRES_MINUTES` | `60` | |
| `PAYMENT_PROVIDER` | `mercadopago` | gateway real de produção |
| `PAYMENT_PROVIDER_KEY` / `PAYMENT_PROVIDER_SECRET` | *(do gateway)* | legado; o Mercado Pago usa as variáveis abaixo |
| `LOG_LEVEL` | `info` | |
| `RATE_LIMIT_MAX` | `120` | |
| `AUTH_RATE_LIMIT_MAX` | `10` | anti brute-force |
| `STORAGE_DRIVER` | `local` (com disco) ou `s3` | ver **Storage de imagens** |
| `STORAGE_LOCAL_DIR` | `/var/data/uploads` | **no disco persistente** |
| `DELIVERY_PROOF_DIR` | `/var/data/delivery-proofs` | **no disco persistente** |
| `STORAGE_PUBLIC_URL` | *(vazio)* | relativo portátil; só preencha com CDN |
| `MERCADOPAGO_ACCESS_TOKEN` | *(do MP)* | segredo — **só backend** |
| `MERCADOPAGO_PUBLIC_KEY` | *(do MP)* | pública (tokenização no browser) |
| `MERCADOPAGO_WEBHOOK_SECRET` | *(do MP)* | segredo — assinatura do webhook |
| `PUBLIC_API_URL` | `https://sua-api.onrender.com` | `notification_url` do Mercado Pago |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npm run vapid:generate` | push opcional (privada só no backend) |

**Nunca** coloque `JWT_SECRET`, `WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN` ou
`MERCADOPAGO_WEBHOOK_SECRET` no frontend. Ao usar `PAYMENT_PROVIDER=mercadopago`,
as credenciais do MP + `PUBLIC_API_URL` são obrigatórias — sem elas os meios
online ficam **indisponíveis** (nunca geramos cobrança falsa).

### 2.2.1 Fail-fast de produção (a API NÃO sobe em configuração insegura)

Em `NODE_ENV=production` o `backend/src/env.ts` **encerra o processo** (exit 1)
quando detecta uma configuração que aceitaria pedidos sem cobrar de verdade:

| Condição | Motivo |
|---|---|
| `PAYMENT_ENV=production` **e** `PAYMENT_PROVIDER!=mercadopago` | produção real não pode usar pagamento simulado |
| `PAYMENT_PROVIDER=mercadopago` sem alguma credencial (`ACCESS_TOKEN`/`PUBLIC_KEY`/`WEBHOOK_SECRET`/`PUBLIC_API_URL`) | nunca aceitar pedido sem conseguir cobrar |
| `STORAGE_DRIVER=s3` sem `STORAGE_S3_BUCKET` | evitar gravar imagens em disco efêmero |
| `CORS_ORIGINS` contendo `localhost`/`127.0.0.1` | a vitrine real não conseguiria chamar a API |

Em desenvolvimento/sandbox (`PAYMENT_ENV=sandbox`) essas checagens apenas
geram **aviso**, para não travar o trabalho local.

### 2.3 Primeira validação

```bash
curl https://sua-api.onrender.com/api/health
```

Espere `status: "ok"` e `database.connected: true`.

Se `database.connected` for `false`, confira a `DATABASE_URL` e se o banco permite conexões da região do serviço.

### 2.4 Criar o primeiro administrador

**Não rode o seed de demonstração em produção.** Crie o admin com uma senha forte:

```bash
# na sua máquina, com a External Database URL
cd backend
export DATABASE_URL="postgresql://...external..."
export SEED_ADMIN_EMAIL="admin@seudominio.com.br"
export SEED_ADMIN_PASSWORD="<senha-forte-e-unica>"
npm run db:seed
```

O seed cria também as 43 chaves de conteúdo **vazias** (necessárias para o CMS) e os itens `[DEMO]` **inativos**. Se preferir um banco sem nenhum item de demonstração, remova-os pelo painel ou apague as linhas `[DEMO]` após o seed.

> Alternativa: crie o admin direto no banco com um hash bcrypt custo 12.

---

> ⚠️ **Deploy do frontend tem guia próprio e detalhado:** [`VERCEL.md`](VERCEL.md)
> — cobre o `vercel.json` (correção do 404 em `/admin`), `VITE_API_URL` obrigatória, CORS e a
> criação/verificação do administrador em produção.

## 2.5 Storage de imagens (uploads) — NÃO PERCA ARQUIVOS

> ⚠️ O disco de um container é **efêmero**: com `STORAGE_DRIVER=local` sem disco
> persistente, **toda imagem enviada some no próximo deploy/restart**. Escolha
> **uma** das duas opções abaixo.

### Opção A — Disco persistente no Render (padrão do `render.yaml`)

O blueprint já monta um disco em `/var/data` e aponta os diretórios para dentro dele:

```yaml
disk:
  name: mastore-data
  mountPath: /var/data
  sizeGB: 5
envVars:
  - key: STORAGE_DRIVER
    value: local
  - key: STORAGE_LOCAL_DIR
    value: /var/data/uploads
  - key: DELIVERY_PROOF_DIR
    value: /var/data/delivery-proofs
```

- Exige **plano pago** (o plano Free não tem disco). O blueprint usa `1c-2g`.
- O Render desativa *zero-downtime deploy* em serviços com disco (esperado).
- As imagens são servidas em `GET /uploads/<arquivo>` (rota estática do host da API).

### Opção B — Storage de objetos S3 (recomendado p/ escala e plano Free)

Compatível com **AWS S3, Cloudflare R2, Backblaze B2, MinIO e DigitalOcean Spaces**.
Remova o bloco `disk:` do `render.yaml` e configure:

```
STORAGE_DRIVER=s3
STORAGE_S3_BUCKET=<bucket>
STORAGE_S3_REGION=us-east-1
STORAGE_S3_ENDPOINT=            # vazio = AWS; preencha p/ R2/MinIO/Spaces
STORAGE_S3_ACCESS_KEY_ID=<...>
STORAGE_S3_SECRET_ACCESS_KEY=<...>
STORAGE_S3_FORCE_PATH_STYLE=false
STORAGE_S3_PREFIX=uploads/
STORAGE_PUBLIC_URL=            # opcional: base pública/CDN do bucket
```

- Com `STORAGE_DRIVER=s3`, a API **não sobe** em produção se o bucket não estiver
  definido (fail-fast proposital — ver `backend/src/env.ts`).
- Detalhes completos em [`STORAGE.md`](STORAGE.md).

### Migrar de disco local para S3

Os arquivos já existentes continuam válidos: como as URLs gravadas são relativas
(`/uploads/<arquivo>`), basta **copiar os arquivos do disco para o bucket** no
mesmo prefixo e trocar `STORAGE_DRIVER`. Nenhuma migration é necessária.

---

## 3. Frontend na Vercel (fase 2)

| Campo | Valor |
|---|---|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Env | `VITE_API_URL=https://sua-api.onrender.com/api` |

**Importante:** só variáveis com prefixo `VITE_` são expostas ao browser. Nunca coloque segredos com esse prefixo.

---

## 4. Migrations

```bash
npx prisma migrate deploy      # aplica o que estiver pendente (produção)
npx prisma migrate dev --name <nome>   # cria migration nova (desenvolvimento)
npx prisma migrate status      # mostra o estado
```

**Regras:**

- Nunca altere o banco de produção manualmente sem uma migration registrada.
- Nunca edite uma migration já aplicada — crie uma nova.
- `migrate deploy` é idempotente: pode rodar em todo deploy.
- Para mudanças destrutivas (remover coluna), faça em duas etapas: primeiro o código para de usar, depois a migration remove.

### Rollback

Prisma não gera *down migrations*. O caminho seguro:

1. **Reverter o código** (Render → Deploys → *Rollback* para o deploy anterior). A API volta a funcionar com o schema antigo — por isso mudanças destrutivas exigem o processo em duas etapas.
2. Se o schema precisar voltar, escreva uma **nova migration** que desfaça a alteração e aplique com `migrate deploy`.

Mantenha backups automáticos do Postgres do Render habilitados e teste a restauração.

---

## 5. Domínio e HTTPS

1. Render → seu Web Service → **Settings** → **Custom Domain**.
2. Adicione `api.seudominio.com.br` e crie o CNAME indicado.
3. O certificado TLS é automático. **Nunca** sirva a API em HTTP puro em produção.
4. No frontend, aponte `VITE_API_URL` para `https://api.seudominio.com.br/api` e atualize `CORS_ORIGINS` na API com o domínio final.

---

## 6. Checklist pós-deploy

```
[ ] /api/health → status ok e database.connected true
[ ] CORS testado a partir do domínio do frontend (sem erro de origem)
[ ] Admin criado com senha forte; usuário de demonstração removido
[ ] `PAYMENT_PROVIDER=mercadopago` e `PAYMENT_ENV=production` (sem mock/sandbox)
[ ] `PUBLIC_API_URL` aponta para a URL pública da API
[ ] A API subiu sem cair no fail-fast (logs sem "NAO vai iniciar")
[ ] WEBHOOK_SECRET configurado e cadastrado no gateway
[ ] Ao menos uma modalidade de frete ATIVA
[ ] Configurações preenchidas (loja, contato, PIX, políticas)
[ ] Tema publicado e banners cadastrados
[ ] Laboratório de testes em /api/admin/lab/run → 0 FAIL
[ ] Backups do banco habilitados
[ ] Logs do Render sem erros recorrentes
```

---

## 7. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `Configuracao de ambiente invalida` no boot | Falta variável obrigatória | A API valida o ambiente e **não sobe** — veja a lista de campos no log |
| `database.connected: false` | `DATABASE_URL` errada, banco suspenso ou SSL ausente | Use a Internal URL e `?sslmode=require` se exigido |
| `P1001` / timeout de conexão | Banco em outra região ou suspenso | Mesma região; reative o banco |
| `P2021` tabela não existe | Migration não aplicada | `npx prisma migrate deploy` |
| `P3018` migration falhou | Histórico inconsistente | `npx prisma migrate status`; corrija com nova migration; em último caso `migrate resolve` com cautela |
| Erro de CORS no navegador | `CORS_ORIGINS` não bate exatamente | Inclua protocolo e porta; **sem** barra final |
| `429 RATE_LIMITED` em uso normal | Limite agressivo | Ajuste `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` |
| Checkout com "Nenhuma modalidade de frete" | Nenhuma modalidade ativa atende o CEP | Cadastre/ative no painel |
| Webhook não atualiza o pedido | Assinatura inválida ou `providerRef` divergente | Confira `WEBHOOK_SECRET` e consulte `GET /api/admin/webhooks` |
| Deploy falha no build | Tipo ou dependência | Rode `npm run typecheck` localmente antes |
| Imagens somem após deploy/restart | `STORAGE_DRIVER=local` **sem** disco persistente | Monte o disco (`/var/data`) ou use `STORAGE_DRIVER=s3` |
| `STORAGE_DRIVER=s3` e a API não sobe | `STORAGE_S3_BUCKET` ausente | Defina o bucket ou volte para `local` com disco |
| `/uploads/<arquivo>` retorna 404 | Driver é `s3` (arquivos não estão em disco) | Use a URL pública do bucket/CDN (`STORAGE_PUBLIC_URL`) |
| Webhook do MP não chega | `PUBLIC_API_URL` vazia ou incorreta | Defina a URL pública da API |

---

## 8. Operação contínua

- **Backups**: habilite no Render e teste uma restauração de verdade.
- **Monitoramento**: acompanhe `/api/health`, os logs do Render e os `requestId` das respostas de erro.
- **Segurança**: rotacione `JWT_SECRET` e `WEBHOOK_SECRET` periodicamente (rotacionar o JWT invalida todas as sessões — os clientes precisam entrar de novo).
- **Qualidade**: rode o laboratório (`/api/admin/lab/run`) antes de cada divulgação e depois de mudanças de configuração.
- **Carga**: rode `node scripts/load-test.mjs` contra staging, **nunca** contra produção.
