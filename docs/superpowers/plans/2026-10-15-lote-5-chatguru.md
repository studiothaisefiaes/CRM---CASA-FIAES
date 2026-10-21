# Lote 5 (paridade ChatGuru restante): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar o andamento.

**Goal:** A equipe deixa de precisar do ChatGuru no dia a dia. O lote entrega:
- nota interna com @ e aviso para a colega;
- mensagem agendada;
- respostas prontas com variáveis, pastas e anexo;
- "Resolvido" (não precisa responder);
- ligações perdidas e reações na conversa;
- mensagem em massa (nasce DESLIGADA);
- importação da ficha do ChatGuru por CSV;
- exportar a conversa (LGPD);
- menu de boas-vindas (nasce DESLIGADO).

**Architecture:** Cada recurso tem um módulo de domínio próprio em `src/server/domain/*` (`notes`, `scheduled`, `quick-replies`, `resolve`, `campaigns`, `chatguru-csv*`, `conversation-export`, `welcome-menu`) e regras puras em `src/lib/*` (`quick-reply`, `transcript`, `bahia-input`, `resolved`). As ações de tela ficam em arquivos novos (`src/app/(app)/conversa/actions.ts`, `config/*/actions.ts`, `contatos/massa-actions.ts`), para não brigar com os Lotes 2, 3, 4, 6 e 7 nos arquivos grandes. Quem envia WhatsApp continua sendo um caminho só:
- **mensagem agendada:** usa o outbox (`source: "agendada"`) e sai pelo `sendFromCrm`, assinada por quem agendou;
- **mensagem em massa:** tem fila própria, porque o outbox exige lead, e sai uma por rodada do worker;
- **menu de boas-vindas:** usa o outbox como a resposta fora do horário.

A única migration (aditiva) nasce na Tarefa 1.

**Tech Stack:** Next 16 (App Router, server actions), React 19, TypeScript, Drizzle ORM + drizzle-kit, Postgres 17 (Docker), pg-boss (worker), Vitest (+ Testing Library/jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md`. Valem a seção 3 › Lote 5, a seção 4 (Decisões do dono) e a seção 5 (Fora de escopo). Leia também:
- auditoria de paridade: `docs/analise-2026-10-15/paridade.md`;
- engenharia reversa do ChatGuru: `docs/chatguru-engenharia-reversa.md` (CSVs oficiais e plano de extração);
- pesquisa de 15/10: `/private/tmp/claude-501/-Users-joaquimsalles/1d859e91-de4e-47e9-bde3-8a64964253fe/scratchpad/agenda-viva/docs/pesquisa-2026-10-15/chatguru-funcionalidades.md`. Interessam as seções 2.7 (status), 2.9 (anotações), 4.1 (respostas), 4.3 (agendada), 4.5 e 4.6 (reações e ligações), 5.1 (campanhas) e 6.8 (exportações).

**Base de código:** branch `rodada-2` com os Lotes 1A, 1B e 1C prontos. O que o 1C produz é tratado como existente: o funil novo, `src/lib/attempts.ts`, os botões "Marcar como aguardando cliente" e "Enviei orçamento" e a migration `0024_funil_novo`. O mesmo vale para o que o 1A/1B produzem: `signBody`, `stripSignature`, `teamNameCol`, `alertText`, `clientLabel`, `firstName`. As interfaces deles estão em `docs/superpowers/plans/2026-10-15-lotes-1-atendimento.md` ("Interfaces que o Lote 1A/1B/1C expõe"). **Antes de editar um arquivo, confirme nomes e linhas com `grep -n`**: os números de linha citados aqui são da rodada-2 de 15/10 e o 1C ainda mexe em vários desses arquivos.

---

## Global Constraints

- **Migrations só aditivas.** Uma migration só, na Tarefa 1: `npm run db:generate -- --name lote5_chatguru`. Ela pode ser renumerada na junção com a rodada-2. Qualquer `DROP` ou `ALTER COLUMN … TYPE` no SQL gerado é erro: pare. Dados iniciais vão no seed ou em script idempotente, nunca em SQL solto (este lote não precisa de dado inicial: chave ausente = desligado).
- **PT-BR** em tudo que a equipe lê: telas, avisos, histórico, erros, saída dos scripts. O código segue o estilo do arquivo ao redor.
- **Nunca enviar WhatsApp em teste.**
  - Os testes usam a Evolution morta `http://127.0.0.1:9` (`test/setup-env.ts`) ou o provedor falso (`setWhatsappProvider(fake)`).
  - O e2e sobe com `EVOLUTION_URL` morto (`e2e/evolution-guard.ts`).
  - Nenhum script deste lote roda em teste contra a Evolution real.
- **Nada de envio automático ligado.**
  - O menu de boas-vindas (`settings.menu_boas_vindas`) e a mensagem em massa (`settings.envio_massa` + permissão `mensagem.massa`) **nascem DESLIGADOS**. Chave ausente = desligado.
  - A mensagem agendada é manual: alguém escreve o texto e escolhe a hora.
- **Nunca guardar CPF, RG, endereço ou dados bancários.** A importação do ChatGuru tira essas colunas e esses campos com `forbiddenColumns` (`src/server/domain/avec/sanitize.ts`) antes de gravar qualquer coisa.
- **Nunca dado real de cliente no repo.** Fixtures fictícias: "Cliente Teste Um", `71 99999-00xx`, e-mails `@teste.local`.
- **Números de produção só por script**, com `--dry-run`, backup e conferência. São os scripts `scripts/importar-chatguru-csv.ts` (Tarefa 12) e `scripts/sincronizar-webhook.ts` (Tarefa 9). Eles só rodam em produção com o ok do dono.
- **Commits:** todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Portas do usuário intocadas:** 3000, 3100, 4321, 4400 e 8080.
  - Playwright sempre com `E2E_PORT` (o executor escolhe uma porta livre fora dessas). Exemplo: `E2E_PORT=3217 npx playwright test e2e/lote5.spec.ts`.
  - O `playwright.config.ts` cai em 3100 sem a variável: **nunca rode o e2e sem `E2E_PORT`**.
- **Worktree próprio com banco próprio.**
  - O `.env` do worktree aponta para um Postgres separado (outro container ou porta), com o banco chamado `crm`. Assim `test/setup-env.ts` deriva `crm_test` e o Playwright deriva `crm_e2e`.
  - Nunca apontar para o banco do worktree principal nem para a Evolution real (`EVOLUTION_URL=http://127.0.0.1:9` no `.env` do worktree).
- **Fronteiras com outras frentes.** NÃO planejar nem mexer em:
  - agenda viva (duração, preço e categoria de serviço, vínculo profissional↔serviço, horário por profissional, bloqueios, marcar na Agenda);
  - comanda, caixa e comissão de comandas novas;
  - pacotes vendidos pelo CRM;
  - app da profissional e área da cliente (Lotes 6A/6B/6C/7A/7B);
  - filtros novos de Contatos e ficha (Lote 2), relatórios (Lote 3) e divisão de `config.editar` (Lote 4).

  Aqui usamos `config.editar` como está e só **lemos** `appointments` (para `{data_horario}`).
- **Testes:** Postgres de pé (`npm run infra:up` no worktree). O `vitest` migra o `crm_test` sozinho (`test/global-setup.ts`) e cada teste de banco chama `resetDb()` (`test/db.ts`). Antes de cada commit rode `npm test && npm run typecheck && npm run lint`.
- **Horário da Casa (Lote 0, produção):** ter–sáb 9h–18h. Os testes deste lote gravam esse horário em `settings.business_hours`. O e2e usa 24h (`e2e/reset.ts`).

## Decisões deste plano (para quem revisa)

- **"Resolvido" quer dizer "não precisa responder".** Encerra a espera sem mandar nada: sai do prazo e dos avisos, não muda a etapa e não encerra a conversa.
  - "Encerrar conversa" (1B) continua sendo o fim do atendimento. O 1B juntou Arquivar e Encerrar numa ação só, e um terceiro nome para a mesma coisa voltaria a confundir.
  - "Desfazer" devolve a espera de onde estava.
  - Fica ao lado de "Marcar como aguardando cliente" (1C), como na spec.
- **Notas numa tabela própria (`contact_notes`), nunca em `messages`.** Relatórios, sinais, prévia da Fila e "Equipe agora" leem `messages` e contariam a nota como resposta da Casa.
- **Mensagem agendada pelo outbox (`outbox.ts:59`).**
  - Sai assinada por quem agendou e conta como resposta dela.
  - Falhou: não reenvia (fail-closed) e avisa a autora.
  - Por padrão **não sai se a cliente escrever antes**: a autora é avisada e decide. É mais seguro que o ChatGuru, que manda de qualquer jeito.
- **Mensagem em massa sem o outbox.** O outbox exige lead, e abrir lead para 300 contatos poluiria Fila e funil.
  - Tem fila própria (`campaigns`/`campaign_recipients`) e sai uma por rodada do worker.
  - A mensagem é gravada na conversa da cliente sem abrir lead. Quem responde vira "Novo contato" normalmente.
  - Só vai para quem **já escreveu para a Casa** (regra do ChatGuru, que só manda para chats existentes) e nunca para quem está com conversa aberta.
- **Respostas prontas sem migration:** a pasta vai em `lists.category` e o anexo em `lists.meta.attachment`. As colunas já existem.
- **Importação do ChatGuru pelo mesmo caminho do "Post para URL".** O CSV passa por `importChatguruRecord`. Corrige um defeito achado agora: a segunda importação **apagava** os campos e o responsável da primeira (`|| jsonb` substituía o objeto `chatguru` inteiro).
- **Permissões.**
  - `mensagem.massa` é nova e **opcional**: ninguém tem, nem a Gestão, até alguém marcar em Configurações › Equipe › Perfis.
  - O resto usa `atendimento.ver` (conversa), `config.editar` (Configurações) e `contatos.ver` + `relatorios.exportar` (exportar conversa).
- **Ligação perdida abre a espera** ("a cliente quer falar"), igual a uma mensagem. Ligação atendida ou feita pela Casa não vira linha.
- **Menu de boas-vindas.** A spec (§5) põe "menu de boas-vindas" em "depois". O pedido deste lote mandou construí-lo DESLIGADO. Fica como a última tarefa (14): pode ser pulada com o ok do dono sem afetar as outras.

## Review Focus

As cinco situações que a spec implica e que mais devem morder quem usa. Cada uma tem o teste na tarefa dona:

1. **Mensagem agendada fora de contexto.** Situações:
   - a cliente escreve depois de agendar;
   - quem agendou sai da equipe;
   - a mensagem perde a hora (worker parado, Casa fechou).

   Em nenhuma delas a mensagem sai sozinha: a autora (ou a gestão) recebe o aviso "Mensagem agendada para Fulana não saiu: …". Teste: Tarefa 4, Passo 1 ("a cliente escreveu depois", "quem agendou saiu", "perdeu a hora").
2. **Mensagem em massa ligada por engano, sem permissão, desligada no meio ou em teste.** Nada sai e nada entra na conversa. Desligar a chave para na rodada seguinte. Teste: Tarefa 10, Passo 1 ("nasce desligada", "chave desligada no meio").
3. **Resposta pronta com variável sem valor** (`{data_horario}` sem horário marcado). O texto cru nunca chega à cliente: o envio é bloqueado com "Falta preencher: data e horário". Testes: Tarefa 6, Passo 1 (`renderReply`) e Passo 7 (campo da conversa).
4. **Ligação perdida chegando em dobro e reação a mensagem que não está no CRM.** A ligação chega pelo evento `CALL` e pelo registro `callLogMesssage` e vira uma linha só. A reação a mensagem desconhecida não quebra o webhook, não cria contato e nunca abre espera. Teste: Tarefa 9, Passo 1 ("a mesma ligação pelos dois caminhos", "reação a mensagem que não está no CRM").
5. **CSV do ChatGuru reimportado, com colunas diferentes ou com CPF/endereço.**
   - etiquetas e notas não duplicam;
   - colunas desconhecidas aparecem na prévia;
   - CPF e endereço nunca são gravados;
   - a ficha que já existia (campos e responsável) não é apagada.

   Testes: Tarefa 12, Passo 1 ("reimportar não duplica", "CPF nunca é gravado", "não apaga a ficha anterior").

## Mapa de arquivos

| Tarefa | Cria | Altera |
|---|---|---|
| 1 Schema | `src/server/db/schema-lote5.test.ts`, `drizzle/0025_lote5_chatguru.sql` (+ snapshot) | `src/server/db/schema.ts`, `test/db.ts`, `e2e/reset.ts` |
| 2 Nota (servidor) | `src/server/domain/notes.ts` (+ teste), `src/app/(app)/conversa/actions.ts`, `src/server/push-extra.test.ts` | `src/lib/alert-copy.ts`, `src/lib/live-scope.ts`, `src/server/push.ts`, `src/server/queries/deal.ts` |
| 3 Nota (tela) | `src/components/lead/timeline.ts`, `src/components/lead/mentions.ts` (+ testes), `src/components/lead/composer-note.test.tsx` | `src/components/lead/conversation.tsx` (+ teste), `src/components/lead/composer.tsx`, `src/components/icons.tsx`, `src/components/queue/conversation-pane.tsx`, `src/components/lead/lead-sheet.tsx` |
| 4 Agendada (servidor) | `src/server/domain/scheduled.ts` (+ teste), `src/lib/history-lote5.test.ts` | `src/server/domain/outbox.ts`, `src/server/domain/events.ts`, `src/lib/history.ts`, `src/lib/alert-copy.ts`, `src/lib/live-scope.ts`, `src/server/push.ts`, `src/server/queries/deal.ts`, `src/app/(app)/conversa/actions.ts` |
| 5 Agendada (tela) | `src/lib/bahia-input.ts` (+ teste), `src/components/lead/schedule-message-dialog.tsx`, `src/components/lead/scheduled-strip.tsx` (+ testes) | `src/components/lead/composer.tsx`, `src/components/queue/conversation-pane.tsx`, `src/components/lead/lead-sheet.tsx` |
| 6 Variáveis | `src/lib/quick-reply.ts` (+ teste), `src/server/queries/reply-vars.ts` (+ teste), `src/components/lead/composer-vars.test.tsx` | `src/components/lead/composer.tsx`, `src/server/queries/deal.ts`, `src/components/config/lists.tsx`, telas que montam o `Composer` |
| 7 Pastas e anexo | `src/server/domain/quick-replies.ts` (+ teste), `src/app/(app)/config/respostas/actions.ts`, `src/app/api/respostas/[id]/arquivo/route.ts`, `src/components/lead/composer-reply-file.test.tsx` | `src/server/domain/send.ts` (exporta `planMedia`), `src/server/queries/deal.ts`, `src/components/config/lists.tsx`, `src/app/(app)/config/listas/page.tsx`, `src/components/lead/composer.tsx`, `src/app/(app)/conversa/actions.ts` |
| 8 Resolvido | `src/server/domain/resolve.ts` (+ teste), `src/lib/resolved.ts` (+ teste) | `src/server/domain/events.ts`, `src/lib/history.ts`, `src/lib/history-lote5.test.ts`, `src/server/queries/deal.ts`, `src/components/queue/use-lead-actions.tsx`, `src/components/queue/client-pane.tsx`, `src/components/queue/pane-header.tsx`, `src/app/(app)/conversa/actions.ts` |
| 9 Ligações e reações | `src/server/whatsapp/webhook-lote5.test.ts`, `scripts/sincronizar-webhook.ts` | `src/server/whatsapp/webhook.ts`, `src/server/whatsapp/evolution.ts`, `src/server/db/schema.ts` (só tipo TS), `src/components/lead/conversation.tsx` (+ teste), `src/components/lead/timeline.ts` |
| 10 Massa (servidor) | `src/server/domain/campaigns.ts` (+ teste) | `src/lib/permissions.ts` (+ teste), `src/lib/alert-copy.ts`, `worker/index.ts` |
| 11 Massa (tela) | `src/app/(app)/config/massa/page.tsx` + `actions.ts`, `src/app/(app)/contatos/massa-actions.ts`, `src/components/config/mass-settings.tsx`, `src/components/contacts/mass-message-sheet.tsx` (+ teste) | `src/components/config/config-nav.tsx`, `src/app/(app)/contatos/page.tsx`, `src/components/contacts/contacts-bulk-bar.tsx` |
| 12 Importar ChatGuru | `src/server/domain/chatguru-csv.ts`, `src/server/domain/chatguru-csv-import.ts` (+ testes), `src/server/domain/chatguru-import-merge.test.ts`, `src/app/(app)/config/chatguru/page.tsx` + `actions.ts`, `src/components/config/chatguru-import.tsx`, `scripts/importar-chatguru-csv.ts` | `src/server/domain/chatguru-import.ts`, `src/components/config/config-nav.tsx` |
| 13 Exportar conversa | `src/lib/transcript.ts` (+ teste), `src/server/queries/transcript.ts`, `src/server/domain/conversation-export.ts` (+ teste), `src/app/api/contatos/[id]/conversa/route.ts`, `src/app/imprimir/conversa/page.tsx`, `src/components/contacts/export-conversation.tsx` | `src/app/(app)/contatos/[id]/page.tsx`, `src/server/auth/guard-coverage.test.ts` |
| 14 Menu (desligado) | `src/server/domain/welcome-menu.ts` (+ teste), `src/app/(app)/config/menu/page.tsx` + `actions.ts`, `src/components/config/welcome-menu.tsx` | `src/server/domain/deals.ts` (fim do `recordInbound`), `src/server/domain/outbox.ts`, `src/components/config/config-nav.tsx` |
| 15 Verificação | `e2e/lote5.spec.ts` | `docs/deploy-contabo.md` |

---
## Tarefa 1: Schema do lote (migration única e aditiva)

**Arquivos:**
- Modificar: `src/server/db/schema.ts`:
  - `deals` (depois de `followupTaskId`);
  - `messages` (depois de `sentVia`);
  - `outbox` (`options` e coluna nova);
  - tabelas novas depois de `chatguruRecords`.
- Criar (gerados): `drizzle/0025_lote5_chatguru.sql`, `drizzle/meta/0025_snapshot.json`; alterado: `drizzle/meta/_journal.json`
- Modificar: `test/db.ts` e `e2e/reset.ts` (lista do `truncate`)
- Teste: `src/server/db/schema-lote5.test.ts` (novo)

**Interfaces:**
- Consome: nada deste lote.
- Produz:
  - tabela `contactNotes` (`contact_notes`). Colunas:
    - `id`, `contactId` (FK `contacts`, cascade), `dealId` (FK `deals`, set null);
    - `authorId` (FK `users`), `authorName`, `body`;
    - `mentions: string[]` (uuid[], padrão `{}`), `source` (`"crm" | "chatguru" | "menu"`, padrão `"crm"`);
    - `externalKey` (único quando não nulo), `createdAt`;
  - `deals.resolvedAt: Date | null`, `deals.resolvedById: string | null`;
  - `messages.reactions: MessageReactions | null`, com `export type MessageReactions = { cliente?: string; casa?: string }`;
  - `outbox.createdBy: string | null` (FK `users`). O tipo de `outbox.options` ganha `cancelIfReply?: boolean` e `sendAt?: string`;
  - tabela `campaigns`: `id`, `name`, `body`, `status` (padrão `"rascunho"`), `intervalSeconds` (padrão 180), `audience`, `total`, `startAt`, `createdBy`, `confirmedBy`, `confirmedAt`, `finishedAt`, `createdAt`;
  - tabela `campaignRecipients`: PK (`campaignId`, `contactId`), `status` (padrão `"pendente"`), `messageId`, `error`, `sentAt`;
  - tipos `ContactNote`, `Campaign`, `CampaignRecipient`.

- [ ] **Passo 1: Escrever o teste que falha**

`src/server/db/schema-lote5.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from ".";

const cols = async (t: string) => ((await db.execute(sql`select column_name from information_schema.columns where table_name = ${t}`)).rows as { column_name: string }[]).map((r) => r.column_name);

describe("Lote 5 (paridade ChatGuru): schema", () => {
  it("notas internas da conversa", async () => {
    expect(await cols("contact_notes")).toEqual(expect.arrayContaining(["id", "contact_id", "deal_id", "author_id", "author_name", "body", "mentions", "source", "external_key", "created_at"]));
  });
  it("Resolvido, reações e quem agendou a mensagem", async () => {
    expect(await cols("deals")).toEqual(expect.arrayContaining(["resolved_at", "resolved_by_id"]));
    expect(await cols("messages")).toContain("reactions");
    expect(await cols("outbox")).toContain("created_by");
  });
  it("mensagem em massa", async () => {
    expect(await cols("campaigns")).toEqual(expect.arrayContaining(["name", "body", "status", "interval_seconds", "audience", "total", "start_at", "created_by", "confirmed_by", "confirmed_at", "finished_at"]));
    expect(await cols("campaign_recipients")).toEqual(expect.arrayContaining(["campaign_id", "contact_id", "status", "message_id", "error", "sent_at"]));
  });
  it("a mesma anotação importada não entra duas vezes", async () => {
    const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'contact_notes_external_uq'`);
    expect((r.rows[0] as { indexdef: string }).indexdef).toContain("external_key IS NOT NULL");
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/db/schema-lote5.test.ts`
Esperado: FAIL. As colunas e tabelas não existem: `expected [] to contain "resolved_at"`.

- [ ] **Passo 3: Escrever o schema**

Em `src/server/db/schema.ts`, logo antes de `export const messages = pgTable(`:

```ts
/** Reações do WhatsApp numa mensagem (a última de cada lado). Não são mensagens nem abrem espera. */
export type MessageReactions = { cliente?: string; casa?: string };
```

Em `deals`, depois de `followupTaskId` (ache com `grep -n "followupTaskId" src/server/db/schema.ts`):

```ts
  /** "Resolvido (não precisa responder)": quando e quem encerrou a espera sem mandar mensagem. Vale até a cliente escrever de novo. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => users.id),
```

Em `messages`, depois de `sentVia`:

```ts
  /** Reações: { cliente: "❤️", casa: "👍" }. Ver `applyReaction` em src/server/whatsapp/webhook.ts. */
  reactions: jsonb("reactions").$type<MessageReactions | null>(),
```

Em `outbox`, trocar a linha do `options` e acrescentar `createdBy` depois de `attempts`:

```ts
  options: jsonb("options").$type<string[] | { values?: string[]; source?: string; awaiting?: string; scheduledAt?: string; stage?: string; messageId?: string; cancelIfReply?: boolean; sendAt?: string } | null>(),
```

```ts
  /** Mensagem agendada à mão: quem agendou (assina e é avisada se não sair). Automáticas ficam sem. */
  createdBy: uuid("created_by").references(() => users.id),
```

Depois de `export const chatguruRecords = …` (antes do bloco do Avec):

```ts
/** Notas internas da conversa: a cliente nunca vê. Troca de turno, recado com @, anotações trazidas do ChatGuru e a escolha no menu de boas-vindas. Ficam na cliente (todas as conversas dela). */
export const contactNotes = pgTable("contact_notes", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
  authorId: uuid("author_id").references(() => users.id),
  /** Quem escreveu quando não é alguém da equipe daqui ("SARA" do ChatGuru, "Menu de boas-vindas"). */
  authorName: text("author_name"),
  body: text("body").notNull(),
  mentions: uuid("mentions").array().notNull().default(sql`'{}'::uuid[]`),
  /** crm | chatguru | menu */
  source: text("source").notNull().default("crm"),
  /** Importação idempotente: a mesma anotação do ChatGuru nunca entra duas vezes. */
  externalKey: text("external_key"),
  createdAt: createdAt(),
}, (t) => [
  index("contact_notes_contact_idx").on(t.contactId, t.createdAt),
  uniqueIndex("contact_notes_external_uq").on(t.externalKey).where(sql`${t.externalKey} is not null`),
]);

/** Mensagem em massa (Contatos). Nasce desligada: precisa da chave `envio_massa` e da permissão "mensagem.massa". */
export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  /** rascunho | agendada | enviando | pausada | concluida | cancelada */
  status: text("status").notNull().default("rascunho"),
  intervalSeconds: integer("interval_seconds").notNull().default(180),
  /** O filtro de Contatos usado ao montar a lista (só para conferência). */
  audience: jsonb("audience").$type<Record<string, unknown>>().notNull().default({}),
  total: integer("total").notNull().default(0),
  startAt: timestamp("start_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("campaigns_status_idx").on(t.status, t.createdAt)]);

/** Quem recebe cada mensagem em massa: lista congelada ao montar. `sentAt` = quando tentou (enviada, falhou ou reservada). */
export const campaignRecipients = pgTable("campaign_recipients", {
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  /** pendente | enviando | enviada | falhou | pulada */
  status: text("status").notNull().default("pendente"),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.campaignId, t.contactId] }),
  index("campaign_recipients_status_idx").on(t.campaignId, t.status),
  index("campaign_recipients_sent_idx").on(t.sentAt),
]);

export type ContactNote = typeof contactNotes.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
```

- [ ] **Passo 4: Gerar a migration e conferir que é só aditiva**

Rodar: `npm run db:generate -- --name lote5_chatguru`
Esperado: cria `drizzle/0025_lote5_chatguru.sql` com `CREATE TABLE "contact_notes"`, `"campaigns"` e `"campaign_recipients"`. Também traz `ALTER TABLE … ADD COLUMN` para `deals.resolved_at`, `deals.resolved_by_id`, `messages.reactions` e `outbox.created_by`, mais as FKs e os índices.

Rodar: `grep -nE "DROP|ALTER COLUMN|SET DATA TYPE" drizzle/0025_lote5_chatguru.sql`
Esperado: nenhuma linha. Se aparecer qualquer uma, pare e confira `git diff drizzle/meta`: o schema do worktree está diferente do da rodada-2.

- [ ] **Passo 5: Limpar as tabelas novas entre testes**

Em `test/db.ts`, na lista do `truncate table …`, acrescentar depois de `chatguru_records,`:

```ts
contact_notes, campaigns, campaign_recipients,
```

Em `e2e/reset.ts`, na lista do `truncate table …`, acrescentar antes de `restart identity cascade`:

```ts
, contact_notes, campaigns, campaign_recipients
```

(com a vírgula antes, depois de `report_print_tokens`).

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/db`
Esperado: PASS (os testes antigos de schema também).

Rodar: `npm run typecheck`
Esperado: sem erros.

- [ ] **Passo 7: Commit**

```bash
git add src/server/db/schema.ts src/server/db/schema-lote5.test.ts drizzle/0025_lote5_chatguru.sql drizzle/meta/0025_snapshot.json drizzle/meta/_journal.json test/db.ts e2e/reset.ts
git commit -m "feat(lote5): schema de notas internas, Resolvido, reações, autora da agendada e mensagem em massa (migration aditiva)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 2: Nota interna no servidor (com @ e aviso para a colega)

**Arquivos:**
- Criar: `src/server/domain/notes.ts`, `src/server/domain/notes.test.ts`
- Criar: `src/app/(app)/conversa/actions.ts` (arquivo de ações da conversa do Lote 5; as Tarefas 4, 5, 7 e 8 acrescentam ações aqui)
- Modificar: `src/lib/alert-copy.ts`. Mudam o objeto `alertText`, o mapa `GROUP_OF` e a lista `ALERT_HELP`. Ache com `grep -n "export const alertText\|const GROUP_OF\|export const ALERT_HELP" src/lib/alert-copy.ts`.
- Modificar: `src/lib/live-scope.ts` (`SCOPE_OF`)
- Modificar: `src/server/push.ts` (`sendPushForPendingAlerts`)
- Modificar: `src/server/queries/deal.ts` (`getDealDetail` devolve `notes`)
- Teste: `src/server/push-extra.test.ts` (novo)

**Interfaces:**
- Consome (Tarefa 1): `contactNotes`. Do 1B: `alertText`, `clientLabel`, `firstName`. Do 1A: `teamNameCol()`.
- Produz:
  - `NOTE_MAX = 2000`;
  - `type NoteItem = { id: string; body: string; authorName: string | null; createdAt: Date; mentions: string[]; source: string }`;
  - `noteExcerpt(body: string): string`;
  - `addNote(input: { dealId: string; body: string; mentions?: string[] }, authorId: string, now?: Date): Promise<{ id: string; notified: number }>`;
  - `notesOf(contactId: string, limit?: number): Promise<NoteItem[]>` (mais antiga primeiro);
  - alerta novo `type = "mencao"` (`audience = "responsavel"`, `userId` = quem foi chamada, `dedupeKey = "mencao:<nota>:<pessoa>"`);
  - `alertText.mention(actor: string | null, client: string, excerpt: string): string`;
  - `PUSH_ALSO: readonly string[]` em `src/server/push.ts`: avisos sem espera que também vão por push (`["mencao"]`; a Tarefa 4 acrescenta `"agendada_falhou"`);
  - evento de tempo real `nota_criada` (escopo `deal:<id>`);
  - `DealDetail.notes: NoteItem[]`;
  - ação `addNoteAction(input: { dealId: string; body: string; mentions: string[] }): Promise<ActionResult<{ id: string }>>`, com `ActionResult` exportado de `src/app/(app)/conversa/actions.ts`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/notes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, messages, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { addNote, notesOf } from "./notes";

let sara = "", cati = "", ex = "", dealId = "", contactId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: cati }] = await db.insert(users).values({ name: "Caticilene Rocha", email: "cati@teste.local", role: "gestor", passwordHash: "x" }).returning();
  [{ id: ex }] = await db.insert(users).values({ name: "Ex Atendente", email: "ex@teste.local", role: "atendente", passwordHash: "x", active: false }).returning();
  const r = await recordInbound({ channelId: null, externalId: "N1", phoneRaw: "71999990001", pushName: "Cliente Teste", body: "Oi, quero marcar" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
});

describe("nota interna", () => {
  it("grava com a autora e aparece nas notas da cliente", async () => {
    await addNote({ dealId, body: "  Cliente prefere à tarde  " }, sara);
    const [n] = await notesOf(contactId);
    expect(n).toMatchObject({ body: "Cliente prefere à tarde", authorName: "Sara Lima", source: "crm", mentions: [] });
  });

  it("a cliente não vê: não cria mensagem, não entra na fila de envio, não mexe na espera nem na etapa", async () => {
    const [before] = await db.select().from(deals).where(eq(deals.id, dealId));
    await addNote({ dealId, body: "Troca de turno: falta mandar o preço" }, sara);
    const [after] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(after.awaitingReplySince?.toISOString()).toBe(before.awaitingReplySince?.toISOString());
    expect(after.stageId).toBe(before.stageId);
    expect(after.lastOutboundAt).toBeNull();
    expect((await db.select().from(messages)).filter((m) => m.direction === "out")).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("@ avisa a colega no sino; nunca a autora, quem saiu da equipe ou um id que não existe", async () => {
    const r = await addNote({ dealId, body: "@Caticilene pode conferir o sinal?", mentions: [cati, sara, ex, "00000000-0000-4000-8000-000000000000"] }, sara);
    expect(r.notified).toBe(1);
    const list = await db.select().from(alerts).where(eq(alerts.type, "mencao"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: cati, audience: "responsavel", dealId });
    expect(list[0].message).toBe("Sara te marcou numa nota sobre Cliente Teste: “@Caticilene pode conferir o sinal?”");
    expect((await notesOf(contactId))[0].mentions).toEqual([cati]);
  });

  it("trecho longo no aviso é cortado em 80 caracteres", async () => {
    await addNote({ dealId, body: `@Caticilene ${"a".repeat(200)}`, mentions: [cati] }, sara);
    const [a] = await db.select().from(alerts).where(eq(alerts.type, "mencao"));
    expect(a.message.endsWith("…”")).toBe(true);
  });

  it("nota vazia ou longa demais é recusada", async () => {
    await expect(addNote({ dealId, body: "   " }, sara)).rejects.toThrow(/Escreva a nota/);
    await expect(addNote({ dealId, body: "x".repeat(2001) }, sara)).rejects.toThrow(/máximo 2.000/);
  });
});
```

`src/server/push-extra.test.ts`:

```ts
import { it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { alerts, pushSubscriptions, users } from "./db/schema";
import { sendPushForPendingAlerts } from "./push";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });

it("menção numa nota vai por push; outros avisos sem espera continuam só no sino", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "ana@teste.local", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values({ userId: ana.id, endpoint: "https://p/ana", p256dh: "k", auth: "a" });
  await db.insert(alerts).values([
    { userId: ana.id, audience: "responsavel", type: "mencao", severity: "info", message: "Sara te marcou numa nota sobre Cliente Teste: “oi”", dedupeKey: "m1" },
    { userId: ana.id, audience: "responsavel", type: "assumiu_sua_conversa", severity: "info", message: "Cati assumiu a conversa de Cliente Teste", dedupeKey: "m2" },
  ]);
  const payloads: string[] = [];
  const r = await sendPushForPendingAlerts(async (_sub, payload) => { payloads.push(payload); return 201; });
  expect(r.sent).toBe(1);
  expect(JSON.parse(payloads[0])).toMatchObject({ title: "Te marcaram numa nota", body: "Sara te marcou numa nota sobre Cliente Teste: “oi”" });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/notes.test.ts src/server/push-extra.test.ts`
Esperado: FAIL. `Cannot find module './notes'` e `expected 0 to be 1` no push.

- [ ] **Passo 3: Textos do aviso**

Em `src/lib/alert-copy.ts`, dentro de `export const alertText = {`, depois de `autoSendFailed`:

```ts
  /** Lote 5: alguém chamou a pessoa com @ numa nota interna. */
  mention: (actor: string | null, client: string, excerpt: string) => `${firstName(actor) ?? "Alguém"} te marcou numa nota sobre ${client}: “${excerpt}”`,
```

No `GROUP_OF`, acrescentar ao grupo das conversas: `mencao: "conversas",`.

Em `ALERT_HELP`, depois da entrada `alerta-respondida`:

```ts
  { id: "alerta-mencao", types: ["mencao"], title: "Te marcaram numa nota",
    text: "Alguém da equipe escreveu uma nota interna na conversa e te chamou com @. A cliente não vê a nota. Abra a conversa para ler o recado.",
    example: alertText.mention("Sara", "Fulana", "pode conferir o sinal do Pix?") },
```

- [ ] **Passo 4: Domínio**

`src/server/domain/notes.ts`:

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { alerts, contactNotes, contacts, deals, users } from "../db/schema";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { teamNameCol } from "../queries/team-name";
import { emit } from "./events";
import { UserFacingError } from "./errors";

export const NOTE_MAX = 2000;
export type NoteItem = { id: string; body: string; authorName: string | null; createdAt: Date; mentions: string[]; source: string };

/** Trecho da nota no aviso do sino: uma linha, até 80 caracteres. */
export const noteExcerpt = (body: string) => {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
};

/**
 * Nota interna na conversa. A cliente nunca vê: não passa pelo WhatsApp, não conta como resposta, não mexe na espera nem na etapa.
 * `mentions`: ids da equipe chamados com @. Só quem está ativo recebe o aviso "te marcou numa nota" (sino e push); a autora nunca.
 */
export async function addNote(input: { dealId: string; body: string; mentions?: string[] }, authorId: string, now = new Date()): Promise<{ id: string; notified: number }> {
  const body = input.body.trim();
  if (!body) throw new UserFacingError("Escreva a nota antes de salvar.");
  if (body.length > NOTE_MAX) throw new UserFacingError(`Nota muito longa (máximo ${NOTE_MAX.toLocaleString("pt-BR")} caracteres).`);
  const [row] = await db.select({ contactId: deals.contactId, name: contacts.name, phone: contacts.phoneE164 })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, input.dealId));
  if (!row) throw new UserFacingError("Essa conversa não existe mais.");
  const wanted = [...new Set(input.mentions ?? [])].filter((id) => id !== authorId);
  const mentioned = wanted.length
    ? (await db.select({ id: users.id }).from(users).where(and(inArray(users.id, wanted), eq(users.active, true)))).map((u) => u.id)
    : [];
  const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, authorId));
  const client = clientLabel(row.name, row.phone);
  const result = await db.transaction(async (tx) => {
    const [note] = await tx.insert(contactNotes)
      .values({ contactId: row.contactId, dealId: input.dealId, authorId, body, mentions: mentioned, createdAt: now }).returning({ id: contactNotes.id });
    for (const uid of mentioned) {
      await tx.insert(alerts).values({
        dealId: input.dealId, userId: uid, audience: "responsavel", type: "mencao", severity: "info", createdAt: now,
        message: alertText.mention(author?.name ?? null, client, noteExcerpt(body)), dedupeKey: `mencao:${note.id}:${uid}`,
      }).onConflictDoNothing();
    }
    return { id: note.id, notified: mentioned.length };
  });
  await emit("nota_criada", { dealId: input.dealId });
  if (result.notified) await emit("alerta", { dealId: input.dealId });
  return result;
}

/** As notas da cliente (todas as conversas dela), da mais antiga para a mais nova, com o nome de quem escreveu (como na equipe). */
export async function notesOf(contactId: string, limit = 200): Promise<NoteItem[]> {
  const rows = await db.select({
    id: contactNotes.id, body: contactNotes.body, team: teamNameCol(), authorName: contactNotes.authorName,
    createdAt: contactNotes.createdAt, mentions: contactNotes.mentions, source: contactNotes.source,
  }).from(contactNotes).leftJoin(users, eq(users.id, contactNotes.authorId))
    .where(eq(contactNotes.contactId, contactId)).orderBy(desc(contactNotes.createdAt), desc(contactNotes.id)).limit(limit);
  return rows.reverse().map((r) => ({ id: r.id, body: r.body, authorName: r.team ?? r.authorName ?? null, createdAt: r.createdAt, mentions: r.mentions, source: r.source }));
}
```

> Atenção: `teamNameCol()` devolve `coalesce(initcap(lower(signature)), name)`. Para Sara sem assinatura cadastrada, sai "Sara Lima". O teste do Passo 1 não grava assinatura de propósito.

- [ ] **Passo 5: Push para a menção**

Em `src/server/push.ts`, acrescentar `notInArray` ao import do `drizzle-orm` e, antes de `sendPushForPendingAlerts`:

```ts
/** Avisos sem espera que também vão por push (o resto fica só no sino). */
export const PUSH_ALSO: readonly string[] = ["mencao"];
const PUSH_TITLE: Record<string, string> = { mencao: "Te marcaram numa nota" };
```

Dentro de `sendPushForPendingAlerts`, trocar a primeira atualização (a que marca `pushedAt` de quem não vai por push) por:

```ts
  await db.update(alerts).set({ pushedAt: new Date() }).where(and(isNull(alerts.pushedAt),
    or(isNotNull(alerts.resolvedAt), and(isNull(alerts.waitKey), notInArray(alerts.type, [...PUSH_ALSO])), like(alerts.waitKey, "task:%"))));
```

e o título:

```ts
    const title = PUSH_TITLE[a.type] ?? (a.level >= 2 ? "Atraso escalado para a gestão" : "Lead esperando");
```

- [ ] **Passo 6: Tempo real e detalhe da conversa**

Em `src/lib/live-scope.ts`, no `SCOPE_OF`, depois de `mensagem_atualizada`:

```ts
  nota_criada: ["deal:<id>"],
```

Em `src/server/queries/deal.ts`:
- import: `import { notesOf } from "../domain/notes";`
- no `Promise.all` de `getDealDetail`, acrescentar `notesOf(row.contact.id)` como **último** item da lista e `notes` no fim da desestruturação: `…, pros, late, notes] = await Promise.all([…, notesOf(row.contact.id)])`;
- no objeto devolvido, depois de `professionals: pros,`:

```ts
    /** Notas internas da cliente (Lote 5): entram na conversa pela hora, nunca em `messages`. */
    notes,
```

- [ ] **Passo 7: Ação da tela**

`src/app/(app)/conversa/actions.ts`:

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { addNote } from "@/server/domain/notes";

/** Ações da conversa do Lote 5 (nota interna, mensagem agendada, resposta pronta com anexo, Resolvido). */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "conversa") });
const uuid = z.string().uuid();

/** Nota interna (a cliente não vê). `mentions`: ids da equipe chamados com @. */
export async function addNoteAction(input: { dealId: string; body: string; mentions: string[] }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const r = await addNote({ dealId: uuid.parse(input.dealId), body: z.string().max(4000).parse(input.body), mentions: z.array(uuid).max(10).parse(input.mentions ?? []) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { id: r.id } };
  } catch (e) { return fail(e); }
}
```

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/notes.test.ts src/server/push-extra.test.ts src/server/push.test.ts src/lib/alert-copy.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS. O `guard-coverage` aceita `addNoteAction`, porque ela começa com `assertPerm`.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 9: Commit**

```bash
git add src/server/domain/notes.ts src/server/domain/notes.test.ts "src/app/(app)/conversa/actions.ts" src/lib/alert-copy.ts src/lib/live-scope.ts src/server/push.ts src/server/push-extra.test.ts src/server/queries/deal.ts
git commit -m "feat(conversa): nota interna com @ (aviso no sino e push para a colega); a cliente nunca vê

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 3: Nota interna na tela (balão amarelo e modo "Nota" no campo, com @)

**Arquivos:**
- Criar: `src/components/lead/timeline.ts`, `src/components/lead/timeline.test.ts`
- Criar: `src/components/lead/mentions.ts`, `src/components/lead/mentions.test.ts`
- Criar: `src/components/lead/composer-note.test.tsx`
- Modificar: `src/components/lead/conversation.tsx`: o tipo `Msg`, `optimisticArrived`, `withDays` e `Bubble`
- Modificar: `src/components/lead/conversation.test.tsx` (um caso novo)
- Modificar: `src/components/lead/composer.tsx` (modo nota e menção)
- Modificar: `src/components/icons.tsx` (`IconNote`)
- Modificar: `src/components/queue/conversation-pane.tsx` (ache com `grep -n "const base = detail.messages.map" src/components/queue/conversation-pane.tsx`) e `src/components/lead/lead-sheet.tsx` (ache com `grep -n "const base = d.messages.map" src/components/lead/lead-sheet.tsx`)

**Interfaces:**
- Consome (Tarefa 2): `DealDetail.notes: NoteItem[]`, `DealDetail.people` (já existe: `{ id; name; … }[]`), `addNoteAction`.
- Produz:
  - `messagesToMsgs(messages: DealDetail["messages"]): Msg[]` (o mapeamento que estava duplicado nas duas telas);
  - `type NoteLike = { id: string; body: string; authorName: string | null; createdAt: string | Date; source: string }`;
  - `noteToMsg(n: NoteLike): Msg` (id `nota:<uuid>`, `kind: "nota"`);
  - `mergeTimeline(msgs: Msg[], notes?: NoteLike[]): Msg[]`;
  - `Msg.note?: "crm" | "chatguru" | "menu"`;
  - `mentionQuery(text): string | null`, `mentionOptions(team, query): T[]`, `insertMention(text, name): string`, `mentionsIn(text, team): string[]`, `firstOf(name): string`;
  - `Composer` ganha as props `team?: { id: string; name: string }[]` e `onNoteSaved?: () => void`;
  - `IconNote`.

- [ ] **Passo 1: Testes puros que falham**

`src/components/lead/mentions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertMention, mentionOptions, mentionQuery, mentionsIn } from "./mentions";

const team = [{ id: "u1", name: "Caticilene Rocha" }, { id: "u2", name: "Sara Lima" }, { id: "u3", name: "Thaíse Fiaes" }];

describe("@ nas notas", () => {
  it("só abre a lista quando o @ está no fim do que se digita", () => {
    expect(mentionQuery("Confere @ca")).toBe("ca");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("email@teste")).toBeNull();
    expect(mentionQuery("Confere @Sara depois")).toBeNull();
  });
  it("filtra pelo primeiro nome, sem acento nem maiúscula", () => {
    expect(mentionOptions(team, "tha").map((p) => p.id)).toEqual(["u3"]);
    expect(mentionOptions(team, "").map((p) => p.id)).toEqual(["u1", "u2", "u3"]);
  });
  it("troca o @ digitado pelo primeiro nome escolhido", () => {
    expect(insertMention("Confere @ca", "Caticilene Rocha")).toBe("Confere @Caticilene ");
  });
  it("só conta quem continua chamado no texto final", () => {
    expect(mentionsIn("@caticilene e @Thaise, olhem isso", team)).toEqual(["u1", "u3"]);
    expect(mentionsIn("Cati vai ver", team)).toEqual([]);
  });
});
```

`src/components/lead/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeTimeline, noteToMsg } from "./timeline";
import { withDays, type Msg } from "./conversation";

const msg = (id: string, at: string, over: Partial<Msg> = {}): Msg => ({ id, direction: "out", kind: "text", body: id, status: "sent", createdAt: at, sender: "Sara", fromPhone: false, ...over });

describe("notas na conversa", () => {
  it("entram pela hora; no mesmo instante, a mensagem vem antes", () => {
    const t = mergeTimeline([msg("a", "2026-10-15T13:00:00.000Z"), msg("b", "2026-10-15T13:05:00.000Z")],
      [{ id: "n1", body: "nota", authorName: "Cati", createdAt: "2026-10-15T13:00:00.000Z", source: "crm" }]);
    expect(t.map((m) => m.id)).toEqual(["a", "nota:n1", "b"]);
  });
  it("nota vira balão próprio: tipo nota, de quem escreveu, de onde veio", () => {
    expect(noteToMsg({ id: "n2", body: "x", authorName: "SARA", createdAt: new Date("2026-10-15T13:00:00Z"), source: "chatguru" }))
      .toMatchObject({ id: "nota:n2", kind: "nota", sender: "SARA", note: "chatguru", status: "nota" });
  });
  it("nota nunca gruda no balão da Casa (nem o balão da Casa nela)", () => {
    const rows = withDays(mergeTimeline([msg("a", "2026-10-15T13:00:00.000Z"), msg("b", "2026-10-15T13:02:00.000Z")],
      [{ id: "n1", body: "nota", authorName: "Sara", createdAt: "2026-10-15T13:01:00.000Z", source: "crm" }]));
    expect(rows.map((r) => r.cont)).toEqual([false, false, false]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/components/lead/mentions.test.ts src/components/lead/timeline.test.ts`
Esperado: FAIL (`Cannot find module './mentions'` e `'./timeline'`).

- [ ] **Passo 3: Módulos puros**

`src/components/lead/mentions.ts`:

```ts
/** @ nas notas internas: funções puras (o campo da conversa usa; os testes também). */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** O que a pessoa digita logo depois de um @ no fim do texto ("@ca" → "ca"); null = não está chamando ninguém. */
export function mentionQuery(text: string): string | null {
  const m = text.match(/(?:^|\s)@([\p{L}]*)$/u);
  return m ? m[1] : null;
}

/** Quem aparece na lista do @: começa com o que foi digitado (primeiro nome, sem acento nem maiúscula). No máximo 6. */
export function mentionOptions<T extends { id: string; name: string }>(team: T[], query: string): T[] {
  const q = norm(query);
  return team.filter((p) => norm(firstOf(p.name)).startsWith(q)).slice(0, 6);
}

/** Troca o "@ca" do fim pelo "@Caticilene " escolhido. */
export const insertMention = (text: string, name: string) => text.replace(/@([\p{L}]*)$/u, `@${firstOf(name)} `);

/** Ids de quem continua chamado no texto final (o @Nome está lá, sem acento nem maiúscula importando). */
export function mentionsIn(text: string, team: { id: string; name: string }[]): string[] {
  const words = new Set([...norm(text).matchAll(/@([a-z0-9]+)/g)].map((m) => m[1]));
  return team.filter((p) => words.has(norm(firstOf(p.name)))).map((p) => p.id);
}
```

`src/components/lead/timeline.ts`:

```ts
import type { DealDetail } from "@/server/queries/deal";
import type { Msg } from "./conversation";

/** As mensagens do servidor no formato da conversa (o mesmo mapeamento na Fila e no Quadro). */
export const messagesToMsgs = (messages: DealDetail["messages"]): Msg[] => messages.map((m) => ({
  id: m.id, externalId: m.externalId, direction: m.direction, kind: m.kind, body: m.body, status: m.status, createdAt: new Date(m.createdAt).toISOString(),
  sender: m.sender, fromPhone: m.fromPhone, sentVia: m.sentVia, error: m.error, hasMedia: m.hasMedia, quotedBody: m.quotedBody,
  edited: !!m.editedAt, deleted: !!m.deletedAt, purgedAt: m.mediaPurgedAt ? new Date(m.mediaPurgedAt).toISOString() : undefined,
}));

export type NoteLike = { id: string; body: string; authorName: string | null; createdAt: string | Date; source: string };

/** Nota interna como balão da conversa ("só a equipe vê"). Nunca conta como mensagem da Casa. */
export const noteToMsg = (n: NoteLike): Msg => ({
  id: `nota:${n.id}`, direction: "out", kind: "nota", body: n.body, status: "nota", createdAt: new Date(n.createdAt).toISOString(),
  sender: n.authorName, fromPhone: false, note: n.source === "chatguru" ? "chatguru" : n.source === "menu" ? "menu" : "crm",
});

/** Mensagens e notas na ordem do relógio; no mesmo instante, a mensagem vem antes. */
export function mergeTimeline(msgs: Msg[], notes: NoteLike[] = []): Msg[] {
  if (!notes.length) return msgs;
  const all = [...msgs.map((m, i) => ({ m, i, n: 0 })), ...notes.map((x, i) => ({ m: noteToMsg(x), i, n: 1 }))];
  all.sort((a, b) => Date.parse(a.m.createdAt) - Date.parse(b.m.createdAt) || a.n - b.n || a.i - b.i);
  return all.map((x) => x.m);
}
```

- [ ] **Passo 4: Balão da nota na conversa**

Em `src/components/lead/conversation.tsx`:

1. No tipo `Msg`, depois de `purgedAt`:

```ts
  /** Nota interna (kind "nota"): de onde veio. A cliente não vê. */ note?: "crm" | "chatguru" | "menu";
```

2. `optimisticArrived`: trocar `m.direction === "out" &&` por `m.direction === "out" && m.kind !== "nota" &&`.

3. Em `withDays`, no cálculo de `cont`, acrescentar no começo da condição: `m.kind !== "nota" && prev?.kind !== "nota" &&` (o resto igual).

4. Antes de `export const Bubble = memo(`:

```tsx
const NOTE_FROM: Record<NonNullable<Msg["note"]>, string> = { crm: "", chatguru: " · veio do ChatGuru", menu: " · menu de boas-vindas" };
/** @Nome em negrito dentro da nota. */
const withMentions = (text: string) => text.split(/(@[\p{L}][\p{L}0-9]*)/u).map((part, i) => (part.startsWith("@") ? <b key={i} className="font-semibold">{part}</b> : part));

/** Nota interna: amarela, no meio, com "só a equipe vê". Sem botão Responder e sem tique de envio. */
function NoteBubble({ m, day, animateIn }: { m: Msg; day: string | null; animateIn: boolean }) {
  return (
    <motion.div initial={animateIn ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className="flex flex-col">
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <div role="note" aria-label="Nota interna" className="self-center w-full max-w-[86%] rounded-[var(--radius-card)] border border-dashed border-gold/60 bg-gold-soft/50 px-3.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-ink">Nota interna · só a equipe vê{NOTE_FROM[m.note ?? "crm"]}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{withMentions(m.body ?? "")}</p>
        <p className="mt-1 text-right text-[10.5px] text-muted">{m.sender ?? "Equipe"} · {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
    </motion.div>
  );
}
```

5. Primeira linha dentro de `Bubble` (antes de `const out = …`):

```tsx
  if (m.kind === "nota") return <NoteBubble m={m} day={day} animateIn={animateIn} />;
```

6. Em `Conversation`, no `animateIn` dos balões, trocar `(m.direction === "in" || m.id === "optimistic")` por `(m.direction === "in" || m.id === "optimistic" || m.kind === "nota")`.

Em `src/components/lead/conversation.test.tsx`, acrescentar no fim:

```tsx
describe("nota interna", () => {
  it("aparece como nota da equipe: sem Responder, sem tique e com o @ em destaque", () => {
    render(<Conversation onReply={() => {}} messages={[msg({ id: "nota:n1", kind: "nota", direction: "out", status: "nota", body: "@Cati confere o sinal", sender: "Sara", externalId: null, note: "crm" })]} />);
    const note = screen.getByRole("note", { name: "Nota interna" });
    expect(note.textContent).toContain("Nota interna · só a equipe vê");
    expect(note.textContent).toContain("Sara");
    expect(note.querySelector("b")?.textContent).toBe("@Cati");
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull();
    expect(screen.queryByLabelText(/Status:/)).toBeNull();
  });
});
```

- [ ] **Passo 5: Teste do campo (modo nota) que falha**

`src/components/lead/composer-note.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const addNoteAction = vi.fn(async () => ({ ok: true as const, data: { id: "n1" } }));
const sendMessageAction = vi.fn();
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction, scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
import { Composer } from "./composer";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const team = [{ id: "u1", name: "Caticilene Rocha" }, { id: "u2", name: "Sara Lima" }];

describe("campo da conversa: nota interna", () => {
  it("modo Nota chama a colega com @ e salva a nota (nada vai para a cliente)", async () => {
    const saved = vi.fn();
    render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} team={team} onNoteSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Nota interna (a cliente não vê)" }));
    const field = screen.getByLabelText("Nota interna");
    fireEvent.change(field, { target: { value: "Confere o sinal @ca" } });
    expect(screen.getByRole("listbox", { name: "Chamar alguém da equipe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /@Caticilene/ }));
    expect((field as HTMLTextAreaElement).value).toBe("Confere o sinal @Caticilene ");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(addNoteAction).toHaveBeenCalledWith({ dealId: "d1", body: "Confere o sinal @Caticilene", mentions: ["u1"] }));
    expect(sendMessageAction).not.toHaveBeenCalled();
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });
  it("no modo Nota não há anexo, gravação nem resposta pronta", () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={[{ id: "q", label: "oi", body: "Oi!" }]} onOptimistic={() => {}} team={team} />);
    fireEvent.click(screen.getByRole("button", { name: "Nota interna (a cliente não vê)" }));
    expect(screen.queryByRole("button", { name: "Anexar foto, PDF ou áudio" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Nota interna"), { target: { value: "/oi" } });
    expect(screen.queryByRole("listbox", { name: "Respostas prontas" })).toBeNull();
  });
});
```

Rodar: `npx vitest run src/components/lead/composer-note.test.tsx`
Esperado: FAIL (não existe o botão "Nota interna (a cliente não vê)").

- [ ] **Passo 6: Ícone e campo com modo Nota**

Em `src/components/icons.tsx`, depois de `IconChat`:

```tsx
export const IconNote = (p: P) => <I {...p}><path d="M5 4.5h14v10l-5 5H5z" /><path d="M14 19.5v-5h5M8.5 9h7M8.5 12.5h4" /></I>;
```

Em `src/components/lead/composer.tsx`:

1. Imports: acrescentar `IconNote` ao import de `@/components/icons`; `import { addNoteAction } from "@/app/(app)/conversa/actions";` e `import { insertMention, mentionOptions, mentionQuery, mentionsIn, firstOf } from "./mentions";`.

2. Props: acrescentar à desestruturação e ao tipo:

```ts
  /** Equipe para o @ das notas internas (a lista "Transferir para…" do lead). */
  team?: { id: string; name: string }[];
  /** Depois de salvar uma nota: recarrega a conversa. */
  onNoteSaved?: () => void;
```

3. Estado e listas, logo depois de `const [sel, setSel] = useState(0);`:

```ts
  const [mode, setMode] = useState<"mensagem" | "nota">("mensagem");
  const noteMode = mode === "nota";
```

Trocar a linha do `slash` por:

```ts
  const slash = !noteMode && text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
```

E, logo depois de `matches`:

```ts
  const mq = noteMode ? mentionQuery(text) : null;
  const people = useMemo(() => (mq === null ? [] : mentionOptions(team ?? [], mq)), [mq, team]);
  const pickPerson = (p: { name: string }) => { setText(insertMention(text, p.name)); setSel(0); requestAnimationFrame(() => ref.current?.focus()); };
```

4. No começo de `send`, antes de `if (!canSend || pending) return;`:

```ts
    if (noteMode) {
      const body = text.trim();
      if (!body || pending) return;
      start(async () => {
        const r = await addNoteAction({ dealId, body, mentions: mentionsIn(body, team ?? []) });
        if (!r.ok) { toast(r.error, "error"); return; }
        setText(""); toast("Nota salva (a cliente não vê)", "ok"); onNoteSaved?.();
      });
      return;
    }
```

5. Lista do @: logo depois do `<AnimatePresence>` das respostas prontas (fecha em `</AnimatePresence>` antes do `replyTo`), acrescentar:

```tsx
      {people.length > 0 && (
        <ul className="absolute left-3 right-3 bottom-full mb-2 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] overflow-hidden" role="listbox" aria-label="Chamar alguém da equipe">
          {people.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseEnter={() => setSel(i)} onClick={() => pickPerson(p)} className={`w-full text-left px-3.5 py-2.5 ${i === sel ? "bg-paper-2" : ""}`}>
                <span className="text-sm font-semibold text-ink">@{firstOf(p.name)}</span> <span className="text-sm text-graphite">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
```

6. No `onKeyDown` do `textarea`, antes de `if (matches.length) {`:

```ts
              if (people.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % people.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + people.length) % people.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickPerson(people[sel] ?? people[0]); return; }
              }
```

7. Botões da linha de baixo:
   - Embrulhe o botão do clipe (`Anexar foto, PDF ou áudio`) em `{!noteMode && (…)}`.
   - Logo antes dele, acrescente o botão do modo:

```tsx
          <IconButton label={noteMode ? "Voltar para mensagem" : "Nota interna (a cliente não vê)"} aria-pressed={noteMode} size="lg" className="h-11"
            onClick={() => { setMode(noteMode ? "mensagem" : "nota"); setAttachment(null); setSel(0); requestAnimationFrame(() => ref.current?.focus()); }}>
            <IconNote size={20} className={noteMode ? "text-gold-ink" : undefined} />
          </IconButton>
```

8. No `textarea`:
   - `placeholder`: `noteMode ? "Nota interna: só a equipe vê. Use @ para chamar alguém." : (o que já era)`;
   - `aria-label`: `noteMode ? "Nota interna" : (o que já era)`;
   - na `className`, trocar `bg-paper-2` por `${noteMode ? "bg-gold-soft/60" : "bg-paper-2"}`.

9. O botão de gravar só aparece fora do modo nota: troque a condição `canSend || !canRecord` por `canSend || !canRecord || noteMode`.
   - `aria-label` do enviar: `noteMode ? "Salvar nota" : "Enviar"`.
   - `const canSend` passa a ser `!!(text.trim() || (!noteMode && attachment)) && !recording;`.

10. Texto de ajuda do rodapé (o `<p className="text-xs text-muted mt-1.5 …">`):

```tsx
      <p className="text-xs text-muted mt-1.5 px-1 hidden sm:block">{noteMode ? <>Nota interna: a cliente não vê · <b className="text-graphite">@</b> chama alguém da equipe · Enter salva</> : <><b className="text-graphite">/</b> respostas prontas · Enter envia · Shift+Enter quebra linha</>}</p>
```

- [ ] **Passo 7: Telas usam a linha do tempo com notas**

Em `src/components/queue/conversation-pane.tsx`:
- import: `import { mergeTimeline, messagesToMsgs } from "@/components/lead/timeline";`
- trocar a linha `const base = detail.messages.map(…)` por:

```ts
    const base = mergeTimeline(messagesToMsgs(detail.messages), detail.notes);
```

- no `<Composer …>`, acrescentar `team={detail?.people ?? []} onNoteSaved={() => { void load(); }}`.

Em `src/components/lead/lead-sheet.tsx`:
- mesmo import;
- trocar `const base = d.messages.map(…)` por `const base = mergeTimeline(messagesToMsgs(d.messages), d.notes);`. Na dependência do `useMemo`, troque `[d.messages, optimistic]` por `[d.messages, d.notes, optimistic]`;
- no `<Composer …>`: `team={d.people} onNoteSaved={() => router.refresh()}`.

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/components/lead`
Esperado: PASS (os testes antigos de `conversation.test.tsx` também).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela, com `npm run dev` numa porta livre e o navegador headless em segundo plano:
- abrir um lead do simulador (`/dev/simulador`, número fictício);
- tocar no ícone de nota;
- escrever "teste @" e escolher alguém;
- salvar;
- a nota amarela aparece entre as mensagens e o sino da pessoa chamada mostra "te marcou numa nota".

- [ ] **Passo 9: Commit**

```bash
git add src/components/lead/timeline.ts src/components/lead/timeline.test.ts src/components/lead/mentions.ts src/components/lead/mentions.test.ts src/components/lead/composer-note.test.tsx src/components/lead/conversation.tsx src/components/lead/conversation.test.tsx src/components/lead/composer.tsx src/components/icons.tsx src/components/queue/conversation-pane.tsx src/components/lead/lead-sheet.tsx
git commit -m "feat(conversa): nota interna amarela na conversa e modo Nota no campo, com @ para chamar a colega

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 4: Mensagem agendada no servidor (outbox, assinada por quem agendou, cancelável)

**Arquivos:**
- Criar: `src/server/domain/scheduled.ts`, `src/server/domain/scheduled.test.ts`, `src/lib/history-lote5.test.ts`
- Modificar: `src/server/domain/outbox.ts`, `processItem`. Ache com `grep -n "const { values, source } = meta;" src/server/domain/outbox.ts`.
- Modificar: `src/server/domain/events.ts` (`DealEventType`)
- Modificar: `src/lib/history.ts` (os `case` novos antes do `default`)
- Modificar: `src/lib/alert-copy.ts` (`alertText.scheduledFailed`, `GROUP_OF`, `ALERT_HELP`)
- Modificar: `src/lib/live-scope.ts`, `src/server/push.ts` (`PUSH_ALSO`, `PUSH_TITLE`), `src/server/queries/deal.ts` (`scheduled`)
- Modificar: `src/app/(app)/conversa/actions.ts` (três ações)

**Interfaces:**
- Consome (Tarefa 1): `outbox.createdBy`, `outbox.options.cancelIfReply` e `outbox.options.sendAt`. Do código atual:
  - `sendFromCrm(dealId, text, userId)`: assina com a assinatura de quem envia (1A);
  - `findOpenDeal(contactId)`, `getBusinessHours()`;
  - `isOpen(ms, hours)`, `businessDayLabel(ms, hours)`, `dueLabel(ms, now)`;
  - `logEvent(db, …)`, `emit(…)`.
- Produz:
  - `SCHEDULED_SOURCE = "agendada"`;
  - `SCHEDULE_MIN_AHEAD_MS = 5 min`, `SCHEDULE_MAX_DAYS = 60`, `SCHEDULED_PER_CONTACT = 5`, `SCHEDULED_LATE_MS = 2 h`;
  - `type ScheduledItem = { id: string; dealId: string; text: string; at: Date; authorName: string | null; cancelIfReply: boolean }`;
  - `scheduleMessage(input: { dealId: string; text: string; at: Date; cancelIfReply?: boolean }, userId: string, now?: Date): Promise<{ id: string; at: Date }>`;
  - `scheduledOf(contactId: string): Promise<ScheduledItem[]>`;
  - `cancelScheduled(id: string, userId: string): Promise<void>`;
  - `sendScheduledNow(id: string, userId: string, now?: Date): Promise<void>`;
  - `deliverScheduled(item: OutboxItem, now?: Date): Promise<"sent" | "cancelled" | "failed">` (chamado pelo `drainOutbox`);
  - alerta `type = "agendada_falhou"`: para a autora (`audience "responsavel"`) ou para a gestão quando a autora saiu. `dedupeKey = "agendada:<item>"`;
  - `alertText.scheduledFailed(client: string, why: string): string`;
  - eventos `mensagem_agendada` (`payload.para`, ISO) e `agendada_cancelada`; tempo real `agendada`;
  - `DealDetail.scheduled: ScheduledItem[]`;
  - ações:
    - `scheduleMessageAction(input: { dealId: string; text: string; at: string; cancelIfReply: boolean }): Promise<ActionResult<{ at: string }>>`;
    - `cancelScheduledAction(id: string): Promise<ActionResult>`;
    - `sendScheduledNowAction(id: string): Promise<ActionResult>`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/scheduled.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, messages, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { drainOutbox } from "./outbox";
import { cancelScheduled, scheduleMessage, scheduledOf, sendScheduledNow } from "./scheduled";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN }; // Lote 0: ter–sáb 9h–18h
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00 em Salvador
const AT = new Date("2026-10-21T13:00:00Z"); // quarta 10:00
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const sent: string[] = []; let failSend = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { if (failSend) throw new ProviderError("Evolution recusou", 500); sent.push(text); return { externalId: `OUT${sent.length}` }; },
};
let sara = "", dealId = "", contactId = "";

beforeEach(async () => {
  sent.length = 0; failSend = false;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999990021", pushName: "Cliente Teste", body: "Oi! Amanhã confirmo", at: plus(T0, -5), now: plus(T0, -5) });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

const failAlert = async () => (await db.select().from(alerts).where(eq(alerts.type, "agendada_falhou")))[0];

describe("mensagem agendada", () => {
  it("agenda: fica na fila com a hora e quem agendou, e aparece na conversa", async () => {
    const { id } = await scheduleMessage({ dealId, text: "Confirma amanhã às 15h?", at: AT, cancelIfReply: false }, sara, T0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ id, createdBy: sara, notBefore: AT, status: "pending", options: { source: "agendada", cancelIfReply: false, sendAt: AT.toISOString() } });
    expect(await scheduledOf(contactId)).toEqual([expect.objectContaining({ id, text: "Confirma amanhã às 15h?", authorName: "Sara Lima", cancelIfReply: false })]);
  });

  it("recusa: menos de 5 min, mais de 60 dias, Casa fechada, texto vazio e mais de 5 na mesma conversa", async () => {
    await expect(scheduleMessage({ dealId, text: "   ", at: AT }, sara, T0)).rejects.toThrow(/Escreva a mensagem/);
    await expect(scheduleMessage({ dealId, text: "x", at: plus(T0, 3) }, sara, T0)).rejects.toThrow(/pelo menos 5 minutos/);
    await expect(scheduleMessage({ dealId, text: "x", at: new Date("2026-12-30T13:00:00Z") }, sara, T0)).rejects.toThrow(/até 60 dias/);
    await expect(scheduleMessage({ dealId, text: "x", at: new Date("2026-10-26T13:00:00Z") }, sara, T0)).rejects.toThrow("Nesse horário a Casa está fechada (segunda, a Casa não abre).");
    for (let i = 0; i < 5; i++) await scheduleMessage({ dealId, text: `m${i}`, at: plus(AT, i * 10) }, sara, T0);
    await expect(scheduleMessage({ dealId, text: "m6", at: AT }, sara, T0)).rejects.toThrow(/já tem 5 mensagens agendadas/);
  });

  it("antes da hora não sai; na hora sai assinada por quem agendou e conta como resposta dela", async () => {
    await scheduleMessage({ dealId, text: "Confirma amanhã às 15h?", at: AT }, sara, T0);
    expect((await drainOutbox(plus(AT, -1))).sent).toBe(0);
    expect((await drainOutbox(AT)).sent).toBe(1);
    expect(sent[0].startsWith("*SARA - CASA FIAES:*")).toBe(true);
    expect(sent[0]).toContain("Confirma amanhã às 15h?");
    const out = (await db.select().from(messages)).find((m) => m.direction === "out")!;
    expect(out).toMatchObject({ sentByUserId: sara, sentVia: "crm", status: "sent", dealId });
    expect((await db.select().from(outbox))[0].status).toBe("sent");
    expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].awaitingReplySince).toBeNull();
  });

  it("a cliente escreveu depois de agendar: não sai e a autora é avisada", async () => {
    await scheduleMessage({ dealId, text: "Confirma amanhã?", at: AT }, sara, T0);
    await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "71999990021", body: "Não vou poder ir", at: plus(T0, 60), now: plus(T0, 60) });
    expect((await drainOutbox(AT)).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await failAlert()).toMatchObject({ userId: sara, audience: "responsavel", dealId,
      message: "Mensagem agendada para Cliente Teste não saiu: a cliente escreveu depois que você agendou. Abra a conversa e decida se envia." });
  });

  it("com “não sai se ela escrever” desmarcado, sai mesmo assim", async () => {
    await scheduleMessage({ dealId, text: "Bom dia!", at: AT, cancelIfReply: false }, sara, T0);
    await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "71999990021", body: "Oi", at: plus(T0, 60), now: plus(T0, 60) });
    expect((await drainOutbox(AT)).sent).toBe(1);
  });

  it("quem agendou saiu da equipe: não sai e a gestão é avisada", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    await db.update(users).set({ active: false }).where(eq(users.id, sara));
    expect((await drainOutbox(AT)).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await failAlert()).toMatchObject({ userId: null, audience: "gestao" });
  });

  it("perdeu a hora (worker parado mais de 2 h): não sai sozinha", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    expect((await drainOutbox(plus(AT, 180))).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await failAlert()).message).toContain("perdeu a hora (era para hoje 10:00)");
  });

  it("WhatsApp recusou: fica como “não saiu”, não tenta de novo e avisa a autora", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    failSend = true;
    expect((await drainOutbox(AT)).failed).toBe(1);
    failSend = false;
    expect(await drainOutbox(plus(AT, 1))).toMatchObject({ sent: 0, failed: 0 });
    expect((await db.select().from(outbox))[0].status).toBe("failed");
    expect((await failAlert()).message).toContain("Evolution recusou");
  });

  it("cancelar tira da fila; enviar agora manda na hora e o worker não manda de novo", async () => {
    const one = await scheduleMessage({ dealId, text: "Primeira", at: AT }, sara, T0);
    await cancelScheduled(one.id, sara);
    expect(await scheduledOf(contactId)).toEqual([]);
    await expect(cancelScheduled(one.id, sara)).rejects.toThrow(/já saiu ou já foi cancelada/);
    const two = await scheduleMessage({ dealId, text: "Agora vai", at: AT }, sara, T0);
    await sendScheduledNow(two.id, sara, plus(T0, 10));
    expect(sent).toHaveLength(1);
    expect((await drainOutbox(AT)).sent).toBe(0);
  });
});
```

`src/lib/history-lote5.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { historyEntries, type HistoryLookup } from "./history";

const lookup: HistoryLookup = { users: {}, lists: {}, sources: {} };
const ev = (type: string, payload: Record<string, unknown> = {}) => ({ id: type, type, payload, createdAt: "2026-10-20T13:00:00Z", user: "Sara Lima" });
const text = (type: string, payload?: Record<string, unknown>) => historyEntries([ev(type, payload)], lookup)[0].text;

describe("histórico do Lote 5", () => {
  it("mensagem agendada e cancelada", () => {
    expect(text("mensagem_agendada", { para: "2026-10-21T13:00:00.000Z" })).toBe("Mensagem agendada para amanhã 10:00");
    expect(text("agendada_cancelada")).toBe("Mensagem agendada cancelada");
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/scheduled.test.ts src/lib/history-lote5.test.ts`
Esperado: FAIL (`Cannot find module './scheduled'`; o histórico mostra "Outro registro do sistema").

- [ ] **Passo 3: Textos, eventos e histórico**

Em `src/lib/alert-copy.ts`:
- em `alertText`, depois de `mention`:

```ts
  /** Lote 5: mensagem agendada que não saiu (a autora decide se envia). */
  scheduledFailed: (client: string, why: string) => `Mensagem agendada para ${client} não saiu: ${why}. Abra a conversa e decida se envia.`,
```

- em `GROUP_OF`, no grupo do sistema: `agendada_falhou: "sistema",`;
- em `ALERT_HELP`, depois de `alerta-envio`:

```ts
  { id: "alerta-agendada", types: ["agendada_falhou"], title: "Mensagem agendada não saiu",
    text: "Uma mensagem agendada não foi enviada: a cliente escreveu antes, quem agendou saiu da equipe, ela perdeu a hora (mais de 2 h de atraso) ou o WhatsApp recusou. Nunca sai sozinha depois disso: abra a conversa e decida.",
    example: alertText.scheduledFailed("Fulana", "a cliente escreveu depois que você agendou") },
```

Em `src/server/domain/events.ts`, acrescentar ao fim da união `DealEventType`:

```ts
  | "mensagem_agendada" | "agendada_cancelada"
```

Em `src/lib/history.ts`, antes do `default:`:

```ts
    case "mensagem_agendada": return one(`Mensagem agendada para ${typeof p.para === "string" ? dueLabel(Date.parse(p.para), ms(e.createdAt)) : "depois"}`);
    case "agendada_cancelada": return one("Mensagem agendada cancelada");
```

Em `src/lib/live-scope.ts`, no `SCOPE_OF`: `agendada: ["queue", "deal:<id>"],`.

Em `src/server/push.ts`:
- `PUSH_ALSO` passa a ser `["mencao", "agendada_falhou"]`;
- `PUSH_TITLE` ganha `agendada_falhou: "Mensagem agendada não saiu"`.

- [ ] **Passo 4: Domínio**

`src/server/domain/scheduled.ts`:

```ts
import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, outbox, users, type OutboxItem } from "../db/schema";
import { businessDayLabel, isOpen } from "@/lib/business-hours";
import { isHiddenNumber } from "@/lib/phone-client";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { dueLabel } from "@/lib/next-action";
import { getBusinessHours } from "./hours";
import { findOpenDeal } from "./deals";
import { sendFromCrm } from "./send";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

export const SCHEDULED_SOURCE = "agendada";
export const SCHEDULE_MIN_AHEAD_MS = 5 * 60_000;
export const SCHEDULE_MAX_DAYS = 60;
export const SCHEDULED_PER_CONTACT = 5;
/** Agendada que perdeu a hora (worker parado, Casa fechou) não sai sozinha depois disso: a autora decide. */
export const SCHEDULED_LATE_MS = 2 * 3_600_000;

export type ScheduledItem = { id: string; dealId: string; text: string; at: Date; authorName: string | null; cancelIfReply: boolean };
type Meta = { source?: string; cancelIfReply?: boolean; sendAt?: string };
const metaOf = (o: OutboxItem["options"]): Meta => (o && !Array.isArray(o) ? o : {});
const isScheduled = sql`${outbox.options}->>'source' = ${SCHEDULED_SOURCE}`;
const pendingOf = (contactId: string) => and(eq(outbox.status, "pending"), isScheduled, eq(deals.contactId, contactId));

/**
 * Mensagem agendada (relógio ao lado do campo): fica no outbox com a hora escolhida e sai assinada por quem agendou.
 * Só com a Casa aberta (o worker não envia com ela fechada), de 5 min a 60 dias para a frente, no máximo 5 por cliente.
 * `cancelIfReply` (padrão: sim): se a cliente escrever antes da hora, não sai e a autora é avisada.
 */
export async function scheduleMessage(input: { dealId: string; text: string; at: Date; cancelIfReply?: boolean }, userId: string, now = new Date()): Promise<{ id: string; at: Date }> {
  const text = input.text.trim();
  if (!text) throw new UserFacingError("Escreva a mensagem antes de agendar.");
  if (text.length > 4000) throw new UserFacingError("Mensagem muito longa (máximo 4.000 caracteres).");
  const at = input.at;
  if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() + SCHEDULE_MIN_AHEAD_MS) throw new UserFacingError("Escolha um horário daqui a pelo menos 5 minutos.");
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) throw new UserFacingError(`Dá para agendar até ${SCHEDULE_MAX_DAYS} dias para a frente.`);
  const hours = await getBusinessHours();
  if (!isOpen(at.getTime(), hours)) throw new UserFacingError(`Nesse horário a Casa está fechada (${businessDayLabel(at.getTime(), hours)}). Escolha um horário com a Casa aberta.`);
  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, input.dealId));
  if (!row) throw new UserFacingError("Essa conversa não existe mais.");
  if (row.deal.archivedAt || row.contact.ignored) throw new UserFacingError("Esse contato está marcado como “Não é cliente”.");
  if (isHiddenNumber(row.contact.phoneE164)) throw new UserFacingError("Essa cliente está com o número oculto no WhatsApp: não dá para agendar por aqui.");
  const pending = await db.select({ id: outbox.id }).from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId)).where(pendingOf(row.contact.id));
  if (pending.length >= SCHEDULED_PER_CONTACT) throw new UserFacingError(`Esta conversa já tem ${SCHEDULED_PER_CONTACT} mensagens agendadas. Cancele uma antes.`);
  const [item] = await db.insert(outbox).values({
    dealId: input.dealId, kind: "text", text, notBefore: at, createdBy: userId, createdAt: now,
    options: { source: SCHEDULED_SOURCE, cancelIfReply: input.cancelIfReply !== false, sendAt: at.toISOString() },
  }).returning({ id: outbox.id });
  await logEvent(db, input.dealId, "mensagem_agendada", { outboxId: item.id, para: at.toISOString() }, userId);
  await emit("agendada", { dealId: input.dealId });
  return { id: item.id, at };
}

/** As agendadas que ainda vão sair (todas as conversas da cliente), da mais próxima para a mais distante. */
export async function scheduledOf(contactId: string): Promise<ScheduledItem[]> {
  const rows = await db.select({ id: outbox.id, dealId: outbox.dealId, text: outbox.text, notBefore: outbox.notBefore, options: outbox.options, authorName: users.name })
    .from(outbox).innerJoin(deals, eq(deals.id, outbox.dealId)).leftJoin(users, eq(users.id, outbox.createdBy))
    .where(pendingOf(contactId)).orderBy(asc(outbox.notBefore));
  return rows.map((r) => {
    const m = metaOf(r.options);
    return { id: r.id, dealId: r.dealId, text: r.text, at: m.sendAt ? new Date(m.sendAt) : r.notBefore, authorName: r.authorName, cancelIfReply: m.cancelIfReply !== false };
  });
}

/** A conversa em que a mensagem entra: a aberta da cliente agora (a antiga pode ter fechado), senão a de quando agendou. */
async function targetDeal(dealId: string): Promise<string> {
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  return d ? (await findOpenDeal(d.contactId))?.id ?? dealId : dealId;
}

export async function cancelScheduled(id: string, userId: string): Promise<void> {
  const [item] = await db.update(outbox).set({ status: "cancelled", error: "Cancelada na conversa." })
    .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), isScheduled)).returning();
  if (!item) throw new UserFacingError("Essa mensagem já saiu ou já foi cancelada.");
  await logEvent(db, item.dealId, "agendada_cancelada", { outboxId: id }, userId);
  await emit("agendada", { dealId: item.dealId });
}

/** "Enviar agora": reserva o item (o worker não pega mais) e manda na hora, assinada por quem clicou. */
export async function sendScheduledNow(id: string, userId: string, now = new Date()): Promise<void> {
  const [item] = await db.update(outbox).set({ status: "sending", attempts: sql`${outbox.attempts} + 1`, notBefore: now })
    .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), isScheduled)).returning();
  if (!item) throw new UserFacingError("Essa mensagem já saiu ou já foi cancelada.");
  try {
    await sendFromCrm(await targetDeal(item.dealId), item.text, userId);
  } catch (e) {
    await db.update(outbox).set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(outbox.id, id));
    await emit("agendada", { dealId: item.dealId });
    throw e;
  }
  await db.update(outbox).set({ status: "sent", sentAt: now, error: null }).where(eq(outbox.id, id));
  await emit("agendada", { dealId: item.dealId });
}

/**
 * Chamado pelo `drainOutbox` para um item "agendada", na hora: confere tudo de novo e envia como quem agendou.
 * Nunca reenvia: qualquer falha vira "não saiu" e a autora (ou a gestão) é avisada.
 */
export async function deliverScheduled(item: OutboxItem, now = new Date()): Promise<"sent" | "cancelled" | "failed"> {
  const meta = metaOf(item.options);
  const [row] = await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, item.dealId));
  const finish = async (status: "cancelled" | "failed", why: string, notify: "autora" | "gestao" | null) => {
    await db.update(outbox).set({ status, error: why.slice(0, 300) }).where(eq(outbox.id, item.id));
    if (row && notify) {
      const toAuthor = notify === "autora" && !!item.createdBy;
      await db.insert(alerts).values({
        dealId: item.dealId, userId: toAuthor ? item.createdBy : null, audience: toAuthor ? "responsavel" : "gestao", type: "agendada_falhou", severity: "info",
        message: alertText.scheduledFailed(clientLabel(row.contact.name, row.contact.phoneE164), why), dedupeKey: `agendada:${item.id}`,
      }).onConflictDoNothing();
      await emit("alerta", { dealId: item.dealId });
    }
    await emit("agendada", { dealId: item.dealId });
    return status;
  };
  if (!row) return finish("cancelled", "a conversa não existe mais", null);
  if (row.contact.ignored || row.deal.archivedAt) return finish("cancelled", "o contato foi marcado como “Não é cliente”", "autora");
  // `notBefore` vira o instante da reserva quando o item é pego: a hora escolhida fica em `sendAt`.
  const sendAt = meta.sendAt ? new Date(meta.sendAt) : item.notBefore;
  if (now.getTime() - sendAt.getTime() > SCHEDULED_LATE_MS) return finish("cancelled", `perdeu a hora (era para ${dueLabel(sendAt.getTime(), now.getTime())})`, "autora");
  const [author] = item.createdBy ? await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.id, item.createdBy)) : [];
  if (!author?.active) return finish("cancelled", "quem agendou não está mais na equipe", "gestao");
  if (meta.cancelIfReply !== false) {
    const [{ last }] = await db.select({ last: max(messages.createdAt) }).from(messages).where(and(eq(messages.contactId, row.contact.id), eq(messages.direction, "in")));
    if (last && last.getTime() > item.createdAt.getTime()) return finish("cancelled", "a cliente escreveu depois que você agendou", "autora");
  }
  try {
    await sendFromCrm(await targetDeal(item.dealId), item.text, author.id);
  } catch (e) {
    return finish("failed", (e instanceof Error ? e.message : String(e)).replace(/^Não foi possível enviar: /, ""), "autora");
  }
  await db.update(outbox).set({ status: "sent", sentAt: now, error: null }).where(eq(outbox.id, item.id));
  await emit("agendada", { dealId: item.dealId });
  return "sent";
}
```

- [ ] **Passo 5: A fila usa o caminho da agendada**

Em `src/server/domain/outbox.ts`:
- import: `import { deliverScheduled, SCHEDULED_SOURCE } from "./scheduled";`
- em `processItem`, logo depois de `const { values, source } = meta;`:

```ts
  // Mensagem agendada à mão (Lote 5): regras próprias (cliente escreveu, autora saiu, perdeu a hora) e envio como quem agendou.
  if (source === SCHEDULED_SOURCE) return deliverScheduled(item, now);
```

> O teto por hora (`envio_teto_hora`) e o "só com a Casa aberta" do `claimNext` continuam valendo para a agendada: ela só é pega com a Casa aberta e conta no teto.

- [ ] **Passo 6: Detalhe da conversa e ações**

Em `src/server/queries/deal.ts`:
- `import { scheduledOf } from "../domain/scheduled";`;
- acrescentar `scheduledOf(row.contact.id)` como último item do `Promise.all` e `scheduled` no fim da desestruturação;
- no retorno: `/** Mensagens agendadas que ainda vão sair (Lote 5). */ scheduled,`.

Em `src/app/(app)/conversa/actions.ts`, acrescentar o import `import { cancelScheduled, scheduleMessage, sendScheduledNow } from "@/server/domain/scheduled";` e:

```ts
/** Agenda o texto do campo para `at` (ISO). A hora é conferida no servidor (Casa aberta, 5 min a 60 dias). */
export async function scheduleMessageAction(input: { dealId: string; text: string; at: string; cancelIfReply: boolean }): Promise<ActionResult<{ at: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const at = new Date(z.string().min(10).max(40).parse(input.at));
    const r = await scheduleMessage({ dealId: uuid.parse(input.dealId), text: z.string().max(4000).parse(input.text), at, cancelIfReply: z.boolean().parse(input.cancelIfReply) }, user.id);
    revalidatePath("/atendimento");
    return { ok: true, data: { at: r.at.toISOString() } };
  } catch (e) { return fail(e); }
}

export async function cancelScheduledAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await cancelScheduled(uuid.parse(id), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function sendScheduledNowAction(id: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await sendScheduledNow(uuid.parse(id), user.id);
    revalidatePath("/atendimento");
    return { ok: true };
  } catch (e) { return fail(e); }
}
```

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/scheduled.test.ts src/lib/history-lote5.test.ts src/server/domain/outbox.test.ts src/server/push-extra.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS. Os testes antigos do outbox também passam, porque o caminho das automáticas não mudou.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 8: Commit**

```bash
git add src/server/domain/scheduled.ts src/server/domain/scheduled.test.ts src/lib/history-lote5.test.ts src/server/domain/outbox.ts src/server/domain/events.ts src/lib/history.ts src/lib/alert-copy.ts src/lib/live-scope.ts src/server/push.ts src/server/queries/deal.ts "src/app/(app)/conversa/actions.ts"
git commit -m "feat(conversa): mensagem agendada pelo outbox, assinada por quem agendou; não sai se a cliente escrever antes, se a autora sair ou se perder a hora

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 5: Mensagem agendada na tela (relógio no campo e "Agendada para…" na conversa)

**Arquivos:**
- Criar: `src/lib/bahia-input.ts`, `src/lib/bahia-input.test.ts`
- Criar: `src/components/lead/schedule-message-dialog.tsx`, `src/components/lead/schedule-message-dialog.test.tsx`
- Criar: `src/components/lead/scheduled-strip.tsx`, `src/components/lead/scheduled-strip.test.tsx`
- Modificar: `src/components/lead/composer.tsx` (botão do relógio), `src/components/queue/conversation-pane.tsx`, `src/components/lead/lead-sheet.tsx`

**Interfaces:**
- Consome (Tarefa 4): `scheduleMessageAction`, `cancelScheduledAction`, `sendScheduledNowAction` e `DealDetail.scheduled`. Do código atual: `bahiaAt`, `dueLabel` (`src/lib/next-action.ts`), `firstName`, `stripSignature`.
- Produz:
  - `bahiaDateInput(ms): string` ("2026-10-21"), `bahiaTimeInput(ms): string` ("10:00");
  - `fromBahiaInputs(day: string, time: string): Date | null`;
  - `<ScheduleMessageDialog open onClose dealId text onDone(atIso) />`;
  - `type ScheduledView = { id: string; text: string; at: string | Date; authorName: string | null; cancelIfReply: boolean }`;
  - `<ScheduledStrip items onChange />`;
  - `Composer` ganha a prop `onScheduled?: () => void`.

- [ ] **Passo 1: Testes que falham**

`src/lib/bahia-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bahiaDateInput, bahiaTimeInput, fromBahiaInputs } from "./bahia-input";

describe("data e hora de Salvador nos campos", () => {
  it("dia e hora digitados viram o instante certo (UTC-3)", () => {
    expect(fromBahiaInputs("2026-10-21", "10:00")?.toISOString()).toBe("2026-10-21T13:00:00.000Z");
  });
  it("campo vazio ou torto vira null", () => {
    expect(fromBahiaInputs("", "10:00")).toBeNull();
    expect(fromBahiaInputs("2026-10-21", "25:99")).toBeNull();
  });
  it("23h em Salvador ainda é o mesmo dia", () => {
    const ms = Date.parse("2026-10-21T02:00:00Z");
    expect(bahiaDateInput(ms)).toBe("2026-10-20");
    expect(bahiaTimeInput(ms)).toBe("23:00");
  });
});
```

`src/components/lead/scheduled-strip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const cancelScheduledAction = vi.fn(async () => ({ ok: true as const }));
const sendScheduledNowAction = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/app/(app)/conversa/actions", () => ({ cancelScheduledAction, sendScheduledNowAction }));
import { ScheduledStrip } from "./scheduled-strip";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const item = { id: "s1", text: "*SARA - CASA FIAES:*\nConfirma amanhã?", at: new Date(Date.now() + 86_400_000).toISOString(), authorName: "Sara Lima", cancelIfReply: true };

describe("mensagens agendadas na conversa", () => {
  it("mostra para quando, de quem e o texto sem a assinatura", () => {
    render(<ScheduledStrip items={[item]} onChange={() => {}} />);
    const list = screen.getByRole("list", { name: "Mensagens agendadas" });
    expect(list.textContent).toContain("Agendada para amanhã");
    expect(list.textContent).toContain("por Sara");
    expect(list.textContent).toContain("Confirma amanhã?");
    expect(list.textContent).not.toContain("CASA FIAES");
    expect(list.textContent).toContain("Não sai se ela escrever antes.");
  });
  it("Cancelar e Enviar agora chamam o servidor e atualizam a conversa", async () => {
    const onChange = vi.fn();
    render(<ScheduledStrip items={[item]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a mensagem agendada" }));
    await waitFor(() => expect(cancelScheduledAction).toHaveBeenCalledWith("s1"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));
    await waitFor(() => expect(sendScheduledNowAction).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });
  it("sem agendadas, não ocupa espaço", () => {
    const { container } = render(<ScheduledStrip items={[]} onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
```

`src/components/lead/schedule-message-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const scheduleMessageAction = vi.fn();
vi.mock("@/app/(app)/conversa/actions", () => ({ scheduleMessageAction }));
import { ScheduleMessageDialog } from "./schedule-message-dialog";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("agendar envio", () => {
  it("manda o dia e a hora de Salvador e o “não sai se ela escrever” marcado por padrão", async () => {
    scheduleMessageAction.mockResolvedValue({ ok: true, data: { at: "2026-10-21T13:00:00.000Z" } });
    const onDone = vi.fn();
    render(<ScheduleMessageDialog open onClose={() => {}} dealId="d1" text="Confirma amanhã?" onDone={onDone} />);
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-10-21" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "10:00" } });
    expect((screen.getByLabelText("Não enviar se a cliente escrever antes") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    await waitFor(() => expect(scheduleMessageAction).toHaveBeenCalledWith({ dealId: "d1", text: "Confirma amanhã?", at: "2026-10-21T13:00:00.000Z", cancelIfReply: true }));
    expect(onDone).toHaveBeenCalledWith("2026-10-21T13:00:00.000Z");
  });
  it("o motivo da recusa do servidor aparece no próprio diálogo", async () => {
    scheduleMessageAction.mockResolvedValue({ ok: false, error: "Nesse horário a Casa está fechada (segunda, a Casa não abre). Escolha um horário com a Casa aberta." });
    render(<ScheduleMessageDialog open onClose={() => {}} dealId="d1" text="Oi" onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("a Casa não abre");
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/bahia-input.test.ts src/components/lead/scheduled-strip.test.tsx src/components/lead/schedule-message-dialog.test.tsx`
Esperado: FAIL (módulos não existem).

- [ ] **Passo 3: Implementar**

`src/lib/bahia-input.ts`:

```ts
/** Campos de dia (type="date") e hora (type="time") sempre no relógio de Salvador (UTC-3 fixo, sem horário de verão). */
const OFFSET_MS = 3 * 3_600_000;
export const bahiaDateInput = (ms: number) => new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
export const bahiaTimeInput = (ms: number) => new Date(ms - OFFSET_MS).toISOString().slice(11, 16);
/** "2026-10-21" + "10:00" → o instante em Salvador; inválido → null. */
export function fromBahiaInputs(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const d = new Date(`${day}T${time}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
```

`src/components/lead/schedule-message-dialog.tsx`:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { scheduleMessageAction } from "@/app/(app)/conversa/actions";
import { bahiaAt } from "@/lib/next-action";
import { bahiaDateInput, bahiaTimeInput, fromBahiaInputs } from "@/lib/bahia-input";
import { stripSignature } from "@/lib/signature";

/** "Agendar envio": dia e hora de Salvador; o servidor confere Casa aberta, 5 min a 60 dias. Padrão: amanhã 10:00. */
export function ScheduleMessageDialog({ open, onClose, dealId, text, onDone }: { open: boolean; onClose: () => void; dealId: string; text: string; onDone: (atIso: string) => void }) {
  const [day, setDay] = useState(""); const [time, setTime] = useState("10:00");
  const [cancelIfReply, setCancelIfReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const t = bahiaAt(Date.now(), 1, 10).getTime();
    setDay(bahiaDateInput(t)); setTime(bahiaTimeInput(t)); setCancelIfReply(true); setError(null);
  }, [open]);
  const submit = () => {
    const at = fromBahiaInputs(day, time);
    if (!at) { setError("Escolha o dia e a hora."); return; }
    start(async () => {
      const r = await scheduleMessageAction({ dealId, text, at: at.toISOString(), cancelIfReply });
      if (!r.ok) { setError(r.error); return; }
      onDone(r.data!.at); onClose();
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="Agendar envio" width={420}
      description="A mensagem sai no dia e hora escolhidos, assinada por você, só com a Casa aberta."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Agendar</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite line-clamp-3">{stripSignature(text)}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia" htmlFor="ag-dia"><Input id="ag-dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Hora" htmlFor="ag-hora"><Input id="ag-hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={cancelIfReply} onChange={(e) => setCancelIfReply(e.target.checked)} className="mt-0.5 size-4" aria-label="Não enviar se a cliente escrever antes" />
          <span>Não enviar se a cliente escrever antes <span className="block text-muted">Você recebe um aviso e decide.</span></span>
        </label>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
```

> Confira os nomes `Field`/`Input` em `src/components/ui/field.tsx`: `Field({ label, hint, error, children, htmlFor })`. Se o `Field` já renderiza o `<label htmlFor>`, o `getByLabelText("Dia")` acha o input pelo `id`.

`src/components/lead/scheduled-strip.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconClock } from "@/components/icons";
import { cancelScheduledAction, sendScheduledNowAction } from "@/app/(app)/conversa/actions";
import { dueLabel } from "@/lib/next-action";
import { firstName } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";

export type ScheduledView = { id: string; text: string; at: string | Date; authorName: string | null; cancelIfReply: boolean };

/** "Agendada para amanhã 10:00 · por Sara", logo acima do campo, com Enviar agora e Cancelar (como o quadro de agendadas do ChatGuru). */
export function ScheduledStrip({ items, onChange }: { items: ScheduledView[]; onChange: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  if (!items.length) return null;
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(done, "ok"); onChange();
  });
  const now = Date.now();
  return (
    <ul aria-label="Mensagens agendadas" className="shrink-0 flex flex-col gap-1.5 border-t border-line bg-paper px-3 pt-2">
      {items.map((s) => (
        <li key={s.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm">
          <IconClock size={15} className="shrink-0 text-gold-ink" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold text-ink" suppressHydrationWarning>Agendada para {dueLabel(new Date(s.at).getTime(), now)}</span>
            {s.authorName && <span className="text-graphite"> · por {firstName(s.authorName)}</span>}
            <span className="block truncate text-graphite">{stripSignature(s.text)}</span>
            {s.cancelIfReply && <span className="block text-xs text-muted">Não sai se ela escrever antes.</span>}
          </p>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => sendScheduledNowAction(s.id), "Mensagem enviada")}>Enviar agora</Button>
          <Button size="sm" variant="ghost" disabled={pending} aria-label="Cancelar a mensagem agendada" onClick={() => act(() => cancelScheduledAction(s.id), "Mensagem agendada cancelada")}>Cancelar</Button>
        </li>
      ))}
    </ul>
  );
}
```

Em `src/components/lead/composer.tsx`:
- imports: `IconClock` no import de ícones; `import { ScheduleMessageDialog } from "./schedule-message-dialog";` e `import { dueLabel } from "@/lib/next-action";`;
- prop nova: `/** Depois de agendar: recarrega a conversa (a agendada aparece acima do campo). */ onScheduled?: () => void;`;
- estado: `const [scheduling, setScheduling] = useState(false);`;
- botão, logo antes do botão de enviar/gravar:

```tsx
          {!noteMode && !attachment && text.trim() && (
            <IconButton label="Agendar envio" size="lg" className="h-11" onClick={() => setScheduling(true)}><IconClock size={20} /></IconButton>
          )}
```

- no fim do JSX (antes do último `</div>`):

```tsx
      <ScheduleMessageDialog open={scheduling} onClose={() => setScheduling(false)} dealId={dealId} text={text.trim()}
        onDone={(at) => { setText(""); toast(`Agendada para ${dueLabel(Date.parse(at), Date.now())}`, "ok"); onScheduled?.(); }} />
```

Em `src/components/queue/conversation-pane.tsx`:
- import `import { ScheduledStrip } from "@/components/lead/scheduled-strip";`;
- logo antes do `<Composer …>`: `<ScheduledStrip items={detail?.scheduled ?? []} onChange={() => { void load(); }} />`;
- no `<Composer …>`: `onScheduled={() => { void load(); }}`.

Em `src/components/lead/lead-sheet.tsx`:
- mesmo import;
- antes do `<Composer …>`: `<ScheduledStrip items={d.scheduled} onChange={() => router.refresh()} />`;
- no `<Composer …>`: `onScheduled={() => router.refresh()}`.

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/bahia-input.test.ts src/components/lead`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela (dev numa porta livre, headless, lead do simulador):
- escrever um texto e tocar no relógio: o diálogo abre em amanhã 10:00;
- clicar em Agendar: aparece "Agendada para amanhã 10:00 · por …" acima do campo;
- clicar em Cancelar: some.

**Não usar "Enviar agora"** fora do simulador.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/bahia-input.ts src/lib/bahia-input.test.ts src/components/lead/schedule-message-dialog.tsx src/components/lead/schedule-message-dialog.test.tsx src/components/lead/scheduled-strip.tsx src/components/lead/scheduled-strip.test.tsx src/components/lead/composer.tsx src/components/queue/conversation-pane.tsx src/components/lead/lead-sheet.tsx
git commit -m "feat(conversa): agendar envio pelo relógio do campo e faixa “Agendada para…” com Enviar agora e Cancelar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 6: Respostas prontas com variáveis ({primeiro_nome}, {data_horario}, {profissional}, {saudacao})

**Arquivos:**
- Criar: `src/lib/quick-reply.ts`, `src/lib/quick-reply.test.ts`
- Criar: `src/server/queries/reply-vars.ts`, `src/server/queries/reply-vars.test.ts`
- Criar: `src/components/lead/composer-vars.test.tsx`
- Modificar: `src/components/lead/composer.tsx` (o `render` e o `fill` atuais, `grep -n "const render = \|const fill = " src/components/lead/composer.tsx`, e o `send`)
- Modificar: `src/server/queries/deal.ts` (`replyVars`)
- Modificar: `src/components/queue/conversation-pane.tsx`, `src/components/lead/lead-sheet.tsx` (passar `vars`)
- Modificar: `src/components/config/lists.tsx` (texto de ajuda da aba Respostas prontas, no `TABS`)

**Interfaces:**
- Consome: `firstName` (1A). Da agenda, só leitura: `appointments` e `professionals`, que são das outras frentes (6A); aqui só lemos.
- Produz:
  - `type ReplyVars = { primeiroNome: string | null; dataHorario: string | null; profissional: string | null }`;
  - `REPLY_VAR_HELP: { token: string; label: string }[]`;
  - `greetingAt(ms: number): string`;
  - `renderReply(body: string | null | undefined, vars: ReplyVars, nowMs?: number): { text: string; missing: string[] }`;
  - `missingVars(text: string): string[]`;
  - `slotLabel(at: Date): string` ("qui 22/10 às 15:00"), `replyVarsOf(dealId: string, now?: Date): Promise<ReplyVars>`;
  - `DealDetail.replyVars: ReplyVars`;
  - `Composer` ganha a prop `vars?: ReplyVars`. Sem ela, vale `{ primeiroNome: firstName }`, o comportamento antigo.

- [ ] **Passo 1: Testes puros e de banco que falham**

`src/lib/quick-reply.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { greetingAt, missingVars, renderReply } from "./quick-reply";

const V = { primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara" };
const MORNING = Date.parse("2026-10-20T12:00:00Z"); // 9:00 em Salvador

describe("respostas prontas: variáveis", () => {
  it("troca nome, data/horário, profissional e saudação", () => {
    expect(renderReply("{saudacao}, {primeiro_nome}! Confirmando {data_horario} com {profissional}.", V, MORNING))
      .toEqual({ text: "Bom dia, Maria! Confirmando qui 22/10 às 15:00 com Maiara.", missing: [] });
  });
  it("{nome} antigo continua valendo como primeiro nome", () => {
    expect(renderReply("Oi, {nome}!", V).text).toBe("Oi, Maria!");
  });
  it("nome desconhecido some sem deixar vírgula sobrando", () => {
    expect(renderReply("Oi, {primeiro_nome}!", { ...V, primeiroNome: null }).text).toBe("Oi!");
  });
  it("data/horário e profissional sem valor ficam no texto e voltam como faltando: nunca vão crus para a cliente", () => {
    expect(renderReply("Confirmando {data_horario} com {profissional}", { primeiroNome: "Maria", dataHorario: null, profissional: null }))
      .toEqual({ text: "Confirmando {data_horario} com {profissional}", missing: ["data e horário", "profissional"] });
  });
  it("chave desconhecida fica como está e as quebras de linha são mantidas", () => {
    expect(renderReply("Linha 1\n\nValor: {preco}", V).text).toBe("Linha 1\n\nValor: {preco}");
  });
  it("saudação pela hora de Salvador", () => {
    expect(greetingAt(Date.parse("2026-10-20T14:59:00Z"))).toBe("Bom dia"); // 11:59
    expect(greetingAt(Date.parse("2026-10-20T15:00:00Z"))).toBe("Boa tarde"); // 12:00
    expect(greetingAt(Date.parse("2026-10-20T21:00:00Z"))).toBe("Boa noite"); // 18:00
  });
  it("na hora de enviar, acusa qualquer variável que ficou no texto", () => {
    expect(missingVars("Oi! Seu horário é {data_horario}")).toEqual(["data e horário"]);
    expect(missingVars("Tudo certo, {preco}")).toEqual([]);
  });
});
```

`src/server/queries/reply-vars.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals, professionals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { replyVarsOf, slotLabel } from "./reply-vars";

const NOW = new Date("2026-10-20T13:00:00Z"); // terça 10:00
let dealId = "", contactId = "", pro = "";
beforeEach(async () => {
  await resetDb();
  const r = await recordInbound({ channelId: null, externalId: "V1", phoneRaw: "71999990031", pushName: "Carla Salgado Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  [{ id: pro }] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
});

describe("variáveis da conversa", () => {
  it("rótulo do horário em Salvador", () => {
    expect(slotLabel(new Date("2026-10-22T18:00:00Z"))).toBe("qui 22/10 às 15:00");
  });
  it("horário marcado no lead, com a profissional escolhida (nome com só a inicial maiúscula)", async () => {
    await db.update(deals).set({ scheduledAt: new Date("2026-10-22T18:00:00Z"), professionalId: pro }).where(eq(deals.id, dealId));
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara" });
  });
  it("sem horário no lead, usa o próximo horário da cliente na agenda; passado e datas absurdas ficam de fora", async () => {
    await db.insert(appointments).values([
      { contactId, serviceLabel: "Escova", startsAt: new Date("2026-10-19T18:00:00Z"), status: "compareceu", externalKey: "t:passado" },
      { contactId, serviceLabel: "Corte", startsAt: new Date("2026-10-24T13:30:00Z"), status: "agendado", professionalId: pro, externalKey: "t:futuro" },
      { contactId, serviceLabel: "Mega", startsAt: new Date("2027-09-01T13:00:00Z"), status: "agendado", externalKey: "t:absurdo" },
    ]);
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: "sáb 24/10 às 10:30", profissional: "Maiara" });
  });
  it("sem nenhum horário futuro, data e profissional ficam vazios", async () => {
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: null, profissional: null });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/quick-reply.test.ts src/server/queries/reply-vars.test.ts`
Esperado: FAIL (módulos não existem).

- [ ] **Passo 3: Implementar**

`src/lib/quick-reply.ts`:

```ts
/** Variáveis das respostas prontas (e da mensagem em massa). Puro: servidor e navegador. {nome} é o nome antigo de {primeiro_nome}. */
export type ReplyVars = { primeiroNome: string | null; dataHorario: string | null; profissional: string | null };

export const REPLY_VAR_HELP: { token: string; label: string }[] = [
  { token: "{primeiro_nome}", label: "primeiro nome da cliente" },
  { token: "{data_horario}", label: "dia e hora do horário marcado (ex.: qui 22/10 às 15:00)" },
  { token: "{profissional}", label: "quem faz o serviço no horário marcado" },
  { token: "{saudacao}", label: "Bom dia, Boa tarde ou Boa noite (hora de Salvador)" },
];
const LABEL: Record<string, string> = { nome: "nome", primeiro_nome: "primeiro nome", data_horario: "data e horário", profissional: "profissional", saudacao: "saudação" };
const VAR = /\{(nome|primeiro_nome|data_horario|profissional|saudacao)\}/g;
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3 fixo

export function greetingAt(ms: number): string {
  const h = new Date(ms - OFFSET_MS).getUTCHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/**
 * Troca as variáveis pelo valor. Nome sem valor some sem deixar vírgula sobrando ("Oi, {primeiro_nome}!" → "Oi!").
 * Data/horário e profissional sem valor FICAM no texto e voltam em `missing`: o campo não deixa enviar com elas.
 * Chave desconhecida ({preco}) fica como está. Quebras de linha são mantidas.
 */
export function renderReply(body: string | null | undefined, vars: ReplyVars, nowMs = Date.now()): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = (body ?? "").replace(VAR, (all, key: string) => {
    if (key === "nome" || key === "primeiro_nome") return vars.primeiroNome?.trim() ?? "";
    if (key === "saudacao") return greetingAt(nowMs);
    const v = key === "data_horario" ? vars.dataHorario : vars.profissional;
    if (v?.trim()) return v.trim();
    missing.add(LABEL[key]);
    return all;
  }).replace(/,\s*([!?.])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { text, missing: [...missing] };
}

/** Variáveis que ainda estão no texto na hora de enviar (a pessoa colou ou não trocou). */
export function missingVars(text: string): string[] {
  return [...new Set([...text.matchAll(VAR)].map((m) => LABEL[m[1]]))];
}
```

`src/server/queries/reply-vars.ts`:

```ts
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, professionals } from "../db/schema";
import { firstName } from "@/lib/authorship";
import type { ReplyVars } from "@/lib/quick-reply";

const OFFSET_MS = 3 * 3_600_000;
const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
/** Até quanto tempo para a frente um horário vale (regra do Lote 0: datas absurdas do Avec ficam de fora). */
const FUTURE_MAX_MS = 180 * 86_400_000;

/** "qui 22/10 às 15:00" (Salvador). */
export function slotLabel(at: Date): string {
  const d = new Date(at.getTime() - OFFSET_MS);
  return `${WEEK[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** "MAIARA" (apelido do Avec) → "Maiara". */
const nice = (s: string | null | undefined) => (s?.trim() ? s.trim().toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : null);

/** Valores das variáveis na conversa: o horário marcado no lead; sem ele, o próximo horário da cliente na agenda (Avec ou CRM). */
export async function replyVarsOf(dealId: string, now = new Date()): Promise<ReplyVars> {
  const [row] = await db.select({ name: contacts.name, contactId: contacts.id, scheduledAt: deals.scheduledAt, proName: professionals.name })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).leftJoin(professionals, eq(professionals.id, deals.professionalId))
    .where(eq(deals.id, dealId));
  if (!row) return { primeiroNome: null, dataHorario: null, profissional: null };
  const primeiroNome = firstName(row.name);
  const max = new Date(now.getTime() + FUTURE_MAX_MS);
  if (row.scheduledAt && row.scheduledAt > now && row.scheduledAt <= max) return { primeiroNome, dataHorario: slotLabel(row.scheduledAt), profissional: nice(row.proName) };
  const [appt] = await db.select({ startsAt: appointments.startsAt, proName: professionals.name }).from(appointments)
    .leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.contactId, row.contactId), gt(appointments.startsAt, now), lte(appointments.startsAt, max), inArray(appointments.status, ["agendado", "confirmado"])))
    .orderBy(asc(appointments.startsAt)).limit(1);
  return { primeiroNome, dataHorario: appt ? slotLabel(appt.startsAt) : null, profissional: nice(appt?.proName) };
}
```

Em `src/server/queries/deal.ts`:
- `import { replyVarsOf } from "./reply-vars";`;
- acrescentar `replyVarsOf(id)` como último item do `Promise.all` e `replyVars` na desestruturação;
- no retorno: `/** Valores de {primeiro_nome}, {data_horario} e {profissional} nesta conversa (Lote 5). */ replyVars,`.

- [ ] **Passo 4: Rodar e ver passar (servidor e puro)**

Rodar: `npx vitest run src/lib/quick-reply.test.ts src/server/queries/reply-vars.test.ts`
Esperado: PASS.

- [ ] **Passo 5: Teste do campo que falha**

`src/components/lead/composer-vars.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const sendMessageAction = vi.fn(async () => ({ ok: true as const, data: { waitedSeconds: null } }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
import { Composer } from "./composer";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const replies = [{ id: "q1", label: "confirma", body: "Oi, {primeiro_nome}! Confirmando {data_horario} com {profissional}." }];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = async () => {
  const field = screen.getByLabelText("Mensagem");
  fireEvent.change(field, { target: { value: "/conf" } });
  fireEvent.click(screen.getByRole("button", { name: /\/confirma/ }));
  await wait(500); // o campo não envia nos 450 ms depois de preencher (tempo de revisar)
  return field as HTMLTextAreaElement;
};

describe("respostas prontas com variáveis no campo", () => {
  it("sem horário marcado, o texto cru nunca sai: o envio é bloqueado", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: null, profissional: null }} />);
    const field = await pick();
    expect(field.value).toBe("Oi, Maria! Confirmando {data_horario} com {profissional}.");
    fireEvent.keyDown(field, { key: "Enter" });
    await wait(50);
    expect(sendMessageAction).not.toHaveBeenCalled();
  });
  it("com horário e profissional, sai preenchida", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={{ primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara" }} />);
    const field = await pick();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", "Oi, Maria! Confirmando qui 22/10 às 15:00 com Maiara.", null));
  });
});
```

Rodar: `npx vitest run src/components/lead/composer-vars.test.tsx`
Esperado: FAIL. O campo ainda usa o `render` antigo, que só troca `{nome}`, e envia o texto cru.

- [ ] **Passo 6: Campo com as variáveis**

Em `src/components/lead/composer.tsx`:
- import: `import { missingVars, renderReply, type ReplyVars } from "@/lib/quick-reply";`;
- prop nova, no tipo e na desestruturação: `/** Valores das variáveis desta conversa (getDealDetail.replyVars). */ vars?: ReplyVars;`;
- trocar o `render` e o `fill` atuais por:

```ts
  const v: ReplyVars = useMemo(() => vars ?? { primeiroNome: firstName || null, dataHorario: null, profissional: null }, [vars, firstName]);
  const render = (b: string | null) => renderReply(b, v).text;
  const fill = (q: Reply) => {
    const r = renderReply(q.body, v);
    setText(r.text); setSel(0); justFilled.current = true; setTimeout(() => { justFilled.current = false; }, 450);
    if (r.missing.length) toast(`Falta preencher: ${r.missing.join(" e ")}. Troque no texto antes de enviar.`, "info");
    requestAnimationFrame(() => ref.current?.focus());
  };
```

- em `send`, logo depois de `if (justFilled.current) return;`:

```ts
    const missing = missingVars(text);
    if (missing.length) { toast(`Falta preencher: ${missing.join(" e ")}. Troque no texto antes de enviar.`, "error"); return; }
```

Nas telas:
- `src/components/queue/conversation-pane.tsx`, no `<Composer …>`: `vars={detail?.replyVars}`;
- `src/components/lead/lead-sheet.tsx`, no `<Composer …>`: `vars={d.replyVars}`.

Em `src/components/config/lists.tsx`, no `TABS`, trocar o texto da aba `quick_reply` por:

```ts
"Aparecem ao digitar / na conversa. Variáveis: {primeiro_nome}, {data_horario}, {profissional} e {saudacao}. Data e profissional vêm do horário marcado; sem horário, o campo não deixa enviar até trocar."
```

e o `placeholder` do `Textarea` da resposta para `"Oi, {primeiro_nome}! …"`.

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/components/lead src/lib/quick-reply.test.ts src/server/queries/reply-vars.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 8: Commit**

```bash
git add src/lib/quick-reply.ts src/lib/quick-reply.test.ts src/server/queries/reply-vars.ts src/server/queries/reply-vars.test.ts src/components/lead/composer-vars.test.tsx src/components/lead/composer.tsx src/server/queries/deal.ts src/components/queue/conversation-pane.tsx src/components/lead/lead-sheet.tsx src/components/config/lists.tsx
git commit -m "feat(respostas): variáveis {primeiro_nome}, {data_horario}, {profissional} e {saudacao}; o texto cru nunca vai para a cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 7: Respostas prontas com pastas e anexo

**Arquivos:**
- Criar: `src/server/domain/quick-replies.ts`, `src/server/domain/quick-replies.test.ts`
- Criar: `src/app/(app)/config/respostas/actions.ts`
- Criar: `src/app/api/respostas/[id]/arquivo/route.ts`
- Criar: `src/components/lead/composer-reply-file.test.tsx`
- Modificar: `src/server/domain/send.ts`: exportar `planMedia` e o tipo `Upload` (`grep -n "^function planMedia\|^type Upload" src/server/domain/send.ts`)
- Modificar: `src/server/queries/deal.ts` (o mapeamento de `quickReplies`)
- Modificar: `src/components/config/lists.tsx` (`Item`, `Row` e o `ListsEditor` na aba Respostas prontas) e `src/app/(app)/config/listas/page.tsx`
- Modificar: `src/components/lead/composer.tsx` (pasta e 📎 no "/", arquivo junto)
- Modificar: `src/app/(app)/conversa/actions.ts` (`sendQuickReplyAction`)

**Interfaces:**
- Consome: `sendFromCrm`, `sendMediaFromCrm`, `MAX_MEDIA_BYTES`, `SendError`, `planMedia`, `save` e `mediaDir` (de `src/server/whatsapp/media.ts`). Da Tarefa 6: `missingVars`.
- Produz:
  - `type QuickReplyAttachment = { path: string; mime: string; name: string; kind: "image" | "video" | "audio" | "document" }`;
  - `quickReplyAttachment(meta: unknown): QuickReplyAttachment | null`;
  - `FOLDER_MAX = 40`;
  - `setQuickReplyFolder(id, folder: string | null, userId): Promise<void>`;
  - `attachToQuickReply(id, file: Upload, userId): Promise<QuickReplyAttachment>`;
  - `detachFromQuickReply(id, userId): Promise<void>`;
  - `readQuickReplyFile(id): Promise<{ data: Buffer; att: QuickReplyAttachment } | null>`;
  - `sendQuickReply(dealId, replyId, text, userId): Promise<{ textSent: boolean; fileSent: boolean }>`;
  - ações:
    - `setQuickReplyFolderAction(id, folder)`, `attachQuickReplyFileAction(form: FormData)` (campos `id` e `file`), `detachQuickReplyFileAction(id)` (`config.editar`);
    - `sendQuickReplyAction(input: { dealId: string; replyId: string; text: string }): Promise<ActionResult<{ waitedSeconds: number | null }>>` (`atendimento.ver`);
  - rota `GET /api/respostas/[id]/arquivo`;
  - `DealDetail.quickReplies: { id; label; body; folder: string | null; attachment: { name: string; kind: string } | null }[]`, ordenadas por pasta.

- [ ] **Passo 1: Testes do domínio que falham**

`src/server/domain/quick-replies.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, lists, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { attachToQuickReply, detachFromQuickReply, quickReplyAttachment, sendQuickReply, setQuickReplyFolder } from "./quick-replies";
import { mediaDir } from "../whatsapp/media";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";

const PDF = Buffer.from("%PDF-1.7 tabela de precos");
const calls: string[] = []; let failText = false; let failMedia = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { if (failText) throw new ProviderError("texto recusado", 500); calls.push(`text:${text}`); return { externalId: `T${calls.length}` }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string; name: string }) => { if (failMedia) throw new ProviderError("arquivo recusado", 500); calls.push(`media:${f.mime}:${f.name}`); return { externalId: `M${calls.length}` }; },
  sendAudio: async () => { calls.push("audio"); return { externalId: "A1" }; },
};
let uid = "", dealId = "", replyId = "";
beforeEach(async () => {
  calls.length = 0; failText = false; failMedia = false;
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999990041", pushName: "Cliente Teste", body: "Quanto custa?" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  [{ id: replyId }] = await db.insert(lists).values({ kind: "quick_reply", label: "tabela-teste-l5", body: "Segue a nossa tabela 😊" }).returning();
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));
const row = async () => (await db.select().from(lists).where(eq(lists.id, replyId)))[0];

describe("respostas prontas: pasta e anexo", () => {
  it("pasta: grava sem espaços sobrando, limpa e recusa nome longo", async () => {
    await setQuickReplyFolder(replyId, "  Preços  ", uid);
    expect((await row()).category).toBe("Preços");
    await setQuickReplyFolder(replyId, "", uid);
    expect((await row()).category).toBeNull();
    await expect(setQuickReplyFolder(replyId, "x".repeat(41), uid)).rejects.toThrow(/máximo 40/);
  });

  it("anexo: guarda o PDF; trocar apaga o anterior; tirar apaga arquivo e registro", async () => {
    const a = await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    expect(a).toMatchObject({ name: "tabela.pdf", mime: "application/pdf", kind: "document" });
    expect(existsSync(path.join(mediaDir(), a.path))).toBe(true);
    const b = await attachToQuickReply(replyId, { name: "tabela-nova.pdf", mime: "application/pdf", data: PDF }, uid);
    expect(existsSync(path.join(mediaDir(), a.path))).toBe(false);
    expect(quickReplyAttachment((await row()).meta)?.name).toBe("tabela-nova.pdf");
    await detachFromQuickReply(replyId, uid);
    expect(quickReplyAttachment((await row()).meta)).toBeNull();
    expect(existsSync(path.join(mediaDir(), b.path))).toBe(false);
  });

  it("recusa arquivo disfarçado (o tipo vem dos bytes)", async () => {
    await expect(attachToQuickReply(replyId, { name: "x.pdf", mime: "application/pdf", data: Buffer.from("<html>") }, uid)).rejects.toThrow(/tipo de arquivo/);
  });

  it("envia o texto e depois o arquivo; com texto vazio, só o arquivo", async () => {
    await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await sendQuickReply(dealId, replyId, "Segue a nossa tabela 😊", uid);
    expect(calls).toEqual([expect.stringMatching(/^text:.*Segue a nossa tabela/s), "media:application/pdf:tabela.pdf"]);
    calls.length = 0;
    await sendQuickReply(dealId, replyId, "  ", uid);
    expect(calls).toEqual(["media:application/pdf:tabela.pdf"]);
  });

  it("texto não saiu: o arquivo não vai; arquivo falhou depois do texto: avisa que só o texto saiu", async () => {
    await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    failText = true;
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow(/texto recusado/);
    expect(calls).toEqual([]);
    failText = false; failMedia = true;
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow("O texto saiu, mas o arquivo não: arquivo recusado. Anexe e envie de novo.");
    expect(calls).toHaveLength(1);
  });

  it("anexo que sumiu do disco: erro claro e nada sai", async () => {
    const a = await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await unlink(path.join(mediaDir(), a.path));
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow(/não está mais disponível/);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/quick-replies.test.ts`
Esperado: FAIL (`Cannot find module './quick-replies'`).

- [ ] **Passo 3: Domínio**

Em `src/server/domain/send.ts`, trocar `type Upload = …` por `export type Upload = …` e `function planMedia(` por `export function planMedia(`. Só isso; o comportamento não muda.

`src/server/domain/quick-replies.ts`:

```ts
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists } from "../db/schema";
import { mediaDir, save as saveMediaFile } from "../whatsapp/media";
import { MAX_MEDIA_BYTES, SendError, planMedia, sendFromCrm, sendMediaFromCrm, type Upload } from "./send";
import { UserFacingError } from "./errors";

export type QuickReplyAttachment = { path: string; mime: string; name: string; kind: "image" | "video" | "audio" | "document" };
export const FOLDER_MAX = 40;

export function quickReplyAttachment(meta: unknown): QuickReplyAttachment | null {
  const a = (meta as { attachment?: Partial<QuickReplyAttachment> } | null)?.attachment;
  return a && typeof a.path === "string" && typeof a.mime === "string" && typeof a.name === "string" && typeof a.kind === "string" ? (a as QuickReplyAttachment) : null;
}
const audit = (userId: string, action: string, id: string, data: Record<string, unknown>) => db.insert(auditLog).values({ userId, action, entity: "list", entityId: id, data });

async function replyRow(id: string) {
  const [r] = await db.select().from(lists).where(and(eq(lists.id, id), eq(lists.kind, "quick_reply")));
  if (!r) throw new UserFacingError("Essa resposta pronta não existe mais.");
  return r;
}
const removeFile = (rel: string) => unlink(path.join(mediaDir(), rel)).catch(() => {});

/** Pasta da resposta pronta (agrupa a lista do "/" e a tela de Configurações). Vazio = sem pasta. */
export async function setQuickReplyFolder(id: string, folder: string | null, userId: string): Promise<void> {
  await replyRow(id);
  const f = folder?.trim().replace(/\s+/g, " ") || null;
  if (f && f.length > FOLDER_MAX) throw new UserFacingError(`Nome da pasta muito longo (máximo ${FOLDER_MAX} caracteres).`);
  await db.update(lists).set({ category: f }).where(eq(lists.id, id));
  await audit(userId, "editou", id, { pasta: f });
}

/** Anexo da resposta pronta: foto, PDF, vídeo ou áudio até 16 MB, tipo conferido pelos bytes. Troca o anterior (e apaga o arquivo velho). */
export async function attachToQuickReply(id: string, file: Upload, userId: string): Promise<QuickReplyAttachment> {
  const row = await replyRow(id);
  if (!file.data.length) throw new UserFacingError("O arquivo está vazio.");
  if (file.data.length > MAX_MEDIA_BYTES) throw new UserFacingError("O arquivo passa de 16 MB. Escolha um menor.");
  const plan = planMedia(file);
  if (!plan) throw new UserFacingError("Esse tipo de arquivo não pode ser enviado. Use foto, PDF, vídeo ou áudio.");
  const name = path.basename(file.name).replace(/[\u0000-\u001f\u007f"\\]/g, "").trim().slice(0, 120) || `arquivo.${plan.ext}`;
  const stored = await saveMediaFile(`resposta-${randomUUID()}.${plan.ext}`, file.data);
  const att: QuickReplyAttachment = { path: stored, mime: plan.mime, name, kind: plan.kind };
  const old = quickReplyAttachment(row.meta);
  await db.update(lists).set({ meta: { ...((row.meta as Record<string, unknown> | null) ?? {}), attachment: att } }).where(eq(lists.id, id));
  if (old) await removeFile(old.path);
  await audit(userId, "anexou", id, { arquivo: name, tipo: plan.mime });
  return att;
}

export async function detachFromQuickReply(id: string, userId: string): Promise<void> {
  const row = await replyRow(id);
  const old = quickReplyAttachment(row.meta);
  if (!old) return;
  const { attachment: _drop, ...rest } = (row.meta as Record<string, unknown> | null) ?? {};
  await db.update(lists).set({ meta: Object.keys(rest).length ? rest : null }).where(eq(lists.id, id));
  await removeFile(old.path);
  await audit(userId, "tirou_anexo", id, { arquivo: old.name });
}

export async function readQuickReplyFile(id: string): Promise<{ data: Buffer; att: QuickReplyAttachment } | null> {
  const [r] = await db.select({ meta: lists.meta }).from(lists).where(and(eq(lists.id, id), eq(lists.kind, "quick_reply")));
  const att = quickReplyAttachment(r?.meta);
  if (!att) return null;
  try { return { data: await readFile(path.join(mediaDir(), att.path)), att }; } catch { return null; }
}

/**
 * Resposta pronta com anexo pelo campo da conversa: primeiro o texto (assinado, como toda mensagem do CRM), depois o arquivo (sem legenda).
 * Texto vazio: só o arquivo. Se o texto não sair, o arquivo não vai; se o arquivo falhar depois do texto, avisa que só o texto saiu.
 * Áudio vai como mensagem de voz (o "áudio pré-gravado" do ChatGuru).
 */
export async function sendQuickReply(dealId: string, replyId: string, text: string, userId: string): Promise<{ textSent: boolean; fileSent: boolean }> {
  const file = await readQuickReplyFile(replyId);
  if (!file) throw new UserFacingError("O anexo dessa resposta pronta não está mais disponível. Envie só o texto ou anexe de novo em Configurações.");
  const typed = text.trim();
  if (typed) await sendFromCrm(dealId, typed, userId);
  try {
    await sendMediaFromCrm(dealId, { name: file.att.name, mime: file.att.mime, data: file.data }, null, userId);
  } catch (e) {
    if (typed && e instanceof SendError) throw new SendError(`O texto saiu, mas o arquivo não: ${e.message.replace(/^Não foi possível enviar: /, "")}. Anexe e envie de novo.`);
    throw e;
  }
  return { textSent: !!typed, fileSent: true };
}
```

> A retenção de mídia (`src/server/whatsapp/retention.ts`) só apaga arquivos ligados a `messages`. Os anexos das respostas (`resposta-*.ext` em `MEDIA_DIR`) não são tocados.

- [ ] **Passo 4: Rodar e ver passar (domínio)**

Rodar: `npx vitest run src/server/domain/quick-replies.test.ts src/server/domain/send-media.test.ts`
Esperado: PASS.

- [ ] **Passo 5: Ações, rota e detalhe da conversa**

`src/app/(app)/config/respostas/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { attachToQuickReply, detachFromQuickReply, setQuickReplyFolder } from "@/server/domain/quick-replies";
import { MAX_MEDIA_BYTES } from "@/server/domain/send";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "respostas") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.editar"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/listas"); return { ok: true, data }; } catch (e) { return fail(e); }
}
const uuid = z.string().uuid();

export const setQuickReplyFolderAction = async (id: string, folder: string | null) => run((u) => setQuickReplyFolder(uuid.parse(id), folder, u));
export const attachQuickReplyFileAction = async (form: FormData) => run(async (u) => {
  const id = uuid.parse(form.get("id"));
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Escolha um arquivo.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("O arquivo passa de 16 MB. Escolha um menor.");
  const att = await attachToQuickReply(id, { name: file.name, mime: file.type, data: Buffer.from(await file.arrayBuffer()) }, u);
  return { name: att.name, kind: att.kind };
});
export const detachQuickReplyFileAction = async (id: string) => run((u) => detachFromQuickReply(uuid.parse(id), u));
```

`src/app/api/respostas/[id]/arquivo/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { findSessionUser } from "@/server/auth/sessions-store";
import { isUuid } from "@/lib/uuid";
import { readQuickReplyFile } from "@/server/domain/quick-replies";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";

/** Anexo de uma resposta pronta (prévia em Configurações). Só para quem atende ou configura. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "atendimento.ver") && !can(user.perms, "config.editar")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const f = await readQuickReplyFile(id);
  if (!f) return new Response("anexo indisponível", { status: 404 });
  const headers = mediaHeaders(sniffMime(f.data.subarray(0, 256 * 1024)), f.att.name);
  return new Response(new Uint8Array(f.data), { headers: { ...headers, "content-length": String(f.data.length) } });
}
```

Em `src/app/(app)/conversa/actions.ts`, acrescentar os imports `import { sendQuickReply } from "@/server/domain/quick-replies";` e `import { waitedBusinessSeconds } from "@/server/domain/deals";`, e a ação:

```ts
/** Resposta pronta com anexo: o texto (assinado) e depois o arquivo dela. */
export async function sendQuickReplyAction(input: { dealId: string; replyId: string; text: string }): Promise<ActionResult<{ waitedSeconds: number | null }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const dealId = uuid.parse(input.dealId);
    const waitedSeconds = await waitedBusinessSeconds(dealId);
    await sendQuickReply(dealId, uuid.parse(input.replyId), z.string().max(4000).parse(input.text), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { waitedSeconds } };
  } catch (e) { return fail(e); }
}
```

Em `src/server/queries/deal.ts`:
- `import { quickReplyAttachment } from "../domain/quick-replies";`;
- trocar `quickReplies: listRows.filter((l) => l.kind === "quick_reply"),` por:

```ts
    /** Respostas prontas por pasta (a ordem dentro da pasta é a de Configurações) e com o anexo, se houver (Lote 5). */
    quickReplies: listRows.filter((l) => l.kind === "quick_reply")
      .map((l) => { const a = quickReplyAttachment(l.meta); return { id: l.id, label: l.label, body: l.body, folder: l.category ?? null, attachment: a ? { name: a.name, kind: a.kind } : null }; })
      .sort((a, b) => (a.folder ?? "").localeCompare(b.folder ?? "", "pt-BR")),
```

- [ ] **Passo 6: Configurações (pasta e anexo em cada resposta)**

Em `src/app/(app)/config/listas/page.tsx`:
- import `import { quickReplyAttachment } from "@/server/domain/quick-replies";`;
- no `rows.map`, acrescentar ao objeto: `attachment: r.kind === "quick_reply" ? ((a) => (a ? { name: a.name, kind: a.kind } : null))(quickReplyAttachment(r.meta)) : null,`.

Em `src/components/config/lists.tsx`:
- imports: `useRef` no import do React; `import { attachQuickReplyFileAction, detachQuickReplyFileAction, setQuickReplyFolderAction } from "@/app/(app)/config/respostas/actions";`;
- no tipo `Item`, acrescentar `/** Respostas prontas: anexo (Lote 5); a pasta usa `category`. */ attachment?: { name: string; kind: string } | null;`;
- no `ListsEditor`, logo depois do `datalist` de serviços:

```tsx
      {tab === "quick_reply" && (
        <datalist id="pastas-respostas">{[...new Set(current.map((i) => i.category).filter((c): c is string => !!c))].sort().map((c) => <option key={c} value={c} />)}</datalist>
      )}
```

- ainda no `ListsEditor`, a lista da aba Respostas prontas sai agrupada por pasta. Troque `const current = items.filter((i) => i.kind === tab);` por:

```ts
  const current = items.filter((i) => i.kind === tab)
    .sort((a, b) => (tab === "quick_reply" ? (a.category ?? "").localeCompare(b.category ?? "", "pt-BR") : 0));
```

e, no `current.map((i) => …)`, troque o `<motion.li …><Row i={i} /></motion.li>` por:

```tsx
<motion.li key={i.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
  {tab === "quick_reply" && (idx === 0 || (current[idx - 1].category ?? "") !== (i.category ?? "")) && (
    <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-gold-ink">{i.category ?? "Sem pasta"}</p>
  )}
  <Row i={i} />
</motion.li>
```

(com `current.map((i, idx) => …)`);
- em `Row`, logo depois do `textarea` da resposta (`{i.kind === "quick_reply" && <textarea …/>}`): `{i.kind === "quick_reply" && <QuickReplyExtras i={i} />}`;
- novo componente no fim do arquivo:

```tsx
/** Resposta pronta: pasta (agrupa no "/") e um anexo opcional (foto, PDF, vídeo ou áudio que vai junto, depois do texto). */
function QuickReplyExtras({ i }: { i: Item }) {
  const [folder, setFolder] = useState(i.category ?? "");
  const [pending, start] = useTransition(); const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const saveFolder = () => {
    if (folder.trim() === (i.category ?? "")) return;
    start(async () => { const r = await setQuickReplyFolderAction(i.id, folder.trim() || null); if (!r.ok) toast(r.error, "error"); });
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    start(async () => { const fd = new FormData(); fd.set("id", i.id); fd.set("file", f); const r = await attachQuickReplyFileAction(fd); toast(r.ok ? "Anexo salvo" : r.error, r.ok ? "ok" : "error"); });
  };
  const remove = () => start(async () => { const r = await detachQuickReplyFileAction(i.id); toast(r.ok ? "Anexo tirado" : r.error, r.ok ? "ok" : "error"); });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <input value={folder} onChange={(e) => setFolder(e.target.value)} onBlur={saveFolder} list="pastas-respostas" placeholder="Pasta (opcional)" aria-label={`Pasta de /${i.label}`}
        className="h-8 w-44 rounded-[var(--radius-control)] border border-line bg-paper px-2" />
      {i.attachment ? (
        <>
          <a href={`/api/respostas/${i.id}/arquivo`} target="_blank" rel="noreferrer" className="underline underline-offset-2">📎 {i.attachment.name}</a>
          <button type="button" disabled={pending} onClick={() => file.current?.click()} className="font-medium text-gold-ink">Trocar</button>
          <button type="button" disabled={pending} onClick={remove} className="font-medium text-alert">Tirar anexo</button>
        </>
      ) : (
        <button type="button" disabled={pending} onClick={() => file.current?.click()} className="font-medium text-gold-ink">Anexar arquivo</button>
      )}
      <input ref={file} type="file" hidden accept="image/*,application/pdf,audio/*,video/mp4" aria-label={`Arquivo de /${i.label}`}
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
```

- [ ] **Passo 7: Campo da conversa (pasta, 📎 e arquivo junto), teste primeiro**

`src/components/lead/composer-reply-file.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const sendMessageAction = vi.fn(async () => ({ ok: true as const, data: { waitedSeconds: null } }));
const sendQuickReplyAction = vi.fn(async () => ({ ok: true as const, data: { waitedSeconds: null } }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction, sendMediaAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction }));
import { Composer } from "./composer";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const replies = [{ id: "q1", label: "tabela", body: "Segue a tabela, {primeiro_nome}!", folder: "Preços", attachment: { name: "tabela.pdf", kind: "document" } }];
const vars = { primeiroNome: "Maria", dataHorario: null, profissional: null };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const choose = async () => {
  const field = screen.getByLabelText("Mensagem");
  fireEvent.change(field, { target: { value: "/pre" } }); // acha pela pasta
  const opt = screen.getByRole("button", { name: /Preços · \/tabela/ });
  expect(opt.textContent).toContain("📎 tabela.pdf");
  fireEvent.click(opt);
  await wait(500);
  return field;
};

describe("resposta pronta com anexo no campo", () => {
  it("escolher leva o arquivo junto e envia pela resposta pronta", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    const field = await choose();
    expect(screen.getByRole("group", { name: "Arquivo da resposta pronta" }).textContent).toContain("tabela.pdf");
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendQuickReplyAction).toHaveBeenCalledWith({ dealId: "d1", replyId: "q1", text: "Segue a tabela, Maria!" }));
    expect(sendMessageAction).not.toHaveBeenCalled();
  });
  it("tirar o arquivo manda só o texto", async () => {
    render(<Composer dealId="d1" firstName="Maria" quickReplies={replies} onOptimistic={() => {}} vars={vars} />);
    const field = await choose();
    fireEvent.click(screen.getByRole("button", { name: "Não enviar o arquivo" }));
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(sendMessageAction).toHaveBeenCalledWith("d1", "Segue a tabela, Maria!", null));
    expect(sendQuickReplyAction).not.toHaveBeenCalled();
  });
});
```

Rodar: `npx vitest run src/components/lead/composer-reply-file.test.tsx`
Esperado: FAIL (a lista não mostra pasta nem 📎).

Em `src/components/lead/composer.tsx`:
1. `type Reply = { id: string; label: string; body: string | null; folder?: string | null; attachment?: { name: string; kind: string } | null };`
2. Import: acrescentar `sendQuickReplyAction` ao import de `@/app/(app)/conversa/actions`.
3. Estado: `const [replyFile, setReplyFile] = useState<{ replyId: string; name: string } | null>(null);`
4. `matches`: também pela pasta, `q.label.toLowerCase().includes(slash) || (q.folder ?? "").toLowerCase().includes(slash) || (q.body ?? "").toLowerCase().includes(slash)`.
5. No item da lista do "/", trocar `<span className="text-xs font-semibold text-gold-ink">/{q.label}</span>` por:

```tsx
<span className="text-xs font-semibold text-gold-ink">{q.folder ? `${q.folder} · ` : ""}/{q.label}{q.attachment ? ` · 📎 ${q.attachment.name}` : ""}</span>
```

6. Em `fill`, depois de `setText(r.text);`: `setReplyFile(q.attachment ? { replyId: q.id, name: q.attachment.name } : null); setAttachment(null);`.
7. Em `attach` (arquivo escolhido à mão), primeira linha: `setReplyFile(null);`.
8. `canSend`: `!!(text.trim() || (!noteMode && (attachment || replyFile))) && !recording`.
9. Em `send`, logo depois de `const done = (…) => { … };` e antes de `if (att) {`:

```ts
    if (replyFile && !att) {
      const rf = replyFile;
      setReplyFile(null); setText(""); onClearReply?.();
      start(async () => {
        const r = await sendQuickReplyAction({ dealId, replyId: rf.replyId, text: body });
        done(r, () => { setReplyFile(rf); setText(body); });
      });
      return;
    }
```

10. Logo depois do bloco `{attachment && (…)}` dentro do `AnimatePresence`:

```tsx
        {replyFile && !attachment && (
          <motion.div key="reply-file" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.fast, ease: EASE }}
            className="mb-2 flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-paper-2 p-2" role="group" aria-label="Arquivo da resposta pronta">
            <span className="size-10 shrink-0 grid place-items-center rounded-[8px] bg-paper text-xs font-semibold text-gold-ink">{replyFile.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "ARQ"}</span>
            <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{replyFile.name}</span><span className="text-muted">vai junto, depois do texto</span></p>
            <IconButton label="Não enviar o arquivo" size="lg" onClick={() => setReplyFile(null)}><IconTrash size={16} /></IconButton>
          </motion.div>
        )}
```

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/components/lead src/server/domain/quick-replies.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS. O `guard-coverage` aceita a rota (tem `can(user.perms,`) e as ações (`run` com `assertPerm(perm)`; `sendQuickReplyAction` com `assertPerm`).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela (dev, headless): em Configurações › Listas e respostas › Respostas prontas:
- pôr a pasta "Preços" e anexar um PDF de teste (fictício);
- na conversa de um lead do simulador, "/pre" mostra "Preços · /… · 📎 …";
- escolher a resposta: aparece o cartão "vai junto, depois do texto".

**Não enviar fora do simulador.**

- [ ] **Passo 9: Commit**

```bash
git add src/server/domain/quick-replies.ts src/server/domain/quick-replies.test.ts "src/app/(app)/config/respostas/actions.ts" "src/app/api/respostas/[id]/arquivo/route.ts" src/components/lead/composer-reply-file.test.tsx src/server/domain/send.ts src/server/queries/deal.ts src/components/config/lists.tsx "src/app/(app)/config/listas/page.tsx" src/components/lead/composer.tsx "src/app/(app)/conversa/actions.ts"
git commit -m "feat(respostas): pastas e anexo nas respostas prontas; o arquivo vai junto, depois do texto assinado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 8: "Resolvido (não precisa responder)" ao lado do "Aguardando cliente"

**Arquivos:**
- Criar: `src/server/domain/resolve.ts`, `src/server/domain/resolve.test.ts`
- Criar: `src/lib/resolved.ts`, `src/lib/resolved.test.ts`
- Modificar: `src/server/domain/events.ts` (`DealEventType`), `src/lib/history.ts`, `src/lib/history-lote5.test.ts`
- Modificar: `src/server/queries/deal.ts` (`resolvedByName` no `select` principal de `getDealDetail`)
- Modificar: `src/components/queue/use-lead-actions.tsx` (`LeadActions.resolve`, `NO_ACTIONS`)
- Modificar: `src/components/queue/client-pane.tsx`: o `NextSteps` e a seção "Situação". Ache com `grep -n 'key: "aguardar"\|key: "encerrar"\|<Outcome d={d} />' src/components/queue/client-pane.tsx`.
- Modificar: `src/components/queue/pane-header.tsx` (menu "Mais ações": `grep -n '"Encerrar conversa"' src/components/queue/pane-header.tsx`)
- Modificar: `src/app/(app)/conversa/actions.ts` (`resolveAction`, `undoResolveAction`)

**Interfaces:**
- Consome (Tarefa 1): `deals.resolvedAt`, `deals.resolvedById`. Do 1B: `sinceLabel`, `firstName`. Do 1C: o item `aguardar` no `NextSteps`.
- Produz:
  - `resolveWithoutReply(dealId: string, userId: string, now?: Date): Promise<{ resolved: boolean }>`;
  - `undoResolve(dealId: string, userId: string): Promise<void>`;
  - eventos `resolvida` (`payload.desde`, ISO) e `resolvida_desfeita`;
  - `resolvedLabel(d: { resolvedAt; lastInboundAt; resolvedByName }, nowMs: number): string | null`;
  - `DealDetail.resolvedByName: string | null`;
  - `LeadActions.resolve: () => void`;
  - ações `resolveAction(dealId: string): Promise<ActionResult<{ resolved: boolean }>>` e `undoResolveAction(dealId: string): Promise<ActionResult>`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/resolve.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { resolveWithoutReply, undoResolve } from "./resolve";

const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let sara = "", dealId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990051", pushName: "Cliente Teste", body: "Vou ver com meu marido e te falo", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  await db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Cliente Teste espera resposta", dedupeKey: "w1", waitKey: `${dealId}:${T0.toISOString()}` });
});
const deal = async () => (await db.select().from(deals).where(eq(deals.id, dealId)))[0];

describe("Resolvido (não precisa responder)", () => {
  it("encerra a espera sem mandar nada: sai do prazo e dos avisos; a etapa não muda e a conversa continua na Fila", async () => {
    const before = await deal();
    expect((await resolveWithoutReply(dealId, sara, plus(10))).resolved).toBe(true);
    const after = await deal();
    expect(after).toMatchObject({ awaitingReplySince: null, resolvedById: sara, resolvedAt: plus(10), stageId: before.stageId, conversationArchivedAt: null, lastOutboundAt: null });
    expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resolvida")));
    expect(ev.map((e) => [e.payload, e.userId])).toEqual([[{ desde: T0.toISOString() }, sara]]);
  });

  it("sem espera, não há o que resolver", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    expect((await resolveWithoutReply(dealId, sara, plus(11))).resolved).toBe(false);
  });

  it("a cliente escreve de novo: volta a esperar resposta", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71999990051", body: "Falei com ele, pode ser sábado?", at: plus(20), now: plus(20) });
    expect((await deal()).awaitingReplySince).toEqual(plus(20));
  });

  it("Desfazer devolve a espera de onde estava; depois que a Casa respondeu, não desfaz", async () => {
    await resolveWithoutReply(dealId, sara, plus(10));
    await undoResolve(dealId, sara);
    expect(await deal()).toMatchObject({ awaitingReplySince: T0, resolvedAt: null, resolvedById: null });
    await resolveWithoutReply(dealId, sara, plus(12));
    await recordOutbound({ dealId, channelId: null, body: "Combinado!", userId: sara, at: plus(15) });
    await expect(undoResolve(dealId, sara)).rejects.toThrow(/A Casa já respondeu/);
  });

  it("conversa marcada como “Não é cliente” ou fechada: recusa", async () => {
    await db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, dealId));
    await expect(resolveWithoutReply(dealId, sara)).rejects.toThrow(/não está mais aberta/);
  });
});
```

`src/lib/resolved.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolvedLabel } from "./resolved";

const NOW = Date.parse("2026-10-20T17:30:00Z"); // 14:30 em Salvador
describe("situação “resolvida”", () => {
  it("mostra quem resolveu e quando, enquanto a cliente não escreve de novo", () => {
    expect(resolvedLabel({ resolvedAt: "2026-10-20T17:02:00Z", lastInboundAt: "2026-10-20T16:00:00Z", resolvedByName: "Sara Lima" }, NOW)).toBe("Resolvida sem resposta por Sara · 14:02");
  });
  it("a cliente escreveu depois: some", () => {
    expect(resolvedLabel({ resolvedAt: "2026-10-20T17:02:00Z", lastInboundAt: "2026-10-20T17:10:00Z", resolvedByName: "Sara" }, NOW)).toBeNull();
  });
  it("nunca resolvida: nada", () => {
    expect(resolvedLabel({ resolvedAt: null, lastInboundAt: null, resolvedByName: null }, NOW)).toBeNull();
  });
});
```

Em `src/lib/history-lote5.test.ts`, acrescentar dentro do `describe`:

```ts
  it("resolvida e desfeita", () => {
    expect(text("resolvida", { desde: "2026-10-20T12:00:00.000Z" })).toBe("Resolvida sem resposta (não precisava responder)");
    expect(text("resolvida_desfeita")).toBe("“Resolvida” desfeita: voltou a esperar resposta");
  });
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/resolve.test.ts src/lib/resolved.test.ts src/lib/history-lote5.test.ts`
Esperado: FAIL (módulos não existem; o histórico mostra "Outro registro do sistema").

- [ ] **Passo 3: Domínio, texto e histórico**

`src/server/domain/resolve.ts`:

```ts
import { and, desc, eq, isNotNull, isNull, notLike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals } from "../db/schema";
import { emit, logEvent } from "./events";
import { UserFacingError } from "./errors";

/** Os avisos de espera do lead: a mesma regra de `recordOutbound` (lembrete de tarefa, `task:<id>`, não é espera). */
const waitAlertsOf = (dealId: string) => and(isNull(alerts.resolvedAt), or(
  and(eq(alerts.dealId, dealId), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")),
  and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.waitKey)),
));

/**
 * "Resolvido (não precisa responder)": a última mensagem da cliente não pede resposta ("vou ver e te falo", "já paguei").
 * Encerra a espera sem mandar nada: sai do prazo e dos avisos, a etapa não muda e a conversa continua na Fila (não é "Encerrar conversa").
 * Volta a esperar sozinha quando ela escrever de novo (recordInbound).
 */
export async function resolveWithoutReply(dealId: string, userId: string, now = new Date()): Promise<{ resolved: boolean }> {
  const r = await db.transaction(async (tx) => {
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d || d.closedAt || d.archivedAt) throw new UserFacingError("Essa conversa não está mais aberta.");
    if (!d.awaitingReplySince) return { resolved: false };
    await tx.update(deals).set({ awaitingReplySince: null, resolvedAt: now, resolvedById: userId }).where(eq(deals.id, dealId));
    await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` }).where(waitAlertsOf(dealId));
    await logEvent(tx, dealId, "resolvida", { desde: d.awaitingReplySince.toISOString() }, userId);
    return { resolved: true };
  });
  if (r.resolved) await emit("lead_atualizado", { dealId });
  return r;
}

/** Desfazer: a espera volta de onde estava. Recusa se a Casa já escreveu ou se a cliente já escreveu de novo. */
export async function undoResolve(dealId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d?.resolvedAt) throw new UserFacingError("Essa conversa não está como resolvida.");
    if (d.lastOutboundAt && d.lastOutboundAt > d.resolvedAt) throw new UserFacingError("A Casa já respondeu depois: não há espera para voltar.");
    if (d.awaitingReplySince) throw new UserFacingError("A cliente já escreveu de novo: a conversa já está esperando resposta.");
    const [ev] = await tx.select({ payload: dealEvents.payload }).from(dealEvents)
      .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "resolvida"))).orderBy(desc(dealEvents.createdAt)).limit(1);
    const desde = typeof ev?.payload.desde === "string" ? new Date(ev.payload.desde) : null;
    if (!desde) throw new UserFacingError("Não deu para desfazer: falta o início da espera.");
    await tx.update(deals).set({ awaitingReplySince: desde, resolvedAt: null, resolvedById: null }).where(eq(deals.id, dealId));
    await logEvent(tx, dealId, "resolvida_desfeita", {}, userId);
  });
  await emit("lead_atualizado", { dealId });
}
```

`src/lib/resolved.ts`:

```ts
import { sinceLabel } from "./alert-copy";
import { firstName } from "./authorship";

/** "Resolvida sem resposta por Sara · 14:02" enquanto a cliente não escreve de novo; depois disso, null. */
export function resolvedLabel(d: { resolvedAt: Date | string | null; lastInboundAt: Date | string | null; resolvedByName: string | null }, nowMs: number): string | null {
  if (!d.resolvedAt) return null;
  const at = new Date(d.resolvedAt).getTime();
  if (d.lastInboundAt && new Date(d.lastInboundAt).getTime() > at) return null;
  return `Resolvida sem resposta${d.resolvedByName ? ` por ${firstName(d.resolvedByName)}` : ""} · ${sinceLabel(at, nowMs)}`;
}
```

Em `src/server/domain/events.ts`, acrescentar à união: `| "resolvida" | "resolvida_desfeita"`.

Em `src/lib/history.ts`, antes do `default:`:

```ts
    case "resolvida": return one("Resolvida sem resposta (não precisava responder)");
    case "resolvida_desfeita": return one("“Resolvida” desfeita: voltou a esperar resposta");
```

- [ ] **Passo 4: Rodar e ver passar (domínio e puro)**

Rodar: `npx vitest run src/server/domain/resolve.test.ts src/lib/resolved.test.ts src/lib/history-lote5.test.ts`
Esperado: PASS.

- [ ] **Passo 5: Ações e tela**

Em `src/app/(app)/conversa/actions.ts`, import `import { resolveWithoutReply, undoResolve } from "@/server/domain/resolve";` e:

```ts
export async function resolveAction(dealId: string): Promise<ActionResult<{ resolved: boolean }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const r = await resolveWithoutReply(uuid.parse(dealId), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

export async function undoResolveAction(dealId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await undoResolve(uuid.parse(dealId), user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true };
  } catch (e) { return fail(e); }
}
```

Em `src/server/queries/deal.ts`, no `select` principal de `getDealDetail` (o que tem `lastReplyName: teamNameOf(deals.lastReplyById)`), acrescentar `resolvedByName: teamNameOf(deals.resolvedById),`.

Em `src/components/queue/use-lead-actions.tsx`:
- import `import { resolveAction, undoResolveAction } from "@/app/(app)/conversa/actions";`;
- no tipo `LeadActions`, depois de `archiveConversation`: `/** "Resolvido (não precisa responder)": encerra a espera sem mandar nada, com Desfazer. */ resolve: () => void;`;
- depois do `archiveConversation`:

```ts
  const resolve = useCallback(() => {
    if (!d) return;
    const id = d.deal.id;
    start(async () => {
      const r = await resolveAction(id);
      if (!r.ok) { toast(r.error, "error"); return; }
      await reload();
      if (!r.data?.resolved) { toast("Ela não estava esperando resposta", "info"); return; }
      toast("Resolvida: saiu do prazo e dos avisos. Volta se ela escrever.", "ok", {
        label: "Desfazer",
        onClick: () => { void undoResolveAction(id).then(async (u) => { if (!u.ok) { toast(u.error, "error"); return; } await reload(); toast("Voltou a esperar resposta"); }); },
      });
    });
  }, [d, reload, toast]);
```

- no `return { … }` do hook, acrescentar `resolve`;
- em `NO_ACTIONS`, acrescentar `resolve: () => {}`.

Em `src/components/queue/client-pane.tsx`:
- import `import { resolvedLabel } from "@/lib/resolved";`;
- logo depois de `const lastOut = …`: `const resolved = resolvedLabel({ resolvedAt: d.deal.resolvedAt, lastInboundAt: d.deal.lastInboundAt, resolvedByName: d.resolvedByName }, Date.now());`;
- na seção "Situação", logo depois de `<Outcome d={d} />`: `{resolved && <p data-testid="resolvida" className="text-sm text-graphite" suppressHydrationWarning>{resolved}</p>}`;
- no array `steps` do `NextSteps`, logo depois do item `aguardar` do 1C (ou, se ele não existir, do item `retomar`):

```tsx
                ...(d.deal.awaitingReplySince ? [{ key: "resolvido", icon: <IconCheck size={18} />, label: "Resolvido (não precisa responder)",
                  hint: "Sai do prazo e dos avisos; volta se ela escrever", highlight: false, run: actions.resolve }] : []),
```

Em `src/components/queue/pane-header.tsx`, na lista `items`, logo antes do item "Encerrar conversa":

```ts
    ...(d && d.deal.awaitingReplySince && !d.deal.closedAt && !d.deal.archivedAt ? [{ label: "Resolvido (não precisa responder)", onSelect: actions.resolve }] : []),
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. O `typecheck` pega quem monta `LeadActions` à mão: os testes que usam `NO_ACTIONS` já recebem `resolve`.

Conferência na tela (dev, headless, lead do simulador esperando resposta):
- "Resolvido (não precisa responder)" aparece nos próximos passos e no menu "Mais ações";
- ao clicar, o relógio de espera some, aparece "Resolvida sem resposta por …" e o aviso traz "Desfazer";
- Desfazer devolve o relógio.

- [ ] **Passo 7: Commit**

```bash
git add src/server/domain/resolve.ts src/server/domain/resolve.test.ts src/lib/resolved.ts src/lib/resolved.test.ts src/server/domain/events.ts src/lib/history.ts src/lib/history-lote5.test.ts src/server/queries/deal.ts src/components/queue/use-lead-actions.tsx src/components/queue/client-pane.tsx src/components/queue/pane-header.tsx "src/app/(app)/conversa/actions.ts"
git commit -m "feat(conversa): Resolvido (não precisa responder) encerra a espera sem mandar nada, com Desfazer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 9: Ligações perdidas e reações na conversa (hoje descartadas no webhook)

**Arquivos:**
- Modificar: `src/server/whatsapp/webhook.ts`:
  - o tipo `BaileysMessage`: `reactionMessage` e `callLogMesssage`;
  - a lista `SILENT` (por volta de `webhook.ts:71-72`);
  - `parseContent`, `handleEvolutionEvent`, `ingestEvolution` (chave do evento) e `processHistoryEvents`.
- Modificar: `src/server/whatsapp/evolution.ts` (`WEBHOOK_EVENTS` ganha `"CALL"`)
- Modificar: `src/components/lead/conversation.tsx` (linha da ligação e reações no balão) e `src/components/lead/conversation.test.tsx`
- Modificar: `src/components/lead/timeline.ts` (`messagesToMsgs` leva `reactions`)
- Criar: `src/server/whatsapp/webhook-lote5.test.ts`
- Criar: `scripts/sincronizar-webhook.ts`

**Interfaces:**
- Consome (Tarefa 1): `messages.reactions`. Do código atual: `recordInbound`, `messageTime`, `normalizePhone`.
- Produz:
  - `callOutcome(c: { isVideo?: boolean; callOutcome?: number | string } | null | undefined): { missed: boolean; video: boolean } | null`;
  - `reactionOf(raw: BaileysMessage | null | undefined): { targetId: string; emoji: string } | null`;
  - mensagem `kind = "call"`, `direction = "in"`, `body = "Ligação perdida" | "Ligação de vídeo perdida"`. Ela abre a espera como qualquer mensagem da cliente. O `externalId` é `call:<id>` (evento CALL) ou o id do registro;
  - `messages.reactions = { cliente?: emoji; casa?: emoji } | null`;
  - `WEBHOOK_EVENTS` com `"CALL"`;
  - `Msg.reactions?: { cliente?: string; casa?: string } | null`;
  - CLI `npx tsx scripts/sincronizar-webhook.ts --dry-run | --aplicar`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/whatsapp/webhook-lote5.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, messages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { callOutcome, ingestEvolution, parseContent } from "./webhook";
import { WEBHOOK_EVENTS } from "./evolution";
import { fromPhone, inboundText } from "../../../test/fixtures/evolution";

const JID = "5571999990061@s.whatsapp.net";
const CLIENT = "5571999812244@s.whatsapp.net"; // o número dos fixtures inboundText/fromPhone
const TS = 1791550931; // 2026-10-09T13:02:11Z
const callLog = (id: string, outcome: number | string, fromMe = false, video = false) => ({ event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: JID, fromMe, id }, pushName: "Cliente Ligação", message: { callLogMesssage: { isVideo: video, callOutcome: outcome, durationSecs: 0 }, messageContextInfo: {} }, messageTimestamp: TS } });
const callEvent = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ event: "call", instance: "casa-principal",
  data: { id, from: JID, chatId: JID, status, isVideo: false, isGroup: false, date: new Date(TS * 1000 + 30_000).toISOString(), offline: false, ...extra } });
const reaction = (id: string, target: string, text: string, fromMe = false, jid = CLIENT) => ({ event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: jid, fromMe, id }, message: { reactionMessage: { key: { id: target, remoteJid: jid, fromMe: !fromMe }, text } }, messageTimestamp: TS + 120 } });
const calls = async () => (await db.select().from(messages)).filter((m) => m.kind === "call");

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "casa-principal", status: "conectado", phone: "+557133330000" });
});

describe("ligações", () => {
  it("o registro do WhatsApp diz se a ligação foi perdida", () => {
    expect(callOutcome({ callOutcome: 1 })).toEqual({ missed: true, video: false });
    expect(callOutcome({ callOutcome: "REJECTED", isVideo: true })).toEqual({ missed: true, video: true });
    expect(callOutcome({ callOutcome: 0 })).toEqual({ missed: false, video: false });
    expect(parseContent({ callLogMesssage: { callOutcome: "ACCEPTED_ELSEWHERE" } } as never)).toBeNull();
  });

  it("ligação perdida entra na conversa e abre a espera (a cliente quer falar)", async () => {
    await ingestEvolution(callLog("C1", 1));
    const [c] = await calls();
    expect(c).toMatchObject({ direction: "in", body: "Ligação perdida" });
    expect((await db.select().from(deals))[0].awaitingReplySince).not.toBeNull();
  });

  it("ligação atendida ou feita pela Casa não vira linha nem lead", async () => {
    await ingestEvolution(callLog("C2", 0));
    await ingestEvolution(callLog("C3", 1, true));
    expect(await calls()).toHaveLength(0);
    expect(await db.select().from(deals)).toHaveLength(0);
  });

  it("evento CALL: só a que ninguém atendeu ou foi recusada entra; tocando, atendida e grupo não", async () => {
    await ingestEvolution(callEvent("X1", "offer"));
    await ingestEvolution(callEvent("X1", "accept"));
    await ingestEvolution(callEvent("X9", "timeout", { isGroup: true }));
    expect(await calls()).toHaveLength(0);
    await ingestEvolution(callEvent("X2", "timeout"));
    expect((await calls()).map((m) => m.externalId)).toEqual(["call:X2"]);
  });

  it("a mesma ligação pelos dois caminhos (evento CALL e registro da conversa) vira uma linha só", async () => {
    await ingestEvolution(callEvent("X3", "timeout"));
    await ingestEvolution(callLog("C4", "MISSED"));
    expect(await calls()).toHaveLength(1);
  });

  it("o webhook pede as ligações à Evolution", () => {
    expect(WEBHOOK_EVENTS).toContain("CALL");
  });
});

describe("reações", () => {
  const m = async (ext: string) => (await db.select().from(messages).where(eq(messages.externalId, ext)))[0];

  it("reação da cliente fica na mensagem da Casa; tirar a reação limpa; não vira mensagem nem abre espera", async () => {
    await ingestEvolution(inboundText("M1"));
    await ingestEvolution(fromPhone("M2"));
    const before = (await db.select().from(deals))[0].awaitingReplySince;
    await ingestEvolution(reaction("R1", "M2", "❤️"));
    expect((await m("M2")).reactions).toEqual({ cliente: "❤️" });
    expect(await db.select().from(messages)).toHaveLength(2);
    expect((await db.select().from(deals))[0].awaitingReplySince).toEqual(before);
    await ingestEvolution(reaction("R2", "M2", ""));
    expect((await m("M2")).reactions).toBeNull();
  });

  it("reação da Casa (pelo celular) fica do lado da Casa", async () => {
    await ingestEvolution(inboundText("M1"));
    await ingestEvolution(reaction("R3", "M1", "👍", true));
    expect((await m("M1")).reactions).toEqual({ casa: "👍" });
  });

  it("reação a mensagem que não está no CRM: sem erro, sem contato novo, sem mensagem", async () => {
    const r = await ingestEvolution(reaction("R4", "NAO-EXISTE", "😂", false, JID));
    expect(r).toMatchObject({ ok: true, kind: "reaction", found: false });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });
});
```

Em `src/components/lead/conversation.test.tsx`, acrescentar:

```tsx
describe("ligações e reações", () => {
  it("ligação perdida aparece como registro no meio da conversa", () => {
    render(<Conversation messages={[msg({ id: "c1", kind: "call", body: "Ligação perdida", externalId: "call:1" })]} />);
    expect(screen.getByTestId("ligacao").textContent).toContain("Ligação perdida");
  });
  it("reação aparece embaixo do balão, dizendo de quem é", () => {
    render(<Conversation messages={[msg({ id: "m1", reactions: { cliente: "❤️" } })]} />);
    expect(screen.getByLabelText("Reação da cliente: ❤️")).toBeTruthy();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/whatsapp/webhook-lote5.test.ts src/components/lead/conversation.test.tsx`
Esperado: FAIL. `callOutcome` não existe, a ligação é descartada e a reação não é gravada.

- [ ] **Passo 3: Webhook**

Em `src/server/whatsapp/evolution.ts`:

```ts
export const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_SET", "SEND_MESSAGE", "CONNECTION_UPDATE", "CALL"] as const;
```

Em `src/server/whatsapp/webhook.ts`:

1. Import: acrescentar `import type { MessageReactions } from "../db/schema";` (o `messages` já vem de `../db/schema`).

2. No tipo `BaileysMessage`, trocar `reactionMessage?: object;` por:

```ts
  reactionMessage?: { key?: { id?: string; fromMe?: boolean }; text?: string };
  /** Registro de ligação no chat (o Baileys escreve com 3 "s"). */
  callLogMesssage?: { isVideo?: boolean; callOutcome?: number | string; durationSecs?: number };
```

3. Em `SILENT`, **tirar** `"callLogMesssage"` (manter `"bcallMessage"` e `"reactionMessage"`).

4. Antes de `parseContent`:

```ts
/** Ligação perdida = ninguém atendeu, recusada, falhou ou silenciada (enum CallOutcome do WhatsApp, número ou nome). */
const MISSED_OUTCOMES = new Set<number | string>([1, "MISSED", 2, "FAILED", 3, "REJECTED", 6, "SILENCED_BY_DND", 7, "SILENCED_UNKNOWN_CALLER"]);
export function callOutcome(c: { isVideo?: boolean; callOutcome?: number | string } | null | undefined): { missed: boolean; video: boolean } | null {
  if (!c) return null;
  return { missed: c.callOutcome !== undefined && MISSED_OUTCOMES.has(c.callOutcome), video: !!c.isVideo };
}

/** Reação do WhatsApp: em qual mensagem (id externo) e qual emoji ("" = tirou a reação). */
export function reactionOf(raw: BaileysMessage | null | undefined): { targetId: string; emoji: string } | null {
  const r = raw ? unwrap(raw as Loose).reactionMessage : undefined;
  return r?.key?.id ? { targetId: r.key.id, emoji: (r.text ?? "").trim() } : null;
}
```

5. Em `parseContent`, logo depois da linha do `SILENT` (`if (keys.length === 0 || keys.every(…)) return null;`):

```ts
  if (m.callLogMesssage) {
    const c = callOutcome(m.callLogMesssage);
    return c?.missed ? { kind: "call", body: c.video ? "Ligação de vídeo perdida" : "Ligação perdida" } : null;
  }
```

6. Funções novas, antes de `handleEvolutionEvent`:

```ts
/** A reação fica na mensagem (a última de cada lado). Nunca vira mensagem nem abre espera. Mensagem que não está no CRM: ignora. */
async function applyReaction(r: { targetId: string; emoji: string }, fromMe: boolean) {
  const side: keyof MessageReactions = fromMe ? "casa" : "cliente";
  const reactions = r.emoji
    ? sql`coalesce(${messages.reactions}, '{}'::jsonb) || jsonb_build_object(${side}::text, ${r.emoji}::text)`
    : sql`nullif(coalesce(${messages.reactions}, '{}'::jsonb) - ${side}::text, '{}'::jsonb)`;
  const rows = await db.update(messages).set({ reactions }).where(eq(messages.externalId, r.targetId)).returning({ dealId: messages.dealId });
  if (rows[0]?.dealId) await emit("mensagem_atualizada", { dealId: rows[0].dealId });
  return { found: rows.length > 0 };
}

type EvoCallData = { id?: string; from?: string; chatId?: string; status?: string; isVideo?: boolean; isGroup?: boolean; date?: string | number };
/** A mesma ligação pode chegar pelo evento CALL e pelo registro do chat (callLogMesssage): uma linha só, numa janela de 3 min. */
const CALL_DEDUPE_MS = 3 * 60_000;
async function recordMissedCall(i: { channelId: string | null; externalId: string; jid: string; lid: string | null; video: boolean; at: Date; pushName?: string | null }) {
  const { normalizePhone } = await import("../domain/phone");
  const phone = i.jid ? normalizePhone(i.jid) : null;
  const who = phone ? sql`c.phone_e164 = ${phone}` : i.lid ? sql`c.wa_lid = ${i.lid}` : sql`false`;
  const dup = await db.execute(sql`select 1 from messages m join contacts c on c.id = m.contact_id
    where ${who} and m.kind = 'call' and m.direction = 'in'
      and m.created_at between ${new Date(i.at.getTime() - CALL_DEDUPE_MS).toISOString()}::timestamptz and ${new Date(i.at.getTime() + CALL_DEDUPE_MS).toISOString()}::timestamptz
    limit 1`);
  if (dup.rows.length) return { ok: true, ignored: "ligacao_repetida" };
  const r = await recordInbound({ channelId: i.channelId, externalId: i.externalId, phoneRaw: i.jid, lid: i.lid, pushName: i.pushName ?? null, kind: "call",
    body: i.video ? "Ligação de vídeo perdida" : "Ligação perdida", at: i.at });
  return { ok: true, kind: "call", result: r };
}

/** Evento CALL da Evolution (formato do Baileys). Só a que ninguém atendeu ("timeout") ou foi recusada ("reject") entra na conversa. */
const MISSED_CALL_STATUS = new Set(["timeout", "reject"]);
async function handleCall(c: EvoCallData | undefined, channelId: string | null) {
  const status = String(c?.status ?? "").toLowerCase();
  if (!c?.id || c.isGroup || !MISSED_CALL_STATUS.has(status)) return { ok: true, ignored: `ligacao_${status || "sem_status"}` };
  const jid = c.chatId ?? c.from ?? "";
  const lid = jid.endsWith("@lid") ? jid.split("@")[0] : null;
  if (!lid && !jid.endsWith("@s.whatsapp.net")) return { ok: true, ignored: "ligacao_sem_numero" };
  const raw = typeof c.date === "number" ? new Date(c.date < 1e12 ? c.date * 1000 : c.date) : c.date ? new Date(c.date) : new Date();
  return recordMissedCall({ channelId, externalId: `call:${c.id}`, jid: lid ? "" : jid, lid, video: !!c.isVideo, at: Number.isNaN(raw.getTime()) ? new Date() : raw });
}
```

7. Em `handleEvolutionEvent`, logo depois de `if (event === "messages.set") return …;` (e **antes** do `if (Array.isArray(p.data))`):

```ts
  if (event === "call") return handleCall((Array.isArray(p.data) ? p.data[0] : p.data) as unknown as EvoCallData | undefined, channelId);
```

8. No ramo `messages.upsert`/`send.message`, logo depois de `if (!jid || !d.key?.id) return { ok: true, ignored: "sem_chave" };`:

```ts
    const reaction = reactionOf(d.message);
    if (reaction) return { ok: true, kind: "reaction", ...(await applyReaction(reaction, !!d.key.fromMe)) };
```

e logo depois de `const at = messageTime(d.messageTimestamp);`:

```ts
    if (content.kind === "call") {
      if (d.key.fromMe) return { ok: true, ignored: "ligacao_da_casa" };
      return recordMissedCall({ channelId, externalId: d.key.id, jid: hidden ? "" : jid, lid, video: content.body === "Ligação de vídeo perdida", at, pushName: d.pushName });
    }
```

9. Em `ingestEvolution`, a chave do evento também usa o id da ligação:

```ts
  const k = one?.key?.id ?? one?.keyId ?? (eventName(p.event) === "call" ? (one as { id?: string } | undefined)?.id : undefined);
```

10. Em `processHistoryEvents`, depois de `if (!jid || !d.key?.id || !content || !d.messageTimestamp) continue;`:

```ts
        if (content.kind === "call" && d.key.fromMe) continue; // ligação feita pela Casa não é mensagem
```

> A Evolution tem `rejectCall` e `msgCall` (responder ligação sozinha). Os dois continuam **desligados**: este lote não mexe nas configurações da instância, só pede o evento.

- [ ] **Passo 4: Conversa (linha da ligação e reações)**

Em `src/components/lead/conversation.tsx`:
1. Tipo `Msg`: `/** Reações do WhatsApp (a última de cada lado). */ reactions?: { cliente?: string; casa?: string } | null;`.
2. `KIND_LABEL`: acrescentar `call: "Ligação"`.
3. `sameMsg`: acrescentar `&& (a.reactions?.cliente ?? null) === (b.reactions?.cliente ?? null) && (a.reactions?.casa ?? null) === (b.reactions?.casa ?? null)`.
4. `withDays`: na condição de `cont`, acrescentar `m.kind !== "call" && prev?.kind !== "call" &&`.
5. Import `IconPhone` de `@/components/icons`. Antes de `Bubble`:

```tsx
/** Ligação perdida: registro no meio da conversa, como no WhatsApp. */
function CallRow({ m, day }: { m: Msg; day: string | null }) {
  return (
    <div className="flex flex-col">
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <p data-testid="ligacao" className="self-center my-1 inline-flex items-center gap-1.5 rounded-full border border-alert/30 bg-alert-soft px-3 py-1 text-xs font-medium text-alert">
        <IconPhone size={13} aria-hidden />{m.body ?? "Ligação"} · {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}
const REACTION_WHO = { cliente: "da cliente", casa: "da Casa" } as const;
```

6. Em `Bubble`, junto do `if (m.kind === "nota") …` da Tarefa 3: `if (m.kind === "call") return <CallRow m={m} day={day} />;`.
7. Em `Bubble`, logo depois da linha de status (o `<span className="flex items-center justify-end gap-1 text-[10.5px] …">…</span>`) e antes do aviso de falha:

```tsx
          {(m.reactions?.cliente || m.reactions?.casa) && (
            <span className={`mt-1 flex gap-1 ${out ? "justify-end" : "justify-start"}`}>
              {(["cliente", "casa"] as const).filter((k) => m.reactions?.[k]).map((k) => (
                <span key={k} aria-label={`Reação ${REACTION_WHO[k]}: ${m.reactions![k]}`} title={`Reação ${REACTION_WHO[k]}`}
                  className="rounded-full border border-line bg-paper px-1.5 text-sm leading-6 shadow-[var(--shadow-card)]">{m.reactions![k]}</span>
              ))}
            </span>
          )}
```

Em `src/components/lead/timeline.ts`, em `messagesToMsgs`, acrescentar ao objeto: `reactions: m.reactions ?? null,`.

- [ ] **Passo 5: Script para pedir o evento CALL à Evolution de produção**

`scripts/sincronizar-webhook.ts`:

```ts
import "dotenv/config";
import { db, pool } from "../src/server/db";
import { channels } from "../src/server/db/schema";
import { whatsapp, WEBHOOK_EVENTS } from "../src/server/whatsapp/evolution";

/**
 * Reaplica a lista de eventos do webhook (agora com CALL, Lote 5) em cada número. Não envia mensagem nem mexe em rejectCall/msgCall.
 * --dry-run: só mostra o que faria. --aplicar: chama /webhook/set de cada instância.
 */
async function main() {
  const apply = process.argv.includes("--aplicar");
  if (!apply && !process.argv.includes("--dry-run")) throw new Error("Use --dry-run (só mostra) ou --aplicar.");
  if (/127\.0\.0\.1:9\b/.test(process.env.EVOLUTION_URL ?? "")) throw new Error("EVOLUTION_URL é o endereço morto dos testes: nada a fazer.");
  const list = await db.select({ name: channels.name, instance: channels.instanceName, status: channels.status }).from(channels);
  console.log(`Eventos que ficarão ligados: ${WEBHOOK_EVENTS.join(", ")}`);
  for (const c of list) {
    console.log(`${apply ? "Aplicando" : "Ensaio"}: ${c.name} (${c.instance}, ${c.status})`);
    if (apply) await whatsapp().syncWebhook?.(c.instance);
  }
  console.log(apply ? "Feito. Confira em Configurações › WhatsApp que o número segue conectado." : "Ensaio: nada foi alterado.");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/whatsapp src/components/lead`
Esperado: PASS. O teste antigo "reação não vira mensagem" (`webhook.test.ts`) continua passando: o fixture dele não tem `key` na reação, então cai no `SILENT` como antes.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência só do ensaio do script, no worktree com a Evolution morta: `npx tsx scripts/sincronizar-webhook.ts --dry-run`. Esperado: "EVOLUTION_URL é o endereço morto dos testes: nada a fazer." **Não rodar `--aplicar` fora de produção.**

- [ ] **Passo 7: Commit**

```bash
git add src/server/whatsapp/webhook.ts src/server/whatsapp/evolution.ts src/server/whatsapp/webhook-lote5.test.ts src/components/lead/conversation.tsx src/components/lead/conversation.test.tsx src/components/lead/timeline.ts scripts/sincronizar-webhook.ts
git commit -m "feat(webhook): ligação perdida entra na conversa (abre a espera) e reações aparecem no balão; evento CALL pedido à Evolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 10: Mensagem em massa no servidor (NASCE DESLIGADA, permissão da gestão, intervalo anti-bloqueio)

**Arquivos:**
- Criar: `src/server/domain/campaigns.ts`, `src/server/domain/campaigns.test.ts`
- Modificar: `src/lib/permissions.ts` (permissão nova) e `src/lib/permissions.test.ts` (o teste de `GESTAO_OPTIONAL`, `grep -n "GESTAO_OPTIONAL" src/lib/permissions.test.ts`)
- Modificar: `src/lib/alert-copy.ts` (`alertText.campaignDone`, `GROUP_OF`, `ALERT_HELP`)
- Modificar: `worker/index.ts` (fila `envio-massa`, a cada minuto)

**Interfaces:**
- Consome (Tarefa 1): `campaigns`, `campaignRecipients`. Da Tarefa 6: `renderReply`. Do código atual: `getSendCap()` (`messaging-settings.ts`), `isOpen`, `getBusinessHours`, `whatsapp().sendText`, `can`, `isHiddenNumber`, `firstName`.
- Produz:
  - permissão `"mensagem.massa"` ("Mandar mensagem em massa"), no grupo Contatos. Está em `GESTAO_OPTIONAL`, então ninguém tem por padrão;
  - `MASS_SETTING = "envio_massa"`;
  - `CAMPAIGN_MIN_INTERVAL_S = 120`, `CAMPAIGN_DEFAULT_INTERVAL_S = 180`, `CAMPAIGN_MAX_RECIPIENTS = 300`, `CAMPAIGN_DAILY_CAP = 150`, `CAMPAIGN_RECENT_DAYS = 7`, `CAMPAIGN_BODY_MAX = 1000`;
  - `type Audience = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] }`;
  - `type ExclusionReason = "nao_e_cliente" | "numero_oculto" | "conversa_aberta" | "recebeu_recente" | "nunca_escreveu"`, `EXCLUSION_LABEL`;
  - `getMassSettings(): Promise<{ enabled: boolean }>`, `saveMassSettings(input: { enabled: boolean }, userId): Promise<void>`;
  - `previewAudience(a: Audience, now?): Promise<AudiencePreview>`, com `AudiencePreview = { found; eligible; excluded: { reason; label; n }[]; sample: { id; name; phone }[]; tooMany }`;
  - `createCampaign(input: { name; body; audience: Audience; intervalSeconds? }, actor: { id; perms }, now?): Promise<{ id: string; total: number }>`;
  - `confirmCampaign(id, input: { typedTotal: number; acceptRisk: boolean; startAt?: Date | null }, actor, now?): Promise<{ startAt: Date; endsAround: Date }>`;
  - `pauseCampaign(id, actor)`, `resumeCampaign(id, actor)`, `cancelCampaign(id, actor)`;
  - `type CampaignSender = (i: { instance: string; phone: string; text: string }) => Promise<{ externalId: string | null }>`;
  - `drainCampaigns(now?, send?: CampaignSender): Promise<{ sent; failed; skipped; waiting?: "desligada" | "casa_fechada" | "limite_do_dia" | "teto_por_hora" | "intervalo" }>`;
  - `listCampaigns(limit?): Promise<CampaignSummary[]>`;
  - alertas `massa_concluida` e `massa_pausada` (grupo "WhatsApp e envios"), `alertText.campaignDone(name, sent, failed)`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/campaigns.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, campaignRecipients, campaigns, channels, contacts, deals, messages, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { cancelCampaign, confirmCampaign, createCampaign, drainCampaigns, pauseCampaign, previewAudience, saveMassSettings } from "./campaigns";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
let gestao = "";
let actor: { id: string; perms: string[] } = { id: "", perms: [] };
const sent: { phone: string; text: string }[] = [];
let failSend = false;
const sender = async (i: { instance: string; phone: string; text: string }) => {
  if (failSend) throw new Error("Evolution recusou");
  sent.push({ phone: i.phone, text: i.text });
  return { externalId: `MASS${sent.length}` };
};
/** Contato que já escreveu para a Casa e não tem conversa aberta: pode receber. */
async function wrote(name: string, phone: string) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone }).returning();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-09-01T13:00:00Z") });
  return c.id;
}
async function ready(ids: string[], interval = 180) {
  const { id } = await createCampaign({ name: "Retorno", body: "{saudacao}, {primeiro_nome}! Sentimos sua falta.", audience: { contactIds: ids }, intervalSeconds: interval }, actor, T0);
  await confirmCampaign(id, { typedTotal: ids.length, acceptRisk: true }, actor, T0);
  return id;
}
const recips = async (id: string) => db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));

beforeEach(async () => {
  sent.length = 0; failSend = false;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: gestao }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  actor = { id: gestao, perms: ["mensagem.massa"] };
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" });
});

describe("mensagem em massa", () => {
  it("nasce desligada: sem a chave ninguém monta; sem a permissão também", async () => {
    const a = await wrote("Ana Teste", "+5571999990071");
    await expect(createCampaign({ name: "Retorno", body: "Oi!", audience: { contactIds: [a] } }, actor, T0)).rejects.toThrow(/desligada em Configurações/);
    await saveMassSettings({ enabled: true }, gestao);
    await expect(createCampaign({ name: "Retorno", body: "Oi!", audience: { contactIds: [a] } }, { id: gestao, perms: [] }, T0)).rejects.toThrow(/não tem permissão/);
    expect(await db.select().from(campaigns)).toHaveLength(0);
  });

  it("prévia: quem recebe e quem fica de fora, com o motivo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const ok = await wrote("Ana Teste", "+5571999990071");
    const ign = await wrote("Bia Teste", "+5571999990072");
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, ign));
    const [hid] = await db.insert(contacts).values({ name: "Oculta Teste", phoneE164: "lid:123456" }).returning();
    await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71999990074", pushName: "Carla Teste", body: "oi" });
    const open = (await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990074")))[0].id;
    const recent = await wrote("Dani Teste", "+5571999990075");
    const [old] = await db.insert(campaigns).values({ name: "Anterior", body: "x", status: "concluida", total: 1, createdBy: gestao }).returning();
    await db.insert(campaignRecipients).values({ campaignId: old.id, contactId: recent, status: "enviada", sentAt: plus(-3 * 24 * 60) });
    const [never] = await db.insert(contacts).values({ name: "Eva Teste", phoneE164: "+5571999990076" }).returning();
    const p = await previewAudience({ contactIds: [ok, ign, hid.id, open, recent, never.id] }, T0);
    expect(p.eligible).toBe(1);
    expect(Object.fromEntries(p.excluded.map((e) => [e.reason, e.n]))).toEqual({ nao_e_cliente: 1, numero_oculto: 1, conversa_aberta: 1, recebeu_recente: 1, nunca_escreveu: 1 });
  });

  it("confirmação dupla: aceitar o risco e digitar o total certo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const a = await wrote("Ana Teste", "+5571999990071");
    const b = await wrote("Bia Teste", "+5571999990072");
    const { id, total } = await createCampaign({ name: "Retorno", body: "Oi, {primeiro_nome}!", audience: { contactIds: [a, b] } }, actor, T0);
    expect(total).toBe(2);
    expect((await db.select().from(campaigns))[0].status).toBe("rascunho");
    await expect(confirmCampaign(id, { typedTotal: 2, acceptRisk: false }, actor, T0)).rejects.toThrow(/risco de bloqueio/);
    await expect(confirmCampaign(id, { typedTotal: 3, acceptRisk: true }, actor, T0)).rejects.toThrow("Digite 2");
    expect((await confirmCampaign(id, { typedTotal: 2, acceptRisk: true }, actor, T0)).startAt).toEqual(T0);
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: "agendada", confirmedBy: gestao });
  });

  it("recusa: intervalo menor que 2 min, variável de horário e mais de 300 contatos", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const a = await wrote("Ana Teste", "+5571999990071");
    await expect(createCampaign({ name: "x", body: "Oi", audience: { contactIds: [a] }, intervalSeconds: 60 }, actor, T0)).rejects.toThrow(/mínimo entre uma mensagem e outra é de 2 minutos/);
    await expect(createCampaign({ name: "x", body: "Seu horário: {data_horario}", audience: { contactIds: [a] } }, actor, T0)).rejects.toThrow(/só vale \{primeiro_nome\}/);
    const many = await db.insert(contacts).values(Array.from({ length: 301 }, (_, i) => ({ name: `Teste ${i}`, phoneE164: `+5571990${String(100000 + i)}` }))).returning({ id: contacts.id });
    await db.insert(messages).values(many.map((c) => ({ contactId: c.id, direction: "in" as const, kind: "text", body: "oi", status: "received" })));
    await expect(createCampaign({ name: "x", body: "Oi", audience: { contactIds: many.map((c) => c.id) } }, actor, T0)).rejects.toThrow(/No máximo 300/);
  });

  it("manda uma por rodada, só com a Casa aberta e respeitando o intervalo; grava na conversa sem abrir lead", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    expect((await drainCampaigns(new Date("2026-10-19T13:00:00Z"), sender)).waiting).toBe("casa_fechada"); // segunda
    expect((await drainCampaigns(T0, sender)).sent).toBe(1);
    expect((await drainCampaigns(plus(1), sender)).waiting).toBe("intervalo");
    expect((await drainCampaigns(plus(3), sender)).sent).toBe(1);
    expect(sent.map((s) => s.text).sort()).toEqual(["Bom dia, Ana! Sentimos sua falta.", "Bom dia, Bia! Sentimos sua falta."]);
    const out = (await db.select().from(messages)).filter((m) => m.direction === "out");
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.dealId === null && m.sentByUserId === null && m.status === "sent")).toBe(true);
    expect(await db.select().from(deals)).toHaveLength(0);
  });

  it("chave desligada no meio: a rodada seguinte não manda nada", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    expect((await drainCampaigns(T0, sender)).sent).toBe(1);
    await saveMassSettings({ enabled: false }, gestao);
    expect(await drainCampaigns(plus(5), sender)).toMatchObject({ sent: 0, waiting: "desligada" });
    expect(sent).toHaveLength(1);
  });

  it("quem começou a conversar depois de montar a lista é pulada", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    await recordInbound({ channelId: null, externalId: "N9", phoneRaw: "71999990071", body: "Oi, quero marcar", at: plus(1) });
    expect((await drainCampaigns(plus(2), sender)).skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await recips(id))[0]).toMatchObject({ status: "pulada", sentAt: null });
    expect((await recips(id))[0].error).toContain("conversa aberta");
  });

  it("WhatsApp recusou: fica “falhou” e não tenta de novo", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    failSend = true;
    expect((await drainCampaigns(T0, sender)).failed).toBe(1);
    failSend = false;
    await drainCampaigns(plus(5), sender);
    expect(sent).toHaveLength(0);
    expect((await recips(id))[0].status).toBe("falhou");
  });

  it("no máximo 150 por dia", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    await ready([await wrote("Ana Teste", "+5571999990071")]);
    const others = await db.insert(contacts).values(Array.from({ length: 150 }, (_, i) => ({ name: `Antes ${i}`, phoneE164: `+5571980${String(100000 + i)}` }))).returning({ id: contacts.id });
    const [prev] = await db.insert(campaigns).values({ name: "Manhã", body: "x", status: "concluida", total: 150, createdBy: gestao }).returning();
    await db.insert(campaignRecipients).values(others.map((c) => ({ campaignId: prev.id, contactId: c.id, status: "enviada", sentAt: plus(-120) })));
    expect((await drainCampaigns(T0, sender)).waiting).toBe("limite_do_dia");
  });

  it("termina sozinha e avisa quem confirmou", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071")]);
    await drainCampaigns(T0, sender);
    await drainCampaigns(plus(3), sender);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, id)))[0].status).toBe("concluida");
    const [a] = await db.select().from(alerts).where(eq(alerts.type, "massa_concluida"));
    expect(a).toMatchObject({ userId: gestao, message: "Mensagem em massa “Retorno” terminou: 1 enviada." });
  });

  it("pausar segura; cancelar tira quem ainda não recebeu", async () => {
    await saveMassSettings({ enabled: true }, gestao);
    const id = await ready([await wrote("Ana Teste", "+5571999990071"), await wrote("Bia Teste", "+5571999990072")]);
    await drainCampaigns(T0, sender);
    await pauseCampaign(id, actor);
    expect((await drainCampaigns(plus(5), sender)).sent).toBe(0);
    await cancelCampaign(id, actor);
    const rows = await recips(id);
    expect(rows.map((r) => r.status).sort()).toEqual(["enviada", "pulada"]);
    expect(sent).toHaveLength(1);
  });
});
```

Em `src/lib/permissions.test.ts`, trocar a expectativa do `GESTAO_OPTIONAL` e acrescentar:

```ts
    expect(GESTAO_OPTIONAL).toEqual(["distribuicao.receber", "mensagem.massa"]);
```

```ts
it("mensagem em massa: ninguém tem por padrão, nem a Gestão", () => {
  for (const p of SYSTEM_PROFILES) expect(p.permissions).not.toContain("mensagem.massa");
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/campaigns.test.ts src/lib/permissions.test.ts`
Esperado: FAIL (`Cannot find module './campaigns'`; `GESTAO_OPTIONAL` ainda só com a distribuição).

- [ ] **Passo 3: Permissão e textos**

Em `src/lib/permissions.ts`:
- em `PERMS`, depois de `"valores.ver",`: `"mensagem.massa",`;
- `PERM_LABEL["mensagem.massa"] = "Mandar mensagem em massa"`;
- `PERM_HELP["mensagem.massa"] = "Monta e dispara mensagem em massa a partir de Contatos (com confirmação dupla). Só funciona com a chave ligada em Configurações › Mensagem em massa. Use com cuidado: o WhatsApp pode bloquear o número."`;
- `PERM_GROUP["mensagem.massa"] = "Contatos"`;
- `export const GESTAO_OPTIONAL: Perm[] = ["distribuicao.receber", "mensagem.massa"];`, e acima dele o comentário: `/** No perfil Gestão, isto é opcional: entrar no rodízio de leads e mandar mensagem em massa (Lote 5: ninguém nasce com ela). */`.

> O seed (`src/server/db/seed.ts`) só mantém as opcionais que o perfil Gestão já tinha. Então `mensagem.massa` não é dada a ninguém no deploy. Quem libera é a gestão, em Configurações › Equipe › Perfis.

Em `src/lib/alert-copy.ts`:
- `alertText` ganha:

```ts
  /** Lote 5: a mensagem em massa terminou (para quem confirmou). */
  campaignDone: (name: string, sent: number, failed: number) =>
    `Mensagem em massa “${name}” terminou: ${sent} enviada${sent === 1 ? "" : "s"}${failed ? `, ${failed} não ${failed === 1 ? "saiu" : "saíram"}` : ""}.`,
```

- `GROUP_OF`: `massa_concluida: "sistema", massa_pausada: "sistema",`;
- `ALERT_HELP`, depois de `alerta-agendada`:

```ts
  { id: "alerta-massa", types: ["massa_concluida", "massa_pausada"], title: "Mensagem em massa",
    text: "A mensagem em massa terminou (com quantas saíram) ou parou sozinha porque nenhum WhatsApp está conectado. Para continuar, conecte o número e toque em Retomar em Configurações › Mensagem em massa.",
    example: alertText.campaignDone("Retorno de outubro", 85, 2) },
```

- [ ] **Passo 4: Domínio**

`src/server/domain/campaigns.ts`:

```ts
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, campaignRecipients, campaigns, channels, contacts, messages, settings, users, type Campaign } from "../db/schema";
import { can } from "@/lib/permissions";
import { isOpen } from "@/lib/business-hours";
import { renderReply } from "@/lib/quick-reply";
import { firstName } from "@/lib/authorship";
import { alertText } from "@/lib/alert-copy";
import { isHiddenNumber } from "@/lib/phone-client";
import { getBusinessHours } from "./hours";
import { getSendCap } from "./messaging-settings";
import { whatsapp } from "../whatsapp/evolution";
import { emit } from "./events";
import { UserFacingError } from "./errors";

export const MASS_SETTING = "envio_massa";
export const CAMPAIGN_MIN_INTERVAL_S = 120;
export const CAMPAIGN_DEFAULT_INTERVAL_S = 180;
export const CAMPAIGN_MAX_RECIPIENTS = 300;
export const CAMPAIGN_DAILY_CAP = 150;
export const CAMPAIGN_RECENT_DAYS = 7;
export const CAMPAIGN_BODY_MAX = 1000;
const STUCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const OFFSET_MS = 3 * 3_600_000;

type Actor = { id: string; perms: readonly string[] };
export type Audience = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] };
export type ExclusionReason = "nao_e_cliente" | "numero_oculto" | "conversa_aberta" | "recebeu_recente" | "nunca_escreveu";
export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  nao_e_cliente: "marcadas como “Não é cliente”",
  numero_oculto: "com número oculto no WhatsApp",
  conversa_aberta: "com conversa aberta (a equipe está atendendo)",
  recebeu_recente: `receberam mensagem em massa nos últimos ${CAMPAIGN_RECENT_DAYS} dias`,
  nunca_escreveu: "nunca escreveram para a Casa (risco de bloqueio)",
};
export type AudiencePreview = { found: number; eligible: number; excluded: { reason: ExclusionReason; label: string; n: number }[]; sample: { id: string; name: string | null; phone: string }[]; tooMany: boolean };
export type CampaignSender = (i: { instance: string; phone: string; text: string }) => Promise<{ externalId: string | null }>;
const defaultSender: CampaignSender = ({ instance, phone, text }) => whatsapp().sendText(instance, phone, text);

/* ---------- Chave em Configurações (nasce desligada) ---------- */
export async function getMassSettings(): Promise<{ enabled: boolean }> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, MASS_SETTING));
  return { enabled: (r?.value as { enabled?: boolean } | undefined)?.enabled === true };
}
export async function saveMassSettings(input: { enabled: boolean }, userId: string): Promise<void> {
  const value = { enabled: input.enabled === true };
  await db.insert(settings).values({ key: MASS_SETTING, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: value.enabled ? "ligou" : "desligou", entity: "settings", entityId: MASS_SETTING, data: value });
}
async function assertCanSend(actor: Actor) {
  if (!can(actor.perms, "mensagem.massa")) throw new UserFacingError("Você não tem permissão para mandar mensagem em massa.");
  if (!(await getMassSettings()).enabled) throw new UserFacingError("Mensagem em massa está desligada em Configurações › Mensagem em massa.");
}

/* ---------- Quem recebe ---------- */
/** Contatos do filtro (busca por nome/telefone/e-mail, só clientes, etiqueta) ou os escolhidos à mão. A busca por trecho de mensagem não vale aqui. */
async function audienceIds(a: Audience): Promise<string[]> {
  if (a.contactIds?.length) return [...new Set(a.contactIds)];
  const conds = [sql`not c.ignored`];
  const term = a.q?.trim().slice(0, 80) ?? "";
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = term.replace(/\D/g, "");
    conds.push(sql`(coalesce(c.name, '') ilike ${like} or coalesce(c.email, '') ilike ${like}${digits.length >= 3 ? sql` or c.phone_e164 like ${`%${digits}%`}` : sql``})`);
  }
  if (a.onlyClients) conds.push(sql`c.is_client`);
  if (a.tag?.trim()) conds.push(sql`exists (select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = c.id and lower(t.name) = lower(${a.tag.trim()}))`);
  const r = await db.execute(sql`select c.id from contacts c where ${sql.join(conds, sql` and `)} order by c.created_at, c.id limit 5000`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

/** Quem pode receber agora. Ficam de fora (nessa ordem): "Não é cliente", número oculto, conversa aberta, quem recebeu nos últimos 7 dias e quem nunca escreveu para a Casa (só manda para quem já conversou: regra do ChatGuru contra bloqueio). */
async function classify(ids: string[], now: Date): Promise<{ eligible: string[]; excluded: Map<ExclusionReason, number> }> {
  const excluded = new Map<ExclusionReason, number>();
  if (!ids.length) return { eligible: [], excluded };
  const since = new Date(now.getTime() - CAMPAIGN_RECENT_DAYS * DAY_MS).toISOString();
  const rows = (await db.execute(sql`
    select c.id, c.ignored, c.phone_e164,
      exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null) as open_deal,
      exists (select 1 from campaign_recipients cr where cr.contact_id = c.id and cr.status = 'enviada' and cr.sent_at > ${since}::timestamptz) as recent,
      exists (select 1 from messages m where m.contact_id = c.id and m.direction = 'in') as wrote
    from contacts c where c.id in ${ids}`)).rows as { id: string; ignored: boolean; phone_e164: string; open_deal: boolean; recent: boolean; wrote: boolean }[];
  const eligible: string[] = [];
  for (const r of rows) {
    const reason: ExclusionReason | null = r.ignored ? "nao_e_cliente" : isHiddenNumber(r.phone_e164) ? "numero_oculto" : r.open_deal ? "conversa_aberta"
      : r.recent ? "recebeu_recente" : !r.wrote ? "nunca_escreveu" : null;
    if (reason) excluded.set(reason, (excluded.get(reason) ?? 0) + 1); else eligible.push(r.id);
  }
  return { eligible, excluded };
}

export async function previewAudience(a: Audience, now = new Date()): Promise<AudiencePreview> {
  const ids = await audienceIds(a);
  const { eligible, excluded } = await classify(ids, now);
  const sample = eligible.length ? await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(inArray(contacts.id, eligible.slice(0, 5))) : [];
  return {
    found: ids.length, eligible: eligible.length, sample, tooMany: eligible.length > CAMPAIGN_MAX_RECIPIENTS,
    excluded: [...excluded].map(([reason, n]) => ({ reason, label: EXCLUSION_LABEL[reason], n })),
  };
}

/* ---------- Montar, confirmar, pausar, cancelar ---------- */
/** Monta o rascunho com a lista congelada. Nada sai até a segunda confirmação (`confirmCampaign`). */
export async function createCampaign(input: { name: string; body: string; audience: Audience; intervalSeconds?: number }, actor: Actor, now = new Date()): Promise<{ id: string; total: number }> {
  await assertCanSend(actor);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new UserFacingError("Dê um nome para a mensagem em massa (só a equipe vê).");
  const body = input.body.trim();
  if (!body) throw new UserFacingError("Escreva a mensagem.");
  if (body.length > CAMPAIGN_BODY_MAX) throw new UserFacingError(`Mensagem muito longa (máximo ${CAMPAIGN_BODY_MAX.toLocaleString("pt-BR")} caracteres).`);
  if (/\{(data_horario|profissional)\}/.test(body)) throw new UserFacingError("Em mensagem em massa só vale {primeiro_nome} e {saudacao}: cada cliente tem um horário diferente.");
  const interval = input.intervalSeconds ?? CAMPAIGN_DEFAULT_INTERVAL_S;
  if (!Number.isInteger(interval) || interval < CAMPAIGN_MIN_INTERVAL_S) throw new UserFacingError("O intervalo mínimo entre uma mensagem e outra é de 2 minutos.");
  const { eligible } = await classify(await audienceIds(input.audience), now);
  if (!eligible.length) throw new UserFacingError("Ninguém do filtro pode receber (veja quem ficou de fora e por quê).");
  if (eligible.length > CAMPAIGN_MAX_RECIPIENTS) throw new UserFacingError(`No máximo ${CAMPAIGN_MAX_RECIPIENTS} clientes por vez. Filtre mais.`);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({ name, body, intervalSeconds: interval, audience: input.audience as Record<string, unknown>, total: eligible.length, createdBy: actor.id, createdAt: now }).returning({ id: campaigns.id });
    await tx.insert(campaignRecipients).values(eligible.map((contactId) => ({ campaignId: c.id, contactId })));
    await tx.insert(auditLog).values({ userId: actor.id, action: "criou", entity: "campanha", entityId: c.id, data: { name, total: eligible.length } });
    return { id: c.id, total: eligible.length };
  });
}

/** Segunda confirmação: marcar o risco de bloqueio e digitar quantas clientes vão receber. Uma de cada vez: se outra estiver saindo, esta espera. */
export async function confirmCampaign(id: string, input: { typedTotal: number; acceptRisk: boolean; startAt?: Date | null }, actor: Actor, now = new Date()): Promise<{ startAt: Date; endsAround: Date }> {
  await assertCanSend(actor);
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c || c.status !== "rascunho") throw new UserFacingError("Essa mensagem em massa não está esperando confirmação.");
  if (!input.acceptRisk) throw new UserFacingError("Marque que entende o risco de bloqueio do número.");
  if (input.typedTotal !== c.total) throw new UserFacingError(`Digite ${c.total} (o número de clientes que vão receber) para confirmar.`);
  const startAt = input.startAt && input.startAt > now ? input.startAt : now;
  await db.update(campaigns).set({ status: "agendada", startAt, confirmedBy: actor.id, confirmedAt: now }).where(and(eq(campaigns.id, id), eq(campaigns.status, "rascunho")));
  await db.insert(auditLog).values({ userId: actor.id, action: "confirmou", entity: "campanha", entityId: id, data: { total: c.total, startAt: startAt.toISOString() } });
  return { startAt, endsAround: new Date(startAt.getTime() + c.total * c.intervalSeconds * 1000) };
}

async function setStatus(id: string, from: string[], to: string, actor: Actor, action: string) {
  if (!can(actor.perms, "mensagem.massa")) throw new UserFacingError("Você não tem permissão para mandar mensagem em massa.");
  const [c] = await db.update(campaigns).set({ status: to, ...(to === "cancelada" ? { finishedAt: new Date() } : {}) })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, from))).returning({ id: campaigns.id });
  if (!c) throw new UserFacingError("Não deu: a mensagem em massa mudou de situação. Atualize a página.");
  await db.insert(auditLog).values({ userId: actor.id, action, entity: "campanha", entityId: id, data: { para: to } });
}
export const pauseCampaign = (id: string, actor: Actor) => setStatus(id, ["agendada", "enviando"], "pausada", actor, "pausou");
export async function resumeCampaign(id: string, actor: Actor) { await assertCanSend(actor); await setStatus(id, ["pausada"], "enviando", actor, "retomou"); }
export async function cancelCampaign(id: string, actor: Actor) {
  await setStatus(id, ["rascunho", "agendada", "enviando", "pausada"], "cancelada", actor, "cancelou");
  await db.update(campaignRecipients).set({ status: "pulada", error: "Mensagem em massa cancelada." }).where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "pendente")));
}

/* ---------- Envio (worker) ---------- */
const bahiaDayStart = (now: Date) => new Date(Math.floor((now.getTime() - OFFSET_MS) / DAY_MS) * DAY_MS + OFFSET_MS);
type Waiting = "desligada" | "casa_fechada" | "limite_do_dia" | "teto_por_hora" | "intervalo";
export type DrainResult = { sent: number; failed: number; skipped: number; waiting?: Waiting };

/**
 * Worker (a cada minuto): manda NO MÁXIMO UMA mensagem por rodada, da mensagem em massa confirmada mais antiga.
 * Para se: a chave foi desligada, a Casa está fechada, já saíram 150 hoje, o teto por hora (o mesmo das automáticas, somado) bateu
 * ou o intervalo ainda não passou. Nunca reenvia: envio interrompido vira "falhou".
 */
export async function drainCampaigns(now = new Date(), send: CampaignSender = defaultSender): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, failed: 0, skipped: 0 };
  await db.update(campaignRecipients).set({ status: "falhou", error: "Envio interrompido: confira no WhatsApp antes de mandar de novo." })
    .where(and(eq(campaignRecipients.status, "enviando"), sql`${campaignRecipients.sentAt} < ${new Date(now.getTime() - STUCK_MS).toISOString()}::timestamptz`));
  if (!(await getMassSettings()).enabled) return { ...out, waiting: "desligada" };
  if (!isOpen(now.getTime(), await getBusinessHours())) return { ...out, waiting: "casa_fechada" };
  let [c] = await db.select().from(campaigns).where(eq(campaigns.status, "enviando")).orderBy(asc(campaigns.confirmedAt)).limit(1);
  if (!c) {
    const r = await db.execute(sql`update campaigns set status = 'enviando' where id = (
      select id from campaigns where status = 'agendada' and start_at <= ${now.toISOString()}::timestamptz order by confirmed_at limit 1) returning id`);
    const id = (r.rows[0] as { id: string } | undefined)?.id;
    if (!id) return out;
    [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  }
  const [{ today }] = (await db.execute(sql`select count(*)::int as today from campaign_recipients where status = 'enviada' and sent_at >= ${bahiaDayStart(now).toISOString()}::timestamptz`)).rows as { today: number }[];
  if (today >= CAMPAIGN_DAILY_CAP) return { ...out, waiting: "limite_do_dia" };
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const [{ hour }] = (await db.execute(sql`select ((select count(*) from campaign_recipients where status = 'enviada' and sent_at > ${hourAgo}::timestamptz)
    + (select count(*) from outbox where status = 'sent' and sent_at > ${hourAgo}::timestamptz))::int as hour`)).rows as { hour: number }[];
  if (hour >= await getSendCap()) return { ...out, waiting: "teto_por_hora" };
  const [{ last }] = (await db.execute(sql`select max(sent_at) as last from campaign_recipients where campaign_id = ${c.id} and status in ('enviada', 'falhou', 'enviando')`)).rows as { last: string | Date | null }[];
  if (last && now.getTime() - new Date(last).getTime() < c.intervalSeconds * 1000) return { ...out, waiting: "intervalo" };
  // Reserva a próxima (FOR UPDATE SKIP LOCKED): dois workers nunca mandam para a mesma pessoa.
  const next = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, "pendente")))
      .orderBy(asc(campaignRecipients.contactId)).limit(1).for("update", { skipLocked: true });
    if (!r) return null;
    await tx.update(campaignRecipients).set({ status: "enviando", sentAt: now }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, r.contactId)));
    return r;
  });
  if (!next) { await finishCampaign(c, now); return out; }
  const result = await sendOne(c, next.contactId, now, send);
  out[result]++;
  return out;
}

async function sendOne(c: Campaign, contactId: string, now: Date, send: CampaignSender): Promise<"sent" | "failed" | "skipped"> {
  const mark = (status: "enviada" | "falhou" | "pulada" | "pendente", extra: Partial<typeof campaignRecipients.$inferInsert> = {}) =>
    db.update(campaignRecipients).set({ status, ...extra }).where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.contactId, contactId)));
  // Confere de novo na hora: ela pode ter começado a conversar, virado "Não é cliente" ou recebido outra em massa.
  const { eligible, excluded } = await classify([contactId], now);
  if (!eligible.length) {
    await mark("pulada", { sentAt: null, error: [...excluded.keys()].map((k) => EXCLUSION_LABEL[k]).join(", ") });
    return "skipped";
  }
  const [ch] = await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1);
  if (!ch) {
    await mark("pendente", { sentAt: null });
    await db.update(campaigns).set({ status: "pausada" }).where(eq(campaigns.id, c.id));
    await db.insert(alerts).values({ userId: c.confirmedBy, audience: c.confirmedBy ? "responsavel" : "gestao", type: "massa_pausada", severity: "info",
      message: `Mensagem em massa “${c.name}” pausada: nenhum WhatsApp conectado. Conecte o número e toque em Retomar.`,
      dedupeKey: `massa:pausa:${c.id}:${now.toISOString().slice(0, 13)}` }).onConflictDoNothing();
    await emit("alerta", {});
    return "skipped";
  }
  const [ct] = await db.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, contactId));
  const text = renderReply(c.body, { primeiroNome: firstName(ct.name), dataHorario: null, profissional: null }, now.getTime()).text;
  // Sem lead (a lista exclui quem está com conversa aberta) e sem autora: aparece na conversa como mensagem automática da Casa.
  const [msg] = await db.insert(messages).values({ dealId: null, contactId, channelId: ch.id, direction: "out", kind: "text", body: text, status: "pending", createdAt: now }).returning({ id: messages.id });
  let externalId: string | null = null;
  try {
    ({ externalId } = await send({ instance: ch.instanceName, phone: ct.phone, text }));
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await db.update(messages).set({ status: "failed", error: why }).where(eq(messages.id, msg.id));
    await mark("falhou", { messageId: msg.id, sentAt: now, error: why });
    return "failed";
  }
  await db.update(messages).set({ status: "sent" }).where(and(eq(messages.id, msg.id), eq(messages.status, "pending")));
  // O eco do WhatsApp pode já ter gravado o id: nunca derruba o registro do envio por isso.
  if (externalId) await db.update(messages).set({ externalId }).where(and(eq(messages.id, msg.id), isNull(messages.externalId))).catch(() => {});
  await mark("enviada", { messageId: msg.id, sentAt: now, error: null });
  return "sent";
}

async function finishCampaign(c: Campaign, now: Date) {
  const [done] = await db.update(campaigns).set({ status: "concluida", finishedAt: now }).where(and(eq(campaigns.id, c.id), eq(campaigns.status, "enviando"))).returning({ id: campaigns.id });
  if (!done) return;
  const rows = (await db.execute(sql`select status, count(*)::int as n from campaign_recipients where campaign_id = ${c.id} group by status`)).rows as { status: string; n: number }[];
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  await db.insert(alerts).values({ userId: c.confirmedBy, audience: c.confirmedBy ? "responsavel" : "gestao", type: "massa_concluida", severity: "info",
    message: alertText.campaignDone(c.name, n("enviada"), n("falhou")), dedupeKey: `massa:fim:${c.id}` }).onConflictDoNothing();
  await emit("alerta", {});
}

/* ---------- Lista (Configurações) ---------- */
export type CampaignSummary = { id: string; name: string; status: string; total: number; intervalSeconds: number; startAt: string | null; createdAt: string; createdByName: string; sent: number; failed: number; skipped: number };
export async function listCampaigns(limit = 20): Promise<CampaignSummary[]> {
  const r = await db.execute(sql`
    select c.id, c.name, c.status, c.total, c.interval_seconds as "intervalSeconds", c.start_at as "startAt", c.created_at as "createdAt", u.name as "createdByName",
      count(*) filter (where r.status = 'enviada')::int as sent, count(*) filter (where r.status = 'falhou')::int as failed, count(*) filter (where r.status = 'pulada')::int as skipped
    from campaigns c join ${users} u on u.id = c.created_by left join campaign_recipients r on r.campaign_id = c.id
    group by c.id, u.name order by c.created_at desc limit ${limit}`);
  return (r.rows as (Omit<CampaignSummary, "startAt" | "createdAt"> & { startAt: Date | null; createdAt: Date })[])
    .map((x) => ({ ...x, startAt: x.startAt ? new Date(x.startAt).toISOString() : null, createdAt: new Date(x.createdAt).toISOString() }));
}
```

> O `${users}` dentro do `sql` vira o nome da tabela (`"users"`). Se o `drizzle` desta versão não aceitar a tabela no template, escreva `join users u` direto.
>
> Atenção ao `c.id in ${ids}` do `classify`: o `sql` do drizzle transforma um array JS em `($1, $2, …)`. Por isso **não** use `= any(${ids}::uuid[])`, que vira SQL inválido. A lista nunca chega vazia aqui (o `return` antes cuida disso).

- [ ] **Passo 5: Worker**

Em `worker/index.ts`:
- import `import { drainCampaigns } from "../src/server/domain/campaigns";`;
- em `QUEUES`, acrescentar `massa: "envio-massa"`;
- agendar junto das outras: `await boss.schedule(QUEUES.massa, "* * * * *", null, { tz: "America/Bahia", singletonKey: "envio-massa" });`;
- trabalhar:

```ts
  // Mensagem em massa (Lote 5): no máximo uma por rodada; não faz nada com a chave desligada (o padrão).
  await boss.work(QUEUES.massa, { batchSize: 1 }, async () => {
    const r = await drainCampaigns().catch((e) => { console.error("[mensagem em massa]", e); return null; });
    if (r && (r.sent || r.failed || r.skipped)) console.log("[mensagem em massa]", r);
  });
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/campaigns.test.ts src/lib/permissions.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. Se algum teste de perfis contar as permissões (`grep -rn "PERMS" src --include="*.test.ts"`), ajuste a contagem para a permissão nova.

- [ ] **Passo 7: Commit**

```bash
git add src/server/domain/campaigns.ts src/server/domain/campaigns.test.ts src/lib/permissions.ts src/lib/permissions.test.ts src/lib/alert-copy.ts worker/index.ts
git commit -m "feat(massa): mensagem em massa desligada por padrão, atrás da permissão mensagem.massa; confirmação dupla, uma por rodada, intervalo mínimo de 2 min, 150 por dia e só para quem já escreveu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 11: Mensagem em massa na tela (chave em Configurações e montagem a partir de Contatos)

**Arquivos:**
- Criar: `src/app/(app)/config/massa/page.tsx`, `src/app/(app)/config/massa/actions.ts`
- Criar: `src/app/(app)/contatos/massa-actions.ts`
- Criar: `src/components/config/mass-settings.tsx`
- Criar: `src/components/contacts/mass-message-sheet.tsx`, `src/components/contacts/mass-message-sheet.test.tsx`
- Modificar: `src/components/config/config-nav.tsx` (`TABS`)
- Modificar: `src/app/(app)/contatos/page.tsx` (botão no `PageHeader` e `mass` para a lista)
- Modificar: `src/components/contacts/contacts-list.tsx` (repassa `mass`) e `src/components/contacts/contacts-bulk-bar.tsx` (botão "Mensagem em massa (N)")

**Interfaces:**
- Consome (Tarefa 10): `getMassSettings`, `saveMassSettings`, `previewAudience`, `createCampaign`, `confirmCampaign`, `pauseCampaign`, `resumeCampaign`, `cancelCampaign`, `listCampaigns`, `CAMPAIGN_*`. Do código atual: `SendConfirmDialog` (`src/components/config/send-confirm.tsx`), `Sheet`, `listTags`.
- Produz:
  - rota `/config/massa` ("Mensagem em massa"), só com `config.editar`;
  - ações:
    - `saveMassSettingsAction(v: { enabled: boolean })` (`config.editar`);
    - `previewAudienceAction(a: AudienceInput)`, `createCampaignAction(input)`, `confirmCampaignAction(id, input)`, `pauseCampaignAction(id)`, `resumeCampaignAction(id)`, `cancelCampaignAction(id)` (`mensagem.massa`);
  - `type AudienceInput = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] }`;
  - `<MassMessageButton audience tags summary />` e `<MassMessageSheet open onClose audience tags summary />`;
  - `ContactsList` e `ContactsBulkBar` ganham a prop `mass?: { tags: string[] } | null`.

- [ ] **Passo 1: Teste da folha que falha**

`src/components/contacts/mass-message-sheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const previewAudienceAction = vi.fn(async () => ({ ok: true as const, data: { found: 10, eligible: 7, tooMany: false, sample: [{ id: "c1", name: "Ana Teste", phone: "+5571999990071" }],
  excluded: [{ reason: "nunca_escreveu", label: "nunca escreveram para a Casa (risco de bloqueio)", n: 3 }] } }));
const createCampaignAction = vi.fn(async () => ({ ok: true as const, data: { id: "camp1", total: 7 } }));
const confirmCampaignAction = vi.fn(async () => ({ ok: true as const, data: { startAt: new Date().toISOString(), endsAround: new Date().toISOString() } }));
vi.mock("@/app/(app)/contatos/massa-actions", () => ({ previewAudienceAction, createCampaignAction, confirmCampaignAction }));
import { MassMessageSheet } from "./mass-message-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("mensagem em massa: montar e confirmar", () => {
  it("mostra quem recebe e quem fica de fora; só confirma com o risco marcado e o total digitado", async () => {
    render(<MassMessageSheet open onClose={() => {}} audience={{ q: null, onlyClients: true }} tags={["VIP"]} summary="Só clientes" />);
    fireEvent.click(screen.getByRole("button", { name: "Ver quem recebe" }));
    expect(await screen.findByText("7 vão receber")).toBeTruthy();
    expect(screen.getByText(/3 nunca escreveram para a Casa \(risco de bloqueio\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(screen.getByLabelText("Nome (só a equipe vê)"), { target: { value: "Retorno outubro" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "{saudacao}, {primeiro_nome}! Sentimos sua falta." } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await waitFor(() => expect(createCampaignAction).toHaveBeenCalledWith({ name: "Retorno outubro", body: "{saudacao}, {primeiro_nome}! Sentimos sua falta.", audience: { q: null, onlyClients: true, tag: null }, intervalSeconds: 180 }));
    const confirm = await screen.findByRole("button", { name: "Confirmar envio" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Entendo que o WhatsApp pode bloquear o número/));
    fireEvent.change(screen.getByLabelText("Digite 7 para confirmar"), { target: { value: "6" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite 7 para confirmar"), { target: { value: "7" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirmCampaignAction).toHaveBeenCalledWith("camp1", { typedTotal: 7, acceptRisk: true }));
  });
});
```

Rodar: `npx vitest run src/components/contacts/mass-message-sheet.test.tsx`
Esperado: FAIL (o módulo não existe).

- [ ] **Passo 2: Ações**

`src/app/(app)/contatos/massa-actions.ts`:

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { CAMPAIGN_MAX_RECIPIENTS, cancelCampaign, confirmCampaign, createCampaign, pauseCampaign, previewAudience, resumeCampaign, type AudiencePreview } from "@/server/domain/campaigns";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
export type AudienceInput = { q?: string | null; onlyClients?: boolean; tag?: string | null; contactIds?: string[] };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "massa") });
const uuid = z.string().uuid();
const audienceSchema = z.object({
  q: z.string().max(80).nullish(), onlyClients: z.boolean().optional(), tag: z.string().max(30).nullish(),
  contactIds: z.array(uuid).max(CAMPAIGN_MAX_RECIPIENTS + 1).optional(),
});

export async function previewAudienceAction(a: AudienceInput): Promise<R<AudiencePreview>> {
  try { await assertPerm("mensagem.massa"); return { ok: true, data: await previewAudience(audienceSchema.parse(a)) }; } catch (e) { return fail(e); }
}
export async function createCampaignAction(input: { name: string; body: string; audience: AudienceInput; intervalSeconds: number }): Promise<R<{ id: string; total: number }>> {
  try {
    const user = await assertPerm("mensagem.massa");
    const data = await createCampaign({ name: z.string().max(80).parse(input.name), body: z.string().max(2000).parse(input.body), audience: audienceSchema.parse(input.audience), intervalSeconds: z.number().int().parse(input.intervalSeconds) }, user);
    return { ok: true, data };
  } catch (e) { return fail(e); }
}
export async function confirmCampaignAction(id: string, input: { typedTotal: number; acceptRisk: boolean; startAt?: string | null }): Promise<R<{ startAt: string; endsAround: string }>> {
  try {
    const user = await assertPerm("mensagem.massa");
    const r = await confirmCampaign(uuid.parse(id), { typedTotal: z.number().int().parse(input.typedTotal), acceptRisk: z.boolean().parse(input.acceptRisk), startAt: input.startAt ? new Date(input.startAt) : null }, user);
    revalidatePath("/config/massa");
    return { ok: true, data: { startAt: r.startAt.toISOString(), endsAround: r.endsAround.toISOString() } };
  } catch (e) { return fail(e); }
}
export async function pauseCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await pauseCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function resumeCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await resumeCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function cancelCampaignAction(id: string): Promise<R> {
  try { const user = await assertPerm("mensagem.massa"); await cancelCampaign(uuid.parse(id), user); revalidatePath("/config/massa"); return { ok: true }; } catch (e) { return fail(e); }
}
```

`src/app/(app)/config/massa/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveMassSettings } from "@/server/domain/campaigns";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "massa") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.editar"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/massa"); revalidatePath("/contatos"); return { ok: true, data }; } catch (e) { return fail(e); }
}
export const saveMassSettingsAction = async (v: { enabled: boolean }) => run((u) => saveMassSettings({ enabled: z.boolean().parse(v.enabled) }, u));
```

- [ ] **Passo 3: Folha de montagem e botão**

`src/components/contacts/mass-message-sheet.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { confirmCampaignAction, createCampaignAction, previewAudienceAction, type AudienceInput } from "@/app/(app)/contatos/massa-actions";
import { dueLabel } from "@/lib/next-action";

type Preview = { found: number; eligible: number; tooMany: boolean; excluded: { reason: string; label: string; n: number }[]; sample: { id: string; name: string | null; phone: string }[] };
const GAPS = [[120, "2 min"], [180, "3 min (recomendado)"], [300, "5 min"], [600, "10 min"]] as const;

/** Três passos: quem recebe (com quem fica de fora e por quê) → a mensagem → confirmação dupla (risco + digitar o total). */
export function MassMessageSheet({ open, onClose, audience, tags, summary }: { open: boolean; onClose: () => void; audience: AudienceInput; tags: string[]; summary: string }) {
  const [step, setStep] = useState<"quem" | "mensagem" | "confirmar">("quem");
  const [tag, setTag] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState(""); const [body, setBody] = useState(""); const [gap, setGap] = useState(180);
  const [created, setCreated] = useState<{ id: string; total: number } | null>(null);
  const [risk, setRisk] = useState(false); const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const aud: AudienceInput = audience.contactIds ? { contactIds: audience.contactIds } : { ...audience, tag: tag || null };
  const check = () => start(async () => { setError(null); const r = await previewAudienceAction(aud); if (r.ok) setPreview(r.data!); else setError(r.error); });
  const create = () => start(async () => {
    setError(null);
    const r = await createCampaignAction({ name, body, audience: aud, intervalSeconds: gap });
    if (!r.ok) { setError(r.error); return; }
    setCreated(r.data!); setStep("confirmar");
  });
  const confirm = () => created && start(async () => {
    setError(null);
    const r = await confirmCampaignAction(created.id, { typedTotal: Number(typed), acceptRisk: risk });
    if (!r.ok) { setError(r.error); return; }
    toast(`Confirmada: começa ${dueLabel(Date.parse(r.data!.startAt), Date.now())}, uma a cada ${Math.round(gap / 60)} min, só com a Casa aberta.`, "ok");
    onClose();
  });
  const canConfirm = !!created && risk && Number(typed) === created.total;
  return (
    <Sheet open={open} onClose={onClose} title="Mensagem em massa"
      footer={step === "quem" ? <Button onClick={() => setStep("mensagem")} disabled={!preview || preview.eligible === 0 || preview.tooMany}>Continuar</Button>
        : step === "mensagem" ? <><Button variant="ghost" onClick={() => setStep("quem")}>Voltar</Button><Button onClick={create} loading={pending} disabled={!name.trim() || !body.trim()}>Revisar</Button></>
        : <Button onClick={confirm} loading={pending} disabled={!canConfirm}>Confirmar envio</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        {step === "quem" && (
          <>
            <p className="text-graphite">Filtro: {summary}</p>
            {!audience.contactIds && tags.length > 0 && (
              <Field label="Só quem tem a etiqueta" htmlFor="massa-tag">
                <Select id="massa-tag" value={tag} onChange={(e) => { setTag(e.target.value); setPreview(null); }}>
                  <option value="">Qualquer etiqueta</option>
                  {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
            )}
            <Button variant="secondary" onClick={check} loading={pending}>Ver quem recebe</Button>
            {preview && (
              <div className="rounded-[var(--radius-card)] border border-line bg-paper-2 p-3">
                <p className="font-display text-lg">{preview.eligible} vão receber</p>
                {preview.tooMany && <p className="text-alert">No máximo 300 por vez. Filtre mais.</p>}
                {preview.excluded.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-graphite">{preview.excluded.map((e) => <li key={e.reason}>{e.n} {e.label}</li>)}</ul>
                )}
                {preview.sample.length > 0 && <p className="mt-2 text-muted">Ex.: {preview.sample.map((s) => s.name ?? s.phone).join(", ")}</p>}
              </div>
            )}
          </>
        )}
        {step === "mensagem" && (
          <>
            <Field label="Nome (só a equipe vê)" htmlFor="massa-nome"><Input id="massa-nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Retorno de outubro" /></Field>
            <Field label="Mensagem" htmlFor="massa-texto" hint="Vale {primeiro_nome} e {saudacao}. Vai sem assinatura de pessoa, como mensagem da Casa.">
              <Textarea id="massa-texto" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
            </Field>
            <Field label="Intervalo entre uma e outra" htmlFor="massa-intervalo" hint="Mais devagar protege o número contra bloqueio.">
              <Select id="massa-intervalo" value={gap} onChange={(e) => setGap(Number(e.target.value))}>
                {GAPS.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
              </Select>
            </Field>
          </>
        )}
        {step === "confirmar" && created && (
          <>
            <p><b className="font-semibold">{created.total} clientes</b> vão receber “{name}”, uma a cada {Math.round(gap / 60)} min, só com a Casa aberta e no máximo 150 por dia.</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} className="mt-0.5 size-4" />
              <span>Entendo que o WhatsApp pode bloquear o número se as clientes denunciarem a mensagem.</span>
            </label>
            <Field label={`Digite ${created.total} para confirmar`} htmlFor="massa-total">
              <Input id="massa-total" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </>
        )}
        {error && <p role="alert" className="text-alert">{error}</p>}
      </div>
    </Sheet>
  );
}

/** Botão do topo de Contatos (só aparece com a chave ligada e a permissão). */
export function MassMessageButton({ audience, tags, summary }: { audience: AudienceInput; tags: string[]; summary: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <Button size="sm" variant="secondary" className="h-9" onClick={() => { setN((x) => x + 1); setOpen(true); }}>Mensagem em massa</Button>
      <MassMessageSheet key={n} open={open} onClose={() => setOpen(false)} audience={audience} tags={tags} summary={summary} />
    </>
  );
}
```

> Confira o `Select` em `src/components/ui/field.tsx` (`forwardRef<HTMLSelectElement, SelectHTMLAttributes…>`). O `key={n}` zera a folha a cada abertura.

- [ ] **Passo 4: Contatos (botão no topo e na seleção)**

Em `src/app/(app)/contatos/page.tsx`:
- imports: `import { getMassSettings } from "@/server/domain/campaigns";`, `import { listTags } from "@/server/domain/tags";`, `import { MassMessageButton } from "@/components/contacts/mass-message-sheet";`;
- depois de `const data = await listContacts(…)`:

```ts
  const massOn = can(user.perms, "mensagem.massa") && (await getMassSettings()).enabled;
  const tagNames = massOn ? (await listTags()).map((t) => t.name) : [];
  const massSummary = [q ? `busca “${q}”` : null, clientes ? "só clientes" : null].filter(Boolean).join(" · ") || "todos os contatos";
```

- `actions` do `PageHeader`:

```tsx
          actions={(massOn || can(user.perms, "config.editar")) ? <div className="flex gap-2">{massOn && <MassMessageButton audience={{ q: q || null, onlyClients: clientes }} tags={tagNames} summary={massSummary} />}{can(user.perms, "config.editar") && <ImportButton />}</div> : undefined}
```

- `<ContactsList rows={data.rows} term={q} />` vira `<ContactsList rows={data.rows} term={q} mass={massOn ? { tags: tagNames } : null} />`.

Em `src/components/contacts/contacts-list.tsx`:
- assinatura `ContactsList({ rows, term, mass }: { rows: ContactRow[]; term: string; mass?: { tags: string[] } | null })`;
- `<ContactsBulkBar ids={ids} mass={mass} />`.

Em `src/components/contacts/contacts-bulk-bar.tsx`:
- assinatura `ContactsBulkBar({ ids, mass }: { ids: string[]; mass?: { tags: string[] } | null })`;
- import `import { useState } from "react";` (junto do `useTransition`) e `import { MassMessageSheet } from "./mass-message-sheet";`;
- estado: `const [massOpen, setMassOpen] = useState(false);`, **antes** do `if (!sel?.mode) return null;` (hooks antes de retorno);
- botão, antes do "Não é cliente":

```tsx
          {mass && <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} onClick={() => setMassOpen(true)}>Mensagem em massa ({n})</Button>}
```

- depois do `</div>` de fora, dentro do `motion.div`: `{mass && <MassMessageSheet open={massOpen} onClose={() => setMassOpen(false)} audience={{ contactIds: ids }} tags={[]} summary={`${n} escolhidos`} />}`.

- [ ] **Passo 5: Configurações › Mensagem em massa**

`src/app/(app)/config/massa/page.tsx`:

```tsx
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { getMassSettings, listCampaigns } from "@/server/domain/campaigns";
import { MassSettings } from "@/components/config/mass-settings";

export const metadata = { title: "Mensagem em massa" };

export default async function MassaPage() {
  const user = await requirePerm("config.editar");
  const [s, list] = await Promise.all([getMassSettings(), listCampaigns()]);
  return <MassSettings enabled={s.enabled} campaigns={list} canSend={can(user.perms, "mensagem.massa")} />;
}
```

`src/components/config/mass-settings.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "./send-confirm";
import { saveMassSettingsAction } from "@/app/(app)/config/massa/actions";
import { cancelCampaignAction, pauseCampaignAction, resumeCampaignAction } from "@/app/(app)/contatos/massa-actions";
import type { CampaignSummary } from "@/server/domain/campaigns";

const STATUS: Record<string, string> = { rascunho: "Rascunho (não confirmada)", agendada: "Agendada", enviando: "Enviando", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };

/** A chave (nasce desligada, com confirmação "isto envia mensagens reais"), as regras e a lista com pausar/retomar/cancelar. */
export function MassSettings({ enabled, campaigns, canSend }: { enabled: boolean; campaigns: CampaignSummary[]; canSend: boolean }) {
  const [on, setOn] = useState(enabled);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const save = (v: boolean) => start(async () => {
    const r = await saveMassSettingsAction({ enabled: v });
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(v); setAsking(false); toast(v ? "Mensagem em massa ligada" : "Mensagem em massa desligada: nada mais sai", "ok");
  });
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { const r = await fn(); toast(r.ok ? done : r.error ?? "Não deu certo.", r.ok ? "ok" : "error"); });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl">Mensagem em massa</h2>
            <p className="mt-1 text-sm text-graphite">Desligada, ninguém consegue montar nem enviar. Ligada, só quem tem a permissão “Mandar mensagem em massa” (Equipe › Perfis) vê o botão em Contatos.</p>
          </div>
          <Switch checked={on} label={on ? "Desligar mensagem em massa" : "Ligar mensagem em massa"} disabled={pending} onChange={(v) => (v ? setAsking(true) : save(false))} />
        </div>
        <ul className="mt-4 list-disc pl-5 text-sm text-graphite">
          <li>Só para quem já escreveu para a Casa; ninguém com conversa aberta; ninguém duas vezes em 7 dias.</li>
          <li>No máximo 300 clientes por vez e 150 mensagens por dia, uma a cada 2 minutos ou mais, só com a Casa aberta.</li>
          <li>Confirmação dupla: marcar o risco de bloqueio e digitar quantas clientes vão receber.</li>
          <li>Desligar aqui para tudo na mesma hora (o que faltava não sai).</li>
        </ul>
      </section>
      <section aria-label="Mensagens em massa" className="rounded-[var(--radius-card)] border border-line bg-paper">
        {campaigns.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma mensagem em massa ainda.</p> : (
          <ul className="divide-y divide-line/70">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{c.name} <span className="text-graphite">· {STATUS[c.status] ?? c.status}</span></p>
                  <p className="text-graphite">{c.sent} de {c.total} enviadas{c.failed ? ` · ${c.failed} não saíram` : ""}{c.skipped ? ` · ${c.skipped} puladas` : ""} · por {c.createdByName}</p>
                </div>
                {canSend && ["agendada", "enviando", "pausada", "rascunho"].includes(c.status) && (
                  <div className="flex gap-2">
                    {c.status === "pausada"
                      ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => resumeCampaignAction(c.id), "Retomada")}>Retomar</Button>
                      : c.status !== "rascunho" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => pauseCampaignAction(c.id), "Pausada")}>Pausar</Button>}
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelCampaignAction(c.id), "Cancelada: quem não recebeu fica de fora")}>Cancelar</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <SendConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => save(true)} pending={pending}
        what="Com a chave ligada, quem tiver a permissão pode mandar a mesma mensagem para até 300 clientes de uma vez." />
    </div>
  );
}
```

Em `src/components/config/config-nav.tsx`, no `TABS`, logo depois de `["/config/mensagens", "Mensagens automáticas"]`: `["/config/massa", "Mensagem em massa"],`.

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/components/contacts src/server/auth/guard-coverage.test.ts`
Esperado: PASS. O `guard-coverage` exige `requirePerm` na página nova e `assertPerm` em cada ação: todas começam assim.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela (dev, headless, banco do worktree):
- Configurações › Mensagem em massa aparece **desligada**;
- com ela desligada, Contatos não mostra o botão;
- ligar a chave (confirmação "Isto vai enviar mensagens reais") e dar a permissão ao perfil Gestão;
- o botão aparece; "Ver quem recebe" lista as exclusões;
- **não confirmar envio** fora do banco de teste (a Evolution do worktree é a morta, e mesmo assim não confirme);
- desligar a chave de novo.

- [ ] **Passo 7: Commit**

```bash
git add "src/app/(app)/config/massa/page.tsx" "src/app/(app)/config/massa/actions.ts" "src/app/(app)/contatos/massa-actions.ts" src/components/config/mass-settings.tsx src/components/contacts/mass-message-sheet.tsx src/components/contacts/mass-message-sheet.test.tsx src/components/config/config-nav.tsx "src/app/(app)/contatos/page.tsx" src/components/contacts/contacts-list.tsx src/components/contacts/contacts-bulk-bar.tsx
git commit -m "feat(massa): chave em Configurações (desligada), montagem pelo filtro ou seleção de Contatos e confirmação dupla

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 12: Importar a ficha do ChatGuru pelos CSVs (tela de upload e script com ensaio e backup)

**Arquivos:**
- Criar: `src/server/domain/chatguru-csv.ts`, `src/server/domain/chatguru-csv.test.ts` (puro)
- Criar: `src/server/domain/chatguru-csv-import.ts`, `src/server/domain/chatguru-csv-import.test.ts`
- Criar: `src/server/domain/chatguru-import-merge.test.ts`
- Modificar: `src/server/domain/chatguru-import.ts` (`importChatguruRecord`: junta a ficha em vez de substituir e descarta campos de dados pessoais)
- Criar: `src/app/(app)/config/chatguru/page.tsx`, `src/app/(app)/config/chatguru/actions.ts`, `src/components/config/chatguru-import.tsx`
- Modificar: `src/components/config/config-nav.tsx` (`TABS`)
- Criar: `scripts/importar-chatguru-csv.ts`

**Interfaces:**
- Consome (Tarefa 1): `contactNotes` (`source: "chatguru"`, `externalKey`). Do código atual: `importChatguruRecord` (o mesmo caminho da rota `src/app/api/importar/chatguru/route.ts`), `parseCsv` (`src/server/domain/import.ts`), `forbiddenColumns` (`src/server/domain/avec/sanitize.ts`), `normalizePhone`, `TAG_MAX`.
- Produz:
  - `type ChatguruCsvKind = "chats" | "funil" | "anotacoes"`;
  - `type ChatguruCsvRow = { line; phone; name; link; since; tags: string[]; stage; responsavel; note: { at: string | null; author: string | null; text: string } | null }`;
  - `decodeCsv(buf: Uint8Array | ArrayBuffer): string` (UTF-8; se vier quebrado, Windows-1252);
  - `parseChatguruCsv(text: string): { kind; rows: ChatguruCsvRow[]; total: number; invalid: { line: number; value: string }[]; ignoredColumns: string[]; removedColumns: string[] }`;
  - `CHATGURU_CSV_MAX_BYTES = 10 MB`, `CHATGURU_CSV_MAX_ROWS = 20.000`;
  - `previewChatguruCsv(text): Promise<ChatguruImportPreview>`, `applyChatguruCsv(text, userId: string | null): Promise<ChatguruImportReport>`;
  - `importChatguruRecord` passa a **juntar** `importedFields.chatguru`: os campos se somam e o responsável, a data e o link só mudam quando vêm preenchidos. Campos como CPF ou endereço nunca são gravados;
  - rota `/config/chatguru` ("Importar do ChatGuru");
  - ações `previewChatguruCsvAction(form)` e `applyChatguruCsvAction(form)` (`config.editar`);
  - CLI `npx tsx scripts/importar-chatguru-csv.ts --dry-run arquivo.csv | --aplicar arquivo.csv` (`BACKUP_DIR`).

> **Depende da Casa exportar os CSVs.** As colunas do CSV do Funil e o arquivo de anotações não são documentados (ver `docs/chatguru-engenharia-reversa.md` §2.6 e §3.2). Por isso o leitor é guiado pelo cabeçalho, com sinônimos, e a prévia mostra as colunas que ele não entendeu. Quando o primeiro arquivo real chegar, confira a prévia antes de importar. Se uma coluna importante aparecer em "Ignoradas", acrescente o sinônimo em `ALIASES` (com teste) e só então importe.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/chatguru-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeCsv, parseChatguruCsv } from "./chatguru-csv";

const CHATS = "﻿Nome;WhatsApp;Link;Data de cadastro;Última mensagem;Tags;CPF\n" +
  "Cliente Teste Um;5571999990011;https://s12.chatguru.app/chats#6512aa;10/05/2025;oi;VIP, Noiva;123.456.789-00\n" +
  "Cliente Teste Dois;(71) 99999-0012;;;tudo bem;;\n" +
  "Sem Número;abc;;;;Promo;\n";

describe("CSV do ChatGuru: leitura", () => {
  it("relatório de chats: nome, número, link, cadastro e etiquetas; CPF sai antes de ler; colunas desconhecidas avisadas", () => {
    const p = parseChatguruCsv(CHATS);
    expect(p.kind).toBe("chats");
    expect(p.total).toBe(3);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ line: 2, phone: "+5571999990011", name: "Cliente Teste Um", link: "https://s12.chatguru.app/chats#6512aa", since: "2025-05-10", tags: ["VIP", "Noiva"], note: null });
    expect(p.rows[1]).toMatchObject({ phone: "+5571999990012", tags: [] });
    expect(p.invalid).toEqual([{ line: 4, value: "abc" }]);
    expect(p.removedColumns).toEqual(["CPF"]);
    expect(p.ignoredColumns).toEqual(["Última mensagem"]);
    expect(JSON.stringify(p.rows)).not.toContain("123.456.789-00");
  });
  it("funil: etapa e responsável", () => {
    const p = parseChatguruCsv("Nome,Número,Etapa,Responsável\nCliente Teste Um,5571999990011,Orçamento,SARA\n");
    expect(p.kind).toBe("funil");
    expect(p.rows[0]).toMatchObject({ phone: "+5571999990011", stage: "Orçamento", responsavel: "SARA" });
  });
  it("anotações: data e hora de Salvador, autor e texto", () => {
    const p = parseChatguruCsv("Número;Data;Autor;Anotação\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n");
    expect(p.kind).toBe("anotacoes");
    expect(p.rows[0].note).toEqual({ at: "2026-10-12T17:30:00.000Z", author: "SARA", text: "Cliente pediu orçamento de mega hair" });
  });
  it("sem coluna de número: erro claro", () => {
    expect(() => parseChatguruCsv("Nome;Tags\nCliente Teste;VIP\n")).toThrow(/coluna do WhatsApp/);
  });
  it("arquivo salvo no Excel (Windows-1252) sai com acento certo", () => {
    expect(decodeCsv(Buffer.from("Nome;WhatsApp\nJoão Teste;5571999990011\n", "latin1"))).toContain("João Teste");
  });
});
```

`src/server/domain/chatguru-csv-import.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contactNotes, contactTags, contacts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyChatguruCsv, previewChatguruCsv } from "./chatguru-csv-import";
import { notesOf } from "./notes";

const CHATS = "﻿Nome;WhatsApp;Link;Data de cadastro;Última mensagem;Tags;CPF;Endereço\n" +
  "Cliente Teste Um;5571999990011;https://s12.chatguru.app/chats#6512aa;10/05/2025;oi;VIP, Noiva;123.456.789-00;Rua Teste, 10\n" +
  "Cliente Teste Dois;(71) 99999-0012;;;tudo bem;;;\n" +
  "Sem Número;abc;;;;Promo;;\n";
const FUNIL = "Nome,Número,Etapa,Responsável\nCliente Teste Um,5571999990011,Orçamento,SARA\n";
const NOTAS = "Número;Data;Autor;Anotação\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n";
let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
});
const um = async () => (await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990011")))[0];

describe("importar a ficha do ChatGuru", () => {
  it("prévia: o que vai entrar, sem gravar nada", async () => {
    const p = await previewChatguruCsv(CHATS);
    expect(p).toMatchObject({ kind: "chats", total: 3, valid: 2, existing: 0, newContacts: 2, tags: ["Noiva", "VIP"], removedColumns: ["CPF", "Endereço"], ignoredColumns: ["Última mensagem"] });
    expect(p.invalid).toEqual([{ line: 4, value: "abc" }]);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("aplica: cria os contatos sem lead, com etiquetas e ficha; CPF e endereço nunca são gravados", async () => {
    const r = await applyChatguruCsv(CHATS, uid);
    expect(r).toMatchObject({ kind: "chats", contacts: 2, created: 2, invalid: 1 });
    expect(await db.select().from(deals)).toHaveLength(0);
    const c = await um();
    expect(c.importedFields?.chatguru).toMatchObject({ link: "https://s12.chatguru.app/chats#6512aa", desde: "2025-05-10" });
    expect(JSON.stringify(await db.select().from(contacts))).not.toMatch(/123\.456|Rua Teste/);
    expect((await db.select().from(contactTags).where(eq(contactTags.contactId, c.id)))).toHaveLength(2);
  });

  it("reimportar não duplica etiquetas, contatos nem notas", async () => {
    await applyChatguruCsv(CHATS, uid);
    await applyChatguruCsv(CHATS, uid);
    expect(await db.select().from(contacts)).toHaveLength(2);
    expect(await db.select().from(contactTags)).toHaveLength(2);
    await applyChatguruCsv(NOTAS, uid);
    await applyChatguruCsv(NOTAS, uid);
    expect(await db.select().from(contactNotes)).toHaveLength(1);
  });

  it("funil depois dos chats: a etapa de lá e o responsável entram sem apagar o link", async () => {
    await applyChatguruCsv(CHATS, uid);
    await applyChatguruCsv(FUNIL, uid);
    expect((await um()).importedFields?.chatguru).toMatchObject({ link: "https://s12.chatguru.app/chats#6512aa", responsavel: "SARA", campos: { "Etapa no ChatGuru": "Orçamento" } });
  });

  it("anotações viram notas internas da cliente, com a autora de lá e a data certa", async () => {
    await applyChatguruCsv(NOTAS, uid);
    const [n] = await notesOf((await um()).id);
    expect(n).toMatchObject({ body: "Cliente pediu orçamento de mega hair", authorName: "SARA", source: "chatguru" });
    expect(n.createdAt.toISOString()).toBe("2026-10-12T17:30:00.000Z");
  });
});
```

`src/server/domain/chatguru-import-merge.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { importChatguruRecord } from "./chatguru-import";

beforeEach(async () => { await resetDb(); });

it("“Post para URL” e CSV juntam a ficha: a segunda importação não apaga a primeira, e CPF/endereço nunca são gravados", async () => {
  await importChatguruRecord({ chat_id: "abc", celular: "5571999990081", nome: "Cliente Teste Um", responsavel_nome: "SARA", link_chat: "https://s12.chatguru.app/chats#abc",
    campos_personalizados: { "Cor preferida": "loiro", CPF: "111.222.333-44", "Endereço": "Rua Teste, 1" } });
  await importChatguruRecord({ chat_id: "csv-funil:+5571999990081", celular: "+5571999990081", campos_personalizados: { "Etapa no ChatGuru": "Orçamento" } });
  const [c] = await db.select().from(contacts);
  expect(c.importedFields?.chatguru).toMatchObject({ responsavel: "SARA", link: "https://s12.chatguru.app/chats#abc", campos: { "Cor preferida": "loiro", "Etapa no ChatGuru": "Orçamento" } });
  expect(JSON.stringify(c.importedFields)).not.toMatch(/111\.222|Rua Teste/);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/chatguru-csv.test.ts src/server/domain/chatguru-csv-import.test.ts src/server/domain/chatguru-import-merge.test.ts`
Esperado: FAIL. Os módulos novos não existem, e no teste de junção o responsável e o link somem (hoje a segunda importação substitui o objeto `chatguru`).

- [ ] **Passo 3: Junção da ficha e filtro de dados pessoais no caminho que já existe**

Em `src/server/domain/chatguru-import.ts`:
- import `import { forbiddenColumns } from "./avec/sanitize";`;
- depois do cálculo de `campos`, descartar os proibidos:

```ts
  // CPF, RG, endereço, banco: nunca ficam guardados (mesma regra do Avec). A lista de chaves é calculada antes de apagar.
  const keys = Object.keys(campos);
  for (const i of forbiddenColumns(keys)) delete campos[keys[i]];
```

> `campos` precisa ser `let`/objeto mutável: hoje ele nasce de `Object.fromEntries(…)`, que já é um objeto comum, então o `delete` funciona.

- trocar o `set` do `update` (o ramo "Já existe") por:

```ts
    const scalars = Object.fromEntries(Object.entries({ responsavel: chatguru.responsavel, desde: chatguru.desde, link: chatguru.link, atualizadoEm: chatguru.atualizadoEm })
      .filter(([, v]) => v != null && v !== ""));
    // Junta com o que já veio antes (outro CSV, outro "Post para URL"): campos se somam; responsável, data e link só mudam quando vêm preenchidos.
    const [c] = await db.update(contacts).set({
      importedFields: sql`jsonb_set(coalesce(${contacts.importedFields}, '{}'::jsonb), '{chatguru}',
        coalesce(${contacts.importedFields}->'chatguru', '{}'::jsonb) || ${JSON.stringify(scalars)}::jsonb
        || jsonb_build_object('campos', coalesce(${contacts.importedFields}->'chatguru'->'campos', '{}'::jsonb) || ${JSON.stringify(campos)}::jsonb))`,
      name: sql`coalesce(nullif(trim(${contacts.name}), ''), ${name})`,
    }).where(eq(contacts.phoneE164, phone)).returning({ id: contacts.id });
```

Rodar: `npx vitest run src/server/domain/chatguru-import-merge.test.ts src/server/domain/chatguru-import.test.ts src/app/api/importar/chatguru/route.test.ts`
Esperado: PASS (os testes antigos da rota continuam valendo).

- [ ] **Passo 4: Leitor do CSV (puro)**

`src/server/domain/chatguru-csv.ts`:

```ts
import { parseCsv } from "./import";
import { forbiddenColumns } from "./avec/sanitize";
import { normalizePhone } from "./phone";
import { TAG_MAX } from "./tags";
import { UserFacingError } from "./errors";

export type ChatguruCsvKind = "chats" | "funil" | "anotacoes";
export type ChatguruCsvRow = {
  line: number; phone: string; name: string | null; link: string | null; since: string | null; tags: string[];
  stage: string | null; responsavel: string | null; note: { at: string | null; author: string | null; text: string } | null;
};
export type ChatguruCsvParse = { kind: ChatguruCsvKind; rows: ChatguruCsvRow[]; total: number; invalid: { line: number; value: string }[]; ignoredColumns: string[]; removedColumns: string[] };

/** CSV do ChatGuru em UTF-8; se vier quebrado (salvo no Excel do Windows), lê como Windows-1252. */
export function decodeCsv(buf: Uint8Array | ArrayBuffer): string {
  const utf = new TextDecoder("utf-8").decode(buf);
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Sinônimos dos cabeçalhos (as colunas do Funil e das anotações não são documentadas: a prévia mostra o que sobrar). Ordem = prioridade. */
const ALIASES: [key: string, names: string[]][] = [
  ["phone", ["whatsapp", "celular", "numero", "telefone", "numero do whatsapp", "numero do contato", "phone"]],
  ["noteText", ["anotacao", "anotacoes", "anotacao interna", "nota", "texto da anotacao"]],
  ["noteAuthor", ["autor", "autor da anotacao", "criado por", "usuario"]],
  ["noteAt", ["data", "data da anotacao", "data hora", "criada em"]],
  ["name", ["nome", "nome do chat", "nome do contato", "chat", "cliente", "contato"]],
  ["link", ["link", "link do chat", "url", "link chat"]],
  ["since", ["data de cadastro", "cadastro", "cadastrado em", "data cadastro", "criado em", "data de criacao"]],
  ["tags", ["tags", "tag", "etiquetas", "etiqueta"]],
  ["stage", ["etapa", "etapa do funil", "coluna", "fase"]],
  ["responsavel", ["responsavel", "responsaveis", "usuario responsavel", "delegado", "delegado para", "atendente"]],
];

const clean = (s: string | undefined) => s?.trim().replace(/\s+/g, " ") || null;
function isoDate(s: string | undefined): string | null {
  const t = s?.trim() ?? "";
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}
/** "12/10/2026 14:30" (Salvador) ou ISO → instante ISO. */
function noteInstant(s: string | undefined): string | null {
  const t = s?.trim() ?? "";
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  const d = m ? new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:00-03:00`) : t ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * Lê um CSV exportado do ChatGuru (Relatório de Chats, Funil ou um CSV de anotações), guiado pelo cabeçalho.
 * Colunas de dados pessoais (CPF, RG, endereço, banco) saem ANTES de ler qualquer linha e nunca chegam ao resultado.
 */
export function parseChatguruCsv(text: string): ChatguruCsvParse {
  const all = parseCsv(text);
  if (all.length === 0) throw new UserFacingError("O arquivo está vazio.");
  const header = all[0].map((h) => h.trim());
  const removed = new Set(forbiddenColumns(header));
  const used = new Set<number>();
  const col: Record<string, number> = {};
  for (const [key, names] of ALIASES) {
    const i = header.findIndex((h, idx) => !removed.has(idx) && !used.has(idx) && names.includes(norm(h)));
    if (i >= 0) { col[key] = i; used.add(i); }
  }
  if (col.phone === undefined) throw new UserFacingError("Não achei a coluna do WhatsApp (número) no arquivo. Confira se é o CSV exportado do ChatGuru.");
  const kind: ChatguruCsvKind = col.noteText !== undefined ? "anotacoes" : col.stage !== undefined ? "funil" : "chats";
  const cell = (r: string[], key: string) => (col[key] === undefined ? undefined : r[col[key]]);
  const rows: ChatguruCsvRow[] = [];
  const invalid: { line: number; value: string }[] = [];
  all.slice(1).forEach((r, i) => {
    const line = i + 2;
    const raw = cell(r, "phone")?.trim() ?? "";
    const phone = normalizePhone(raw);
    if (!phone) { invalid.push({ line, value: raw }); return; }
    const text = clean(cell(r, "noteText"));
    if (kind === "anotacoes" && !text) { invalid.push({ line, value: "anotação vazia" }); return; }
    rows.push({
      line, phone, name: clean(cell(r, "name"))?.slice(0, 120) ?? null, link: clean(cell(r, "link")), since: isoDate(cell(r, "since")),
      tags: (cell(r, "tags") ?? "").split(/[,;|]/).map((t) => t.trim()).filter((t) => t && t.length <= TAG_MAX),
      stage: clean(cell(r, "stage")), responsavel: clean(cell(r, "responsavel")),
      note: kind === "anotacoes" ? { at: noteInstant(cell(r, "noteAt")), author: clean(cell(r, "noteAuthor")), text: text! } : null,
    });
  });
  return {
    kind, rows, total: all.length - 1, invalid,
    ignoredColumns: header.filter((_, i) => !used.has(i) && !removed.has(i) && header[i]),
    removedColumns: header.filter((_, i) => removed.has(i)),
  };
}
```

> No CSV de chats, "Data" sozinha (sem "de cadastro") cai em `noteAt`, que só vale para anotações. Ela aparece como usada e não como ignorada. É de propósito: o cabeçalho "Data" do relatório de chats é a data da última mensagem, que não importamos.

- [ ] **Passo 5: Aplicar (banco)**

`src/server/domain/chatguru-csv-import.ts`:

```ts
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contactNotes, contacts } from "../db/schema";
import { importChatguruRecord } from "./chatguru-import";
import { parseChatguruCsv, type ChatguruCsvKind } from "./chatguru-csv";
import { UserFacingError } from "./errors";

export const CHATGURU_CSV_MAX_BYTES = 10 * 1024 * 1024;
export const CHATGURU_CSV_MAX_ROWS = 20_000;
export type ChatguruImportPreview = { kind: ChatguruCsvKind; total: number; valid: number; invalid: { line: number; value: string }[]; existing: number; newContacts: number; tags: string[]; notes: number; ignoredColumns: string[]; removedColumns: string[] };
export type ChatguruImportReport = { kind: ChatguruCsvKind; contacts: number; created: number; notes: number; invalid: number };

function parseChecked(text: string) {
  if (Buffer.byteLength(text, "utf8") > CHATGURU_CSV_MAX_BYTES) throw new UserFacingError("O arquivo passa de 10 MB. Exporte por período e envie em partes.");
  const p = parseChatguruCsv(text);
  if (p.total > CHATGURU_CSV_MAX_ROWS) throw new UserFacingError(`O arquivo tem mais de ${CHATGURU_CSV_MAX_ROWS.toLocaleString("pt-BR")} linhas. Envie em partes.`);
  return p;
}

/** Prévia: o que vai entrar, sem gravar nada. */
export async function previewChatguruCsv(text: string): Promise<ChatguruImportPreview> {
  const p = parseChecked(text);
  const phones = [...new Set(p.rows.map((r) => r.phone))];
  const existing = phones.length ? (await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.phoneE164, phones))).length : 0;
  return {
    kind: p.kind, total: p.total, valid: p.rows.length, invalid: p.invalid.slice(0, 50), existing, newContacts: phones.length - existing,
    tags: [...new Set(p.rows.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "pt-BR")), notes: p.rows.filter((r) => r.note).length,
    ignoredColumns: p.ignoredColumns, removedColumns: p.removedColumns,
  };
}

/** Contato pelo número; se não existe, nasce sem lead (como no "Post para URL"). */
async function contactIdFor(phone: string, name: string | null): Promise<string> {
  const [found] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
  if (found) return found.id;
  const [c] = await db.insert(contacts).values({ phoneE164: phone, name }).onConflictDoNothing().returning({ id: contacts.id });
  return c?.id ?? (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone)))[0].id;
}

/**
 * Importa idempotente pelo número. Chats e Funil passam por `importChatguruRecord` (etiquetas somadas, ficha juntada, sem lead).
 * Anotações viram notas internas (`source: "chatguru"`), uma vez só (`externalKey` = número + data + autora + texto).
 */
export async function applyChatguruCsv(text: string, userId: string | null): Promise<ChatguruImportReport> {
  const p = parseChecked(text);
  let created = 0, notes = 0;
  const touched = new Set<string>();
  for (const r of p.rows) {
    if (p.kind === "anotacoes" && r.note) {
      const contactId = await contactIdFor(r.phone, r.name);
      touched.add(contactId);
      const key = createHash("sha1").update(`${r.phone}|${r.note.at ?? ""}|${r.note.author ?? ""}|${r.note.text}`).digest("hex");
      const [ins] = await db.insert(contactNotes).values({
        contactId, authorName: r.note.author?.slice(0, 60) ?? "ChatGuru", body: r.note.text.slice(0, 2000), source: "chatguru", externalKey: `chatguru:${key}`,
        ...(r.note.at ? { createdAt: new Date(r.note.at) } : {}),
      }).onConflictDoNothing().returning({ id: contactNotes.id });
      if (ins) notes++;
      continue;
    }
    const res = await importChatguruRecord({
      chat_id: `csv-${p.kind}:${r.phone}`, celular: r.phone, nome: r.name ?? undefined, tags: r.tags, link_chat: r.link, chat_created: r.since,
      responsavel_nome: r.responsavel, campos_personalizados: r.stage ? { "Etapa no ChatGuru": r.stage } : undefined,
    });
    if (res.ok) { touched.add(res.contactId); if (res.created) created++; }
  }
  await db.insert(auditLog).values({ userId, action: "importou", entity: "chatguru_csv", entityId: null, data: { tipo: p.kind, contatos: touched.size, criados: created, notas: notes, invalidas: p.invalid.length } });
  return { kind: p.kind, contacts: touched.size, created, notes, invalid: p.invalid.length };
}
```

Rodar: `npx vitest run src/server/domain/chatguru-csv.test.ts src/server/domain/chatguru-csv-import.test.ts`
Esperado: PASS.

- [ ] **Passo 6: Tela de upload e ações**

`src/app/(app)/config/chatguru/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { decodeCsv } from "@/server/domain/chatguru-csv";
import { applyChatguruCsv, CHATGURU_CSV_MAX_BYTES, previewChatguruCsv } from "@/server/domain/chatguru-csv-import";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues[0]?.message ?? "Arquivo inválido." : userErrorMessage(e, "chatguru") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.editar"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/chatguru"); revalidatePath("/contatos"); return { ok: true, data }; } catch (e) { return fail(e); }
}
const textOf = async (form: FormData) => {
  const f = form.get("file");
  if (!(f instanceof File) || !f.size) throw new Error("Escolha um arquivo .csv.");
  if (f.size > CHATGURU_CSV_MAX_BYTES) throw new Error("O arquivo passa de 10 MB. Exporte por período e envie em partes.");
  return decodeCsv(new Uint8Array(await f.arrayBuffer()));
};
export const previewChatguruCsvAction = async (form: FormData) => run(async () => previewChatguruCsv(await textOf(form)));
export const applyChatguruCsvAction = async (form: FormData) => run(async (u) => applyChatguruCsv(await textOf(form), u));
```

`src/app/(app)/config/chatguru/page.tsx`:

```tsx
import { requirePerm } from "@/server/auth/session";
import { ChatguruImport } from "@/components/config/chatguru-import";

export const metadata = { title: "Importar do ChatGuru" };

export default async function ChatguruPage() {
  await requirePerm("config.editar");
  return <ChatguruImport />;
}
```

`src/components/config/chatguru-import.tsx`:

```tsx
"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { IconUpload } from "@/components/icons";
import { applyChatguruCsvAction, previewChatguruCsvAction } from "@/app/(app)/config/chatguru/actions";
import type { ChatguruImportPreview, ChatguruImportReport } from "@/server/domain/chatguru-csv-import";

const KIND = { chats: "Relatório de Chats", funil: "Funil", anotacoes: "Anotações" } as const;

/** Upload dos CSVs do ChatGuru: prévia primeiro (nada é gravado), depois Importar. Pode repetir: nada duplica. */
export function ChatguruImport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ChatguruImportPreview | null>(null);
  const [report, setReport] = useState<ChatguruImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const form = () => { const fd = new FormData(); fd.set("file", file!); return fd; };
  const ver = () => file && start(async () => { const r = await previewChatguruCsvAction(form()); if (r.ok) { setPreview(r.data!); setError(null); } else setError(r.error); });
  const importar = () => file && start(async () => { const r = await applyChatguruCsvAction(form()); if (r.ok) { setReport(r.data!); setError(null); } else setError(r.error); });
  const pick = (f: File | undefined) => { if (!f) return; setFile(f); setPreview(null); setReport(null); setError(null); };
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm text-graphite">
        <h2 className="font-display text-xl text-ink">Importar do ChatGuru</h2>
        <p className="mt-1">Envie os CSVs que a Casa exporta no ChatGuru, um de cada vez. Pode enviar de novo: nada duplica. Ninguém ganha lead nem recebe mensagem.</p>
        <ul className="mt-3 list-disc pl-5">
          <li><b className="font-semibold text-ink">Relatório de Chats</b> (Relatórios › Chats › Exportar CSV): nome, número, link, data de cadastro e etiquetas.</li>
          <li><b className="font-semibold text-ink">Funil</b> (Funis › Mais opções › Exportar em CSV): a etapa de lá e o responsável ficam na ficha da cliente.</li>
          <li><b className="font-semibold text-ink">Anotações</b> (CSV com número, data, autor e anotação): viram notas internas na conversa.</li>
        </ul>
        <p className="mt-3">CPF, RG, endereço e dados bancários são descartados antes de ler o arquivo.</p>
      </section>
      <button type="button" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
        className="w-full rounded-[var(--radius-card)] border-2 border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-gold hover:bg-gold-soft/30">
        <IconUpload className="mx-auto text-gold" size={22} />
        <span className="mt-2 block text-sm font-medium">{file ? file.name : "Escolher ou soltar o arquivo .csv"}</span>
      </button>
      <input ref={input} type="file" hidden accept=".csv,text/csv" aria-label="Arquivo CSV do ChatGuru" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {!preview && !report && <Button onClick={ver} loading={pending} disabled={!file}>Ver prévia</Button>}
      {preview && !report && (
        <section aria-label="Prévia" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 text-sm">
          <p className="font-display text-lg">{KIND[preview.kind]}: {preview.valid} de {preview.total} linhas com número válido</p>
          <ul className="mt-2 list-disc pl-5 text-graphite">
            <li>{preview.newContacts} contatos novos · {preview.existing} já existiam (só completamos a ficha)</li>
            {preview.tags.length > 0 && <li>Etiquetas: {preview.tags.join(", ")}</li>}
            {preview.notes > 0 && <li>{preview.notes} anotações viram notas internas</li>}
            {preview.invalid.length > 0 && <li>Sem número válido: {preview.invalid.slice(0, 5).map((x) => `linha ${x.line} (${x.value || "vazio"})`).join(", ")}{preview.invalid.length > 5 ? "…" : ""}</li>}
            {preview.ignoredColumns.length > 0 && <li>Colunas que não usamos: {preview.ignoredColumns.join(", ")}</li>}
            {preview.removedColumns.length > 0 && <li>Descartadas (dados pessoais): {preview.removedColumns.join(", ")}</li>}
          </ul>
          <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setPreview(null)}>Voltar</Button><Button onClick={importar} loading={pending} disabled={preview.valid === 0}>Importar</Button></div>
        </section>
      )}
      {report && <p role="status" className="rounded-[var(--radius-card)] bg-ok-soft px-4 py-3 text-sm font-medium text-ok">Importado: {report.contacts} contatos ({report.created} novos){report.notes ? `, ${report.notes} notas` : ""}{report.invalid ? `; ${report.invalid} linhas sem número ficaram de fora` : ""}.</p>}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
    </div>
  );
}
```

Em `src/components/config/config-nav.tsx`, no `TABS`, logo depois de `["/config/origens", "Origens"]`: `["/config/chatguru", "Importar do ChatGuru"],`.

- [ ] **Passo 7: Script com ensaio e backup (para produção)**

`scripts/importar-chatguru-csv.ts`:

```ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { contactNotes, contacts, contactTags, tags } from "../src/server/db/schema";
import { decodeCsv, parseChatguruCsv } from "../src/server/domain/chatguru-csv";
import { applyChatguruCsv, previewChatguruCsv } from "../src/server/domain/chatguru-csv-import";

/**
 * Importa um CSV do ChatGuru em produção.
 *   --dry-run <arquivo.csv>  só a prévia (nada é gravado)
 *   --aplicar <arquivo.csv>  backup JSON dos contatos que serão tocados (BACKUP_DIR, padrão ./backups), importa e confere
 * Nunca envia mensagem nem cria lead. O backup fica no servidor, nunca no repositório.
 */
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!["--dry-run", "--aplicar"].includes(mode ?? "") || !file) throw new Error("Uso: --dry-run arquivo.csv | --aplicar arquivo.csv");
  const text = decodeCsv(await readFile(file));
  const prev = await previewChatguruCsv(text);
  console.log(`Arquivo: ${prev.kind} · ${prev.total} linhas · ${prev.valid} válidas · ${prev.invalid.length} sem número válido`);
  console.log(`Contatos: ${prev.existing} já existem, ${prev.newContacts} novos · etiquetas: ${prev.tags.join(", ") || "nenhuma"} · anotações: ${prev.notes}`);
  if (prev.removedColumns.length) console.log(`Descartadas (dados pessoais): ${prev.removedColumns.join(", ")}`);
  if (prev.ignoredColumns.length) console.log(`Não usadas: ${prev.ignoredColumns.join(", ")}`);
  if (mode === "--dry-run") { console.log("Ensaio: nada foi gravado."); return; }
  const phones = [...new Set(parseChatguruCsv(text).rows.map((r) => r.phone))];
  const before = phones.length ? await db.select().from(contacts).where(inArray(contacts.phoneE164, phones)) : [];
  const ids = before.map((c) => c.id);
  const em = new Date().toISOString();
  const backup = {
    em, arquivo: path.basename(file),
    contatos: before.map((c) => ({ id: c.id, phone: c.phoneE164, name: c.name, importedFields: c.importedFields })),
    etiquetas: ids.length ? await db.select({ contactId: contactTags.contactId, tag: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(inArray(contactTags.contactId, ids)) : [],
    notas: ids.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(contactNotes).where(inArray(contactNotes.contactId, ids)))[0].n : 0,
  };
  const dir = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `chatguru-csv-${em.replace(/[:.]/g, "-")}-antes.json`);
  await writeFile(out, JSON.stringify(backup, null, 2));
  console.log(`Backup: ${out}`);
  const r = await applyChatguruCsv(text, null);
  console.log(`Feito: ${r.contacts} contatos tocados, ${r.created} criados, ${r.notes} notas novas, ${r.invalid} linhas sem número válido.`);
  const after = phones.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(inArray(contacts.phoneE164, phones)))[0].n : 0;
  console.log(`Conferência: ${after} contatos com esses números (antes ${before.length}; esperado ${before.length + prev.newContacts}).`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/chatguru-csv.test.ts src/server/domain/chatguru-csv-import.test.ts src/server/domain/chatguru-import-merge.test.ts src/server/domain/chatguru-import.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Ensaio do script contra o banco do worktree, com um CSV fictício criado na hora em `/tmp`:

```bash
printf 'Nome;WhatsApp;Tags\nCliente Teste Um;5571999990011;VIP\n' > /tmp/chatguru-teste.csv
npx tsx scripts/importar-chatguru-csv.ts --dry-run /tmp/chatguru-teste.csv
```

Esperado: "Arquivo: chats · 1 linhas · 1 válidas" e "Ensaio: nada foi gravado.".

- [ ] **Passo 9: Commit**

```bash
git add src/server/domain/chatguru-csv.ts src/server/domain/chatguru-csv.test.ts src/server/domain/chatguru-csv-import.ts src/server/domain/chatguru-csv-import.test.ts src/server/domain/chatguru-import-merge.test.ts src/server/domain/chatguru-import.ts "src/app/(app)/config/chatguru/page.tsx" "src/app/(app)/config/chatguru/actions.ts" src/components/config/chatguru-import.tsx src/components/config/config-nav.tsx scripts/importar-chatguru-csv.ts
git commit -m "feat(chatguru): importar a ficha pelos CSVs (chats, funil, anotações) com prévia; ficha juntada sem apagar a anterior; CPF/endereço descartados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 13: Exportar a conversa (texto e PDF) para a LGPD

**Arquivos:**
- Criar: `src/lib/transcript.ts`, `src/lib/transcript.test.ts`
- Criar: `src/server/queries/transcript.ts`
- Criar: `src/server/domain/conversation-export.ts`, `src/server/domain/conversation-export.test.ts`
- Criar: `src/app/api/contatos/[id]/conversa/route.ts`
- Criar: `src/app/imprimir/conversa/page.tsx`
- Criar: `src/components/contacts/export-conversation.tsx`
- Modificar: `src/app/(app)/contatos/[id]/page.tsx`, ao lado do `StartConversation` (`grep -n "StartConversation contactId" "src/app/(app)/contatos/[id]/page.tsx"`)
- Modificar: `src/server/auth/guard-coverage.test.ts` (`PUBLIC_PAGES`)

**Interfaces:**
- Consome: `stripSignature`, `parseSignature`, `signatureDisplayName` (1A), `teamNameCol`, `formatPhoneClient`, `renderPagePdf` (`src/server/reports/pdf.ts`), `consumePrintToken` (`src/server/reports/print-token.ts`). Da Tarefa 2: `contactNotes`.
- Produz:
  - `type TranscriptLine = { at: Date; direction: "in" | "out" | "nota"; kind: string; body: string | null; author: string | null; deleted?: boolean; edited?: boolean }`;
  - `stamp(d: Date): string`;
  - `transcriptLine(l, clientName): string`;
  - `transcriptText(input: { clientName; phone; generatedAt; generatedBy; lines; withNotes; truncated? }): string`;
  - `TRANSCRIPT_MAX = 20.000`;
  - `loadTranscript(contactId, { notes }): Promise<{ clientName; phone; lines; truncated } | null>`;
  - `exportConversationText(contactId, user: { id; name }, { notes }, now?): Promise<{ filename; body } | null>`;
  - `logConversationPdf(contactId, user: { id }, notes, now?): Promise<{ filename } | null>`;
  - rota `GET /api/contatos/[id]/conversa?formato=txt|pdf&notas=1`: exige `contatos.ver` **e** `relatorios.exportar` e registra no `audit_log` (`action "exportou"`, `entity "conversa"`);
  - página `/imprimir/conversa?contato=<id>&notas=1&t=<token>`;
  - `<ExportConversation contactId />`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/lib/transcript.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { transcriptText, type TranscriptLine } from "./transcript";

const lines: TranscriptLine[] = [
  { at: new Date("2026-10-15T17:02:00Z"), direction: "in", kind: "text", body: "Oi, quanto custa a escova?", author: null },
  { at: new Date("2026-10-15T17:05:00Z"), direction: "out", kind: "text", body: "*SARA - CASA FIAES:*\nA escova sai por R$ 80.", author: "Sara" },
  { at: new Date("2026-10-15T17:06:00Z"), direction: "nota", kind: "nota", body: "Cliente prefere sábado", author: "Sara" },
  { at: new Date("2026-10-15T17:07:00Z"), direction: "in", kind: "image", body: "foto do cabelo", author: null, deleted: true },
];
const base = { clientName: "Cliente Teste", phone: "(71) 99999-0091", generatedAt: new Date("2026-10-15T18:00:00Z"), generatedBy: "Thaíse", lines };

describe("conversa exportada em texto", () => {
  it("linhas legíveis no horário de Salvador, sem a assinatura crua, com o tipo de mídia e as marcas", () => {
    expect(transcriptText({ ...base, withNotes: false }).split("\n")).toEqual([
      "Conversa de Cliente Teste ((71) 99999-0091) com a Casa Fiaes",
      "Gerado em 15/10/2026 15:00 por Thaíse",
      "Período: 15/10/2026 14:02 a 15/10/2026 14:07 · 3 registros",
      "",
      "15/10/2026 14:02 · Cliente Teste (cliente): Oi, quanto custa a escova?",
      "15/10/2026 14:05 · Casa Fiaes (Sara): A escova sai por R$ 80.",
      "15/10/2026 14:07 · Cliente Teste (cliente): [Foto] foto do cabelo [apagada pela cliente]",
      "",
    ]);
  });
  it("notas internas só quando pedido, e o cabeçalho avisa", () => {
    const t = transcriptText({ ...base, withNotes: true });
    expect(t).toContain("15/10/2026 14:06 · Nota interna de Sara: Cliente prefere sábado");
    expect(t).toContain("inclui notas internas (só a equipe via)");
  });
  it("sem mensagens, diz isso", () => {
    expect(transcriptText({ ...base, lines: [], withNotes: false })).toContain("Nenhuma mensagem registrada.");
  });
});
```

`src/server/domain/conversation-export.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { addNote } from "./notes";
import { exportConversationText } from "./conversation-export";

let sara = "", gestao = "", dealId = "", contactId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestao }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999990091", pushName: "Cliente Teste", body: "Oi, quanto custa a escova?", at: new Date("2026-10-15T17:02:00Z") });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nA escova sai por R$ 80.", userId: sara, at: new Date("2026-10-15T17:05:00Z") });
  await addNote({ dealId, body: "Cliente prefere sábado" }, sara, new Date("2026-10-15T17:06:00Z"));
});

describe("exportar conversa", () => {
  it("texto com cliente e Casa, sem notas por padrão, e registra quem exportou", async () => {
    const out = await exportConversationText(contactId, { id: gestao, name: "Thaíse Teste" }, { notes: false }, new Date("2026-10-15T18:00:00Z"));
    expect(out!.filename).toBe("conversa-cliente-teste-2026-10-15.txt");
    expect(out!.body).toContain("Cliente Teste (cliente): Oi, quanto custa a escova?");
    expect(out!.body).toContain("Casa Fiaes (Sara Lima): A escova sai por R$ 80.");
    expect(out!.body).not.toContain("Cliente prefere sábado");
    const withNotes = await exportConversationText(contactId, { id: gestao, name: "Thaíse Teste" }, { notes: true });
    expect(withNotes!.body).toContain("Nota interna de Sara Lima: Cliente prefere sábado");
    const logs = await db.select().from(auditLog).where(eq(auditLog.entity, "conversa"));
    expect(logs.map((l) => [l.userId, l.action, (l.data as { notas: boolean }).notas])).toEqual([[gestao, "exportou", false], [gestao, "exportou", true]]);
  });
  it("contato que não existe: nada", async () => {
    expect(await exportConversationText("00000000-0000-4000-8000-000000000000", { id: gestao, name: "x" }, { notes: false })).toBeNull();
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/transcript.test.ts src/server/domain/conversation-export.test.ts`
Esperado: FAIL (módulos não existem).

- [ ] **Passo 3: Implementar**

`src/lib/transcript.ts`:

```ts
import { stripSignature } from "./signature";

/** Uma linha da conversa exportada (LGPD): mensagem da cliente, da Casa ou nota interna. */
export type TranscriptLine = { at: Date; direction: "in" | "out" | "nota"; kind: string; body: string | null; author: string | null; deleted?: boolean; edited?: boolean };
const OFFSET_MS = 3 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** "15/10/2026 14:02" no horário de Salvador. */
export const stamp = (d: Date) => { const x = new Date(d.getTime() - OFFSET_MS); return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; };
const KIND: Record<string, string> = { image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", call: "Ligação", other: "Mensagem sem prévia" };

export function transcriptLine(l: TranscriptLine, clientName: string): string {
  const who = l.direction === "in" ? `${clientName} (cliente)` : l.direction === "nota" ? `Nota interna de ${l.author ?? "alguém da equipe"}` : `Casa Fiaes${l.author ? ` (${l.author})` : ""}`;
  const text = (l.direction === "out" ? stripSignature(l.body) : l.body ?? "").trim();
  const label = l.kind !== "text" && l.kind !== "nota" ? `[${KIND[l.kind] ?? "Mensagem"}]` : "";
  const flags = `${l.deleted ? " [apagada pela cliente]" : ""}${l.edited ? " [editada]" : ""}`;
  return `${stamp(l.at)} · ${who}: ${[label, text].filter(Boolean).join(" ")}${flags}`;
}

export function transcriptText(input: { clientName: string; phone: string; generatedAt: Date; generatedBy: string; lines: TranscriptLine[]; withNotes: boolean; truncated?: boolean }): string {
  const lines = input.lines.filter((l) => input.withNotes || l.direction !== "nota");
  const head = [
    `Conversa de ${input.clientName} (${input.phone}) com a Casa Fiaes`,
    `Gerado em ${stamp(input.generatedAt)} por ${input.generatedBy}${input.withNotes ? " · inclui notas internas (só a equipe via)" : ""}`,
    lines.length
      ? `Período: ${stamp(lines[0].at)} a ${stamp(lines[lines.length - 1].at)} · ${lines.length} registro${lines.length === 1 ? "" : "s"}${input.truncated ? " (só os 20.000 primeiros)" : ""}`
      : "Nenhuma mensagem registrada.",
    "",
  ];
  return [...head, ...lines.map((l) => transcriptLine(l, input.clientName))].join("\n") + "\n";
}
```

`src/server/queries/transcript.ts`:

```ts
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { contactNotes, contacts, messages, users } from "../db/schema";
import { teamNameCol } from "./team-name";
import { parseSignature, signatureDisplayName } from "@/lib/signature";
import { formatPhoneClient } from "@/lib/phone-client";
import type { TranscriptLine } from "@/lib/transcript";

export const TRANSCRIPT_MAX = 20_000;

/** Toda a conversa da cliente (todas as conversas dela, pelo número), da mais antiga para a mais nova; notas só se pedido. */
export async function loadTranscript(contactId: string, opts: { notes: boolean }): Promise<{ clientName: string; phone: string; lines: TranscriptLine[]; truncated: boolean } | null> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return null;
  const rows = await db.select({ at: messages.createdAt, direction: messages.direction, kind: messages.kind, body: messages.body, team: teamNameCol(), deleted: messages.deletedAt, edited: messages.editedAt })
    .from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
    .where(eq(messages.contactId, contactId)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(TRANSCRIPT_MAX + 1);
  const lines: TranscriptLine[] = rows.slice(0, TRANSCRIPT_MAX).map((r) => ({
    at: r.at, direction: r.direction, kind: r.kind, body: r.body, deleted: !!r.deleted, edited: !!r.edited,
    author: r.direction === "out" ? r.team ?? signatureDisplayName(parseSignature(r.body)) : null,
  }));
  if (opts.notes) {
    const notes = await db.select({ at: contactNotes.createdAt, body: contactNotes.body, team: teamNameCol(), authorName: contactNotes.authorName })
      .from(contactNotes).leftJoin(users, eq(users.id, contactNotes.authorId)).where(eq(contactNotes.contactId, contactId)).orderBy(asc(contactNotes.createdAt));
    lines.push(...notes.map((n) => ({ at: n.at, direction: "nota" as const, kind: "nota", body: n.body, author: n.team ?? n.authorName ?? null })));
    lines.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return { clientName: c.name?.trim() || formatPhoneClient(c.phoneE164), phone: formatPhoneClient(c.phoneE164), lines, truncated: rows.length > TRANSCRIPT_MAX };
}
```

`src/server/domain/conversation-export.ts`:

```ts
import { db } from "../db";
import { auditLog } from "../db/schema";
import { loadTranscript } from "../queries/transcript";
import { transcriptText } from "@/lib/transcript";

const OFFSET_MS = 3 * 3_600_000;
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
const day = (d: Date) => new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);

/** Conversa em texto (pedido da cliente pela LGPD ou para guardar). Fica registrado quem exportou e se levou as notas. */
export async function exportConversationText(contactId: string, user: { id: string; name: string }, opts: { notes: boolean }, now = new Date()): Promise<{ filename: string; body: string } | null> {
  const t = await loadTranscript(contactId, opts);
  if (!t) return null;
  await db.insert(auditLog).values({ userId: user.id, action: "exportou", entity: "conversa", entityId: contactId, data: { formato: "texto", notas: opts.notes, registros: t.lines.length } });
  return {
    filename: `conversa-${slug(t.clientName)}-${day(now)}.txt`,
    body: transcriptText({ clientName: t.clientName, phone: t.phone, generatedAt: now, generatedBy: user.name, lines: t.lines, withNotes: opts.notes, truncated: t.truncated }),
  };
}

/** O PDF sai da página /imprimir/conversa; aqui ficam o registro de quem exportou e o nome do arquivo. */
export async function logConversationPdf(contactId: string, user: { id: string }, notes: boolean, now = new Date()): Promise<{ filename: string } | null> {
  const t = await loadTranscript(contactId, { notes: false });
  if (!t) return null;
  await db.insert(auditLog).values({ userId: user.id, action: "exportou", entity: "conversa", entityId: contactId, data: { formato: "pdf", notas: notes, registros: t.lines.length } });
  return { filename: `conversa-${slug(t.clientName)}-${day(now)}.pdf` };
}
```

`src/app/api/contatos/[id]/conversa/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { findSessionUser } from "@/server/auth/sessions-store";
import { exportConversationText, logConversationPdf } from "@/server/domain/conversation-export";
import { renderPagePdf } from "@/server/reports/pdf";
import { UserFacingError } from "@/server/domain/errors";

export const maxDuration = 90;

/** "Exportar conversa" da ficha (LGPD): texto ou PDF; notas internas só com `notas=1`. Precisa ver Contatos e poder exportar. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const notes = req.nextUrl.searchParams.get("notas") === "1";
  if (req.nextUrl.searchParams.get("formato") === "pdf") {
    const log = await logConversationPdf(id, user, notes);
    if (!log) return new Response("não encontrado", { status: 404 });
    try {
      const pdf = await renderPagePdf({ path: "/imprimir/conversa", params: { contato: id, ...(notes ? { notas: "1" } : {}) }, userId: user.id });
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${log.filename}"`, "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof UserFacingError) return new Response(e.message, { status: 503 });
      console.error("[conversa pdf]", e);
      return new Response("Não deu para gerar o PDF. Tente de novo.", { status: 500 });
    }
  }
  const out = await exportConversationText(id, { id: user.id, name: user.name }, { notes });
  if (!out) return new Response("não encontrado", { status: 404 });
  return new Response(out.body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" } });
}
```

`src/app/imprimir/conversa/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { consumePrintToken } from "@/server/reports/print-token";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { loadTranscript } from "@/server/queries/transcript";
import { stamp, transcriptLine } from "@/lib/transcript";

export const metadata = { title: "Conversa" };
export const dynamic = "force-dynamic";

/** Página que o Chromium do servidor imprime em PDF (A4). Sem cookie: token de uso único (5 min) de quem pediu, com Contatos e Exportar. */
export default async function ImprimirConversa({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await consumePrintToken(typeof sp.t === "string" ? sp.t : null);
  if (!user || !can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) notFound();
  const id = typeof sp.contato === "string" ? sp.contato : "";
  if (!isUuid(id)) notFound();
  const withNotes = sp.notas === "1";
  const t = await loadTranscript(id, { notes: withNotes });
  if (!t) notFound();
  return (
    <main style={{ fontFamily: "Arial, sans-serif", fontSize: 11, lineHeight: 1.5, color: "#121212", background: "#fff", padding: "14mm" }}>
      <h1 style={{ fontSize: 16, margin: 0 }}>Conversa de {t.clientName} ({t.phone}) com a Casa Fiaes</h1>
      <p style={{ color: "#6f6a62", margin: "4px 0 12px" }}>Gerado em {stamp(new Date())} por {user.name}{withNotes ? " · inclui notas internas (só a equipe via)" : ""}{t.truncated ? " · só os 20.000 primeiros registros" : ""}</p>
      {t.lines.length === 0 ? <p>Nenhuma mensagem registrada.</p> : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {t.lines.map((l, i) => <li key={i} style={{ padding: "2px 0", borderBottom: "1px solid #eee", background: l.direction === "nota" ? "#fbf4e6" : undefined }}>{transcriptLine(l, t.clientName)}</li>)}
        </ol>
      )}
    </main>
  );
}
```

`src/components/contacts/export-conversation.tsx`:

```tsx
"use client";
import { Menu } from "@/components/ui/menu";
import { IconDownload } from "@/components/icons";

/** "Exportar conversa" (LGPD): texto ou PDF; com notas internas só se pedir. O servidor registra quem exportou. */
export function ExportConversation({ contactId }: { contactId: string }) {
  const go = (q: string) => { window.location.href = `/api/contatos/${contactId}/conversa?${q}`; };
  return (
    <Menu label="Exportar conversa"
      trigger={<span className="inline-flex items-center gap-1.5 text-sm font-medium"><IconDownload size={15} />Exportar conversa</span>}
      triggerClassName="h-10 px-3 rounded-[var(--radius-control)] border border-line-strong hover:bg-paper-2"
      items={[
        { label: "Texto (.txt)", onSelect: () => go("formato=txt") },
        { label: "PDF", onSelect: () => go("formato=pdf") },
        { label: "Texto com notas internas", detail: "Só para uso da equipe", onSelect: () => go("formato=txt&notas=1") },
      ]} />
  );
}
```

Em `src/app/(app)/contatos/[id]/page.tsx`:
- import `import { ExportConversation } from "@/components/contacts/export-conversation";`;
- trocar a linha `{!contact.ignored && <StartConversation … />}` por:

```tsx
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {!contact.ignored && <StartConversation contactId={contact.id} hasOpenLead={!!current} className="w-full sm:w-auto" />}
          {can(user.perms, "relatorios.exportar") && <ExportConversation contactId={contact.id} />}
        </div>
```

Em `src/server/auth/guard-coverage.test.ts`, no `PUBLIC_PAGES`, acrescentar:

```ts
  "imprimir/conversa/page.tsx", // token de uso único (5 min) de quem pediu + contatos.ver e relatorios.exportar dessa pessoa
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/transcript.test.ts src/server/domain/conversation-export.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS. A rota nova tem `can(user.perms,`, e a página de impressão está na lista justificada.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela (dev, headless, contato fictício):
- a ficha mostra "Exportar conversa";
- "Texto (.txt)" baixa o arquivo com as linhas;
- o PDF depende do Chromium do servidor. No Mac, rode com `PDF_BASE_URL` apontando para a porta do dev. Se aparecer "PDF indisponível neste servidor", está certo para um ambiente sem Chromium.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/transcript.ts src/lib/transcript.test.ts src/server/queries/transcript.ts src/server/domain/conversation-export.ts src/server/domain/conversation-export.test.ts "src/app/api/contatos/[id]/conversa/route.ts" src/app/imprimir/conversa/page.tsx src/components/contacts/export-conversation.tsx "src/app/(app)/contatos/[id]/page.tsx" src/server/auth/guard-coverage.test.ts
git commit -m "feat(lgpd): exportar a conversa da cliente em texto ou PDF, com notas internas só se pedir; registro de quem exportou

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Tarefa 14: Menu de boas-vindas (construído DESLIGADO)

> **Opcional.** A spec (§5) põe "Menu de boas-vindas" em "depois". O pedido deste lote mandou construí-lo desligado, então ele vem por último e pode ser pulado com o ok do dono. Nada das Tarefas 1 a 13 depende dele. Ele **não** mexe na "resposta fora do horário" (que já existe) nem na tela "Mensagens automáticas", que o Lote 4 vai refazer. A tela dele é própria (`/config/menu`).

**Arquivos:**
- Criar: `src/server/domain/welcome-menu.ts`, `src/server/domain/welcome-menu.test.ts`
- Criar: `src/app/(app)/config/menu/page.tsx`, `src/app/(app)/config/menu/actions.ts`, `src/components/config/welcome-menu.tsx`
- Modificar: `src/server/domain/deals.ts`. Mexe só no fim de `recordInbound`, no bloco depois do commit que chama `maybeAutoReply`: `grep -n "maybeAutoReply" src/server/domain/deals.ts`.
- Modificar: `src/server/domain/outbox.ts`, `processItem`, na cadeia `if (source === AUTO_REPLY_SOURCE) … else if (source?.startsWith("automacao:"))`
- Modificar: `src/components/config/config-nav.tsx` (`TABS`)

**Interfaces:**
- Consome (Tarefa 1): `contactNotes` (`source: "menu"`). Do código atual: `enqueueAutomated`, `drainOutbox`, `addTag`, `TAG_MAX`, `isOpen`, `getBusinessHours`.
- Produz:
  - `WELCOME_SETTING = "menu_boas_vindas"`, `WELCOME_SOURCE = "menu_boas_vindas"`, `WELCOME_MAX_OPTIONS = 6`, `WELCOME_REPLY_WINDOW_MS = 24 h`;
  - `welcomeSchema` (zod);
  - `type WelcomeConfig = { enabled: boolean; intro: string; options: { label: string; tag?: string | null }[] }`;
  - `getWelcomeMenu(): Promise<WelcomeConfig>`, `saveWelcomeMenu(input: unknown, userId): Promise<void>`;
  - `welcomeText(c): string`;
  - `maybeWelcomeMenu(dealId, at, now?): Promise<boolean>`;
  - `maybeWelcomeChoice(dealId, body, at): Promise<{ option: number } | null>`;
  - ação `saveWelcomeMenuAction(v: unknown)` (`config.editar`);
  - rota `/config/menu` ("Menu de boas-vindas").

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/welcome-menu.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contactNotes, contacts, contactTags, deals, messages, outbox, settings, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { drainOutbox } from "./outbox";
import { saveWelcomeMenu, welcomeText } from "./welcome-menu";
import { setWhatsappProvider } from "../whatsapp/evolution";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
const MENU = { enabled: true, intro: "Olá! Bem-vinda à Casa Fiaes. Responda com o número:", options: [{ label: "Agendar horário", tag: "Quer agendar" }, { label: "Saber preços", tag: null }] };
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { sent.push(text); return { externalId: `W${sent.length}` }; },
};
let uid = "";
const inbound = (id: string, body = "Oi", at = T0, phone = "71999990101") =>
  recordInbound({ channelId: null, externalId: id, phoneRaw: phone, pushName: "Cliente Teste", body, at, now: at });
const dealOf = async (r: Awaited<ReturnType<typeof inbound>>) => { if (!("dealId" in r)) throw new Error("sem lead"); return r.dealId; };

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: uid }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" });
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

describe("menu de boas-vindas", () => {
  it("nasce desligado: número novo não recebe nada", async () => {
    await inbound("M1");
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("ligado e Casa aberta: número novo recebe o menu, uma vez", async () => {
    await saveWelcomeMenu(MENU, uid);
    await inbound("M1");
    await inbound("M2", "?", plus(1));
    const items = await db.select().from(outbox);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("Olá! Bem-vinda à Casa Fiaes. Responda com o número:\n\n1. Agendar horário\n2. Saber preços");
    expect(welcomeText(MENU)).toBe(items[0].text);
  });

  it("quem já conversou antes e a Casa fechada não recebem o menu", async () => {
    await saveWelcomeMenu(MENU, uid);
    const [c] = await db.insert(contacts).values({ name: "Antiga Teste", phoneE164: "+5571999990102" }).returning();
    await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-08-01T13:00:00Z") });
    await inbound("M3", "Oi de novo", T0, "71999990102");
    await inbound("M4", "Oi", new Date("2026-10-19T13:00:00Z"), "71999990103"); // segunda: Casa fechada
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("na hora de enviar: desligado ou a Casa já respondeu, o menu não sai", async () => {
    await saveWelcomeMenu(MENU, uid);
    await inbound("M1");
    await saveWelcomeMenu({ ...MENU, enabled: false }, uid);
    expect((await drainOutbox(plus(1))).cancelled).toBe(1);
    await saveWelcomeMenu(MENU, uid);
    const d = await dealOf(await inbound("M5", "Oi", plus(2), "71999990104"));
    await recordOutbound({ dealId: d, channelId: null, body: "Oi! Sou a Thaíse, como posso ajudar?", userId: uid, at: plus(3) });
    expect((await drainOutbox(plus(4))).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("a resposta ao menu vira etiqueta e nota para quem atender; depois de alguém da equipe responder, “1” é só mensagem", async () => {
    await saveWelcomeMenu(MENU, uid);
    const d = await dealOf(await inbound("M1"));
    expect((await drainOutbox(plus(1))).sent).toBe(1);
    await inbound("M2", "1", plus(2));
    const contactId = (await db.select().from(deals).where(eq(deals.id, d)))[0].contactId;
    const t = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, contactId));
    expect(t.map((x) => x.name)).toEqual(["Quer agendar"]);
    expect((await db.select().from(contactNotes))[0]).toMatchObject({ source: "menu", authorName: "Menu de boas-vindas", body: "Escolheu no menu: 1. Agendar horário" });
    await recordOutbound({ dealId: d, channelId: null, body: "Claro! Qual dia?", userId: uid, at: plus(3) });
    await inbound("M3", "2", plus(4));
    expect(await db.select().from(contactNotes)).toHaveLength(1);
  });

  it("ligar sem saudação ou com menos de 2 opções é recusado", async () => {
    await expect(saveWelcomeMenu({ enabled: true, intro: "Oi", options: [{ label: "Agendar" }] }, uid)).rejects.toThrow(/pelo menos 2 opções/);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/welcome-menu.test.ts`
Esperado: FAIL (`Cannot find module './welcome-menu'`).

- [ ] **Passo 3: Domínio**

`src/server/domain/welcome-menu.ts`:

```ts
import { and, desc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, contactNotes, deals, messages, outbox, settings } from "../db/schema";
import { isOpen } from "@/lib/business-hours";
import { getBusinessHours } from "./hours";
import { enqueueAutomated } from "./outbox";
import { addTag, TAG_MAX } from "./tags";

export const WELCOME_SETTING = "menu_boas_vindas";
export const WELCOME_SOURCE = "menu_boas_vindas";
export const WELCOME_MAX_OPTIONS = 6;
/** Depois disso a resposta não conta mais como escolha do menu. */
export const WELCOME_REPLY_WINDOW_MS = 24 * 3_600_000;

const optionSchema = z.object({ label: z.string().trim().min(1, "Escreva o nome da opção.").max(40, "Opção com no máximo 40 caracteres."), tag: z.string().trim().max(TAG_MAX).nullish() });
export const welcomeSchema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().max(400, "A saudação passou de 400 caracteres."),
  options: z.array(optionSchema).max(WELCOME_MAX_OPTIONS, `No máximo ${WELCOME_MAX_OPTIONS} opções.`),
}).refine((v) => !v.enabled || (v.intro.length >= 3 && v.options.length >= 2), { message: "Para ligar, escreva a saudação e pelo menos 2 opções.", path: ["options"] });
export type WelcomeConfig = z.infer<typeof welcomeSchema>;

export async function getWelcomeMenu(): Promise<WelcomeConfig> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, WELCOME_SETTING));
  const v = (r?.value ?? {}) as Partial<WelcomeConfig>;
  return { enabled: v.enabled === true, intro: v.intro ?? "", options: Array.isArray(v.options) ? v.options : [] };
}
/** Salva (e liga/desliga). A confirmação "isto envia mensagens reais" é da tela; aqui fica a auditoria. */
export async function saveWelcomeMenu(input: unknown, userId: string): Promise<void> {
  const v = welcomeSchema.parse(input);
  const before = await getWelcomeMenu();
  await db.insert(settings).values({ key: WELCOME_SETTING, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: WELCOME_SETTING, data: v as unknown as Record<string, unknown> });
}

/** O texto que a cliente recebe: a saudação e as opções numeradas. */
export function welcomeText(c: Pick<WelcomeConfig, "intro" | "options">): string {
  return [c.intro.trim(), "", ...c.options.map((o, i) => `${i + 1}. ${o.label.trim()}`)].join("\n");
}

/**
 * Número que escreve pela primeira vez na vida (o contato não tem nenhuma mensagem antes) com a Casa aberta: o menu entra na fila de envio.
 * Desligado por padrão. Com a Casa fechada, quem responde é a "resposta fora do horário" (nunca os dois).
 */
export async function maybeWelcomeMenu(dealId: string, at: Date, now = new Date()): Promise<boolean> {
  const cfg = await getWelcomeMenu();
  if (!cfg.enabled || cfg.options.length < 2) return false;
  if (!isOpen(now.getTime(), await getBusinessHours())) return false;
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return false;
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from messages where contact_id = ${d.contactId}`)).rows as { n: number }[];
  if (n !== 1) return false;
  await enqueueAutomated({ dealId, kind: "text", text: welcomeText(cfg), source: WELCOME_SOURCE, at });
  return true;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** A cliente respondeu ao menu ("1" ou o nome da opção) antes de alguém da equipe escrever: etiqueta (se a opção tiver) e uma nota para quem atender. Não responde nada sozinho. */
export async function maybeWelcomeChoice(dealId: string, body: string | null | undefined, at: Date): Promise<{ option: number } | null> {
  const text = body?.trim();
  if (!text || text.length > 40) return null;
  const cfg = await getWelcomeMenu();
  if (!cfg.enabled) return null;
  const [menu] = await db.select({ sentAt: outbox.sentAt }).from(outbox)
    .where(and(eq(outbox.dealId, dealId), eq(outbox.status, "sent"), sql`${outbox.options}->>'source' = ${WELCOME_SOURCE}`)).orderBy(desc(outbox.sentAt)).limit(1);
  if (!menu?.sentAt || at.getTime() - menu.sentAt.getTime() > WELCOME_REPLY_WINDOW_MS) return null;
  // Alguém da equipe já escreveu depois do menu (pelo CRM ou pelo celular): a conversa já é com a pessoa.
  const [human] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"), or(isNotNull(messages.sentByUserId), eq(messages.fromPhone, true)), gt(messages.createdAt, menu.sentAt))).limit(1);
  if (human) return null;
  const t = norm(text);
  const idx = /^\d+$/.test(t) ? Number(t) - 1 : cfg.options.findIndex((o) => norm(o.label) === t);
  const opt = cfg.options[idx];
  if (!opt) return null;
  const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  if (!d) return null;
  if (opt.tag?.trim()) await addTag(d.contactId, opt.tag.trim(), null);
  await db.insert(contactNotes).values({ contactId: d.contactId, dealId, authorName: "Menu de boas-vindas", source: "menu", body: `Escolheu no menu: ${idx + 1}. ${opt.label.trim()}`, createdAt: at });
  return { option: idx + 1 };
}
```

> `enqueueAutomated` aceita `at` (instante do enfileiramento). Confira com `grep -n "at?: Date" src/server/domain/outbox.ts`.

- [ ] **Passo 4: Ganchos no recebimento e na fila**

Em `src/server/domain/deals.ts`, no fim de `recordInbound`, logo depois do `try { … maybeAutoReply … } catch …` (dentro do mesmo `if ("dealId" in result && "created" in result)`):

```ts
    // Menu de boas-vindas (Lote 5, desligado por padrão): número novo recebe o menu; "1"/"2" logo depois vira etiqueta e nota.
    try {
      const { maybeWelcomeChoice, maybeWelcomeMenu } = await import("./welcome-menu");
      if (result.created) await maybeWelcomeMenu(result.dealId, at, input.now);
      else await maybeWelcomeChoice(result.dealId, input.body, at);
    } catch (e) { console.error("[menu de boas-vindas]", result.dealId, e instanceof Error ? e.message : e); }
```

Em `src/server/domain/outbox.ts`:
- import `import { getWelcomeMenu, WELCOME_SOURCE } from "./welcome-menu";`;
- em `processItem`, na cadeia de `source`, depois do ramo `automacao:`:

```ts
  } else if (source === WELCOME_SOURCE) {
    if (!(await getWelcomeMenu()).enabled) return cancel("O menu de boas-vindas foi desligado.");
    if (row.deal.lastOutboundAt) return cancel("Alguém da Casa já respondeu: o menu perdeu o sentido.");
```

(mantendo o `}` que fecha a cadeia).

> `welcome-menu.ts` importa `enqueueAutomated` de `outbox.ts`, e `outbox.ts` importa `getWelcomeMenu` de `welcome-menu.ts`. O ciclo é seguro porque nenhum dos dois usa o outro no carregamento do módulo, só dentro das funções. Se o `vitest` reclamar de import circular, troque o import em `outbox.ts` por `const { getWelcomeMenu } = await import("./welcome-menu");` dentro do ramo.

- [ ] **Passo 5: Rodar e ver passar (domínio)**

Rodar: `npx vitest run src/server/domain/welcome-menu.test.ts src/server/domain/outbox.test.ts src/server/domain/deals.test.ts`
Esperado: PASS.

- [ ] **Passo 6: Tela (desligada, com confirmação)**

`src/app/(app)/config/menu/actions.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Perm } from "@/lib/permissions";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveWelcomeMenu } from "@/server/domain/welcome-menu";

type R<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : userErrorMessage(e, "menu") });
async function run<T>(fn: (uid: string) => Promise<T>, perm: Perm = "config.editar"): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath("/config/menu"); return { ok: true, data }; } catch (e) { return fail(e); }
}
export const saveWelcomeMenuAction = async (v: unknown) => run((u) => saveWelcomeMenu(v, u));
```

`src/app/(app)/config/menu/page.tsx`:

```tsx
import { requirePerm } from "@/server/auth/session";
import { getWelcomeMenu } from "@/server/domain/welcome-menu";
import { WelcomeMenuEditor } from "@/components/config/welcome-menu";

export const metadata = { title: "Menu de boas-vindas" };

export default async function MenuPage() {
  await requirePerm("config.editar");
  return <WelcomeMenuEditor initial={await getWelcomeMenu()} />;
}
```

`src/components/config/welcome-menu.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "./send-confirm";
import { saveWelcomeMenuAction } from "@/app/(app)/config/menu/actions";

type Opt = { label: string; tag?: string | null };

/** Menu de boas-vindas: nasce desligado; ligar pede a confirmação "isto envia mensagens reais". */
export function WelcomeMenuEditor({ initial }: { initial: { enabled: boolean; intro: string; options: Opt[] } }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [intro, setIntro] = useState(initial.intro);
  const [options, setOptions] = useState<Opt[]>(initial.options.length ? initial.options : [{ label: "" }, { label: "" }]);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const clean = options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), tag: o.tag?.trim() || null }));
  const save = (on: boolean) => start(async () => {
    const r = await saveWelcomeMenuAction({ enabled: on, intro, options: clean });
    if (!r.ok) { toast(r.error, "error"); return; }
    setEnabled(on); setAsking(false); toast(on === enabled ? "Salvo" : on ? "Menu de boas-vindas ligado" : "Menu de boas-vindas desligado", "ok");
  });
  const set = (i: number, patch: Partial<Opt>) => setOptions((l) => l.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl">Menu de boas-vindas</h2>
            <p className="mt-1 text-sm text-graphite">Quem escreve para a Casa pela primeira vez, com a Casa aberta, recebe a saudação com as opções. A resposta (“1”, “2”…) vira etiqueta e uma nota para quem atender. Nada mais é respondido sozinho.</p>
          </div>
          <Switch checked={enabled} label={enabled ? "Desligar o menu" : "Ligar o menu"} disabled={pending} onChange={(v) => (v ? setAsking(true) : save(false))} />
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <Field label="Saudação" htmlFor="menu-intro"><Textarea id="menu-intro" value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} placeholder="Olá! Bem-vinda à Casa Fiaes. Responda com o número:" /></Field>
        {options.map((o, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_12rem] items-center gap-2">
            <span className="text-sm font-semibold text-gold-ink">{i + 1}.</span>
            <Input value={o.label} onChange={(e) => set(i, { label: e.target.value })} aria-label={`Opção ${i + 1}`} placeholder="Ex.: Agendar horário" />
            <Input value={o.tag ?? ""} onChange={(e) => set(i, { tag: e.target.value })} aria-label={`Etiqueta da opção ${i + 1}`} placeholder="Etiqueta (opcional)" />
          </div>
        ))}
        {options.length < 6 && <Button variant="ghost" size="sm" onClick={() => setOptions((l) => [...l, { label: "" }])}>Acrescentar opção</Button>}
        <p className="text-sm text-muted">Como a cliente vê:</p>
        <pre className="whitespace-pre-wrap rounded-[var(--radius-control)] bg-paper-2 p-3 text-sm">{[intro.trim(), "", ...clean.map((o, i) => `${i + 1}. ${o.label}`)].join("\n")}</pre>
        <div><Button onClick={() => save(enabled)} loading={pending}>Salvar</Button></div>
      </section>
      <SendConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => save(true)} pending={pending}
        what="Toda pessoa que escrever pela primeira vez, com a Casa aberta, recebe o menu automaticamente." />
    </div>
  );
}
```

Em `src/components/config/config-nav.tsx`, no `TABS`, depois de `["/config/massa", "Mensagem em massa"]`: `["/config/menu", "Menu de boas-vindas"],`.

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. O `guard-coverage` aceita a página nova (`requirePerm`) e a ação (`run` com `assertPerm(perm)`).

Conferência na tela (dev, headless):
- Configurações › Menu de boas-vindas aparece **desligado**;
- a prévia mostra o texto numerado;
- ligar pede "Isto vai enviar mensagens reais";
- **desligue de novo antes de sair.**

- [ ] **Passo 8: Commit**

```bash
git add src/server/domain/welcome-menu.ts src/server/domain/welcome-menu.test.ts "src/app/(app)/config/menu/page.tsx" "src/app/(app)/config/menu/actions.ts" src/components/config/welcome-menu.tsx src/server/domain/deals.ts src/server/domain/outbox.ts src/components/config/config-nav.tsx
git commit -m "feat(menu): menu de boas-vindas desligado por padrão; a escolha vira etiqueta e nota, sem resposta automática

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Tarefa 15: Verificação final, e2e do lote e roteiro de produção

**Arquivos:**
- Criar: `e2e/lote5.spec.ts`
- Modificar: `docs/deploy-contabo.md` (seção "Lote 5", com o roteiro da seção **Implantação** abaixo)

**Interfaces:**
- Consome: tudo das Tarefas 1 a 14.
- Produz: o e2e do lote e o roteiro de produção no `docs/deploy-contabo.md`.

- [ ] **Passo 1: e2e que exercita os três fluxos do dia a dia**

`e2e/lote5.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login, simulate, e2eSql, isola } from "./helpers";

test("Lote 5: nota interna com @, mensagem agendada (e cancelada) e Resolvido, sem enviar nada", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await isola("+5571997505");
  await simulate(page, { phone: "71 99750-5001", name: "Cliente Lote Cinco", text: "Vou ver com meu marido e te falo" });
  const [{ id }] = await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.archived_at is null", ["+5571997505001"]);
  await page.goto(`/atendimento?lead=${id}`);
  const lead = page.getByRole("region", { name: /Lead Cliente Lote Cinco/ });
  await expect(lead).toBeVisible();

  // Nota interna chamando a Ana (atendente do e2e): a nota aparece e ela recebe o aviso.
  await page.getByRole("button", { name: "Nota interna (a cliente não vê)" }).click();
  await page.getByLabel("Nota interna", { exact: true }).fill("Confere o preço @An");
  await page.getByRole("button", { name: /@Ana/ }).click();
  await page.getByRole("button", { name: "Salvar nota" }).click();
  await expect(page.getByRole("note", { name: "Nota interna" })).toContainText("Confere o preço @Ana");
  await expect.poll(async () => Number((await e2eSql("select count(*)::int as n from alerts where type = 'mencao'"))[0].n)).toBe(1);

  // Mensagem agendada: aparece acima do campo e some ao cancelar (a Evolution do e2e é a morta; nada sai).
  await page.getByRole("button", { name: "Voltar para mensagem" }).click();
  await page.getByLabel("Mensagem", { exact: true }).fill("Oi! Conseguiu falar com ele?");
  await page.getByRole("button", { name: "Agendar envio" }).click();
  await page.getByRole("dialog", { name: "Agendar envio" }).getByRole("button", { name: "Agendar", exact: true }).click();
  const strip = page.getByRole("list", { name: "Mensagens agendadas" });
  await expect(strip).toContainText("Agendada para amanhã 10:00");
  await strip.getByRole("button", { name: "Cancelar a mensagem agendada" }).click();
  await expect(strip).toHaveCount(0);

  // Resolvido: sai do prazo sem mandar nada.
  await page.getByRole("button", { name: /Resolvido \(não precisa responder\)/ }).first().click();
  await expect.poll(async () => (await e2eSql("select awaiting_reply_since is null as livre, resolved_at is not null as resolvida from deals where id = $1", [id]))[0]).toEqual({ livre: true, resolvida: true });
  expect(Number((await e2eSql("select count(*)::int as n from messages where deal_id = $1 and direction = 'out'", [id]))[0].n)).toBe(0);
});
```

Rodar (porta livre escolhida pelo executor, fora de 3000/3100/4321/4400/8080): `E2E_PORT=3217 npx playwright test e2e/lote5.spec.ts --project=desktop`
Esperado: PASS.

- [ ] **Passo 2: Tudo verde**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Rodar: `E2E_PORT=3217 npx playwright test e2e/conversa.spec.ts e2e/fila.spec.ts e2e/contatos.spec.ts e2e/permissoes.spec.ts e2e/a11y.spec.ts e2e/lote5.spec.ts`
Esperado: PASS. Se o `a11y.spec.ts` acusar contraste ou nome nos componentes novos (nota amarela, faixa de agendadas, folha de massa), corrija antes do commit.

Prints (headless, `CF_SHOTS_DIR` numa pasta do scratchpad):
- conversa com nota, ligação perdida, reação e faixa de agendada, no desktop e no celular;
- Configurações › Mensagem em massa desligada;
- Importar do ChatGuru com a prévia.

Confira cada print contra o que o texto do plano diz que aparece.

- [ ] **Passo 3: Roteiro de produção no `docs/deploy-contabo.md`**

Acrescentar ao fim de `docs/deploy-contabo.md` a seção "Lote 5 (paridade ChatGuru): publicar e conferir", com os passos I0 a I8 da seção **Implantação** deste plano, copiados como estão.

- [ ] **Passo 4: Commit**

```bash
git add e2e/lote5.spec.ts docs/deploy-contabo.md
git commit -m "test(lote5): e2e de nota com @, agendada cancelada e Resolvido; roteiro de produção do Lote 5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Interfaces que o Lote 5 expõe (resumo para quem junta com as outras frentes)

| Onde | O quê |
|---|---|
| Banco | `contact_notes`; `deals.resolved_at`, `deals.resolved_by_id`; `messages.reactions`; `outbox.created_by` (+ `options.cancelIfReply`/`sendAt`); `campaigns`, `campaign_recipients` |
| Permissão | `mensagem.massa` (opcional; ninguém tem por padrão) |
| `settings` | `envio_massa` `{ enabled }` e `menu_boas_vindas` `{ enabled, intro, options }`. Ausentes = desligados |
| Alertas novos | `mencao`, `agendada_falhou` (push), `massa_concluida`, `massa_pausada` |
| Eventos novos | `mensagem_agendada`, `agendada_cancelada`, `resolvida`, `resolvida_desfeita`. Tempo real: `nota_criada`, `agendada` |
| Domínio | `notes`, `scheduled`, `quick-replies`, `resolve`, `campaigns`, `chatguru-csv`, `chatguru-csv-import`, `conversation-export`, `welcome-menu` |
| Puro | `quick-reply` (`renderReply`, `missingVars`, `greetingAt`), `transcript`, `bahia-input`, `resolved`; `components/lead/timeline` e `mentions` |
| Webhook | evento `CALL`; `messages.kind = "call"`; reações em `messages.reactions` |
| Telas | `/config/massa`, `/config/chatguru`, `/config/menu`, `/imprimir/conversa`; rotas `/api/respostas/[id]/arquivo` e `/api/contatos/[id]/conversa` |
| Worker | fila `envio-massa` (a cada minuto; não faz nada com a chave desligada) |
| `DealDetail` | `notes`, `scheduled`, `replyVars`, `resolvedByName`, `quickReplies[].folder/attachment` |
| `Composer` | props `team`, `onNoteSaved`, `onScheduled`, `vars` |

**Pontos de junção com outras frentes:**
- **`config-nav.tsx`:** o Lote 4 deve redividir as abas entre `config.diaadia` e `config.sistema`. Sugestão: "Mensagem em massa", "Importar do ChatGuru" e "Menu de boas-vindas" vão para `config.sistema`.
- **`permissions.ts`:** o Lote 4 acrescenta `config.diaadia` e `config.sistema` na mesma lista em que este lote põe `mensagem.massa`. O conflito é só de linhas vizinhas.
- **`contatos/page.tsx` e `contacts-list.tsx`:** o Lote 2 refaz os filtros. O botão de massa recebe o filtro como `Audience`. Quando o Lote 2 existir, passe os filtros novos como `contactIds` (os do filtro, até 300) ou acrescente o campo ao `Audience`.
- **`appointments`:** só leitura aqui (`{data_horario}`). A agenda viva (6A) pode mudar os status. Mantenha `agendado`/`confirmado` como "futuro válido" ou ajuste `replyVarsOf`.
- **`deals.ts` e `outbox.ts`:** este lote mexe só em pontos pequenos. No `recordInbound`, o gancho depois do commit. No `processItem`, dois ramos de `source`.

## Implantação

Só depois das Tarefas 1 a 15 commitadas no worktree, juntadas na `rodada-2` e com o ok do dono em cada passo que grava em produção. Fora do expediente da Casa (ter–sáb 9h–18h). **Nada aqui envia WhatsApp:** massa e menu continuam desligados.

**I0. Junção.**
- Se outra frente já usou o número `0025`, apague a `drizzle/0025_lote5_chatguru.sql` e o snapshot deste lote e rode de novo `npm run db:generate -- --name lote5_chatguru` sobre o schema juntado.
- Confira que o SQL novo é o mesmo (só `CREATE TABLE`/`ADD COLUMN`/índices).
- Depois: `npm test && npm run typecheck && npm run lint` verdes na `rodada-2`.

**I1. Backup do banco de produção** pelo procedimento de `docs/backup-restauracao.md`, com o nome `bkp_lote5_AAAAMMDD`.

**I2. Publicar** pelo procedimento de `docs/deploy-contabo.md`: tarball em `/opt/crm-rN` e troca de pasta. Em seguida:
- `npm run db:migrate`: só aditiva; o ensaio é ler o `.sql` antes;
- `npm run db:seed`: idempotente. Não liga nada nem dá `mensagem.massa` a ninguém;
- reiniciar app e worker (pm2).

**I3. Conferir que nasceu tudo desligado** (só SELECT):

```sql
select key, value from settings where key in ('envio_massa', 'menu_boas_vindas');           -- esperado: 0 linhas
select count(*) from profiles where 'mensagem.massa' = any(permissions);                     -- esperado: 0
select count(*) from campaigns;                                                              -- esperado: 0
```

**I4. Evolution: pedir o evento das ligações.**
1. `npx tsx scripts/sincronizar-webhook.ts --dry-run` mostra os números e a lista de eventos.
2. Com o ok do dono, rode `--aplicar`. O comando só reaplica a lista de eventos, sem mexer em `rejectCall`/`msgCall` e sem enviar nada.
3. Confira em Configurações › WhatsApp que o número segue conectado.
4. Teste com uma ligação perdida feita **do celular de quem cuida do sistema** (nunca de cliente): ela aparece como "Ligação perdida" na conversa desse número.

**I5. Conferência na tela** com o usuário da gestão:
- nota interna com @ numa conversa de teste;
- agendar e **cancelar** uma mensagem;
- "Resolvido" e Desfazer;
- as respostas prontas com `{data_horario}` bloqueiam o envio sem horário;
- Configurações mostra "Mensagem em massa" e "Menu de boas-vindas" **desligados**.

**I6. Importação do ChatGuru** (só quando a Casa mandar os CSVs). Para cada arquivo:
1. Copie o arquivo para o servidor (fora do repositório).
2. Rode `BACKUP_DIR=/home/crm/backups npx tsx scripts/importar-chatguru-csv.ts --dry-run arquivo.csv` e mostre a prévia ao dono: linhas, novos, etiquetas, colunas não usadas e descartadas.
3. Com o ok, rode `--aplicar`. Ele grava o backup JSON dos contatos tocados e confere a contagem.
4. Confira 20 clientes conhecidas pela recepção (etiquetas e ficha).

Se a prévia mostrar uma coluna importante em "Não usadas", pare: acrescente o sinônimo com teste e publique antes de importar.

**I7. Mensagem em massa e menu** ficam desligados até o dono pedir. Quando ele pedir:
1. A gestão liga a chave em Configurações (confirmação "Isto vai enviar mensagens reais").
2. A permissão `mensagem.massa` vai só para o perfil que o dono indicar.
3. A primeira mensagem em massa é pequena: até 20 clientes que já escreveram, com intervalo de 3 min, acompanhada.
4. Depois de usar, desligue a chave se não houver outra prevista.

**I8. Desfazer.**
- O código volta pela troca de pasta (`/opt/crm-r(N-1)`). A migration é aditiva e pode ficar.
- Para parar qualquer envio do lote na hora, basta desligar as chaves (`envio_massa`, `menu_boas_vindas`) ou cancelar as agendadas na conversa.
- A importação do ChatGuru tem o backup JSON por arquivo, para conferir e voltar a ficha à mão se preciso.

## Autoconferência (skill writing-plans)

### 1. Cobertura da spec (§3 › Lote 5 e o pedido do lote)

| Pedido | Tarefa |
|---|---|
| Nota interna na conversa, com menção à colega e aviso | 2 (servidor, sino e push) e 3 (tela) |
| Guardar as anotações migradas | 12 (anotações do ChatGuru viram `contact_notes` com `source: "chatguru"`) |
| Mensagem agendada pelo outbox, cancelável, "agendada para…" na conversa | 4 e 5 |
| Respostas prontas com anexo, variáveis e pastas | 6 e 7 |
| Status manual "Resolvido" ao lado do "Aguardando" do 1C | 8 |
| Ligações perdidas e reações na conversa (hoje descartadas em `webhook.ts:71-72`) | 9 |
| Mensagem em massa a partir de Contatos, confirmação dupla, intervalo, desligada e atrás de permissão, nunca dispara em teste | 10 e 11 |
| Importar a ficha do ChatGuru pelos CSVs com tela de upload (endereço `api/importar/chatguru` já existe) | 12 (reaproveita `importChatguruRecord`) |
| Exportar conversa (PDF/texto) para a LGPD | 13 |
| O que a pesquisa mostrou que falta (menu de boas-vindas, construído DESLIGADO) | 14 (opcional) |

### 2. Placeholders

Procurei TBD, TODO, "implementar depois", "tratar erros" e "igual à Tarefa N": não ficou nenhum. Os únicos pontos deixados para o executor confirmar são nomes e linhas em código que o 1C ainda está escrevendo. Cada um traz o `grep -n` para achar.

### 3. Consistência de nomes

- `ActionResult` vem de `src/app/(app)/conversa/actions.ts` em todas as ações da conversa.
- `NoteItem`/`NoteLike` (`authorName`, `source`) batem entre Tarefas 2, 3, 12 e 13.
- `ScheduledItem` (servidor) é compatível com `ScheduledView` (tela).
- `ReplyVars` é o mesmo nas Tarefas 6, 7 e 10.
- `SCHEDULED_SOURCE`/`WELCOME_SOURCE` são usados no `outbox.ts`.
- `PUSH_ALSO`: a Tarefa 2 cria e a Tarefa 4 estende.
- `firstName` é o do 1A.

### 4. Review Focus

As cinco situações têm teste na tarefa dona:
1. Tarefa 4, Passo 1.
2. Tarefa 10, Passo 1.
3. Tarefa 6, Passos 1 e 5.
4. Tarefa 9, Passo 1.
5. Tarefa 12, Passo 1.

### Lacunas que o plano não cobre (de propósito)

- **Departamentos, rodízio por departamento, campanhas recorrentes, NPS, resumo e transcrição por IA, modo espião e "marcar como não lida":** spec §5 ou fora do pedido.
- **Importar o histórico de mensagens do ChatGuru:** o CSV de mensagens não garante o texto inteiro (engenharia reversa §2.6) e duplicaria o histórico que o espelho da Evolution já trouxe. Só entra a ficha e as anotações.
- **Agendar mensagem com anexo ou áudio:** o ChatGuru tem. Aqui a agendada é só texto, porque o outbox só guarda texto e enquete.
- **Etiqueta "agendada" na linha da Fila:** a conversa mostra a faixa, mas a linha da Fila não mudou, para não mexer em `queue.ts`, que é do 1A/1B/1C.
- **Exportar contatos em CSV e filtros novos de Contatos:** Lote 2.
- **Divisão de `config.editar`:** Lote 4.
