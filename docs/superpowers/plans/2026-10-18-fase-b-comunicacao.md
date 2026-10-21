# Fase B: Comunicação, para sair do ChatGuru (itens 9 a 18)

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** A recepção da Casa Fiaes deixa de precisar do ChatGuru: o menu de boas-vindas encaminha e responde, as regras reagem a acontecimentos, as mensagens da Casa (confirmação da véspera, agradecimento com o Google e pesquisa) saem do CRM depois de uma virada com checklist, e a conversa ganha as ferramentas e os filtros que a equipe usa lá.

**Architecture:** Tudo que sai para a cliente continua passando pela fila de envio (`outbox` + `drainOutbox`), que ganha o tipo `media` e uma checagem central de "automáticas pausadas". Configurações sem tabela nova ficam em `settings` (menu v2, dias especiais, depois do atendimento, resumo no WhatsApp); o que é dado de cliente ou de equipe ganha migration (0070 a 0074). O motor de regras ganha um segundo caminho, por acontecimento (`src/server/rules/events.ts`), chamado depois do commit da mensagem, da etiqueta e da ligação, que reaproveita as ações de `engine.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Drizzle + Postgres 17, pg-boss (worker), Evolution API v2.3.7, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-o-que-falta-design.md`, seção "Fase B · Comunicação, para sair do ChatGuru". Base: `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`. Detalhes: `~/ClaudeGerado/casa-fiaes-gap-chatguru-2026-10-18.md` (seções 3 e 4), `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18.md` (Marketing, item 15) e `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18-parte2.md` (A4, Ficha › Permissões).

## Global Constraints

- **Nenhuma mensagem sai sem a equipe ver.** Só sai sozinho texto ou arquivo fixo que a gestão escreveu e viu na prévia, com a chave nascendo DESLIGADA e o "ligar" pedindo a confirmação de envio real (`components/config/send-confirm.tsx`). Tudo o que sai aparece na conversa (via `deliverAutomated`). A IA nunca envia: só sugere no campo.
- **O lembrete do CRM só liga na virada** (Task 10): com o lembrete do ChatGuru e a confirmação do Avec desligados, marcados no checklist. O mesmo vale para "Depois do atendimento" (o Avec manda agradecimento hoje).
- **Pausa e consentimento valem para tudo que é automático para a cliente:** regras, menu, boas-vindas, ausência, fora do horário, resolver, lembrete, depois do atendimento e massa. A mensagem programada à mão (`source = "agendada"`) não é automática e sai. Ações internas (etiqueta, nota, passar para, alerta) continuam mesmo com a pausa.
- **Uma pergunta por tela.** Cada configuração nova é uma tela ou um passo com uma pergunta no título ("Para onde vai cada opção?", "Em que dias a Casa abre diferente?").
- **Um nome para cada coisa.** Nomes fixos desta fase: **Setor** (Recepção, Método Fiaes®, Serviços gerais), **Biblioteca**, **Dias especiais**, **Depois do atendimento**, **Pesquisa de satisfação**, **Avaliação no Google**, **Automáticas pausadas**, **Acompanhar** / **Acompanhando**, **Marcar como não lida**, **Encaminhar**, **Virada**. Os sinônimos entram em `NOMES_UNICOS` (Task 0).
- **Estilo da Casa nos textos para a cliente:** "Método Fiaes®" sempre com ®; sem artigo antes de nome de pessoa ("com Gilvan", nunca "com o Gilvan"); a dona é "nossa Diretora Técnica, Thaise Fiaes". Coração 💛 como nos textos de hoje. Datas e horas em negrito do WhatsApp (`*...*`).
- **Migrations:** só na faixa **0070 a 0079**, escritas à mão no padrão de `drizzle/0054_tipo_contato.sql` (só acrescenta, `IF NOT EXISTS`), com a entrada no `drizzle/meta/_journal.json` (`idx` = o próximo do journal na hora do merge; `when` a partir de **1792380000000**, de 10.000.000 em 10.000.000: 0070 = 1792380000000, 0071 = 1792390000000, 0072 = 1792400000000, 0073 = 1792410000000, 0074 = 1792420000000). Toda tabela nova entra no `truncate` de `test/db.ts`.
- Horários sempre no relógio de Salvador (`America/Bahia`, UTC-3).
- Código, chaves e rotas existentes não mudam de nome (`menu_boas_vindas`, `lembrete_d1`, `automacao:<id>`, `/config/menu`).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Mensagem em dobro na virada.** Ligar o lembrete (ou "Depois do atendimento") com o ChatGuru ou o Avec ainda mandando faz a cliente receber 2 ou 3 mensagens. Sem os três itens do checklist marcados, o servidor recusa ligar, e desligar cancela o que está na fila. Teste na Task 10.
2. **Encaminhar a foto de uma cliente para outra cliente.** O cabeçalho "Encaminhada da conversa com {nome}" só vai para conversa de Equipe; para cliente vai só o conteúdo, sem nome nem telefone de origem. Teste na Task 13.
3. **Regra por acontecimento em laço ou agindo no passado.** Regra A põe a etiqueta X e a regra B, ao ver X, põe Y que dispara A: a etiqueta posta por regra não dispara regra. Ligar uma regra de palavra não age nas mensagens que já chegaram, nem na mensagem reprocessada do webhook (mais de 6 h). Teste na Task 6.
4. **Pausa depois de enfileirar.** O lembrete, o menu ou a massa que entraram na fila antes da pausa não saem depois dela. Teste na Task 2.
5. **Resposta solta ao menu.** "2️⃣", " 2 ", "2." e "opção 2" valem como 2; "tenho 2 filhas" e "dois horários" não valem (a equipe atende). Teste na Task 5.

## Decisões do dono (o plano segue o padrão; trocar antes da task indicada)

1. **"Setor" em vez de "Equipe"** para Recepção, Método Fiaes® e Serviços gerais, porque "Equipe" já é a aba dos números de funcionária e o "Equipe agora" do Hoje (Task 0 e 1).
2. **Uma mensagem só depois do atendimento:** ou o agradecimento com o Google, ou a pesquisa (nota alta recebe o Google). Nunca os dois (Task 8 e 9).
3. **Quando sai:** 2 h depois do último serviço Finalizado, dentro de 8h–20h; nota baixa = 1 a 3 de 5 (Task 8 e 9).
4. **Nota baixa não manda nada para a cliente:** só avisa a gestão e põe a etiqueta "Nota baixa" (Task 9).
5. **Campanha e "não perguntado":** só quem disse Não fica de fora; quem nunca foi perguntada recebe (Task 2).
6. **Textos definitivos da Casa:** a captura do Avec não trouxe o texto inteiro da confirmação e do agradecimento. O plano usa o rascunho de `casa-texts.ts`; a Casa manda os textos, o endereço, o link do mapa, o link de avaliação do Google e o pino (latitude e longitude) (Task 8 e 12).
7. **Texto fixo aprovado pela gestão pode sair sozinho** (como a resposta fora do horário de hoje); a IA nunca envia. Se o dono quiser tudo como rascunho para tocar Enviar, as Tasks 5, 7 e 8 mudam.
8. **Resumo das 19h:** quem recebe (Thaise, Cati ou as duas; até 3 números) e só nos dias em que a Casa abriu (Task 11).
9. **Encaminhar para outra cliente vai sem o nome da cliente de origem** (Task 13).

---

## Ordem e paralelismo

| Task | Item | Depende de | Pode rodar junto com |
|---|---|---|---|
| 0. Nomes da Fase B | — | — | — |
| 1. Setores | 15 | 0 | 2, 3, 4, 11, 12, 14, 15 |
| 2. Consentimento e Automáticas pausadas | 13, 14 | 0 | 1, 3, 4, 11, 12, 14, 15 |
| 3. Dias especiais | 14 | 0 | 1, 2, 4, 11, 12, 14, 15 |
| 4. Biblioteca e envio de arquivo pela fila | 18 | 0 | 1, 2, 3, 11, 12, 14, 15 |
| 5. Menu que encaminha e responde | 9 | 1, 4 | 6, 8 |
| 6. Regras: gatilhos por acontecimento | 10 | 0 | 1 a 5, 8 |
| 7. Regras: ações novas | 10 | 1, 4, 6 | 8 |
| 8. Mensagens da Casa e Depois do atendimento | 11 | 0 | 1 a 7 |
| 9. Pesquisa de satisfação | 12 | 7, 8 | 13 |
| 10. Virada | 11 | 8, 9, 11 | 13 |
| 11. Resumo do dia no WhatsApp | 16 | 0 | 1 a 4, 12, 14, 15 |
| 12. Reação, editar, localização, contato e vídeo | 17 | 0 | 1 a 4, 11, 14, 15 |
| 13. Encaminhar | 17 | 4, 12 | 9, 10 |
| 14. Marcar como não lida e Acompanhar | 17 | 0 | 1 a 4, 11, 12, 15 |
| 15. Filtros finos na Fila | 18 | 1 | 2 a 4, 11, 12, 14 |

Em paralelo, cada task roda na sua worktree; as migrations entram no journal na ordem 0070 → 0074 na hora do merge, e `src/server/db/schema.ts` e `test/db.ts` só ganham linhas (conflito de merge resolve somando).

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/lib/ui-terms.test.ts` | Sinônimos proibidos desta fase | 0 |
| `drizzle/0070_setores.sql` | `teams`, `team_members`, `deals.team_id` | 1 |
| `src/server/domain/teams.ts` | Setores: cadastro, membros, `pickTeamMember`, `passToTeam` | 1 |
| `src/components/config/teams.tsx` | Configurações › Pessoas › Setores | 1 |
| `drizzle/0071_consentimento_pausa.sql` | `contacts.consent_*`, `contacts.automations_paused_until` | 2 |
| `src/server/domain/consent.ts` | Consentimento e pausa: gravar, ler, `automationBlockReason` | 2 |
| `src/components/contacts/ficha/consent-block.tsx` | As três caixas na ficha | 2 |
| `src/components/queue/pause-switch.tsx` | Interruptor "Automáticas pausadas" no painel da cliente | 2 |
| `src/lib/business-hours.ts` | `especiais` dentro do `BusinessHours` (puro) | 3 |
| `src/server/domain/special-days.ts` | Dias especiais: salvar, ler, bloqueio da Casa na Agenda | 3 |
| `src/components/config/special-days.tsx` | Horário de funcionamento › Dias especiais | 3 |
| `drizzle/0072_biblioteca.sql` | `library_files` | 4 |
| `src/server/domain/library.ts` | Biblioteca: subir, listar, ler, apagar, enviar | 4 |
| `src/components/config/library.tsx`, `src/components/lead/library-picker.tsx` | Gestão da Biblioteca e clipe › "Da biblioteca" | 4 |
| `src/lib/welcome-menu-flow.ts` | Menu v2 puro: `parseMenuChoice`, `menuStep`, `migrateMenu` | 5 |
| `src/server/domain/welcome-menu.ts` | Menu v2 no servidor (submenu, responder, passar para) | 5 |
| `src/server/rules/types.ts` | Gatilhos, condições e ações novas | 6, 7, 9 |
| `src/server/rules/events.ts` | `runEventRules(event)` | 6 |
| `src/server/rules/engine.ts` | `execute` exportado, ações novas | 7 |
| `src/lib/casa-texts.ts` | Textos padrão no estilo da Casa | 8 |
| `src/server/domain/after-visit.ts` | Depois do atendimento: configuração, gatilho por visita, job | 8, 9 |
| `drizzle/0073_pesquisa_satisfacao.sql` | `satisfaction_answers` | 9 |
| `src/server/domain/satisfaction.ts` | Voto da pesquisa, alerta de nota baixa, números | 9 |
| `src/lib/virada.ts`, `src/components/config/virada.tsx` | Checklist da virada | 10 |
| `src/server/domain/summary-whatsapp.ts` | Resumo do dia às 19h no WhatsApp | 11 |
| `src/server/whatsapp/provider.ts`, `evolution.ts` | `sendReaction`, `editText`, `sendLocation`, `sendContact` | 12 |
| `src/server/domain/message-tools.ts` | Reagir, editar, Como chegar, mandar contato | 12 |
| `src/server/domain/forward.ts`, `src/components/lead/forward-dialog.tsx` | Encaminhar | 13 |
| `drizzle/0074_nao_lida_acompanhar.sql` | `deals.marked_unread_at/by`, `deal_follows` | 14 |
| `src/server/domain/follow.ts`, `src/components/today/following.tsx` | Não lida e Acompanhando | 14 |
| `src/server/queries/queue.ts`, `src/lib/queue-filters.ts`, `src/lib/queue.ts` | Filtros finos | 15 |
| `worker/index.ts` | Jobs `depois-atendimento` e `resumo-whatsapp` | 8, 11 |
| `src/lib/config-tabs.ts` | Itens novos de Configurações | 1, 3, 4, 8, 11 |

---

### Task 0: Nomes da Fase B

**Files:**
- Modify: `src/lib/ui-terms.test.ts:62-88` (`NOMES_UNICOS`)

**Interfaces:**
- Produces: as regras que todas as telas desta fase seguem.

- [ ] **Step 1: Write the failing test.** Acrescente a `NOMES_UNICOS`:

```ts
// Fase B (18/10): um nome para cada coisa nova.
{ re: /\bDepartamentos?\b/, fica: "Setor" },
{ re: /\bEquipes\b/, fica: "Setores (a aba Equipe é dos números de funcionária)" },
{ re: /\bNPS\b/, fica: "Pesquisa de satisfação" },
{ re: /\bFavorit(?:o|a|os|as|ar)\b/i, fica: "Acompanhar" },
{ re: /\bChatbot\b|\bRobô\b/i, fica: "Automáticas" },
{ re: /\bFeriados e exceções\b|\bExceções de horário\b/, fica: "Dias especiais" },
{ re: /\bArquivos da equipe\b|\bGaleria da equipe\b/, fica: "Biblioteca" },
{ re: /\bMétodo Fiaes(?!®)/, fica: "Método Fiaes®" },
```

E um teste novo no mesmo arquivo: `it("texto para a cliente não põe artigo antes de Thaise", ...)` que varre `src/lib/casa-texts.ts` e `src/lib/reminder-d1.ts` e espera zero casos de `/\b(?:a|à|da|na|pela) Thaise\b/`.

- [ ] **Step 2: Run** `npx vitest run src/lib/ui-terms.test.ts`. Expected: FAIL se já houver "Método Fiaes" sem ® em texto de tela (anote os achados) ou "Equipes".
- [ ] **Step 3: Implement.** Corrija só os achados de texto de tela (pôr o ®; "Equipes" vira o termo certo). Chave, rota e dado do banco entram em `PERMITIDOS` com o motivo.
- [ ] **Step 4: Run** `npx vitest run src/lib/ui-terms.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `test(nomes): nomes únicos da Fase B (Setor, Biblioteca, Dias especiais, Acompanhar)`.

---

### Task 1: Setores (item 15)

**Files:**
- Create: `drizzle/0070_setores.sql`, `src/server/domain/teams.ts`, `src/server/domain/teams.test.ts`, `src/components/config/teams.tsx`, `src/components/config/teams.test.tsx`
- Modify: `src/server/db/schema.ts` (tabelas `teams`, `teamMembers`; `deals.teamId`), `drizzle/meta/_journal.json`, `test/db.ts`, `src/components/config/team-tabs.tsx` (aba "Setores"), `src/lib/config-tabs.ts` (palavras-chave "setor", "departamento" no item `pessoas`), o "Passar para…" da conversa (`src/components/queue/*` que hoje chama `transferDeal`), `src/server/queries/queue.ts` (filtro `setor`)

**Interfaces:**
- Produces:
  - `teams(id uuid, name text unique lower, position int, active bool, created_at)`, `team_members(team_id, user_id, primary key (team_id, user_id))`, `deals.team_id uuid null references teams`.
  - `listTeams(): Promise<{ id: string; name: string; active: boolean; members: { id: string; name: string }[] }[]>`
  - `saveTeam(input: { id?: string; name: string; active?: boolean; memberIds: string[] }, actorId: string): Promise<{ id: string }>`
  - `pickTeamMember(tx: Tx, teamId: string, now: Date): Promise<string | null>`
  - `passToTeam(dealId: string, teamId: string, actorId: string | null, now?: Date): Promise<{ ownerId: string | null }>`
  - `QueueOptions.setor?: string | null` (id do setor).

- [ ] **Step 1: Write the failing test** `src/server/domain/teams.test.ts`:

```ts
it("0070 cria os três setores da Casa vazios", async () => {
  expect((await listTeams()).map((t) => t.name)).toEqual(["Recepção", "Método Fiaes®", "Serviços gerais"]);
});
it("passa para a pessoa do setor que está Disponível, com sinal, e com menos conversas esperando", async () => {
  // Sara e Cati no setor Recepção; Sara com 2 esperando, Cati com 0; as duas disponíveis e vistas há 1 min
  const r = await passToTeam(dealId, recepcaoId, null, NOW);
  expect(r.ownerId).toBe(cati);
  expect((await dealRow(dealId)).teamId).toBe(recepcaoId);
});
it("ninguém livre no setor: a conversa fica sem dona, marcada no setor, e avisa o setor no sino", async () => {
  const r = await passToTeam(dealId, metodoId, null, NOW);
  expect(r.ownerId).toBeNull();
  expect((await dealRow(dealId)).teamId).toBe(metodoId);
  expect(await alertsOf(dealId)).toContainEqual(expect.objectContaining({ type: "setor_sem_ninguem", audience: "gestao" }));
});
it("quem está em Pausa ou sem sinal há mais de 5 min não recebe", async () => { /* ... */ });
it("nome repetido (sem acento e maiúsculas) é recusado", async () => {
  await expect(saveTeam({ name: "recepcao", memberIds: [] }, uid)).rejects.toThrow("Já existe o setor Recepção.");
});
```

E em `src/server/queries/queue.test.ts`: `it("filtro setor mostra só as conversas do setor")`.

- [ ] **Step 2: Run** `npx vitest run src/server/domain/teams.test.ts`. Expected: FAIL (tabela e módulo não existem).
- [ ] **Step 3: Implement** a migration 0070 (`when` 1792380000000; semeia os três setores com `position` 1, 2, 3) e `teams.ts`. `pickTeamMember` usa a mesma regra de presença de `freeCandidates` (`availability = 'disponivel'`, `last_seen_at` nos últimos `PRESENCE_TIMEOUT_MIN`, `canReceiveConversation()`), mas filtra por `team_members` e NÃO exige `distribuicao.receber` (Thaise está no Método Fiaes® sem receber distribuição). Empate: menor carga, depois `last_assigned_at` mais antigo. `passToTeam` grava `teamId`, chama `transferDeal` quando acha alguém (ator `null` = "Sistema" no aviso) e registra `logEvent(..., "passado_para_setor", { setor, para })`. O "Passar para…" da conversa ganha a seção "Setores" acima das pessoas.
- [ ] **Step 4: Run** `npx vitest run src/server/domain/teams.test.ts src/server/queries/queue.test.ts src/components/config/teams.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(setores): Recepção, Método Fiaes® e Serviços gerais; Passar para setor`.

---

### Task 2: Consentimento e Automáticas pausadas (itens 13 e 14)

**Files:**
- Create: `drizzle/0071_consentimento_pausa.sql`, `src/server/domain/consent.ts`, `src/server/domain/consent.test.ts`, `src/components/contacts/ficha/consent-block.tsx`, `src/components/queue/pause-switch.tsx` (+ testes `.render.test.tsx`)
- Modify: `src/server/db/schema.ts` (`contacts`), `src/server/domain/outbox.ts` (`processItem`), `src/server/domain/campaigns.ts` (`classify`, `ExclusionReason`), `src/server/ai/suggest.ts` (`SkipReason`, `claimSuggestion`), `src/server/queries/queue.ts` (selo), ficha (`src/app/(app)/contatos/[id]/page.tsx`), painel da cliente (`src/components/queue/client-pane.tsx`)

**Interfaces:**
- Produces:
  - colunas `contacts.consent_whatsapp boolean null`, `contacts.consent_ai boolean null`, `contacts.consent_cpf_nota boolean null`, `contacts.consent_at timestamptz null`, `contacts.consent_by uuid null`, `contacts.automations_paused_until timestamptz null` (`'infinity'` = até alguém religar).
  - `type Consent = { whatsapp: boolean | null; ai: boolean | null; cpfNota: boolean | null }` (null = não perguntado)
  - `saveConsent(contactId: string, patch: Partial<Consent>, userId: string): Promise<void>` (auditado com de/para)
  - `setAutomationsPaused(contactId: string, until: Date | "sempre" | null, userId: string): Promise<void>`
  - `automationBlockReason(contact: Pick<Contact, "automationsPausedUntil">, now: Date): string | null` → `"As automáticas desta cliente estão pausadas."`
  - `ExclusionReason` ganha `"sem_consentimento"` e `"pausada"`; `SkipReason` ganha `"sem_consentimento_ia"`.
  - `QueueItem.badges` ganha `"pausada"` (selo "Automáticas pausadas").

- [ ] **Step 1: Write the failing tests** em `consent.test.ts`:

```ts
it("item enfileirado ANTES da pausa não sai depois dela (lembrete, menu, regra)", async () => {
  await enqueueAutomated({ dealId, kind: "text", text: "Lembrete", source: "lembrete_d1:v1:2026-10-21T13:00:00.000Z" });
  await setAutomationsPaused(contactId, "sempre", uid);
  const r = await drainOutbox(OPEN_TIME);
  expect(r.cancelled).toBe(1);
  expect((await outboxRows())[0].error).toBe("As automáticas desta cliente estão pausadas.");
});
it("a mensagem programada à mão (agendada) sai mesmo com a pausa", async () => { /* source "agendada" → sent */ });
it("pausa até uma data: no dia seguinte volta a valer sozinha", async () => { /* until = amanhã 00:00 Salvador */ });
it("massa: 'Não' em campanhas por WhatsApp fica de fora com o motivo próprio; não perguntado entra", async () => {
  const p = await previewAudience({ contactIds: [naoQuer, naoPerguntado] });
  expect(p.eligible).toBe(1);
  expect(p.excluded).toContainEqual(expect.objectContaining({ reason: "sem_consentimento", n: 1 }));
});
it("massa: cliente pausada fica de fora", async () => { /* reason "pausada" */ });
it("IA: cliente que disse Não ao atendimento por IA não gera sugestão nem manda dado para a IA", async () => {
  await saveConsent(contactId, { ai: false }, uid);
  expect(await claimSuggestion(dealId, { now: NOW })).toEqual({ status: "pulada", motivo: "sem_consentimento_ia" });
});
it("gravar o consentimento audita quem mudou, de e para", async () => { /* audit_log action "consentimento" */ });
```

E `pause-switch.render.test.tsx`: o interruptor tem `role="switch"` e nome "Pausar automáticas desta cliente"; ligado pergunta "Até quando?" com "Até eu religar" e "Até amanhã".

- [ ] **Step 2: Run** `npx vitest run src/server/domain/consent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Migration 0071 (`when` 1792390000000), sem preencher nada (todo mundo começa "não perguntado"). Em `processItem`, logo depois do teste de Fornecedor/Spam e antes de qualquer `source`, para todo item cujo `source !== SCHEDULED_SOURCE`: `const why = automationBlockReason(row.contact, now); if (why) return cancel(why);`. Em `classify` (massa): `consent_whatsapp = false` → `sem_consentimento`; pausa vigente → `pausada`; textos em `EXCLUSION_LABEL`: "disseram Não a campanhas por WhatsApp" e "com as automáticas pausadas". Na ficha, o bloco "O que ela aceita" com três perguntas sim/não/não perguntado: "Recebe campanhas por WhatsApp?", "Pode ser atendida com ajuda da IA?", "Quer CPF na nota?". O CPF na nota só é guardado (a NFS-e é da Fase D).
- [ ] **Step 4: Run** `npx vitest run src/server/domain/consent.test.ts src/server/domain/campaigns.test.ts src/server/ai/suggest.test.ts src/server/domain/outbox.test.ts src/components/queue/pause-switch.render.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cliente): consentimento na ficha e Automáticas pausadas na conversa`.

---

### Task 3: Dias especiais (item 14)

**Files:**
- Create: `src/server/domain/special-days.ts`, `src/server/domain/special-days.test.ts`, `src/components/config/special-days.tsx`, `src/components/config/special-days.test.tsx`
- Modify: `src/lib/business-hours.ts`, `src/lib/business-hours.test.ts`, `src/server/domain/hours.ts`, `src/server/domain/auto-reply.ts` (texto do dia), `src/app/(app)/config/etapas/page.tsx` (`?parte=horario` ganha "Dias especiais"), `src/lib/config-tabs.ts` (palavras "feriado", "dia especial" no item `horario`)

**Interfaces:**
- Produces:
  - `type SpecialDay = { day: string /* AAAA-MM-DD */; window: [string, string] | null; text: string | null }`
  - `type BusinessHours = Record<"0"|…|"6", [string, string] | null> & { especiais?: Record<string, [string, string] | null> }`
  - `windowOf(dayStartLocalMs: number, hours: BusinessHours): [string, string] | null` (exportada; o dia especial vence o dia da semana)
  - `getSpecialDays(): Promise<SpecialDay[]>`, `saveSpecialDays(days: SpecialDay[], userId: string): Promise<void>` (chave `settings.dias_especiais`)
  - `getBusinessHours()` passa a devolver `{ ...semana, especiais }` (todas as 49 chamadas ganham os dias especiais sem mudar).
  - `specialDayText(atMs: number): Promise<string | null>` (o texto próprio do dia, para a Resposta fora do horário)

- [ ] **Step 1: Write the failing tests** em `src/lib/business-hours.test.ts`:

```ts
const XMAS = { ...DEFAULT_HOURS, especiais: { "2026-12-24": ["08:00", "13:00"] as [string, string], "2026-12-25": null } };
it("dia especial com horário reduzido fecha mais cedo", () => {
  expect(isOpen(Date.parse("2026-12-24T15:59:00Z"), XMAS)).toBe(true);  // 12:59
  expect(isOpen(Date.parse("2026-12-24T16:00:00Z"), XMAS)).toBe(false); // 13:00
});
it("dia especial fechado num dia de semana: não abre e não conta prazo", () => {
  expect(isOpen(Date.parse("2026-12-25T13:00:00Z"), XMAS)).toBe(false);
  expect(businessMinutesBetween(Date.parse("2026-12-24T15:00:00Z"), Date.parse("2026-12-26T12:00:00Z"), XMAS)).toBe(60 + 60);
});
it("lastClosingBefore e daysCountingOpenDays respeitam o dia especial", () => { /* ... */ });
it("sem `especiais` nada muda (compatível com o horário salvo hoje)", () => { /* DEFAULT_HOURS iguais aos testes antigos */ });
```

Em `special-days.test.ts`:

```ts
it("dia fechado cria um bloqueio Feriado da Casa inteira na Agenda; tirar o dia apaga o bloqueio", async () => {
  await saveSpecialDays([{ day: "2026-12-25", window: null, text: null }], uid);
  expect(await liveBlocks()).toContainEqual(expect.objectContaining({ professionalId: null, reason: "feriado", startsOn: "2026-12-25", externalKey: "dia_especial:2026-12-25" }));
  await saveSpecialDays([], uid);
  expect(await liveBlocks()).toEqual([]);
});
it("a Resposta fora do horário usa o texto do dia especial quando ele tem texto", async () => { /* ... */ });
it("data no passado ou repetida é recusada", async () => {
  await expect(saveSpecialDays([{ day: "2026-12-25", window: null, text: null }, { day: "2026-12-25", window: ["08:00", "12:00"], text: null }], uid)).rejects.toThrow("O dia 25/12 aparece duas vezes.");
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/business-hours.test.ts src/server/domain/special-days.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Em `business-hours.ts`, troque cada `hours[String(d.getUTCDay())]` por `windowOf(dayStart, hours)`, que procura antes `hours.especiais?.[AAAA-MM-DD]` (com `in`: `null` = fechado). `saveSpecialDays` valida (máximo 60 dias, sem passado, janela início < fim), grava e sincroniza bloqueios pela porta existente (`createBlock`/`deleteBlock` de `src/server/domain/agenda/blocks.ts`, `professionalId: null`, `reason: "feriado"`, título "Casa fechada"); horário reduzido não cria bloqueio. Tela com a pergunta "Em que dias a Casa abre diferente?" e, por dia: data, "Fechada" ou "Das __ às __", e "Texto para quem escrever nesse dia (opcional)".
- [ ] **Step 4: Run** `npx vitest run src/lib/business-hours.test.ts src/server/domain/special-days.test.ts src/components/config/special-days.test.tsx src/server/rules/engine.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(horario): Dias especiais (feriado e horário reduzido) valem para mensagens, prazos e Agenda`.

---

### Task 4: Biblioteca e envio de arquivo pela fila (item 18, primeira parte)

**Files:**
- Create: `drizzle/0072_biblioteca.sql`, `src/server/domain/library.ts`, `src/server/domain/library.test.ts`, `src/components/config/library.tsx`, `src/components/lead/library-picker.tsx` (+ testes), `src/app/(app)/config/biblioteca/page.tsx`, `src/app/(app)/config/biblioteca/actions.ts`
- Modify: `src/server/db/schema.ts`, `test/db.ts`, `src/server/domain/outbox.ts` (`EnqueueInput.kind`, `fileId`), `src/server/domain/send.ts` (`AutomatedPayload`, `deliverAutomated`), `src/components/lead/composer.tsx` (clipe › "Da biblioteca"), `src/lib/config-tabs.ts` (item `biblioteca`, grupo `conversas`, need `diaadia`), `src/server/whatsapp/retention.ts` (a Biblioteca nunca é apagada pela retenção)

**Interfaces:**
- Produces:
  - `library_files(id, name text not null, caption text null, tags text[] not null default '{}', path text not null, mime text not null, kind text not null /* image|video|document|audio */, size_bytes int, created_by, created_at, deleted_at)`
  - `LIBRARY_TAGS = ["Preços", "Resultados", "Cuidados", "Como chegar"] as const` (sugestões; a gestão pode criar outra)
  - `uploadLibraryFile(file: Upload, meta: { name: string; caption?: string | null; tags: string[] }, userId: string): Promise<{ id: string }>` (usa `planMedia`; até 16 MB)
  - `listLibrary(opts?: { tag?: string | null; q?: string | null }): Promise<LibraryItem[]>` com `LibraryItem = { id; name; caption; tags; kind; sizeBytes; thumbUrl: string | null }`
  - `readLibraryFile(id: string): Promise<{ data: Buffer; mime: string; name: string; kind: string } | null>`
  - `sendLibraryFile(dealId: string, fileId: string, caption: string | null, userId: string): Promise<void>` (envio na hora pela atendente, mesmo caminho de `sendMediaFromCrm`)
  - `EnqueueInput.kind: "text" | "poll" | "media"` e `EnqueueInput.fileId?: string` (guardado em `options.fileId`; `text` = legenda ou o nome do arquivo)
  - `AutomatedPayload = { kind: "text" | "poll"; text: string; options: string[] } | { kind: "media"; fileId: string; caption: string | null }`

- [ ] **Step 1: Write the failing tests** em `library.test.ts`:

```ts
it("sobe uma foto com etiqueta Preços e lista por etiqueta", async () => { /* listLibrary({ tag: "Preços" }) → 1 item, kind "image" */ });
it("arquivo que não é foto, vídeo mp4, PDF ou áudio é recusado com o motivo", async () => {
  await expect(uploadLibraryFile({ name: "x.exe", mime: "application/octet-stream", data: Buffer.from("MZ") }, { name: "x", tags: [] }, uid))
    .rejects.toThrow("Esse tipo de arquivo não pode ir pelo WhatsApp. Use foto, vídeo MP4, PDF ou áudio.");
});
it("a fila envia um arquivo da Biblioteca como mídia e ele aparece na conversa", async () => {
  await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela de preços", source: "automacao:x" });
  await drainOutbox(OPEN_TIME);
  expect(fake.media).toEqual([{ mediatype: "image", caption: "Tabela de preços" }]);
  expect(await lastOut(dealId)).toMatchObject({ kind: "image", status: "sent" });
});
it("arquivo apagado da Biblioteca depois de enfileirar: o item é cancelado com o motivo", async () => { /* error "O arquivo saiu da Biblioteca." */ });
it("apagar é lógico: a conversa que já recebeu continua mostrando o arquivo", async () => { /* deletedAt, path intacto */ });
```

E `library-picker.render.test.tsx`: abre com as abas das etiquetas, mostra a miniatura e "Enviar" num toque chama `sendLibraryFileAction(dealId, id, legenda)`.

- [ ] **Step 2: Run** `npx vitest run src/server/domain/library.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Migration 0072 (`when` 1792400000000). Arquivos em `MEDIA_DIR/biblioteca/<id>.<ext>` (igual ao anexo da resposta pronta em `quick-replies.ts`). `deliverAutomated` com `kind: "media"` lê o arquivo e chama `prov.sendMedia`; a linha da conversa fica com o `kind` da mídia e `mediaPath` apontando para o arquivo da Biblioteca; o resto (pendente, eco, incerto) é o mesmo caminho do texto. `processItem` cancela com "O arquivo saiu da Biblioteca." se `deleted_at` estiver preenchido.
- [ ] **Step 4: Run** `npx vitest run src/server/domain/library.test.ts src/server/domain/outbox.test.ts src/server/domain/send-media.test.ts src/components/lead/library-picker.render.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(biblioteca): arquivos da Casa num lugar só, envio em um toque e pela fila`.

---

### Task 5: Menu que encaminha e responde (item 9)

**Files:**
- Create: `src/lib/welcome-menu-flow.ts`, `src/lib/welcome-menu-flow.test.ts`
- Modify: `src/server/domain/welcome-menu.ts`, `src/server/domain/welcome-menu.test.ts`, `src/server/domain/outbox.ts` (o `source` do menu passa a ser prefixo), `src/components/config/welcome-menu.tsx` (+ teste)

**Interfaces:**
- Consumes: `passToTeam` (Task 1), `transferDeal`, `addTag`, `listLibrary`/`enqueueAutomated({ kind: "media" })` (Task 4).
- Produces:
  - `type MenuOption = { label: string; tag?: string | null; reply?: { text?: string | null; fileId?: string | null } | null; passTo?: { team: string } | { user: string } | null; submenu?: { intro: string; options: MenuOption[] } | null }` (submenu só no 1º nível: no máximo 2 níveis; 2 a 6 opções por nível)
  - `type WelcomeConfig = { enabled: boolean; intro: string; options: MenuOption[] }` (o formato antigo `{ label, tag }` continua válido: é um `MenuOption` sem o resto)
  - `parseMenuChoice(text: string, options: { label: string }[]): number | null` (índice 0-based)
  - `menuStep(cfg: WelcomeConfig, path: number[], input: string): { kind: "escolheu"; path: number[]; option: MenuOption } | { kind: "submenu"; path: number[]; text: string } | { kind: "nao_entendi" }` (pura; a tela de teste usa)
  - `WELCOME_SOURCE` continua `"menu_boas_vindas"`; o submenu sai com `source = "menu_boas_vindas:<i>"`.

- [ ] **Step 1: Write the failing tests** em `welcome-menu-flow.test.ts`:

```ts
const opts = [{ label: "Agendar horário" }, { label: "Método Fiaes®" }, { label: "Saber preços" }];
it.each([["2", 1], [" 2 ", 1], ["2.", 1], ["2️⃣", 1], ["opção 2", 1], ["Método Fiaes", 1], ["metodo fiaes®", 1]])("'%s' escolhe a opção %i", (t, i) => {
  expect(parseMenuChoice(t, opts)).toBe(i);
});
it.each(["tenho 2 filhas", "dois horários", "7", "0", "", "Oi, boa tarde! Queria saber o valor da escova"])("'%s' não é escolha", (t) => {
  expect(parseMenuChoice(t, opts)).toBeNull();
});
it("menuStep: opção com submenu devolve o texto do submenu numerado; a escolha no submenu devolve a opção de dentro", () => { /* ... */ });
```

Em `welcome-menu.test.ts`:

```ts
it("opção que responde: a resposta entra na fila com o texto da gestão e a etiqueta é posta", async () => { /* outbox source menu_boas_vindas:resposta */ });
it("opção que passa para o setor Método Fiaes®: chama passToTeam e deixa a nota 'Escolheu no menu: 2. Método Fiaes®'", async () => { /* deals.teamId */ });
it("opção com submenu: manda o submenu; '1' depois disso vale para o submenu, não para o menu de cima", async () => { /* ... */ });
it("alguém da equipe escreveu depois do menu: a resposta da cliente não é mais escolha (igual a hoje)", async () => { /* ... */ });
it("menu salvo no formato antigo continua funcionando (só etiqueta e nota)", async () => { /* settings com { label, tag } */ });
it("salvar recusa terceiro nível, opção sem nome e passar para setor inativo", async () => { /* mensagens: "O menu tem no máximo 2 níveis." */ });
```

E `welcome-menu.test.tsx` (tela): uma opção por vez, com a pergunta "O que acontece quando ela escolhe {opção}?" e quatro escolhas (Pôr etiqueta, Responder, Passar para, Abrir outro menu); o "Testar como cliente" ao lado usa `menuStep` sem enviar nada.

- [ ] **Step 2: Run** `npx vitest run src/lib/welcome-menu-flow.test.ts src/server/domain/welcome-menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `parseMenuChoice`: tira emoji de tecla (`/⃣|️/g`), aceita `^\s*(?:op(?:ç|c)[aã]o\s*)?(\d)\s*[.)-]?\s*$` ou o rótulo normalizado igual (função `norm` que já existe, sem o ®); nada mais. `maybeWelcomeChoice` acha o último envio do menu por `source like 'menu_boas_vindas%'`, sabe o nível pelo sufixo, e para a opção escolhida, nesta ordem: etiqueta, nota, resposta (texto e/ou arquivo, cada um um item na fila com `source = "menu_boas_vindas:resposta"`), passar para (setor ou pessoa), submenu. Em `processItem`, a checagem do menu passa a valer para `source.startsWith(WELCOME_SOURCE)`; a regra "alguém da Casa já respondeu" continua para o menu e o submenu, e não vale para a resposta (ela é a continuação do menu).
- [ ] **Step 4: Run** `npx vitest run src/lib/welcome-menu-flow.test.ts src/server/domain/welcome-menu.test.ts src/components/config/welcome-menu.test.tsx src/server/domain/outbox.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): cada opção responde, passa para setor ou pessoa, ou abre submenu`.

---

### Task 6: Regras por acontecimento: gatilhos e condições (item 10, primeira parte)

**Files:**
- Create: `src/server/rules/events.ts`, `src/server/rules/events.test.ts`
- Modify: `src/server/rules/types.ts`, `src/server/rules/engine.ts` (`runRules` ignora gatilhos de acontecimento; `execute` e `candidateForDeal` exportados), `src/server/rules/preview.ts`, `src/server/domain/deals.ts` (depois do commit de `recordInbound`), `src/server/domain/tags.ts` (`addTag`), `src/server/whatsapp/webhook.ts` (ligação perdida), `src/components/config/automations.tsx`

**Interfaces:**
- Consumes: `automationBlockReason` (Task 2) só pela fila; nada novo aqui.
- Produces:
  - gatilhos novos em `triggerSchema`: `{ type: "cliente_escreveu"; words: string[] /* 1 a 20 */ }`, `{ type: "contato_novo" }`, `{ type: "ligacao_perdida" }`, `{ type: "midia_recebida"; kinds: ("image"|"audio"|"video"|"document")[] }`, `{ type: "etiqueta_colocada"; tag: string }`
  - `EVENT_TRIGGERS: ReadonlySet<Trigger["type"]>` com esses cinco
  - condições novas em `conditionSchema`: `{ type: "casa_aberta"; aberta: boolean }`, `{ type: "tem_etiqueta"; tag: string; tem: boolean }`
  - `type RuleEvent = { type: "mensagem"; dealId: string; messageId: string; kind: string; body: string | null; created: boolean; at: Date } | { type: "ligacao_perdida"; dealId: string; messageId: string; at: Date } | { type: "etiqueta"; contactId: string; tag: string; at: Date; byRule: boolean }`
  - `runEventRules(ev: RuleEvent, now?: Date): Promise<{ fired: number; errors: string[] }>`
  - `export async function execute(tx, a, c, auto, trigger, now, ctx)` e `export async function candidateForDeal(dealId: string): Promise<Candidate | null>` em `engine.ts`
  - `addTag(contactId: string, rawName: string, userId: string | null, opts?: { byRule?: boolean }): Promise<Tag>` (dispara `runEventRules` com `byRule` depois de gravar)
  - rótulos em `TRIGGER_LABELS`: "A cliente escrever uma destas palavras", "Chegar um contato novo", "Ligação perdida", "A cliente mandar foto, áudio, vídeo ou documento", "Uma etiqueta ser colocada"

- [ ] **Step 1: Write the failing tests** em `events.test.ts`:

```ts
it("'quanto custa' na mensagem da cliente dispara a regra de palavra uma vez por mensagem", async () => {
  await rule({ trigger: { type: "cliente_escreveu", words: ["quanto custa", "valor"] }, actions: [{ type: "alertar_responsavel", message: "{nome} perguntou preço" }] });
  await inbound("m1", "Oi! Quanto custa a escova?");
  expect(await alertTexts()).toEqual(["Maria perguntou preço"]);
  await runEventRules({ type: "mensagem", dealId, messageId: m1, kind: "text", body: "Oi! Quanto custa a escova?", created: false, at: T0 });
  expect(await alertTexts()).toHaveLength(1); // automation_runs: windowKey "evento:<messageId>"
});
it("palavra casa sem acento e sem maiúscula, mas não dentro de outra palavra ('valor' não casa 'valorizar')", async () => { /* ... */ });
it("ligar a regra não age nas mensagens que já chegaram, nem na mensagem com mais de 6 h (webhook reprocessado)", async () => { /* ... */ });
it("etiqueta posta por regra não dispara regra (sem laço A→B→A)", async () => {
  await rule({ trigger: { type: "etiqueta_colocada", tag: "B" }, actions: [{ type: "alertar_responsavel", message: "{nome} ganhou B" }] });
  await runEventRules({ type: "etiqueta", contactId, tag: "B", at: T0, byRule: true });
  expect(await runs()).toHaveLength(0);
});
it("ligação perdida dispara; atendida não", async () => { /* ... */ });
it("contato novo dispara só na 1ª mensagem do contato", async () => { /* ... */ });
it("condição casa_aberta=false só age fora do expediente (Dias especiais valem)", async () => { /* ... */ });
it("Spam, Fornecedor, Equipe e canal em modo quieto ficam fora (igual ao motor de tempo)", async () => { /* ... */ });
it("runRules (a cada minuto) não roda gatilho de acontecimento", async () => { /* summary.fired = 0 */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/rules/events.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `runEventRules` busca as automações ligadas (`activeAutomationFilter()`) cujo gatilho é do tipo do evento, monta o candidato com `candidateForDeal`, aplica as condições (incluindo `etapa_em`) e executa na mesma transação de `runRules` (lead travado, `automation_runs` com `windowKey` = `evento:<messageId>` ou `etiqueta:<tag>:<at ISO>`). Casamento de palavra: texto normalizado (`fold` de `signals.ts`) e borda de palavra (`\b`). Chamadas, todas depois do commit, em `try/catch` que nunca derruba a ingestão: em `recordInbound` (mesmo bloco do menu; não para `noWait`, nem mensagem com mais de 6 h, nem `importedAt`), em `addTag` (com `byRule` vindo do chamador) e na ligação perdida em `webhook.ts`. `previewCandidates` para gatilho de acontecimento devolve `{ count: 0, sendCount: 0, sample: [] }` e a tela diz "Vale para o que acontecer depois de ligar". O editor ganha os gatilhos e as condições, com a frase legível ("Quando a cliente escrever 'quanto custa' ou 'valor', com a Casa aberta").
- [ ] **Step 4: Run** `npx vitest run src/server/rules/ src/server/domain/deals.test.ts src/server/whatsapp/webhook.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(regras): gatilhos por acontecimento (palavra, contato novo, ligação perdida, mídia, etiqueta)`.

---

### Task 7: Regras: ações novas (item 10, segunda parte)

**Files:**
- Modify: `src/server/rules/types.ts`, `src/server/rules/templates.ts` (`SEND_TYPES` ganha `enviar_arquivo`), `src/server/rules/engine.ts` (`execute`), `src/server/rules/engine.test.ts`, `src/server/rules/events.test.ts`, `src/components/config/automations.tsx`, `src/server/domain/conversation-status.ts` (aceitar ator `null` = "Sistema")

**Interfaces:**
- Consumes: `passToTeam` (Task 1), `transferDeal`, `addTag(contactId, name, null, { byRule: true })`, `removeTag`, `contactNotes`, `setConversationStatus`, `enqueueAutomated({ kind: "media", fileId })` (Task 4).
- Produces, em `actionSchema`:
  - `{ type: "por_etiqueta"; tag: string }`, `{ type: "tirar_etiqueta"; tag: string }`
  - `{ type: "passar_para"; to: { team: string } | { user: string } }`
  - `{ type: "escrever_nota"; text: string /* 3 a 500 */ }`
  - `{ type: "enviar_arquivo"; fileId: string; caption?: string | null; delayMinutes?: number /* 0 a 240 */ }`
  - `{ type: "mudar_status"; status: "aberto" | "aguardando" | "resolvido" }`
  - `enviar_mensagem` ganha `delayMinutes?: number` (0 a 240), que vira `notBefore` na fila
  - `actions` passa de `.max(4)` para `.max(6)`
  - rótulos: "Pôr a etiqueta", "Tirar a etiqueta", "Passar para", "Escrever uma nota", "Enviar um arquivo da Biblioteca", "Mudar o status para"

- [ ] **Step 1: Write the failing tests** em `events.test.ts` e `engine.test.ts`:

```ts
it("'remarcar' na mensagem: põe Quer remarcar, passa para o setor Recepção e escreve a nota", async () => {
  await rule({ trigger: { type: "cliente_escreveu", words: ["remarcar"] }, actions: [
    { type: "por_etiqueta", tag: "Quer remarcar" }, { type: "passar_para", to: { team: recepcaoId } }, { type: "escrever_nota", text: "Pediu para remarcar" }] });
  await inbound("m1", "Preciso remarcar amanhã");
  expect(await tagsOf(contactId)).toContain("Quer remarcar");
  expect((await dealRow(dealId)).teamId).toBe(recepcaoId);
  expect(await notes(contactId)).toContainEqual(expect.objectContaining({ authorName: "Regra: Remarcar", body: "Pediu para remarcar" }));
});
it("enviar_arquivo com 10 min de atraso entra na fila com notBefore = agora + 10 min", async () => { /* ... */ });
it("ligar regra com enviar_arquivo pede a confirmação de envio real (sendsMessages)", () => {
  expect(sendsMessages([{ type: "enviar_arquivo" }])).toBe(true);
});
it("mudar_status resolvido numa regra de tempo arquiva a conversa como Sistema", async () => { /* ... */ });
it("passar_para pessoa que saiu da equipe: a regra registra o erro e as outras ações seguem", async () => { /* summary.errors com o nome da regra */ });
it("arquivo apagado da Biblioteca: salvar a regra recusa ('Esse arquivo saiu da Biblioteca. Escolha outro.')", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/rules/`. Expected: FAIL.
- [ ] **Step 3: Implement** os casos novos de `execute`. A nota sai com `authorName = "Regra: {nome da regra}"` e `source = "regra"`. `por_etiqueta` chama `addTag` com `byRule: true` (Task 6 não dispara de novo). Erro numa ação vira linha em `summary.errors` e não desfaz as anteriores (cada ação interna é idempotente; a execução continua dentro da mesma transação, com `savepoint` por ação). O editor mostra as ações em linha do tempo ("Na hora", "Depois de 10 min").
- [ ] **Step 4: Run** `npx vitest run src/server/rules/ src/server/domain/conversation-status.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(regras): pôr e tirar etiqueta, passar para, nota, arquivo e status`.

---

### Task 8: Mensagens da Casa e Depois do atendimento (item 11)

**Files:**
- Create: `src/lib/casa-texts.ts`, `src/lib/casa-texts.test.ts`, `src/server/domain/after-visit.ts`, `src/server/domain/after-visit.test.ts`, `src/components/config/after-visit.tsx` (+ teste)
- Modify: `src/lib/reminder-d1.ts` (`ReminderVars` ganha `endereco`, `mapa`; `DEFAULT_REMINDER_TEXT` vira o da Casa), `src/server/domain/client-link/settings.ts` (`CasaInfo.mapa`), `src/server/domain/client-link/reminder.ts` (preenche as variáveis novas), `src/components/config/reminder-d1.tsx` ("Usar o texto da Casa"), `src/server/domain/agenda/ports.ts` (`changeStatus` chama `afterVisitDone` depois do commit), `src/server/domain/caixa/comandas.ts` (`closeComanda` chama `afterVisitDone` depois do commit), `src/server/domain/outbox.ts` (reconferência do `source` `depois_atendimento:`), `worker/index.ts` (job `depois-atendimento`, `*/15 * * * *`), `src/lib/config-tabs.ts` (item `depois-atendimento`, grupo `mensagens`, `sends: true`)

**Interfaces:**
- Consumes: `automationBlockReason` (Task 2, pela fila), `getCasaInfo`, `inReminderWindow`.
- Produces:
  - em `casa-texts.ts`: `CASA_CONFIRMACAO_D1`, `CASA_AGRADECIMENTO`, `CASA_PESQUISA_TITULO`, `CASA_NOTA_ALTA` (strings, abaixo)
  - `type AfterVisitConfig = { mode: "desligado" | "agradecimento" | "pesquisa"; delayMinutes: number /* 30 a 1440, padrão 120 */; textoAgradecimento: string; tituloPesquisa: string; textoNotaAlta: string; linkGoogle: string | null; notaAltaMin: 4 | 5 }` (chave `settings.depois_atendimento`)
  - `getAfterVisit(): Promise<AfterVisitConfig>`, `saveAfterVisit(input: unknown, userId: string): Promise<void>`
  - `afterVisitDone(visitId: string, now?: Date): Promise<"enfileirado" | "ja_tem" | "desligado" | "nao_concluida">` (enfileira com `notBefore = conclusão + delayMinutes`, `source = "depois_atendimento:<visitId>"`)
  - `runAfterVisit(now?: Date): Promise<{ enqueued: number }>` (job: pega as visitas concluídas nas últimas 24 h que ainda não têm item, para o Avec importado)
  - `AFTER_VISIT_SOURCE = "depois_atendimento:"`

Textos padrão (rascunho no estilo da Casa; os definitivos vêm da Casa, ver decisões):

```ts
export const CASA_CONFIRMACAO_D1 = [
  "Oi, {primeiro_nome}! 💛", "", "Podemos confirmar sua presença amanhã na Casa Fiaes?", "", "📅 *{data}* às *{hora}*", "{servicos}", "",
  "📍 {endereco}", "{mapa}", "", "Temos tolerância de 15 minutos. Se precisar remarcar, é só responder por aqui.",
].join("\n");
export const CASA_AGRADECIMENTO = [
  "Oi, {primeiro_nome}! Obrigada por estar com a gente hoje na Casa Fiaes. 💛", "",
  "Se puder, conte como foi no Google. Sua avaliação ajuda muito: {link_google}", "", "E quando quiser voltar, pergunte pelos nossos Combos Especiais.",
].join("\n");
export const CASA_PESQUISA_TITULO = "{primeiro_nome}, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?";
export const CASA_NOTA_ALTA = "Que alegria, {primeiro_nome}! 💛 Se puder, conte como foi no Google: {link_google}";
```

- [ ] **Step 1: Write the failing tests.** `casa-texts.test.ts`: os quatro textos não têm artigo antes de nome (`/\b(?:a|o|da|do|na|no|pela|pelo) [A-Z][a-z]+ Fiaes\b/` só pode casar "Casa Fiaes"), não têm "Método Fiaes" sem ®, e `renderReminder(CASA_CONFIRMACAO_D1, vars, null)` com `endereco` vazio tira a linha do 📍 e do mapa (sem linha em branco dupla). `after-visit.test.ts`:

```ts
it("visita com todos os serviços Finalizados: o agradecimento entra na fila para 2 h depois, uma vez só", async () => {
  await finishAll(visitId, at("2026-10-20T17:00:00Z"));
  expect(await afterVisitDone(visitId, at("2026-10-20T17:00:00Z"))).toBe("enfileirado");
  expect(await afterVisitDone(visitId, at("2026-10-20T17:01:00Z"))).toBe("ja_tem");
  expect((await outboxRows())[0]).toMatchObject({ notBefore: at("2026-10-20T19:00:00Z") });
});
it("visita com um serviço ainda em atendimento não dispara", async () => { /* "nao_concluida" */ });
it("cliente que faltou não recebe", async () => { /* ... */ });
it("conclusão às 19h30: com 2 h cairia às 21h30, fora da janela 8h–20h: sai às 8h do dia seguinte", async () => { /* ... */ });
it("Avec importado no dia seguinte: o job pega a visita concluída há menos de 24 h; mais velha que isso não sai", async () => { /* ... */ });
it("comanda fechada no caixa do CRM dispara pelo mesmo caminho (sem duplicar com o Finalizado)", async () => { /* ... */ });
it("modo desligado ou link do Google vazio no agradecimento: não enfileira e a tela não deixa ligar", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/casa-texts.test.ts src/server/domain/after-visit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** A visita está "concluída" quando todos os horários ativos dela estão `compareceu` (Finalizado) e pelo menos um existe; a hora da conclusão é o `updated_at` do último. `afterVisitDone` é chamada depois do commit nos dois lugares (porta `changeStatus` e `closeComanda`) e engole o erro (nunca derruba o Finalizado). No envio, `processItem` reconfere: modo ainda ligado, visita ainda concluída, menos de 24 h desde a conclusão, e refaz o texto (como o lembrete faz). No modo `pesquisa` esta task só enfileira o item; o envio da enquete e o voto são da Task 9 (até lá, o modo `pesquisa` fica escondido na tela). A tela tem uma pergunta: "O que a cliente recebe depois do atendimento?" (Nada, Agradecimento com o link do Google, Pesquisa de satisfação), e o passo seguinte "Quanto tempo depois?" e o texto com prévia. Ligar exige a virada (Task 10); até lá o interruptor fica desabilitado com "Ligue pela Virada".
- [ ] **Step 4: Run** `npx vitest run src/lib/ src/server/domain/after-visit.test.ts src/server/domain/client-link/reminder.test.ts src/components/config/after-visit.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mensagens): textos da Casa na confirmação e agradecimento depois do atendimento`.

---

### Task 9: Pesquisa de satisfação (item 12)

**Files:**
- Create: `drizzle/0073_pesquisa_satisfacao.sql`, `src/server/domain/satisfaction.ts`, `src/server/domain/satisfaction.test.ts`, `src/components/reports/satisfaction-block.tsx` (+ teste)
- Modify: `src/server/db/schema.ts`, `test/db.ts`, `src/server/domain/after-visit.ts` (modo `pesquisa` envia a enquete), `src/server/domain/poll-vote.ts` (despacha voto de pesquisa), `src/server/rules/types.ts` + `engine.ts` (ação `pedir_avaliacao`), `src/components/config/after-visit.tsx` (mostra o modo), a aba Salão de Relatórios (`src/app/(app)/relatorios/*`, bloco novo)

**Interfaces:**
- Consumes: `AfterVisitConfig`, `AFTER_VISIT_SOURCE` (Task 8); `applyPollVote` (existente); `execute` (Task 7).
- Produces:
  - `satisfaction_answers(id, visit_id uuid null, deal_id uuid not null, contact_id uuid not null, poll_message_id uuid not null unique, score smallint null check 1..5, professional_ids uuid[] not null default '{}', service_ids uuid[] not null default '{}', asked_at timestamptz not null, answered_at timestamptz null)`
  - `SATISFACTION_OPTIONS = ["5 · Excelente", "4 · Muito bom", "3 · Bom", "2 · Ruim", "1 · Muito ruim"] as const`
  - `scoreOf(option: string): 1 | 2 | 3 | 4 | 5 | null`
  - `applySatisfactionVote(pollMessageId: string, option: string | null, at: Date): Promise<"nota_alta" | "nota_baixa" | "retirado" | "nada">`
  - `satisfactionNumbers(f: { from: string; to: string }): Promise<{ asked: number; answered: number; average: number | null; byProfessional: { id: string; name: string; answered: number; average: number }[] }>`
  - ação `{ type: "pedir_avaliacao" }` em `actionSchema`, rótulo "Mandar a Pesquisa de satisfação"; `SEND_TYPES` ganha `pedir_avaliacao`

- [ ] **Step 1: Write the failing tests** em `satisfaction.test.ts`:

```ts
it("nota 5: grava, e a cliente recebe a mensagem de nota alta com o link do Google", async () => {
  expect(await applySatisfactionVote(pollId, "5 · Excelente", T1)).toBe("nota_alta");
  expect(await outboxTexts()).toEqual(["Que alegria, Maria! 💛 Se puder, conte como foi no Google: https://g.page/r/casa-fiaes/review"]);
});
it("nota 2: avisa a gestão com cliente, serviços e quem fez; põe a etiqueta Nota baixa; não manda nada para a cliente", async () => {
  expect(await applySatisfactionVote(pollId, "2 · Ruim", T1)).toBe("nota_baixa");
  expect(await outboxTexts()).toEqual([]);
  expect(await alertsOf(dealId)).toContainEqual(expect.objectContaining({ audience: "gestao", type: "nota_baixa",
    message: "Maria deu nota 2 para Escova com Gilvan. Fale com ela hoje." }));
  expect(await tagsOf(contactId)).toContain("Nota baixa");
});
it("mudou o voto de 2 para 5: vale o último, o alerta de nota baixa se resolve, e o link sai uma vez só", async () => { /* ... */ });
it("votou de novo com a mesma nota (webhook repetido): nada muda", async () => { /* ... */ });
it("enquete de confirmação continua com o caminho antigo (Confirmo / Preciso remarcar)", async () => { /* applyPollVote */ });
it("satisfactionNumbers: média e respostas por profissional no período", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/domain/satisfaction.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Migration 0073 (`when` 1792410000000). No modo `pesquisa`, o item de `depois_atendimento:` é uma enquete (`kind: "poll"`, opções `SATISFACTION_OPTIONS`); ao confirmar o envio, grava a linha em `satisfaction_answers` com as profissionais e os serviços da visita. `applyPollVote` olha antes se o `pollExternalId` é de uma pesquisa (join `messages` → `satisfaction_answers.poll_message_id`) e, se for, chama `applySatisfactionVote`. Nota baixa = abaixo de `notaAltaMin`. O alerta usa `dedupeKey = "nota:<pollMessageId>"`. A mensagem de nota alta tem `source = "pesquisa_nota_alta:<pollMessageId>"` (sai uma vez). O bloco em Relatórios › Salão mostra "Pesquisa de satisfação": respondidas de enviadas, média e a tabela por profissional (só com `relatorios.equipe`).
- [ ] **Step 4: Run** `npx vitest run src/server/domain/satisfaction.test.ts src/server/domain/after-visit.test.ts src/server/rules/ src/components/reports/satisfaction-block.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pesquisa): nota de 1 a 5 depois do atendimento; nota baixa avisa a gestão, nota alta recebe o Google`.

---

### Task 10: Virada (lembrete e Depois do atendimento saem do ChatGuru e do Avec)

**Files:**
- Create: `src/lib/virada.ts`, `src/lib/virada.test.ts`, `src/components/config/virada.tsx`, `src/components/config/virada.test.tsx`, `src/app/(app)/config/virada/page.tsx`, `src/app/(app)/config/virada/actions.ts`
- Modify: `src/server/domain/client-link/reminder.ts` (`saveLembreteD1` exige a virada para ligar), `src/server/domain/after-visit.ts` (`saveAfterVisit` idem), `src/server/domain/client-link/reminder.test.ts`, `src/components/config/reminder-d1.tsx` (o interruptor leva à Virada), `src/lib/config-tabs.ts` (item `virada`, grupo `mensagens`, `sends: true`, palavras "chatguru", "avec", "desligar")

**Interfaces:**
- Consumes: `saveLembreteD1`, `saveAfterVisit`, `getLembreteD1`, `getAfterVisit`, `ensureTeamConversation(phone)` (Task 11).
- Produces:
  - `VIRADA_ITENS = { lembrete: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido", "teste_enviado"], depois: ["avec_agradecimento", "texto_conferido", "teste_enviado"] } as const`
  - `type Virada = { alvo: "lembrete" | "depois"; marcados: string[]; quem: string; quando: string }` (chave `settings.virada_<alvo>`, auditada)
  - `viradaPronta(alvo: "lembrete" | "depois", marcados: readonly string[]): boolean`
  - `saveVirada(alvo, marcados: string[], userId: string): Promise<void>`
  - `sendViradaTest(alvo, phone: string, userId: string): Promise<{ dealId: string }>` (manda o texto de verdade, montado com uma visita de exemplo, para o WhatsApp digitado na tela; o número vira contato de Equipe, como na Task 11; grava `audit_log` `teste_virada`)
  - `saveLembreteD1` com `enabled: true` e virada incompleta lança `UserFacingError("Faça a Virada antes de ligar: confirme que o lembrete do ChatGuru e a confirmação do Avec estão desligados.")`

- [ ] **Step 1: Write the failing tests** em `reminder.test.ts` e `virada.test.ts`:

```ts
it("ligar o lembrete sem a virada é recusado; com os 4 itens marcados, liga", async () => {
  await expect(saveLembreteD1({ ...cfg, enabled: true }, uid)).rejects.toThrow("Faça a Virada antes de ligar");
  await saveVirada("lembrete", [...VIRADA_ITENS.lembrete], uid);
  await expect(saveLembreteD1({ ...cfg, enabled: true }, uid)).resolves.toBeUndefined();
});
it("desligar não pede virada, e o que estava na fila é cancelado na hora de enviar", async () => { /* reminderStillValid → "lembrete desligado" */ });
it("teste_enviado só conta se houve um teste de verdade nas últimas 24 h (audit 'teste_virada')", async () => { /* ... */ });
it("Depois do atendimento: mesma trava, com avec_agradecimento", async () => { /* ... */ });
```

E `virada.test.tsx`: uma pergunta por passo, na ordem: "O lembrete do ChatGuru está desligado?" (com o caminho no ChatGuru), "A confirmação por WhatsApp do Avec está desligada?" (Configurações › Notificações › Envio de WhatsApp para clientes), "O texto está certo?" (prévia com a visita de amanhã), "Chegou o teste no seu WhatsApp?" ("Para qual WhatsApp mando o teste?" e o botão "Mandar o teste"); só no fim aparece "Ligar o lembrete", que pede a confirmação de envio real.

- [ ] **Step 2: Run** `npx vitest run src/lib/virada.test.ts src/server/domain/client-link/reminder.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** a trava no servidor (as duas funções `save*` conferem `viradaPronta` dentro da transação) e a tela.
- [ ] **Step 4: Run** `npx vitest run src/lib/virada.test.ts src/server/domain/client-link/ src/server/domain/after-visit.test.ts src/components/config/virada.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(virada): checklist para ligar o lembrete e o depois do atendimento sem mensagem em dobro`.

**Roteiro da virada (operação, depois do deploy; não é código):**
1. Combinar o dia com a Casa (de preferência segunda, com a Casa fechada) e quem está no ChatGuru e no Avec.
2. ChatGuru: desligar o diálogo de lembrete. Avec: Configurações › Notificações › Envio de WhatsApp para clientes, desligar a confirmação e o agradecimento. Print das duas telas em `~/Projects/casa-fiaes/ops/capturas/virada-AAAA-MM-DD-*.png`.
3. No CRM: Configurações › Virada, os passos na ordem; "Mandar o teste" para o WhatsApp da gestora; ligar.
4. No dia seguinte, 8h–20h: conferir em Conversas › Programadas que os lembretes saíram e que nenhuma cliente recebeu dois (procurar "confirmar sua presença" duas vezes no mesmo dia).
5. Voltar atrás: desligar o lembrete no CRM (cancela o que está na fila) e religar o do ChatGuru.

---

### Task 11: Resumo do dia no WhatsApp da gestora (item 16)

**Files:**
- Create: `src/server/domain/summary-whatsapp.ts`, `src/server/domain/summary-whatsapp.test.ts`, `src/components/config/summary-whatsapp.tsx` (+ teste)
- Modify: `src/server/domain/outbox.ts` (`claimNext`: `resumo_dia:` sai com a Casa fechada; `processItem`: reconfere ligado), `worker/index.ts` (job `resumo-whatsapp`, `0 19 * * *`), `src/lib/config-tabs.ts` (item `resumo-whatsapp`, grupo `mensagens`), `src/components/today/daily-summary.tsx` (atalho "Receber todo dia às 19h no meu WhatsApp", só com `relatorios.equipe`)

**Interfaces:**
- Consumes: `dailySummaryText(user, now)` de `src/server/reports/summary-text.ts`; `SUMMARY_HOUR`.
- Produces:
  - `type SummaryWhatsapp = { enabled: boolean; to: { userId: string; phone: string }[] }` (chave `settings.resumo_whatsapp`; até 3 pessoas, todas com `relatorios.equipe`)
  - `saveSummaryWhatsapp(input: unknown, userId: string): Promise<void>`
  - `runSummaryWhatsapp(now?: Date): Promise<{ enqueued: number; skipped: "desligado" | "casa_nao_abriu" | null }>`
  - `SUMMARY_SOURCE = "resumo_dia:"` (`resumo_dia:<AAAA-MM-DD>:<userId>`)
  - `ensureTeamConversation(phone: string): Promise<{ contactId: string; dealId: string }>` (acha ou cria o contato como Equipe e a conversa dele, sem mandar nada; a Task 10 usa)

- [ ] **Step 1: Write the failing tests:**

```ts
it("às 19h de um dia aberto, cada pessoa recebe o próprio resumo na conversa de Equipe do número dela", async () => {
  const r = await runSummaryWhatsapp(at("2026-10-20T22:00:00Z"));
  expect(r.enqueued).toBe(1);
  expect((await outboxRows())[0].text).toContain("Resumo do dia");
  expect((await outboxRows())[0].text).toContain("https://crm.exemplo/atendimento"); // links absolutos com APP_URL
});
it("sábado às 19h (a Casa fechou às 17h): sai mesmo assim; a fila não segura o resumo", async () => { /* drainOutbox com isOpen=false → sent */ });
it("domingo, segunda ou Dia especial fechado: não manda", async () => { /* skipped "casa_nao_abriu" */ });
it("rodar duas vezes no mesmo dia não duplica", async () => { /* source único */ });
it("o número vira contato do tipo Equipe (fora da Fila de clientes e das métricas)", async () => { /* contacts.kind = "equipe" */ });
it("salvar recusa quem não tem 'Ver números de toda a equipe'", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/domain/summary-whatsapp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** O dia "abriu" se `windowOf` (Task 3, se já entrou; senão o dia da semana) tem janela. A conversa de destino: acha ou cria o contato pelo número, marca como Equipe (`setContactKind`) e acha ou cria a conversa dele como `src/server/domain/start-conversation.ts` faz, sem mandar mensagem (isso é `ensureTeamConversation`). O texto é o de `dailySummaryText` com os links trocados por `APP_URL + href`.
- [ ] **Step 4: Run** `npx vitest run src/server/domain/summary-whatsapp.test.ts src/server/domain/outbox.test.ts src/components/config/summary-whatsapp.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(resumo): o resumo do dia chega às 19h no WhatsApp da gestora`.

---

### Task 12: Reação, editar, Como chegar, contato e vídeo (item 17, primeira parte)

**Files:**
- Create: `src/server/domain/message-tools.ts`, `src/server/domain/message-tools.test.ts`
- Modify: `src/server/whatsapp/provider.ts`, `src/server/whatsapp/evolution.ts`, `src/server/whatsapp/evolution.test.ts`, `src/server/whatsapp/demo-provider.ts`, `src/server/domain/client-link/settings.ts` (`CasaInfo` ganha `latitude`, `longitude`), `src/components/config/client-page-settings.tsx` (pino da Casa), `src/components/lead/composer.tsx` (clipe aceita vídeo MP4; itens "Como chegar" e "Mandar contato"), `src/components/lead/conversation.tsx` (segurar a mensagem: reagir 👍 ❤️ 🙏 😂; "Editar" nas da Casa com menos de 15 min), `src/app/(app)/conversa/actions.ts`

**Interfaces:**
- Produces, em `WhatsAppProvider`:
  - `sendReaction?(instance: string, toE164: string, target: { externalId: string; fromMe: boolean }, emoji: string): Promise<void>` → `POST /message/sendReaction/{instance}` `{ key: { remoteJid, fromMe, id }, reaction }` (emoji vazio tira)
  - `editText?(instance: string, toE164: string, externalId: string, text: string): Promise<void>` → `POST /chat/updateMessage/{instance}` `{ number, key: { remoteJid, fromMe: true, id }, text }`
  - `sendLocation?(instance: string, toE164: string, loc: { name: string; address: string; latitude: number; longitude: number }): Promise<{ externalId: string | null }>` → `POST /message/sendLocation/{instance}`
  - `sendContact?(instance: string, toE164: string, c: { fullName: string; phoneE164: string }): Promise<{ externalId: string | null }>` → `POST /message/sendContact/{instance}` `{ number, contact: [{ fullName, wuid, phoneNumber }] }`
- Produces, em `message-tools.ts`:
  - `reactToMessage(messageId: string, emoji: string | null, userId: string): Promise<void>` (grava `messages.reactions.casa`)
  - `editSentMessage(messageId: string, text: string, userId: string, now?: Date): Promise<void>` (só da Casa, enviada pelo CRM, `sent`, texto, menos de 15 min; `editedAt` + `audit_log` com o texto antigo)
  - `sendCasaLocation(dealId: string, userId: string): Promise<void>` (sem pino cadastrado: "Cadastre o pino da Casa em Página da cliente.")
  - `sendContactCard(dealId: string, c: { fullName: string; phoneE164: string }, userId: string): Promise<void>`
  - `EDIT_WINDOW_MS = 15 * 60_000`

- [ ] **Step 1: Write the failing tests.** Em `evolution.test.ts`, um teste por endpoint conferindo URL e corpo (o padrão dos testes de `sendText`). Em `message-tools.test.ts`:

```ts
it("editar depois de 15 min é recusado", async () => {
  await expect(editSentMessage(msgId, "Novo texto", uid, plusMin(16))).rejects.toThrow("Só dá para editar até 15 minutos depois de enviar.");
});
it("editar mensagem da cliente, automática ou de outra pessoa é recusado", async () => { /* ... */ });
it("editar guarda o texto antigo na auditoria e marca 'Editada'", async () => { /* ... */ });
it("reagir grava a reação da Casa e reagir de novo com o mesmo emoji tira", async () => { /* ... */ });
it("Como chegar manda o pino com o nome e o endereço da Casa e aparece na conversa como Localização", async () => { /* ... */ });
it("WhatsApp sem a função (provider antigo): mensagem clara, nada gravado", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/whatsapp/evolution.test.ts src/server/domain/message-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Antes de escrever, abrir o Swagger da Evolution v2.3.7 (`docker compose` local, `/docs`) e confirmar os quatro corpos; se algum diferir, vale o Swagger e o teste acompanha. Os envios novos seguem o caminho de `sendFromCrm` (linha pendente, provider, `confirmSent`), com `kind` `location` e `contact`.
- [ ] **Step 4: Run** `npx vitest run src/server/whatsapp/ src/server/domain/message-tools.test.ts src/components/lead/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(conversa): reagir, editar até 15 min, Como chegar, mandar contato e vídeo`.

---

### Task 13: Encaminhar (item 17, segunda parte)

**Files:**
- Create: `src/server/domain/forward.ts`, `src/server/domain/forward.test.ts`, `src/components/lead/forward-dialog.tsx` (+ teste)
- Modify: `src/components/lead/conversation.tsx` (segurar › "Encaminhar"), `src/app/(app)/conversa/actions.ts`

**Interfaces:**
- Consumes: `sendFromCrm`, `sendMediaFromCrm` (o arquivo de `messages.mediaPath`), `readLibraryFile` não; `contacts.kind`.
- Produces:
  - `FORWARD_MAX = 10`
  - `forwardMessage(messageId: string, toDealIds: string[], userId: string): Promise<{ sent: number; failed: { dealId: string; error: string }[] }>`
  - cabeçalho só para Equipe: `` `Encaminhada da conversa com ${nome}, ${dd/mm às hh:mm}:` ``

- [ ] **Step 1: Write the failing tests:**

```ts
it("para conversa de Equipe vai com o cabeçalho com o nome da cliente e o horário", async () => {
  await forwardMessage(fotoId, [equipeDeal], uid);
  expect(fake.media[0].caption).toBe("Encaminhada da conversa com Maria Souza, 20/10 às 10:00:");
});
it("para outra cliente vai só o conteúdo: sem nome, telefone nem legenda de origem", async () => {
  await forwardMessage(fotoId, [outraCliente], uid);
  expect(fake.media[0].caption).toBeNull();
});
it("mais de 10 destinos é recusado; destino que falha não impede os outros", async () => { /* ... */ });
it("mídia já apagada pela retenção: 'Essa foto não está mais guardada no sistema.'", async () => { /* ... */ });
it("nota interna, ligação e mensagem apagada não podem ser encaminhadas", async () => { /* ... */ });
it("quem não pode abrir a conversa de origem não encaminha", async () => { /* escopo deal-scope */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/domain/forward.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** O diálogo tem uma pergunta: "Para quem?", com busca por conversa e as conversas de Equipe no topo (profissionais).
- [ ] **Step 4: Run** `npx vitest run src/server/domain/forward.test.ts src/components/lead/forward-dialog.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(conversa): encaminhar para até 10 conversas, sem expor a cliente`.

---

### Task 14: Marcar como não lida e Acompanhar (item 17, terceira parte)

**Files:**
- Create: `drizzle/0074_nao_lida_acompanhar.sql`, `src/server/domain/follow.ts`, `src/server/domain/follow.test.ts`, `src/components/today/following.tsx` (+ teste)
- Modify: `src/server/db/schema.ts`, `test/db.ts`, `src/server/queries/queue.ts` (não lida conta a marcada à mão), `src/server/domain/seen.ts` (abrir limpa a marca), Hoje › Recepção (coluna de conversas ganha "Acompanhando"), menu da conversa (`src/components/queue/pane-header.tsx`)

**Interfaces:**
- Produces:
  - `deals.marked_unread_at timestamptz null`, `deals.marked_unread_by uuid null`; `deal_follows(user_id, deal_id, created_at, primary key (user_id, deal_id))`
  - `markUnread(dealId: string, userId: string, now?: Date): Promise<void>`
  - `setFollowing(dealId: string, userId: string, on: boolean): Promise<void>`
  - `followingOf(userId: string): Promise<{ dealId: string; name: string; lastAt: string | null; waiting: boolean }[]>`

- [ ] **Step 1: Write the failing tests:**

```ts
it("marcar como não lida põe a conversa em Não lidas, mesmo com a última mensagem sendo da Casa", async () => { /* getQueue aba nao-lidas */ });
it("marcar como não lida não toca som nem cria aviso no sino", async () => { /* alerts vazio; emit sem aviso */ });
it("abrir a conversa limpa a marca", async () => { /* markConversationRead */ });
it("Acompanhar é por pessoa: Sara acompanha, Cati não vê na lista dela", async () => { /* followingOf */ });
it("conversa resolvida continua em Acompanhando até a pessoa desmarcar", async () => { /* ... */ });
```

- [ ] **Step 2: Run** `npx vitest run src/server/domain/follow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Migration 0074 (`when` 1792420000000). A estrela fica no cabeçalho da conversa ("Acompanhar" / "Deixar de acompanhar"); "Marcar como não lida" no menu ⋯ do card da Fila e da conversa.
- [ ] **Step 4: Run** `npx vitest run src/server/domain/follow.test.ts src/server/queries/queue.test.ts src/components/today/following.render.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(conversa): marcar como não lida e Acompanhando no Hoje`.

---

### Task 15: Filtros finos na Fila (item 18, segunda parte)

**Files:**
- Modify: `src/server/queries/queue.ts` (`QueueOptions`), `src/server/queries/queue.test.ts`, `src/lib/queue.ts` (`QueueParams`, `queueHref`), `src/lib/queue-filters.ts` (`activeFilters`), o painel Filtros da Fila (`src/components/queue/*filters*`)

**Interfaces:**
- Consumes: `QueueOptions.setor` (Task 1).
- Produces:
  - `QueueOptions.etiquetas?: string[] | null` (ids) e `QueueOptions.regraEtiqueta?: "todas" | "qualquer" | "nao_tem" | null` (padrão `qualquer`); o `etiqueta` de hoje continua valendo como `etiquetas: [id]`
  - `QueueOptions.dono?: string | "sem" | null` (`"sem"` = sem dona, combinável com etapa, setor e etiquetas)
  - `QueueOptions.diasSemConversa?: number | null` (1 a 365: última mensagem, de qualquer lado, há N dias ou mais)
  - URL: `etiquetas=a,b&regra=todas&dono=sem&dias=30`

- [ ] **Step 1: Write the failing tests** em `queue.test.ts`:

```ts
it("Todas: só quem tem as duas etiquetas", async () => { /* ... */ });
it("Qualquer: quem tem uma ou outra", async () => { /* ... */ });
it("Não tem: 'Método Fiaes® sem Horário marcado' = etiqueta Método e não tem Horário marcado", async () => { /* combina duas listas */ });
it("dono=sem combinado com etapa e setor", async () => { /* ... */ });
it("dias sem conversar = 30 conta a última mensagem de qualquer lado", async () => { /* ... */ });
it("link antigo ?etiqueta=<id> continua funcionando", async () => { /* ... */ });
```

E em `queue-filters.test.ts`: os chips "Etiquetas: Método, Noiva (todas)", "Sem dona", "30 dias sem conversar", cada um com o link que tira só ele.

- [ ] **Step 2: Run** `npx vitest run src/server/queries/queue.test.ts src/lib/queue-filters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** No painel Filtros, a etiqueta escolhida mostra três botões (Tem todas / Tem qualquer / Não tem), em vez do Shift+toque do ChatGuru (não existe no celular).
- [ ] **Step 4: Run** `npx vitest run src/server/queries/ src/lib/queue-filters.test.ts src/components/queue/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(fila): etiquetas com Todas, Qualquer e Não tem, sem dona e dias sem conversar`.

---

## Verificação final (depois da última task)

- [ ] `npm run typecheck && npm run lint && npm test` sem erro.
- [ ] `npx playwright test` com um e2e novo `e2e/fase-b.spec.ts`: cliente nova escreve, recebe o menu, responde "2", recebe a resposta e cai no setor Método Fiaes®; a Virada não deixa ligar o lembrete sem os passos.
- [ ] Prints (em segundo plano, sem roubar a tela) de: Menu (uma opção aberta), Regras (gatilho de palavra), Dias especiais, Virada, Biblioteca no clipe, Acompanhando no Hoje; celular 390 px e computador.
- [ ] Nenhuma chave nova nasce ligada: conferir `settings` depois do seed (menu, depois do atendimento, resumo, lembrete).

## Nota de integração (coordenador, 18/10)
Os números e os `when` das migrations destas fases se cruzam (A usa 0061–0067 até 1792430000000; B, C e D começam em 1792380000000, 1792390000000 e 1792400000000). Ao juntar uma fase em `ia-sugestao`, renumere as migrations dela para depois da última já integrada, com `when` maior que todos, e reindexe o `_journal.json`. O drizzle pula migration com `when` menor que a última aplicada.

## Regra do dono para todas as fases (18/10, vale acima de qualquer padrão deste plano)
- **Tudo configurável:** todo número de regra (porcentagens, taxas, prazos, horários, limites, quantidades) fica editável em Configurações, com o padrão deste plano como valor inicial. Nada fica fixo no código.
- **Todo texto que a cliente ou a equipe recebe** (mensagens, avisos, recibos, perguntas) fica editável em Configurações, com variáveis e botão "Usar o texto sugerido".
- **Toda funcionalidade nova nasce com um liga/desliga** em Configurações. O que manda mensagem para a cliente nasce **desligado**.
- **Toda ação nova tem uma permissão própria**, atribuível por perfil em Configurações › Pessoas › Perfis. O padrão dos perfis segue este plano.
- Teste em cada tarefa: mudar a configuração muda o comportamento, e sem a permissão a ação é recusada no servidor.
