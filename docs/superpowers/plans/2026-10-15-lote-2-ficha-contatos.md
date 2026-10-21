# Lote 2 (Ficha da cliente e Contatos clicáveis): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar o andamento.

**Goal:** Clicar no nome da cliente em qualquer tela e ver como ela está agora: a ficha em ordem, com a situação numa frase, o retorno sugerido (que também põe a cliente na etapa 6 do funil quando a data chega), os números e as preferências vindos do Avec; o painel da conversa com a mesma frase e as visitas certas; a lista de Contatos com filtros contados, colunas, ordenação e ações em massa.

**Architecture:** Uma tabela calculada por contato (`contact_stats`, a "visão materializada" da spec) guarda o que é pesado de contar: visitas, ritmo, profissional e serviços preferidos, faltas, totais, dívida e crédito, "como conheceu". Ela é recalculada inteira depois de cada importação do Avec e toda noite pelo worker. O que depende da hora (próximo horário, conversa aberta, aniversário, "sumida") é lido ao vivo e classificado por funções puras em `src/lib/` (`client-rhythm.ts`, `client-situation.ts`), as mesmas na ficha, no painel da conversa e na lista; a SQL da lista usa as mesmas constantes. A frase de situação é montada no servidor. O Retorno sugerido automático é uma varredura diária do worker que nasce DESLIGADA.

**Tech Stack:** Next 16 (App Router, server actions), React 19, TypeScript, Drizzle ORM + drizzle-kit 0.31, Postgres 17 (Docker), pg-boss (worker), Vitest (+ Testing Library/jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md` (seção 3 › Lote 2; seção 4 › Decisões do dono; seção 5 › Fora de escopo). Auditoria com arquivo:linha: `docs/analise-2026-10-15/contatos.md`. Base de código: plano `docs/superpowers/plans/2026-10-15-lotes-1-atendimento.md` (Lote 1C e "Interfaces que o Lote 1A/1C expõe"), tratado como já construído.

## Decisões de interpretação (para quem revisa)

1. **"Visão materializada" = tabela calculada `contact_stats`.** Uma `MATERIALIZED VIEW` do Postgres no drizzle-kit 0.31 é comparada pelo texto da SQL e vira `DROP` + `CREATE` na próxima mudança (fere "migrations só aditivas" no próximo lote), não aceita índice declarado no schema e não é limpa pelo `truncate ... cascade` dos testes. A tabela tem PK no contato (`on delete cascade`), índices pelo drizzle-kit, e é refeita numa transação (`delete` + `insert ... select`) com trava `pg_advisory_xact_lock`: quem lê vê a versão anterior até o fim (nada fica vazio) e duas recalculadas não brigam.
2. **Só fatos estáveis na visão; o resto é ao vivo.** A visão guarda datas (última visita, retorno previsto), contagens e preferências. "Sumida", "Na hora de voltar", "Com horário", "Sem dono", aniversário e o próximo horário são calculados na hora da consulta, então valem mesmo com a visão de ontem.
3. **Retorno sugerido automático (etapa 6, regra que o 1C deixou para cá).** Varredura diária às 08:00, só em dia que a Casa abre, **desligada até a gestão ligar** (Configurações › Automações). Cria um cartão em "Retorno sugerido" quando a data prevista chegou e a cliente ainda está "na hora de voltar" (até 1,5× o ritmo), sem horário futuro, sem conversa aberta, sem cartão de retorno desde a última visita, contato normal (nem "Não é cliente" nem número oculto) e que conversou com a Casa pelo WhatsApp nos últimos 365 dias (o espírito da decisão 4). Teto de 20 cartões por dia. Cada cartão nasce com o combinado "Chamar <nome> para voltar" para a dona da última conversa (ativa) e nada é enviado. Depois: se ela marca horário, o cartão vai para Agendado (a mesma regra do 1C, `syncContactFunnelTx`); se a Casa escreveu e ela não respondeu em 4 h, vai para Aguardando cliente (tentativas do 1C); 14 dias sem a Casa escrever vira Perdido "Retorno não feito". Se ela escreve, o 1C já volta para Em conversa.
4. **Clique.** Nome e foto abrem `/contatos/[id]` (link direto). Onde a linha inteira já é um link (Hoje, sino, relatórios) a linha vira "link esticado" para a conversa e o nome fica por cima, como link próprio (nunca link dentro de link). Duas exceções, pela opção "painel lateral com Ver ficha completa" da spec: no **Quadro** o cartão continua abrindo o painel do lead (é arrastável) e, no painel, o nome e "Ver ficha completa" levam à ficha; na **Agenda** (território da outra frente, mexer o mínimo) o nome abre o painel do horário, que passa a ter sempre "Abrir ficha da cliente". Na **Jornada** o círculo continua abrindo a conversa (é o uso principal) e o nome embaixo dele abre a ficha.
5. **Profissional preferida:** escolhida na ficha > calculada (3+ serviços e 60%+ com a mesma) > anotada no Avec ("CLIENTE GILVAN" → Gilvan). O filtro "Profissional" da lista usa a preferida (ficha ou calculada).
6. **VIP:** 12+ visitas ou entre as 10% que mais gastaram. Constantes em `src/lib/client-rhythm.ts`; a tela para configurar fica para o Lote 4 (Configurações).
7. **Dívida e crédito:** lançamentos do Avec com forma de pagamento "Dívida" e "Crédito Cliente". Não existe extrato de saldo no Avec importado, então a ficha diz "lançado como Dívida no Avec: R$ X (N vezes, última em dd/mm/aaaa)", nunca "saldo". Para quem não vê valores: "Tem dívida lançada no Avec", sem o valor.
8. **Avisos fixos** (alergia, "não gosta de volume"): campo novo `contacts.alert_notes` (até 300 caracteres, uma linha por aviso), editável na ficha e em destaque na conversa.
9. **Anotações num campo só:** `contacts.notes` passa a ser o campo único. O campo "Observações" da conversa grava nele; um script com ensaio, backup e desfazer junta as 109 anotações presas nos leads. `deals.observations` fica no banco (aditivo) e deixa de ser escrito.
10. **"Mesclado" × "Não é cliente":** lead arquivado sem `archived_by` (a junção automática do número oculto não registra pessoa) ou com o evento `contato_mesclado` nele mesmo; a junção passa a registrar esse evento também no lead que sai.
11. **Exportar CSV** só com "Exportar CSV e PDF" (`relatorios.exportar`, a gestão): a lista inteira de telefones é dado sensível. A coluna "Total gasto" só com "ver valores".
12. **Agendar pela ficha** abre (ou reaproveita) a conversa e já abre a folha "Agendar" que existe hoje (`/atendimento/[id]?agendar=1`). Marcar direto na Agenda é da outra frente (Lote 6A).

## Global Constraints

- **Migrations só aditivas:** uma só, `0025_ficha_contatos`, toda na Tarefa 1, gerada com `npx drizzle-kit generate --name ficha_contatos` (na junção com a rodada-2 o número pode mudar; vale o que o drizzle-kit gerar). Qualquer `DROP`, `ALTER COLUMN ... TYPE` ou `RENAME` gerado é erro: parar.
- **Dados iniciais** (motivo de perda "Retorno não feito", configuração do retorno) vão no seed ou em script idempotente, nunca em SQL solto na migration.
- **PT-BR em tudo que a equipe lê:** tela, avisos, histórico, CSV, saída dos scripts. Código no estilo do arquivo ao redor.
- **Nunca enviar WhatsApp em teste:** a Evolution dos testes é `http://127.0.0.1:9` (`test/setup-env.ts`, conferido por `test/evolution-guard.test.ts`); o e2e usa o endereço morto do `playwright.config.ts`.
- **Nada de envio automático ligado:** automações novas nascem DESLIGADAS. O Retorno sugerido automático nasce desligado e, mesmo ligado, só cria cartão e combinado; nenhuma tarefa deste lote envia mensagem.
- **Nunca guardar CPF, RG, endereço ou banco:** nenhum campo novo disso; o CSV só leva nome, telefone, e-mail e os dados da ficha.
- **Nunca dado real de cliente no repo:** fixtures fictícias ("Rita Fictícia", telefones `+557196…`/`+557199…` de teste).
- **Números de produção só por script com `--dry-run`, backup e conferência** (Tarefa 3 `visao-contatos.ts`, Tarefa 7 `unificar-anotacoes.ts`, Tarefa 14 `retorno-sugerido.ts`).
- **Todo commit termina com** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Portas do usuário 3000, 3100, 4321, 4400 e 8080 intocadas.** Playwright sempre com `E2E_PORT` (o executor define a porta). O Postgres do worktree sobe numa porta própria (o executor escolhe), só o serviço `db` (nunca a Evolution), e o banco TEM de se chamar `crm`: os testes derivam `crm_test` e `crm_e2e` trocando `/crm` na URL (`test/setup-env.ts`, `playwright.config.ts`).
- **Fora deste lote (a outra frente constrói):** duração, preço e categoria de serviço; vínculo profissional↔serviço; horário de trabalho por profissional; bloqueios; marcar horário na Agenda; comanda, caixa e comissão de comandas novas; pacotes vendidos pelo CRM; app da profissional e área da cliente. Este lote só LÊ `appointments`, `client_packages`, `sales_items`, `sales_payments` e `lists.cycle_days`.
- **Base:** rodada-2 com os Lotes 1A, 1B e 1C prontos. Antes de usar um nome do 1C, confirmar com `grep -n` (`stageByKind`, `moveToKindTx`, `syncContactFunnelTx`, `FUTURE_MAX_DAYS`, `activeOwnerTx`, `clientFirstName`, `applyAvecFiles(... ): ... & { funil }`, `BACK_TO_CONVERSATION_KINDS`). Números de linha citados valem para o código de 15/10 sem o 1C: conferir com `grep -n` antes de editar.
- **Tempo:** o dia da Casa é o de Salvador (`America/Bahia`, UTC-3). Horário futuro só conta até 180 dias (datas absurdas do Avec ficam de fora).
- **Dinheiro** (ticket médio, total gasto, dívida e crédito em R$, coluna de valor no CSV) só com `valores.ver`: o servidor nem manda o valor. Visitas, frequência, faltas e cancelamentos aparecem para a atendente.
- **Testes:** `npm run infra:up` (ou o `db` do worktree) de pé; `vitest` migra o `crm_test` sozinho (`test/global-setup.ts`); teste de banco usa `resetDb` (`test/db.ts`). Verde no fim de cada tarefa: `npm test && npm run typecheck && npm run lint`.

## Review Focus

Cinco situações que a spec implica e que mais devem morder quem usa. Cada uma tem o teste na tarefa dona:

1. **Cliente bem na borda do ritmo** (exatamente 0,8× ou 1,5× do ritmo, 365 dias sem vir, ou com horário a 181 dias): a ficha ("Na hora de voltar"/"Sumida") e o botão de filtro da lista dão a mesma resposta, e o horário a 181 dias não conta como "Com horário". Teste: Tarefa 2, Passo 1 ("bordas do ritmo") e Tarefa 12, Passo 1 ("ficha e filtro concordam nas bordas").
2. **Retorno automático rodando duas vezes no dia ou para quem não devia** (cliente com conversa aberta, com horário no Avec, "Não é cliente", número oculto, já teve cartão de retorno depois da última visita): nenhum cartão a mais, nenhum combinado duplicado. Teste: Tarefa 14, Passo 1 ("não cria duas vezes nem para quem não deve").
3. **Atendente vendo dinheiro** (ficha, painel da conversa, lista e CSV para quem não tem "ver valores"): nenhum centavo sai do servidor; o CSV não tem a coluna. Testes: Tarefa 5, Passo 1 ("sem ver valores, nenhum centavo") e Tarefa 13, Passo 1 ("CSV sem coluna de valor").
4. **Cliente sem visita, sem nome ou com número oculto** (contato novo do WhatsApp, `lid:`): a frase diz "ainda não veio à Casa" e nunca aparece "NaN", "há -1 dias", "undefined" ou "lid:". Teste: Tarefa 2, Passo 1 ("cliente nova sem nome") e Tarefa 12, Passo 1 ("linha de contato só do WhatsApp").
5. **Datas absurdas do Avec** (comparecimento em 2923, venda em 4676): não viram visita, última visita nem ritmo, e a ficha não diz "última visita há -329.000 dias". Teste: Tarefa 3, Passo 1 ("datas absurdas do Avec").

---

## Mapa de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/client-rhythm.ts` | Constantes e regras puras: ritmo, retorno, aniversário, nome de profissional, data do "Lembrar" |
| `src/lib/client-situation.ts` | A frase de situação e os estados (Sem dono, Atrasada, Sumida, Na hora de voltar, Aniversário) |
| `src/lib/birthday.ts` | Ler "dd/mm" ou "dd/mm/aaaa" do aniversário |
| `src/lib/visit-days.ts` | Juntar horários e itens de comanda por dia |
| `src/lib/notes-merge.ts` | Juntar anotações dos leads no texto do contato (idempotente) |
| `src/server/domain/contact-stats.ts` | Recalcular a visão por contato (`contact_stats`) e o resumo do ensaio |
| `src/server/domain/contact-profile.ts` | Editar a ficha (nome, e-mail, aniversário, anotações, avisos fixos, profissional preferida) |
| `src/server/domain/suggested-return.ts` | "Lembrar", configuração e varredura do Retorno sugerido |
| `src/server/domain/notes-merge.ts` | Ensaio, aplicação e desfazer da junção das anotações |
| `src/server/queries/client-snapshot.ts` | O retrato da cliente agora (frase, números, preferências, conversa, finanças) |
| `src/server/queries/contact-visits.ts` | Visitas passadas e futuras da ficha |
| `src/server/queries/avec-links.ts` | Ligar o nome nas tabelas do Avec ao contato |
| `src/server/queries/contacts-csv.ts` | Montar o CSV de Contatos |
| `src/components/contacts/client-link.tsx` | Link do nome/foto para a ficha (por cima de linhas clicáveis) |
| `src/components/contacts/ficha/*.tsx` | Blocos da ficha |
| `src/components/config/suggested-return-switch.tsx` | Chave liga/desliga do Retorno sugerido |
| `src/app/api/contatos/csv/route.ts` | Download do CSV |
| `scripts/visao-contatos.ts`, `scripts/unificar-anotacoes.ts`, `scripts/retorno-sugerido.ts` | Ensaio e aplicação em produção |
| `e2e/ficha.spec.ts`, `e2e/ficha-cliques.spec.ts` | Ficha e pontos de clique |

**Alterados (principais):** `src/server/db/schema.ts`, `test/db.ts`, `src/server/domain/avec/apply.ts`, `worker/index.ts`, `src/server/queries/client-context.ts`, `src/server/queries/contact.ts`, `src/server/queries/contacts.ts`, `src/server/domain/updates.ts`, `src/server/domain/tags.ts`, `src/server/domain/lid-merge.ts`, `src/app/(app)/contatos/page.tsx`, `src/app/(app)/contatos/[id]/page.tsx`, `src/app/(app)/contatos/actions.ts`, `src/components/contacts/contacts-list.tsx`, `src/components/contacts/contacts-bulk-bar.tsx`, `src/components/queue/client-pane.tsx`, `src/components/queue/context-strip.tsx`, `src/components/queue/pane-header.tsx`, `src/components/queue/conversation-pane.tsx`, `src/components/queue/tags-editor.tsx`, `src/components/lead/lead-sheet.tsx`, `src/components/journey/station.tsx`, `src/components/today/*.tsx`, `src/app/(app)/page.tsx`, `src/components/shell/alerts-bell.tsx`, `src/server/queries/alerts.ts`, `src/server/queries/today.ts`, `src/components/agenda/agenda-board.tsx`, `src/components/agenda/entry-sheet.tsx`, `src/components/reports/analysis.tsx`, `src/server/reports/queries.ts`, `src/app/(app)/relatorios/avec/[id]/page.tsx`, `src/app/(app)/config/automacoes/page.tsx`, `src/app/(app)/config/actions.ts`, `src/server/db/seed-data.ts`, `src/lib/lead-href.ts`, `src/lib/field-labels.ts`, `e2e/contatos.spec.ts`, `e2e/helpers.ts`, `docs/deploy-contabo.md`.

---

### Preparação do worktree (antes da Tarefa 1, sem commit)

- [ ] **Passo 1: Banco próprio e porta do e2e**

O executor escolhe uma porta livre para o Postgres (fora de 3000/3100/4321/4400/8080; a 5433 é a do banco de desenvolvimento da pasta principal) e uma para o e2e. Exemplo com `55433` e `3310` (troque pelos números escolhidos):

```bash
cp ../crm/.env .env   # ou o caminho da pasta principal; NÃO commitar
sed -i '' 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://crm:crm_local_dev@localhost:55433/crm#' .env
PG_PORT=55433 docker compose -p crm-lote2 up -d db
until docker compose -p crm-lote2 exec -T db pg_isready -U crm -d crm; do sleep 1; done
npm ci && npm run db:migrate && npm run db:seed
export E2E_PORT=3310
```

Esperado: `db:migrate` aplica até a `0024_funil_novo` (Lote 1C) sem erro. O banco se chama `crm` (os testes usam `crm_test` e `crm_e2e`, criados por `docker/init-db.sql`). A Evolution não sobe.

- [ ] **Passo 2: Linha de base verde**

Rodar: `npm test && npm run typecheck`
Esperado: PASS. Se algo falhar aqui, é do código de base (1A–1C): parar e avisar, não corrigir neste lote.

---

### Tarefa 1: Banco (colunas da ficha e a visão por contato `contact_stats`)

**Files:**
- Modify: `src/server/db/schema.ts` (import da linha 2-4; `contacts`, linhas 72-97; tabela nova no fim, depois de `avecReports`)
- Create (gerado): `drizzle/0025_ficha_contatos.sql`, `drizzle/meta/0025_snapshot.json`; Modify (gerado): `drizzle/meta/_journal.json`
- Modify: `test/db.ts` (lista do `truncate`)
- Test: `src/server/db/schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `contacts.preferredProfessionalId: string | null` (FK `professionals.id`, `on delete set null`) e `contacts.alertNotes: string | null`;
  - tabela `contactStats` (`contact_stats`) e `type ContactStats = typeof contactStats.$inferSelect`, com as colunas: `contactId` (PK, FK `contacts.id` `on delete cascade`), `visits`, `firstVisitOn`, `lastVisitOn`, `rhythmDays`, `cycleDays`, `returnDueOn`, `noShows`, `cancellations`, `tickets`, `totalCents`, `preferredProfessionalId`, `preferredProfessionalName`, `preferredShare`, `serviceCount`, `topServices: { item: string; n: number }[]`, `originLabel`, `avecProfessionalHint`, `debtCents`, `debtCount`, `lastDebtOn`, `creditCents`, `creditCount`, `computedAt`. Datas (`date`) chegam como texto `"aaaa-mm-dd"`; `bigint` em modo `number`.

- [ ] **Passo 1: Escrever os testes que falham**

Acrescentar em `src/server/db/schema.test.ts`, dentro do `describe` (o helper `cols` já existe na linha 4):

```ts
  it("ficha da cliente (Lote 2): colunas do contato e a visão por contato", async () => {
    expect(await cols("contacts")).toEqual(expect.arrayContaining(["preferred_professional_id", "alert_notes"]));
    expect(await cols("contact_stats")).toEqual(expect.arrayContaining([
      "contact_id", "visits", "first_visit_on", "last_visit_on", "rhythm_days", "cycle_days", "return_due_on", "no_shows", "cancellations",
      "tickets", "total_cents", "preferred_professional_id", "preferred_professional_name", "preferred_share", "service_count", "top_services",
      "origin_label", "avec_professional_hint", "debt_cents", "debt_count", "last_debt_on", "credit_cents", "credit_count", "computed_at",
    ]));
  });
  it("apagar o contato apaga a linha dele na visão; apagar a profissional só limpa a escolha", async () => {
    const [p] = (await db.execute(sql`insert into professionals (name) values ('PROFISSIONAL TESTE') returning id`)).rows as { id: string }[];
    const [c] = (await db.execute(sql`insert into contacts (name, phone_e164, preferred_professional_id) values ('Rita Fictícia', '+5571966000901', ${p.id}) returning id`)).rows as { id: string }[];
    await db.execute(sql`insert into contact_stats (contact_id, visits) values (${c.id}, 3)`);
    await db.execute(sql`delete from professionals where id = ${p.id}`);
    expect(((await db.execute(sql`select preferred_professional_id from contacts where id = ${c.id}`)).rows[0] as { preferred_professional_id: string | null }).preferred_professional_id).toBeNull();
    await db.execute(sql`delete from contacts where id = ${c.id}`);
    expect((await db.execute(sql`select 1 from contact_stats where contact_id = ${c.id}`)).rows).toHaveLength(0);
  });
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/db/schema.test.ts`
Esperado: FAIL ("expected [...] to contain preferred_professional_id" e `relation "contact_stats" does not exist`).

- [ ] **Passo 3: Schema**

Em `src/server/db/schema.ts`, linha 3, acrescentar `bigint` e `real` ao import de `drizzle-orm/pg-core`:

```ts
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, index, smallint, primaryKey, date, numeric, bigint, real, type AnyPgColumn,
```

Em `contacts`, logo depois de `lastAutoReplyAt` (antes de `createdAt`):

```ts
  /** Profissional preferida escolhida na ficha: vale mais que a calculada em `contact_stats` (Lote 2). */
  preferredProfessionalId: uuid("preferred_professional_id").references((): AnyPgColumn => professionals.id, { onDelete: "set null" }),
  /** Avisos fixos (alergia, "não gosta de volume"): em destaque na ficha e na conversa. Uma linha por aviso, até 300 caracteres. */
  alertNotes: text("alert_notes"),
```

No fim do arquivo, depois de `export type AvecReport = ...`:

```ts
/* ───────────────────────── Lote 2: visão por contato (migration 0025) ───────────────────────── */

/**
 * A "visão materializada" da ficha e da lista de Contatos: o que é pesado de contar, uma linha por contato.
 * Recalculada INTEIRA por `refreshContactStats` (src/server/domain/contact-stats.ts) depois de cada importação do Avec e toda noite.
 * Só fatos que não dependem da hora: "sumida", "na hora de voltar", "com horário" e o próximo horário são lidos ao vivo.
 * Dinheiro (total, dívida, crédito) só sai das consultas para quem tem "ver valores".
 */
export const contactStats = pgTable("contact_stats", {
  contactId: uuid("contact_id").primaryKey().references(() => contacts.id, { onDelete: "cascade" }),
  /** Dias distintos com comparecimento (Avec), comanda (Avec) ou Compareceu no CRM. */
  visits: integer("visits").notNull().default(0),
  firstVisitOn: date("first_visit_on"),
  lastVisitOn: date("last_visit_on"),
  /** Mediana dos intervalos entre visitas; só com 3 ou mais visitas. */
  rhythmDays: smallint("rhythm_days"),
  /** Ciclo de retorno do último serviço feito (Listas › Serviços), para quem ainda não tem ritmo. */
  cycleDays: smallint("cycle_days"),
  /** Última visita + ritmo (ou ciclo). */
  returnDueOn: date("return_due_on"),
  noShows: integer("no_shows").notNull().default(0),
  cancellations: integer("cancellations").notNull().default(0),
  /** Comandas distintas (dia + número): o divisor do ticket médio. */
  tickets: integer("tickets").notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }),
  /** Calculada: 3+ serviços e 60%+ com a mesma profissional. A escolhida na ficha fica em `contacts.preferred_professional_id`. */
  preferredProfessionalId: uuid("preferred_professional_id").references(() => professionals.id, { onDelete: "set null" }),
  preferredProfessionalName: text("preferred_professional_name"),
  /** Parte dos serviços com a profissional mais frequente (0 a 1), mesmo abaixo de 60%. */
  preferredShare: real("preferred_share"),
  serviceCount: integer("service_count").notNull().default(0),
  topServices: jsonb("top_services").$type<{ item: string; n: number }[]>().notNull().default([]),
  /** "Como conheceu" do Avec (normalizado) ou a origem do primeiro lead; null quando não identificada. */
  originLabel: text("origin_label"),
  /** "CLIENTE GILVAN" no "Como conheceu" do Avec: a Casa usava o campo para guardar a profissional. */
  avecProfessionalHint: text("avec_professional_hint"),
  debtCents: bigint("debt_cents", { mode: "number" }).notNull().default(0),
  debtCount: integer("debt_count").notNull().default(0),
  lastDebtOn: date("last_debt_on"),
  creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
  creditCount: integer("credit_count").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("contact_stats_return_idx").on(t.returnDueOn),
  index("contact_stats_last_visit_idx").on(t.lastVisitOn),
  index("contact_stats_pro_idx").on(t.preferredProfessionalId),
  index("contact_stats_origin_idx").on(t.originLabel),
]);
export type ContactStats = typeof contactStats.$inferSelect;
```

- [ ] **Passo 4: Gerar a migration e conferir que é só aditiva**

Rodar: `npx drizzle-kit generate --name ficha_contatos`
Esperado: cria `drizzle/0025_ficha_contatos.sql` (se outro trabalho ocupou o número, vale o que o drizzle-kit gerar), `drizzle/meta/0025_snapshot.json` e uma entrada nova em `drizzle/meta/_journal.json`.

Rodar: `grep -nE "DROP|ALTER COLUMN|RENAME" drizzle/0025_ficha_contatos.sql`
Esperado: nenhuma linha. O SQL tem só `CREATE TABLE "contact_stats"`, dois `ALTER TABLE "contacts" ADD COLUMN`, os `ADD CONSTRAINT ... FOREIGN KEY` e quatro `CREATE INDEX`. Qualquer outra coisa: parar e conferir `git diff drizzle/meta`.

Rodar: `npm run db:migrate`
Esperado: aplica a 0025 no banco do worktree.

- [ ] **Passo 5: `resetDb` limpa a visão**

Em `test/db.ts`, na lista do `truncate`, depois de `avec_reports`:

```ts
    appointments, agenda_blocks, client_packages, package_uses, sales_items, sales_payments, avec_reports, contact_stats restart identity cascade`);
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/db/schema.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck`
Esperado: verde.

- [ ] **Passo 7: Commit**

```bash
git add src/server/db/schema.ts src/server/db/schema.test.ts drizzle/ test/db.ts
git commit -m "feat(contatos): visão por contato (contact_stats), profissional preferida e avisos fixos no contato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: Regras puras (ritmo, retorno, aniversário e a frase da situação)

**Files:**
- Create: `src/lib/client-rhythm.ts`, `src/lib/client-rhythm.test.ts`
- Create: `src/lib/client-situation.ts`, `src/lib/client-situation.test.ts`
- Create: `src/lib/birthday.ts`, `src/lib/birthday.test.ts`

**Interfaces:**
- Consumes: `dueLabel(dueMs, nowMs)` (`src/lib/next-action.ts`), `firstName(name): string | null` (`src/lib/authorship.ts`, Lote 1A).
- Produces (`src/lib/client-rhythm.ts`):
  - constantes `MIN_VISITS_FOR_RHYTHM = 3`, `RETURN_SOON = 0.8`, `RETURN_GONE = 1.5`, `GONE_MAX_DAYS = 365`, `FUTURE_HORIZON_DAYS = 180`, `PREFERRED_MIN_SERVICES = 3`, `PREFERRED_MIN_SHARE = 0.6`, `VIP_MIN_VISITS = 12`, `VIP_TOP_SHARE = 0.1`, `FALTOSA_MIN = 2`, `BIRTHDAY_WEEK_DAYS = 7`;
  - `bahiaDay(ms: number): string`, `daysBetween(from: string, to: string): number`, `addDaysTo(day: string, n: number): string`, `shortDay(day: string, today: string): string`;
  - `type ReturnStatus = "agendada" | "em_dia" | "na_hora" | "sumida" | "antiga"`;
  - `type ReturnInfo = { basis: "ritmo" | "ciclo"; everyDays: number; dueOn: string; daysSince: number; lateDays: number; status: ReturnStatus }`;
  - `type RhythmInput = { lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null; hasFuture: boolean }`;
  - `returnInfo(s: RhythmInput, today: string): ReturnInfo | null`, `returnLine(r: ReturnInfo, today: string): string`;
  - `daysUntilBirthday(day: number, month: number, today: string): number`;
  - `displayName(raw: string | null | undefined): string | null`;
  - `reminderDueAt(dueOn: string | null, nowMs: number): Date`.
- Produces (`src/lib/client-situation.ts`):
  - `type SituationState = "sem_dono" | "atrasada" | "sumida" | "na_hora_de_voltar" | "aniversario"`, `SITUATION_STATE_LABEL: Record<SituationState, string>`;
  - `type SituationInput = { lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null; nextAppointment: { startsAt: string; professionalName: string | null } | null; activePackage: { usedSessions: number; totalSessions: number } | null; conversation: { stageName: string; stageKind: string; ownerName: string | null; enteredAt: string; awaitingSince: string | null; late: boolean } | null; birthday: { day: number; month: number } | null }`;
  - `type Situation = { sentence: string; short: string; states: SituationState[]; retorno: ReturnInfo | null }`;
  - `clientSituation(i: SituationInput, nowMs: number): Situation`.
- Produces (`src/lib/birthday.ts`): `parseBirthday(raw: string): { ok: true; day: number; month: number; year: number | null } | { ok: false; error: string }`, `birthdayLabel(day: number | null, month: number | null, year?: number | null): string | null`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/lib/client-rhythm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDaysTo, bahiaDay, daysUntilBirthday, displayName, reminderDueAt, returnInfo, returnLine } from "./client-rhythm";

const TODAY = "2026-10-15";
const base = { rhythmDays: 40, cycleDays: null, hasFuture: false };
const visit = (daysAgo: number) => addDaysTo(TODAY, -daysAgo);

describe("returnInfo", () => {
  it("bordas do ritmo: 0,8× e 1,5× ainda são 'na hora'; 1 dia além de 1,5× é 'sumida'; 365 dias é 'antiga'", () => {
    expect(returnInfo({ ...base, lastVisitOn: visit(31) }, TODAY)?.status).toBe("em_dia");   // 31 < 32
    expect(returnInfo({ ...base, lastVisitOn: visit(32) }, TODAY)?.status).toBe("na_hora");  // 0,8 × 40
    expect(returnInfo({ ...base, lastVisitOn: visit(60) }, TODAY)?.status).toBe("na_hora");  // 1,5 × 40
    expect(returnInfo({ ...base, lastVisitOn: visit(61) }, TODAY)?.status).toBe("sumida");
    expect(returnInfo({ ...base, lastVisitOn: visit(364) }, TODAY)?.status).toBe("sumida");
    expect(returnInfo({ ...base, lastVisitOn: visit(365) }, TODAY)?.status).toBe("antiga");
    expect(returnInfo({ ...base, lastVisitOn: visit(61), hasFuture: true }, TODAY)?.status).toBe("agendada");
  });
  it("sem ritmo usa o ciclo do serviço; sem os dois, não há previsão", () => {
    const r = returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: 30, hasFuture: false }, TODAY);
    expect(r).toMatchObject({ basis: "ciclo", everyDays: 30, dueOn: "2026-11-04", lateDays: 0, status: "em_dia" });
    expect(returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: null, hasFuture: false }, TODAY)).toBeNull();
    expect(returnInfo({ lastVisitOn: null, rhythmDays: 40, cycleDays: null, hasFuture: false }, TODAY)).toBeNull();
  });
  it("frase do retorno, como na spec", () => {
    expect(returnLine(returnInfo({ lastVisitOn: "2026-09-18", rhythmDays: 45, cycleDays: null, hasFuture: false }, "2026-11-14")!, "2026-11-14"))
      .toBe("Volta a cada ~45 dias · prevista 02/11 · atrasada 12 dias");
    expect(returnLine(returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: 30, hasFuture: false }, TODAY)!, TODAY))
      .toBe("Pelo ciclo do serviço, a cada 30 dias · prevista 04/11 · faltam 20 dias");
    expect(returnLine(returnInfo({ lastVisitOn: visit(39), rhythmDays: 40, cycleDays: null, hasFuture: false }, TODAY)!, TODAY))
      .toBe("Volta a cada ~40 dias · prevista 16/10 · falta 1 dia");
  });
});

describe("datas de Salvador", () => {
  it("o dia muda à meia-noite de Salvador, não de UTC", () => {
    expect(bahiaDay(Date.parse("2026-10-16T02:30:00Z"))).toBe("2026-10-15");
    expect(bahiaDay(Date.parse("2026-10-16T03:00:00Z"))).toBe("2026-10-16");
  });
  it("aniversário: dias até o próximo; 29/02 cai em 28/02 em ano não bissexto", () => {
    expect(daysUntilBirthday(15, 10, TODAY)).toBe(0);
    expect(daysUntilBirthday(14, 10, TODAY)).toBe(364);
    expect(daysUntilBirthday(29, 2, "2027-02-27")).toBe(1);
    expect(daysUntilBirthday(29, 2, "2028-02-28")).toBe(1);
  });
  it("Lembrar: no dia previsto às 10h; já passou ou sem previsão, amanhã às 10h", () => {
    const now = Date.parse("2026-10-15T15:00:00Z");
    expect(reminderDueAt("2026-11-02", now).toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(reminderDueAt("2026-10-01", now).toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(reminderDueAt(null, now).toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });
  it("nome de profissional do Avec em maiúsculas vira nome próprio; nome já escrito fica", () => {
    expect(displayName("MAIARA")).toBe("Maiara");
    expect(displayName("ANA PAULA")).toBe("Ana Paula");
    expect(displayName("Maiara Souza")).toBe("Maiara Souza");
    expect(displayName("  ")).toBeNull();
  });
});
```

`src/lib/client-situation.test.ts`:

```ts
import { expect, it } from "vitest";
import { clientSituation, type SituationInput } from "./client-situation";

const NOW = Date.parse("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const vazio: SituationInput = { lastVisitOn: null, rhythmDays: null, cycleDays: null, nextAppointment: null, activePackage: null, conversation: null, birthday: null };

it("a frase da spec: horário, pacote, última visita e a conversa com a dona", () => {
  const s = clientSituation({
    ...vazio, lastVisitOn: "2026-09-25", rhythmDays: 45,
    nextAppointment: { startsAt: "2026-10-16T17:00:00Z", professionalName: "MAIARA" },
    activePackage: { usedSessions: 3, totalSessions: 4 },
    conversation: { stageName: "Aguardando cliente", stageKind: "followup", ownerName: "Daniela Rezende", enteredAt: "2026-10-15T13:00:00Z", awaitingSince: null, late: false },
  }, NOW);
  expect(s.sentence).toBe("Tem horário amanhã 14:00 com Maiara · pacote 3/4 · última visita há 20 dias · conversa aguardando cliente há 2 h com Sara");
  expect(s.states).toEqual([]);
  expect(s.short).toBe("Tem horário amanhã 14:00 com Maiara · última visita há 20 dias");
});

it("sumida: diz quando era a volta e quanto atrasou; estado Sumida", () => {
  const s = clientSituation({ ...vazio, lastVisitOn: "2026-07-01", rhythmDays: 40 }, NOW);
  expect(s.sentence).toBe("última visita há 106 dias · sumida (volta prevista 10/08, atrasada 66 dias)");
  expect(s.states).toEqual(["sumida"]);
  expect(s.short).toBe("Sumida · última visita há 106 dias");
});

it("cliente nova sem nome, número oculto, esperando a Casa e sem dona: sem NaN, -1 ou undefined", () => {
  const s = clientSituation({ ...vazio, conversation: { stageName: "Novo contato", stageKind: "lead", ownerName: null, enteredAt: "2026-10-15T14:55:00Z", awaitingSince: "2026-10-15T14:55:00Z", late: true } }, NOW);
  expect(s.sentence).toBe("ainda não veio à Casa · esperando resposta da Casa há 5 min, sem dono");
  expect(s.states).toEqual(["sem_dono", "atrasada"]);
  expect(s.short).toBe("Esperando resposta, atrasada · Sem dono");
  expect(s.sentence + s.short).not.toMatch(/NaN|undefined|null|-\d|lid:/);
});

it("na hora de voltar e aniversário nesta semana", () => {
  const s = clientSituation({ ...vazio, lastVisitOn: "2026-09-01", rhythmDays: 40, birthday: { day: 17, month: 10 } }, NOW);
  expect(s.sentence).toBe("última visita há 44 dias · na hora de voltar (prevista 11/10) · aniversário 17/10");
  expect(s.states).toEqual(["na_hora_de_voltar", "aniversario"]);
});
```

`src/lib/birthday.test.ts`:

```ts
import { expect, it } from "vitest";
import { birthdayLabel, parseBirthday } from "./birthday";

it("lê dia/mês e dia/mês/ano; recusa data que não existe", () => {
  expect(parseBirthday("5/3")).toEqual({ ok: true, day: 5, month: 3, year: null });
  expect(parseBirthday("29/02/1992")).toEqual({ ok: true, day: 29, month: 2, year: 1992 });
  expect(parseBirthday("31/02")).toEqual({ ok: false, error: "Data de aniversário inválida." });
  expect(parseBirthday("29/02/1991")).toEqual({ ok: false, error: "Data de aniversário inválida." });
  expect(parseBirthday("março")).toEqual({ ok: false, error: "Use dia/mês, ex.: 14/11." });
});
it("rótulo: 05/03 ou 05/03/1992; sem dia, nada", () => {
  expect(birthdayLabel(5, 3)).toBe("05/03");
  expect(birthdayLabel(5, 3, 1992)).toBe("05/03/1992");
  expect(birthdayLabel(null, null)).toBeNull();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/client-rhythm.test.ts src/lib/client-situation.test.ts src/lib/birthday.test.ts`
Esperado: FAIL ("Failed to resolve import ./client-rhythm", "./client-situation", "./birthday").

- [ ] **Passo 3: `src/lib/client-rhythm.ts`**

```ts
/**
 * Ritmo de volta, retorno sugerido e aniversário da cliente (Lote 2). Puro: servidor e navegador.
 * As MESMAS constantes entram na SQL da lista de Contatos (src/server/queries/contacts.ts): ficha e filtro nunca discordam.
 */
export const MIN_VISITS_FOR_RHYTHM = 3;
/** A partir de 0,8× o ritmo sem vir (e sem horário): "na hora de voltar". */
export const RETURN_SOON = 0.8;
/** Passou de 1,5× o ritmo: "sumida" (até 1 ano; depois disso é "antiga", outra conversa). */
export const RETURN_GONE = 1.5;
export const GONE_MAX_DAYS = 365;
/** Horário futuro só conta até 180 dias: o mesmo FUTURE_MAX_DAYS do Lote 1C (src/server/domain/avec/funnel-sync.ts). */
export const FUTURE_HORIZON_DAYS = 180;
/** Profissional preferida calculada: 3 ou mais serviços e 60% ou mais com a mesma. */
export const PREFERRED_MIN_SERVICES = 3;
export const PREFERRED_MIN_SHARE = 0.6;
/** VIP: 12+ visitas ou entre as 10% que mais gastaram (a tela para configurar é do Lote 4). */
export const VIP_MIN_VISITS = 12;
export const VIP_TOP_SHARE = 0.1;
/** Faltosa: 2 ou mais faltas. */
export const FALTOSA_MIN = 2;
/** "Aniversário nesta semana": hoje e os próximos 7 dias, a mesma janela do Hoje (src/server/queries/today.ts). */
export const BIRTHDAY_WEEK_DAYS = 7;

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** "aaaa-mm-dd" do instante, no relógio de Salvador. */
export const bahiaDay = (ms: number): string => new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
/** Dias de `from` até `to` (negativo se `to` vem antes). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
export const addDaysTo = (day: string, n: number): string => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
/** "02/11" no ano de hoje; "02/11/2027" em outro ano. */
export const shortDay = (day: string, today: string): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}${day.slice(0, 4) === today.slice(0, 4) ? "" : `/${day.slice(0, 4)}`}`;

export type ReturnStatus = "agendada" | "em_dia" | "na_hora" | "sumida" | "antiga";
export type ReturnInfo = { basis: "ritmo" | "ciclo"; everyDays: number; dueOn: string; daysSince: number; lateDays: number; status: ReturnStatus };
/** `rhythmDays` só vem preenchido com 3+ visitas (a visão por contato garante); sem ele, vale o ciclo do serviço. */
export type RhythmInput = { lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null; hasFuture: boolean };

/** Quando a cliente deve voltar e como ela está em relação a isso. null = sem visita ou sem ritmo nem ciclo. */
export function returnInfo(s: RhythmInput, today: string): ReturnInfo | null {
  if (!s.lastVisitOn) return null;
  const basis = s.rhythmDays ? "ritmo" : s.cycleDays ? "ciclo" : null;
  if (!basis) return null;
  const everyDays = basis === "ritmo" ? s.rhythmDays! : s.cycleDays!;
  const daysSince = Math.max(0, daysBetween(s.lastVisitOn, today));
  const dueOn = addDaysTo(s.lastVisitOn, everyDays);
  // A SQL da lista usa exatamente estas comparações (>= 0,8×; <= 1,5×; < 365).
  const status: ReturnStatus = s.hasFuture ? "agendada"
    : daysSince < RETURN_SOON * everyDays ? "em_dia"
    : daysSince <= RETURN_GONE * everyDays ? "na_hora"
    : daysSince < GONE_MAX_DAYS ? "sumida" : "antiga";
  return { basis, everyDays, dueOn, daysSince, lateDays: Math.max(0, daysBetween(dueOn, today)), status };
}

/** "Volta a cada ~45 dias · prevista 02/11 · atrasada 12 dias" (sem ritmo: "Pelo ciclo do serviço, a cada 30 dias · …"). */
export function returnLine(r: ReturnInfo, today: string): string {
  const head = r.basis === "ritmo" ? `Volta a cada ~${r.everyDays} dias` : `Pelo ciclo do serviço, a cada ${r.everyDays} dias`;
  const left = daysBetween(today, r.dueOn);
  const tail = r.status === "agendada" ? "já tem horário marcado"
    : r.lateDays > 0 ? `atrasada ${r.lateDays} ${r.lateDays === 1 ? "dia" : "dias"}`
    : left === 0 ? "é hoje" : left === 1 ? "falta 1 dia" : `faltam ${left} dias`;
  return `${head} · prevista ${shortDay(r.dueOn, today)} · ${tail}`;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Dias até o próximo aniversário (0 = hoje). 29/02 em ano não bissexto cai em 28/02, como no Hoje. */
export function daysUntilBirthday(day: number, month: number, today: string): number {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) {
    const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day;
    const diff = daysBetween(today, `${year}-${pad(month)}-${pad(d)}`);
    if (diff >= 0) return diff;
  }
  return 365;
}

/** Nome do Avec em maiúsculas ("MAIARA") vira "Maiara"; nome já escrito com minúsculas fica como está. */
export function displayName(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** "Lembrar": no dia previsto às 10h de Salvador; se já passou (ou não há previsão), amanhã às 10h. */
export function reminderDueAt(dueOn: string | null, nowMs: number): Date {
  const at10 = (day: string) => new Date(dayMs(day) + 10 * 3_600_000 + OFFSET_MS);
  if (dueOn) {
    const d = at10(dueOn);
    if (d.getTime() > nowMs) return d;
  }
  return at10(addDaysTo(bahiaDay(nowMs), 1));
}
```

- [ ] **Passo 4: `src/lib/client-situation.ts`**

```ts
import { dueLabel } from "./next-action";
import { firstName } from "./authorship";
import { BIRTHDAY_WEEK_DAYS, addDaysTo, bahiaDay, daysBetween, daysUntilBirthday, displayName, returnInfo, shortDay, type ReturnInfo } from "./client-rhythm";

/**
 * A situação da cliente em uma frase (spec Lote 2, bloco 2), montada no servidor e repetida na ficha, no painel da conversa e na lista.
 * Ex.: "Tem horário amanhã 14:00 com Maiara · pacote 3/4 · última visita há 20 dias · conversa aguardando cliente há 2 h com Sara".
 */
export type SituationState = "sem_dono" | "atrasada" | "sumida" | "na_hora_de_voltar" | "aniversario";
export const SITUATION_STATE_LABEL: Record<SituationState, string> = {
  sem_dono: "Sem dono", atrasada: "Atrasada", sumida: "Sumida", na_hora_de_voltar: "Na hora de voltar", aniversario: "Aniversário nesta semana",
};

export type SituationInput = {
  lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null;
  /** O próximo horário marcado (até 180 dias); quem chama já cortou as datas absurdas. */
  nextAppointment: { startsAt: string; professionalName: string | null } | null;
  activePackage: { usedSessions: number; totalSessions: number } | null;
  /** A conversa aberta: etapa, dona, desde quando está na etapa, desde quando espera a Casa e se tem alerta de atraso aberto. */
  conversation: { stageName: string; stageKind: string; ownerName: string | null; enteredAt: string; awaitingSince: string | null; late: boolean } | null;
  birthday: { day: number; month: number } | null;
};
export type Situation = { sentence: string; short: string; states: SituationState[]; retorno: ReturnInfo | null };

function ago(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const conversationLabel = (kind: string, name: string) =>
  kind === "lead" ? "conversa nova" : kind === "atendimento" ? "em conversa" : `conversa ${lowerFirst(name)}`;

export function clientSituation(i: SituationInput, nowMs: number): Situation {
  const today = bahiaDay(nowMs);
  const retorno = returnInfo({ lastVisitOn: i.lastVisitOn, rhythmDays: i.rhythmDays, cycleDays: i.cycleDays, hasFuture: !!i.nextAppointment }, today);
  const states: SituationState[] = [];
  const parts: string[] = [];

  let appt: string | null = null;
  if (i.nextAppointment) {
    const pro = displayName(i.nextAppointment.professionalName);
    appt = `Tem horário ${dueLabel(Date.parse(i.nextAppointment.startsAt), nowMs)}${pro ? ` com ${pro}` : ""}`;
    parts.push(appt);
  }
  if (i.activePackage) parts.push(`pacote ${i.activePackage.usedSessions}/${i.activePackage.totalSessions}`);

  const days = i.lastVisitOn ? Math.max(0, daysBetween(i.lastVisitOn, today)) : null;
  const visit = days == null ? "ainda não veio à Casa" : days === 0 ? "veio hoje" : days === 1 ? "última visita ontem" : `última visita há ${days} dias`;
  parts.push(visit);

  if (i.conversation) {
    const c = i.conversation;
    const who = c.ownerName ? ` com ${firstName(c.ownerName)}` : ", sem dono";
    parts.push(c.awaitingSince
      ? `esperando resposta da Casa há ${ago(Date.parse(c.awaitingSince), nowMs)}${who}`
      : `${conversationLabel(c.stageKind, c.stageName)} há ${ago(Date.parse(c.enteredAt), nowMs)}${who}`);
    if (!c.ownerName) states.push("sem_dono");
    if (c.late) states.push("atrasada");
  }

  let back: string | null = null;
  if (retorno?.status === "na_hora") { back = "Na hora de voltar"; states.push("na_hora_de_voltar"); parts.push(`na hora de voltar (prevista ${shortDay(retorno.dueOn, today)})`); }
  if (retorno?.status === "sumida") { back = "Sumida"; states.push("sumida"); parts.push(`sumida (volta prevista ${shortDay(retorno.dueOn, today)}, atrasada ${retorno.lateDays} dias)`); }

  if (i.birthday) {
    const n = daysUntilBirthday(i.birthday.day, i.birthday.month, today);
    if (n <= BIRTHDAY_WEEK_DAYS) {
      states.push("aniversario");
      parts.push(n === 0 ? "aniversário hoje" : n === 1 ? "aniversário amanhã" : `aniversário ${shortDay(addDaysTo(today, n), today)}`);
    }
  }

  // Frase curta (coluna "Situação" da lista e faixa da conversa): o mais urgente primeiro, no máximo 2 pedaços.
  const late = i.conversation?.late ? "Esperando resposta, atrasada" : null;
  const noOwner = i.conversation && !i.conversation.ownerName ? "Sem dono" : null;
  const short = [late, appt, back, noOwner, visit].filter((x): x is string => !!x).slice(0, 2).join(" · ");
  return { sentence: parts.join(" · "), short, states, retorno };
}
```

- [ ] **Passo 5: `src/lib/birthday.ts`**

```ts
/** Aniversário digitado na ficha ("14/11" ou "14/11/1990"). Puro: a tela valida antes e o servidor confere de novo. */
export function parseBirthday(raw: string): { ok: true; day: number; month: number; year: number | null } | { ok: false; error: string } {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return { ok: false, error: "Use dia/mês, ex.: 14/11." };
  const [day, month, year] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  const test = new Date(Date.UTC(year ?? 2000, month - 1, day)); // 2000 é bissexto: 29/02 sem ano vale
  if (test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) return { ok: false, error: "Data de aniversário inválida." };
  return { ok: true, day, month, year };
}

/** "05/03" ou "05/03/1992". */
export function birthdayLabel(day: number | null, month: number | null, year?: number | null): string | null {
  if (!day || !month) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(day)}/${p(month)}${year ? `/${year}` : ""}`;
}
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/lib/client-rhythm.test.ts src/lib/client-situation.test.ts src/lib/birthday.test.ts`
Esperado: PASS.

Rodar: `npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 7: Commit**

```bash
git add src/lib/client-rhythm.ts src/lib/client-rhythm.test.ts src/lib/client-situation.ts src/lib/client-situation.test.ts src/lib/birthday.ts src/lib/birthday.test.ts
git commit -m "feat(ficha): regras do ritmo, do retorno sugerido, do aniversário e a frase de situação da cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 3: Visão por contato (cálculo, recálculo e ensaio)

**Files:**
- Create: `src/server/domain/contact-stats.ts`, `src/server/domain/contact-stats.test.ts`
- Create: `scripts/visao-contatos.ts`

**Interfaces:**
- Consumes (T1): tabela `contactStats`. (T2): `MIN_VISITS_FOR_RHYTHM`, `PREFERRED_MIN_SERVICES`, `PREFERRED_MIN_SHARE`. Existentes: `SOURCE_EXPR(alias)` (`src/server/reports/common.ts`), `NOT_IDENTIFIED` (`src/lib/source-kinds.ts`), `type Tx` (`src/server/db`).
- Produces:
  - `type RefreshResult = { contatos: number; comVisita: number; ms: number }`;
  - `refreshContactStatsTx(tx: Tx, now?: Date): Promise<RefreshResult>` (recalcula tudo dentro da transação de quem chama);
  - `refreshContactStats(opts?: { now?: Date }): Promise<RefreshResult>` (abre a própria transação);
  - `type StatsSummary = { contatos: number; uma: number; duasAQuatro: number; cincoAOnze: number; dozeOuMais: number; comRitmo: number; ritmoMediano: number | null; comPreferida: number }`;
  - `statsSummary(tx: Tx | typeof db): Promise<StatsSummary>`;
  - CLI `npx tsx scripts/visao-contatos.ts [--dry-run | --aplicar]`.
- Regras (spec Lote 2 › Dados; auditoria `contatos.md` §5):
  - **visita** = dia distinto (Salvador) com horário "compareceu" (Avec ou CRM), comanda do Avec ou Compareceu marcado no CRM; nada depois de agora (datas absurdas do Avec ficam fora);
  - **ritmo** = mediana dos intervalos entre visitas, só com 3+ visitas; **ciclo** = `lists.cycle_days` do último serviço feito; **retorno previsto** = última visita + ritmo (senão ciclo);
  - **faltas** = horários "faltou" + Faltou do CRM sem horário ligado; **cancelamentos** = horários "cancelado" (até 180 dias à frente);
  - **profissional preferida calculada** = a mais frequente nos serviços com profissional, se forem 3+ serviços e ela tiver 60%+;
  - **3 serviços mais feitos** (empate: o mais recente primeiro);
  - **origem** = "Como conheceu" do Avec com a primeira letra maiúscula, ou a origem do primeiro lead; "CLIENTE GILVAN" não é origem: vira a dica de profissional "Gilvan";
  - **dívida e crédito** = pagamentos com forma "Dívida" e "Crédito Cliente".

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/contact-stats.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, contactStats, contacts, deals, lists, professionals, salesItems, salesPayments, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { refreshContactStats } from "./contact-stats";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
/** "aaaa-mm-dd" de n dias antes de hoje (negativo = depois). */
const dia = (n: number) => new Date(Date.parse("2026-10-15T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
/** O instante de n dias antes, ao meio-dia de Salvador. */
const hora = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
let seq = 0;
const cliente = async (name = "Cliente Fictícia", extra: Partial<typeof contacts.$inferInsert> = {}) =>
  (await db.insert(contacts).values({ name, phoneE164: `+5571966${String(++seq).padStart(6, "0")}`, ...extra }).returning())[0];
const venda = (contactId: string, soldOn: string, o: Partial<typeof salesItems.$inferInsert> = {}) =>
  db.insert(salesItems).values({ contactId, soldOn, item: "Corte Feminino", kind: "servico", totalCents: 10_000, externalKey: `t:venda:${++seq}`, ...o });
const horario = (contactId: string, startsAt: Date, status: string, o: Partial<typeof appointments.$inferInsert> = {}) =>
  db.insert(appointments).values({ contactId, startsAt, status, serviceLabel: "Escova", externalKey: `t:horario:${++seq}`, ...o });
const stats = async (contactId: string) => (await db.select().from(contactStats).where(eq(contactStats.contactId, contactId)))[0];

beforeEach(async () => { seq = 0; await resetDb(); });

it("visitas = dias distintos com comparecimento, comanda ou Compareceu no CRM (o mesmo dia conta uma vez)", async () => {
  const c = await cliente("Rita Fictícia");
  await horario(c.id, hora(40), "compareceu");
  await venda(c.id, dia(40)); // a mesma visita
  await venda(c.id, dia(20));
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  await db.insert(deals).values({ contactId: c.id, stageId: fechado.id, attendance: "compareceu", attendanceAt: hora(5), closedAt: hora(5) });
  await horario(c.id, hora(10), "faltou");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 3, firstVisitOn: dia(40), lastVisitOn: dia(5), noShows: 1 });
});

it("ritmo = mediana dos intervalos com 3+ visitas; retorno = última visita + ritmo; com 2 visitas vale o ciclo do serviço", async () => {
  const a = await cliente("Ana Fictícia");
  for (const n of [130, 90, 50, 20]) await venda(a.id, dia(n)); // intervalos 40, 40, 30 → mediana 40
  const b = await cliente("Bia Fictícia");
  await db.insert(lists).values({ kind: "service", label: "Progressiva Lote2 Teste", cycleDays: 90, position: 90 });
  await venda(b.id, dia(100), { item: "Progressiva Lote2 Teste" });
  await venda(b.id, dia(30), { item: "Progressiva Lote2 Teste" });
  await refreshContactStats({ now: NOW });
  expect(await stats(a.id)).toMatchObject({ visits: 4, rhythmDays: 40, cycleDays: null, returnDueOn: dia(-20) });
  expect(await stats(b.id)).toMatchObject({ visits: 2, rhythmDays: null, cycleDays: 90, returnDueOn: dia(-60) });
});

it("profissional preferida: 3+ serviços e 60%+ com a mesma (guarda a parte); abaixo disso, nenhuma", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const fiel = await cliente("Carla Fictícia");
  await venda(fiel.id, dia(90), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(fiel.id, dia(60), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(fiel.id, dia(30), { professionalName: "LUANA" });
  const dividida = await cliente("Dora Fictícia");
  await venda(dividida.id, dia(90), { professionalName: "LUANA" });
  await venda(dividida.id, dia(60), { professionalId: maiara.id, professionalName: "MAIARA" });
  await venda(dividida.id, dia(30), { professionalName: "JOANA" });
  await refreshContactStats({ now: NOW });
  expect(await stats(fiel.id)).toMatchObject({ preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", serviceCount: 3 });
  expect((await stats(fiel.id)).preferredShare).toBeCloseTo(0.67, 2);
  expect(await stats(dividida.id)).toMatchObject({ preferredProfessionalId: null, preferredProfessionalName: null, serviceCount: 3 });
});

it("os 3 serviços mais feitos, do mais feito ao menos (empate: o mais recente primeiro)", async () => {
  const c = await cliente();
  for (const [n, item] of [[100, "Escova"], [90, "Escova"], [80, "Corte"], [70, "Hidratação"], [60, "Manicure"], [50, "Hidratação"]] as const) await venda(c.id, dia(n), { item });
  await refreshContactStats({ now: NOW });
  expect((await stats(c.id)).topServices).toEqual([{ item: "Hidratação", n: 2 }, { item: "Escova", n: 2 }, { item: "Manicure", n: 1 }]);
});

it("'Como conheceu' do Avec vira a origem; 'CLIENTE GILVAN' vira a dica de profissional; sem Avec, a origem do primeiro lead", async () => {
  const insta = await cliente("Eva Fictícia", { importedFields: { avec: { comoConheceu: "INSTAGRAM" } } });
  const gilvan = await cliente("Fia Fictícia", { importedFields: { avec: { comoConheceu: "CLIENTE GILVAN" } } });
  const crm = await cliente("Gal Fictícia");
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: crm.id, stageId: lead.id, sourceLabel: "Indicação", createdAt: hora(3) });
  await refreshContactStats({ now: NOW });
  expect(await stats(insta.id)).toMatchObject({ originLabel: "Instagram", avecProfessionalHint: null });
  expect(await stats(gilvan.id)).toMatchObject({ originLabel: null, avecProfessionalHint: "Gilvan" });
  expect(await stats(crm.id)).toMatchObject({ originLabel: "Indicação" });
});

it("faltas, cancelamentos e os lançamentos de Dívida e Crédito Cliente do Avec", async () => {
  const c = await cliente();
  await horario(c.id, hora(30), "faltou");
  await horario(c.id, hora(20), "faltou");
  await horario(c.id, hora(10), "cancelado");
  await db.insert(salesPayments).values([
    { contactId: c.id, comanda: "1", paidOn: dia(30), method: "Dívida", valueCents: 5_000, externalKey: "t:pag:1" },
    { contactId: c.id, comanda: "2", paidOn: dia(10), method: "DIVIDA", valueCents: 2_500, externalKey: "t:pag:2" },
    { contactId: c.id, comanda: "3", paidOn: dia(5), method: "Crédito Cliente", valueCents: 7_000, externalKey: "t:pag:3" },
    { contactId: c.id, comanda: "4", paidOn: dia(5), method: "Pix", valueCents: 9_000, externalKey: "t:pag:4" },
  ]);
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ noShows: 2, cancellations: 1, debtCents: 7_500, debtCount: 2, lastDebtOn: dia(10), creditCents: 7_000, creditCount: 1 });
});

it("datas absurdas do Avec (compareceu em 2923, venda em 4676) não viram visita, última visita nem ritmo", async () => {
  const c = await cliente();
  await venda(c.id, dia(60));
  await venda(c.id, dia(30));
  await horario(c.id, new Date("2923-05-10T13:00:00Z"), "compareceu");
  await venda(c.id, "4676-01-01");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 2, lastVisitOn: dia(30), rhythmDays: null, totalCents: 20_000 });
});

it("contato sem nenhum dado tem linha com zeros (a lista e a ficha não quebram)", async () => {
  const c = await cliente("Sem Nada Fictícia");
  await refreshContactStats({ now: NOW });
  expect(await stats(c.id)).toMatchObject({ visits: 0, lastVisitOn: null, rhythmDays: null, topServices: [], debtCents: 0, originLabel: null });
});

it("duas recalculadas ao mesmo tempo (importação + noite): sem erro e uma linha por contato", async () => {
  for (let i = 0; i < 5; i++) await venda((await cliente(`Cliente${i} Fictícia`)).id, dia(10 + i));
  await Promise.all([refreshContactStats({ now: NOW }), refreshContactStats({ now: NOW })]);
  const [r] = (await db.execute(sql`select count(*)::int as n, (select count(*)::int from contacts) as total from contact_stats`)).rows as { n: number; total: number }[];
  expect(r.n).toBe(r.total);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/contact-stats.test.ts`
Esperado: FAIL ("Failed to resolve import ./contact-stats").

- [ ] **Passo 3: `src/server/domain/contact-stats.ts`**

```ts
import { sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { SOURCE_EXPR } from "../reports/common";
import { NOT_IDENTIFIED } from "../../lib/source-kinds";
import { MIN_VISITS_FOR_RHYTHM, PREFERRED_MIN_SERVICES, PREFERRED_MIN_SHARE } from "../../lib/client-rhythm";

/**
 * A visão por contato (Lote 2): recalcula `contact_stats` INTEIRA a partir do Avec (horários, comandas, pagamentos) e do CRM.
 * Roda depois de cada importação do Avec e toda noite (worker). Só escreve nesta tabela derivada; nunca envia nada.
 * Numa transação só: quem lê vê a versão anterior até o fim; a trava faz duas recalculadas ao mesmo tempo esperarem uma a outra.
 */
const TZ = "America/Bahia";
const LOCK_KEY = 2_026_101_502; // pg_advisory_xact_lock só desta recalculada
/** "CLIENTE GILVAN" no "Como conheceu": a Casa usava o campo para guardar a profissional (parâmetros, não texto na SQL: sem escapes). */
const CLIENTE_RE = "^\\s*cliente\\s+\\S";
const CLIENTE_PREFIX_RE = "^\\s*cliente\\s+";
const DEBT_RE = "d[íiÍI]vida";
const CREDIT_RE = "cr[éeÉE]dito\\s+cliente";

export type RefreshResult = { contatos: number; comVisita: number; ms: number };

export async function refreshContactStatsTx(tx: Tx, now: Date = new Date()): Promise<RefreshResult> {
  const t0 = Date.now();
  const at = now.toISOString();
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
  await tx.execute(sql`delete from contact_stats`);
  await tx.execute(sql`
    with
    hoje as (select (${at}::timestamptz at time zone ${TZ})::date as dia),
    visit_days as (
      select a.contact_id, (a.starts_at at time zone ${TZ})::date as day
        from appointments a
       where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${at}::timestamptz
      union
      select s.contact_id, s.sold_on
        from sales_items s, hoje
       where s.contact_id is not null and s.sold_on <= hoje.dia
      union
      select d.contact_id, (coalesce(d.attendance_at, d.scheduled_at) at time zone ${TZ})::date
        from deals d
       where d.attendance = 'compareceu' and coalesce(d.attendance_at, d.scheduled_at) <= ${at}::timestamptz
    ),
    gaps as (
      select contact_id, day, (day - lag(day) over (partition by contact_id order by day))::float8 as gap from visit_days
    ),
    visits as (
      select contact_id, count(*)::int as visits, min(day) as first_on, max(day) as last_on,
             percentile_cont(0.5) within group (order by gap) as median_gap
        from gaps group by contact_id
    ),
    misses as (
      select contact_id,
             count(*) filter (where status = 'faltou')::int as no_shows,
             count(*) filter (where status = 'cancelado')::int as cancellations
        from appointments
       where contact_id is not null and starts_at <= ${at}::timestamptz + interval '180 days'
       group by contact_id
    ),
    crm_misses as (
      select d.contact_id, count(*)::int as n from deals d
       where d.attendance = 'faltou' and not exists (select 1 from appointments a where a.deal_id = d.id)
       group by d.contact_id
    ),
    cycles as (
      select distinct on (contact_id) contact_id, cycle_days from (
        select a.contact_id, a.starts_at as at, l.cycle_days
          from appointments a join lists l on l.id = a.service_id
         where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${at}::timestamptz and l.cycle_days is not null
        union all
        select s.contact_id, s.sold_on::timestamp at time zone ${TZ}, l.cycle_days
          from sales_items s join lists l on l.kind = 'service' and lower(l.label) = lower(trim(s.item)), hoje
         where s.contact_id is not null and s.kind = 'servico' and s.sold_on <= hoje.dia and l.cycle_days is not null
      ) x order by contact_id, at desc
    ),
    pro_counts as (
      select s.contact_id,
             coalesce(s.professional_id::text, 'nome:' || upper(trim(s.professional_name))) as pro_key,
             (array_agg(s.professional_id) filter (where s.professional_id is not null))[1] as professional_id,
             max(coalesce(p.name, trim(s.professional_name))) as pro_name,
             count(*)::int as n
        from sales_items s left join professionals p on p.id = s.professional_id
       where s.contact_id is not null and s.kind = 'servico'
         and (s.professional_id is not null or nullif(trim(s.professional_name), '') is not null)
       group by 1, 2
    ),
    pro_top as (
      -- a janela soma antes do DISTINCT ON: total = todos os serviços com profissional da cliente
      select distinct on (contact_id) contact_id, professional_id, pro_name, n, (sum(n) over (partition by contact_id))::int as total
        from pro_counts order by contact_id, n desc, pro_name
    ),
    svc as (
      select contact_id, jsonb_agg(jsonb_build_object('item', item, 'n', n) order by n desc, last_on desc) as top_services
        from (
          select contact_id, item, n, last_on, row_number() over (partition by contact_id order by n desc, last_on desc) as rk
            from (select s.contact_id, trim(s.item) as item, count(*)::int as n, max(s.sold_on) as last_on
                    from sales_items s
                   where s.contact_id is not null and s.kind = 'servico' and nullif(trim(s.item), '') is not null
                   group by s.contact_id, trim(s.item)) c
        ) r
       where rk <= 3
       group by contact_id
    ),
    money as (
      select s.contact_id, coalesce(sum(s.total_cents), 0)::bigint as total_cents, count(distinct (s.sold_on, s.comanda))::int as tickets
        from sales_items s, hoje
       where s.contact_id is not null and s.sold_on <= hoje.dia
       group by s.contact_id
    ),
    pay as (
      select contact_id,
             coalesce(sum(value_cents) filter (where method ~* ${DEBT_RE}), 0)::bigint as debt_cents,
             count(*) filter (where method ~* ${DEBT_RE})::int as debt_count,
             max(coalesce(paid_on, comanda_on)) filter (where method ~* ${DEBT_RE}) as last_debt_on,
             coalesce(sum(value_cents) filter (where method ~* ${CREDIT_RE}), 0)::bigint as credit_cents,
             count(*) filter (where method ~* ${CREDIT_RE})::int as credit_count
        from sales_payments where contact_id is not null group by contact_id
    ),
    first_deal as (
      select distinct on (d.contact_id) d.contact_id, ${SOURCE_EXPR("d")} as label
        from deals d order by d.contact_id, d.created_at asc
    )
    insert into contact_stats (contact_id, visits, first_visit_on, last_visit_on, rhythm_days, cycle_days, return_due_on, no_shows, cancellations,
      tickets, total_cents, preferred_professional_id, preferred_professional_name, preferred_share, service_count, top_services,
      origin_label, avec_professional_hint, debt_cents, debt_count, last_debt_on, credit_cents, credit_count, computed_at)
    select c.id, coalesce(v.visits, 0), v.first_on, v.last_on, r.rhythm, cy.cycle_days,
           v.last_on + coalesce(r.rhythm, cy.cycle_days::int),
           coalesce(m.no_shows, 0) + coalesce(cm.n, 0), coalesce(m.cancellations, 0),
           coalesce(mo.tickets, 0), mo.total_cents,
           case when pt.ok then pt.professional_id end, case when pt.ok then pt.pro_name end,
           case when pt.total > 0 then round(pt.n::numeric / pt.total, 2)::real end, coalesce(pt.total, 0),
           coalesce(sv.top_services, '[]'::jsonb),
           coalesce(case when cc.raw !~* ${CLIENTE_RE} then upper(left(cc.raw, 1)) || lower(substr(cc.raw, 2)) end,
                    case when fd.label <> ${NOT_IDENTIFIED} then fd.label end),
           case when cc.raw ~* ${CLIENTE_RE} then initcap(lower(regexp_replace(cc.raw, ${CLIENTE_PREFIX_RE}, '', 'i'))) end,
           coalesce(pa.debt_cents, 0), coalesce(pa.debt_count, 0), pa.last_debt_on, coalesce(pa.credit_cents, 0), coalesce(pa.credit_count, 0),
           ${at}::timestamptz
      from contacts c
      cross join lateral (select nullif(trim(c.imported_fields->'avec'->>'comoConheceu'), '') as raw) cc
      left join visits v on v.contact_id = c.id
      cross join lateral (select case when v.visits >= ${MIN_VISITS_FOR_RHYTHM} then greatest(1, round(v.median_gap))::int end as rhythm) r
      left join cycles cy on cy.contact_id = c.id
      left join misses m on m.contact_id = c.id
      left join crm_misses cm on cm.contact_id = c.id
      left join (select *, total >= ${PREFERRED_MIN_SERVICES} and n::real / total >= ${PREFERRED_MIN_SHARE} as ok from pro_top) pt on pt.contact_id = c.id
      left join svc sv on sv.contact_id = c.id
      left join money mo on mo.contact_id = c.id
      left join pay pa on pa.contact_id = c.id
      left join first_deal fd on fd.contact_id = c.id`);
  const [r] = (await tx.execute(sql`select count(*)::int as contatos, count(*) filter (where visits > 0)::int as "comVisita" from contact_stats`)).rows as { contatos: number; comVisita: number }[];
  return { contatos: r.contatos, comVisita: r.comVisita, ms: Date.now() - t0 };
}

export function refreshContactStats(opts: { now?: Date } = {}): Promise<RefreshResult> {
  return db.transaction((tx) => refreshContactStatsTx(tx, opts.now ?? new Date()));
}

export type StatsSummary = {
  contatos: number; uma: number; duasAQuatro: number; cincoAOnze: number; dozeOuMais: number;
  comRitmo: number; ritmoMediano: number | null; comPreferida: number;
};

/** O resumo que o ensaio imprime para conferir com a auditoria de 15/10 (2.363 / 1.110 / 513 / 167; 1.163 com ritmo, mediana 62; 752 com preferida). */
export async function statsSummary(tx: Tx | typeof db): Promise<StatsSummary> {
  const [r] = (await tx.execute(sql`
    select count(*)::int as contatos,
      count(*) filter (where visits = 1)::int as uma,
      count(*) filter (where visits between 2 and 4)::int as "duasAQuatro",
      count(*) filter (where visits between 5 and 11)::int as "cincoAOnze",
      count(*) filter (where visits >= 12)::int as "dozeOuMais",
      count(*) filter (where rhythm_days is not null)::int as "comRitmo",
      (percentile_cont(0.5) within group (order by rhythm_days))::float8 as "ritmoMediano",
      count(*) filter (where preferred_professional_name is not null)::int as "comPreferida"
    from contact_stats`)).rows as StatsSummary[];
  return r;
}
```

Os padrões de texto (`CLIENTE_RE`, `DEBT_RE`…) vão como **parâmetros** de propósito: dentro do `sql\`...\`` um `\s` escrito direto viraria `s` (escape de template do JavaScript) e o filtro deixaria de funcionar sem erro nenhum.

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/contact-stats.test.ts`
Esperado: PASS (9 testes).

- [ ] **Passo 5: Script de ensaio `scripts/visao-contatos.ts`**

```ts
import "dotenv/config";
import { TransactionRollbackError } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { refreshContactStatsTx, statsSummary } from "../src/server/domain/contact-stats";

/**
 * Visão por contato (Lote 2). `--dry-run` (padrão): calcula numa transação, imprime o resumo e DESFAZ. `--aplicar`: grava.
 * Só escreve na tabela derivada `contact_stats` (pode ser refeita a qualquer hora a partir do Avec e do CRM: não precisa de backup).
 * Nunca envia mensagem. Conferir o resumo com a auditoria de 15/10 antes de aplicar.
 */
async function main() {
  const apply = process.argv.includes("--aplicar");
  try {
    await db.transaction(async (tx) => {
      const r = await refreshContactStatsTx(tx, new Date());
      const s = await statsSummary(tx);
      console.log(`${apply ? "GRAVADO" : "ENSAIO (nada foi gravado)"}: ${r.contatos} contatos, ${r.comVisita} com pelo menos uma visita (${r.ms} ms)`);
      console.log("Visitas por cliente (auditoria 15/10: 1 = 2.363 · 2 a 4 = 1.110 · 5 a 11 = 513 · 12+ = 167):");
      console.log(`  1 visita: ${s.uma} · 2 a 4: ${s.duasAQuatro} · 5 a 11: ${s.cincoAOnze} · 12 ou mais: ${s.dozeOuMais}`);
      console.log(`Com ritmo (3+ visitas): ${s.comRitmo} (auditoria: 1.163) · ritmo mediano: ${s.ritmoMediano ?? "—"} dias (auditoria: 62)`);
      console.log(`Com profissional preferida calculada: ${s.comPreferida} (auditoria: 752)`);
      if (!apply) tx.rollback();
    });
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
  }
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
```

Rodar (banco do worktree, que tem só o seed): `npx tsx scripts/visao-contatos.ts`
Esperado: "ENSAIO (nada foi gravado): N contatos, 0 com pelo menos uma visita" e as linhas do resumo, sem erro.

- [ ] **Passo 6: Verde e commit**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

```bash
git add src/server/domain/contact-stats.ts src/server/domain/contact-stats.test.ts scripts/visao-contatos.ts
git commit -m "feat(contatos): visão por contato (visitas, ritmo, preferida, serviços, faltas, dívida/crédito, como conheceu) com ensaio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4: Recalcular depois de cada importação do Avec e toda noite (worker)

**Files:**
- Modify: `src/server/domain/avec/apply.ts` (`applyAvecFiles`, que o Lote 1C já trocou para devolver `funil`; ache com `grep -n "export async function applyAvecFiles" src/server/domain/avec/apply.ts`)
- Modify: `scripts/importar-avec.ts` (a linha do funil que o 1C pôs; `grep -n "Funil (só quem conversou" scripts/importar-avec.ts`)
- Modify: `worker/index.ts`
- Test: `src/server/domain/contact-stats.test.ts` (um teste a mais)

**Interfaces:**
- Consumes (T3): `refreshContactStats`, `type RefreshResult`. (1C): `applyAvecFiles(files, opts?: { now?: Date }): Promise<AvecBatchResult & { funil: FunnelSyncResult }>`.
- Produces:
  - `applyAvecFiles(...)` passa a devolver também `visao: RefreshResult | null` (null quando o recálculo falhou; a importação não é desfeita);
  - fila do worker `"visao-contatos"`, todo dia às 03:30 de Salvador, e uma rodada logo ao subir quando `contact_stats` está vazia.

- [ ] **Passo 1: Escrever o teste que falha**

No fim de `src/server/domain/contact-stats.test.ts` (imports novos no topo: `import { applyAvecFiles } from "./avec/apply";` e `import { buildXlsx, readXlsx } from "./avec/xlsx";`):

```ts
it("importar um relatório do Avec recalcula a visão por contato", async () => {
  const c = await cliente("Rita Fictícia", { phoneE164: "+5571988880001" });
  const rows = await readXlsx(await buildXlsx([
    ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
    ["01/10/2026 10:00", "20/10/2026", "09:30", "Rita Fictícia", 71988880001, "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "Gosta de franja curta", "", "", "Recepção"],
  ]));
  const r = await applyAvecFiles([{ fileName: "reservas.xlsx", rows }], { now: NOW });
  expect(r.visao?.contatos).toBeGreaterThanOrEqual(1);
  expect(await stats(c.id)).toBeDefined(); // a linha só existe se a recalculada rodou depois da importação
});
```

Rodar: `npx vitest run src/server/domain/contact-stats.test.ts -t "importar um relatório"`
Esperado: FAIL ("Cannot read properties of undefined (reading 'contatos')" ou `stats(c.id)` undefined).

- [ ] **Passo 2: `apply.ts`**

Import novo: `import { refreshContactStats, type RefreshResult } from "../contact-stats";`

Assinatura de `applyAvecFiles` (a do 1C mais `visao`):

```ts
export async function applyAvecFiles(files: AvecFileInput[], opts: { now?: Date } = {}): Promise<AvecBatchResult & { funil: FunnelSyncResult; visao: RefreshResult | null }> {
```

E o `return` do fim (depois da linha `const funil = await syncFunnelFromAgenda(...)` do 1C):

```ts
  // Lote 2: a visão por contato (visitas, ritmo, preferências) é refeita com o que entrou. Falhar aqui não desfaz a importação (roda de novo à noite).
  const visao = await refreshContactStats({ now: opts.now }).catch((e) => { console.error("[visão por contato]", e); return null; });
  return { files: results, summary, funil, visao };
```

No comentário do topo do arquivo, depois da frase do funil que o 1C escreveu, acrescentar: "Por fim refaz a visão por contato (`contact_stats`) da ficha e da lista de Contatos."

Se o TypeScript reclamar em `src/app/api/relatorios/avec/route.ts` (o lote vazio monta o objeto à mão), acrescentar `visao: null` ao objeto do lote vazio.

- [ ] **Passo 3: `scripts/importar-avec.ts`**

Logo depois da linha `console.log(\`Funil (só quem conversou ...\`)` do 1C:

```ts
  console.log(res.visao
    ? `Visão por contato: ${res.visao.contatos} contatos recalculados (${res.visao.comVisita} com visita).`
    : "Visão por contato: não recalculou (veja o erro acima); o worker refaz às 03:30.");
```

- [ ] **Passo 4: Worker**

Em `worker/index.ts`:
- imports: `import { refreshContactStats } from "../src/server/domain/contact-stats";` e acrescentar `contactStats` ao import de `../src/server/db/schema` (fica `import { contactStats, settings } from "../src/server/db/schema";`);
- em `QUEUES`, acrescentar `visao: "visao-contatos"`;
- depois do `boss.schedule(QUEUES.monthly, ...)`:

```ts
  // Lote 2: a visão por contato da ficha e da lista de Contatos é refeita toda noite (e depois de cada importação do Avec).
  await boss.schedule(QUEUES.visao, "30 3 * * *", null, { tz: "America/Bahia", singletonKey: "visao-contatos" });
```

- depois do `boss.work(QUEUES.monthly, ...)`:

```ts
  await boss.work(QUEUES.visao, { batchSize: 1 }, async () => {
    try { const r = await refreshContactStats(); console.log(`[visão por contato] ${r.contatos} contatos, ${r.comVisita} com visita (${r.ms} ms)`); }
    catch (e) { console.error("[visão por contato] falhou", e); }
  });
```

- logo antes de `await boss.send(QUEUES.rules, {});` ("Primeira rodada imediata"):

```ts
  // Primeira vez (tabela vazia logo depois da migration): não espera a madrugada.
  if (!(await db.select({ id: contactStats.contactId }).from(contactStats).limit(1)).length) await boss.send(QUEUES.visao, {});
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/contact-stats.test.ts src/server/domain/avec`
Esperado: PASS (os testes do Avec do 1C continuam verdes: `visao` é campo a mais).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 6: Commit**

```bash
git add src/server/domain/avec/apply.ts src/app/api/relatorios/avec/route.ts scripts/importar-avec.ts worker/index.ts src/server/domain/contact-stats.test.ts
git commit -m "feat(contatos): visão por contato refeita depois de cada importação do Avec e toda noite às 03:30

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Se `route.ts` não precisou mudar, tire-o do `git add`.)

---

### Tarefa 5: O retrato da cliente no servidor (`getClientSnapshot`) e o contexto da conversa com o Avec

**Files:**
- Create: `src/server/queries/client-snapshot.ts`, `src/server/queries/client-snapshot.test.ts`
- Modify: `src/server/queries/client-context.ts` (inteiro, 70 linhas)
- Test: `src/server/queries/client-context.test.ts` (os testes atuais continuam; um novo)

**Interfaces:**
- Consumes (T1-T3): `contactStats`, `contacts.preferredProfessionalId`, `contacts.alertNotes`, `clientSituation`, `FUTURE_HORIZON_DAYS`, `refreshContactStats` (nos testes). Existentes: `nextAppointmentsOf`, `listClientPackages`, `type AppointmentItem` (`src/server/queries/avec.ts`), `lateExists` (`late-count.ts`), `teamNameOf` (`team-name.ts`, 1A), `normText` (`domain/avec/normalize.ts`).
- Produces:
  - `type ClientSnapshot` (abaixo) e `getClientSnapshot(contactId: string, opts: { money: boolean; now?: Date }): Promise<ClientSnapshot | null>`;
  - `ClientContext` ganha `situation: string`, `short: string`, `states: SituationState[]`, `retorno: ReturnInfo | null`, `preferredProfessional: string | null`, `alertNotes: string | null`, `knownSince: string | null`; `visits`, `lastVisit`, `firstContactAt`, `isFirstContact` e `totalCents` passam a considerar o Avec (corrige os 122 "nenhuma registrada" e os 109 "primeira conversa").

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/queries/client-snapshot.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, professionals, salesItems, salesPayments, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { refreshContactStats } from "../domain/contact-stats";
import { getClientSnapshot } from "./client-snapshot";
import { clientContext } from "./client-context";

const NOW = new Date("2026-10-15T15:00:00Z");
const dia = (n: number) => new Date(Date.parse("2026-10-15T00:00:00Z") - n * 86_400_000).toISOString().slice(0, 10);
let seq = 0;
let rita = "";
const venda = (soldOn: string, o: Partial<typeof salesItems.$inferInsert> = {}) =>
  db.insert(salesItems).values({ contactId: rita, soldOn, item: "Escova", kind: "servico", totalCents: 20_000, comanda: String(++seq), externalKey: `t:v:${seq}`, ...o });

beforeEach(async () => {
  seq = 0;
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000201", birthDay: 17, birthMonth: 10 }).returning())[0].id;
});

it("cliente frequente do Avec: visitas > 0 e 'desde' antes de 2026 (nada de 'nenhuma registrada' nem 'primeira conversa')", async () => {
  await venda("2020-03-10"); await venda("2024-05-01"); await venda(dia(45));
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [d] = await db.insert(deals).values({ contactId: rita, stageId: lead.id }).returning();
  await refreshContactStats({ now: NOW });
  const x = await clientContext(rita, d.id, { money: false });
  expect(x.visits).toBe(3);
  expect(x.isFirstContact).toBe(false);
  expect(new Date(x.firstContactAt).getTime()).toBeLessThan(Date.parse("2026-01-01"));
  expect(x.lastVisit?.at.slice(0, 10)).toBe(dia(45));
});

it("sem 'ver valores', nenhum centavo sai do servidor (total, ticket, dívida, crédito)", async () => {
  await venda(dia(60)); await venda(dia(30));
  await db.insert(salesPayments).values([
    { contactId: rita, comanda: "9", paidOn: dia(30), method: "Dívida", valueCents: 4_000, externalKey: "t:p:1" },
    { contactId: rita, comanda: "8", paidOn: dia(20), method: "Crédito Cliente", valueCents: 1_000, externalKey: "t:p:2" },
  ]);
  await refreshContactStats({ now: NOW });
  const sem = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect([sem.stats.totalCents, sem.stats.ticketCents, sem.finance.debtCents, sem.finance.creditCents]).toEqual([null, null, null, null]);
  expect(sem.finance).toMatchObject({ debtCount: 1, creditCount: 1 }); // o aviso "tem dívida" continua, sem o valor
  expect(JSON.stringify(sem)).not.toMatch(/"(total|ticket|debt|credit|price)Cents":\s*\d/);
  const com = (await getClientSnapshot(rita, { money: true, now: NOW }))!;
  expect(com.stats).toMatchObject({ totalCents: 40_000, ticketCents: 20_000 });
  expect(com.finance).toMatchObject({ debtCents: 4_000, creditCents: 1_000 });
});

it("profissional preferida: a da ficha vale mais que a calculada; sem as duas, a anotada no Avec", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [gilvan] = await db.insert(professionals).values({ name: "GILVAN" }).returning();
  for (const n of [90, 60, 30]) await venda(dia(n), { professionalId: maiara.id, professionalName: "MAIARA" });
  await refreshContactStats({ now: NOW });
  expect((await getClientSnapshot(rita, { money: false, now: NOW }))!.preferred).toMatchObject({ id: maiara.id, name: "MAIARA", source: "calculada", share: 1 });
  await db.update(contacts).set({ preferredProfessionalId: gilvan.id }).where(eq(contacts.id, rita));
  expect((await getClientSnapshot(rita, { money: false, now: NOW }))!.preferred).toMatchObject({ id: gilvan.id, source: "ficha" });
  const [outra] = await db.insert(contacts).values({ name: "Fia Fictícia", phoneE164: "+5571966000202", importedFields: { avec: { comoConheceu: "CLIENTE GILVAN" } } }).returning();
  await refreshContactStats({ now: NOW });
  expect((await getClientSnapshot(outra.id, { money: false, now: NOW }))!.preferred).toMatchObject({ id: gilvan.id, name: "Gilvan", source: "avec" });
});

it("frase com horário, conversa aberta e dona; horário a mais de 180 dias não conta como próximo", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana Souza", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [espera] = await db.select().from(stages).where(eq(stages.key, "followup_1"));
  await db.insert(deals).values({ contactId: rita, stageId: espera.id, ownerId: ana.id, stageEnteredAt: new Date("2026-10-15T13:00:00Z") });
  await venda(dia(20));
  await db.insert(appointments).values({ contactId: rita, startsAt: new Date("2027-08-01T13:00:00Z"), status: "agendado", serviceLabel: "Escova", externalKey: "t:a:longe" });
  await refreshContactStats({ now: NOW });
  const longe = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect(longe.nextAppointment).toBeNull();
  expect(longe.situation.sentence).toBe("última visita há 20 dias · conversa aguardando cliente há 2 h com Ana · aniversário 17/10");
  await db.insert(appointments).values({ contactId: rita, startsAt: new Date("2026-10-16T17:00:00Z"), status: "confirmado", serviceLabel: "Escova", externalKey: "t:a:perto" });
  const perto = (await getClientSnapshot(rita, { money: false, now: NOW }))!;
  expect(perto.situation.sentence.startsWith("Tem horário amanhã 14:00")).toBe(true);
  expect(perto.conversation).toMatchObject({ stageName: "Aguardando cliente", ownerName: "Ana Souza" });
});
```

O nome da dona sai pela regra do 1A (`teamNameOf`: a assinatura, ou o nome cadastrado); Ana não tem assinatura, então vem "Ana Souza" e a frase usa o primeiro nome.

Em `src/server/queries/client-context.test.ts`, os dois testes atuais não mudam (sem nada do Avec, `contact_stats` vazia: visitas e total do CRM).

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/queries/client-snapshot.test.ts`
Esperado: FAIL ("Failed to resolve import ./client-snapshot").

- [ ] **Passo 3: `src/server/queries/client-snapshot.ts`**

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { contactStats, contacts, deals, professionals, stages } from "../db/schema";
import { listClientPackages, nextAppointmentsOf, type AppointmentItem } from "./avec";
import { lateExists } from "./late-count";
import { teamNameOf } from "./team-name";
import { normText } from "../domain/avec/normalize";
import { clientSituation, type Situation } from "../../lib/client-situation";
import { FUTURE_HORIZON_DAYS } from "../../lib/client-rhythm";
import { isUuid } from "../../lib/uuid";

const DAY = 86_400_000;

/** A cliente agora, para a ficha e para o painel da conversa (Lote 2). Valores em centavos só com `money`. */
export type ClientSnapshot = {
  contactId: string;
  stats: {
    visits: number; firstVisitOn: string | null; lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null;
    noShows: number; cancellations: number; serviceCount: number; topServices: { item: string; n: number }[];
    totalCents: number | null; ticketCents: number | null; computedAt: string | null;
  };
  situation: Situation;
  preferred: { id: string | null; name: string; source: "ficha" | "calculada" | "avec"; share: number | null } | null;
  /** "Como conheceu" (Avec) ou a origem do primeiro lead; null = não identificada. */
  origin: string | null;
  avecProfessionalHint: string | null;
  finance: { debtCount: number; debtCents: number | null; lastDebtOn: string | null; creditCount: number; creditCents: number | null };
  conversation: {
    dealId: string; stageName: string; stageKind: string; ownerName: string | null; lastReplyName: string | null; lastReplyVia: "celular" | "crm" | null;
    enteredAt: string; awaitingSince: string | null; late: boolean; closedConversation: boolean; nextAction: { title: string; dueAt: string } | null;
  } | null;
  nextAppointment: AppointmentItem | null;
  activePackage: { packageName: string; usedSessions: number; totalSessions: number } | null;
  birthday: { day: number; month: number; year: number | null } | null;
  /** O mais antigo entre a primeira visita, o "cliente desde" do Avec, a primeira mensagem e o primeiro lead. */
  knownSince: string | null;
  alertNotes: string | null;
};

export async function getClientSnapshot(contactId: string, opts: { money: boolean; now?: Date }): Promise<ClientSnapshot | null> {
  if (!isUuid(contactId)) return null;
  const now = opts.now ?? new Date();
  const [row] = await db.select({ c: contacts, s: contactStats, chosen: professionals.name }).from(contacts)
    .leftJoin(contactStats, eq(contactStats.contactId, contacts.id))
    .leftJoin(professionals, eq(professionals.id, contacts.preferredProfessionalId))
    .where(eq(contacts.id, contactId));
  if (!row) return null;
  const { c, s } = row;
  const [[open], nextMap, [pkg], [first], pros] = await Promise.all([
    db.select({
      id: deals.id, stageName: stages.name, stageKind: stages.kind,
      ownerName: teamNameOf(deals.ownerId), lastReplyName: teamNameOf(deals.lastReplyById), lastReplyVia: deals.lastReplyVia,
      enteredAt: deals.stageEnteredAt, awaitingSince: deals.awaitingReplySince, closedConversation: sql<boolean>`(${deals.conversationArchivedAt} is not null)`,
      late: sql<boolean>`${lateExists(deals.id)}`,
      nextTitle: sql<string | null>`(select t.title from tasks t where t.deal_id = ${deals.id} and t.kind = 'proxima_acao' and t.done_at is null order by t.due_at limit 1)`,
      nextDue: sql<string | null>`(select t.due_at from tasks t where t.deal_id = ${deals.id} and t.kind = 'proxima_acao' and t.done_at is null order by t.due_at limit 1)`,
    }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
      .where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).limit(1),
    nextAppointmentsOf([contactId], now),
    listClientPackages({ contactId, situacao: "ativos" }, now),
    db.execute(sql`select least((select min(m.created_at) from messages m where m.contact_id = ${contactId}),
                                (select min(d.created_at) from deals d where d.contact_id = ${contactId})) as first`).then((r) => r.rows as { first: string | Date | null }[]),
    s?.avecProfessionalHint ? db.select({ id: professionals.id, name: professionals.name }).from(professionals) : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // Horário a mais de 180 dias (data absurda do Avec) não é "próximo horário".
  const nextRaw = nextMap.get(contactId) ?? null;
  const next = nextRaw && Date.parse(nextRaw.startsAt) <= now.getTime() + FUTURE_HORIZON_DAYS * DAY ? nextRaw : null;

  const preferred: ClientSnapshot["preferred"] = c.preferredProfessionalId && row.chosen
    ? { id: c.preferredProfessionalId, name: row.chosen, source: "ficha", share: null }
    : s?.preferredProfessionalName
      ? { id: s.preferredProfessionalId, name: s.preferredProfessionalName, source: "calculada", share: s.preferredShare }
      : s?.avecProfessionalHint
        ? { id: pros.find((p) => normText(p.name) === normText(s.avecProfessionalHint))?.id ?? null, name: s.avecProfessionalHint, source: "avec", share: null }
        : null;

  const since = [s?.firstVisitOn ? Date.parse(`${s.firstVisitOn}T15:00:00Z`) : null, c.clientSince?.getTime() ?? null, first?.first ? new Date(first.first).getTime() : null]
    .filter((x): x is number => x != null);

  const conversation: ClientSnapshot["conversation"] = open ? {
    dealId: open.id, stageName: open.stageName, stageKind: open.stageKind, ownerName: open.ownerName, lastReplyName: open.lastReplyName,
    lastReplyVia: open.lastReplyVia ?? null, enteredAt: open.enteredAt.toISOString(), awaitingSince: open.awaitingSince?.toISOString() ?? null,
    late: !!open.late, closedConversation: !!open.closedConversation,
    nextAction: open.nextTitle && open.nextDue ? { title: open.nextTitle, dueAt: new Date(open.nextDue).toISOString() } : null,
  } : null;

  const situation = clientSituation({
    lastVisitOn: s?.lastVisitOn ?? null, rhythmDays: s?.rhythmDays ?? null, cycleDays: s?.cycleDays ?? null,
    nextAppointment: next ? { startsAt: next.startsAt, professionalName: next.professionalName } : null,
    activePackage: pkg ? { usedSessions: pkg.usedSessions, totalSessions: pkg.totalSessions } : null,
    // Conversa encerrada não entra na frase (a ficha mostra no bloco Agora).
    conversation: conversation && !conversation.closedConversation ? conversation : null,
    birthday: c.birthDay && c.birthMonth ? { day: c.birthDay, month: c.birthMonth } : null,
  }, now.getTime());

  const money = opts.money;
  return {
    contactId,
    stats: {
      visits: s?.visits ?? 0, firstVisitOn: s?.firstVisitOn ?? null, lastVisitOn: s?.lastVisitOn ?? null,
      rhythmDays: s?.rhythmDays ?? null, cycleDays: s?.cycleDays ?? null, noShows: s?.noShows ?? 0, cancellations: s?.cancellations ?? 0,
      serviceCount: s?.serviceCount ?? 0, topServices: s?.topServices ?? [],
      totalCents: money ? s?.totalCents ?? 0 : null,
      ticketCents: money && s && s.tickets > 0 && s.totalCents != null ? Math.round(s.totalCents / s.tickets) : null,
      computedAt: s?.computedAt?.toISOString() ?? null,
    },
    situation, preferred, origin: s?.originLabel ?? null, avecProfessionalHint: s?.avecProfessionalHint ?? null,
    finance: {
      debtCount: s?.debtCount ?? 0, debtCents: money ? s?.debtCents ?? 0 : null, lastDebtOn: s?.lastDebtOn ?? null,
      creditCount: s?.creditCount ?? 0, creditCents: money ? s?.creditCents ?? 0 : null,
    },
    conversation,
    nextAppointment: next,
    activePackage: pkg ? { packageName: pkg.packageName, usedSessions: pkg.usedSessions, totalSessions: pkg.totalSessions } : null,
    birthday: c.birthDay && c.birthMonth ? { day: c.birthDay, month: c.birthMonth, year: c.birthYear } : null,
    knownSince: since.length ? new Date(Math.min(...since)).toISOString() : null,
    alertNotes: c.alertNotes,
  };
}
```

- [ ] **Passo 4: `src/server/queries/client-context.ts`**

Trocar o arquivo inteiro por:

```ts
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getClientSnapshot } from "./client-snapshot";
import type { SituationState } from "../../lib/client-situation";
import type { ReturnInfo } from "../../lib/client-rhythm";

/**
 * O que a atendente precisa saber da cliente ao abrir a conversa. Desde o Lote 2 inclui o Avec (visitas, "desde", total)
 * e a mesma frase de situação da ficha. Valores só com `money`.
 */
export type ClientContext = {
  firstContactAt: string;
  isFirstContact: boolean;
  lastVisit: { at: string; service: string | null; by: string | null } | null;
  visits: number;
  lastSales: { at: string; service: string | null; valueCents: number | null }[];
  totalCents: number | null;
  previousOwner: string | null;
  nextAppointment: { startsAt: string; serviceLabel: string; professionalName: string | null } | null;
  activePackage: { packageName: string; usedSessions: number; totalSessions: number } | null;
  /** A frase de situação (a mesma da ficha), a versão curta e os estados. */
  situation: string; short: string; states: SituationState[];
  retorno: ReturnInfo | null;
  preferredProfessional: string | null;
  alertNotes: string | null;
  knownSince: string | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

export async function clientContext(contactId: string, dealId: string, opts: { money: boolean }): Promise<ClientContext> {
  const now = new Date();
  const [[base], visits, sales, [prev], snap] = await Promise.all([
    db.execute(sql`
      select least(c.created_at, coalesce((select min(m.created_at) from messages m where m.contact_id = c.id), c.created_at),
                   coalesce((select min(d.created_at) from deals d where d.contact_id = c.id), c.created_at)) as first,
             (select count(*)::int from deals d where d.contact_id = c.id and d.id <> ${dealId}) as others,
             c.client_since as "clientSince"
      from contacts c where c.id = ${contactId}`).then((r) => r.rows as { first: string; others: number; clientSince: string | null }[]),
    db.execute(sql`
      select coalesce(d.scheduled_at, d.attendance_at, d.closed_at) as at, l.label as service, u.name as by
      from deals d left join lists l on l.id = d.service_id left join users u on u.id = d.owner_id
      where d.contact_id = ${contactId} and d.attendance = 'compareceu'
      order by coalesce(d.scheduled_at, d.attendance_at, d.closed_at) desc`).then((r) => r.rows as { at: string; service: string | null; by: string | null }[]),
    db.execute(sql`
      select d.closed_at as at, l.label as service, d.value_cents as "valueCents"
      from deals d join stages s on s.id = d.stage_id left join lists l on l.id = d.service_id
      where d.contact_id = ${contactId} and s.kind = 'fechado' and d.closed_at is not null
      order by d.closed_at desc`).then((r) => r.rows as { at: string; service: string | null; valueCents: number | null }[]),
    db.execute(sql`
      select u.name from deals d join users u on u.id = d.owner_id
      where d.contact_id = ${contactId} and d.id <> ${dealId} and d.closed_at is not null
      order by d.closed_at desc limit 1`).then((r) => r.rows as { name: string }[]),
    getClientSnapshot(contactId, { money: opts.money, now }),
  ]);
  const crm = visits[0];
  const avecLast = snap?.stats.lastVisitOn ? `${snap.stats.lastVisitOn}T15:00:00.000Z` : null;
  const lastVisit = crm && (!avecLast || Date.parse(iso(crm.at)) >= Date.parse(avecLast))
    ? { at: iso(crm.at), service: crm.service, by: crm.by }
    : avecLast ? { at: avecLast, service: null, by: null } : null;
  const visitCount = Math.max(visits.length, snap?.stats.visits ?? 0);
  const firstAt = Math.min(Date.parse(iso(base?.first ?? now)), snap?.knownSince ? Date.parse(snap.knownSince) : Infinity);
  const crmTotal = sales.reduce((n, s) => n + (s.valueCents ?? 0), 0);
  const avecTotal = snap?.stats.totalCents ?? 0;
  return {
    firstContactAt: new Date(firstAt).toISOString(),
    isFirstContact: (!base || base.others === 0) && visitCount === 0 && !base?.clientSince,
    lastVisit,
    visits: visitCount,
    lastSales: sales.slice(0, 3).map((s) => ({ at: iso(s.at), service: s.service, valueCents: opts.money ? s.valueCents : null })),
    // O Avec é o caixa da Casa: com venda lá, vale o total do Avec; venda só no CRM conta quando não há nada do Avec.
    totalCents: opts.money ? (avecTotal > 0 ? avecTotal : crmTotal) : null,
    previousOwner: prev?.name ?? null,
    nextAppointment: snap?.nextAppointment ? { startsAt: snap.nextAppointment.startsAt, serviceLabel: snap.nextAppointment.serviceLabel, professionalName: snap.nextAppointment.professionalName } : null,
    activePackage: snap?.activePackage ?? null,
    situation: snap?.situation.sentence ?? "", short: snap?.situation.short ?? "", states: snap?.situation.states ?? [],
    retorno: snap?.situation.retorno ?? null,
    preferredProfessional: snap?.preferred?.name ?? null,
    alertNotes: snap?.alertNotes ?? null,
    knownSince: snap?.knownSince ?? null,
  };
}
```

O próximo horário agora vem do retrato (com o corte de 180 dias); antes vinha de `nextAppointmentsOf` sem corte.

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/queries/client-snapshot.test.ts src/server/queries/client-context.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. Se algum teste de render da conversa montar um `DealDetail` à mão e o TypeScript pedir os campos novos de `context`, acrescentar ao objeto do teste `situation: "", short: "", states: [], retorno: null, preferredProfessional: null, alertNotes: null, knownSince: null`.

- [ ] **Passo 6: Commit**

```bash
git add src/server/queries/client-snapshot.ts src/server/queries/client-snapshot.test.ts src/server/queries/client-context.ts src/server/queries/client-context.test.ts
git commit -m "feat(ficha): retrato da cliente no servidor (frase de situação, Avec, preferida, finanças) e o contexto da conversa com as visitas do Avec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Se algum arquivo de teste de componente precisou dos campos novos, incluí-lo no `git add`.)

---
### Tarefa 6: Editar na própria ficha, "Lembrar" e "Agendar"

**Files:**
- Create: `src/server/domain/contact-profile.ts`, `src/server/domain/contact-profile.test.ts`
- Create: `src/server/domain/suggested-return.ts` (só o "Lembrar"; a Tarefa 14 acrescenta a varredura)
- Modify: `src/app/(app)/contatos/actions.ts` (ações novas no fim)
- Modify: `src/components/queue/tags-editor.tsx` (aceita `contactId` no lugar de `dealId`)
- Modify: `src/app/(app)/atendimento/[id]/page.tsx:28` e `src/components/queue/conversation-pane.tsx:82-86` (abrir a folha Agendar com `?agendar=1`)

**Interfaces:**
- Consumes (T2): `parseBirthday`, `reminderDueAt`, `shortDay`, `bahiaDay`. (1C): `clientFirstName(name): string` (`src/lib/attempts.ts`). Existentes: `addTag`, `removeTag` (`src/server/domain/tags.ts`), `createTaskTx` (`tasks.ts`), `startConversation` (`start-conversation.ts`), `emit`.
- Produces:
  - `ALERT_NOTES_MAX = 300`, `contactProfileSchema`, `type ContactProfilePatch = { name?, email?, birthday?, notes?, alertNotes?, preferredProfessionalId? }` (strings; `null`/`""` apagam);
  - `updateContactProfile(contactId: string, raw: ContactProfilePatch, userId: string): Promise<{ changed: string[] }>` (lança `UserFacingError` com o texto para a tela);
  - `REMIND_META = { origem: "lembrar_retorno" }`, `remindReturn(contactId: string, input: { dueAt?: Date | null; dueOn?: string | null }, userId: string, now?: Date): Promise<{ taskId: string; dueAt: Date }>`;
  - ações: `updateContactProfileAction(contactId, patch)`, `addContactTagAction(contactId, name)`, `removeContactTagAction(contactId, tagId)`, `remindReturnAction(contactId, { dueAt?: string | null; dueOn?: string | null })`, `scheduleFromContactAction(contactId)` (redireciona para `/atendimento/<id>?agendar=1`);
  - `TagsEditor({ dealId?, contactId?, tags, options })`;
  - `ConversationPane({ ..., openSchedule?: boolean })`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/contact-profile.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, deals, professionals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { updateContactProfile } from "./contact-profile";
import { remindReturn } from "./suggested-return";
import { UserFacingError } from "./errors";

const NOW = new Date("2026-10-15T15:00:00Z");
let ana = "", rita = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000101" }).returning())[0].id;
});
const contato = async () => (await db.select().from(contacts).where(eq(contacts.id, rita)))[0];

it("edita nome, e-mail, aniversário, anotações, avisos fixos e profissional preferida; audita só o que mudou", async () => {
  const [pro] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const r = await updateContactProfile(rita, { name: " Rita Souza ", email: "rita@exemplo.com", birthday: "17/10/1990", notes: "Prefere manhã", alertNotes: "Alérgica a amônia", preferredProfessionalId: pro.id }, ana);
  expect([...r.changed].sort()).toEqual(["alertNotes", "birthday", "email", "name", "notes", "preferredProfessionalId"]);
  expect(await contato()).toMatchObject({ name: "Rita Souza", email: "rita@exemplo.com", birthDay: 17, birthMonth: 10, birthYear: 1990, notes: "Prefere manhã", alertNotes: "Alérgica a amônia", preferredProfessionalId: pro.id });
  expect((await updateContactProfile(rita, { name: "Rita Souza", birthday: "17/10/1990" }, ana)).changed).toEqual([]);
  expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, rita), eq(auditLog.action, "atualizou_contato")))).toHaveLength(1);
});

it("aniversário que não existe, e-mail inválido e profissional apagada: erro claro e nada muda", async () => {
  await expect(updateContactProfile(rita, { birthday: "31/02" }, ana)).rejects.toThrow("Data de aniversário inválida.");
  await expect(updateContactProfile(rita, { email: "rita@" }, ana)).rejects.toBeInstanceOf(UserFacingError);
  await expect(updateContactProfile(rita, { preferredProfessionalId: "00000000-0000-4000-8000-000000000000" }, ana)).rejects.toThrow("Essa profissional não existe mais.");
  await expect(updateContactProfile(rita, { alertNotes: "x".repeat(301) }, ana)).rejects.toThrow("Use até 300 caracteres.");
  expect(await contato()).toMatchObject({ birthDay: null, email: null, preferredProfessionalId: null, alertNotes: null });
});

it("vazio apaga: aniversário, anotações e a escolha da profissional (volta para a calculada)", async () => {
  const [pro] = await db.insert(professionals).values({ name: "LUANA" }).returning();
  await updateContactProfile(rita, { birthday: "05/03", notes: "x", preferredProfessionalId: pro.id }, ana);
  await updateContactProfile(rita, { birthday: "", notes: "  ", preferredProfessionalId: "" }, ana);
  expect(await contato()).toMatchObject({ birthDay: null, birthMonth: null, birthYear: null, notes: null, preferredProfessionalId: null });
});

it("Lembrar: combinado de retorno no dia previsto às 10h para quem pediu; sem conversa aberta fica só no contato", async () => {
  const r = await remindReturn(rita, { dueOn: "2026-11-02" }, ana, NOW);
  expect(r.dueAt.toISOString()).toBe("2026-11-02T13:00:00.000Z");
  const [t] = await db.select().from(tasks).where(eq(tasks.id, r.taskId));
  expect(t).toMatchObject({ kind: "retorno", dealId: null, contactId: rita, assigneeId: ana, title: "Chamar Rita para voltar (prevista 02/11)" });
});

it("Lembrar com conversa aberta: a tarefa fica na conversa; data que já passou é recusada", async () => {
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [d] = await db.insert(deals).values({ contactId: rita, stageId: lead.id }).returning();
  const r = await remindReturn(rita, { dueOn: null }, ana, NOW);
  expect(r.dueAt.toISOString()).toBe("2026-10-16T13:00:00.000Z"); // sem previsão: amanhã 10h
  expect((await db.select().from(tasks).where(eq(tasks.id, r.taskId)))[0].dealId).toBe(d.id);
  await expect(remindReturn(rita, { dueAt: new Date("2026-10-01T13:00:00Z") }, ana, NOW)).rejects.toThrow("Essa data já passou");
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/contact-profile.test.ts`
Esperado: FAIL ("Failed to resolve import ./contact-profile").

- [ ] **Passo 3: `src/server/domain/contact-profile.ts`**

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, contacts, professionals } from "../db/schema";
import { UserFacingError } from "./errors";
import { parseBirthday } from "../../lib/birthday";

export const ALERT_NOTES_MAX = 300;
export const contactProfileSchema = z.object({
  name: z.string().max(120, "Use até 120 caracteres.").nullable().optional(),
  email: z.union([z.string().trim().email("E-mail inválido."), z.literal(""), z.null()]).optional(),
  birthday: z.string().nullable().optional(),
  notes: z.string().max(4000, "Use até 4.000 caracteres.").nullable().optional(),
  alertNotes: z.string().max(ALERT_NOTES_MAX, `Use até ${ALERT_NOTES_MAX} caracteres.`).nullable().optional(),
  preferredProfessionalId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
});
export type ContactProfilePatch = z.input<typeof contactProfileSchema>;

const LABEL: Record<string, string> = {
  name: "Nome", email: "E-mail", birthday: "Aniversário", notes: "Anotações", alertNotes: "Avisos fixos", preferredProfessionalId: "Profissional preferida",
};
const blank = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

/**
 * Edição na própria ficha (Lote 2): nome, e-mail, aniversário, anotações, avisos fixos e profissional preferida.
 * Grava só o que mudou e registra na auditoria (`atualizou_contato`). Vazio apaga; profissional vazia volta para a calculada.
 */
export async function updateContactProfile(contactId: string, raw: ContactProfilePatch, userId: string): Promise<{ changed: string[] }> {
  const parsed = contactProfileSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Dado inválido.");
  const p = parsed.data;
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const set: Partial<typeof contacts.$inferInsert> = {};
    const changed: string[] = [];
    const put = (field: string, patch: Partial<typeof contacts.$inferInsert>) => { Object.assign(set, patch); changed.push(field); };
    if (p.name !== undefined && blank(p.name) !== c.name) put("name", { name: blank(p.name) });
    if (p.email !== undefined && blank(p.email) !== c.email) put("email", { email: blank(p.email) });
    if (p.notes !== undefined && blank(p.notes) !== c.notes) put("notes", { notes: blank(p.notes) });
    if (p.alertNotes !== undefined && blank(p.alertNotes) !== c.alertNotes) put("alertNotes", { alertNotes: blank(p.alertNotes) });
    if (p.birthday !== undefined) {
      const text = blank(p.birthday);
      if (!text) { if (c.birthDay != null) put("birthday", { birthDay: null, birthMonth: null, birthYear: null }); }
      else {
        const b = parseBirthday(text);
        if (!b.ok) throw new UserFacingError(b.error);
        if (b.day !== c.birthDay || b.month !== c.birthMonth || b.year !== c.birthYear) put("birthday", { birthDay: b.day, birthMonth: b.month, birthYear: b.year });
      }
    }
    if (p.preferredProfessionalId !== undefined) {
      const id = p.preferredProfessionalId || null;
      if (id && !(await tx.select({ id: professionals.id }).from(professionals).where(eq(professionals.id, id))).length) throw new UserFacingError("Essa profissional não existe mais.");
      if (id !== c.preferredProfessionalId) put("preferredProfessionalId", { preferredProfessionalId: id });
    }
    if (!changed.length) return { changed };
    await tx.update(contacts).set(set).where(eq(contacts.id, contactId));
    await tx.insert(auditLog).values({ userId, action: "atualizou_contato", entity: "contact", entityId: contactId, data: { campos: changed.map((k) => LABEL[k] ?? k) } });
    return { changed };
  });
}
```

- [ ] **Passo 4: `src/server/domain/suggested-return.ts` (o "Lembrar")**

```ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals } from "../db/schema";
import { createTaskTx } from "./tasks";
import { emit } from "./events";
import { UserFacingError } from "./errors";
import { bahiaDay, reminderDueAt, shortDay } from "../../lib/client-rhythm";
import { clientFirstName } from "../../lib/attempts";

/** Marca no evento da tarefa criada pelo "Lembrar" do bloco Retorno sugerido. */
export const REMIND_META = { origem: "lembrar_retorno" } as const;

/**
 * "Lembrar" (ficha › Retorno sugerido): um combinado do tipo "retorno" para quem tocou, no dia previsto às 10h (já passou ou sem
 * previsão: amanhã 10h) ou na data escolhida. Com conversa aberta, a tarefa fica nela; sem, fica só no contato (aparece no Hoje e
 * abre a ficha). Nunca envia mensagem.
 */
export async function remindReturn(contactId: string, input: { dueAt?: Date | null; dueOn?: string | null }, userId: string, now = new Date()): Promise<{ taskId: string; dueAt: Date }> {
  const dueAt = input.dueAt ?? reminderDueAt(input.dueOn ?? null, now.getTime());
  if (dueAt.getTime() <= now.getTime()) throw new UserFacingError("Essa data já passou. Escolha outra.");
  const t = await db.transaction(async (tx) => {
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, contactId));
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const [open] = await tx.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt))).limit(1);
    const title = `Chamar ${clientFirstName(c.name)} para voltar${input.dueOn ? ` (prevista ${shortDay(input.dueOn, bahiaDay(now.getTime()))})` : ""}`;
    return createTaskTx(tx, { dealId: open?.id ?? null, contactId, kind: "retorno", title, dueAt, assigneeId: userId, meta: { ...REMIND_META } }, userId);
  });
  await emit("lead_atualizado", { dealId: t.dealId ?? undefined });
  return { taskId: t.id, dueAt: t.dueAt };
}
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/contact-profile.test.ts`
Esperado: PASS.

- [ ] **Passo 6: Ações da ficha**

No fim de `src/app/(app)/contatos/actions.ts` (imports novos: `updateContactProfile, type ContactProfilePatch` de `@/server/domain/contact-profile`; `addTag, removeTag` de `@/server/domain/tags`; `remindReturn` de `@/server/domain/suggested-return`):

```ts
/** Edição na própria ficha (nome, e-mail, aniversário, anotações, avisos fixos, profissional preferida). Toda a equipe que vê Contatos. */
export async function updateContactProfileAction(contactId: string, patch: ContactProfilePatch): Promise<ActionResult<{ changed: string[] }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const r = await updateContactProfile(uuid.parse(contactId), patch, user.id);
    refresh(contactId);
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível salvar. Tente de novo."); }
}

/** Etiquetas na ficha (as mesmas da conversa: ficam na cliente). */
export async function addContactTagAction(contactId: string, name: string): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const tag = await addTag(uuid.parse(contactId), z.string().max(200).parse(name), user.id);
    refresh(contactId);
    return { ok: true, data: tag };
  } catch (e) { return safe(e, "Não foi possível pôr a etiqueta. Tente de novo."); }
}
export async function removeContactTagAction(contactId: string, tagId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("contatos.ver");
    await removeTag(uuid.parse(contactId), uuid.parse(tagId), user.id);
    refresh(contactId);
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível tirar a etiqueta. Tente de novo."); }
}

/** "Lembrar" do Retorno sugerido: um combinado para quem tocou (nunca envia mensagem). */
export async function remindReturnAction(contactId: string, input: { dueAt?: string | null; dueOn?: string | null }): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const v = z.object({ dueAt: z.string().datetime({ offset: true }).nullable().optional(), dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(input);
    const r = await remindReturn(uuid.parse(contactId), { dueAt: v.dueAt ? new Date(v.dueAt) : null, dueOn: v.dueOn ?? null }, user.id);
    refresh(contactId);
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível criar o lembrete. Tente de novo."); }
}

/** "Agendar" da ficha: abre (ou reaproveita) a conversa e já abre a folha Agendar. Não envia nada. */
export async function scheduleFromContactAction(contactId: string): Promise<ActionResult> {
  let dealId: string;
  try {
    const user = await assertPerm("contatos.ver");
    ({ dealId } = await startConversation(uuid.parse(contactId), user.id));
    refresh(contactId);
  } catch (e) { return safe(e, "Não foi possível abrir a conversa para agendar. Tente de novo."); }
  redirect(`/atendimento/${dealId}?agendar=1`);
}
```

- [ ] **Passo 7: Etiquetas pela ficha (`tags-editor.tsx`)**

Trocar a assinatura e as duas chamadas:

```tsx
import { addContactTagAction, removeContactTagAction } from "@/app/(app)/contatos/actions";
// …
/** Na conversa usa `dealId`; na ficha da cliente, `contactId`. As etiquetas ficam sempre na cliente. */
export function TagsEditor({ dealId, contactId, tags, options }: { dealId?: string; contactId?: string; tags: Tag[]; options: string[] }) {
```

Dentro de `add`: `const r = contactId ? await addContactTagAction(contactId, name) : await addTagAction(dealId!, name);`
Dentro de `remove`: `const r = contactId ? await removeContactTagAction(contactId, t.id) : await removeTagAction(dealId!, t.id);`

- [ ] **Passo 8: `?agendar=1` abre a folha Agendar**

Em `src/app/(app)/atendimento/[id]/page.tsx`, trocar a linha 28 por:

```tsx
  const sp = await searchParams;
  const compose = sp.compose === "1"; // vindo de "Iniciar conversa": o cursor já abre no campo de mensagem
  const agendar = sp.agendar === "1"; // vindo do "Agendar" da ficha: a folha Agendar já abre
```

e passar `openSchedule={agendar}` ao `<ConversationPane … focusComposer={compose} />`.

Em `src/components/queue/conversation-pane.tsx`, na assinatura (linhas 82-86) acrescentar `openSchedule` aos parâmetros e ao tipo:

```tsx
  /** Abre a folha Agendar assim que os dados chegam (vindo do "Agendar" da ficha da cliente). */
  openSchedule?: boolean;
```

e logo depois de `const actions = useLeadActions({ d: detail, name, viewer, reload: load });`:

```tsx
  // "Agendar" da ficha (?agendar=1): abre a folha uma vez, quando o lead carregou.
  const scheduleOpened = useRef(false);
  useEffect(() => {
    if (!openSchedule || scheduleOpened.current || !detail) return;
    scheduleOpened.current = true;
    actions.open("schedule");
  }, [openSchedule, detail, actions]);
```

(`useRef` e `useEffect` já estão importados na linha 2.) O e2e da Tarefa 8 confere o caminho inteiro (ficha → Agendar → folha aberta).

- [ ] **Passo 9: Verde e commit**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

```bash
git add src/server/domain/contact-profile.ts src/server/domain/contact-profile.test.ts src/server/domain/suggested-return.ts \
  "src/app/(app)/contatos/actions.ts" src/components/queue/tags-editor.tsx "src/app/(app)/atendimento/[id]/page.tsx" src/components/queue/conversation-pane.tsx
git commit -m "feat(ficha): editar nome, e-mail, aniversário, anotações, avisos fixos, preferida e etiquetas na ficha; Lembrar e Agendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 7: Anotações num campo só (a conversa grava no contato; script junta as 109)

**Files:**
- Create: `src/lib/notes-merge.ts`, `src/lib/notes-merge.test.ts`
- Create: `src/server/domain/notes-merge.ts`, `src/server/domain/notes-merge.test.ts`
- Create: `scripts/unificar-anotacoes.ts`
- Modify: `src/server/domain/updates.ts:18-40` (`dealPatchSchema`), `:60-62` (`contactSet`), `:88-91` (`before`)
- Modify: `src/lib/field-labels.ts:3` (rótulo `notes`)
- Modify: `src/components/lead/lead-sheet.tsx:51` (campo "Observações" da conversa)
- Modify: `src/components/queue/client-pane.tsx` (linha do `d.deal.observations` no `WhoIs`; `grep -n "d.deal.observations" src/components/queue/client-pane.tsx`)
- Test: `src/server/domain/updates.test.ts` (um teste a mais)

**Interfaces:**
- Consumes: `updateDealTx`/`updateDeal` (existentes), `auditLog`.
- Produces:
  - `mergeNotes(current: string | null, items: { at: string; text: string }[]): { text: string | null; added: number }`;
  - `type NotesPlanRow = { contactId: string; name: string | null; before: string | null; after: string | null; added: number; items: { at: string; text: string }[] }`;
  - `planNotesMerge(): Promise<NotesPlanRow[]>`, `applyNotesMerge(backupFile: string): Promise<{ updated: number; backup: string }>`, `restoreNotesMerge(backupFile: string): Promise<{ restored: number }>`;
  - `DealPatch.notes?: string | null` (grava em `contacts.notes`); o campo da conversa passa a ser "Anotações da cliente";
  - CLI `npx tsx scripts/unificar-anotacoes.ts --dry-run | --aplicar [--backup arq] | --desfazer arq`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/lib/notes-merge.test.ts`:

```ts
import { expect, it } from "vitest";
import { mergeNotes } from "./notes-merge";

it("junta as anotações dos leads na ordem das conversas, com o dia, sem apagar o que já havia", () => {
  const r = mergeNotes("Cliente desde 2020.", [
    { at: "2026-10-14T13:00:00Z", text: "Quer luzes" },
    { at: "2026-09-01T13:00:00Z", text: "Alérgica a amônia" },
  ]);
  expect(r).toEqual({ added: 2, text: "Cliente desde 2020.\n\n— Anotação da conversa de 01/09/2026 —\nAlérgica a amônia\n\n— Anotação da conversa de 14/10/2026 —\nQuer luzes" });
});
it("idempotente: rodar de novo não repete; texto vazio não entra; sem nada, continua null", () => {
  const once = mergeNotes(null, [{ at: "2026-10-14T13:00:00Z", text: " Quer luzes " }]);
  expect(mergeNotes(once.text, [{ at: "2026-10-14T13:00:00Z", text: "Quer luzes" }])).toEqual({ text: once.text, added: 0 });
  expect(mergeNotes(null, [{ at: "2026-10-14T13:00:00Z", text: "   " }])).toEqual({ text: null, added: 0 });
});
```

`src/server/domain/notes-merge.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db";
import { contacts, deals, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyNotesMerge, planNotesMerge, restoreNotesMerge } from "./notes-merge";

let rita = "";
beforeEach(async () => {
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000301", notes: "Antiga" }).returning())[0].id;
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values([
    { contactId: rita, stageId: fechado.id, closedAt: new Date("2026-09-02T13:00:00Z"), createdAt: new Date("2026-09-01T13:00:00Z"), observations: "Alérgica a amônia" },
    { contactId: rita, stageId: lead.id, createdAt: new Date("2026-10-14T13:00:00Z"), observations: "Quer luzes" },
  ]);
});
const notas = async () => (await db.select({ n: contacts.notes }).from(contacts).where(eq(contacts.id, rita)))[0].n;

it("ensaio não grava; aplicar grava com backup; de novo não repete; desfazer volta ao texto de antes", async () => {
  const plano = await planNotesMerge();
  expect(plano).toHaveLength(1);
  expect(plano[0]).toMatchObject({ contactId: rita, before: "Antiga", added: 2 });
  expect(await notas()).toBe("Antiga");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "anotacoes-")), "antes.json");
  expect(await applyNotesMerge(file)).toMatchObject({ updated: 1 });
  expect(await notas()).toContain("— Anotação da conversa de 14/10/2026 —\nQuer luzes");
  expect(JSON.parse(readFileSync(file, "utf8")).rows).toEqual([{ contactId: rita, before: "Antiga" }]);
  expect(await planNotesMerge()).toEqual([]);
  expect(await restoreNotesMerge(file)).toEqual({ restored: 1 });
  expect(await notas()).toBe("Antiga");
});
```

Em `src/server/domain/updates.test.ts`, no fim:

```ts
it("anotações da conversa ficam no contato (campo único da ficha) e entram no histórico como 'notes'", async () => {
  const id = await lead();
  await updateDeal(id, { notes: "Prefere horário cedo" }, ana);
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  const [c] = await db.select().from(contacts).where(eq(contacts.id, d.contactId));
  expect(c.notes).toBe("Prefere horário cedo");
  expect(d.observations).toBeNull();
  const ev = (await db.select().from(dealEvents).where(eq(dealEvents.type, "campo_alterado"))).at(-1)!;
  expect(ev.payload).toEqual({ campos: [{ campo: "notes", de: null, para: "Prefere horário cedo" }] });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/notes-merge.test.ts src/server/domain/notes-merge.test.ts src/server/domain/updates.test.ts`
Esperado: FAIL (imports inexistentes; `notes` não é campo do `DealPatch`).

- [ ] **Passo 3: `src/lib/notes-merge.ts`**

```ts
/**
 * Junta as anotações que estavam presas nos leads ao campo único do contato (Lote 2). Idempotente: texto que já está lá não entra
 * de novo. Cada uma entra com o dia da conversa, da mais antiga para a mais nova, depois do que o contato já tinha.
 */
export function mergeNotes(current: string | null, items: { at: string; text: string }[]): { text: string | null; added: number } {
  let text = current?.trim() ?? "";
  let added = 0;
  for (const it of [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const body = it.text.trim();
    if (!body || text.includes(body)) continue;
    const day = new Date(it.at).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
    text = `${text}${text ? "\n\n" : ""}— Anotação da conversa de ${day} —\n${body}`;
    added++;
  }
  return { text: text || null, added };
}
```

- [ ] **Passo 4: `src/server/domain/notes-merge.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts } from "../db/schema";
import { mergeNotes } from "../../lib/notes-merge";

export type NotesPlanRow = { contactId: string; name: string | null; before: string | null; after: string | null; added: number; items: { at: string; text: string }[] };
type Backup = { createdAt: string; rows: { contactId: string; before: string | null }[] };

/** Ensaio: quem tem anotação presa em lead e como o campo do contato fica. Não grava nada. */
export async function planNotesMerge(): Promise<NotesPlanRow[]> {
  const rows = (await db.execute(sql`
    select d.contact_id as "contactId", c.name, c.notes, d.created_at as at, d.observations as text
      from deals d join contacts c on c.id = d.contact_id
     where nullif(trim(d.observations), '') is not null
     order by d.contact_id, d.created_at`)).rows as { contactId: string; name: string | null; notes: string | null; at: string | Date; text: string }[];
  const by = new Map<string, NotesPlanRow>();
  for (const r of rows) {
    const row = by.get(r.contactId) ?? { contactId: r.contactId, name: r.name, before: r.notes, after: null, added: 0, items: [] };
    row.items.push({ at: new Date(r.at).toISOString(), text: r.text });
    by.set(r.contactId, row);
  }
  const out: NotesPlanRow[] = [];
  for (const row of by.values()) {
    const m = mergeNotes(row.before, row.items);
    if (m.added) out.push({ ...row, after: m.text, added: m.added });
  }
  return out;
}

/** Aplica com backup (o texto de antes de cada contato, lido já travado) e auditoria. Rodar de novo não repete nada. */
export async function applyNotesMerge(backupFile: string): Promise<{ updated: number; backup: string }> {
  const plan = await planNotesMerge();
  let updated = 0;
  await db.transaction(async (tx) => {
    const before: Backup["rows"] = [];
    for (const r of plan) {
      const [c] = await tx.select({ notes: contacts.notes }).from(contacts).where(eq(contacts.id, r.contactId)).for("update");
      if (c) before.push({ contactId: r.contactId, before: c.notes });
    }
    writeFileSync(backupFile, JSON.stringify({ createdAt: new Date().toISOString(), rows: before } satisfies Backup, null, 2));
    for (const r of plan) {
      const cur = before.find((b) => b.contactId === r.contactId);
      if (!cur) continue;
      const m = mergeNotes(cur.before, r.items);
      if (!m.added) continue;
      await tx.update(contacts).set({ notes: m.text }).where(eq(contacts.id, r.contactId));
      updated++;
    }
    await tx.insert(auditLog).values({ userId: null, action: "juntou_anotacoes", entity: "contacts", data: { contatos: updated, backup: backupFile } });
  });
  return { updated, backup: backupFile };
}

/** Desfaz com o backup: cada contato volta ao texto de antes. */
export async function restoreNotesMerge(backupFile: string): Promise<{ restored: number }> {
  const b = JSON.parse(readFileSync(backupFile, "utf8")) as Backup;
  let restored = 0;
  await db.transaction(async (tx) => {
    for (const r of b.rows) restored += (await tx.update(contacts).set({ notes: r.before }).where(eq(contacts.id, r.contactId)).returning({ id: contacts.id })).length;
    await tx.insert(auditLog).values({ userId: null, action: "desfez_juntar_anotacoes", entity: "contacts", data: { contatos: restored, backup: backupFile } });
  });
  return { restored };
}
```

- [ ] **Passo 5: A conversa grava no contato**

`src/server/domain/updates.ts`:
- em `dealPatchSchema`, logo depois de `observations`: `notes: z.string().max(4000).nullable().optional(),` com o comentário `/** Anotações da cliente (campo único do contato, Lote 2). `observations` fica só para o código antigo. */`;
- logo depois da linha `if (patch.instagram !== undefined) …`: `if (patch.notes !== undefined) contactSet.notes = patch.notes?.trim() ? patch.notes.trim() : null;`
- no objeto `before`, junto de `name: contact.name, …`: acrescentar `notes: contact.notes,`.

`src/lib/field-labels.ts`, linha 3: acrescentar `notes: "Anotações",` depois de `observations: "Observações",`.

`src/components/lead/lead-sheet.tsx:51`:

```tsx
    <AutoField dealId={d.deal.id} name="notes" label="Anotações da cliente" kind="textarea" value={d.contact.notes ?? ""} placeholder="Vale para todas as conversas dela e aparece na ficha…" />
```

`src/components/queue/client-pane.tsx` (no `WhoIs`), trocar a linha do `d.deal.observations` por:

```tsx
      {d.contact.notes && <p className="whitespace-pre-line rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">{d.contact.notes}</p>}
      {/* Anotação antiga presa nesta conversa, até o script do Lote 2 juntar no contato. */}
      {d.deal.observations && !(d.contact.notes ?? "").includes(d.deal.observations.trim()) && (
        <p className="whitespace-pre-line rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">{d.deal.observations}</p>
      )}
```

- [ ] **Passo 6: Script `scripts/unificar-anotacoes.ts`**

```ts
import "dotenv/config";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyNotesMerge, planNotesMerge, restoreNotesMerge } from "../src/server/domain/notes-merge";

/**
 * Lote 2: junta no contato as anotações presas nos leads (auditoria de 15/10: 109 leads).
 *   --dry-run (padrão)            mostra quem muda e não grava
 *   --aplicar [--backup arquivo]  grava (backup JSON antes; padrão em $BACKUP_DIR ou na pasta atual) e confere no fim
 *   --desfazer arquivo            volta cada contato ao texto do backup
 * Nunca envia mensagem. `deals.observations` não é apagado.
 */
async function main() {
  const a = process.argv.slice(2);
  const undo = a.indexOf("--desfazer");
  if (undo >= 0) {
    const r = await restoreNotesMerge(a[undo + 1]);
    console.log(`Desfeito: ${r.restored} contatos voltaram ao texto de antes.`);
    return;
  }
  const plan = await planNotesMerge();
  console.table(plan.map((r) => ({ contato: r.name ?? r.contactId, anotacoes: r.added, antes: (r.before ?? "").length, depois: (r.after ?? "").length })));
  console.log(`${plan.length} contatos, ${plan.reduce((n, r) => n + r.added, 0)} anotações para juntar.`);
  if (!a.includes("--aplicar")) { console.log("ENSAIO: nada foi gravado. Para gravar: --aplicar"); return; }
  const b = a.indexOf("--backup");
  const file = b >= 0 ? a[b + 1] : path.join(process.env.BACKUP_DIR ?? ".", `anotacoes-${new Date().toISOString().slice(0, 10)}-antes.json`);
  const r = await applyNotesMerge(file);
  console.log(`Gravado: ${r.updated} contatos. Backup: ${r.backup}`);
  const left = await planNotesMerge();
  console.log(left.length ? `Conferência: ${left.length} contatos ainda com anotação de fora (rode o ensaio e veja).` : "Conferência: nada pendente.");
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/lib/notes-merge.test.ts src/server/domain/notes-merge.test.ts src/server/domain/updates.test.ts`
Esperado: PASS (os testes antigos com `observations` continuam: o campo segue no schema).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. Se um e2e ou teste de render procurar o rótulo "Observações" do campo da conversa, trocar para "Anotações da cliente" (`grep -rn "Observações" e2e src --include=*.ts*`).

- [ ] **Passo 8: Commit**

```bash
git add src/lib/notes-merge.ts src/lib/notes-merge.test.ts src/server/domain/notes-merge.ts src/server/domain/notes-merge.test.ts scripts/unificar-anotacoes.ts \
  src/server/domain/updates.ts src/server/domain/updates.test.ts src/lib/field-labels.ts src/components/lead/lead-sheet.tsx src/components/queue/client-pane.tsx
git commit -m "feat(ficha): anotações num campo só no contato (a conversa grava nele) e script com ensaio, backup e desfazer para as antigas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 8: A ficha em ordem (`/contatos/[id]`)

**Files:**
- Create: `src/lib/visit-days.ts`, `src/lib/visit-days.test.ts`
- Create: `src/server/queries/contact-visits.ts`
- Create: `src/components/contacts/ficha/blocks.tsx`, `src/components/contacts/ficha/header.tsx`, `src/components/contacts/ficha/editable.tsx`, `src/components/contacts/ficha/return-actions.tsx`, `src/components/contacts/ficha/visits.tsx`
- Modify: `src/server/queries/contact.ts` (campos do contato, `merged` nos leads)
- Modify: `src/server/domain/lid-merge.ts` (evento no lead que sai), `src/server/domain/lid-merge.test.ts`
- Modify (reescrever): `src/app/(app)/contatos/[id]/page.tsx`
- Modify: `e2e/helpers.ts` (`refreshStatsE2E`)
- Create: `e2e/ficha.spec.ts`

**Interfaces:**
- Consumes: T2 (`returnLine`, `displayName`, `bahiaDay`, `SITUATION_STATE_LABEL`, `birthdayLabel`), T5 (`getClientSnapshot`, `ClientSnapshot`), T6 (`updateContactProfileAction`, `remindReturnAction`, `scheduleFromContactAction`, `TagsEditor` com `contactId`), existentes (`getContact`, `getContactAvecData`, `ClientPackages`, `UpcomingAppointments`, `ContactTimeline`, `buildTimeline`, `StartConversation`, `BackToClient`, `listTags`, `tagsOf`, `listProfessionals`, `stripSignature` do 1A).
- Produces:
  - `type VisitAppointment`, `type VisitItem`, `type VisitDay = { day: string; future: boolean; appointments: VisitAppointment[]; items: VisitItem[]; totalCents: number | null }`, `VISIT_STATUS_LABEL`, `mergeVisitDays(appts, items, today): VisitDay[]`;
  - `VISITS_LIMIT = 300`, `getContactVisits(contactId: string, opts: { withValues: boolean; now?: Date }): Promise<VisitDay[]>`;
  - `ContactDeal.merged: boolean`; `getContact(...).contact` ganha `birthDay`, `birthMonth`, `birthYear`, `alertNotes`, `preferredProfessionalId`;
  - componentes `FichaHeader`, `SituationBlock`, `NowBlock`, `ReturnBlock`, `NumbersBlock`, `PreferencesBlock`, `FinanceBlock`, `NotesBlock`, `ConversationBlock`, `LeadsBlock`, `VisitsBlock`, `ProfileField`, `ReturnActions`;
  - cada bloco tem `data-bloco` (situacao, agora, proximos, retorno, numeros, preferencias, pacotes, visitas, financeiro, anotacoes, conversa, leads) para o e2e conferir a ordem;
  - `refreshStatsE2E()` em `e2e/helpers.ts`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/lib/visit-days.test.ts`:

```ts
import { expect, it } from "vitest";
import { mergeVisitDays } from "./visit-days";

it("horário e comanda do mesmo dia numa linha só; futuros primeiro (o mais perto em cima), depois os passados (o mais recente)", () => {
  const days = mergeVisitDays(
    [
      { id: "a1", startsAt: "2026-09-10T13:00:00Z", status: "compareceu", serviceLabel: "Escova", professionalName: "MAIARA", notes: "Gosta de água morna" },
      { id: "a2", startsAt: "2026-10-20T17:00:00Z", status: "agendado", serviceLabel: "Corte", professionalName: null, notes: null },
      { id: "a3", startsAt: "2026-11-02T13:00:00Z", status: "confirmado", serviceLabel: "Escova", professionalName: null, notes: null },
    ],
    [
      { id: "i1", soldOn: "2026-09-10", item: "Escova", professionalName: "MAIARA", totalCents: 12_000, fromPackage: false },
      { id: "i2", soldOn: "2026-09-10", item: "Hidratação", professionalName: "MAIARA", totalCents: 8_000, fromPackage: true },
      { id: "i3", soldOn: "2026-08-01", item: "Corte", professionalName: null, totalCents: null, fromPackage: false },
    ],
    "2026-10-15",
  );
  expect(days.map((d) => [d.day, d.future])).toEqual([["2026-10-20", true], ["2026-11-02", true], ["2026-09-10", false], ["2026-08-01", false]]);
  expect(days[2]).toMatchObject({ totalCents: 20_000 });
  expect(days[2].appointments[0].notes).toBe("Gosta de água morna");
  expect(days[3].totalCents).toBeNull(); // sem valor (quem não vê valores recebe null)
});
```

Em `src/server/domain/lid-merge.test.ts`, um teste novo (use os ajudantes que o arquivo já tem para criar o contato oculto com conversa aberta e o contato com número com conversa aberta; ache com `grep -n "^it(\|async function\|const .* = async" src/server/domain/lid-merge.test.ts`):

```ts
it("a conversa do número oculto que sai na junção fica marcada como mesclada (não como 'Não é cliente')", async () => {
  // dois contatos, cada um com conversa aberta: o oculto (lid) e o do número; depois juntar
  const hidden = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "lid:998877", waLid: "998877" }).returning())[0];
  const real = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000401" }).returning())[0];
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [h] = await db.insert(deals).values({ contactId: hidden.id, stageId: lead.id }).returning();
  await db.insert(deals).values({ contactId: real.id, stageId: lead.id });
  await mergeLidInto("998877", "+5571966000401");
  const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, h.id), eq(dealEvents.type, "contato_mesclado")));
  expect(ev).toHaveLength(1);
  const ficha = await getContact(real.id);
  expect(ficha!.deals.find((x) => x.id === h.id)).toMatchObject({ archived: true, merged: true });
});
```

(Imports que faltarem no arquivo: `and`, `eq` de `drizzle-orm`; `contacts`, `dealEvents`, `deals`, `stages` do schema; `getContact` de `../queries/contact`.)

`e2e/ficha.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, refreshStatsE2E } from "./helpers";

/** Lote 2: a ficha em ordem, a frase de situação, o retorno sugerido, a edição na própria ficha, Lembrar, Agendar, dinheiro só para a gestão. */
const fone = (i: number) => `+557199977${String(i).padStart(4, "0")}`;
const digitado = (i: number) => `71 99977-${String(i).padStart(4, "0")}`;
const contactId = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199977%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

/** Cliente com 4 visitas a cada 50 dias (Avec), a última há 50 dias com observação, e uma Dívida lançada. */
async function clienteDoAvec(page: Page, i: number) {
  await simulate(page, { phone: digitado(i), name: `Rosa${i} Fictícia`, text: "Oi, queria marcar" });
  const id = await contactId(fone(i));
  await e2eSql("insert into professionals (name) select 'MAIARA E2E' where not exists (select 1 from professionals where name = 'MAIARA E2E')");
  const [pro] = await e2eSql("select id from professionals where name = 'MAIARA E2E'");
  for (const [k, n] of [200, 150, 100, 50].entries())
    await e2eSql(`insert into sales_items (contact_id, sold_on, comanda, item, kind, professional_id, professional_name, total_cents, external_key)
      values ($1, ((now() at time zone 'America/Bahia')::date - $2::int), $3, 'Escova', 'servico', $4, 'MAIARA E2E', 15000, $5)
      on conflict do nothing`, [id, n, `e2e-${i}-${k}`, pro.id, `e2e:ficha:${i}:${k}`]);
  await e2eSql(`insert into appointments (contact_id, starts_at, status, service_label, notes, external_key)
    values ($1, now() - interval '50 days', 'compareceu', 'Escova', 'Gosta de água morna', $2) on conflict do nothing`, [id, `e2e:ficha:${i}:ap`]);
  await e2eSql(`insert into sales_payments (contact_id, comanda, paid_on, method, value_cents, external_key)
    values ($1, 'e2e-div', (now() - interval '50 days')::date, 'Dívida', 3000, $2) on conflict do nothing`, [id, `e2e:ficha:${i}:p`]);
  refreshStatsE2E();
  return id;
}

test("ficha em ordem: frase, retorno, números, preferências, visitas com observação, dívida e edição na própria ficha", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 1);
  await page.goto(`/contatos/${id}`);
  const ordem = await page.locator("[data-bloco]").evaluateAll((els) => els.map((e) => e.getAttribute("data-bloco")));
  expect(ordem).toEqual(["situacao", "agora", "proximos", "retorno", "numeros", "preferencias", "pacotes", "visitas", "financeiro", "anotacoes", "conversa", "leads"]);
  await expect(page.getByTestId("frase-situacao")).toContainText("última visita há 50 dias");
  await expect(page.locator('[data-bloco="retorno"]')).toContainText("Volta a cada ~50 dias");
  await expect(page.locator('[data-bloco="numeros"]')).toContainText("4");
  await expect(page.locator('[data-bloco="preferencias"]')).toContainText("Calculada: 100% dos serviços com Maiara E2e");
  await expect(page.locator('[data-bloco="visitas"]')).toContainText("Gosta de água morna");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Dívida lançada no Avec: R$ 30,00");

  const aniversario = page.getByLabel("Aniversário");
  await aniversario.fill("17/10");
  await aniversario.blur();
  await expect(page.getByText("salvo").first()).toBeVisible();
  const avisos = page.getByRole("textbox", { name: "Avisos fixos" }); // a lista do topo também se chama "Avisos fixos"
  await avisos.fill("Alérgica a amônia");
  await avisos.blur();
  await page.reload();
  await expect(page.getByLabel("Aniversário")).toHaveValue("17/10");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Alérgica a amônia");

  await page.getByRole("button", { name: /^Lembrar/ }).first().click();
  await expect(page.getByText(/Lembrete criado/)).toBeVisible();
  await page.getByRole("button", { name: "Agendar" }).click();
  await expect(page).toHaveURL(new RegExp(`/atendimento/[0-9a-f-]+\\?agendar=1`));
  await expect(page.getByRole("dialog")).toBeVisible(); // a folha Agendar abriu sozinha
});

test("atendente: vê visitas e faltas, mas nenhum R$ (só 'Tem dívida lançada no Avec')", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  const id = await clienteDoAvec(page, 2);
  await login(page, "ana@e2e.local");
  await page.goto(`/contatos/${id}`);
  await expect(page.locator('[data-bloco="numeros"]')).toContainText("Visitas");
  await expect(page.getByRole("list", { name: "Avisos fixos" })).toContainText("Tem dívida lançada no Avec");
  await expect(page.locator("main")).not.toContainText("R$");
  await expect(page.locator('[data-bloco="financeiro"]')).toHaveCount(0);
});

test("Leads: 'Mesclado (mesmo número)' separado de 'Não é cliente'", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  await simulate(page, { phone: digitado(3), name: "Lia Fictícia", text: "Oi" });
  const id = await contactId(fone(3));
  // um lead que saiu na junção do número oculto (sem pessoa e sem o evento "arquivado") e um "Não é cliente" (com o evento)
  await e2eSql(`insert into deals (contact_id, stage_id, archived_at, created_at) select $1, s.id, now(), now() - interval '20 days' from stages s where s.key = 'lead'`, [id]);
  const [ign] = await e2eSql(`insert into deals (contact_id, stage_id, archived_at, created_at) select $1, s.id, now(), now() - interval '10 days' from stages s where s.key = 'lead' returning id`, [id]);
  await e2eSql(`insert into deal_events (deal_id, type, payload) values ($1, 'arquivado', '{}')`, [ign.id]);
  await page.goto(`/contatos/${id}`);
  const leads = page.locator('[data-bloco="leads"]');
  await expect(leads).toContainText("Mesclado (mesmo número)");
  await expect(leads).toContainText("Não é cliente");
});
```

Em `e2e/helpers.ts`, depois de `ageLead`:

```ts
/** Refaz a visão por contato (Lote 2) no banco de e2e com o mesmo script de produção (`--aplicar`). Nunca a Evolution real. */
export function refreshStatsE2E() {
  execSync("npx tsx scripts/visao-contatos.ts --aplicar", { stdio: "inherit", env: { ...process.env, DATABASE_URL: e2eUrl(), EVOLUTION_URL: "http://127.0.0.1:9" } });
}
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/visit-days.test.ts src/server/domain/lid-merge.test.ts`
Esperado: FAIL ("./visit-days" não existe; o evento `contato_mesclado` não está no lead que sai; `merged` indefinido).

Rodar: `npx playwright test e2e/ficha.spec.ts --project=desktop` (com `E2E_PORT` definido)
Esperado: FAIL (os blocos e o `data-bloco` ainda não existem).

- [ ] **Passo 3: `src/lib/visit-days.ts`**

```ts
import { bahiaDay } from "./client-rhythm";

/** Visitas da ficha (Lote 2): horários (Avec ou CRM) e itens de comanda do mesmo dia numa linha só. Puro. */
export type VisitAppointment = { id: string; startsAt: string; status: string; serviceLabel: string; professionalName: string | null; notes: string | null };
export type VisitItem = { id: string; soldOn: string; item: string; professionalName: string | null; totalCents: number | null; fromPackage: boolean };
export type VisitDay = { day: string; future: boolean; appointments: VisitAppointment[]; items: VisitItem[]; totalCents: number | null };

export const VISIT_STATUS_LABEL: Record<string, string> = {
  agendado: "Marcado", confirmado: "Confirmado", compareceu: "Atendida", faltou: "Faltou", cancelado: "Cancelado",
};

/** Futuros primeiro (o mais perto em cima), depois os passados (o mais recente em cima). Hoje conta como passado. */
export function mergeVisitDays(appts: VisitAppointment[], items: VisitItem[], today: string): VisitDay[] {
  const byDay = new Map<string, VisitDay>();
  const get = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, future: day > today, appointments: [], items: [], totalCents: null }));
    return d;
  };
  for (const a of appts) get(bahiaDay(Date.parse(a.startsAt))).appointments.push(a);
  for (const i of items) {
    const d = get(i.soldOn);
    d.items.push(i);
    if (i.totalCents != null) d.totalCents = (d.totalCents ?? 0) + i.totalCents;
  }
  for (const d of byDay.values()) d.appointments.sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
  const all = [...byDay.values()];
  return [...all.filter((d) => d.future).sort((a, b) => a.day.localeCompare(b.day)), ...all.filter((d) => !d.future).sort((a, b) => b.day.localeCompare(a.day))];
}
```

- [ ] **Passo 4: `src/server/queries/contact-visits.ts`**

```ts
import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, professionals, salesItems } from "../db/schema";
import { mergeVisitDays, type VisitDay } from "../../lib/visit-days";
import { FUTURE_HORIZON_DAYS, bahiaDay } from "../../lib/client-rhythm";
import { isUuid } from "../../lib/uuid";

export const VISITS_LIMIT = 300;

/** Visitas passadas e futuras (até 180 dias) com profissional, situação e a observação do horário; valores só com `withValues`. */
export async function getContactVisits(contactId: string, opts: { withValues: boolean; now?: Date }): Promise<VisitDay[]> {
  if (!isUuid(contactId)) return [];
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + FUTURE_HORIZON_DAYS * 86_400_000);
  const [appts, items] = await Promise.all([
    db.select({ id: appointments.id, startsAt: appointments.startsAt, status: appointments.status, serviceLabel: appointments.serviceLabel, professionalName: professionals.name, notes: appointments.notes })
      .from(appointments).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
      .where(and(eq(appointments.contactId, contactId), ne(appointments.status, "espera"), lte(appointments.startsAt, horizon)))
      .orderBy(desc(appointments.startsAt)).limit(VISITS_LIMIT),
    db.select({
      id: salesItems.id, soldOn: salesItems.soldOn, item: salesItems.item, totalCents: salesItems.totalCents, fromPackage: salesItems.fromPackage,
      professionalName: sql<string | null>`coalesce(${professionals.name}, ${salesItems.professionalName})`,
    }).from(salesItems).leftJoin(professionals, eq(professionals.id, salesItems.professionalId))
      .where(and(eq(salesItems.contactId, contactId), lte(salesItems.soldOn, bahiaDay(horizon.getTime()))))
      .orderBy(desc(salesItems.soldOn)).limit(VISITS_LIMIT),
  ]);
  return mergeVisitDays(
    appts.map((a) => ({ ...a, startsAt: a.startsAt.toISOString() })),
    items.map((i) => ({ ...i, totalCents: opts.withValues ? i.totalCents : null })),
    bahiaDay(now.getTime()),
  );
}
```

- [ ] **Passo 5: `contact.ts` e `lid-merge.ts`**

Em `src/server/queries/contact.ts`:
- no `select` do contato, acrescentar `birthDay: contacts.birthDay, birthMonth: contacts.birthMonth, birthYear: contacts.birthYear, alertNotes: contacts.alertNotes, preferredProfessionalId: contacts.preferredProfessionalId,`;
- no `select` dos leads (`dealRows`), acrescentar:

```ts
      // Lead que saiu na junção do número oculto: arquivado SEM o evento "arquivado" (que só o "Não é cliente" grava).
      merged: sql<boolean>`(${deals.archivedAt} is not null and not exists (select 1 from deal_events ae where ae.deal_id = ${deals.id} and ae.type = 'arquivado'))`,
```

- no tipo `ContactDeal`: `/** Saiu na junção automática do número oculto (não é "Não é cliente"). */ merged: boolean;`
- no `dealsOut`: `merged: !!d.merged,`.

Em `src/server/domain/lid-merge.ts`, dentro do `if (realOpen && hiddenOpen) { … }`, depois do `update(deals).set({ archivedAt: new Date() })`:

```ts
      // O lead que sai fica com o registro da junção (a ficha mostra "Mesclado", não "Não é cliente").
      await logEvent(tx, hiddenOpen.id, "contato_mesclado", { lid, para: realOpen.id });
```

- [ ] **Passo 6: Componentes da ficha**

`src/components/contacts/ficha/editable.tsx`:

```tsx
"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactProfileAction } from "@/app/(app)/contatos/actions";
import type { ContactProfilePatch } from "@/server/domain/contact-profile";

type Kind = "text" | "email" | "textarea" | "birthday" | "select";

/** Campo da ficha que salva sozinho ao sair (ou ao escolher, no select). Mostra "salvo" por um instante e o erro do servidor embaixo. */
export function ProfileField({ contactId, name, label, value, kind = "text", options, placeholder, hint }: {
  contactId: string; name: keyof ContactProfilePatch; label: string; value: string; kind?: Kind;
  options?: { value: string; label: string }[]; placeholder?: string; hint?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (value !== prev) { setPrev(value); setV(value); }

  const save = (next = v) => {
    if (next === value) { setErr(null); return; }
    start(async () => {
      const r = await updateContactProfileAction(contactId, { [name]: next === "" ? null : next } as ContactProfilePatch);
      if (!r.ok) { setErr(r.error); return; }
      setErr(null); setSaved(true); setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  };
  const cls = "w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-base outline-offset-2 disabled:opacity-60 aria-[invalid=true]:border-alert";
  const common = { id, disabled: pending, "aria-invalid": err ? true : undefined, "aria-describedby": err || hint ? `${id}-d` : undefined } as const;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">{label}{saved && <span role="status" className="ml-2 font-medium text-ok">salvo</span>}</label>
      {kind === "textarea" ? (
        <textarea {...common} rows={3} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => save()} className={cls} />
      ) : kind === "select" ? (
        <select {...common} value={v} onChange={(e) => { setV(e.target.value); save(e.target.value); }} className={cls}>
          {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input {...common} type={kind === "email" ? "email" : "text"} inputMode={kind === "birthday" ? "numeric" : undefined} value={v} placeholder={placeholder}
          onChange={(e) => setV(e.target.value)} onBlur={() => save()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className={cls} />
      )}
      {(err || hint) && <p id={`${id}-d`} role={err ? "alert" : undefined} className={err ? "text-sm text-alert" : "text-xs text-muted"}>{err ?? hint}</p>}
    </div>
  );
}
```

`src/components/contacts/ficha/return-actions.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { remindReturnAction, scheduleFromContactAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { bahiaAt, dueLabel } from "@/lib/next-action";

/** Agendar (abre a conversa com a folha Agendar) e Lembrar (um combinado para quem tocou). Nada é enviado à cliente. */
export function ReturnActions({ contactId, dueOn, canSchedule }: { contactId: string; dueOn: string | null; canSchedule: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const agendar = () => start(async () => { const r = await scheduleFromContactAction(contactId); if (r && !r.ok) toast(r.error, "error"); });
  const lembrar = (dueAt?: Date) => start(async () => {
    const r = await remindReturnAction(contactId, dueAt ? { dueAt: dueAt.toISOString() } : { dueOn });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`Lembrete criado para ${dueLabel(Date.parse(r.data!.dueAt), Date.now())}. Aparece no Hoje.`, "ok");
    router.refresh();
  });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {canSchedule && <Button size="sm" onClick={agendar} loading={pending}>Agendar</Button>}
      <Button size="sm" variant="secondary" onClick={() => lembrar()} disabled={pending}>{dueOn ? "Lembrar no dia previsto" : "Lembrar amanhã"}</Button>
      <Button size="sm" variant="ghost" onClick={() => lembrar(bahiaAt(Date.now(), 7, 10))} disabled={pending}>Lembrar em 1 semana</Button>
    </div>
  );
}
```

`src/components/contacts/ficha/blocks.tsx` (componentes de servidor; os campos editáveis e os botões são de cliente):

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ProfileField } from "./editable";
import { ReturnActions } from "./return-actions";
import { SITUATION_STATE_LABEL, type Situation, type SituationState } from "@/lib/client-situation";
import { displayName, returnLine, type ReturnInfo } from "@/lib/client-rhythm";
import { dueLabel } from "@/lib/next-action";
import { formatBRL } from "@/lib/money";
import { brDay } from "@/lib/client-avec";
import { leadHref } from "@/lib/lead-href";
import { stripSignature } from "@/lib/signature";
import type { ClientSnapshot } from "@/server/queries/client-snapshot";
import type { ContactDeal, ContactDetail } from "@/server/queries/contact";
import type { SalePaymentItem } from "@/server/queries/avec";

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-[var(--shadow-card)]";
const H2 = "font-display text-xl font-medium tracking-[-0.01em]";
const LINK = "inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold-ink underline-offset-4 hover:underline lg:min-h-0";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthYear = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]}/${day.slice(0, 4)}`;
const vezes = (n: number) => `${n} ${n === 1 ? "vez" : "vezes"}`;

export function Card({ id, title, children, extra }: { id: string; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className={CARD} aria-labelledby={`h-${id}`} data-bloco={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id={`h-${id}`} className={H2}>{title}</h2>{extra}</div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const STATE_TONE: Record<SituationState, "alert" | "gold" | "neutral"> = { sem_dono: "neutral", atrasada: "alert", sumida: "alert", na_hora_de_voltar: "gold", aniversario: "gold" };

/** 2. A situação em uma frase (montada no servidor) e os estados. */
export function SituationBlock({ situation }: { situation: Situation }) {
  return (
    <section aria-label="Situação agora" data-bloco="situacao" className="rounded-[var(--radius-card)] bg-paper-2 px-4 py-3">
      <p data-testid="frase-situacao" className="text-base leading-relaxed text-ink first-letter:uppercase">{situation.sentence}</p>
      {situation.states.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Estados da cliente">
          {situation.states.map((s) => <li key={s}><Badge tone={STATE_TONE[s]}>{SITUATION_STATE_LABEL[s]}</Badge></li>)}
        </ul>
      )}
    </section>
  );
}

/** 3. Agora: a conversa atual (etapa, dona, quem respondeu, próxima ação). Os próximos horários vêm logo abaixo (bloco "proximos"). */
export function NowBlock({ snap, now }: { snap: ClientSnapshot; now: number }) {
  const c = snap.conversation;
  return (
    <Card id="agora" title="Agora">
      {c ? (
        <div className="space-y-1.5 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="gold">{c.stageName}</Badge>
            <span className="text-graphite">
              {c.ownerName ? `Dona: ${c.ownerName}` : "Sem dono"}
              {c.lastReplyName && c.lastReplyName !== c.ownerName ? ` · respondida por ${c.lastReplyName}${c.lastReplyVia === "celular" ? " pelo celular" : ""}` : ""}
            </span>
            {c.closedConversation && <Badge>Conversa encerrada</Badge>}
          </p>
          <p>
            <span className="text-muted">Próxima ação: </span>
            {c.nextAction ? `${c.nextAction.title} · ${Date.parse(c.nextAction.dueAt) < now ? "atrasada, " : ""}${dueLabel(Date.parse(c.nextAction.dueAt), now)}` : "nenhuma definida"}
          </p>
          <Link href={leadHref(c.dealId)} className={LINK}>Abrir conversa</Link>
        </div>
      ) : <p className="text-sm text-graphite">Nenhuma conversa em andamento.</p>}
    </Card>
  );
}

/** 4. Retorno sugerido, com Agendar e Lembrar. A etapa 6 do funil entra sozinha quando a data chega (Tarefa 14, se ligada). */
export function ReturnBlock({ contactId, retorno, today, canSchedule }: { contactId: string; retorno: ReturnInfo | null; today: string; canSchedule: boolean }) {
  return (
    <Card id="retorno" title="Retorno sugerido">
      <p className="text-sm">{retorno ? returnLine(retorno, today) : "Sem previsão ainda: o ritmo aparece a partir da 3ª visita (ou com o ciclo do serviço cadastrado)."}</p>
      <ReturnActions contactId={contactId} dueOn={retorno && retorno.status !== "agendada" ? retorno.dueOn : null} canSchedule={canSchedule} />
    </Card>
  );
}

/** 5. Números: visitas, desde, frequência, faltas e cancelamentos para todas; ticket e total só com "ver valores". */
export function NumbersBlock({ snap, money }: { snap: ClientSnapshot; money: boolean }) {
  const s = snap.stats;
  const items: [string, string][] = [
    ["Visitas", String(s.visits)],
    ["Desde", s.firstVisitOn ? monthYear(s.firstVisitOn) : snap.knownSince ? monthYear(snap.knownSince.slice(0, 10)) : "—"],
    ["Frequência", s.rhythmDays ? `a cada ~${s.rhythmDays} dias` : "—"],
    ["Faltas", String(s.noShows)],
    ["Cancelamentos", String(s.cancellations)],
  ];
  if (money) items.push(["Ticket médio", s.ticketCents != null ? formatBRL(s.ticketCents) : "—"], ["Total gasto", formatBRL(s.totalCents ?? 0)]);
  return (
    <Card id="numeros" title="Números">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-display text-2xl font-light leading-tight tabular">{v}</dd></div>)}
      </dl>
    </Card>
  );
}

/** 6. Preferências: profissional (calculada, editável), 3 serviços mais feitos, aniversário e "Como conheceu". */
export function PreferencesBlock({ contactId, snap, chosenId, professionals, birthday }: {
  contactId: string; snap: ClientSnapshot; chosenId: string | null; professionals: { id: string; name: string }[]; birthday: string | null;
}) {
  const p = snap.preferred;
  const hint = !p ? "Nenhuma: menos de 3 serviços ou nenhuma profissional com 60% ou mais."
    : p.source === "ficha" ? "Escolhida aqui na ficha."
    : p.source === "calculada" ? `Calculada: ${Math.round((p.share ?? 0) * 100)}% dos serviços com ${displayName(p.name)}.`
    : `Anotada no Avec como "cliente de ${p.name}".`;
  const auto = p && p.source !== "ficha" ? `Automática (${displayName(p.name)})` : "Automática";
  return (
    <Card id="preferencias" title="Preferências">
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileField contactId={contactId} name="preferredProfessionalId" label="Profissional preferida" kind="select" value={chosenId ?? ""} hint={hint}
          options={[{ value: "", label: auto }, ...professionals.map((x) => ({ value: x.id, label: displayName(x.name) ?? x.name }))]} />
        <ProfileField contactId={contactId} name="birthday" label="Aniversário" kind="birthday" value={birthday ?? ""} placeholder="dd/mm ou dd/mm/aaaa" />
        <div>
          <p className="text-xs text-muted">Serviços mais feitos</p>
          {snap.stats.topServices.length
            ? <ol className="mt-1 text-sm">{snap.stats.topServices.map((x) => <li key={x.item}>{x.item} <span className="tabular text-muted">({x.n}×)</span></li>)}</ol>
            : <p className="mt-1 text-sm text-graphite">Nenhum serviço registrado.</p>}
        </div>
        <div>
          <p className="text-xs text-muted">Como conheceu</p>
          <p className="mt-1 text-sm">{snap.origin ?? "Não identificada"}</p>
          {snap.avecProfessionalHint && <p className="mt-1 text-xs text-graphite">No Avec está &quot;cliente de {snap.avecProfessionalHint}&quot;: é a profissional, não a origem.</p>}
        </div>
      </div>
    </Card>
  );
}

/** 9. Financeiro (só com "ver valores"): pagamentos e os lançamentos de Dívida e Crédito Cliente. O Avec não manda saldo. */
export function FinanceBlock({ snap, payments }: { snap: ClientSnapshot; payments: SalePaymentItem[] }) {
  const f = snap.finance;
  return (
    <Card id="financeiro" title="Financeiro">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Lançado como Dívida no Avec</dt><dd>{f.debtCount ? `${formatBRL(f.debtCents ?? 0)} · ${vezes(f.debtCount)} · última em ${brDay(f.lastDebtOn)}` : "Nada lançado"}</dd></div>
        <div><dt className="text-xs text-muted">Lançado como Crédito Cliente no Avec</dt><dd>{f.creditCount ? `${formatBRL(f.creditCents ?? 0)} · ${vezes(f.creditCount)}` : "Nada lançado"}</dd></div>
      </dl>
      <p className="mt-1 text-xs text-muted">São os lançamentos com essas formas de pagamento, não o saldo de hoje.</p>
      {payments.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Dia</th><th className="font-medium">Comanda</th><th className="font-medium">Forma</th><th className="text-right font-medium">Valor</th></tr></thead>
          <tbody>
            {payments.slice(0, 30).map((p) => (
              <tr key={p.id} className="border-t border-line/70">
                <td className="py-1.5 tabular">{brDay(p.paidOn ?? p.comandaOn)}</td><td className="tabular">{p.comanda ?? "—"}</td>
                <td>{p.method ?? "—"}</td><td className="text-right tabular">{p.valueCents != null ? formatBRL(p.valueCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** 10. Anotações (campo único da cliente) e avisos fixos. */
export function NotesBlock({ contactId, notes, alertNotes }: { contactId: string; notes: string | null; alertNotes: string | null }) {
  return (
    <Card id="anotacoes" title="Anotações">
      <div className="grid gap-4">
        <ProfileField contactId={contactId} name="notes" label="Anotações da cliente" kind="textarea" value={notes ?? ""} placeholder="Vale para todas as conversas dela…" />
        <ProfileField contactId={contactId} name="alertNotes" label="Avisos fixos" kind="textarea" value={alertNotes ?? ""}
          placeholder="Ex.: Alérgica a amônia" hint="Uma linha por aviso. Aparecem em destaque aqui e na conversa." />
      </div>
    </Card>
  );
}

/** 11. A conversa resumida (última mensagem e quem mandou, quantas conversas) e o Histórico completo recolhido. */
export function ConversationBlock({ data, now, children }: { data: ContactDetail; now: number; children: ReactNode }) {
  const last = data.messages.at(-1);
  const open = data.deals.find((d) => d.open);
  return (
    <Card id="conversa" title="Conversa">
      {last ? (
        <p className="text-sm"><span className="text-muted">{last.direction === "in" ? "Ela" : last.sender ?? "A Casa"} · {dueLabel(last.createdAt.getTime(), now)}: </span>{stripSignature(last.body) || "(mídia)"}</p>
      ) : <p className="text-sm text-graphite">Nenhuma mensagem ainda.</p>}
      <p className="mt-1 text-xs text-muted">{data.deals.length} {data.deals.length === 1 ? "conversa" : "conversas"} · {data.messageTotal} mensagens</p>
      {open && <Link href={leadHref(open.id)} className={LINK}>Abrir conversa</Link>}
      <details className="mt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-gold-ink lg:min-h-0">Histórico completo</summary><div className="mt-2">{children}</div></details>
    </Card>
  );
}

function dealStatus(d: ContactDeal): { label: string; tone: "gold" | "ok" | "alert" | "neutral" } {
  if (d.merged) return { label: "Mesclado (mesmo número)", tone: "neutral" };
  if (d.archived) return { label: "Não é cliente", tone: "neutral" };
  if (d.stageKind === "fechado") return { label: "Venda fechada", tone: "ok" };
  if (d.stageKind === "perdido") return { label: "Perdido", tone: "alert" };
  return { label: d.stageName, tone: "gold" };
}

/** 12. Leads, com "Mesclado" separado de "Não é cliente". */
export function LeadsBlock({ deals, day }: { deals: ContactDeal[]; day: (d: Date) => string }) {
  return (
    <Card id="leads" title={`Leads (${deals.length})`}>
      {deals.length === 0 ? <p className="text-sm text-graphite">Nenhum lead ainda.</p> : (
        <ul className="-mx-1 divide-y divide-line/70">
          {deals.map((x) => {
            const st = dealStatus(x);
            const body = (
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5"><Badge tone={st.tone}>{st.label}</Badge><span className="text-sm tabular text-graphite">{day(x.createdAt)}</span></span>
                <span className="mt-1 block text-sm text-graphite">{x.sourceLabel}{x.ownerName ? ` · ${x.ownerName.split(" ")[0]}` : ""}{x.valueCents ? ` · ${formatBRL(x.valueCents)}` : ""}</span>
              </span>
            );
            return <li key={x.id}>{x.archived ? <div className="flex min-h-11 items-center px-1 py-2.5">{body}</div> : <Link href={leadHref(x.id)} className="flex min-h-11 items-center rounded-[var(--radius-control)] px-1 py-2.5 hover:bg-paper-2/60">{body}</Link>}</li>;
          })}
        </ul>
      )}
    </Card>
  );
}
```

`src/components/contacts/ficha/visits.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Card } from "./blocks";
import { VISIT_STATUS_LABEL, type VisitDay } from "@/lib/visit-days";
import { displayName } from "@/lib/client-rhythm";
import { brDay } from "@/lib/client-avec";
import { formatBRL } from "@/lib/money";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const TONE: Record<string, "ok" | "alert" | "gold" | "neutral"> = { compareceu: "ok", faltou: "alert", cancelado: "neutral", agendado: "gold", confirmado: "gold" };

/** 8. Visitas passadas e futuras juntas, com profissional, situação e a observação do horário; os itens da comanda do mesmo dia. */
export function VisitsBlock({ days, money }: { days: VisitDay[]; money: boolean }) {
  return (
    <Card id="visitas" title="Visitas">
      {days.length === 0 ? <p className="text-sm text-graphite">Nenhuma visita registrada no Avec nem no CRM.</p> : (
        <ol className="divide-y divide-line/70">
          {days.map((d) => (
            <li key={d.day} className="py-3">
              <p className="text-sm font-semibold tabular">{brDay(d.day)}{d.future ? " · marcado" : ""}{money && d.totalCents != null ? ` · ${formatBRL(d.totalCents)}` : ""}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {d.appointments.map((a) => (
                  <li key={a.id}>
                    <span className="tabular text-graphite">{hora(a.startsAt)}</span> · {a.serviceLabel}{a.professionalName ? ` · ${displayName(a.professionalName)}` : ""}{" "}
                    <Badge tone={TONE[a.status] ?? "neutral"}>{VISIT_STATUS_LABEL[a.status] ?? a.status}</Badge>
                    {a.notes && <p className="mt-0.5 whitespace-pre-line text-graphite">Observação: {a.notes}</p>}
                  </li>
                ))}
                {d.items.map((i) => (
                  <li key={i.id} className="text-graphite">
                    {i.item}{i.professionalName ? ` · ${displayName(i.professionalName)}` : ""}{i.fromPackage ? " · do pacote" : ""}{money && i.totalCents != null ? ` · ${formatBRL(i.totalCents)}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
```

`src/components/contacts/ficha/header.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { TagsEditor } from "@/components/queue/tags-editor";
import { BackToClient, StartConversation } from "@/components/contacts/start-conversation";
import { ProfileField } from "./editable";
import { IconInstagram, IconMail, IconPhone, IconWhatsApp } from "@/components/icons";
import { formatPhoneClient, isHiddenNumber } from "@/lib/phone-client";
import { formatBRL } from "@/lib/money";
import { brDay } from "@/lib/client-avec";
import type { ContactDetail } from "@/server/queries/contact";
import type { ClientSnapshot } from "@/server/queries/client-snapshot";

const OUTLINE = "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong px-3.5 text-sm font-medium hover:bg-paper-2 lg:min-h-10";

/** Avisos fixos do topo: os da equipe (uma linha cada) e Dívida/Crédito do Avec (valor só com "ver valores"). */
export function fixedWarnings(alertNotes: string | null, f: ClientSnapshot["finance"], money: boolean): string[] {
  return [
    ...(alertNotes ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    ...(f.debtCount ? [money ? `Dívida lançada no Avec: ${formatBRL(f.debtCents ?? 0)} (última em ${brDay(f.lastDebtOn)})` : "Tem dívida lançada no Avec"] : []),
    ...(f.creditCount ? [money ? `Crédito Cliente lançado no Avec: ${formatBRL(f.creditCents ?? 0)}` : "Tem crédito lançado no Avec"] : []),
  ];
}

/** 1. Cabeçalho: foto, nome, telefone, Conversar/Ligar/WhatsApp, etiquetas editáveis e avisos fixos. Nome e e-mail editáveis ali mesmo. */
export function FichaHeader({ data, snap, tags, tagOptions, money }: { data: ContactDetail; snap: ClientSnapshot; tags: { id: string; name: string }[]; tagOptions: string[]; money: boolean }) {
  const c = data.contact;
  const name = c.name?.trim() || formatPhoneClient(c.phone);
  const dial = !isHiddenNumber(c.phone);
  const warnings = fixedWarnings(c.alertNotes, snap.finance, money);
  return (
    <header className="flex flex-col gap-4 pt-3">
      <div className="flex min-w-0 items-start gap-4 lg:gap-5">
        <ContactAvatar contactId={c.id} hasAvatar={c.hasAvatar} name={name} size={72} className="mt-1 ring-2 ring-gold-soft" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gold-ink"><span aria-hidden className="h-px w-6 bg-gold" />Ficha da cliente</p>
          <h1 className="mt-1 break-words font-display text-[30px] font-light leading-[1.08] tracking-[-0.015em] lg:text-[44px]">{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-graphite">
            {dial && <span className="inline-flex items-center gap-1.5 tabular"><IconPhone size={15} />{formatPhoneClient(c.phone)}</span>}
            {c.email && <span className="inline-flex items-center gap-1.5 break-all"><IconMail size={15} />{c.email}</span>}
            {c.instagram && <span className="inline-flex items-center gap-1.5"><IconInstagram size={15} />{c.instagram}</span>}
            {c.ignored && <Badge tone="alert">Não é cliente</Badge>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!c.ignored && <StartConversation contactId={c.id} hasOpenLead={!!snap.conversation} />}
        {dial && <a href={`tel:${c.phone}`} className={OUTLINE}><IconPhone size={15} />Ligar</a>}
        {dial && <a href={`https://wa.me/${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className={OUTLINE}><IconWhatsApp size={15} />WhatsApp</a>}
        {c.ignored && <BackToClient contactId={c.id} />}
      </div>
      <TagsEditor contactId={c.id} tags={tags} options={tagOptions} />
      {warnings.length > 0 && (
        <ul aria-label="Avisos fixos" className="flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-3 py-2 text-sm font-medium text-alert">
              <span aria-hidden className="font-bold">!</span>{w}
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-2">
        <summary className="min-h-11 cursor-pointer text-sm font-medium text-gold-ink lg:min-h-8">Editar nome e e-mail</summary>
        <div className="grid gap-3 py-3 sm:grid-cols-2">
          <ProfileField contactId={c.id} name="name" label="Nome" value={c.name ?? ""} placeholder="Nome da cliente" />
          <ProfileField contactId={c.id} name="email" label="E-mail" kind="email" value={c.email ?? ""} placeholder="nome@exemplo.com" />
        </div>
      </details>
    </header>
  );
}
```

- [ ] **Passo 7: A página `src/app/(app)/contatos/[id]/page.tsx`**

Trocar o arquivo inteiro por:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { getContact } from "@/server/queries/contact";
import { getContactAvecData } from "@/server/queries/avec";
import { getClientSnapshot } from "@/server/queries/client-snapshot";
import { getContactVisits } from "@/server/queries/contact-visits";
import { listTags, tagsOf } from "@/server/domain/tags";
import { listProfessionals } from "@/server/domain/professionals";
import { LiveRefresh } from "@/components/shell/live";
import { ClientPackages, UpcomingAppointments } from "@/components/contacts/contact-avec";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { FichaHeader } from "@/components/contacts/ficha/header";
import { ConversationBlock, FinanceBlock, LeadsBlock, NotesBlock, NowBlock, NumbersBlock, PreferencesBlock, ReturnBlock, SituationBlock } from "@/components/contacts/ficha/blocks";
import { VisitsBlock } from "@/components/contacts/ficha/visits";
import { IconArrowRight } from "@/components/icons";
import { buildTimeline } from "@/lib/contact-timeline";
import { bahiaDay } from "@/lib/client-rhythm";
import { birthdayLabel } from "@/lib/birthday";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Ficha da cliente" };
const day = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });

/**
 * A ficha da cliente (spec Lote 2), em ordem: 1 cabeçalho · 2 situação · 3 agora (+ próximos horários) · 4 retorno sugerido ·
 * 5 números · 6 preferências · 7 pacotes · 8 visitas · 9 financeiro (só com "ver valores") · 10 anotações · 11 conversa · 12 leads.
 */
export default async function ContatoPage({ params }: PageProps<"/contatos/[id]">) {
  const user = await requirePerm("contatos.ver");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const money = can(user.perms, "valores.ver");
  const [data, avec, snap, visits, tagMap, tagOptions, pros] = await Promise.all([
    getContact(id, { withValues: money }), getContactAvecData(id, { withValues: money }), getClientSnapshot(id, { money }),
    getContactVisits(id, { withValues: money }), tagsOf([id]), listTags(), listProfessionals(),
  ]);
  if (!data || !snap) notFound();
  const now = data.asOf;
  const c = data.contact;
  const days = buildTimeline({
    now, messages: data.messages, events: data.events, lookup: data.lookup,
    deals: data.deals.map((x) => ({ id: x.id, createdAt: x.createdAt, stageName: x.stageName })),
  });
  return (
    <main className="pb-12">
      <LiveRefresh scopes={["queue"]} />
      <div className="px-5 pt-5 lg:px-8 lg:pt-8">
        <Link href="/contatos" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-graphite hover:text-ink lg:min-h-0"><IconArrowRight size={14} className="rotate-180" />Contatos</Link>
      </div>
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-5 lg:px-8">
        <FichaHeader data={data} snap={snap} tags={tagMap.get(id) ?? []} tagOptions={tagOptions.map((t) => t.name)} money={money} />
        <SituationBlock situation={snap.situation} />
        <NowBlock snap={snap} now={now} />
        <div data-bloco="proximos"><UpcomingAppointments items={avec.proximos} now={now} /></div>
        <ReturnBlock contactId={id} retorno={snap.situation.retorno} today={bahiaDay(now)} canSchedule={!c.ignored} />
        <NumbersBlock snap={snap} money={money} />
        <PreferencesBlock contactId={id} snap={snap} chosenId={c.preferredProfessionalId} professionals={pros.map((p) => ({ id: p.id, name: p.name }))}
          birthday={birthdayLabel(c.birthDay, c.birthMonth, c.birthYear)} />
        <div data-bloco="pacotes"><ClientPackages items={avec.pacotes} /></div>
        <VisitsBlock days={visits} money={money} />
        {money && <FinanceBlock snap={snap} payments={avec.pagamentos} />}
        <NotesBlock contactId={id} notes={c.notes} alertNotes={c.alertNotes} />
        <ConversationBlock data={data} now={now}>
          <ContactTimeline days={days} messageTotal={data.messageTotal} messageShown={data.messages.length} eventsTruncated={data.eventsTruncated} />
        </ConversationBlock>
        <LeadsBlock deals={data.deals} day={day} />
      </div>
    </main>
  );
}
```

Se `UpcomingAppointments` ou `ClientPackages` não renderizarem nada quando a lista está vazia, o `div` com `data-bloco` continua lá (vazio) e a ordem do e2e vale. "Atendimentos e compras" (`ClientHistory`) sai da página: as visitas do bloco 8 já juntam as comandas por dia (o componente e o teste dele ficam no repositório).

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/lib/visit-days.test.ts src/server/domain/lid-merge.test.ts src/server/queries/contact.test.ts`
Esperado: PASS.

Rodar: `npm run typecheck && npm run lint`
Esperado: verde.

Rodar: `npx playwright test e2e/ficha.spec.ts e2e/contatos.spec.ts e2e/cliente.spec.ts --project=desktop`
Esperado: PASS. Se um teste antigo de `contatos.spec.ts` procurar textos que saíram da ficha ("Lead atual", "Valores", "Atendimentos e compras", "Observações"), trocar pelo bloco novo equivalente ("Agora", "Números", "Visitas", "Anotações") e anotar no commit.

- [ ] **Passo 9: Commit**

```bash
git add src/lib/visit-days.ts src/lib/visit-days.test.ts src/server/queries/contact-visits.ts src/server/queries/contact.ts \
  src/server/domain/lid-merge.ts src/server/domain/lid-merge.test.ts src/components/contacts/ficha/ "src/app/(app)/contatos/[id]/page.tsx" \
  e2e/helpers.ts e2e/ficha.spec.ts e2e/contatos.spec.ts
git commit -m "feat(ficha): ficha em ordem (situação, agora, retorno, números, preferências, visitas com observação, financeiro, anotações, conversa, leads com Mesclado)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 9: Painel da conversa (a mesma frase, visitas do Avec, retorno, preferida, avisos fixos; nome e foto abrem a ficha)

**Files:**
- Modify: `src/lib/lead-href.ts`, `src/lib/lead-href.test.ts`
- Create: `src/components/contacts/client-link.tsx`, `src/components/contacts/client-link.test.tsx`
- Modify: `src/components/queue/client-pane.tsx` (cabeçalho da coluna, `WhoIs`; ache com `grep -n "function WhoIs\|ContactAvatar contactId" src/components/queue/client-pane.tsx`)
- Modify: `src/components/queue/context-strip.tsx` (inteiro, 40 linhas)
- Create: `src/components/queue/context-strip.test.tsx`
- Modify: `src/components/queue/pane-header.tsx:103` e `:107` (foto e nome)

**Interfaces:**
- Consumes (T5): `ClientContext.situation | short | states | retorno | preferredProfessional | alertNotes`. (T2): `returnLine`, `displayName`, `bahiaDay`.
- Produces:
  - `contactHref(contactId: string): string` (`/contatos/<id>`), o único lugar que sabe o caminho da ficha;
  - `ClientLink({ contactId, name, children, className?, label? })`: link para a ficha que fica por cima de linhas clicáveis (não deixa o toque nem o arrasto "vazar" para a linha); nome acessível padrão "Ficha de <nome>";
  - no painel: `data-testid="situacao-conversa"` com a frase; link "Ver ficha completa".

- [ ] **Passo 1: Escrever os testes que falham**

Em `src/lib/lead-href.test.ts`, acrescentar `contactHref` ao import e:

```ts
it("contactHref: a ficha da cliente", () => {
  expect(contactHref("0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f")).toBe("/contatos/0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f");
});
```

`src/components/contacts/client-link.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientLink } from "./client-link";

afterEach(cleanup);

it("leva à ficha, com nome acessível que contém o nome visível, e não deixa o toque chegar na linha nem no arrasto", () => {
  const onRow = vi.fn();
  render(<div onPointerDown={onRow}><ClientLink contactId="c-1" name="Rita Souza">Rita Souza</ClientLink></div>);
  const a = screen.getByRole("link", { name: "Ficha de Rita Souza" });
  expect(a.getAttribute("href")).toBe("/contatos/c-1");
  fireEvent.pointerDown(a);
  expect(onRow).not.toHaveBeenCalled();
});
```

`src/components/queue/context-strip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DealDetail } from "@/server/queries/deal";
import { ContextStrip } from "./context-strip";

afterEach(cleanup);

const d = {
  deal: { id: "d-1" }, contact: { id: "c-1" }, messages: [],
  context: {
    firstContactAt: "2020-03-10T15:00:00.000Z", isFirstContact: false, lastVisit: { at: "2026-09-25T15:00:00.000Z", service: null, by: null }, visits: 12,
    lastSales: [], totalCents: null, previousOwner: null, nextAppointment: null, activePackage: null,
    situation: "última visita há 20 dias · na hora de voltar (prevista 11/10)", short: "Na hora de voltar · última visita há 20 dias", states: ["na_hora_de_voltar"],
    retorno: { basis: "ritmo", everyDays: 25, dueOn: "2026-10-11", daysSince: 20, lateDays: 4, status: "na_hora" }, preferredProfessional: "MAIARA", alertNotes: null, knownSince: "2020-03-10T15:00:00.000Z",
  },
} as unknown as DealDetail;

it("a faixa usa a frase curta da situação; aberta, mostra a frase inteira, a preferida e o link para a ficha", () => {
  render(<ContextStrip d={d} />);
  expect(screen.getByRole("button", { name: /Na hora de voltar · última visita há 20 dias/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /ver mais/ }));
  expect(screen.getByText("última visita há 20 dias · na hora de voltar (prevista 11/10)")).toBeTruthy();
  expect(screen.getByText("Maiara")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ver ficha completa" }).getAttribute("href")).toBe("/contatos/c-1");
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/lead-href.test.ts src/components/contacts/client-link.test.tsx src/components/queue/context-strip.test.tsx`
Esperado: FAIL (`contactHref` e `./client-link` não existem; a faixa ainda mostra "Fala com a Casa desde").

- [ ] **Passo 3: `contactHref` e `ClientLink`**

No fim de `src/lib/lead-href.ts`:

```ts
/** Único lugar que sabe onde fica a ficha da cliente (Lote 2: nome e foto abrem a ficha em todas as telas). */
export const contactHref = (contactId: string) => `/contatos/${contactId}`;
```

`src/components/contacts/client-link.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { contactHref } from "@/lib/lead-href";
import { cn } from "@/lib/cn";

/**
 * Nome ou foto que abre a ficha da cliente (Lote 2). Pode ficar POR CIMA de uma linha que já é clicável (link esticado para a conversa):
 * `relative z-[1]` o põe acima do link da linha, e o toque não "vaza" para a linha nem começa o arrasto do Quadro.
 * Nunca colocar dentro de outro link (HTML inválido): a linha usa link esticado ao lado deste.
 */
export function ClientLink({ contactId, name, children, className, label }: { contactId: string; name: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <Link href={contactHref(contactId)} aria-label={label ?? `Ficha de ${name}`} title={`Ver ficha de ${name}`}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className={cn("relative z-[1] rounded-[var(--radius-control)] underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}
```

- [ ] **Passo 4: Coluna da cliente (`client-pane.tsx`)**

Imports novos: `import Link from "next/link";` (se ainda não houver), `import { ClientLink } from "@/components/contacts/client-link";`, `import { contactHref } from "@/lib/lead-href";`, `import { bahiaDay, displayName, returnLine } from "@/lib/client-rhythm";`.

No topo da coluna (o bloco com `ContactAvatar … size={52}` e o `<h3>` do nome), trocar a foto e o nome por um link só para a ficha (um link, não dois):

```tsx
        <div className="flex items-center gap-3.5">
          <ClientLink contactId={d.contact.id} name={name} label={`Ver ficha de ${name}`} className="group flex min-w-0 flex-1 items-center gap-3.5 hover:no-underline">
            <ContactAvatar contactId={d.contact.id} hasAvatar={!!d.contact.avatarPath} name={name} size={52} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display text-xl leading-tight font-medium group-hover:underline">{name}</h3>
              <p className="truncate text-sm text-graphite">{formatPhoneClient(phone)}{d.contact.instagram ? ` · @${d.contact.instagram}` : ""}</p>
            </div>
          </ClientLink>
          {d.contact.isClient && <Badge tone="ok" className="self-start">Cliente</Badge>}
        </div>
```

No `WhoIs`, trocar o começo do retorno (o `<dl>` e o que vem antes) por:

```tsx
  const c = d.context;
  const source = d.sourceLabel === NOT_IDENTIFIED || isChannelOrigin(d.sourceLabel) ? NOT_IDENTIFIED : d.sourceLabel;
  const avisos = (c.alertNotes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <>
      {avisos.length > 0 && (
        <ul aria-label="Avisos fixos" className="flex flex-col gap-1">
          {avisos.map((a) => <li key={a} className="rounded-[var(--radius-control)] border border-alert/40 bg-alert-soft px-3 py-1.5 text-sm font-medium text-alert">{a}</li>)}
        </ul>
      )}
      {c.situation && <p data-testid="situacao-conversa" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink first-letter:uppercase">{c.situation}</p>}
      <dl className="divide-y divide-line/70">
        <Row label="Veio de">{source}</Row>
        <Row label="Fala com a Casa desde">{c.isFirstContact ? "Agora (primeira conversa)" : monthYear(c.firstContactAt)}</Row>
        <Row label="Visitas">{c.visits ? `${c.visits}${c.lastVisit ? ` · última ${shortDate(c.lastVisit.at)}${c.lastVisit.service ? ` · ${c.lastVisit.service}` : ""}` : ""}` : "nenhuma registrada"}</Row>
        {c.retorno && <Row label="Retorno" wrap>{returnLine(c.retorno, bahiaDay(Date.now()))}</Row>}
        {c.preferredProfessional && <Row label="Profissional preferida">{displayName(c.preferredProfessional)}</Row>}
        {c.nextAppointment && <Row label="Próximo horário" wrap>{appointmentLine(c.nextAppointment, Date.now())}</Row>}
        {c.activePackage && <Row label="Pacote" wrap>{packageLine(c.activePackage)}</Row>}
        {c.totalCents != null && <Row label="Já gastou">{c.totalCents > 0 ? formatBRL(c.totalCents) : "Nada registrado"}</Row>}
        {c.previousOwner && <Row label="Atendeu antes">{c.previousOwner}</Row>}
      </dl>
      <Link href={contactHref(d.contact.id)} className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline lg:min-h-0">Ver ficha completa</Link>
```

(O resto do `WhoIs`, com `TagsEditor`, `FromChatguru`, sinais e as anotações da Tarefa 7, fica como está.)

- [ ] **Passo 5: Faixa do topo (`context-strip.tsx`)**

Trocar o arquivo inteiro por:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import type { DealDetail } from "@/server/queries/deal";
import { signalsOf, signalLabels, SIGNAL_WINDOW } from "@/server/domain/signals";
import { formatBRL } from "@/lib/money";
import { appointmentLine, packageLine } from "@/lib/client-avec";
import { bahiaDay, displayName, returnLine } from "@/lib/client-rhythm";
import { contactHref } from "@/lib/lead-href";
import { cn } from "@/lib/cn";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "America/Bahia" }).replace(". de ", "/").replace(" de ", "/").replace(".", "");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/**
 * Quem é a cliente, numa linha no topo da conversa (abaixo de 1280 px). A linha usa a frase curta da situação (a mesma da ficha);
 * tocar abre o resto: a frase inteira, última visita, retorno, preferida, quanto gastou (só com "ver valores") e "Ver ficha completa".
 */
export function ContextStrip({ d, className }: { d: DealDetail; className?: string }) {
  const [open, setOpen] = useState(false);
  const c = d.context;
  const sinais = signalLabels(signalsOf(d.messages.slice(-SIGNAL_WINDOW).map((m) => ({ direction: m.direction, body: m.body, createdAt: m.createdAt }))));
  const head = c.short || [c.isFirstContact ? "Primeira conversa com a Casa" : `Fala com a Casa desde ${monthYear(c.firstContactAt)}`, c.visits ? `${c.visits} ${c.visits === 1 ? "visita" : "visitas"}` : null].filter(Boolean).join(" · ");
  return (
    <section aria-label="Quem é a cliente" className={cn("shrink-0 mx-3 mt-2 rounded-[var(--radius-card)] border border-line bg-paper text-sm", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`contexto-${d.deal.id}`}
        className="flex w-full min-h-11 items-center gap-2 px-3 text-left">
        <span className="min-w-0 truncate font-medium text-ink first-letter:uppercase">{head}</span>
        {sinais.slice(0, 2).map((l) => <span key={l} className="shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-medium text-gold-ink">{l}</span>)}
        <span className="ml-auto shrink-0 text-xs font-medium text-gold-ink">{open ? "fechar" : "ver mais"}</span>
      </button>
      {open && (
        <div id={`contexto-${d.deal.id}`} className="px-3 pb-3">
          {c.situation && <p className="mb-2 text-[13px] text-ink first-letter:uppercase">{c.situation}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            {c.nextAppointment && <div className="col-span-2"><dt className="text-muted text-xs">Próximo horário</dt><dd>{appointmentLine(c.nextAppointment, Date.now())}</dd></div>}
            {c.activePackage && <div className="col-span-2"><dt className="text-muted text-xs">Pacote</dt><dd>{packageLine(c.activePackage)}</dd></div>}
            {c.retorno && <div className="col-span-2"><dt className="text-muted text-xs">Retorno</dt><dd>{returnLine(c.retorno, bahiaDay(Date.now()))}</dd></div>}
            <div><dt className="text-muted text-xs">Última visita</dt><dd>{c.lastVisit ? `${shortDate(c.lastVisit.at)}${c.lastVisit.service ? ` · ${c.lastVisit.service}` : ""}` : "nenhuma registrada"}</dd></div>
            <div><dt className="text-muted text-xs">Profissional preferida</dt><dd>{displayName(c.preferredProfessional) ?? "—"}</dd></div>
            <div><dt className="text-muted text-xs">Atendeu antes</dt><dd>{c.previousOwner ?? "—"}</dd></div>
            {c.totalCents != null && <div><dt className="text-muted text-xs">Já gastou</dt><dd>{c.totalCents > 0 ? formatBRL(c.totalCents) : "Nada registrado"}</dd></div>}
          </dl>
          <Link href={contactHref(d.contact.id)} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline">Ver ficha completa</Link>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Passo 6: Cabeçalho da conversa (`pane-header.tsx`)**

Import: `import { ClientLink } from "@/components/contacts/client-link";`. Linha 103, a foto:

```tsx
          <ClientLink contactId={contactId} name={name} label={`Ver ficha de ${name}`} className={back ? "rounded-full" : "ml-2 rounded-full lg:ml-0"}>
            <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} name={name} size={40} />
          </ClientLink>
```

Linha 107, o nome:

```tsx
            <h2 className="min-w-0 truncate text-base font-semibold lg:font-display lg:text-[28px] lg:leading-tight lg:font-medium">
              <ClientLink contactId={contactId} name={name}>{name}</ClientLink>
            </h2>
```

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/lib/lead-href.test.ts src/components/contacts/client-link.test.tsx src/components/queue/context-strip.test.tsx`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Rodar: `npx playwright test e2e/conversa.spec.ts e2e/cliente.spec.ts e2e/fila.spec.ts e2e/a11y.spec.ts --project=desktop`
Esperado: PASS. Se um teste procurar o nome da cliente como texto puro do `<h2>`/`<h3>` com `getByRole("heading", { name })`, continua valendo (o link fica dentro do título). Se algum spec esperava "Nenhuma venda no CRM", trocar por "Nada registrado".

- [ ] **Passo 8: Commit**

```bash
git add src/lib/lead-href.ts src/lib/lead-href.test.ts src/components/contacts/client-link.tsx src/components/contacts/client-link.test.tsx \
  src/components/queue/client-pane.tsx src/components/queue/context-strip.tsx src/components/queue/context-strip.test.tsx src/components/queue/pane-header.tsx
git commit -m "feat(conversa): painel com a frase de situação, visitas do Avec, retorno, preferida e avisos fixos; nome e foto abrem a ficha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 10: Nome e foto abrem a ficha no Quadro, Jornada, Hoje, sino, Agenda e Relatórios

**Files:**
- Modify: `src/components/lead/lead-sheet.tsx:235-238` (painel do lead aberto pelo Quadro)
- Modify: `src/components/journey/station.tsx:38-56`
- Modify: `src/server/queries/today.ts:13` (tipo `TodayItem`) e `:76` (select do `q`)
- Modify: `src/components/today/waiting-list.tsx:36-60`, `src/components/today/attendance-list.tsx:45-51`, `src/components/today/next-actions.tsx:40-45`
- Modify: `src/app/(app)/page.tsx:154-160` (Aniversários da semana)
- Modify: `src/server/queries/alerts.ts:8-20`, `src/components/shell/alerts-bell.tsx:147-165`
- Modify: `src/components/agenda/agenda-board.tsx:73-75` e `:134-136`, `src/components/agenda/entry-sheet.tsx:35-41`, `src/components/agenda/agenda-board.test.tsx`
- Modify: `src/server/reports/queries.ts:197` e `:210` (`ChargeItem` com `contactId`), `src/components/reports/analysis.tsx:139-146`
- Modify: `e2e/hoje.spec.ts:133`, `e2e/jornada.spec.ts:102`
- Create: `e2e/ficha-cliques.spec.ts`

**Interfaces:**
- Consumes (T9): `ClientLink`, `contactHref`.
- Produces:
  - `TodayItem.contactId: string`; `AlertItem.contactId: string | null`; `ChargeItem.contactId: string`;
  - Agenda: o nome de qualquer horário (do Avec ou da conversa) abre o painel do horário, que mostra "Abrir conversa" (quando há) **e** "Abrir ficha da cliente";
  - nenhuma linha tem link dentro de link: onde a linha leva à conversa, ela vira "link esticado" (`absolute inset-0`) e o nome fica por cima com `ClientLink`.

- [ ] **Passo 1: Escrever os testes que falham**

`e2e/ficha-cliques.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { login, simulate, e2eSql, ageLead } from "./helpers";

/** Lote 2: todos os pontos da tabela de cliques da auditoria de Contatos abrem a ficha (ou o painel com "Abrir ficha da cliente"). */
const fone = (i: number) => `+557199978${String(i).padStart(4, "0")}`;
const digitado = (i: number) => `71 99978-${String(i).padStart(4, "0")}`;
const contactId = async (phone: string) => String((await e2eSql("select id from contacts where phone_e164 = $1", [phone]))[0].id);
const dealId = async (phone: string) => String((await e2eSql("select d.id from deals d join contacts c on c.id = d.contact_id where c.phone_e164 = $1 and d.closed_at is null and d.archived_at is null", [phone]))[0].id);
const naFicha = async (page: Page, id: string) => { await expect(page).toHaveURL(new RegExp(`/contatos/${id}$`)); await expect(page.getByTestId("frase-situacao")).toBeVisible(); };

test.afterAll(async () => {
  await e2eSql("update deals set archived_at = coalesce(archived_at, now()) where contact_id in (select id from contacts where phone_e164 like '+557199978%')");
  await e2eSql("update alerts set resolved_at = now() where resolved_at is null");
});

test("conversa, Quadro, Jornada, Hoje, sino, Agenda e Relatórios levam à ficha", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  test.setTimeout(180_000);
  await login(page);
  await simulate(page, { phone: digitado(1), name: "Olga Fictícia", text: "Oi, tem horário sábado?" });
  const id = await contactId(fone(1));
  const deal = await dealId(fone(1));

  // Conversa: nome do cabeçalho
  await page.goto(`/atendimento/${deal}`);
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);

  // Hoje › Esperando resposta (a cliente escreveu e ninguém respondeu)
  await page.goto("/");
  await page.getByRole("region", { name: "Esperando resposta" }).getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);

  // Hoje › Minhas próximas ações e Aniversários da semana
  await e2eSql(`insert into tasks (deal_id, contact_id, kind, title, due_at, assignee_id) select $1, $2, 'proxima_acao', 'Mandar valores Olga', now() + interval '1 hour', u.id from users u where u.email = 'gestao@e2e.local'`, [deal, id]);
  await e2eSql("update contacts set birth_day = extract(day from (now() at time zone 'America/Bahia'))::int, birth_month = extract(month from (now() at time zone 'America/Bahia'))::int where id = $1", [id]);
  await page.goto("/");
  await page.getByRole("region", { name: "Minhas próximas ações" }).getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);
  await page.goto("/");
  await page.locator("section[aria-labelledby='h-aniversarios']").getByRole("link", { name: /Olga Fictícia/ }).click();
  await naFicha(page, id);

  // Quadro: o cartão abre o painel do lead; nele, o nome e "Ver ficha completa"
  await page.goto(`/funil?lead=${deal}`);
  await page.getByRole("link", { name: "Ver ficha completa" }).click();
  await naFicha(page, id);

  // Jornada: o nome embaixo do círculo
  await page.goto("/jornada");
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).click();
  await naFicha(page, id);

  // Sino: aviso de espera, botão "Ficha"
  ageLead(fone(1), 40);
  await page.goto("/");
  await page.getByRole("button", { name: /^Alertas/ }).click();
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);

  // Agenda: horário do Avec da cliente hoje → painel → "Abrir ficha da cliente"
  await e2eSql(`insert into appointments (contact_id, starts_at, status, service_label, external_key) values ($1, now() + interval '10 minutes', 'agendado', 'Escova', 'e2e:cliques:ag') on conflict do nothing`, [id]);
  await page.goto("/agenda");
  await page.getByTestId("agenda-item").filter({ hasText: "Olga Fictícia" }).first().getByRole("button").first().click();
  await page.getByRole("link", { name: "Abrir ficha da cliente" }).click();
  await naFicha(page, id);

  // Relatórios › Análise › cobranças vencidas (gestão; só venda fechada com valor a receber): o nome na lista
  await e2eSql(`insert into deals (contact_id, stage_id, value_cents, charge_at, closed_at, created_at)
    select $1, s.id, 30000, now() - interval '1 day', now() - interval '2 days', now() - interval '3 days' from stages s where s.key = 'fechado'`, [id]);
  await page.goto("/relatorios?aba=analise");
  await page.getByRole("link", { name: "Ficha de Olga Fictícia" }).first().click();
  await naFicha(page, id);
});
```

A seção "Esperando resposta" do Hoje ganha nome acessível no Passo 4 (`aria-labelledby="h-esperando"`). As cobranças ficam na aba Análise dos Relatórios (`/relatorios?aba=analise`) e só listam venda fechada com valor a receber.

Em `src/components/agenda/agenda-board.test.tsx`, se houver teste esperando um link para a conversa no nome de um horário que veio de conversa, troque para: o nome é um botão que abre o painel (`getByRole("button", { name: /<nome do teste>/ })`).

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx playwright test e2e/ficha-cliques.spec.ts --project=desktop`
Esperado: FAIL (não existe link "Ficha de Olga Fictícia" fora da conversa).

- [ ] **Passo 3: Quadro (painel do lead) e Jornada**

`src/components/lead/lead-sheet.tsx` (imports `ClientLink`, `contactHref` e `Link` de `next/link` se faltar), linha 235:

```tsx
                  <h2 className="font-display text-[28px] leading-tight font-medium truncate"><ClientLink contactId={d.contact.id} name={name}>{name}</ClientLink></h2>
```

e logo depois do `<p>` da linha 238 (telefone · origem · canal):

```tsx
                <Link href={contactHref(d.contact.id)} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline lg:min-h-0">Ver ficha completa</Link>
```

`src/components/journey/station.tsx` (import `ClientLink`), trocar o `<Link …>` da pessoa (linhas 38-55) por um bloco com o círculo levando à conversa (como hoje) e o nome, ao lado, levando à ficha:

```tsx
    <motion.li initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: T.base, ease: EASE, delay: Math.min(index, 11) * 0.025 }}>
      <div className="group flex w-24 flex-col items-center gap-2 py-1">
        <Link href={leadHref(p.dealId)} aria-label={label} suppressHydrationWarning className="rounded-full outline-offset-2">
          <span className="relative block" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
              <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-line)" strokeWidth={3} />
              <circle suppressHydrationWarning cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={RING_COLOR[ring]} strokeWidth={3} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
            </svg>
            <ContactAvatar contactId={p.contactId} hasAvatar={p.hasAvatar} name={p.name} size={SIZE - 14} className="absolute inset-[7px] font-display font-normal transition-transform duration-200 group-hover:scale-[1.04]" />
            {ring === "late" && <span aria-hidden className="absolute -right-0.5 -top-0.5 grid size-[22px] place-items-center rounded-full border-2 border-paper bg-alert text-[13px] font-bold leading-none text-white">!</span>}
            {p.ownerInitials && (
              <span aria-hidden title={`Dona: ${p.ownerName}`} className="absolute -bottom-0.5 -left-0.5 grid size-[24px] place-items-center rounded-full border-2 border-paper bg-paper-3 text-[10px] font-semibold leading-none text-graphite">{p.ownerInitials}</span>
            )}
          </span>
        </Link>
        <ClientLink contactId={p.contactId} name={p.name} className="text-center text-[12.5px] font-medium leading-tight">{short}</ClientLink>
        <span suppressHydrationWarning className={cn("-mt-1.5 whitespace-pre-line text-center text-xs font-semibold leading-tight", SUB_TONE[ring])}>{text.replace(" · ", "\n")}</span>
      </div>
    </motion.li>
```

(O conteúdo do círculo é o de hoje, sem mudança; só o nome sai de dentro do link da conversa e vira o link da ficha. Se a Tarefa A7/C9 já tiver mudado alguma classe aqui, mantenha a versão atual do círculo.)

`e2e/jornada.spec.ts:102`: o nome agora também é link (para a ficha); o clique que abre a conversa passa a ser no círculo:

```ts
    await page.locator('[data-station="lead"]').getByRole("link", { name: /^Tatiane M\. \(Tatiane Moura\)/ }).click();
```

- [ ] **Passo 4: Hoje**

`src/server/queries/today.ts`: no tipo `TodayItem` (linha 13) acrescentar `contactId: string;` e no `select` do `q` (linha 76) acrescentar `c.id as "contactId",` depois de `select d.id,`.

`src/components/today/waiting-list.tsx` (imports `ClientLink`), trocar o `return` do `Row` (linhas 45-59) pela linha com link esticado:

```tsx
  const name = i.name ?? formatPhoneClient(i.phone);
  return (
    <div data-late={red ? "sim" : "nao"} className={`group relative flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-[var(--radius-control)] transition-colors ${red ? "bg-alert-soft hover:bg-alert-soft/80" : "hover:bg-paper-2"}`}>
      {/* A linha inteira abre a conversa (link esticado); o nome, por cima, abre a ficha. */}
      <Link href={leadHref(i.id)} aria-label={`Abrir conversa com ${name}`} className="absolute inset-0 rounded-[var(--radius-control)]" />
      <span className={`pointer-events-none relative size-2 rounded-full shrink-0 ${red ? "bg-alert" : gold ? "bg-gold" : "bg-line-strong"}`}>
        {pulse && <motion.span aria-hidden data-testid="pulso-atraso" className="absolute inset-0 rounded-full bg-alert" initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: reduced ? 1 : 3 }} transition={{ duration: 0.6, ease: EASE, repeat: 1 }} />}
      </span>
      <span className="pointer-events-none min-w-0 flex-1">
        <ClientLink contactId={i.contactId} name={name} className="pointer-events-auto block truncate text-base font-medium">{name}</ClientLink>
        <span className="block text-xs text-muted">{i.stageName}</span>
        <span className={`sm:hidden flex items-center gap-1 mt-0.5 text-xs font-semibold tabular ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={12} className="shrink-0" /><StatusText i={i} /></span>
      </span>
      <span className={`pointer-events-none hidden sm:inline-flex items-center gap-1 text-sm font-semibold tabular text-right ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={14} className="shrink-0" /><StatusText i={i} /></span>
      <IconArrowRight size={15} className="pointer-events-none text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </div>
  );
```

`src/components/today/attendance-list.tsx` (imports `ClientLink`, `IconChat`), trocar o `<Link href={leadHref(i.dealId)} …>` (linhas 45-51) por:

```tsx
              <span className="flex min-h-11 min-w-0 flex-1 basis-40 items-center gap-2.5">
                <ClientLink contactId={i.contactId} name={name} className="flex min-w-0 items-center gap-2.5">
                  <ContactAvatar contactId={i.contactId} hasAvatar={i.hasAvatar} name={name} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium">{name}</span>
                    <span className="block text-sm text-graphite tabular">{dueLabel(new Date(i.scheduledAt).getTime(), nowMs)}</span>
                  </span>
                </ClientLink>
                <Link href={leadHref(i.dealId)} aria-label={`Abrir conversa com ${name}`} className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-2 lg:size-9"><IconChat size={16} /></Link>
              </span>
```

`src/components/today/next-actions.tsx` (import `ClientLink`), trocar o `<Link …>` da linha 40 pelo título como link e o nome por cima:

```tsx
            <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1">
              <Link href={t.dealId ? leadHref(t.dealId) : `/contatos/${t.contactId}`} className="text-base font-medium leading-snug rounded-[var(--radius-control)] hover:underline underline-offset-4">{t.title}</Link>
              <span className="text-sm leading-snug text-graphite">
                <ClientLink contactId={t.contactId} name={t.name}>{t.name}</ClientLink> · <span className={cn("tabular", t.overdue && "font-semibold text-alert")}>{t.overdue ? "atrasada " : ""}{dueLabel(new Date(t.dueAt).getTime(), nowMs)}</span>
              </span>
            </div>
```

`e2e/hoje.spec.ts:133`: a linha agora tem dois links (o título leva à conversa; o nome, à ficha):

```ts
  expect(await itens.nth(0).getByRole("link", { name: "Mandar os valores da hidratação" }).getAttribute("href")).toBe(`/atendimento?lead=${d.dealId}`);
```

`src/app/(app)/page.tsx`, seção "Esperando resposta" (linhas 122-124): dar nome à região, para o leitor de tela e para o e2e:

```tsx
        <section aria-labelledby="h-esperando" className="rounded-[var(--radius-panel)] border border-line bg-paper">
          {/* … */}
            <h2 id="h-esperando" className="font-display text-[22px] font-medium">Esperando resposta</h2>
```

`src/app/(app)/page.tsx` (Aniversários da semana, linha 156): o nome abre a ficha sempre:

```tsx
                    <Link href={contactHref(b.contactId)} aria-label={`Ficha de ${b.name}, aniversário ${b.today ? "hoje" : b.label}`} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink transition-colors">
```

(import `contactHref` de `@/lib/lead-href`; o `leadHref` continua importado se outra parte da página usar.)

- [ ] **Passo 5: Sino**

`src/server/queries/alerts.ts`: no `select` acrescentar `contactId: contacts.id,` e no `return` do `map` acrescentar `contactId,` (desestruture `({ a, contactName, phone, contactId })`).

`src/components/shell/alerts-bell.tsx` (imports `contactHref`), dentro do `<li>` de cada aviso, logo antes do botão "Assumir" da oferta:

```tsx
                        {a.contactId && (
                          <Link href={contactHref(a.contactId)} onClick={() => setOpen(false)} aria-label={`Ficha de ${a.contactName?.trim() || "cliente"}`}
                            className="self-center mr-2 inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line-strong px-3 text-sm font-medium text-ink shrink-0 hover:bg-paper-2 pointer-coarse:min-h-11">Ficha</Link>
                        )}
```

- [ ] **Passo 6: Agenda (mínimo: o nome abre o painel do horário, que leva à ficha)**

`src/components/agenda/agenda-board.tsx`, linhas 73-75 e 134-136: o horário vindo de conversa passa a abrir o painel como os do Avec (o painel tem "Abrir conversa" e "Abrir ficha da cliente"):

```tsx
                  <button type="button" onClick={() => setOpenKey(i.key)} className={whoCls} aria-haspopup="dialog">{who}</button>
```

(na linha 134-136, o mesmo com `cls` e `body`). Se `leadHref` ficar sem uso no arquivo, tire o import.

`src/components/agenda/entry-sheet.tsx` (import `contactHref`), trocar a linha 35 e o link da linha 41:

```tsx
  const links = i ? [
    ...(i.source === "lead" && i.dealId ? [{ href: leadHref(i.dealId), label: "Abrir conversa" }] : []),
    ...(i.contactId ? [{ href: contactHref(i.contactId), label: "Abrir ficha da cliente" }] : []),
  ] : [];
```

```tsx
          {links.length > 0 && (
            <span className="mr-auto flex flex-wrap gap-x-4">
              {links.map((l) => <Link key={l.href} href={l.href} className="inline-flex h-10 items-center text-sm font-medium text-gold-ink underline-offset-4 hover:underline pointer-coarse:min-h-11">{l.label}</Link>)}
            </span>
          )}
```

- [ ] **Passo 7: Relatórios (cobranças)**

`src/server/reports/queries.ts:197`: `export type ChargeItem = { id: string; contactId: string; name: string | null; phone: string; chargeAt: string; remainingCents: number };` e no `select` da linha 210: `select d.id, d.contact_id as "contactId", c.name, …`.

`src/components/reports/analysis.tsx` (import `ClientLink`), trocar o `<li>` da linha 140-145:

```tsx
            <li key={c.id} className="relative border-t border-line">
              <Link href={leadHref(c.id)} aria-label={`Abrir conversa: cobrança de ${c.name ?? formatPhoneClient(c.phone)}`} className="absolute inset-0" />
              <div className="pointer-events-none flex flex-wrap items-baseline justify-between gap-x-3 min-h-11 py-2 text-[14px]">
                <ClientLink contactId={c.contactId} name={c.name ?? formatPhoneClient(c.phone)} className="pointer-events-auto">{c.name ?? formatPhoneClient(c.phone)}</ClientLink>
                <span className="tabular text-muted">{dateTime(c.chargeAt)} · {money(c.remainingCents)}</span>
              </div>
            </li>
```

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde (inclusive `agenda-board.test.tsx` e `pro-grid.test.tsx`).

Rodar: `npx playwright test e2e/ficha-cliques.spec.ts e2e/hoje.spec.ts e2e/jornada.spec.ts e2e/quadro.spec.ts e2e/alertas.spec.ts e2e/relatorios.spec.ts e2e/a11y.spec.ts`
Esperado: PASS (desktop e celular onde o spec roda nos dois). O a11y não pode acusar link dentro de link nem nome acessível vazio.

- [ ] **Passo 9: Commit**

```bash
git add src/components/lead/lead-sheet.tsx src/components/journey/station.tsx src/server/queries/today.ts src/components/today/ "src/app/(app)/page.tsx" \
  src/server/queries/alerts.ts src/components/shell/alerts-bell.tsx src/components/agenda/agenda-board.tsx src/components/agenda/entry-sheet.tsx src/components/agenda/agenda-board.test.tsx \
  src/server/reports/queries.ts src/components/reports/analysis.tsx e2e/hoje.spec.ts e2e/jornada.spec.ts e2e/ficha-cliques.spec.ts
git commit -m "feat(ficha): nome e foto abrem a ficha no Quadro, Jornada, Hoje, sino, Agenda e Relatórios (sem link dentro de link)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 11: Relatórios do Avec com o nome da cliente clicável

**Files:**
- Create: `src/server/queries/avec-links.ts`, `src/server/queries/avec-links.test.ts`
- Modify: `src/app/(app)/relatorios/avec/[id]/page.tsx` (corpo da tabela; `grep -n "r.rows.map" "src/app/(app)/relatorios/avec/[id]/page.tsx"`)

**Interfaces:**
- Consumes: `ImportCtx` (`src/server/domain/avec/context.ts`: `contactOf(row)` acha pelo telefone e, sem telefone, pelo nome quando há um contato só com esse nome), `COLS`, `colOf` (`src/server/domain/avec/formats.ts`; confirme com `grep -n "export function colOf\|export const colOf" src/server/domain/avec/*.ts`), `contactHref`.
- Produces: `linkAvecRows(columns: string[], rows: string[][]): Promise<{ clientCol: number; contactIds: (string | null)[] }>` (só leitura; mesma regra da importação). A tabela mostra a célula do cliente como link para a ficha quando acha o contato.

- [ ] **Passo 1: Escrever o teste que falha**

`src/server/queries/avec-links.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { linkAvecRows } from "./avec-links";

let rita = "", ana = "";
beforeEach(async () => {
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000501" }).returning())[0].id;
  ana = (await db.insert(contacts).values({ name: "Ana Única Fictícia", phoneE164: "+5571966000502" }).returning())[0].id;
  await db.insert(contacts).values([{ name: "Bia Repetida", phoneE164: "+5571966000503" }, { name: "Bia Repetida", phoneE164: "+5571966000504" }]);
});

it("acha a cliente pelo telefone e, sem telefone, pelo nome único; nome repetido ou desconhecido fica sem link", async () => {
  const r = await linkAvecRows(["Cliente", "Celular", "Serviço"], [
    ["Rita F.", "(71) 96600-0501", "Escova"],
    ["Ana Única Fictícia", "", "Corte"],
    ["Bia Repetida", "", "Corte"],
    ["Ninguém Fictícia", "", "Corte"],
  ]);
  expect(r.clientCol).toBe(0);
  expect(r.contactIds).toEqual([rita, ana, null, null]);
});

it("relatório sem coluna de cliente: nada vira link", async () => {
  expect(await linkAvecRows(["Profissional", "Total"], [["MAIARA", "100"]])).toEqual({ clientCol: -1, contactIds: [null] });
});
```

Rodar: `npx vitest run src/server/queries/avec-links.test.ts`
Esperado: FAIL ("Failed to resolve import ./avec-links").

- [ ] **Passo 2: `src/server/queries/avec-links.ts`**

```ts
import { db } from "../db";
import { ImportCtx } from "../domain/avec/context";
import { COLS, colOf } from "../domain/avec/formats";

/**
 * Liga cada linha de um relatório do Avec guardado à ficha da cliente (Lote 2), com a MESMA regra da importação: telefone primeiro;
 * sem telefone, o nome quando só um contato tem esse nome. Só leitura (transação read only). Sem coluna de cliente, nada vira link.
 */
export async function linkAvecRows(columns: string[], rows: string[][]): Promise<{ clientCol: number; contactIds: (string | null)[] }> {
  const clientCol = colOf(columns, ...COLS.client);
  if (clientCol < 0 || !rows.length) return { clientCol, contactIds: rows.map(() => null) };
  const contactIds = await db.transaction(async (tx) => {
    const ctx = new ImportCtx(tx, columns, rows, []);
    const out: (string | null)[] = [];
    for (const row of rows) out.push(await ctx.contactOf(row)); // em sequência: o ImportCtx guarda o que já achou
    return out;
  }, { accessMode: "read only" });
  return { clientCol, contactIds };
}
```

Se `colOf` estiver em outro arquivo (`grep` do Interfaces), ajuste o import. A tabela tem no máximo 50 linhas por página (`AVEC_REPORT_PAGE_SIZE`), então a busca por nome (que lê os contatos uma vez) é feita uma vez por página.

- [ ] **Passo 3: A página do relatório**

Em `src/app/(app)/relatorios/avec/[id]/page.tsx`: imports `import { linkAvecRows } from "@/server/queries/avec-links";` e `import { contactHref } from "@/lib/lead-href";`. Depois de `if (!r) notFound();`:

```tsx
  const links = await linkAvecRows(r.columns, r.rows);
```

E no corpo da tabela (o `r.rows.map((row, i) => …)`), a célula de cada coluna passa a ser:

```tsx
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap border-b border-line/70 px-3 py-1.5">
                        {j === links.clientCol && links.contactIds[i]
                          ? <Link href={contactHref(links.contactIds[i]!)} className="font-medium text-gold-ink underline-offset-4 hover:underline">{cell}</Link>
                          : cell}
                      </td>
                    ))}
```

(Mantenha as classes que a `<td>` tem hoje; só o conteúdo muda.)

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/queries/avec-links.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 5: Commit**

```bash
git add src/server/queries/avec-links.ts src/server/queries/avec-links.test.ts "src/app/(app)/relatorios/avec/[id]/page.tsx"
git commit -m "feat(relatorios): nome da cliente nas tabelas do Avec abre a ficha (mesma regra de telefone/nome da importação)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 12: Lista de Contatos no servidor (filtros com contagem, filtros em lista, colunas e ordenação)

**Files:**
- Create: `src/lib/contact-list-params.ts`, `src/lib/contact-list-params.test.ts`
- Modify (reescrever): `src/server/queries/contacts.ts` (a busca atual fica igual por dentro)
- Create: `src/server/queries/contacts-filters.test.ts`
- Modify: `scripts/visao-contatos.ts` (imprime as contagens dos filtros)
- Test: `src/server/queries/contacts.test.ts` (os testes atuais continuam passando sem mudança)

**Interfaces:**
- Consumes: T1 (`contact_stats`, `contacts.preferred_professional_id`), T2 (constantes, `clientSituation`, `bahiaDay`, `birthdayLabel`), `lateExists`, `excerptAround`.
- Produces (`src/lib/contact-list-params.ts`, puro):
  - `CONTACT_FILTERS = ["sumidas", "na_hora", "aniversario_semana", "aniversario_mes", "com_pacote", "com_horario", "sem_dono", "nunca_voltou", "vip", "faltosas"] as const`, `type ContactFilter`, `CONTACT_FILTER_LABEL`, `CONTACT_FILTER_HELP`;
  - `CONTACT_SORTS = ["chegada", "ultima_visita", "visitas", "nome"] as const`, `type ContactSort`, `CONTACT_SORT_LABEL`;
  - `type ContactListParams = { q: string; onlyClients: boolean; includeIgnored: boolean; page: number; filter: ContactFilter | null; professionalId: string | null; service: string | null; tagId: string | null; origin: string | null; sort: ContactSort | null }`;
  - `parseContactListParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): ContactListParams` (chaves da URL: `q`, `clientes`, `ignorados`, `p`, `f`, `pro`, `svc`, `tag`, `origem`, `ordem`);
  - `contactListQuery(p: ContactListParams, over?: Partial<ContactListParams>): string` (o `?…` da URL; sem página 1, sem vazios).
- Produces (`src/server/queries/contacts.ts`):
  - `type ContactListOpts = Partial<ContactListParams> & { now?: Date; ids?: string[]; pageSize?: number }`;
  - `ContactRow` ganha `visits`, `lastVisitOn`, `nextAppointmentAt`, `nextProfessional`, `preferredProfessional`, `pkg: { used: number; total: number } | null`, `birthday: string | null` ("17/10"), `origin: string | null`, `situation: string`, `states: SituationState[]`;
  - `listContacts(opts: ContactListOpts): Promise<{ rows: ContactRow[]; total: number; page: number; size: number }>` (sem `sort`: com busca, por parecido; sem busca, por chegada, como hoje);
  - `contactFilterCounts(opts: ContactListOpts, runner?: Tx | typeof db): Promise<Record<ContactFilter, number>>` (contagem de cada botão com a busca e os filtros em lista aplicados, sem o próprio botão);
  - `contactListOptions(): Promise<{ professionals: { id: string; name: string }[]; services: string[]; tags: { id: string; name: string }[]; origins: string[] }>`.
- Regras (as mesmas da ficha, pelas constantes de `client-rhythm.ts`):
  - **Sumidas:** sem horário (até 180 dias), com ritmo (ou ciclo) e dias desde a última visita > 1,5× o ritmo e < 365;
  - **Na hora de voltar:** sem horário, dias ≥ 0,8× e ≤ 1,5× o ritmo;
  - **Aniversário na semana:** hoje e os próximos 7 dias (29/02 cai em 28/02 em ano não bissexto, como no Hoje); **no mês:** mês de hoje;
  - **Com pacote:** pacote com sessão sobrando e dentro da validade; **Com horário:** agendado ou confirmado nos próximos 180 dias;
  - **Sem dono:** conversa aberta, não encerrada, sem dona; **Nunca voltou:** 1 visita; **VIP:** 12+ visitas ou total ≥ o corte das 10% que mais gastaram; **Faltosas:** 2+ faltas;
  - **Profissional:** a preferida (escolhida na ficha ou calculada); **Serviço:** já fez esse serviço (comanda do Avec); **Etiqueta**; **Origem:** "Como conheceu"/origem do primeiro lead.

- [ ] **Passo 1: Escrever os testes que falham**

`src/lib/contact-list-params.test.ts`:

```ts
import { expect, it } from "vitest";
import { contactListQuery, parseContactListParams } from "./contact-list-params";

it("lê a URL; valores desconhecidos viram 'sem filtro'; a URL volta igual (sem página 1 e sem vazios)", () => {
  const p = parseContactListParams(new URLSearchParams("q=ana&f=sumidas&pro=0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f&svc=Escova&ordem=visitas&p=2&clientes=1"));
  expect(p).toMatchObject({ q: "ana", filter: "sumidas", professionalId: "0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f", service: "Escova", sort: "visitas", page: 2, onlyClients: true, includeIgnored: false });
  expect(parseContactListParams({ f: "inventado", ordem: "x", pro: "não-é-uuid", p: "-3" })).toMatchObject({ filter: null, sort: null, professionalId: null, page: 1 });
  expect(contactListQuery(p, { page: 1, filter: null })).toBe("?q=ana&clientes=1&pro=0b9b1d1e-2f3a-4c5d-8e9f-0a1b2c3d4e5f&svc=Escova&ordem=visitas");
});
```

`src/server/queries/contacts-filters.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contactStats, contactTags, contacts, deals, professionals, salesItems, stages, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { contactFilterCounts, listContacts } from "./contacts";
import { CONTACT_FILTERS, type ContactFilter } from "../../lib/contact-list-params";
import { addDaysTo, returnInfo } from "../../lib/client-rhythm";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const HOJE = "2026-10-15";
let seq = 0;
/** Contato com a linha da visão por contato montada à mão (estes testes são da SQL da lista, não do recálculo). */
async function cliente(name: string, st: Partial<typeof contactStats.$inferInsert> = {}, extra: Partial<typeof contacts.$inferInsert> = {}) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+5571967${String(++seq).padStart(6, "0")}`, ...extra }).returning();
  await db.insert(contactStats).values({ contactId: c.id, ...st });
  return c.id;
}
const nomes = async (filter: ContactFilter) => (await listContacts({ filter, now: NOW, sort: "nome" })).rows.map((r) => r.name);
const visita = (diasAtras: number, ritmo = 40) => ({ visits: 5, lastVisitOn: addDaysTo(HOJE, -diasAtras), rhythmDays: ritmo });

beforeEach(async () => { seq = 0; await resetDb(); });

it("ficha e filtro concordam nas bordas (0,8×, 1,5×, 365 dias e horário a 181 dias)", async () => {
  const dias = [31, 32, 60, 61, 364, 365];
  for (const d of dias) await cliente(`Borda ${String(d).padStart(3, "0")}`, visita(d));
  const longe = await cliente("Borda Longe", visita(61));
  await db.insert(appointments).values({ contactId: longe, startsAt: new Date(NOW.getTime() + 181 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:longe" });
  const naHora = await nomes("na_hora"), sumidas = await nomes("sumidas");
  for (const d of dias) {
    const st = returnInfo({ lastVisitOn: addDaysTo(HOJE, -d), rhythmDays: 40, cycleDays: null, hasFuture: false }, HOJE)!.status;
    const nome = `Borda ${String(d).padStart(3, "0")}`;
    expect([d, naHora.includes(nome)]).toEqual([d, st === "na_hora"]);
    expect([d, sumidas.includes(nome)]).toEqual([d, st === "sumida"]);
  }
  expect(sumidas).toContain("Borda Longe"); // horário a 181 dias não conta
  expect(await nomes("com_horario")).not.toContain("Borda Longe");
});

it("cada botão filtra o que diz e a contagem bate com a lista", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const semana = await cliente("Aniversário Semana", {}, { birthDay: 22, birthMonth: 10 });
  await cliente("Aniversário Fora", {}, { birthDay: 23, birthMonth: 11 });
  const pacote = await cliente("Com Pacote");
  await db.insert(clientPackages).values([
    { contactId: pacote, packageName: "Hidratação 10x", totalSessions: 10, usedSessions: 3, validUntil: "2027-01-01", externalKey: "t:pk1" },
    { contactId: await cliente("Pacote Usado"), packageName: "Escova 4x", totalSessions: 4, usedSessions: 4, externalKey: "t:pk2" },
  ]);
  const horario = await cliente("Com Horário", visita(70));
  await db.insert(appointments).values({ contactId: horario, startsAt: new Date(NOW.getTime() + 3 * 86_400_000), status: "confirmado", serviceLabel: "Corte", externalKey: "t:h1" });
  const semDono = await cliente("Sem Dono");
  await db.insert(deals).values({ contactId: semDono, stageId: lead.id });
  await db.insert(deals).values({ contactId: await cliente("Com Dona"), stageId: lead.id, ownerId: ana.id });
  await cliente("Uma Visita", { visits: 1, lastVisitOn: addDaysTo(HOJE, -200) });
  await cliente("Doze Visitas", { visits: 12, lastVisitOn: addDaysTo(HOJE, -5), rhythmDays: 30 });
  await cliente("Faltosa", { noShows: 2 });
  await cliente("Faltou Uma", { noShows: 1 });

  expect(await nomes("aniversario_semana")).toEqual(["Aniversário Semana"]);
  expect(await nomes("aniversario_mes")).toEqual(["Aniversário Semana"]);
  expect(await nomes("com_pacote")).toEqual(["Com Pacote"]);
  expect(await nomes("com_horario")).toEqual(["Com Horário"]);
  expect(await nomes("sumidas")).not.toContain("Com Horário"); // com horário marcado não é sumida
  expect(await nomes("sem_dono")).toEqual(["Sem Dono"]);
  expect(await nomes("nunca_voltou")).toEqual(["Uma Visita"]);
  expect(await nomes("vip")).toEqual(["Doze Visitas"]);
  expect(await nomes("faltosas")).toEqual(["Faltosa"]);
  const counts = await contactFilterCounts({ now: NOW });
  for (const f of CONTACT_FILTERS) expect([f, counts[f]]).toEqual([f, (await listContacts({ filter: f, now: NOW })).total]);
  void semana;
});

it("VIP também pelas 10% que mais gastaram", async () => {
  for (let i = 1; i <= 10; i++) await cliente(`Gasto ${String(i).padStart(2, "0")}`, { totalCents: i * 100_000, tickets: 1, visits: 1 });
  expect(await nomes("vip")).toEqual(["Gasto 09", "Gasto 10"]);
});

it("filtros em lista: profissional (ficha vale mais que a calculada), serviço já feito, etiqueta e origem; ordenação", async () => {
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [luana] = await db.insert(professionals).values({ name: "LUANA" }).returning();
  const calc = await cliente("Calculada Maiara", { preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", visits: 3, lastVisitOn: addDaysTo(HOJE, -10) });
  await cliente("Escolhida Luana", { preferredProfessionalId: maiara.id, preferredProfessionalName: "MAIARA", visits: 8, lastVisitOn: addDaysTo(HOJE, -50) }, { preferredProfessionalId: luana.id });
  await db.insert(salesItems).values({ contactId: calc, soldOn: addDaysTo(HOJE, -10), item: "Progressiva", kind: "servico", externalKey: "t:s1" });
  const [noiva] = await db.insert(tags).values({ name: "Noiva" }).returning();
  const insta = await cliente("Veio Do Insta", { originLabel: "Instagram", visits: 1, lastVisitOn: addDaysTo(HOJE, -1) });
  await db.insert(contactTags).values({ contactId: insta, tagId: noiva.id });
  const so = async (o: object) => (await listContacts({ now: NOW, ...o })).rows.map((r) => r.name);
  expect(await so({ professionalId: maiara.id })).toEqual(["Calculada Maiara"]);
  expect(await so({ professionalId: luana.id })).toEqual(["Escolhida Luana"]);
  expect(await so({ service: "progressiva" })).toEqual(["Calculada Maiara"]);
  expect(await so({ tagId: noiva.id })).toEqual(["Veio Do Insta"]);
  expect(await so({ origin: "Instagram" })).toEqual(["Veio Do Insta"]);
  expect(await so({ sort: "ultima_visita" })).toEqual(["Veio Do Insta", "Calculada Maiara", "Escolhida Luana"]);
  expect(await so({ sort: "visitas" })).toEqual(["Escolhida Luana", "Calculada Maiara", "Veio Do Insta"]);
});

it("linha de contato só do WhatsApp (número oculto, sem nome, sem visita): frase sem NaN, -1, undefined ou lid:", async () => {
  const [c] = await db.insert(contacts).values({ name: null, phoneE164: "lid:5550001" }).returning();
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: c.id, stageId: lead.id, awaitingReplySince: new Date(NOW.getTime() - 5 * 60_000) });
  const [row] = (await listContacts({ now: NOW })).rows;
  expect(row).toMatchObject({ visits: 0, lastVisitOn: null, nextAppointmentAt: null, pkg: null, birthday: null, states: ["sem_dono"] });
  expect(row.situation).toBe("Sem dono · ainda não veio à Casa"); // a coluna usa a frase curta (a ficha mostra a inteira)
  expect(JSON.stringify(row)).not.toMatch(/NaN|undefined|há -\d/);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/contact-list-params.test.ts src/server/queries/contacts-filters.test.ts`
Esperado: FAIL ("./contact-list-params" não existe; `listContacts` não conhece `filter`).

- [ ] **Passo 3: `src/lib/contact-list-params.ts`**

```ts
import { isUuid } from "./uuid";

/** Filtros, ordenação e a URL da lista de Contatos (Lote 2). Puro: a página, o CSV e o servidor leem a URL do mesmo jeito. */
export const CONTACT_FILTERS = ["sumidas", "na_hora", "aniversario_semana", "aniversario_mes", "com_pacote", "com_horario", "sem_dono", "nunca_voltou", "vip", "faltosas"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];
export const CONTACT_FILTER_LABEL: Record<ContactFilter, string> = {
  sumidas: "Sumidas", na_hora: "Na hora de voltar", aniversario_semana: "Aniversário na semana", aniversario_mes: "Aniversário no mês",
  com_pacote: "Com pacote", com_horario: "Com horário", sem_dono: "Sem dono", nunca_voltou: "Nunca voltou", vip: "VIP", faltosas: "Faltosas",
};
export const CONTACT_FILTER_HELP: Record<ContactFilter, string> = {
  sumidas: "Passou de 1,5 vez o ritmo dela sem voltar, sem horário marcado e há menos de 1 ano.",
  na_hora: "Está entre 0,8 e 1,5 vez o ritmo dela desde a última visita e não tem horário marcado.",
  aniversario_semana: "Faz aniversário hoje ou nos próximos 7 dias.",
  aniversario_mes: "Faz aniversário neste mês.",
  com_pacote: "Tem pacote com sessão sobrando e dentro da validade.",
  com_horario: "Tem horário marcado nos próximos 180 dias.",
  sem_dono: "Tem conversa aberta e ninguém assumiu.",
  nunca_voltou: "Veio uma vez só.",
  vip: "12 visitas ou mais, ou entre as 10% que mais gastaram.",
  faltosas: "Faltou 2 vezes ou mais.",
};
export const CONTACT_SORTS = ["chegada", "ultima_visita", "visitas", "nome"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];
export const CONTACT_SORT_LABEL: Record<ContactSort, string> = { chegada: "Chegada no CRM", ultima_visita: "Última visita", visitas: "Mais visitas", nome: "Nome" };

export type ContactListParams = {
  q: string; onlyClients: boolean; includeIgnored: boolean; page: number;
  filter: ContactFilter | null; professionalId: string | null; service: string | null; tagId: string | null; origin: string | null; sort: ContactSort | null;
};

const one = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends string>(list: readonly T[], v: string): T | null => ((list as readonly string[]).includes(v) ? (v as T) : null);
const text = (v: string, max = 80) => v.trim().slice(0, max) || null;

export function parseContactListParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): ContactListParams {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) ?? "" : one(sp[k]));
  const page = Math.floor(Number(get("p")));
  return {
    q: get("q").trim().slice(0, 80), onlyClients: get("clientes") === "1", includeIgnored: get("ignorados") === "1", page: page >= 1 ? page : 1,
    filter: pick(CONTACT_FILTERS, get("f")), sort: pick(CONTACT_SORTS, get("ordem")),
    professionalId: isUuid(get("pro")) ? get("pro") : null, tagId: isUuid(get("tag")) ? get("tag") : null,
    service: text(get("svc")), origin: text(get("origem")),
  };
}

/** O `?…` da lista com os mesmos parâmetros (mais as trocas de `over`); página 1 e vazios não entram. */
export function contactListQuery(p: ContactListParams, over: Partial<ContactListParams> = {}): string {
  const v = { ...p, ...over };
  const s = new URLSearchParams();
  if (v.q) s.set("q", v.q);
  if (v.onlyClients) s.set("clientes", "1");
  if (v.includeIgnored) s.set("ignorados", "1");
  if (v.filter) s.set("f", v.filter);
  if (v.professionalId) s.set("pro", v.professionalId);
  if (v.service) s.set("svc", v.service);
  if (v.tagId) s.set("tag", v.tagId);
  if (v.origin) s.set("origem", v.origin);
  if (v.sort) s.set("ordem", v.sort);
  if (v.page > 1) s.set("p", String(v.page));
  return s.size ? `?${s}` : "";
}
```

- [ ] **Passo 4: `src/server/queries/contacts.ts`**

Trocar o arquivo inteiro por:

```ts
import { sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "../db";
import { excerptAround } from "../../lib/highlight";
import { lateExists } from "./late-count";
import { clientSituation, type SituationState } from "../../lib/client-situation";
import { BIRTHDAY_WEEK_DAYS, FALTOSA_MIN, FUTURE_HORIZON_DAYS, GONE_MAX_DAYS, RETURN_GONE, RETURN_SOON, VIP_MIN_VISITS, VIP_TOP_SHARE } from "../../lib/client-rhythm";
import { birthdayLabel } from "../../lib/birthday";
import { CONTACT_FILTERS, type ContactFilter, type ContactListParams, type ContactSort } from "../../lib/contact-list-params";
import { isUuid } from "../../lib/uuid";

/** Mensagens varridas por busca (as mais recentes que casam): o limite mantém a busca rápida mesmo com o histórico inteiro importado. */
export const MESSAGE_HIT_LIMIT = 500;
/** A busca de trecho de mensagem só começa com 3 letras (o índice trigram não ajuda com menos) e o nome parecido, com 4. */
const MESSAGE_MIN = 3, FUZZY_MIN = 4;
const TZ = "America/Bahia";

/** Texto do usuário vira padrão de ILIKE: `%`, `_` e `\` valem como texto. */
const likeOf = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

export type ContactRow = {
  id: string; name: string | null; phone: string; email: string | null; instagram: string | null;
  isClient: boolean; clientSince: string | null; lastServiceAt: string | null; ignored: boolean; hasAvatar: boolean;
  /** O lead mais recente (qualquer estado) e o lead em andamento, se houver, com quem cuida dele. */
  lastDealId: string | null; openDealId: string | null; openDealOwnerId: string | null; openDealOwnerName: string | null; deals: number;
  /** A mensagem em que o termo apareceu (recortada em volta do acerto), quando a busca achou por ela. */
  snippet: { text: string; at: string } | null;
  /** Lote 2: colunas da lista (da visão por contato e ao vivo). */
  visits: number; lastVisitOn: string | null; nextAppointmentAt: string | null; nextProfessional: string | null;
  preferredProfessional: string | null; pkg: { used: number; total: number } | null; birthday: string | null; origin: string | null;
  /** A frase curta e os estados (a mesma regra da ficha). */
  situation: string; states: SituationState[];
};

export type ContactListOpts = Partial<ContactListParams> & { now?: Date; ids?: string[]; pageSize?: number };

const dayOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

/** Busca e filtros em lista: o "onde" comum à lista, à contagem dos botões e ao CSV. */
function base(opts: ContactListOpts) {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const today = sql`((${at}::timestamptz at time zone ${TZ})::date)`;
  const term = opts.q?.trim().slice(0, 80) ?? "";
  const like = likeOf(term);
  const digits = term.replace(/\D/g, "");
  const byMessage = term.length >= MESSAGE_MIN;
  // Telefone só quando o termo se parece com telefone: "100%" tem dígitos, mas não é número.
  const byPhone = digits.length >= 3 && /^[\d\s()+.-]+$/.test(term) ? sql`c.phone_e164 like ${`%${digits}%`}` : sql`false`;
  const byName = sql`(coalesce(c.name, '') ilike ${like}${term.length >= FUZZY_MIN ? sql` or c.name % ${term}` : sql``})`;

  const conds: SQL[] = [sql`true`];
  if (!opts.includeIgnored) conds.push(sql`not c.ignored`);
  if (opts.onlyClients) conds.push(sql`c.is_client`);
  if (term) conds.push(sql`(${byName} or coalesce(c.email, '') ilike ${like} or ${byPhone}${byMessage ? sql` or h.contact_id is not null` : sql``})`);
  if (opts.ids?.length) conds.push(sql`c.id = any(${opts.ids.filter(isUuid)}::uuid[])`);
  if (opts.professionalId && isUuid(opts.professionalId)) conds.push(sql`coalesce(c.preferred_professional_id, s.preferred_professional_id) = ${opts.professionalId}`);
  if (opts.service) conds.push(sql`exists (select 1 from sales_items si where si.contact_id = c.id and si.kind = 'servico' and lower(trim(si.item)) = lower(${opts.service}))`);
  if (opts.tagId && isUuid(opts.tagId)) conds.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${opts.tagId})`);
  if (opts.origin) conds.push(sql`s.origin_label = ${opts.origin}`);

  // Uma mensagem por contato (a mais recente que casa). Os filtros do contato valem ANTES do limite (um ignorado cheio de mensagens não gasta as vagas).
  const hitConds: SQL[] = [sql`m.body ilike ${like}`, sql`m.deleted_at is null`];
  if (!opts.includeIgnored) hitConds.push(sql`not hc.ignored`);
  if (opts.onlyClients) hitConds.push(sql`hc.is_client`);
  const hits = term && byMessage
    ? sql`hits as (
        select distinct on (contact_id) contact_id, body, created_at from (
          select m.contact_id, m.body, m.created_at from messages m join contacts hc on hc.id = m.contact_id
          where ${sql.join(hitConds, sql` and `)} order by m.created_at desc limit ${MESSAGE_HIT_LIMIT}
        ) m order by contact_id, created_at desc)`
    : sql`hits as (select null::uuid as contact_id, null::text as body, null::timestamptz as created_at where false)`;

  // Uma linha por contato, com a visão (s), o próximo horário até 180 dias (fut), a conversa aberta (od) e o pacote ativo (pk).
  const from = sql`
    from contacts c
    left join contact_stats s on s.contact_id = c.id
    left join hits h on h.contact_id = c.id
    left join lateral (
      select a.starts_at, p.name as pro_name from appointments a left join professionals p on p.id = a.professional_id
       where a.contact_id = c.id and a.status in ('agendado', 'confirmado') and a.starts_at > ${at}::timestamptz
         and a.starts_at <= ${at}::timestamptz + ${FUTURE_HORIZON_DAYS} * interval '1 day'
       order by a.starts_at limit 1) fut on true
    left join lateral (
      select d.id, d.owner_id, d.awaiting_reply_since, d.stage_entered_at, d.conversation_archived_at, st.name as stage_name, st.kind::text as stage_kind,
             ${lateExists(sql`d.id`)} as late
        from deals d join stages st on st.id = d.stage_id
       where d.contact_id = c.id and d.closed_at is null and d.archived_at is null
       order by d.created_at desc limit 1) od on true
    left join users ou on ou.id = od.owner_id
    left join lateral (
      select p.used_sessions, p.total_sessions from client_packages p
       where p.contact_id = c.id and p.used_sessions < p.total_sessions and (p.valid_until is null or p.valid_until >= ${today})
       order by p.valid_until asc nulls last limit 1) pk on true`;

  const vipCut = sql`(select percentile_disc(${1 - VIP_TOP_SHARE}::float8) within group (order by total_cents) from contact_stats where total_cents > 0)`;
  const order = term
    ? sql`greatest(similarity(coalesce(c.name, ''), ${term}), case when coalesce(c.name, '') ilike ${like} then 0.7 else 0 end, case when ${byPhone} then 0.9 else 0 end, case when h.contact_id is not null then 0.2 else 0 end) desc, c.created_at desc, c.id`
    : sql`c.created_at desc, c.id`;
  return { now, today, term, where: sql.join(conds, sql` and `), hits, from, vipCut, order };
}

/** O que cada botão de filtro quer dizer, em SQL (as mesmas comparações de `returnInfo`, em src/lib/client-rhythm.ts). */
function filterSql(f: ContactFilter, today: SQL, vipCut: SQL): SQL {
  const every = sql`coalesce(s.rhythm_days, s.cycle_days)`;
  const since = sql`(${today} - s.last_visit_on)`;
  switch (f) {
    case "na_hora": return sql`(fut.starts_at is null and ${every} is not null and ${since} >= ${RETURN_SOON}::numeric * ${every} and ${since} <= ${RETURN_GONE}::numeric * ${every})`;
    case "sumidas": return sql`(fut.starts_at is null and ${every} is not null and ${since} > ${RETURN_GONE}::numeric * ${every} and ${since} < ${GONE_MAX_DAYS})`;
    case "aniversario_semana": return sql`exists (select 1 from generate_series(0, ${BIRTHDAY_WEEK_DAYS}) g
      where extract(month from (${today} + g))::int = c.birth_month and (extract(day from (${today} + g))::int = c.birth_day
        or (c.birth_month = 2 and c.birth_day = 29 and extract(day from (${today} + g))::int = 28
            and extract(day from (date_trunc('year', (${today} + g)) + interval '1 month 28 days'))::int <> 29)))`;
    case "aniversario_mes": return sql`(c.birth_month = extract(month from ${today})::int)`;
    case "com_pacote": return sql`(pk.total_sessions is not null)`;
    case "com_horario": return sql`(fut.starts_at is not null)`;
    case "sem_dono": return sql`(od.id is not null and od.owner_id is null and od.conversation_archived_at is null)`;
    case "nunca_voltou": return sql`(s.visits = 1)`;
    case "vip": return sql`(s.visits >= ${VIP_MIN_VISITS} or (s.total_cents > 0 and s.total_cents >= ${vipCut}))`;
    case "faltosas": return sql`(s.no_shows >= ${FALTOSA_MIN})`;
  }
}

const SORT: Record<ContactSort, SQL> = {
  chegada: sql`c.created_at desc, c.id`,
  ultima_visita: sql`s.last_visit_on desc nulls last, c.created_at desc, c.id`,
  visitas: sql`coalesce(s.visits, 0) desc, s.last_visit_on desc nulls last, c.id`,
  nome: sql`c.name is null, lower(c.name), c.id`,
};

/**
 * A lista de Contatos e a busca. Com termo: nome (também parecido, `pg_trgm`), e-mail, telefone (só os dígitos) e trecho de mensagem.
 * Filtros (Lote 2): um botão (`filter`) e os filtros em lista (profissional, serviço, etiqueta, origem). Ordem: a pedida; sem pedido,
 * por parecido (com busca) ou por chegada (sem busca), como antes. "Não é cliente" fica de fora, a não ser que `includeIgnored`.
 */
export async function listContacts(opts: ContactListOpts) {
  const size = Math.min(5000, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const b = base(opts);
  const where = opts.filter ? sql`${b.where} and ${filterSql(opts.filter, b.today, b.vipCut)}` : b.where;
  const order = opts.sort ? SORT[opts.sort] : b.order;
  const rows = (await db.execute(sql`
    with ${b.hits}
    select c.id, c.name, c.phone_e164 as phone, c.email, c.instagram, c.is_client as "isClient", c.client_since as "clientSince", c.last_service_at as "lastServiceAt",
      c.ignored, (c.avatar_path is not null) as "hasAvatar", c.birth_day as "birthDay", c.birth_month as "birthMonth", h.body as "hitBody", h.created_at as "hitAt",
      (select d.id from deals d where d.contact_id = c.id order by d.created_at desc limit 1) as "lastDealId",
      od.id as "openDealId", od.owner_id as "openDealOwnerId", ou.name as "openDealOwnerName",
      (select count(*)::int from deals d where d.contact_id = c.id) as deals,
      coalesce(s.visits, 0) as visits, s.last_visit_on as "lastVisitOn", s.rhythm_days as "rhythmDays", s.cycle_days as "cycleDays", s.origin_label as origin,
      fut.starts_at as "nextAt", fut.pro_name as "nextProfessional",
      coalesce(cp.name, s.preferred_professional_name) as "preferredProfessional",
      pk.used_sessions as "pkgUsed", pk.total_sessions as "pkgTotal",
      od.stage_name as "stageName", od.stage_kind as "stageKind", od.awaiting_reply_since as "awaitingSince", od.stage_entered_at as "stageEnteredAt",
      od.conversation_archived_at as "convArchivedAt", coalesce(od.late, false) as late
    ${b.from}
    left join professionals cp on cp.id = c.preferred_professional_id
    where ${where}
    order by ${order} limit ${size} offset ${(page - 1) * size}`)).rows as Record<string, unknown>[];
  const [{ total }] = (await db.execute(sql`with ${b.hits} select count(*)::int as total ${b.from} where ${where}`)).rows as { total: number }[];

  const nowMs = b.now.getTime();
  return {
    rows: rows.map((r): ContactRow => {
      const birthDay = r.birthDay as number | null, birthMonth = r.birthMonth as number | null;
      const nextAt = isoOf(r.nextAt);
      const conv = r.openDealId && !r.convArchivedAt ? {
        stageName: String(r.stageName), stageKind: String(r.stageKind), ownerName: (r.openDealOwnerName as string | null) ?? null,
        enteredAt: isoOf(r.stageEnteredAt)!, awaitingSince: isoOf(r.awaitingSince), late: !!r.late,
      } : null;
      const s = clientSituation({
        lastVisitOn: dayOf(r.lastVisitOn), rhythmDays: (r.rhythmDays as number | null) ?? null, cycleDays: (r.cycleDays as number | null) ?? null,
        nextAppointment: nextAt ? { startsAt: nextAt, professionalName: (r.nextProfessional as string | null) ?? null } : null,
        activePackage: r.pkgTotal != null ? { usedSessions: Number(r.pkgUsed), totalSessions: Number(r.pkgTotal) } : null,
        conversation: conv, birthday: birthDay && birthMonth ? { day: birthDay, month: birthMonth } : null,
      }, nowMs);
      return {
        id: String(r.id), name: (r.name as string | null) ?? null, phone: String(r.phone), email: (r.email as string | null) ?? null, instagram: (r.instagram as string | null) ?? null,
        isClient: !!r.isClient, clientSince: isoOf(r.clientSince), lastServiceAt: isoOf(r.lastServiceAt), ignored: !!r.ignored, hasAvatar: !!r.hasAvatar,
        lastDealId: (r.lastDealId as string | null) ?? null, openDealId: (r.openDealId as string | null) ?? null, openDealOwnerId: (r.openDealOwnerId as string | null) ?? null,
        openDealOwnerName: (r.openDealOwnerName as string | null) ?? null, deals: Number(r.deals),
        snippet: r.hitBody && r.hitAt ? { text: excerptAround(String(r.hitBody), b.term), at: isoOf(r.hitAt)! } : null,
        visits: Number(r.visits), lastVisitOn: dayOf(r.lastVisitOn), nextAppointmentAt: nextAt, nextProfessional: (r.nextProfessional as string | null) ?? null,
        preferredProfessional: (r.preferredProfessional as string | null) ?? null,
        pkg: r.pkgTotal != null ? { used: Number(r.pkgUsed), total: Number(r.pkgTotal) } : null,
        birthday: birthdayLabel(birthDay, birthMonth), origin: (r.origin as string | null) ?? null,
        situation: s.short, states: s.states,
      };
    }),
    total, page, size,
  };
}

/** A contagem de cada botão de filtro, com a busca e os filtros em lista aplicados (sem o próprio botão). `runner`: o ensaio passa a transação. */
export async function contactFilterCounts(opts: ContactListOpts, runner: Tx | typeof db = db): Promise<Record<ContactFilter, number>> {
  const b = base(opts);
  const cols = sql.join(CONTACT_FILTERS.map((f) => sql`count(*) filter (where ${filterSql(f, b.today, b.vipCut)})::int as ${sql.identifier(f)}`), sql`, `);
  const [row] = (await runner.execute(sql`with ${b.hits} select ${cols} ${b.from} where ${b.where}`)).rows as Record<ContactFilter, number>[];
  return row;
}

/** Opções dos filtros em lista: profissionais ativas, serviços já feitos (os 80 mais comuns), etiquetas e origens. */
export async function contactListOptions() {
  const [pros, services, tagRows, origins] = await Promise.all([
    db.execute(sql`select id, name from professionals where active order by name`),
    db.execute(sql`select trim(item) as item from sales_items where kind = 'servico' and nullif(trim(item), '') is not null group by trim(item) order by count(distinct contact_id) desc limit 80`),
    db.execute(sql`select id, name from tags order by lower(name)`),
    db.execute(sql`select origin_label from contact_stats where origin_label is not null group by origin_label order by count(*) desc limit 40`),
  ]);
  return {
    professionals: pros.rows as { id: string; name: string }[],
    services: (services.rows as { item: string }[]).map((r) => r.item).sort((a, b) => a.localeCompare(b, "pt-BR")),
    tags: tagRows.rows as { id: string; name: string }[],
    origins: (origins.rows as { origin_label: string }[]).map((r) => r.origin_label),
  };
}
```

`RETURN_SOON`/`RETURN_GONE` vão com `::numeric` de propósito: sem o cast, o Postgres lê `$1 * inteiro` como inteiro e 0,8 viraria erro.

- [ ] **Passo 5: O ensaio imprime as contagens dos filtros**

Em `scripts/visao-contatos.ts`, import `import { contactFilterCounts } from "../src/server/queries/contacts";` e, dentro da transação, logo antes do `if (!apply) tx.rollback();`:

```ts
      const f = await contactFilterCounts({ now: new Date() }, tx);
      console.log(`Filtros (auditoria 15/10: sumidas ~199 · na hora ~118 · aniversário semana 60 · mês 292 · nunca voltou 2.363):`);
      console.log(`  sumidas ${f.sumidas} · na hora ${f.na_hora} · aniversário semana ${f.aniversario_semana} · mês ${f.aniversario_mes} · nunca voltou ${f.nunca_voltou}`);
      console.log(`  com pacote ${f.com_pacote} · com horário ${f.com_horario} · sem dono ${f.sem_dono} · VIP ${f.vip} · faltosas ${f.faltosas}`);
```

(A semana do Hoje e da lista vai de hoje a hoje + 7 dias: pode dar alguns a mais que os 60 da auditoria, que contou 7 dias.)

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/lib/contact-list-params.test.ts src/server/queries/contacts-filters.test.ts src/server/queries/contacts.test.ts`
Esperado: PASS (os testes antigos da busca continuam verdes: a ordem padrão e os campos antigos não mudaram).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. `src/components/contacts/contacts-list.tsx` continua compilando (só ganhou campos).

- [ ] **Passo 7: Commit**

```bash
git add src/lib/contact-list-params.ts src/lib/contact-list-params.test.ts src/server/queries/contacts.ts src/server/queries/contacts-filters.test.ts scripts/visao-contatos.ts
git commit -m "feat(contatos): filtros com contagem (sumidas, na hora de voltar, aniversário, pacote, horário, sem dono, nunca voltou, VIP, faltosas), filtros em lista e ordenação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 13: Lista de Contatos na tela, ações em massa (etiquetar, exportar CSV, Não é cliente)

**Files:**
- Modify (reescrever): `src/app/(app)/contatos/page.tsx`
- Modify: `src/components/contacts/contacts-list.tsx` (colunas), `src/components/contacts/contacts-bulk-bar.tsx` (Etiquetar e Exportar)
- Modify: `src/server/domain/tags.ts` (`normalizeTagName`, `bulkTagContacts`), `src/server/domain/tags.test.ts`
- Modify: `src/app/(app)/contatos/actions.ts` (`tagContactsAction`)
- Create: `src/server/queries/contacts-csv.ts`, `src/server/queries/contacts-csv.test.ts`
- Create: `src/app/api/contatos/csv/route.ts`
- Modify: `e2e/contatos.spec.ts` (um teste novo)

**Interfaces:**
- Consumes (T12): `listContacts`, `contactFilterCounts`, `contactListOptions`, `parseContactListParams`, `contactListQuery`, `CONTACT_*`. Existentes: `toCsv`, `csvDisposition` (`src/server/reports/common.ts`), `findSessionUser`, `can`, `BULK_MAX`, `QueueSelectionProvider`/`useQueueSelection`.
- Produces:
  - `normalizeTagName(raw: string): string` (lança `UserFacingError` se vazio ou longo), `bulkTagContacts(contactIds: string[], name: string, userId: string): Promise<{ tag: Tag; tagged: number }>`;
  - `tagContactsAction(contactIds: string[], name: string): Promise<ActionResult<{ tag: string; tagged: number }>>`;
  - `EXPORT_MAX = 5000`, `type ContactExportRow = ContactRow & { tags: string[]; totalCents: number | null }`, `exportContactRows(opts: ContactListOpts, money: boolean): Promise<ContactExportRow[]>`, `contactsCsv(rows: ContactExportRow[], opts: { money: boolean }): string`;
  - `GET /api/contatos/csv?<os mesmos parâmetros da lista>[&ids=a,b,c]` (só com `contatos.ver` + `relatorios.exportar`; coluna "Total gasto" só com `valores.ver`).

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/queries/contacts-csv.test.ts`:

```ts
import { expect, it } from "vitest";
import { contactsCsv, type ContactExportRow } from "./contacts-csv";

const row = (o: Partial<ContactExportRow> = {}): ContactExportRow => ({
  id: "c1", name: "Rita Fictícia", phone: "+5571966000601", email: "rita@exemplo.com", instagram: null, isClient: true, clientSince: null, lastServiceAt: null,
  ignored: false, hasAvatar: false, lastDealId: null, openDealId: null, openDealOwnerId: null, openDealOwnerName: "Daniela Rezende", deals: 1, snippet: null,
  visits: 7, lastVisitOn: "2026-09-25", nextAppointmentAt: null, nextProfessional: null, preferredProfessional: "MAIARA", pkg: { used: 3, total: 10 },
  birthday: "17/10", origin: "Instagram", situation: "última visita há 20 dias", states: [], tags: ["Noiva", "VIP"], totalCents: 123_456, ...o,
});

it("CSV sem coluna de valor para quem não vê valores", () => {
  const csv = contactsCsv([row()], { money: false });
  const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
  expect(header).toBe("Nome;Telefone;E-mail;Situação;Última visita;Visitas;Próximo horário;Profissional preferida;Pacote;Aniversário;Responsável;Etiquetas;Como conheceu");
  expect(line).toBe("Rita Fictícia;+5571966000601;rita@exemplo.com;última visita há 20 dias;25/09/2026;7;;Maiara;3/10;17/10;Daniela Rezende;Noiva, VIP;Instagram");
  expect(csv).not.toMatch(/1234|Total gasto/);
});

it("com 'ver valores': coluna Total gasto; número oculto sai vazio; fórmula vira texto", () => {
  const csv = contactsCsv([row({ phone: "lid:777", name: "=HYPERLINK(\"x\")" })], { money: true });
  const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
  expect(header.endsWith(";Total gasto (R$)")).toBe(true);
  expect(line.startsWith(`"'=HYPERLINK(""x"")";;`)).toBe(true);
  expect(line.endsWith(";1234,56")).toBe(true);
});
```

Em `src/server/domain/tags.test.ts`, no fim (imports que faltarem: `inArray` de `drizzle-orm`; `bulkTagContacts`; `contactTags`, `contacts`, `users` do schema):

```ts
it("etiquetar em massa: cria a etiqueta uma vez, não duplica em quem já tem e conta só as novas", async () => {
  const [u] = await db.insert(users).values({ name: "Ana", email: "ana-tag@c.com", role: "atendente", passwordHash: "x" }).returning();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await db.insert(contacts).values({ name: `Tag${i} Fictícia`, phoneE164: `+557196600070${i}` }).returning())[0].id);
  expect((await bulkTagContacts(ids.slice(0, 2), " noiva ", u.id)).tagged).toBe(2);
  const r = await bulkTagContacts(ids, "NOIVA", u.id);
  expect(r).toMatchObject({ tagged: 1, tag: { name: "noiva" } });
  expect(await db.select().from(contactTags).where(inArray(contactTags.contactId, ids))).toHaveLength(3);
});
```

Em `e2e/contatos.spec.ts`, um teste novo no fim (o import de `refreshStatsE2E` vem de `./helpers`):

```ts
test("filtros com contagem, ordenar, etiquetar em massa e exportar CSV (a atendente não exporta)", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop");
  await login(page);
  // Duas clientes do Avec: uma veio uma vez só, a outra 12 vezes (VIP)
  await e2eSql("insert into contacts (phone_e164, name, is_client) values ($1, 'Úrsula Umavez', true), ($2, 'Vera Vip', true) on conflict do nothing", [telefone(7, 1), telefone(7, 2)]);
  const umaVez = await contactId(telefone(7, 1)), vip = await contactId(telefone(7, 2));
  await e2eSql("insert into sales_items (contact_id, sold_on, comanda, item, kind, total_cents, external_key) values ($1, current_date - 300, 'e2e-l1', 'Escova', 'servico', 10000, 'e2e:lista:1') on conflict do nothing", [umaVez]);
  for (let i = 0; i < 12; i++)
    await e2eSql("insert into sales_items (contact_id, sold_on, comanda, item, kind, total_cents, external_key) values ($1, current_date - $2::int, $3, 'Corte', 'servico', 10000, $4) on conflict do nothing", [vip, 10 + i * 20, `e2e-v${i}`, `e2e:lista:v${i}`]);
  refreshStatsE2E();

  await page.goto("/contatos");
  const nunca = page.getByRole("link", { name: /^Nunca voltou/ });
  const n = Number((await nunca.innerText()).match(/(\d[\d.]*)/)![1].replace(/\./g, ""));
  await nunca.click();
  await expect(page).toHaveURL(/f=nunca_voltou/);
  await expect(page.getByRole("table")).toContainText("Úrsula Umavez");
  await expect(page.getByRole("table")).not.toContainText("Vera Vip");
  await expect(page.getByText(new RegExp(`${n.toLocaleString("pt-BR")} contatos?`)).first()).toBeVisible(); // a contagem do botão bate com a lista

  await page.goto("/contatos?f=vip&ordem=visitas");
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText("Vera Vip");

  // Etiquetar em massa
  await page.goto("/contatos?q=Umavez");
  await page.getByRole("button", { name: /Selecionar/ }).first().click();
  await page.getByRole("checkbox", { name: /Úrsula Umavez/ }).first().click();
  await page.getByRole("button", { name: "Etiquetar" }).click();
  await page.getByLabel("Nome da etiqueta").fill("Noiva E2E");
  await page.getByRole("button", { name: "Pôr etiqueta" }).click();
  await expect(page.getByText(/1 contato etiquetado/)).toBeVisible();

  // Exportar CSV (gestão: com a coluna de valor)
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar CSV" }).click()]);
  const csv = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
  expect(csv.split("\r\n")[0]).toContain("Nome;Telefone;E-mail;Situação");
  expect(csv.split("\r\n")[0]).toContain("Total gasto (R$)");

  // Atendente: sem botão e o servidor recusa
  await login(page, "ana@e2e.local");
  await page.goto("/contatos");
  await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);
  expect((await page.request.get("/api/contatos/csv")).status()).toBe(403);
});
```

O nome do botão de seleção e da caixinha seguem o padrão que `contatos.spec.ts` já usa (`grep -n "Selecionar\|checkbox" e2e/contatos.spec.ts`); se for outro, use o mesmo do arquivo.

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/queries/contacts-csv.test.ts src/server/domain/tags.test.ts`
Esperado: FAIL ("./contacts-csv" não existe; `bulkTagContacts` não existe).

- [ ] **Passo 3: Etiquetar em massa (`tags.ts`)**

Em `src/server/domain/tags.ts`, tirar a normalização de dentro de `addTag` para uma função e usar nas duas:

```ts
/** "  vip  " → "vip"; vazio ou com mais de 30 caracteres: erro com o texto para a tela. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da etiqueta.");
  if (name.length > TAG_MAX) throw new UserFacingError(`Use até ${TAG_MAX} caracteres.`);
  return name;
}
```

Em `addTag`, trocar as três primeiras linhas por `const name = normalizeTagName(rawName);`. No fim do arquivo:

```ts
/** A mesma etiqueta em várias clientes de uma vez (Contatos › ações em massa). Quem já tinha não conta; auditoria com o total. */
export async function bulkTagContacts(contactIds: string[], rawName: string, userId: string): Promise<{ tag: Tag; tagged: number }> {
  const name = normalizeTagName(rawName);
  const ids = [...new Set(contactIds)];
  return db.transaction(async (tx) => {
    await tx.insert(tags).values({ name, createdBy: userId }).onConflictDoNothing();
    const [tag] = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(sql`lower(${tags.name}) = lower(${name})`);
    const added = ids.length
      ? await tx.insert(contactTags).values(ids.map((contactId) => ({ contactId, tagId: tag.id, createdBy: userId }))).onConflictDoNothing().returning({ contactId: contactTags.contactId })
      : [];
    if (added.length) await tx.insert(auditLog).values({ userId, action: "etiquetou_em_massa", entity: "contacts", data: { etiqueta: tag.name, contatos: added.length } });
    return { tag, tagged: added.length };
  });
}
```

Em `src/app/(app)/contatos/actions.ts` (import `bulkTagContacts`):

```ts
/** "Etiquetar" em massa na lista de Contatos (até 100). Toda a equipe que vê Contatos pode (as etiquetas são da equipe). */
export async function tagContactsAction(contactIds: string[], name: string): Promise<ActionResult<{ tag: string; tagged: number }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const r = await bulkTagContacts(ids.parse(contactIds), z.string().max(200).parse(name), user.id);
    refresh();
    return { ok: true, data: { tag: r.tag.name, tagged: r.tagged } };
  } catch (e) { return safe(e, "Não foi possível etiquetar. Tente de novo."); }
}
```

(`ids` é o `z.array(uuid).min(1).max(BULK_MAX)` que já existe no arquivo.)

- [ ] **Passo 4: CSV (`contacts-csv.ts` e a rota)**

`src/server/queries/contacts-csv.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tagsOf } from "../domain/tags";
import { listContacts, type ContactListOpts, type ContactRow } from "./contacts";
import { toCsv } from "../reports/common";
import { displayName } from "../../lib/client-rhythm";

export const EXPORT_MAX = 5000;
export type ContactExportRow = ContactRow & { tags: string[]; totalCents: number | null };

const brDate = (day: string | null) => (day ? day.split("-").reverse().join("/") : "");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const reais = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

/** As linhas do CSV: a lista com os mesmos filtros (até 5.000), as etiquetas e, só com `money`, o total gasto. */
export async function exportContactRows(opts: ContactListOpts, money: boolean): Promise<ContactExportRow[]> {
  const { rows } = await listContacts({ ...opts, page: 1, pageSize: EXPORT_MAX });
  const ids = rows.map((r) => r.id);
  const [tagMap, totals] = await Promise.all([
    tagsOf(ids),
    money && ids.length
      ? db.execute(sql`select contact_id as id, total_cents as cents from contact_stats where contact_id = any(${ids}::uuid[])`).then((r) => new Map((r.rows as { id: string; cents: string | number | null }[]).map((x) => [x.id, x.cents == null ? null : Number(x.cents)])))
      : Promise.resolve(new Map<string, number | null>()),
  ]);
  return rows.map((r) => ({ ...r, tags: (tagMap.get(r.id) ?? []).map((t) => t.name), totalCents: money ? totals.get(r.id) ?? null : null }));
}

/** CSV com BOM e ; (Excel em português). Nunca CPF, RG, endereço ou banco (não existem no CRM). Número oculto sai vazio. */
export function contactsCsv(rows: ContactExportRow[], opts: { money: boolean }): string {
  const header = ["Nome", "Telefone", "E-mail", "Situação", "Última visita", "Visitas", "Próximo horário", "Profissional preferida", "Pacote", "Aniversário", "Responsável", "Etiquetas", "Como conheceu", ...(opts.money ? ["Total gasto (R$)"] : [])];
  return toCsv(header, rows.map((r) => [
    r.name ?? "", r.phone.startsWith("lid:") ? "" : r.phone, r.email ?? "", r.situation, brDate(r.lastVisitOn), r.visits, when(r.nextAppointmentAt),
    displayName(r.preferredProfessional) ?? "", r.pkg ? `${r.pkg.used}/${r.pkg.total}` : "", r.birthday ?? "", r.openDealOwnerName ?? "", r.tags.join(", "), r.origin ?? "",
    ...(opts.money ? [reais(r.totalCents)] : []),
  ]));
}
```

`src/app/api/contatos/csv/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { findSessionUser } from "@/server/auth/sessions-store";
import { contactsCsv, exportContactRows } from "@/server/queries/contacts-csv";
import { csvDisposition } from "@/server/reports/common";
import { parseContactListParams } from "@/lib/contact-list-params";
import { BULK_MAX } from "@/lib/bulk-limits";
import { isUuid } from "@/lib/uuid";

/** Exportar CSV da lista de Contatos (com os filtros da tela) ou só das selecionadas (`ids`). Revalida a sessão a cada pedido. */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar contatos", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter(isUuid).slice(0, BULK_MAX);
  const money = can(user.perms, "valores.ver");
  const rows = await exportContactRows({ ...parseContactListParams(sp), ...(ids.length ? { ids } : {}) }, money);
  return new Response(contactsCsv(rows, { money }), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": csvDisposition("contatos", ids.length ? "selecionados" : "lista"), "Cache-Control": "no-store" },
  });
}
```

- [ ] **Passo 5: A página de Contatos**

Trocar `src/app/(app)/contatos/page.tsx` inteiro por:

```tsx
import Link from "next/link";
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { contactFilterCounts, contactListOptions, listContacts } from "@/server/queries/contacts";
import { LiveRefresh } from "@/components/shell/live";
import { PageHeader } from "@/components/page-header";
import { ImportButton } from "./import-button";
import { SearchBox } from "./search-box";
import { ContactsList } from "@/components/contacts/contacts-list";
import { QueueSelectionProvider, SelectToggle } from "@/components/queue/queue-selection";
import { Empty } from "@/components/ui/empty";
import { IconDownload } from "@/components/icons";
import { CONTACT_FILTERS, CONTACT_FILTER_HELP, CONTACT_FILTER_LABEL, CONTACT_SORTS, CONTACT_SORT_LABEL, contactListQuery, parseContactListParams } from "@/lib/contact-list-params";
import { displayName } from "@/lib/client-rhythm";
import { cn } from "@/lib/cn";

export const metadata = { title: "Contatos" };

const CHIP = "inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 text-sm font-medium transition-colors sm:h-10";
const SELECT = "h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm sm:h-10";

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const user = await requirePerm("contatos.ver");
  const p = parseContactListParams(await searchParams);
  const [data, counts, opts] = await Promise.all([listContacts(p), contactFilterCounts({ ...p, filter: null }), contactListOptions()]);
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const href = (over: Parameters<typeof contactListQuery>[1]) => `/contatos${contactListQuery(p, { page: 1, ...over })}`;
  const canExport = can(user.perms, "relatorios.exportar");
  const keep = Object.fromEntries(new URLSearchParams(contactListQuery(p, { q: "", page: 1 }).slice(1)));
  return (
    <QueueSelectionProvider>
      <main className="pb-12">
        <LiveRefresh scopes={["queue"]} />
        <PageHeader title="Contatos" subtitle={`${data.total.toLocaleString("pt-BR")} contato${data.total === 1 ? "" : "s"}${p.q || p.filter ? " encontrado" + (data.total === 1 ? "" : "s") : ""}`}
          actions={<div className="flex flex-wrap gap-2">
            {canExport && <a href={`/api/contatos/csv${contactListQuery(p, { page: 1 })}`} className={cn(CHIP, "border-line-strong hover:bg-paper-2")}><IconDownload size={15} />Exportar CSV</a>}
            {can(user.perms, "config.editar") && <ImportButton />}
          </div>} />
        <div className="px-5 lg:px-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="order-1 min-w-0 flex-1 sm:flex-none"><SearchBox initial={p.q} keep={keep} /></div>
            <SelectToggle className="order-2 min-h-11 border border-line-strong sm:order-4 sm:ml-auto sm:min-h-10 lg:min-h-10" />
            <div className="order-3 flex w-full flex-wrap gap-2 sm:w-auto">
              <Link href={href({ onlyClients: !p.onlyClients })} aria-current={p.onlyClients ? "true" : undefined} className={cn(CHIP, p.onlyClients ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>Só clientes</Link>
              <Link href={href({ includeIgnored: !p.includeIgnored })} aria-current={p.includeIgnored ? "true" : undefined} className={cn(CHIP, p.includeIgnored ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>Incluir “Não é cliente”</Link>
            </div>
          </div>

          <nav aria-label="Filtros" className="mb-3 flex flex-wrap gap-2">
            {CONTACT_FILTERS.map((f) => {
              const on = p.filter === f;
              return (
                <Link key={f} href={href({ filter: on ? null : f })} aria-current={on ? "true" : undefined} title={CONTACT_FILTER_HELP[f]}
                  className={cn(CHIP, on ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>
                  {CONTACT_FILTER_LABEL[f]}<span className={cn("tabular text-xs", on ? "text-paper/80" : "text-muted")}>{counts[f].toLocaleString("pt-BR")}</span>
                </Link>
              );
            })}
          </nav>

          <form method="get" action="/contatos" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filtrar e ordenar">
            {p.q && <input type="hidden" name="q" value={p.q} />}
            {p.filter && <input type="hidden" name="f" value={p.filter} />}
            {p.onlyClients && <input type="hidden" name="clientes" value="1" />}
            {p.includeIgnored && <input type="hidden" name="ignorados" value="1" />}
            <label className="flex flex-col gap-1 text-xs text-muted">Profissional
              <select name="pro" defaultValue={p.professionalId ?? ""} className={SELECT}><option value="">Todas</option>{opts.professionals.map((x) => <option key={x.id} value={x.id}>{displayName(x.name)}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">Serviço
              <select name="svc" defaultValue={p.service ?? ""} className={SELECT}><option value="">Todos</option>{opts.services.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">Etiqueta
              <select name="tag" defaultValue={p.tagId ?? ""} className={SELECT}><option value="">Todas</option>{opts.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">Origem
              <select name="origem" defaultValue={p.origin ?? ""} className={SELECT}><option value="">Todas</option>{opts.origins.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">Ordenar por
              <select name="ordem" defaultValue={p.sort ?? ""} className={SELECT}><option value="">{p.q ? "Mais parecido" : CONTACT_SORT_LABEL.chegada}</option>{CONTACT_SORTS.filter((s) => s !== "chegada").map((s) => <option key={s} value={s}>{CONTACT_SORT_LABEL[s]}</option>)}</select>
            </label>
            <button type="submit" className={cn(CHIP, "border-ink bg-ink text-paper")}>Aplicar</button>
            {(p.professionalId || p.service || p.tagId || p.origin || p.sort || p.filter) && <Link href={href({ professionalId: null, service: null, tagId: null, origin: null, sort: null, filter: null })} className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink underline underline-offset-4 sm:min-h-10">Limpar filtros</Link>}
          </form>

          {data.rows.length === 0 ? (
            <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
              <Empty title={p.q || p.filter ? "Nada encontrado" : "Nenhum contato ainda"}
                action={p.q && !p.includeIgnored ? <Link href={href({ includeIgnored: true })} className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline underline-offset-4">Buscar também em “Não é cliente”</Link> : undefined}>
                {p.q ? "Tente outro nome, telefone ou um trecho da conversa." : p.filter ? "Nenhum contato neste filtro agora." : "Os contatos aparecem quando alguém manda mensagem no WhatsApp, ou importando o histórico de clientes."}
              </Empty>
            </div>
          ) : <ContactsList rows={data.rows} term={p.q} tagOptions={opts.tags.map((t) => t.name)} canExport={canExport} />}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Páginas">
              <span className="text-muted">Página {data.page} de {pages}</span>
              <div className="flex gap-2">
                {data.page > 1 && <Link href={href({ page: data.page - 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Anterior</Link>}
                {data.page < pages && <Link href={href({ page: data.page + 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Próxima</Link>}
              </div>
            </nav>
          )}
        </div>
      </main>
    </QueueSelectionProvider>
  );
}
```

- [ ] **Passo 6: Colunas (`contacts-list.tsx`) e a barra de ações em massa**

Em `src/components/contacts/contacts-list.tsx`:
- assinatura: `export function ContactsList({ rows, term, tagOptions, canExport }: { rows: ContactRow[]; term: string; tagOptions: string[]; canExport: boolean })` e, no fim, `<ContactsBulkBar ids={ids} tagOptions={tagOptions} canExport={canExport} />`;
- imports: `import { displayName } from "@/lib/client-rhythm";` e `import { dueLabel } from "@/lib/next-action";`;
- no cartão do celular, trocar a linha do telefone por `{formatPhoneClient(c.phone)}{c.situation ? ` · ${c.situation}` : ""}`;
- na tabela, o cabeçalho passa a ser:

```tsx
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Nome</th><th className="px-3 font-medium">Situação</th>
              <th className="hidden px-3 font-medium md:table-cell">Última visita</th><th className="px-3 text-right font-medium">Visitas</th>
              <th className="hidden px-3 font-medium lg:table-cell">Próximo horário</th><th className="hidden px-3 font-medium xl:table-cell">Profissional preferida</th>
              <th className="hidden px-3 font-medium xl:table-cell">Pacote</th><th className="hidden px-3 font-medium xl:table-cell">Aniversário</th>
              <th className="hidden px-3 pr-5 font-medium lg:table-cell">Responsável</th>
            </tr>
```

- e as células de cada linha (depois da célula do nome, que ganha o telefone embaixo: `<span className="block text-xs tabular text-graphite">{formatPhoneClient(c.phone)}</span>` logo depois do nome):

```tsx
                  <td className="px-3"><span className="block max-w-[18rem] truncate text-graphite first-letter:uppercase" title={c.situation}>{c.situation || "—"}</span><StatusBadge c={c} compact /></td>
                  <td className="hidden whitespace-nowrap px-3 tabular text-graphite md:table-cell">{c.lastVisitOn ? c.lastVisitOn.split("-").reverse().join("/") : "—"}</td>
                  <td className="px-3 text-right tabular">{c.visits}</td>
                  <td className="hidden whitespace-nowrap px-3 text-graphite lg:table-cell" suppressHydrationWarning>{c.nextAppointmentAt ? dueLabel(Date.parse(c.nextAppointmentAt), Date.now()) : "—"}</td>
                  <td className="hidden px-3 text-graphite xl:table-cell">{displayName(c.preferredProfessional) ?? "—"}</td>
                  <td className="hidden px-3 tabular text-graphite xl:table-cell">{c.pkg ? `${c.pkg.used}/${c.pkg.total}` : "—"}</td>
                  <td className="hidden px-3 tabular text-graphite xl:table-cell">{c.birthday ?? "—"}</td>
                  <td className="hidden px-3 pr-5 text-graphite lg:table-cell">{c.openDealId ? (c.openDealOwnerName ? firstName(c.openDealOwnerName) : "Sem dono") : "—"}</td>
```

(As colunas antigas "Telefone", "Último atendimento" e "Atendimentos" saem: o telefone fica embaixo do nome; "Atendimentos" contava leads do CRM e dava 0 para cliente do Avec.)

Em `src/components/contacts/contacts-bulk-bar.tsx`:
- assinatura `export function ContactsBulkBar({ ids, tagOptions, canExport }: { ids: string[]; tagOptions: string[]; canExport: boolean })`;
- imports `useId`, `useState` de `react` e `tagContactsAction` das ações;
- estado do etiquetar e a ação, logo depois de `const n = ids.length;`:

```tsx
  const [tagging, setTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const listId = useId();
  const tag = () => start(async () => {
    const r = await tagContactsAction(ids, tagName);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`${plural(r.data!.tagged, "contato etiquetado", "contatos etiquetados")} com “${r.data!.tag}”${r.data!.tagged < n ? ` · ${n - r.data!.tagged} já tinham` : ""}`, "ok");
    setTagging(false); setTagName(""); sel.exit();
  });
```

- e os botões, antes de "Não é cliente":

```tsx
          {tagging ? (
            <span className="flex items-center gap-2">
              <input aria-label="Nome da etiqueta" list={listId} value={tagName} onChange={(e) => setTagName(e.target.value)} maxLength={30} autoFocus
                className="h-9 w-44 rounded-[var(--radius-control)] border border-line-strong bg-paper px-2.5 text-sm pointer-coarse:min-h-11" placeholder="Ex.: Noiva" />
              <datalist id={listId}>{tagOptions.map((t) => <option key={t} value={t} />)}</datalist>
              <Button size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || !tagName.trim() || pending} loading={pending} onClick={tag}>Pôr etiqueta</Button>
            </span>
          ) : <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm pointer-coarse:min-h-11" disabled={n === 0 || pending} onClick={() => setTagging(true)}>Etiquetar</Button>}
          {canExport && (n > 0
            ? <a href={`/api/contatos/csv?ids=${ids.join(",")}`} className="inline-flex h-9 items-center rounded-[8px] border border-line-strong px-3.5 text-sm font-medium hover:bg-paper-2 pointer-coarse:min-h-11">Exportar CSV</a>
            : <Button variant="secondary" size="sm" className="h-9 px-3.5 text-sm" disabled>Exportar CSV</Button>)}
```

(O comentário do topo do arquivo ganha: "Etiquetar põe a mesma etiqueta em todas as escolhidas; Exportar CSV baixa só as escolhidas, com a permissão de exportar.")

Com a seleção ligada, há dois "Exportar CSV" na página (o do cabeçalho, a lista inteira, e o da barra, as escolhidas). O e2e clica no do cabeçalho com a seleção já fechada (`sel.exit()` depois de etiquetar).

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/server/queries/contacts-csv.test.ts src/server/domain/tags.test.ts src/server/domain/bulk-contacts.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Rodar: `npx playwright test e2e/contatos.spec.ts e2e/mobile.spec.ts e2e/a11y.spec.ts`
Esperado: PASS. Testes antigos que liam a coluna "Atendimentos" ou "Telefone" da tabela: trocar pela coluna nova ("Visitas") ou pelo telefone embaixo do nome, e anotar no commit.

- [ ] **Passo 8: Commit**

```bash
git add "src/app/(app)/contatos/page.tsx" "src/app/(app)/contatos/actions.ts" src/components/contacts/contacts-list.tsx src/components/contacts/contacts-bulk-bar.tsx \
  src/server/domain/tags.ts src/server/domain/tags.test.ts src/server/queries/contacts-csv.ts src/server/queries/contacts-csv.test.ts src/app/api/contatos/csv/route.ts e2e/contatos.spec.ts
git commit -m "feat(contatos): botões de filtro com contagem, filtros em lista, colunas novas, ordenar, etiquetar e exportar CSV em massa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 14: Retorno sugerido automático (a etapa 6 do funil entra quando a data chega), desligado até a gestão ligar

**Files:**
- Modify: `src/server/domain/suggested-return.ts` (a varredura; o "Lembrar" da Tarefa 6 fica)
- Create: `src/server/domain/suggested-return.test.ts`
- Modify: `src/server/db/seed-data.ts:26` (motivo de perda "Retorno não feito")
- Create: `src/components/config/suggested-return-switch.tsx`
- Modify: `src/app/(app)/config/automacoes/page.tsx`, `src/app/(app)/config/actions.ts`
- Modify: `worker/index.ts`
- Create: `scripts/retorno-sugerido.ts`

**Interfaces:**
- Consumes (1C): `stageByKind`, `moveToKindTx`, `findOpenDeal` (`deals.ts`), `activeOwnerTx` (`attempts.ts`), `syncContactFunnelTx` (`avec/funnel-sync.ts`), `cancelOpenTasksByOriginTx` (`tasks.ts`), `clientFirstName`. Existentes: `setNextActionTx`, `getBusinessHours`, `logEvent`, `emit`, `bahiaAt`, `Switch`. (T1/T2): `contact_stats`, `RETURN_GONE`, `FUTURE_HORIZON_DAYS`, `shortDay`, `bahiaDay`.
- Produces:
  - `RETORNO_SETTING = "retorno_sugerido"`, `type SuggestedReturnSetting = { ativo: boolean; maxPorDia: number }`, `RETORNO_DEFAULT = { ativo: false, maxPorDia: 20 }`;
  - `RETORNO_ORIGIN = "Retorno sugerido"`, `RETORNO_META = { origem: "retorno_sugerido" }`, `RETORNO_CONVERSA_DIAS = 365`, `RETORNO_CASA_ESCREVEU_HORAS = 4`, `RETORNO_SEM_CONTATO_DIAS = 14`, `RETORNO_LOST_REASON = "Retorno não feito"`;
  - `getSuggestedReturnSetting(tx?): Promise<SuggestedReturnSetting>`, `setSuggestedReturnSetting(ativo: boolean, userId: string): Promise<SuggestedReturnSetting>`;
  - `type PlannedReturn = { contactId: string; name: string | null; dueOn: string; lastVisitOn: string; everyDays: number }`, `planSuggestedReturns(now: Date, limit: number): Promise<PlannedReturn[]>`;
  - `type SweepReturnResult = { criados: number; pelaAgenda: number; aguardando: number; expirados: number; erros: string[]; desligado?: true }`, `sweepSuggestedReturns(now?: Date): Promise<SweepReturnResult>`;
  - ação `setSuggestedReturnAction(on: boolean)` (`config.editar`); fila do worker `"retorno-sugerido"` às 08:00 de Salvador; CLI `npx tsx scripts/retorno-sugerido.ts [--dry-run | --aplicar]`.

- [ ] **Passo 1: Escrever os testes que falham**

`src/server/domain/suggested-return.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, contactStats, contacts, deals, lists, messages, settings, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { RETORNO_LOST_REASON, RETORNO_ORIGIN, getSuggestedReturnSetting, planSuggestedReturns, setSuggestedReturnSetting, sweepSuggestedReturns } from "./suggested-return";
import { addDaysTo } from "../../lib/client-rhythm";

const NOW = new Date("2026-10-15T11:00:00Z"); // quinta, 8h em Salvador (a hora da varredura)
const HOJE = "2026-10-15";
let seq = 0, ana = "";

/** Ritmo de 40 dias, última visita há `dias` e (por padrão) uma mensagem com a Casa há 60 dias. */
async function cliente(name: string, dias = 45, o: { phone?: string; ignored?: boolean; conversa?: boolean } = {}) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: o.phone ?? `+5571968${String(++seq).padStart(6, "0")}`, ignored: o.ignored ?? false }).returning();
  const last = addDaysTo(HOJE, -dias);
  await db.insert(contactStats).values({ contactId: c.id, visits: 5, lastVisitOn: last, rhythmDays: 40, returnDueOn: addDaysTo(last, 40) });
  if (o.conversa !== false) await db.insert(messages).values({ contactId: c.id, direction: "in", body: "oi", status: "received", createdAt: new Date(NOW.getTime() - 60 * 86_400_000) });
  return c.id;
}
const liga = (maxPorDia = 20) => db.insert(settings).values({ key: "retorno_sugerido", value: { ativo: true, maxPorDia } })
  .onConflictDoUpdate({ target: settings.key, set: { value: { ativo: true, maxPorDia } } });
const cartoes = (contactId: string) => db.select({ id: deals.id, kind: stages.kind, closedAt: deals.closedAt, origin: deals.origin, ownerId: deals.ownerId })
  .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.contactId, contactId));
const retornoDe = async (contactId: string) => (await cartoes(contactId)).find((d) => d.origin === RETORNO_ORIGIN)!;

beforeEach(async () => {
  seq = 0;
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana-r@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  // A Casa abre ter–sáb, 9h–18h (Lote 0)
  const dia = ["09:00", "18:00"];
  await db.insert(settings).values({ key: "business_hours", value: { 0: null, 1: null, 2: dia, 3: dia, 4: dia, 5: dia, 6: dia } });
});

it("nasce desligado: sem a gestão ligar, nada acontece", async () => {
  await cliente("Rita Fictícia");
  expect(await getSuggestedReturnSetting()).toEqual({ ativo: false, maxPorDia: 20 });
  expect(await sweepSuggestedReturns(NOW)).toMatchObject({ criados: 0, desligado: true });
  expect(await db.select().from(deals)).toHaveLength(0);
});

it("ligado: a data prevista chegou → cartão em Retorno sugerido com o combinado da dona da última conversa; nada é enviado", async () => {
  const id = await cliente("Rita Fictícia", 45); // previsto há 5 dias; ainda "na hora" (≤ 1,5 × 40)
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  await db.insert(deals).values({ contactId: id, stageId: fechado.id, ownerId: ana, closedAt: new Date(NOW.getTime() - 50 * 86_400_000), createdAt: new Date(NOW.getTime() - 52 * 86_400_000) });
  await liga();
  expect(await sweepSuggestedReturns(NOW)).toMatchObject({ criados: 1, erros: [] });
  const novo = await retornoDe(id);
  expect(novo).toMatchObject({ kind: "retorno", ownerId: ana, closedAt: null });
  const [t] = await db.select().from(tasks).where(and(eq(tasks.dealId, novo.id), isNull(tasks.doneAt)));
  expect(t).toMatchObject({ kind: "proxima_acao", assigneeId: ana, title: "Chamar Rita para voltar (prevista 10/10)" });
  expect(t.dueAt.toISOString()).toBe("2026-10-15T13:00:00.000Z"); // hoje, 10h
  expect(await db.select().from(messages).where(eq(messages.direction, "out"))).toHaveLength(0);
});

it("não cria duas vezes nem para quem não deve (conversa aberta, horário no Avec, Não é cliente, número oculto, sem conversa no último ano, sumida, cedo, já teve retorno neste ciclo)", async () => {
  const ok = await cliente("Pode Entrar", 45);
  const aberta = await cliente("Com Conversa Aberta", 45);
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: aberta, stageId: lead.id });
  const horario = await cliente("Com Horário", 45);
  await db.insert(appointments).values({ contactId: horario, startsAt: new Date(NOW.getTime() + 5 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:r1" });
  await cliente("Não É Cliente", 45, { ignored: true });
  await cliente("Número Oculto", 45, { phone: "lid:123456" });
  await cliente("Sem Conversa", 45, { conversa: false });
  await cliente("Já Sumida", 61);
  await cliente("Ainda Não", 30);
  await liga();
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(1);
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(0); // de novo no mesmo dia
  expect((await cartoes(ok)).filter((d) => d.kind === "retorno")).toHaveLength(1);
  await db.update(deals).set({ closedAt: NOW }).where(eq(deals.contactId, ok)); // o cartão foi fechado; a volta ainda é do mesmo ciclo
  expect((await sweepSuggestedReturns(new Date(NOW.getTime() + 86_400_000))).criados).toBe(0);
});

it("teto por dia e só em dia que a Casa abre (segunda fechada: nada)", async () => {
  for (let i = 0; i < 3; i++) await cliente(`Cliente${i} Fictícia`, 45);
  await liga(2);
  expect((await sweepSuggestedReturns(new Date("2026-10-19T11:00:00Z"))).criados).toBe(0); // segunda-feira
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(2);
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(0);
});

it("depois: marcou → Agendado; a Casa escreveu e ela não respondeu em 4 h → Aguardando cliente; 14 dias sem a Casa escrever → Perdido 'Retorno não feito'", async () => {
  const marcou = await cliente("Marcou Fictícia", 45);
  const escreveu = await cliente("Casa Escreveu", 45);
  const parada = await cliente("Ninguém Chamou", 45);
  await liga();
  await sweepSuggestedReturns(NOW);
  await db.insert(appointments).values({ contactId: marcou, startsAt: new Date(NOW.getTime() + 3 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:r2" });
  const d2 = await retornoDe(escreveu);
  const saiu = new Date(NOW.getTime() + 3_600_000);
  await db.insert(messages).values({ contactId: escreveu, dealId: d2.id, direction: "out", body: "Oi! Vamos marcar?", status: "sent", createdAt: saiu });
  await db.update(deals).set({ lastOutboundAt: saiu }).where(eq(deals.id, d2.id));
  expect(await sweepSuggestedReturns(new Date(NOW.getTime() + 86_400_000))).toMatchObject({ pelaAgenda: 1, aguardando: 1, expirados: 0 });
  expect((await retornoDe(marcou)).kind).toBe("agendado");
  expect((await retornoDe(escreveu)).kind).toBe("followup");
  expect((await sweepSuggestedReturns(new Date(NOW.getTime() + 15 * 86_400_000))).expirados).toBe(1);
  const perdido = await retornoDe(parada);
  expect(perdido.kind).toBe("perdido");
  const [motivo] = await db.select().from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, RETORNO_LOST_REASON)));
  expect((await db.select().from(deals).where(eq(deals.id, perdido.id)))[0].lostReasonId).toBe(motivo.id);
  expect(await db.select().from(tasks).where(and(eq(tasks.dealId, perdido.id), isNull(tasks.doneAt)))).toHaveLength(0);
});

it("o ensaio lista quem entraria hoje, a mais atrasada primeiro, sem gravar", async () => {
  await cliente("Atrasada Cinco", 45);
  await cliente("Atrasada Dez", 50);
  expect((await planSuggestedReturns(NOW, 10)).map((p) => p.name)).toEqual(["Atrasada Dez", "Atrasada Cinco"]);
  expect(await db.select().from(deals)).toHaveLength(0);
});

it("ligar fica gravado (com o teto) e auditado", async () => {
  expect(await setSuggestedReturnSetting(true, ana)).toEqual({ ativo: true, maxPorDia: 20 });
  expect((await getSuggestedReturnSetting()).ativo).toBe(true);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/suggested-return.test.ts`
Esperado: FAIL (`sweepSuggestedReturns`, `planSuggestedReturns` e a configuração não existem).

- [ ] **Passo 3: A varredura em `suggested-return.ts`**

Juntar aos imports do arquivo (Tarefa 6):

```ts
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, contacts, deals, lists, settings } from "../db/schema";
import { emit, logEvent } from "./events";
import { findOpenDeal, moveToKindTx, stageByKind } from "./deals";
import { activeOwnerTx } from "./attempts";
import { syncContactFunnelTx } from "./avec/funnel-sync";
import { cancelOpenTasksByOriginTx, createTaskTx, setNextActionTx } from "./tasks";
import { getBusinessHours } from "./hours";
import type { BusinessHours } from "../../lib/business-hours";
import { bahiaAt } from "../../lib/next-action";
import { FUTURE_HORIZON_DAYS, RETURN_GONE, bahiaDay, reminderDueAt, shortDay } from "../../lib/client-rhythm";
```

No fim do arquivo:

```ts
/**
 * Retorno sugerido automático (etapa 6 do funil; regra que o Lote 1C deixou para o Lote 2). Desligado até a gestão ligar
 * (Configurações › Automações). Todo dia às 08:00, em dia que a Casa abre, a cliente cuja volta prevista chegou ganha um cartão em
 * "Retorno sugerido" com o combinado "Chamar <nome> para voltar". NUNCA envia mensagem.
 */
export const RETORNO_SETTING = "retorno_sugerido";
export type SuggestedReturnSetting = { ativo: boolean; maxPorDia: number };
export const RETORNO_DEFAULT: SuggestedReturnSetting = { ativo: false, maxPorDia: 20 };
export const RETORNO_ORIGIN = "Retorno sugerido";
export const RETORNO_META = { origem: "retorno_sugerido" } as const;
/** Só quem conversou com a Casa pelo WhatsApp neste período (o espírito da decisão 4: cartão só para quem conversa). */
export const RETORNO_CONVERSA_DIAS = 365;
/** A Casa escreveu e a cliente não respondeu neste tempo: vai para Aguardando cliente (as tentativas do 1C cuidam do resto). */
export const RETORNO_CASA_ESCREVEU_HORAS = 4;
/** Ninguém da Casa escreveu neste prazo: Perdido "Retorno não feito" (ela continua no filtro Sumidas/Na hora de voltar). */
export const RETORNO_SEM_CONTATO_DIAS = 14;
export const RETORNO_LOST_REASON = "Retorno não feito";

export async function getSuggestedReturnSetting(tx: Tx | typeof db = db): Promise<SuggestedReturnSetting> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, RETORNO_SETTING));
  const v = (r?.value ?? {}) as Partial<SuggestedReturnSetting>;
  const max = Number(v.maxPorDia);
  return { ativo: v.ativo === true, maxPorDia: Number.isInteger(max) && max > 0 && max <= 200 ? max : RETORNO_DEFAULT.maxPorDia };
}

export async function setSuggestedReturnSetting(ativo: boolean, userId: string): Promise<SuggestedReturnSetting> {
  const v = { ...(await getSuggestedReturnSetting()), ativo };
  await db.insert(settings).values({ key: RETORNO_SETTING, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: ativo ? "ligou" : "desligou", entity: "settings", entityId: RETORNO_SETTING, data: v });
  return v;
}

export type PlannedReturn = { contactId: string; name: string | null; dueOn: string; lastVisitOn: string; everyDays: number };

/**
 * Quem entra hoje (só leitura; o ensaio usa o mesmo): a volta prevista chegou e ela ainda está "na hora" (≤ 1,5× o ritmo); sem horário
 * nos próximos 180 dias; sem conversa aberta; sem cartão de retorno desde a última visita; contato normal (nem "Não é cliente" nem
 * número oculto); conversou com a Casa no último ano. A mais atrasada primeiro.
 */
export async function planSuggestedReturns(now: Date, limit: number): Promise<PlannedReturn[]> {
  const at = now.toISOString();
  const today = sql`((${at}::timestamptz at time zone 'America/Bahia')::date)`;
  const every = sql`coalesce(s.rhythm_days, s.cycle_days)`;
  const rows = (await db.execute(sql`
    select c.id as "contactId", c.name, s.return_due_on as "dueOn", s.last_visit_on as "lastVisitOn", ${every} as "everyDays"
      from contact_stats s join contacts c on c.id = s.contact_id
     where not c.ignored and c.phone_e164 not like 'lid:%'
       and s.return_due_on is not null and s.return_due_on <= ${today}
       and (${today} - s.last_visit_on) <= ${RETURN_GONE}::numeric * ${every}
       and not exists (select 1 from appointments a where a.contact_id = c.id and a.status in ('agendado', 'confirmado')
                        and a.starts_at > ${at}::timestamptz and a.starts_at <= ${at}::timestamptz + ${FUTURE_HORIZON_DAYS} * interval '1 day')
       and not exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null)
       and not exists (select 1 from deals d where d.contact_id = c.id and d.origin = ${RETORNO_ORIGIN}
                        and d.created_at >= (s.last_visit_on::timestamp at time zone 'America/Bahia'))
       and exists (select 1 from messages m where m.contact_id = c.id and m.created_at >= ${at}::timestamptz - ${RETORNO_CONVERSA_DIAS} * interval '1 day')
     order by s.return_due_on asc, c.name
     limit ${limit}`)).rows as { contactId: string; name: string | null; dueOn: unknown; lastVisitOn: unknown; everyDays: number }[];
  return rows.map((r) => ({ contactId: r.contactId, name: r.name, dueOn: String(r.dueOn).slice(0, 10), lastVisitOn: String(r.lastVisitOn).slice(0, 10), everyDays: Number(r.everyDays) }));
}

/** Perdido "Retorno não feito" (sem recontato: ela continua nos filtros da lista) e o combinado do retorno cancelado. */
async function loseNoContactTx(tx: Tx, dealId: string, now: Date) {
  await tx.insert(lists).values({ kind: "lost_reason", label: RETORNO_LOST_REASON, position: 99 }).onConflictDoNothing();
  const [reason] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, RETORNO_LOST_REASON)));
  await cancelOpenTasksByOriginTx(tx, dealId, RETORNO_META.origem, null);
  await tx.update(deals).set({ lostReasonId: reason.id }).where(eq(deals.id, dealId));
  await moveToKindTx(tx, dealId, "perdido", null, "retorno_sem_contato", now);
}

export type SweepReturnResult = { criados: number; pelaAgenda: number; aguardando: number; expirados: number; erros: string[]; desligado?: true };
type Counter = "pelaAgenda" | "aguardando" | "expirados";

export async function sweepSuggestedReturns(now = new Date()): Promise<SweepReturnResult> {
  const out: SweepReturnResult = { criados: 0, pelaAgenda: 0, aguardando: 0, expirados: 0, erros: [] };
  const cfg = await getSuggestedReturnSetting();
  if (!cfg.ativo) return { ...out, desligado: true };

  // 1) Os cartões que já estão em Retorno sugerido.
  const open = (await db.execute(sql`
    select d.id, d.contact_id as "contactId", d.stage_entered_at as "enteredAt", d.last_outbound_at as "lastOut", d.last_inbound_at as "lastIn",
           exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'out' and m.status not in ('failed', 'pending')
                    and m.created_at > d.stage_entered_at) as "casaEscreveu"
      from deals d join stages s on s.id = d.stage_id
     where s.kind = 'retorno' and d.closed_at is null and d.archived_at is null`)).rows as
    { id: string; contactId: string; enteredAt: string; lastOut: string | null; lastIn: string | null; casaEscreveu: boolean }[];
  for (const r of open) {
    try {
      const did = await db.transaction(async (tx): Promise<Counter | null> => {
        // Marcou (Avec ou Agenda) → Agendado; veio → Atendida: a mesma regra do Lote 1C.
        const synced = await syncContactFunnelTx(tx, r.contactId, now);
        if (synced.result) { await cancelOpenTasksByOriginTx(tx, r.id, RETORNO_META.origem, null); return "pelaAgenda"; }
        const entered = new Date(r.enteredAt).getTime();
        const lastIn = r.lastIn ? new Date(r.lastIn).getTime() : 0;
        const lastOut = r.lastOut ? new Date(r.lastOut).getTime() : 0;
        if (r.casaEscreveu && lastIn < entered && lastOut <= now.getTime() - RETORNO_CASA_ESCREVEU_HORAS * 3_600_000) {
          await cancelOpenTasksByOriginTx(tx, r.id, RETORNO_META.origem, null);
          await moveToKindTx(tx, r.id, "followup", null, "retorno_casa_escreveu", now);
          return "aguardando";
        }
        if (!r.casaEscreveu && entered <= now.getTime() - RETORNO_SEM_CONTATO_DIAS * 86_400_000) {
          await loseNoContactTx(tx, r.id, now);
          return "expirados";
        }
        return null;
      });
      if (did) { out[did]++; await emit("etapa_alterada", { dealId: r.id }); }
    } catch (e) { out.erros.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }

  // 2) Cartões novos: só em dia que a Casa abre e até o teto do dia.
  const hours = await getBusinessHours();
  const weekday = String(new Date(now.getTime() - 3 * 3_600_000).getUTCDay()) as keyof BusinessHours;
  if (!hours[weekday]) return out;
  const [{ n: today }] = (await db.execute(sql`select count(*)::int as n from deals where origin = ${RETORNO_ORIGIN}
      and created_at >= ((${now.toISOString()}::timestamptz at time zone 'America/Bahia')::date::timestamp at time zone 'America/Bahia')`)).rows as { n: number }[];
  const room = cfg.maxPorDia - today;
  if (room <= 0) return out;
  let stage;
  try { stage = await stageByKind("retorno"); } catch { out.erros.push("A etapa Retorno sugerido está desativada em Configurações › Etapas."); return out; }
  const todayDay = bahiaDay(now.getTime());
  const dueAt = new Date(Math.max(bahiaAt(now.getTime(), 0, 10).getTime(), now.getTime() + 30 * 60_000)); // hoje 10h (ou daqui a 30 min)
  for (const p of await planSuggestedReturns(now, room)) {
    try {
      const dealId = await db.transaction(async (tx) => {
        await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, p.contactId)).for("update");
        if (await findOpenDeal(p.contactId, tx)) return null; // abriu conversa nesse meio-tempo
        const [last] = await tx.select({ ownerId: deals.ownerId, channelId: deals.channelId }).from(deals)
          .where(eq(deals.contactId, p.contactId)).orderBy(desc(deals.createdAt)).limit(1);
        const ownerId = await activeOwnerTx(tx, last?.ownerId ?? null);
        const [d] = await tx.insert(deals).values({
          contactId: p.contactId, stageId: stage.id, ownerId, channelId: last?.channelId ?? null, origin: RETORNO_ORIGIN, stageEnteredAt: now, createdAt: now,
        }).returning();
        await logEvent(tx, d.id, "lead_criado", { origin: RETORNO_ORIGIN, initialStage: stage.key, retorno: { previsto: p.dueOn, aCadaDias: p.everyDays, ultimaVisita: p.lastVisitOn } });
        await setNextActionTx(tx, d.id, {
          title: `Chamar ${clientFirstName(p.name)} para voltar (prevista ${shortDay(p.dueOn, todayDay)})`, dueAt, assigneeId: ownerId, meta: { ...RETORNO_META },
        }, null, now);
        return d.id;
      });
      if (dealId) { out.criados++; await emit("lead_atualizado", { dealId }); }
    } catch (e) { out.erros.push(`${p.contactId}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
```

(`createTaskTx`, `reminderDueAt` e os imports do "Lembrar" continuam usados pela Tarefa 6; tire do import o que o `npm run lint` acusar sem uso.)

- [ ] **Passo 4: Motivo de perda no seed**

`src/server/db/seed-data.ts:26`: acrescentar `"Retorno não feito"` ao fim de `lost_reason` (o seed insere listas com `onConflictDoNothing`: rodar de novo em produção só acrescenta o motivo). Se `src/server/db/seed.test.ts` contar os motivos de perda, somar 1 na contagem.

- [ ] **Passo 5: A chave em Configurações › Automações**

`src/components/config/suggested-return-switch.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { setSuggestedReturnAction } from "@/app/(app)/config/actions";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

/** Liga e desliga o Retorno sugerido automático (nasce desligado). Diz em uma frase o que acontece e que nada é enviado. */
export function SuggestedReturnSwitch({ initial }: { initial: { ativo: boolean; maxPorDia: number } }) {
  const [on, setOn] = useState(initial.ativo);
  const [pending, start] = useTransition();
  const toast = useToast();
  const change = (v: boolean) => start(async () => {
    const r = await setSuggestedReturnAction(v);
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(v);
    toast(v ? "Retorno sugerido ligado: no próximo dia de expediente, às 8h, entram as clientes do dia." : "Retorno sugerido desligado.", "ok");
  });
  return (
    <section aria-labelledby="retorno-sugerido" className="mb-6 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="retorno-sugerido" className="font-display text-xl font-medium">Retorno sugerido automático</h2>
          <p className="mt-1 text-sm text-graphite">
            Todo dia de expediente, às 8h, a cliente cuja volta prevista chegou entra na etapa Retorno sugerido com o combinado
            &quot;Chamar para voltar&quot; (até {initial.maxPorDia} por dia). Só quem conversou com a Casa pelo WhatsApp no último ano,
            sem horário marcado e sem conversa aberta. Nada é enviado para a cliente.
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{on ? "Ligado" : "Desligado"}</p>
        </div>
        <Switch checked={on} onChange={change} label="Retorno sugerido automático" disabled={pending} />
      </div>
    </section>
  );
}
```

`src/app/(app)/config/actions.ts` (imports `setSuggestedReturnSetting` de `@/server/domain/suggested-return`):

```ts
export const setSuggestedReturnAction = async (on: boolean) => run((u) => setSuggestedReturnSetting(z.boolean().parse(on), u), "/config/automacoes");
```

`src/app/(app)/config/automacoes/page.tsx`, inteiro (a chave fica acima da lista de automações):

```tsx
import { requirePerm } from "@/server/auth/session";
import { asc, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { automations, stages } from "@/server/db/schema";
import { AutomationsList } from "@/components/config/automations";
import { getSuggestedReturnSetting } from "@/server/domain/suggested-return";
import { SuggestedReturnSwitch } from "@/components/config/suggested-return-switch";

export const metadata = { title: "Automações" };

export default async function AutomacoesPage() {
  await requirePerm("config.editar");
  const [list, st, runRows, retorno] = await Promise.all([
    db.select().from(automations).orderBy(asc(automations.name)),
    db.select({ key: stages.key, name: stages.name }).from(stages).orderBy(asc(stages.position)),
    db.execute(sql`select automation_id as id, count(*)::int as n from automation_runs where created_at > now() - interval '7 days' group by 1`),
    getSuggestedReturnSetting(),
  ]);
  const runs = Object.fromEntries((runRows.rows as { id: string; n: number }[]).map((r) => [r.id, r.n]));
  return (
    <>
      <SuggestedReturnSwitch initial={retorno} />
      <AutomationsList items={list.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, conditions: a.conditions, actions: a.actions, version: a.version, updatedAt: a.updatedAt.toISOString() }))} stages={st} runs={runs} />
    </>
  );
}
```

(Se o Lote 1C ou a junção já tiverem mudado esta página, mantenha o que mudou e só acrescente `getSuggestedReturnSetting()` ao `Promise.all` e o `<SuggestedReturnSwitch>` acima da lista.)

- [ ] **Passo 6: Worker e script**

`worker/index.ts`: import `sweepSuggestedReturns` de `../src/server/domain/suggested-return`; em `QUEUES` acrescentar `retorno: "retorno-sugerido"`; depois do `schedule` da visão:

```ts
  // Lote 2: Retorno sugerido automático às 08:00 (depois da visão por contato das 03:30). Desligado até a gestão ligar; nunca envia nada.
  await boss.schedule(QUEUES.retorno, "0 8 * * *", null, { tz: "America/Bahia", singletonKey: "retorno-sugerido" });
```

e depois do `work` da visão:

```ts
  await boss.work(QUEUES.retorno, { batchSize: 1 }, async () => {
    try { const r = await sweepSuggestedReturns(); if (!r.desligado) console.log("[retorno sugerido]", r); }
    catch (e) { console.error("[retorno sugerido] falhou", e); }
  });
```

`scripts/retorno-sugerido.ts`:

```ts
import "dotenv/config";
import { pool } from "../src/server/db";
import { getSuggestedReturnSetting, planSuggestedReturns, sweepSuggestedReturns } from "../src/server/domain/suggested-return";

/**
 * Lote 2: Retorno sugerido automático.
 *   --dry-run (padrão)  quem entraria HOJE (sem gravar), com o teto do dia
 *   --aplicar           roda a varredura uma vez agora (só se a gestão já ligou em Configurações › Automações)
 * Nunca envia mensagem: cria cartão e combinado.
 */
async function main() {
  const cfg = await getSuggestedReturnSetting();
  const plan = await planSuggestedReturns(new Date(), cfg.maxPorDia);
  console.log(`Retorno sugerido: ${cfg.ativo ? "LIGADO" : "desligado"} · teto ${cfg.maxPorDia} por dia`);
  console.table(plan.map((p) => ({ cliente: p.name ?? p.contactId, ultimaVisita: p.lastVisitOn, aCadaDias: p.everyDays, prevista: p.dueOn })));
  console.log(`${plan.length} entrariam hoje.`);
  if (!process.argv.includes("--aplicar")) { console.log("ENSAIO: nada foi gravado."); return; }
  if (!cfg.ativo) { console.log("Desligado: ligue em Configurações › Automações antes de aplicar."); process.exitCode = 1; return; }
  const r = await sweepSuggestedReturns(new Date());
  console.log(`Feito: ${r.criados} cartões novos · ${r.pelaAgenda} foram pela agenda · ${r.aguardando} para Aguardando cliente · ${r.expirados} Retorno não feito${r.erros.length ? ` · erros: ${r.erros.join("; ")}` : ""}`);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/suggested-return.test.ts src/server/domain/contact-profile.test.ts src/server/db/seed.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 8: Commit**

```bash
git add src/server/domain/suggested-return.ts src/server/domain/suggested-return.test.ts src/server/db/seed-data.ts src/server/db/seed.test.ts \
  src/components/config/suggested-return-switch.tsx "src/app/(app)/config/automacoes/page.tsx" "src/app/(app)/config/actions.ts" worker/index.ts scripts/retorno-sugerido.ts
git commit -m "feat(funil): Retorno sugerido automático (etapa 6 quando a data prevista chega), desligado até a gestão ligar; nunca envia mensagem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 15: Verificação final do lote e roteiro de produção no `docs/deploy-contabo.md`

**Files:**
- Modify: `docs/deploy-contabo.md` (seção nova "Lote 2: ficha e contatos", com os passos da **Implantação** abaixo)

**Interfaces:**
- Consumes: tudo das Tarefas 1-14.
- Produces: o roteiro de produção no repositório (o mesmo texto da seção Implantação).

- [ ] **Passo 1: Tudo verde**

Rodar: `npm test && npm run typecheck && npm run lint && npm run build`
Esperado: PASS.

Rodar: `npx playwright test` (com `E2E_PORT` definido pelo executor)
Esperado: PASS, inclusive `e2e/ficha.spec.ts`, `e2e/ficha-cliques.spec.ts`, `e2e/contatos.spec.ts` e o `e2e/a11y.spec.ts`.

Rodar: `npx vitest run test/evolution-guard.test.ts`
Esperado: PASS (nenhum teste fala com o WhatsApp de verdade).

Rodar: `grep -rnE "TODO|TBD|FIXME" src/lib/client-rhythm.ts src/lib/client-situation.ts src/server/domain/contact-stats.ts src/server/domain/suggested-return.ts src/server/queries/contacts.ts src/components/contacts/ficha`
Esperado: nada.

Rodar: `git status --short`
Esperado: só os arquivos soltos que já existiam antes do lote (prints, `tsconfig.json`, `.next-copia/`).

- [ ] **Passo 2: Roteiro no `docs/deploy-contabo.md`**

Acrescentar ao fim de `docs/deploy-contabo.md` a seção "Lote 2: ficha e contatos (só com o ok do dono)" com os passos I0 a I11 da seção **Implantação** deste plano (copiar os comandos como estão).

- [ ] **Passo 3: Commit**

```bash
git add docs/deploy-contabo.md
git commit -m "docs: roteiro de produção do Lote 2 (visão por contato, anotações e retorno sugerido com ensaio)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Interfaces que o Lote 2 expõe

**Banco (migration `0025_ficha_contatos`, só aditiva)**
- `contacts.preferred_professional_id uuid → professionals.id (on delete set null)`, `contacts.alert_notes text`
- tabela `contact_stats` (PK `contact_id` → `contacts.id on delete cascade`) com visitas, datas, ritmo, ciclo, retorno previsto, faltas, cancelamentos, comandas, total, preferida calculada, serviços, origem, dica do Avec, dívida e crédito; índices em `return_due_on`, `last_visit_on`, `preferred_professional_id`, `origin_label`
- dados no seed: motivo de perda "Retorno não feito"; configuração `settings.retorno_sugerido` (ausente = desligado)

**Puro (`src/lib`)**
- `client-rhythm.ts`: constantes (ritmo 3 visitas; 0,8×/1,5×; 365; 180; preferida 3/60%; VIP 12/10%; faltosa 2; semana 7), `bahiaDay`, `daysBetween`, `addDaysTo`, `shortDay`, `returnInfo`, `returnLine`, `daysUntilBirthday`, `displayName`, `reminderDueAt`, tipos `ReturnInfo`, `ReturnStatus`, `RhythmInput`
- `client-situation.ts`: `clientSituation`, `SITUATION_STATE_LABEL`, tipos `Situation`, `SituationInput`, `SituationState`
- `birthday.ts`: `parseBirthday`, `birthdayLabel`
- `visit-days.ts`: `mergeVisitDays`, `VISIT_STATUS_LABEL`, tipos `VisitDay`, `VisitAppointment`, `VisitItem`
- `notes-merge.ts`: `mergeNotes`
- `contact-list-params.ts`: `CONTACT_FILTERS`, `CONTACT_FILTER_LABEL`, `CONTACT_FILTER_HELP`, `CONTACT_SORTS`, `CONTACT_SORT_LABEL`, `parseContactListParams`, `contactListQuery`, tipos `ContactFilter`, `ContactSort`, `ContactListParams`
- `lead-href.ts`: `contactHref`

**Servidor**
- `domain/contact-stats.ts`: `refreshContactStats`, `refreshContactStatsTx`, `statsSummary`, tipos `RefreshResult`, `StatsSummary`
- `domain/contact-profile.ts`: `updateContactProfile`, `contactProfileSchema`, `ALERT_NOTES_MAX`, tipo `ContactProfilePatch`
- `domain/suggested-return.ts`: `remindReturn`, `REMIND_META`, `getSuggestedReturnSetting`, `setSuggestedReturnSetting`, `planSuggestedReturns`, `sweepSuggestedReturns`, constantes `RETORNO_*`, tipos `SuggestedReturnSetting`, `PlannedReturn`, `SweepReturnResult`
- `domain/notes-merge.ts`: `planNotesMerge`, `applyNotesMerge`, `restoreNotesMerge`
- `domain/tags.ts`: `normalizeTagName`, `bulkTagContacts`
- `queries/client-snapshot.ts`: `getClientSnapshot`, tipo `ClientSnapshot`
- `queries/client-context.ts`: `ClientContext` com `situation`, `short`, `states`, `retorno`, `preferredProfessional`, `alertNotes`, `knownSince` (visitas e "desde" com o Avec)
- `queries/contact-visits.ts`: `getContactVisits`, `VISITS_LIMIT`
- `queries/contact.ts`: `ContactDeal.merged`; contato com aniversário, avisos fixos e preferida escolhida
- `queries/contacts.ts`: `listContacts` (filtro, filtros em lista, ordenação, colunas, frase curta), `contactFilterCounts`, `contactListOptions`, tipos `ContactRow`, `ContactListOpts`
- `queries/contacts-csv.ts`: `exportContactRows`, `contactsCsv`, `EXPORT_MAX`, tipo `ContactExportRow`
- `queries/avec-links.ts`: `linkAvecRows`
- `queries/today.ts`: `TodayItem.contactId`; `queries/alerts.ts`: `AlertItem.contactId`; `reports/queries.ts`: `ChargeItem.contactId`
- `domain/avec/apply.ts`: `applyAvecFiles(...)` devolve também `visao: RefreshResult | null`
- `domain/updates.ts`: `DealPatch.notes` (grava em `contacts.notes`)
- `domain/lid-merge.ts`: o lead que sai na junção ganha o evento `contato_mesclado`

**Telas, ações e rotas**
- Ações em `contatos/actions.ts`: `updateContactProfileAction`, `addContactTagAction`, `removeContactTagAction`, `remindReturnAction`, `scheduleFromContactAction`, `tagContactsAction`; em `config/actions.ts`: `setSuggestedReturnAction`
- `GET /api/contatos/csv`
- Componentes: `ClientLink`, `TagsEditor({ contactId })`, `ConversationPane({ openSchedule })`, `FichaHeader`, blocos da ficha (`data-bloco`), `ProfileField`, `ReturnActions`, `VisitsBlock`, `SuggestedReturnSwitch`, `ContactsList({ tagOptions, canExport })`, `ContactsBulkBar({ tagOptions, canExport })`
- `/atendimento/[id]?agendar=1` abre a folha Agendar

**Worker e CLI**
- filas `visao-contatos` (03:30, e logo ao subir se a visão estiver vazia) e `retorno-sugerido` (08:00, desligado até a gestão ligar)
- `scripts/visao-contatos.ts [--dry-run|--aplicar]`, `scripts/unificar-anotacoes.ts [--dry-run|--aplicar [--backup arq]|--desfazer arq]`, `scripts/retorno-sugerido.ts [--dry-run|--aplicar]`

---

## Implantação

Só depois das Tarefas 1 a 15 commitadas, do worktree juntado à `rodada-2` e com o ok do dono para cada passo que grava em produção. Fora do expediente da Casa (ter–sáb, 9h–18h). Nada aqui envia WhatsApp. Mesmo procedimento de pacote em pasta nova dos lotes anteriores (`/opt/crm-rN`).

**I0. Junção e testes (no Mac)**

```bash
git merge --no-ff lote-2-ficha-contatos   # na rodada-2, com 1A–1C e a outra frente já juntados
ls drizzle/*.sql | tail -4                 # se outra frente também criou uma 0025: apague drizzle/0025_ficha_contatos.sql e o snapshot dela,
                                           # tire a entrada dela do drizzle/meta/_journal.json e rode de novo: npx drizzle-kit generate --name ficha_contatos
grep -nE "DROP|ALTER COLUMN|RENAME" drizzle/*ficha_contatos.sql   # vazio
npm test && npm run typecheck && npm run lint && npm run build && npx playwright test
```
Esperado: tudo PASS.

**I1–I4. Pacote, build em pasta nova, backup e parada** (igual aos lotes anteriores; `N` = o número seguinte ao da pasta no ar, visto com `ls -d /opt/crm*` no servidor; troque `N` em todos os comandos)

```bash
git archive --format=tar.gz -o /tmp/crm-rN.tgz HEAD && scp /tmp/crm-rN.tgz casafiaes:~/ && rm /tmp/crm-rN.tgz
# no servidor: pasta /opt/crm-rN, .env copiado, npm ci, npm run build (sem parar o que está no ar)
cd /opt/crm && sudo -u crm bash scripts/backup.sh        # anote a pasta do backup
sudo -u crm pm2 stop crm-web crm-worker
```

**I5. Migrar e semear com o código novo**

```bash
cd /opt/crm-rN && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) from contact_stats"   # 0 (a tabela nasceu vazia)
```

**I6. Troca de pasta e só a web de volta** (o worker fica parado até o I8)

```bash
sudo mv /opt/crm /opt/crm-anterior && sudo mv /opt/crm-rN /opt/crm && cd /opt/crm && sudo -u crm pm2 start crm-web
curl -s https://crm.217-76-54-18.sslip.io/api/health
```

**I7. Visão por contato (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/visao-contatos.ts            # ENSAIO: nada gravado
```
Esperado, perto da auditoria de 15/10: visitas 1 ≈ 2.363 · 2–4 ≈ 1.110 · 5–11 ≈ 513 · 12+ ≈ 167; com ritmo ≈ 1.163 e mediana ≈ 62 dias; preferida ≈ 752; sumidas ≈ 199; na hora ≈ 118; aniversário mês ≈ 292; nunca voltou ≈ 2.363. Diferença grande (mais de 10%): parar e conferir antes de aplicar.

```bash
sudo -u crm npx tsx scripts/visao-contatos.ts --aplicar  # grava só a tabela derivada (refeita toda noite)
```

**I8. Anotações num campo só (ensaio → ok do dono → aplicar) e worker**

```bash
sudo -u crm npx tsx scripts/unificar-anotacoes.ts       # ENSAIO: ~109 anotações de leads
sudo -u crm env BACKUP_DIR=/home/crm/backups npx tsx scripts/unificar-anotacoes.ts --aplicar
```
Esperado: "Gravado: N contatos. Backup: /home/crm/backups/anotacoes-…-antes.json" e "Conferência: nada pendente.". Para voltar: `--desfazer <esse arquivo>`.

```bash
sudo -u crm pm2 start crm-worker && sudo -u crm pm2 save
curl -s https://crm.217-76-54-18.sslip.io/api/health      # status ok, worker.ok true em até 1 min
```

**I9. Retorno sugerido (fica DESLIGADO; ligar só com o ok do dono)**

```bash
sudo -u crm npx tsx scripts/retorno-sugerido.ts           # ENSAIO: quem entraria hoje (até 20)
```
Mostrar ao dono a lista e o número. Com o ok: a gestão liga em Configurações › Automações › "Retorno sugerido automático". No próximo dia de expediente, às 08:00, o worker cria os cartões (ou, se o dono quiser ver na hora: `sudo -u crm npx tsx scripts/retorno-sugerido.ts --aplicar`). Para parar: desligar a chave (os cartões já criados ficam; dá para fechar pelo Quadro em massa).

**I10. Conferir (só leitura)**

```bash
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select (select count(*) from contacts) as contatos, (select count(*) from contact_stats) as na_visao"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as anotacoes_presas from deals d join contacts c on c.id = d.contact_id where nullif(trim(d.observations), '') is not null and position(trim(d.observations) in coalesce(c.notes, '')) = 0"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as cartoes_retorno from deals d join stages s on s.id = d.stage_id where s.kind = 'retorno' and d.closed_at is null"
```
Esperado: `na_visao` = `contatos` (menos os criados depois do I7); `anotacoes_presas` = 0; `cartoes_retorno` = 0 até a chave ser ligada.

**I11. Prints** (navegador headless em segundo plano, gestão e atendente; 1440 px e 390 px): ficha de uma cliente frequente (blocos em ordem, frase, retorno, visitas com observação, financeiro só na gestão), painel da conversa (frase, visitas do Avec, "Ver ficha completa"), lista de Contatos com um filtro ligado e a barra de ações em massa, Configurações › Automações com a chave. Salvar numa pasta só (`~/ClaudeGerado/casa-fiaes-crm-lote-2-AAAA-MM-DD/`), mandar ao usuário e apagar a pasta depois de entregue.

**Voltar, se precisar**
- Código: parar web e worker, devolver `/opt/crm-anterior` para `/opt/crm` e subir de novo. A migration é aditiva: a versão anterior ignora `contact_stats`, `alert_notes` e `preferred_professional_id`.
- Anotações: `scripts/unificar-anotacoes.ts --desfazer <backup>`.
- Retorno sugerido: desligar a chave.
- Banco inteiro: o backup do I1–I4, só se houver dano (perde o que entrou depois).

---

## Autoconferência (skill writing-plans)

### 1. Cobertura da spec (seção 3 › Lote 2)

| Spec | Onde no plano |
|---|---|
| Clique: nome e foto abrem a ficha (conversa, cabeçalho, faixa; Quadro; Jornada; Hoje; sino; Agenda; Relatórios e tabelas do Avec) | T9 (conversa, cabeçalho, faixa), T10 (Quadro pelo painel do lead, Jornada, Hoje, sino, Agenda pelo painel do horário, Relatórios), T11 (tabelas do Avec); e2e T10 |
| Ficha 1: foto, nome, telefone, Conversar/Ligar/WhatsApp, etiquetas editáveis, avisos fixos (alergia, preferência, dívida/crédito) | T1 (`alert_notes`), T6 (etiquetas por contato), T8 (`FichaHeader`) |
| Ficha 2: situação numa frase, montada no servidor, com os estados | T2 (`clientSituation`), T5 (`getClientSnapshot`), T8 |
| Ficha 3: Agora (etapa, dona, quem respondeu, próxima ação) e próximos horários | T5, T8 (`NowBlock` + `UpcomingAppointments`) |
| Ficha 4: Retorno sugerido com Agendar e Lembrar; ritmo com 3+ visitas, senão ciclo; a etapa 6 do funil | T2, T3, T6 (Lembrar/Agendar), T8, T14 (etapa 6 automática) |
| Ficha 5: Números para a atendente; ticket e total só com ver valores | T5, T8 (`NumbersBlock`); e2e T8 |
| Ficha 6: preferida calculada (60%+) e editável; 3 serviços; aniversário; "Como conheceu" com "CLIENTE GILVAN" como profissional | T3, T5, T6, T8 |
| Ficha 7: Pacotes | T8 (componente existente, no lugar da ordem) |
| Ficha 8: Visitas passadas e futuras com profissional, status e observação, juntas com as comandas por dia | T8 (`mergeVisitDays`, `getContactVisits`) |
| Ficha 9: Financeiro (gestão): pagamentos, crédito, dívida | T3, T5, T8 (`FinanceBlock`) |
| Ficha 10: Anotações num campo único (as 109 dos leads) | T7 |
| Ficha 11: Conversa resumida e Histórico recolhido | T8 (`ConversationBlock`) |
| Ficha 12: Leads com "Mesclado" separado de "Não é cliente" | T8 (`merged`, `lid-merge`) |
| Nome, e-mail, aniversário, anotação, etiqueta e preferida editáveis na ficha | T6, T8 |
| Painel da conversa: mesma frase; visitas e "desde" do Avec (122/109); retorno; preferida | T5 (`clientContext`), T9 |
| Lista: filtros em botão com contagem (Sumidas, Na hora, Aniversariantes semana/mês, Com pacote, Com horário, Sem dono, Nunca voltou, VIP, Faltosas) | T12, T13 |
| Lista: filtros em lista (profissional, serviço, etiqueta, origem) | T12, T13 |
| Lista: colunas e ordenação | T12, T13 |
| Lista: ações em massa (etiquetar, exportar CSV, Não é cliente) | T13 (Não é cliente já existia) |
| Dados: visão por contato recalculada após importação e à noite | T1, T3, T4 |
| Como testar: contagens batem com a auditoria (199, 118, 60, 292, 2.363) | T3/T12 (`scripts/visao-contatos.ts`), Implantação I7 |
| Como testar: cliente frequente com visitas > 0 e "desde" antes de 2026 | T5, Passo 1 |
| Como testar: todos os pontos de clique abrem a ficha | T10 (`e2e/ficha-cliques.spec.ts`), T9 |
| Seção 4 (decisões): decisão 4 (cartão só para quem conversa) aplicada ao retorno | T14 (`RETORNO_CONVERSA_DIAS`) |
| Seção 5 (fora de escopo): nada daqui entrou | ver "Lacunas" |

### 2. Placeholders

Procurados: "TBD", "TODO", "implementar depois", "similar à Tarefa", "tratar erros adequadamente". Nenhum. Os pontos condicionais são de conferência com o comando a rodar: T1 Passo 4 (parar se o drizzle-kit gerar `DROP`), T4 Passo 2 (`route.ts` só se o TypeScript pedir), T8 Passo 8 e T13 Passo 7 (textos antigos de e2e trocados pelos blocos novos), T10 Passo 3 (o círculo da Jornada fica como o 1A/1C deixaram).

### 3. Consistência de nomes e tipos

- `contactHref` nasce na T9 e é usado na T10, T11 e T13; `ClientLink` nasce na T9.
- `clientSituation` (T2) é a única fonte da frase: ficha e painel (T5 via `getClientSnapshot`), lista (T12 em `listContacts`); a frase curta (`short`) é a coluna da lista e a faixa da conversa.
- As comparações do ritmo existem em dois lugares por necessidade (TS e SQL) e usam as mesmas constantes; o teste "ficha e filtro concordam nas bordas" (T12) amarra os dois.
- `remindReturn` (T6) e a varredura (T14) moram no mesmo arquivo `suggested-return.ts`; o combinado do "Lembrar" é tarefa `retorno` com `REMIND_META`; o da varredura é a próxima ação com `RETORNO_META`.
- `contact_stats.preferred_professional_*` é a calculada; `contacts.preferred_professional_id` é a escolhida; `getClientSnapshot.preferred.source` diz qual vale.
- Nomes do 1C usados (confirmar com `grep -n` ao executar): `stageByKind`, `moveToKindTx`, `findOpenDeal`, `activeOwnerTx`, `syncContactFunnelTx`, `cancelOpenTasksByOriginTx`, `clientFirstName`, `applyAvecFiles(...).funil`.
- Migration: `0025_ficha_contatos` (T1), única do lote.

### 4. Review Focus

Os cinco itens do topo têm teste: (1) T2 Passo 1 e T12 Passo 1; (2) T14 Passo 1; (3) T5 Passo 1 e T13 Passo 1 (e o e2e da atendente na T8); (4) T2 Passo 1 e T12 Passo 1; (5) T3 Passo 1.

### Lacunas que o plano não cobre (de propósito)

1. **Mensagem em massa** a partir dos filtros: Lote 5 (spec), com confirmação.
2. **Marcar horário direto na Agenda, duração/ciclo/preço de serviço, horário por profissional, bloqueios, comanda, caixa, comissão, pacotes vendidos pelo CRM:** a outra frente (Lotes 6A–7B). O "Agendar" da ficha usa a folha Agendar da conversa que existe hoje; o ciclo de retorno do serviço só é lido (`lists.cycle_days`), a tela para preencher é de outro lote.
3. **Tela para configurar o VIP** (12 visitas / 10% do gasto) e o teto do Retorno sugerido: Lote 4 (Configurações). Os valores ficam em constantes e em `settings.retorno_sugerido.maxPorDia`.
4. **Saldo de crédito/dívida:** o Avec importado não traz extrato; a ficha mostra os lançamentos com essas formas de pagamento, não um saldo.
5. **Tabelas do Avec:** só viram link as linhas cujo telefone ou nome único bate com um contato (a mesma regra da importação); nome repetido fica sem link.
6. **Combinado "Chamar para voltar" quando a cliente escreve primeiro:** o 1C leva o cartão para Em conversa e o combinado continua aberto até alguém concluir (a varredura só cancela nos caminhos dela: agenda, Aguardando e Retorno não feito).
7. **"Fechado/Perdido e a cliente escreve → Em conversa"** continua para o Lote 3 (como no 1C).
8. **A visão por contato é de ontem à noite** (ou da última importação) para visitas, ritmo e preferências; o que muda durante o dia (horário, conversa, aniversário) é lido ao vivo. Uma visita marcada como Compareceu na Agenda entra no ritmo só na próxima recalculada.
