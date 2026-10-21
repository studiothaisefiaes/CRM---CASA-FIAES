# Plano 5: limpeza das duplicidades (Juntar e tirar) e pendências do Plano 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada coisa passa a ter um lugar só: o Quadro abre o painel da conversa da Fila, o lembrete da véspera fica só em Configurações › Mensagens, o catálogo de pacotes fica só em Serviços e pacotes, e os nomes que sobraram do Plano 1 ("encerrar", "Retorno sugerido", "Ver Atendimento") saem da tela.

**Architecture:** O Quadro (`/funil?lead=ID`) monta o `ConversationPane` da Fila numa gaveta à direita (`BoardLeadPanel`), e os ganchos de navegação da Fila (`useOpenLead`, `useCloseLead`, `BackToQueue`) aprendem que em `/funil` abrir e fechar ficam no Quadro. O `LeadSheet` é apagado. As automações aposentadas viram uma lista (`RETIRED_AUTOMATION_KEYS`) que a tela, o índice de Configurações, o motor e a trava do lembrete ignoram. Nenhuma migration: produção tem as duas automações desligadas.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, motion/react, Drizzle + Postgres, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`, seções "Juntar e tirar" e "Um nome para cada coisa".

## Global Constraints
- O desenho das telas não muda. Só sai o que é duplicado e trocam os textos listados.
- Código, banco, rotas e chaves não mudam de nome: `deals.origin = "Retorno sugerido"`, `atendimento.ver`, `/funil`, `msg_encerramento` continuam.
- Textos em PT-BR. Nenhum texto de tela com "Encerrar", "ao encerrar", "Retorno sugerido" ou "Ver Atendimento" (a regra `NOMES_UNICOS` de `src/lib/ui-terms.test.ts` pega).
- Sem migration (se inevitável: 0057, `when` 1792330000000).
- Não mexer em `src/app/(app)/page.tsx`, `src/components/today`. `src/components/queue/conversation-pane.tsx` fica intocado (é do agente de performance). Em `src/components/shell/nav.ts` só o `NavSub.caixa` sai.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Fica para a virada da agenda (NÃO fazer agora)
- `ScheduleSheet` (grava só `deals.scheduledAt`) → `BookingSheet`, e "Fechar venda" na conversa → comanda. Os dois dependem da agenda do CRM sair do modo consulta (`agenda_modo` dupla): hoje o horário de verdade nasce no Avec e o caixa do CRM pode estar desligado; tirar agora deixaria a Casa sem como marcar ou registrar venda pelo CRM.
- `deals.attendance` como entrada ("Ela veio?") → derivado da comanda: mesma dependência.

## Review Focus
1. **Link antigo `/funil?lead=ID` de conversa que não está no Quadro** (resolvida, filtrada, de outra pessoa). O painel abre mesmo assim, com o nome "Conversa" até o cabeçalho chegar. Teste na Task 2.
2. **Esc com resposta digitada** no campo de mensagem não fecha o painel (perderia a resposta), e **Esc com um diálogo por cima** (Agendar, Editar dados) fecha só o diálogo. Teste na Task 2.
3. **Celular no Quadro:** o voltar do painel leva ao Quadro com os filtros, não à Fila; "Próximo da fila" continua no Quadro. Teste na Task 2.
4. **Lembrete da véspera ligado e uma automação personalizada de agendamento com mensagem:** continua travado nos dois sentidos (a cliente não recebe duas mensagens). Teste na Task 3.
5. **Origem "Retorno sugerido" no filtro de Clientes:** a opção mostra "Hora de voltar", mas filtrar continua achando as clientes (o valor enviado é o do banco). Teste na Task 5.

---

### Task 1: "Objeção" em Editar dados

O LeadSheet tinha campos que o painel da Fila não tem. Decisão de cada um (vai para o relatório final como ruling):

| Campo do LeadSheet | Destino |
|---|---|
| Nome, E-mail, Instagram, CPF, Aniversário, Anotações | já estão em Editar dados (`DadosDialog`) |
| Origem | "Como conheceu a Casa" em Editar dados |
| Responsável | "Com: X ▾ › Passar para…" no cabeçalho |
| Agendamento | Agendar / Remarcar horário |
| Motivo da perda | folha Perdido; aparece na Situação |
| Atendimentos anteriores e Histórico | ficha (Abrir ficha › linha do tempo e Conversas) |
| **Objeção** | **fica, em Editar dados**: alimenta o relatório R9 (perdas e objeções) e a lista de Configurações › Listas |
| Valor, Forma de pagamento | saem: venda é "Fechar venda" hoje e a comanda depois (spec) |
| Data de cobrança | sai: saldo em aberto é da comanda (pagamento parcial, spec). O que já está gravado segue no relatório "A cobrar" e na automação "Dia da cobrança" |
| Recontato em | sai: "Retomar…" (Combinado) substitui; o Perdido continua gravando o recontato sozinho |

**Files:**
- Modify: `src/components/queue/dados-dialog.tsx`
- Test: `src/components/queue/dados-dialog.render.test.tsx` (novo)

**Interfaces:**
- Consumes: `updateDealAction(dealId, { objectionId: string | null })` (já existe em `src/app/(app)/funil/actions.ts`), `d.objections: { id; label }[]` (já vem no `DealDetail`).

- [ ] **Step 1: Teste que falha** — `dados-dialog.render.test.tsx`, `it("Objeção: escolher grava na conversa e conta como mudança")`: renderiza `DadosDialog` com `d.objections = [{ id: "o1", label: "Preço" }]`, `d.deal.objectionId = null`; escolhe "Preço" no select de rótulo "Objeção" e clica "Salvar dados"; espera `updateDealAction` chamado com `("d1", { objectionId: "o1" })` e `onSaved(1)`. Segundo `it("sem mudar a objeção, não grava")`: salvar sem mexer não chama `updateDealAction` e `onSaved(0)`.
- [ ] **Step 2:** `npx vitest run src/components/queue/dados-dialog.render.test.tsx` → FAIL (não há campo Objeção).
- [ ] **Step 3:** Em `DadosDialog`, `Select` "Objeção" (opção vazia "Nenhuma") logo depois de "Como conheceu a Casa"; no salvar, se mudou, `updateDealAction(d.deal.id, { objectionId: valor || null })` e `changed++`.
- [ ] **Step 4:** O teste passa.
- [ ] **Step 5:** Commit `feat(dados): objeção da conversa em Editar dados`.

### Task 2: O Quadro abre o painel da Fila

**Files:**
- Create: `src/components/pipeline/board-lead-panel.tsx`, `src/components/pipeline/board-lead-panel.render.test.tsx`
- Modify: `src/components/pipeline/board.tsx` (renderiza o painel), `src/app/(app)/funil/page.tsx` (sai `getDealDetail`, `LeadSheetPresence`, `nextId`), `src/components/queue/open-lead.ts` (`/funil`), `src/components/queue/queue-route.tsx` (`BackToQueue` em `/funil`), `src/components/pipeline/deal-card.tsx` (`originLabel`, ver Task 5)
- Delete: `src/components/lead/lead-sheet.tsx` e o que só ele usava (conferir com `grep`: `fields.tsx`, `cpf-field.tsx`, `markConversationReadAction` se ficar sem uso); tirar o `vi.mock("@/components/lead/lead-sheet")` de `client-pane.render.test.tsx`.
- Test e2e: `e2e/quadro.spec.ts`, `e2e/fluxo.spec.ts`, `e2e/fila.spec.ts`, `e2e/acoes-fila.spec.ts`, `e2e/ficha-cliques.spec.ts`

**Interfaces:**
- Produces: `BoardLeadPanel({ dealId, name }: { dealId: string | null; name: string | null })`. Gaveta `role="dialog" aria-modal="true" aria-label={name ? \`Conversa com ${name}\` : "Conversa"}`, à direita, `w-full lg:w-[min(1180px,calc(100vw-260px))]`, com `ConversationPane key={dealId} dealId={dealId} initial={null} back="below-lg"` dentro de um grid `grid-cols-1 grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_300px]` (o mesmo de `/atendimento/[id]`). Fecha pelo fundo e pelo Esc (via `pushModal/isTop/popModal` de `ui/modal-stack`; não fecha com texto digitado em `input`/`textarea` em foco).
- `useCloseLead()` em `/funil`: `router.push("/funil" + filtros sem lead, { scroll: false })`.
- `useOpenLead()` em `/funil` (desktop e celular): `router.replace("/funil?…&lead=ID", { scroll: false })`.
- `BackToQueue` em `/funil`: link para `/funil` com os filtros sem `lead`, rótulo "Voltar para o quadro".

- [ ] **Step 1: Testes que falham** — `board-lead-panel.render.test.tsx` (mock de `ConversationPane` que mostra `dealId`; mock de `next/navigation` com `usePathname() = "/funil"` e `useSearchParams` = `dono=x&lead=d1`):
  - `it("abre o painel da Fila numa gaveta com o nome da cliente")`: `getByRole("dialog", { name: "Conversa com Aline Prado" })` contém o pane com `d1`.
  - `it("sem o nome (lead fora do Quadro), o nome é Conversa")`.
  - `it("Esc e o fundo fecham e voltam ao Quadro com os filtros")`: Esc → `push("/funil?dono=x", { scroll: false })`.
  - `it("Esc com resposta digitada não fecha")`: foco num `textarea` com texto, Esc → `push` não chamado.
  - `it("Esc com outro diálogo por cima não fecha a gaveta")`: `pushModal()` depois de abrir, Esc → `push` não chamado.
  - `open-lead.render.test.tsx` (novo, mesmo mock): `useCloseLead()()` em `/funil?dono=x&lead=d1` → `push("/funil?dono=x")`; `useOpenLead()("d2")` → `replace("/funil?dono=x&lead=d2")` com `matchMedia` de celular e de desktop; `BackToQueue` em `/funil` → link "Voltar para o quadro" com `href="/funil?dono=x"`.
- [ ] **Step 2:** `npx vitest run src/components/pipeline/board-lead-panel.render.test.tsx src/components/queue/open-lead.render.test.tsx` → FAIL.
- [ ] **Step 3:** Implementar `BoardLeadPanel`, os ramos `/funil` em `open-lead.ts` e `BackToQueue`; o `Board` lê `?lead=` (uuid) e passa o nome do card; a página do Quadro para de buscar o lead no servidor. Apagar `lead-sheet.tsx` e os órfãos.
- [ ] **Step 4:** Os testes passam; `npx vitest run src/components/pipeline src/components/queue` passa.
- [ ] **Step 5:** e2e: trocar nos specs o `combobox "Etapa"` do LeadSheet pelo menu de etapa do painel (`Trocar etapa: …`), apagar "valor do lead aceita 1158.50" (o campo saiu, ruling) e reescrever "campos do card salvam sozinhos" como "Editar dados do painel do Quadro salva o e-mail"; `acoes-fila.spec.ts:337` (Valor no Quadro) vira "Fechar venda/valor fica na Fila" ou sai, conforme o que o teste prova. Rodar `quadro`, `fluxo`, `fila`, `acoes-fila`, `ficha-cliques` (ver Verificação).
- [ ] **Step 6:** Commit `feat(quadro): o Quadro abre o mesmo painel da conversa da Fila; sai o LeadSheet`.

### Task 3: Lembrete da véspera, uma só fonte

**Files:**
- Create: `src/server/rules/retired.ts`
- Modify: `src/server/db/seed-data.ts` (saem `lembrete_agendamento` e `confirmacao_d1`), `src/server/rules/templates.ts` (saem os modelos `lembrete-d1` e `confirmacao-enquete-d1`, que recriavam as mesmas duas), `src/app/(app)/config/automacoes/page.tsx`, `src/server/queries/config-index.ts`, `src/server/rules/engine.ts`, `src/server/domain/client-link/reminder.ts`, `src/server/domain/config.ts` (sai a trava automação × automação: enquete × lembrete e "as duas numa só")
- Delete: `src/server/domain/automation-conflict.test.ts`
- Test: `src/server/db/seed.test.ts`, `src/server/rules/retired.test.ts` (novo), `src/server/rules/engine.test.ts`, `src/server/domain/outbox.test.ts` (usam automação inserida pelo próprio teste, não a do seed)

**Interfaces:**
- Produces: `RETIRED_AUTOMATION_KEYS = ["lembrete_agendamento", "confirmacao_d1"] as const`; `activeAutomationFilter(): SQL` = `key is null or key not in (...)`.
- Fica: a trava lembrete da véspera × automação de agendamento que envia (Lote 7B), nos dois sentidos — ela não é código morto (a gestão ainda pode criar uma automação "faltar X horas" com mensagem).

- [ ] **Step 1: Testes que falham**:
  - `seed.test.ts`: total de automações `10`; nenhuma automação do seed envia mensagem; `DEFAULT_AUTOMATIONS` não tem `lembrete_agendamento` nem `confirmacao_d1`.
  - `retired.test.ts`: `it("a tela, o índice e o motor ignoram as aposentadas")` — insere `lembrete_agendamento` ligada e uma personalizada sem chave; a query com `activeAutomationFilter()` devolve só a personalizada; `runRules`/a lista do motor não roda a aposentada; `saveLembreteD1({ enabled: true })` não é barrado por ela.
  - `it("a trava do lembrete da véspera continua com automação personalizada")`: personalizada `agendamento_em_horas` + `enviar_mensagem` ligada → `saveLembreteD1({ enabled: true })` rejeita "Desligue antes…"; com o lembrete ligado, `toggleAutomation(personalizada, true)` rejeita "Desligue o lembrete do horário…".
  - `templates`: nenhum modelo usa `agendamento_em_horas` com envio.
- [ ] **Step 2:** `npx vitest run src/server/db/seed.test.ts src/server/rules/retired.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; ajustar `engine.test.ts` e `outbox.test.ts` para inserir a própria automação de agendamento (o comportamento do gatilho e da enquete continua testado).
- [ ] **Step 4:** `npx vitest run src/server` passa.
- [ ] **Step 5:** Commit `refactor(automacoes): lembrete da véspera só em Configurações › Mensagens`.

### Task 4: Catálogo de pacotes num lugar só

Decisão pela spec ("pacotes editados em /caixa/pacotes → só em Serviços e pacotes"): `/caixa/pacotes` continua, só com "Pacotes das clientes" (Dar novo prazo e Valor por sessão), porque essas ações não têm outro lugar na spec. O editor `PackageDefEditor` sai. O "valor por sessão" de cada serviço do pacote (base da comissão), que só existia nele, entra no painel do pacote de Serviços.

**Files:**
- Modify: `src/app/(app)/caixa/pacotes/page.tsx` (título "Pacotes das clientes", link "O catálogo fica em Serviços e pacotes › Pacotes" → `/servicos?aba=pacotes`; permissão `caixa.gerir` ou `config.sistema` continua), `src/components/config/caixa-settings.tsx` (link "Pacotes à venda" → `/servicos?aba=pacotes`), `src/components/servicos/package-sheet.tsx` (campo "Valor por sessão (R$), opcional" por serviço)
- Delete: `src/components/caixa/package-def-editor.tsx` e o teste; `savePackageDefAction` em `src/app/(app)/caixa/actions.ts` se ficar sem uso
- Test: `src/components/config/caixa-settings.test.tsx`, `src/components/servicos/services-page.test.tsx`, `e2e/servicos.spec.ts` / `e2e/caixa.spec.ts` se tocarem `/caixa/pacotes`

- [ ] **Step 1: Testes que falham**: `caixa-settings.test.tsx` espera `href="/servicos?aba=pacotes"`; `services-page.test.tsx` `it("pacote: valor por sessão de cada serviço vai junto ao salvar")` — preenche "Valor por sessão de Corte" com `50,00` e espera `savePackageAction` com `items[0].unitCents === 5000`; abrir um pacote com `unitCents: 4000` mostra `40,00`.
- [ ] **Step 2:** Rodar os dois → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Passam.
- [ ] **Step 5:** Commit `refactor(pacotes): catálogo só em Serviços e pacotes; /caixa/pacotes fica com os pacotes das clientes`.

### Task 5: Nomes que sobraram (Plano 1)

**Files:**
- Modify: `src/lib/config-tabs.ts` ("Mensagem ao resolver"; descrição "toda vez que alguém resolve a conversa"), `src/server/domain/retomada.ts` ("Cancelada ao resolver a conversa (Resolvido ou Perdido)."), `src/server/domain/auto-message-settings.ts` ("A cliente escreveu depois de resolver."), `src/lib/alert-copy.ts` ("conversa encerrada" → "conversa resolvida"), `src/lib/permissions.ts` (rótulo "Ver Conversas", grupo "Conversas", ajuda do `pro.app` "Sem Conversas, …"), `src/components/pipeline/deal-card.tsx`, `src/components/pipeline/toolbar.tsx`, `src/components/queue/client-pane.tsx`, `src/components/queue/dados-dialog.tsx`, `src/components/contacts/ficha/header.tsx`, `src/app/(app)/contatos/page.tsx` (rótulo com `originLabel()`, valor igual), `src/lib/ui-terms.test.ts`
- Test: `src/lib/ui-terms.test.ts`, os testes que citam esses textos, `e2e/permissoes.spec.ts`

**Interfaces:**
- Consumes: `originLabel(origin)` de `src/lib/origin-label.ts`.
- `NOMES_UNICOS` ganha: `/\bao encerrar\b/` → "ao resolver"; `/\bdo encerramento\b/` → "depois de resolver"; `/\bencerra(?:r)? a conversa\b/` → "resolver a conversa"; `/\bconversas? encerradas?\b/` → "conversa resolvida"; `/\bVer Atendimento\b/` → "Ver Conversas". "Espera encerrada", horário "encerrado" e pacote "Encerrados" não entram (são outra coisa).

- [ ] **Step 1: Testes que falham**: rodar `npx vitest run src/lib/ui-terms.test.ts` com as regras novas → lista os textos de cima. Render: `deal-card` com `origin: "Retorno sugerido"` mostra "Hora de voltar"; `client-pane` "Como conheceu" mostra "Hora de voltar"; `contatos` filtro: `<option value="Retorno sugerido">Hora de voltar</option>` (teste de render da página não existe: o e2e `contatos.spec.ts` ou um teste da função de opções). `permissions` test: `PERM_LABEL["atendimento.ver"] === "Ver Conversas"` e `PERM_GROUP["atendimento.ver"] === "Conversas"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Trocar os textos e envolver as exibições em `originLabel()`; tirar o item do `PERMITIDOS` que falava de "Ver Atendimento".
- [ ] **Step 4:** Passam.
- [ ] **Step 5:** Commit `fix(textos): resolver no lugar de encerrar, Hora de voltar na origem e Conversas nas permissões`.

### Task 6: Menu, cabeçalhos e sobras

**Files:**
- Modify: `src/components/shell/sidebar.tsx` (item pai com subtópico aceso: `aria-current="true"`; o subtópico fica com `"page"`; item sem subtópico visível segue `"page"`), `src/components/shell/nav.ts` (sai `NavSub.caixa` e o filtro dele), `src/app/(app)/relatorios/page.tsx` (link "Jornada", `lg:hidden`, só com `jornada.ver`), `src/app/(app)/atendimento/[id]/page.tsx` (`countScheduled(user)` com a lista; `programadas` no `WorkspaceBar` e na `QueueColumn`), `src/components/servicos/services-page.tsx` (título "Clientes com pacote" na aba clientes) e `src/app/(app)/servicos/page.tsx` (`generateMetadata`: "Clientes com pacote" na aba clientes), `src/lib/config-tabs.ts` + `src/server/queries/config-index.ts` (sai `servicesNoDuration`)
- Test: `src/components/shell/sidebar.render.test.tsx`, `src/components/servicos/services-page.test.tsx`, `src/lib/config-tabs.test.ts`

- [ ] **Step 1: Testes que falham**: sidebar em `/funil` aberto: `Conversas` com `aria-current="true"`, `Quadro` com `"page"`; recolhido em `/funil`: `Conversas` com `"page"`; `/config`: `Configurações` com `"page"`. `services-page`: aba clientes tem `heading "Clientes com pacote"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar (o contador e o link da Jornada são de página do servidor: conferidos no e2e e no tsc).
- [ ] **Step 4:** Passam.
- [ ] **Step 5:** Commit `fix(menu): item pai com aria-current=true, Jornada no celular, contador de Programadas na conversa e título Clientes com pacote`.

### Verificação final
- `npx vitest run` (completo), `npx next typegen && npx tsc --noEmit`, `npm run lint`.
- e2e (banco `crm_e2e_limpeza5`, porta 3515): `DATABASE_URL=…/crm_e2e_limpeza5 E2E_PORT=3515 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test quadro fluxo fila acoes-fila ficha-cliques config-indice config-lote4 config-mensagens servicos caixa permissoes`.
- Revisão final do branch inteiro (superpowers:requesting-code-review) antes de parar.
