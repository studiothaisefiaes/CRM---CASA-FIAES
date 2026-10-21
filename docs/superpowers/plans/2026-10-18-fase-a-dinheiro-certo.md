# Fase A: dinheiro certo, para ligar o caixa do CRM — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** a comissão e o líquido do caixa do CRM saem iguais aos do Avec: assistente na comanda, taxa do cartão por bandeira e parcela, comissão com descontos, pagamento da comissão com recibo, vale/bônus/desconto, crédito e dívida da cliente, a página de exceções e as permissões por área.

**Arquitetura:** tudo evolui o caixa por pessoa que já existe (`comandas`, `comanda_items`, `comanda_payments`, `cash_sessions`, `cash_movements`, `client_credit_entries`). As contas ficam puras em `src/lib/` (`comanda-math.ts`, `commission-math.ts`, `commission-rules.ts`, `payout-period.ts`); as regras com banco, em `src/server/domain/caixa/*`; as leituras, em `src/server/queries/*` e `src/server/reports/financeiro/*`. A comissão continua sendo um **retrato** gravado ao Finalizar a comanda; o retrato agora guarda a comissão sem descontos, cada desconto e as assistentes. Toda mudança de dinheiro grava quem fez, o antes, o depois e o motivo no `audit_log`.

**Stack:** Next 16.4 (App Router, server actions; ler `node_modules/next/dist/docs/` antes de mexer em rota, como pede o `AGENTS.md`), Drizzle + Postgres, Vitest, Playwright, Tailwind com os tokens do CRM.

**Spec:** `docs/superpowers/specs/2026-10-18-o-que-falta-design.md`, seção "Fase A · Dinheiro certo" (itens 1 a 8). Base: `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md` ("Decisões do dono (17/10)", "Caixa", "Fechar o dia e Financeiro", "Um nome para cada coisa"). Valores do Avec: `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18.md` (seções 3, 4, 7 e 13) e `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18-parte2.md` (A7, seção 7 "Customizações" e seção 8 "Comissões"/"Financeiro").

## Restrições globais

- Todo texto de tela, erro, comentário e commit em PT-BR. Dinheiro em centavos inteiros; percentual em pontos-base (`bp`, 199 = 1,99%); arredondamento de % pela `commissionCents` que já existe (meio centavo para cima).
- Migrations só de **0061 a 0069**. Este plano usa 0061 a 0067, `when` de 1792370000000 a 1792430000000 (passo de 10000000). A última em produção é a 0060 (`when` 1792360000000). Só acrescentam: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`. O vínculo de assistente (`professionals.assistant_of`) **nunca** é preenchido por migration (regra da 0053).
- **Caixa por pessoa** continua: o pagamento entra no caixa de quem recebeu; nada aqui muda o esperado do fechamento (taxa não sai da gaveta).
- **Todos mudam preço, desconto e cortesia, sempre com motivo e rastro** (nada muda aqui). Vale, bônus, desconto na comissão, desfazer pagamento de comissão e mudar taxa ou regra também gravam quem, antes, depois e motivo.
- **Avec e CRM juntos:** o Financeiro compara, nunca soma. A dívida e o crédito do Avec ficam no Avec; o CRM só conta os seus.
- **Uma pergunta por tela; resumo pequeno que abre o painel grande.** **Desenho atual mantido:** só os componentes e tokens que existem (`Button`, `Input`, `Select`, `Segmented`, `ActionSheet`, `Dialog`, `Badge`, `PageHeader`, `Empty`, `DataList`, `Section`, `Fig`, as classes `rounded-[var(--radius-card)] border border-line bg-paper`).
- **Um nome para cada coisa** (`NOMES_UNICOS` em `src/lib/ui-terms.test.ts`): Assistente · Taxa do cartão · Líquido · Dívida · Crédito da cliente · Vale · Bônus · **Desconto na comissão** (nunca só "Desconto", que é o da comanda) · Pagar a comissão · Recibo · A pagar · Pagas · Exceções. Nunca usar "Aguardando a cliente" fora do status da conversa.
- Comanda e pagamento só com `caixa_modo = "crm"` (`assertCaixaOn`). Regras de comissão, vales e pagamento da comissão não dependem do modo (a Casa prepara antes, como hoje).
- Bancos: vitest em `crm_test_fasea` (`TDB=postgresql://crm:crm_local_dev@localhost:5433/crm_test_fasea`; criar uma vez com `psql postgresql://crm:crm_local_dev@localhost:5433/crm -c 'create database crm_test_fasea'`); e2e em `crm_e2e_fasea`, portas 3520/3521, com `EVOLUTION_URL=http://127.0.0.1:8080` só no comando.
- Proibido: portas 3000/3100/4321/4400/8080 (o 8080 só como `EVOLUTION_URL` do e2e), `pkill`/`killall`, push, deploy, mandar WhatsApp, rodar migration fora dos bancos acima.

## Decisões deste plano (rulings) — as marcadas com ★ precisam do dono

1. ★ **% da assistente** fica na linha da profissional principal × serviço (`professional_services.assistant_bp`, "% da assistente"), como no Avec ("comissão de assistente" no serviço de cada profissional). Vazio = assistente "sem regra" (aparece pendente, nunca somada).
2. ★ **Assistente já preenchida:** o item de serviço nasce com as assistentes ativas cujo `assistant_of` é a profissional do item (até 2, por nome). Trocar a profissional do item troca as assistentes pelas sugeridas da nova. Se a profissional marcada no horário for ela mesma uma assistente (ex.: Sidney), o item fica com ela como profissional, sem trocar para a principal.
3. **Dois assistentes:** "sobre o total" = cada uma calcula sobre a base inteira; "metade" = cada uma sobre metade (a primeira fica com o centavo a menos). Com uma assistente, as duas regras dão o mesmo. A comissão das assistentes sai da principal pelo "quanto sai da principal" (Avec: `desconto_assistente_controlado`, Casa 100%).
4. ★ **Antes ou depois:** "antes" desconta o valor da base (efeito na comissão = valor × % dela); "depois" desconta o valor inteiro da comissão. Vale para taxa do cartão, antecipação e custo do serviço. A antecipação é `antecipacaoBp` × o recebido em Crédito (à vista e parcelado). Com "antes", 7% de antecipação tira 7% da comissão sobre a parte paga no crédito, que é o "a antecipação desconta 7% da comissão" do Avec.
5. **Rateio na comanda:** taxa do cartão e antecipação da comanda são rateadas pelos itens proporcionalmente ao líquido de cada um (total − parte no desconto − parte na cortesia; sessão de pacote vale 0), com `splitDiscount`. Custo = `lists.cost_cents` × quantidade.
6. **Padrão no código = neutro** (nada descontado, "sobre o total", 0% sai da principal, dívida "agora"), para os testes antigos não mudarem. Os valores da Casa entram pela migration 0063 em `settings.comissao_regras`: cartão "antes", antecipação "antes" 7%, custo "depois", dois assistentes "metade", 100% sai da principal, ★ comissão da dívida "quando ela pagar".
7. ★ **Taxas da Casa** (migration 0062): débito 1,99% Visa/Mastercard/Elo; crédito à vista Visa 2,43%, Mastercard 2,10%, Elo 2,90%, Hipercard 3,00%, Amex 2,90%; crédito parcelado (2x a 12x) 5,70% nas mesmas 5 bandeiras. Bandeira sem taxa cadastrada: o pagamento entra com taxa vazia, a comanda avisa "Sem taxa cadastrada: Alelo" e nada é descontado. A taxa é retrato do momento do pagamento.
8. ★ **Custo do serviço** entra agora (`lists.cost_cents`, campo "Custo" no serviço), porque a regra da Casa desconta o custo. O resto do item 24 (Fase C) continua lá. Atenção: o plano da Fase C (`0084_servico_completo`) também cria `lists.cost_cents` e o campo Custo; a fase que entrar depois reaproveita a coluna e o campo em vez de criar de novo (as duas migrations usam `ADD COLUMN IF NOT EXISTS`).
9. **Dívida:** ao Finalizar com falta, "Deixar R$ X como dívida" (precisa de cliente). A dívida é por comanda. Quitar = item "Dívida da comanda N de dd/mm" (`kind = "divida"`, sem comissão, fora do faturamento por profissional e serviço) numa comanda nova, até o que falta. Com a regra "quando ela pagar", a comissão da comanda com dívida fica retida (`commission_held`) e só entra no "A pagar" quando a dívida daquela comanda zera. ★ Dívida e crédito do Avec não entram no livro do CRM.
10. ★ **Pagar a comissão:** paga tudo o que não foi pago até a data escolhida (não só o período), porque a comissão liberada depois ou refeita numa reabertura cai no próximo recibo. A data sugerida é o fim do último período fechado da profissional (`professionals.payout_period`: mensal, padrão; quinzenal; semanal, de domingo a sábado). Recibo com número sequencial. Se vales e descontos passarem da comissão, o recibo sai com R$ 0 e a diferença vira "Desconto na comissão" do dia seguinte ("Saldo do recibo nº N"). Desfazer o pagamento pede motivo e devolve tudo ao "A pagar".
11. **Comanda com comissão paga não reabre** nem é cancelada: "A comissão de Ana desta comanda já foi paga no recibo nº 3. Desfaça o pagamento em Comissão antes."
12. ★ **Vale pela sangria:** a sangria pode virar vale de uma profissional que tenha acesso ao app (`professionals.user_id`). Ela digita a própria senha no caixa (como `solicitar_senha_sangrias_prof` do Avec); 5 tentativas a cada 10 min por quem opera. Sem acesso ao app, a tela diz como cadastrar e não deixa. Cancelar a sangria cancela o vale.
13. **Vale, bônus e desconto na comissão:** avulso ou "todo mês no dia X" (1 a 28, com início e fim opcional). Os do mês são gerados na hora de ler ou pagar (idempotente, um por regra e dia). Motivo obrigatório.
14. ★ **Exceções (item 7):** a página de auditoria se chama "Exceções" (o nome que já está no Financeiro e no Excel). O Financeiro mostra o resumo por tipo e "Ver todas", que abre `/relatorios/excecoes`. Entram também: item cancelado em comanda aberta, assistente trocada e profissional diferente entre a agenda e a comanda.
15. ★ **Permissões por área:** o grupo "Agenda e caixa" vira Agenda, Caixa e Comissão. Novas: `caixa.dinheiro` ("Ver o dinheiro do caixa": caixa no escuro por perfil), `caixa.outros` ("Ver os caixas e fechamentos da equipe", que sai de `caixa.gerir`) e `comissao.pagar` ("Pagar a comissão e lançar vale, bônus e desconto na comissão"). Para nada mudar no dia: `caixa.dinheiro` vai a todo perfil que já tem `caixa.operar`; `caixa.outros`, a todo perfil que tem `caixa.gerir`; `comissao.pagar`, só à Gestão. Cada área com gente ou dinheiro tem um "ver de outras": Conversas (`atendimento.todas`), Caixa (`caixa.outros`), Comissão (`comissao.ver`), Relatórios (`relatorios.equipe`).

## Foco da revisão

1. **Reabrir comanda com comissão já paga** (a recepção corrige um preço depois do recibo): recusa com o número do recibo, nada muda. Teste na Tarefa 9.
2. **Dois cliques em "Pagar"** (ou duas pessoas ao mesmo tempo): um recibo só, nenhuma linha paga duas vezes. Teste na Tarefa 9.
3. **Taxa alterada depois do pagamento:** não muda a taxa, o líquido nem a comissão da comanda já recebida. Teste na Tarefa 3.
4. **Quitação em duas vezes e quitação maior que a dívida:** a segunda parte zera a dívida e só então a comissão é liberada; passar do que falta é recusado. Teste na Tarefa 7.
5. **Bandeira sem taxa cadastrada (Alelo):** o pagamento entra, o líquido é o valor, a comanda avisa e a comissão não desconta. Teste na Tarefa 3.

---

## Estrutura de arquivos

**Criar**
- `drizzle/0061_assistentes_comanda.sql`, `0062_taxas_cartao.sql`, `0063_regras_comissao.sql`, `0064_repasse_comissao.sql`, `0065_vales.sql`, `0066_divida.sql`, `0067_permissoes_area.sql`
- `src/lib/commission-rules.ts` (+ `.test.ts`): tipo das regras, padrão neutro, leitura e mescla com a da profissional.
- `src/lib/commission-math.ts` (+ `.test.ts`): comissão de um item com descontos e assistentes.
- `src/lib/payout-period.ts` (+ `.test.ts`): fim do último período de repasse.
- `src/server/domain/caixa/payment-fees.ts` (+ `.test.ts`): taxas do cartão.
- `src/server/domain/caixa/assistants.ts` (+ `.test.ts`): assistentes do item.
- `src/server/domain/caixa/commission-rules.ts` (+ `.test.ts`): regras da Casa, da profissional, % da assistente.
- `src/server/domain/caixa/commission-snapshot.ts` (+ `.test.ts`): o retrato no Finalizar e o desfazer.
- `src/server/domain/caixa/debts.ts` (+ `.test.ts`): dívida da cliente.
- `src/server/domain/caixa/adjustments.ts` (+ `.test.ts`): vale, bônus e desconto na comissão.
- `src/server/domain/caixa/payouts.ts` (+ `.test.ts`): a pagar, pagar, desfazer, recibo.
- `src/app/(app)/caixa/comissao/actions.ts` (+ `.test.ts`): ações da Comissão (regras, lançamentos, pagamento).
- `src/app/(app)/caixa/comissao/recibo/[id]/page.tsx`, `src/app/(pro)/pro/ganhos/recibo/[id]/page.tsx`
- `src/app/(app)/relatorios/excecoes/page.tsx`
- `src/components/caixa/assistants-field.tsx`, `commission-how.tsx`, `adjustments-panel.tsx`, `payout-sheet.tsx`, `payout-receipt.tsx`, `payouts-list.tsx` (+ testes de tela onde indicado)
- `src/components/servicos/card-fees.tsx` (+ `.test.tsx`)
- `src/components/reports/excecoes-page.tsx`
- `test/comanda-fixtures.ts`: `comandaFechada()` para os testes de comissão.

**Modificar**
- `src/server/db/schema.ts`, `src/server/db/schema.test.ts`, `drizzle/meta/_journal.json`, `test/db.ts`, `e2e/reset.ts`
- `src/lib/permissions.ts` (+ teste), `src/components/config/profiles-editor.tsx`, `src/components/shell/nav.ts`
- `src/lib/comanda-math.ts` (+ teste), `src/server/domain/caixa/comandas.ts`, `cash.ts`, `commission.ts` (+ testes)
- `src/server/queries/caixa.ts`, `fechar-dia.ts`, `pro-earnings.ts`, `src/lib/pro-earnings.ts`, `src/server/domain/agenda/ports.ts`
- `src/server/queries/caixa-pagamentos.ts`, `src/server/reports/financeiro/{entradas,itens,excecoes,index,xlsx}.ts` (+ testes), `src/components/reports/financeiro.tsx`, `salon-period-picker.tsx`
- `src/app/(app)/caixa/actions.ts`, `caixa/comissao/page.tsx`, `caixa/equipe/page.tsx`, `caixa/fechamentos/page.tsx`, `servicos/page.tsx`, `servicos/actions.ts`, `(pro)/pro/ganhos/page.tsx`
- `src/components/caixa/{comanda-panel,payment-panel,movement-sheet,commission-rules,commission-table}.tsx`, `src/components/servicos/service-sheet.tsx`, `src/server/domain/services.ts`, `src/components/pro/earnings-view.tsx`

## Ordem e paralelismo

- **Tarefas 1 e 2 em paralelo** (banco × contas puras, sem arquivo em comum).
- **Trilha A, em sequência** (dividem `comandas.ts`, `queries/caixa.ts`, `comanda-panel.tsx`, `caixa/actions.ts` e a página da Comissão): 3 → 4 → 5 → 6 → 7 → 8 → 9 → 12.
- **Trilha B, em paralelo com a A** depois da Tarefa 1 (`reports/financeiro/{entradas,excecoes,index,xlsx}.ts`, `caixa-pagamentos.ts`, `components/reports/*`, `report-legend.ts` e a página nova): 10 → 11. A Trilha A só toca `reports/financeiro/itens.ts` (Tarefa 7), que a B não toca.
- **Tarefa 13** no fim, depois das duas trilhas.

---

### Tarefa 1: banco (migrations 0061–0067), schema e as três permissões novas

**Arquivos:**
- Criar: `drizzle/0061_assistentes_comanda.sql` … `drizzle/0067_permissoes_area.sql`
- Modificar: `drizzle/meta/_journal.json`, `src/server/db/schema.ts`, `src/server/db/schema.test.ts`, `test/db.ts`, `e2e/reset.ts`, `src/lib/permissions.ts`, `src/lib/permissions.test.ts`

**Interfaces:**
- Produz (schema, nomes Drizzle → colunas):
  - `professionalServices.assistantBp` → `assistant_bp integer` (0 a 10000).
  - `comandaItemAssistants` → `comanda_item_assistants`: `id`, `comandaItemId` (fk item, cascade), `professionalId`, `position smallint` (1|2), `baseCents`, `bp`, `commissionCents`, `payoutId` (fk `commission_payouts`), `createdBy`, `createdAt`; únicos (item, position) e (item, professional).
  - `paymentFees` → `payment_fees`: `id`, `method` ('credito'|'debito'), `brand`, `parcelado boolean`, `feeBp`, `updatedBy`, `updatedAt`; único (method, brand, parcelado); check `method = 'credito' or not parcelado`. `comandaPayments.feeBp`, `comandaPayments.feeCents` (null = não é cartão ou sem taxa; check 0 ≤ fee ≤ value).
  - `professionals.commissionRules jsonb` (null = segue a Casa), `lists.costCents integer ≥ 0`, `comandaItems.commissionGrossCents integer`, `comandaItems.commissionDeductions jsonb` (`Deductions` da Tarefa 2).
  - `professionals.payoutPeriod text not null default 'mensal'` ('mensal'|'quinzenal'|'semanal'); `commissionPayouts` → `commission_payouts`: `id`, `number` (sequência própria, único), `professionalId`, `fromDay`, `untilDay`, `commissionCents`, `bonusCents`, `valesCents`, `descontosCents`, `carriedCents`, `netCents`, `note`, `paidBy`, `paidAt`, `cancelledAt`, `cancelledBy`, `cancelReason`; `comandaItems.payoutId`.
  - `professionalAdjustmentRules` → `professional_adjustment_rules`: `id`, `professionalId`, `kind` ('vale'|'bonus'|'desconto'), `valueCents > 0`, `dayOfMonth` (1 a 28), `startsOn`, `endsOn` (null), `note not null`, `active`, `createdBy`, `createdAt`. `professionalAdjustments` → `professional_adjustments`: `id`, `professionalId`, `kind`, `valueCents > 0`, `day`, `note not null`, `ruleId`, `cashMovementId`, `carriedFromPayoutId`, `payoutId`, `createdBy`, `createdAt`, `cancelledAt`, `cancelledBy`, `cancelReason`; únicos parciais (rule_id, day) e (cash_movement_id).
  - `comandas.debtCents integer not null default 0 ≥ 0`; `comandaItems.settlesComandaId` (fk comandas), `comandaItems.commissionHeld boolean not null default false`; `clientDebtEntries` → `client_debt_entries`: `id`, `contactId`, `comandaId` (a comanda da dívida), `deltaCents <> 0` (+ dívida, − quitação), `paidInComandaId`, `createdBy`, `createdAt`.
  - Tipos exportados: `PaymentFee`, `ComandaItemAssistant`, `CommissionPayout`, `ProfessionalAdjustment`, `ProfessionalAdjustmentRule`, `ClientDebtEntry`.
- Produz (`src/lib/permissions.ts`): `"caixa.dinheiro"`, `"caixa.outros"`, `"comissao.pagar"` em `PERMS`, `PERM_LABEL`, `PERM_HELP`, `PERM_GROUP` (por ora "Agenda e caixa"); `caixa.dinheiro` na lista `EQUIPE`; `comissao.pagar` e `caixa.outros` não opcionais na Gestão.

- [ ] **Step 1: Escrever os testes que falham** em `src/server/db/schema.test.ts`, num `describe("Fase A")`, com o `cols()` que já existe:

```ts
it("assistentes, taxas, regras, repasse, vales e dívida", async () => {
  expect(await cols("comanda_item_assistants")).toEqual(expect.arrayContaining(["comanda_item_id", "professional_id", "position", "base_cents", "bp", "commission_cents", "payout_id"]));
  expect(await cols("professional_services")).toContain("assistant_bp");
  expect(await cols("payment_fees")).toEqual(expect.arrayContaining(["method", "brand", "parcelado", "fee_bp"]));
  expect(await cols("comanda_payments")).toEqual(expect.arrayContaining(["fee_bp", "fee_cents"]));
  expect(await cols("comanda_items")).toEqual(expect.arrayContaining(["commission_gross_cents", "commission_deductions", "payout_id", "settles_comanda_id", "commission_held"]));
  expect(await cols("professionals")).toEqual(expect.arrayContaining(["commission_rules", "payout_period"]));
  expect(await cols("lists")).toContain("cost_cents");
  expect(await cols("commission_payouts")).toEqual(expect.arrayContaining(["number", "until_day", "net_cents", "carried_cents", "cancelled_at"]));
  expect(await cols("professional_adjustments")).toEqual(expect.arrayContaining(["kind", "rule_id", "cash_movement_id", "carried_from_payout_id", "payout_id"]));
  expect(await cols("professional_adjustment_rules")).toContain("day_of_month");
  expect(await cols("client_debt_entries")).toEqual(expect.arrayContaining(["comanda_id", "delta_cents", "paid_in_comanda_id"]));
  expect(await cols("comandas")).toContain("debt_cents");
});
it("taxas da Casa e regras da comissão vêm na migration", async () => {
  await resetDb();
  await runInserts("drizzle/0062_taxas_cartao.sql"); await runInserts("drizzle/0063_regras_comissao.sql");
  expect((await db.select().from(settings).where(eq(settings.key, "comissao_regras")))[0].value).toMatchObject({ cartao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", divida: "quitacao" });
  const fees = (await db.execute(sql`select method, brand, parcelado, fee_bp from payment_fees order by 1, 3, 2`)).rows;
  expect(fees).toEqual(expect.arrayContaining([{ method: "debito", brand: "visa", parcelado: false, fee_bp: 199 }, { method: "credito", brand: "mastercard", parcelado: false, fee_bp: 210 }, { method: "credito", brand: "hipercard", parcelado: true, fee_bp: 570 }]));
  expect(fees).toHaveLength(13);
});
```

Como o `resetDb` de outros arquivos trunca `payment_fees` e `settings`, o segundo teste reaplica os `INSERT` das duas migrations: `runInserts(file)` é um helper local que lê o arquivo, separa por `--> statement-breakpoint`, roda só os trechos que começam com `INSERT` (são idempotentes). Em `src/lib/permissions.test.ts`: `expect(PERMS).toEqual(expect.arrayContaining(["caixa.dinheiro", "caixa.outros", "comissao.pagar"]))`; a Recepção e a Atendente têm `caixa.dinheiro` e não têm `comissao.pagar` nem `caixa.outros`; `GESTAO_REQUIRED` contém as três.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/db/schema.test.ts src/lib/permissions.test.ts`
Expected: FAIL (colunas e tabelas não existem; permissões desconhecidas).

- [ ] **Step 3: Escrever as migrations, o journal, o schema e as permissões**

Uma migration por área, com as colunas e tabelas do bloco Interfaces e `--> statement-breakpoint` entre os comandos, como na 0055. Dados:
- 0062: as 13 taxas da decisão 7 (`INSERT … ON CONFLICT (method, brand, parcelado) DO NOTHING`).
- 0063: `INSERT INTO settings (key, value) VALUES ('comissao_regras', '{"cartao":"antes","antecipacao":"antes","antecipacaoBp":700,"custo":"depois","doisAssistentes":"metade","assistenteSaiDaPrincipalBp":10000,"divida":"quitacao"}') ON CONFLICT (key) DO NOTHING`.
- 0064: `CREATE SEQUENCE IF NOT EXISTS commission_payouts_number_seq` e `number integer not null default nextval(...)`; a fk `comanda_item_assistants.payout_id` é criada aqui.
- 0067: `array_append` de `caixa.dinheiro` em todo perfil com `caixa.operar` e de `caixa.outros` em todo perfil com `caixa.gerir`, só onde ainda não tem (decisão 15).

`_journal.json`: idx 59 a 65, tags `0061_…` a `0067_…`, `when` 1792370000000 a 1792430000000. `test/db.ts` e `e2e/reset.ts`: incluir `comanda_item_assistants, payment_fees, commission_payouts, professional_adjustments, professional_adjustment_rules, client_debt_entries` no `truncate`.

- [ ] **Step 4: Rodar e ver passar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/db/schema.test.ts src/lib/permissions.test.ts && npx tsc --noEmit`
Expected: PASS; tsc sem erros.

- [ ] **Step 5: Commit**

```bash
git add drizzle src/server/db test/db.ts e2e/reset.ts src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(caixa): banco da Fase A (assistentes, taxas, regras, repasse, vales, dívida) e permissões novas"
```

---

### Tarefa 2: contas puras (comissão com descontos, taxa, período de repasse)

**Arquivos:**
- Criar: `src/lib/commission-rules.ts`, `src/lib/commission-math.ts`, `src/lib/payout-period.ts` e os `.test.ts` de cada um
- Modificar: `src/lib/comanda-math.ts`, `src/lib/comanda-math.test.ts`

**Interfaces:**
- Consome: `commissionCents`, `splitDiscount` de `src/lib/comanda-math.ts`.
- Produz:
  - `commission-rules.ts`: `type DeductMode = "nao" | "antes" | "depois"`; `type CommissionRules = { cartao: DeductMode; antecipacao: DeductMode; antecipacaoBp: number; custo: DeductMode; doisAssistentes: "total" | "metade"; assistenteSaiDaPrincipalBp: number; divida: "agora" | "quitacao" }`; `type ProCommissionRules = Partial<Pick<CommissionRules, "cartao" | "antecipacao" | "custo">>`; `NEUTRAL_COMMISSION_RULES: CommissionRules` (nao, nao, 0, nao, "total", 0, "agora"); `readCommissionRules(v: unknown): CommissionRules` (campo inválido = o neutro); `readProCommissionRules(v: unknown): ProCommissionRules | null`; `effectiveRules(casa: CommissionRules, pro: ProCommissionRules | null): CommissionRules`; `DEDUCT_LABEL: Record<DeductMode, string>` = "Não descontar" / "Descontar antes de calcular" / "Descontar da comissão".
  - `commission-math.ts`: `type Deductions = { cartao: number; antecipacao: number; custo: number; assistentes: number }`; `type ItemCommissionInput = { baseCents: number; bp: number | null; cardFeeCents: number; anticipationCents: number; costCents: number; assistants: { professionalId: string; bp: number | null }[] }`; `type ItemCommission = { grossCents: number | null; deductions: Deductions; commissionCents: number | null; assistants: { professionalId: string; baseCents: number; bp: number | null; commissionCents: number | null }[] }`; `itemCommission(i: ItemCommissionInput, r: CommissionRules): ItemCommission`; `allocateByNet(nets: { id: string; total: number }[], amountCents: number): Map<string, number>`.
  - `comanda-math.ts`: `feeCents(valueCents: number, bp: number): number`.
  - `payout-period.ts`: `type PayoutPeriod = "mensal" | "quinzenal" | "semanal"`; `PAYOUT_PERIODS`; `PAYOUT_PERIOD_LABEL`; `lastClosedPeriodEnd(period: PayoutPeriod, today: string): string`.

Conta de `itemCommission` (decisões 3 e 4), que o teste fixa:
```
baseLíquida = max(0, base − Σ valores com modo "antes")
bruta       = bp == null ? null : commissionCents(base, bp)
efeito(d)   = "antes" → commissionCents(valor_d, bp) · "depois" → valor_d · "nao" → 0
assistente  = base da assistente = baseLíquida (ou metade dela com "metade" e 2 assistentes; a 1ª fica com floor)
              comissão = bp == null ? null : commissionCents(baseDela, bp)
assistentes = round(Σ comissões das assistentes × assistenteSaiDaPrincipalBp / 10000)
comissão    = bruta == null ? null : max(0, bruta − Σ efeitos − assistentes)
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// commission-math.test.ts
const CASA = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" } as const;
it("R$ 200 a 40%, crédito Visa 2,43%, antecipação 7%, custo R$ 10, uma assistente a 10%", () => {
  const r = itemCommission({ baseCents: 20000, bp: 4000, cardFeeCents: 486, anticipationCents: 1400, costCents: 1000, assistants: [{ professionalId: "s", bp: 1000 }] }, CASA);
  expect(r.grossCents).toBe(8000);
  expect(r.deductions).toEqual({ cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 });
  expect(r.assistants).toEqual([{ professionalId: "s", baseCents: 18114, bp: 1000, commissionCents: 1811 }]);
  expect(r.commissionCents).toBe(4435);
});
it("duas assistentes: metade divide a base (centavo ímpar na segunda); sobre o total não divide", () => {
  const two = [{ professionalId: "r", bp: 1000 }, { professionalId: "b", bp: 1000 }];
  const meio = itemCommission({ baseCents: 10001, bp: 4000, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: two }, CASA);
  expect(meio.assistants.map((a) => a.baseCents)).toEqual([5000, 5001]);
  expect(itemCommission({ baseCents: 10001, bp: 4000, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: two }, { ...CASA, doisAssistentes: "total" }).assistants.map((a) => a.baseCents)).toEqual([10001, 10001]);
});
it("neutro = como hoje; sem regra da principal fica null mas a assistente calcula; nunca negativa", () => {
  expect(itemCommission({ baseCents: 10800, bp: 4000, cardFeeCents: 300, anticipationCents: 700, costCents: 500, assistants: [] }, NEUTRAL_COMMISSION_RULES).commissionCents).toBe(4320);
  const semRegra = itemCommission({ baseCents: 10000, bp: null, cardFeeCents: 0, anticipationCents: 0, costCents: 0, assistants: [{ professionalId: "s", bp: 1000 }] }, CASA);
  expect([semRegra.commissionCents, semRegra.assistants[0].commissionCents]).toEqual([null, 1000]);
  expect(itemCommission({ baseCents: 1000, bp: 1000, cardFeeCents: 0, anticipationCents: 0, costCents: 5000, assistants: [] }, CASA).commissionCents).toBe(0);
});
// payout-period.test.ts (18/10/2026 é domingo)
it("fim do último período fechado", () => {
  expect(lastClosedPeriodEnd("mensal", "2026-10-18")).toBe("2026-09-30");
  expect(lastClosedPeriodEnd("quinzenal", "2026-10-18")).toBe("2026-10-15");
  expect(lastClosedPeriodEnd("quinzenal", "2026-10-15")).toBe("2026-09-30");
  expect(lastClosedPeriodEnd("semanal", "2026-10-18")).toBe("2026-10-17");
  expect(lastClosedPeriodEnd("semanal", "2026-10-17")).toBe("2026-10-10");
  expect(lastClosedPeriodEnd("mensal", "2026-03-01")).toBe("2026-02-28");
});
// commission-rules.test.ts
it("lê com o neutro no que falta e mescla a da profissional", () => {
  expect(readCommissionRules({ cartao: "antes", antecipacaoBp: -1, doisAssistentes: "x" })).toEqual({ ...NEUTRAL_COMMISSION_RULES, cartao: "antes" });
  expect(readProCommissionRules(null)).toBeNull();
  expect(effectiveRules({ ...NEUTRAL_COMMISSION_RULES, custo: "depois" }, { custo: "nao" }).custo).toBe("nao");
});
// comanda-math.test.ts
it("taxa do cartão arredonda como a comissão", () => { expect(feeCents(10000, 243)).toBe(243); expect(feeCents(12345, 199)).toBe(246); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/commission-math.test.ts src/lib/commission-rules.test.ts src/lib/payout-period.test.ts src/lib/comanda-math.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar as funções do bloco Interfaces** nos arquivos indicados. `allocateByNet` é `splitDiscount` com totais negativos tratados como 0 e montante 0 devolvendo zeros.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/commission-rules.ts src/lib/commission-rules.test.ts src/lib/commission-math.ts src/lib/commission-math.test.ts src/lib/payout-period.ts src/lib/payout-period.test.ts src/lib/comanda-math.ts src/lib/comanda-math.test.ts
git commit -m "feat(comissao): contas puras de comissão com descontos, taxa do cartão e período de repasse"
```

---

### Tarefa 3: taxa do cartão no caixa (item 2)

**Arquivos:**
- Criar: `src/server/domain/caixa/payment-fees.ts` (+ `.test.ts`), `src/components/servicos/card-fees.tsx` (+ `.test.tsx`), `test/comanda-fixtures.ts`
- Modificar: `src/server/domain/caixa/comandas.ts` (`addPayment`), `src/server/domain/caixa/payments.test.ts`, `src/server/queries/caixa.ts` (`ComandaDetail`, `getComandaDetail`), `src/components/caixa/payment-panel.tsx` (+ teste), `src/app/(app)/servicos/actions.ts`, `src/app/(app)/servicos/page.tsx`

**Interfaces:**
- Consome: `paymentFees`, `comandaPayments.feeBp/feeCents` (Tarefa 1); `feeCents` (Tarefa 2).
- Produz:
  - `listPaymentFees(): Promise<PaymentFee[]>`; `savePaymentFee(input: { method: "credito" | "debito"; brand: CardBrand; parcelado: boolean; feeBp: number | null }, actor: Actor): Promise<void>` (null apaga; audit `taxa_cartao` com `de`/`para`; erros "Use de 0% a 100%." e "Débito não tem parcelado."); `feeBpTx(q: Tx | Db, p: { method: string; brand: string | null; installments: number | null }): Promise<number | null>` (parcelado = `installments > 1`).
  - `ComandaDetail.payments[]` ganha `feeBp: number | null; feeCents: number | null`; `ComandaDetail` ganha `feeCents: number` (soma), `netCents: number` (= total − taxas) e `missingFeeBrands: string[]` (rótulos das bandeiras de cartão sem taxa).
  - `savePaymentFeeAction(input)` em `servicos/actions.ts` (`caixa.gerir`).
  - `test/comanda-fixtures.ts`: `comandaFechada(s, o: { items: { serviceId: string; professionalId: string; unitCents?: number }[]; pays: AddPaymentInput[]; contactId?: string; day?: string }): Promise<{ comandaId: string }>` (abre comanda avulsa, lança os itens e pagamentos com `s.caixaRecepcao`, fecha; `day` muda o "agora" para montar comandas de outros dias). A Tarefa 7 acrescenta `leaveDebt?: boolean`.

- [ ] **Step 1: Escrever os testes que falham** (`payment-fees.test.ts` e um `describe("taxa")` em `payments.test.ts`, com `setupCaixa` e fees inseridas no teste, porque o reset trunca `payment_fees`):

```ts
it("crédito à vista, parcelado e débito gravam a taxa do momento; mudar a taxa depois não mexe", async () => {
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao);
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: true, feeBp: 570 }, s.caixaGestao);
  // comanda de R$ 300: 100 à vista, 100 em 3x, 100 no débito Alelo (sem taxa)
  const p = await db.select().from(comandaPayments).orderBy(comandaPayments.createdAt);
  expect(p.map((x) => [x.method, x.feeBp, x.feeCents])).toEqual([["credito", 243, 243], ["credito", 570, 570], ["debito", null, null]]);
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 300 }, s.caixaGestao);
  const d = (await getComandaDetail(c.comandaId, s.cati.id))!;
  expect([d.feeCents, d.netCents, d.missingFeeBrands]).toEqual([813, 29187, ["Alelo"]]);
});
it("pix, dinheiro e cortesia não têm taxa; débito parcelado é recusado; taxa auditada", async () => {
  await savePaymentFee({ method: "debito", brand: "elo", parcelado: false, feeBp: 199 }, s.caixaGestao);
  // pix, dinheiro e cortesia lançados → fee_bp e fee_cents null
  await expect(savePaymentFee({ method: "debito", brand: "visa", parcelado: true, feeBp: 199 }, s.caixaGestao)).rejects.toThrow("Débito não tem parcelado.");
  await expect(savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 10001 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
  expect(await db.select().from(auditLog).where(eq(auditLog.action, "taxa_cartao"))).toHaveLength(1);
});
```

Teste de tela em `payment-panel.test.tsx`: com um pagamento de crédito com `feeCents: 243`, a linha mostra "taxa R$ 2,43"; o rodapé mostra "Taxas do cartão R$ 2,43" e "Líquido"; com `missingFeeBrands: ["Alelo"]`, aparece "Sem taxa cadastrada: Alelo". `card-fees.test.tsx`: a grade mostra Visa, Mastercard, Elo, Hipercard e Amex nas colunas "Débito", "Crédito à vista" e "Crédito parcelado", com o valor salvo em %, e salvar "2,43" chama a ação com `feeBp: 243`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/payment-fees.test.ts src/server/domain/caixa/payments.test.ts src/components/caixa/payment-panel.test.tsx src/components/servicos/card-fees.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar** as funções do bloco Interfaces; em `addPayment`, depois de travar a comanda, `feeBpTx` e `feeCents` gravados na linha do pagamento. `CardFeesEditor({ fees })` em `card-fees.tsx`, montado na aba Formas de pagamento abaixo do `PaymentOptionsEditor`, com título "Taxas do cartão": um `Input` de % por célula, salvo ao sair do campo, e "Outras bandeiras" listadas só quando há alguma salva. No `payment-panel`, a taxa entra na linha do pagamento e o rodapé ganha "Taxas do cartão" e "Líquido".

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa` (os testes antigos do caixa continuam verdes). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/caixa src/server/queries/caixa.ts src/components/caixa/payment-panel.tsx src/components/caixa/payment-panel.test.tsx src/components/servicos/card-fees.tsx src/components/servicos/card-fees.test.tsx src/app/\(app\)/servicos test/comanda-fixtures.ts
git commit -m "feat(caixa): taxa do cartão por bandeira e parcela, com líquido na comanda"
```

---

### Tarefa 4: assistente na comanda (item 1)

**Arquivos:**
- Criar: `src/server/domain/caixa/assistants.ts` (+ `.test.ts`), `src/components/caixa/assistants-field.tsx` (+ `.test.tsx`)
- Modificar: `src/server/domain/caixa/comandas.ts` (`addAppointmentItemsTx`, `addItem`, `updateItem`, `reopenForCorrection`), `src/server/queries/caixa.ts`, `src/server/queries/comanda-catalog.ts`, `src/app/(app)/caixa/actions.ts`, `src/components/caixa/comanda-panel.tsx`

**Interfaces:**
- Consome: `comandaItemAssistants` (Tarefa 1).
- Produz:
  - `MAX_ASSISTANTS = 2`; `suggestedAssistantsTx(q: Tx | Db, professionalId: string | null): Promise<string[]>` (ativas com `assistant_of` = ela, por nome, até 2); `fillSuggestedAssistantsTx(tx: Tx, itemId: string, professionalId: string | null, actorId: string): Promise<void>` (apaga as do item e põe as sugeridas); `setItemAssistants(itemId: string, input: { professionalIds: string[] }, actor: Actor, now?: Date): Promise<void>`.
  - Audit `assistente_alterado`, `entity: "comanda"`, `data: { numero, itemId, item, de: string[], para: string[] }` (nomes). A Tarefa 11 lê esse formato.
  - `ComandaDetail.items[]` ganha `assistants: { professionalId: string; name: string; position: 1 | 2 }[]`; o catálogo da comanda passa a levar `assistantOf: string | null` em cada profissional.
  - `setAssistantsAction(itemId: string, input: { professionalIds: string[] })` em `caixa/actions.ts` (`caixa.operar`).

- [ ] **Step 1: Escrever os testes que falham** (`assistants.test.ts`, com Ana principal e "Sidney" e "Roberta" com `assistantOf = ana.id` criadas no teste):

```ts
it("o serviço da Ana nasce com as assistentes dela; trocar para Bia troca as assistentes", async () => {
  const c = await openWalkInComanda({ clientName: "Paula", requestKey: randomUUID(), item: { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id } }, s.caixaRecepcao, NOW);
  const nomes = async () => (await getComandaDetail(c.comandaId, s.cati.id))!.items[0].assistants.map((a) => [a.name, a.position]);
  expect(await nomes()).toEqual([["Roberta", 1], ["Sidney", 2]]);
  await updateItem(itemId, { professionalId: s.bia.id }, s.caixaRecepcao, NOW);
  expect(await nomes()).toEqual([]);
});
it("até 2, sem repetir, nunca a própria profissional, só na comanda aberta; auditado com de/para", async () => {
  await expect(setItemAssistants(itemId, { professionalIds: [sidney.id, roberta.id, s.bia.id] }, s.caixaRecepcao)).rejects.toThrow("No máximo 2 assistentes por serviço.");
  await expect(setItemAssistants(itemId, { professionalIds: [s.ana.id] }, s.caixaRecepcao)).rejects.toThrow("A assistente não pode ser a própria profissional do serviço.");
  await setItemAssistants(itemId, { professionalIds: [sidney.id] }, s.caixaRecepcao);
  const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "assistente_alterado"));
  expect(a.data).toMatchObject({ item: "Corte", de: ["Roberta", "Sidney"], para: ["Sidney"] });
});
it("comanda que nasce do horário e a reaberta para corrigir levam as assistentes", async () => { /* openComandaForAppointment e reopenForCorrection → mesmas assistentes */ });
```

`assistants-field.test.tsx`: mostra "Sidney" e "Roberta" com botão "Tirar Sidney"; com 2, o "+ Assistente" some; o `Select` não oferece a profissional do item.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/assistants.test.ts src/components/caixa/assistants-field.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar** as funções do bloco Interfaces. As assistentes nascem só em `servico` e `pacote_sessao` com profissional: em `addAppointmentItemsTx` e `addItem` (depois do insert), em `updateItem` quando `professionalId` muda, e copiadas em `reopenForCorrection`. Erros: "Escolha a profissional do serviço antes da assistente." (item sem profissional) e o `assertOpen` que já existe. Na tela, `AssistantsField({ item, catalog, disabled, onChange })` fica embaixo do `Select` da profissional na linha do item aberto; fechada, a linha mostra "Ana com Sidney".

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa src/components/caixa`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/caixa src/server/queries/caixa.ts src/app/\(app\)/caixa/actions.ts src/components/caixa
git commit -m "feat(caixa): até 2 assistentes por serviço na comanda, já preenchidas pelo par da profissional"
```

---

### Tarefa 5: regras da comissão e retrato no Finalizar (itens 1 e 3, domínio)

**Arquivos:**
- Criar: `src/server/domain/caixa/commission-rules.ts` (+ `.test.ts`), `src/server/domain/caixa/commission-snapshot.ts` (+ `.test.ts`)
- Modificar: `src/server/domain/caixa/comandas.ts` (`closeComanda`, `undoCloseTx`), `src/server/domain/caixa/commission.ts` (+ teste), `src/lib/pro-earnings.ts`, `src/server/domain/agenda/ports.ts`, `src/server/domain/services.ts` (`ServiceInput.costCents`)

**Interfaces:**
- Consome: `itemCommission`, `allocateByNet`, `effectiveRules`, `readCommissionRules` (Tarefa 2); `comandaItemAssistants`, `professionalServices.assistantBp`, `professionals.commissionRules`, `lists.costCents`, `comandaItems.commissionGrossCents/commissionDeductions/commissionHeld` (Tarefa 1).
- Produz:
  - `getCommissionRules(q?: Tx | Db): Promise<CommissionRules>` (chave `comissao_regras`); `saveCommissionRules(input: CommissionRules, actor: Actor): Promise<void>`; `saveProfessionalCommissionRules(professionalId: string, input: ProCommissionRules | null, actor: Actor): Promise<void>`; `setAssistantCommission(input: { professionalId: string; serviceId: string; bp: number | null }, actor: Actor): Promise<void>`. Todas auditadas com `de`/`para` (`comissao_regras_casa`, `comissao_regras_profissional`, `comissao_assistente`). `antecipacaoBp` e `assistenteSaiDaPrincipalBp` de 0 a 10000.
  - `snapshotCommissionsTx(tx: Tx, o: { comanda: Comanda; items: ComandaItem[]; pays: ComandaPayment[]; totals: ComandaTotals; pkgs: Map<string, typeof clientPackages.$inferSelect>; held: boolean }): Promise<void>` e `clearCommissionSnapshotTx(tx: Tx, comandaId: string): Promise<void>`.
  - `CommissionStatus` ganha `"aguardando_quitacao"`; `CommissionLine` ganha `role: "principal" | "assistente"`, `principalName: string | null` (na linha da assistente), `grossCents: number | null`, `deductions: Deductions | null`, `payoutNumber: number | null`. O `commissionReport` passa a trazer as linhas de assistente na profissional assistente, rótulo `"{serviço} (assistente de {principal})"`. `CommissionLineLike` em `src/lib/pro-earnings.ts` acompanha.
  - `updateService(id, { costCents?: number | null })`.

- [ ] **Step 1: Escrever os testes que falham**

`commission-snapshot.test.ts` (Ana 40% no Corte, % da assistente 10%, Sidney assistente da Ana, Corte com custo R$ 10, taxa Visa à vista 2,43%, regras da Casa salvas com `saveCommissionRules`):

```ts
it("Corte R$ 200 no crédito Visa: o retrato guarda bruta, cada desconto, a assistente e o que fica para a Ana", async () => {
  const { comandaId } = await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }], pays: [{ method: "credito", valueCents: 20000, brand: "visa" }] });
  const [it] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId));
  expect([it.commissionBaseCents, it.commissionGrossCents, it.commissionDeductions, it.commissionCents]).toEqual([20000, 8000, { cartao: 194, antecipacao: 560, custo: 1000, assistentes: 1811 }, 4435]);
  expect((await db.select().from(comandaItemAssistants)).map((a) => [a.baseCents, a.bp, a.commissionCents])).toEqual([[18114, 1000, 1811]]);
});
it("regra própria da profissional vale só para ela; com as regras neutras o resultado é o de antes", async () => { /* Bia { custo: "nao" } → sem custo; neutro → 4800 */ });
it("reabrir apaga o retrato (inclusive das assistentes); fechar de novo refaz igual", async () => { /* reopenComanda → nulls; closeComanda → mesmos números */ });
```

`commission.test.ts` (novo `it`): o relatório traz, para Sidney, uma linha `role: "assistente"`, `label: "Corte (assistente de Ana)"`, `commissionCents: 1811`; e, para Ana, `deductions` e `grossCents` na linha. `commission-rules.test.ts`: `saveCommissionRules` recusa `antecipacaoBp: 10001` com "Use de 0% a 100%."; `setAssistantCommission` numa linha que ela não faz → "Ela não faz esse serviço: marque em Profissionais primeiro."; as três gravam audit com `de`/`para`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/commission-snapshot.test.ts src/server/domain/caixa/commission-rules.test.ts src/server/domain/caixa/commission.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `snapshotCommissionsTx` substitui o bloco "Comissão congelada (retrato)" de `closeComanda` (a base continua a de hoje: total − parte no desconto − parte na cortesia; sessão de pacote = valor da sessão × qtd). Taxa da comanda = Σ `fee_cents` vivos; antecipação = `feeCents(Σ crédito vivo, antecipacaoBp)` quando o modo não é "nao"; as duas rateadas por `allocateByNet` (decisão 5). Regra efetiva = `effectiveRules(casa, profissional)`; `% da assistente` da linha (principal, serviço). `held` vem `false` nesta tarefa (a Tarefa 7 liga). `undoCloseTx` chama `clearCommissionSnapshotTx` no lugar do update de hoje.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa src/server/queries/pro-earnings.test.ts`. Expected: PASS, inclusive `comandas-fechar.test.ts` sem mudar números (regras neutras no teste).

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/caixa src/lib/pro-earnings.ts src/server/domain/agenda/ports.ts src/server/domain/services.ts
git commit -m "feat(comissao): regras da Casa e da profissional e retrato com taxa, antecipação, custo e assistentes"
```

---

### Tarefa 6: regras da comissão na tela (item 3, tela) e custo do serviço

**Arquivos:**
- Criar: `src/app/(app)/caixa/comissao/actions.ts` (+ `.test.ts`), `src/components/caixa/commission-how.tsx` (+ `.test.tsx`)
- Modificar: `src/app/(app)/caixa/comissao/page.tsx`, `src/components/caixa/commission-rules.tsx` (+ teste), `src/components/caixa/commission-table.tsx`, `src/components/servicos/service-sheet.tsx`, `src/components/servicos/services-page.test.tsx`, `src/app/(app)/servicos/actions.ts`

**Interfaces:**
- Consome: Tarefa 5 (`getCommissionRules`, `saveCommissionRules`, `saveProfessionalCommissionRules`, `setAssistantCommission`, `CommissionLine`), `DEDUCT_LABEL` (Tarefa 2).
- Produz: em `caixa/comissao/actions.ts`, `saveCommissionRulesAction(input: CommissionRules)`, `saveProCommissionRulesAction(professionalId: string, input: ProCommissionRules | null)`, `setAssistantCommissionAction(input: { professionalId: string; serviceId: string; bp: number | null })`, todas com `config.sistema` e o mesmo `ActionResult` de `caixa/actions.ts`. `CommissionHow({ rules })`: o bloco "Como calcular a comissão" no topo da aba Regras.

- [ ] **Step 1: Escrever os testes que falham.** `commission-how.test.tsx`: mostra "Taxa do cartão", "Antecipação (7%)", "Custo do serviço", "Duas assistentes" ("Sobre o total" | "Metade") e "Quanto da assistente sai da principal" (100%), cada desconto com o `Segmented` de `DEDUCT_LABEL`, e "Comissão de comanda com dívida" ("Na hora" | "Quando ela pagar"); salvar chama a ação com o objeto inteiro. `commission-rules.test.tsx`: cada serviço tem "%" e "% da assistente"; cada profissional tem "Segue a Casa" ou "Regra própria". `actions.test.ts`: sem `config.sistema` → `{ ok: false }` com a mensagem de permissão do `run`. `services-page.test.tsx`: o serviço tem o campo "Custo (R$)" e salvar manda `costCents`. A tabela do relatório (`commission-table.tsx`) mostra, por linha, "Bruta", "Descontos" e "Comissão", e a linha de assistente com "(assistente de Ana)".

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/components/caixa/commission-how.test.tsx src/components/caixa/commission-rules.test.tsx src/app/\(app\)/caixa/comissao/actions.test.ts src/components/servicos/services-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar** as ações e os componentes do bloco Interfaces, com `Segmented`, `Input` e `Button` que já existem, e o campo "Custo (R$)" no `service-sheet` (junto do preço).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/caixa/comissao src/components/caixa src/components/servicos src/app/\(app\)/servicos
git commit -m "feat(comissao): tela de como calcular a comissão, % da assistente e custo do serviço"
```

---

### Tarefa 7: crédito e dívida da cliente (item 6)

**Arquivos:**
- Criar: `src/server/domain/caixa/debts.ts` (+ `.test.ts`)
- Modificar: `test/comanda-fixtures.ts`, `src/server/domain/caixa/comandas.ts` (`ITEM_KINDS`, `buildItemTx`, `closeComanda`, `undoCloseTx`), `src/server/domain/caixa/commission-snapshot.ts`, `src/server/domain/caixa/commission.ts`, `src/lib/pro-earnings.ts`, `src/server/queries/caixa.ts`, `src/server/reports/financeiro/itens.ts`, `src/app/(app)/caixa/actions.ts`, `src/components/caixa/payment-panel.tsx`, `src/components/caixa/comanda-panel.tsx` (+ testes)

**Interfaces:**
- Consome: `clientDebtEntries`, `comandas.debtCents`, `comandaItems.settlesComandaId/commissionHeld` (Tarefa 1); `getCommissionRules().divida` (Tarefa 5); `snapshotCommissionsTx(..., held)` (Tarefa 5).
- Produz:
  - `ITEM_KINDS` ganha `"divida"`; `AddItemInput.settlesComandaId?: string | null`; `comandaFechada()` (`test/comanda-fixtures.ts`) ganha `leaveDebt?: boolean`.
  - `debtBalance(contactId: string, q?: Tx | Db): Promise<number>`; `openDebts(contactId: string, q?: Tx | Db): Promise<{ comandaId: string; number: number; day: string; remainingCents: number }[]>`; `lockClientDebtTx(tx, contactId)`.
  - `closeComanda(comandaId, input: { saveChangeAsCredit?: boolean; leaveDebt?: boolean }, actor, now)`; retorno ganha `debtCents`.
  - `ComandaDetail` ganha `debts: { comandaId: string; number: number; day: string; remainingCents: number }[]` (as abertas da cliente, sem a própria comanda) e `debtCents`.
  - `closeComandaAction(comandaId, { saveChangeAsCredit?, leaveDebt? })`.
  - Linha do relatório com `status: "aguardando_quitacao"` (nunca somada), e `why` no app: "Espera a cliente quitar a dívida da comanda."

- [ ] **Step 1: Escrever os testes que falham** (`debts.test.ts`, regras com `divida: "quitacao"`, Ana 40% no Corte):

```ts
it("Finalizar com falta deixa dívida e retém a comissão; quitar em duas vezes libera só no fim", async () => {
  const p = await cliente("Paula Souza");
  const { comandaId } = await comandaFechada(s, { contactId: p.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [{ method: "pix", valueCents: 2000 }], leaveDebt: true });
  expect((await db.select().from(comandas).where(eq(comandas.id, comandaId)))[0].debtCents).toBe(10000);
  expect(await debtBalance(p.contactId)).toBe(10000);
  const linha = async () => (await commissionReport({ from: "2026-10-01", to: "2026-10-31" })).rows[0].lines[0].status;
  expect(await linha()).toBe("aguardando_quitacao");
  // comanda 2: item "divida" de 6000; comanda 3: o resto, 4000
  await expect(addItem(c3, { kind: "divida", settlesComandaId: comandaId, unitCents: 4001 }, s.caixaRecepcao, NOW)).rejects.toThrow("Passa do que falta da dívida (R$ 40,00).");
  expect(await linha()).toBe("ok");
  expect(await debtBalance(p.contactId)).toBe(0);
});
it("com a regra 'na hora', a comissão sai já; sem cliente não deixa dívida; reabrir desfaz a dívida", async () => {
  await expect(closeComanda(semCliente, { leaveDebt: true }, s.caixaRecepcao, NOW)).rejects.toThrow("Escolha a cliente para deixar a dívida.");
  // reopenComanda da comanda com dívida → debt_cents 0 e o lançamento + estornado; se já houve quitação: "Parte desta dívida já foi paga na comanda N."
});
it("troco continua indo para o crédito da cliente (regra antiga) e o item de dívida fica fora do faturamento por profissional", async () => { /* financeItens não lista kind "divida" */ });
```

Tela: `payment-panel.test.tsx` — com `remainingCents > 0`, cliente escolhida e itens finalizados, aparece "Deixar R$ 100,00 como dívida" e o Finalizar fica ativo quando marcado; `comanda-panel.test` (ou `comanda-sheet.test.tsx`) — com `debts` não vazio, aparece "Dívida anterior: R$ 100,00 (comanda 1 de 15/10)" e "Cobrar junto", que lança o item "Dívida da comanda 1 de 15/10".

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/debts.test.ts src/components/caixa/payment-panel.test.tsx src/components/caixa/comanda-sheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar.** `closeComanda` com `leaveDebt`: aceita pago < total só com cliente, grava `debt_cents` e o lançamento `+` com a trava da cliente; `held = debt > 0 && regra === "quitacao"`. Item `divida`: preço = o que falta daquela comanda (pode ser menor; maior é recusado), sem profissional, sem comissão, `fiscalKind "servico"` (a nota da Fase D ignora `divida`); ao Finalizar, lançamento `−` com `paidInComandaId`, e se a dívida daquela comanda zerou, `commission_held = false` nos itens dela. `undoCloseTx` desfaz o lançamento da própria comanda (recusa se já houve quitação) e devolve o que a comanda quitou.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa src/server/reports/financeiro`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/caixa src/lib/pro-earnings.ts src/server/queries/caixa.ts src/server/reports/financeiro/itens.ts src/app/\(app\)/caixa/actions.ts src/components/caixa
git commit -m "feat(caixa): dívida da cliente na comanda, quitação e comissão retida até ela pagar"
```

---

### Tarefa 8: vale, bônus e desconto na comissão (item 5)

**Arquivos:**
- Criar: `src/server/domain/caixa/adjustments.ts` (+ `.test.ts`), `src/components/caixa/adjustments-panel.tsx` (+ `.test.tsx`)
- Modificar: `src/server/domain/caixa/cash.ts` (`addMovement`, cancelar movimento), `src/server/domain/caixa/cash.test.ts`, `src/app/(app)/caixa/actions.ts` (`movementAction`), `src/app/(app)/caixa/comissao/actions.ts`, `src/app/(app)/caixa/comissao/page.tsx`, `src/components/caixa/movement-sheet.tsx`

**Interfaces:**
- Consome: `professionalAdjustments`, `professionalAdjustmentRules`, `cashMovements` (Tarefa 1); `checkCredentials` e `allow` (já existem).
- Produz:
  - `type AdjustmentKind = "vale" | "bonus" | "desconto"`; `ADJUSTMENT_LABEL = { vale: "Vale", bonus: "Bônus", desconto: "Desconto na comissão" }`.
  - `addAdjustment(input: { professionalId: string; kind: AdjustmentKind; valueCents: number; day: string; note: string }, actor: Actor, now?: Date): Promise<{ id: string }>`; `cancelAdjustment(id: string, input: { reason: string }, actor: Actor, now?: Date): Promise<void>` (recusa se `payoutId` ou se veio de sangria: "Cancele a sangria no caixa."); `saveAdjustmentRule(input: { id?: string | null; professionalId: string; kind: AdjustmentKind; valueCents: number; dayOfMonth: number; startsOn: string; endsOn?: string | null; note: string; active: boolean }, actor: Actor): Promise<{ id: string }>`; `materializeRulesTx(tx: Tx, untilDay: string, professionalId?: string): Promise<number>` (cria os do mês com `ON CONFLICT (rule_id, day) DO NOTHING`); `listAdjustments(o: { professionalId?: string; from: string; to: string }): Promise<...>`.
  - `addMovement(input: { kind; valueCents; reason; vale?: { professionalId: string; password: string } | null }, actor, now)`: a sangria com `vale` confere a senha do usuário da profissional e cria o vale ligado (`cashMovementId`). Audit `vale_pela_sangria`.
  - Ações em `caixa/comissao/actions.ts`, todas com `comissao.pagar`: `addAdjustmentAction`, `cancelAdjustmentAction`, `saveAdjustmentRuleAction`.

- [ ] **Step 1: Escrever os testes que falham** (`adjustments.test.ts` e `cash.test.ts`):

```ts
it("vale, bônus e desconto na comissão com motivo; regra 'todo mês no dia 5' cria um por mês, uma vez só", async () => {
  await expect(addAdjustment({ professionalId: s.ana.id, kind: "vale", valueCents: 5000, day: "2026-10-10", note: " " }, s.caixaGestao)).rejects.toThrow("Escreva o motivo.");
  await saveAdjustmentRule({ professionalId: s.ana.id, kind: "bonus", valueCents: 10000, dayOfMonth: 5, startsOn: "2026-08-01", note: "Meta de pacotes", active: true }, s.caixaGestao);
  await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"));
  await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"));
  expect((await db.select().from(professionalAdjustments)).map((a) => a.day).sort()).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
});
it("sangria vira vale com a senha da profissional; senha errada recusa; sem acesso ao app não deixa; cancelar a sangria cancela o vale", async () => {
  // Ana com users.user_id e senha "ana-123"; caixa da Cati aberto com R$ 200
  await expect(addMovement({ kind: "sangria", valueCents: 5000, reason: "vale", vale: { professionalId: s.ana.id, password: "errada" } }, s.caixaRecepcao)).rejects.toThrow("A senha de Ana não confere.");
  await addMovement({ kind: "sangria", valueCents: 5000, reason: "vale", vale: { professionalId: s.ana.id, password: "ana-123" } }, s.caixaRecepcao);
  expect((await db.select().from(professionalAdjustments))[0]).toMatchObject({ kind: "vale", valueCents: 5000, professionalId: s.ana.id });
  await expect(addMovement({ kind: "sangria", valueCents: 1000, reason: "vale", vale: { professionalId: s.bia.id, password: "x" } }, s.caixaRecepcao)).rejects.toThrow("Bia ainda não tem acesso ao app. Cadastre em Configurações › Profissionais.");
});
```

Tela: `adjustments-panel.test.tsx` mostra os lançamentos do período com "Vale", "Bônus" e "Desconto na comissão", o total de cada um, e o formulário com "Todo mês" (dia 1 a 28). `movement-sheet` (teste junto) mostra, na sangria, "É vale de uma profissional?" e o campo "Senha dela" quando escolhida.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/adjustments.test.ts src/server/domain/caixa/cash.test.ts src/components/caixa/adjustments-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar** o bloco Interfaces; limite de tentativas `allow("vale-senha:" + actor.id, 5)` na ação ("Muitas tentativas. Espere alguns minutos."). Na página da Comissão, o `AdjustmentsPanel` entra como aba "Lançamentos" (só com `comissao.pagar`).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/caixa src/app/\(app\)/caixa src/components/caixa
git commit -m "feat(comissao): vale, bônus e desconto na comissão, avulsos ou todo mês, e a sangria que vira vale"
```

---

### Tarefa 9: pagar a comissão, recibo e app da profissional (item 4)

**Arquivos:**
- Criar: `src/server/domain/caixa/payouts.ts` (+ `.test.ts`), `src/components/caixa/payout-sheet.tsx`, `payout-receipt.tsx`, `payouts-list.tsx` (+ `payout-receipt.test.tsx`), `src/app/(app)/caixa/comissao/recibo/[id]/page.tsx`, `src/app/(pro)/pro/ganhos/recibo/[id]/page.tsx`
- Modificar: `src/server/domain/caixa/comandas.ts` (`undoCloseTx`, `cancelComanda`), `src/app/(app)/caixa/comissao/actions.ts`, `src/app/(app)/caixa/comissao/page.tsx`, `src/components/caixa/commission-table.tsx`, `src/server/queries/pro-earnings.ts`, `src/app/(pro)/pro/ganhos/page.tsx`, `src/components/pro/earnings-view.tsx`, `src/server/domain/professionals.ts` (`payoutPeriod`), `src/components/config/professional-sheet.tsx`

**Interfaces:**
- Consome: `commissionPayouts`, `comandaItems.payoutId`, `comandaItemAssistants.payoutId`, `professionalAdjustments.payoutId/carriedFromPayoutId` (Tarefa 1); `lastClosedPeriodEnd` (Tarefa 2); `materializeRulesTx` (Tarefa 8); `commissionHeld` (Tarefa 7).
- Produz:
  - `type Payable = { professionalId: string; name: string; fromDay: string | null; untilDay: string; lines: { kind: "item" | "assistente"; id: string; day: string; comandaNumber: number; clientName: string; label: string; commissionCents: number }[]; adjustments: { id: string; kind: AdjustmentKind; day: string; valueCents: number; note: string }[]; pending: { day: string; label: string; why: "sem_regra" | "sem_valor_sessao" | "aguardando_quitacao" }[]; totals: { commissionCents: number; bonusCents: number; valesCents: number; descontosCents: number; netCents: number } }`.
  - `payableFor(o: { professionalId: string; until: string }): Promise<Payable>` (comandas fechadas até `until`, item vivo, não retido, com comissão, sem `payoutId`; mais as linhas de assistente; mais lançamentos não cancelados e não pagos até `until`, depois de `materializeRulesTx`).
  - `payCommission(input: { professionalId: string; until: string; expectedNetCents: number; note?: string | null }, actor: Actor, now?: Date): Promise<{ id: string; number: number; netCents: number }>`; trava `lockKeyTx(tx, "repasse:" + professionalId)`.
  - `undoPayout(id: string, input: { reason: string }, actor: Actor, now?: Date): Promise<void>`.
  - `listPayouts(o: { professionalId?: string; limit?: number }): Promise<PayoutRow[]>`; `getPayoutReceipt(id: string): Promise<PayoutReceipt | null>` (`PayoutReceipt` = o `Payable` congelado + `number`, `paidAt`, `paidByName`, `carriedCents`, `cancelledAt`).
  - `PaidCommissionError` com a mensagem da decisão 11; `undoCloseTx` e `cancelComanda` recusam com ela.
  - Ações (`comissao.pagar`): `payableAction(professionalId, until)`, `payCommissionAction(input)`, `undoPayoutAction(id, { reason })`.
  - `getProEarnings` ganha `receipts: { id: string; number: number; paidAt: string; netCents: number }[]`.

- [ ] **Step 1: Escrever os testes que falham** (`payouts.test.ts`, Ana 40% no Corte):

```ts
it("a pagar até 30/09: comissões + bônus − vales − desconto; paga, numera e some do a pagar", async () => {
  // comanda de 20/09 (Corte 12.000 → 4.800), vale de 1.000 em 25/09, bônus 500 em 28/09, comanda de 02/10 (fora)
  const p = await payableFor({ professionalId: s.ana.id, until: "2026-09-30" });
  expect(p.totals).toEqual({ commissionCents: 4800, bonusCents: 500, valesCents: 1000, descontosCents: 0, netCents: 4300 });
  const r = await payCommission({ professionalId: s.ana.id, until: "2026-09-30", expectedNetCents: 4300 }, s.caixaGestao);
  expect(r).toMatchObject({ number: 1, netCents: 4300 });
  expect((await payableFor({ professionalId: s.ana.id, until: "2026-09-30" })).lines).toEqual([]);
});
it("dois cliques ao mesmo tempo: um recibo só", async () => { // só a comanda de 20/09, sem lançamentos
  const both = await Promise.allSettled([1, 2].map(() => payCommission({ professionalId: s.ana.id, until: "2026-09-30", expectedNetCents: 4800 }, s.caixaGestao)));
  expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(commissionPayouts)).toHaveLength(1);
});
it("valor mudou desde que abriu: recusa com o novo valor", async () => {
  await expect(payCommission({ professionalId: s.ana.id, until: "2026-09-30", expectedNetCents: 9999 }, s.caixaGestao)).rejects.toThrow("O valor mudou desde que você abriu (agora R$ 48,00). Confira de novo.");
});
it("vales maiores que a comissão: recibo de R$ 0 e o saldo vira desconto na comissão do dia seguinte; desfazer devolve tudo", async () => {
  // comissão 4.800, vale 6.000 → net 0, carried 1.200, desconto de 1.200 em 2026-10-01 "Saldo do recibo nº 1"
  await undoPayout(id, { reason: "pago errado" }, s.caixaGestao);
  // linhas e vale voltam ao a pagar; o desconto levado é cancelado
});
it("comanda com comissão paga não reabre nem cancela", async () => {
  await expect(reopenComanda(comandaId, { reason: "preço" }, s.caixaGestao, NOW)).rejects.toThrow("A comissão de Ana desta comanda já foi paga no recibo nº 1. Desfaça o pagamento em Comissão antes.");
});
it("assistente recebe pelo próprio recibo; comissão retida pela dívida não entra", async () => { /* Sidney: linha "assistente"; item retido em pending */ });
```

Tela: `payout-receipt.test.tsx` mostra "Recibo nº 1", o período, "Comissões", "Como assistente", "Bônus", "Vales", "Desconto na comissão", "Saldo levado" (só quando há) e "Total pago", sem o valor do serviço. A página `/pro/ganhos/recibo/[id]` de outra profissional dá `notFound()` (teste em `pro-earnings.test.ts` pela função que a página usa).

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa/payouts.test.ts src/components/caixa/payout-receipt.test.tsx src/server/queries/pro-earnings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** o bloco Interfaces. Na página da Comissão: abas Relatório · A pagar · Pagas · Lançamentos · Regras (as que a permissão deixa). "A pagar" é o resumo por profissional (nome, até quando, total) e "Pagar" abre o `PayoutSheet` com o recibo em prévia e "Confirmar pagamento"; "Pagas" é o `PayoutsList` com "Abrir recibo" e "Desfazer" (motivo). O recibo abre em página própria com `window.print()` no botão "Imprimir". No `/pro/ganhos`, a seção "Recibos" lista os dela. O período de repasse vai no cadastro da profissional (`Select` "Repasse": Mensal, Quinzenal, Semanal).

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/domain/caixa src/server/queries`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain src/server/queries/pro-earnings.ts src/app/\(app\)/caixa/comissao src/app/\(pro\)/pro/ganhos src/components/caixa src/components/pro src/components/config/professional-sheet.tsx
git commit -m "feat(comissao): pagar a comissão com recibo, histórico de pagas e recibo no app da profissional"
```

---

### Tarefa 10: Financeiro com taxa e líquido (item 2, Financeiro) — trilha B

**Arquivos:**
- Modificar: `src/server/queries/caixa-pagamentos.ts` (+ teste), `src/server/reports/financeiro/entradas.ts` (+ teste), `src/server/reports/financeiro/xlsx.ts` (+ teste), `src/components/reports/financeiro.tsx`, `src/lib/report-legend.ts`

**Interfaces:**
- Consome: `comandaPayments.feeCents` (Tarefa 1). Os testes inserem pagamentos com `fee_cents` direto; não depende da Tarefa 3.
- Produz: `MethodTotal.feeCents: number`; `FinanceMethod.crmFeeCents: number`; `Side` ganha `taxasCents: number` e `liquidoCents: number` (no lado Avec, `taxasCents: 0` e `liquidoCents` = entradas, com a nota "o Avec não manda a taxa"); na tela, Entradas ganha os `Fig` "Taxas do cartão no CRM" e "Líquido no CRM"; Formas ganha as colunas "Taxa (CRM)" e "Líquido (CRM)"; a aba Formas do Excel ganha as mesmas colunas.

- [ ] **Step 1: Escrever os testes que falham.** `caixa-pagamentos.test.ts`: dois créditos de 10.000 com `fee_cents` 243 e 570 e um Pix de 5.000 → `paymentsByMethod` dá crédito `{ valueCents: 20000, feeCents: 813 }` e Pix `feeCents: 0`; pagamento estornado não soma taxa. `entradas.test.ts`: `crm.taxasCents === 813` e `crm.liquidoCents === crm.entradasCents - 813`; a diferença CRM − Avec continua pelo bruto. `xlsx.test.ts`: a aba "Formas" tem os cabeçalhos "Taxa (CRM)" e "Líquido (CRM)".

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/queries/caixa-pagamentos.test.ts src/server/reports/financeiro`
Expected: FAIL.

- [ ] **Step 3: Implementar** os campos do bloco Interfaces (taxa = `coalesce(sum(fee_cents), 0)` nos mesmos filtros `live()`), e a legenda nova em `report-legend.ts` ("Líquido = entradas menos a taxa do cartão gravada em cada pagamento").

- [ ] **Step 4: Rodar e ver passar** (mesmo comando). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/caixa-pagamentos.ts src/server/queries/caixa-pagamentos.test.ts src/server/reports/financeiro src/components/reports/financeiro.tsx src/lib/report-legend.ts
git commit -m "feat(financeiro): taxa do cartão e líquido do CRM, sem somar com o Avec"
```

---

### Tarefa 11: Exceções completas, a auditoria na tela (item 7) — trilha B

**Arquivos:**
- Criar: `src/app/(app)/relatorios/excecoes/page.tsx`, `src/components/reports/excecoes-page.tsx`
- Modificar: `src/server/reports/financeiro/excecoes.ts` (+ teste), `src/server/reports/financeiro/index.ts`, `src/components/reports/financeiro.tsx`, `src/components/reports/salon-period-picker.tsx`

**Interfaces:**
- Consome: audit `assistente_alterado` no formato da Tarefa 4 (os testes inserem a linha de audit direto).
- Produz:
  - `ExceptionKind` ganha `"profissional_trocada"` ("Profissional diferente da agenda") e `"assistente_alterado"` ("Assistente trocada"); `item_cancelado` passa a valer também em comanda aberta.
  - `exceptionCounts(list: FinanceException[]): { kind: ExceptionKind; label: string; count: number }[]` (para o resumo).
  - `SalonPeriodPicker` ganha `path?: string` (padrão `"/relatorios"`).
  - Página `/relatorios/excecoes?de=&ate=&tipo=` com `requirePerm` igual ao Financeiro (`relatorios.ver` + `valores.ver`), título "Exceções", filtro por tipo (`Select`) e a lista inteira, sem o corte de 60.

- [ ] **Step 1: Escrever os testes que falham** em `excecoes.test.ts`:

```ts
it("profissional diferente entre o horário e a comanda fechada, com as duas", async () => {
  // horário com Ana; item da comanda fechada com Bia
  expect(list.find((x) => x.kind === "profissional_trocada")).toMatchObject({ item: "Corte", reason: "Agenda: Ana · Comanda: Bia" });
});
it("assistente trocada (do audit) e item cancelado em comanda aberta entram", async () => {
  expect(list.filter((x) => x.kind === "assistente_alterado").map((x) => x.reason)).toEqual(["De Roberta, Sidney para Sidney"]);
  expect(list.some((x) => x.kind === "item_cancelado" && x.comanda === "2")).toBe(true); // comanda 2 ainda aberta
});
it("contagem por tipo para o resumo", () => {
  expect(exceptionCounts(list)).toEqual(expect.arrayContaining([{ kind: "profissional_trocada", label: "Profissional diferente da agenda", count: 1 }]));
});
```

Teste de tela (em `src/components/reports/financeiro` ou junto da página): a seção Exceções do Financeiro mostra a contagem por tipo e o link "Ver todas" para `/relatorios/excecoes` com o mesmo período.

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/server/reports/financeiro/excecoes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** o bloco Interfaces; a seção Exceções do Financeiro vira o resumo (contagem por tipo + as 5 mais recentes) com "Ver todas"; a lista inteira mora na página nova, com o mesmo `DataList`.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/server/reports src/lib/ui-terms.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/reports/financeiro src/components/reports src/app/\(app\)/relatorios/excecoes
git commit -m "feat(financeiro): página de Exceções com profissional diferente da agenda, assistente trocada e itens cancelados"
```

---

### Tarefa 12: permissões por área e caixa no escuro (item 8)

**Arquivos:**
- Modificar: `src/lib/permissions.ts` (+ teste), `src/components/config/profiles-editor.tsx`, `src/server/queries/caixa.ts` (`isBlindFor`, `listCashSessions`) (+ `caixa.test.ts`), `src/server/queries/fechar-dia.ts`, `src/server/domain/caixa/cash.ts` (mensagem da sangria), `src/components/shell/nav.ts`, `src/app/(app)/caixa/equipe/page.tsx`, `src/app/(app)/caixa/fechamentos/page.tsx`, `src/app/(app)/caixa/comissao/page.tsx`

**Interfaces:**
- Consome: as três permissões da Tarefa 1; `comissao.pagar` já usada nas Tarefas 8 e 9.
- Produz:
  - `PermGroup = "Conversas" | "Agenda" | "Caixa" | "Comissão" | "Visões" | "Clientes" | "Relatórios" | "Gestão"`; `PERM_GROUP` com `agenda.*` e `pro.app` em Agenda; `caixa.*` e `servicos.editar` em Caixa; `comissao.*` e `pro.ganhos` em Comissão.
  - `PERM_OTHERS: Partial<Record<PermGroup, Perm>> = { Conversas: "atendimento.todas", Caixa: "caixa.outros", "Comissão": "comissao.ver", "Relatórios": "relatorios.equipe" }`; o editor de perfis mostra um `Badge` "ver de outras" nessas.
  - `isBlindFor(rules, viewer) = !can(viewer.perms, "caixa.gerir") && (rules.contagemCega || !can(viewer.perms, "caixa.dinheiro"))`.
  - `caixa.outros` guarda Caixas da equipe (página e menu) e a lista de Fechamentos de todas; `caixa.gerir` continua para aprovar, fechar o de outra pessoa, reabrir e as regras. `/caixa/comissao` abre com `comissao.ver`, `comissao.pagar` ou `config.sistema`.

- [ ] **Step 1: Escrever os testes que falham.** `permissions.test.ts`: cada `PERM_OTHERS[g]` tem `PERM_GROUP === g`; nenhum perm fica em "Agenda e caixa"; a ajuda de `caixa.gerir` não fala mais em "ver os caixas da equipe". `caixa.test.ts` (função pura):

```ts
it("caixa no escuro por perfil", () => {
  const regras = { ...DEFAULT_CAIXA_RULES, contagemCega: false };
  expect(isBlindFor(regras, { perms: ["caixa.operar", "caixa.dinheiro"] })).toBe(false);
  expect(isBlindFor(regras, { perms: ["caixa.operar"] })).toBe(true);
  expect(isBlindFor({ ...regras, contagemCega: true }, { perms: ["caixa.operar", "caixa.dinheiro"] })).toBe(true);
  expect(isBlindFor({ ...regras, contagemCega: true }, { perms: ["caixa.gerir"] })).toBe(false);
});
it("Fechamentos: com caixa.outros vê os de todas; sem, só os próprios", async () => { /* listCashSessions */ });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$TDB npx vitest run src/lib/permissions.test.ts src/server/queries/caixa.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar** o bloco Interfaces. A mensagem da sangria em `cash.ts` passa a usar a mesma regra de `isBlindFor`. O menu "Caixas da equipe" troca `perm: "caixa.gerir"` por `"caixa.outros"`.

- [ ] **Step 4: Rodar e ver passar** (mesmo comando) e `DATABASE_URL=$TDB npx vitest run src/lib src/server/queries src/components/config src/components/shell`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts src/components/config/profiles-editor.tsx src/server/queries src/server/domain/caixa/cash.ts src/components/shell/nav.ts src/app/\(app\)/caixa
git commit -m "feat(permissoes): áreas Agenda, Caixa e Comissão, ver de outras e caixa no escuro por perfil"
```

---

### Tarefa 13: e2e, capturas e verificação final

**Arquivos:**
- Criar: `e2e/fase-a.spec.ts`
- Modificar: `src/lib/ui-terms.test.ts` (só se algum termo novo precisar de `PERMITIDOS`, com motivo)

**Interfaces:**
- Consome: todas as tarefas anteriores.

- [ ] **Step 1: Escrever o e2e que falha** (`e2e/fase-a.spec.ts`, desktop e celular): a gestão cadastra a taxa Visa 2,43% em Serviços e pacotes › Formas de pagamento; a recepção abre a comanda do Corte da Ana, vê "Sidney" como assistente, recebe R$ 120 no crédito Visa, vê "Taxas do cartão R$ 2,92" e "Líquido", e Finaliza; outra comanda fica com "Deixar R$ … como dívida"; a gestão lança um vale de R$ 50 para a Ana em Comissão › Lançamentos, abre "A pagar", paga, abre o recibo; a Ana entra no `/pro/ganhos` e vê o recibo; Relatórios › Financeiro mostra "Líquido no CRM" e "Ver todas" abre Exceções. Capturas em segundo plano de cada tela em `CF_SHOTS_DIR`.

- [ ] **Step 2: Rodar e ver falhar, depois passar**

Run: `DATABASE_URL=postgresql://crm:crm_local_dev@localhost:5433/crm_e2e_fasea E2E_PORT=3520 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test e2e/fase-a.spec.ts --project=setup --project=desktop --project=mobile`
Expected: PASS (headless).

- [ ] **Step 3: Verificação completa**

Run: `DATABASE_URL=$TDB npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 0 falhas, tsc e eslint limpos. Conferir também `DATABASE_URL=$TDB npx vitest run src/lib/ui-terms.test.ts` (nenhum nome duplicado novo).

- [ ] **Step 4: Revisão** com superpowers:requesting-code-review sobre a branch inteira, olhando o "Foco da revisão" acima.

- [ ] **Step 5: Commit**

```bash
git add e2e/fase-a.spec.ts src/lib/ui-terms.test.ts
git commit -m "test(e2e): Fase A de ponta a ponta (taxa, assistente, dívida, vale, pagar a comissão, exceções)"
```

---

## Antes de ligar em produção (fora do código, para o dono)

- Conferir em Configurações › Profissionais os pares de assistente: Sidney → Thaise, Roberta → Gilvan, Bebel → Gilvan.
- Preencher em Comissão › Regras o "% da assistente" das principais e o "Custo" dos serviços que têm custo.
- Conferir as taxas e as regras que a migration trouxe (decisões 6 e 7).
- Dar acesso ao app às profissionais que pegam vale no balcão.

## Nota de integração (coordenador, 18/10)
Os números e os `when` das migrations destas fases se cruzam (A usa 0061–0067 até 1792430000000; B, C e D começam em 1792380000000, 1792390000000 e 1792400000000). Ao juntar uma fase em `ia-sugestao`, renumere as migrations dela para depois da última já integrada, com `when` maior que todos, e reindexe o `_journal.json`. O drizzle pula migration com `when` menor que a última aplicada.

## Regra do dono para todas as fases (18/10, vale acima de qualquer padrão deste plano)
- **Tudo configurável:** todo número de regra (porcentagens, taxas, prazos, horários, limites, quantidades) fica editável em Configurações, com o padrão deste plano como valor inicial. Nada fica fixo no código.
- **Todo texto que a cliente ou a equipe recebe** (mensagens, avisos, recibos, perguntas) fica editável em Configurações, com variáveis e botão "Usar o texto sugerido".
- **Toda funcionalidade nova nasce com um liga/desliga** em Configurações. O que manda mensagem para a cliente nasce **desligado**.
- **Toda ação nova tem uma permissão própria**, atribuível por perfil em Configurações › Pessoas › Perfis. O padrão dos perfis segue este plano.
- Teste em cada tarefa: mudar a configuração muda o comportamento, e sem a permissão a ação é recusada no servidor.
