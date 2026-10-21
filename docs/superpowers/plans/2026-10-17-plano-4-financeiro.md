# Plano 4: Relatórios › Financeiro e Caixa › Fechar o dia

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (escolha do dono: execução na própria sessão, com TDD, sem pedir aprovação). Passos com checkbox (`- [ ]`).

**Objetivo:** a gestão vê o dinheiro da Casa por período (CRM e Avec lado a lado, sem somar) e exporta em Excel; a recepção fecha o dia num assistente de 3 passos.

**Arquitetura:** leitura nova e isolada em `src/server/reports/financeiro/` (entradas, itens, exceções, montagem e Excel) e `src/server/queries/fechar-dia.ts`. O lado CRM lê `comandas`/`comanda_items`/`comanda_payments`/`cash_sessions`/`cash_movements`; o lado Avec lê `sales_payments`/`sales_items` (reaproveitando as funções do Salão). Telas novas em `src/components/reports/financeiro.tsx` e `src/components/fechar-dia/`. Em `src/components/caixa` e `src/server/domain/caixa` nada muda (só se importa `cashSummary`, `getOpenCashTx`, `commissionReport`, `CashCloseSheet`, `ComandaProvider`).

**Tech:** Next 16.4 (App Router, `PageProps`/`RouteContext` gerados por `next typegen`), Drizzle + Postgres, exceljs 4.4 (já no projeto), Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md` (seções "Fechar o dia e Financeiro" e "Decisões do dono").

## Restrições globais
- Tudo na tela em PT-BR, com os nomes da spec: "Comanda", "Fechar o dia", "Financeiro", "Finalizado".
- Dinheiro em centavos; na tela `money()` de `@/lib/format`; no Excel número com formato `"R$" #,##0.00`.
- CRM e Avec nunca somados: cada número diz de qual lado é; a diferença é CRM − Avec.
- Financeiro: `relatorios.ver` + `valores.ver`. Excel: também `relatorios.exportar`. Fechar o dia: `caixa.operar`.
- Com `caixa_modo = avec`: Fechar o dia mostra os passos 1 e 2 e, no 3, o aviso `CAIXA_OFF` ("O caixa ainda é no Avec.").
- Sem migration (o plano não cria coluna). Se precisar: `0056`, `when` 1792320000000.
- Bancos: dev `crm_fin4`; vitest `crm_test_fin4` (`DATABASE_URL=…/crm_test_fin4 npx vitest run`); e2e `crm_e2e_fin4`, portas 3505/3506.
- Proibido: portas 3000/3100/4321/4400/8080 (o 8080 só aparece como `EVOLUTION_URL` no comando do e2e, para a guarda), pkill/killall, push, deploy, WhatsApp.

## Rulings (decisões que a spec deixa abertas)
1. **Entradas** = soma dos pagamentos das comandas fechadas (CRM, pela `comandas.day`; troco tirado do dinheiro, como `dayTotals`) e dos pagamentos do Avec (pela `coalesce(paid_on, comanda_on)`, como o Salão). Crédito da cliente entra (é como o Avec e o `dayTotals` contam); **Cortesia** (forma que o plano 3 cria) aparece em Formas e Exceções, mas não em Entradas.
2. **Ticket médio** = entradas ÷ comandas, de cada lado. Comanda do Avec = (`comanda_on`, `comanda`) com pagamento no período.
3. **Formas** casadas por chave: Pix, Crédito, Débito, Dinheiro, Crédito da cliente, Cortesia; o resto do Avec (Dívida, Voucher…) vira "outra:<nome>" com o nome original.
4. **Por profissional / serviço** no CRM: total do item menos a parte dele no desconto da comanda (`splitDiscount`); sessão de pacote vale 0 (como no Salão). No Avec: `salonByProfessional`/`salonByService` (os números do Salão), sem o corte em 15.
5. **Exceções** saem dos dados (que sempre existem) e buscam quem e o motivo no `audit_log` da mesma entidade (`entity_id` = item ou comanda, `data->>'motivo'`), caindo para quem lançou/fechou e "sem motivo registrado". Assim o que o plano 3 auditar aparece sozinho no merge. Tipos: desconto no item, desconto na comanda, preço alterado (unitário ≠ preço do catálogo), cortesia, item cancelado em comanda fechada, comanda cancelada, comanda reaberta para corrigir, sangria; do Avec: desconto e item a R$ 0 (sem pacote).
6. **Caixas (pessoa)** = `cash_sessions.opened_by` das sessões abertas no período; comanda fechada sem caixa vai em "Sem caixa aberto".
7. **Período** do Financeiro = o do Salão (`salonRange`: hoje, 7 dias, este mês, mês passado, este ano, datas livres), pelo mesmo `SalonPeriodPicker` com `aba`. Os filtros "pessoa" e "origem" da Visão geral não se aplicam a dinheiro de caixa e não aparecem.
8. **Fechar o dia, passo 1**: hoje, status ativo (`solicitado`, `agendado`, `confirmado`, `chegou`, `em_atendimento`) e `starts_at + coalesce(duration_min, 60) min` já passou; gêmeos do Avec (`avec_twin_of`) e lista de espera fora. Sugestão do Avec, nesta ordem: status do gêmeo do Avec; `avec_status` do horário mexido no CRM; comanda do Avec no dia para a mesma cliente (`sales_items` de origem avec, mesmo contato ou mesmo nome normalizado) = "veio". Ações pelo `markManyAction` já existente (mesma permissão e Desfazer).
9. **Passo 2**: todas as comandas abertas até hoje (as de dias anteriores também, marcadas com o dia), porque o `closeCash` também conta todas.
10. **Passo 3**: o caixa aberto de hoje pela interface atual (`getOpenCashTx` + `cashSummary` + `CashCloseSheet`); mostra quem abriu. O plano 3 troca por "o meu caixa" no merge.
11. **Menu**: Caixa ganha "Fechar o dia". Com o caixa no Avec, o item Caixa continua fora da barra do celular, mas aparece no menu (no "Mais", no celular) só com "Fechar o dia", apontando para `/caixa/fechar-dia`. Relatórios ganha "Financeiro" depois de Análise.
12. **Excel** com nome do cliente (é da gestão com `relatorios.exportar`, como os relatórios do Avec); texto que começa com `= + - @` vai com `'` (injeção de planilha).

## Review Focus
1. Período sem nenhum dado (CRM desligado, hoje antes do primeiro import): toda seção mostra "Nenhum …", nunca NaN, R$ NaN ou divisão por zero no ticket. → teste em Task 2 (`ticket null com 0 comandas`) e Task 5 (render vazio).
2. Comanda cancelada, pagamento estornado (`cancelled_at`) e item cancelado não entram em Entradas, Formas nem por profissional. → teste em Task 2 e Task 3.
3. Pessoa sem `valores.ver` abrindo `/relatorios?aba=financeiro` direto pela URL cai na Visão geral, e o Excel responde 403. → teste em Task 5 (route) e Task 6 (e2e).
4. Avec com valores negativos (Crédito Cliente, Dívida) e formas desconhecidas não quebram a tabela de Formas. → teste em Task 1 e Task 2.
5. Fechar o dia com `caixa_modo = avec`: passo 3 é só o aviso e o passo 1 funciona; horário que ainda não acabou (começou, mas está dentro da duração) não aparece. → teste em Task 7 e Task 8.

---

### Task 1: Formas de pagamento casadas (puro)

**Files:**
- Create: `src/server/reports/financeiro/methods.ts`
- Test: `src/server/reports/financeiro/methods.test.ts`

**Interfaces — Produces:**
- `methodKey(raw: string | null): string` — `"pix" | "credito" | "debito" | "dinheiro" | "credito_cliente" | "cortesia"` ou `"outra:<nome original aparado>"`; vazio → `"outra:Não informada"`.
- `methodLabel(key: string): string` — usa `PAY_LABEL` de `@/lib/comanda-math` + `{ cortesia: "Cortesia" }`; `outra:X` → `X`.
- `isRevenue(key: string): boolean` — falso só para `cortesia`.
- `METHOD_ORDER: readonly string[]` = `["pix","credito","debito","dinheiro","credito_cliente","cortesia"]`.

- [ ] **Step 1: teste** — `methodKey` com os nomes reais de produção: `"Cartão Crédito (MasterCard)"→"credito"`, `"Cartão Débito (ELO)"→"debito"`, `"Pix"→"pix"`, `"Dinheiro"→"dinheiro"`, `"Crédito Cliente"→"credito_cliente"`, `"Dívida"→"outra:Dívida"`, `"Voucher"→"outra:Voucher"`, `null→"outra:Não informada"`; chaves do CRM (`"pix"`, `"credito_cliente"`, `"cortesia"`) voltam iguais; `methodLabel("credito_cliente")==="Crédito da cliente"`, `methodLabel("outra:Dívida")==="Dívida"`; `isRevenue("cortesia")===false`, `isRevenue("pix")===true`.
- [ ] **Step 2:** rodar `npx vitest run src/server/reports/financeiro/methods.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar; normalizar com `normText` de `@/server/domain/avec/normalize` (sem acento, minúsculo); "credito cliente" testado antes de "credito".
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): formas de pagamento do CRM e do Avec na mesma chave`.

### Task 2: Entradas, formas, dias e caixas

**Files:**
- Create: `src/server/reports/financeiro/entradas.ts`
- Test: `src/server/reports/financeiro/entradas.test.ts` (fixtures: `test/caixa-fixtures.ts`, `test/salon-fixtures.ts`)

**Interfaces — Consumes:** Task 1; `DayRange`, `salonBuckets`, `bucketLabel` (Salão).
**Produces:**
```ts
export type Side = { entradasCents: number; comandas: number; ticketCents: number | null };
export type FinanceDay = { key: string; label: string; crmCents: number; avecCents: number };
export type FinanceMethod = { key: string; label: string; revenue: boolean; crmCents: number; crmN: number; avecCents: number; avecN: number };
export type FinanceCashier = { sessionId: string | null; day: string | null; userName: string; openedAt: string | null; closedAt: string | null;
  status: "aberto" | "fechado" | null; openingCents: number; entradasCents: number; comandas: number; differenceCents: number | null };
export async function financeEntradas(r: SalonRange): Promise<{ crm: Side; avec: Side; days: FinanceDay[]; methods: FinanceMethod[]; cashiers: FinanceCashier[] }>;
```

- [ ] **Step 1: testes** (dia 2026-10-15; `setupCaixa()`):
  - CRM: comanda fechada A (Pix 5000 + Dinheiro 7000, troco 1000), comanda fechada B (`cortesia` 3000), comanda cancelada C (Pix 9000), pagamento estornado em A (Pix 4000 com `cancelled_at`) → `crm = { entradasCents: 11000, comandas: 2, ticketCents: 5500 }`; método `dinheiro.crmCents === 6000`; `cortesia` com `revenue:false` e `crmCents:3000`; nada da C.
  - Avec: pagamentos `Cartão Crédito (Visa)` 10000 (comanda "1"), `Crédito Cliente` −2000 (comanda "1"), `Pix` 5000 (comanda "2", `paidOn` 2026-10-16 → fora de um período só de 15/10) → `avec = { entradasCents: 8000, comandas: 1, ticketCents: 8000 }`; `methods` tem `credito.avecCents 10000` e `credito_cliente.avecCents -2000`.
  - Dias: período 14–15/10 → `days` com as duas chaves, 14/10 zerado.
  - Caixas: sessão aberta pela Cati com A dentro e B sem caixa → `cashiers` = [`{ userName: "Cati Souza", entradasCents: 11000, comandas: 1 }`, `{ sessionId: null, userName: "Sem caixa aberto", comandas: 1, entradasCents: 0 }`] (B é só cortesia).
  - Vazio: sem nada → `crm.ticketCents === null`, `avec.ticketCents === null`, `methods` vazio.
- [ ] **Step 2:** `DATABASE_URL=…/crm_test_fin4 npx vitest run src/server/reports/financeiro/entradas.test.ts` → FAIL.
- [ ] **Step 3:** implementar com SQL (`rows` de `../common`). CRM: pagamentos vivos de comandas `fechada` com `day` no período, agrupados por comanda/forma; troco subtraído do dinheiro da própria comanda; Entradas exclui `!isRevenue`. Avec: `sales_payments` agrupado por `methodKey` em JS. Caixa: `teamNameOf` não serve em SQL cru, use `users.name`.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): entradas por dia, forma e caixa, CRM ao lado do Avec`.

### Task 3: Profissional, serviço/categoria, pacotes e comissão

**Files:**
- Create: `src/server/reports/financeiro/itens.ts`
- Test: `src/server/reports/financeiro/itens.test.ts`

**Interfaces — Consumes:** `salonByProfessional`, `salonByService`, `REVENUE` (Salão); `commissionReport` (`@/server/domain/caixa/commission`); `splitDiscount` (`@/lib/comanda-math`).
**Produces:**
```ts
export type FinanceItem = { origin: "crm" | "avec"; day: string; comanda: string; client: string | null; item: string; kind: string; category: string;
  professional: string; valueCents: number | null; discountCents: number; netCents: number; commissionCents: number | null };
export type FinancePro = { key: string; name: string; crmCents: number; crmItens: number; avecCents: number; avecItens: number; crmCommissionCents: number | null; avecCommissionCents: number | null };
export type FinanceGroup = { key: string; label: string; category?: string; crmN: number; crmCents: number; avecN: number; avecCents: number };
export type FinancePackages = { crm: { vendidos: number; cents: number; sessoes: number }; avec: { vendidos: number; cents: number; sessoes: number }; byName: { name: string; crm: number; avec: number }[] };
export type FinanceCommission = { crmCents: number; crmPending: number; avecCents: number | null };
export async function crmItems(r: DayRange): Promise<FinanceItem[]>;          // itens vivos de comandas fechadas, net com a parte do desconto da comanda
export async function avecItems(r: DayRange): Promise<FinanceItem[]>;         // sales_items do período (para o Excel)
export async function financeItens(r: DayRange): Promise<{ professionals: FinancePro[]; services: FinanceGroup[]; categories: FinanceGroup[]; packages: FinancePackages; commission: FinanceCommission }>;
```
- [ ] **Step 1: testes**:
  - CRM: comanda fechada com Corte (Ana, 12000) e Hidratação (Bia, 9000, desconto do item 1000), desconto da comanda 2000, mais um item cancelado (Ana, 5000) → Ana `crmCents` = 12000 − parte de 2000 pelo `splitDiscount` (ex.: 12000−1200=10800), Bia 8000−800=7200; item cancelado fora; categoria "Cabelo" soma 18000.
  - Avec: `item({ proName: "MAIARA TESTE", value: 25000, commissionCents: 10000 })` → linha "MAIARA TESTE" com `avecCents 25000`, `avecCommissionCents 10000`, `crmCents 0`.
  - Pacotes: um `client_packages` crm (comprado no dia, 50000) e um avec cancelado + um `package_uses` avec no dia → `crm.vendidos 1, crm.cents 50000`, `avec.vendidos 0`, `avec.sessoes 1`.
  - Comissão: com regra 40% no Corte da Ana e a comanda fechada pelo `closeComanda` → `commission.crmCents` igual ao total de `commissionReport({from,to})`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; serviço do CRM agrupa por `label` com `lists.category` (sem → "Sem categoria"); pacote de cliente cancelado (`cancelled_at`) fora; pacotes por `purchased_on`, sessões por `used_on`.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): por profissional, serviço, categoria, pacotes e comissão`.

### Task 4: Exceções (descontos, cortesias, preços alterados)

**Files:**
- Create: `src/server/reports/financeiro/excecoes.ts`
- Test: `src/server/reports/financeiro/excecoes.test.ts`

**Produces:**
```ts
export type ExceptionKind = "desconto_item" | "desconto_comanda" | "preco_alterado" | "cortesia" | "item_cancelado" | "comanda_cancelada" | "comanda_reaberta" | "sangria" | "desconto_avec" | "zero_avec";
export const EXCEPTION_LABEL: Record<ExceptionKind, string>; // "Desconto no item", "Desconto na comanda", "Preço alterado", "Cortesia", "Item cancelado", "Comanda cancelada", "Comanda reaberta para corrigir", "Sangria", "Desconto (Avec)", "Item a R$ 0 (Avec)"
export type FinanceException = { origin: "crm" | "avec"; kind: ExceptionKind; day: string; at: string | null; comanda: string | null; client: string | null; item: string | null;
  who: string | null; beforeCents: number | null; afterCents: number | null; valueCents: number | null; reason: string | null };
export async function financeExceptions(r: DayRange): Promise<FinanceException[]>; // mais recente primeiro
```
- [ ] **Step 1: testes**:
  - Item com `discount_cents 1000` em comanda fechada, lançado pela Cati, sem auditoria → `{ kind: "desconto_item", who: "Cati Souza", valueCents: 1000, reason: null }`.
  - O mesmo com `audit_log` `{ entity: "comanda_item", entity_id: <item>, user_id: gestora, data: { motivo: "cliente antiga" } }` → `who: "Thaíse Fiaes", reason: "cliente antiga"`.
  - Corte com `unit_cents 10000` e catálogo 12000 → `{ kind: "preco_alterado", beforeCents: 12000, afterCents: 10000 }`.
  - Pagamento `cortesia` 3000 → `{ kind: "cortesia", valueCents: 3000 }`; comanda cancelada com `cancel_reason "duplicada"` → `reason: "duplicada"`; sangria com motivo "banco" → `kind "sangria"`.
  - Avec: `item({ value: 10000, discount: 2000 })` → `desconto_avec 2000`; `item({ value: 0, total: 0 })` → `zero_avec`; `fromPackage: true` com total 0 → nada.
  - Comanda aberta com desconto → não aparece (só fechadas e canceladas).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; a busca do motivo: último `audit_log` com `entity_id` = id do item/comanda e `data ? 'motivo'`.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): exceções com quem fez e o motivo`.

### Task 5: Montagem, Excel e rota de download

**Files:**
- Create: `src/server/reports/financeiro/index.ts`, `src/server/reports/financeiro/xlsx.ts`, `src/app/api/relatorios/excel-financeiro/route.ts`
- Test: `src/server/reports/financeiro/xlsx.test.ts`, `src/app/api/relatorios/excel-financeiro/route.test.ts`

**Produces:**
```ts
// index.ts
export type FinanceView = { range: SalonRange; avecUntil: string | null; caixaMode: CaixaMode; crm: Side; avec: Side; days: FinanceDay[]; methods: FinanceMethod[];
  cashiers: FinanceCashier[]; professionals: FinancePro[]; services: FinanceGroup[]; categories: FinanceGroup[]; packages: FinancePackages; commission: FinanceCommission; exceptions: FinanceException[] };
export async function loadFinanceiro(range: SalonRange): Promise<FinanceView>;
export type FinanceSale = { origin: "crm" | "avec"; day: string; comanda: string; client: string | null; cashier: string | null; totalCents: number; methods: string };
export async function financeSales(r: DayRange): Promise<FinanceSale[]>;
// xlsx.ts
export const FIN_SHEETS = ["Painel", "Formas", "Caixas", "Vendas", "Itens", "Exceções"] as const;
export async function buildFinanceiroXlsx(v: FinanceView, d: { sales: FinanceSale[]; items: FinanceItem[]; geradoPor: string; geradoEm: Date }): Promise<Buffer>;
export const financeiroFileName = (r: SalonRange) => `financeiro_${r.from}_a_${r.to}.xlsx`;
```
- [ ] **Step 1: testes**:
  - xlsx: montar com um `FinanceView` mínimo → reabrir com exceljs: nomes das abas = `FIN_SHEETS`; Painel tem "Entradas CRM" e "Entradas Avec"; Formas tem a linha "Pix" com CRM 50 e Avec 0 (em reais, `numFmt` com "R$"); célula de cliente `"=HYPERLINK(...)"` sai com `'` na frente.
  - rota: sem sessão → 401; usuário sem `valores.ver` → 403; com gestão → 200, `content-type` xlsx e `content-disposition` com `financeiro_2026-10-01_a_2026-10-15.xlsx` (período `?de=2026-10-01&ate=2026-10-15`). Seguir o padrão de `src/app/api/relatorios/avec/route.test.ts` para a sessão.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar. Cabeçalho azul-escuro da Casa (`ink`) com texto branco e linha congelada, como o `fechamentoXlsx` do Norte Vendas (só leitura, referência de estilo); horários deslocados −3 h (o Excel não guarda fuso).
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): Excel com Painel, Formas, Caixas, Vendas, Itens e Exceções`.

### Task 6: Aba Financeiro na tela e no menu

**Files:**
- Create: `src/components/reports/financeiro.tsx`, `src/components/reports/financeiro.render.test.tsx`
- Modify: `src/app/(app)/relatorios/page.tsx`, `src/components/reports/report-tabs.tsx`, `src/components/reports/salon-period-picker.tsx`, `src/lib/salon-period.ts` (`salonQuery(r, aba = "salao")`), `src/lib/report-legend.ts` (chaves `fin*`), `src/components/shell/nav.ts`, `src/components/shell/nav.test.ts`

**Interfaces — Consumes:** `FinanceView` (Task 5). **Produces:** `FinanceTab({ d, excelHref }: { d: FinanceView; excelHref: string | null })`; `ReportTab` ganha `"financeiro"`; `ReportTabs({ value, salon, financeiro })`; `SalonPeriodPicker({ preset, from, to, aba? })`.

- [ ] **Step 1: testes**:
  - nav: gestão vê `Relatórios › Financeiro` (`/relatorios?aba=financeiro`) entre Análise e Comissão; perfil sem `valores.ver` não vê; `activeNav(items, "/relatorios", "?aba=financeiro")` → `{ item: "relatorios", sub: "/relatorios?aba=financeiro" }`.
  - render: com dados, mostra os títulos "Entradas", "Formas de pagamento", "Por caixa", "Por profissional", "Por serviço e categoria", "Descontos, cortesias e preços alterados", "Pacotes", "Comissão"; colunas "CRM", "Avec", "Diferença"; com `caixaMode "avec"` e CRM zerado, a frase "O caixa do CRM ainda está desligado: os números do CRM aparecem quando ele for ligado."; vazio → "Nenhum pagamento no período." e nenhum "NaN".
  - `salonQuery({ preset: "7d", from, to }, "financeiro")` → `"aba=financeiro&periodo=7d"`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar com `Section`, `DataList`, `Muted` e o `Fig` do Salão (mover `Fig` para `src/components/reports/fig.tsx` e importar nos dois). Página: `aba=financeiro` só com `valores.ver` (senão Visão geral); período por `salonRange`; esconde `PeriodTabs`, `ExportMenu` e `PdfMenu` nessa aba; botão "Baixar Excel" (`/api/relatorios/excel-financeiro?<período>`) só com `relatorios.exportar`. `ReportTabs`: ao trocar para `salao`/`financeiro`, mantém `de`/`ate`. Link "Ver a comissão por linha" para `/caixa/comissao?de=…&ate=…`.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(financeiro): aba Financeiro em Relatórios e no menu`.

### Task 7: Fechar o dia, leitura

**Files:**
- Create: `src/server/queries/fechar-dia.ts`
- Test: `src/server/queries/fechar-dia.test.ts`

**Produces:**
```ts
export type AvecHint = { status: "compareceu" | "faltou" | "cancelado" | "aberto"; why: "status" | "comanda" };
export type NoOutcomeRow = { id: string; startsAt: string; endsAt: string; clientName: string; contactId: string | null; professional: string | null; service: string;
  status: string; avec: AvecHint | null; suggest: "compareceu" | "faltou" | null };
export async function noOutcomeToday(now: Date): Promise<NoOutcomeRow[]>;
export type OpenComandaRow = { id: string; day: string; number: number; clientName: string; itens: number; totalCents: number | null; paidCents: number };
export async function openComandasUntil(today: string): Promise<OpenComandaRow[]>;
export type CashStep = { mode: "avec" } | { mode: "crm"; open: null } | { mode: "crm"; open: { id: string; openedByName: string; openedAt: string; mine: boolean; expected: Record<"pix" | "credito" | "debito" | "dinheiro", number>; openComandas: number } };
export async function cashStep(userId: string): Promise<CashStep>;
```
- [ ] **Step 1: testes** (`NOW = bahia(15, 9)` não serve para "depois do fim": usar `bahia(15, 18)`):
  - horário Avec 10h (60 min) `agendado` → aparece, `avec: { status: "aberto", why: "status" }`, `suggest: null`; com `sales_items` avec do dia para o mesmo contato → `{ status: "compareceu", why: "comanda" }`, `suggest: "compareceu"`.
  - horário CRM mexido (`crm_touched_at`) com `avec_status "faltou"` → `suggest: "faltou"`; horário CRM com gêmeo do Avec `cancelado` → `avec.status "cancelado"`, `suggest: null`; o gêmeo não aparece como linha.
  - 17h30 com 60 min (ainda dentro) → não aparece; `compareceu`, `faltou`, `espera` e horário de ontem → não aparecem.
  - `openComandasUntil("2026-10-15")`: aberta de hoje e de 14/10 aparecem (mais antiga primeiro), fechada não.
  - `cashStep`: modo avec → `{ mode: "avec" }`; crm sem caixa → `{ mode: "crm", open: null }`; aberto pela Cati → `openedByName "Cati Souza"`, `mine` true para a Cati e false para a gestora, `expected.dinheiro` = troco.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; `statusGroup` de `@/lib/appointment-status` para o status do Avec; `normText` para o nome.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(fechar-dia): horários sem desfecho com o Avec sugerido, comandas abertas e o caixa`.

### Task 8: Fechar o dia, tela e menu

**Files:**
- Create: `src/app/(app)/caixa/fechar-dia/page.tsx`, `src/components/fechar-dia/close-day.tsx`, `src/components/fechar-dia/close-day.test.tsx`
- Modify: `src/components/shell/nav.ts`, `src/components/shell/nav.test.ts`

**Interfaces — Consumes:** Task 7; `markManyAction`/`undoManyAction` (`@/app/(app)/agenda/actions`); `CashCloseSheet`; `ComandaProvider`/`useComanda`.
**Produces:** `CloseDay({ today, noOutcome, comandas, cash, step }: { …; step: 1 | 2 | 3 })`; NavSub `caixa: true` em "A receber" e "Fechamentos".

- [ ] **Step 1: testes**:
  - nav: `navFor(gestao, { caixaOn: true })` → Caixa com subs `["/caixa", "/caixa/fechar-dia", "/caixa/fechamentos"]`, `mobile: "bar"`; `caixaOn: false` → Caixa presente com `href "/caixa/fechar-dia"`, só o sub Fechar o dia e `mobile: "mais"`; sem `caixa.operar` → sem Caixa; `activeNav(items, "/caixa/fechar-dia", "")` → `{ item: "caixa", sub: "/caixa/fechar-dia" }`.
  - render: passo 1 mostra a cliente, o chip "Avec: veio (comanda)" e os botões "Compareceu" e "Faltou" desabilitados sem seleção; "Selecionar as que o Avec diz que vieram (1)" marca a linha; passo 3 com `{ mode: "avec" }` mostra "O caixa ainda é no Avec." e nenhum botão "Fechar caixa"; com caixa aberto mostra "Aberto por Cati" e o botão "Fechar caixa"; a navegação mostra "1 Horários sem desfecho", "2 Comandas abertas", "3 Fechar o caixa" com as contagens.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar. Página: `requirePerm("caixa.operar")`, `?passo=1|2|3` (padrão 1), `LiveRefresh scopes={["caixa"]}`; no modo crm envolve em `ComandaProvider` com o mesmo catálogo de `/caixa` (o botão "Abrir" da comanda usa `useComanda()?.openById`). Ao marcar, as linhas feitas somem e o toast tem Desfazer (mesmo texto do Sem baixa).
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5:** commit `feat(fechar-dia): assistente de 3 passos e o subtópico no menu`.

### Task 9: e2e e capturas

**Files:**
- Create: `e2e/financeiro.spec.ts`

- [ ] **Step 1:** spec (desktop; dados com prefixo `e2e-fin:` e limpos no `afterAll`):
  - gestão em `/relatorios?aba=financeiro&de=2026-09-01&ate=2026-09-30` com pagamentos do Avec inseridos: aba Financeiro selecionada, "Formas de pagamento" com Pix, coluna Avec, sem rolagem lateral; "Baixar Excel" baixa `financeiro_2026-09-01_a_2026-09-30.xlsx` e o arquivo abre com as 6 abas.
  - perfil sem `valores.ver` em `/relatorios?aba=financeiro` vê a Visão geral; `/api/relatorios/excel-financeiro` → 403.
  - `caixa_modo = avec`: `/caixa/fechar-dia` lista o horário Avec de hoje que já acabou, com a sugestão; "Compareceu" em lote marca; passo 3 mostra "O caixa ainda é no Avec.". Menu: Relatórios › Financeiro e Caixa › Fechar o dia.
  - `caixa_modo = crm` com caixa aberto: passo 2 lista a comanda aberta; passo 3 fecha o caixa com o dinheiro contado.
  - capturas com `CF_SHOTS_DIR=~/Projects/casa-fiaes/ops/capturas` via `shot()`: `financeiro-relatorio`, `financeiro-relatorio-celular` (viewport 390), `financeiro-fechar-dia-passo1`, `financeiro-fechar-dia-passo3-avec`, `financeiro-fechar-dia-passo3-crm`.
- [ ] **Step 2:** rodar `DATABASE_URL=postgresql://…/crm_e2e_fin4 E2E_PORT=3505 EVOLUTION_URL=http://127.0.0.1:8080 CF_SHOTS_DIR=… npx playwright test e2e/financeiro.spec.ts --project=setup --project=desktop` → PASS (headless).
- [ ] **Step 3:** commit `test(e2e): Financeiro e Fechar o dia`.

### Task 10: Verificação e revisão final
- [ ] `DATABASE_URL=…/crm_test_fin4 npx vitest run` (completo) → 0 falhas.
- [ ] `npx next typegen && npx tsc --noEmit` → sem erro; `npm run lint` → sem erro.
- [ ] e2e novos (Task 9) e os que tocam o menu e Relatórios (`relatorios-salao.spec.ts`, `relatorios.spec.ts`) → PASS.
- [ ] Revisão final do branch inteiro (superpowers:requesting-code-review), corrigir o que vier, commit. Parar sem merge e sem push.
