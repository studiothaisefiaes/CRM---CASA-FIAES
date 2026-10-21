# Plano 1: menu agrupado e um nome para cada coisa

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizar o menu lateral em 5 itens do dia a dia mais o grupo Gestão, com subtópicos dentro do item aberto, e trocar os nomes duplicados da tela pelo nome único de cada coisa.

**Architecture:** `src/components/shell/nav.ts` passa a ser um modelo puro (itens, grupos, subtópicos e regras de item ativo), testado sem tela. O `Sidebar` e a barra do celular só desenham o que o modelo devolve. Os nomes viram regra de teste em `src/lib/ui-terms.test.ts`, que lê os textos dos arquivos (o mesmo mecanismo que já existe para "lead/follow-up").

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, motion/react, vitest e Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`, seções "Menu" e "Um nome para cada coisa".

## Global Constraints
- O desenho das telas não muda. Só mudam o menu, os títulos e os textos listados aqui.
- Código, banco e rotas não mudam de nome. `/atendimento`, `/contatos` e `/funil` continuam.
- Textos em PT-BR, sem caixa alta em rótulo e sem termo interno.
- O item Caixa aparece só com `caixaOn`, como já acontece hoje.
- O item só aparece para quem tem a permissão dele, e o mesmo vale para cada subtópico.
- Celular: barra de baixo com Hoje, Conversas, Agenda, Caixa (se ligado) e Mais. O "Mais" tem Clientes, o grupo Gestão, a presença e Sair.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Duas rotas que acendem dois itens.** `/servicos?aba=clientes` deve acender Clientes › Com pacote, e não Serviços e pacotes. O teste fica na Task 1.
2. **Menu recolhido no computador.** Mostra só os ícones dos itens, sem subtópicos e sem título de grupo, mas com o separador do grupo Gestão. O teste fica na Task 2.
3. **Atendente sem permissão de Gestão.** Não vê o título "Gestão" quando o grupo fica vazio, e vê só "Serviços e pacotes" quando é o único item do grupo que ela pode abrir. O teste fica na Task 1.
4. **Conversa em tela cheia no celular** (`isConversationPath`). As barras continuam sumindo. O teste fica na Task 3.
5. **Link antigo para `/jornada`.** Continua abrindo a Jornada, agora debaixo de Relatórios e com o item Relatórios aceso. O teste fica na Task 4.

---

### Task 1: Modelo do menu (`nav.ts`)

**Files:**
- Modify: `src/components/shell/nav.ts`
- Test: `src/components/shell/nav.test.ts` (novo). Atualize `servicos-nav.test.ts` para o novo formato.

**Interfaces:**
- Produces:
  - `type NavSub = { href: string; label: string; perm?: Perm; caixa?: boolean }`
  - `type NavItem = { key: "hoje"|"conversas"|"agenda"|"caixa"|"clientes"|"relatorios"|"servicos"|"config"; href: string; label: string; icon: Icon; perm: Perm | null; group: "dia" | "gestao"; match?: string[]; subs?: NavSub[]; mobile: "bar" | "mais" }`
  - `NAV: NavItem[]`
  - `navFor(perms: readonly string[], opts: { caixaOn: boolean }): { dia: NavItem[]; gestao: NavItem[] }`. Já filtra itens e subtópicos por permissão e por `caixaOn`.
  - `activeNav(items: NavItem[], pathname: string, search: string): { item: string | null; sub: string | null }`. Devolve a `key` do item e o `href` do subtópico. Ganha o subtópico mais específico, em que rota com query bate antes de rota sem query.
- O item `config` usa `canConfigure(perms)` em vez de `perm`. Represente isso com `perm: null` mais o filtro dentro de `navFor`.

Valores fixados pela spec:

| Item | href | Grupo | Subtópicos (href · rótulo · permissão) |
|---|---|---|---|
| hoje | `/` | dia | `/` Recepção |
| conversas | `/atendimento` (match `/atendimento`, `/funil`) | dia | `/atendimento` Fila · `/funil` Quadro (`quadro.ver`) · `/atendimento/programadas` Programadas |
| agenda | `/agenda` | dia | `/agenda` Dia · `/agenda?v=semana` Semana · `/agenda?v=lista` Lista |
| caixa | `/caixa` (`caixa.operar`, só `caixaOn`) | dia | `/caixa` A receber · `/caixa/fechamentos` Fechamentos |
| clientes | `/contatos` (`contatos.ver`) | dia, celular no "mais" | `/contatos` Lista · `/servicos?aba=clientes` Com pacote |
| relatorios | `/relatorios` (`relatorios.ver`; match `/relatorios`, `/jornada`, `/caixa/comissao`) | gestao | `/relatorios` Visão geral · `/relatorios?aba=salao` Salão · `/relatorios?aba=analise` Análise · `/caixa/comissao` Comissão (`comissao.ver`) · `/jornada` Jornada (`jornada.ver`) · `/relatorios/avec` Relatórios do Avec |
| servicos | `/servicos` (`atendimento.ver`) | gestao | `/servicos` Serviços · `/servicos?aba=pacotes` Pacotes |
| config | `/config` | gestao | sem subtópicos |

Rótulos dos itens: Hoje, Conversas, Agenda, Caixa, Clientes, Relatórios, Serviços e pacotes, Configurações.

- [ ] **Step 1: Write the failing tests in `nav.test.ts`**
  - `navFor(perfil gestao, {caixaOn:true})` devolve `dia` = [hoje, conversas, agenda, caixa, clientes] e `gestao` = [relatorios, servicos, config].
  - Com `caixaOn:false`, não há caixa.
  - Perfil atendente: `gestao` = [servicos]; o subtópico Comissão não aparece em lugar nenhum.
  - Perfil profissional: `dia` = [hoje] e `gestao` = [].
  - `activeNav(..., "/funil", "")` → `{item:"conversas", sub:"/funil"}`.
  - `activeNav(..., "/servicos", "?aba=clientes")` → `{item:"clientes", sub:"/servicos?aba=clientes"}`.
  - `activeNav(..., "/servicos", "?aba=pacotes")` → `{item:"servicos", sub:"/servicos?aba=pacotes"}`.
  - `activeNav(..., "/jornada", "")` → `{item:"relatorios", sub:"/jornada"}`.
  - `activeNav(..., "/agenda", "?v=semana&d=2026-10-17")` → sub `/agenda?v=semana`.
  - `activeNav(..., "/caixa/comissao", "")` → item `relatorios`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run src/components/shell/nav.test.ts` deve dar FAIL, porque `navFor` não existe.
- [ ] **Step 3: Implement `NAV`, `navFor` and `activeNav` in `nav.ts`.** Uma query no subtópico bate quando todos os seus parâmetros estão presentes na `search` atual. Um subtópico sem query bate só quando a `search` não tem a chave que distingue um subtópico irmão (`aba`, `v`). Atualize `servicos-nav.test.ts`: agora "Serviços e pacotes" está no grupo gestão, com `mobile: "mais"`.
- [ ] **Step 4: Run the tests and confirm they pass.** `npx vitest run src/components/shell` deve dar PASS.
- [ ] **Step 5: Commit** com `feat(menu): modelo do menu com grupos e subtópicos`.

### Task 2: Menu lateral do computador

**Files:**
- Modify: `src/components/shell/sidebar.tsx`. Ele usa `navFor` e `activeNav`. Tire o `MATCH` local e o caso especial de `/config`.
- Modify: `src/components/shell/sidebar-state.ts`. A regra "nasce encolhido no Atendimento" continua para `/atendimento` e `/funil`, mas não para `/jornada`.
- Test: `src/components/shell/sidebar.render.test.tsx` (novo). Mocke `next/navigation` (`usePathname`, `useSearchParams`) e `useLiveAlerts`, como os testes de render vizinhos fazem.

**Interfaces:**
- Consumes: `navFor` e `activeNav` (Task 1).

- [ ] **Step 1: Write the failing tests**
  - **Aberto, em `/funil`:** os links Hoje, Conversas, Agenda e Clientes aparecem com `aria-current="page"` só em Conversas. Dentro de Conversas aparecem os subtópicos Fila, Quadro e Programadas, com `aria-current="page"` em Quadro.
  - O título de grupo "Gestão" aparece e, depois dele, Relatórios, Serviços e pacotes e Configurações.
  - **Recolhido:** nenhum subtópico, nenhum texto "Gestão" visível (só `sr-only`) e um separador (`role="separator"`) antes de Relatórios.
  - **Atendente:** sem "Relatórios" e sem "Configurações". "Gestão" aparece, com "Serviços e pacotes".
- [ ] **Step 2: Run the tests and confirm they fail.** `npx vitest run src/components/shell/sidebar.render.test.tsx` deve dar FAIL.
- [ ] **Step 3: Implement.**
  - Os subtópicos são uma lista recuada (`pl-9`, `text-sm`) logo abaixo do item ativo, visível só com o menu aberto.
  - O título do grupo é texto pequeno e `text-muted`, com espaçamento antes.
  - Mantenha a pílula animada (`layoutId="nav-pill"`) no item ativo e use um marcador simples no subtópico ativo.
- [ ] **Step 4: Run the tests and confirm they pass.** Os testes de render e os vizinhos de `src/components/shell` devem dar PASS.
- [ ] **Step 5: Commit** com `feat(menu): menu lateral com grupo Gestão e subtópicos`.

### Task 3: Celular (barra de baixo e "Mais")

**Files:**
- Modify: `src/components/shell/sidebar.tsx` (bloco do celular).
- Test: `src/components/shell/sidebar.render.test.tsx`.

- [ ] **Step 1: Write the failing tests**
  - Na largura do celular (o teste mira o `nav` com `lg:hidden`), a barra tem Hoje, Conversas, Agenda, Caixa (com `caixaOn`) e Mais.
  - O "Mais" aberto lista, nesta ordem: Clientes, o título "Gestão", Relatórios, Serviços e pacotes, Configurações e Sair.
  - "Mais" fica aceso em `/contatos`, `/relatorios` e `/servicos`.
  - Em `/atendimento/abc` (`isConversationPath`), nenhuma das duas barras aparece.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Os itens com `mobile: "bar"` vão para a barra, e o resto vai para o "Mais", com o grupo Gestão separado. Subtópicos não aparecem no celular.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** com `feat(menu): barra do celular e Mais com o grupo Gestão`.

### Task 4: Conversas (título e abas) e Jornada em Relatórios

**Files:**
- Modify: `src/components/queue/workspace-bar.tsx`
  - o título passa a "Conversas";
  - as abas passam a Fila · Quadro · Programadas;
  - Jornada sai das abas;
  - a prop `journey` sai e entra a prop `programadas?: number` (contador ao lado de Programadas).
- Modify: `src/app/(app)/jornada/page.tsx`. Use `PageHeader` com o título "Jornada" e um link "Relatórios" para voltar, no lugar de `WorkspaceBar`. A página continua só da Gestão.
- Modify: os pontos que hoje passam `journey` para `WorkspaceBar`. Procure com `grep -rn "WorkspaceBar" src`. O botão "Programadas N" que existia na Fila vira a aba.
- Modify: `src/lib/config-tabs.ts`. Tire o item "Serviços" de Configurações, porque o menu já tem Serviços e pacotes. Atualize `servicos-nav.test.ts`.
- Test: `src/components/queue/workspace-bar.test.tsx` (novo ou existente), `src/components/shell/servicos-nav.test.ts` e o e2e que conferir "Atendimento" ou "Jornada" (procure com `grep -rln "Atendimento\|Jornada" e2e`).

- [ ] **Step 1: Write the failing tests**
  - `WorkspaceBar` mostra o h1 "Conversas" e os links "Fila", "Quadro" e "Programadas". Com `programadas={3}`, a aba mostra "3". Não há link "Jornada".
  - `configTabs(["config.sistema"])` não tem item com `id === "servicos"`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** os arquivos listados acima.
- [ ] **Step 4: Run the tests and confirm they pass:** `npx vitest run src/components/queue src/components/shell src/lib/config-tabs*`. Depois rode os e2e alterados e confirme que passam.
- [ ] **Step 5: Commit** com `feat(menu): Conversas com Fila, Quadro e Programadas; Jornada em Relatórios`.

### Task 5: Um nome para cada coisa

**Files:**
- Modify: `src/lib/ui-terms.test.ts`. Acrescente uma segunda regra, `NOMES_UNICOS`, que usa a mesma função `texts()` sobre `src/components`, `src/app` e `src/lib` (sem testes).
- Modify: os arquivos que o teste apontar. Pela busca de hoje, os candidatos são:
  - `lib/alert-copy.ts`, `server/queries/queue.ts`, `lib/queue-filters.ts`, `lib/queue.ts`;
  - `components/queue/next-action*.tsx`, `components/today/next-actions.tsx`, `app/(app)/page.tsx`;
  - `lib/config-tabs.ts`, `components/config/*`, `lib/client-situation.ts`, `lib/contact-list-params.ts`;
  - `server/domain/suggested-return.ts`, `lib/conversation-status.ts`, `components/queue/status-menu.ts`, `components/reports/analysis.tsx`.

Tabela fixada pela spec (texto proibido → texto que fica):

| Proibido (regex, sobre o texto que vai para a tela) | Fica |
|---|---|
| `/\bBola com a cliente\b/` | Aguardando a cliente |
| `/\bPara reengajar\b/` | Hora de voltar |
| `/\bRetorno sugerido\b/` | Hora de voltar |
| `/\b[Nn]a hora de voltar\b/` | Hora de voltar |
| `/\bPróxima ação\b/`, `/\b[Pp]róximas ações\b/` | Combinado / Meus combinados |
| `/\bEncerrar\b/`, `/\bEncerradas?\b/` | Resolver / Resolvidas |

- **Exceção explícita**, numa lista `PERMITIDOS` com o motivo: o título de relatório do Avec que nomeia uma coluna vinda do próprio Avec, se existir.
- **Não entra na regra:** "Para retomar". Ele é a ação Retomar, que é outra coisa.

- [ ] **Step 1: Write the failing test.** `NOMES_UNICOS` lista cada ocorrência no formato `arquivo: "texto"`. Rode e confirme que FALHA, apontando os arquivos acima.
- [ ] **Step 2: Troque os textos** até o teste passar. Se um texto também é chave ou valor gravado no banco (por exemplo, um `label` de etapa salvo no seed), troque só o que vai para a tela e deixe a chave.
- [ ] **Step 3: Run the tests and confirm they pass:** `npx vitest run src/lib/ui-terms.test.ts`. Rode também os testes dos arquivos alterados e os e2e que conferem esses textos (procure com `grep -rln "Bola com a cliente\|Retorno sugerido\|Próxima ação\|Encerrar" e2e src`). Atualize os testes que esperavam o texto antigo.
- [ ] **Step 4: Commit** com `fix(textos): um nome para cada coisa (Hora de voltar, Combinado, Resolver, Aguardando a cliente)`.

### Task 6: Verificação final do plano

- [ ] Rode `npx vitest run` com a saída num arquivo e leia o final. Esperado: tudo verde.
- [ ] Rode `npx next typegen && npx tsc --noEmit`. Esperado: sem erros.
- [ ] Rode o lint nos arquivos alterados. Esperado: 0 erros.
- [ ] Rode o e2e de shell e menu e os specs que mudaram.
- [ ] Tire uma captura do menu aberto, do menu recolhido e do "Mais" do celular, para mostrar ao dono antes da publicação.
