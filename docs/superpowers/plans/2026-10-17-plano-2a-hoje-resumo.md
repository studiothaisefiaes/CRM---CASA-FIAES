# Hoje como resumo (protótipo v3) — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (escolhido pelo dono; o protótipo já foi aprovado, sem rodada de aprovação do plano). Passos com checkbox (`- [ ]`).

**Objetivo:** trocar o quadro de colunas do Hoje (`/`) por um resumo: saudação, faixa escura "Para você agora", grade de blocos compactos que abrem o painel grande e, dentro de "O dia na Casa", a tabela do dia.

**Arquitetura:** as regras do dia (quem entra na tabela, situação, números, ação da linha, "passou da hora") ficam puras em `src/lib/day-visit.ts`, testadas sem banco. A tela usa um bloco novo (`ResumoBloco`: a região inteira é um botão que abre o `Sheet` com `PAINEL_GRANDE`) e reaproveita as listas que já existem (combinados, esperando, aniversários, equipe, comparecimentos) dentro dos painéis. A tabela do dia é um componente cliente (`DayTable`) que abre a visita (`DayVisitSheet`) ou a comanda (`useComanda`).

**Stack:** Next 16 (App Router, RSC), React 19, Drizzle/Postgres, Tailwind, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md` (seção "Hoje › Recepção", agora substituída pelo protótipo v3) e `ops/prototipos/hoje-recepcao.html` (v3, aprovado pelo dono em 17/10). O pedido do dono manda sobre a spec onde os dois divergem: a faixa de 4 números e o quadro de colunas saem.

## Restrições globais
- Todo texto de tela em PT-BR.
- Nome de serviço sempre por `displayName` (nunca TUDO EM MAIÚSCULAS).
- Telefone cru nunca aparece: nome, ou "cliente com final 5353" (`clientLabel`), com inicial maiúscula no começo da linha.
- Cores de estado: `VIEW_STATUS` (`src/lib/agenda-day.ts`). Atraso para chegar: texto discreto em cor de aviso (`text-gold-ink`), nunca pílula vermelha.
- "Falta pagar" e o número "faltam pagar" só com `caixa_modo = "crm"`; sem ele, somem.
- Fora da tabela e dos números: cliente "CLIENTE PADRÃO" (comparação sem maiúsculas e sem acento), espera às 00:00 (status `espera*` ou horário 00:00 de Salvador) e cancelado (só conta em "Não vieram" se cancelou hoje).
- Grade: 3 colunas no computador (`lg`), 2 no tablet (`sm`), 1 no celular; "O dia na Casa" ocupa 2 colunas a partir do tablet.
- Prévias: Meus combinados até 3, Avisos até 3, Aniversário até 3, Esperando resposta até 2, próximas chegadas 2.
- e2e: banco com `crm_e2e` no nome, migrado antes; `E2E_PORT=3495`; `EVOLUTION_URL=http://127.0.0.1:8080` só no comando. Nunca portas 3000/3100/4321/4400/8080.

## Foco da revisão
1. Visita com serviço às 00:00 junto com serviço real no mesmo dia: só o 00:00 sai; a visita fica, com a hora do primeiro serviço real.
2. Visita só com cancelados de outro dia (cancelou ontem o horário de hoje): some da tabela e de "Não vieram"; cancelou hoje: "Não veio".
3. Combinado com telefone no título ("Responder +557190000002"): vira "Responder Olga" (ou "Responder cliente com final 5353").
4. Sem caixa no CRM: nem o número "faltam pagar", nem "falta pagar" na linha, nem o botão Receber.
5. Celular (390 px): sem rolagem horizontal da página; a tabela rola dentro do painel.

---

### Task 1: Regras do dia (puras)

**Arquivos:**
- Modificar: `src/lib/day-visit.ts`
- Teste: `src/lib/day-visit.test.ts`

**Interfaces (produz):**
- `DayVisitService` ganha `arrivedAt?: string | null` (Chegou ou Começou, o mais cedo) e `cancelledAt?: string | null`.
- `isClientePadrao(name: string): boolean`
- `dayTableVisits(visits: DayVisit[], day: string): DayVisit[]` — tira CLIENTE PADRÃO, serviços `espera*` ou às 00:00 de Salvador, cancelados que não foram cancelados em `day`; visita que fica vazia (sem serviço e sem cancelado de hoje) sai; `entry` é recalculada.
- `passedText(min: number): string` — `"passou 47 min"`, `"passou 2h47"`, `"passou 3h"`.
- `type DayFilter = "todas" | VisitColumn`
- `visitSituation(v: DayVisit, nowMs: number, opts: { caixaOn: boolean }): { label: string; detail: string | null; late: boolean; tone: ViewStatus | null }`
  - a chegar no horário: `label` "Confirmada" (todos confirmados) ou "Marcada"; atrasada: `label` "passou 2h47, sem Chegou", `late: true`, `tone: null`.
  - na Casa: `label` "Na Casa desde HH:MM" (`arrivedAt` mais cedo, senão `entry`); `detail` "N de M finalizados" só com M > 1.
  - finalizou: `label` "Finalizou"; `detail` "falta pagar" / "paga" só com caixa (paga = comanda `fechada`).
  - não veio: `label` "Não veio".
- `visitAction(v: DayVisit, opts: { caixaOn: boolean; canReceive: boolean }): "chegou" | "receber" | "abrir"`
- `dayNumbers(visits: DayVisit[], nowMs: number, opts: { caixaOn: boolean }): { total: number; inHouse: number; toCome: number; done: number; toPay: number | null; noShow: number; next: DayVisit[] }` — `next` = as 2 primeiras a chegar que ainda não passaram da hora; `toPay` null sem caixa.
- Sai: `boardCounts`, `COLUMN_LABEL`, `lateText` (o painel da visita passa a usar `passedText`).

- [ ] **Passo 1: testes que falham** — em `day-visit.test.ts`:
  - `dayTableVisits`: "CLIENTE PADRÃO", "Cliente Padrao" e "cliente padrão" saem; espera às 00:00 sai e a visita com 00:00 + 10:00 fica com entrada 10:00; cancelado com `cancelledAt` ontem some; com `cancelledAt` hoje fica e `visitColumn` dá "nao_veio".
  - `passedText(47)` = "passou 47 min"; `passedText(167)` = "passou 2h47"; `passedText(180)` = "passou 3h".
  - `visitSituation` dos quatro casos acima (com e sem caixa) e "passou 2h47, sem Chegou" às 12:47 para entrada 10:00.
  - `dayNumbers` com caixa (`toPay` 1) e sem caixa (`toPay` null); `next` com 2 itens, sem atrasadas.
  - `visitAction`: a chegar → "chegou"; finalizou sem pagar com caixa e permissão → "receber"; sem caixa → "abrir".
- [ ] **Passo 2:** `npx vitest run src/lib/day-visit.test.ts` → falha (funções não existem).
- [ ] **Passo 3:** implementar em `src/lib/day-visit.ts`; trocar `lateText` por `passedText` em `src/components/agenda/day-visit.tsx` (texto `${passedText(min)}, sem Chegou` em `text-gold-ink`, sem pílula vermelha).
- [ ] **Passo 4:** o mesmo comando → passa.
- [ ] **Passo 5:** commit `feat(hoje): regras puras da tabela do dia`.

### Task 2: Dados (visita, conversas minhas, catálogo da comanda, telefone escondido)

**Arquivos:**
- Modificar: `src/server/queries/day-visit.ts` (serviço por `displayName`; `arrivedAt` = `least(arrived_at, started_at)`; `cancelledAt`)
- Modificar: `src/server/queries/today.ts` (`TodayItem.ownerId: string | null`)
- Criar: `src/server/queries/comanda-catalog.ts` — `getComandaCatalog(user: SessionUser): Promise<ComandaCatalog | null>` (a mesma montagem da Agenda; null sem `caixa.operar` ou sem caixa no CRM)
- Criar: `src/lib/hide-phone.ts` — `hidePhone(text: string, name?: string | null, phone?: string | null): string`
- Testes: `src/server/queries/day-visit.test.ts`, `src/lib/hide-phone.test.ts`

- [ ] **Passo 1: testes que falham**
  - `hidePhone("Responder +557190000002", "Olga")` = "Responder Olga"; sem nome = "Responder cliente com final 5353"; `hidePhone("+55 71 9000-0002", null)` = "Cliente com final 5353"; texto sem telefone fica igual; "às 10:00" e "R$ 150,00" ficam iguais.
  - day-visit (banco): serviço "LUZES E MECHAS" volta "Luzes e Mechas"; `arrivedAt` do serviço com `arrived_at`; `cancelledAt` do cancelado.
- [ ] **Passo 2:** rodar os dois arquivos → falham.
- [ ] **Passo 3:** implementar. `hidePhone` troca sequências de 8+ dígitos (com `+`, espaço, parênteses e hífen) pelo nome real (que não seja ele mesmo telefone) ou por `clientLabel(null, telefone)`; inicial maiúscula no começo do texto.
- [ ] **Passo 4:** passam.
- [ ] **Passo 5:** commit `feat(hoje): dados da tabela do dia e telefone escondido`.

### Task 3: A tabela do dia

**Arquivos:**
- Criar: `src/components/today/day-table.tsx` — `DayTable({ visits, nowMs, caixaOn, canMark, agendaMode }: { visits: DayVisit[]; nowMs: number; caixaOn: boolean; canMark: boolean; agendaMode: AgendaMode })`
- Teste: `src/components/today/day-table.render.test.tsx`
- Apagar: `src/components/today/reception-board.tsx` e o teste dele

Abas (`Tabs`, `idPrefix="dia"`): Todas · A chegar · Na Casa · Finalizaram · Não vieram, com contagem. Tabela: Hora · Cliente · Serviços e profissionais · Situação · Ação. Serviço = etiqueta com bolinha `VIEW_STATUS[serviceView(status)].bar` + nome + profissional. Linha (`data-testid="dia-linha"`, `tabIndex=0`, Enter abre) abre `DayVisitSheet`; botão Chegou (`aria-label="Chegou: {nome}"`) marca a visita toda (`setAppointmentStatusAction(primeiro planejado, "chegou")`); Receber abre a comanda (`useComanda`); Abrir abre a visita. Finalizou e Não veio em texto apagado.

- [ ] **Passo 1: teste que falha** — contagens das abas (Todas 5, A chegar 2…); filtrar "Na Casa" deixa 1 linha; "passou 2h30, sem Chegou" sem pílula; "Na Casa desde 09:10 · 1 de 3 finalizados"; sem caixa não aparece "falta pagar" nem Receber; Chegou chama a ação com o primeiro planejado e não abre a visita.
- [ ] **Passo 2:** falha (componente não existe).
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** passa.
- [ ] **Passo 5:** commit `feat(hoje): tabela do dia com abas, situação e ação na linha`.

### Task 4: Blocos do resumo e a página

**Arquivos:**
- Criar: `src/components/today/resumo-bloco.tsx` — `ResumoBloco({ id, title, count, countLabel, more, wide, empty, panelTitle, panelPhrase, panelFooter, panel, children })`: região nomeada pelo título, botão esticado `aria-label="{more}: {title}"`, prévia sem nada clicável dentro, `Sheet` com `PAINEL_GRANDE`.
- Criar: `src/components/today/hoje-resumo.tsx` — `ParaVoceAgora`, `CombinadosBloco`, `AvisosBloco`, `AniversarioBloco`, `DiaNaCasaBloco`, `EsperandoBloco`, `RetomarBloco`, `EquipeBloco`.
- Modificar: `birthdays-today.tsx` (exporta `BirthdaysPanel`, sai `BirthdaysToday`), `team-now.tsx` (exporta `TeamRows`), `waiting-list.tsx` (exporta `WaitStatusText`), `src/app/(app)/page.tsx` (reescrita).
- Teste: `src/components/today/hoje-resumo.render.test.tsx` (e o de aniversários ajustado).

Caminho de quem sai (nada some):
- Comparecimentos para conferir → seção no painel de Meus combinados (lista com Compareceu/Faltou) e linha na prévia quando houver.
- Cobranças e recontatos → linha em Meus combinados (só com algo) + seção no painel.
- Mensagens programadas → linha em Meus combinados (só com algo) + `ProgramadasHoje` no painel.
- Parados agora → linha "Conversas paradas" em Para retomar + lista no painel.
- Tempo médio de resposta → linha no painel de Esperando resposta.
- Resumo da gestão (`DailySummary`) → fica acima da faixa, como hoje.

- [ ] **Passo 1: teste que falha** — Para você agora conta só conversas com `ownerId` = a pessoa, combinados e avisos não lidos para ela; "Atender próxima" leva à primeira dela (sem nenhuma dela, à primeira da equipe); prévias limitadas (3/3/3/2); "Ver o dia todo: O dia na Casa" abre o diálogo "O dia na Casa" com a tabela; combinado "Responder +557190000002" aparece "Responder Olga"; sem caixa não há "faltam pagar".
- [ ] **Passo 2:** falha.
- [ ] **Passo 3:** implementar os blocos e reescrever `page.tsx` (saudação, `DailySummary`, faixa, grade `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`, `ComandaProvider` quando `getComandaCatalog` devolve catálogo).
- [ ] **Passo 4:** `npx vitest run src/components/today` → passa.
- [ ] **Passo 5:** commit `feat(hoje): resumo em blocos (protótipo v3)`.

### Task 5: e2e, verificação e capturas

**Arquivos:** `e2e/hoje.spec.ts` (reescrito), `e2e/ficha-cliques.spec.ts`, `e2e/programadas.spec.ts`, e os outros que procuram o Hoje antigo.

- [ ] **Passo 1:** e2e novo: abrir "Ver o dia todo", aba "Na Casa" mostra só quem chegou, Chegou numa linha de "A chegar" leva a visita toda para `chegou` no banco e a linha para "Na Casa"; Meus combinados (painel: concluir); comparecimentos no painel; contador de atrasados.
- [ ] **Passo 2:** `npx vitest run` completo; `npx next typegen && npx tsc --noEmit`; `npx eslint` nos arquivos alterados; e2e afetados (desktop e celular) com `DATABASE_URL=…/crm_e2e_hoje3 E2E_PORT=3495 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test …`.
- [ ] **Passo 3:** capturas com banco próprio e dados de exemplo (servidor na 3496, navegador sem foco): `ops/capturas/hoje-v3-computador.png`, `hoje-v3-celular.png`, `hoje-v3-dia-na-casa.png`.
- [ ] **Passo 4:** commit `test(hoje): e2e do resumo e da tabela do dia`.
