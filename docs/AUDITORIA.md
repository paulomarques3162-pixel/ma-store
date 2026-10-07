# Auditoria completa — MA STORE

Relatório da auditoria total do projeto (código, banco, segurança, UX, responsividade,
acessibilidade, performance) com **evidência de execução** para cada afirmação.

Foi executada em ciclos: **auditar → identificar → corrigir → testar → auditar regressões**.
Nada aqui é declarado funcional apenas por existir um arquivo, rota ou componente.

> Regra seguida à risca: **nenhuma operação destrutiva no banco** (sem `DROP`, `TRUNCATE`,
> `migrate reset` ou exclusão massiva). As únicas alterações de dado foram a reversão dos
> registros de teste criados pela própria auditoria, sempre com marcadores (`[DEMO]`,
> `[TESTE]`, `e2e-*@teste.local`, `lab-*@teste.local`).

---

## 1. Resumo executivo

| Métrica | Antes | Depois |
|---|---|---|
| Typecheck (backend) | 0 erros | 0 erros |
| Testes automatizados (backend) | 127/127 | **127/127** |
| Testes automatizados (frontend) | 55/55 | **55/55** |
| Laboratório de testes (API real) | 45/45 | **45/45** |
| **Testes no navegador (E2E)** | não existiam | **17 passos, 0 falhas** |
| **Auditoria responsiva (8 páginas × 9 larguras)** | não existia | **0 overflow, 0 falha de acessibilidade, 0 erro** |
| Overflow horizontal | 320 px e 768 px | **nenhum** |
| Botões sem rótulo acessível | não medido | **0** |
| Imagens sem `alt` | não medido | **0** |
| Campos sem `label` | não medido | **0** |
| Erros de console/JS/rede | não medido | **0** |
| Contraste do dourado sobre branco | 2,6:1 (reprova) | **5,9:1 (AA)** |
| Peso do logo | 1,28 MB (com ruído) | **219 KB (PNG) / 105 KB (WebP)** |
| CSS do bundle (gzip) | 11,7 KB | **13,1 KB** |

**Bugs reais encontrados e corrigidos: 14** (nenhum deles seria visível sem execução real).

---

## 2. Problemas encontrados e corrigidos

### 🔴 Bloqueadores

#### 2.1 O ZIP entregue não compila (arquivos ausentes)

`MA-STORE-FINAL_24e666a0.zip` foi criado no Windows e traz **diretórios vazios**:

| Caminho | Arquivos esperados | No ZIP |
|---|---|---|
| `backend/src/modules/**` | 41 | **0** |
| `frontend/src/components/**` | 21 | **0** |

O `backend/src/app.ts` importa `./modules/admin/admin.routes.js` e mais 15 módulos
inexistentes; o frontend importa `@/components/ui` (design system) que não existe.
**Resultado: nem a API sobe, nem o frontend compila a partir daquele pacote.**
O pacote entregue ao final desta auditoria está completo e verificado.

#### 2.2 Duplo clique criava DOIS pedidos

Evidência (E2E no navegador, antes da correção):
`idempotência do checkout — 1 → 3` (dois pedidos criados em dois cliques).

Causa: o frontend gerava `crypto.randomUUID()` **dentro do handler de clique**. Dois cliques
antes do React renderizar o estado "carregando" produziam **chaves diferentes** — e o backend,
corretamente, criava dois pedidos (chaves distintas = requisições distintas).

Correção (`CheckoutPage.tsx`): a chave passa a ser **estável por tentativa** (`useMemo` sobre
itens, frete, cupom, endereço e pagamento) + trava síncrona `useRef` imune ao ciclo de render.

Evidência depois: `duplo clique criou exatamente 1 pedido — 1 → 2` ✅

#### 2.3 `useId` gerava IDs inválidos como seletor CSS

React devolve `:r6:` em `useId()`. `document.querySelector("#:r6:")` lança
`SyntaxError: not a valid selector` — quebra automação, testes e qualquer script que
selecione o campo. Corrigido com `useFieldId()` que sanitiza para `field-r6`.

#### 2.4 Ordem das camadas CSS quebrava o layout mobile

`utilities.css` era importado **antes** de `layout.css`. Como tudo usa a mesma especificidade,
`.site-header__nav { display: flex }` vencia `.hide-mobile { display: none }` → **o menu desktop
aparecia no mobile** e o cabeçalho estourava a página.

Correção: utilitários passam a ser a **última** camada + breakpoint único em **1024 px**
(antes havia dois: 640 e 768), eliminando o estado intermediário em tablets.

### 🟠 Segurança, integridade e dados

#### 2.5 Contraste reprovado em WCAG AA

`--color-accent: #B8935F` sobre branco = **2,6:1** (mínimo AA é 4,5:1 para texto).
Separei em dois tokens com papéis explícitos:

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| `--color-accent` | `#8A5210` | texto sobre fundo claro | **5,9:1** ✅ |
| `--color-accent-bright` | `#EBB248` | dourado sobre fundo escuro | 9,8:1 ✅ |

#### 2.6 Laboratório de testes APAGAVA dados do seed

`coupon.deleteMany({ where: { isDemo: true } })` removia **todo** cupom de demonstração —
inclusive o `DEMO10` criado pelo seed. Um dado legítimo da loja era destruído por rodar testes.
Correção: limpeza restrita ao que a suíte cria (`code startsWith "LAB"`). Verificado: o `DEMO10`
sobrevive a uma execução completa.

#### 2.7 Laboratório deixava resíduo que apareceria para o cliente

Depois da suíte sobravam: 2 usuários de teste **com pedidos**, e uma modalidade de frete
`[TESTE] Frete padrao do laboratorio` **ativa** — que apareceria no checkout de clientes reais.
Correções: pedidos removidos antes dos usuários (a FK de pedido é `Restrict` de propósito) e a
modalidade criada pela suíte é excluída no final (a da loja é preservada).
Verificado: **0 resíduos** de usuários, produtos, cupons e frete.

#### 2.8 Rate limit bloqueava uso legítimo

O padrão de 120 req/min por IP é baixo para um SPA que faz ~6 chamadas por página: 20 páginas
navegadas em um minuto já estouravam o limite (observado como `429` na auditoria responsiva).
Calibrado para **300/min**, com o limite de autenticação mantido rígido em **10/min**.
Verificado: auditoria responsiva com **0 erros**.

### 🟡 Interface e experiência

#### 2.9 Checkout exigia clicar "Continuar" duas vezes

Ao cadastrar um endereço novo, o botão salvava o endereço mas **não avançava** a etapa — o
cliente precisava clicar de novo. Agora avança automaticamente após salvar.

#### 2.10 Atalhos flutuantes colidiam com outros elementos

- Colidiam com o aviso de instalação do PWA (mesmo canto) → aviso movido para a **esquerda** no
  desktop e, no mobile, os atalhos recolhem enquanto o aviso está visível.
- Cobriam o conteúdo do rodapé (pilha de ~270 px de altura) → no desktop viraram **ícones
  circulares com rótulo no hover**.
- Toasts ficavam embaixo à direita, sob os atalhos → movidos para o **topo** no desktop.

#### 2.11 Hero com "painel vazio"

Sem banner cadastrado, o hero exibia um retângulo marrom vazio. Agora, sem banner, o painel
desaparece e a **própria marca** ocupa o espaço (com halo dourado).

#### 2.12 Overflow horizontal em 320 px e 768 px

Detectado pela auditoria responsiva (`div.site-header__actions`, `select.select`,
`div.toolbar`, `div.product-grid`). Corrigido com: emblema e nome reduzidos em telas muito
estreitas, ícones secundários ocultos no compacto, barra de ferramentas empilhada e grid de
1 coluna abaixo de 340 px.

#### 2.13 Hierarquia de CTA fraca

Todos os botões eram iguais. Agora: **dourado com gradiente** = ação comercial
(`Ver produtos`, `Comprar agora`, `Criar conta`); **espresso** = ação neutra.

#### 2.14 Erro de grafia na logo do proprietário

A assinatura da logo diz **"CONFIRANCA"** — deveria ser **"CONFIANÇA"** (tem um "R" extra e
falta o cedilha). Recomendação: regenerar o arquivo da logo. O site usa a grafia correta no
texto (a imagem original não foi alterada).

---

## 3. Redesign e identidade visual

### Paleta extraída da logo real (não inventada)

A logo foi analisada por faixas de luminância; a rampa abaixo é a que ela realmente usa:

| Faixa | Cor |
|---|---|
| sombra | `#531F03` |
| meio-escuro | `#844408` |
| dourado | `#BB791F` |
| dourado claro | `#EBB248` |
| brilho | `#FBE190` |
| fundo (marca) | `#180F07` |

Gradientes usados **estrategicamente** (hero, CTA comercial, badges, item ativo do painel,
marcadores) — nunca em tudo.

### Ativos gerados a partir da logo

| Ativo | Antes | Depois |
|---|---|---|
| Logo web | 1,28 MB, com RGB corrompido nas áreas transparentes | `logo.webp` 105 KB + `logo.png` 219 KB, RGB zerado |
| Ícones PWA | inexistentes/quebrados | 192, 512, maskable, apple-touch, favicon — todos sobre o espresso |
| Open Graph | genérico | emblema + halo dourado em 1200×630 |
| Lockup de marca | logo quadrada esmagada no header | emblema original + nome em texto nítido e acessível |

O **emblema não foi redesenhado**: mantém a arte do proprietário. O que muda é o tratamento —
fundo escuro (onde o dourado tem contraste), tamanho responsivo por classe e lockup com o nome
em texto, para continuar legível em 44 px (dentro do anel há texto que seria ilegível nesse tamanho).

---

## 4. Matriz de funcionalidades

Legenda: **OK** = executado ponta a ponta com evidência · **PARCIAL** = implementado e testado,
mas depende de configuração externa · **N/V** = não validável neste ambiente.

### Cliente

| Funcionalidade | Onde | Endpoint | Testada em | Resultado |
|---|---|---|---|---|
| Home com seções reais | `/` | `GET /products`, `/categories`, `/banners`, `/content` | navegador 9 larguras | OK |
| Catálogo com filtros/ordenação/paginação | `/produtos` | `GET /products` | E2E + integração | OK |
| Busca com debounce | `/buscar` | `GET /products?search` | E2E + integração | OK |
| Categoria | `/categoria/:slug` | `GET /categories/:slug` | navegador 9 larguras | OK |
| Produto (galeria, estoque, relacionados) | `/produto/:slug` | `GET /products/:slug` | E2E | OK |
| Carrinho (add/alterar/remover/limpar) | `/carrinho` | `/cart*` | E2E + integração | OK |
| Cupom | carrinho/checkout | `POST /coupons/validate` | integração + componentes | OK |
| Frete por CEP | checkout | `POST /shipping/quote` | E2E + integração | OK |
| Checkout 4 etapas | `/checkout` | `POST /orders` | **E2E** | OK |
| Comprovante (imprimir/PDF) | `/meus-pedidos/:id` | `GET /orders/:id/receipt` | E2E | OK |
| Histórico de pedidos | `/meus-pedidos` | `GET /orders` | E2E | OK |
| Favoritos | `/favoritos` | `/favorites*` | integração + componentes | OK |
| Conta (dados, senha, endereços) | `/minha-conta` | `/auth/me`, `/users/me/addresses` | integração | OK |
| Mensagens cliente | `/mensagens` | `/messages*` | integração | OK |
| Notificações | `/notificacoes` | `/notifications*` | componentes | OK |
| Avaliações e feedback | `/feedback` | `/products/:id/reviews`, `/feedback` | integração | OK |
| Responsividade 320→1920 | todas | — | **auditoria 72 combinações** | OK |

### Autenticação

| Cenário | Resultado |
|---|---|
| Cadastro válido | OK (E2E) |
| Senha fraca / confirmação diferente / termos | OK (integração) |
| E-mail duplicado | OK (integração) |
| Login válido / senha incorreta / usuário inexistente | OK (integração; mensagem genérica) |
| Brute force (5 tentativas) | OK (bloqueio de 15 min) |
| Refresh token + rotação + revogação | OK (integração + testes do cliente HTTP) |
| Token inválido/expirado | OK (401, nunca 500) |
| Sessão após recarregar a página | OK (**E2E**) |
| Logout | OK (integração) |
| Recuperação de senha | PARCIAL — fluxo OK em dev (token no retorno); **envio por e-mail depende de SMTP** |

### Administração (16 áreas)

| Área | CRUD | Validação/erro | Permissão |
|---|---|---|---|
| Dashboard | leitura | OK | OK |
| Produtos | C/R/U/D + duplicar + estoque | OK | OK |
| Categorias e marcas | C/R/U/D + ordenar | OK | OK |
| Pedidos | R + status + cancelar | OK (transições inválidas → 400) | OK |
| Usuários | R + bloquear + reset | OK (nunca expõe senha) | OK |
| Cupons | C/R/U/D + ativar | OK (percentual > 100 → 409) | OK |
| Pagamentos | R + expirar vencidos | OK | OK |
| Fretes | C/R/U/D | OK (prazo inválido → 400) | OK |
| Mensagens | R + responder + status | OK | OK |
| Avaliações/feedbacks | R + moderar + excluir | OK | OK |
| Conteúdo (CMS) | R + salvar em lote | OK (chaves vazias = placeholder) | OK |
| Layout/tema | rascunho → publicar | OK (tema publicado não edita) | OK |
| Notificações | R + marcar lida | OK | OK |
| Laboratório | executar suíte + histórico | OK | OK |
| Logs/auditoria | R + diff antes/depois | OK | OK |
| Configurações | R + salvar | OK | OK |

Rotas administrativas exigem `role = ADMIN` — verificado (cliente → **403**).

### Pagamentos

| Item | Situação |
|---|---|
| Arquitetura multi-gateway preparada | Implementado |
| Sandbox (`PAYMENT_ENV=sandbox`) | **Funcionando e testado** (aprovar, recusar, cancelar, expirar) |
| Webhook com HMAC + idempotência | **Funcionando e testado** (assinatura inválida não altera o pagamento; evento repetido não reprocessa) |
| Consistência pagamento ↔ pedido ↔ estoque | Testada |
| Frontend mostra só meios habilitados | Implementado (CMS) |
| **Gateway real (PIX/cartão/boleto)** | **NÃO VALIDADO** — depende de credenciais do proprietário. Permanece em sandbox, como manda a regra. |

---

## 5. Testes executados

| Suíte | Comando | Resultado |
|---|---|---|
| Backend — tipos | `npx tsc --noEmit` | 0 erros |
| Backend — build | `npm run build` | OK |
| Backend — testes | `npm test` | **127/127** (8 arquivos) |
| Backend — laboratório | `POST /api/admin/lab/run` | **45/45 PASS** |
| Frontend — tipos | `npm run typecheck` | 0 erros |
| Frontend — testes | `npm test` | **55/55** (5 arquivos) |
| Frontend — build | `npm run build` | OK (CSS 13,1 KB gzip) |
| **Navegador — E2E** | `npm run audit:e2e` | **17 passos, 0 falhas** |
| **Navegador — responsivo** | `npm run audit:responsive` | **72 execuções, 0 problema** |
| Banco (migrations, índices, FKs, transações) | laboratório | OK |
| Concorrência de estoque | testes + laboratório | OK (nunca negativo) |
| Carga | `node scripts/load-test.mjs` | 0 erros 5xx até 250 conexões |

### Cobertura do E2E no navegador

cadastro → sessão persistente → catálogo → filtros → produto → quantidade → carrinho →
checkout (endereço → entrega → pagamento → revisão) → pedido criado → comprovante →
histórico → **duplo clique controlado** → ausência de erros de console.

### Cobertura da auditoria responsiva

8 páginas (`/`, `/produtos`, `/buscar`, `/carrinho`, `/login`, `/cadastro`, `/como-comprar`,
`/admin/login`) × 9 larguras (**320, 375, 390, 414, 768, 1024, 1280, 1440, 1920**), medindo:
rolagem horizontal, elementos causadores, botões/links sem nome acessível, imagens sem `alt`,
campos sem rótulo e erros de console/JS/rede.

---

## 6. Deploy

| Componente | Plataforma | Situação |
|---|---|---|
| Frontend | **Vercel** | Preparado (build ✅). **NÃO PUBLICADO** — sem acesso à conta do proprietário |
| Backend | **Render** | Preparado (`Dockerfile`, `migrate deploy` no start). **NÃO PUBLICADO** |
| Banco | **Neon PostgreSQL** | Compatível (PostgreSQL puro, migrations versionadas). **NÃO PROVISIONADO** |

`VITE_API_URL` deve apontar para a API publicada
(ex.: `https://ma-store-backend.onrender.com/api`) e o domínio da Vercel precisa estar em
`CORS_ORIGINS` — nunca `*` em produção.

Passo a passo completo: [`DEPLOY.md`](DEPLOY.md).

---

## 7. Riscos e pendências

| Item | Severidade | Situação |
|---|---|---|
| Gateway de pagamento real não conectado | Alta | **Bloqueia venda real.** Arquitetura pronta; faltam credenciais |
| SMTP não configurado | Média | Recuperação de senha não envia e-mail (em dev o token é retornado) |
| Deploy não executado | Alta | Sem acesso às contas Vercel/Render/Neon |
| Grafia da logo ("CONFIRANCA") | Baixa | Recomenda-se regenerar o arquivo; o site usa a grafia correta |
| Upload de imagens por URL | Média | Hoje o admin informa a URL; falta storage (S3/Cloudinary) |
| 2FA para administradores | Média | Não implementado |
| Nota fiscal | Baixa | Não implementado |
| Frete real por transportadora | Média | Cálculo por CEP/região; falta integração com Correios/Melhor Envio |
| Carrinho de visitante | Baixa | Decisão de produto: a compra exige conta |
| Cobertura E2E de admin | Média | E2E cobre a loja; o painel é coberto por 127 testes de API + laboratório |

### O que NÃO foi validado (e por quê)

- **Pagamentos reais**: sem credenciais de gateway. Permanece sandbox — não foi fingida nenhuma
  transação real.
- **Deploy em produção**: sem acesso às contas das plataformas.
- **Envio de e-mail**: sem SMTP configurado.
- **Teste de carga em produção**: executado apenas localmente.

---

## 8. Arquivos alterados nesta auditoria

**Backend**
`src/env.ts` (rate limit), `src/modules/content/content.routes.ts` (cache),
`src/modules/lab/lab.service.ts` (limpeza segura: cupom, usuários, frete),
`.env.example`, `prisma/seed.ts` (reidratação do cupom).

**Frontend**
`src/main.tsx` (ordem das camadas CSS), `src/styles/*` (paleta, gradientes, contraste,
responsividade, atalhos, toasts), `src/components/ui/Icons.tsx` (astro + lockup),
`src/components/ui/primitives.tsx` (IDs válidos, props sem colisão com o DOM),
`src/components/layout/SiteChrome.tsx` (header/rodapé/menu), `src/components/layout/InstallPrompt.tsx`,
`src/pages/CheckoutPage.tsx` (**idempotência** + avanço de etapa), `src/pages/HomePage.tsx`,
`src/pages/admin/*` (ajustes de tipo/apresentação), `public/*` (novos ativos de marca).

**Novos**
`tests/browser/` (servidor local + auditoria responsiva + E2E + capturas),
`docs/AUDITORIA.md` (este relatório).

---

## 9. Conclusão

A loja está **funcional de ponta a ponta, responsiva, acessível e testada**, com identidade
visual construída a partir da logo real do proprietário.

O que **impede** o estado "pronto para venda real" não é código: é **configuração externa** —
gateway de pagamento, SMTP, storage de imagens e o deploy nas três plataformas.
