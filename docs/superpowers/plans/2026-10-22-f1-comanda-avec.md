# F1 — Comanda e caixa no nível do Avec — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assistentes sem limite, nova comanda com cliente e profissional de verdade, busca de serviço que filtra, lista de comandas (histórico) e comandas na ficha da cliente.

**Architecture:** Mexe no domínio do caixa (`src/server/domain/caixa/`), nas consultas (`src/server/queries/`) e nos componentes de `src/components/caixa/`. Reaproveita o que já existe: `ClientPicker` + `resolveClientTx` da agenda, `ComandaProvider.openById`, `setComandaClient`, `professional_services`.

**Tech Stack:** Next.js App Router (server actions), Drizzle + Postgres, Vitest (+ Testing Library/jsdom nos componentes), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-22-caixa-atendimento-nota-design.md` (seção F1, itens 1–6; o item 7 "tela no jeito Avec" fica para um plano próprio, depois dos prints da Cati).

## Global Constraints

- Branch `cati-2010`; merge em `ia-sugestao`; deploy só 17h–9h (`ops/deploy-crm.sh N ~/Projects/casa-fiaes/wt/ia-sugestao [migrar]`), depois `ops/github-publicar.sh`.
- Testes: `U=$(grep ^DATABASE_URL .env | cut -d= -f2-); DATABASE_URL="${U%/*}/crm" npx vitest run <arquivo>`; nunca dois vitest ao mesmo tempo; `npx tsc --noEmit -p .` limpo.
- Migration nova: `drizzle/0092_*.sql` + entrada no `_journal.json` com `when` = 1792690000000 (> 1792670000000 da 0091).
- Texto de tela em PT-BR, no tom das telas atuais; sem redesign (mesmos componentes `Input`, `Select`, `Segmented`, `Button`, `SectionTabs`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Desempenho: nenhuma consulta nova sem `limit`; nada de comparar a base inteira em memória (lição de 22/10).

## Review Focus

- Comanda já fechada com 2 assistentes e comissão paga: a mudança da regra "metade" não pode recalcular comissão de comanda fechada (só itens abertos usam a regra nova) → teste em Task 1.
- Contagem cega: quem não é gestão não pode ver o total das comandas pagas **hoje** na lista de Comandas (somadas dariam o esperado do caixa) → teste em Task 4.
- Cliente nova na Nova comanda com telefone que já existe reaproveita a ficha (não duplica contato) → teste em Task 2.
- Busca de serviço sem acento/maiúscula ("escova" acha "Escova Modelada"; "mecha" acha "Mechas") → teste em Task 3.
- Lista de Comandas com período grande: no máximo 200 linhas e aviso "mostrando 200 de N" → teste em Task 4.

---

### Task 1: Assistentes sem limite (até 20, o mesmo teto da agenda)

**Files:**
- Create: `drizzle/0092_assistentes_sem_limite.sql` (+ `drizzle/meta/_journal.json`)
- Modify: `src/server/db/schema.ts:1241`, `src/server/domain/caixa/assistants.ts`, `src/lib/caixa-recursos.ts`, `src/app/(app)/caixa/actions.ts:219`, `src/components/config/caixa-recursos.tsx:24,39`, `src/lib/commission-math.ts:28-31`, `src/components/caixa/commission-how.tsx:54`, `src/components/caixa/assistants-field.tsx`, `src/components/caixa/comanda-panel.tsx:208`
- Test: `src/server/domain/caixa/assistants.test.ts`, `src/lib/commission-math.test.ts` (criar se não existir), `src/lib/caixa-recursos.test.ts`

**Interfaces:**
- Produces: `MAX_ASSISTANTS = 20`; `CaixaRecursos.assistentesMax: number` (1–20, padrão 20); `isAssistentesMax(v): v is number` (inteiro 1–20).

- [ ] **Step 1: Testes que falham**
  - `assistants.test.ts`: "aceita 5 assistentes num serviço, na ordem (posições 1..5)" — `setItemAssistants(item, { professionalIds: [a,b,c,d,e] })` e `assistantNamesTx` devolve os 5 na ordem; "horário com 6 auxiliares passa as 6 para a comanda, sem aviso" (`fillFromAppointmentTx` devolve `null`); "acima de assistentesMax (configurado 3) recusa com 'No máximo 3 assistentes por serviço.'".
  - `commission-math.test.ts`: `metade` com 3 assistentes e líquido 1000 → bases `[334, 333, 333]`; com 2 → `[500, 500]` (igual a hoje); com 1 → 1000; `total` com 3 → cada uma 1000.
  - `commission-snapshot.test.ts`: "comanda fechada com 2 assistentes e regra metade guarda as bases gravadas; ler de novo depois da mudança não recalcula" (os valores vêm de `comanda_item_assistants.base_cents/commission_cents`, não da conta nova).
  - `caixa-recursos.test.ts`: `readCaixaRecursos({ assistentesMax: 7 }).assistentesMax === 7`; `{ assistentesMax: 21 }` e `{ assistentesMax: 0 }` → 20 (padrão); `{}` → 20.
- [ ] **Step 2: Rodar e ver falhar** (`npx vitest run src/server/domain/caixa/assistants.test.ts src/lib/commission-math.test.ts src/lib/caixa-recursos.test.ts`).
- [ ] **Step 3: Migration 0092** — troca o check: `alter table comanda_item_assistants drop constraint comanda_item_assistants_position_ck, add constraint comanda_item_assistants_position_ck check (position between 1 and 20);` e `update settings set value = jsonb_set(value, '{assistentesMax}', '20') where key = 'caixa_recursos';` (o dono pediu "quantos eu quiser"). Schema: `sql\`${t.position} between 1 and 20\``.
- [ ] **Step 4: Código** — `MAX_ASSISTANTS = 20` (comentário: teto = agenda, `appointment_assistants`); `suggestedAssistantsTx`/`fillFromAppointmentTx` usam `Math.min(max, MAX_ASSISTANTS)` (já usam: só muda a constante); `isAssistentesMax` = `isIntBetween(v, 1, 20)`, padrão 20, tipo `number`; action: `z.number().int().min(1).max(20)`; tela de Configurações: dica "De 1 a 20." e sem o cast `as 1 | 2`; `commission-math`: `const split = i.assistants.length >= 2 && r.doisAssistentes === "metade"` e base de cada uma = divisão igual do líquido, resto de centavos para as primeiras (`Math.floor(net / n) + (idx < net % n ? 1 : 0)`); `commission-how.tsx`: rótulo "Duas ou mais assistentes", opção "Dividir igual" (valor continua `"metade"`, sem migrar dado).
- [ ] **Step 5: Tela** — `assistants-field.tsx`: lista das escolhidas (cada uma com "Tirar") + `Select` "+ Assistente" que some quando chega em `assistentesMax`; ordem = ordem de escolha. `comanda-panel.tsx:208`: nomes com `", "` e `" e "` antes da última (`Ana, Bia e Carla`). Teste de render no `assistants-field` (se houver arquivo de teste vizinho; senão, `comanda-panel` render test): 3 assistentes aparecem e o "+ Assistente" continua visível com max 20.
- [ ] **Step 6: Rodar** os três arquivos + `src/server/domain/caixa/commission*.test.ts` + `payouts.test.ts` → PASS; `tsc` limpo.
- [ ] **Step 7: Commit** `feat(caixa): assistentes sem limite por serviço (até 20) e "metade" vira divisão igual entre N`.

### Task 2: Nova comanda com cliente de verdade e profissional padrão; trocar cliente

**Files:**
- Modify: `src/server/domain/caixa/comandas.ts:143-165` (`openWalkInComanda`), `src/app/(app)/caixa/actions.ts:81-85,114-115`, `src/components/caixa/new-comanda.tsx`, `src/components/caixa/comanda-panel.tsx` (`AddItem` + cabeçalho da comanda), `src/server/queries/agenda-clients.ts` (CPF)
- Test: `src/server/domain/caixa/comandas.test.ts`, `src/server/queries/agenda-clients.test.ts` (ou o teste vizinho que já cobre `searchAgendaClients`), `src/components/caixa/new-comanda.test.tsx` (criar)

**Interfaces:**
- Consumes: `resolveClientTx(tx, ref: ClientRef)` de `src/server/domain/agenda/visits.ts:78`; `ClientPicker`/`PickedClient` de `src/components/agenda/client-picker.tsx`.
- Produces: `openWalkInComanda(input: { client?: ClientRef | null; clientName?: string | null; requestKey: string; item?: AddItemInput | null }, actor, now?)` (o antigo `contactId` vira `client: { contactId }`); `openWalkInAction` com `client` no lugar de `contactId`; `AddItem` aceita `defaultProfessionalId?: string | null`.

- [ ] **Step 1: Testes que falham**
  - `comandas.test.ts`: "nova comanda com cliente nova (nome + celular) cria a ficha e liga a comanda"; "cliente nova com celular que já existe reaproveita a ficha (1 contato só)"; "com `client: { contactId }` usa o nome da ficha" (o comportamento antigo).
  - `searchAgendaClients`: "acha pelo CPF (11 dígitos, com ou sem pontuação) e não devolve o CPF" — contato com `cpf = '12345678901'`, busca `'123.456.789-01'` → 1 hit, objeto sem campo `cpf`.
  - `new-comanda.test.tsx`: escolher cliente pelo picker (mock de `searchClientsAction`) e profissional "Ana" no topo → `openWalkInAction` recebe `client: { contactId }` e o item com `professionalId` da Ana sem ter escolhido de novo no item.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Domínio** — `openWalkInComanda`: `const who = input.client ? await resolveClientTx(tx, input.client) : null`; `contactId: who?.id ?? null`, `clientName: who?.name ?? input.clientName?.trim() || BALCAO`. Action: `client: z.union([z.object({ contactId: z.string().uuid() }), z.object({ name: z.string().min(1).max(120), phone: z.string().min(8).max(20) })]).nullish()`. `searchAgendaClients`: quando `digits.length === 11`, também `or c.cpf = ${digits}`.
- [ ] **Step 4: Tela** — `NewComanda`: troca o campo de nome livre por `ClientPicker` (com "Cliente de balcão" como estado vazio: sem cliente = balcão) e um `Select` "Profissional" no topo; passa `defaultProfessionalId` para `AddItem` (inicia o `pro` e reaplica quando muda no topo, se o item ainda não escolheu outra). `AddItem` com cliente escolhida já mostra Pacote/Sessão (usa `contactId` da cliente escolhida, não `null`). Cabeçalho da comanda aberta: botão "Trocar cliente" (só comanda aberta) abre o `ClientPicker` e chama `setClientAction(comandaId, { contactId })`; cliente nova no trocar → `setComandaClient` aceita `client: ClientRef` do mesmo jeito (mesma mudança de assinatura do Step 3).
- [ ] **Step 5: Rodar** os três testes + `src/server/domain/caixa/comandas*.test.ts` → PASS; `tsc`.
- [ ] **Step 6: Commit** `feat(caixa): nova comanda escolhe a cliente (busca, CPF, cliente nova) e a profissional; trocar cliente na comanda`.

### Task 3: Busca de serviço que digita e filtra

**Files:**
- Create: `src/components/caixa/service-picker.tsx`, `src/components/caixa/service-picker.test.tsx`, `src/lib/search-text.ts` (se não existir um normalizador de acento; procure antes `normalize("NFD")` em `src/lib/`)
- Modify: `src/server/queries/comanda-catalog.ts` (serviços com preço e "quem faz"), `src/components/caixa/comanda-sheet.tsx` (tipo `ComandaCatalog`), `src/components/caixa/comanda-panel.tsx:420` (troca o `<Select>` de serviço)

**Interfaces:**
- Produces: `ComandaCatalog.services: { id: string; label: string; priceCents: number | null }[]`; `ComandaCatalog.proServices: Record<string, string[]>` (profissional → ids de serviço, de `professional_services`); `rankServices(services, query: string, professionalId: string | null): Service[]` exportada de `service-picker.tsx`; `<ServicePicker services proServices professionalId value onPick />`.

- [ ] **Step 1: Testes que falham** (`service-picker.test.tsx`)
  - `rankServices`: "escova" acha "Escova Modelada"; "mecha" acha "Mechas"; "MANICURE" acha "Manicure"; com profissional que faz "Corte Feminino", "co" lista "Corte Feminino" antes de "Coloração"; query vazia + profissional → primeiro os dela, depois o resto, por nome.
  - Render: digitar "esc", ↓, Enter chama `onPick` com o id de "Escova Modelada"; cada linha mostra o preço (`R$ 120,00`) quando houver.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Código** — catálogo: `listServicePrices()` já existe em `src/server/queries/agenda.ts:173`; `proServices` = uma consulta `select professional_id, service_id from professional_services` agrupada em memória (tabela pequena). `ServicePicker`: `Input` com `role="combobox"`, lista `role="listbox"` até 8 itens, ↑↓ Enter Esc, toque escolhe; escolhido mostra o nome + "Trocar". Busca sem acento e sem caixa (`normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()`), casa por palavra que começa com o termo, depois por "contém".
- [ ] **Step 4: Trocar no `AddItem`** — o `Select` de serviço vira `ServicePicker` (a profissional escolhida reordena). Ajustar os testes de render existentes de `comanda-panel` que procuram `combobox "Serviço"` pelo `<select>`.
- [ ] **Step 5: Rodar** `service-picker.test.tsx` + testes de `src/components/caixa/` → PASS; `tsc`.
- [ ] **Step 6: Commit** `feat(caixa): busca de serviço na comanda (digita e filtra, sem acento, os da profissional primeiro, com preço)`.

### Task 4: Aba "Comandas" (histórico, como "Comandas finalizadas/pendentes" do Avec)

**Files:**
- Create: `src/server/queries/comandas-list.ts`, `src/server/queries/comandas-list.test.ts`, `src/app/(app)/caixa/comandas/page.tsx`, `src/components/caixa/comandas-list.tsx`
- Modify: `src/components/caixa/caixa-nav.tsx` (abas "Comandas" e "Fechamentos", esta para `/caixa/fechamentos`, que já existe)

**Interfaces:**
- Produces: `listComandas(f: { from: string; to: string; status?: "aberta" | "fechada" | "cancelada" | "divida"; q?: string; professionalId?: string; blind: boolean }, now?): Promise<{ rows: ComandaListRow[]; total: number }>`; `ComandaListRow = { id; number; day; clientName; status; totalCents: number | null; paidCents: number | null; debtCents: number; professionals: string[]; openedAt; closedAt: string | null; closedByName: string | null }`.

- [ ] **Step 1: Testes que falham** (`comandas-list.test.ts`)
  - filtra por período (`from`/`to` em dias da Bahia), por status (`divida` = fechada com dívida em aberto), por profissional (principal **ou** assistente), por `q` (nome da cliente, telefone com ≥4 dígitos, ou número exato da comanda);
  - ordena da mais nova para a mais antiga (dia desc, número desc);
  - devolve no máximo 200 linhas e `total` com a contagem real;
  - `blind: true` → `totalCents`/`paidCents` `null` só nas fechadas **hoje**; as de outros dias continuam com valor.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: `listComandas`** — uma consulta com `where` nos filtros + `limit 200` e um `count(*)` com os mesmos filtros; profissionais por `string_agg(distinct …)` de `comanda_items.professional_id` ∪ `comanda_item_assistants.professional_id` (itens não cancelados); dívida pela mesma regra que o "Devendo" já usa (reaproveite a função de `src/server/domain/caixa/debts.ts`, não reescreva). `blind` = mesma regra de `queueFor` (contagem cega e sem `caixa.gerir`).
- [ ] **Step 4: Página** `/caixa/comandas` — `requirePerm("caixa.operar")`; filtros por `searchParams` (`de`, `ate`, `status`, `q`, `pro`), padrão últimos 7 dias; `Segmented` de status (Todas, Abertas, Pagas, Com dívida, Canceladas), campo de busca, `Select` de profissional, datas; lista: nº · dia · cliente · profissionais · total · situação; tocar abre a comanda por `useComanda().openById` (envolver em `ComandaProvider` com `buildComandaCatalog`, como a página do Caixa). "Mostrando 200 de N — refine a busca" quando `total > 200`. `CaixaNav`: abas Caixa · Comandas · Fechamentos · Caixas da equipe (as duas novas só com o caixa no CRM).
- [ ] **Step 5: Rodar** `comandas-list.test.ts` + `src/app/(app)/caixa/**/*.test.ts` → PASS; `tsc`.
- [ ] **Step 6: Commit** `feat(caixa): aba Comandas com histórico por período, situação, cliente, profissional e número; aba Fechamentos`.

### Task 5: Comandas na ficha da cliente

**Files:**
- Modify: `src/server/queries/comandas-list.ts` (função da cliente), `src/app/(app)/contatos/[id]/page.tsx` (seção nova)
- Create: `src/components/contatos/client-comandas.tsx`
- Test: `src/server/queries/comandas-list.test.ts`

**Interfaces:**
- Consumes: `ComandaListRow` (Task 4).
- Produces: `clientComandas(contactId: string, limit = 30): Promise<ComandaListRow[]>` (CRM; inclui pessoas do mesmo número? **não**: só a própria ficha, como a agenda dela) .

- [ ] **Step 1: Teste que falha** — `clientComandas` devolve as comandas da cliente (abertas, pagas, canceladas), mais nova primeiro, sem as de outra cliente; respeita `limit`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Código** — reaproveita a consulta da Task 4 com filtro `contactId` (sem período). Seção "Comandas" na ficha, perto do histórico do Avec já mostrado (`server/queries/avec.ts:198`): nº, dia, itens resumidos, total, situação; tocar abre a comanda (com `caixa.operar`; sem, só lista). Valores só para quem tem `valores.ver` (mesma regra da ficha hoje).
- [ ] **Step 4: Rodar** → PASS; `tsc`.
- [ ] **Step 5: Commit** `feat(clientes): comandas do CRM na ficha da cliente`.

### Task 6: Fechar a fase (deploy)

- [ ] **Step 1:** Suites tocadas + `src/server/domain/caixa` inteira → PASS (falhas antigas conhecidas fora: `teams.test.ts`, 1 de `conversation-archive.test.ts`, `open-lead.render.test.tsx`).
- [ ] **Step 2:** Merge `cati-2010` → `ia-sugestao`; deploy com migração (`… 9N … migrar`) depois das 17h; `ops/github-publicar.sh`.
- [ ] **Step 3:** Conferir em produção: `select pg_get_constraintdef(oid) from pg_constraint where conname='comanda_item_assistants_position_ck'` (between 1 and 20); `settings.caixa_recursos->assistentesMax = 20`; abrir `/caixa/comandas` (200) e medir o tempo da página do Caixa antes/depois (não pode piorar).
- [ ] **Step 4:** Anotar em `ops/pendencias-minhas.md`; texto curto para a Cati do que mudou.
