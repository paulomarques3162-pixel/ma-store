# Performance — MA STORE

Relatório do teste de carga (`backend/scripts/load-test.mjs`), executado contra a API real com PostgreSQL local.

---

## Ambiente medido

| Item | Valor |
|---|---|
| CPU | 2 vCPU |
| Memória | ~2 GB |
| SO | Linux (Debian 12, container) |
| Node | v24.21.0 |
| PostgreSQL | 15.19 (mesma máquina) |
| Data | 2026-09-18 |
| Catálogo | 120 produtos ativos |
| Duração por cenário | 6 s |
| Rate limit | elevado **apenas para o teste** (em produção: 120/min) |

> ⚠️ Estes números vêm de uma instância **mínima** (2 vCPU, banco na mesma máquina). Uma instância maior no Render tende a apresentar resultados melhores; o valor aqui é servir de **linha de base** e provar que não há erros sob concorrência.

---

## Resultados

### Listagem de produtos (paginada) — `GET /api/products?perPage=20`

| Simultâneos | RPS | p50 | p95 | p99 | 4xx | 5xx |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 507,2 | 18 ms | 32 ms | 40 ms | 0 | 0 |
| 25 | 560,3 | 43 ms | 62 ms | 75 ms | 0 | 0 |
| 50 | 583,0 | 84 ms | 112 ms | 133 ms | 0 | 0 |
| 100 | 631,7 | 153 ms | 193 ms | 226 ms | 0 | 0 |
| 250 | 611,8 | 396 ms | 481 ms | 506 ms | 0 | 0 |

### Busca com filtro + ordenação — `GET /api/products?search=Perfume&sort=price_asc&inStock=true`

| Simultâneos | RPS | p50 | p95 | p99 | 4xx | 5xx |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 438,6 | 22 ms | 29 ms | 40 ms | 0 | 0 |
| 25 | 409,8 | 61 ms | 77 ms | 89 ms | 0 | 0 |
| 50 | 424,7 | 114 ms | 144 ms | 166 ms | 0 | 0 |
| 100 | 428,2 | 236 ms | 274 ms | 281 ms | 0 | 0 |
| 250 | 410,0 | 596 ms | 706 ms | 724 ms | 0 | 0 |

### Categorias (cacheável) — `GET /api/categories`

| Simultâneos | RPS | p50 | p95 | p99 | 4xx | 5xx |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.425,3 | 6 ms | 12 ms | 21 ms | 0 | 0 |
| 25 | 1.596,0 | 14 ms | 29 ms | 43 ms | 0 | 0 |
| 50 | 1.672,1 | 28 ms | 50 ms | 62 ms | 0 | 0 |
| 100 | 1.808,8 | 53 ms | 87 ms | 109 ms | 0 | 0 |
| 250 | 1.707,6 | 139 ms | 192 ms | 244 ms | 0 | 0 |

### Health check — `GET /api/health`

| Simultâneos | RPS | p50 | p95 | p99 | 4xx | 5xx |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 2.292,0 | 4 ms | 9 ms | 17 ms | 0 | 0 |
| 25 | 2.688,1 | 8 ms | 19 ms | 33 ms | 0 | 0 |
| 50 | 3.092,7 | 14 ms | 33 ms | 47 ms | 0 | 0 |
| 100 | 3.514,6 | 26 ms | 53 ms | 63 ms | 0 | 0 |
| 250 | 3.319,0 | 71 ms | 117 ms | 137 ms | 0 | 0 |

### Leitura dos números

- **Zero erros 5xx e zero timeouts** em todos os cenários — inclusive com 250 conexões simultâneas.
- A latência cresce de forma **linear e previsível** com a concorrência (fila), sem degradação abrupta. O `p99` acompanha o `p95` de perto: não há "cauda longa" de requisições travadas.
- **Vazão estável**: a listagem sustenta ~600 RPS e a busca ~420 RPS nesta máquina. As rotas sem acesso ao banco (health) chegam a 3.500 RPS, confirmando que o *overhead* do framework é baixo e o gargalo está no banco — como esperado.
- Categorias são ~3× mais rápidas que a listagem de produtos porque a resposta é menor e pode ser cacheada.

**Limite honesto do teste:** medições acima de ~250 conexões simultâneas em 2 vCPU medem a fila do sistema operacional, não a aplicação. Para validar 500+ usuários reais, rode o script contra um ambiente de staging com hardware equivalente ao de produção.

---

## Otimizações aplicadas

| Otimização | Onde | Efeito |
|---|---|---|
| **Índices GIN + `pg_trgm`** em nome/SKU/descrição | migration `performance_indexes` | Busca deixa de fazer *sequential scan* conforme o catálogo cresce |
| **Índices compostos** `(categoryId, active, createdAt DESC)` | idem | Filtro + ordenação resolvidos pelo índice |
| **Índices parciais** (oferta, estoque baixo, não lidas) | idem | Índices menores e mais rápidos para consultas específicas |
| **Paginação obrigatória** com teto de 100 | `lib/serialize.ts` | Respostas previsíveis; nenhuma listagem devolve o catálogo inteiro |
| **`select` explícito** em toda listagem | todos os serviços | Menos bytes trafegados e menos trabalho no banco |
| **Sem N+1** — agregações com `groupBy`/`count`/`aggregate` | dashboard, usuários, moderação | Uma consulta por métrica em vez de uma por linha |
| **`Promise.all`** para consultas independentes | listagens e dashboard | Latência = a consulta mais lenta, não a soma |
| **`Cache-Control` público** em vitrine | produtos, categorias, marcas, banners, tema | `stale-while-revalidate` reduz o custo na borda |
| **Sem cache em dado crítico** | checkout, estoque, cupom, pagamento | Impossível vender com preço/estoque velho |
| **Reserva de estoque atômica em SQL** | `order.service.ts` | Uma ida ao banco resolve a corrida; sem *lock* pessimista longo |
| **`bodyLimit` 2 MB** | `app.ts` | Evita payload abusivo consumindo memória |
| **Pool do Prisma** dimensionado | `db.ts` | Conexões reaproveitadas; sem *overhead* de conexão por requisição |

## Práticas proibidas (revisadas de propósito)

Conforme a regra nº 36 do projeto, **não** existe:

- chamada de API repetida em `useEffect` ou polling agressivo;
- carregamento de todo o catálogo de uma vez;
- consulta sem índice em coluna usada para filtro/busca;
- consulta repetida para o mesmo dado dentro da mesma requisição;
- requisição duplicada por duplo clique (resolvido com `X-Idempotency-Key`);
- processamento pesado no frontend (o backend entrega o dado pronto).

---

## Como repetir

```bash
cd backend
npm run build
npm start &                      # ou: npm run dev
API_URL=http://127.0.0.1:3333 \
ADMIN_EMAIL=admin@teste.local \
ADMIN_PASSWORD=Teste@Admin123 \
LOAD_CONCURRENCY=10,25,50,100,250 \
LOAD_DURATION_MS=6000 \
node scripts/load-test.mjs
```

O relatório completo (incluindo dados da máquina) é gravado em `backend/var/load-report.json`.

> **Nunca** rode contra produção: o script cria e remove registros.
