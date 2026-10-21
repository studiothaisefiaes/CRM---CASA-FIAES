# Fase C · Agenda e ficha da cliente: plano de implementação

> **Para quem executa (agente):** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para rodar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar.

**Objetivo:** fechar os itens 19 a 25 da spec "O que falta". São eles: marcador e tipo do horário, aviso que salta e uso de imagem, ficha de consultoria com fotos, fidelidade, horário que se repete e "Passar o dia", serviço completo e unir cadastros com campos da ficha.

**Arquitetura:** cada item vira um módulo de domínio pequeno, com uma transação por ação e auditoria em `audit_log`. As telas atuais ganham linhas, abas e painéis, mas o desenho não muda.
- **Fichas:** um motor só (`form_questions` + `form_answers`) atende a Anamnese, a Consultoria de imagem e os Campos da ficha.
- **Fidelidade:** é um razão de pontos (`loyalty_entries`). Os pontos entram ao fechar a comanda, saem ao reabrir ou cancelar, e o resgate é um item da comanda.
- **Unir cadastros:** reaproveita o modelo do `mergeLidInto` e tem um teste que trava se aparecer tabela nova ligada a `contacts`.

**Tecnologia:** Next.js 16.4 (App Router, Server Actions), Drizzle 0.45 + Postgres 17, Vitest (+ jsdom/RTL nas telas), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-o-que-falta-design.md` (Fase C, itens 19–25), sobre a base `docs/superpowers/specs/2026-10-17-fluxo-novo-design.md`.

**Fontes dos detalhes:**
- `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18.md`, com as 9 etiquetas no §0.7, o cadastro de serviço no §13 e unir no item 14 do §16;
- `~/ClaudeGerado/casa-fiaes-gap-avec-2026-10-18-parte2.md`, com a fidelidade em A2 e §1 (0112/0113), a agenda e a recorrência no §3.1, as 32 e as 16 perguntas no §3.2 e as customizações no §7;
- `~/ClaudeGerado/casa-fiaes-dados-2026-10-17.md` §1;
- `~/ClaudeGerado/casa-fiaes-dados-correcoes/07_duplicados_lista_para_revisar.sql`.

## Global Constraints

- O texto da tela é em PT-BR. Siga "um nome para cada coisa":
  - **Marcador** é a etiqueta do horário, porque "Etiqueta" já é da cliente;
  - **Tipo do horário**: Pediu ela, Tanto faz, Indicação, Noiva e Primeira vez;
  - **Aviso**: o `alertNotes`, que já se chama "Avisos" na ficha;
  - **Uso de imagem**;
  - **Anamnese**, **Consultoria de imagem**, **Campos da ficha** e **Fotos de antes e depois**;
  - **Fidelidade**: o nome de cada programa é o da Casa ("Fiel da Fiaes", "10x Você", "Aniversário");
  - **Repetir**, **Passar o dia** e **Unir cadastros**.
- O desenho atual das telas fica. Use os componentes que já existem (`Sheet`, `Dialog`, `Menu`, `Field`, `Button`, chips, `Card` da ficha) e não crie estilo novo.
- **Uma pergunta por tela** nos fluxos de vários passos: preencher a anamnese, usar o prêmio da fidelidade, Passar o dia e Unir cadastros.
- **Resumo pequeno que abre o painel grande:** Consultoria e Fidelidade entram na aba Resumo como cartão pequeno, e o cartão abre a aba ou o painel.
- **Fotos reais, nunca de IA.** A foto vem só da câmera ou de um arquivo, sem filtro nem edição. O tipo é conferido pelos bytes (`sniffPhoto`). Nenhum código gera ou altera imagem.
- **Dado de cliente fora de exportação e fora da IA:** CPF, respostas das fichas e fotos não entram no CSV de Clientes, no Exportar conversa, no contexto da IA nem no Avec. Nesta fase isso vale sempre, inclusive com consentimento, porque o consentimento é da Fase B (item 13).
- **Migrations 0080 a 0089:**
  - `when` = `1792390000000 + n × 10000000` (0080 → 1792390000000, 0081 → 1792400000000 …);
  - só acrescentam, com `IF NOT EXISTS` e `ON CONFLICT DO NOTHING`, para poder rodar 2 vezes;
  - no journal, o `idx` é o próximo livre na hora do merge; `tag` e `when` são fixos.
- **Avec e CRM juntos:**
  - a importação nunca sobrescreve o que foi mexido no CRM;
  - as colunas novas, que são só do CRM (marcador, tipo, série), **não** marcam `crmTouchedAt`, para não travar o status vindo do Avec;
  - mudar a profissional (Passar o dia) marca `crmTouchedAt`.
- Dinheiro é em centavos e porcentagem em pontos-base (`bp`: 2000 = 20%), como já é no código.
- Server Action segue o padrão `assertPerm(...)` + `safe(e, ...)` devolvendo `ActionResult`, e a regra fica no domínio.
- Toda tabela nova entra na lista do `truncate` de `test/db.ts`.
- Antes de escrever página ou rota, leia o guia em `node_modules/next/dist/docs/` (veja `AGENTS.md`).
- Teste roda com `npm test -- <arquivo>` (precisa de `npm run infra:up`). Tipos com `npm run typecheck`.

## Review Focus

1. **Unir e depois importar o Avec de novo.** O Avec continua com os 2 cadastros. A cliente que saiu não pode voltar como contato novo, nem pelo próximo relatório nem por mensagem nova do número dela: os dois caem na que ficou (`contact_merges`). O teste fica na Tarefa 11.
2. **Passar o dia com "Pediu ela" e com horário do Avec.** O horário em que a cliente pediu a profissional só passa com o tique explícito. O horário vindo do Avec, depois de passado, não volta para a profissional antiga na próxima importação (`crmTouchedAt`). O teste fica na Tarefa 10.
3. **Repetir sobre dia ocupado ou bloqueado.** A repetição que não cabe (conflito, bloqueio, folga) fica de fora e aparece na lista "não couberam". Nunca vira encaixe sem ninguém pedir. O teste fica na Tarefa 9.
4. **Ponto contado 2 vezes ou dado com desconto alto.** Reabrir e fechar de novo não duplica o ponto. Cancelar a comanda tira o ponto. Desconto acima de 20% não pontua. Tirar o item do prêmio devolve os pontos. Os testes ficam na Tarefa 6.
5. **Ficha vazando.** A resposta da anamnese ou da consultoria e a foto de antes e depois não aparecem no CSV de Clientes, no Exportar conversa (nem com notas internas) nem no contexto da IA. O teste fica na Tarefa 4.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `drizzle/0080_marcador_tipo_horario.sql` | `appointment_labels` + as 9 da Casa; `appointments.label_id`, `appointments.visit_type` |
| `drizzle/0081_uso_de_imagem.sql` | `contacts.image_use`, `contacts.image_use_on`; cópia da etiqueta "Uso de imagem" |
| `drizzle/0082_fichas.sql` | `form_questions` (+ as 32 da anamnese), `form_answers`, `client_photos` |
| `drizzle/0083_fidelidade.sql` | `loyalty_programs` (+ os 3 da Casa), `loyalty_entries` |
| `drizzle/0084_servico_completo.sql` | `lists.parallel_ok/cost_cents/price_kind`; `professional_services.price_cents/duration_min` |
| `drizzle/0085_repetir.sql` | `appointment_series`, `appointments.series_id` |
| `drizzle/0086_unir_cadastros.sql` | `contact_merges` |
| `src/server/db/schema.ts` | as tabelas e colunas acima, cada bloco com o seu cabeçalho no fim do arquivo |
| `src/lib/visit-type.ts` | tipos do horário e rótulos |
| `src/server/domain/agenda/labels.ts` | marcadores: listar, criar, editar, pôr no horário; tipo do horário |
| `src/lib/client-alert.ts` · `src/components/contacts/client-alert-popup.tsx` | o aviso que salta (linhas e chave de "já vi") |
| `src/lib/fichas.ts` · `src/server/domain/fichas.ts` | motor das fichas: perguntas, validação e respostas |
| `src/server/domain/client-photos.ts` · `src/app/api/contatos/[id]/fotos/[photoId]/route.ts` | fotos de antes e depois |
| `src/components/contacts/ficha/consultoria.tsx` | aba Consultoria (anamnese em passos, consultorias por visita, fotos) |
| `src/app/(app)/config/fichas/page.tsx` (+ `actions.ts`) | Configurações › Fichas da cliente |
| `src/server/domain/avec/import-fichas.ts` | 0115/2115/0116 do Avec |
| `src/server/domain/fidelidade.ts` · `src/server/domain/avec/import-fidelidade.ts` | programas, pontos, resgate e saldos do 0113 |
| `src/components/servicos/loyalty-programs.tsx` · `src/components/contacts/ficha/loyalty.tsx` · `src/components/caixa/loyalty-banner.tsx` | telas da fidelidade |
| `src/server/domain/service-terms.ts` · `src/lib/service-price.ts` | preço e tempo por profissional; "a partir de" |
| `src/server/domain/agenda/recurrence.ts` | Repetir |
| `src/server/domain/agenda/transfer-day.ts` · `src/components/agenda/transfer-day-sheet.tsx` | Passar o dia |
| `src/server/domain/merge-contacts.ts` · `src/server/queries/duplicate-suspects.ts` | Unir cadastros e a lista de possíveis duplicadas |
| `src/app/(app)/contatos/[id]/unir/page.tsx` · `src/components/contacts/merge-flow.tsx` | a tela de unir |

## Ordem e paralelo

- **Trilha Agenda:** T1 → T8 → T9 → T10. As quatro mexem em `visits.ts` e no `BookingSheet`.
- **Trilha Ficha:** T2 → T3 → T4 → T5.
- **Trilha Fidelidade:** T6 → T7. T7 depende de T2, porque as duas mexem no `ComandaPanel`.
- **Trilha Unir:** T11 → T12, **por último**. Ela precisa das tabelas de T3, T6 e T9 para movê-las.
- **O que roda em paralelo:** as trilhas Agenda, Ficha e Fidelidade (T6), cada uma num worktree. O conflito previsível fica em `schema.ts`, `_journal.json` e `test/db.ts`. Cada tarefa acrescenta só o seu bloco, e o merge segue a ordem das migrations (0080 → 0086), mantendo todas as entradas.
- **T13**, a verificação final, vem depois de tudo.

---

### Task 1: Marcador e tipo do horário (item 19)

**Files:**
- Create: `drizzle/0080_marcador_tipo_horario.sql`, `src/lib/visit-type.ts`, `src/server/domain/agenda/labels.ts`, `src/server/domain/agenda/labels.test.ts`, `src/server/db/migration-0080.test.ts`
- Modify:
  - `src/server/db/schema.ts`: `appointmentLabels`, `appointments.labelId/visitType`;
  - `drizzle/meta/_journal.json`;
  - `test/db.ts`;
  - `src/server/domain/agenda/visits.ts`: `createVisitSchema` e insert;
  - `src/server/queries/agenda.ts`: `AgendaItem.label`, `AgendaItem.visitType`;
  - `src/components/agenda/booking-sheet.tsx`, `entry-sheet.tsx`, `day/day-grid.tsx`: o chip no cartão;
  - `src/app/(app)/agenda/actions.ts`;
  - `src/app/(app)/config/agenda/page.tsx`: a seção Marcadores do horário.
- Test: os dois `.test.ts` acima e `src/components/agenda/booking-sheet.test.tsx`.

**Interfaces:**
- Produces:
  - `VISIT_TYPES = ["indicacao", "noiva"] as const`, `type VisitType`, `VISIT_TYPE_LABEL: Record<VisitType, string>` = `{ indicacao: "Indicação", noiva: "Noiva" }`, `FIRST_VISIT_LABEL = "Primeira vez"` (em `src/lib/visit-type.ts`).
  - `type AppointmentLabel = { id: string; name: string; color: string | null; active: boolean; position: number }`.
  - `listAppointmentLabels(opts?: { all?: boolean }): Promise<AppointmentLabel[]>`.
  - `saveAppointmentLabel(input: { id?: string; name: string; color?: string | null; active?: boolean }, userId: string): Promise<{ id: string }>`.
  - `setAppointmentLabel(appointmentId: string, labelId: string | null, actor: Actor, now?: Date): Promise<void>`.
  - `setVisitType(appointmentId: string, type: VisitType | null, actor: Actor, now?: Date): Promise<void>`.
  - `createVisitSchema` ganha `labelId?: string | null` e `visitType?: VisitType | null`, gravados em todos os horários da visita.
  - `AgendaItem` ganha `label: { id: string; name: string; color: string | null } | null` e `visitType: VisitType | null`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// migration-0080.test.ts: rodar o SQL 2 vezes (padrão de migration-0059.test.ts)
it("traz os 9 marcadores da Casa, na ordem, sem duplicar na 2ª vez", async () => {
  await run(); await run();
  expect((await db.select().from(appointmentLabels).orderBy(appointmentLabels.position)).map((l) => l.name)).toEqual(
    ["Foi Atendida", "08H", "VER OBS", "Atrasada", "Não Cobrar", "revisão", "Representantes", "ON LINE", "CLIENTE DOENTE - VAI REMARCAR"]);
});
// labels.test.ts (setupAgenda, cliente, bahia, NOW)
it("marcador e tipo vão para todos os horários da visita", async () => { /* createVisit 2 itens com { labelId, visitType: "noiva" } → os 2 com labelId e visit_type "noiva" */ });
it("pôr marcador não marca crmTouchedAt (o status do Avec continua chegando)", async () => { /* horário origin "avec", crmTouchedAt null → setAppointmentLabel → crmTouchedAt null; audit "marcador_horario" */ });
it("marcador desativado é recusado; tipo fora da lista é recusado", async () => {
  await expect(setAppointmentLabel(id, inactiveId, recepcao, NOW)).rejects.toThrow("Esse marcador não está mais em uso.");
  await expect(setVisitType(id, "primeira_vez" as never, recepcao, NOW)).rejects.toThrow();
});
it("nome repetido (sem diferenciar maiúsculas) é recusado", async () => { /* saveAppointmentLabel({ name: "ver obs" }) → "Já existe o marcador VER OBS." */ });
```

```tsx
// booking-sheet.test.tsx: novo caso
it("Tipo e Marcador são opcionais e vão no pedido", async () => { /* clicar chip "Noiva" e "VER OBS" → createVisitAction chamado com visitType "noiva" e labelId do VER OBS */ });
```

- [ ] **Passo 2:** rodar `npm test -- src/server/domain/agenda/labels.test.ts src/server/db/migration-0080.test.ts src/components/agenda/booking-sheet.test.tsx`. Esperado: FAIL ("appointment_labels" não existe).
- [ ] **Passo 3:** escrever a migration `0080_marcador_tipo_horario.sql`:
  - `appointment_labels` (id, name, color, position, active, created_by, created_at), com `uniqueIndex lower(name)`;
  - INSERT das 9, com `position` 0 a 8 e cor nula;
  - `appointments.label_id uuid REFERENCES appointment_labels ON DELETE SET NULL`;
  - `appointments.visit_type text CHECK (visit_type IN ('indicacao','noiva'))`.

  Depois, o schema, a entrada `{ tag: "0080_marcador_tipo_horario", when: 1792390000000 }` no journal e a tabela no `test/db.ts`.
- [ ] **Passo 4:** implementar `labels.ts` e `visit-type.ts`, e gravar `labelId`/`visitType` em `createVisitTx`. Em `getAgenda`, juntar `appointment_labels` (left join). "Primeira vez" **não é gravado**: a tela usa `AgendaItem.firstVisit`, que já existe.
- [ ] **Passo 5: telas**
  - **BookingSheet:** uma linha "Tipo" (Indicação, Noiva) e uma "Marcador" (chips com os ativos), as duas opcionais.
  - **EntrySheet:** mostra e troca as duas. No cartão da grade entra o chip do marcador, com a cor dele, ao lado do `PreferenceTag`, e "Primeira vez" quando `firstVisit`.
  - **Configurações › Agenda:** a seção "Marcadores do horário" (nome, cor da paleta, ativo e novo), com `config.diaadia`.
- [ ] **Passo 6:** rodar os testes do passo 2 e `npm run typecheck`. Esperado: PASS.
- [ ] **Passo 7:** commit `feat(agenda): marcador e tipo do horário (0080)`.

---

### Task 2: Aviso que salta e uso de imagem (item 20)

**Files:**
- Create: `drizzle/0081_uso_de_imagem.sql`, `src/lib/client-alert.ts`, `src/lib/client-alert.test.ts`, `src/components/contacts/client-alert-popup.tsx`, `src/components/contacts/client-alert-popup.test.tsx`, `src/server/db/migration-0081.test.ts`
- Modify:
  - `schema.ts`, `_journal.json`;
  - `src/server/domain/contact-profile.ts`: `imageUse`, `imageUseOn`;
  - `src/server/domain/avec/context.ts`: `tagImageUse` passa a gravar o campo;
  - `src/server/queries/agenda.ts`: `AgendaItem.alertNotes`, `AgendaItem.imageUse`;
  - `src/server/queries/caixa.ts`: `ComandaDetail.alertNotes`, `ComandaDetail.imageUse`;
  - `src/components/agenda/entry-sheet.tsx`, `src/components/caixa/comanda-panel.tsx`;
  - `src/components/contacts/ficha/header.tsx` (`FichaData`) e `more-menu.tsx` (Editar dados).
- Test: os arquivos acima, `src/server/domain/contact-profile.test.ts` e `src/server/domain/avec/apply.test.ts` (um caso novo).

**Interfaces:**
- Produces:
  - `type ImageUse = "sim" | "nao"`. As colunas são `contacts.image_use text CHECK IN ('sim','nao')` e `contacts.image_use_on date`, e null quer dizer "não informado".
  - `contactProfileSchema` ganha `imageUse: z.enum(["sim","nao"]).nullable()` e `imageUseOn: data "AAAA-MM-DD" | null`. Ao marcar "sim" sem data, grava hoje (Salvador).
  - `popupLines(o: { alertNotes: string | null; imageUse: ImageUse | null }): string[]` devolve as linhas do aviso e, se `imageUse === "nao"`, mais "Não autorizou uso de imagem".
  - `alertAckKey(o: { contactId: string; scope: string; lines: string[] }): string`. O `scope` é o `visitId` ou o id da comanda, e um texto novo dá uma chave nova.
  - `<ClientAlertPopup contactId scope alertNotes imageUse />`: abre um `Dialog` "Aviso da cliente" se houver linhas e a chave não estiver no `sessionStorage`. "Entendi" guarda a chave.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// migration-0081.test.ts
it("quem tem a etiqueta Uso de imagem passa a ter image_use = 'sim' (data vazia); quem não tem fica null", ...);
// client-alert.test.ts
it("linhas do aviso + 'Não autorizou uso de imagem'; vazio → []", () => {
  expect(popupLines({ alertNotes: "Alérgica a amônia\n\n Não cobrar café ", imageUse: "nao" }))
    .toEqual(["Alérgica a amônia", "Não cobrar café", "Não autorizou uso de imagem"]);
  expect(popupLines({ alertNotes: null, imageUse: "sim" })).toEqual([]);
});
it("texto novo muda a chave", () => { expect(alertAckKey({ contactId: "c", scope: "v", lines: ["a"] })).not.toBe(alertAckKey({ contactId: "c", scope: "v", lines: ["b"] })); });
// client-alert-popup.test.tsx
it("salta uma vez por visita: depois do Entendi, abrir de novo não salta", ...);
// contact-profile.test.ts
it("Uso de imagem 'sim' sem data grava hoje; 'nao' apaga a data", ...);
// apply.test.ts
it("nome '(T. USO DE IMAGEM)' do Avec vira image_use 'sim' e não cria a etiqueta", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** escrever a migration 0081 (`when` 1792400000000). Ela acrescenta as 2 colunas e faz um UPDATE pela etiqueta `lower(name) = 'uso de imagem'`, **sem apagar a etiqueta** (decisão do dono, ver o fim). Acertar o schema, o journal e a validação no `contact-profile.ts`. `tagImageUse` passa a fazer `update contacts set image_use = 'sim' where id = $1 and image_use is null`.
- [ ] **Passo 4:** implementar `client-alert.ts` e o popup. Na `EntrySheet`, o popup aparece ao abrir o horário de uma cliente. No `ComandaBody`, ao abrir a comanda. A ficha (`FichaData`) mostra "Uso de imagem: Sim, desde 12/03/2026 · Não · Não informado". O "Editar dados" ganha um select e uma data.
- [ ] **Passo 5:** rodar os testes e o `typecheck`. Esperado: PASS.
- [ ] **Passo 6:** commit `feat(ficha): aviso que salta e uso de imagem (0081)`.

---

### Task 3: Motor das fichas: Anamnese, Consultoria de imagem e Campos da ficha (itens 21 e 25b)

**Files:**
- Create:
  - `drizzle/0082_fichas.sql`;
  - `src/lib/fichas.ts`, `src/lib/fichas.test.ts`;
  - `src/server/domain/fichas.ts`, `src/server/domain/fichas.test.ts`;
  - `src/server/db/migration-0082.test.ts`;
  - `src/app/(app)/config/fichas/page.tsx` e `actions.ts`, `src/components/config/fichas-editor.tsx`.
- Modify:
  - `schema.ts`, `_journal.json`, `test/db.ts`;
  - `src/lib/config-tabs.ts`: um grupo novo `clientes`, "Clientes", com a frase "O que a Casa pergunta e anota de cada cliente." e o item "Fichas da cliente".

**Interfaces:**
- Produces:
  - `FICHA_FORMS = ["anamnese", "consultoria", "campos"] as const` e `type FichaForm`.
  - `FICHA_FORM_LABEL` = `{ anamnese: "Anamnese", consultoria: "Consultoria de imagem", campos: "Campos da ficha" }`.
  - `QUESTION_KINDS = ["opcao", "caixas", "texto", "texto_longo", "sim_nao", "data"] as const`, com os rótulos "Uma opção", "Várias opções", "Texto curto", "Texto longo", "Sim ou não" e "Data".
  - `type AnswerValue = string | string[]`.
  - `validateAnswer(kind: QuestionKind, options: string[], raw: unknown): AnswerValue | null` devolve null para vazio, que apaga a resposta, e lança `UserFacingError` para valor fora da lista. Os limites: `texto` até 500, `texto_longo` até 4000, `sim_nao` só "sim" ou "nao", `data` no formato AAAA-MM-DD.
  - Tabelas:
    - `form_questions` (id, form, position, label, kind, options text[], active, avec_slug, created_by, created_at);
    - `form_answers` (id, contact_id, question_id, visit_id null, value jsonb, source 'crm'|'avec', answered_by, answered_at, external_key único null), com `UNIQUE (contact_id, question_id, visit_id) NULLS NOT DISTINCT`;
    - `client_photos` (id, contact_id, visit_id null, kind 'antes'|'depois', media_path, media_mime, created_by, created_at, deleted_at, deleted_by), que a T4 usa.
  - `type FormQuestion = { id; form: FichaForm; position; label; kind: QuestionKind; options: string[]; active }`.
  - `listQuestions(form: FichaForm, opts?: { all?: boolean }): Promise<FormQuestion[]>`.
  - `saveQuestion(input: { id?: string; form: FichaForm; label: string; kind: QuestionKind; options?: string[] }, userId): Promise<{ id: string }>`, `moveQuestion(id, dir: "up" | "down", userId)` e `setQuestionActive(id, active, userId)`. Não existe apagar: a resposta antiga fica.
  - `saveAnswer(input: { contactId: string; questionId: string; visitId?: string | null; value: unknown }, userId): Promise<void>`. A consultoria exige `visitId`; a anamnese e os campos recusam `visitId`.
  - `type FichaQA = { questionId; label; kind; options; value: AnswerValue | null; answeredAt: string | null }`.
  - `fichaOf(contactId): Promise<{ anamnese: FichaQA[]; consultorias: { visitId: string; day: string; items: FichaQA[] }[]; campos: FichaQA[] }>`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// migration-0082.test.ts
it("traz as 32 perguntas da anamnese da Casa, na ordem, com tipo e opções; a consultoria nasce vazia", async () => {
  await run(); await run();
  const q = await db.select().from(formQuestions).where(eq(formQuestions.form, "anamnese")).orderBy(formQuestions.position);
  expect(q).toHaveLength(32);
  expect(q[0]).toMatchObject({ label: "Como conheceu a Casa Fiaes?", kind: "opcao", options: ["Indicação", "Instagram", "Evento", "Cliente antiga", "Outro"] });
  expect(q[31]).toMatchObject({ kind: "sim_nao" });
  expect(await db.select().from(formQuestions).where(eq(formQuestions.form, "consultoria"))).toHaveLength(0);
});
// fichas.test.ts
it("caixas aceita só opções da pergunta; vazio apaga a resposta", ...);
it("consultoria sem visita é recusada; anamnese com visita é recusada", ...);
it("responder de novo troca a resposta (uma por cliente e pergunta; na consultoria, uma por visita)", ...);
it("pergunta desativada some do preencher, mas a resposta antiga aparece na ficha", ...);
it("fichaOf agrupa as consultorias por visita, a mais nova primeiro", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** escrever a migration 0082 (`when` 1792410000000) com as 3 tabelas e o INSERT das 32 perguntas.
  - **Textos, tipos e opções:** copiar do §3.2 da parte 2, nesta ordem e sem mudar uma palavra.
  - **Tipos:** "seleção" e "uma das opções" viram `opcao`, "caixas" vira `caixas`, "texto" vira `texto`, "texto longo" vira `texto_longo` e a nº 32 vira `sim_nao`.
  - **Rótulos das perguntas 9 a 13:** como a parte 2 só dá o nome do campo, o rótulo é "Estrutura do fio", "Textura natural" etc.
  - **As 16 da consultoria não entram aqui.** A parte 2 só traz um resumo delas, e o texto exato chega pela importação do 0116 (T5).
- [ ] **Passo 4:** implementar `lib/fichas.ts` e `domain/fichas.ts`, com auditoria `ficha_respondida` (só o id da pergunta, nunca o valor) e `ficha_pergunta_editada`.
- [ ] **Passo 5:** fazer a tela Configurações › Fichas da cliente (`?ficha=anamnese|consultoria|campos`). Ela lista as perguntas, tem subir e descer, editar (rótulo, tipo e opções, uma por linha), desativar e "Nova pergunta". A permissão é `config.diaadia`.
- [ ] **Passo 6:** rodar os testes e o `typecheck`. Esperado: PASS.
- [ ] **Passo 7:** commit `feat(fichas): anamnese, consultoria de imagem e campos da ficha (0082)`.

---

### Task 4: Aba Consultoria na ficha, fotos de antes e depois e a trava de privacidade (itens 21 e 25b)

**Files:**
- Create:
  - `src/components/contacts/ficha/consultoria.tsx` e `consultoria.test.tsx`;
  - `src/server/domain/client-photos.ts` e `client-photos.test.ts`;
  - `src/app/api/contatos/[id]/fotos/[photoId]/route.ts`;
  - `src/server/privacy-fichas.test.ts`.
- Modify:
  - `src/lib/ficha.ts`: `FichaTab` ganha `"consultoria"`, com o rótulo "Consultoria" depois de "Pacotes";
  - `src/app/(app)/contatos/[id]/page.tsx`;
  - `src/components/contacts/ficha/blocks.tsx`: o cartão pequeno "Consultoria" no `SummaryGrid`;
  - `header.tsx` (`FichaData`): os Campos da ficha;
  - `more-menu.tsx` (Editar dados): os Campos da ficha;
  - `src/app/(app)/contatos/actions.ts`.

**Interfaces:**
- Consumes: `fichaOf`, `saveAnswer`, `listQuestions` (T3), `client_photos` (T3) e `sniffPhoto`, `PHOTO_EXT` e `mediaDir`.
- Produces:
  - `addClientPhoto(input: { contactId: string; visitId?: string | null; kind: "antes" | "depois"; data: Buffer }, userId: string): Promise<{ id: string }>`. Aceita até 5 MB, confere o tipo pelos bytes e grava em `MEDIA_DIR/galeria/<id>.<ext>`.
  - `removeClientPhoto(id: string, userId: string): Promise<void>`, que só marca `deleted_at`.
  - `listClientPhotos(contactId: string): Promise<{ id; visitId; day: string | null; kind; url: string }[]>`.
  - A rota GET `/api/contatos/[id]/fotos/[photoId]` pede sessão e `contatos.ver`, e responde com `Cache-Control: private, no-store`.
  - Actions: `saveFichaAnswerAction`, `addClientPhotoAction(FormData)` e `removeClientPhotoAction`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// privacy-fichas.test.ts: o marcador "SEGREDO-FICHA-7" nas respostas de anamnese, consultoria e campos, e uma foto
it("CSV de Clientes não traz resposta nem foto", async () => { expect(contactsCsv(await exportContactRows({}, true), { money: true })).not.toContain("SEGREDO-FICHA-7"); });
it("Exportar conversa (com notas internas) não traz", async () => { /* exportConversationText(id, user, { notes: true }) → sem o marcador */ });
it("contexto da IA não traz", async () => { /* JSON.stringify(await loadClienteContext(id, NOW)) e de clientContext(id, dealId, { money: true }) → sem o marcador nem "galeria/" */ });
// client-photos.test.ts
it("recusa o que não é foto pelos bytes e passa de 5 MB", ...);
it("apagar só marca deleted_at e some da lista", ...);
```

```tsx
// consultoria.test.tsx
it("Preencher anamnese mostra UMA pergunta por tela, salva ao avançar e mostra 'x de 32'", ...);
it("consultorias por visita navegam com ‹ ›, como no Avec", ...);
it("cartão do Resumo 'Consultoria' abre a aba", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL nos novos. O de privacidade já pode passar no CSV e na IA; ele é a trava contra regressão.
- [ ] **Passo 3:** implementar `client-photos.ts` e a rota, no mesmo modelo de `src/app/api/notas/[id]/foto/route.ts`.
- [ ] **Passo 4: implementar a aba Consultoria**
  - **Anamnese:** o resumo "18 de 32 respondidas" e o botão "Preencher" ou "Continuar". O botão abre um `Dialog` em passos: uma pergunta, o campo, e Anterior, Pular e Próxima.
  - **Consultoria de imagem por visita:** ‹ ›, "Ver a última" e "Nova", que usa a visita de hoje ou a última.
  - **Fotos de antes e depois:** agrupadas por visita. O "Adicionar foto" usa `<input type="file" accept="image/*" capture="environment">`, sem recorte nem filtro.
  - **Campos da ficha:** linhas em `FichaData` e no Editar dados.
- [ ] **Passo 5:** rodar os testes, o `typecheck` e `npm run e2e -- e2e/ficha.spec.ts`. Esperado: PASS.
- [ ] **Passo 6:** commit `feat(ficha): aba Consultoria com anamnese em passos e fotos de antes e depois`.

---

### Task 5: Trazer as fichas do Avec (0115, 2115 e 0116)

**Files:**
- Create: `src/server/domain/avec/import-fichas.ts`, `import-fichas.test.ts`
- Modify:
  - `src/server/domain/avec/formats.ts`: o papel `"fichas"`;
  - `apply.ts`: em `IMPORTERS`, e com `batchOrder` = 3;
  - `context.ts`: `AvecSummary.fichas`, e `reject.reason` aceita `"cliente_nao_encontrada"`.
- Test: `formats.test.ts` (um caso).

**Interfaces:**
- Consumes: `ImportCtx.contactOf`, `visitForDayTx(tx, ref, day, null, now, "avec")`, `form_questions`/`form_answers` (T3).
- Produces:
  - `rolesOf` dá `"fichas"` quando `has("campo", "slug", "valor")` e há coluna de cliente.
  - Com a coluna `comanda`, a resposta vai para a consultoria da visita do dia. Sem ela, vai para a anamnese.
  - `importFichas(ctx: ImportCtx): Promise<void>`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("0115: resposta casa com a pergunta pelo rótulo normalizado e grava source 'avec'", ...);
it("0116: pergunta que não existe é criada na consultoria (rótulo exato do Campo, avec_slug = Slug), na ordem em que aparece", ...);
it("valor vazio não grava; cliente com nome ambíguo vai para avec_rejected_rows 'cliente_nao_encontrada'", ...);
it("importar de novo não duplica e NÃO sobrescreve resposta dada no CRM", async () => { /* saveAnswer CRM → reimport → valor do CRM fica */ });
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - A chave é `avec:ficha:<contato>:<pergunta>:<dia|->`, com `ON CONFLICT (external_key) DO UPDATE ... WHERE form_answers.source = 'avec'`.
  - O valor entra como texto, como veio. A validação por tipo é só para o que se digita no CRM.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(avec): importa anamnese e consultoria de imagem (0115/2115/0116)`.

---

### Task 6: Fidelidade: programas, pontos, estorno e resgate (item 22)

**Files:**
- Create: `drizzle/0083_fidelidade.sql`, `src/server/domain/fidelidade.ts`, `src/server/domain/fidelidade.test.ts`, `src/server/db/migration-0083.test.ts`
- Modify:
  - `schema.ts`, `_journal.json`, `test/db.ts`;
  - `src/server/domain/caixa/comandas.ts`:
    - exportar `addItemTx`;
    - `AddItemInput.ruleDiscount?: "fidelidade"`, que não pede aprovação;
    - os ganchos em `closeComanda`, `reopenComanda`, `reopenForCorrection`, `cancelComanda` e `removeItem`.

**Interfaces:**
- Produces:
  - **Tabelas:**
    - `loyalty_programs` (id, name único, description, kind 'contagem'|'aniversario', goal smallint, counts_service_ids uuid[] null, reward_service_ids uuid[], reward_discount_bp int default 10000, max_discount_bp int null, active, position, created_at). Em `counts_service_ids`, null quer dizer todos os serviços.
    - `loyalty_entries` (id, contact_id, program_id, delta int ≠ 0, reason 'servico'|'resgate'|'saldo_avec'|'ajuste', comanda_id null, comanda_item_id null, note, created_by, created_at, external_key único null), com `UNIQUE (program_id, comanda_item_id, reason) WHERE comanda_item_id IS NOT NULL`.
  - `type LoyaltyStatus = { programId: string; name: string; kind: "contagem" | "aniversario"; goal: number | null; balance: number; ready: boolean; rewardServiceIds: string[] }`. No aniversário, `ready` quer dizer que é o mês do aniversário e o prêmio não foi usado no ano.
  - `loyaltyOf(contactId: string, now: Date): Promise<LoyaltyStatus[]>`.
  - `accrueLoyaltyTx(tx, comandaId: string, actorId: string, now: Date): Promise<number>`. O item pontua se for `servico`, não for prêmio, a comanda tiver cliente, o programa for `contagem` e ativo, o serviço contar, e `discountCents / (unitCents × qty)` for ≤ `max_discount_bp`. Cada item vale `qty` pontos.
  - `reverseLoyaltyTx(tx, comandaId: string): Promise<void>` apaga as linhas 'servico' e 'resgate' da comanda e audita `fidelidade_estornada`.
  - `redeemLoyalty(comandaId: string, programId: string, target: { serviceId: string; professionalId: string } | { itemId: string }, actor: Actor, now?: Date): Promise<{ itemId: string }>`. Na `contagem`, acrescenta o item do prêmio com o desconto de `reward_discount_bp`, o motivo "Fidelidade: <programa>" e a linha −goal. No `aniversario`, aplica o desconto no item escolhido e grava uma linha `resgate` com `delta` −1, que marca o ano.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// fidelidade.test.ts (setupCaixa)
it("fechar comanda dá 1 ponto por serviço que conta; reabrir e fechar de novo não duplica", ...);
it("cancelar a comanda tira os pontos", ...);
it("desconto acima de 20% não pontua (max_discount_bp 2000); 20% pontua", ...);
it("com 12 pontos, usar o prêmio põe o item com 100% de desconto e motivo 'Fidelidade: Fiel da Fiaes' sem pedir aprovação, e o saldo vai a 0", ...);
it("tirar o item do prêmio devolve os 12 pontos", ...);
it("sem saldo: 'Faltam 3 serviços para o prêmio.'", ...);
it("Aniversário: só no mês do aniversário, uma vez por ano, 50% no item escolhido", ...);
it("o item do prêmio não pontua", ...);
// migration-0083.test.ts
it("traz os 3 programas da Casa, sem duplicar", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3: escrever a migration 0083** (`when` 1792420000000), com os 3 programas:
  - **"Fiel da Fiaes":** `contagem`, goal 12, conta todos os serviços, `max_discount_bp` 2000. O prêmio é o conjunto dos serviços com `category ILIKE 'finaliza%'`, pego no INSERT.
  - **"10x Você":** `contagem`, goal 10, `max_discount_bp` 2000. Conta e premia os serviços com `label ~* '^corte'`. A descrição é "Acompanhe pelo nosso sistema".
  - **"Aniversário":** `aniversario`, `reward_discount_bp` 5000, e o prêmio são os serviços com `label ~* 'ritual de tratamento'`.

  Esses filtros são sugestão, e a gestão confere na T7. Ver as decisões do dono.
- [ ] **Passo 4:** implementar `fidelidade.ts` e os ganchos, todos dentro da transação que já existe em cada função de `comandas.ts`.
- [ ] **Passo 5:** rodar os testes e toda a pasta `src/server/domain/caixa`. Esperado: PASS, sem regressão no caixa.
- [ ] **Passo 6:** commit `feat(fidelidade): pontos ao fechar comanda, estorno e resgate (0083)`.

---

### Task 7: Fidelidade nas telas e os saldos do Avec (relatório 0113)

**Files:**
- Create:
  - `src/components/servicos/loyalty-programs.tsx` e `.test.tsx`;
  - `src/components/contacts/ficha/loyalty.tsx`;
  - `src/components/caixa/loyalty-banner.tsx` e `.test.tsx`;
  - `src/server/domain/avec/import-fidelidade.ts` e `.test.ts`.
- Modify:
  - `src/app/(app)/servicos/page.tsx` e `services-page.tsx`: a aba `?aba=fidelidade`;
  - `src/components/caixa/comanda-panel.tsx`;
  - `blocks.tsx` (`SummaryGrid`);
  - `formats.ts`: o papel `"fidelidade"`;
  - `apply.ts`.

**Interfaces:**
- Consumes: `loyaltyOf`, `redeemLoyalty` (T6).
- Produces:
  - `rolesOf` dá `"fidelidade"` quando `has("pontos gerados", "saldo atual")`.
  - `importLoyaltyBalances(ctx)`: para cada contato achado pelo telefone com `Saldo Atual` > 0, faz um upsert de `loyalty_entries` com a chave `avec:fid:<contato>`, `reason 'saldo_avec'` e `delta` = saldo. Uma importação nova **troca** o valor, não soma. O programa de destino vem do setting `fidelidade_programa_avec`, e o padrão é o id de "Fiel da Fiaes".
  - `saveLoyaltyProgram(input, userId)`, com a permissão `servicos.editar`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("0113: saldo 23 vira 23 pontos de Fiel da Fiaes; importar de novo com 25 deixa 25 (não 48)", ...);
it("saldo 0 ou cliente sem telefone conhecido não grava", ...);
```

```tsx
it("comanda com saldo completo mostra 'Fiel da Fiaes: 12 de 12 · Usar o prêmio'; o resgate pergunta UMA coisa por tela (serviço → profissional → confirmar)", ...);
it("Serviços › Fidelidade: editar quais serviços contam e quais são prêmio", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3: implementar as telas**
  - **Resumo da ficha:** um cartão pequeno ("Fiel da Fiaes 9 de 12") que abre um `Sheet` com todos os programas e o histórico de pontos.
  - **Comanda:** o banner `LoyaltyBanner`.
  - **Serviços › Fidelidade:** os cartões dos programas. A recepção só consulta.
  - **Importação:** o importador do 0113.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(fidelidade): telas e saldos do Avec (0113)`.

> Como trazer os saldos: no Avec, abrir o relatório **0113 "Pontos de fidelidade acumulados por cliente"**, pôr o período de 01/01/2020 até hoje, exportar em Excel e importar em Configurações › Avec. O 0113 traz Cliente, Celular, E-mail, Última Pontuação, Pontos Gerados e Saldo Atual. Como o saldo é igual ao gerado, porque ninguém nunca resgatou, isso cobre as 2.294 clientes. O 0112 (Premiações) está vazio e não precisa.

---

### Task 8: Serviço completo (item 24)

**Files:**
- Create: `drizzle/0084_servico_completo.sql`, `src/server/domain/service-terms.ts`, `service-terms.test.ts`, `src/lib/service-price.ts`, `service-price.test.ts`
- Modify:
  - `schema.ts`, `_journal.json`;
  - `src/server/domain/service-details.ts`: `costCents`, `priceKind`, `parallelOk`;
  - `src/server/domain/professionals.ts`: `setProfessionalServiceTerms`;
  - `src/lib/free-slots.ts` e `src/server/domain/agenda/availability.ts`: `parallelOk`;
  - `src/server/domain/agenda/visits.ts` (`planItems`, `pickAnyPro`) e `src/server/domain/caixa/comandas.ts` (`buildItemTx`);
  - `src/components/servicos/service-sheet.tsx`;
  - `src/app/agendar/page.tsx` e o preço que a IA cita (`src/server/ai/pricing.ts`/`prompt.ts`), com `priceText`.

**Interfaces:**
- Produces:
  - **Colunas:**
    - `lists.cost_cents int null CHECK ≥ 0`;
    - `lists.price_kind text null CHECK IN ('fixo','a_partir_de','sob_consulta')`, em que null quer dizer fixo;
    - `lists.parallel_ok boolean null`, em que null quer dizer "não informado" e o comportamento fica como hoje;
    - `professional_services.price_cents int null` e `professional_services.duration_min smallint null CHECK 5..720`.
  - `type PriceKind`.
  - `priceText(priceCents: number | null, kind: PriceKind | null): string | null` devolve "R$ 150,00", "a partir de R$ 150,00", "sob consulta" ou null.
  - `serviceTermsFor(q: Tx | Db, serviceId: string, professionalId: string | null): Promise<{ priceCents: number | null; durationMin: number | null; bufferMin: number | null; priceKind: PriceKind | null }>`, em que vale o da profissional e, sem ele, o do serviço.
  - `setProfessionalServiceTerms(professionalId, serviceId, patch: { priceCents?: number | null; durationMin?: number | null }, userId): Promise<void>`.
  - `SlotQuery.parallelOk?: boolean | null` e `BusyItem.parallelOk?: boolean`. O conflito da mesma cliente com outra profissional **não conta** quando os dois lados são `true`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("Ana com preço e tempo próprios: marcar com Ana usa 150 min e R$ 300 no horário; com Bia, o do serviço", ...);
it("'Qualquer uma' confere cada candidata com o tempo dela", ...);
it("comanda: item de serviço com a Ana parte do preço dela (mudar dele pede motivo)", ...);
it("dois serviços com parallel_ok true para a mesma cliente em profissionais diferentes: sem encaixe", ...);
it("'Ao mesmo tempo' com um serviço parallel_ok false: 'Escova não pode ser feita ao mesmo tempo que outro serviço.'", ...);
it("parallel_ok null: como hoje (conflito de cliente vira encaixe)", ...);
it("priceText", () => { expect(priceText(15000, "a_partir_de")).toBe("a partir de R$ 150,00"); expect(priceText(null, "sob_consulta")).toBe("sob consulta"); });
it("custo do serviço nunca vai para a IA nem para /agendar", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** escrever a migration 0084 (`when` 1792430000000) e implementar.
  - A "Folga depois" (`bufferMin`) **já existe**: é o "tempo livre depois" da spec, e só se confere que aparece na ficha do serviço.
  - O custo aparece só para quem tem `valores.ver`.
- [ ] **Passo 4: ficha do serviço**
  - "Custo (R$)";
  - "Preço": Fixo, A partir de ou Sob consulta;
  - "Pode ser feito junto com outro": Sim, Não ou Não informado;
  - em "Quem faz", cada profissional com "Preço próprio" e "Tempo próprio", os dois opcionais.
- [ ] **Passo 5:** rodar os testes, as pastas `agenda` e `caixa` e o `typecheck`. Esperado: PASS.
- [ ] **Passo 6:** commit `feat(servicos): custo, preço a partir de, junto com outro, preço e tempo por profissional (0084)`.

---

### Task 9: Repetir o horário (item 23a)

**Files:**
- Create: `drizzle/0085_repetir.sql`, `src/server/domain/agenda/recurrence.ts`, `recurrence.test.ts`
- Modify:
  - `schema.ts`, `_journal.json`, `test/db.ts`;
  - `visits.ts`: `cancelSchema.scope` ganha `"serie"`;
  - `src/server/queries/agenda.ts`: `AgendaItem.series`;
  - `booking-sheet.tsx`, `cancel-sheet.tsx`, `entry-sheet.tsx`;
  - `src/app/(app)/agenda/actions.ts`.

**Interfaces:**
- Consumes: `createVisitTx` e `CreateVisitInput` (T1 e T8).
- Produces:
  - `appointment_series` (id, every_weeks smallint 1..12, times smallint 2..26, request_key uuid único, created_by, created_at) e `appointments.series_id uuid null` (com índice).
  - `createRecurringVisits(raw: CreateVisitInput & { repeat: { everyWeeks: number; times: number } }, actor: Actor, now?: Date): Promise<{ seriesId: string; created: { day: string; visitId: string }[]; skipped: { day: string; reason: string }[] }>`. Cada repetição roda num savepoint (`tx.transaction`). A primeira falhando derruba tudo, com o erro dela. As seguintes que falham entram em `skipped` com o texto do motor, e só a primeira pode usar `fitIn`. O `requestKey` de cada repetição é `derivedUuid(seriesRequestKey, k)`, um hash SHA-256 em formato uuid.
  - `AgendaItem.series: { index: number; total: number } | null`.
  - `cancelAppointments` com `scope: "serie"` cancela este horário e os próximos ainda ativos da série.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("a cada 2 semanas, 4 vezes: 4 visitas, mesma hora e profissional, com series_id", ...);
it("a 3ª cai num bloqueio: 3 criadas, skipped [{ day: '2026-11-12', reason: /bloque/ }], nenhuma com fitIn", ...);
it("mandar o mesmo pedido de novo não duplica (request_key da série)", ...);
it("cancelar 'este e os próximos' na 2ª cancela 2, 3 e 4 e deixa a 1ª", ...);
it("limites: everyWeeks 0 ou 13 e times 1 ou 27 são recusados", ...);
it("modo consulta recusa (assertCanBook)", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** escrever a migration 0085 (`when` 1792440000000) e implementar.
  - **BookingSheet:** a chave "Repetir" abre "A cada [1–12] semanas" e "[2–26] vezes". O resultado aparece como "8 marcados. 2 não couberam: 12/11 (Ana ocupada) …".
  - **EntrySheet:** "Repete: 3 de 8".
  - **CancelSheet:** a pergunta "Só este / Este e os próximos" aparece só quando o horário tem série.
- [ ] **Passo 4:** rodar os testes e toda a pasta `agenda`. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(agenda): repetir a cada X semanas (0085)`.

---

### Task 10: Passar o dia de uma profissional para outra (item 23b)

**Files:**
- Create: `src/server/domain/agenda/transfer-day.ts`, `transfer-day.test.ts`, `src/components/agenda/transfer-day-sheet.tsx`, `transfer-day-sheet.test.tsx`
- Modify: `src/components/agenda/day/shell.tsx` (a ação "Passar o dia de uma profissional" em "Mais ações da agenda", com `agenda.marcar`), `src/app/(app)/agenda/actions.ts`

**Interfaces:**
- Consumes: `lockAgendaTx`, `checkSlotTx`, `assertProfessionalFor`, `queueProNotificationsTx({ kind: "remarcado", before, after })`, `afterAgendaChange` e `serviceTermsFor` (T8, para a duração da profissional nova).
- Produces:
  - `type TransferRow = { appointmentId: string; hm: string; clientName: string; serviceLabel: string }`.
  - `previewTransferDay(i: { fromProfessionalId: string; toProfessionalId: string; day: string }, now?: Date): Promise<{ movable: TransferRow[]; askedForHer: TransferRow[]; blocked: (TransferRow & { reason: string })[] }>`.
  - `transferDay(i: { fromProfessionalId; toProfessionalId; day; appointmentIds: string[]; confirmAskedForHer: boolean }, actor: Actor, now?: Date): Promise<{ moved: number; skipped: { appointmentId: string; reason: string }[] }>`. Só mexe em agendado, confirmado e solicitado, e nunca em gêmeo do Avec. Mantém o status e a confirmação, troca `professionalId`, marca `crmTouchedAt` e `anyPro=false`, e audita `agendamento_passado` (de, para). Não manda mensagem para a cliente: o lembrete D-1 já sai com o nome de quem atende.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("passa os horários livres da Ana para a Bia, mantendo hora e 'Confirmado'", ...);
it("'Pediu ela' fica em askedForHer e só passa com confirmAskedForHer", ...);
it("Bia ocupada ou sem fazer o serviço: fica em blocked com o motivo; nada vira encaixe", ...);
it("horário do Avec passado não volta para a Ana ao reimportar o 0051", async () => { /* transferDay → applyAvecFile(0051 com a mesma reserva) → professionalId continua Bia */ });
it("a Bia recebe o aviso no app (pro_notifications) e a Ana o de saída", ...);
```

```tsx
it("um passo por tela: De quem? → Para quem? → lista com caixas ('Ela pediu a Ana' desmarcado) → Passar", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar o domínio e o `TransferDaySheet`, que usa `Sheet` e passos.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(agenda): passar o dia de uma profissional para outra`.

---

### Task 11: Unir cadastros: o domínio (item 25a)

**Files:**
- Create: `drizzle/0086_unir_cadastros.sql`, `src/server/domain/merge-contacts.ts`, `merge-contacts.test.ts`, `merge-contacts-coverage.test.ts`
- Modify:
  - `schema.ts`, `_journal.json`, `test/db.ts`;
  - `src/server/domain/deals.ts` (`resolveContact`);
  - `src/server/domain/avec/context.ts` (`contactOf`);
  - `src/lib/permissions.ts`: `"contatos.unir"`, com o rótulo "Unir cadastros duplicados", obrigatória na Gestão e em `ONE_TIME_GRANTS` para a Recepção.

**Interfaces:**
- Produces:
  - `contact_merges` (id, kept_id uuid → contacts ON DELETE CASCADE, dropped_id uuid, dropped_phone text, dropped_wa_lid text, dropped_name text, snapshot jsonb, merged_by, merged_at), com índice em `dropped_phone`.
  - `MERGE_HANDLED_FKS: readonly string[]`: cada `"tabela.coluna"` que aponta para `contacts.id`.
  - `type MergePreview = { keep: {...}; drop: {...}; moving: Record<"conversas" | "mensagens" | "horarios" | "comandas" | "vendas" | "pacotes" | "pontos" | "fichas" | "fotos" | "notas", number>; blockers: string[] }`.
  - `previewMerge(keepId: string, dropId: string): Promise<MergePreview>`.
  - `mergeContacts(i: { keepId: string; dropId: string }, userId: string, now?: Date): Promise<{ moved: MergePreview["moving"] }>`.
  - `mergedTargetFor(q: Tx | Db, phone: string): Promise<string | null>`.
- **Regras de `mergeContacts`**, numa transação só:
  - **O que impede:**
    - o mesmo id;
    - `kind` diferente;
    - comanda aberta das duas no mesmo dia;
    - ficar com uma "pessoa a mais" (`pessoa:`) quando a outra tem número de WhatsApp. Aí a tela troca a ordem.
  - **Conversas:** as duas abertas viram uma só, como em `mergeLidInto`. As mensagens vão para a aberta que fica e a outra é arquivada com o evento `contato_mesclado`.
  - **`messages_import_key_uq`:** a mensagem cuja `import_key` já existe na que fica perde a `import_key`. Nada é apagado.
  - **Tabelas com chave composta:** `contact_tags`, `campaign_recipients` e `form_answers` usam INSERT … ON CONFLICT DO NOTHING e depois DELETE. Na ficha, a resposta da que fica vence, e a outra vai para o `snapshot`.
  - **Visitas do mesmo dia:** os horários passam para a visita da que fica.
  - **Campos vazios da que fica** são preenchidos com os da outra: e-mail, aniversário, Instagram, CPF, apelido, tipo de cabelo, preferida, uso de imagem e `waLid`. Antes, `waLid` da que sai vira null, por causa do índice único.
  - **Avisos:** as linhas se juntam sem repetir. O que passar de 300 caracteres vai para `notes`.
  - **Avec:** `importedFields.avec` fica o da que fica, e o da outra vai para o `snapshot`.
  - **Datas:** `isClient` é OU, `clientSince` é o menor e `lastServiceAt` é o maior.
  - **Pessoas a mais** da que sai passam para a que fica.
  - **Fim:** grava `contact_merges`, apaga a que sai, audita `cadastros_unidos` e, depois do commit, roda `refreshContactStats()` e `emit("lead_atualizado")`.
- **`resolveContact` e `ImportCtx.contactOf`:** telefone sem contato mas com `mergedTargetFor` vai para a que ficou.

- [ ] **Passo 1: escrever os testes que falham**

```ts
// merge-contacts-coverage.test.ts: a trava (pega tabela nova das Fases A/B)
it("toda FK para contacts está em MERGE_HANDLED_FKS", async () => {
  const fks = (await db.execute(sql`select tc.table_name || '.' || kcu.column_name as fk from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'contacts' and ccu.column_name = 'id'`)).rows.map((r) => r.fk as string);
  expect(fks.filter((f) => !MERGE_HANDLED_FKS.includes(f))).toEqual([]);
});
// merge-contacts.test.ts
it("leva conversas, horários, comandas, vendas, pacotes, pontos, fichas, fotos e notas; a outra some", ...);
it("as duas com conversa aberta: fica uma, sem perder mensagem; a outra arquivada com 'contato_mesclado'", ...);
it("campos vazios da que fica são completados; CPF e aniversário dela não são trocados", ...);
it("mensagem nova do número que saiu cai na que ficou (resolveContact)", ...);
it("reimportar o Avec (0004 e 0051 com o telefone e o nome da que saiu) não recria a cliente", ...);
it("recusa: tipos diferentes; comanda aberta nas duas no mesmo dia; ficar com a 'pessoa a mais' quando a outra tem WhatsApp", ...);
it("visitas do mesmo dia viram uma só", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** escrever a migration 0086 (`when` 1792450000000) e implementar. Preencher `MERGE_HANDLED_FKS` a partir da consulta do teste, rodada no banco de teste com todas as fases já aplicadas.
- [ ] **Passo 4:** rodar os testes, `lid-merge.test.ts`, `people-on-number.test.ts` e `src/server/domain/avec`. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(clientes): unir cadastros duplicados (0086)`.

---

### Task 12: Unir cadastros: a tela e as possíveis duplicadas

**Files:**
- Create:
  - `src/server/queries/duplicate-suspects.ts` e `.test.ts`;
  - `src/app/(app)/contatos/[id]/unir/page.tsx`;
  - `src/components/contacts/merge-flow.tsx` e `.test.tsx`.
- Modify:
  - `src/components/contacts/ficha/more-menu.tsx`: "Unir com…", só com `contatos.unir`;
  - `src/app/(app)/contatos/page.tsx`: o chip "Possíveis duplicadas (N)";
  - `src/app/(app)/contatos/actions.ts`.

**Interfaces:**
- Consumes: `previewMerge` e `mergeContacts` (T11).
- Produces:
  - `type DuplicateSignal = "cpf" | "email" | "aniversario" | "final8" | "pessoa_a_mais" | "codigo_avec"`.
  - `listDuplicateSuspects(opts?: { contactId?: string }): Promise<{ aId: string; bId: string; aName: string | null; bName: string | null; signals: DuplicateSignal[] }[]>`. Usa a mesma regra do `07_duplicados_lista_para_revisar.sql`:
    - nome normalizado igual, com 2 ou mais palavras;
    - sem `pessoa:` e `lid:` no par por nome;
    - e-mail usado por até 3 contatos.

    Junta os pares de "pessoa a mais" com contato próprio e os de código do Avec repetido.
  - `mergeContactsAction(keepId, dropId)`, que pede `contatos.unir` e o tique "Estou ciente".

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("acha os 4 sinais do par por nome, o 'pessoa a mais' com contato próprio e o código do Avec repetido; homônimo sem sinal fica fora", ...);
```

```tsx
it("um passo por tela: Com quem? (suspeitas primeiro + busca) → Qual cadastro fica? (sugere o que tem WhatsApp e mais histórico) → 'Vai junto: 3 conversas, 12 horários…' + 'Estou ciente: não dá para desfazer' → Unir", ...);
```

- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar a tela. O telefone aparece mascarado (`hide-phone`) e o CPF nunca aparece.
- [ ] **Passo 4:** rodar os testes e `npm run e2e -- e2e/contatos.spec.ts e2e/ficha.spec.ts`. Esperado: PASS.
- [ ] **Passo 5:** commit `feat(clientes): tela de unir e lista de possíveis duplicadas`.

---

### Task 13: Verificação final

- [ ] Rodar `npm run typecheck && npm run lint && npm test`. Esperado: 0 erros e todos os testes passando.
- [ ] Rodar `npm run e2e`. Esperado: tudo verde.
- [ ] Conferir `drizzle/meta/_journal.json`:
  - 0080 a 0086 em ordem, com `when` crescente e maior que o das Fases A/B;
  - `npm run db:migrate` num banco limpo e de novo, sem erro.
- [ ] Rodar de novo `merge-contacts-coverage.test.ts`, já com as Fases A/B na branch. Se falhar, a tabela nova entra em `MERGE_HANDLED_FKS`.
- [ ] Commit, se algo mudou: `chore(fase-c): verificação final`.

---

## Autorrevisão

- **Cobertura da spec:**
  - 19 → T1;
  - 20 → T2;
  - 21 → T3, T4 e T5;
  - 22 → T6 e T7;
  - 23 → T9 (repetir) e T10 (passar o dia);
  - 24 → T8;
  - 25 → T11 e T12 (unir) e T3 e T4 (campos da ficha).
  - O "relatório de onde importar os saldos" fica na nota da T7.
- **Nomes conferidos entre tarefas:**
  - `serviceTermsFor` (T8 → T10);
  - `createVisitTx`/`CreateVisitInput` (T1 → T9);
  - `fichaOf`/`saveAnswer` (T3 → T4/T5);
  - `loyaltyOf`/`redeemLoyalty` (T6 → T7);
  - `previewMerge`/`mergeContacts` (T11 → T12);
  - `form_answers`, `client_photos` e `loyalty_entries` entram em `MERGE_HANDLED_FKS`.
- **Review Focus:** cada linha tem teste na tarefa dona (T11, T10, T9, T6, T4).

## Decisões do dono (com o padrão que o plano já segue)

1. **"Marcador" para a etiqueta do horário**, porque "Etiqueta" já é da cliente. Padrão: Marcador.
2. **Os 3 marcadores que repetem estado** ("Foi Atendida", "Atrasada", "ON LINE"). Padrão: entram ativos, como a Casa usa.
3. **"Primeira vez"** passa a ser automática, pela primeira visita finalizada, e não marcada à mão. Padrão: automática.
4. **Fidelidade:**
   - O 0113 traz um saldo por cliente, sem dizer de qual programa. Padrão: tudo em "Fiel da Fiaes".
   - Quais serviços contam e quais são prêmio. Padrão: Fiel conta todos e premia uma Finalização. 10x conta e premia o Corte. Aniversário dá 50% no Ritual de Tratamento.
   - Sessão de pacote não pontua.
5. **As 16 perguntas da consultoria:** a parte 2 só tem o resumo. Padrão: o texto exato vem do 0116 exportado de 2026 inteiro. Até lá, a gestão pode cadastrar à mão.
6. **Etiqueta "Uso de imagem"** depois de copiada para o campo. Padrão: fica, e a gestão apaga em Etiquetas se quiser.
7. **Repetir:** de 1 a 12 semanas, até 26 vezes. A repetição que não cabe fica de fora, com aviso.
8. **Passar o dia:** não manda mensagem na hora, porque o lembrete D-1 já sai com o nome da profissional nova.
9. **Unir:**
   - a mensagem nova do número que saiu cai na ficha que ficou;
   - a permissão nova "Unir cadastros duplicados" vale para a Gestão e a Recepção.
10. **"Pode ser feito junto com outro":** vazio continua como hoje, com conflito de cliente virando encaixe.

## Nota de integração (coordenador, 18/10)
Os números e os `when` das migrations destas fases se cruzam (A usa 0061–0067 até 1792430000000; B, C e D começam em 1792380000000, 1792390000000 e 1792400000000). Ao juntar uma fase em `ia-sugestao`, renumere as migrations dela para depois da última já integrada, com `when` maior que todos, e reindexe o `_journal.json`. O drizzle pula migration com `when` menor que a última aplicada.

## Regra do dono para todas as fases (18/10, vale acima de qualquer padrão deste plano)
- **Tudo configurável:** todo número de regra (porcentagens, taxas, prazos, horários, limites, quantidades) fica editável em Configurações, com o padrão deste plano como valor inicial. Nada fica fixo no código.
- **Todo texto que a cliente ou a equipe recebe** (mensagens, avisos, recibos, perguntas) fica editável em Configurações, com variáveis e botão "Usar o texto sugerido".
- **Toda funcionalidade nova nasce com um liga/desliga** em Configurações. O que manda mensagem para a cliente nasce **desligado**.
- **Toda ação nova tem uma permissão própria**, atribuível por perfil em Configurações › Pessoas › Perfis. O padrão dos perfis segue este plano.
- Teste em cada tarefa: mudar a configuração muda o comportamento, e sem a permissão a ação é recusada no servidor.
