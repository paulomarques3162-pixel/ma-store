# MÓDULO DE ENTREGA / MOTOBOY — MA STORE

Área exclusiva do entregador, integrada ao sistema existente (pedidos guest,
autenticação JWT, storage de imagens e auditoria). **Nenhum layout da loja
pública foi alterado.**

---

## 1. Modelos (PostgreSQL / Prisma)

Migration `20260927120000_delivery_module` (aditiva):

- **Role** ganhou `DELIVERY_PERSON` (não quebra usuários existentes).
- Enums `DeliveryStatus` (`PENDING`, `ASSIGNED`, `OUT_FOR_DELIVERY`, `DELIVERED`,
  `FAILED`, `CANCELLED`) e `DeliveryFailureReason` (`CLIENTE_AUSENTE`,
  `ENDERECO_NAO_LOCALIZADO`, `RECUSA_DO_RECEBEDOR`, `AREA_INACESSIVEL`,
  `PROBLEMA_DE_ACESSO`, `OUTRO`).

`Delivery` (1:1 com `pedidos`; tentativas ficam no histórico):

| Campo | Descrição |
| --- | --- |
| `id`, `pedido_id` (único), `driver_id` | vínculos |
| `status` | `DeliveryStatus` |
| `assigned_at`, `started_at`, `delivered_at` | marcos (sempre server-side) |
| `recipient_name`, `recipient_document_last4` | quem recebeu |
| `proof_photo_url` | referência PRIVADA da foto |
| `latitude`, `longitude`, `location_accuracy` | GPS do evento |
| `notes`, `failure_reason` | observação / motivo |

`DeliveryEvent` — histórico auditável (`delivery_id`, `status`, GPS, notas,
`failure_reason`, `created_by`, `created_at`).

Índices: `deliveries(pedido_id)` único, `(driver_id, status)`, `(status)`,
`(created_at)`; `delivery_events(delivery_id)`.

---

## 2. Endpoints

### Entregador (`/api/delivery`, token obrigatório)

| Método | Rota | Regra |
| --- | --- | --- |
| GET | `/my` | role `DELIVERY_PERSON`; `driverId` vem da **sessão** |
| GET | `/:id` | ADMIN **ou** `delivery.driverId === user.id` |
| GET | `/:id/proof` | ADMIN ou dono; devolve a foto (arquivo privado) |
| POST | `/:id/start` | dono; `ASSIGNED` → `OUT_FOR_DELIVERY` |
| POST | `/:id/photo` | dono; multipart (campo `file`), valida imagem |
| POST | `/:id/confirm` | dono; prova + nome do recebedor |
| POST | `/:id/fail` | dono; motivo obrigatório |

### Admin (`/api/admin`)

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/delivery` | lista entregas (filtros) |
| GET | `/delivery/pending` | pedidos prontos para envio sem entrega |
| GET | `/delivery/report?from=AAAA-MM-DD&to=AAAA-MM-DD` | relatório por entregador (período) |
| GET | `/delivery/:id` | detalhe |
| GET | `/delivery/:id/proof` | prova (arquivo privado) |
| POST | `/delivery/assign` | `{ pedidoId, driverId }` — cria/atribui |
| POST | `/delivery/:id/reassign` | `{ driverId }` — reatribui |
| POST | `/delivery/:id/proof-viewed` | registra auditoria da visualização |
| GET/POST | `/drivers` | listar/criar entregador |
| PATCH | `/drivers/:id` | editar (nome, telefone, status) |
| POST | `/drivers/:id/deactivate` | desativa (nunca apaga histórico) |
| POST | `/drivers/:id/reset-password` | redefine e derruba sessões |

Erros padronizados: `DELIVERY_NOT_FOUND`, `NOT_AUTHORIZED`,
`DELIVERY_ALREADY_COMPLETED`, `INVALID_STATUS`, `RECIPIENT_NAME_REQUIRED`,
`PROOF_REQUIRED`, `FAILURE_REASON_REQUIRED`, `DRIVER_NOT_FOUND`,
`INVALID_DRIVER`.

---

## 3. Segurança e autorização

- O `driverId` **nunca** vem do frontend: é sempre `request.authUser.id`.
- `GET /my?driverId=outro` é ignorado (filtra pela sessão).
- Só `role = DELIVERY_PERSON` e `status = ACTIVE` podem ser atribuídos.
- Preço, status, entregador, `orderId` e `deliveredAt` enviados pelo frontend
  são **ignorados** (Zod remove campos desconhecidos).
- Transições atômicas via `updateMany` condicional (evita dupla confirmação /
  concorrência admin×motoboy).
- **Idempotência**: confirmar duas vezes não duplica evento; a segunda chamada
  devolve o mesmo resultado. Falhar depois de entregue é bloqueado com
  `DELIVERY_ALREADY_COMPLETED`.
- Timestamps: `deliveredAt/startedAt` = `new Date()` no servidor.
- Prova é servida apenas por endpoint autenticado, com `Cache-Control: no-store`.

---

## 4. Foto / prova de entrega

- Upload multipart em `POST /api/delivery/:id/photo` (só o dono, em
  `ASSIGNED`/`OUT_FOR_DELIVERY`).
- Reaproveita `validateImage` do storage existente: **magic bytes**, tamanho
  (`UPLOAD_MAX_MB`) e dimensões — não confia em nome/MIME do cliente.
- Gravada em diretório **privado** `DELIVERY_PROOF_DIR` (padrão
  `./var/delivery-proofs`), fora de `/uploads`.
- A referência precisa pertencer àquela entrega (`delivery-proofs/<id>/...`) —
  bloqueia caminhos de outras entregas/path traversal.
- No admin, a prova é exibida via `GET /api/admin/delivery/:id/proof`
  (a `proof-viewed` é auditada). No MP, exibida só para ADMIN/dono.

---

## 5. Fluxos

### Entregador
`/motoboy/login` → `/motoboy` (painel) → `/motoboy/entregas` (lista) →
`/motoboy/entregas/:id` → **Iniciar entrega** → **Confirmar entrega**
(nome do recebedor + foto + GPS) ou **Não entregue** (motivo + obs.).

### Admin
`/admin/entregadores` (criar/ativar/desativar/resetar senha) →
`/admin/entregas` (acompanhar + **Atribuir pedido**) →
`/admin/entregas/:id` (prova completa + histórico + reatribuir).

### Cliente
O rastreio (`/rastreio/:token`) já exibe "Entregue em … — Recebido por: …"
porque a confirmação atualiza o `Pedido` (status `Entregue`, `recebidoPor`,
`dataEntrega`).

Ao **iniciar**, o pedido passa para `Saiu para Entrega`. Ao **falhar**, volta
para `Pronto para Envio` (fluxo administrativo), mantendo o histórico.

---

## 5.1 Mapa e relatório (admin)

- **Mapa**: no detalhe da entrega (`/admin/entregas/:id`), quando há coordenadas,
  é exibido um mapa simples via embed do OpenStreetMap (com marcador) — sem
  dependências novas e restrito ao ADMIN. Também há o link "abrir no mapa".
- **Relatório**: aba **Relatório** em `/admin/entregas`, com filtro de período
  (`de`/`até`, padrão últimos 30 dias). Mostra totais do período e, por
  entregador: total, **concluídas**, **falhas**, em andamento e taxa de sucesso.
  Agregação feita no backend (`GET /api/admin/delivery/report`) por
  `driverId` + `status`, com a data de criação da entrega no período.

## 6. Notificações e auditoria

- Ao atribuir: cria `Notification` para o entregador ("Nova entrega atribuída").
- Auditoria: `delivery_assigned`, `delivery_reassigned`, `delivery_started`,
  `delivery_confirmed`, `delivery_failed`, `proof_viewed`, `driver_created`,
  `driver_updated`, `driver_deactivated`, `driver_password_reset`.

---

## 7. Seeds

- `npm run seed:dev` / `seed:test`: cria entregadores de teste
  **`motoboy1@test.local`** e **`motoboy2@test.local`** (senha
  `Motoboy@Test123`, marcados `isDemo`, troca de senha obrigatória). Aborta em
  produção.
- `npm run seed:production`: **não cria** entregadores, senhas, entregas, provas,
  coordenadas nem fotos fictícias.

---

## 8. Testes

Backend `tests/integration/delivery.test.ts` (23 casos): autenticação,
autorização (dono/outro/admin/cliente), atribuição (role/ativo/inexistente),
início, foto (inválida, de outro entregador), confirmação (nome/foto/prova,
timestamp do servidor, idempotência), não entrega (motivo/OUTRO), prova privada.

Frontend `src/pages/motoboy/driver.test.tsx`: painel e lista do entregador.

```bash
cd backend && npx vitest run tests/integration/delivery.test.ts
cd frontend && npx vitest run src/pages/motoboy
```

---

## 9. Variáveis de ambiente

```
DELIVERY_PROOF_DIR=./var/delivery-proofs   # diretório privado das provas
UPLOAD_MAX_MB=5                            # limite da foto (reaproveitado)
```

Em produção com disco efêmero, troque o storage local por objeto privado
(mesma interface de `services/storage.ts`).

---

## Login único (Admin + Entregador)

A operação usa **uma única tela de login**: `/admin/login`. O backend identifica
o `role` e a tela redireciona automaticamente:

- `ADMIN` → `/admin/dashboard`
- `DELIVERY_PERSON` → `/motoboy`
- `CLIENT` → loja (`/`)

`/motoboy/login` continua existindo apenas como **alias** da mesma tela
(`DriverLoginPage` reexporta `AdminLoginPage`). Não há duplicação de lógica e a
autorização é sempre validada no backend (JWT + role + `status=ACTIVE`).

## Usuários (painel admin)

Novo módulo administrativo de usuários (`/api/admin/users`, ADMIN-only):

- `GET /api/admin/users` — lista com `ordersCount` e `totalSpent` (sem senha);
- `GET /api/admin/users/:id` — detalhe + sessões ativas + `passwordVisible: false`;
- `PATCH /api/admin/users/:id/status` — ativa/bloqueia (bloquear derruba sessões;
  o próprio admin não pode se bloquear);
- `POST /api/admin/users/:id/reset-password` — gera link de redefinição.

Nunca expõe `passwordHash`.
