# Deploy — MA STORE

Arquitetura alvo:

| Componente | Plataforma |
|---|---|
| API (Node) | **Render** (Web Service) |
| Banco | **PostgreSQL** (Render) |
| Frontend (fase 2) | **Vercel** |

> ⚠️ **Nunca** comite `.env`. Todos os segredos vão em variáveis de ambiente da plataforma.

---

## 1. Banco de dados no Render

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
| `PAYMENT_ENV` | `sandbox` primeiro, depois `production` | |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` | segredo |
| `PAYMENT_EXPIRES_MINUTES` | `60` | |
| `PAYMENT_PROVIDER` | `mock` (troque ao integrar gateway real) | |
| `PAYMENT_PROVIDER_KEY` / `PAYMENT_PROVIDER_SECRET` | *(do gateway)* | segredos |
| `LOG_LEVEL` | `info` | |
| `RATE_LIMIT_MAX` | `120` | |
| `AUTH_RATE_LIMIT_MAX` | `10` | anti brute-force |

**Nunca** coloque `JWT_SECRET` ou `WEBHOOK_SECRET` no frontend.

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
[ ] PAYMENT_ENV correto (sandbox x production)
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

---

## 8. Operação contínua

- **Backups**: habilite no Render e teste uma restauração de verdade.
- **Monitoramento**: acompanhe `/api/health`, os logs do Render e os `requestId` das respostas de erro.
- **Segurança**: rotacione `JWT_SECRET` e `WEBHOOK_SECRET` periodicamente (rotacionar o JWT invalida todas as sessões — os clientes precisam entrar de novo).
- **Qualidade**: rode o laboratório (`/api/admin/lab/run`) antes de cada divulgação e depois de mudanças de configuração.
- **Carga**: rode `node scripts/load-test.mjs` contra staging, **nunca** contra produção.
