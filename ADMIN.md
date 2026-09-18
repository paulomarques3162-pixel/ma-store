# MA STORE — Manual do Painel Administrativo

Guia prático para operar a loja. O painel usa a mesma API (`/api/admin/*`) com autenticação de administrador (`role = ADMIN`).

---

## 1. Primeiro acesso

O seed cria um administrador **de demonstração**:

| Campo | Valor |
|---|---|
| E-mail | `admin@teste.local` |
| Senha | `Teste@Admin123` |
| Marcação | `isDemo = true`, `mustChangePassword = true` |

**Faça imediatamente:**

1. Entre e troque a senha (`POST /api/auth/change-password`).
2. Confirme que `isDemo` foi limpo / remova o usuário de teste.
3. Em produção, defina `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` **antes** do seed — ou não rode o seed e crie o admin direto no banco.

> O painel **nunca** consegue ver a senha de um cliente. Só é possível **iniciar** o fluxo de redefinição.

---

## 2. Ordem recomendada de configuração

O sistema foi desenhado para não inventar nada. Siga esta ordem para a loja ficar vendável:

```
1. Configurações  → loja, contato, redes sociais, dados fiscais
2. Configurações  → PIX / pagamento / parcelamento
3. Frete          → cadastre ao menos UMA modalidade ATIVA
4. Categorias e Marcas
5. Produtos       → ative somente o que for real
6. Conteúdo       → textos da home, políticas, rodapé
7. Layout         → tema (rascunho → publicar)
8. Banners
9. Cupons
10. Testes        → rode o laboratório antes de divulgar
```

> ⚠️ **Sem uma modalidade de frete ativa que atenda o CEP, o checkout é bloqueado.** Isso é intencional: o sistema prefere bloquear a inventar um valor de frete.

---

## 3. Configurações (`/admin/configuracoes`)

Agrupadas por seção. Todas nascem **vazias** e aparecem como campos rotulados no painel.

| Grupo | Chaves |
|---|---|
| **Loja** | `store.name`, `store.tagline`, `store.legalName`, `store.cnpj`, `store.email`, `store.phone`, `store.whatsapp`, `store.address`, `store.hours` |
| **Redes** | `social.instagram`, `social.facebook`, `social.tiktok`, `social.youtube` |
| **Pagamento** | `payment.pixKey`, `payment.pixHolder`, `payment.bankAccount`, `payment.notes`, `payment.pixEnabled`, `payment.cardEnabled`, `payment.boletoEnabled`, `payment.maxInstallments`, `payment.installmentMinValue` |
| **Frete** | `shipping.originCep`, `shipping.freeAbove`, `shipping.notes`, `shipping.pickupEnabled` |
| **Políticas** | `policy.privacy`, `policy.terms`, `policy.exchange`, `page.how_to_buy`, `page.contact` |
| **Home** | `home.hero.title`, `home.hero.subtitle`, `home.hero.ctaLabel`, `home.hero.ctaLink`, `home.section.*` |
| **Rodapé** | `footer.about`, `footer.copyright`, `newsletter.title`, `newsletter.subtitle` |

### Campos privados x públicos

- **Públicos** (`isPublic = true`): aparecem em `GET /api/content` e podem ir para o site.
- **Privados** (`isPublic = false`): `store.legalName`, chave PIX, titular, conta bancária, CEP de origem. **Nunca** saem na API pública — ficam acessíveis só ao administrador.

Ao preencher um meio de pagamento, ative-o com a chave correspondente (`payment.pixEnabled = "true"`). Meio não configurado **não** aparece no checkout.

Salvamento: `PUT /api/admin/content` em lote. Toda alteração vai para a auditoria com `before`/`after`.

---

## 4. Produtos (`/admin/produtos`)

### Campos

| Campo | Observação |
|---|---|
| Nome, SKU | SKU único; slug gerado/atualizado automaticamente |
| Descrição curta / completa | Usadas na vitrine e na página do produto |
| Marca, Categoria | Opcionais, mas melhoram filtros e SEO |
| Preço | Obrigatório |
| Preço comparativo | Preencha **só** se houver promoção real (alimenta a seção Ofertas e o selo de desconto) |
| Custo | Interno — **nunca** exposto na API pública |
| Volume, Peso (g) | Volume aparece nos filtros; peso é usado no frete |
| Estoque, Estoque mínimo | O mínimo dispara alerta de estoque baixo no dashboard |
| Possui frete | `NÃO` → o produto não entra no cálculo de frete |
| Permite cupom | `NÃO` → cupons não incidem sobre este item |
| Lançamento / Destaque / Mais vendido | Alimentam as seções da home |
| Ativo | Só produtos ativos aparecem para o cliente |
| Imagens | URLs; sem imagem o frontend mostra placeholder elegante |

### Ações

- **Duplicar** — cria uma cópia **inativa** com estoque 0 e SKU novo.
- **Ajustar estoque** — `PATCH /:id/stock`. O sistema **impede** definir estoque abaixo do reservado (unidades em pedidos aguardando pagamento).
- **Excluir** — desativa (`active = false`), preservando o histórico de pedidos.
- **Excluir de verdade** (`?hard=true`) — só se o produto **nunca foi vendido**.

### Estoque

Três números por produto:

| Campo | Significado |
|---|---|
| `stock` | Disponível para venda |
| `reservedStock` | Em pedidos criados e ainda não pagos |
| `soldStock` | Vendido (pagamento aprovado) |

Ciclo: pedido criado → `stock -` / `reservedStock +` · pago → `reservedStock -` / `soldStock +` · cancelado → devolve para `stock`. A reserva é atômica no banco: **dois clientes não conseguem comprar o mesmo último item**.

---

## 5. Categorias e marcas

- Slug único gerado automaticamente (`Decants` → `decants`, segunda vez `decants-2`).
- Reordenação em lote (`POST /reorder`) define a ordem no menu.
- Excluir uma categoria com produtos/subcategorias apenas a **desativa**.

---

## 6. Pedidos (`/admin/pedidos`)

### Badge e pendências

`GET /api/admin/orders/pending-count` alimenta o contador **"Pedidos pendentes: X"**. Cada pedido novo gera notificação para todos os administradores ativos.

### Filtros

Status, período (`from`/`to`), forma de pagamento e busca por número, nome ou e-mail do cliente.

### Fluxo de status

```
AWAITING_PAYMENT → PAYMENT_REVIEW → PAID → PREPARING → SHIPPED → DELIVERED → REFUNDED
        │                │           │         │            │
        └────────────────┴───────────┴─────────┴────────────┴──→ CANCELED
```

Ao mudar o status você pode informar `note`, `trackingCode` e `carrier`. O cliente recebe notificação automática em `PAID`, `SHIPPED`, `DELIVERED`, `CANCELED` e `REFUNDED`, e o histórico completo fica em `order_status_history`.

Transições inválidas (ex.: `PAID → DELIVERED` direto) são bloqueadas com `400`.

### Comprovante

`GET /api/admin/orders/:id/receipt` devolve número, cliente, itens, valores, desconto, frete, total, pagamento, endereço, data e status — pronto para imprimir e salvar em PDF.

---

## 7. Cupons (`/admin/cupons`)

| Campo | Efeito |
|---|---|
| Código | Único, salvo em maiúsculas |
| Tipo | `PERCENT` (máx. 100%) ou `FIXED` |
| Valor | Percentual ou valor fixo |
| Valor mínimo | Subtotal mínimo para uso |
| Máximo de usos | Limite global |
| Limite por usuário | Limite por cliente |
| Vigência | `startsAt` / `endsAt` |
| Aplica a todo o catálogo | Se `NÃO`, escolha produtos e/ou categorias |
| Aplica no frete | Desconto também zera/desconta o frete |
| Ativo | Só cupons ativos são validados |

A validação acontece **sempre** no backend no momento da compra, revalidando tudo (inclusive o limite por usuário já consumido).

Um cupom já utilizado não é excluído — é desativado, preservando o histórico.

---

## 8. Frete (`/admin/frete`)

Cada modalidade tem nome, transportadora, valor, valor de frete grátis, prazo mínimo/máximo, regiões (UFs) e ordem.

- **Regiões vazias = atende todas as UFs.**
- Regiões preenchidas limitam a modalidade àquelas UFs.
- `freeAbove` zera o valor quando o subtotal alcança o limite.
- O CEP informado é convertido em UF por faixa oficial de CEP para selecionar a modalidade.
- Produtos com `hasShipping = NÃO` não entram no cálculo: se todos os itens forem assim, o frete é zero e a resposta traz `required: false`.

---

## 9. Mensagens (`/admin/mensagens`)

Central de atendimento no estilo help desk:

- Colunas: cliente, pedido vinculado, última mensagem, não lidas, status.
- Filtros por status (`OPEN`, `ARCHIVED`, `RESOLVED`) e busca por nome/e-mail/assunto.
- O admin pode responder, arquivar e marcar como resolvido. Responder notifica o cliente.
- Abrir a conversa zera o contador de não lidas (`unreadForAdmin`).

---

## 10. Avaliações e feedbacks (`/admin/feedbacks`)

- **Avaliações de produto** só podem ser criadas por quem **recebeu** o produto (pedido `DELIVERED`).
- Entram como `PENDING`. Só aparecem na página do produto após `APPROVED`.
- O painel permite aprovar, rejeitar ou excluir. O texto original do cliente **não é editado** — apenas moderado, preservando a integridade do feedback.

---

## 11. Conteúdo e layout (`/admin/conteudo`, `/admin/layout`)

### CMS de texto

Edite textos da home, institucionais, rodapé, contato, políticas, "Como comprar" e "Trocas e devoluções". Tudo salvo no banco — **nada hardcoded** no frontend.

### Layout / tema

Edite cor principal, cor secundária, destaque, fundos, textos, botões, bordas, raio dos cards, estilo dos botões, logo, favicon e banners.

Fluxo **rascunho → publicar**:

1. `POST /api/admin/theme` cria um **rascunho** (`isDraft = true`).
2. Edite o rascunho à vontade (`PATCH`) — inclusive pré-visualizando.
3. `POST /api/admin/theme/:id/publish` publica: desativa o tema anterior e ativa o novo.
4. O site público (`GET /api/theme`) **só** consome o tema ativo.
5. O tema publicado **não pode ser editado** — crie um rascunho a partir dele (`/draft`).

Enquanto nenhum tema for publicado, `GET /api/theme` responde `published: false` e o frontend usa o próprio padrão — em vez de inventar uma identidade visual.

### Banners

Título, subtítulo, imagem, link, texto do botão, posição (`hero`, `vitrine`, …), ordem, vigência e ativação. Banners fora da vigência não são exibidos.

---

## 12. Usuários (`/admin/usuarios`)

Colunas: nome, e-mail, telefone, status, quantidade de pedidos, total gasto, data de cadastro e último acesso.

Ações: bloquear/desbloquear, ver pedidos, ver sessões ativas, revogar sessões e **iniciar** recuperação de senha.

### 🔒 Regra absoluta sobre senhas

| ❌ Nunca aparece no painel | ✅ Pode aparecer |
|---|---|
| Senha do cliente | E-mail |
| Senha descriptografada | Nome |
| Senha original | Status |
| Token de autenticação | Data de cadastro / último acesso |
| Hash da senha | Pedidos e valores |

Isso é garantido no código: nenhuma seleção do Prisma para o painel inclui `passwordHash`, e os testes automatizados verificam que a resposta **não** contém `passwordHash` nem o valor da senha. O detalhe do usuário traz explicitamente `passwordVisible: false`.

Bloquear um usuário **revoga todas as sessões ativas imediatamente**.

---

## 13. Laboratório de testes (`/admin/testes`)

Área exclusiva para validar a plataforma antes de divulgar.

- **Executar suíte completa**: `POST /api/admin/lab/run`.
- 45 verificações reais contra a API e o banco, agrupadas em 17 categorias.
- Resultado por item: 🟢 `PASS`, 🟡 `WARN`, 🔴 `FAIL`, com tempo, endpoint, mensagem de erro, `requestId` e stack trace (**oculto em produção**).
- Histórico das execuções em `test_runs` / `test_results`.
- Os dados criados pela suíte são marcados como `[TESTE]`/`isDemo` e **removidos ao final**, sem sujar o catálogo real.

### Categorias verificadas

`infra` · `banco` · `autenticacao` · `seguranca` · `catalogo` · `carrinho` · `cupom` · `frete` · `pedido` · `concorrencia` · `pagamento` · `admin` · `mensagens` · `notificacoes` · `avaliacoes` · `cms` · `performance`

Rode o laboratório **antes de cada divulgação** e depois de qualquer mudança de configuração.

---

## 14. Logs e auditoria (`/admin/logs`)

### Auditoria (`admin_audit_logs`)

Toda ação administrativa registra: administrador, ação, entidade, `before`, `after`, IP e `requestId`. Exemplos: `UPDATE_STOCK`, `UPDATE_STATUS`, `PUBLISH_THEME`, `MODERATE_REVIEW`, `BLOCK_USER`, `INITIATE_PASSWORD_RESET`. Use isso para investigar alterações indevidas de preço, estoque ou pedido.

### Logs operacionais

Eventos de webhook recebidos (com validade da assinatura e status) e falhas do laboratório. Cada erro tem um `requestId` que correlaciona logs do servidor e resposta HTTP.

---

## 15. Pagamentos (`/admin/pagamentos`)

Lista com método, status, valor, provedor, referência, tentativas, pedido e cliente. Resumo agregado por status e o **ambiente atual** exibido de forma explícita:

- 🟡 **TESTE (sandbox)** — nenhuma cobrança real acontece.
- 🟢 **PRODUÇÃO** — cobranças reais.

Ações: expirar pagamentos pendentes vencidos.

> Guarda-corpo: o ambiente vem de `PAYMENT_ENV`. Credenciais de teste nunca são ativadas por acidente em produção — e segredos do gateway **nunca** ficam no frontend (só em variáveis de ambiente).

---

## 16. Checklist antes de divulgar a loja

```
[ ] Senha do admin trocada, usuário de demonstração removido
[ ] Configurações: loja, contato, redes, dados fiscais preenchidos
[ ] PIX / pagamento configurados e habilitados
[ ] Ao menos UMA modalidade de frete ATIVA
[ ] Categorias e marcas reais cadastradas
[ ] Produtos reais cadastrados, com preço, estoque e imagens
[ ] Itens [DEMO] excluídos ou substituídos
[ ] Textos da home, políticas e rodapé preenchidos
[ ] Tema publicado
[ ] Banners cadastrados
[ ] Cupons revisados (vigência, limites, elegibilidade)
[ ] Laboratório de testes: 0 FAIL
[ ] PAYMENT_ENV conferido (sandbox x produção)
[ ] Testado no celular: home, produto, carrinho, checkout
```
