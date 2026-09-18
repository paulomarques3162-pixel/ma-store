# Segurança — MA STORE

Documento dos controles implementados e do que **não** é feito de propósito.

---

## 1. Senhas e credenciais

| Controle | Implementação |
|---|---|
| Hash | **bcrypt, custo 12** (`src/lib/password.ts`) |
| Senha em texto puro | Nunca persistida, nunca logada, nunca retornada |
| Política mínima | ≥ 8 caracteres, ao menos 1 letra e 1 número |
| Comparação | `bcrypt.compare` (tempo constante na biblioteca) |
| Admin vendo senha | **Impossível por construção**: nenhuma consulta do painel seleciona `passwordHash` |
| Recuperação | Token aleatório de 40 bytes, guardado **como hash SHA-256**, validade de 1 hora, uso único |
| Redefinição | Revoga **todas** as sessões ativas do usuário |
| Redefinição pelo admin | Apenas **inicia** o fluxo — o admin nunca descobre a senha |

O teste `admin.test.ts > Painel de usuarios nunca expoe senha` falha se qualquer resposta do painel contiver `passwordHash` ou o valor da senha. O detalhe do usuário retorna explicitamente `passwordVisible: false`.

---

## 2. Sessões e tokens

| Item | Decisão |
|---|---|
| Access token | JWT **HS256**, TTL 15 min, claims `sub`, `role`, `sid`; valida `issuer` e `audience` |
| Refresh token | **Valor opaco** (não é JWT), 48 bytes aleatórios, guardado **só como hash SHA-256**, TTL 30 dias |
| Rotação | A cada `refresh`, o token antigo é revogado e um novo par é emitido |
| Reuso de token revogado | Rejeitado com 401 |
| Revogação | `logout` revoga a sessão; bloquear usuário revoga **todas** as sessões na hora |
| Token inválido/expirado | Sempre **401** com mensagem amigável (nunca 500) |
| Sessões visíveis | Só metadados (user-agent, IP, datas) — **nunca** o token |

Por que refresh opaco e não JWT? Porque permite revogação imediata. Um JWT de refresh continuaria válido até expirar.

---

## 3. Autorização

- `authenticate` — exige token válido e conta não bloqueada.
- `requireAdmin` — exige `role = ADMIN`.
- Rotas administrativas passam por um hook global de plugin; nenhuma depende de checagem manual.
- Verificações testadas: cliente em `/api/admin/*` → **403**; sem token → **401**; token inválido → **401**.

### Isolamento de dados (IDOR)

Toda consulta de dado pessoal é filtrada pelo usuário autenticado:

- pedido de outro cliente → **404** (não 403, para não confirmar a existência do recurso);
- carrinho de outro → **404**;
- endereço de outro → **404**;
- pagamento de outro → **403**;
- recebimento de comprovante de outro → **404**.

---

## 4. Força bruta e abuso

| Controle | Implementação |
|---|---|
| Tentativas falhas | `failedLoginCount`; a partir de 5, bloqueio de 15 minutos (`lockedUntil`) |
| Rate limit global | 120 req/min por IP (configurável) |
| Rate limit de autenticação | 10 req/min por IP nas rotas de login/cadastro/reset |
| Enumeração de usuários | Mensagem genérica no login **e** na recuperação de senha |
| Duplo clique | `Order.idempotencyKey` + `X-Idempotency-Key` |
| Webhook repetido | `WebhookEvent @@unique([provider, eventId])` |

`AUTH_RATE_LIMIT_MAX` é configurável para não bloquear a suíte de testes — em produção o padrão é 10/min.

---

## 5. Validação e injeção

| Vetor | Controle |
|---|---|
| Corpo / query / params | **Zod** em todas as rotas |
| SQL Injection | Prisma com consultas parametrizadas; o SQL cru usa *tagged templates* (`$queryRaw\`… ${valor}\``), nunca concatenação |
| XSS | API retorna apenas JSON; nenhum HTML renderizado pelo backend |
| Mass assignment | Cada rota monta explicitamente os campos que aceita — o payload inteiro nunca vai direto para o ORM |
| Upload | Apenas URLs de imagem válidas e limitadas a 12 por produto |
| Payload abusivo | `bodyLimit` de 2 MB |

---

## 6. Segredos

- **Somente** em variáveis de ambiente (`src/env.ts` valida na inicialização e a aplicação **não sobe** com configuração inválida).
- `.env` está no `.gitignore`; o repositório traz apenas `.env.example` com valores de exemplo.
- O logger tem `redact` para `authorization`, `cookie`, `password`, `newPassword`, `currentPassword`, `confirmPassword`, `cardNumber`, `cvv` e `set-cookie` → `[REDACTED]`.
- **Nenhum** segredo é exposto ao frontend. Nada sensível usa prefixo `VITE_`.
- Credenciais de gateway **nunca** entram no código.
- `GET /api/health` não revela host do banco, versão do Postgres nem variáveis.

---

## 7. Pagamentos

| Controle | Implementação |
|---|---|
| Dados de cartão | **Nunca** armazenados — só `providerRef` e metadados não sensíveis |
| Assinatura de webhook | HMAC-SHA256 sobre o **corpo cru**, comparação em tempo constante (`timingSafeEqual`) |
| Corpo cru preservado | *Content type parser* encapsulado ao plugin de pagamentos |
| Idempotência | `(provider, eventId)` único + `applyPaymentResult` verifica estado final |
| Assinatura inválida | Registrada como `INVALID_SIGNATURE`; **nenhuma** alteração no pagamento |
| Sandbox x produção | `PAYMENT_ENV`; `simulate` é **bloqueado** quando `production` |
| Guarda-corpo | `NODE_ENV=production` com `PAYMENT_ENV=sandbox` emite aviso explícito no boot |
| Valores | Sempre recalculados no backend; o frontend nunca envia preço, desconto ou total |

O teste `payments.test.ts > nao guarda dados completos de cartao` falha se aparecer um número de cartão nos metadados.

---

## 8. Integridade de dados

- **Toda operação crítica é transacional**: criação de pedido (estoque + cupom + pagamento + histórico + carrinho + notificações), aplicação de resultado de pagamento, mudança de status, criar endereço padrão, publicar tema.
- **Condição de corrida**: a reserva de estoque usa `UPDATE … WHERE stock >= qty`. Dois clientes no último item → um recebe `409`, o estoque **nunca** fica negativo.
- **Estoque abaixo do reservado é bloqueado** no ajuste manual do admin.
- **Produto vendido não pode ser excluído** de forma definitiva — preserva o histórico.
- Todas as FKs têm `onDelete` explícito (`Cascade`, `Restrict` ou `SetNull`) — nada some por acidente.
- `OrderItem` e `Order.shippingAddress` são **snapshots**: mudar o produto ou o endereço depois não reescreve o passado.

---

## 9. Auditoria

`admin_audit_logs` registra administrador, ação, entidade, `before`, `after`, IP e `requestId`. Ações típicas: `UPDATE_STOCK`, `UPDATE_STATUS`, `PUBLISH_THEME`, `MODERATE_REVIEW`, `BLOCK_USER`, `DELETE`, `INITIATE_PASSWORD_RESET`.

Uma falha ao gravar auditoria é logada, mas **não** derruba a operação principal. Os testes verificam que a alteração aparece na auditoria com o valor anterior e o novo.

---

## 10. Erros e vazamento de informação

- Cliente recebe mensagem amigável + `requestId`; **nunca** stack trace.
- Stack trace aparece apenas no log do servidor e no laboratório, e é **ocultado quando `environment === "production"`**.
- Erros esperados de negócio (400/401/403/404/409/422) são logados como `warn`; só 5xx vira `error`.
- Códigos do Prisma são traduzidos (`P2002` → 409, `P2025` → 404) sem expor detalhe interno.

---

## 11. Transporte e cabeçalhos

- HTTPS obrigatório em produção (fornecido pela plataforma).
- `trustProxy` habilitado para respeitar `X-Forwarded-For` atrás do proxy.
- **Helmet** ativo (com CSP desligado de propósito: a API só serve JSON, o CSP é responsabilidade do frontend).
- CORS com lista explícita de origens, credenciais permitidas e cabeçalhos restritos (`Content-Type`, `Authorization`, `X-Idempotency-Key`, `X-Webhook-Signature`).

---

## 12. Checklist de segurança — testes executados

Todos verificados automaticamente (suíte + laboratório):

```
[✓] Cliente tentando acessar /api/admin/*            → 403
[✓] Requisição sem token                             → 401
[✓] Token expirado / inválido / malformado           → 401
[✓] Cliente tentando alterar preço de produto        → 403 e preço intacto
[✓] Cliente tentando acessar pedido de outro         → 404
[✓] Cliente tentando acessar pagamento de outro      → 403
[✓] Cliente tentando alterar carrinho de outro       → 404
[✓] Cliente tentando alterar endereço de outro       → 404
[✓] Painel expondo senha ou hash                     → verificação dedicada
[✓] Webhook sem assinatura                           → não altera o pagamento
[✓] Webhook com assinatura inválida                  → registrado, ignorado
[✓] Webhook duplicado                                → não reprocessa
[✓] Simulação de pagamento em produção               → bloqueada
[✓] Admin bloqueando a própria conta                 → bloqueado
[✓] Estoque negativo por concorrência                → impossível
[✓] Produto vendido excluído de verdade              → bloqueado
[✓] Estoque abaixo do reservado                      → bloqueado
[✓] Transição de status inválida                     → 400
[✓] Dados de cartão no banco                         → verificação dedicada
[✓] Conteúdo privado (PIX, razão social) na API pública → não exposto
```

São 20 verificações de segurança cobertas por testes.

---

## 13. Decisões conscientes (e o que ainda falta)

| Decisão | Motivo |
|---|---|
| CSP desligado na API | A API serve apenas JSON; CSP pertence ao frontend |
| CSRF não implementado | A autenticação é por `Authorization: Bearer` (não cookie de sessão), então CSRF clássico não se aplica |
| Sandbox de pagamento com `mock` | Nenhum gateway real integrado ainda — reforça a regra de não simular dinheiro real |
| Sem 2FA ainda | Pendente na fase 2 (ver `ROADMAP.md`) |

### Pendências de segurança antes de produção

1. Integrar um gateway real com credenciais próprias e cadastrar o `WEBHOOK_SECRET` dele.
2. Habilitar backups e testar a restauração do banco.
3. Configurar alertas de erro (5xx, falha de webhook, aumento de latência).
4. Rotacionar `JWT_SECRET` / `WEBHOOK_SECRET` periodicamente (rotacionar o JWT invalida todas as sessões).
5. Considerar 2FA e verificação de e-mail para administradores.
6. Configurar SMTP para que a recuperação de senha saia por e-mail (hoje o `devToken` só existe fora de produção).
7. Adicionar WAF/Cloudflare se a loja ganhar visibilidade relevante.
