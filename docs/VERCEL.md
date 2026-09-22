# Deploy do frontend na Vercel — MA STORE

Este documento resolve o problema **`/admin` retornando 404** e consolida a configuração
correta do deploy do WebApp.

---

## 1. Por que `/admin` dava 404

O frontend é uma **SPA** (Single Page Application): existe **um único** `index.html` e todas as
rotas (`/`, `/produtos`, `/admin`, `/admin/login`, `/admin/dashboard`, …) são resolvidas pelo
React Router **no navegador**.

A Vercel, por padrão, entrega **arquivos**:

```
GET /              -> encontra index.html           -> 200 OK
GET /admin         -> procura um arquivo "admin"    -> 404 NOT_FOUND
GET /admin/login   -> procura "admin/login"         -> 404 NOT_FOUND
```

O arquivo `index.html` existe, mas **nada estava dizendo à Vercel para entregá-lo quando o
caminho não corresponde a um arquivo real**. Esse "aviso" é o `rewrite` (regra de reescrita).

**Isso não é um bug do código React** — é configuração de servidor. A loja em si sempre esteve
correta: o backend autoriza, o frontend protege a rota e o acesso administrativo funciona.

---

## 2. A correção

Foram adicionados **dois** arquivos `vercel.json` (cada um serve a um cenário; o que não se
aplica é simplesmente ignorado pela Vercel):

| Arquivo | Quando é usado |
|---|---|
| `frontend/vercel.json` | Quando **Root Directory = `frontend`** (recomendado) |
| `vercel.json` (raiz) | Quando **Root Directory = raiz do repositório** |

A regra central é a mesma:

```json
{
  "rewrites": [
    {
      "source": "/((?!api/)(?!assets/)(?!icons/)(?!.*\\.[a-zA-Z0-9]+$).*)",
      "destination": "/index.html"
    }
  ]
}
```

Leitura da regra, de dentro para fora:

| Trecho | Significado |
|---|---|
| `(?!api/)` | **nunca** reescrever chamadas de API |
| `(?!assets/)` | **nunca** reescrever os arquivos compilados (JS/CSS) |
| `(?!icons/)` | **nunca** reescrever os ícones do PWA |
| `(?!.*\.[a-zA-Z0-9]+$)` | **nunca** reescrever qualquer arquivo com extensão (`/logo.webp`, `/sw.js`, `/manifest.webmanifest`, `/favicon-32.png`, …) |
| `.*` | **todo o resto** (rotas da aplicação) → `/index.html` |

Assim `/admin`, `/admin/login`, `/admin/produtos/novo` e `/produtos/perfume-x` passam a
carregar o app, enquanto imagens, scripts, estilos e a API continuam sendo servidos direto.

> **Por que a exclusão explícita, se a Vercel checa o sistema de arquivos antes do rewrite?**
> Porque a checagem explícita protege contra mudanças de comportamento do provedor e contra
> arquivos que passem a ser gerados dinamicamente. É uma garantia de "nenhum asset será
> transformado em HTML".

### Validação da regra (executada)

| Caminho | Resultado esperado | Resultado |
|---|---|---|
| `/admin`, `/admin/login`, `/admin/dashboard`, `/admin/produtos/novo` | `index.html` | ✅ |
| `/produtos`, `/carrinho`, `/checkout`, `/minha-conta` | `index.html` | ✅ |
| `/assets/index-abc.js`, `/assets/index-abc.css` | servido direto | ✅ |
| `/logo.webp`, `/icons/icon-192.png`, `/favicon-32.png` | servido direto | ✅ |
| `/sw.js`, `/manifest.webmanifest`, `/robots.txt` | servido direto | ✅ |
| `/api/products`, `/api/auth/login` | vai para a API | ✅ |

O mesmo teste roda localmente:

```bash
cd frontend
npm run build
npm run serve:test          # aplica o vercel.json de verdade, na mesma ordem da Vercel
npm run audit:admin         # 19 rotas + fluxo de acesso no navegador
```

O servidor de teste (`tests/browser/local-server.mjs`) **não inventa um fallback próprio**: ele
lê o `frontend/vercel.json` e aplica a mesma regra, com a mesma ordem da Vercel
(*arquivo existente vence → depois o rewrite → senão 404*). É isso que torna o teste local uma
prova real da configuração.

---

## 3. Configuração da Vercel (passo a passo)

**Settings → General**

| Campo | Valor |
|---|---|
| Root Directory | `frontend` ← **recomendado** |
| Framework Preset | `Vite` (detectado automaticamente) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |
| Node Version | 20.x ou 22.x |

**Settings → Environment Variables** (Production **e** Preview)

| Variável | Valor | Obrigatória |
|---|---|---|
| `VITE_API_URL` | `https://sua-api.onrender.com/api` | ✅ **sim** |
| `VITE_APP_NAME` | `MA STORE` | não |

> ⚠️ **`VITE_API_URL` é obrigatória.** O padrão do projeto é `/api` (usado no desenvolvimento,
> onde o Vite faz proxy). Se ela não for definida na Vercel, o frontend chama `/api` **no próprio
> domínio da Vercel** e recebe o `index.html` no lugar do JSON — a loja parecia "quebrada" sem
> nenhuma mensagem clara. Duas proteções foram adicionadas no código:
>
> 1. o console acusa explicitamente quando o build de produção roda sem `VITE_API_URL`;
> 2. o cliente HTTP detecta resposta HTML e lança um erro legível em vez de tratar como "sem dados".

> ⚠️ Tudo que começa com `VITE_` é **embutido no bundle** e visível ao usuário. Nunca coloque
> segredos (`JWT_SECRET`, `DATABASE_URL`, chaves de gateway) nas variáveis da Vercel.

---

## 4. CORS no backend (Render)

O frontend na Vercel precisa estar na lista de origens permitidas da API. Em
**Render → seu Web Service → Environment**:

```
CORS_ORIGINS=https://seudominio.com.br,https://www.seudominio.com.br,https://seu-projeto.vercel.app
```

| Regra | Motivo |
|---|---|
| **Sem barra no final** | `https://site.com/` não casa com `https://site.com` |
| Inclua **com e sem `www`** | São origens diferentes |
| Inclua a URL de produção da Vercel | Use o alias estável, não o hash de um deploy específico |
| **Nunca use `*` em produção** | O código só libera `*` se você escrever `*` explicitamente |

> As **Preview Deployments** da Vercel têm URL única por deploy e ficam **bloqueadas por padrão**
> (Deployment Protection). Teste sempre pelo domínio de produção.
>
> Sobre a URL que você enviou
> (`ma-store-ophhwz9iv-paulomarques3162-2208s-projects.vercel.app`): ela responde **302 para o login
> da Vercel** em **todas** as rotas, inclusive `/`. Isso é a proteção de deploy, não o erro de
> rewrite. Para abrir o site publicamente: **Settings → Deployment Protection → Vercel Authentication
> → Disabled** (ou use o domínio de produção).

---

## 5. Como criar e verificar o administrador (Neon / produção)

### Verificar se já existe (sem criar, sem alterar nada)

```bash
cd backend
DATABASE_URL="postgresql://...neon.tech/mastore?sslmode=require" npm run admin:check
```

Saída: lista os administradores (e-mail, status, datas) e **nunca** exibe senha ou hash.
Código de saída `0` = existe administrador ativo · `1` = nenhum · `2` = falha de conexão.

### Criar (idempotente e seguro)

```bash
cd backend
SEED_ADMIN_EMAIL="voce@seudominio.com.br" \
SEED_ADMIN_PASSWORD="<senha-forte-e-unica>" \
DATABASE_URL="postgresql://...neon.tech/mastore?sslmode=require" \
npm run db:seed
```

Garantias do seed nesta versão:

| Garantia | Como |
|---|---|
| **Não apaga nem recria o banco** | usa apenas `upsert` — nenhum `DROP`/`TRUNCATE`/`reset` |
| **Não sobrescreve senha existente** | o `update` altera só `role` e `status` |
| **Exige senha em produção** | com `NODE_ENV=production` e sem `SEED_ADMIN_PASSWORD`, o seed **aborta** |
| **Rejeita a senha de demonstração em produção** | falha explícita se ela for usada |
| **Não imprime credenciais em produção** | apenas confirma que a senha veio da variável |
| **Marca demonstração só em dev** | `isDemo` não é aplicado em produção |

> O seed também cria/garante as **43 chaves de conteúdo** vazias (placeholders do CMS) e os itens
> `[DEMO]` **inativos**. Nenhum dado real é inventado.

---

## 6. Checklist de verificação após o deploy

```
[ ] https://SEU-DOMINIO/                    -> loja abre
[ ] https://SEU-DOMINIO/admin               -> redireciona para /admin/login  (NÃO 404)
[ ] https://SEU-DOMINIO/admin/login         -> formulário abre               (NÃO 404)
[ ] https://SEU-DOMINIO/admin/dashboard     -> com sessão de ADMIN, abre o painel
[ ] F5 em /admin/dashboard                  -> continua no painel (não 404, não desloga)
[ ] /assets/....js carrega (aba Network, status 200)
[ ] /logo.webp carrega e NÃO retorna HTML
[ ] Login como CLIENTE em /admin/login      -> "Esta conta não possui acesso administrativo."
[ ] Cliente autenticado em /admin/dashboard -> tela "Área restrita"
[ ] Cliente chamando a API /api/admin/*     -> HTTP 403
[ ] VITE_API_URL definida na Vercel         -> chamadas vão para a API do Render
[ ] CORS_ORIGINS no Render contém o domínio da Vercel (sem barra final)
[ ] Sem erro de CORS no console do navegador
[ ] /api/health responde {"status":"ok","database":{"connected":true}}
```

Todos os itens acima, exceto os que dependem do seu domínio publicado, são verificados
automaticamente por `npm run audit:admin`.
