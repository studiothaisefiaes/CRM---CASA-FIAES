# Plano 3: caixa por pessoa e pagamento novo — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** cada pessoa abre e fecha o próprio caixa; a recepção recebe a comanda pela fila "A receber" com as formas de pagamento do Norte Vendas (sem a taxa de 10%), ajusta preço, desconto e cortesia sempre com motivo e rastro, e a gestão vê "Caixas da equipe".

**Arquitetura:** evolui o caixa 6C que já existe (`cash_sessions`, `comandas`, `comanda_items`, `comanda_payments`). Cada pagamento grava a sessão de caixa de quem recebeu (`comanda_payments.cash_session_id`), e é dela que sai o esperado do fechamento. Não há pagamento em jsonb: cada forma é uma linha. As contas puras ficam em `src/lib/comanda-math.ts`; as regras do caixa, no domínio (`src/server/domain/caixa/*`); as leituras para a tela e para o Financeiro, em `src/server/queries/*`. A auditoria usa o `audit_log` que já existe.

**Stack:** Next 16 (App Router, server actions), Drizzle + Postgres, Vitest, Playwright, Tailwind com os tokens do CRM.

**Spec:** `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`, seções "Decisões do dono (17/10)" e "Caixa (modelo do Norte Vendas, sem a taxa de 10%)".

**Referência (só leitura):** `~/Projects/norte para negocios/ntb vendas`: `lib/calc.ts` (`calculateChangeForMethods`), `lib/cashDenominations.ts`, `lib/labels.ts` (`CARD_BRAND_LABELS`), `components/modules/StoreModule.tsx` (`PaymentCaptureFields`, fechamento com contagem cega e aprovação de supervisor).

## Restrições globais

- Todo texto de tela, erro, comentário e commit em PT-BR.
- Dinheiro sempre em centavos inteiros.
- Sem taxa de serviço. Sem pagamento guardado em jsonb.
- Migration única: `drizzle/0055_caixa_por_pessoa.sql`, com `when` 1792310000000 no `_journal.json`. O número 0056 é do Financeiro e não pode ser usado.
- Não mexer em `src/app/(app)/page.tsx` nem em `src/components/today/*`.
- Caixa só funciona com `caixa_modo = "crm"` (`assertCaixaOn`).
- Todos os que têm `caixa.operar` podem mudar o preço, dar desconto e dar cortesia, sempre com motivo. Cada mudança grava quem fez, o valor anterior e o motivo.
- Quem tem `caixa.gerir` aprova a diferença do fechamento, vê "Caixas da equipe", cadastra as formas "Outra", reabre um caixa e cancela comanda fechada.
- Visual: só os tokens e componentes que já existem (`Button`, `Input`, `Select`, `Segmented`, `ActionSheet`, `PageHeader`, `Empty`, as classes `rounded-[var(--radius-card)] border border-line bg-paper`).
- Testes do vitest no banco `crm_caixa3_t`; e2e no banco `crm_e2e_caixa3`, na porta 3500, com `EVOLUTION_URL=http://127.0.0.1:8080` só no comando.

## Decisões deste plano (rulings)

1. **O motivo é obrigatório** para mudar um preço que já existia, para dar desconto (> 0) e para dar cortesia. Para preencher um preço que estava vazio, o motivo não é pedido. Para tirar um item ou estornar um pagamento, o motivo é opcional, mas o registro na auditoria acontece sempre.
2. **Troco (regra do Norte):** troco = dinheiro entregue − max(0, total − o que as outras formas pagaram). Uma forma que não é dinheiro nunca passa do restante a pagar; isso é recusado no lançamento. O troco é gravado no último pagamento em dinheiro (`comanda_payments.change_cents`), e o esperado do caixa usa o dinheiro líquido.
3. **"Exigir caixa aberto"** passa a valer no **receber**, não no fechar a comanda. Com a regra desligada (padrão), o pagamento de quem está sem caixa aberto fica sem sessão: entra nos totais do dia, mas não em nenhum fechamento.
4. **Contado em branco = zero.** Antes, o que não era digitado contava como esperado. No fechamento, o dinheiro é a soma das cédulas e moedas; Pix, Crédito, Débito e Outra são digitados pelo total.
5. **Aprovação da diferença:** se |diferença| passa da tolerância, quem tem `caixa.gerir` aprova a própria diferença com um clique ("Aprovar a diferença"). Quem não tem precisa que alguém da gestão digite o e-mail e a senha ali mesmo (como o supervisor do Norte). O limite de tentativas é de 5 a cada 10 minutos por pessoa.
6. **Contagem cega** (opcional, desligada por padrão): quem não tem `caixa.gerir` não vê o esperado nem a diferença antes de fechar, nem mesmo no pedido de aprovação. Depois de fechar, vê o resultado.
7. **As regras do fechamento** (tolerância, contagem cega e sangria grande) ficam em Caixa › Caixas da equipe, editadas por quem tem `caixa.gerir`, e não em Configurações. Assim a tela de Configurações, que está com outro agente (limpeza-p5), não muda. Ficam gravadas na mesma chave `caixa_regras`, mescladas com `exigeCaixaAberto`. Valores padrão: tolerância R$ 5,00; contagem cega desligada; sangria grande a partir de R$ 200,00.
8. **Reabrir comanda** é feito no lugar: a mesma comanda volta para "aberta" e os pagamentos continuam nos caixas em que entraram. Desfaz o crédito lançado, o pacote vendido (se ainda não foi usado), a sessão de pacote baixada e o retrato da comissão. Quem pode: `caixa.operar` para comanda do dia, `caixa.gerir` para qualquer dia. O antigo "Reabrir para corrigir" sai da tela, mas a função continua no código.
9. **Cancelar comanda fechada** agora estorna os pagamentos e exige que o caixa de cada um ainda esteja aberto.
10. **"Outra forma"** fica numa tabela nova, `payment_method_options`, cadastrada em Serviços e pacotes › Formas de pagamento (`caixa.gerir`). O pagamento guarda o id e mostra o nome.
11. **Bandeira** é obrigatória no crédito e no débito, com o catálogo fechado do Norte: Visa, Mastercard, Elo, Amex, Hipercard, Alelo, Sodexo, Ticket, VR, Cabal e Outra.
12. **Nota fiscal futura:** `comanda_items.fiscal_kind` ('servico' | 'produto'; produto só quando `kind = 'produto'`) e `comandas.cpf` (11 dígitos válidos, opcional).
13. **A gestão pode fechar o caixa de outra pessoa** pela tela Caixas da equipe (quem esqueceu de fechar). Fica registrado quem fechou.

## Foco da revisão

1. **Duas pessoas recebendo ao mesmo tempo** na mesma comanda: a trava da comanda (`FOR UPDATE`) e a regra "não passa do restante" impedem pagar além do total com outra forma. Teste: dois pagamentos em Pix que juntos passam do total → o segundo é recusado.
2. **Estorno de pagamento cujo caixa já fechou:** é recusado com o nome da dona do caixa. Teste na Tarefa 4.
3. **Contagem cega vazando o esperado:** nem a página nem a resposta de "precisa de aprovação" mandam o esperado a quem não tem `caixa.gerir`. Testes nas Tarefas 3 e 6.
4. **Reabrir e fechar de novo** não pode dobrar o crédito nem a baixa de pacote. Teste na Tarefa 5.
5. **Troco com pagamento parcial em dinheiro** seguido de Pix: o troco sai só do dinheiro e cai no caixa de quem recebeu o dinheiro. Teste na Tarefa 4.

---

### Tarefa 1: migration 0055 e schema

**Arquivos:**
- Criar: `drizzle/0055_caixa_por_pessoa.sql`
- Modificar: `drizzle/meta/_journal.json`, `src/server/db/schema.ts` (bloco do caixa, ~794-930), `src/server/db/schema.test.ts:111-125`, `test/db.ts`, `e2e/reset.ts` (lista do truncate)

**Interfaces:**
- Produz (colunas no Drizzle):
  - `cashSessions`: + `countedBreakdown` (jsonb `Record<string, number>`: centavos da cédula → quantidade), `approvedBy` (uuid → users), `approvedAt`, `blind` (boolean, default false). Índice `cash_sessions_one_open_per_person` em `(opened_by) where status = 'aberto'`, no lugar de `cash_sessions_one_open`.
  - `paymentMethodOptions` (tabela `payment_method_options`): `id`, `label`, `active` (default true), `position` (int, default 0), `createdBy`, `createdAt`. Índice único em `lower(label)`.
  - `comandaPayments`: + `cashSessionId` (→ cash_sessions, com índice), `brand`, `note`, `customMethodId` (→ payment_method_options), `changeCents` (int, not null, default 0), `cancelledBy`, `cancelReason`. CHECKs `NOT VALID`: crédito/débito pedem `brand`; `outra` pede `custom_method_id`.
  - `comandaItems`: + `originalUnitCents`, `priceReason`, `discountReason`, `fiscalKind` (text, not null, default 'servico', CHECK em ('servico','produto')). Backfill: `fiscal_kind = 'produto'` onde `kind = 'produto'`.
  - `comandas`: + `cpf` (CHECK `cpf ~ '^\d{11}$'`), `discountReason`, `reopenedBy`, `reopenedAt`, `reopenReason`.
  - Backfill: `comanda_payments.cash_session_id` recebe a `cash_session_id` da comanda fechada; o `comandas.change_cents` vai para o último pagamento em dinheiro da comanda (`DISTINCT ON`).
  - Tipo exportado: `PaymentMethodOption`.

- [ ] **Passo 1: teste que falha** em `schema.test.ts`. O índice esperado passa a ser `cash_sessions_one_open_per_person`. A mesma pessoa não abre dois caixas; duas pessoas abrem um cada:

```ts
await db.insert(cashSessions).values({ day: "2026-10-16", openedBy: u.id });
await expect(db.insert(cashSessions).values({ day: "2026-10-16", openedBy: u.id })).rejects.toThrow();
await db.insert(cashSessions).values({ day: "2026-10-16", openedBy: outra.id }); // outra pessoa: passa
expect(await cols("comanda_payments")).toEqual(expect.arrayContaining(["cash_session_id", "brand", "note", "custom_method_id", "change_cents", "cancel_reason"]));
expect(await cols("comanda_items")).toEqual(expect.arrayContaining(["original_unit_cents", "price_reason", "discount_reason", "fiscal_kind"]));
expect(await cols("comandas")).toEqual(expect.arrayContaining(["cpf", "discount_reason", "reopen_reason"]));
```

- [ ] **Passo 2:** `vt.sh src/server/db/schema.test.ts` → FALHA (índice e colunas não existem).
- [ ] **Passo 3:** escrever a SQL (idempotente: `IF NOT EXISTS`, `DROP INDEX IF EXISTS`), a entrada no journal (`idx` 55, `when` 1792310000000, `tag` "0055_caixa_por_pessoa") e o schema do Drizzle. Incluir `payment_method_options` no truncate de `test/db.ts` e de `e2e/reset.ts`.
- [ ] **Passo 4:** `npx drizzle-kit migrate` nos bancos `crm_caixa3` e `crm_e2e_caixa3`, depois `vt.sh src/server/db` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): migration 0055, um caixa aberto por pessoa e campos do pagamento novo`.

### Tarefa 2: contas puras (troco, cédulas, regras)

**Arquivos:**
- Modificar: `src/lib/comanda-math.ts`, `src/lib/caixa-settings.ts`
- Criar: `src/lib/cash-denominations.ts`, `src/lib/cpf.ts`
- Teste: `src/lib/comanda-math.test.ts` (criar ou ampliar), `src/lib/cash-denominations.test.ts`, `src/lib/cpf.test.ts`

**Interfaces (produz):**
- `PAY_METHODS = ["pix","credito","debito","dinheiro","cortesia","credito_cliente","outra"] as const`; `PAY_LABEL` com Pix, Crédito, Débito, Dinheiro, Cortesia, Crédito da cliente e Outra forma.
- `DRAWER_METHODS = ["dinheiro","pix","credito","debito","outra"] as const` (o que é conferido no fechamento); `type DrawerMethod`.
- `CARD_BRANDS` (as 11 chaves do Norte) e `CARD_BRAND_LABEL: Record<CardBrand, string>`.
- `changeFor(pays: PaymentLine[], totalCents: number): number`: a regra do Norte, em centavos.
- `checkNewPayment(input: { totalCents: number; paidCents: number; method: PayMethod; valueCents: number }): string | null`: devolve a mensagem de erro, ou null se o pagamento pode entrar.
- `checkPayments(totalCents, pays)` mantém a assinatura, mas o troco agora vem de `changeFor`.
- `expectedByMethod({ openingCents, received, suprimentosCents, sangriasCents })`: `received` já vem líquido do troco; devolve `Record<DrawerMethod, number>`.
- `cashDifference(expected, counted)`: o que não foi contado vale **0**.
- `fiscalKindOf(kind: string): "servico" | "produto"`.
- `cash-denominations.ts`: `CASH_DENOMINATIONS_CENTS = [20000,10000,5000,2000,1000,500,200,100,50,25,10,5,1]`, `sumDenominations(counts: Record<string, number>): number` (ignora chave desconhecida e quantidade negativa ou não inteira) e `denominationLabel(cents)`.
- `cpf.ts`: `normalizeCpf(text): string | null` (só os 11 dígitos, se os dígitos verificadores batem).
- `caixa-settings.ts`: `CaixaRules = { exigeCaixaAberto: boolean; toleranciaCents: number; contagemCega: boolean; sangriaGrandeCents: number }` e `DEFAULT_CAIXA_RULES = { exigeCaixaAberto: false, toleranciaCents: 500, contagemCega: false, sangriaGrandeCents: 20000 }`.

- [ ] **Passo 1: testes que falham:**

```ts
expect(changeFor([{ method: "pix", valueCents: 5000 }, { method: "dinheiro", valueCents: 10000 }], 12000)).toBe(3000);
expect(changeFor([{ method: "dinheiro", valueCents: 5000 }], 12000)).toBe(0);
expect(checkNewPayment({ totalCents: 12000, paidCents: 5000, method: "pix", valueCents: 8000 })).toBe("Passa do que falta (R$ 70,00). Só o dinheiro pode passar e virar troco.");
expect(checkNewPayment({ totalCents: 12000, paidCents: 5000, method: "dinheiro", valueCents: 10000 })).toBeNull();
expect(checkNewPayment({ totalCents: 12000, paidCents: 12000, method: "dinheiro", valueCents: 100 })).toBe("Essa comanda já está paga.");
expect(sumDenominations({ "20000": 1, "5000": 2, "25": 3, "x": 9, "100": -1 })).toBe(30075);
expect(cashDifference({ dinheiro: 1000, pix: 500 }, { dinheiro: 900 })).toEqual({ byMethod: { dinheiro: -100, pix: -500 }, totalCents: -600 });
expect(normalizeCpf("529.982.247-25")).toBe("52998224725"); expect(normalizeCpf("111.111.111-11")).toBeNull();
expect(fiscalKindOf("produto")).toBe("produto"); expect(fiscalKindOf("pacote_venda")).toBe("servico");
```

  (O `R$` sai de `money()`, que usa espaço não separável; o teste compara com `money(7000)`.)

- [ ] **Passo 2:** rodar → FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/lib` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): troco do Norte, cédulas, bandeiras, CPF e regras do fechamento`.

### Tarefa 3: caixa por pessoa (abrir, sangria, fechar com aprovação, reabrir)

**Arquivos:**
- Modificar: `src/server/domain/caixa/cash.ts`, `src/server/domain/caixa/mode.ts`
- Teste: `src/server/domain/caixa/cash.test.ts`

**Interfaces:**
- Consome: Tarefa 2 (`expectedByMethod`, `cashDifference`, `sumDenominations`, `CaixaRules`).
- Produz:
  - `getOpenCashTx(q: Q, userId: string): Promise<CashSession | null>`: o caixa aberto **dessa pessoa**.
  - `openCash(input: { openingCents: number; notes?: string | null }, actor, now?)`: recusa com "Seu caixa já está aberto (desde HH:MM)."; a trava é `caixa:sessao:<userId>`.
  - `cashSummary(sessionId, q?) → CashSummary`, com `received: { method, valueCents }[]` (pagamentos vivos daquela sessão, dinheiro líquido do troco), `byBrand: { method, brand, valueCents }[]`, `suprimentosCents`, `sangriasCents`, `expected: Record<DrawerMethod, number>` e `openComandas`.
  - `addMovement(input, actor, now?)`: no caixa aberto da própria pessoa. Se for sangria ≥ `sangriaGrandeCents`, também grava `audit_log` com a ação `caixa_sangria_grande`.
  - `closeCash(input: { sessionId?: string | null; cashBreakdown: Record<string, number>; counted: Partial<Record<"pix"|"credito"|"debito"|"outra", number | null>>; notes?: string | null; approverId?: string | null }, actor, now?)` → `{ status: "precisa_aprovacao"; differenceCents: number | null } | { status: "fechado"; differenceCents; expected; counted; openComandas; warning }`.
    - Sem `sessionId`, usa o caixa da própria pessoa. Para fechar o de outra pessoa, precisa de `caixa.gerir` ("Só a gestão fecha o caixa de outra pessoa.").
    - Se |diferença| > tolerância, sem `approverId`, ou com um `approverId` sem `caixa.gerir`, devolve `precisa_aprovacao`. Com contagem cega e sem `caixa.gerir` no ator, `differenceCents` vem null.
    - Grava `countedBreakdown`, `blind`, `approvedBy` e `approvedAt`; a auditoria `caixa_fechado` leva `aprovadoPor`.
  - `userHasPerm(userId: string, perm: Perm, q?): Promise<boolean>` (lê o perfil).
  - `reopenCash(id, actor, now?)`: recusa com "{Nome} já tem um caixa aberto." quando a dona já abriu outro.
  - `mode.ts`: `getCaixaRules()` devolve as 4 regras com os padrões; `saveCaixaSettings` mescla em vez de sobrescrever; nova função `saveCaixaRules(input: Omit<CaixaRules,"exigeCaixaAberto">, userId)`, auditada com de/para.

- [ ] **Passo 1: testes que falham** (substituem os do "um aberto por vez"):
  - `"cada pessoa abre o seu; a mesma pessoa não abre dois"`: a Cati e a gestora abrem; a Cati abre de novo → `"Seu caixa já está aberto (desde 09:00)."`.
  - `"esperado vem dos pagamentos que entraram em cada caixa"`: insere pagamentos com `cashSessionId` A (dinheiro 7.000 com troco 1.000; Pix 5.000) e B (Débito 3.000) → `cashSummary(A).expected` = `{ dinheiro: 10000 + 6000, pix: 5000, credito: 0, debito: 0, outra: 0 }` e o de B tem `debito: 3000`.
  - `"sangria grande vai para a auditoria"`: sangria de 20.000 → existe uma linha `caixa_sangria_grande`; a de 1.000 não gera.
  - `"fechar: dinheiro pelas cédulas, cartão e Pix pelo total; dentro da tolerância fecha"`: esperado de dinheiro 16.000; cédulas `{ "10000": 1, "5000": 1, "200": 4, "100": 2 }` (= 16.000 − 0) e Pix 5.000 → `status: "fechado"`, `differenceCents: 0`, `countedBreakdown` gravado.
  - `"acima da tolerância pede aprovação; a gestão aprova; aprovador sem caixa.gerir não vale"`: diferença de −1.000 com tolerância de 500 → `precisa_aprovacao` (−1.000); `approverId` = Cati → `precisa_aprovacao`; `approverId` = gestora → `fechado`, `approvedBy` = gestora.
  - `"contagem cega esconde a diferença de quem não é gestão"`: com `contagemCega: true`, a Cati recebe `{ status: "precisa_aprovacao", differenceCents: null }`.
  - `"gestão fecha o caixa de outra pessoa; a equipe não"`.
  - `"reabrir: recusa se a dona já abriu outro"`.
  - `"salvar o modo não apaga as regras do fechamento"`.
- [ ] **Passo 2:** rodar → FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/server/domain/caixa/cash.test.ts` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): caixa por pessoa, contagem por cédula, tolerância com aprovação e contagem cega`.

### Tarefa 4: pagamento novo (formas, bandeira, troco, estorno, Outra forma)

**Arquivos:**
- Criar: `src/server/domain/caixa/payment-options.ts`, `src/server/domain/caixa/payments.test.ts`
- Modificar: `src/server/domain/caixa/comandas.ts` (`addPayment`, `removePayment` e o trecho de troco de `closeComanda`)
- Modificar testes: `comandas-fechar.test.ts` (o caso "caixa fechado quando exigido" passa a valer para o receber)

**Interfaces:**
- Produz:
  - `addPayment(comandaId, input: { method: PayMethod; valueCents: number; installments?: number | null; brand?: CardBrand | null; customMethodId?: string | null; note?: string | null }, actor, now?) → { id }`.
    - Erros: "Escolha a bandeira do cartão.", "Parcelas de 1 a 12.", "Escolha qual é a outra forma.", "Escreva o motivo da cortesia." e as mensagens de `checkNewPayment`.
    - Grava `cashSessionId` = caixa aberto do ator (ou null). Com `exigeCaixaAberto` e sem caixa, lança `CashClosedError` com a mensagem "Abra o seu caixa para receber.".
    - A cortesia grava `audit_log` com a ação `cortesia` ({ numero, valor, motivo }).
  - `removePayment(paymentId, input: { reason?: string | null }, actor, now?)`: estorno. Recusa com "Esse pagamento entrou no caixa de {Nome}, que já fechou." Grava `cancelledBy` e `cancelReason`, mais a auditoria `estorno` ({ numero, forma, valor, motivo }).
  - `closeComanda`: troco = `changeFor`. Vai para o último pagamento vivo em dinheiro (`change_cents`); com "guardar como crédito", o `change_cents` fica 0. Não confere mais o caixa aberto ao fechar.
  - `payment-options.ts`: `listPaymentOptions({ activeOnly?: boolean }): Promise<PaymentMethodOption[]>` e `savePaymentOption(input: { id?: string | null; label: string; active?: boolean }, actor): Promise<{ id }>`. Nome de 2 a 40 caracteres. Nome repetido → "Já existe a forma {label}.". Auditoria `forma_pagamento_salva`.

- [ ] **Passo 1: testes que falham** (`payments.test.ts`):
  - `"crédito pede bandeira e parcelas de 1 a 12; débito pede bandeira"`.
  - `"forma que não é dinheiro não passa do restante; dinheiro passa e o troco cai no dinheiro"` (Pix 5.000 e dinheiro 10.000 numa comanda de 12.000 → ao fechar, `change_cents` do pagamento em dinheiro = 3.000).
  - `"pagamento parcial deixa a comanda aberta com saldo"` (Pix 5.000 em 12.000 → status "aberta"; `getComandaDetail(...).remainingCents` = 7.000).
  - `"o pagamento grava o caixa de quem recebeu"` (Cati com caixa aberto e gestora sem caixa → `cashSessionId` da Cati e null).
  - `"exigir caixa aberto vale no receber"` → `CashClosedError`.
  - `"cortesia pede motivo e vai para a auditoria"`.
  - `"Outra forma pede uma forma ativa cadastrada"` (inativa → "Escolha qual é a outra forma.").
  - `"estorno recusa pagamento de caixa já fechado e audita o estorno"`.
  - `"dois Pix que juntos passam do total: o segundo é recusado"` (Foco da revisão 1).
  - `"troco de dinheiro parcial + Pix fica no caixa de quem recebeu o dinheiro"` (Foco 5: Cati recebe dinheiro 10.000 de 12.000, a gestora recebe Pix 5.000 e fecha → troco 3.000 no pagamento da Cati; `cashSummary(cati).expected.dinheiro` = 7.000 + fundo).
  - `"Outra forma: cadastra, recusa nome repetido e desativa"`.
- [ ] **Passo 2:** rodar → FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/server/domain/caixa` → PASSA (inclui os testes antigos, atualizados).
- [ ] **Passo 5:** commit `feat(caixa): formas do Norte com bandeira, parcelas, cortesia, Outra forma, troco no dinheiro e estorno`.

### Tarefa 5: item e comanda com motivo, CPF, reabrir e auditoria

**Arquivos:**
- Modificar: `src/server/domain/caixa/comandas.ts`
- Criar: `src/server/domain/caixa/ajustes.test.ts`

**Interfaces:**
- Produz:
  - `AddItemInput` ganha `priceReason?: string | null`. Serviço com preço diferente do catálogo exige motivo. Grava `originalUnitCents` (preço do catálogo ou do horário) e `fiscalKind`.
  - `updateItem(itemId, patch: { qty?; unitCents?; discountCents?; discountPercent?; professionalId?; label?; reason?: string | null }, actor, now?)`.
    - Mudar um preço que já existia → exige `reason` ("Escreva o motivo da mudança de preço."), grava `priceReason`, mantém `originalUnitCents` (preenche com o anterior se estava vazio) e audita `preco_alterado` ({ numero, item, de, para, motivo }).
    - Desconto > 0 que mudou → exige `reason` ("Escreva o motivo do desconto."), grava `discountReason` e audita `desconto` ({ numero, item, valor, percentual, motivo }).
  - `removeItem(itemId, input: { reason?: string | null }, actor, now?)`: audita `item_cancelado` ({ numero, item, valor, motivo }).
  - `setComandaDiscount(comandaId, input: { cents?; percent?; reason?: string | null }, actor, now?)`: motivo obrigatório quando o desconto é > 0; grava `discountReason` e audita `desconto` (item null).
  - `setComandaCpf(comandaId, cpf: string | null, actor, now?)`: "CPF inválido." quando `normalizeCpf` devolve null.
  - `reopenComanda(comandaId, input: { reason: string }, actor, now?) → { day }`.
    - Volta para "aberta" no lugar. A comanda de outro dia exige `caixa.gerir` ("Comanda de outro dia: só a gestão reabre.").
    - Desfaz o crédito, o pacote vendido, a sessão de pacote, a comissão e o `change_cents`. Mantém os pagamentos. Grava `reopenedBy/At/Reason`. Audita `comanda_reaberta`.
  - `cancelComanda` (pelo `cancelClosedTx`): estorna os pagamentos vivos (com `cancelReason`) e exige o caixa de cada um aberto; a auditoria `estorno` sai por pagamento.
  - Função interna compartilhada `undoCloseTx(tx, c, reason, actor, now)`, usada por reabrir e cancelar.

- [ ] **Passo 1: testes que falham** (`ajustes.test.ts`):
  - `"mudar preço pede motivo, guarda o anterior e audita"` (Corte 12.000 → 10.000 sem motivo → erro; com "cliente antiga" → `originalUnitCents` 12.000, `priceReason`, auditoria { de: 12000, para: 10000 }).
  - `"preencher preço vazio não pede motivo"` (Mechas null → 30.000).
  - `"desconto em R$ e em % pede motivo e audita"` (10% do Corte = 1.200).
  - `"desconto na comanda pede motivo"`.
  - `"tirar item audita item_cancelado"`.
  - `"CPF válido grava só os dígitos; inválido recusa"`.
  - `"item de produto é produto para a nota; serviço é serviço"`.
  - `"reabrir no lugar: mantém pagamentos, desfaz crédito e pacote; fechar de novo não dobra"` (Foco 4: crédito usado de 2.000 e sessão de pacote → reabre → saldo e sessões voltam → fecha de novo → saldo −2.000 uma vez só; `package_uses` vivos = 1).
  - `"reabrir comanda de outro dia é da gestão"`.
  - `"cancelar fechada estorna os pagamentos; recusa se o caixa de algum já fechou"`.
- [ ] **Passo 2:** rodar → FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/server/domain/caixa` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): preço, desconto e cortesia com motivo; CPF; reabrir comanda no lugar; auditoria`.

### Tarefa 6: leituras (fila, detalhe, caixas da equipe e as funções do Financeiro)

**Arquivos:**
- Modificar: `src/server/queries/caixa.ts`, `src/server/queries/caixa.test.ts`
- Criar: `src/server/queries/caixa-pagamentos.ts`, `src/server/queries/caixa-pagamentos.test.ts`

**Interfaces (produz):**
- `getComandaDetail(id: string, viewerId: string): Promise<ComandaDetail | null>`. Ganha `cpf`, `discountReason` e `canReopen` (calculado na action); por item, `originalUnitCents`, `priceReason`, `discountReason` e `fiscalKind`; por pagamento, `brand`, `note`, `customLabel`, `changeCents` e `sessionOwnerName`. `cashOpen` é o caixa do visitante; `changePreviewCents` = `changeFor`.
- `getCaixaQueue(now?: Date): Promise<CaixaQueue>`, com `CaixaQueue = { aReceber: QueueRow[]; emAtendimento: QueueRow[]; pagasHoje: QueueRow[] }`.
  - `QueueRow = { id; number; day; clientName; totalCents; paidCents; remainingCents; since: string; closedAt: string | null; closedByName: string | null; services: { label; professionalName: string | null; status: string | null }[] }`.
  - A receber: comandas abertas, de qualquer dia, com pelo menos um item vivo e todos os itens de horário em `compareceu`. São ordenadas por `since` crescente (o maior `finished_at` dos horários, ou o `openedAt`).
  - Em atendimento: as outras abertas.
  - Pagas hoje: fechadas com `closedAt` no dia de hoje em Salvador, da mais recente para a mais antiga.
- `getCaixaHoje(viewer: { id: string; perms: Perm[] }, now?)` → `{ day, mode, rules, mine: CashSummary | null (sem expected/diferença se a contagem for cega e o visitante não tiver caixa.gerir), myName, queue, totals }`.
- `listTeamCash(now?: Date): Promise<TeamCashRow[]>`: caixas abertos (de qualquer dia) e fechados hoje.
  - `TeamCashRow = { id; personId; personName; day; status; openedAt; closedAt; openingCents; received: Record<PayMethod, number>; expectedCash: number; differenceCents: number | null; approvedByName: string | null; closedByName: string | null }`.
- `listCashSessions(limit)` ganha `approvedByName`.
- **Para o Financeiro** (`caixa-pagamentos.ts`; `range = { from: string; to: string }`, dias "AAAA-MM-DD" em Salvador, inclusive; conta os pagamentos vivos de comandas não canceladas; o dia é o do pagamento; o dinheiro vem líquido do troco):
  - `paymentsByMethod(range): Promise<MethodTotal[]>`, com `MethodTotal = { method: PayMethod; label: string; customMethodId: string | null; valueCents: number; count: number }` ("Outra" sai uma linha por forma cadastrada).
  - `paymentsBySession(range): Promise<SessionTotal[]>`, com `SessionTotal = { sessionId: string | null; personId: string | null; personName: string; status: "aberto" | "fechado" | "sem_caixa"; openedAt: string | null; closedAt: string | null; byMethod: Record<PayMethod, number>; moneyCents: number; differenceCents: number | null; approvedByName: string | null }`.
  - `paymentsByDay(range): Promise<DayTotal[]>`, com `DayTotal = { day: string; byMethod: Record<PayMethod, number>; moneyCents: number; count: number }`.
  - `listCaixaExceptions(range): Promise<CaixaException[]>`, com `CaixaException = { at: string; kind: "preco_alterado" | "desconto" | "cortesia" | "item_cancelado" | "estorno" | "comanda_reaberta" | "sangria_grande"; userName: string | null; comandaId: string | null; comandaNumber: number | null; item: string | null; valueCents: number | null; previousCents: number | null; reason: string | null }`.
  - `moneyCents` = soma das formas de `DRAWER_METHODS` (fora cortesia e crédito da cliente).
- `dayTotals(day)` (em `cash.ts`) passa a ser `paymentsByDay({ from: day, to: day })`.

- [ ] **Passo 1: testes que falham:**
  - `"fila: A receber só com todos os serviços finalizados, da mais antiga para a mais nova; Em atendimento e Pagas hoje"`.
  - `"detalhe: saldo, bandeira, observação, CPF e dona do caixa do pagamento"`.
  - `"caixa de hoje esconde o esperado na contagem cega"` (Foco 3).
  - `"caixas da equipe: aberto e fechado hoje, por pessoa"`.
  - `"Financeiro: por forma, por sessão (com 'sem caixa') e por dia; dinheiro líquido do troco; estorno e comanda cancelada ficam fora"`.
  - `"exceções: preço, desconto, cortesia, item cancelado, estorno, reabertura e sangria grande, com quem fez e o motivo"`.
- [ ] **Passo 2:** FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/server/queries` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): fila A receber, caixas da equipe e leituras de pagamentos para o Financeiro`.

### Tarefa 7: server actions

**Arquivos:**
- Modificar: `src/app/(app)/caixa/actions.ts`, `src/app/(app)/caixa/actions.test.ts`, `src/app/(app)/servicos/actions.ts`, `src/lib/permissions.ts` (texto de `caixa.gerir`)

**Interfaces (produz, todas `ActionResult`):**
- `addPaymentAction(comandaId, { method, valueCents, installments?, brand?, customMethodId?, note? })`
- `removePaymentAction(paymentId, { reason? })`
- `updateItemAction(itemId, patch & { reason? })`
- `removeItemAction(itemId, { reason? })`
- `setDiscountAction(comandaId, { cents?, percent?, reason? })`
- `setCpfAction(comandaId, cpf | null)`
- `reopenComandaAction(comandaId, { reason })`: `caixa.operar` na entrada; o domínio confere `caixa.gerir` para comanda de outro dia.
- `closeCashAction({ sessionId?, cashBreakdown, counted, notes?, approval?: { email: string; password: string } | { self: true } })`:
  - com `email` e `senha`, confere com `checkCredentials` e `userHasPerm(…, "caixa.gerir")`, limitado por `allow("caixa-aprovar:<userId>", 5)`;
  - com `self`, só serve se o ator tiver `caixa.gerir`;
  - devolve o resultado de `closeCash`.
- `queueAction()` (para recarregar a fila sem refresh); `saveCaixaRulesAction(rules)` com `caixa.gerir`; `savePaymentOptionAction(input)` com `caixa.gerir`, em `servicos/actions.ts`.
- [ ] **Passo 1:** teste em `actions.test.ts`: "aprovação com senha de quem não é gestão é recusada" e "Aprovação com senha errada → 'E-mail ou senha da gestão não conferem.'". Rodar → FALHA.
- [ ] **Passo 2:** implementar. `vt.sh src/app src/server/auth/guard-coverage.test.ts` → PASSA.
- [ ] **Passo 3:** commit `feat(caixa): ações do pagamento novo, do fechamento com aprovação e das formas`.

### Tarefa 8: a comanda (painel com itens editáveis e pagamento)

**Arquivos:**
- Criar: `src/components/caixa/comanda-panel.tsx`, `src/components/caixa/item-editor.tsx`
- Modificar: `src/components/caixa/comanda-sheet.tsx` (vira uma casca: `ActionSheet` + `ComandaPanel`; a assinatura continua a mesma), `src/components/caixa/payment-panel.tsx`, `src/components/caixa/comanda-provider.tsx` (o catálogo ganha `paymentOptions` e `today`)
- Testes: `comanda-sheet.test.tsx`, `payment-panel.test.tsx`, `item-editor.test.tsx`

**Interfaces:**
- `ComandaCatalog` ganha `paymentOptions: { id: string; label: string }[]` e `today: string`. As páginas que montam o catálogo (Agenda e Caixa) passam esses campos.
- `ComandaPanel({ comandaId, catalog, onChanged?: () => void, layout: "sheet" | "inline" })`: título "Comanda N · Cliente", itens, somar item, desconto, CPF, pagamento e ações (Descartar, Finalizar, Reabrir com motivo, Cancelar para a gestão).
- `ItemEditor({ item, onSave(patch & { reason }) })`: Preço (R$), Desconto com `Segmented` R$/%, Motivo (aparece e é obrigatório quando muda um preço que já existia ou quando há desconto) e Salvar. "Tirar" pede o motivo (opcional).
- `PaymentPanel`:
  - botões das formas (Pix, Crédito, Débito, Dinheiro, Cortesia, Crédito da cliente quando há saldo, Outra forma quando há cadastro);
  - bandeiras em botões (`aria-pressed`) no crédito e no débito;
  - Parcelas 1x a 12x no crédito; select da outra forma; Valor; Observação (vira "Motivo da cortesia" na cortesia);
  - "Restante a pagar", "Troco" ao vivo e o botão Receber.
  - A lista de pagamentos mostra a bandeira, as parcelas, a observação, quem recebeu e "Estornar".
- [ ] **Passo 1: testes que falham** (render com Testing Library):
  - no crédito sem bandeira, Receber fica desabilitado e aparece "Escolha a bandeira";
  - o troco ao vivo segue `changeFor`;
  - na cortesia, o campo é "Motivo da cortesia";
  - no editor, mudar o preço mostra o Motivo obrigatório; preencher um preço vazio não mostra.
- [ ] **Passo 2:** FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/components/caixa` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): comanda com itens editáveis, motivo e o painel de pagamento novo`.

### Tarefa 9: tela do Caixa, fechamento, Caixas da equipe e Formas de pagamento

**Arquivos:**
- Modificar: `src/app/(app)/caixa/page.tsx`, `src/components/caixa/caixa-today.tsx` (vira `caixa-workspace.tsx`), `src/components/caixa/cash-close-sheet.tsx`, `src/app/(app)/caixa/fechamentos/page.tsx`, `src/components/shell/nav.ts` (+ `nav.test.ts`), `src/app/(app)/servicos/page.tsx`, `src/components/servicos/services-page.tsx`, `src/app/(app)/agenda/page.tsx` (só o catálogo)
- Criar: `src/components/caixa/caixa-queue.tsx`, `src/components/caixa/cash-header.tsx`, `src/app/(app)/caixa/equipe/page.tsx`, `src/components/caixa/team-cash.tsx`, `src/components/caixa/caixa-rules-form.tsx`, `src/components/servicos/payment-options.tsx`
- Testes: `cash-close-sheet.test.tsx`, `caixa-queue.test.tsx`, `nav.test.ts`, `payment-options.test.tsx`

**Interfaces / tela:**
- **Cabeçalho** (`CashHeader`):
  - caixa aberto: "Caixa de {Nome} · aberto HH:MM" e os botões Sangria, Suprimento e Fechar caixa;
  - caixa fechado: "Fundo de troco (R$)" e o botão "Abrir caixa, {Nome}".
  - Abas: A receber · Fechamentos · Caixas da equipe (gestão) · Comissão.
- **Corpo** (`lg:grid-cols-[minmax(320px,380px)_1fr]`):
  - à esquerda, `CaixaQueue` com "Nova comanda" e as seções A receber, Em atendimento e Pagas hoje (contagem, número, cliente, serviços, saldo/total e "pronta há X min");
  - à direita, `ComandaPanel layout="inline"` da comanda escolhida, ou o vazio "Escolha uma comanda na lista".
  - Abaixo de `lg`, tocar na lista abre o `ComandaSheet`.
- **`CashCloseSheet({ sessionId?, ownerName, summary: { expected: Record<DrawerMethod, number> | null; byBrand; openComandas }, blind, canGerir, hasOptions })`:**
  - grade de cédulas e moedas, cada uma com um campo de quantidade e o rótulo `aria-label="Quantidade de R$ 200"`;
  - "Dinheiro contado" (a soma); Pix, Crédito, Débito e (se houver) Outra pelo total;
  - Sistema e diferença por forma (fora da contagem cega);
  - em `precisa_aprovacao`: o botão "Aprovar a diferença" (para a gestão) ou E-mail e Senha da gestão com "Aprovar e fechar";
  - depois de uma contagem cega, mostra o resultado.
- **`/caixa/equipe`** (`requirePerm("caixa.gerir")`): tabela `TeamCash` com Pessoa, Abriu, Fundo, Recebido, Dinheiro esperado, Diferença, Situação e ações (Fechar para o caixa aberto de outra pessoa, Reabrir para o fechado). Embaixo, `CaixaRulesForm`: Tolerância (R$), Contagem cega (Switch) e Sangria grande a partir de (R$).
- **Serviços e pacotes › Formas de pagamento** (`?aba=formas`, só `caixa.gerir`): lista, com "Nova forma", renomear e "Ativa".
- **nav:** Caixa ganha `{ href: "/caixa/equipe", label: "Caixas da equipe", perm: "caixa.gerir" }`. Serviços e pacotes ganha `{ href: "/servicos?aba=formas", label: "Formas de pagamento", perm: "caixa.gerir" }`.
- [ ] **Passo 1: testes que falham:**
  - fechamento: as cédulas somam "Dinheiro contado R$ 175,00"; a contagem cega esconde "Sistema"; `precisa_aprovacao` sem gestão mostra E-mail e Senha;
  - fila: as três seções, com contagem e saldo;
  - nav: a atendente não vê "Caixas da equipe" e a gestão vê;
  - formas: adicionar chama a ação.
- [ ] **Passo 2:** FALHA. **Passo 3:** implementar. **Passo 4:** `vt.sh src/components` → PASSA.
- [ ] **Passo 5:** commit `feat(caixa): tela A receber com a comanda ao lado, fechamento por cédula, Caixas da equipe e Formas de pagamento`.

### Tarefa 10: e2e e capturas

**Arquivos:**
- Modificar: `e2e/caixa.spec.ts`
- Criar: `e2e/caixa-pessoa.spec.ts`

- [ ] **Passo 1:** atualizar o teste de desktop de `caixa.spec.ts`:
  - "Fundo de troco (R$)" e "Abrir caixa, Thaíse";
  - Pix 50, depois Dinheiro 100 → "Troco: R$ 30";
  - no fechamento, cédulas 1×100, 1×50, 1×10 e 1×5 = 165, contra 170 de esperado, e Pix 50 → diferença −5 (dentro da tolerância de R$ 5) → "Caixa fechado".
- [ ] **Passo 2:** `caixa-pessoa.spec.ts` (desktop):
  - (a) a comanda finalizada aparece em A receber, abre à direita, muda o preço com motivo, paga com Crédito + bandeira + 3x e Finaliza, e vai para Pagas hoje;
  - (b) pagamento parcial deixa a comanda com saldo em A receber;
  - (c) uma diferença acima da tolerância pede aprovação e a gestão aprova;
  - (d) Caixas da equipe mostra o caixa da Ana (aberto por SQL) e o da gestão.
- [ ] **Passo 3:** rodar `E2E_PORT=3500 DATABASE_URL=…/crm_e2e_caixa3 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test e2e/caixa.spec.ts e2e/caixa-pessoa.spec.ts` → PASSA.
- [ ] **Passo 4:** capturas em segundo plano (Playwright headless, sem roubar o foco) em `~/Projects/casa-fiaes/ops/capturas/`: `caixa-a-receber.png`, `caixa-pagamento.png`, `caixa-fechamento.png`, `caixa-aprovacao.png`, `caixa-equipe.png`, `caixa-formas.png`.
- [ ] **Passo 5:** commit `test(caixa): e2e do caixa por pessoa e do pagamento novo`.

### Tarefa 11: verificação final e revisão

- [ ] `vt.sh` (suite completa) → 0 falhas.
- [ ] `npx next typegen && npx tsc --noEmit` → sem erros.
- [ ] `npx eslint <arquivos alterados>` → sem erros.
- [ ] e2e do caixa → PASSA.
- [ ] Revisão final do branch inteiro por um revisor novo (`superpowers:requesting-code-review`), com a correção do que ele apontar e um commit.
