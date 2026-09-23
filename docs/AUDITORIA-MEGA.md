# MA STORE — Auditoria e correções (Mega-prompt)

Data: 2026-09-23 · Base: `ma-store-guest-checkout`
Regras respeitadas: **não resetar Neon**, **nenhum dado apagado**, **nenhum deploy/push**, **nenhum secret exposto**, **não inventar dados**.

Legenda de status: ✅ corrigido nesta entrega · 🟡 parcial / depende de credencial · 🔴 pendência (sem acesso).

---

## 1. AUDITORIA GERAL

| Item | Situação |
|---|---|
| Framework | React 18 + Vite 6 (SPA) / Fastify 5 + Prisma 6 + PostgreSQL (Neon) |
| Roteamento frontend | React Router 6 (client-side) |
| Estado/dados | Zustand + TanStack Query 5 |
| Autenticação | JWT HS256 (admin). Comprador: **não existe mais** |
| Deploy | Render (API) + Vercel (SPA) |
| Migrations | Incrementais, idempotentes |

**Achados**
- ✅ Checkout 100% guest (não exige conta em nenhum ponto).
- ✅ Paginação real no catálogo público e no admin (`skip/take` + `count`).
- ✅ `select` enxuto (`publicProductSelect`) evita payload gigante.
- ✅ `Cache-Control` de borda nas rotas públicas de produto.
- ✅ Estoque validado no backend dentro de transação.
- 🔴 Não é possível auditar os dados reais do Neon (sem acesso ao banco de produção). Auditoria de catálogo/preços/estoque no banco ficou pendente; usei o site oficial como referência pública.

## 2. CATÁLOGO

**Referência oficial (mastoree.com.br, Nuvemshop)** — estrutura pública real:
- Perfumes: Femininos, Masculinos, Decants femininos, Decants masculinos, Infantil, Brand Collection
- Body Splash: Victoria's Secret
- Creme: Victoria's Secret, Body cream, Body lotion
- Marcas citadas: Lattafa, Al Wataniah, Orientica, Armaf, Afnan (Brand Collection), Victoria's Secret
- Amostras de preço reais observadas: Asad Bourbon 100ml — **R$ 380,00**; decants — **R$ 42,50 / R$ 85,00**; kits — **R$ 680,00 / R$ 760,00**; "Frete grátis" exibido em produto.

**Achados no código**
- ✅ Produto inativo nunca aparece na vitrine (`buildPublicWhere` força `active: true`).
- ✅ Busca por nome/SKU/descrição/marca/categoria.
- ✅ **Importador seguro implementado**: `scripts/import-catalog.ts` + `src/services/catalog-import.ts` + scripts `catalog:validate` / `catalog:import`. Dry-run por padrão, detecta novos/atualizados/duplicados/faltantes/preço divergente, **nunca apaga** e cria produtos novos **inativos** para revisão. Fonte de referência real gerada do site oficial (`catalog/mastoree-listing.json`, 42 produtos).
- 🔴 Comparação preço-do-banco × preço-oficial depende de acesso ao Neon (importador pronto, execução pendente).

## 3. PREÇOS
- ✅ Nenhum preço é aceito do frontend na criação do pedido: o servidor relê `product.price`.
- ✅ `comparePrice` usado como preço "de" (desconto calculado no frontend `discountPercent`).
- 🟡 Validação "promocional > original" não bloqueia cadastro (só exibe). Recomendação: validação no schema do admin.

## 4. ESTOQUE
- ✅ `createGuestPedido` faz `UPDATE ... WHERE stock >= qty` atômico dentro de transação → impede estoque negativo e venda acima do disponível.
- ✅ Carrinho mostra disponibilidade por item.
- ✅ Itens indisponíveis bloqueiam o "Comprar".

## 5. IMAGENS
- ✅ Placeholder elegante quando não há imagem; `onError` troca URL quebrada pelo placeholder.
- ✅ `loading="lazy"` + `decoding="async"` (e `eager` na imagem principal).
- ✅ **NOVO — enquadramento (focal point)**: `product_images.focal_point`, exposto na API e renderizado como `object-position`. Admin agora permite: adicionar, remover, reordenar (subir/descer), **definir capa**, escolher enquadramento (Centro/Topo/Base/Esquerda/Direita + presets) e ver preview.
- ✅ **Upload binário implementado**: `POST /api/admin/uploads` (multipart, ADMIN) com validação por **magic bytes** (JPEG/PNG/WEBP/GIF/AVIF), limite de tamanho (`UPLOAD_MAX_MB`) e dimensões (100–6000 px). Frontend: input de arquivo no formulário de produto com preview.
- 🟡 Otimização WebP/AVIF automática, `srcset` e CDN ainda não implementados (dependem de pipeline/CDN externo). Driver atual é `local`; em serverless puro trocar por storage de objetos (mesma interface `saveUpload`).
- ✅ `object-fit: cover` + `object-position` aplicados; `aspect-ratio` evita CLS.

## 6. PAGAMENTOS
- ✅ Schema tem idempotência e status de pagamento (`Payment`, `PaymentAttempt`, `WebhookEvent` com `@@unique([provider,eventId])`).
- ✅ Confirmação não é aceita apenas por "sucesso no frontend" (arquitetura de webhook).
- 🟡 Provedor atual é `mock` (sandbox). Integração real depende das credenciais do gateway.
- 🔴 Auditoria de estorno/replay/ordem de eventos exige ambiente com gateway real.

## 7. FRETE
- ✅ `POST /api/shipping` calcula por peso (peso unitário × qtd + 100 g) — nunca pelo número de itens.
- ✅ Retirada (grátis), Motoboy Pirassununga R$ 10 (CEP `1363`), Correios PAC/SEDEX (quando com token), Jetlog, Pegaki.
- ✅ Correios pago direto à transportadora **não** entra no total da loja (`frete_pago_direto`).
- ✅ Falha dos Correios não quebra o checkout (aviso + `retryable`).
- 🔴 Emissão de etiqueta oficial dos Correios: não implementada (depende de credencial; não fingimos emissão).

## 8. CHECKOUT
- ✅ Fluxo Dados → Endereço → Frete → Revisão, sem cadastro.
- ✅ Frete re-cotado e re-validado no servidor na criação do pedido.
- ✅ Responsivo (`auto-fit/minmax`), sem overflow em telas estreitas.

## 9. PEDIDOS
- ✅ `POST /api/pedidos` ignora `id`, `token`, `status`, preço, peso e total enviados pelo cliente.
- ✅ Token de rastreio com 32 bytes aleatórios.
- ✅ Transação única (estoque + pedido).
- ✅ Correios no pedido **não** somam ao total da loja.

## 10. RASTREAMENTO
- ✅ `GET /api/rastreio/:token` público, query parametrizada.
- ✅ Timeline dos 5 estados (status desconhecido não quebra).
- ✅ **NOVO**: página `/rastreio` (consulta por código) — acessível sem conta.

## 11. ADMIN
- ✅ Acesso discreto: já era `/admin/login`, sem botão público.
- ✅ Removido o **Usuários** da navegação, as rotas e também as **páginas e endpoints** (`user.admin.routes.ts` excluído).
- ✅ Alterações refletem sem reload (invalidation do React Query + navegação).

## 12. USUÁRIOS
- ✅ **Área pública de conta removida** do header, menu mobile e barra inferior.
- ✅ `/login`, `/cadastro`, `/minha-conta`, `/notificacoes` → redirecionam para a home; `/meus-pedidos` → `/rastreio`; `/mensagens` e `/feedback` → `/contato`; `/favoritos` → `/produtos`.
- ✅ Favoritos removidos dos cards/produto (exigiam conta).
- ✅ Páginas públicas de conta **excluídas** (`AccountPage`, `OrdersPage`, `FavoritesPage`, `MessagesPage`, `NotificationsPage`, `FeedbackPage`, `LoginPage`, `RegisterPage`).
- ✅ Autenticação **ADMIN mantida** e protegida.

## 13. PERFORMANCE
- ✅ Paginação no catálogo e no admin; `select` de campos; `Cache-Control`; React Query com `staleTime`; sabe-se que existe skeleton.
- ✅ Imagens com lazy/decoding.
- 🟡 Não foram feitos benchmarks. Medições reais dependem de executar contra o Neon (pendência). O bundle do frontend já separa vendor (react 158 kB, query 47 kB, index 85 kB) — candidato a análise de code-splitting adicional.
- ⚠️ `products/facets` e `content/theme` são chamados por página; cache existente mitiga.

## 14. SEGURANÇA
- ✅ Helmet, CORS restrito, rate limit, JWT admin, Zod, queries parametrizadas (Prisma), erro sem stack trace, redação de logs.
- ✅ Nenhum secret no frontend (só `VITE_*`).
- ✅ Nenhum secret hardcoded no backend; tudo via environment.

## 15. BANCO
- ✅ Nenhum `reset`, `DROP`, `TRUNCATE` ou apagamento.
- ✅ Migrations incrementais e idempotentes (`IF NOT EXISTS`).
- ✅ Novas migrations: `pedidos` (guest), `focal_point`.
- 🔴 Backup/índices do Neon não inspecionados (sem acesso).

## 16. INFRAESTRUTURA
- ✅ `vercel.json` e build inalterados no essencial.
- ✅ Backend serverless-friendly (sem filesystem/estado global persistente).
- 🟡 Nada foi deployado (conforme regra).

## 17. COMPARTILHAMENTO
- ✅ **NOVO** `lib/share.ts`: Web Share API + fallback "copiar link" com confirmação.
- ✅ Compartilhar produto (nome, preço, URL, imagem via Web Share quando suportado).
- ✅ Compartilhar loja (header + rodapé).

## 18. MOBILE
- ✅ Checkout com grids responsivos; menus adaptados; barra inferior atualizada (Rastreio).
- 🟡 Falta teste em dispositivo real (320–430 px). Recomenda-se revisão visual final.

## 19. TESTES (executados)
| Suíte | Resultado |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Backend `tsup` build | ✅ |
| Backend unit (guest checkout, storage, catalog-import, lib, business-rules) | ✅ 45/45 |
| Frontend `tsc` | ✅ |
| Frontend `vite build` | ✅ |
| Frontend `vitest` | ✅ 53/53 |

## 20. PENDÊNCIAS
1. **Acesso ao Neon** para rodar o importador e auditar catálogo/preços/estoque reais (nada foi inventado).
2. **Correios**: `CORREIOS_TOKEN` + `CORREIOS_ORIGEM_CEP` para ativar PAC/SEDEX reais; etiqueta oficial depende da API.
3. **Jetlog/Pegaki**: credenciais ou valor fixo por env.
4. **Pagamentos**: credenciais do gateway e auditoria de webhook em produção (a suíte de integração exige Postgres, indisponível neste sandbox).
5. **Imagens**: pipeline de otimização/CDN (upload já funciona).
6. **Deploy**: aguardando autorização (nada foi publicado).

---

# Entrega 3 — Frete real + Pagamentos + PIX + Admin

## Implementado
- **PIX BR Code real (EMV/BACEN)**: `services/pix.ts` (CRC16 + montagem do payload) com chave/titular/cidade lidos do **CMS privado** (nunca expostos ao público). Gerado na criação do pedido Guest, exibido no rastreamento (QR + copia e cola).
- **Status de integrações (ADMIN)**: `GET /api/admin/diagnostics/integrations` e `POST /api/admin/diagnostics/pix/preview` — mostram o que está configurado e o que falta, sem inventar resultado.
- **Meios de pagamento públicos**: `GET /api/payment-methods` informa o que está habilitado/configurado (sem segredos).
- **Checkout**: seleção de forma de pagamento (PIX quando habilitado+configurado; senão "combinar com a loja").
- **Rastreamento**: bloco de pagamento com QR/copia e cola, status "Pendente" e aviso de que a confirmação é manual/webhook.
- **Botão Admin discreto abaixo de Compartilhar** (rodapé + menu mobile) apontando para `/admin`.
- **Pedido Guest** ganhou `metodo_pagamento`, `pagamento_status`, `pagamento_payload`, `pagamento_expira_em` (migration idempotente).

## Regras respeitadas
- Nenhum pagamento é marcado como pago sem confirmação real (PIX é estático; confirmação manual/webhook).
- Correios/Jetlog/Pegaki sem credencial **não aparecem** — nada de valor inventado.
- Nenhum secret no frontend; chave PIX só no servidor.

## Testes
- Backend: `tsc` ✅ · build ✅ · **48/48** unit tests ✅ (inclui PIX/CRC16).
- Frontend: `tsc` ✅ · build ✅ · **53/53** tests ✅.

## Pendências (externas)
- Correios real (token/CEP origem), Jetlog/Pegaki (credenciais), cartão/boleto (provedor),
  webhook real (banco/provedor), Neon (importador/auditoria de dados) e deploy (aguardando autorização).
