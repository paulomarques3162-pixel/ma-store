# Roadmap — MA STORE

Estado atual e próximas fases. Cada fase é entregável de forma independente.

---

## ✅ Fase 1 — Backend, banco e painel administrativo (concluída)

**Entregue e testado:**

- API REST completa (Fastify 5 + TypeScript strict), 100+ endpoints
- PostgreSQL 15 + Prisma 6, 30 modelos, migrations versionadas + migration de índices de performance
- Autenticação JWT + refresh opaco com rotação e revogação; bcrypt custo 12
- Perfis **CLIENT** e **ADMIN** com autorização por rota
- Catálogo: produtos, categorias (árvore), marcas, imagens, filtros, busca, ordenação, paginação
- Carrinho, favoritos, cupons (todas as regras), frete por CEP/região
- Checkout transacional com reserva atômica de estoque e idempotência
- Pedidos com 8 status, transições validadas, histórico e comprovante
- Pagamentos sandbox/produção com webhooks assinados e idempotentes
- Central de mensagens cliente ↔ admin
- Notificações para cliente e administração
- Avaliações (só após compra entregue) e feedback, com moderação
- CMS: 43 chaves de conteúdo, banners, tema com rascunho/publicação
- Painel administrativo completo (dashboard, CRUDs, moderação, auditoria, logs)
- **Laboratório de testes integrado** (`/api/admin/lab/run`) — 45 verificações
- 127 testes automatizados (unitário, integração, E2E)
- Teste de carga com relatório de percentis
- Documentação: README, API, ADMIN, arquitetura, deploy, testes, performance, segurança
- Docker + Dockerfile de produção; `.env.example`; `.gitignore`

**Evidências:** typecheck limpo · build OK · 127/127 testes · 45/45 no laboratório · 0 erros 5xx sob 250 conexões simultâneas.

---

## ✅ Fase 2 — Frontend / WebApp (concluída)

**Stack entregue:** React 18 + Vite 6 + TypeScript strict + React Router 6 + TanStack Query 5 + Zustand 5 + PWA próprio.

**Evidências:** `tsc -b` sem erros · **55/55 testes** · build com code splitting por rota · contrato de CMS 100% verificado · app servido e validado contra a API real.

Detalhes em [`../frontend/README.md`](../frontend/README.md).

**Implementado:**

| Área | Detalhes |
|---|---|
| Design system | `Button`, `Input`, `Select`, `Modal`, `Card`, `ProductCard`, `Badge`, `Toast`, `Drawer`, `Dropdown`, `Header`, `Footer`, `Sidebar`, `FloatingButton`, `Skeleton`, `Pagination`, `EmptyState`, `ErrorState` |
| Páginas | `/`, `/produtos`, `/produto/:slug`, `/categoria/:slug`, `/buscar`, `/carrinho`, `/checkout`, `/login`, `/cadastro`, `/minha-conta`, `/meus-pedidos`, `/favoritos`, `/mensagens`, `/feedback`, `/contato`, `/como-comprar`, `/trocas-e-devolucoes` |
| Painel | `/admin/login`, `/admin/dashboard`, `/admin/produtos`, `/admin/categorias`, `/admin/pedidos`, `/admin/usuarios`, `/admin/cupons`, `/admin/pagamentos`, `/admin/fretes`, `/admin/mensagens`, `/admin/feedbacks`, `/admin/conteudo`, `/admin/layout`, `/admin/notificacoes`, `/admin/testes`, `/admin/logs`, `/admin/configuracoes` |
| Atalhos flutuantes | 🛒 Carrinho · 💬 Mensagens · ❤️ Favoritos · 📦 Meus pedidos · 🔍 Buscar (expansível no mobile) |
| Mobile | Header simplificado + barra inferior (Início · Produtos · Buscar · Carrinho · Conta) |
| UX | Skeleton loading, estados vazios e de erro, tratamento de loading/sucesso/erro em toda ação, prevenção de duplo clique, acessibilidade (teclado, ARIA, contraste, foco visível) |
| PWA | `manifest.json`, ícones, splash, service worker com cache adequado, instalável |
| Performance | Lazy loading de rotas, code splitting, imagens responsivas (WebP/AVIF), `React.lazy`, debounce na busca, sem polling agressivo |
| SEO | Title/description por página, Open Graph, `sitemap.xml`, `robots.txt`, URLs amigáveis, canonical e dados estruturados **apenas quando houver dados reais** |
| Placeholders | Sem imagem → placeholder elegante; conteúdo `null` → nunca inventar dado da loja |

**Responsividade:** estilos escritos para 360, 390, 414, 768, 1024, 1280, 1440 e 1920 px — sem overflow horizontal, sem elemento cortado, sem texto sobreposto.

**Testes entregues:** 55 testes com Vitest + Testing Library, teste de contrato de CMS,
**17 passos de E2E em Chromium real** (`tests/browser/e2e.mjs`) e **auditoria responsiva de
8 páginas × 9 larguras** (`tests/browser/responsive-audit.mjs`).

**Auditada e corrigida:** veja [`AUDITORIA.md`](AUDITORIA.md) — 14 bugs reais encontrados e
corrigidos, incluindo dois bloqueadores (pacote incompleto e criação duplicada de pedidos).

---

## 🔜 Fase 3 — Produção e operação

| Item | Descrição |
|---|---|
| Gateway real | Integrar PIX + cartão + boleto, com credenciais em variável de ambiente e webhook assinado |
| SMTP | E-mail transacional: confirmação de pedido, pagamento, envio, recuperação de senha |
| Upload de imagens | Storage real (S3/Cloudinary/R2) com redimensionamento e WebP, em vez de apenas URL |
| 2FA | Segundo fator para administradores |
| Entrega | Cálculo real via API da transportadora (Correios/Melhor Envio) |
| Nota fiscal | Emissão de NF-e |
| Observabilidade | Sentry (ou equivalente) + alertas de 5xx, webhook e latência |
| Backups | Rotina automatizada + teste de restauração documentado |
| LGPD | Política de privacidade, exportação e exclusão de dados do titular |
| E-mail marketing | Newsletter (o CMS já tem os textos prontos) |

---

## 🔜 Fase 4 — Escala

- Cache distribuído (Redis) para vitrine e sessões
- Fila para webhooks e e-mails (retry com backoff)
- Réplica de leitura para o catálogo
- CDN para imagens e assets estáticos
- Rate limiting distribuído
- APM e tracing distribuído
- Teste de carga no ambiente de produção-equivalente (250 → 500+ simultâneos)

---

## Melhorias técnicas mapeadas

| Item | Prioridade | Nota |
|---|---|---|
| Substituir `bcryptjs` por `argon2id` | Média | Argon2 é o padrão atual para hashing de senha; bcrypt custo 12 é seguro e sem dependência nativa |
| Verificação de e-mail no cadastro | Média | Reduz contas falsas |
| Busca full-text (`tsvector`) | Baixa | `pg_trgm` já cobre bem; `tsvector` melhora relevância |
| Histórico de preço por produto | Baixa | Útil para relatórios |
| Relatórios exportáveis (CSV/PDF) | Média | Vendas, estoque, clientes |
| Cupom com frete grátis dedicado | Baixa | Hoje existe via `appliesToShipping` |
| Carrinho de visitante mesclado no login | Média | Hoje o carrinho exige conta (decisão de produto) |
| Preferências de notificação | Baixa | Hoje todas as notificações são criadas |

---

## Notas de produto

- **Carrinho exige conta.** Decisão alinhada ao requisito original de que o cliente tenha cadastro antes de comprar. Se a loja quiser carrinho de visitante, é uma mudança de produto — a API já está pronta para receber um `cart` por sessão.
- **Nenhum dado da loja é inventado.** Produtos, preços, contatos, PIX, políticas e imagens vêm sempre do cadastro administrativo. O seed cria apenas itens `[DEMO]` **inativos**.
- **Frete nunca é estimado.** Sem modalidade ativa atendendo o CEP, o checkout informa em vez de cobrar um valor fictício.
