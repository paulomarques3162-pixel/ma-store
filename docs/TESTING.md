# Testes — MA STORE

Três níveis de verificação, todos executáveis automaticamente.

| Camada | Ferramenta | Arquivos | Testes |
|---|---|---|---|
| Unitário | Vitest | `tests/unit/*` | 24 |
| Integração | Vitest + `app.inject()` | `tests/integration/*` | ~90 |
| E2E | Vitest + `app.inject()` | `tests/e2e/full-flow.test.ts` | 1 fluxo completo |
| Laboratório | API real + banco | `POST /api/admin/lab/run` | 45 verificações |
| Carga | Node puro | `scripts/load-test.mjs` | RPS/p50/p95/p99 |

**Resultado atual: 127/127 testes automatizados e 45/45 verificações do laboratório.**

---

## Pré-requisitos

Um PostgreSQL acessível e dois bancos: um de desenvolvimento e um **de teste**.

```bash
createdb mastore_dev
createdb mastore_test
```

Em `backend/.env`:

```
DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/mastore_dev?schema=public
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/mastore_test?schema=public
```

> A suíte **aborta** se `TEST_DATABASE_URL` apontar para um banco cujo nome contenha `mastore_dev`. Isso evita rodar TRUNCATE no banco de desenvolvimento.

---

## Executar

```bash
cd backend

npm test                 # tudo
npm run test:unit        # só unitários (rápido, sem banco de dados real)
npm run test:integration # integração
npm run test:e2e         # fluxo completo
npm run typecheck        # tsc --noEmit
```

### Depuração

```bash
LOG_LEVEL=error npx vitest run tests/integration/orders.test.ts   # mostra o erro real
TEST_VERBOSE=1  npx vitest run tests/integration/payments.test.ts # habilita o log do Pino
```

---

## Como a suíte está montada

### `tests/setup.ts`

Roda antes de cada arquivo de teste e **força o ambiente de teste**:

- `NODE_ENV=test`, `DATABASE_URL=TEST_DATABASE_URL`
- `JWT_SECRET` e `WEBHOOK_SECRET` só para teste
- `PAYMENT_ENV=sandbox`
- `RATE_LIMIT_MAX` e `AUTH_RATE_LIMIT_MAX` altíssimos

Isso é necessário porque `src/env.ts` valida o ambiente na importação (fail fast) e o anti brute-force, correto em produção, bloquearia a própria suíte.

### `tests/global-setup.ts`

Executa `prisma migrate deploy` **no banco de teste** uma vez antes de tudo.

### `tests/helpers.ts`

| Helper | Para que serve |
|---|---|
| `makeApp()` | Cria a aplicação com logger desligado (ou ligado com `TEST_VERBOSE=1`) |
| `resetDatabase()` | `TRUNCATE … RESTART IDENTITY CASCADE` em todas as tabelas, **exceto `_prisma_migrations`** |
| `api(app, {method,url,token,payload})` | Chama a API via `app.inject()` (sem abrir porta) |
| `createClient()` | Registra um cliente e devolve tokens |
| `createAdmin()` | Cria um admin e devolve o token |
| `createShopFixture()` | Categoria + produto + modalidade de frete |
| `ADDRESS` | Endereço válido reutilizável |

Usamos `app.inject()` em vez de HTTP real: exercita a **mesma** pilha (parsers, hooks, validação, serviços, banco) sem custo de rede e sem portas ocupadas.

`fileParallelism: false` + `singleFork: true` porque todos os arquivos compartilham o mesmo banco.

---

## O que é verificado

### Unitário (`tests/unit/`)

- **Serialização**: Decimal → number (inclusive via *duck typing* após o bundle), datas, aninhamento, sem vazar propriedades internas.
- **Slug**: acentos pt-BR, espaços, `&`.
- **Paginação**: padrões seguros, teto de 100, valores inválidos ignorados.
- **Senhas**: hash, verificação, política mínima, nunca retorna a original.
- **Criptografia**: SHA-256 determinístico, `safeEqual` em tempo constante, HMAC, hash de idempotência.
- **Erros**: mapeamento código → status HTTP.
- **CEP → UF**: normalização, máscara, CEP inválido, faixas das principais UFs.
- **Transições de pedido**: caminho felizes, cancelamentos válidos, saltos bloqueados, idempotência do mesmo status.

### Integração (`tests/integration/`)

**`auth.test.ts`**
Cadastro (normalização de e-mail, duplicidade, senha fraca, confirmação, aceite dos termos), login (senha errada com mensagem genérica, sem revelar se o e-mail existe), bloqueio após 5 tentativas, rotação de refresh token, logout, token inválido → **401 (nunca 500)**, recuperação de senha completa, troca de senha exigindo a atual, cliente bloqueado em **todas** as rotas de admin, endereços (criação, padrão, isolamento entre usuários).

**`catalog-cart.test.ts`**
Produto inativo fora da vitrine, busca, filtros (preço, estoque, lançamento), ordenação, paginação, detalhe/relacionados/facetas, **custo nunca exposto**, 404, categorias e marcas. Carrinho: acumular, atualizar, remover, limpar, subtotal no servidor, estoque insuficiente → **409**, produto inativo → 404, carrinhos independentes, não alterar item de outro usuário, exigir autenticação. Favoritos: favoritar, duplicidade → 409, remover.

**`orders.test.ts`**
Cupom: percentual, fixo limitado ao subtotal, minúsculas, expirado/inativo/futuro/inexistente, valor mínimo, limite por usuário, produto fora do cupom, produto com `allowCoupon: false`. Frete: cotação por CEP, `required: false` sem itens despacháveis, frete grátis, CEP → UF. Checkout: totais corretos, reserva de estoque, snapshots imutáveis, **idempotência**, carrinho vazio → 400, frete obrigatório → 422, endereço obrigatório, endereço de outro usuário → 404, compra acima do estoque → **409**, e **concorrência: 3 clientes no último item → exatamente 1 pedido criado, estoque 0, nunca negativo**. Pedidos: listar/detalhar/comprovante/resumo, cancelamento com devolução de estoque, isolamento entre clientes, notificação para cliente e admin.

**`payments.test.ts`**
Intenção com `providerRef`, reaproveitamento (não cria pagamento duplicado), pedido de outro usuário → 404, pagamento de outro → 403, **nenhum dado de cartão armazenado**. Sandbox: aprovar (pedido `PAID`, `soldStock`), recusar (pedido intacto + notificação), cancelar, expirar, tentativas registradas, idempotência do estado final. Webhooks: assinatura inválida não altera o pagamento, ausência de assinatura, assinatura válida processa, evento desconhecido → `IGNORED`, **eventId duplicado → `DUPLICATED`**, expiração em lote.

**`admin.test.ts`**
Dashboard com métricas reais e alerta de estoque baixo. Produtos: CRUD, SKU duplicado, duplicação, estoque abaixo do reservado **bloqueado**, produto vendido não pode ser excluído de verdade, **auditoria com antes/depois**. Categorias/marcas: slug único, soft delete. Cupons: criação, percentual > 100 bloqueado, ativar/desativar. Frete: criação, prazo inválido → 400. Usuários: **nunca expõe `passwordHash` nem senha**, `passwordVisible: false`, bloqueio derruba sessões, admin não bloqueia a si mesmo, reset iniciado sem revelar a senha. Mensagens, moderação de avaliações (aprovar publica, rejeitar esconde), pagamentos/webhooks. CMS: chaves nascem vazias, salvar conteúdo gera auditoria, conteúdo privado não sai na API pública, banners com vigência, **tema só publica por ação explícita**. Auditoria com filtros e logs.

### E2E (`tests/e2e/full-flow.test.ts`)

Um único teste percorre **todo** o fluxo com um cliente real:

```
admin → catálogo → cupom → cadastro → login → sessão validada → endereço
→ busca → produto → favorito → carrinho → cupom validado → frete calculado
→ checkout → estoque reservado → intenção de pagamento (sandbox)
→ pagamento aprovado → estoque vendido → webhook → meus pedidos
→ comprovante → conversa + resposta do admin → dashboard
→ pedido no admin → PREPARING → SHIPPED (com rastreio) → DELIVERED
→ histórico de status → notificações → avaliação → moderação → publicação
→ feedback → logout → sessão revogada → auditoria
```

---

## Laboratório de testes (dentro do painel)

Além da suíte de código, existe o laboratório embutido na API, pensado para o **administrador** validar a plataforma em execução.

```bash
curl -X POST https://sua-api/api/admin/lab/run \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{}'
```

- Cria dados marcados como `[TESTE]`/`isDemo`, executa 45 verificações reais, grava em `test_runs`/`test_results` e **limpa tudo ao final**.
- Categorias: infra, banco, autenticação, segurança, catálogo, carrinho, cupom, frete, pedido, concorrência, pagamento, admin, mensagens, notificações, avaliações, CMS, performance.
- Cada item reporta tempo, endpoint, mensagem, `requestId` e stack trace (**oculto em produção**).
- `GET /api/admin/lab/runs` mostra o histórico com resumo; `GET /api/admin/lab/runs/:id` o detalhe.

Verificações de destaque: tabelas obrigatórias presentes, índices e FKs, **rollback de transação**, token inválido → 401, cliente → 403 em rotas de admin, **cliente não consegue alterar preço**, **concorrência no último item**, **webhook duplicado**, **painel nunca expõe senha**, latência p95 das listagens.

---

## Teste de carga

```bash
cd backend
API_URL=http://127.0.0.1:3333 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/load-test.mjs
```

Cria produtos ativos, mede 4 cenários em concorrência crescente (10 → 250), gera `var/load-report.json` e **remove os produtos criados**.

> Nunca rode contra produção: o script cria e apaga registros.

Resultados em [`PERFORMANCE.md`](PERFORMANCE.md).

---

## Escrevendo um teste novo

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createClient, db, makeApp, resetDatabase } from "../helpers";

let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); (await db()).$disconnect(); });
beforeEach(async () => { await resetDatabase(); });

describe("minha regra", () => {
  it("descreve o comportamento esperado", async () => {
    const client = await createClient(app);

    const response = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: "…", quantity: 1 },
    });

    expect(response.status).toBe(200);
  });
});
```

Boas práticas adotadas:

1. **`resetDatabase()` no `beforeEach`** — cada teste começa de um banco limpo.
2. **Teste o comportamento, não a implementação** — asserte status HTTP e efeito observável no banco.
3. **Sempre verifique o lado do efeito colateral** — além do status, confirme estoque/pedido/notificação.
4. **Teste o caminho de recusa** — 401, 403, 404, 409, 422 merecem tanta atenção quanto o sucesso.
5. **Segurança é asserção** — tente expor senha, mudar preço, acessar dado alheio.
6. **Nomes em português, descritivos**, no formato "faz X quando Y".
