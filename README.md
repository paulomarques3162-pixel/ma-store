# MA STORE — Plataforma de e-commerce

Plataforma própria de e-commerce para a **MA STORE** (perfumes importados, árabes, decants, contratipos e kits), com loja virtual, painel administrativo completo, API REST, banco PostgreSQL, autenticação, pedidos, cupons, fretes, pagamentos (sandbox/produção), mensagens, feedback, CMS de conteúdo, temas visuais e laboratório de testes integrado.

> **Status desta entrega:** backend/API + banco **completos e testados** (127 testes automatizados + 45 verificações do laboratório, todos passando). O frontend está planejado na fase 2 — veja `docs/ROADMAP.md`.

---

## Regra nº 1 do projeto: NÃO INVENTAR DADOS DA LOJA

Esta é uma regra **absoluta** e está implementada no código, não apenas documentada:

- Nenhum produto, preço, estoque, CNPJ, PIX, telefone, endereço, rede social, política ou prazo é inventado.
- As **43 chaves de conteúdo/configuração** nascem com `value = null`. O site público devolve `null` e o frontend exibe um *placeholder* elegante até o administrador preencher.
- O **seed** cria dados de demonstração marcados com `[DEMO]` e `isDemo = true`, todos **inativos** (`active = false`) — invisíveis para o cliente até serem ativados de propósito.
- O **frete** nunca é estimado: se nenhuma modalidade ativa atender o CEP, o checkout informa em vez de cobrar um valor inventado.
- Produtos de demonstração **não têm imagem**: o frontend mostra um espaço reservado em vez de uma foto falsa.
- **Nenhum cálculo crítico** (preço, desconto, frete, total, estoque) é aceito do frontend — tudo é recalculado no backend.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ (testado em 24) |
| Linguagem | TypeScript 5 (strict, `noUncheckedIndexedAccess`) |
| HTTP | Fastify 5 |
| Banco | PostgreSQL 15+ |
| ORM | Prisma 6 (migrations versionadas) |
| Validação | Zod |
| Segurança | Helmet, CORS, rate limiting, JWT HS256, bcrypt (custo 12), HMAC-SHA256 em webhooks |
| Logs | Pino com `requestId` e redação de dados sensíveis |
| Testes | Vitest (unitário, integração, E2E) |
| Build | tsup (ESM) |

---

## Estrutura

```text
MA-STORE/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma              # 30 modelos + 13 enums
│   │   ├── migrations/                # init + índices de performance
│   │   └── seed.ts                    # dados [DEMO] inativos
│   ├── scripts/load-test.mjs          # teste de carga (RPS, p50/p95/p99)
│   ├── src/
│   │   ├── app.ts                     # composição do Fastify
│   │   ├── index.ts                   # bootstrap + shutdown gracioso
│   │   ├── env.ts                     # validação de ambiente (fail fast)
│   │   ├── db.ts                      # cliente Prisma
│   │   ├── lib/                       # crypto, senha, erros, tokens, auditoria, serialização
│   │   ├── plugins/                   # autenticação/autorização, handler de erros
│   │   └── modules/
│   │       ├── auth/                  # cadastro, login, sessões, reset de senha
│   │       ├── catalog/               # produtos, categorias, marcas
│   │       ├── cart/  favorites/
│   │       ├── coupons/  shipping/
│   │       ├── orders/                # checkout transacional + estoque
│   │       ├── payments/              # sandbox/produção + webhooks
│   │       ├── messages/  notifications/
│   │       ├── reviews/               # avaliações + feedback
│   │       ├── content/               # CMS: conteúdo, banners, tema
│   │       ├── users/                 # endereços
│   │       ├── admin/                 # painel administrativo completo
│   │       └── lab/                   # laboratório de testes
│   ├── tests/                         # unit, integration, e2e
│   └── .env.example
├── frontend/                          # fase 2 (veja docs/ROADMAP.md)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOY.md                      # Render + Vercel passo a passo
│   ├── TESTING.md
│   ├── PERFORMANCE.md                 # resultados medidos
│   ├── SECURITY.md
│   └── ROADMAP.md
├── docker-compose.yml                 # Postgres + API para desenvolvimento
├── README.md
├── API.md                             # todos os endpoints
└── ADMIN.md                           # manual do painel
```

---

## Como rodar localmente

### Opção A — com Docker (recomendado)

```bash
git clone <repo> && cd MA-STORE
cp backend/.env.example backend/.env      # edite JWT_SECRET e WEBHOOK_SECRET
docker compose up -d db                   # PostgreSQL em localhost:5432
cd backend && npm install
npx prisma migrate deploy
npm run db:seed
npm run dev                               # http://localhost:3333
```

### Opção B — PostgreSQL já instalado

```bash
cd backend
cp .env.example .env
# ajuste DATABASE_URL para o seu Postgres
createdb mastore_dev
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

### Verificação rápida

```bash
curl http://localhost:3333/api/health
```

```json
{
  "data": {
    "status": "ok",
    "api": "online",
    "database": { "connected": true, "latencyMs": 1 },
    "version": "1.0.0",
    "environment": "development",
    "payments": "sandbox",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
}
```

### Primeiro acesso ao painel

O seed cria um administrador **de teste**:

| E-mail | Senha | Observação |
|---|---|---|
| `admin@teste.local` | `Teste@Admin123` | `isDemo = true`, troca de senha obrigatória |

> Troque a senha no primeiro acesso. Em produção, defina `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` antes de rodar o seed — ou não rode o seed e crie o admin pelo banco.

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor com hot reload (tsx) |
| `npm run build` | Build ESM em `dist/` (tsup) |
| `npm start` | Executa o build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Aplica migrations (`migrate deploy`) |
| `npm run db:seed` | Popula dados `[DEMO]` **inativos** |
| `npm run db:reset` | Recria o banco e reaplica migrations |
| `npm test` | Todos os testes (unit + integração + E2E) |
| `npm run test:unit` / `test:integration` / `test:e2e` | Subconjuntos |
| `node scripts/load-test.mjs` | Teste de carga com relatório de percentis |

---

## Qualidade — evidências desta entrega

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | sem erros |
| `npm run build` | build ESM OK |
| `npm test` | **127/127 passando** (8 arquivos) |
| Laboratório de testes (`POST /api/admin/lab/run`) | **45/45 PASS**, 0 WARN, 0 FAIL |
| Teste de carga (250 usuários simultâneos) | **0 erros 5xx**, p95 ≤ 481 ms |
| Migrations do zero | aplicadas com sucesso em banco vazio |
| Seed | executa e é idempotente |

Detalhes numéricos em `docs/PERFORMANCE.md`.

---

## Bugs reais encontrados e corrigidos durante o desenvolvimento

O laboratório e a suíte não serviram apenas para "dar verde" — encontraram defeitos de verdade:

1. **Pagamento sem `providerRef`** — o pagamento criado junto com o pedido não tinha referência do provedor, então o webhook não conseguia correlacionar o evento. Corrigido em `createPaymentIntent`.
2. **Rate limit devolvendo 500 em vez de 429** — o `errorResponseBuilder` customizado lançava um objeto sem `statusCode`, caindo no ramo de erro interno. Removido.
3. **Token inválido devolvendo 500** — `jsonwebtoken.verify` lançava erro cru. Agora toda falha de token vira `401`.
4. **`INSERT` da sequência de pedidos sem `updatedAt`** — erro de SQL `42601`. Corrigido com `now()`.
5. **Decimal do Prisma vazando para o JSON** — a detecção por `constructor.name` falhava após o bundle; trocada por *duck typing* (`toNumber` + `toFixed`).
6. **Shipment não atualizado em `DELIVERED`** — o rastreio só era atualizado quando havia novo código na transição.
7. **`TRUNCATE` apagando `_prisma_migrations`** nos testes — o histórico de migrations era destruído e o Prisma tentava reaplicar tudo.
8. **Anti brute-force bloqueando a própria suíte** — limite agora configurável por ambiente (`AUTH_RATE_LIMIT_MAX`).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`API.md`](API.md) | Todos os endpoints, payloads, códigos de erro |
| [`ADMIN.md`](ADMIN.md) | Manual do painel administrativo |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modelo de dados, decisões técnicas, fluxos |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Deploy em Render (API + Postgres) e Vercel (frontend) |
| [`docs/TESTING.md`](docs/TESTING.md) | Como rodar e escrever testes; laboratório |
| [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | Resultados do teste de carga e otimizações |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Controles de segurança e checklist |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Próximas fases (frontend PWA, gateways reais, e-mail) |

---

## Licença e propriedade

Implementação própria. Nenhum código, credencial, banco ou recurso privado do site de referência foi copiado — apenas a estrutura comercial e a identidade de segmento foram usadas como referência.
