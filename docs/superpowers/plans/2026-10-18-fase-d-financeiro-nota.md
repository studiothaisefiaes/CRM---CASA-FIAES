# Fase D: Financeiro da Casa e nota fiscal (itens 26 a 30), plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** fechar o motivo financeiro e fiscal para a Casa depender do Avec. São cinco entregas: contas a pagar, fluxo de caixa e DRE, produtos e estoque com baixa pela comanda, mapa de calor e ocupação, e nota fiscal. A NFS-e sai pelo Emissor Nacional e a NFC-e sai pela SEFAZ-BA, as duas atrás de uma chave.

**Arquitetura:**
- Relatórios › Financeiro ganha quatro vistas (`?vista=`), cada uma com uma pergunta: Entradas (a tela de hoje), Contas a pagar, Resultado e Notas fiscais.
- Despesas, categorias e contas bancárias são tabelas novas. O Resultado lê as entradas que já existem (`financeEntradas`) e as despesas, e mostra o CRM e o Avec em colunas separadas, sem somar.
- Produtos têm cadastro próprio, e o estoque é a soma de `stock_movements`, como o crédito da cliente.
- A nota fiscal fica em `src/server/domain/fiscal/`. O caminho é: rascunho puro (`NfseDraft`), XML da DPS, assinatura, cliente da Sefin Nacional com mTLS, e uma fila no worker que nunca envia duas vezes. A NFC-e é o módulo do Norte Vendas portado.
- A chave `nfse_modo` / `nfce_modo` tem três estados: `desligada`, `teste` (Produção Restrita / homologação) e `producao`.

**Tecnologias:** Next.js 16 (App Router; leia `node_modules/next/dist/docs/` antes de escrever código, como pede o AGENTS.md), React 19, Drizzle ORM com Postgres e migrations SQL escritas à mão, pg-boss (worker), Vitest (banco real `crm_test`, `fileParallelism: false`), ExcelJS. Dependências novas, só na Task 11: `node-forge` e `xml-crypto` (as mesmas do Norte Vendas).

**Specs:**
- `docs/superpowers/specs/2026-10-18-o-que-falta-design.md` (seção "Fase D"), sobre a base `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`.
- Pesquisa fiscal: `~/ClaudeGerado/casa-fiaes-nfse-salvador-2026-10-17.md` (seções 1.2, 2.2, 4 e 5).
- Avec por dentro: `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18.md` (seções 4, 5 e 11) e `...-parte2.md` (Produtos, Financeiro, Nota Fiscal).
- Código a reaproveitar, só leitura: `/Users/joaquimsalles/Projects/norte para negocios/ntb vendas/lib/fiscal/*`.

## Global Constraints

- Todo texto de tela, de erro e de nota fiscal é em PT-BR.
- **Um nome para cada coisa:** "Comanda", "Comissão", "Contas a pagar", "Despesa", "Produto", "Estoque", "Nota fiscal". A palavra "cota-parte" só aparece no texto da NFS-e e no extrato da parceira; nas telas do CRM o nome continua "Comissão".
- **Uma pergunta por tela.** Cada vista nova tem um título-pergunta:
  - Contas a pagar: "O que a Casa tem para pagar?"
  - Resultado: "Quanto sobrou no mês?"
  - Notas fiscais: "Que notas saíram?"
  - Ocupação: "Quando a Casa enche e quem está livre?"
  - Configurações › Nota fiscal: "Como a Casa emite nota fiscal?"
- **O desenho atual não muda.** Use só os blocos que já existem: `Section`, `DataList`, `Fig`, `Muted`, `Tabs`, `SalonPeriodPicker`, as folhas laterais (`*-sheet.tsx`) e os tokens de cor. Nenhuma cor ou fonte nova.
- **Avec e CRM juntos:** todo número que existe nos dois lados aparece em duas colunas, "CRM" e "Avec", e **nunca somado**. As despesas só existem no CRM e entram iguais nas duas colunas do Resultado.
- **Caixa por pessoa:** nada desta fase muda `cash_sessions`. Os pagamentos continuam no caixa de quem recebeu.
- **Dinheiro sempre em centavos inteiros (`integer`).** Percentual em pontos-base (`4000` = 40%). Quantidade de estoque em `numeric` (aceita 0,5 frasco).
- **Fuso:** os dias são de Salvador (`America/Bahia`). Use `todayBahia`, `dayOf` e `salonRange`, que já existem.
- **Migrations:** só na faixa **0090–0099**, SQL escrito à mão em `drizzle/NNNN_nome.sql` com `IF NOT EXISTS`, e uma entrada no fim de `drizzle/meta/_journal.json`:
  - `idx` = último idx + 1;
  - `when` fixo por migration: 0090 → `1792400000000`, 0091 → `1792410000000`, 0092 → `1792420000000`, 0093 → `1792430000000`;
  - `version` = `"7"` e `breakpoints` = `true`.
  - Toda tabela nova entra no `truncate` de `test/db.ts › resetDb`.
- **Segredos** (certificado A1 e senha, CSC e ID do CSC) só no `.env` do servidor e no cofre. Nunca no banco nem no repositório. O `.env.example` recebe só os nomes, comentados e sem valor.
- **Erros que a pessoa vê:** use `UserFacingError` com frase completa em PT-BR. Toda ação de gestão grava `audit_log` com `de` e `para`.
- **Permissões:**
  - entra uma permissão nova, `financeiro.lancar` ("Lançar e pagar despesas"), que só a Gestão recebe (`GESTAO_REQUIRED` já pega todas);
  - ver o Financeiro continua pedindo `valores.ver`;
  - emitir nota usa `caixa.operar`;
  - cancelar nota e mudar a chave fiscal usam `caixa.gerir` e `config.sistema`.
- **A Fase A vem antes e mexe em `closeComanda`** (assistente, taxa por bandeira, comissão com descontos). Antes da Task 9, leia o `closeComanda` da `main` e encaixe os snapshots novos depois do cálculo de comissão que estiver lá.
- **Testes:** `npx vitest run <arquivo>` passa, e `npm run typecheck` e `npm run lint` passam no fim de cada tarefa.

## Review Focus

1. **Comanda reaberta ou cancelada depois da nota autorizada.** A pessoa espera que o sistema não deixe a nota "solta": reabrir, reabrir para correção ou cancelar a comanda pede antes "cancele a nota". Teste na Task 12.
2. **Queda de rede ou timeout no envio da NFS-e.** A pessoa espera uma nota só, mesmo clicando de novo ou com o worker tentando de novo. Antes de reenviar, o sistema consulta a DPS pelo Id. Testes nas Tasks 11 e 12.
3. **Venda de produto sem estoque.** O caixa não trava: a venda fecha, o estoque fica negativo e a lista de produtos mostra "Estoque negativo". Teste na Task 5.
4. **Despesa mensal com vencimento no dia 31.** Fevereiro vence no último dia do mês (28 ou 29), não em 3 de março. Teste na Task 1.
5. **Período em que a Casa recebeu no Avec e no CRM.** O Resultado nunca soma os dois lados, e a mesma despesa aparece nas duas colunas. Teste na Task 3.

---

## O que depende do contador e da Casa, e o que dá para construir já

| Bloco | Tarefas | Depende de |
|---|---|---|
| **Já** (sem ninguém de fora) | 1 a 10 | nada: tudo funciona com a chave fiscal desligada |
| **Atrás da chave, em teste** | 11 e 12 (NFS-e na Produção Restrita) | certificado e-CNPJ A1 da Casa no `.env`, e o primeiro acesso da Casa no nfse.gov.br |
| **Atrás da chave, em produção** | ligar `nfse_modo = producao` | o contador confirmar o regime (Simples), a IM, o cTribNac/NBS, a alíquota efetiva e o modelo de nota unificada do Salão Parceiro em Salvador; os contratos das parceiras homologados e o CNPJ de cada uma |
| **NFC-e** | 13 | inscrição estadual e CNAE de comércio (4772-5/00), o CSC da SEFAZ-BA e o certificado A1 |

A partir de 01/11/2026, enquanto a chave estiver desligada, a Task 10 entrega o **rascunho da nota para copiar** no emissor web (nfse.gov.br). É o passo 5 da pesquisa.

## Ordem e paralelismo

```
Trilha A (Financeiro):   T1 → T2 ─┐
Trilha B (Estoque):      T5 ──────┼→ T3 → T4      T5 → T6 → T7
Trilha D (Nota fiscal):  T9 ──────┘   T9 → T10 → T11 → T12 → T13 (T13 espera também T5)
Trilha C (Salão):        T8
```

- As trilhas A, B, C e D podem rodar em paralelo, cada uma na própria worktree.
- **O Resultado (T3) só começa depois de T5 e T9:** ele lê `comanda_items.net_cents` (T9) para a receita sem cortesia e `stock_movements` (T5) para o custo dos produtos. Junte T5 e T9 na trilha A antes de T3.
- O número de cada migration já está fixo na tarefa (0090 em T1, 0091 em T5, 0092 em T9, 0093 em T13), então não há colisão de número.
- Ao juntar as trilhas, o conflito esperado fica só no fim de `drizzle/meta/_journal.json`, no `truncate` de `test/db.ts` e no `schema.ts`. Resolva em ordem de número e refaça o `idx`.
- Dentro de uma trilha, as tarefas são sequenciais.
- Os testes usam um banco só (`crm_test`), então rode a suíte inteira só depois de juntar as trilhas.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `drizzle/0090_financeiro_despesas.sql` | `finance_categories`, `bank_accounts`, `expenses` e as categorias padrão |
| `drizzle/0091_produtos_estoque.sql` | `products`, `stock_movements`, `comanda_items.product_id` |
| `drizzle/0092_fiscal.sql` | vínculo e CNPJ da profissional, códigos fiscais do serviço, `comanda_items.net_cents`/`partner_cnpj`, `fiscal_documents`, `fiscal_sequences` |
| `drizzle/0093_nfce.sql` | reservado para a T13; só é criado se `fiscal_documents` precisar de ajuste |
| `src/lib/expense-status.ts` | puro: situação da despesa e vencimentos mensais |
| `src/lib/dre.ts` | puro: grupos do DRE, rótulos e ordem |
| `src/lib/cnpj.ts` | puro: dígitos, validação e máscara de CNPJ |
| `src/lib/fiscal-settings.ts` | puro: tipos e leitura de `fiscal_empresa`, `nfse_modo` e `nfce_modo` |
| `src/lib/occupancy-math.ts` | puro: minutos disponíveis e minutos agendados de um dia |
| `src/server/domain/financeiro/cadastros.ts` | categorias, contas bancárias e conta de cada forma de pagamento |
| `src/server/domain/financeiro/despesas.ts` | lançar, repetir, pagar, desfazer o pagamento, cancelar e listar |
| `src/server/reports/financeiro/resultado.ts` | fluxo de caixa, DRE e saldo por conta |
| `src/server/domain/estoque/produtos.ts` | cadastro, movimentos manuais e posição |
| `src/server/domain/estoque/baixa.ts` | baixa e estorno pela comanda (dentro da transação do caixa) |
| `src/server/domain/avec/import-products.ts` | papel `produtos` (relatório 0149 "Posição de Estoque") |
| `src/server/reports/ocupacao.ts` | mapa de calor e ocupação por profissional |
| `src/server/domain/fiscal/config.ts` | dados da empresa, chaves, prontidão |
| `src/server/domain/fiscal/draft.ts` | `NfseDraft`: o que vai na nota de serviço da comanda (puro sobre dados lidos) |
| `src/server/domain/fiscal/certificate.ts` | lê o A1 do `.env` e devolve PEM, CNPJ e validade |
| `src/server/domain/fiscal/dps-xml.ts` | monta o XML da DPS (puro) |
| `src/server/domain/fiscal/sign.ts` | assinatura XMLDSig (DPS, evento, NFC-e) |
| `src/server/domain/fiscal/sefin-client.ts` | cliente da API do Emissor Nacional (mTLS), transporte injetável |
| `src/server/domain/fiscal/nfse.ts` | fila, envio, consulta antes de reenviar, cancelamento |
| `src/server/domain/fiscal/nfce/*` | porte do Norte Vendas: chave de acesso, XML 65, QR Code, SOAP BA/SVRS |
| `src/components/reports/financeiro-views.tsx` | as abas Entradas · Contas a pagar · Resultado · Notas fiscais |
| `src/components/reports/contas-a-pagar.tsx`, `expense-sheet.tsx`, `resultado.tsx`, `notas-fiscais.tsx`, `ocupacao.tsx` | telas das vistas |
| `src/components/servicos/products-tab.tsx`, `product-sheet.tsx` | Serviços e pacotes › Produtos |
| `src/components/caixa/nota-fiscal-block.tsx` | bloco "Nota fiscal" da comanda fechada |
| `src/app/(app)/config/nota-fiscal/page.tsx`, `actions.ts` | Configurações › Nota fiscal |
| `src/app/api/notas/[id]/route.ts` | XML e PDF da nota (só equipe com permissão) |
| `worker/index.ts` | fila `nota-fiscal` a cada minuto |

---

## Bloco 1: dá para construir já

### Task 1: Contas a pagar (banco e domínio), item 27

**Files:**
- Create: `drizzle/0090_financeiro_despesas.sql`, `src/lib/expense-status.ts`, `src/lib/dre.ts`, `src/server/domain/financeiro/cadastros.ts`, `src/server/domain/financeiro/despesas.ts`
- Modify: `src/server/db/schema.ts` (3 tabelas), `drizzle/meta/_journal.json`, `test/db.ts` (truncate), `src/lib/permissions.ts` (`financeiro.lancar`, grupo "Gestão", rótulo "Lançar e pagar despesas", ajuda "Lança, paga e cancela as despesas em Relatórios › Financeiro › Contas a pagar.")
- Test: `src/lib/expense-status.test.ts`, `src/server/domain/financeiro/despesas.test.ts`

**Interfaces:**
- Produz (schema):
  - `financeCategories`: `id`, `name` (único, sem diferenciar maiúsculas), `dreGroup: DreExpenseGroup`, `active`, `position`, `createdAt`;
  - `bankAccounts`: `id`, `name` (único), `bank`, `openingCents` int default 0, `active`, `createdAt`;
  - `expenses`: `id`, `title`, `categoryId` (FK, not null), `supplier`, `amountCents` (>0), `dueOn` date, `competence` date (1º dia do mês), `paidOn` date null, `paidCents` int null, `bankAccountId` FK null, `paidMethod` text null, `seriesId` uuid null, `installment` smallint, `installments` smallint, `notes`, `createdBy`, `createdAt`, `cancelledAt`, `cancelledBy`, `cancelReason`.
  - Índices: `(due_on) where cancelled_at is null`, `(paid_on)`, `(series_id)`.
- Produz (`src/lib/dre.ts`):
  - `DRE_EXPENSE_GROUPS = ["pessoal","ocupacao","operacao","marketing","impostos","financeiras","outras"] as const`;
  - `type DreExpenseGroup`;
  - `DRE_LABEL: Record<DreKey, string>`, com `DreKey` = `"receita_servicos" | "receita_produtos" | "receita_pacotes" | "repasse_profissionais" | "taxas_cartao" | "custo_produtos" | DreExpenseGroup`.
- Produz (`src/lib/expense-status.ts`):
  - `type ExpenseStatus = "paga" | "atrasada" | "vence_7d" | "em_aberto"`;
  - `expenseStatus(e: { dueOn: string; paidOn: string | null }, today: string): ExpenseStatus`;
  - `monthlyDueDates(firstDue: string, n: number): string[]`;
  - `EXPENSE_STATUS_LABEL = { paga: "Paga", atrasada: "Atrasada", vence_7d: "Vence em até 7 dias", em_aberto: "Em aberto" }`.
- Produz (`cadastros.ts`):
  - `listCategories(): Promise<FinanceCategory[]>`;
  - `saveCategory(i: { id?: string; name: string; dreGroup: DreExpenseGroup; active?: boolean }, actor: Actor): Promise<{ id: string }>`;
  - `listBankAccounts()`;
  - `saveBankAccount(i: { id?: string; name: string; bank?: string | null; openingCents: number; active?: boolean }, actor)`;
  - `getMethodAccounts(): Promise<Partial<Record<PayMethod, string>>>` e `saveMethodAccounts(map, actor)` (settings `financeiro_contas_por_forma`).
- Produz (`despesas.ts`):
  - `type ExpenseInput = { title: string; categoryId: string; supplier?: string | null; amountCents: number; dueOn: string; competence?: string | null; repeatMonths?: number; bankAccountId?: string | null; notes?: string | null }`;
  - `createExpense(i: ExpenseInput, actor: Actor): Promise<{ ids: string[] }>`;
  - `payExpense(id: string, p: { paidOn: string; paidCents: number; bankAccountId: string | null; method: PayMethod | "boleto" | "transferencia" }, actor): Promise<void>`;
  - `undoExpensePayment(id, actor)`;
  - `cancelExpense(id, c: { reason: string; scope: "esta" | "proximas" }, actor)`;
  - `listExpenses(f: { from: string; to: string; status?: ExpenseStatus; categoryId?: string }, now: Date): Promise<ExpenseRow[]>`.
  - `ExpenseRow` = colunas + `categoryName` + `status`.
  - Todas as escritas pedem `financeiro.lancar` (`assertPerm`) e gravam auditoria: `despesa_lancada`, `despesa_paga`, `despesa_pagamento_desfeito`, `despesa_cancelada`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/expense-status.test.ts
it("vencimento mensal mantém o dia e cai no último dia do mês curto", () => {
  expect(monthlyDueDates("2027-01-31", 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  expect(monthlyDueDates("2028-01-31", 2)).toEqual(["2028-01-31", "2028-02-29"]);
});
it("situação: paga vence tudo; atrasada antes de hoje; até 7 dias; o resto em aberto", () => {
  expect(expenseStatus({ dueOn: "2026-10-01", paidOn: "2026-10-02" }, "2026-10-18")).toBe("paga");
  expect(expenseStatus({ dueOn: "2026-10-17", paidOn: null }, "2026-10-18")).toBe("atrasada");
  expect(expenseStatus({ dueOn: "2026-10-25", paidOn: null }, "2026-10-18")).toBe("vence_7d");
  expect(expenseStatus({ dueOn: "2026-10-26", paidOn: null }, "2026-10-18")).toBe("em_aberto");
});
```

```ts
// src/server/domain/financeiro/despesas.test.ts (resetDb + setupCaixa; gestão = s.caixaGestao, recepção = s.caixaRecepcao)
it("repetir 3 meses cria 3 parcelas da mesma série, com competência do mês de cada uma", async () => {
  const cat = await saveCategory({ name: "Aluguel", dreGroup: "ocupacao" }, s.caixaGestao);
  const { ids } = await createExpense({ title: "Aluguel da loja", categoryId: cat.id, amountCents: 450000, dueOn: "2026-10-31", repeatMonths: 3 }, s.caixaGestao);
  const rows = await listExpenses({ from: "2026-10-01", to: "2026-12-31" }, new Date("2026-10-18T12:00:00Z"));
  expect(rows.map((r) => [r.dueOn, r.competence, r.installment, r.installments])).toEqual([
    ["2026-10-31", "2026-10-01", 1, 3], ["2026-11-30", "2026-11-01", 2, 3], ["2026-12-31", "2026-12-01", 3, 3]]);
  expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
  expect(ids).toHaveLength(3);
});
it("pagar, desfazer e cancelar 'esta e as próximas'; tudo auditado", async () => { /* paga a 1ª: status paga; desfaz: em_aberto;
  cancela a 2ª com scope "proximas": 2ª e 3ª somem da lista, 1ª fica; audit_log tem despesa_lancada, despesa_paga, despesa_pagamento_desfeito, despesa_cancelada */ });
it("sem financeiro.lancar não lança", async () => {
  await expect(createExpense({ title: "X", categoryId: cat.id, amountCents: 100, dueOn: "2026-10-20" }, s.caixaRecepcao)).rejects.toThrow();
});
it("valida: valor > 0, título, categoria ativa, repetir de 1 a 24, motivo de cancelamento", async () => {
  await expect(createExpense({ ...base, amountCents: 0 }, s.caixaGestao)).rejects.toThrow("Digite o valor da despesa.");
  await expect(createExpense({ ...base, repeatMonths: 25 }, s.caixaGestao)).rejects.toThrow("Repita de 1 a 24 meses.");
  await expect(cancelExpense(id, { reason: " ", scope: "esta" }, s.caixaGestao)).rejects.toThrow("Escreva o motivo do cancelamento.");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/expense-status.test.ts src/server/domain/financeiro/despesas.test.ts`
Esperado: FALHA (módulos não existem).

- [ ] **Step 3: Escrever a migration 0090 e o schema**

O `INSERT ... ON CONFLICT DO NOTHING` traz estas categorias padrão (nome → grupo):
- Aluguel → ocupacao
- Energia → ocupacao
- Água → ocupacao
- Internet e telefone → ocupacao
- Produtos de uso no salão → operacao
- Contador → operacao
- Manutenção → operacao
- Salários e encargos → pessoal
- Pró-labore → pessoal
- Impostos (DAS) → impostos
- Tarifas bancárias → financeiras
- Marketing → marketing
- Outras despesas → outras

A mesma migration faz `UPDATE profiles SET permissions = array_append(...) WHERE key = 'gestao' AND NOT 'financeiro.lancar' = ANY(permissions)`. Acrescente as tabelas ao `truncate` de `test/db.ts`.

- [ ] **Step 4: Implementar `expense-status.ts`, `dre.ts`, `cadastros.ts` e `despesas.ts`**

- Repetição: `monthlyDueDates` mais `seriesId = randomUUID()`. A `competence` padrão é o 1º dia do mês do vencimento.
- `cancelExpense` com `"proximas"` cancela a mesma série com `installment >= ` a dela que ainda não foi paga.
- `listExpenses` filtra por `due_on` no período, fora as canceladas, ordenadas por `due_on` e depois pelo título.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/expense-status.test.ts src/server/domain/financeiro/despesas.test.ts && npm run typecheck`
Esperado: PASSA.

- [ ] **Step 6: Commit**: `git add drizzle/0090_financeiro_despesas.sql drizzle/meta/_journal.json src/server/db/schema.ts test/db.ts src/lib/{expense-status,dre,permissions}.ts src/lib/expense-status.test.ts src/server/domain/financeiro && git commit -m "feat(financeiro): contas a pagar, categorias e contas bancárias (0090)"`

---

### Task 2: Tela de Contas a pagar e as vistas do Financeiro, item 27

**Files:**
- Create: `src/components/reports/financeiro-views.tsx`, `src/components/reports/contas-a-pagar.tsx`, `src/components/reports/expense-sheet.tsx`, `src/app/(app)/relatorios/financeiro-actions.ts`
- Modify: `src/app/(app)/relatorios/page.tsx` (lê `sp.vista` quando `aba === "financeiro"`)
- Test: `src/components/reports/contas-a-pagar.render.test.tsx`, `src/app/(app)/relatorios/financeiro-actions.test.ts`

**Interfaces:**
- Consome: Task 1 (`listExpenses`, `createExpense`, `payExpense`, `undoExpensePayment`, `cancelExpense`, `listCategories`, `saveCategory`, `listBankAccounts`, `saveBankAccount`, `EXPENSE_STATUS_LABEL`).
- Produz:
  - `type FinanceVista = "entradas" | "contas" | "resultado" | "notas"`;
  - `FinanceViews({ value, notas }: { value: FinanceVista; notas: boolean })`. São abas `Tabs` com os rótulos "Entradas", "Contas a pagar", "Resultado" e "Notas fiscais". "Notas fiscais" só aparece com `notas=true`, ou seja, com `nfse_modo` diferente de `desligada` ou alguma nota no período (Task 10). O estado mora em `?vista=` e o período continua em `de`/`ate`/`periodo`;
  - `ContasAPagar({ rows, categories, accounts, canEdit, today })`;
  - server actions `lancarDespesa`, `pagarDespesa`, `desfazerPagamento`, `cancelarDespesa`, `salvarCategoria` e `salvarConta`, que devolvem `{ ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
// contas-a-pagar.render.test.tsx (jsdom)
it("pergunta da tela, totais por situação e a linha atrasada com o rótulo", () => {
  render(<ContasAPagar rows={[atrasada, paga]} categories={cats} accounts={[]} canEdit today="2026-10-18" />);
  expect(screen.getByRole("heading", { name: "O que a Casa tem para pagar?" })).toBeTruthy();
  expect(screen.getByText("Atrasada")).toBeTruthy();
  expect(screen.getByText("A pagar no período")).toBeTruthy(); // Fig com a soma das não pagas
});
it("sem permissão de lançar: sem botão 'Lançar despesa' nem 'Pagar'", () => { /* canEdit=false */ });
it("lista vazia: 'Nenhuma despesa no período.'", () => {});
```

```ts
// financeiro-actions.test.ts: a action confere financeiro.lancar e devolve o erro do domínio como texto
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/reports/contas-a-pagar.render.test.tsx "src/app/(app)/relatorios/financeiro-actions.test.ts"`
Esperado: FALHA.

- [ ] **Step 3: Implementar**

- Topo, com `Fig`: "A pagar no período", "Atrasadas" e "Pagas no período".
- Filtro de situação: chips com os 4 rótulos mais "Todas".
- Lista: `DataList` com as colunas Vencimento, Despesa, Categoria, Fornecedor, Valor e Situação. Cada linha tem a ação "Pagar" (folha com data, valor, conta e forma) ou "Desfazer".
- "Lançar despesa" abre a `expense-sheet` com os campos título, categoria, fornecedor, valor, vencimento, "Repetir por [1–24] meses", conta e observação.
- As categorias e as contas são editadas num bloco "Categorias e contas" no fim da vista, só para `financeiro.lancar`.
- `page.tsx` só carrega os dados da vista aberta.

- [ ] **Step 4: Rodar e ver passar.** Rode os mesmos comandos mais `npx vitest run src/components/reports/financeiro.render.test.tsx`, porque a vista Entradas não pode mudar. Esperado: PASSA.

- [ ] **Step 5: Commit**: `feat(financeiro): Contas a pagar em Relatórios › Financeiro`

---

### Task 3: Resultado (fluxo de caixa, DRE e saldo por conta), item 28

**Depende de:** Tasks 1, 5 e 9.

**Files:**
- Create: `src/server/reports/financeiro/resultado.ts`
- Test: `src/server/reports/financeiro/resultado.test.ts`

**Interfaces:**
- Consome:
  - `comanda_items.net_cents` (Task 9) e os movimentos `venda` com `unit_cost_cents` (Task 5);
  - `financeEntradas(range)`, que dá `days[].crmCents` e `days[].avecCents`, as entradas por dia já sem cortesia, crédito da cliente e troco;
  - `financeItens(range)`, que dá a comissão do CRM;
  - `expenses` e `financeCategories` (Task 1);
  - `getMethodAccounts()` (Task 1).
- Consome da Fase A (item 2): a taxa gravada por pagamento. Antes de escrever, leia `docs/superpowers/plans/2026-10-18-fase-a-*.md` e use o nome de coluna que ele definiu. Se a Fase A não estiver na `main`, `taxas_cartao` vem `null` e a tela mostra "—".
- Produz:

```ts
export type FluxoRow = { key: string; label: string; entradasCrmCents: number; entradasAvecCents: number; saidasCents: number; aPagarCents: number };
export type DreLine = { key: DreKey; label: string; crmCents: number | null; avecCents: number | null };
export type ResultadoView = {
  range: SalonRange; fluxo: FluxoRow[];
  dre: DreLine[]; resultado: { crmCents: number; avecCents: number };
  contas: { id: string; name: string; saldoCents: number }[];
};
export async function loadResultado(range: SalonRange, now?: Date): Promise<ResultadoView>;
```

- Regras do DRE (as linhas saem nesta ordem):
  - `receita_servicos`, `receita_produtos` e `receita_pacotes` somam `comanda_items.net_cents` por `kind` (`servico`, `produto`, `pacote_venda`). A sessão de pacote vale 0.
    - CRM: comandas fechadas no período.
    - Avec: `sales_items` por `kind` com o `REVENUE()` de `salon.ts`.
  - `repasse_profissionais`: CRM = soma de `commission_cents`; Avec = soma de `sales_items.commission_cents`.
  - `taxas_cartao`: vem da Fase A, só no CRM; no Avec é `null`.
  - `custo_produtos`: CRM = soma de `−delta_qty × unit_cost_cents` dos movimentos `venda` vivos de comandas fechadas no período; Avec = `null`.
  - Os grupos de despesa somam as despesas **pela competência**, e o mesmo valor vai nas duas colunas.
  - `resultado` = receitas − deduções − despesas, por coluna. Linha `null` conta como 0.
- O fluxo de caixa olha as datas, não a competência:
  - entradas pela data do pagamento, o que já vem de `financeEntradas`;
  - saídas pelas despesas pagas, por `paid_on`;
  - `aPagarCents` pelas despesas não pagas, por `due_on`;
  - a granularidade (`range.grain`, dia ou mês) é a mesma das Entradas.
- Saldo por conta = `openingCents` + entradas do CRM das formas ligadas a essa conta (desde sempre até `range.to`) − despesas pagas por essa conta. O Avec não entra no saldo.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("CRM e Avec em colunas, nunca somados; a despesa aparece igual nas duas", async () => {
  // comanda CRM fechada 2026-10-10: serviço net 10000 (comissão 4000); sales_items Avec 2026-10-10: serviço 8000 (comissão 3000)
  // despesa Aluguel 5000 competência 2026-10, paga 2026-10-05
  const v = await loadResultado(salonRange({ de: "2026-10-01", ate: "2026-10-31" }, now));
  const line = (k: DreKey) => v.dre.find((l) => l.key === k)!;
  expect([line("receita_servicos").crmCents, line("receita_servicos").avecCents]).toEqual([10000, 8000]);
  expect([line("ocupacao").crmCents, line("ocupacao").avecCents]).toEqual([5000, 5000]);
  expect(v.resultado).toEqual({ crmCents: 10000 - 4000 - 5000, avecCents: 8000 - 3000 - 5000 });
});
it("despesa de competência outubro paga em novembro: DRE de outubro, fluxo de novembro", async () => {});
it("fluxo: a pagar pelo vencimento, pagas pela data do pagamento, canceladas fora", async () => {});
it("saldo por conta: abertura + PIX ligado à conta − despesa paga por ela; dinheiro sem conta não entra", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run src/server/reports/financeiro/resultado.test.ts`. Esperado: FALHA.
- [ ] **Step 3: Implementar `loadResultado`.** Um `rows(sql\`…\`)` por bloco (DRE CRM, DRE Avec, despesas por grupo e mês, despesas pagas por bucket, a pagar por bucket, saldos), juntados em TS. Reaproveite `salonBuckets(range)` para as chaves.
- [ ] **Step 4: Rodar e ver passar.** Esperado: PASSA.
- [ ] **Step 5: Commit**: `feat(financeiro): fluxo de caixa, DRE e saldo por conta`

---

### Task 4: Tela do Resultado e abas novas no Excel, item 28

**Files:**
- Create: `src/components/reports/resultado.tsx`
- Modify: `src/app/(app)/relatorios/page.tsx` (vista `resultado`), `src/server/reports/financeiro/xlsx.ts` (`FIN_SHEETS` ganha `"Despesas"` e `"Resultado"`), `src/app/api/relatorios/excel-financeiro/route.ts`
- Test: `src/components/reports/resultado.render.test.tsx`, `src/server/reports/financeiro/xlsx.test.ts` (acrescentar)

**Interfaces:**
- Consome: `loadResultado` (Task 3) e `listExpenses` (Task 1).
- Produz: `ResultadoTab({ v }: { v: ResultadoView })`. `buildFinanceiroXlsx` recebe `d.resultado: ResultadoView` e `d.expenses: ExpenseRow[]`.

- [ ] **Step 1: Escrever os testes que falham**

```tsx
it("pergunta, DRE com as colunas CRM e Avec e o resultado do mês", () => {
  render(<ResultadoTab v={v} />);
  expect(screen.getByRole("heading", { name: "Quanto sobrou no mês?" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "CRM" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Avec" })).toBeTruthy();
  expect(screen.getByText("Resultado")).toBeTruthy();
});
it("linha sem dado mostra '—', nunca R$ 0,00", () => { /* taxas_cartao null */ });
it("aviso fixo: 'CRM e Avec lado a lado, sem somar. As despesas são as mesmas nos dois.'", () => {});
```

```ts
it("Excel tem as abas Despesas e Resultado, nesta ordem, depois de Exceções", async () => { /* FIN_SHEETS e workbook.worksheets.map(w=>w.name) */ });
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** São três `Section`, nesta ordem:
  - "Resultado do período": DRE com `DataList` e as colunas Linha, CRM, Avec;
  - "Fluxo de caixa": colunas Dia/Mês, Entradas CRM, Entradas Avec, Saídas, A pagar;
  - "Saldo por conta".
  - Use o mesmo `diff` visual da vista Entradas (sem cor de certo ou errado). Valores de dedução aparecem com "−".
- [ ] **Step 4: Rodar e ver passar.** Run: `npx vitest run src/components/reports/resultado.render.test.tsx src/server/reports/financeiro/xlsx.test.ts`
- [ ] **Step 5: Commit**: `feat(financeiro): vista Resultado e abas Despesas/Resultado no Excel`

---

### Task 5: Produtos e estoque (banco, domínio e baixa pela comanda), item 29

**Files:**
- Create: `drizzle/0091_produtos_estoque.sql`, `src/server/domain/estoque/produtos.ts`, `src/server/domain/estoque/baixa.ts`
- Modify:
  - `src/server/db/schema.ts`;
  - `drizzle/meta/_journal.json`;
  - `test/db.ts`;
  - `src/server/domain/caixa/comandas.ts`:
    - `AddItemInput.productId`;
    - `buildItemTx` para `kind === "produto"`;
    - `closeComanda` chama `saleMovementsTx`;
    - `reopenComanda`, `cancelComanda` e `reopenForCorrection` chamam `reverseSaleMovementsTx`.
- Test: `src/server/domain/estoque/produtos.test.ts`, `src/server/domain/estoque/baixa.test.ts`; ajuste em `src/server/domain/caixa/comandas.test.ts` (a mensagem "Escreva o nome do produto." vira a do Step 1).

**Interfaces:**
- Produz (schema):
  - `products`:
    - `id`, `name` (único, sem diferenciar maiúsculas), `brand`, `category`;
    - `barcode`, `ncm` (check `^[0-9]{8}$` ou null), `cfop` default `'5102'`, `csosn` default `'102'`, `unit` default `'UN'`;
    - `priceCents`, `costCents`;
    - `use` (`'venda' | 'consumo'`, default `'venda'`), `minQty` numeric null;
    - `avecName`, `active`, `createdBy`, `createdAt`, `updatedAt`.
  - `stockMovements`:
    - `id`, `productId`;
    - `deltaQty` numeric (≠ 0);
    - `reason` (`'venda' | 'entrada' | 'saida' | 'ajuste' | 'saldo_avec'`);
    - `comandaItemId` null, `unitCostCents` null, `note`, `createdBy`, `createdAt`, `cancelledAt`;
    - unique `(comanda_item_id) where reason = 'venda'`.
  - `comandaItems.productId` (FK null).
  - Estoque = `sum(delta_qty) where cancelled_at is null`.
- Produz (`produtos.ts`):
  - `type ProductInput = { id?: string; name: string; brand?; category?; barcode?; ncm?; priceCents: number | null; costCents?: number | null; use?: "venda" | "consumo"; minQty?: number | null; active?: boolean }`;
  - `saveProduct(i: ProductInput, actor): Promise<{ id: string }>`, que pede `servicos.editar`;
  - `listProducts(f: { q?: string; situacao?: "todos" | "abaixo_minimo" | "negativo"; activeOnly?: boolean }): Promise<ProductRow[]>`, com `ProductRow = Product & { stockQty: number; below: boolean; negative: boolean }`;
  - `addStockMovement(m: { productId: string; kind: "entrada" | "saida" | "ajuste"; qty: number; unitCostCents?: number | null; note?: string | null }, actor): Promise<void>`. No `ajuste`, `qty` é o estoque contado e o delta é calculado. "saida" e "ajuste" pedem `note`.
- Produz (`baixa.ts`):
  - `saleMovementsTx(tx: Tx, comandaId: string, actorId: string, now: Date): Promise<void>`: para cada item vivo `kind='produto'` com `productId`, faz upsert de `reason='venda'`, `deltaQty = -qty`, `unitCostCents = products.cost_cents` e `cancelledAt = null`;
  - `reverseSaleMovementsTx(tx: Tx, comandaId: string, now: Date): Promise<void>`: marca `cancelledAt = now` nos movimentos de venda da comanda.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// baixa.test.ts (setupCaixa; produto "Shampoo Fiaes" preço 4000, custo 1800, estoque 1 por entrada)
it("fechar a comanda com 2 frascos baixa 2 e o estoque fica −1, sem travar o caixa", async () => {
  await addItem(c.id, { kind: "produto", productId: shampoo.id, qty: 2 }, s.caixaRecepcao);
  /* pagar 8000 em pix e closeComanda */
  expect((await listProducts({ situacao: "negativo" })).map((p) => [p.name, p.stockQty])).toEqual([["Shampoo Fiaes", -1]]);
});
it("reabrir estorna; fechar de novo baixa de novo sem duplicar", async () => { /* stockQty 1 → -1 → 1 → -1; só 1 movimento 'venda' por item */ });
it("cancelar a comanda fechada estorna", async () => {});
it("produto sem catálogo não entra: 'Escolha o produto (cadastre em Serviços e pacotes › Produtos).'", async () => {
  await expect(addItem(c.id, { kind: "produto", label: "Shampoo" }, s.caixaRecepcao)).rejects.toThrow("Escolha o produto (cadastre em Serviços e pacotes › Produtos).");
});
it("preço diferente do catálogo pede motivo, como no serviço", async () => {
  await expect(addItem(c.id, { kind: "produto", productId: shampoo.id, unitCents: 3500 }, s.caixaRecepcao)).rejects.toThrow(PRICE_REASON);
});
it("item de produto grava fiscal_kind 'produto' e label = nome do produto", async () => {});
```

```ts
// produtos.test.ts
it("ajuste por contagem grava o delta; saída e ajuste pedem motivo; NCM com 8 dígitos", async () => {});
it("abaixo do mínimo: estoque < minQty", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run src/server/domain/estoque src/server/domain/caixa/comandas.test.ts`
- [ ] **Step 3: Escrever a migration 0091 e o schema.** `when` = `1792410000000`.
- [ ] **Step 4: Implementar.**
  - Em `buildItemTx`: produto exige `productId` ativo, `label = product.name`, `basePrice = product.priceCents`.
  - `saleMovementsTx` roda dentro da transação de `closeComanda`, depois do bloco de pacotes.
  - O estorno roda nas três portas de reabrir e cancelar, junto do estorno de pacote que já existe.
- [ ] **Step 5: Rodar e ver passar.** Rode também `npx vitest run src/server/domain/caixa`, porque nenhum teste do caixa pode quebrar além da mensagem trocada.
- [ ] **Step 6: Commit**: `feat(estoque): produtos, movimentos e baixa pela comanda (0091)`

---

### Task 6: Telas de Produtos (catálogo, estoque e escolha na comanda), item 29

**Files:**
- Create: `src/components/servicos/products-tab.tsx`, `src/components/servicos/product-sheet.tsx`
- Modify:
  - `src/app/(app)/servicos/page.tsx`: aba `produtos`, para quem tem `atendimento.ver` ou `servicos.editar`;
  - `src/components/servicos/services-page.tsx`: tipo `ServicosTab` mais `"produtos"`, rótulo "Produtos";
  - `src/components/caixa/item-editor.tsx`: escolher o produto do catálogo, com busca por nome ou código de barras;
  - `src/server/queries/comanda-catalog.ts`: devolve os produtos ativos.
- Test: `src/components/servicos/products-tab.render.test.tsx`, `src/components/caixa/item-editor.test.tsx` (acrescentar), `src/server/queries/comanda-catalog.test.ts` (acrescentar)

**Interfaces:**
- Consome: `listProducts`, `saveProduct` e `addStockMovement` (Task 5).
- Produz:
  - `ProductsTab({ rows, canEdit })`;
  - `comandaCatalog()` acrescenta `products: { id; name; priceCents; barcode; stockQty }[]`;
  - server actions `salvarProduto` e `movimentarEstoque` em `src/app/(app)/servicos/actions.ts`.

- [ ] **Step 1: Escrever os testes que falham**
  - `products-tab`: as colunas são Produto, Marca, Preço, Estoque e Situação.
  - O chip "Abaixo do mínimo" filtra a lista.
  - O rótulo "Estoque negativo" aparece em `negative`.
  - Sem `canEdit`, não há "Novo produto", "Entrada" nem "Ajustar".
  - `item-editor`: no tipo Produto, o campo é uma busca no catálogo (não texto livre), e o preço vem do catálogo.
  - O estoque zerado mostra o aviso "Sem estoque: a venda fecha e o estoque fica negativo." e o botão continua habilitado.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** A folha do produto tem três blocos, um por pergunta:
  - "Dados" (nome, marca, categoria, preço, custo, uso, mínimo);
  - "Nota fiscal" (NCM, código de barras; CFOP e CSOSN só leitura, com o padrão);
  - "Estoque" (posição, últimos 20 movimentos, Entrada / Saída / Ajustar).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**: `feat(estoque): aba Produtos e produto do catálogo na comanda`

---

### Task 7: Trazer os produtos do Avec (relatório 0149), item 29

**Files:**
- Create: `src/server/domain/avec/import-products.ts`
- Modify: `src/server/domain/avec/formats.ts` (papel `"produtos"` em `AvecRole` e `rolesOf`), `src/server/domain/avec/apply.ts` (chama `importProducts` e encaixa em `batchOrder`)
- Test: `src/server/domain/avec/import-products.test.ts`, `src/server/domain/avec/formats.test.ts` (acrescentar)

**Interfaces:**
- Consome: `products` e `stockMovements` (Task 5), `getCaixaMode()`, `ImportCtx`.
- Produz: `importProducts(ctx: ImportCtx): Promise<{ criados: number; atualizados: number; saldos: number }>`.
- Reconhecimento do formato: o cabeçalho tem `produto` **e** `ncm` **e** uma coluna de estoque. Procure a coluna de estoque por `colOf(header, "qtd. estoque", "qtd estoque", "estoque")`; confira os nomes normalizados com `normHeader` antes de fixar.
- As colunas usadas são Produto, Categoria, Marca, Custo, Valor, NCM, Cód. Barras e Qtd. Estoque.

**Regras:**
- Liga pelo `avecName` normalizado; se não achar, pelo nome. Cria o produto que falta.
- Só preenche campo que está vazio no CRM: o que a Casa mudou no CRM não volta.
- **Saldo:**
  - com `caixa_modo = "avec"`: grava um movimento `saldo_avec` de `avecQty − estoqueAtual`, se o resultado não for 0. Quem vende é o Avec, então o saldo segue o Avec;
  - com `caixa_modo = "crm"`: **nunca** mexe no estoque, só no cadastro.

- [ ] **Step 1: Escrever os testes que falham**
  - `rolesOf` reconhece o cabeçalho do 0149 copiado do parte2: "Produto; Categoria; Custo; Valor; Custo Médio Ponderado; Medida; Qtd. Estoque; Qtd. Estoque Absoluto; Marca; Linha; NCM; Cód. Barras; Cód. Interno; Local de estoque; Custo Total; Preço Venda Total". Ele **não** reconhece o 0043, que não tem NCM.
  - A importação cria 2 produtos, e reimportar com outro saldo no modo avec grava o delta.
  - No modo crm, o saldo não muda.
  - O preço mudado no CRM não volta.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Rode também `npx vitest run src/server/domain/avec`.
- [ ] **Step 5: Commit**: `feat(avec): importar produtos e saldo do relatório Posição de Estoque`

---

### Task 8: Mapa de calor e ocupação por profissional em Relatórios › Salão, item 30

**Files:**
- Create: `src/lib/occupancy-math.ts`, `src/server/reports/ocupacao.ts`, `src/components/reports/ocupacao.tsx`
- Modify:
  - `src/components/reports/heatmap.tsx`: props opcionais `unit`, `caption`, `ariaLabel` e `format`; o padrão continua "mensagem/mensagens";
  - `src/app/(app)/relatorios/page.tsx`: `aba=salao&vista=ocupacao`;
  - `src/components/reports/salon.tsx`: abas "Resumo" e "Ocupação" no topo, com `Tabs` e o estado em `?vista=`.
- Test: `src/lib/occupancy-math.test.ts`, `src/server/reports/ocupacao.test.ts`, `src/components/reports/ocupacao.render.test.tsx`, `src/components/reports/salon.render.test.tsx` (o resumo continua igual)

**Interfaces:**
- Consome:
  - `effectiveRanges(day, workHours, casa)` de `src/lib/work-hours.ts`;
  - `blockAppliesOn` de `src/lib/agenda-blocks.ts`;
  - `getBusinessHours()`, `salonBuckets` e `todayBahia`.
- Produz:

```ts
// occupancy-math.ts (puro, minutos do dia)
export function availableMinutes(ranges: [number, number][], blocks: [number, number][]): number; // faixas − união dos bloqueios
export function clippedMinutes(busy: [number, number][], ranges: [number, number][]): number;     // agendado dentro das faixas, sem contar sobreposição 2x
// ocupacao.ts
export type OcupacaoMedida = "horarios" | "valor";
export type OcupacaoView = {
  range: SalonRange; money: boolean; medida: OcupacaoMedida; professionalId: string | null;
  grid: number[][]; /* [dia da semana 0..6][hora 0..23] */
  professionals: { id: string; name: string; availableMin: number; bookedMin: number; pct: number | null; days: number }[];
};
export async function loadOcupacao(user: { perms: readonly string[] }, range: SalonRange, o: { professionalId?: string | null; medida?: OcupacaoMedida }): Promise<OcupacaoView>;
```

**Regras:**
- **Entram no mapa** os horários com `status in ('agendado','confirmado','chegou','em_atendimento','compareceu')`, `avec_twin_of is null`, sem os "sem hora" do Avec (00:00), pela hora de início em Salvador.
- **Medida:**
  - "horarios" conta os horários;
  - "valor" soma `appointments.price_cents`, só com `valores.ver`; sem a permissão, cai para "horarios".
- **Ocupação** = minutos agendados (duração do horário ou do serviço, mais a folga do serviço) dentro das faixas do dia ÷ minutos disponíveis (faixas menos os bloqueios que valem no dia, menos o pedido de folga recusado). O cálculo é por profissional ativa e por dia do período.
  - `pct` = `null` quando o disponível é 0.
  - `days` = dias com disponível > 0.
- A lista sai ordenada por `pct`, do maior para o menor; quem tem `null` vai para o fim.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("disponível: 9–18 com almoço 12–13 = 480 min; bloqueio do dia inteiro = 0", () => {
  expect(availableMinutes([[540, 1080]], [[720, 780]])).toBe(480);
  expect(availableMinutes([[540, 1080]], [[0, 1440]])).toBe(0);
});
it("agendado que passa do fim do expediente conta só até o fim; dois horários sobrepostos não contam 2x", () => {
  expect(clippedMinutes([[1020, 1110]], [[540, 1080]])).toBe(60);
  expect(clippedMinutes([[600, 660], [630, 690]], [[540, 1080]])).toBe(90);
});
```

```ts
// ocupacao.test.ts (setupAgenda): Ana trabalha ter 9–18, almoço bloqueado 12–13; 2 horários de 60 min numa terça; 1 faltou (fora)
it("grade conta 2 na terça às 10h e 14h; ocupação da Ana = 120/480 = 25%", async () => {});
it("sem valores.ver: medida 'valor' cai para 'horarios'", async () => {});
it("filtro por profissional muda a grade, não a lista de ocupação", async () => {});
```

```tsx
// ocupacao.render.test.tsx
it("pergunta 'Quando a Casa enche e quem está livre?', mapa com 'horário/horários' e tabela com Ocupação %", () => {});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** A tela tem três partes:
  - os filtros: `SalonPeriodPicker`, um seletor de profissional ("Todas") e "Horários / Valor", este só com `money`;
  - o `Heatmap` com `unit={{ one: "horário", many: "horários" }}` ou, em Valor, `format={money}`;
  - o `DataList` com as colunas Profissional, Disponível (h), Agendado (h), Ocupação e Dias.
  - A nota fixa no `lead`: "Disponível = horário de trabalho dela (ou o da Casa) menos bloqueios e folgas."
- [ ] **Step 4: Rodar e ver passar.** Rode também `npx vitest run src/components/reports src/server/reports`.
- [ ] **Step 5: Commit**: `feat(relatorios): Salão › Ocupação com mapa de calor e ocupação por profissional`

---

### Task 9: Dados fiscais (banco, snapshot no fechamento e telas de cadastro), item 26

**Files:**
- Create: `drizzle/0092_fiscal.sql`, `src/lib/cnpj.ts`, `src/lib/fiscal-settings.ts`, `src/server/domain/fiscal/config.ts`, `src/app/(app)/config/nota-fiscal/page.tsx`, `src/app/(app)/config/nota-fiscal/actions.ts`, `src/components/config/fiscal-settings.tsx`
- Modify:
  - `src/server/db/schema.ts`, `drizzle/meta/_journal.json`, `test/db.ts`;
  - `src/server/domain/professionals.ts`: `updateProfessional` aceita `bond`, `cnpj` e `legalName`;
  - `src/components/config/professional-sheet.tsx`: bloco "Vínculo" com Parceira (salão-parceiro) / CLT / Outro, CNPJ e Razão social;
  - `src/server/domain/services.ts` e `src/components/servicos/service-sheet.tsx`: "Código do serviço na nota (cTribNac)" e "NBS", opcionais, que sobrepõem o padrão;
  - `src/server/domain/caixa/comandas.ts`: `closeComanda` grava `net_cents` e `partner_cnpj`;
  - `src/lib/config-tabs.ts`: item `nota-fiscal` no grupo "agenda", com `need: "sistema"`;
  - `src/server/env.ts` e `.env.example`: `FISCAL_CERT_PATH`, `FISCAL_CERT_PASSWORD`, `NFCE_CSC` e `NFCE_CSC_ID`, todos opcionais e só com nome e comentário no exemplo.
- Test: `src/lib/cnpj.test.ts`, `src/lib/fiscal-settings.test.ts`, `src/server/domain/fiscal/config.test.ts`, `src/server/domain/caixa/comandas-fechar.test.ts` (acrescentar), `src/server/domain/professionals.test.ts` (acrescentar), `src/server/env.test.ts` (acrescentar)

**Interfaces:**
- Produz (schema, 0092, `when` `1792420000000`):
  - `professionals`: `bond` (check `in ('parceira','clt','outro')` ou null), `cnpj` (check `^[0-9]{14}$` ou null), `legalName`;
  - `lists`: `fiscalCtribNac` (check `^[0-9]{6}$` ou null), `fiscalNbs`;
  - `comandaItems`: `netCents` int null (o valor do item na nota: total − parte dele no desconto da comanda − parte dele na cortesia) e `partnerCnpj` (o retrato no fechamento);
  - `fiscalDocuments`:
    - `id`, `comandaId`, `kind` (`'nfse' | 'nfce'`), `environment` (`'teste' | 'producao'`), `series` int, `number` bigint;
    - `localId` (o Id da DPS ou da NFC-e), `accessKey` null;
    - `status` (`'pendente' | 'autorizada' | 'rejeitada' | 'erro_envio' | 'cancelada'`), `amountCents`;
    - `requestXml`, `responseBody`, `rejectReason`, `attempts` int default 0, `lastError`, `nextTryAt`;
    - `createdBy`, `createdAt`, `authorizedAt`, `cancelledAt`, `cancelledBy`, `cancelReason`;
    - unique `(comanda_id, kind) where status in ('pendente','autorizada')` e unique `(kind, environment, series, number)`.
  - `fiscalSequences`: `kind`, `environment`, `series`, `nextNumber` bigint, com PK nos três primeiros.
- Produz (`src/lib/cnpj.ts`): `cnpjDigits`, `isValidCnpj` (dígitos verificadores; sequência repetida não vale) e `formatCnpj`, no mesmo molde de `src/lib/cpf.ts`.
- Produz (`src/lib/fiscal-settings.ts`):

```ts
export type FiscalModo = "desligada" | "teste" | "producao";
export type FiscalEmpresa = {
  cnpj: string | null; razaoSocial: string | null; inscricaoMunicipal: string | null; inscricaoEstadual: string | null;
  regime: "simples" | "presumido" | null; aliquotaSimplesBp: number | null; codigoMunicipio: "2927408";
  endereco: { logradouro: string; numero: string; bairro: string; cep: string } | null;
  cTribNacPadrao: string; /* "060101" */ nbsPadrao: string | null; serieDps: number; /* 1 */ serieNfce: number; /* 1 */
  emitirAoFechar: boolean; /* false */
};
export const DEFAULT_FISCAL_EMPRESA: FiscalEmpresa;
export function readFiscalEmpresa(v: unknown): FiscalEmpresa;
export const isFiscalModo: (v: unknown) => v is FiscalModo;
```

- Produz (`config.ts`):
  - `getFiscalEmpresa()` e `saveFiscalEmpresa(i: FiscalEmpresa, actor)`, que pedem `config.sistema` e gravam auditoria `fiscal_empresa` com de/para;
  - `getNfseModo()` e `getNfceModo()` (settings `nfse_modo` e `nfce_modo`, padrão `"desligada"`);
  - `setNfseModo(m: FiscalModo, actor)`. A `"producao"` só é aceita com a prontidão completa **e** pelo menos uma `fiscal_documents` NFS-e `autorizada` em `teste`;
  - `fiscalReadiness(kind: "nfse" | "nfce"): Promise<{ ok: boolean; missing: string[] }>`.
  - As frases exatas de `missing` são:
    - "CNPJ da Casa"
    - "Inscrição municipal"
    - "Regime tributário"
    - "Certificado digital A1 no servidor"
    - "Certificado vence em X dias" (aparece com menos de 30 dias)
    - "Parceira {nome} sem CNPJ" (uma por parceira ativa)
    - só na NFC-e: "Inscrição estadual" e "CSC da SEFAZ-BA no servidor"
  - Esta tarefa só confere a **presença** de `FISCAL_CERT_PATH` e `FISCAL_CERT_PASSWORD`. A validade entra na Task 11.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("CNPJ: válido, inválido, repetido", () => {
  expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  expect(isValidCnpj("11222333000180")).toBe(false);
  expect(isValidCnpj("11111111111111")).toBe(false);
});
it("parceira exige CNPJ válido; CLT não", async () => {
  await expect(updateProfessional(ana.id, { bond: "parceira", cnpj: null }, gestora.id)).rejects.toThrow("Parceira precisa do CNPJ dela.");
  await expect(updateProfessional(ana.id, { bond: "parceira", cnpj: "11222333000180" }, gestora.id)).rejects.toThrow("CNPJ inválido.");
});
it("fechar a comanda grava net_cents com desconto e cortesia rateados, e o CNPJ da parceira", async () => {
  // Corte 10000 (Ana, parceira 11222333000181) + Hidratação 5000 (Bia, CLT); desconto da comanda 1500; cortesia 1350
  // net = total − desconto rateado − cortesia rateada: Corte 9000−900 = 8100; Hidratação 4500−450 = 4050
  expect(items.map((i) => [i.label, i.netCents, i.partnerCnpj])).toEqual([["Corte", 8100, "11222333000181"], ["Hidratação", 4050, null]]);
});
it("produção só com prontidão completa e uma nota autorizada em teste", async () => {
  await expect(setNfseModo("producao", gestao)).rejects.toThrow("Antes da produção, emita e confira uma nota no modo Teste.");
});
it("prontidão lista o que falta, com as frases fixas", async () => { /* env sem FISCAL_CERT_PATH → "Certificado digital A1 no servidor" */ });
it("env: as variáveis fiscais são opcionais", () => { /* parseEnv sem elas não lança */ });
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Escrever a migration 0092 e o schema.**
- [ ] **Step 4: Implementar.**
  - **`net_cents`:** o `closeComanda` já calcula `totals.shares` (desconto) e `courtesyShares` (cortesia) para a comissão. Use os mesmos mapas para **todo** item vivo, inclusive produto e pacote vendido, e grave na mesma atualização que já grava `totalCents` e a comissão.
  - **`partner_cnpj`:** vem de `professionals.cnpj` quando `bond = 'parceira'`.
  - **Tela Configurações › Nota fiscal**, com o título "Como a Casa emite nota fiscal?", em três blocos:
    - "Situação": a chave com os três estados e os textos "Desligada: a Casa emite à mão no nfse.gov.br.", "Teste: emite no ambiente de teste do governo (sem valor fiscal)." e "Produção: emite de verdade.", mais a lista de prontidão;
    - "Dados da Casa";
    - "Padrão dos serviços".
- [ ] **Step 5: Rodar e ver passar.** Rode também `npx vitest run src/server/domain/caixa src/server/env.test.ts`.
- [ ] **Step 6: Commit**: `feat(fiscal): dados fiscais, vínculo das parceiras e valor do item na nota (0092)`

---

### Task 10: Rascunho da nota, vista Notas fiscais e extrato das parceiras, item 26

Serve desde 01/11 com a chave desligada: a recepção copia os dados para o emissor web.

**Files:**
- Create: `src/server/domain/fiscal/draft.ts`, `src/components/caixa/nota-fiscal-block.tsx`, `src/components/reports/notas-fiscais.tsx`, `src/server/reports/financeiro/notas.ts`
- Modify: `src/components/caixa/comanda-sheet.tsx` (o bloco aparece na comanda **fechada**), `src/app/(app)/relatorios/page.tsx` (vista `notas`)
- Test: `src/server/domain/fiscal/draft.test.ts`, `src/server/reports/financeiro/notas.test.ts`, `src/components/caixa/nota-fiscal-block.test.tsx`

**Interfaces:**
- Consome: `net_cents`, `partner_cnpj`, `getFiscalEmpresa()` e `getNfseModo()` (Task 9).
- Produz:

```ts
export type NfseDraftLine = { itemId: string; label: string; netCents: number; professional: string | null;
  partner: { legalName: string; cnpj: string } | null; cTribNac: string; nbs: string | null };
export type NfseDraft = {
  comandaId: string; comandaNumber: number; day: string; tomador: { cpf: string | null; nome: string | null };
  lines: NfseDraftLine[]; totalCents: number; salaoCents: number;
  parceiras: { legalName: string; cnpj: string; cents: number }[]; discriminacao: string;
};
export async function loadNfseDraft(comandaId: string): Promise<NfseDraft | null>; // null = nada a declarar
export function buildDiscriminacao(d: Omit<NfseDraft, "discriminacao">): string;  // pura
// notas.ts
export type NotaRow = { id: string; comandaNumber: number; day: string; kind: "nfse" | "nfce"; environment: "teste" | "producao"; status: string; amountCents: number; accessKey: string | null; rejectReason: string | null };
export type ParceiraExtrato = { professionalId: string; name: string; legalName: string; cnpj: string; month: string; cents: number; comandas: number };
export async function loadNotas(range: SalonRange): Promise<{ notas: NotaRow[]; parceiras: ParceiraExtrato[] }>;
```

**Regras do rascunho:**
- **Linhas da nota:**
  - entram os itens vivos `fiscal_kind = 'servico'` com `kind in ('servico','pacote_venda')` e `net_cents > 0`;
  - a sessão de pacote fica fora, porque a nota saiu na venda do pacote; o contador confirma isso;
  - o produto fica fora, porque vai para a NFC-e.
- **Cotas:**
  - a cota da parceira na linha é o `commission_cents` do item;
  - `salaoCents` = `totalCents` − soma das cotas das parceiras;
  - profissional CLT não tem cota separada.
- **`cTribNac`:** o do serviço; se não houver, `cTribNacPadrao`.
- **Texto exato** de `buildDiscriminacao`. Os valores saem sempre com 2 casas e espaço comum, como em `R$ 1.234,50`. Não use `money()`, porque ele corta o ",00" e põe espaço não separável. Use `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })` e troque o ` ` por espaço:
  - sem parceira: `Serviços de beleza: {label1}, {label2}.`
  - com parceira, acrescenta: ` Salão-parceiro (Lei 13.352/2016): cota-parte do salão {salão}; cota-parte de {legalName} (CNPJ {cnpj formatado}) {valor}.` (com "; " entre as parceiras).
- **Extrato das parceiras:** por mês e por parceira, a soma do `commission_cents` dos itens com `partner_cnpj` não nulo, nas comandas fechadas. Serve para a nota que a parceira emite contra o salão.
- **Bloco na comanda fechada:**
  - com a chave `desligada`: "Dados da nota (para o nfse.gov.br)", com os campos e um botão "Copiar" em cada um (CPF, Discriminação, Valor, Código do serviço);
  - com a chave em `teste` ou `producao`: a situação da nota e as ações da Task 12.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("nota da comanda: só serviços, cotas separadas e texto fixo", async () => {
  // Corte net 8100 (Ana parceira, comissão 3240) + Hidratação net 4050 (Bia CLT) + Shampoo (produto) + sessão de pacote
  const d = (await loadNfseDraft(c.id))!;
  expect(d.lines.map((l) => l.label)).toEqual(["Corte", "Hidratação"]);
  expect([d.totalCents, d.salaoCents]).toEqual([12150, 8910]);
  expect(d.discriminacao).toBe("Serviços de beleza: Corte, Hidratação. Salão-parceiro (Lei 13.352/2016): cota-parte do salão R$ 89,10; cota-parte de ANA SILVA ME (CNPJ 11.222.333/0001-81) R$ 32,40.");
});
it("valor redondo sai com ',00' (R$ 100,00), nunca 'R$ 100'", () => { /* buildDiscriminacao com cota de 10000 */ });
it("comanda só com produto ou só sessão de pacote: null", async () => {});
it("extrato da parceira: soma do mês, sem comanda cancelada", async () => {});
```

```tsx
it("chave desligada: mostra 'Dados da nota (para o nfse.gov.br)' e os botões Copiar", () => {});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** A vista "Notas fiscais" tem duas `Section`:
  - "Notas do período", com as colunas Comanda, Dia, Tipo, Ambiente, Situação e Valor;
  - "Para a nota das parceiras", com as colunas Mês, Parceira, CNPJ, Comandas e Valor.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit**: `feat(fiscal): rascunho da NFS-e na comanda, vista Notas fiscais e extrato das parceiras`

---

## Bloco 2: atrás da chave (depende do contador e da Casa)

### Task 11: NFS-e Nacional: certificado, DPS, assinatura e cliente da Sefin, item 26

**Files:**
- Create: `src/server/domain/fiscal/certificate.ts`, `src/server/domain/fiscal/dps-xml.ts`, `src/server/domain/fiscal/sign.ts`, `src/server/domain/fiscal/sefin-client.ts`, `test/fiscal-cert.ts` (gera um PFX autoassinado de teste com node-forge)
- Modify: `package.json` (`node-forge`, `xml-crypto`, `@types/node-forge`), `src/server/domain/fiscal/config.ts` (a prontidão passa a ler a validade do certificado)
- Test: `src/server/domain/fiscal/certificate.test.ts`, `dps-xml.test.ts`, `sign.test.ts`, `sefin-client.test.ts`

**Interfaces:**
- Consome: `NfseDraft` (Task 10) e `FiscalEmpresa` (Task 9).
- Produz:

```ts
// certificate.ts — porta lib/fiscal/certificado.ts do Norte Vendas, mas lendo do .env
export type FiscalCert = { certPem: string; keyPem: string; cnpj: string | null; notAfter: Date };
export function readPfx(pfx: Buffer, password: string): FiscalCert;
export async function loadFiscalCert(): Promise<FiscalCert | null>; // FISCAL_CERT_PATH + FISCAL_CERT_PASSWORD; null se faltar
// dps-xml.ts
export type DpsInput = { draft: NfseDraft; empresa: FiscalEmpresa; environment: "teste" | "producao"; series: number; number: number; emittedAt: Date };
export function dpsId(cnpj: string, series: number, number: number): string; // "DPS" + "2927408" + "2" + cnpj(14) + série(5, zeros à esq.) + nDPS(15, zeros à esq.) = 45 caracteres
export function buildDpsXml(i: DpsInput): { xml: string; id: string };
// sign.ts — assinatura XMLDSig envelopada (porta lib/fiscal/assinatura.ts com o elemento como parâmetro)
export function signXml(xml: string, o: { elementLocalName: string; id: string; cert: FiscalCert; algorithm: "sha1" | "sha256" }): string;
// sefin-client.ts
export type SefinTransport = (r: { method: "GET" | "HEAD" | "POST"; url: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;
export type SefinResult =
  | { kind: "autorizada"; accessKey: string; nfseXml: string; raw: unknown }
  | { kind: "rejeitada"; reasons: string[]; raw: unknown }
  | { kind: "falha"; error: string };       // rede, timeout, 5xx: tentar de novo
export function createSefinClient(o: { environment: "teste" | "producao"; transport?: SefinTransport; cert?: FiscalCert }): {
  emitir(signedDpsXml: string): Promise<SefinResult>;
  consultarDps(id: string): Promise<{ kind: "existe"; accessKey: string } | { kind: "nao_existe" } | { kind: "falha"; error: string }>;
  cancelar(accessKey: string, signedEventXml: string): Promise<{ ok: true } | { ok: false; reason: string }>;
};
export function httpsTransport(cert: FiscalCert, timeoutMs?: number): SefinTransport; // node:https com cert/key (mTLS), timeout padrão 30 s
```

**Valores que dependem do manual.** Escreva cada um como constante nomeada no topo de `sefin-client.ts` ou `dps-xml.ts`, com o comentário "conferido no Manual dos Contribuintes v1.2 / XSD em DD/MM". Confira tudo no manual (https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica) e no Swagger da Produção Restrita **antes** do Step 3:

| Constante | Valor esperado (conferir) |
|---|---|
| `SEFIN_URL.teste` | `https://sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| `SEFIN_URL.producao` | `https://sefin.nfse.gov.br/SefinNacional` |
| Envio | `POST {base}/nfse`, corpo `{ "dpsXmlGZipB64": "<gzip+base64>" }`; resposta com `chaveAcesso` e `nfseXmlGZipB64`; rejeição em 4xx com `erros[].Codigo/Descricao` |
| Consulta | `GET {base}/dps/{id}`, que devolve `chaveAcesso` (404 = não existe) |
| Cancelamento | `POST {base}/nfse/{chave}/eventos` com o pedido de evento de cancelamento (`e101101`) assinado |
| Id da DPS | `DPS` + cLocEmi(7) + tipo de inscrição (`2` = CNPJ) + CNPJ(14) + série(5) + nDPS(15) |
| Leiaute | `DPS versao="1.00"`, `tpAmb` 1 = produção / 2 = homologação, `cLocEmi` 2927408, `opSimpNac` 3 (ME/EPP) |
| Assinatura | algoritmo exigido no Anexo I (o Norte Vendas usa SHA1 por causa da NF-e; a DPS pode pedir SHA-256) |

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("Id da DPS tem 45 caracteres e o formato fixo", () => {
  expect(dpsId("11222333000181", 1, 42)).toBe("DPS292740821122233300018100001000000000000042");
});
it("DPS leva tpAmb 2 no teste, o valor do draft, o cTribNac e o CPF quando houver", () => {
  const { xml, id } = buildDpsXml({ draft, empresa, environment: "teste", series: 1, number: 42, emittedAt: new Date("2026-11-03T13:00:00Z") });
  expect(xml).toContain(`Id="${id}"`); expect(xml).toContain("<tpAmb>2</tpAmb>"); expect(xml).toContain("<cTribNac>060101</cTribNac>");
  expect(xml).toContain("<vServ>121.50</vServ>"); expect(xml).toContain("<CPF>52998224725</CPF>"); expect(xml).toContain(draft.discriminacao);
});
it("sem CPF a DPS sai sem tomador identificado", () => {});
it("caracteres especiais do texto escapados (&, <, aspas)", () => {});
it("assinatura confere com a chave pública do certificado de teste", () => { /* xml-crypto SignedXml.checkSignature */ });
it("readPfx lê CNPJ e validade; senha errada dá 'Senha do certificado não confere.'", () => {});
it("cliente: 201 → autorizada; 400 com erros → rejeitada com as descrições; timeout → falha", async () => { /* transport stub */ });
it("consultarDps: 200 → existe com a chave; 404 → nao_existe", async () => {});
it("o corpo do POST é o XML gzip+base64 (descompactado = o XML assinado)", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Conferir as constantes da tabela no manual e no Swagger.** Fixe os valores, com a data no comentário.
- [ ] **Step 4: Implementar.**
  - Valores decimais com ponto e 2 casas.
  - Datas em `AAAA-MM-DDThh:mm:ss-03:00`.
  - Nunca registrar em log o XML com CPF.
- [ ] **Step 5: Rodar e ver passar.** Run: `npx vitest run src/server/domain/fiscal && npm run typecheck`
- [ ] **Step 6: Commit**: `feat(fiscal): DPS, assinatura e cliente da Sefin Nacional (NFS-e)`

---

### Task 12: Emissão pela comanda, fila sem duplicar, cancelamento e teste na Produção Restrita, item 26

**Files:**
- Create: `src/server/domain/fiscal/nfse.ts`, `src/app/api/notas/[id]/route.ts`
- Modify:
  - `worker/index.ts`: fila `nota-fiscal`, `"* * * * *"`, `singletonKey: "nota-fiscal"`;
  - `src/server/domain/caixa/comandas.ts`:
    - `closeComanda` chama `queueNfseTx` quando `emitirAoFechar`;
    - as três portas de reabrir e cancelar chamam `assertNoAuthorizedNoteTx`;
  - `src/components/caixa/nota-fiscal-block.tsx`: situação, "Emitir nota", "Emitir de novo", "Cancelar nota", "Ver nota (PDF)" e "Baixar XML";
  - `src/app/(app)/caixa/actions.ts`: `emitirNota` e `cancelarNota`.
- Test: `src/server/domain/fiscal/nfse.test.ts`, `src/server/domain/caixa/comandas-cancelar.test.ts` (acrescentar)

**Interfaces:**
- Consome: `loadNfseDraft` (Task 10), `buildDpsXml`, `signXml`, `createSefinClient` e `loadFiscalCert` (Task 11), `getNfseModo` e `getFiscalEmpresa` (Task 9).
- Produz:

```ts
export type NfseDeps = { client: ReturnType<typeof createSefinClient>; cert: FiscalCert; now: () => Date };
export async function queueNfseTx(tx: Tx, comandaId: string, actorId: string, now: Date): Promise<{ id: string } | null>; // reserva o número e grava "pendente" com o XML assinado
export async function emitNfse(comandaId: string, actor: Actor, deps?: NfseDeps): Promise<{ id: string; status: string }>; // queue + uma tentativa já
export async function processPendingNfse(deps?: NfseDeps, limit?: number): Promise<{ autorizadas: number; rejeitadas: number; falhas: number }>; // o worker
export async function cancelNfse(docId: string, i: { reason: string }, actor: Actor, deps?: NfseDeps): Promise<void>;
export async function assertNoAuthorizedNoteTx(tx: Tx, comandaId: string): Promise<void>;
```

**Regras:**
- **`queueNfseTx`:**
  - com a chave `desligada`, erro "A nota fiscal está desligada em Configurações › Nota fiscal.";
  - comanda que não está `fechada`, erro "Feche a comanda antes de emitir a nota.";
  - draft `null`, erro "Essa comanda não tem serviço para nota.";
  - se já houver uma `pendente` ou `autorizada`, devolve a que existe sem criar outra; o índice único também garante;
  - o número vem de `fiscal_sequences`, com `SELECT … FOR UPDATE` e `INSERT … ON CONFLICT` para criar o contador da série;
  - o XML assinado fica em `request_xml`; reenviar usa **o mesmo** XML.
- **Uma tentativa:**
  - `emitir` devolveu `autorizada`: grava `accessKey`, `responseBody` e `authorizedAt`;
  - devolveu `rejeitada`: status `rejeitada`, com `rejectReason` = as descrições unidas por " · ";
  - devolveu `falha`: soma 1 em `attempts`, grava `lastError` e `nextTryAt = now + min(2^attempts, 30) min`.
- **Antes de reenviar uma `pendente` com `attempts > 0`,** o sistema roda `consultarDps(localId)`:
  - se a DPS existe, a nota fica `autorizada` com a chave, sem reenviar (Review Focus 2);
  - com `attempts >= 10`, o status vira `erro_envio`.
- **"Emitir de novo"** só existe para `rejeitada` e `erro_envio`, e cria outra linha com número novo.
- **`cancelNfse`:**
  - pede `caixa.gerir`;
  - a justificativa tem de 15 a 255 caracteres, ou dá o erro "Escreva o motivo do cancelamento (pelo menos 15 letras).";
  - monta e assina o evento e chama `cancelar`; se der certo, a nota vira `cancelada` com auditoria `nota_cancelada`.
- **`assertNoAuthorizedNoteTx`:** erro "Essa comanda tem nota fiscal autorizada: cancele a nota antes." (Review Focus 1).
- **`/api/notas/[id]`:**
  - pede `caixa.operar`;
  - `?formato=xml` devolve `request_xml` mais `responseBody`;
  - `?formato=pdf` busca o DANFSe no ADN com mTLS. Confira o caminho no Swagger do ADN. Se falhar, o erro é 502 com o texto "Abra a nota no nfse.gov.br com a chave {chave}.".

- [ ] **Step 1: Escrever os testes que falham** (transport stub, certificado de teste, `nfse_modo = teste`)

```ts
it("emitir: autorizada grava chave; clicar de novo não cria outra", async () => {});
it("timeout e depois o worker: consulta a DPS, acha e marca autorizada SEM reenviar", async () => {
  // stub: 1º POST → falha (timeout); GET /dps/{id} → 200 com chave; espera 1 POST no total
});
it("timeout e DPS inexistente: reenvia o MESMO XML e o mesmo número", async () => {});
it("10 falhas viram erro_envio; 'Emitir de novo' cria número novo", async () => {});
it("rejeitada mostra o motivo do governo", async () => {});
it("reabrir, reabrir para correção e cancelar comanda com nota autorizada: erro fixo", async () => {});
it("cancelar nota: motivo curto recusado; sem caixa.gerir recusado; ok vira cancelada e libera reabrir", async () => {});
it("chave desligada: emitir dá o erro fixo e nada é gravado", async () => {});
it("emitirAoFechar ligado: fechar a comanda deixa uma pendente; desligado, nada", async () => {});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `nfse.ts`, as ações, o bloco da comanda, a rota e a fila no worker.**
- [ ] **Step 4: Rodar e ver passar.** Run: `npx vitest run src/server/domain/fiscal src/server/domain/caixa && npm run typecheck && npm run lint`
- [ ] **Step 5: Roteiro na Produção Restrita** (manual, com o A1 da Casa no `.env` de um ambiente que não é o de produção, e `nfse_modo = teste`). Anote o resultado de cada passo no PR:
  1. comanda só com serviço de profissional CLT, com CPF: autorizada;
  2. comanda com serviço de parceira: autorizada, e o texto das cotas aparece no PDF;
  3. derrubar a rede no meio do envio: ao voltar, o worker acha a DPS e não duplica;
  4. cancelar a nota 1: cancelada;
  5. reenviar uma DPS já usada: o governo recusa, e o CRM mostra o motivo.

  Esperado: os 5 passos como descritos. Só depois disso a chave pode ir para `producao`, e só com o OK do contador.
- [ ] **Step 6: Commit**: `feat(fiscal): emissão da NFS-e pela comanda, fila sem duplicar e cancelamento`

---

### Task 13: NFC-e de produto (porte do Norte Vendas), item 29

**Depende de:** Tasks 5, 9 e 11 e, para sair do teste, da inscrição estadual mais o CSC.

**Files:**
- Create:
  - `src/server/domain/fiscal/nfce/chave-acesso.ts`, porte de `lib/fiscal/chaveAcesso.ts`;
  - `.../nfce/xml.ts`, porte de `montarXmlNota` só no modelo 65, com `emitente` vindo de `FiscalEmpresa`;
  - `.../nfce/qrcode.ts`;
  - `.../nfce/soap.ts`, com os endpoints SVRS do modelo 65 de homologação e produção e as URLs de consulta da BA, copiados do Norte Vendas;
  - `.../nfce/nfce.ts`;
  - `drizzle/0093_nfce.sql`, só se o índice de NFC-e precisar de ajuste. Se `fiscal_documents` da Task 9 já bastar, **não** crie a 0093.
- Modify: `src/components/caixa/nota-fiscal-block.tsx` (segunda linha "Nota de produto (NFC-e)"), `worker/index.ts` (a mesma fila processa as duas notas), `src/server/domain/fiscal/config.ts` (`setNfceModo`, com a mesma regra de produção)
- Test: `src/server/domain/fiscal/nfce/*.test.ts`

**Interfaces:**
- Consome:
  - `products` (NCM, CFOP, CSOSN, unidade, código de barras) e `comanda_items.net_cents` dos itens `produto`;
  - `comanda_payments`;
  - `signXml` com `elementLocalName: "infNFe"` e `algorithm: "sha1"`;
  - `loadFiscalCert`, `NFCE_CSC` e `NFCE_CSC_ID` do `.env`.
- Produz:

```ts
export function prorate(totalCents: number, weights: { key: string; cents: number }[]): Map<string, number>; // maiores restos; soma exata
export function tPagOf(method: PayMethod): "01" | "03" | "04" | "05" | "17" | "90" | "99"; // dinheiro 01, crédito 03, débito 04, crédito da cliente 05, pix 17, cortesia 90, outra 99
export async function queueNfceTx(tx: Tx, comandaId: string, actorId: string, now: Date): Promise<{ id: string } | null>;
export async function emitNfce(comandaId: string, actor: Actor): Promise<{ id: string; status: string }>;
export async function cancelNfce(docId: string, i: { reason: string }, actor: Actor): Promise<void>; // só até 30 min depois da autorização
```

**Regras:**
- A NFC-e leva só os itens `produto` com `net_cents > 0`, e todo produto precisa de NCM. Se faltar, o erro é "Produto {nome} sem NCM: complete em Serviços e pacotes › Produtos.".
- `<pag>`: as formas da comanda rateadas pelo valor dos produtos (`prorate`), sem cortesia.
- Os grupos de cartão usam `tpIntegra=2` e o `tBand` mapeado como no Norte Vendas.
- Contingência offline fica fora desta fase.

- [ ] **Step 1: Escrever os testes que falham**
  - Os testes da chave de acesso usam os mesmos casos do porte: DV de uma chave conhecida da SEFAZ-BA, tirada de `scripts/nfce-referencia` do Norte Vendas.
  - `prorate`: 3 formas que somam exatamente o total dos produtos.
  - XML 65: `tpAmb` 2 no teste, NCM, CFOP 5102, CSOSN 102, `vNF` igual à soma.
  - QR Code: o hash com o CSC de teste.
  - Comanda com produto sem NCM dá o erro fixo.
  - Comanda com serviço e produto gera duas notas, a NFS-e e a NFC-e, e cada uma com o próprio valor.
  - O cancelamento depois de 30 min é recusado com "A NFC-e só pode ser cancelada até 30 minutos depois de autorizada."
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Portar e implementar.** Copie os comentários que explicam rejeições reais (cStat 391, tBand) junto do código.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Roteiro na homologação SVRS** (manual, com `nfce_modo = teste`): emitir, consultar pelo QR Code e cancelar em menos de 30 min.
- [ ] **Step 6: Commit**: `feat(fiscal): NFC-e de produto (porte do Norte Vendas)`

---

## Decisões que ficam com o dono e o contador (o plano segue o padrão até alguém dizer o contrário)

| # | Pergunta | Padrão do plano | Quem decide |
|---|---|---|---|
| 1 | Regime da Casa (Simples ME/EPP?), IM, alíquota efetiva e cTribNac/NBS de cada serviço | Simples, `060101`, alíquota informada à mão todo mês | contador |
| 2 | Nota unificada do Salão Parceiro em Salvador: cotas só no texto ou com dedução? | só no texto (discriminação) | contador |
| 3 | A cota-parte da parceira é a "Comissão" do CRM (já com os descontos da Fase A)? | sim: cota = `commission_cents` | contador e dono, olhando os contratos |
| 4 | Nota de pacote: sai na venda ou em cada sessão? | na venda; a sessão fica fora | contador |
| 5 | A Casa tem IE e CNAE de comércio para vender produto com NFC-e? | sem NFC-e até confirmar; o estoque funciona do mesmo jeito | contador |
| 6 | Avec e CRM emitindo nota ao mesmo tempo: quem emite qual? | o CRM só emite comandas do caixa do CRM; o Avec segue com as dele. Nunca as duas para a mesma venda | dono |
| 7 | Emitir sozinha ao fechar a comanda ou só pelo botão? | só pelo botão (`emitirAoFechar = false`) | dono |
| 8 | Estoque com Avec e CRM juntos: o saldo segue o Avec enquanto o caixa for no Avec? | sim; com `caixa_modo = crm`, o CRM passa a mandar | dono |
| 9 | Plano B Focus NFe (R$ 94,90) se a Produção Restrita travar ou se a Casa não for do Simples | não construído; a troca fica só na camada `sefin-client` | dono |
| 10 | Comprar o e-CNPJ A1 e fazer o primeiro acesso no nfse.gov.br; CNPJ e contrato homologado de cada parceira | sem isso, a chave fica em `desligada` e vale o rascunho da Task 10 | Casa |

## Nota de integração (coordenador, 18/10)
Os números e os `when` das migrations destas fases se cruzam (A usa 0061–0067 até 1792430000000; B, C e D começam em 1792380000000, 1792390000000 e 1792400000000). Ao juntar uma fase em `ia-sugestao`, renumere as migrations dela para depois da última já integrada, com `when` maior que todos, e reindexe o `_journal.json`. O drizzle pula migration com `when` menor que a última aplicada.

## Regra do dono para todas as fases (18/10, vale acima de qualquer padrão deste plano)
- **Tudo configurável:** todo número de regra (porcentagens, taxas, prazos, horários, limites, quantidades) fica editável em Configurações, com o padrão deste plano como valor inicial. Nada fica fixo no código.
- **Todo texto que a cliente ou a equipe recebe** (mensagens, avisos, recibos, perguntas) fica editável em Configurações, com variáveis e botão "Usar o texto sugerido".
- **Toda funcionalidade nova nasce com um liga/desliga** em Configurações. O que manda mensagem para a cliente nasce **desligado**.
- **Toda ação nova tem uma permissão própria**, atribuível por perfil em Configurações › Pessoas › Perfis. O padrão dos perfis segue este plano.
- Teste em cada tarefa: mudar a configuração muda o comportamento, e sem a permissão a ação é recusada no servidor.
