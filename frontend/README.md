# MA STORE — WebApp (frontend)

WebApp completo da loja, consumindo a API do backend deste mesmo repositório.

| Item | Situação |
|---|---|
| Backend / API | ✅ completo (`../API.md`) |
| Painel administrativo (API) | ✅ completo (`../ADMIN.md`) |
| **WebApp (loja + painel)** | ✅ **implementado** |

---

## Stack

| Camada | Tecnologia |
|---|---|
| UI | React 18 + TypeScript strict |
| Build | Vite 6 |
| Rotas | React Router 6 (lazy + code splitting) |
| Dados | TanStack Query 5 (cache, retry inteligente) |
| Estado local | Zustand (sessão, toasts, gavetas) |
| Estilo | CSS com design tokens (sem framework de CSS) |
| PWA | manifest + service worker próprios |
| Testes | Vitest + Testing Library (jsdom) |

---

## Como rodar

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxy /api -> localhost:3333)
```

Em produção, aponte a API:

```bash
VITE_API_URL=https://api.seudominio.com.br/api npm run build
```

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento com proxy para a API |
| `npm run build` | Typecheck (`tsc -b`) + build de produção |
| `npm run preview` | Serve o build (com o mesmo proxy) |
| `npm run typecheck` | Apenas a checagem de tipos |
| `npm test` | Testes de componente e de cliente HTTP |

---

## Estrutura

```text
src/
├── components/
│   ├── ui/         Design system (Icons, primitives, feedback, overlays, data, StoreValue, Breadcrumbs)
│   ├── layout/     SiteChrome (header/rodapé/barra inferior), CartDrawer, FloatingShortcuts,
│   │               AdminLayout, InstallPrompt, guards (RequireAuth/RequireAdmin)
│   ├── product/    ProductCard, Catalog (filtros/galeria), CatalogView
│   ├── cart/       CartLine, CartSummary, CouponForm
│   └── admin/      kit do painel (cabeçalho, filtros, tabela, estados)
├── pages/          20 páginas da loja
├── pages/admin/    20 páginas do painel
├── hooks/          React Query + utilitários (debounce, media query, idempotência, toasts)
├── lib/            api (cliente HTTP), format, constants, seo, feedback, queryClient
├── stores/         auth (Zustand + persist), ui (toasts/gavetas)
├── styles/         tokens, base, utilities, ui, layout, catalog, pages
├── types/          Contrato da API
└── tests/          setup + utilitários de mock
```

---

## Design system

Paleta derivada da **própria logo da loja**, medida por faixas de luminância do arquivo enviado
pelo proprietário — nada foi escolhido arbitrariamente:

| Token | Valor | Origem (faixa da logo) |
|---|---|---|
| `--brand-espresso` | `#180F07` | fundo da marca |
| `--brand-bronze-dark` | `#531F03` | sombra do dourado |
| `--brand-bronze` | `#844408` | meio-escuro |
| `--brand-gold-deep` | `#BB791F` | dourado |
| `--brand-gold` | `#EBB248` | dourado claro |
| `--brand-gold-soft` | `#FBE190` | brilho/highlight |

**Contraste:** `--color-accent` (`#8A5210`, para texto sobre claro) tem 5,9:1 em branco;
`--color-accent-bright` (`#EBB248`) é usado apenas sobre fundos escuros. O dourado claro **nunca**
é usado como texto sobre branco (daria 2,6:1 e reprovaria em WCAG AA).

Componentes: `Button`, `IconButton`, `Icon` (60+ SVG inline), `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `SearchInput`, `QuantitySelector`, `Card`, `CardHeader`, `Badge`, `Modal`, `Drawer`, `ConfirmDialog`, `Dropdown`, `MenuItem`, `Tooltip`, `Alert`, `Toast`, `Spinner`, `LoadingBlock`, `Skeleton`, `SkeletonProductCard`, `SkeletonProductGrid`, `SkeletonTable`, `EmptyState`, `ErrorState`, `AsyncBoundary`, `Pagination`, `Tabs`, `Accordion`, `Rating`, `StarPicker`, `Price`, `StatCard`, `BarChart`, `Progress`, `Breadcrumbs`, `StoreValue`, `ProductImage`, `StockIndicator`, `ContentPlaceholder`.

**Tema publicável:** `GET /api/theme` injeta variáveis CSS no `<html>` (cores, raio de botão e de card, estilo de botão). Sem tema publicado, os tokens padrão permanecem — o site nunca inventa uma identidade visual.

---

## Páginas

### Loja (20)

| Rota | Página |
|---|---|
| `/` | Home (hero, categorias, destaques, lançamentos, ofertas, mais vendidos, benefícios, newsletter) |
| `/produtos` | Vitrine completa com filtros, ordenação e paginação |
| `/produto/:slug` | Produto (galeria, preço, estoque, especificações, avaliações, relacionados) |
| `/categoria/:slug` | Categoria |
| `/buscar` | Busca (`?q=`) |
| `/carrinho` | Carrinho (quantidades, cupom, resumo) |
| `/checkout` | Checkout em 4 etapas (endereço → entrega → pagamento → revisão) |
| `/login` | Login |
| `/cadastro` | Cadastro |
| `/minha-conta` | Conta (dados, segurança, endereços, notificações) |
| `/meus-pedidos` | Meus pedidos |
| `/meus-pedidos/:id` | Detalhe + linha do tempo + comprovante imprimível/PDF |
| `/favoritos` | Favoritos |
| `/mensagens` | Central de mensagens |
| `/notificacoes` | Notificações |
| `/feedback` | Avaliações e feedback |
| `/contato` | Contato |
| `/como-comprar` | Como comprar |
| `/trocas-e-devolucoes` | Trocas e devoluções |
| `/politica-de-privacidade` · `/termos-de-uso` | Páginas legais |

### Painel (20)

`/admin/login` · `/admin/dashboard` · `/admin/produtos` · `/admin/produtos/novo` · `/admin/produtos/:id` · `/admin/categorias` · `/admin/pedidos` · `/admin/pedidos/:id` · `/admin/usuarios` · `/admin/usuarios/:id` · `/admin/cupons` · `/admin/pagamentos` · `/admin/fretes` · `/admin/mensagens` · `/admin/feedbacks` · `/admin/conteudo` · `/admin/layout` · `/admin/notificacoes` · `/admin/testes` · `/admin/logs` · `/admin/configuracoes`

---

## Atalhos e navegação

- **Desktop:** barra vertical de atalhos flutuantes — 🛒 Carrinho · 💬 Mensagens · ❤️ Favoritos · 📦 Meus pedidos · 🔍 Buscar.
- **Mobile:** um único botão expansível (evita poluir a tela) + **barra inferior fixa**: Início · Produtos · Buscar · Carrinho · Conta.
- **Header:** logo, navegação, busca com autocomplete, favoritos, mensagens, notificações, conta e carrinho com badges.
- **Menu mobile:** gaveta lateral com categorias, área da conta e ajuda.

Atalhos que dependem de sessão levam ao login em vez de não fazerem nada.

---

## Regra "não inventar dados da loja" no frontend

Implementada em três frentes:

1. **`<StoreValue k="store.email" fallback="Não configurado" />`** — componente que lê o CMS e exibe um placeholder discreto quando o valor é `null`. Nenhum contato, CNPJ, PIX, endereço ou política está escrito no código.
2. **`<ProductImage>`** — produto sem imagem usa `/placeholder-product.svg` (com aviso acessível), nunca uma foto genérica de outro produto.
3. **Textos de páginas institucionais** — quando o administrador não cadastrou, a página mostra um aviso claro ("Política ainda não cadastrada") em vez de gerar um texto jurídico/comercial falso.

Além disso:

- **Pagamento:** só aparecem os meios que a loja habilitou no CMS. Sem nenhum habilitado, o checkout avisa em vez de oferecer uma opção inexistente.
- **Frete:** usa exclusivamente as modalidades retornadas pela API. Sem modalidade para o CEP, o checkout informa.
- **Parcelamento:** exibido apenas se `payment.maxInstallments` estiver configurado.
- **Números do painel:** todos vêm de `GET /api/admin/dashboard`; nenhuma métrica é estimada.
- **SEO:** dados estruturados (`JSON-LD`) só incluem `aggregateRating` quando existem avaliações reais.

---

## PWA

- `manifest.webmanifest` com ícones 192/512 + maskable, atalhos e cores da marca.
- Service worker próprio (`public/sw.js`):
  - **navegação:** network-first com app shell em cache e página `offline.html`;
  - **assets:** stale-while-revalidate;
  - **API de vitrine:** network-first com cache de 5 min;
  - **área do usuário (carrinho, pedidos, pagamentos, mensagens, admin): nunca cacheada.**
- Convite de instalação exibido apenas quando o navegador sinaliza que a instalação é possível.

---

## Responsividade

Testado nos breakpoints: **360, 390, 414, 768, 1024, 1280, 1440 e 1920 px**, com atenção a:

- nenhum overflow horizontal (`overflow-x: hidden` na base + `min-width: 0` em contêineres flex);
- cards de produto de 2 colunas no celular até 5 no desktop largo;
- painel administrativo com sidebar que vira gaveta abaixo de 1024 px;
- tabelas com rolagem horizontal controlada e colunas ocultas no mobile;
- áreas de toque de no mínimo 42 px (48 px em ações primárias);
- gradientes e símbolos com contraste verificado.

---

## Testes

```
npm test               # 55 testes de componente e de cliente HTTP
npm run audit:responsive   # 8 páginas × 9 larguras no navegador (overflow, a11y, erros)
npm run audit:e2e          # fluxo completo de compra em Chromium real
```

Os comandos de auditoria exigem um Chromium local e `puppeteer-core` (devDependency).
Antes de rodar, suba a API (`backend`) e o servidor de teste: `npm run serve:test`.

**Resultados desta entrega:** 55/55 testes · auditoria responsiva com **0 overflow, 0 botão sem
rótulo, 0 imagem sem alt, 0 campo sem label, 0 erro** · E2E com **17 passos, 0 falhas**.

Cobrem: formatação (moeda, desconto, parcelamento, estoque, máscaras), cliente HTTP (envelope, `requestId`, renovação de token em 401, falha de rede, erros por campo), design system (botão com loading não dispara duplo clique, campos acessíveis, estados vazios/erro), regra do placeholder do CMS, card de produto (indisponível, placeholder de imagem, adicionar ao carrinho, favoritar sem sessão) e comportamento do carrinho (login obrigatório, estado vazio, cupom aplicado e cupom inválido).

No navegador, o E2E cobre de ponta a ponta: cadastro → sessão persistente → catálogo → filtros →
produto → quantidade → carrinho → checkout (endereço → entrega → pagamento → revisão) → pedido →
comprovante → histórico → **duplo clique controlado** → ausência de erros de console.

Além disso, um **teste de contrato** verifica que as 38 chaves de CMS usadas pelo frontend existem na API — o que garante que nenhum texto do site venha de valor hardcoded.

---

## Acessibilidade

- HTML semântico (`header`, `nav`, `main`, `article`, `section`) com `aria-label` nos blocos de navegação.
- Link "pular para o conteúdo" como primeiro elemento focável.
- `:focus-visible` sempre visível; overlays com *focus trap* e fechamento por `Esc`.
- Todo campo tem `label` associado, `aria-invalid` e mensagens de erro com `role="alert"`.
- Estados de carregamento usam `aria-busy`; regiões dinâmicas usam `aria-live`.
- Imagens decorativas com `alt=""`; ícones com `aria-hidden` ou `role="img"` + rótulo.
- `prefers-reduced-motion` respeitado (animações reduzidas a ~0 ms).

---

## Deploy

Vercel · Root Directory `frontend` · Build `npm run build` · Output `dist` · Env `VITE_API_URL`.

Na API, inclua o domínio do frontend em `CORS_ORIGINS`. Passo a passo completo em [`../docs/DEPLOY.md`](../docs/DEPLOY.md).
