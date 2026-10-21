# Lotes 3 e 4 (relatórios do salão e configurações): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar o andamento.

**Goal:** O dono enxerga o salão nos Relatórios (faturamento, profissionais, serviços, pagamentos, clientes, comparecimento, agenda sem desfecho, funil, retorno, comissão) com dado do Avec e do CRM (Lote 3), e a equipe configura o dia a dia sem mexer no sistema: permissões separadas, etiquetas, etapas criadas pela tela, profissionais enxutas, origens numa lista só e mensagens automáticas prontas e desligadas (Lote 4).

**Architecture:** Parte 3 primeiro, depois Parte 4, sobre a `rodada-2` com os Lotes 1A, 1B e 1C prontos. Regras puras ficam em `src/lib/*` (período do Salão, catálogo dos relatórios do Avec, abas de Configurações); as consultas do Salão leem `sales_items`, `sales_payments`, `appointments` e `deals` em SQL próprio (`src/server/reports/salon.ts`, `cohort.ts`, `replies.ts`), e os valores em R$ saem do servidor como `null` para quem não tem "ver valores". O schema muda uma vez só (Tarefa 0, migration aditiva); os dados de produção (comissão histórica) entram por script com ensaio, backup e conferência; a troca de permissões roda no seed, de forma idempotente.

**Tech Stack:** Next 16 (App Router, server actions), React 19, TypeScript, Drizzle ORM + drizzle-kit, Postgres 17 (Docker), pg-boss (worker), Vitest (+ Testing Library/jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md` (seção 3 › Lote 3 e Lote 4; seção 4 › Decisões do dono; seção 5 › Fora de escopo). Auditoria com arquivo:linha: `docs/analise-2026-10-15/relatorios-config.md`. Plano anterior (interfaces usadas aqui): `docs/superpowers/plans/2026-10-15-lotes-1-atendimento.md` (seções "Interfaces que o Lote 1A expõe" e "Interfaces que o Lote 1C expõe").

## Global Constraints

- **Ordem:** Tarefa 0 → Parte 3 (3.1 → 3.10) → Parte 4 (4.1 → 4.9). Os números de linha citados valem para o código **antes** deste plano e já com 1A/1B/1C; confirme sempre com `grep -n` antes de editar.
- **Código do 1C:** este plano trata como existente o que o plano do 1C produz (funil Novo contato → Em conversa → Aguardando cliente com 3 tentativas → Orçamento enviado → Agendado → Atendida → Retorno sugerido → Fechado/Perdido; `src/lib/attempts.ts`, `src/lib/alert-copy.ts`, `src/lib/authorship.ts`, migrations `0023` e `0024`). Antes de usar um nome dele, confirme: `grep -rn "<nome>" src`.
- **Fora deste plano (outra frente, Lotes 6A/6B/6C/7A/7B):** duração/preço/categoria de serviço, vínculo profissional↔serviço, horário de trabalho por profissional, bloqueios, marcar horário na Agenda, comanda/caixa, cálculo de comissão de comandas novas, pacotes vendidos pelo CRM, app da profissional, área da cliente. Não mexer em `ServicePicker`, `serviceIds`, `professional_services`, `appointments` (escrita), `agenda_blocks`.
- **Schema:** só na Tarefa 0, com `npx drizzle-kit generate --name relatorios_config`. Migrations só aditivas (nenhum `DROP`, nenhum `ALTER COLUMN ... TYPE`). A migration pode ser renumerada na junção com a `rodada-2`. Nomes fixos combinados com a frente 6C: `sales_items.commission_pct` e `sales_items.commission_cents`.
- **Dados iniciais** vão no seed (`src/server/db/seed.ts`, idempotente) ou em script idempotente; nunca em SQL solto na migration.
- **Produção:** números de produção só por script com `--dry-run` (ensaio), backup JSON antes de gravar e conferência depois; só aplica com o ok do dono.
- PT-BR em tudo que a equipe lê (telas, avisos, saída dos scripts). Código no estilo do arquivo ao redor.
- **Nunca enviar WhatsApp em teste:** a Evolution dos testes é `http://127.0.0.1:9` (`test/setup-env.ts`, conferido por `test/evolution-guard.test.ts`). Teste que precisa passar pela fila de envio usa o provider falso (`setWhatsappProvider(fake)`, como em `src/server/domain/outbox.test.ts`); nunca a Evolution real.
- **Nada de envio automático ligado:** as mensagens automáticas novas (boas-vindas, ausência, encerramento) nascem DESLIGADAS; ligar exige o diálogo `SendConfirmDialog`. O seed nunca liga nada.
- **Nunca guardar CPF, RG, endereço ou dados de banco.** Nenhum dado real de cliente no repositório: fixtures fictícias (nomes "Teste", telefones `+557199...` inventados).
- **Valores em R$** só para quem tem `valores.ver`: o servidor manda `null`, a tela não "esconde".
- **Banco do worktree:** o `DATABASE_URL` do `.env` do worktree tem de terminar em `/crm` (num Postgres/porta próprios). Os testes trocam `/crm` por `/crm_test` e `/crm_e2e`; com outro nome de banco, o `resetDb` apagaria o banco de desenvolvimento. Conferir antes do primeiro `npm test`: `grep DATABASE_URL .env`.
- **Portas do usuário intocadas:** 3000, 3100, 4321, 4400 e 8080. Playwright sempre com `E2E_PORT` definido pelo executor (ex.: `E2E_PORT=3217`); o padrão do `playwright.config.ts` é 3100, que é do usuário. Nos comandos abaixo, `$E2E_PORT` é a porta escolhida.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Testes: Postgres local de pé (`npm run infra:up`); o `vitest` migra o `crm_test` sozinho (`test/global-setup.ts`) e cada teste de banco usa `resetDb` (`test/db.ts`).

## Review Focus

Cinco situações que a spec implica e que mais podem morder quem usa. Cada uma tem teste na tarefa dona:

1. **Quem não tem "ver valores" abre o Salão ou a Análise:** nenhum R$ chega ao navegador (o servidor manda `null`), só quantidades. Teste: Tarefa 3.4, Passo 1 ("sem valores.ver o Salão chega sem nenhum valor") e Tarefa 3.4, Passo 8 (e2e com perfil sem valores).
2. **Datas absurdas do Avec e período livre torto** (`de=4676-11-10`, `de` depois de `ate`, `2026-02-30`, horário em 2923): o período é corrigido sem erro e o horário de 2923 não conta como "marcou horário" no funil. Testes: Tarefa 3.1, Passo 1 ("período livre torto") e Tarefa 3.3, Passo 1 ("horário em 2923 não conta").
3. **Etapa criada pela tela perde os avisos ou o sistema perde uma etapa de que precisa:** etapa nova entra nas automações de espera e continua nelas depois de um novo deploy (o seed não tira); apagar a única etapa de um tipo, ou uma com conversas abertas, é recusado com frase clara. Teste: Tarefa 4.4, Passo 1 ("etapa nova recebe os avisos de espera e o seed não tira…" e "não apaga a única etapa do tipo nem etapa com conversa aberta…").
4. **Renomear ou juntar a etiqueta "Uso de imagem":** a importação do Avec procura essa etiqueta pelo nome e criaria outra; a tela recusa renomear e juntar *a partir* dela. Teste: Tarefa 4.2, Passo 1 ("Uso de imagem não muda de nome nem some").
5. **Seed rodando de novo depois da troca de permissões:** quem tinha `config.editar` fica com `config.diaadia` e `config.sistema` (mesmo acesso), a Atendente ganha o dia a dia **uma vez só**, e se a gestão tirar `config.diaadia` da Atendente o próximo deploy não devolve. Teste: Tarefa 4.1, Passo 1 (`src/server/auth/profiles-seed.test.ts`).

Outros riscos com teste próprio: item de comissão ambíguo (mesmo item duas vezes na comanda com comissões diferentes) fica de fora em vez de receber o valor errado (3.8); mensagem automática desligada depois de entrar na fila é cancelada na hora de enviar (4.8); cliente que volta depois de Fechado/Perdido não conta como "respondida" sem resposta (3.10).

## Decisões de interpretação (para quem revisa)

- **"Salão" é uma aba** ao lado de Visão geral, com período próprio (Hoje, 7 dias, Este mês, Mês passado, Este ano, Escolher datas). Aparece para quem tem `relatorios.ver` **e** `relatorios.equipe` (são números do salão inteiro); os valores, só com `valores.ver`.
- **Faturamento = soma dos itens de comanda (`sales_items`), valor − desconto (Lote 0), sem as sessões de pacote** (`from_package`: o dinheiro entrou quando o pacote foi vendido). A conferência por ano contra os pagamentos imprime as duas contas (com e sem sessões) para o dono decidir se algo destoar.
- **Financeiro "Avec + CRM"** mostra dois blocos sem somar um no outro: "No salão (comandas)" (`sales_items`/`sales_payments`, de qualquer origem: Avec hoje, comanda do CRM depois do 6C) e "Vendas fechadas no atendimento" (`deals` fechados com valor). Somar contaria duas vezes quando a comanda do CRM existir.
- **"Tempo de resposta por atendente"** passa a usar a **autora da mensagem** (Lote 1A: assinatura ou pessoa logada), também nas primeiras respostas de "Cada pessoa contra a meta" e no PDF "Por atendente". Resposta sem autora (áudio, foto, celular sem assinatura) aparece à parte como "sem autora"; nas primeiras respostas continua valendo a regra antiga (conta para a dona).
- **"Quais perfis veem" a etapa** vale para o **Quadro** (colunas). A Fila continua mostrando toda conversa que espera resposta (esconder conversa esperando deixaria cliente sem resposta); a Jornada é só da gestão, que vê tudo.
- **"Sequência de Aguardando configurável"** = os 3 dias das tentativas (D+1, D+3, D+7; Orçamento D+2, D+4, D+8) por etapa, no lugar da constante `ATTEMPT_DAYS` do 1C. Continuam 3 tentativas (decisão 3 do dono).
- **Apagar etapa**: com histórico (alguma conversa já passou por ela) a etapa é **desativada** (some de tudo, o histórico continua com o nome); sem histórico, é apagada de verdade.
- **Herdado do 1C:** o plano do 1C deixou para o "Lote 3" a regra "Fechado/Perdido e a cliente escreve → Em conversa" e o ajuste do relatório "respondidos" (`reports/queries.ts:95`). Entra aqui na Tarefa 3.10.

## Preparação do worktree (antes da Tarefa 0, sem commit)

- [ ] **Passo 1: Banco próprio e porta do e2e**

O executor escolhe uma porta livre para o Postgres (fora de 3000/3100/4321/4400/8080; a 5433 é a do banco de desenvolvimento da pasta principal) e uma para o e2e. Exemplo com `55434` e `3317` (troque pelos números escolhidos):

```bash
cp ../crm/.env .env   # o caminho da pasta principal; NÃO commitar
sed -i '' 's#@localhost:[0-9]*/crm$#@localhost:55434/crm#' .env   # só a porta muda; usuário e senha (PG_PASSWORD) ficam
grep DATABASE_URL .env   # tem de terminar em /crm
PG_PORT=55434 docker compose -p crm-lote34 up -d db
until docker compose -p crm-lote34 exec -T db pg_isready -U crm -d crm; do sleep 1; done
npm ci && npm run db:migrate && npm run db:seed
export E2E_PORT=3317
```

Esperado: `db:migrate` aplica até a `0024_funil_novo` (Lote 1C) sem erro; o banco se chama `crm` (os testes usam `crm_test` e `crm_e2e`, criados por `docker/init-db.sql`). A Evolution não sobe.

- [ ] **Passo 2: Linha de base verde**

Rodar: `npm test && npm run typecheck`
Esperado: PASS. Se algo falhar aqui, é do código de base (1A–1C): parar e avisar; não corrigir neste plano.

---

## Mapa de arquivos

**Criados**

| Tarefa | Arquivos |
|---|---|
| 0 | `drizzle/0025_relatorios_config.sql`, `drizzle/meta/0025_snapshot.json` |
| 3.1 | `src/lib/salon-period.ts`, `src/lib/salon-period.test.ts` |
| 3.2 | `src/server/reports/salon.ts`, `src/server/reports/salon.test.ts`, `test/salon-fixtures.ts`, `scripts/conferir-faturamento.ts` |
| 3.3 | `src/server/reports/salon-agenda.test.ts` |
| 3.4 | `src/components/reports/salon.tsx`, `src/components/reports/salon-period-picker.tsx`, `src/components/reports/salon.render.test.tsx`, `src/server/reports/salon-view.test.ts`, `e2e/relatorios-salao.spec.ts` |
| 3.5 | `src/server/reports/cohort.ts`, `src/server/reports/cohort.test.ts` |
| 3.6 | `src/server/reports/salon-finance.test.ts` |
| 3.7 | `src/server/reports/replies.ts`, `src/server/reports/replies.test.ts` |
| 3.8 | `src/server/domain/avec/commission-backfill.ts`, `src/server/domain/avec/commission-backfill.test.ts`, `scripts/comissao-avec.ts` |
| 3.9 | `src/lib/avec-catalog.ts`, `src/lib/avec-catalog.test.ts`, `src/components/relatorios-avec/catalog.tsx`, `src/components/relatorios-avec/catalog.test.tsx` |
| 3.10 | `src/server/domain/returning-client.test.ts` |
| 4.1 | `src/lib/config-tabs.ts`, `src/lib/config-tabs.test.ts`, `e2e/config-lote4.spec.ts` |
| 4.2 | `src/lib/tag-colors.ts`, `src/app/(app)/config/etiquetas/page.tsx`, `src/components/config/tags.tsx`, `src/components/config/tags.test.tsx`, `src/components/tags/tag-dot.tsx` |
| 4.3 | `src/components/tags/tag-filter.tsx` |
| 4.4 | `src/lib/stage-kind-labels.ts`, `src/lib/stage-visibility.ts`, `src/server/domain/stage-admin.ts`, `src/server/domain/stage-admin.test.ts` |
| 4.5 | `src/server/domain/attempt-days.test.ts` |
| 4.6 | `src/components/config/professionals.test.tsx` |
| 4.7 | `src/components/config/origins.tsx`, `src/components/config/origins.test.tsx` |
| 4.8 | `src/lib/auto-message-text.ts`, `src/server/domain/auto-message-settings.ts`, `src/server/domain/auto-messages.ts`, `src/server/domain/auto-messages.test.ts`, `src/components/config/auto-messages.tsx`, `src/components/config/auto-messages.test.tsx` |

**Modificados (principais)**

| Área | Arquivos |
|---|---|
| Banco | `src/server/db/schema.ts`, `src/server/db/schema.test.ts`, `src/server/db/seed.ts` |
| Permissões | `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `src/server/auth/profiles-seed.test.ts` |
| Relatórios | `src/server/reports/queries.ts`, `src/server/reports/team.ts`, `src/server/reports/screen.ts`, `src/lib/report-legend.ts`, `src/app/(app)/relatorios/page.tsx`, `src/components/reports/report-tabs.tsx`, `src/components/reports/analysis.tsx`, `src/app/api/relatorios/[tipo]/route.ts` |
| Avec | `src/server/domain/avec/normalize.ts`, `src/server/domain/avec/import-sales.ts`, `src/server/domain/avec/apply.test.ts`, `src/app/(app)/relatorios/avec/page.tsx` |
| Atendimento | `src/server/domain/deals.ts`, `src/server/queries/queue.ts`, `src/lib/queue.ts`, `src/components/queue/queue-filters.tsx`, `src/components/queue/queue-column.tsx`, `src/components/queue/queue-item.tsx`, `src/components/queue/tags-editor.tsx`, `src/app/(app)/atendimento/page.tsx` |
| Contatos | `src/server/queries/contacts.ts`, `src/app/(app)/contatos/page.tsx`, `src/app/(app)/contatos/actions.ts` |
| Quadro | `src/server/queries/board.ts`, `src/app/(app)/funil/page.tsx` |
| Configurações | `src/app/(app)/config/*` (layout, page, actions e as páginas), `src/components/config/config-nav.tsx`, `stages.tsx`, `distribution.tsx`, `professionals.tsx`, `lists.tsx`, `messages.tsx` |
| Domínio | `src/server/domain/tags.ts`, `src/server/domain/attempts.ts`, `src/server/domain/funnel.ts`, `src/lib/attempts.ts`, `src/server/domain/outbox.ts`, `src/server/domain/conversation-archive.ts` |
| Casca | `src/components/shell/sidebar.tsx`, `src/components/shell/connection-banner.tsx`, `src/components/queue/use-lead-actions.tsx`, `src/app/(app)/quiet/actions.ts`, `src/app/dev/simulador/*` |
| e2e e docs | `e2e/cliente.spec.ts`, `docs/deploy-contabo.md` |

---

## Parte 0: Banco

### Tarefa 0: Schema único (migration 0025): comissão no item, cor da etiqueta, perfis e tentativas da etapa

**Arquivos:**
- Modificar: `src/server/db/schema.ts` (tabelas `stages` ~linha 60, `tags` ~linha 403, `salesItems` ~linha 528)
- Criar: `drizzle/0025_relatorios_config.sql` e `drizzle/meta/0025_snapshot.json` (gerados)
- Teste: `src/server/db/schema.test.ts`

**Interfaces:**
- Consome: nada.
- Produz (todas anuláveis, usadas pelas tarefas seguintes):
  - `stages.visibleProfileIds: string[] | null` (coluna `visible_profile_ids uuid[]`): perfis que veem a etapa no Quadro; `null` ou vazio = todos (Tarefa 4.4).
  - `stages.attemptDays: number[] | null` (coluna `attempt_days smallint[]`): os 3 dias das tentativas; `null` = padrão do tipo (Tarefa 4.5).
  - `tags.color: string | null` (coluna `color text`): `#rrggbb` ou `null` (Tarefas 4.2 e 4.3).
  - `salesItems.commissionPct: number | null` (coluna `commission_pct numeric(5,2)`) e `salesItems.commissionCents: number | null` (coluna `commission_cents integer`) (Tarefas 3.2 e 3.8; a frente 6C usa as mesmas).

- [ ] **Passo 1: Escrever o teste que falha**

Acrescentar em `src/server/db/schema.test.ts`, dentro do `describe("migração das melhorias", ...)`:

```ts
  it("Lotes 3 e 4: comissão no item, cor da etiqueta, perfis e tentativas da etapa", async () => {
    expect(await cols("sales_items")).toEqual(expect.arrayContaining(["commission_pct", "commission_cents"]));
    expect(await cols("tags")).toContain("color");
    expect(await cols("stages")).toEqual(expect.arrayContaining(["visible_profile_ids", "attempt_days"]));
    const types = (await db.execute(sql`select column_name::text as column_name, data_type::text as data_type, numeric_precision::int as numeric_precision,
      numeric_scale::int as numeric_scale from information_schema.columns
      where table_name = 'sales_items' and column_name in ('commission_pct', 'commission_cents') order by column_name`)).rows;
    expect(types).toEqual([
      { column_name: "commission_cents", data_type: "integer", numeric_precision: 32, numeric_scale: 0 },
      { column_name: "commission_pct", data_type: "numeric", numeric_precision: 5, numeric_scale: 2 },
    ]);
  });
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/db/schema.test.ts`
Esperado: FAIL (`expected [...] to contain "commission_pct"`).

- [ ] **Passo 3: Schema**

Em `src/server/db/schema.ts`, na tabela `stages`, depois de `active`:

```ts
  /** Perfis que veem a etapa no Quadro (Configurações › Etapas). null ou vazio = todos. A gestão vê todas; a Fila não muda (Lote 4). */
  visibleProfileIds: uuid("visible_profile_ids").array(),
  /** Aguardando cliente / Orçamento enviado: os dias das 3 tentativas (ex.: {1,3,7}). null = o padrão do tipo (src/lib/attempts.ts). */
  attemptDays: smallint("attempt_days").array(),
```

Na tabela `tags`, depois de `name`:

```ts
  /** Cor da etiqueta ("#8a6a2f"), escolhida em Configurações › Etiquetas. null = sem cor (neutra). */
  color: text("color"),
```

Na tabela `salesItems`, depois de `totalCents`:

```ts
  /**
   * Comissão do item: % e valor em centavos. Do Avec ("Itens de comanda": Comissão (%) e Comissão; "Comissão por item"). A comanda nova
   * do CRM (Lote 6C) grava nas MESMAS colunas. null = não informado (nunca chutar).
   */
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2, mode: "number" }),
  commissionCents: integer("commission_cents"),
```

- [ ] **Passo 4: Gerar a migration e torná-la idempotente**

Rodar: `npx drizzle-kit generate --name relatorios_config`
Esperado: cria `drizzle/0025_relatorios_config.sql` (se a junção com a `rodada-2` já tiver outra 0025, vale o número que o drizzle-kit der).

Editar o SQL gerado para `ADD COLUMN IF NOT EXISTS` (a frente 6C pode trazer as mesmas colunas de comissão; assim a junção não quebra). Resultado esperado (a ordem das linhas pode variar):

```sql
ALTER TABLE "sales_items" ADD COLUMN IF NOT EXISTS "commission_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales_items" ADD COLUMN IF NOT EXISTS "commission_cents" integer;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "visible_profile_ids" uuid[];--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "attempt_days" smallint[];--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "color" text;
```

Conferir: `grep -nE "DROP|ALTER COLUMN|TYPE " drizzle/0025_relatorios_config.sql` não pode imprimir nada. Se imprimir, parar e conferir `git diff drizzle/meta`.

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/db/schema.test.ts && npm run typecheck`
Esperado: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/server/db/schema.ts src/server/db/schema.test.ts drizzle/
git commit -m "feat(banco): comissão no item do Avec, cor da etiqueta, perfis e tentativas da etapa (migration aditiva)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Parte 3: Relatórios do salão (Lote 3)

### Tarefa 3.1: Período do Salão (módulo puro): atalhos, período livre, anterior e barras

**Arquivos:**
- Criar: `src/lib/salon-period.ts`
- Teste: `src/lib/salon-period.test.ts`

**Interfaces:**
- Consome: nada.
- Produz:
  - `SALON_PRESETS = ["hoje", "7d", "mes", "mes-passado", "ano", "livre"]`, `type SalonPreset`, `SALON_PRESET_LABEL: Record<SalonPreset, string>`
  - `type SalonRange = { preset; from: string; to: string; prevFrom: string; prevTo: string; days: number; grain: "dia" | "mes"; label: string; prevLabel: string }` (datas "AAAA-MM-DD" de Salvador, inclusivas)
  - `salonRange(p: { periodo?: string | null; de?: string | null; ate?: string | null }, now: Date): SalonRange`
  - `salonBuckets(r: Pick<SalonRange, "from" | "to" | "grain">): string[]` (dias "AAAA-MM-DD" ou meses "AAAA-MM")
  - `salonQuery(r: Pick<SalonRange, "preset" | "from" | "to">): string` (sem o `?`)
  - `todayBahia(now: Date): string`, `brDay(d: string): string`, `rangeLabel(from, to): string`, `bucketLabel(key: string): string`
  - `SALON_MIN_DATE = "2015-01-01"`, `SALON_MAX_DAYS = 1098`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/lib/salon-period.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bucketLabel, rangeLabel, salonBuckets, salonQuery, salonRange, todayBahia } from "./salon-period";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador

describe("período do Salão", () => {
  it("hoje é o dia de Salvador, também depois das 21h (quando em UTC já é amanhã)", () => {
    expect(todayBahia(new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15");
    expect(salonRange({ periodo: "hoje" }, NOW)).toMatchObject({ preset: "hoje", from: "2026-10-15", to: "2026-10-15", prevFrom: "2026-10-14", prevTo: "2026-10-14", days: 1, grain: "dia" });
  });
  it("7 dias, este mês, mês passado e este ano, cada um com o período anterior certo", () => {
    expect(salonRange({ periodo: "7d" }, NOW)).toMatchObject({ from: "2026-10-09", to: "2026-10-15", prevFrom: "2026-10-02", prevTo: "2026-10-08" });
    expect(salonRange({ periodo: "mes" }, NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-15", prevFrom: "2026-09-01", prevTo: "2026-09-15", grain: "dia" });
    expect(salonRange({ periodo: "mes-passado" }, NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", prevFrom: "2026-08-01", prevTo: "2026-08-31" });
    expect(salonRange({ periodo: "ano" }, NOW)).toMatchObject({ from: "2026-01-01", to: "2026-10-15", prevFrom: "2025-01-01", prevTo: "2025-10-15", grain: "mes" });
  });
  it("31 de março: o pedaço do mês anterior para no último dia de fevereiro; em janeiro, o mês passado é dezembro", () => {
    expect(salonRange({ periodo: "mes" }, new Date("2026-03-31T15:00:00Z"))).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(salonRange({ periodo: "mes-passado" }, new Date("2026-01-10T15:00:00Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31", prevFrom: "2025-11-01", prevTo: "2025-11-30" });
  });
  it("período livre: compara com os mesmos dias logo antes", () => {
    expect(salonRange({ de: "2026-09-10", ate: "2026-09-20" }, NOW)).toMatchObject({
      preset: "livre", from: "2026-09-10", to: "2026-09-20", prevFrom: "2026-08-30", prevTo: "2026-09-09", days: 11, label: "10/09 a 20/09/2026",
    });
  });
  it("período livre torto: invertido, dia que não existe, ano 4676 e mais de 3 anos são corrigidos sem erro", () => {
    expect(salonRange({ de: "2026-09-20", ate: "2026-09-10" }, NOW)).toMatchObject({ from: "2026-09-10", to: "2026-09-20" });
    expect(salonRange({ de: "2026-02-30", ate: "lixo" }, NOW)).toMatchObject({ preset: "mes", from: "2026-10-01", to: "2026-10-15" });
    const absurdo = salonRange({ de: "4676-11-10" }, NOW);
    expect(absurdo.from).toBe("2026-10-15");
    expect(absurdo.to <= "2027-10-16").toBe(true);
    const longo = salonRange({ de: "2010-01-01", ate: "2026-10-15" }, NOW);
    expect(longo.from >= "2015-01-01").toBe(true);
    expect(longo.days).toBeLessThanOrEqual(1098);
  });
  it("barras: uma por dia até 62 dias, uma por mês acima disso, sem buracos", () => {
    expect(salonBuckets({ from: "2026-09-28", to: "2026-10-02", grain: "dia" })).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(salonBuckets({ from: "2025-11-15", to: "2026-02-03", grain: "mes" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(bucketLabel("2026-09-28")).toBe("28/09");
    expect(rangeLabel("2025-12-30", "2026-01-02")).toBe("30/12/2025 a 02/01/2026");
  });
  it("a URL do período volta ao mesmo período", () => {
    expect(salonQuery(salonRange({ periodo: "mes-passado" }, NOW))).toBe("aba=salao&periodo=mes-passado");
    expect(salonQuery(salonRange({ de: "2026-09-10", ate: "2026-09-20" }, NOW))).toBe("aba=salao&de=2026-09-10&ate=2026-09-20");
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/salon-period.test.ts`
Esperado: FAIL ("Failed to resolve import ./salon-period").

- [ ] **Passo 3: Implementar**

Criar `src/lib/salon-period.ts`:

```ts
/**
 * Período do painel Salão (Relatórios): datas locais de Salvador ("AAAA-MM-DD", inclusivas), o período anterior para comparar e o
 * tamanho das barras. Puro: servidor e navegador. Datas tortas na URL (invertidas, inexistentes, ano 4676) são corrigidas, nunca erro.
 */
export const SALON_PRESETS = ["hoje", "7d", "mes", "mes-passado", "ano", "livre"] as const;
export type SalonPreset = (typeof SALON_PRESETS)[number];
export const SALON_PRESET_LABEL: Record<SalonPreset, string> = {
  hoje: "Hoje", "7d": "7 dias", mes: "Este mês", "mes-passado": "Mês passado", ano: "Este ano", livre: "Escolher datas",
};
export type SalonRange = {
  preset: SalonPreset; from: string; to: string; prevFrom: string; prevTo: string; days: number;
  /** Barras por dia (até 62 dias) ou por mês. */ grain: "dia" | "mes";
  label: string; prevLabel: string;
};

/** O Avec da Casa começa em 2020; antes disso a data é engano. Período livre de até 3 anos (1098 dias). */
export const SALON_MIN_DATE = "2015-01-01";
export const SALON_MAX_DAYS = 1098;
const BAHIA_OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toIso(toMs(d) + n * DAY_MS);
const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS) + 1;
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** Data real no formato AAAA-MM-DD (2026-02-30 não passa). */
const valid = (d: unknown): d is string => typeof d === "string" && ISO.test(d) && !Number.isNaN(toMs(d)) && toIso(toMs(d)) === d;

export const todayBahia = (now: Date) => toIso(now.getTime() - BAHIA_OFFSET_MS);
export const brDay = (d: string) => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
export function rangeLabel(from: string, to: string): string {
  if (from === to) return brDay(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${brDay(from).slice(0, 5)} a ${brDay(to)}` : `${brDay(from)} a ${brDay(to)}`;
}

export function salonRange(p: { periodo?: string | null; de?: string | null; ate?: string | null }, now: Date): SalonRange {
  const today = todayBahia(now);
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1, d = Number(today.slice(8, 10));
  const prevMonth = (yy: number, mm0: number) => (mm0 === 0 ? { y: yy - 1, m0: 11 } : { y: yy, m0: mm0 - 1 });
  const sameLength = (f: string, t: string): [string, string] => { const n = daysBetween(f, t); return [addDays(f, -n), addDays(f, -1)]; };
  let preset: SalonPreset = (SALON_PRESETS as readonly string[]).includes(p.periodo ?? "") ? (p.periodo as SalonPreset) : "mes";
  if (valid(p.de) || valid(p.ate)) preset = "livre";
  let from: string, to: string, prevFrom: string, prevTo: string;
  switch (preset) {
    case "hoje": from = to = today; [prevFrom, prevTo] = sameLength(from, to); break;
    case "7d": from = addDays(today, -6); to = today; [prevFrom, prevTo] = sameLength(from, to); break;
    case "mes": {
      const pm = prevMonth(y, m0);
      from = toIso(Date.UTC(y, m0, 1)); to = today;
      prevFrom = toIso(Date.UTC(pm.y, pm.m0, 1)); prevTo = toIso(Date.UTC(pm.y, pm.m0, Math.min(d, lastDay(pm.y, pm.m0))));
      break;
    }
    case "mes-passado": {
      const pm = prevMonth(y, m0), qm = prevMonth(pm.y, pm.m0);
      from = toIso(Date.UTC(pm.y, pm.m0, 1)); to = toIso(Date.UTC(pm.y, pm.m0, lastDay(pm.y, pm.m0)));
      prevFrom = toIso(Date.UTC(qm.y, qm.m0, 1)); prevTo = toIso(Date.UTC(qm.y, qm.m0, lastDay(qm.y, qm.m0)));
      break;
    }
    case "ano":
      from = `${y}-01-01`; to = today;
      prevFrom = `${y - 1}-01-01`; prevTo = toIso(Date.UTC(y - 1, m0, Math.min(d, lastDay(y - 1, m0))));
      break;
    default: {
      let f = valid(p.de) ? p.de : valid(p.ate) ? p.ate : toIso(Date.UTC(y, m0, 1));
      let t = valid(p.ate) ? p.ate : today;
      if (f > t) [f, t] = [t, f];
      if (f < SALON_MIN_DATE) f = SALON_MIN_DATE;
      const maxTo = addDays(today, 366);
      if (t > maxTo) t = maxTo;
      if (f > t) f = t;
      if (daysBetween(f, t) > SALON_MAX_DAYS) f = addDays(t, -(SALON_MAX_DAYS - 1));
      from = f; to = t; [prevFrom, prevTo] = sameLength(from, to);
    }
  }
  const days = daysBetween(from, to);
  const span = rangeLabel(from, to);
  return { preset, from, to, prevFrom, prevTo, days, grain: days <= 62 ? "dia" : "mes", label: preset === "livre" ? span : `${SALON_PRESET_LABEL[preset]} (${span})`, prevLabel: rangeLabel(prevFrom, prevTo) };
}

/** As chaves das barras: cada dia ("AAAA-MM-DD") ou cada mês ("AAAA-MM") do período, em ordem e sem buracos. */
export function salonBuckets(r: Pick<SalonRange, "from" | "to" | "grain">): string[] {
  const out: string[] = [];
  if (r.grain === "dia") { for (let k = r.from; k <= r.to; k = addDays(k, 1)) out.push(k); return out; }
  let yy = Number(r.from.slice(0, 4)), mm = Number(r.from.slice(5, 7));
  const end = r.to.slice(0, 7);
  for (;;) {
    const k = `${yy}-${String(mm).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    mm++; if (mm > 12) { mm = 1; yy++; }
  }
  return out;
}

/** "28/09" para dia; "set. de 26" para mês. */
export const bucketLabel = (k: string) =>
  k.length === 10 ? brDay(k).slice(0, 5) : new Date(`${k}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Query string do período (sem o `?`): atalho em `periodo`, período livre em `de` e `ate`. */
export function salonQuery(r: Pick<SalonRange, "preset" | "from" | "to">): string {
  const q = new URLSearchParams({ aba: "salao" });
  if (r.preset === "livre") { q.set("de", r.from); q.set("ate", r.to); } else q.set("periodo", r.preset);
  return q.toString();
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/lib/salon-period.test.ts && npm run typecheck`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/salon-period.ts src/lib/salon-period.test.ts
git commit -m "feat(salão): período do painel (atalhos, datas livres corrigidas, período anterior e barras)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.2: Consultas de dinheiro do Salão (faturamento, profissional, serviço, pagamentos) e conferência por ano

**Arquivos:**
- Criar: `src/server/reports/salon.ts`
- Criar: `test/salon-fixtures.ts` (fixtures fictícias para os testes do Salão)
- Criar: `scripts/conferir-faturamento.ts` (só leitura)
- Teste: `src/server/reports/salon.test.ts`

**Interfaces:**
- Consome: `SalonRange`, `salonBuckets` (3.1); colunas `sales_items.commission_cents` (Tarefa 0).
- Produz (em `src/server/reports/salon.ts`):
  - `type DayRange = { from: string; to: string }`
  - `REVENUE(alias = "si"): SQL` (valor do item sem sessão de pacote) e `COMANDA_KEY(alias = "si"): SQL`
  - `type RevenueTotals = { cents: number; comandas: number; itens: number; ticketCents: number | null }`
  - `revenueTotals(r: DayRange): Promise<RevenueTotals>`
  - `salonRevenue(r: SalonRange): Promise<RevenueTotals & { previous: RevenueTotals; series: { key: string; cents: number; comandas: number }[] }>`
  - `avecUntil(): Promise<string | null>` (última venda importada do Avec, "AAAA-MM-DD")
  - `type ProfessionalRow = { key: string; name: string; cents: number; comandas: number; itens: number; ticketCents: number | null; commissionCents: number | null }`; `salonByProfessional(r: DayRange, opts?: { byCount?: boolean }): Promise<ProfessionalRow[]>`
  - `SERVICE_TOP = 15`; `type SalonServices = { items: { item: string; category: string | null; n: number; cents: number }[]; otherItems: { count: number; n: number; cents: number }; categories: { category: string; n: number; cents: number }[] }`; `salonByService(r: DayRange, opts?: { byCount?: boolean }): Promise<SalonServices>`
  - `type PaymentRow = { method: string; n: number; cents: number }`; `salonPayments(r: DayRange, opts?: { byCount?: boolean }): Promise<PaymentRow[]>`
  - `type YearCheck = { ano: number; faturamentoCents: number; comPacoteCents: number; pagamentosCents: number; diferencaPct: number | null }`; `yearlyCheck(): Promise<YearCheck[]>`
- Produz (em `test/salon-fixtures.ts`): `pro(name)`, `client(name, phone)`, `item({...})`, `payment({...})`, `appt({...})`.

- [ ] **Passo 1: Fixtures dos testes (fictícias)**

Criar `test/salon-fixtures.ts`:

```ts
import { db } from "@/server/db";
import { appointments, contacts, professionals, salesItems, salesPayments } from "@/server/db/schema";

/** Fixtures FICTÍCIAS do Salão (nomes "Teste", telefones inventados). Chave externa única por linha. */
let seq = 0;
const key = (p: string) => `teste:${p}:${++seq}`;

export async function pro(name: string) {
  const [p] = await db.insert(professionals).values({ name }).returning({ id: professionals.id });
  return p.id;
}
export async function client(name: string, phone: string) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone, isClient: true }).returning({ id: contacts.id });
  return c.id;
}
export async function item(v: {
  day: string; comanda?: string | null; item?: string; value: number; discount?: number | null; total?: number | null; kind?: string; category?: string | null;
  proId?: string | null; proName?: string | null; contactId?: string | null; clientName?: string | null; fromPackage?: boolean;
  commissionPct?: number | null; commissionCents?: number | null; origin?: string;
}) {
  await db.insert(salesItems).values({
    soldOn: v.day, comanda: v.comanda === undefined ? "1" : v.comanda, item: v.item ?? "Corte", kind: v.kind ?? "servico", category: v.category ?? null,
    professionalId: v.proId ?? null, professionalName: v.proName ?? null, contactId: v.contactId ?? null, clientName: v.clientName ?? null,
    valueCents: v.value, discountCents: v.discount ?? null, totalCents: v.total === undefined ? v.value - (v.discount ?? 0) : v.total,
    fromPackage: v.fromPackage ?? false, commissionPct: v.commissionPct ?? null, commissionCents: v.commissionCents ?? null,
    origin: v.origin ?? "avec", externalKey: key("item"),
  });
}
export async function payment(v: { day: string; value: number; method?: string | null; comanda?: string; paidOn?: string | null }) {
  await db.insert(salesPayments).values({
    comandaOn: v.day, paidOn: v.paidOn === undefined ? v.day : v.paidOn, comanda: v.comanda ?? "1", method: v.method === undefined ? "Pix" : v.method,
    valueCents: v.value, externalKey: key("pag"),
  });
}
/** Horário às `hm` de Salvador (UTC-3) no dia. */
export async function appt(v: { day: string; hm?: string; status: string; contactId?: string | null; proId?: string | null; service?: string; clientName?: string | null }) {
  const startsAt = new Date(Date.parse(`${v.day}T${v.hm ?? "10:00"}:00Z`) + 3 * 3_600_000);
  await db.insert(appointments).values({
    contactId: v.contactId ?? null, professionalId: v.proId ?? null, serviceLabel: v.service ?? "Corte", startsAt, status: v.status,
    clientName: v.clientName ?? null, externalKey: key("res"),
  });
}
```

- [ ] **Passo 2: Escrever o teste que falha**

Criar `src/server/reports/salon.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { avecUntil, salonByProfessional, salonByService, salonPayments, salonRevenue, yearlyCheck } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW); // setembro/2026; anterior: agosto

beforeEach(resetDb);

describe("Salão: dinheiro", () => {
  it("faturamento: valor − desconto, comanda pelo par dia+número, sem sessão de pacote, com o período anterior e barras sem buraco", async () => {
    await item({ day: "2026-09-02", comanda: "10", value: 30000, discount: 5000 });
    await item({ day: "2026-09-02", comanda: "10", item: "Escova", value: 10000 });
    await item({ day: "2026-09-03", comanda: "10", value: 20000 });                 // mesmo número, outro dia: outra comanda
    await item({ day: "2026-09-04", comanda: null, value: 5000 });                  // sem número: comanda própria
    await item({ day: "2026-09-05", comanda: "11", value: 40000, fromPackage: true }); // sessão de pacote: não é dinheiro novo
    await item({ day: "2026-09-06", comanda: "12", value: 8000, discount: 1000, total: null }); // linha antiga sem total: valor − desconto
    await item({ day: "2026-08-20", comanda: "3", value: 12000 });
    const r = await salonRevenue(SET);
    expect(r).toMatchObject({ cents: 67000, comandas: 4, ticketCents: 16750 });
    expect(r.previous).toMatchObject({ cents: 12000, comandas: 1 });
    expect(r.series).toHaveLength(30);
    expect(r.series[0]).toEqual({ key: "2026-09-01", cents: 0, comandas: 0 });
    expect(r.series.find((s) => s.key === "2026-09-02")).toEqual({ key: "2026-09-02", cents: 35000, comandas: 1 });
  });

  it("'fonte: Avec até': a última venda vinda do Avec (comanda do CRM não conta)", async () => {
    expect(await avecUntil()).toBeNull();
    await item({ day: "2026-10-14", value: 1000 });
    await item({ day: "2026-10-15", value: 1000, origin: "crm" });
    expect(await avecUntil()).toBe("2026-10-14");
  });

  it("por profissional: nome do cadastro, senão o nome escrito no Avec, senão 'Sem profissional'; comissão só quando existe", async () => {
    const maiara = await pro("MAIARA");
    await item({ day: "2026-09-02", comanda: "1", proId: maiara, value: 30000, commissionPct: 40, commissionCents: 12000 });
    await item({ day: "2026-09-02", comanda: "1", proId: maiara, item: "Escova", value: 10000 });
    await item({ day: "2026-09-03", comanda: "2", proName: "JO", value: 8000 });
    await item({ day: "2026-09-03", comanda: "3", value: 2000 });
    const rows = await salonByProfessional(SET);
    expect(rows.map((r) => [r.name, r.cents, r.comandas, r.ticketCents, r.commissionCents])).toEqual([
      ["MAIARA", 40000, 1, 40000, 12000], ["JO", 8000, 1, 8000, null], ["Sem profissional", 2000, 1, 2000, null],
    ]);
  });

  it("por serviço (os 15 maiores e o resto somado) e por categoria ('Sem categoria' quando falta)", async () => {
    for (let i = 0; i < 17; i++) {
      await item({ day: "2026-09-10", comanda: String(100 + i), item: `Serviço ${String(i).padStart(2, "0")}`, value: 1000 * (i + 1), category: i % 2 ? "CABELO" : null });
    }
    const s = await salonByService(SET);
    expect(s.items).toHaveLength(15);
    expect(s.items[0]).toMatchObject({ item: "Serviço 16", n: 1, cents: 17000 });
    expect(s.otherItems).toEqual({ count: 2, n: 2, cents: 3000 });
    expect(s.categories.map((c) => c.category).sort()).toEqual(["CABELO", "Sem categoria"]);
  });

  it("formas de pagamento: a bandeira não separa ('Cartão de Crédito (Visa)' e '(Master)' viram uma) e vale a data do pagamento", async () => {
    await payment({ day: "2026-09-02", value: 10000, method: "Cartão de Crédito (Visa)" });
    await payment({ day: "2026-09-02", value: 5000, method: "Cartão de Crédito (Master)" });
    await payment({ day: "2026-09-03", value: 7000, method: "Pix" });
    await payment({ day: "2026-08-31", paidOn: "2026-09-01", value: 1000, method: null }); // comanda de agosto paga em setembro
    expect(await salonPayments(SET)).toEqual([
      { method: "Cartão de Crédito", n: 2, cents: 15000 }, { method: "Pix", n: 1, cents: 7000 }, { method: "Não informada", n: 1, cents: 1000 },
    ]);
  });

  it("conferência por ano: com e sem as sessões de pacote contra os pagamentos, com a diferença em %", async () => {
    await item({ day: "2025-03-01", value: 100000 });
    await item({ day: "2025-03-02", value: 5000, fromPackage: true });
    await payment({ day: "2025-03-01", value: 96000 });
    expect(await yearlyCheck()).toEqual([{ ano: 2025, faturamentoCents: 100000, comPacoteCents: 105000, pagamentosCents: 96000, diferencaPct: 4.2 }]);
  });
});
```

- [ ] **Passo 3: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/salon.test.ts`
Esperado: FAIL ("Failed to resolve import ./salon").

- [ ] **Passo 4: Implementar**

Criar `src/server/reports/salon.ts`:

```ts
import { sql, type SQL } from "drizzle-orm";
import { rows } from "./common";
import { salonBuckets, type SalonRange } from "../../lib/salon-period";

/**
 * Painel "Salão" (Lote 3): o que o dono de salão olha, lido das comandas (`sales_items`), dos pagamentos (`sales_payments`), dos horários
 * (`appointments`) e das conversas (`deals`). Avec hoje; a comanda do CRM (Lote 6C) entra nas mesmas tabelas. Dinheiro em centavos.
 * Quem vê o quê é decidido em `loadSalon` (sem "ver valores", todo valor sai como null).
 */

/** Período em dias de Salvador, inclusivo ("AAAA-MM-DD"). */
export type DayRange = { from: string; to: string };

/**
 * Valor de um item (centavos): total = valor − desconto (Lote 0: o "Valor" do Avec já é o total da linha). Sessão de pacote (`from_package`)
 * vale 0: o dinheiro entrou quando o pacote foi vendido. A conferência por ano (`yearlyCheck`) mostra as duas contas.
 */
export const REVENUE = (a = "si"): SQL =>
  sql.raw(`(case when ${a}.from_package then 0 else coalesce(${a}.total_cents, ${a}.value_cents - coalesce(${a}.discount_cents, 0), 0) end)`);
/** Uma comanda = dia + número (o número reinicia no Avec); item sem número conta como comanda própria. */
export const COMANDA_KEY = (a = "si"): SQL => sql.raw(`(${a}.sold_on::text || '|' || coalesce(${a}.comanda, ${a}.id::text))`);
/** Comandas com dinheiro: as que têm algum item que não é sessão de pacote. */
const COMANDAS = (a = "si"): SQL => sql`count(distinct ${COMANDA_KEY(a)}) filter (where not ${sql.raw(a)}.from_package)`;
const inDays = (col: string, r: DayRange): SQL => sql`${sql.raw(col)} between ${r.from}::date and ${r.to}::date`;
const num = (v: unknown) => Number(v ?? 0);
const ticket = (cents: number, comandas: number) => (comandas ? Math.round(cents / comandas) : null);

export type RevenueTotals = { cents: number; comandas: number; itens: number; ticketCents: number | null };

export async function revenueTotals(r: DayRange): Promise<RevenueTotals> {
  const [x] = await rows<{ cents: number; comandas: number; itens: number }>(sql`
    select coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas, count(*)::int as itens
    from sales_items si where ${inDays("si.sold_on", r)}`);
  const cents = num(x?.cents), comandas = x?.comandas ?? 0;
  return { cents, comandas, itens: x?.itens ?? 0, ticketCents: ticket(cents, comandas) };
}

export type SalonRevenue = RevenueTotals & { previous: RevenueTotals; series: { key: string; cents: number; comandas: number }[] };

/** Faturamento do período, o do período anterior e as barras (por dia ou por mês, sem buracos). */
export async function salonRevenue(r: SalonRange): Promise<SalonRevenue> {
  const fmt = r.grain === "dia" ? "YYYY-MM-DD" : "YYYY-MM";
  const [cur, previous, s] = await Promise.all([
    revenueTotals(r), revenueTotals({ from: r.prevFrom, to: r.prevTo }),
    rows<{ k: string; cents: number; comandas: number }>(sql`
      select to_char(si.sold_on, ${fmt}) as k, coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas
      from sales_items si where ${inDays("si.sold_on", r)} group by 1`),
  ]);
  const by = new Map(s.map((x) => [x.k, x]));
  return { ...cur, previous, series: salonBuckets(r).map((k) => ({ key: k, cents: num(by.get(k)?.cents), comandas: by.get(k)?.comandas ?? 0 })) };
}

/** Até quando vão os dados do Avec (a última venda importada): a legenda "fonte: Avec até 14/10". */
export async function avecUntil(): Promise<string | null> {
  const [x] = await rows<{ d: string | null }>(sql`select max(sold_on)::text as d from sales_items where origin = 'avec'`);
  return x?.d ?? null;
}

export type ProfessionalRow = { key: string; name: string; cents: number; comandas: number; itens: number; ticketCents: number | null; commissionCents: number | null };

/** Por profissional: o cadastro; sem cadastro, o nome escrito no Avec; sem nada, "Sem profissional". `byCount`: em ordem de comandas. */
export async function salonByProfessional(r: DayRange, opts: { byCount?: boolean } = {}): Promise<ProfessionalRow[]> {
  const x = await rows<{ key: string; name: string; cents: number; comandas: number; itens: number; commission: number | null }>(sql`
    select coalesce(si.professional_id::text, 'nome:' || lower(nullif(trim(si.professional_name), '')), 'sem') as key,
      coalesce(max(p.name), max(nullif(trim(si.professional_name), '')), 'Sem profissional') as name,
      coalesce(sum(${REVENUE()}), 0)::float8 as cents, ${COMANDAS()}::int as comandas, count(*)::int as itens,
      sum(si.commission_cents)::float8 as commission
    from sales_items si left join professionals p on p.id = si.professional_id
    where ${inDays("si.sold_on", r)} group by 1
    order by ${opts.byCount ? sql`comandas desc, cents desc` : sql`cents desc, comandas desc`}, name`);
  return x.map((p) => ({
    key: p.key, name: p.name, cents: num(p.cents), comandas: p.comandas, itens: p.itens, ticketCents: ticket(num(p.cents), p.comandas),
    commissionCents: p.commission == null ? null : Math.round(num(p.commission)),
  }));
}

export const SERVICE_TOP = 15;
export type SalonServices = {
  items: { item: string; category: string | null; n: number; cents: number }[];
  /** O que ficou fora dos 15: quantos serviços, quantos itens e quanto. */ otherItems: { count: number; n: number; cents: number };
  categories: { category: string; n: number; cents: number }[];
};

export async function salonByService(r: DayRange, opts: { byCount?: boolean } = {}): Promise<SalonServices> {
  const order = opts.byCount ? sql`n desc, cents desc` : sql`cents desc, n desc`;
  const [items, categories] = await Promise.all([
    rows<{ item: string; category: string | null; n: number; cents: number }>(sql`
      select si.item, max(si.category) as category, count(*)::int as n, coalesce(sum(${REVENUE()}), 0)::float8 as cents
      from sales_items si where ${inDays("si.sold_on", r)} group by si.item order by ${order}, si.item`),
    rows<{ category: string; n: number; cents: number }>(sql`
      select coalesce(nullif(trim(si.category), ''), 'Sem categoria') as category, count(*)::int as n, coalesce(sum(${REVENUE()}), 0)::float8 as cents
      from sales_items si where ${inDays("si.sold_on", r)} group by 1 order by ${order}, 1`),
  ]);
  const top = items.slice(0, SERVICE_TOP), rest = items.slice(SERVICE_TOP);
  return {
    items: top.map((x) => ({ item: x.item, category: x.category, n: x.n, cents: num(x.cents) })),
    otherItems: { count: rest.length, n: rest.reduce((a, x) => a + x.n, 0), cents: rest.reduce((a, x) => a + num(x.cents), 0) },
    categories: categories.map((x) => ({ category: x.category, n: x.n, cents: num(x.cents) })),
  };
}

export type PaymentRow = { method: string; n: number; cents: number };

/** Pagamentos de comanda pela data do pagamento (sem ela, a da comanda). "Cartão de Crédito (Visa)" conta como "Cartão de Crédito". */
export async function salonPayments(r: DayRange, opts: { byCount?: boolean } = {}): Promise<PaymentRow[]> {
  const x = await rows<{ method: string; n: number; cents: number }>(sql`
    select coalesce(nullif(split_part(trim(sp.method), ' (', 1), ''), 'Não informada') as method, count(*)::int as n,
      coalesce(sum(sp.value_cents), 0)::float8 as cents
    from sales_payments sp where coalesce(sp.paid_on, sp.comanda_on) between ${r.from}::date and ${r.to}::date
    group by 1 order by ${opts.byCount ? sql`n desc, cents desc` : sql`cents desc, n desc`}, 1`);
  return x.map((p) => ({ method: p.method, n: p.n, cents: num(p.cents) }));
}

export type YearCheck = { ano: number; faturamentoCents: number; comPacoteCents: number; pagamentosCents: number; diferencaPct: number | null };

/** Conferência da spec ("faturamento por ano bate com os pagamentos, diferença menor que 5%"): por ano, sem e com as sessões de pacote. */
export async function yearlyCheck(): Promise<YearCheck[]> {
  const r = await rows<{ ano: number; fat: number; com: number; pag: number }>(sql`
    with f as (
        select extract(year from si.sold_on)::int as ano, sum(${REVENUE()})::float8 as fat,
          sum(coalesce(si.total_cents, si.value_cents - coalesce(si.discount_cents, 0), 0))::float8 as com
        from sales_items si group by 1),
      p as (
        select extract(year from coalesce(sp.paid_on, sp.comanda_on))::int as ano, sum(sp.value_cents)::float8 as pag
        from sales_payments sp where coalesce(sp.paid_on, sp.comanda_on) is not null group by 1)
    select coalesce(f.ano, p.ano) as ano, coalesce(f.fat, 0)::float8 as fat, coalesce(f.com, 0)::float8 as com, coalesce(p.pag, 0)::float8 as pag
    from f full join p on p.ano = f.ano order by 1`);
  return r.map((x) => ({
    ano: x.ano, faturamentoCents: num(x.fat), comPacoteCents: num(x.com), pagamentosCents: num(x.pag),
    diferencaPct: num(x.pag) > 0 ? Math.round(((num(x.fat) - num(x.pag)) / num(x.pag)) * 1000) / 10 : null,
  }));
}
```

Criar `scripts/conferir-faturamento.ts`:

```ts
// scripts/conferir-faturamento.ts
import "dotenv/config";
import { pool } from "../src/server/db";
import { yearlyCheck } from "../src/server/reports/salon";

// Lote 3: confere o faturamento do Salão contra os pagamentos, por ano. SÓ LEITURA (nada é gravado).
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/conferir-faturamento.ts
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const rows = await yearlyCheck();
  console.log("Ano  | Faturamento (sem sessões de pacote) | Com as sessões     | Pagamentos         | Diferença");
  for (const r of rows) {
    console.log(`${r.ano} | ${brl(r.faturamentoCents).padStart(35)} | ${brl(r.comPacoteCents).padStart(18)} | ${brl(r.pagamentosCents).padStart(18)} | ${r.diferencaPct == null ? "—" : `${r.diferencaPct}%`}`);
  }
  const fora = rows.filter((r) => r.diferencaPct != null && Math.abs(r.diferencaPct) >= 5);
  console.log(fora.length ? `\nAtenção: diferença de 5% ou mais em ${fora.map((r) => r.ano).join(", ")}. Mostrar ao dono antes de seguir.` : "\nTodos os anos com diferença menor que 5%.");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/reports/salon.test.ts && npm run typecheck`
Esperado: PASS. Conta do primeiro teste: 25.000 + 10.000 + 20.000 + 5.000 + 7.000 = R$ 670,00 em 4 comandas com dinheiro (a da sessão de pacote fica fora) → ticket R$ 167,50.

- [ ] **Passo 6: Commit**

```bash
git add src/server/reports/salon.ts src/server/reports/salon.test.ts test/salon-fixtures.ts scripts/conferir-faturamento.ts
git commit -m "feat(salão): faturamento, profissional, serviço, pagamentos e conferência por ano contra os pagamentos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.3: Consultas de clientes e agenda do Salão (novas × recorrentes, comparecimento, sem desfecho, funil)

**Arquivos:**
- Modificar: `src/server/reports/salon.ts` (acrescentar no fim)
- Teste: `src/server/reports/salon-agenda.test.ts`

**Interfaces:**
- Consome: `DayRange`, `inDays`, `rows` (3.2); `SalonRange` (3.1); do 1C: `FUTURE_MAX_DAYS` (`src/server/domain/avec/funnel-sync.ts`, valor 180; confirmar com `grep -n "FUTURE_MAX_DAYS" src/server/domain/avec/funnel-sync.ts`) e `stageByKind` (`src/server/domain/deals.ts`, só no teste).
- Produz:
  - `type ClientsMix = { novas: number; recorrentes: number }`; `salonClients(r: SalonRange): Promise<ClientsMix & { previous: ClientsMix }>`
  - `type AttendanceCounts = { compareceu: number; faltou: number; cancelado: number; semDesfecho: number }`, `type AttendanceRow = AttendanceCounts & { key: string; name: string }`, `type NoOutcomeItem = { id: string; startsAt: string; clientName: string | null; contactId: string | null; professional: string | null; service: string }`, `type SalonAttendance = { rows: AttendanceRow[]; total: AttendanceCounts; noOutcome: { n: number; items: NoOutcomeItem[] } }`; `NO_OUTCOME_LIST = 30`; `salonAttendance(r: DayRange, now?: Date): Promise<SalonAttendance>`
  - `type SalonFunnel = { conversas: number; comHorario: number; compareceram: number; compraram: number }`; `salonFunnel(r: DayRange, now?: Date): Promise<SalonFunnel>`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/reports/salon-agenda.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { deals } from "../db/schema";
import { stageByKind } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { appt, client, item, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { salonAttendance, salonClients, salonFunnel } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW); // setembro/2026

beforeEach(resetDb);

describe("Salão: clientes, comparecimento e funil", () => {
  it("clientes novas × recorrentes: a primeira compra decide (pelo contato ou, sem contato, pelo nome)", async () => {
    const ana = await client("Ana Teste", "+5571990000001");
    await item({ day: "2026-05-10", contactId: ana, value: 1000 });              // Ana já tinha comprado
    await item({ day: "2026-09-02", contactId: ana, value: 1000 });              // recorrente em setembro
    await item({ day: "2026-09-03", clientName: "Bia Teste", value: 1000 });     // nova (sem contato, pelo nome)
    await item({ day: "2026-09-20", clientName: " bia teste ", value: 1000 });   // a mesma Bia de novo: continua uma
    await item({ day: "2026-08-15", clientName: "Caio Teste", value: 1000 });    // nova em agosto (período anterior)
    expect(await salonClients(SET)).toEqual({ novas: 1, recorrentes: 1, previous: { novas: 1, recorrentes: 0 } });
  });

  it("comparecimento por profissional e agenda sem desfecho (horário que já passou e continua agendado ou confirmado)", async () => {
    const maiara = await pro("MAIARA");
    const ana = await client("Ana Teste", "+5571990000001");
    await appt({ day: "2026-09-02", status: "compareceu", proId: maiara });
    await appt({ day: "2026-09-02", hm: "14:00", status: "compareceu", proId: maiara });
    await appt({ day: "2026-09-03", status: "faltou", proId: maiara });
    await appt({ day: "2026-09-04", status: "cancelado" });
    await appt({ day: "2026-09-05", status: "agendado", proId: maiara, contactId: ana, service: "Escova" });
    await appt({ day: "2026-09-06", status: "espera" });   // lista de espera não é horário
    await appt({ day: "2026-10-20", status: "agendado" }); // fora do período
    const r = await salonAttendance(SET, NOW);
    expect(r.rows).toEqual([
      { key: maiara, name: "MAIARA", compareceu: 2, faltou: 1, cancelado: 0, semDesfecho: 1 },
      { key: "sem", name: "Sem profissional", compareceu: 0, faltou: 0, cancelado: 1, semDesfecho: 0 },
    ]);
    expect(r.total).toEqual({ compareceu: 2, faltou: 1, cancelado: 1, semDesfecho: 1 });
    expect(r.noOutcome.n).toBe(1);
    expect(r.noOutcome.items[0]).toMatchObject({ clientName: "Ana Teste", contactId: ana, professional: "MAIARA", service: "Escova" });
  });

  it("da conversa à compra: cada passo por conta própria; horário em 2923 (data errada do Avec) não conta", async () => {
    const a = await client("Ana Teste", "+5571990000001"), b = await client("Bia Teste", "+5571990000002"), c = await client("Caio Teste", "+5571990000003");
    const stage = await stageByKind("atendimento");
    for (const id of [a, b, c]) await db.insert(deals).values({ contactId: id, stageId: stage.id, createdAt: new Date("2026-09-02T13:00:00Z") });
    await appt({ day: "2026-09-10", status: "compareceu", contactId: a });
    await item({ day: "2026-09-10", contactId: a, value: 1000 });
    await appt({ day: "2026-09-12", status: "faltou", contactId: b });
    await appt({ day: "2923-01-01", status: "agendado", contactId: c });
    await item({ day: "2026-09-20", contactId: c, value: 1000 }); // comprou sem horário (passou na recepção)
    expect(await salonFunnel(SET, NOW)).toEqual({ conversas: 3, comHorario: 2, compareceram: 1, compraram: 2 });
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/salon-agenda.test.ts`
Esperado: FAIL ("salonClients is not a function" / não exportado).

- [ ] **Passo 3: Implementar**

No topo de `src/server/reports/salon.ts`, acrescentar o import:

```ts
import { FUTURE_MAX_DAYS } from "../domain/avec/funnel-sync";
```

No fim de `src/server/reports/salon.ts`:

```ts
/* ───────────── Clientes, comparecimento e funil ───────────── */

/** A cliente de um item: o contato; sem contato, o nome (minúsculo, sem espaço nas pontas). */
const CLIENT_KEY = sql.raw(`coalesce(si.contact_id::text, 'nome:' || lower(nullif(trim(si.client_name), '')))`);
const localDay = (col: string): SQL => sql.raw(`((${col}) at time zone 'America/Bahia')::date`);

export type ClientsMix = { novas: number; recorrentes: number };

async function clientsMix(r: DayRange): Promise<ClientsMix> {
  const [x] = await rows<ClientsMix>(sql`
    with firsts as (select ${CLIENT_KEY} as k, min(si.sold_on) as first_day from sales_items si where ${CLIENT_KEY} is not null group by 1),
      inper as (select distinct ${CLIENT_KEY} as k from sales_items si where ${inDays("si.sold_on", r)} and ${CLIENT_KEY} is not null)
    select count(*) filter (where f.first_day >= ${r.from}::date)::int as novas, count(*) filter (where f.first_day < ${r.from}::date)::int as recorrentes
    from inper i join firsts f on f.k = i.k`);
  return { novas: x?.novas ?? 0, recorrentes: x?.recorrentes ?? 0 };
}

/** Quem comprou no período: nova (a primeira compra dela em todo o histórico foi no período) ou recorrente. Com o período anterior. */
export async function salonClients(r: SalonRange): Promise<ClientsMix & { previous: ClientsMix }> {
  const [cur, previous] = await Promise.all([clientsMix(r), clientsMix({ from: r.prevFrom, to: r.prevTo })]);
  return { ...cur, previous };
}

export type AttendanceCounts = { compareceu: number; faltou: number; cancelado: number; semDesfecho: number };
export type AttendanceRow = AttendanceCounts & { key: string; name: string };
export type NoOutcomeItem = { id: string; startsAt: string; clientName: string | null; contactId: string | null; professional: string | null; service: string };
export type SalonAttendance = { rows: AttendanceRow[]; total: AttendanceCounts; noOutcome: { n: number; items: NoOutcomeItem[] } };
export const NO_OUTCOME_LIST = 30;

/** Horários do período por profissional (lista de espera não entra) e os que já passaram sem desfecho (ainda agendado ou confirmado). */
export async function salonAttendance(r: DayRange, now = new Date()): Promise<SalonAttendance> {
  const pending = sql`a.status in ('agendado', 'confirmado') and a.starts_at < ${now.toISOString()}::timestamptz`;
  const inPeriod = sql`${localDay("a.starts_at")} between ${r.from}::date and ${r.to}::date`;
  const [byPro, list] = await Promise.all([
    rows<AttendanceRow>(sql`
      select coalesce(a.professional_id::text, 'sem') as key, coalesce(max(p.name), 'Sem profissional') as name,
        count(*) filter (where a.status = 'compareceu')::int as compareceu, count(*) filter (where a.status = 'faltou')::int as faltou,
        count(*) filter (where a.status = 'cancelado')::int as cancelado, count(*) filter (where ${pending})::int as "semDesfecho"
      from appointments a left join professionals p on p.id = a.professional_id
      where a.status <> 'espera' and ${inPeriod}
      group by 1 order by compareceu desc, name`),
    rows<{ id: string; startsAt: Date; clientName: string | null; contactId: string | null; professional: string | null; service: string }>(sql`
      select a.id, a.starts_at as "startsAt", coalesce(c.name, a.client_name) as "clientName", a.contact_id as "contactId", p.name as professional,
        a.service_label as service
      from appointments a left join professionals p on p.id = a.professional_id left join contacts c on c.id = a.contact_id
      where ${pending} and ${inPeriod} order by a.starts_at desc limit ${NO_OUTCOME_LIST}`),
  ]);
  const total = byPro.reduce<AttendanceCounts>((t, x) => ({
    compareceu: t.compareceu + x.compareceu, faltou: t.faltou + x.faltou, cancelado: t.cancelado + x.cancelado, semDesfecho: t.semDesfecho + x.semDesfecho,
  }), { compareceu: 0, faltou: 0, cancelado: 0, semDesfecho: 0 });
  return { rows: byPro, total, noOutcome: { n: total.semDesfecho, items: list.map((x) => ({ ...x, startsAt: new Date(x.startsAt).toISOString() })) } };
}

export type SalonFunnel = { conversas: number; comHorario: number; compareceram: number; compraram: number };

/**
 * Conversas que começaram no período (sem "Não é cliente" e sem lead arquivado) e o que veio depois, cada passo por conta própria:
 * quem passou na recepção compra sem horário marcado. Horário além de FUTURE_MAX_DAYS (data errada do Avec: 2923, 4676) não conta.
 */
export async function salonFunnel(r: DayRange, now = new Date()): Promise<SalonFunnel> {
  const limit = new Date(now.getTime() + FUTURE_MAX_DAYS * 86_400_000).toISOString();
  const [x] = await rows<SalonFunnel>(sql`
    with conv as (
      select d.id, d.contact_id, d.created_at from deals d join contacts c on c.id = d.contact_id
      where d.archived_at is null and not c.ignored and ${localDay("d.created_at")} between ${r.from}::date and ${r.to}::date)
    select count(*)::int as conversas,
      count(*) filter (where exists (select 1 from appointments a where a.contact_id = conv.contact_id and a.status <> 'espera'
        and a.starts_at >= conv.created_at and a.starts_at <= ${limit}::timestamptz))::int as "comHorario",
      count(*) filter (where exists (select 1 from appointments a where a.contact_id = conv.contact_id and a.status = 'compareceu'
        and a.starts_at >= conv.created_at and a.starts_at <= ${limit}::timestamptz))::int as compareceram,
      count(*) filter (where exists (select 1 from sales_items s where s.contact_id = conv.contact_id
        and s.sold_on >= ${localDay("conv.created_at")}))::int as compraram
    from conv`);
  return x ?? { conversas: 0, comHorario: 0, compareceram: 0, compraram: 0 };
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/reports/salon-agenda.test.ts src/server/reports/salon.test.ts && npm run typecheck`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/server/reports/salon.ts src/server/reports/salon-agenda.test.ts
git commit -m "feat(salão): clientes novas × recorrentes, comparecimento por profissional, agenda sem desfecho e funil conversa→compra

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 3.4: Aba "Salão" nos Relatórios (valores só para quem pode ver)

**Arquivos:**
- Modificar: `src/server/reports/salon.ts` (acrescentar `loadSalon` no fim)
- Modificar: `src/lib/permissions.ts` (acrescentar `canSeeSalon`), `src/lib/permissions.test.ts`
- Modificar: `src/lib/report-legend.ts` (legendas do Salão)
- Criar: `src/components/reports/salon.tsx`, `src/components/reports/salon-period-picker.tsx`
- Modificar: `src/components/reports/report-tabs.tsx`, `src/app/(app)/relatorios/page.tsx`
- Testes: `src/server/reports/salon-view.test.ts`, `src/components/reports/salon.render.test.tsx`, `e2e/relatorios-salao.spec.ts`

**Interfaces:**
- Consome: tudo da 3.2 e da 3.3; `salonRange`, `bucketLabel`, `brDay`, `salonQuery`, `SALON_PRESETS`, `SALON_PRESET_LABEL` (3.1).
- Produz:
  - `canSeeSalon(perms): boolean` (`relatorios.ver` e `relatorios.equipe`)
  - `type SalonView` e `loadSalon(user: { perms: readonly string[] }, range: SalonRange, now?: Date): Promise<SalonView>` (sem `valores.ver`: todo campo `*Cents`/`cents` é `null`, listas em ordem de quantidade)
  - `SalonTab({ d }: { d: SalonView })` e `SalonPeriodPicker({ preset, from, to })`
  - `type ReportTab = "visao" | "salao" | "analise"`; `ReportTabs({ value, salon })`
  - legendas `salaoFaturamento`, `salaoProfissional`, `salaoServico`, `salaoPagamento`, `salaoClientes`, `salaoComparecimento`, `salaoSemDesfecho`, `salaoFunil`

- [ ] **Passo 1: Escrever os testes que falham (servidor)**

Criar `src/server/reports/salon-view.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { loadSalon } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW);

beforeEach(resetDb);

/** Todos os valores das chaves que terminam em "cents", em qualquer profundidade do objeto. */
const centsValues = (o: unknown): unknown[] => (Array.isArray(o) ? o.flatMap(centsValues)
  : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (/cents$/i.test(k) ? [v] : centsValues(v))) : []);

it("sem valores.ver o Salão chega sem nenhum valor (só quantidades) e em ordem de quantidade", async () => {
  const maiara = await pro("MAIARA"), jo = await pro("JO");
  await item({ day: "2026-09-02", comanda: "1", proId: maiara, value: 90000, commissionCents: 1000 });
  await item({ day: "2026-09-03", comanda: "2", proId: jo, value: 1000 });
  await item({ day: "2026-09-04", comanda: "3", proId: jo, value: 1000 });
  await payment({ day: "2026-09-02", value: 90000 });

  const semValores = await loadSalon({ perms: ["relatorios.ver", "relatorios.equipe"] }, SET, NOW);
  expect(semValores.money).toBe(false);
  const all = centsValues(semValores);
  expect(all.length).toBeGreaterThan(10);
  expect(all.every((v) => v === null)).toBe(true);
  expect(semValores.revenue.comandas).toBe(3);
  expect(semValores.professionals.map((p) => p.name)).toEqual(["JO", "MAIARA"]); // por comandas: a ordem não entrega quem fatura mais

  const comValores = await loadSalon({ perms: ["relatorios.ver", "relatorios.equipe", "valores.ver"] }, SET, NOW);
  expect(comValores.revenue.cents).toBe(92000);
  expect(comValores.professionals.map((p) => [p.name, p.commissionCents])).toEqual([["MAIARA", 1000], ["JO", null]]);
});
```

Em `src/lib/permissions.test.ts`, acrescentar `canSeeSalon` ao import e:

```ts
describe("canSeeSalon", () => {
  it("Salão: números do salão inteiro, então pede Relatórios e 'toda a equipe'", () => {
    expect(canSeeSalon(["relatorios.ver"])).toBe(false);
    expect(canSeeSalon(["relatorios.ver", "relatorios.equipe"])).toBe(true);
    expect(canSeeSalon(profile("gestao").permissions)).toBe(true);
    expect(canSeeSalon(profile("atendente").permissions)).toBe(false);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/salon-view.test.ts src/lib/permissions.test.ts`
Esperado: FAIL ("loadSalon is not a function", "canSeeSalon is not a function").

- [ ] **Passo 3: `canSeeSalon` e `loadSalon`**

Em `src/lib/permissions.ts`, depois de `canSeeAvecReports`:

```ts
/** Painel Salão (Relatórios): números do salão inteiro, então pede "toda a equipe" além de abrir Relatórios. Os R$, só com "ver valores". */
export const canSeeSalon = (perms: readonly string[] | null | undefined): boolean => can(perms, "relatorios.ver") && can(perms, "relatorios.equipe");
```

Em `src/server/reports/salon.ts`, trocar o import de `salon-period` por `import { bucketLabel, salonBuckets, type SalonRange } from "../../lib/salon-period";`, acrescentar `import { can } from "../../lib/permissions";` e, no fim do arquivo:

```ts
/* ───────────── O painel para a tela ───────────── */

export type SalonView = {
  range: SalonRange; avecUntil: string | null;
  /** Pode ver valores (`valores.ver`). Sem isso, todo campo em centavos vem null. */ money: boolean;
  revenue: {
    cents: number | null; prevCents: number | null; comandas: number; prevComandas: number; ticketCents: number | null; prevTicketCents: number | null;
    series: { key: string; label: string; cents: number | null; comandas: number }[];
  };
  professionals: { key: string; name: string; comandas: number; itens: number; cents: number | null; ticketCents: number | null; commissionCents: number | null }[];
  services: {
    items: { item: string; category: string | null; n: number; cents: number | null }[];
    otherItems: { count: number; n: number; cents: number | null };
    categories: { category: string; n: number; cents: number | null }[];
  };
  payments: { method: string; n: number; cents: number | null }[];
  clients: ClientsMix & { previous: ClientsMix };
  attendance: SalonAttendance;
  funnel: SalonFunnel;
};

/**
 * O painel inteiro. Sem "ver valores", todo valor em centavos vai como null (o dado nem chega à tela) e as listas saem em ordem de
 * quantidade: a ordem por faturamento entregaria quem fatura mais.
 */
export async function loadSalon(user: { perms: readonly string[] }, range: SalonRange, now = new Date()): Promise<SalonView> {
  const money = can(user.perms, "valores.ver");
  const byCount = !money;
  const [rev, pros, svc, pays, clients, attendance, funnel, until] = await Promise.all([
    salonRevenue(range), salonByProfessional(range, { byCount }), salonByService(range, { byCount }), salonPayments(range, { byCount }),
    salonClients(range), salonAttendance(range, now), salonFunnel(range, now), avecUntil(),
  ]);
  const m = (v: number | null) => (money ? v : null);
  return {
    range, avecUntil: until, money,
    revenue: {
      cents: m(rev.cents), prevCents: m(rev.previous.cents), comandas: rev.comandas, prevComandas: rev.previous.comandas,
      ticketCents: m(rev.ticketCents), prevTicketCents: m(rev.previous.ticketCents),
      series: rev.series.map((s) => ({ key: s.key, label: bucketLabel(s.key), cents: m(s.cents), comandas: s.comandas })),
    },
    professionals: pros.map((p) => ({ key: p.key, name: p.name, comandas: p.comandas, itens: p.itens, cents: m(p.cents), ticketCents: m(p.ticketCents), commissionCents: m(p.commissionCents) })),
    services: {
      items: svc.items.map((s) => ({ ...s, cents: m(s.cents) })),
      otherItems: { ...svc.otherItems, cents: m(svc.otherItems.cents) },
      categories: svc.categories.map((c) => ({ ...c, cents: m(c.cents) })),
    },
    payments: pays.map((p) => ({ ...p, cents: m(p.cents) })),
    clients, attendance, funnel,
  };
}
```

- [ ] **Passo 4: Rodar e ver passar (servidor)**

Rodar: `npx vitest run src/server/reports/salon-view.test.ts src/lib/permissions.test.ts`
Esperado: PASS.

- [ ] **Passo 5: Legendas, seletor de período e a aba**

Em `src/lib/report-legend.ts`, dentro de `LEGEND`, acrescentar:

```ts
  salaoFaturamento: "Soma dos itens de comanda do período (valor menos desconto), do Avec e das comandas do CRM. Sessão de pacote não entra: o dinheiro entrou quando o pacote foi vendido. Comanda é o dia mais o número (o número reinicia no Avec). Ticket médio: faturado dividido pelas comandas. A comparação é com o período anterior de mesmo tamanho (no mês, o mesmo pedaço do mês anterior).",
  salaoProfissional: "Itens de comanda de cada profissional, pelo cadastro (sem cadastro, o nome escrito no Avec). Comandas: em quantas comandas ela aparece. Comissão: a que veio do Avec (Itens de comanda e Comissão por item); 'não importada' quando o Avec não trouxe.",
  salaoServico: "Itens vendidos pelo nome do serviço ou produto, e por categoria do Avec. Sem categoria aparece como 'Sem categoria'.",
  salaoPagamento: "Pagamentos de comanda pela data do pagamento (sem ela, a data da comanda). A bandeira do cartão fica junto da forma de pagamento.",
  salaoClientes: "Clientes que compraram no período. Nova: a primeira compra dela, em todo o histórico, foi no período. Recorrente: já tinha comprado antes. Sem cadastro, a cliente é reconhecida pelo nome.",
  salaoComparecimento: "Horários do período por profissional, pelo status do Avec (ou do CRM). Sem desfecho: o horário já passou e continua como agendado ou confirmado. Lista de espera não entra.",
  salaoSemDesfecho: "Horários do período que já passaram e não têm Compareceu, Faltou nem Cancelado. Os 30 mais recentes; o nome abre a ficha da cliente.",
  salaoFunil: "Conversas que começaram no período (sem 'Não é cliente'). Marcou horário: tem horário depois do início da conversa (até 180 dias à frente; datas erradas do Avec ficam de fora). Compareceu: um desses horários teve Compareceu. Comprou: tem comanda a partir do dia da conversa. Cada passo é contado por conta própria.",
```

Criar `src/components/reports/salon-period-picker.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SALON_PRESETS, SALON_PRESET_LABEL, salonQuery, type SalonPreset } from "@/lib/salon-period";
import { cn } from "@/lib/cn";

/** Período do Salão: atalhos e "Escolher datas" (de/até). Troca a URL; o servidor refaz o painel e corrige data torta. */
export function SalonPeriodPicker({ preset, from, to }: { preset: SalonPreset; from: string; to: string }) {
  const router = useRouter();
  const [livre, setLivre] = useState(preset === "livre");
  const [de, setDe] = useState(from), [ate, setAte] = useState(to);
  const go = (q: string) => router.replace(`/relatorios?${q}`, { scroll: false });
  const on = (p: SalonPreset) => (p === "livre" ? livre : !livre && p === preset);
  const input = "h-11 lg:h-9 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-[16px] lg:text-sm";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Período do Salão">
        {SALON_PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={on(p)}
            onClick={() => { if (p === "livre") setLivre(true); else { setLivre(false); go(salonQuery({ preset: p, from, to })); } }}
            className={cn("min-h-11 lg:min-h-8 rounded-full border px-3 text-sm font-medium transition-colors",
              on(p) ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>
            {SALON_PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      {livre && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(salonQuery({ preset: "livre", from: de, to: ate })); }}>
          <label className="flex flex-col gap-1 text-sm text-graphite">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={input} /></label>
          <label className="flex flex-col gap-1 text-sm text-graphite">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={input} /></label>
          <button type="submit" className="min-h-11 lg:min-h-9 rounded-[var(--radius-control)] bg-ink px-4 text-sm font-medium text-paper">Ver</button>
        </form>
      )}
    </div>
  );
}
```

Criar `src/components/reports/salon.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { compareMetric, shareText } from "@/lib/report-format";
import { money } from "@/lib/format";
import { brDay } from "@/lib/salon-period";
import type { SalonView } from "@/server/reports/salon";
import { DataList, type Col } from "./data-list";
import { Delta } from "./delta";
import { Muted, Section } from "./section";
import { SalonPeriodPicker } from "./salon-period-picker";

const brl = (c: number | null) => (c == null ? "—" : money(c));
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Coluna só para quem vê valores. */
const moneyCol = <T,>(on: boolean, col: Col<T>): Col<T>[] => (on ? [col] : []);

/** Aba Salão (Lote 3): faturamento, profissionais, serviços, pagamentos, clientes, comparecimento, agenda sem desfecho e funil. */
export function SalonTab({ d }: { d: SalonView }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SalonPeriodPicker preset={d.range.preset} from={d.range.from} to={d.range.to} />
        <p className="text-[13px] text-muted" data-testid="fonte-salao">{d.avecUntil ? `Fonte: Avec até ${brDay(d.avecUntil)}` : "Ainda não há dados do Avec"} · comandas do CRM entram junto</p>
      </div>
      <Revenue d={d} />
      <Professionals d={d} />
      <Services d={d} />
      <Payments d={d} />
      <Clients d={d} />
      <Attendance d={d} />
      <NoOutcome d={d} />
      <Funnel d={d} />
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="@container min-w-0">
      <dt className="text-[13px] text-graphite">{label}</dt>
      <dd>
        <p className="font-display font-medium leading-none tabular mt-1 whitespace-nowrap text-[clamp(22px,14cqw,34px)]">{value}</p>
        {sub && <div className="mt-1.5">{sub}</div>}
      </dd>
    </div>
  );
}

function Revenue({ d }: { d: SalonView }) {
  const v = d.revenue;
  const max = Math.max(1, ...v.series.map((s) => (d.money ? s.cents ?? 0 : s.comandas)));
  return (
    <Section id="salao-faturamento" title={d.money ? "Faturamento" : "Comandas"} lead={`${d.range.label}, comparado com ${d.range.prevLabel}.`} legend="salaoFaturamento">
      <dl className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {d.money && <Fig label="Faturado" value={brl(v.cents)} sub={<Delta c={compareMetric(v.cents, v.prevCents, { kind: "cents", n: v.comandas, nPrev: v.prevComandas })} prevText={`antes: ${brl(v.prevCents)}`} />} />}
        <Fig label="Comandas" value={v.comandas.toLocaleString("pt-BR")} sub={<Delta c={compareMetric(v.comandas, v.prevComandas, { kind: "count", n: v.comandas, nPrev: v.prevComandas })} prevText={`antes: ${v.prevComandas}`} />} />
        {d.money && <Fig label="Ticket médio por comanda" value={brl(v.ticketCents)} sub={<span className="text-[13px] text-muted tabular">antes: {brl(v.prevTicketCents)}</span>} />}
      </dl>
      {v.comandas === 0 ? <Muted>Nenhuma comanda no período.</Muted> : (
        <ol className="mt-6 flex flex-col gap-1" aria-label={d.range.grain === "dia" ? "Por dia" : "Por mês"}>
          {v.series.map((s) => {
            const val = d.money ? s.cents ?? 0 : s.comandas;
            return (
              <li key={s.key} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 text-[13px] tabular">
                <span className="text-muted">{s.label}</span>
                <span className="h-2 rounded-full bg-paper-2" aria-hidden><span className="block h-2 rounded-full bg-gold" style={{ width: `${Math.round((100 * val) / max)}%` }} /></span>
                <span className="text-right">{d.money ? brl(s.cents) : `${s.comandas} ${s.comandas === 1 ? "comanda" : "comandas"}`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Professionals({ d }: { d: SalonView }) {
  type R = SalonView["professionals"][number];
  const cols: Col<R>[] = [
    { key: "n", label: "Profissional", render: (p) => p.name },
    ...moneyCol<R>(d.money, { key: "f", label: "Faturado", align: "right", render: (p) => brl(p.cents) }),
    { key: "c", label: "Comandas", align: "right", render: (p) => p.comandas },
    ...moneyCol<R>(d.money, { key: "t", label: "Ticket", align: "right", render: (p) => brl(p.ticketCents) }),
    ...moneyCol<R>(d.money, { key: "m", label: "Comissão", align: "right", render: (p) => (p.commissionCents == null ? <span className="text-muted">não importada</span> : brl(p.commissionCents)) }),
  ];
  return (
    <Section id="salao-profissionais" title="Por profissional" lead="Itens de comanda de cada profissional no período." legend="salaoProfissional">
      {d.professionals.length === 0 ? <Muted>Nenhuma comanda no período.</Muted> : <DataList rows={d.professionals} cols={cols} rowKey={(p) => p.key} caption="Por profissional" />}
    </Section>
  );
}

function Services({ d }: { d: SalonView }) {
  const s = d.services;
  type I = SalonView["services"]["items"][number];
  type C = SalonView["services"]["categories"][number];
  const itemCols: Col<I>[] = [
    { key: "i", label: "Serviço ou produto", render: (x) => x.item }, { key: "c", label: "Categoria", render: (x) => x.category ?? "—" },
    { key: "n", label: "Vezes", align: "right", render: (x) => x.n }, ...moneyCol<I>(d.money, { key: "v", label: "Faturado", align: "right", render: (x) => brl(x.cents) }),
  ];
  const catCols: Col<C>[] = [
    { key: "c", label: "Categoria", render: (x) => x.category }, { key: "n", label: "Itens", align: "right", render: (x) => x.n },
    ...moneyCol<C>(d.money, { key: "v", label: "Faturado", align: "right", render: (x) => brl(x.cents) }),
  ];
  return (
    <Section id="salao-servicos" title="Por serviço e categoria" lead={d.money ? "Os 15 que mais faturaram; o resto vai somado." : "Os 15 mais feitos; o resto vai somado."} legend="salaoServico">
      {s.items.length === 0 ? <Muted>Nenhum item no período.</Muted> : (
        <div className="grid lg:grid-cols-[3fr_2fr] gap-x-12 gap-y-6">
          <div className="min-w-0">
            <DataList rows={s.items} cols={itemCols} rowKey={(x) => x.item} caption="Serviços e produtos" />
            {s.otherItems.count > 0 && <p className="text-[13px] text-muted mt-2 tabular">Outros {s.otherItems.count}: {s.otherItems.n} itens{d.money ? ` · ${brl(s.otherItems.cents)}` : ""}</p>}
          </div>
          <div className="min-w-0"><DataList rows={s.categories} cols={catCols} rowKey={(x) => x.category} caption="Por categoria" /></div>
        </div>
      )}
    </Section>
  );
}

function Payments({ d }: { d: SalonView }) {
  type P = SalonView["payments"][number];
  const cols: Col<P>[] = [
    { key: "m", label: "Forma de pagamento", render: (p) => p.method }, { key: "n", label: "Pagamentos", align: "right", render: (p) => p.n },
    ...moneyCol<P>(d.money, { key: "v", label: "Recebido", align: "right", render: (p) => brl(p.cents) }),
  ];
  return (
    <Section id="salao-pagamentos" title="Formas de pagamento" lead="Pagamentos de comanda pela data do pagamento." legend="salaoPagamento">
      {d.payments.length === 0 ? <Muted>Nenhum pagamento no período.</Muted> : <DataList rows={d.payments} cols={cols} rowKey={(p) => p.method} caption="Pagamentos por forma" />}
    </Section>
  );
}

function Clients({ d }: { d: SalonView }) {
  const c = d.clients;
  const n = c.novas + c.recorrentes, nPrev = c.previous.novas + c.previous.recorrentes;
  return (
    <Section id="salao-clientes" title="Clientes novas e recorrentes" lead="Quem comprou no período. Nova: a primeira compra dela foi no período." legend="salaoClientes">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 max-w-[560px]">
        <Fig label="Novas" value={String(c.novas)} sub={<Delta c={compareMetric(c.novas, c.previous.novas, { kind: "count", n, nPrev })} prevText={`antes: ${c.previous.novas}`} />} />
        <Fig label="Recorrentes" value={String(c.recorrentes)} sub={<Delta c={compareMetric(c.recorrentes, c.previous.recorrentes, { kind: "count", n, nPrev })} prevText={`antes: ${c.previous.recorrentes}`} />} />
      </dl>
    </Section>
  );
}

function Attendance({ d }: { d: SalonView }) {
  const a = d.attendance;
  type A = SalonView["attendance"]["rows"][number];
  const cols: Col<A>[] = [
    { key: "p", label: "Profissional", render: (x) => x.name }, { key: "c", label: "Compareceu", align: "right", render: (x) => x.compareceu },
    { key: "f", label: "Faltou", align: "right", render: (x) => x.faltou }, { key: "x", label: "Cancelou", align: "right", render: (x) => x.cancelado },
    { key: "s", label: "Sem desfecho", align: "right", render: (x) => (x.semDesfecho ? <b className="text-alert">{x.semDesfecho}</b> : 0) },
  ];
  return (
    <Section id="salao-comparecimento" title="Comparecimento, faltas e cancelamentos" legend="salaoComparecimento"
      lead={`No período: ${a.total.compareceu} compareceram, ${a.total.faltou} faltaram, ${a.total.cancelado} cancelaram.`}>
      {a.rows.length === 0 ? <Muted>Nenhum horário no período.</Muted> : <DataList rows={a.rows} cols={cols} rowKey={(x) => x.key} caption="Comparecimento por profissional" />}
    </Section>
  );
}

function NoOutcome({ d }: { d: SalonView }) {
  const n = d.attendance.noOutcome;
  const line = (x: (typeof n.items)[number]) => (<><span>{x.clientName ?? "Cliente"} · {x.service}</span><span className="tabular text-muted">{when(x.startsAt)}{x.professional ? ` · ${x.professional}` : ""}</span></>);
  const row = "flex flex-wrap items-baseline justify-between gap-x-3 min-h-11 py-2 text-[14px]";
  return (
    <Section id="salao-sem-desfecho" title="Agenda sem desfecho" legend="salaoSemDesfecho"
      lead={n.n ? `${n.n} ${n.n === 1 ? "horário já passou e continua" : "horários já passaram e continuam"} como agendado ou confirmado. Confira se a cliente veio.` : "Todo horário que já passou tem desfecho."}>
      {n.items.length > 0 && (
        <ul className="flex flex-col">
          {n.items.map((x) => (
            <li key={x.id} className="border-t border-line">
              {x.contactId ? <Link href={`/contatos/${x.contactId}`} className={`${row} hover:text-gold-ink`}>{line(x)}</Link> : <p className={row}>{line(x)}</p>}
            </li>
          ))}
        </ul>
      )}
      {n.n > n.items.length && <p className="text-[13px] text-muted mt-1">Mostrando {n.items.length} de {n.n}, os mais recentes.</p>}
    </Section>
  );
}

function Funnel({ d }: { d: SalonView }) {
  const f = d.funnel;
  const steps: [string, number][] = [["Conversas iniciadas", f.conversas], ["Marcaram horário depois", f.comHorario], ["Compareceram", f.compareceram], ["Compraram", f.compraram]];
  return (
    <Section id="salao-funil" title="Da conversa à compra" legend="salaoFunil"
      lead="Conversas que começaram no período e o que a cliente fez depois. Cada passo é contado por conta própria: quem passou na recepção compra sem horário marcado.">
      {f.conversas === 0 ? <Muted>Nenhuma conversa começou no período.</Muted> : (
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          {steps.map(([label, n], i) => <Fig key={label} label={label} value={String(n)} sub={i === 0 ? null : <span className="text-[13px] text-muted tabular">{shareText(n, f.conversas)} das conversas</span>} />)}
        </dl>
      )}
    </Section>
  );
}
```

Trocar `src/components/reports/report-tabs.tsx` inteiro por:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export type ReportTab = "visao" | "salao" | "analise";
const ALL: { value: ReportTab; label: string }[] = [{ value: "visao", label: "Visão geral" }, { value: "salao", label: "Salão" }, { value: "analise", label: "Análise" }];
const OTHER_PERIODS = ["hoje", "7d", "mes", "ano"];

/** Abas Visão geral / Salão / Análise. O estado mora na URL (?aba=…). O Salão só aparece para quem vê os números do salão (`canSeeSalon`). */
export function ReportTabs({ value, salon = false }: { value: ReportTab; salon?: boolean }) {
  const sp = useSearchParams(); const router = useRouter();
  const items = ALL.filter((t) => t.value !== "salao" || salon);
  return (
    <Tabs<ReportTab> label="Seção do relatório" idPrefix="rel" value={value} items={items} className="max-w-md"
      onChange={(v) => {
        const p = new URLSearchParams(sp.toString());
        p.set("aba", v);
        // As outras abas não têm "mês passado" nem datas livres.
        if (v !== "salao") { p.delete("de"); p.delete("ate"); if (!OTHER_PERIODS.includes(p.get("periodo") ?? "mes")) p.delete("periodo"); }
        router.replace(`/relatorios?${p}`, { scroll: false });
      }} />
  );
}
```

Em `src/app/(app)/relatorios/page.tsx`:
- imports: trocar `import { can, canSeeAvecReports } from "@/lib/permissions";` por `import { can, canSeeAvecReports, canSeeSalon } from "@/lib/permissions";` e acrescentar:

```ts
import { salonRange } from "@/lib/salon-period";
import { loadSalon } from "@/server/reports/salon";
import { SalonTab } from "@/components/reports/salon";
```

- trocar a linha `const aba: ReportTab = sp.aba === "analise" ? "analise" : "visao";` por:

```ts
  const salon = canSeeSalon(user.perms);
  const aba: ReportTab = sp.aba === "analise" ? "analise" : sp.aba === "salao" && salon ? "salao" : "visao";
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
```

- trocar o `Promise.all` de `people, sources, data` por:

```ts
  const [people, sources, data, salonView] = await Promise.all([
    gestor ? activeUsers() : Promise.resolve([]), reportSources(gestor ? null : user.id),
    aba === "salao" ? Promise.resolve(null) : aba === "analise" ? loadAnalysis(user, filter) : loadOverview(user, filter),
    aba === "salao" ? loadSalon(user, salonRange({ periodo: one("periodo"), de: one("de"), ate: one("ate") }, new Date())) : Promise.resolve(null),
  ]);
```

- no `PageHeader`: `subtitle={reportsSubtitle(salonView ? salonView.range.label : PERIOD_LABEL[period], env().DEMO)}` e, em `actions`, mostrar `PeriodTabs`, `ExportMenu` e `PdfMenu` só quando `aba !== "salao"` (o link "Relatórios do Avec" continua sempre):

```tsx
        actions={<>{aba !== "salao" && <PeriodTabs people={people} origins={sources} />}{canSeeAvecReports(user.perms) && <Link href="/relatorios/avec" className="h-9 pointer-coarse:h-11 px-3 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm hover:bg-paper-2">Relatórios do Avec</Link>}{aba !== "salao" && exportar && <ExportMenu qs={qs} team={gestor} money={money} />}{aba !== "salao" && exportar && <PdfMenu periodo={period} team={gestor} />}</>} />
```

- `<ReportTabs value={aba} />` vira `<ReportTabs value={aba} salon={salon} />`;
- o conteúdo do `tabpanel` vira:

```tsx
          {salonView ? <SalonTab d={salonView} />
            : data && ("followup" in data
              ? <AnalysisTab data={data} qs={qs} />
              : <OverviewTab data={data} period={period} qs={qs} gestor={money} scope={{ dono, fonte: source }} />)}
```

- [ ] **Passo 6: Teste da tela (com e sem valores)**

Criar `src/components/reports/salon.render.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { salonRange } from "@/lib/salon-period";
import type { SalonView } from "@/server/reports/salon";
import { SalonTab } from "./salon";

afterEach(cleanup);

const range = salonRange({ periodo: "mes-passado" }, new Date("2026-10-15T15:00:00Z"));
const view = (money: boolean): SalonView => {
  const c = (v: number) => (money ? v : null);
  return {
    range, avecUntil: "2026-10-14", money,
    revenue: { cents: c(37345), prevCents: c(10000), comandas: 2, prevComandas: 1, ticketCents: c(18673), prevTicketCents: c(10000),
      series: [{ key: "2026-09-02", label: "02/09", cents: c(25000), comandas: 1 }, { key: "2026-09-03", label: "03/09", cents: c(12345), comandas: 1 }] },
    professionals: [{ key: "p1", name: "MAIARA TESTE", comandas: 1, itens: 1, cents: c(25000), ticketCents: c(25000), commissionCents: null }],
    services: { items: [{ item: "Corte Teste", category: "CABELO", n: 1, cents: c(25000) }], otherItems: { count: 0, n: 0, cents: c(0) }, categories: [{ category: "CABELO", n: 2, cents: c(37345) }] },
    payments: [{ method: "Pix", n: 1, cents: c(25000) }],
    clients: { novas: 1, recorrentes: 1, previous: { novas: 0, recorrentes: 1 } },
    attendance: {
      rows: [{ key: "sem", name: "Sem profissional", compareceu: 1, faltou: 0, cancelado: 0, semDesfecho: 1 }], total: { compareceu: 1, faltou: 0, cancelado: 0, semDesfecho: 1 },
      noOutcome: { n: 1, items: [{ id: "a2", startsAt: "2026-09-05T13:00:00.000Z", clientName: "Bia Teste", contactId: "c1", professional: null, service: "Escova Teste" }] },
    },
    funnel: { conversas: 4, comHorario: 2, compareceram: 1, compraram: 1 },
  };
};

it("com valores: faturamento, comissão 'não importada', a fonte do Avec e a agenda sem desfecho abrindo a ficha", () => {
  const { container } = render(<SalonTab d={view(true)} />);
  expect(screen.getByRole("heading", { name: "Faturamento" })).toBeTruthy();
  expect(container.textContent).toMatch(/R\$\s373,45/);
  expect(container.textContent).toContain("não importada");
  expect(screen.getByTestId("fonte-salao").textContent).toContain("Fonte: Avec até 14/10/2026");
  expect(container.querySelector('a[href="/contatos/c1"]')).toBeTruthy();
});

it("sem valores: nenhum R$ na tela, só quantidades", () => {
  const { container } = render(<SalonTab d={view(false)} />);
  expect(screen.getByRole("heading", { name: "Comandas" })).toBeTruthy();
  expect(container.textContent).not.toMatch(/R\$/);
  expect(container.textContent).toContain("MAIARA TESTE");
});
```

Rodar: `npx vitest run src/components/reports/salon.render.test.tsx && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 7: Ver na tela (gestão)**

Rodar a suíte inteira antes: `npm test`. Esperado: PASS (o `guard-coverage.test.ts` continua verde: a página segue com `requirePerm("relatorios.ver")`).

- [ ] **Passo 8: e2e (gestão e perfil sem valores)**

Criar `e2e/relatorios-salao.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login, e2eSql } from "./helpers";

test.describe.configure({ mode: "serial" });

const ANA = "ana@e2e.local";
const limpa = async () => {
  for (const t of ["sales_items", "sales_payments", "appointments"]) await e2eSql(`delete from ${t} where external_key like 'e2e-salao:%'`);
  await e2eSql("update users set profile_id = (select id from profiles where key = 'atendente') where email = $1", [ANA]);
  await e2eSql("delete from profiles where name = 'Relatórios sem valores'");
};

test.beforeAll(async () => {
  await limpa();
  await e2eSql(`insert into sales_items (sold_on, comanda, item, kind, category, professional_name, value_cents, total_cents, origin, external_key) values
    ('2026-09-02', '501', 'Corte Teste', 'servico', 'CABELO', 'MAIARA TESTE', 25000, 25000, 'avec', 'e2e-salao:1'),
    ('2026-09-03', '502', 'Escova Teste', 'servico', 'CABELO', 'JO TESTE', 12345, 12345, 'avec', 'e2e-salao:2')`);
  await e2eSql(`insert into sales_payments (comanda_on, paid_on, comanda, method, value_cents, external_key) values ('2026-09-02', '2026-09-02', '501', 'Pix', 25000, 'e2e-salao:p1')`);
  await e2eSql(`insert into appointments (service_label, starts_at, status, external_key) values
    ('Corte Teste', '2026-09-02 13:00+00', 'compareceu', 'e2e-salao:a1'), ('Escova Teste', '2026-09-05 13:00+00', 'agendado', 'e2e-salao:a2')`);
});
test.afterAll(limpa);

test("gestão vê o Salão de setembro: faturamento, profissional, agenda sem desfecho e a fonte do Avec, sem rolagem lateral", async ({ page }) => {
  await login(page);
  await page.goto("/relatorios?aba=salao&de=2026-09-01&ate=2026-09-30");
  await expect(page.getByRole("tab", { name: "Salão" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Faturamento" })).toBeVisible();
  await expect(page.getByText(/R\$\s373,45/).first()).toBeVisible();
  await expect(page.getByText("MAIARA TESTE").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agenda sem desfecho" })).toBeVisible();
  await expect(page.getByTestId("fonte-salao")).toContainText("Fonte: Avec até");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("perfil com Relatórios mas sem 'ver valores': o Salão mostra só quantidades", async ({ browser, baseURL }) => {
  await e2eSql(`insert into profiles (name, permissions) values ('Relatórios sem valores', array['atendimento.ver','relatorios.ver','relatorios.equipe']::text[])`);
  await e2eSql("update users set profile_id = (select id from profiles where name = 'Relatórios sem valores') where email = $1", [ANA]);
  const ctx = await browser.newContext({ baseURL, storageState: "e2e/.auth/ana.json" });
  const ana = await ctx.newPage();
  try {
    await ana.goto("/relatorios?aba=salao&de=2026-09-01&ate=2026-09-30");
    await expect(ana.getByRole("heading", { name: "Comandas" })).toBeVisible();
    await expect(ana.getByText("MAIARA TESTE").first()).toBeVisible();
    expect(await ana.locator("main").innerText()).not.toMatch(/R\$/);
  } finally { await ctx.close(); }
});
```

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/relatorios-salao.spec.ts --project=desktop`
Esperado: PASS (2 testes, mais o `setup`).

- [ ] **Passo 9: Commit**

```bash
git add src/server/reports/salon.ts src/server/reports/salon-view.test.ts src/lib/permissions.ts src/lib/permissions.test.ts src/lib/report-legend.ts \
  src/components/reports/salon.tsx src/components/reports/salon-period-picker.tsx src/components/reports/salon.render.test.tsx \
  src/components/reports/report-tabs.tsx "src/app/(app)/relatorios/page.tsx" e2e/relatorios-salao.spec.ts
git commit -m "feat(salão): aba Salão nos Relatórios com período livre; valores só para quem pode ver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.5: "Retorno por coorte" calculado de verdade

**Arquivos:**
- Criar: `src/server/reports/cohort.ts`
- Modificar: `src/server/reports/screen.ts` (`loadAnalysis`), `src/components/reports/analysis.tsx` (sai `BlockedAvec`, entra `Cohort`), `src/lib/report-legend.ts`
- Teste: `src/server/reports/cohort.test.ts`

**Interfaces:**
- Consome: `todayBahia`, `brDay` (3.1); fixtures `item`, `appt`, `client` (3.2).
- Produz:
  - `COHORT_WINDOWS = [30, 60, 90]`, `COHORT_MONTHS = 12`
  - `type CohortCell = { base: number; voltou: number }`, `type CohortRow = { month: string; novas: number; d30: CohortCell; d60: CohortCell; d90: CohortCell }`, `type Cohorts = { dataEnd: string | null; rows: CohortRow[] }`
  - `returnCohorts(now?: Date): Promise<Cohorts>`
  - `Analysis.cohort: Cohorts | null` (só com `relatorios.equipe`)

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/reports/cohort.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { appt, client, item } from "../../../test/salon-fixtures";
import type { Perm } from "@/lib/permissions";
import { returnCohorts } from "./cohort";
import { loadAnalysis } from "./screen";

const NOW = new Date("2026-10-15T15:00:00Z");
beforeEach(resetDb);

it("coorte: clientes da primeira visita de cada mês e quantas voltaram em 30, 60 e 90 dias, só quando já deu tempo de medir", async () => {
  const a = await client("A Teste", "+5571990000011"), b = await client("B Teste", "+5571990000012");
  const c = await client("C Teste", "+5571990000013"), e = await client("E Teste", "+5571990000014");
  await item({ day: "2026-06-05", contactId: a, value: 1000 });
  await appt({ day: "2026-06-25", status: "compareceu", contactId: a });   // A volta em 20 dias (horário com Compareceu vale visita)
  await item({ day: "2026-06-10", contactId: b, value: 1000 });
  await item({ day: "2026-08-24", contactId: b, value: 1000 });            // B volta em 75 dias
  await item({ day: "2026-06-12", contactId: c, value: 1000 });            // C não volta
  await item({ day: "2026-09-25", contactId: e, value: 1000 });            // E: ainda não deu 30 dias até a última visita dos dados
  await item({ day: "2026-10-10", contactId: a, value: 1000 });            // a última visita registrada: 10/10
  const r = await returnCohorts(NOW);
  expect(r.dataEnd).toBe("2026-10-10");
  expect(r.rows.map((x) => x.month)).toEqual(["2026-09", "2026-06"]);
  expect(r.rows[1]).toEqual({ month: "2026-06", novas: 3, d30: { base: 3, voltou: 1 }, d60: { base: 3, voltou: 1 }, d90: { base: 3, voltou: 2 } });
  expect(r.rows[0]).toEqual({ month: "2026-09", novas: 1, d30: { base: 0, voltou: 0 }, d60: { base: 0, voltou: 0 }, d90: { base: 0, voltou: 0 } });
});

it("sem dados do Avec: nenhuma linha e nenhuma data", async () => {
  expect(await returnCohorts(NOW)).toEqual({ dataEnd: null, rows: [] });
});

it("na Análise, a coorte só vai para quem vê a equipe (é número do salão inteiro)", async () => {
  const u = { id: "00000000-0000-4000-8000-000000000001", name: "Teste", email: "t@t.local" };
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver"] as Perm[] }, { period: "mes", now: NOW })).cohort).toBeNull();
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe"] as Perm[] }, { period: "mes", now: NOW })).cohort).toEqual({ dataEnd: null, rows: [] });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/cohort.test.ts`
Esperado: FAIL ("Failed to resolve import ./cohort").

- [ ] **Passo 3: Implementar a consulta**

Criar `src/server/reports/cohort.ts`:

```ts
import { sql } from "drizzle-orm";
import { rows } from "./common";
import { todayBahia } from "../../lib/salon-period";

export const COHORT_WINDOWS = [30, 60, 90] as const;
export const COHORT_MONTHS = 12;
export type CohortCell = { base: number; voltou: number };
export type CohortRow = { month: string; novas: number; d30: CohortCell; d60: CohortCell; d90: CohortCell };
export type Cohorts = { dataEnd: string | null; rows: CohortRow[] };

/**
 * Retorno por coorte: clientes cuja PRIMEIRA visita (comanda ou horário com Compareceu, Avec ou CRM) caiu em cada um dos últimos 12 meses,
 * e quantas voltaram (visita em outro dia) em até 30, 60 e 90 dias. Só entra na base quem já teve o tempo inteiro para voltar até a
 * última visita registrada (`dataEnd`): sem isso, o mês recente pareceria pior do que é (os dados do Avec são uma foto).
 */
export async function returnCohorts(now = new Date()): Promise<Cohorts> {
  const today = todayBahia(now), nowIso = now.toISOString();
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(y, m0 - (COHORT_MONTHS - 1), 1)).toISOString().slice(0, 10);
  const visits = sql`
    select si.contact_id, si.sold_on as day from sales_items si where si.contact_id is not null and si.sold_on <= ${today}::date
    union
    select a.contact_id, (a.starts_at at time zone 'America/Bahia')::date from appointments a
    where a.contact_id is not null and a.status = 'compareceu' and a.starts_at <= ${nowIso}::timestamptz`;
  const [end] = await rows<{ d: string | null }>(sql`with visits as (${visits}) select max(day)::text as d from visits`);
  if (!end?.d) return { dataEnd: null, rows: [] };
  const windows = sql.join(COHORT_WINDOWS.map((w) => sql`
    count(*) filter (where f.first_day + ${w}::int <= ${end.d}::date)::int as ${sql.raw(`base${w}`)},
    count(*) filter (where f.first_day + ${w}::int <= ${end.d}::date and exists (select 1 from visits v
      where v.contact_id = f.contact_id and v.day > f.first_day and v.day <= f.first_day + ${w}::int))::int as ${sql.raw(`voltou${w}`)}`), sql`,`);
  const r = await rows<Record<string, unknown>>(sql`
    with visits as (${visits}), firsts as (select contact_id, min(day) as first_day from visits group by contact_id)
    select to_char(f.first_day, 'YYYY-MM') as month, count(*)::int as novas, ${windows}
    from firsts f where f.first_day >= ${start}::date group by 1 order by 1 desc`);
  const cell = (x: Record<string, unknown>, w: number): CohortCell => ({ base: Number(x[`base${w}`] ?? 0), voltou: Number(x[`voltou${w}`] ?? 0) });
  return { dataEnd: end.d, rows: r.map((x) => ({ month: String(x.month), novas: Number(x.novas), d30: cell(x, 30), d60: cell(x, 60), d90: cell(x, 90) })) };
}
```

- [ ] **Passo 4: Análise usa a coorte**

Em `src/server/reports/screen.ts`, acrescentar `import { returnCohorts } from "./cohort";` e trocar `loadAnalysis` por:

```ts
export async function loadAnalysis(user: ScreenUser, filter: ReportFilter) {
  const team = can(user.perms, "relatorios.equipe"), money = can(user.perms, "valores.ver");
  const f = scopedFilter(user, filter);
  const [followup, heatmap, people, finance, cohort] = await Promise.all([
    followupEfficacy(f), demandHeatmap(f), team ? personVsGoal(f) : null, team && money ? financeWithPaid(f) : null,
    team ? returnCohorts(f.now ?? new Date()) : null,
  ]);
  return { followup, heatmap, people, finance, cohort };
}
```

Em `src/lib/report-legend.ts`, acrescentar:

```ts
  coorte: "Clientes cuja primeira visita (comanda ou horário com Compareceu, do Avec ou do CRM) foi em cada mês, e quantas voltaram em outro dia em até 30, 60 e 90 dias. Só conta quem já teve o tempo inteiro para voltar até a última visita registrada; antes disso aparece 'ainda não dá'. Com menos de 20 clientes na base, a conta aparece como 'x de y'.",
```

Em `src/components/reports/analysis.tsx`:
- apagar a função `BlockedAvec` (e o comentário acima dela) e o import de `Badge` se não for mais usado;
- acrescentar `shareText` ao import de `@/lib/report-format` e `import { brDay } from "@/lib/salon-period";`;
- em `AnalysisTab`, trocar `<BlockedAvec />` por `{d.cohort && <Cohort c={d.cohort} />}`;
- acrescentar:

```tsx
const monthLabel = (k: string) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

function Cohort({ c }: { c: NonNullable<Analysis["cohort"]> }) {
  type R = (typeof c.rows)[number];
  const cell = (w: { base: number; voltou: number }) => (w.base === 0 ? <span className="text-muted">ainda não dá</span> : shareText(w.voltou, w.base));
  const cols: Col<R>[] = [
    { key: "m", label: "Mês da primeira visita", render: (r) => monthLabel(r.month) },
    { key: "n", label: "Clientes novas", align: "right", render: (r) => r.novas },
    { key: "30", label: "Voltou em 30 dias", align: "right", render: (r) => cell(r.d30) },
    { key: "60", label: "Em 60 dias", align: "right", render: (r) => cell(r.d60) },
    { key: "90", label: "Em 90 dias", align: "right", render: (r) => cell(r.d90) },
  ];
  return (
    <Section id="coorte" title="Retorno por coorte" legend="coorte"
      lead={`Clientes que vieram pela primeira vez em cada mês e quantas voltaram. Visitas: comandas e horários com Compareceu${c.dataEnd ? `, até ${brDay(c.dataEnd)}` : ""}.`}>
      {c.rows.length === 0 ? <Muted>Nenhuma cliente nova nos últimos 12 meses (ou o Avec ainda não foi importado).</Muted>
        : <DataList rows={c.rows} cols={cols} rowKey={(r) => r.month} caption="Retorno por coorte" />}
    </Section>
  );
}
```

- atualizar o comentário de `AnalysisTab` para "Análise: R10 (follow-up), R11 (mapa de calor), retorno por coorte e, só para a gestão, R7 (pessoa contra a meta) e R13 (financeiro)".

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/reports/cohort.test.ts src/server/reports/reports.test.ts && npm run typecheck && npm run lint`
Esperado: PASS. Se algum teste antigo procurava o texto "Depende da exportação de atendimentos do Avec", trocar a expectativa por "Retorno por coorte" (o texto enganoso saiu de propósito).

- [ ] **Passo 6: Commit**

```bash
git add src/server/reports/cohort.ts src/server/reports/cohort.test.ts src/server/reports/screen.ts src/components/reports/analysis.tsx src/lib/report-legend.ts
git commit -m "feat(relatórios): Retorno por coorte calculado com as visitas do Avec e do CRM (sai o aviso de 'bloqueado')

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.6: "Financeiro" com o salão (Avec + CRM) e a legenda de fonte

**Arquivos:**
- Modificar: `src/server/reports/salon.ts` (acrescentar `salonFinance`)
- Modificar: `src/server/reports/screen.ts` (`loadAnalysis` ganha `salon`), `src/components/reports/analysis.tsx` (`Finance`), `src/lib/report-legend.ts` (`financeiro`)
- Modificar: `src/app/api/relatorios/[tipo]/route.ts` (CSV "financeiro")
- Teste: `src/server/reports/salon-finance.test.ts`

**Interfaces:**
- Consome: `revenueTotals`, `salonPayments`, `avecUntil`, `type PaymentRow`, `type DayRange` (3.2); `periodWindow`, `type ReportFilter` (`./common`); `todayBahia` (3.1).
- Produz:
  - `type SalonFinance = { from: string; to: string; avecUntil: string | null; faturadoCents: number; comandas: number; recebidoCents: number; byMethod: PaymentRow[] }`
  - `salonFinance(f: Pick<ReportFilter, "period" | "now">): Promise<SalonFinance>`
  - `Analysis.salon: SalonFinance | null` (só com `relatorios.equipe` e `valores.ver`)

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/reports/salon-finance.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment } from "../../../test/salon-fixtures";
import type { Perm } from "@/lib/permissions";
import { salonFinance } from "./salon";
import { loadAnalysis } from "./screen";

const NOW = new Date("2026-10-15T15:00:00Z");
beforeEach(resetDb);

it("Financeiro: o salão no período da tela (comandas do Avec e do CRM, recebido por forma) e até quando vai o Avec", async () => {
  await item({ day: "2026-10-02", value: 50000 });
  await item({ day: "2026-10-03", value: 7000, origin: "crm" }); // comanda do CRM (Lote 6C) entra junto
  await item({ day: "2026-09-30", value: 99000 });                // fora do mês
  await payment({ day: "2026-10-02", value: 40000, method: "Pix" });
  expect(await salonFinance({ period: "mes", now: NOW })).toEqual({
    from: "2026-10-01", to: "2026-10-15", avecUntil: "2026-10-02", faturadoCents: 57000, comandas: 2, recebidoCents: 40000,
    byMethod: [{ method: "Pix", n: 1, cents: 40000 }],
  });
});

it("Análise: o bloco do salão só vai para quem vê a equipe e os valores", async () => {
  const u = { id: "00000000-0000-4000-8000-000000000001", name: "Teste", email: "t@t.local" };
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe"] as Perm[] }, { period: "mes", now: NOW })).salon).toBeNull();
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe", "valores.ver"] as Perm[] }, { period: "mes", now: NOW })).salon).not.toBeNull();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/salon-finance.test.ts`
Esperado: FAIL ("salonFinance is not a function").

- [ ] **Passo 3: Implementar**

Em `src/server/reports/salon.ts`, acrescentar ao import de `./common`: `import { periodWindow, rows, type ReportFilter } from "./common";`, ao import de `salon-period`: `todayBahia`, e no fim do arquivo:

```ts
/* ───────────── Financeiro (aba Análise) ───────────── */

export type SalonFinance = { from: string; to: string; avecUntil: string | null; faturadoCents: number; comandas: number; recebidoCents: number; byMethod: PaymentRow[] };

/** O salão no período da tela da Análise (hoje, 7 dias, mês, ano), em dias de Salvador: faturado, comandas e recebido por forma. */
export async function salonFinance(f: Pick<ReportFilter, "period" | "now">): Promise<SalonFinance> {
  const w = periodWindow(f);
  const r: DayRange = { from: todayBahia(w.from), to: todayBahia(w.to) };
  const [rev, pays, until] = await Promise.all([revenueTotals(r), salonPayments(r), avecUntil()]);
  return { ...r, avecUntil: until, faturadoCents: rev.cents, comandas: rev.comandas, recebidoCents: pays.reduce((a, p) => a + p.cents, 0), byMethod: pays };
}
```

Em `src/server/reports/screen.ts`, acrescentar `import { salonFinance } from "./salon";` e, em `loadAnalysis`, acrescentar `salon` ao `Promise.all` e ao retorno:

```ts
  const [followup, heatmap, people, finance, cohort, salon] = await Promise.all([
    followupEfficacy(f), demandHeatmap(f), team ? personVsGoal(f) : null, team && money ? financeWithPaid(f) : null,
    team ? returnCohorts(f.now ?? new Date()) : null, team && money ? salonFinance(f) : null,
  ]);
  return { followup, heatmap, people, finance, cohort, salon };
```

Em `src/lib/report-legend.ts`, trocar o texto de `financeiro` por:

```ts
  financeiro: "No salão: soma dos itens de comanda do período (valor menos desconto, sem sessão de pacote), do Avec e das comandas do CRM, e os pagamentos recebidos por forma de pagamento; a 'fonte' diz até quando vão os dados do Avec importados. Vendas fechadas no atendimento: as conversas fechadas como venda no CRM, com o valor informado; pago é o valor pago informado (ou o valor inteiro se há só a data de pagamento); a receber é vendido menos pago. Os dois blocos não se somam: a mesma venda pode estar nos dois. Vencidas e a vencer: vendas com cobrança marcada e saldo a pagar, de qualquer data.",
```

Em `src/components/reports/analysis.tsx`, no `Finance`:
- a `Section` passa a ter `lead="Faturamento do salão (comandas do Avec e do CRM) e as vendas fechadas no atendimento."`;
- logo no começo do conteúdo da `Section`, antes do bloco atual, acrescentar o bloco do salão;
- o título do bloco atual vira "Vendas fechadas no atendimento" e o vazio diz "Nenhuma venda fechada no atendimento no período (n = 0).":

```tsx
function Finance({ d, csv, cobrancas }: { d: Analysis; csv: { href: string; label: string }; cobrancas: { href: string; label: string } }) {
  const f = d.finance!, s = d.salon;
  const methodCols: Col<(typeof f.byMethod)[number]>[] = [
    { key: "m", label: "Forma de pagamento", render: (m) => (m.method ? PAYMENT_LABEL[m.method] ?? m.method : "Não informada") },
    { key: "n", label: "Vendas", align: "right", render: (m) => m.n },
    { key: "t", label: "Vendido", align: "right", render: (m) => money(m.totalCents) },
    { key: "p", label: "Pago", align: "right", render: (m) => money(m.pagoCents) },
  ];
  const salonCols: Col<NonNullable<typeof s>["byMethod"][number]>[] = [
    { key: "m", label: "Forma de pagamento", render: (m) => m.method },
    { key: "n", label: "Pagamentos", align: "right", render: (m) => m.n },
    { key: "v", label: "Recebido", align: "right", render: (m) => money(m.cents) },
  ];
  return (
    <Section id="financeiro" title="Financeiro" lead="Faturamento do salão (comandas do Avec e do CRM) e as vendas fechadas no atendimento." csv={csv} legend="financeiro">
      {s && (
        <div className="flex flex-col gap-4 mb-10">
          <div>
            <h3 className="text-[15px] font-medium">No salão (comandas)</h3>
            <p className="text-[13px] text-muted mt-0.5" data-testid="fonte-financeiro">{s.avecUntil ? `Fonte: Avec até ${brDay(s.avecUntil)}` : "Ainda não há dados do Avec"} · comandas do CRM entram junto</p>
          </div>
          {s.comandas === 0 && s.recebidoCents === 0 ? <Muted>Nenhuma comanda no período.</Muted> : (
            <>
              <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                <Fig label="Faturado" value={money(s.faturadoCents)} sub={`${s.comandas} ${s.comandas === 1 ? "comanda" : "comandas"}`} big />
                <Fig label="Recebido" value={money(s.recebidoCents)} />
              </dl>
              {s.byMethod.length > 0 && <DataList rows={s.byMethod} cols={salonCols} rowKey={(m) => m.method} caption="Recebido no salão por forma de pagamento" />}
            </>
          )}
        </div>
      )}
      <h3 className="text-[15px] font-medium mb-3">Vendas fechadas no atendimento</h3>
      {f.vendas === 0 ? <Muted>Nenhuma venda fechada no atendimento no período (n = 0).</Muted> : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <Fig label="Vendido" value={money(f.totalCents)} sub={`${f.vendas} ${f.vendas === 1 ? "venda" : "vendas"}`} big />
            <Fig label="Pago" value={money(f.pagoCents)} />
            <Fig label="A receber" value={money(f.aReceberCents)} />
            <Fig label="Valor médio por venda" value={f.ticketCents == null ? "—" : money(f.ticketCents)} sub={`${f.vendasComValor} ${f.vendasComValor === 1 ? "venda com valor" : "vendas com valor"}`} />
          </dl>
          <DataList rows={f.byMethod} cols={methodCols} rowKey={(m) => m.method ?? "x"} caption="Vendas por forma de pagamento" />
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-x-14 gap-y-6 mt-8">
        <Charges title="Cobranças vencidas" tone="alert" data={f.vencidas} />
        <Charges title="Cobranças a vencer" tone="ink" data={f.aVencer} />
      </div>
      <p className="mt-2"><a href={cobrancas.href} download className="inline-flex items-center min-h-11 text-[13px] text-gold-ink underline underline-offset-2" aria-label="Baixar CSV: cobranças">Baixar CSV das cobranças</a></p>
    </Section>
  );
}
```

Em `src/app/api/relatorios/[tipo]/route.ts`:
- acrescentar `import { salonFinance } from "@/server/reports/salon";`;
- no `case "financeiro"`, trocar por (as 4 colunas continuam; o salão vem depois de uma linha em branco):

```ts
    case "financeiro": {
      const [r, s] = await Promise.all([financeWithPaid(f), salonFinance(f)]);
      const day = (d: string | null) => (d ? d.split("-").reverse().join("/") : "sem dados");
      csv = toCsv(["Forma de pagamento", "Vendas", "Vendido (R$)", "Pago (R$)"], [
        ...r.byMethod.map((x) => [x.method ? PAY[x.method] ?? x.method : "Não informada", x.n, brl(x.totalCents), brl(x.pagoCents)]),
        ["Total", r.vendas, brl(r.totalCents), brl(r.pagoCents)], ["A receber", "", brl(r.aReceberCents), ""],
        [`Ticket médio (n = ${r.vendasComValor} vendas com valor)`, "", r.ticketCents == null ? "" : brl(r.ticketCents), ""],
        ["", "", "", ""],
        [`No salão (comandas do Avec e do CRM; fonte: Avec até ${day(s.avecUntil)})`, "Comandas", "Faturado (R$)", ""],
        ["Faturado", s.comandas, brl(s.faturadoCents), ""],
        ...s.byMethod.map((x) => [`Recebido: ${x.method}`, x.n, brl(x.cents), ""]),
        ["Recebido (total)", "", brl(s.recebidoCents), ""],
      ]);
      break;
    }
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/reports/salon-finance.test.ts src/server/reports/reports.test.ts && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/server/reports/salon.ts src/server/reports/salon-finance.test.ts src/server/reports/screen.ts src/components/reports/analysis.tsx src/lib/report-legend.ts "src/app/api/relatorios/[tipo]/route.ts"
git commit -m "feat(relatórios): Financeiro com o salão (Avec e CRM) e a legenda da fonte, separado das vendas do atendimento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 3.7: "Tempo de resposta por atendente" pela autora da mensagem (Lote 1A)

**Arquivos:**
- Criar: `src/server/reports/replies.ts`
- Modificar: `src/server/reports/queries.ts` (`firstResponses`, linhas 15-21), `src/server/domain/deals.ts` (evento `resposta` em `recordOutbound`), `src/server/reports/screen.ts`, `src/components/reports/analysis.tsx`, `src/lib/report-legend.ts`
- Teste: `src/server/reports/replies.test.ts`

**Interfaces:**
- Consome: do 1A, `messages.sent_by_user_id` (autora: assinatura ou pessoa logada), `users.signature`; `recordInbound`/`recordOutbound` (`src/server/domain/deals.ts`).
- Produz:
  - `REPLY_MESSAGE_JOIN(ev = "e"): SQL` (liga o evento `resposta` à mensagem que respondeu: pelo `payload.messageId` ou pelo `mensagem_enviada` da mesma transação; alias da mensagem: `rm`)
  - `repliesWithAuthor(f: ReportFilter, w: Window): SQL` (colunas `w`, `sla`, `author_id`)
  - `type AuthorReplyRow = { userId: string; name: string; n: number; p50: number | null; slaHit: number; slaHitPct: number | null }`, `type AuthorReplies = { rows: AuthorReplyRow[]; semAutora: number }`, `replyTimesByAuthor(f: ReportFilter): Promise<AuthorReplies>`
  - `firstResponses` passa a devolver `user_id = coalesce(autora da mensagem, user_id do evento)` (vale para "Cada pessoa contra a meta" e para o PDF "Por atendente", `team.ts`)
  - evento `resposta` ganha `payload.messageId`
  - `Analysis.replies: AuthorReplies`

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/reports/replies.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { personVsGoal } from "./queries";
import { replyTimesByAuthor } from "./replies";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // 13/10/2026 (terça), hora de Salvador
let sara = "";

beforeEach(async () => {
  await resetDb();
  [sara] = (await db.insert(users).values([
    { name: "Sara Teste", email: "sara@teste.local", role: "atendente", signature: "SARA" },
    { name: "Cati Teste", email: "cati@teste.local", role: "gestor", signature: "CATI" },
  ]).returning()).map((u) => u.id);
});

async function conversa(i: number, at: Date) {
  const r = await recordInbound({ channelId: null, externalId: `in-${i}`, phoneRaw: `7199${1_000_000 + i}`, body: "oi", at });
  if (!("dealId" in r)) throw new Error("lead não criado");
  return r.dealId;
}
const responde = (dealId: string, id: string, at: Date, body: string) => recordOutbound({ dealId, channelId: null, externalId: id, body, fromPhone: true, at });

it("tempo de resposta por atendente: todas as respostas, pela assinatura; sem assinatura fica à parte", async () => {
  const d1 = await conversa(1, T(10));
  await responde(d1, "o1", T(10, 4), "*CATI - CASA FIAES:*\nOi!");                 // Cati, 4 min (primeira)
  await recordInbound({ channelId: null, externalId: "in-1b", phoneRaw: "71991000001", body: "e o preço?", at: T(11) });
  await responde(d1, "o2", T(11, 10), "*SARA - CASA FIAES:*\nR$ 100");             // Sara, 10 min (não é a primeira)
  const d2 = await conversa(2, T(12));
  await responde(d2, "o3", T(12, 2), "áudio sem assinatura");                       // sem autora
  const r = await replyTimesByAuthor({ period: "mes", now: T(18) });
  expect(r.rows.map((x) => [x.name, x.n, x.p50])).toEqual([["Cati Teste", 1, 240], ["Sara Teste", 1, 600]]);
  expect(r.semAutora).toBe(1);
  // A atendente (ownerId = ela, pelo scopedFilter) vê só a própria linha e não vê o "sem autora".
  expect(await replyTimesByAuthor({ period: "mes", now: T(18), ownerId: sara })).toEqual({ rows: [expect.objectContaining({ name: "Sara Teste", n: 1 })], semAutora: 0 });
});

it("o evento resposta guarda a mensagem que respondeu", async () => {
  const d = await conversa(3, T(10));
  const out = await responde(d, "o4", T(10, 1), "*SARA - CASA FIAES:*\nOi");
  const [ev] = await db.select().from(dealEvents).where(sql`${dealEvents.dealId} = ${d} and ${dealEvents.type} = 'resposta'`);
  expect(ev.payload.messageId).toBe("messageId" in out ? out.messageId : "?");
});

it("primeiras respostas (Cada pessoa contra a meta): vale a autora da mensagem, também nos eventos antigos (dona no evento, sem messageId)", async () => {
  for (let i = 0; i < 20; i++) {
    const id = await conversa(100 + i, T(9, i));
    await db.update(deals).set({ ownerId: sara }).where(eq(deals.id, id));
    await responde(id, `p${i}`, T(9, i + 1), "*CATI - CASA FIAES:*\nOi");
  }
  // Como era antes do Lote 1A: a resposta pelo celular contava para a dona e o evento não guardava a mensagem.
  await db.execute(sql`update deal_events set user_id = ${sara}, payload = payload - 'messageId' where type = 'resposta'`);
  const people = await personVsGoal({ period: "mes", now: T(18), compare: true });
  expect(people.map((p) => [p.name, p.n])).toEqual([["Cati Teste", 20]]);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/reports/replies.test.ts`
Esperado: FAIL ("Failed to resolve import ./replies").

- [ ] **Passo 3: O evento guarda a mensagem**

Em `src/server/domain/deals.ts`, dentro de `recordOutbound`, no `logEvent(tx, dealId, "resposta", { ... }, responder)` (achar com `grep -n '"resposta", {' src/server/domain/deals.ts`), acrescentar `messageId: msg.id` ao payload:

```ts
      await logEvent(tx, dealId, "resposta", {
        waitedSeconds: waited, first: !deal.firstResponseAt, fromPhone: !!input.fromPhone,
        stage: stage?.key ?? null, slaSeconds: stage?.slaMinutes ? stage.slaMinutes * 60 : null, messageId: msg.id,
      }, responder);
```

- [ ] **Passo 4: Respostas com autora**

Criar `src/server/reports/replies.ts`:

```ts
import { sql, type SQL } from "drizzle-orm";
import { dealScope, iso, pct, periodWindow, rows, SLA_FALLBACK_SECONDS, upTo, type ReportFilter, type Window } from "./common";

/**
 * A mensagem que respondeu cada evento `resposta` (alias `rm`): a do próprio evento (`payload.messageId`, gravado desde o Lote 3) ou a do
 * `mensagem_enviada` gravado na MESMA transação (mesmo `created_at`; eventos antigos). Dela sai a autora (Lote 1A: assinatura do
 * celular/ChatGuru ou quem estava logada no CRM), também nas mensagens acertadas para trás pelo script do 1A.
 */
export const REPLY_MESSAGE_JOIN = (ev = "e"): SQL => sql.raw(`
  left join lateral (select me.payload->>'messageId' as mid from deal_events me
    where me.deal_id = ${ev}.deal_id and me.type = 'mensagem_enviada' and me.created_at = ${ev}.created_at limit 1) pm on true
  left join messages rm on rm.id = coalesce(${ev}.payload->>'messageId', pm.mid)::uuid`);

/**
 * Todas as respostas do período (não só a primeira), pela hora da mensagem. `author_id` null = sem autora (áudio, foto, celular sem
 * assinatura). Vale para qualquer conversa: quem respondeu não precisa ser a dona.
 */
export const repliesWithAuthor = (f: ReportFilter, w: Window): SQL => sql`
  select (e.payload->>'waitedSeconds')::int as w, coalesce((e.payload->>'slaSeconds')::int, ${SLA_FALLBACK_SECONDS}) as sla, rm.sent_by_user_id as author_id
  from deal_events e join deals d on d.id = e.deal_id ${REPLY_MESSAGE_JOIN()}
  where e.type = 'resposta' and e.created_at >= ${iso(w.from)}::timestamptz - interval '7 days'
    and coalesce(rm.created_at, e.created_at) >= ${iso(w.from)}::timestamptz and ${upTo("coalesce(rm.created_at, e.created_at)", w)}
    and ${dealScope({ ...f, ownerId: null })}`;

export type AuthorReplyRow = { userId: string; name: string; n: number; p50: number | null; slaHit: number; slaHitPct: number | null };
export type AuthorReplies = { rows: AuthorReplyRow[]; semAutora: number };

/**
 * "Tempo de resposta por atendente": cada pessoa que respondeu no período, com a mediana (expediente) e quantas no prazo.
 * Com `f.ownerId` (atendente sem "toda a equipe", ver `scopedFilter`), só a linha dela e sem o "sem autora".
 */
export async function replyTimesByAuthor(f: ReportFilter): Promise<AuthorReplies> {
  const w = periodWindow(f);
  const r = await rows<{ userId: string | null; name: string | null; n: number; p50: number | null; hit: number }>(sql`
    with rr as (${repliesWithAuthor(f, w)})
    select rr.author_id as "userId", u.name, count(*)::int as n, round(percentile_cont(0.5) within group (order by rr.w))::int as p50,
      count(*) filter (where rr.w <= rr.sla)::int as hit
    from rr left join users u on u.id = rr.author_id group by rr.author_id, u.name`);
  const own = f.ownerId ?? null;
  return {
    rows: r.filter((x): x is typeof x & { userId: string } => !!x.userId && (!own || x.userId === own))
      .map((x) => ({ userId: x.userId, name: x.name ?? "Sem nome", n: x.n, p50: x.p50, slaHit: x.hit, slaHitPct: pct(x.hit, x.n) }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    semAutora: own ? 0 : r.find((x) => !x.userId)?.n ?? 0,
  };
}
```

Em `src/server/reports/queries.ts`:
- acrescentar `import { REPLY_MESSAGE_JOIN } from "./replies";`;
- trocar `firstResponses` (linhas 10-21) por:

```ts
/**
 * Primeiras respostas humanas dos leads da coorte: 1 por lead, `waitedSeconds` já em segundos de expediente.
 * Só vale a resposta que já tinha acontecido até o fim da janela (no período anterior, até o corte).
 * Prazo (`sla`): o da etapa no momento da resposta; etapa sem prazo usa a reserva do Lead (ou 2 min).
 * Quem respondeu (`user_id`): a AUTORA da mensagem (Lote 1A: assinatura ou pessoa logada); sem autora, quem o evento guardou (a dona).
 */
export const firstResponses = (f: ReportFilter, w: Window) => sql`
  select (e.payload->>'waitedSeconds')::int as w, coalesce(rm.sent_by_user_id, e.user_id) as user_id,
    coalesce((e.payload->>'slaSeconds')::int, ${SLA_FALLBACK_SECONDS}) as sla,
    e.payload->>'stage' as stage, (e.payload->>'fromPhone' = 'true') as from_phone
  from deals d
  join lateral (select ev.payload, ev.user_id, ev.deal_id, ev.created_at from deal_events ev
    where ev.deal_id = d.id and ev.type = 'resposta' and ev.payload->>'first' = 'true' order by ev.created_at limit 1) e on true
  ${REPLY_MESSAGE_JOIN()}
  where d.first_response_at is not null and ${upTo("d.first_response_at", w)} and ${cohort(f, w)}`;
```

- [ ] **Passo 5: A seção na Análise**

Em `src/server/reports/screen.ts`, acrescentar `import { replyTimesByAuthor } from "./replies";` e, em `loadAnalysis`, `replies` no `Promise.all` e no retorno:

```ts
  const [followup, heatmap, people, finance, cohort, salon, replies] = await Promise.all([
    followupEfficacy(f), demandHeatmap(f), team ? personVsGoal(f) : null, team && money ? financeWithPaid(f) : null,
    team ? returnCohorts(f.now ?? new Date()) : null, team && money ? salonFinance(f) : null, replyTimesByAuthor(f),
  ]);
  return { followup, heatmap, people, finance, cohort, salon, replies };
```

Em `src/lib/report-legend.ts`:
- acrescentar:

```ts
  respostaAutora: "Cada resposta da Casa a uma cliente que esperava, no período, pela autora da mensagem: a assinatura *NOME - CASA FIAES:* do celular ou do ChatGuru, ou quem estava no CRM. Tempo típico: a mediana, em horas de expediente. No prazo: dentro do prazo da etapa. Resposta sem assinatura (áudio, foto) não entra por pessoa. A atendente vê só a própria linha.",
```

- no texto de `pessoas`, trocar "Resposta dada pelo celular vale para quem está com o lead." por "Vale quem assinou a resposta (celular ou ChatGuru) ou quem estava no CRM; sem assinatura, quem está com o lead."

Em `src/components/reports/analysis.tsx`:
- acrescentar `shareText` ao import de `@/lib/report-format` (se a 3.5 ainda não acrescentou);
- em `AnalysisTab`, logo depois de `{d.people && <People ... />}`: `<Replies r={d.replies} />`;
- acrescentar:

```tsx
function Replies({ r }: { r: Analysis["replies"] }) {
  type R = (typeof r.rows)[number];
  const cols: Col<R>[] = [
    { key: "p", label: "Quem respondeu", render: (x) => x.name },
    { key: "n", label: "Respostas", align: "right", render: (x) => x.n },
    { key: "m", label: "Tempo típico", align: "right", render: (x) => (x.p50 == null ? "—" : seconds(x.p50)) },
    { key: "s", label: "No prazo", align: "right", render: (x) => shareText(x.slaHit, x.n) ?? "—" },
  ];
  return (
    <Section id="resposta-autora" title="Tempo de resposta por atendente" legend="respostaAutora"
      lead="Todas as respostas do período, pela assinatura (*NOME - CASA FIAES:*) ou por quem estava no CRM.">
      {r.rows.length === 0 ? <Muted>Nenhuma resposta com autora no período.</Muted> : <DataList rows={r.rows} cols={cols} rowKey={(x) => x.userId} caption="Tempo de resposta por atendente" />}
      {r.semAutora > 0 && <p className="text-[13px] text-muted mt-2">{r.semAutora} {r.semAutora === 1 ? "resposta sem autora" : "respostas sem autora"} (áudio, foto ou celular sem assinatura) fora da tabela.</p>}
    </Section>
  );
}
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/reports src/server/domain/deals.test.ts src/server/domain/authorship.test.ts && npm run typecheck && npm run lint`
Esperado: PASS. `reports.test.ts`, `team.test.ts` e o PDF "Por atendente" continuam verdes: quando a autora é a dona, nada muda.

- [ ] **Passo 7: Commit**

```bash
git add src/server/reports/replies.ts src/server/reports/replies.test.ts src/server/reports/queries.ts src/server/domain/deals.ts \
  src/server/reports/screen.ts src/components/reports/analysis.tsx src/lib/report-legend.ts
git commit -m "feat(relatórios): tempo de resposta por atendente pela autora da mensagem (assinatura do 1A), também nas primeiras respostas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.8: Comissão histórica do Avec nos itens (importação daqui para a frente e acerto pelos relatórios guardados)

**Arquivos:**
- Modificar: `src/server/domain/avec/normalize.ts` (+ `pctOrNull`), `src/server/domain/avec/normalize.test.ts`
- Modificar: `src/server/domain/avec/import-sales.ts` (`importSalesItems`)
- Criar: `src/server/domain/avec/commission-backfill.ts`, `scripts/comissao-avec.ts`
- Testes: `src/server/domain/avec/apply.test.ts` (novo caso), `src/server/domain/avec/commission-backfill.test.ts`

**Interfaces:**
- Consome: `sales_items.commission_pct`/`commission_cents` (Tarefa 0); `COLS`, `colOf` (`formats.ts`); `comandaOf`, `dateIso`, `moneyCents`, `normText` (`normalize.ts`); `todayBahia` (3.1); fixture `item` (3.2).
- Produz:
  - `pctOrNull(v: string | null | undefined): number | null` (0 a 100, 2 casas)
  - importação de "Itens de comanda" grava `commissionPct`/`commissionCents` e completa linhas antigas sem comissão
  - em `commission-backfill.ts`: `hasItemCommission(columns): boolean`, `rowCommission(columns, row): { pct; cents }`, `type CommissionUpdate`, `type CommissionPlan = { relatorios; updates; semPar; ambiguas; jaTinham; conferencia: { mes; linhas } }`, `type CommissionBackup`, `planCommissionBackfill(now?)`, `applyCommissionBackfill(plan, writeBackup)`, `restoreCommissionBackfill(backup)`, `commissionByProfessional(month: string)`
  - CLI: `npx tsx scripts/comissao-avec.ts --dry-run | --aplicar [--backup arq.json] | --desfazer arq.json`

- [ ] **Passo 1: Escrever os testes que falham**

Em `src/server/domain/avec/normalize.test.ts`, acrescentar `pctOrNull` ao import e:

```ts
describe("pctOrNull", () => {
  it("lê a % da comissão do Avec; fora de 0 a 100 ou texto, nada", () => {
    expect(pctOrNull("40")).toBe(40);
    expect(pctOrNull("40,5")).toBe(40.5);
    expect(pctOrNull(" 35 % ")).toBe(35);
    expect(pctOrNull("0")).toBe(0);
    expect(pctOrNull("101")).toBeNull();
    expect(pctOrNull("abc")).toBeNull();
    expect(pctOrNull("")).toBeNull();
  });
});
```

Em `src/server/domain/avec/apply.test.ts`, dentro do `describe` dos itens de comanda (perto da linha 171, onde já se usa `H.itens` com comissão 40 e 60):

```ts
  it("itens de comanda trazem a comissão do Avec (% e valor); importar de novo completa a linha antiga sem comissão", async () => {
    const linha = ["01/10/2026", 1001, "Corte Feminino", "Serviço", "Cabelo", "MAIARA DA SILVA TESTE", "", "", 40, "Ana Teste", "", "", 71988880001, 150, 0, 1, 0, 60, 90, ""];
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, linha]));
    const [a] = await db.select().from(salesItems);
    expect([a.commissionPct, a.commissionCents]).toEqual([40, 6000]);
    await db.update(salesItems).set({ commissionPct: null, commissionCents: null }); // como as linhas importadas antes do Lote 3
    await applyAvecFile(await sheet("itens.xlsx", [H.itens, linha]));
    const all = await db.select().from(salesItems);
    expect(all).toHaveLength(1);
    expect([all[0].commissionPct, all[0].commissionCents]).toEqual([40, 6000]);
  });
```

Criar `src/server/domain/avec/commission-backfill.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { db } from "../../db";
import { avecReports, salesItems } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { item } from "../../../../test/salon-fixtures";
import { applyCommissionBackfill, planCommissionBackfill, restoreCommissionBackfill, rowCommission, type CommissionBackup } from "./commission-backfill";

const ITENS = ["Data", "Comanda", "Item", "Tipo", "Categoria", "Profissional", "Assistente 1", "Assistente 2", "Comissão (%)", "Cliente", "Valor", "Desconto", "Qtd.", "Custo", "Comissão", "Líquido", "UA"];
const POR_ITEM = ["Data Comanda", "N° da Comanda", "Serviço ou Produto", "Cliente", "Valor Cobrado", "Comissão (%)", "Total"];
const NOW = new Date("2026-10-15T15:00:00Z");
let seq = 0;
const guardar = (title: string, columns: string[], rows: string[][]) =>
  db.insert(avecReports).values({ signature: `teste${++seq}`, title, fileName: `${title}.xlsx`, fileHash: `h${seq}`, columns, rows, rowCount: rows.length });

beforeEach(resetDb);

it("'Comissão por item': o Total só vale como comissão quando bate com valor × %", () => {
  expect(rowCommission(POR_ITEM, ["01/09/2026", "7", "Corte", "Ana Teste", "150,00", "40", "60,00"])).toEqual({ pct: 40, cents: 6000 });
  expect(rowCommission(POR_ITEM, ["01/09/2026", "7", "Corte", "Ana Teste", "150,00", "40", "150,00"])).toEqual({ pct: 40, cents: null });
});

it("preenche pelos relatórios guardados: 'Itens de comanda' primeiro; o que já tinha comissão não muda; o segundo ensaio vem vazio; desfazer volta", async () => {
  await item({ day: "2026-09-02", comanda: "7", item: "Corte Feminino", value: 15000, proName: "MAIARA TESTE" });
  await item({ day: "2026-09-02", comanda: "8", item: "Escova", value: 8000, proName: "JO TESTE" });
  await item({ day: "2026-09-03", comanda: "9", item: "Mega Hair", value: 380000, proName: "MAIARA TESTE", commissionPct: 30, commissionCents: 114000 });
  await guardar("Itens de comanda", ITENS, [
    ["02/09/2026", "7", "Corte Feminino", "Serviço", "Cabelo", "MAIARA TESTE", "", "", "40", "Ana Teste", "150,00", "0", "1", "0", "60,00", "90,00", ""],
    ["03/09/2026", "9", "Mega Hair", "Serviço", "Cabelo", "MAIARA TESTE", "", "", "35", "Bia Teste", "3.800,00", "0", "1", "0", "1.330,00", "", ""],
  ]);
  await guardar("Comissão por item", POR_ITEM, [
    ["02/09/2026", "7", "Corte Feminino", "Ana Teste", "150,00", "10", "15,00"], // o "Itens de comanda" já decidiu este item
    ["02/09/2026", "8", "Escova", "Caio Teste", "80,00", "50", "40,00"],
    ["05/09/2026", "99", "Item que não existe", "Caio Teste", "10,00", "50", "5,00"],
  ]);
  const plan = await planCommissionBackfill(NOW);
  expect(plan.updates.map((u) => [u.professional, u.commissionPct, u.commissionCents]).sort()).toEqual([["JO TESTE", 50, 4000], ["MAIARA TESTE", 40, 6000]]);
  expect(plan).toMatchObject({ semPar: 1, ambiguas: 0, jaTinham: 1 });
  expect(plan.conferencia.mes).toBe("2026-09");

  let backup: CommissionBackup | null = null;
  expect(await applyCommissionBackfill(plan, async (b) => { backup = b; })).toEqual({ updated: 2 });
  expect(backup!.itens).toHaveLength(2);
  expect((await planCommissionBackfill(NOW)).updates).toEqual([]);
  const mega = (await db.select().from(salesItems)).find((i) => i.item === "Mega Hair")!;
  expect([mega.commissionPct, mega.commissionCents]).toEqual([30, 114000]);

  expect(await restoreCommissionBackfill(backup!)).toBe(2);
  expect((await db.select().from(salesItems)).filter((i) => i.commissionCents != null)).toHaveLength(1);
});

it("mesmo item duas vezes na comanda, comissões diferentes e nada para separar: fica de fora (ambíguo), nunca o valor errado", async () => {
  await item({ day: "2026-09-02", comanda: "7", item: "Escova", value: 8000 });
  await item({ day: "2026-09-02", comanda: "7", item: "Escova", value: 8000 });
  await guardar("Comissão por item", POR_ITEM, [
    ["02/09/2026", "7", "Escova", "Ana Teste", "80,00", "40", "32,00"],
    ["02/09/2026", "7", "Escova", "Ana Teste", "80,00", "50", "40,00"],
  ]);
  const plan = await planCommissionBackfill(NOW);
  expect(plan.updates).toEqual([]);
  expect(plan.ambiguas).toBe(2);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/avec/normalize.test.ts src/server/domain/avec/apply.test.ts src/server/domain/avec/commission-backfill.test.ts`
Esperado: FAIL ("pctOrNull is not a function", comissão `null`, "Failed to resolve import ./commission-backfill").

- [ ] **Passo 3: `pctOrNull` e a importação**

Em `src/server/domain/avec/normalize.ts`, depois de `moneyCents`:

```ts
/** Porcentagem ("40", "40,5", "35 %") com 2 casas; fora de 0 a 100 ou texto: null. */
export function pctOrNull(v: string | null | undefined): number | null {
  const s = String(v ?? "").replace(/%|\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n >= 0 && n <= 100 ? n : null;
}
```

Em `src/server/domain/avec/import-sales.ts`:
- acrescentar `pctOrNull` ao import de `./normalize`;
- em `importSalesItems`, no objeto `ix`, acrescentar `commissionPct: ctx.col("comissao (%)"), commission: ctx.col("comissao"),`;
- dentro do `for`, antes do `out.push`:

```ts
    // Comissão do item ("Comissão (%)" e "Comissão" do relatório "Itens de comanda"): só o que veio; nunca calculada aqui.
    const commissionPct = pctOrNull(ctx.cell(row, ix.commissionPct));
    const commissionCents = ix.commission >= 0 ? moneyCents(ctx.cell(row, ix.commission)) : null;
```

- no `out.push({ ... })`, acrescentar `commissionPct, commissionCents,` depois de `origin: "avec",`;
- no `fillEmpty(old, inc, [...])` do `upsertKeyed`, acrescentar `"commissionPct", "commissionCents"` à lista.

- [ ] **Passo 4: O acerto pelos relatórios guardados**

Criar `src/server/domain/avec/commission-backfill.ts`:

```ts
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { avecReports, salesItems } from "../../db/schema";
import { todayBahia } from "../../../lib/salon-period";
import { COLS, colOf } from "./formats";
import { comandaOf, dateIso, moneyCents, normText, pctOrNull } from "./normalize";

/**
 * Comissão histórica dos itens de comanda (Lote 3), lida dos relatórios do Avec JÁ GUARDADOS (`avec_reports`, saneados): "Itens de comanda"
 * (Comissão (%) e Comissão) e "Comissão por item" (Comissão (%) e Total). Só preenche item sem comissão; nunca troca valor que já existe;
 * item que não dá para saber com certeza qual é (mesmo item duas vezes na comanda, comissões diferentes) fica de fora.
 */

type Ix = { day: number; comanda: number; item: number; value: number; pct: number; cents: number; total: number; pro: number };
const indexes = (c: string[]): Ix => ({
  day: colOf(c, ...COLS.itemDate), comanda: colOf(c, ...COLS.comanda), item: colOf(c, ...COLS.item), value: colOf(c, "valor", "valor cobrado", "valor r$"),
  pct: colOf(c, "comissao (%)"), cents: colOf(c, "comissao"), total: colOf(c, "total"), pro: colOf(c, ...COLS.professional),
});
const cellOf = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
const keyOf = (day: string, comanda: string | null, item: string, value: number | null) => `${day}|${comanda ?? ""}|${normText(item)}|${value ?? ""}`;

/** Relatório com comissão por item: data, comanda, item, valor e a % ou o valor da comissão. */
export const hasItemCommission = (c: string[]) => { const ix = indexes(c); return ix.day >= 0 && ix.comanda >= 0 && ix.item >= 0 && ix.value >= 0 && (ix.pct >= 0 || ix.cents >= 0); };

/** A comissão da linha: a coluna "Comissão"; sem ela ("Comissão por item"), o "Total" só quando bate com valor × % (até 1 centavo). */
export function rowCommission(columns: string[], row: string[]): { pct: number | null; cents: number | null } {
  const ix = indexes(columns);
  const pct = pctOrNull(cellOf(row, ix.pct));
  if (ix.cents >= 0) return { pct, cents: moneyCents(cellOf(row, ix.cents)) };
  const total = moneyCents(cellOf(row, ix.total)), value = moneyCents(cellOf(row, ix.value));
  const fits = total != null && value != null && pct != null && Math.abs(total - Math.round((value * pct) / 100)) <= 1;
  return { pct, cents: fits ? total : null };
}

export type CommissionUpdate = {
  id: string; professional: string; soldOn: string; commissionPct: number | null; commissionCents: number | null;
  before: { commissionPct: number | null; commissionCents: number | null };
};
export type CommissionPlan = {
  relatorios: { id: string; title: string; linhas: number }[];
  updates: CommissionUpdate[];
  /** Linhas com comissão que não acharam o item (item escrito de outro jeito, ou não importado). */ semPar: number;
  /** Linhas iguais com comissões diferentes e nada para separar: ficam de fora. */ ambiguas: number;
  /** Itens que já tinham comissão: não mudam. */ jaTinham: number;
  /** Para conferir 2 profissionais à mão com o Avec: o que entra no último mês fechado, por profissional. */
  conferencia: { mes: string; linhas: { profissional: string; itens: number; comissaoCents: number }[] };
};
export type CommissionBackup = { criadoEm: string; itens: { id: string; commissionPct: number | null; commissionCents: number | null }[] };

const lastMonth = (now: Date) => {
  const t = todayBahia(now), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export async function planCommissionBackfill(now = new Date()): Promise<CommissionPlan> {
  // Primeiro só os cabeçalhos (são 200+ relatórios guardados); as linhas, só dos que trazem comissão por item.
  const heads = (await db.select({ id: avecReports.id, title: avecReports.title, columns: avecReports.columns, importedAt: avecReports.importedAt }).from(avecReports))
    .filter((r) => hasItemCommission(r.columns))
    // Quem traz o valor da comissão ("Itens de comanda") decide primeiro; no mesmo tipo, o envio mais novo.
    .sort((a, b) => Number(indexes(b.columns).cents >= 0) - Number(indexes(a.columns).cents >= 0) || b.importedAt.getTime() - a.importedAt.getTime());
  const reports: (typeof heads[number] & { rows: string[][] })[] = [];
  for (const h of heads) reports.push({ ...h, rows: (await db.select({ rows: avecReports.rows }).from(avecReports).where(eq(avecReports.id, h.id)))[0]?.rows ?? [] });
  const mes = lastMonth(now);
  const relatorios = reports.map((r) => ({ id: r.id, title: r.title, linhas: r.rows.length }));
  const empty: CommissionPlan = { relatorios, updates: [], semPar: 0, ambiguas: 0, jaTinham: 0, conferencia: { mes, linhas: [] } };
  const days = reports.flatMap((r) => r.rows.map((row) => dateIso(cellOf(row, indexes(r.columns).day)))).filter((d): d is string => !!d).sort();
  if (!days.length) return empty;

  const items = await db.select({
    id: salesItems.id, soldOn: salesItems.soldOn, comanda: salesItems.comanda, item: salesItems.item, valueCents: salesItems.valueCents, totalCents: salesItems.totalCents,
    professionalName: salesItems.professionalName, commissionPct: salesItems.commissionPct, commissionCents: salesItems.commissionCents,
  }).from(salesItems).where(and(gte(salesItems.soldOn, days[0]), lte(salesItems.soldOn, days[days.length - 1]))).orderBy(asc(salesItems.id));
  const byKey = new Map<string, typeof items>();
  for (const it of items) { const k = keyOf(it.soldOn, it.comanda, it.item, it.valueCents ?? it.totalCents); byKey.set(k, [...(byKey.get(k) ?? []), it]); }

  type Line = { pro: string; pct: number | null; cents: number | null };
  const decided = new Map<string, Line>();
  let semPar = 0, ambiguas = 0;
  for (const r of reports) {
    const ix = indexes(r.columns);
    const groups = new Map<string, Line[]>();
    for (const row of r.rows) {
      const day = dateIso(cellOf(row, ix.day)), item = cellOf(row, ix.item);
      if (!day || !item) continue;
      const c = rowCommission(r.columns, row);
      if (c.pct == null && c.cents == null) continue;
      const k = keyOf(day, comandaOf(cellOf(row, ix.comanda)), item, moneyCents(cellOf(row, ix.value)));
      groups.set(k, [...(groups.get(k) ?? []), { pro: normText(cellOf(row, ix.pro)), ...c }]);
    }
    for (const [k, lines] of groups) {
      const all = byKey.get(k) ?? [];
      if (!all.length) { semPar += lines.length; continue; }
      const left = all.filter((it) => !decided.has(it.id));
      if (!left.length) continue; // outro relatório já decidiu estes itens
      const rest: Line[] = [];
      for (const l of lines) {
        const i = l.pro ? left.findIndex((it) => normText(it.professionalName) === l.pro) : -1;
        if (i >= 0) decided.set(left.splice(i, 1)[0].id, l); else rest.push(l);
      }
      if (!rest.length || !left.length) continue;
      const same = rest.every((l) => l.pct === rest[0].pct && l.cents === rest[0].cents);
      if (same && left.length === rest.length) for (const it of left) decided.set(it.id, rest[0]);
      else ambiguas += rest.length;
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const updates: CommissionUpdate[] = [];
  let jaTinham = 0;
  for (const [id, l] of decided) {
    const it = byId.get(id)!;
    if (it.commissionPct != null || it.commissionCents != null) { jaTinham++; continue; }
    updates.push({ id, professional: it.professionalName ?? "Sem profissional", soldOn: it.soldOn, commissionPct: l.pct, commissionCents: l.cents, before: { commissionPct: null, commissionCents: null } });
  }
  const byPro = new Map<string, { itens: number; comissaoCents: number }>();
  for (const u of updates.filter((x) => x.soldOn.startsWith(mes) && x.commissionCents != null)) {
    const cur = byPro.get(u.professional) ?? { itens: 0, comissaoCents: 0 };
    byPro.set(u.professional, { itens: cur.itens + 1, comissaoCents: cur.comissaoCents + u.commissionCents! });
  }
  return {
    relatorios, updates, semPar, ambiguas, jaTinham,
    conferencia: { mes, linhas: [...byPro].map(([profissional, v]) => ({ profissional, ...v })).sort((a, b) => b.comissaoCents - a.comissaoCents) },
  };
}

/** Grava (backup antes, numa transação). Só preenche o que ainda está vazio: se alguém importou de novo no meio, o que chegou fica. */
export async function applyCommissionBackfill(plan: CommissionPlan, writeBackup: (b: CommissionBackup) => Promise<void>): Promise<{ updated: number }> {
  if (!plan.updates.length) return { updated: 0 };
  await writeBackup({ criadoEm: new Date().toISOString(), itens: plan.updates.map((u) => ({ id: u.id, ...u.before })) });
  return db.transaction(async (tx) => {
    let updated = 0;
    for (let i = 0; i < plan.updates.length; i += 500) {
      const values = sql.join(plan.updates.slice(i, i + 500).map((u) => sql`(${u.id}::uuid, ${u.commissionPct}::numeric, ${u.commissionCents}::int)`), sql`, `);
      const r = await tx.execute(sql`update sales_items si set commission_pct = v.pct, commission_cents = v.cents
        from (values ${values}) as v(id, pct, cents) where si.id = v.id and si.commission_pct is null and si.commission_cents is null`);
      updated += r.rowCount ?? 0;
    }
    return { updated };
  });
}

/** Volta os itens ao que estava no backup. */
export async function restoreCommissionBackfill(b: CommissionBackup): Promise<number> {
  return db.transaction(async (tx) => {
    let n = 0;
    for (let i = 0; i < b.itens.length; i += 500) {
      const values = sql.join(b.itens.slice(i, i + 500).map((x) => sql`(${x.id}::uuid, ${x.commissionPct}::numeric, ${x.commissionCents}::int)`), sql`, `);
      const r = await tx.execute(sql`update sales_items si set commission_pct = v.pct, commission_cents = v.cents from (values ${values}) as v(id, pct, cents) where si.id = v.id`);
      n += r.rowCount ?? 0;
    }
    return n;
  });
}

/** Conferência depois de aplicar: comissão por profissional no mês (para bater 2 profissionais com o relatório do Avec). */
export async function commissionByProfessional(month: string): Promise<{ profissional: string; itens: number; comissaoCents: number }[]> {
  const r = await db.execute(sql`
    select coalesce(p.name, nullif(trim(si.professional_name), ''), 'Sem profissional') as profissional, count(*)::int as itens,
      coalesce(sum(si.commission_cents), 0)::float8 as "comissaoCents"
    from sales_items si left join professionals p on p.id = si.professional_id
    where to_char(si.sold_on, 'YYYY-MM') = ${month} and si.commission_cents is not null group by 1 order by 3 desc`);
  return (r.rows as { profissional: string; itens: number; comissaoCents: number }[]).map((x) => ({ ...x, comissaoCents: Number(x.comissaoCents) }));
}
```

Criar `scripts/comissao-avec.ts`:

```ts
// scripts/comissao-avec.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyCommissionBackfill, commissionByProfessional, planCommissionBackfill, restoreCommissionBackfill, type CommissionBackup, type CommissionPlan } from "../src/server/domain/avec/commission-backfill";

// Lote 3: comissão histórica dos itens de comanda, lida dos relatórios do Avec já guardados ("Itens de comanda", "Comissão por item").
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/comissao-avec.ts <modo>
//   --dry-run                    ensaio: o que entra, o que fica de fora e a conferência por profissional; não grava nada
//   --aplicar [--backup arq]     grava o backup JSON, aplica numa transação e confere (um segundo ensaio tem de vir vazio)
//   --desfazer arq.json          volta os itens ao que estava no backup
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function report(plan: CommissionPlan) {
  console.log(`Relatórios usados: ${plan.relatorios.map((r) => `${r.title} (${r.linhas} linhas)`).join(", ") || "nenhum"}`);
  console.log(`Itens que ganham comissão: ${plan.updates.length}`);
  console.log(`Já tinham comissão (não mudam): ${plan.jaTinham}`);
  console.log(`Linhas sem o item no CRM: ${plan.semPar} · ambíguas (ficam de fora): ${plan.ambiguas}`);
  console.log(`\nConferência de ${plan.conferencia.mes} (o que ENTRA agora, por profissional; compare 2 delas com o "Comissão por profissional" do Avec do mesmo mês):`);
  for (const l of plan.conferencia.linhas) console.log(`  ${l.profissional.padEnd(28)} ${String(l.itens).padStart(5)} itens  ${brl(l.comissaoCents)}`);
}

async function main() {
  if (flag("--desfazer")) {
    const file = value("--desfazer");
    if (!file) throw new Error("Informe o arquivo de backup: --desfazer <arquivo.json>");
    const b = JSON.parse(await readFile(file, "utf8")) as CommissionBackup;
    console.log(`Desfeito: ${await restoreCommissionBackfill(b)} itens voltaram ao backup de ${b.criadoEm}.`);
    return;
  }
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const plan = await planCommissionBackfill();
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = value("--backup") ?? path.join(os.homedir(), "backups", `comissao-avec-${stamp}-antes.json`);
  if (existsSync(file)) throw new Error(`O backup ${file} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(file), { recursive: true });
  const res = await applyCommissionBackfill(plan, (b) => writeFile(file, JSON.stringify(b, null, 1), { flag: "wx" }));
  console.log(`\nBackup: ${file}`);
  console.log(`Aplicado: ${res.updated} itens.`);
  const check = await planCommissionBackfill();
  console.log(check.updates.length ? `Ainda há ${check.updates.length} pendências. Rode --dry-run de novo.` : "Conferência: nada pendente.");
  if (check.updates.length) process.exitCode = 1;
  console.log(`\nComo ficou ${plan.conferencia.mes} (tudo o que tem comissão no CRM):`);
  for (const l of await commissionByProfessional(plan.conferencia.mes)) console.log(`  ${l.profissional.padEnd(28)} ${String(l.itens).padStart(5)} itens  ${brl(l.comissaoCents)}`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/avec && npm run typecheck && npm run lint`
Esperado: PASS (os casos antigos de `apply.test.ts` continuam verdes: comissão é coluna nova, só completada).

- [ ] **Passo 6: Commit**

```bash
git add src/server/domain/avec/normalize.ts src/server/domain/avec/normalize.test.ts src/server/domain/avec/import-sales.ts src/server/domain/avec/apply.test.ts \
  src/server/domain/avec/commission-backfill.ts src/server/domain/avec/commission-backfill.test.ts scripts/comissao-avec.ts
git commit -m "feat(avec): comissão do item (Comissão (%) e Comissão) na importação e acerto do histórico pelos relatórios guardados, com ensaio e backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.9: Relatórios do Avec organizados (principais em cartões, assuntos recolhíveis, "Virou dado no CRM", vazios no fim, repetidos juntos)

**Arquivos:**
- Criar: `src/lib/avec-catalog.ts`, `src/components/relatorios-avec/catalog.tsx`
- Modificar: `src/app/(app)/relatorios/avec/page.tsx`
- Testes: `src/lib/avec-catalog.test.ts`, `src/components/relatorios-avec/catalog.test.tsx`

**Interfaces:**
- Consome: `listAvecReports()` (`src/server/queries/avec.ts`, devolve `AvecReportSummary[]`); `periodLabel` (`src/components/relatorios-avec/format.ts`).
- Produz:
  - `type AvecReportLite = { id; title; rowCount; dateFrom; dateTo; importedAt: string; applied: Record<string, number> }`
  - `type AvecType<T>`, `type SectionKey`, `type AvecCatalog<T>`, `PRINCIPAIS` (os 11), `SECTION_ORDER`, `SECTION_LABEL`, `sectionOf(title): SectionKey`, `organizeAvecReports<T extends AvecReportLite>(list: T[]): AvecCatalog<T>`
  - `AvecCatalogView({ catalog })`

- [ ] **Passo 1: Escrever os testes que falham**

Criar `src/lib/avec-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PRINCIPAIS, organizeAvecReports, sectionOf, type AvecReportLite } from "./avec-catalog";

let seq = 0;
const r = (title: string, o: Partial<AvecReportLite> = {}): AvecReportLite => ({
  id: `r${++seq}`, title, rowCount: 10, dateFrom: "2026-01-01", dateTo: "2026-10-14", importedAt: "2026-10-14T12:00:00Z", applied: {}, ...o,
});

describe("Relatórios do Avec organizados", () => {
  it("os 11 principais viram cartões na ordem, mesmo os que ainda não vieram, e não se repetem nas seções", () => {
    const c = organizeAvecReports([r("Reservas", { applied: { agendamentos: 120 } }), r("Itens de comanda")]);
    expect(c.principais.map((p) => p.title)).toEqual([...PRINCIPAIS]);
    expect(c.principais.find((p) => p.title === "Reservas")!.type).toMatchObject({ applied: true });
    expect(c.principais.find((p) => p.title === "Aniversariantes")!.type).toBeNull();
    expect(c.secoes.flatMap((s) => s.types.map((t) => t.title))).toEqual(["Itens de comanda"]);
  });

  it("seções por assunto, na ordem combinada", () => {
    expect(sectionOf("Bloqueios de agenda")).toBe("agenda");
    expect(sectionOf("Itens de comanda")).toBe("vendas");
    expect(sectionOf("Comissão por item")).toBe("profissionais");
    expect(sectionOf("Taxas de cartão")).toBe("financeiro");
    expect(sectionOf("Clientes por bairro")).toBe("clientes");
    expect(sectionOf("Estoque de produtos")).toBe("produtos");
    expect(sectionOf("Notas fiscais (NFC-e)")).toBe("notas");
    expect(sectionOf("Uso de pacotes")).toBe("pacotes");
    expect(sectionOf("Relatório: A, B, C")).toBe("outros");
    const c = organizeAvecReports([r("Taxas de cartão"), r("Bloqueios de agenda"), r("Itens de comanda")]);
    expect(c.secoes.map((s) => s.key)).toEqual(["agenda", "vendas", "financeiro"]);
  });

  it("vazios no fim; repetidos (mesmas linhas e mesmo período, no mesmo assunto) juntados no primeiro", () => {
    const c = organizeAvecReports([
      r("Lucratividade por produto", { rowCount: 504 }), r("Lucro por produto", { rowCount: 504, applied: { itensVenda: 1 } }), r("Produtos (códigos)", { rowCount: 30 }),
      r("Cheques", { rowCount: 0 }),
    ]);
    const produtos = c.secoes.find((s) => s.key === "produtos")!;
    expect(produtos.types.map((t) => [t.title, t.also.map((a) => a.title), t.applied])).toEqual([
      ["Lucratividade por produto", ["Lucro por produto"], true], ["Produtos (códigos)", [], false],
    ]);
    expect(c.vazios.map((t) => t.title)).toEqual(["Cheques"]);
  });

  it("o último envio do tipo é o de período mais novo (empate: o enviado por último)", () => {
    const old = r("Reservas", { dateTo: "2026-09-30" }), novo = r("Reservas", { dateTo: "2026-10-14" });
    expect(organizeAvecReports([old, novo]).principais.find((p) => p.title === "Reservas")!.type!.latest.id).toBe(novo.id);
  });
});
```

Criar `src/components/relatorios-avec/catalog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { organizeAvecReports } from "@/lib/avec-catalog";
import { AvecCatalogView } from "./catalog";

afterEach(cleanup);

it("cartões dos principais, selo 'Virou dado no CRM', assunto recolhido e 'Vazios (N)' no fim", () => {
  const base = { rowCount: 10, dateFrom: "2026-01-01", dateTo: "2026-10-14", importedAt: "2026-10-14T12:00:00Z", fileName: "x.xlsx", importedByName: null };
  const catalog = organizeAvecReports([
    { ...base, id: "a", title: "Reservas", applied: { agendamentos: 5 } },
    { ...base, id: "b", title: "Bloqueios de agenda", applied: {} },
    { ...base, id: "c", title: "Cheques", rowCount: 0, applied: {} },
  ]);
  const { container } = render(<AvecCatalogView catalog={catalog} />);
  expect(container.querySelectorAll("[data-card]")).toHaveLength(11);
  expect(screen.getAllByText("Virou dado no CRM").length).toBeGreaterThan(0);
  expect(container.querySelector('a[href="/relatorios/avec/a"]')).toBeTruthy();
  const agenda = screen.getByText("Agenda").closest("details")!;
  expect(agenda.hasAttribute("open")).toBe(false);
  expect(screen.getByText("Vazios (1)")).toBeTruthy();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/avec-catalog.test.ts src/components/relatorios-avec/catalog.test.tsx`
Esperado: FAIL ("Failed to resolve import").

- [ ] **Passo 3: Implementar a regra**

Criar `src/lib/avec-catalog.ts`:

```ts
/**
 * Relatórios do Avec organizados (Lote 3): os 11 principais em cartões no topo, os outros por assunto (seções recolhíveis), o selo
 * "Virou dado no CRM" (o relatório alimentou agenda, contatos ou vendas: `applied`), os vazios num grupo no fim e os tipos repetidos
 * (mesmas linhas e mesmo período, no mesmo assunto) juntados. Puro: só reorganiza a lista que `listAvecReports` já devolve.
 */
export type AvecReportLite = { id: string; title: string; rowCount: number; dateFrom: string | null; dateTo: string | null; importedAt: string; applied: Record<string, number> };
export type AvecType<T extends AvecReportLite = AvecReportLite> = {
  title: string; latest: T; items: T[]; applied: boolean; empty: boolean;
  /** Outros tipos com as mesmas linhas e o mesmo período (provável repetição do Avec). */ also: { title: string; id: string }[];
};
export type SectionKey = "agenda" | "vendas" | "profissionais" | "financeiro" | "clientes" | "produtos" | "notas" | "pacotes" | "outros";
export type AvecCatalog<T extends AvecReportLite = AvecReportLite> = {
  principais: { title: string; type: AvecType<T> | null }[];
  secoes: { key: SectionKey; label: string; types: AvecType<T>[] }[];
  vazios: AvecType<T>[];
};

export const PRINCIPAIS = [
  "Faturamento por dia", "Comissão por profissional", "Faturamento por serviço", "Recebimentos por forma de pagamento", "Reservas", "Cancelamentos",
  "Lista de espera", "Clientes sumidas", "Retorno sugerido", "Aniversariantes", "Pacotes das clientes",
] as const;
export const SECTION_ORDER: SectionKey[] = ["agenda", "vendas", "profissionais", "financeiro", "clientes", "produtos", "notas", "pacotes", "outros"];
export const SECTION_LABEL: Record<SectionKey, string> = {
  agenda: "Agenda", vendas: "Vendas e comandas", profissionais: "Profissionais e comissões", financeiro: "Financeiro e caixa", clientes: "Clientes",
  produtos: "Produtos e estoque", notas: "Notas fiscais", pacotes: "Pacotes e fidelidade", outros: "Outros",
};
/** A primeira regra que casa decide (a ordem importa: "Faturamento por profissional" é de Profissionais, não de Vendas). */
const RULES: [SectionKey, RegExp][] = [
  ["agenda", /reserva|cancelamento|lista de espera|bloqueio|agenda|agendamento|ocupa[cç][aã]o/i],
  ["pacotes", /pacote|fidelidade|vale|cupo|promo[cç]/i],
  ["profissionais", /comiss|profissiona|repasse|recibo|caixinha|assistente|cargo/i],
  ["notas", /nota|nfc|nfs|fiscal/i],
  ["produtos", /produto|estoque|invent[aá]rio|marca|reposi[cç][aã]o|pedidos de compra/i],
  ["financeiro", /pagamento|recebimento|taxa|despesa|contas a pagar|caixa|lan[cç]amento|cr[eé]dito|d[ií]vida|cheque|bandeira|split|movimenta/i],
  ["clientes", /^clientes?\b|aniversari|conheceu|etiqueta|avalia|g[eê]nero|bairro|retorno sugerido|sumidas|visitas por|campos extras das clientes/i],
  ["vendas", /comanda|iten|venda|faturamento|servi[cç]o|lucr|margem|custo|categoria|ticket|totais|tipos de/i],
];
export const sectionOf = (title: string): SectionKey => RULES.find(([, re]) => re.test(title))?.[0] ?? "outros";

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "pt-BR");

/** Junta os tipos com as mesmas linhas e o mesmo período (o primeiro pelo nome fica; os outros vão em `also`). */
function mergeRepeated<T extends AvecReportLite>(types: AvecType<T>[]): AvecType<T>[] {
  const out: AvecType<T>[] = [];
  for (const t of [...types].sort(byTitle)) {
    const twin = out.find((o) => o.latest.rowCount > 0 && o.latest.rowCount === t.latest.rowCount && o.latest.dateFrom === t.latest.dateFrom && o.latest.dateTo === t.latest.dateTo);
    if (twin) { twin.also.push({ title: t.title, id: t.latest.id }); twin.applied ||= t.applied; } else out.push({ ...t, also: [] });
  }
  return out;
}

export function organizeAvecReports<T extends AvecReportLite>(list: T[]): AvecCatalog<T> {
  const by = new Map<string, T[]>();
  for (const r of list) by.set(r.title, [...(by.get(r.title) ?? []), r]);
  const types: AvecType<T>[] = [...by.entries()].map(([title, items]) => {
    const sorted = [...items].sort((a, b) => (b.dateTo ?? "").localeCompare(a.dateTo ?? "") || b.importedAt.localeCompare(a.importedAt));
    return {
      title, latest: sorted[0], items: sorted, also: [],
      applied: items.some((i) => Object.values(i.applied ?? {}).some((n) => n > 0)), empty: items.every((i) => i.rowCount === 0),
    };
  });
  const principal = new Set<string>(PRINCIPAIS);
  const rest = types.filter((t) => !principal.has(t.title));
  return {
    principais: PRINCIPAIS.map((title) => ({ title, type: types.find((t) => t.title === title) ?? null })),
    secoes: SECTION_ORDER.map((key) => ({ key, label: SECTION_LABEL[key], types: mergeRepeated(rest.filter((t) => !t.empty && sectionOf(t.title) === key)) }))
      .filter((s) => s.types.length > 0),
    vazios: rest.filter((t) => t.empty).sort(byTitle),
  };
}
```

- [ ] **Passo 4: A tela**

Criar `src/components/relatorios-avec/catalog.tsx`:

```tsx
import Link from "next/link";
import type { AvecCatalog, AvecReportLite, AvecType } from "@/lib/avec-catalog";
import { Badge } from "@/components/ui/badge";
import { IconArrowRight } from "@/components/icons";
import { periodLabel } from "./format";

type Report = AvecReportLite & { fileName: string; importedByName: string | null };
const lines = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "linha" : "linhas"}`;
const Applied = () => <Badge tone="ok">Virou dado no CRM</Badge>;

/** Relatórios do Avec: cartões dos principais, assuntos recolhidos, vazios no fim. */
export function AvecCatalogView({ catalog }: { catalog: AvecCatalog<Report> }) {
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="avec-principais">
        <h2 id="avec-principais" className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Principais</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.principais.map(({ title, type }) => (
            <li key={title} data-card="">
              {type ? (
                <Link href={`/relatorios/avec/${type.latest.id}`} className="flex h-full min-h-24 flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-paper p-4 hover:bg-paper-2">
                  <span className="font-medium text-ink">{title}</span>
                  <span className="text-sm text-graphite tabular">{periodLabel(type.latest.dateFrom, type.latest.dateTo)} · {lines(type.latest.rowCount)}</span>
                  {type.applied && <span><Applied /></span>}
                </Link>
              ) : (
                <div className="flex h-full min-h-24 flex-col gap-1.5 rounded-[var(--radius-card)] border border-dashed border-line-strong p-4">
                  <span className="font-medium text-graphite">{title}</span>
                  <span className="text-sm text-muted">Ainda não enviado. Exporte do Avec e envie aqui.</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      {catalog.secoes.map((s) => (
        <details key={s.key} className="group rounded-[var(--radius-card)] border border-line bg-paper">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
            <span className="font-medium">{s.label}</span>
            <span className="text-sm text-muted">{s.types.length} {s.types.length === 1 ? "tipo" : "tipos"} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></span>
          </summary>
          <TypeList types={s.types} />
        </details>
      ))}
      {catalog.vazios.length > 0 && (
        <details className="group rounded-[var(--radius-card)] border border-line bg-paper-2/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-graphite [&::-webkit-details-marker]:hidden">
            <span>Vazios ({catalog.vazios.length})</span><span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <TypeList types={catalog.vazios} />
        </details>
      )}
    </div>
  );
}

function TypeList({ types }: { types: AvecType<Report>[] }) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {types.map((t) => (
        <li key={t.title} className="px-4 py-3">
          <Link href={`/relatorios/avec/${t.latest.id}`} className="flex min-h-11 items-center gap-4 hover:text-gold-ink">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.title}</span>{t.applied && <Applied />}</span>
              <span className="block truncate text-sm text-muted">{periodLabel(t.latest.dateFrom, t.latest.dateTo)} · {t.latest.fileName}</span>
            </span>
            <span className="shrink-0 text-sm text-graphite tabular">{lines(t.latest.rowCount)}</span>
            <IconArrowRight size={14} className="shrink-0 text-muted" />
          </Link>
          {t.also.length > 0 && <p className="text-[13px] text-muted">Mesmas linhas e período: {t.also.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`/relatorios/avec/${a.id}`} className="underline underline-offset-2">{a.title}</Link></span>)}</p>}
          {t.items.length > 1 && (
            <details className="mt-1 text-[13px]">
              <summary className="cursor-pointer text-gold-ink">Envios anteriores ({t.items.length - 1})</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {t.items.slice(1).map((r) => <li key={r.id}><Link href={`/relatorios/avec/${r.id}`} className="underline underline-offset-2">{periodLabel(r.dateFrom, r.dateTo)}</Link> · {lines(r.rowCount)}</li>)}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
```

Em `src/app/(app)/relatorios/avec/page.tsx`:
- trocar `import { groupReports, periodLabel } from "@/components/relatorios-avec/format";` por `import { organizeAvecReports } from "@/lib/avec-catalog";` e `import { AvecCatalogView } from "@/components/relatorios-avec/catalog";`;
- trocar `const groups = groupReports(reports);` por `const catalog = organizeAvecReports(reports);` e `const types = new Set(reports.map((r) => r.title)).size;`;
- no subtítulo, trocar `groups.length` por `types` (duas vezes);
- trocar o bloco `groups.length === 0 ? (...) : (<div className="flex flex-col gap-8">...</div>)` por `reports.length === 0 ? (...o mesmo vazio de hoje...) : <AvecCatalogView catalog={catalog} />`;
- tirar as constantes `TZ` e `sentAt` e o import de `IconArrowRight` se ficarem sem uso (o `npm run lint` acusa).

`groupReports` continua em `format.ts` (o teste dele segue valendo).

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/lib/avec-catalog.test.ts src/components/relatorios-avec && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/avec-catalog.ts src/lib/avec-catalog.test.ts src/components/relatorios-avec/catalog.tsx src/components/relatorios-avec/catalog.test.tsx "src/app/(app)/relatorios/avec/page.tsx"
git commit -m "feat(avec): Relatórios do Avec com os 11 principais em cartões, assuntos recolhíveis, selo Virou dado no CRM, vazios no fim e repetidos juntos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3.10 (herdada do 1C): cliente que volta depois de Fechado/Perdido começa em Em conversa; "respondidos" só com resposta

O plano do 1C deixou esta regra da spec (etapa 1 "Em conversa": "a cliente escreve estando em … 7") para o Lote 3, porque ela mexe no relatório "respondidos" (`src/server/reports/queries.ts:95`).

**Arquivos:**
- Modificar: `src/server/domain/deals.ts` (`recordInbound`, bloco `if (!deal) {`)
- Modificar: `src/server/reports/queries.ts` (`milestones`, linha do `respondidos`)
- Teste: `src/server/domain/returning-client.test.ts`

**Interfaces:**
- Consome: do 1C, `stageByKind(kind, tx)` (`src/server/domain/deals.ts`).
- Produz: lead criado por cliente que já teve conversa Fechada/Perdida nasce na etapa do tipo `atendimento` (Em conversa), com `lead_criado.payload.voltou = true`; "respondidos" deixa de contar quem só está em Em conversa sem resposta.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/domain/returning-client.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, stages } from "../db/schema";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { funnelMilestones } from "../reports/queries";
import { resetDb } from "../../../test/db";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // 13/10/2026, hora de Salvador
beforeEach(resetDb);

async function escreve(id: string, phone: string, at: Date) {
  const r = await recordInbound({ channelId: null, externalId: id, phoneRaw: phone, body: "oi", at });
  if (!("dealId" in r) || !("created" in r)) throw new Error("sem lead");
  return r;
}
const kindOf = async (dealId: string) =>
  (await db.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].kind;

it("cliente que volta depois de Fechado ou Perdido: a conversa nova começa em Em conversa (marcada 'voltou'); número novo segue em Novo contato", async () => {
  const a = await escreve("a1", "71990000101", T(9));
  await db.transaction((tx) => moveDealTx(tx, a.dealId, "fechado", null, "venda", T(9, 30)));
  const a2 = await escreve("a2", "71990000101", T(11));
  expect(a2.created).toBe(true);
  expect(await kindOf(a2.dealId)).toBe("atendimento");
  const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, a2.dealId), eq(dealEvents.type, "lead_criado")));
  expect(ev.payload).toMatchObject({ voltou: true, initialStage: "atendimento" });

  const b = await escreve("b1", "71990000102", T(9));
  await db.transaction((tx) => moveDealTx(tx, b.dealId, "perdido", null, "manual", T(9, 30)));
  expect(await kindOf((await escreve("b2", "71990000102", T(11))).dealId)).toBe("atendimento");

  expect(await kindOf((await escreve("c1", "71990000103", T(11))).dealId)).toBe("lead");
});

it("relatório: a conversa de quem voltou só conta como respondida depois que a Casa responde", async () => {
  const a = await escreve("a1", "71990000101", T(9));
  await db.transaction((tx) => moveDealTx(tx, a.dealId, "fechado", null, "venda", T(9, 30)));
  const a2 = await escreve("a2", "71990000101", T(11));
  const antes = await funnelMilestones({ period: "mes", now: T(12) });
  expect(antes).toMatchObject({ leads: 2, respondidos: 1 }); // o fechado conta; a conversa nova em Em conversa, sem resposta, não
  await recordOutbound({ dealId: a2.dealId, channelId: null, externalId: "o1", body: "Oi de novo!", fromPhone: true, at: T(11, 5) });
  expect(await funnelMilestones({ period: "mes", now: T(12) })).toMatchObject({ leads: 2, respondidos: 2 });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/returning-client.test.ts`
Esperado: FAIL (`expected 'lead' to be 'atendimento'`; `respondidos` 2 em vez de 1).

- [ ] **Passo 3: Implementar**

Em `src/server/domain/deals.ts`, em `recordInbound`, no bloco `if (!deal) {`, trocar a linha que busca a etapa de entrada (hoje `const lead = await stageByKey("lead", tx);`; depois do 1C pode ser `stageByKind("lead", tx)`; achar com `grep -n 'const lead = await stageBy' src/server/domain/deals.ts`, a PRIMEIRA ocorrência, dentro de `recordInbound`) por:

```ts
      // Cliente que volta depois de Fechado/Perdido (funil da decisão 3; regra que o 1C deixou para o Lote 3): começa em Em conversa.
      const [before] = await tx.select({ id: deals.id }).from(deals)
        .where(and(eq(deals.contactId, contact.id), isNotNull(deals.closedAt), isNull(deals.archivedAt))).limit(1);
      const lead = await stageByKind(before ? "atendimento" : "lead", tx);
```

e, no `logEvent(tx, deal.id, "lead_criado", { origin, initialStage: lead.key, historico: false })` logo abaixo, acrescentar a marca:

```ts
      await logEvent(tx, deal.id, "lead_criado", { origin, initialStage: lead.key, historico: false, ...(before ? { voltou: true } : {}) });
```

Em `src/server/reports/queries.ts`, na linha do `respondidos` em `milestones` (`grep -n "as respondidos" src/server/reports/queries.ts`), tirar `'atendimento'` da lista de etapas alcançadas (as outras ficam como estão, inclusive as que o 1C acrescentou):

```ts
      count(*) filter (where c.first_response_at is not null or exists (select 1 from reached r where r.id = c.id and r.kind in ('agendado', 'followup', 'proposta', 'atendido', 'retorno', 'fechado')))::int as respondidos,
```

e acrescentar acima de `milestones` o comentário: `// "Respondido" = a Casa respondeu (ou o lead já passou de Em conversa). Estar em Em conversa não basta: a cliente que volta nasce lá (Tarefa 3.10).`

No `src/lib/report-legend.ts`, no texto de `funil`, trocar "quantos foram respondidos" por "quantos a Casa respondeu".

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/returning-client.test.ts src/server/reports/reports.test.ts src/server/domain/deals.test.ts src/server/domain/distribution.test.ts && npm test && npm run typecheck`
Esperado: PASS. Se um teste antigo de `reports.test.ts` contava como "respondido" um lead movido à mão para Atendimento sem resposta, a expectativa muda para não contar (a regra nova é a da spec: respondido = a Casa respondeu).

- [ ] **Passo 5: Commit**

```bash
git add src/server/domain/deals.ts src/server/reports/queries.ts src/lib/report-legend.ts src/server/domain/returning-client.test.ts
git commit -m "feat(funil): cliente que volta depois de Fechado/Perdido começa em Em conversa; relatório só conta respondida com resposta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Parte 4: Configurações (Lote 4)

### Tarefa 4.1: `config.editar` vira `config.diaadia` (quem atende) e `config.sistema` (gestão), com a troca nos perfis guardados

**Arquivos:**
- Modificar: `src/lib/permissions.ts` (linhas 5-11 `PERMS`, 17-66 rótulos/grupos, 72 `EQUIPE`), `src/lib/permissions.test.ts`
- Criar: `src/lib/config-tabs.ts`, `src/lib/config-tabs.test.ts`
- Modificar: `src/server/db/seed.ts`, `src/server/auth/profiles-seed.test.ts`
- Modificar: `src/app/(app)/config/actions.ts` (`run`/`runSafe` e cada action), `src/app/(app)/config/actions.test.ts`, `src/app/(app)/config/listas/actions.ts`
- Modificar: `src/app/(app)/config/layout.tsx`, `page.tsx`, e as páginas `whatsapp`, `etapas`, `automacoes`, `mensagens` (sistema), `listas`, `profissionais`, `origens` (dia a dia), `distribuicao` (qualquer das duas)
- Modificar: `src/components/config/config-nav.tsx`, `src/components/config/distribution.tsx`
- Modificar: `src/components/shell/sidebar.tsx:40`, `src/components/shell/connection-banner.tsx:16`, `src/components/queue/use-lead-actions.tsx:180`, `src/app/(app)/atendimento/[id]/page.tsx:42`, `src/app/(app)/atendimento/[id]/cliente/page.tsx:31`, `src/app/(app)/contatos/page.tsx:41`, `src/app/(app)/contatos/actions.ts:24,38`, `src/app/(app)/quiet/actions.ts:15`, `src/app/dev/simulador/page.tsx:11`, `src/app/dev/simulador/actions.ts`
- Testes e2e: `e2e/config-lote4.spec.ts` (novo), `e2e/cliente.spec.ts` (a atendente passa a cadastrar serviço)

**Interfaces:**
- Consome: nada de tarefas anteriores.
- Produz:
  - `Perm` com `"config.diaadia"` e `"config.sistema"`; sai `"config.editar"`. `LEGACY_CONFIG_PERM = "config.editar"` (só o seed usa).
  - `canConfigure(perms): boolean` (dia a dia, sistema ou equipe)
  - `type ConfigTab = { href; label; need: "diaadia" | "sistema" | "equipe" | "qualquer" }`, `CONFIG_TABS`, `configTabs(perms): ConfigTab[]`, `firstConfigPath(perms): string`
  - `CONFIG_SPLIT_MARK = "migracao_permissoes_config"` (chave em `settings`) e a troca no `seed()`
  - `ConfigNav({ tabs: { href: string; label: string }[] })`
  - `DistributionEditor` ganha `canSystem: boolean` e `canLevels: boolean`
  - em `config/actions.ts`, `run(fn, path, perm)` e `runSafe(fn, path, fallback, perm)` com `perm` obrigatório; constantes `DIA`, `SIS`, `EQ`
- Divisão (spec, Lote 4): **dia a dia** = Etiquetas, Respostas prontas, Objeções e Motivos (mesma tela), Palavras-chave, Profissionais, Serviços, Origens e links, níveis da Distribuição. **Sistema** = WhatsApp, Horário e etapas, Automações, Mensagens automáticas, limites (envios/hora, guarda de mídias, limite da Distribuição), ligar/desligar a Distribuição, importar contatos, "Retomar avisos" e o simulador.

- [ ] **Passo 1: Escrever os testes que falham**

Em `src/lib/permissions.test.ts`:
- no teste "Atendente e Recepção fazem o mesmo atendimento…", trocar a lista `equipe` por:

```ts
    const equipe = ["atendimento.fechar", "atendimento.transferir", "atendimento.ver", "config.diaadia", "contatos.ver", "distribuicao.receber", "quadro.ver"];
```

- acrescentar `canConfigure` ao import e:

```ts
describe("configurações em duas (Lote 4)", () => {
  it("config.editar deixou de existir; a Gestão tem o dia a dia e o sistema; a Atendente, só o dia a dia", () => {
    expect(isPerm("config.editar")).toBe(false);
    expect(profile("gestao").permissions).toEqual(expect.arrayContaining(["config.diaadia", "config.sistema"]));
    expect(profile("atendente").permissions).toContain("config.diaadia");
    expect(profile("atendente").permissions).not.toContain("config.sistema");
  });
  it("entra em Configurações quem tem qualquer uma das três", () => {
    expect(canConfigure(["config.diaadia"])).toBe(true);
    expect(canConfigure(["config.sistema"])).toBe(true);
    expect(canConfigure(["equipe.gerir"])).toBe(true);
    expect(canConfigure(["atendimento.ver"])).toBe(false);
  });
});
```

Criar `src/lib/config-tabs.test.ts`:

```ts
import { expect, it } from "vitest";
import { configTabs, firstConfigPath } from "./config-tabs";

const hrefs = (perms: string[]) => configTabs(perms).map((t) => t.href);

it("dia a dia vê listas, profissionais, origens e distribuição; não vê WhatsApp, etapas, mensagens, automações nem equipe", () => {
  expect(hrefs(["config.diaadia"])).toEqual(["/config/listas", "/config/profissionais", "/config/origens", "/config/distribuicao"]);
});
it("sistema vê WhatsApp, etapas, mensagens, automações e distribuição; a gestão vê tudo", () => {
  expect(hrefs(["config.sistema"])).toEqual(["/config/distribuicao", "/config/whatsapp", "/config/etapas", "/config/mensagens", "/config/automacoes"]);
  expect(hrefs(["config.diaadia", "config.sistema", "equipe.gerir"])[0]).toBe("/config/equipe");
});
it("a página inicial de Configurações é a primeira aba que a pessoa pode abrir", () => {
  expect(firstConfigPath(["config.diaadia"])).toBe("/config/listas");
  expect(firstConfigPath(["equipe.gerir"])).toBe("/config/equipe");
  expect(firstConfigPath([])).toBe("/");
});
```

Em `src/server/auth/profiles-seed.test.ts`, acrescentar `settings` ao import do schema, `import { CONFIG_SPLIT_MARK } from "../db/seed";` e, dentro do `describe`:

```ts
  it("Lote 4: quem tinha config.editar fica com config.diaadia e config.sistema (o mesmo acesso), sem repetir", async () => {
    const [p] = await db.insert(profiles).values({ name: "Perfil antigo", permissions: ["atendimento.ver", "config.editar", "config.sistema"] }).returning();
    await seed(db);
    const [after] = await db.select().from(profiles).where(eq(profiles.id, p.id));
    expect([...after.permissions].sort()).toEqual(["atendimento.ver", "config.diaadia", "config.sistema"]);
  });

  it("Lote 4: Atendente e Recepção ganham o dia a dia uma vez só; se a gestão tirar, o próximo deploy não devolve", async () => {
    expect((await byKey("atendente"))!.permissions).toContain("config.diaadia");
    expect((await byKey("recepcao"))!.permissions).toContain("config.diaadia");
    await db.update(profiles).set({ permissions: ["atendimento.ver"] }).where(eq(profiles.key, "atendente"));
    await seed(db);
    expect((await byKey("atendente"))!.permissions).toEqual(["atendimento.ver"]);
  });

  it("Lote 4: banco de antes da troca (Atendente sem o dia a dia, sem a marca) ganha na primeira vez que o seed roda", async () => {
    await db.update(profiles).set({ permissions: ["atendimento.ver", "quadro.ver"] }).where(eq(profiles.key, "atendente"));
    await db.delete(settings).where(eq(settings.key, CONFIG_SPLIT_MARK));
    await seed(db);
    expect([...(await byKey("atendente"))!.permissions].sort()).toEqual(["atendimento.ver", "config.diaadia", "quadro.ver"]);
  });
```

Em `src/app/(app)/config/actions.test.ts`, trocar o arquivo inteiro por:

```ts
import { it, expect, vi } from "vitest";

const { asked } = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { PERMS } = await import("@/lib/permissions");
  const u = { id: "u1", perms: [...PERMS] };
  return { assertUser: async () => u, assertPerm: async (p: string) => { asked.push(p); return u; }, assertAnyPerm: async () => u };
});
vi.mock("@/server/domain/config", async (orig) => ({
  ...(await orig<typeof import("@/server/domain/config")>()),
  addListItem: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "lists_kind_label_uq"'), { code: "23505" }); },
  updateListItem: async () => { throw new Error("Escreva o texto da resposta pronta."); },
  disconnectChannel: async () => {}, toggleAutomation: async () => {},
}));
vi.mock("@/server/domain/distribution", async (orig) => ({ ...(await orig<typeof import("@/server/domain/distribution")>()), saveDistributionSettings: async () => {}, setPriorityLevel: async () => {} }));
vi.mock("@/server/domain/messaging-settings", async (orig) => ({ ...(await orig<typeof import("@/server/domain/messaging-settings")>()), saveAutoReply: async () => {} }));
vi.mock("@/server/domain/professionals", async (orig) => ({ ...(await orig<typeof import("@/server/domain/professionals")>()), createProfessional: async () => ({}) }));
import {
  addListItemAction, createProfessionalAction, disconnectChannelAction, saveAutoReplyAction, saveDistributionAction, setPriorityLevelAction,
  toggleAutomationAction, updateListItemAction,
} from "./actions";

const quiet = async <T>(fn: () => Promise<T>) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const ID = "00000000-0000-4000-8000-000000000000";

it("erro de banco não chega cru à tela de Configurações", async () => {
  const r = await quiet(() => addListItemAction("service", "Corte", null));
  expect(r).toEqual({ ok: false, error: "Não deu certo. Tente de novo." });
});
it("erro do domínio (texto fixo) continua chegando", async () => {
  expect(await updateListItemAction(ID, "x", "", true)).toEqual({ ok: false, error: "Escreva o texto da resposta pronta." });
});
it("cada ação pede a permissão certa: dia a dia × sistema (Lote 4)", async () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["listas", () => addListItemAction("service", "Corte", null), "config.diaadia"],
    ["níveis da distribuição", () => setPriorityLevelAction(ID, 1), "config.diaadia"],
    ["profissionais", () => createProfessionalAction({ name: "Teste", serviceIds: [] }), "config.diaadia"],
    ["WhatsApp", () => disconnectChannelAction(ID, false), "config.sistema"],
    ["automações", () => toggleAutomationAction(ID, false), "config.sistema"],
    ["ligar a distribuição", () => saveDistributionAction({ enabled: false, limit: 3 }), "config.sistema"],
    ["mensagem automática", () => saveAutoReplyAction({ enabled: false, text: "" }), "config.sistema"],
  ];
  for (const [nome, call, perm] of cases) { asked.length = 0; await quiet(call); expect(asked[0], nome).toBe(perm); }
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/permissions.test.ts src/lib/config-tabs.test.ts src/server/auth/profiles-seed.test.ts "src/app/(app)/config/actions.test.ts"`
Esperado: FAIL (`config.diaadia` não existe; `./config-tabs` não existe; `asked[0]` = `"config.editar"`).

- [ ] **Passo 3: As permissões**

Em `src/lib/permissions.ts`:
- em `PERMS`, trocar `"config.editar", "equipe.gerir",` por `"config.diaadia", "config.sistema", "equipe.gerir",`;
- em `PERM_LABEL`, trocar a linha de `config.editar` por:

```ts
  "config.diaadia": "Configurar o dia a dia",
  "config.sistema": "Configurar o sistema",
```

- em `PERM_HELP`, trocar a linha de `config.editar` por:

```ts
  "config.diaadia": "Etiquetas, respostas prontas, objeções e motivos de perda, serviços, palavras-chave, profissionais, origens e links, e o nível de cada pessoa na distribuição.",
  "config.sistema": "WhatsApp, horário e etapas, automações, mensagens automáticas, limite de envios e guarda de mídias, ligar e desligar a distribuição e importar contatos.",
```

- em `PERM_GROUP`, trocar `"config.editar": "Gestão", "equipe.gerir": "Gestão",` por `"config.diaadia": "Gestão", "config.sistema": "Gestão", "equipe.gerir": "Gestão",`;
- `EQUIPE` passa a ser:

```ts
/** Atendente e Recepção fazem o mesmo atendimento (pedido da Casa, 14/10) e configuram o dia a dia (Lote 4). Relatórios e o sistema, só a Gestão. */
const EQUIPE: readonly Perm[] = ["atendimento.ver", "atendimento.transferir", "atendimento.fechar", "distribuicao.receber", "quadro.ver", "contatos.ver", "config.diaadia"];
```

- no fim do arquivo:

```ts
/** A permissão de antes do Lote 4 ("tudo ou nada"), que o seed troca por config.diaadia + config.sistema nos perfis guardados. */
export const LEGACY_CONFIG_PERM = "config.editar";

/** Entra em Configurações: quem configura o dia a dia, o sistema ou gere a equipe. */
export const canConfigure = (perms: readonly string[] | null | undefined): boolean =>
  can(perms, "config.diaadia") || can(perms, "config.sistema") || can(perms, "equipe.gerir");
```

Criar `src/lib/config-tabs.ts`:

```ts
import { can } from "./permissions";

/** Abas de Configurações e quem abre cada uma (Lote 4). Do dia a dia ao sistema: Automações por último. */
export type ConfigTab = { href: string; label: string; need: "diaadia" | "sistema" | "equipe" | "qualquer" };
export const CONFIG_TABS: ConfigTab[] = [
  { href: "/config/equipe", label: "Equipe", need: "equipe" },
  { href: "/config/listas", label: "Listas e respostas", need: "diaadia" },
  { href: "/config/profissionais", label: "Profissionais", need: "diaadia" },
  { href: "/config/origens", label: "Origens e links", need: "diaadia" },
  { href: "/config/distribuicao", label: "Distribuição", need: "qualquer" },
  { href: "/config/whatsapp", label: "WhatsApp", need: "sistema" },
  { href: "/config/etapas", label: "Horário, etapas e prazos", need: "sistema" },
  { href: "/config/mensagens", label: "Mensagens automáticas", need: "sistema" },
  { href: "/config/automacoes", label: "Automações", need: "sistema" },
];

export function configTabs(perms: readonly string[] | null | undefined): ConfigTab[] {
  const d = can(perms, "config.diaadia"), s = can(perms, "config.sistema"), e = can(perms, "equipe.gerir");
  return CONFIG_TABS.filter((t) => (t.need === "equipe" ? e : t.need === "diaadia" ? d : t.need === "sistema" ? s : d || s));
}

/** Para onde vai quem abre /config: a primeira aba que pode abrir (ou o Hoje). */
export const firstConfigPath = (perms: readonly string[] | null | undefined): string => configTabs(perms)[0]?.href ?? "/";
```

- [ ] **Passo 4: A troca nos perfis guardados (seed, idempotente)**

Em `src/server/db/seed.ts`:
- imports: acrescentar `settings` ao import de `./schema` e `LEGACY_CONFIG_PERM` ao import de `@/lib/permissions`;
- antes de `export async function seed`:

```ts
/** Marca de que a troca de permissões do Lote 4 já rodou: a gestão pode tirar o dia a dia da Atendente e o próximo deploy não devolve. */
export const CONFIG_SPLIT_MARK = "migracao_permissoes_config";

/**
 * Lote 4 (idempotente). Em qualquer perfil, "config.editar" vira "config.diaadia" + "config.sistema" (o mesmo acesso de antes). Uma vez só
 * (marca em `settings`), Atendente e Recepção ganham "config.diaadia": a spec põe o dia a dia com quem atende.
 */
async function migrateConfigPerms(db: Db) {
  await db.execute(sql`update profiles
    set permissions = array(select distinct p from unnest(array_remove(permissions, ${LEGACY_CONFIG_PERM}::text) || array['config.diaadia', 'config.sistema']::text[]) p order by p)
    where ${LEGACY_CONFIG_PERM}::text = any(permissions)`);
  const [done] = await db.select({ key: settings.key }).from(settings).where(eq(settings.key, CONFIG_SPLIT_MARK));
  if (done) return;
  await db.execute(sql`update profiles set permissions = array(select distinct p from unnest(permissions || array['config.diaadia']::text[]) p order by p)
    where key in ('atendente', 'recepcao')`);
  await db.insert(settings).values({ key: CONFIG_SPLIT_MARK, value: { em: new Date().toISOString() } }).onConflictDoNothing();
}
```

- em `seed()`, logo depois do `insert(profiles)...onConflictDoNothing(...)`, chamar `await migrateConfigPerms(db);`.

- [ ] **Passo 5: Guardas das actions**

Em `src/app/(app)/config/actions.ts`:
- trocar `run` e `runSafe` (o `perm` deixa de ter padrão: toda action escolhe):

```ts
type ConfigPerm = Extract<Perm, "config.diaadia" | "config.sistema" | "equipe.gerir">;
/** Lote 4: cada action escolhe a permissão (dia a dia, sistema ou equipe). Sem padrão, para nenhuma ficar com a errada. */
const DIA = "config.diaadia" as const, SIS = "config.sistema" as const, EQ = "equipe.gerir" as const;
async function run<T>(fn: (uid: string) => Promise<T>, path: string, perm: ConfigPerm): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) { return fail(e); }
}
```

```ts
async function runSafe<T>(fn: (uid: string) => Promise<T>, path: string, fallback: string, perm: ConfigPerm): Promise<R<T>> {
  try { const u = await assertPerm(perm); const data = await fn(u.id); revalidatePath(path); return { ok: true, data }; } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? fallback };
    if (e instanceof Error && /sessão expirou|não tem permissão|não encontrad/i.test(e.message)) return { ok: false, error: e.message };
    console.error("[config]", fallback, e);
    return { ok: false, error: fallback };
  }
}
```

- acrescentar o último argumento em cada chamada (as que já passam `"equipe.gerir"` passam `EQ`):
  - `SIS`: `updateStageAction`, `saveHoursAction`, `moveStageAction`, `saveAutomationAction`, `toggleAutomationAction`, `restoreAutomationAction`, `deleteAutomationAction`, `automationDetailsAction`, `previewAutomationAction`, `createChannelAction`, `channelQrAction`, `channelStateAction`, `disconnectChannelAction`, `saveDistributionAction`, `saveAutoReplyAction`, `saveSendCapAction`, `saveMediaRetentionAction`
  - `DIA`: `addListItemAction`, `updateListItemAction`, `setKeywordBoostAction`, `setPriorityLevelAction`, `createSourceAction`, `setSourceActiveAction`, `saveServiceCycleDaysAction`, `createProfessionalAction`, `updateProfessionalAction`
  - `EQ`: `inviteMemberAction`, `setMemberProfileAction`, `setMemberActiveAction`, `saveProfileAction`, `duplicateProfileAction`, `deleteProfileAction`, `createMemberAction`, `resetMemberPasswordAction`, `setMemberSignatureAction`

  Exemplos (os outros seguem igual):

```ts
export const updateStageAction = async (id: string, v: Parameters<typeof cfg.updateStage>[1]) => run((u) => cfg.updateStage(id, v, u), "/config/etapas", SIS);
export const addListItemAction = async (kind: (typeof cfg.listKinds)[number], label: string, body: string | null) => run((u) => cfg.addListItem(kind, label, body, u), "/config/listas", DIA);
export const setPriorityLevelAction = async (userId: string, level: number) => run((u) => distribution.setPriorityLevel(userId, level, u), "/config/distribuicao", DIA);
export const saveAutoReplyAction = async (v: unknown) => runSafe((u) => msg.saveAutoReply(v, u), "/config/mensagens", "Não deu para salvar a resposta fora do horário. Tente de novo.", SIS);
export const setMemberProfileAction = async (id: string, profileId: string) => run((u) => profiles.setMemberProfile(id, profileId, u), "/config/equipe", EQ);
```

  Se o arquivo tiver action de outro lote (ex.: chave do Retorno sugerido do Lote 2), o `npm run typecheck` acusa a falta do argumento: Automações e mensagens = `SIS`; listas, etiquetas, profissionais e origens = `DIA`.

- `src/app/(app)/config/listas/actions.ts:17`: `assertPerm("config.editar")` → `assertPerm("config.diaadia")`.
- `src/app/(app)/contatos/actions.ts:24` e `:38`: `assertPerm("config.editar")` → `assertPerm("config.sistema")` (importar contatos é do sistema).
- `src/app/(app)/quiet/actions.ts:15`: `assertPerm("config.editar")` → `assertPerm("config.sistema")`.
- `src/app/dev/simulador/actions.ts` e `src/app/dev/simulador/page.tsx:11`: `"config.editar"` → `"config.sistema"`.

- [ ] **Passo 6: Telas e menu**

`src/app/(app)/config/layout.tsx` inteiro:

```tsx
import { requireAnyPerm } from "@/server/auth/session";
import { ConfigNav } from "@/components/config/config-nav";
import { configTabs } from "@/lib/config-tabs";

export default async function ConfigLayout({ children }: LayoutProps<"/config">) {
  const user = await requireAnyPerm("config.diaadia", "config.sistema", "equipe.gerir");
  return (
    <main className="pb-14">
      <header className="px-5 lg:px-8 pt-6 lg:pt-9 pb-4">
        <h1 className="font-display text-[32px] lg:text-[38px] leading-none font-light">Configurações</h1>
        <p className="text-graphite mt-2">O dia a dia (etiquetas, respostas, profissionais, origens) quem atende ajusta; o sistema (WhatsApp, etapas, automações), a gestão.</p>
      </header>
      <ConfigNav tabs={configTabs(user.perms).map(({ href, label }) => ({ href, label }))} />
      <div className="px-5 lg:px-8 mt-5 max-w-[1100px]">{children}</div>
    </main>
  );
}
```

`src/app/(app)/config/page.tsx` inteiro:

```tsx
import { redirect } from "next/navigation";
import { requireAnyPerm } from "@/server/auth/session";
import { firstConfigPath } from "@/lib/config-tabs";

export default async function ConfigIndex() {
  const user = await requireAnyPerm("config.diaadia", "config.sistema", "equipe.gerir");
  redirect(firstConfigPath(user.perms));
}
```

Em `src/components/config/config-nav.tsx`: apagar a constante `TABS` e trocar a assinatura e o filtro:

```tsx
/** As abas chegam já filtradas pelo servidor (`configTabs`): cada pessoa vê só o que pode abrir. */
export function ConfigNav({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
```

(o resto do componente continua igual, usando `tabs.map(({ href, label }) => …)` no lugar de `tabs.map(([href, label]) => …)`).

Páginas (troca da guarda):
- `requirePerm("config.sistema")`: `config/whatsapp/page.tsx:10`, `config/etapas/page.tsx:10`, `config/automacoes/page.tsx:10`, `config/mensagens/page.tsx:13`.
- `requirePerm("config.diaadia")`: `config/listas/page.tsx:9`, `config/profissionais/page.tsx:12`, `config/origens/page.tsx:14`.
- `config/distribuicao/page.tsx` inteiro:

```tsx
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { distributionTeam, getDistributionSettings } from "@/server/domain/distribution";
import { DistributionEditor } from "@/components/config/distribution";
import { LiveRefresh } from "@/components/shell/live";
export const metadata = { title: "Distribuição" };
export default async function DistribuicaoPage() {
  const user = await requireAnyPerm("config.diaadia", "config.sistema");
  const [cfg, team] = await Promise.all([getDistributionSettings(), distributionTeam()]);
  return (
    <>
      <LiveRefresh scopes={["team", "queue"]} />
      <DistributionEditor initial={cfg} canSystem={can(user.perms, "config.sistema")} canLevels={can(user.perms, "config.diaadia")}
        team={team.map((t) => ({ id: t.id, name: t.name, availability: t.availability, online: t.online, priorityLevel: t.priorityLevel, waiting: t.waiting }))} />
    </>
  );
}
```

Em `src/components/config/distribution.tsx`:
- assinatura: `export function DistributionEditor({ initial, team, canSystem, canLevels }: { initial: { enabled: boolean; limit: number }; team: Person[]; canSystem: boolean; canLevels: boolean }) {`;
- `Switch` da distribuição: `disabled={pending || !canSystem}`;
- `Input` do limite: acrescentar `disabled={!canSystem}`; o botão "Salvar limite" só com `canSystem` (`{canSystem && <Button …>Salvar limite</Button>}`);
- logo abaixo do `<form>` do limite: `{!canSystem && <p className="text-sm text-muted">Ligar, desligar e o limite ficam com a gestão (Configurar o sistema).</p>}`;
- `Select` do nível: `disabled={pending || !canLevels}`.

Casca e atalhos:
- `src/components/shell/sidebar.tsx:40`: `const config = canConfigure(user.perms);` (importar `canConfigure` de `@/lib/permissions`).
- `src/components/shell/connection-banner.tsx:16`: `const gestor = can(perms, "config.sistema");`.
- `src/components/queue/use-lead-actions.tsx:180`: `canManage={can(viewer?.perms, "config.diaadia")}`.
- `src/app/(app)/atendimento/[id]/page.tsx:42` e `src/app/(app)/atendimento/[id]/cliente/page.tsx:31`: `can(user.perms, "config.sistema") ? "/config/whatsapp" : "/atendimento"`.
- `src/app/(app)/contatos/page.tsx:41`: `can(user.perms, "config.sistema") ? <ImportButton /> : undefined`.

Conferir que não sobrou nada: `grep -rn "config.editar" src scripts worker e2e test` só pode mostrar `LEGACY_CONFIG_PERM` em `src/lib/permissions.ts` e o uso no `seed.ts`.

- [ ] **Passo 7: Rodar e ver passar (unitários)**

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: PASS, inclusive `src/server/auth/guard-coverage.test.ts` (toda action segue com `=> run(`/`=> runSafe(` e o `run` exige `assertPerm(perm)`).

- [ ] **Passo 8: e2e**

Criar `e2e/config-lote4.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const ANA = "ana@e2e.local";

test("atendente configura o dia a dia, mas não vê nem abre WhatsApp, etapas, mensagens e automações", async ({ page }) => {
  await login(page, ANA);
  await page.goto("/config");
  await expect(page).toHaveURL(/\/config\/listas/);
  const nav = page.getByRole("navigation", { name: "Configurações" });
  for (const n of ["Listas e respostas", "Profissionais", "Origens e links", "Distribuição"]) await expect(nav.getByRole("link", { name: n })).toBeVisible();
  for (const n of ["Equipe", "WhatsApp", "Horário, etapas e prazos", "Mensagens automáticas", "Automações"]) await expect(nav.getByRole("link", { name: n })).toHaveCount(0);
  for (const path of ["/config/whatsapp", "/config/etapas", "/config/automacoes", "/config/mensagens"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/\?aviso=sem-permissao/);
  }
  await page.goto("/config/distribuicao");
  await expect(page.getByRole("switch", { name: "Distribuição automática" })).toBeDisabled();
  await expect(page.getByText("Ligar, desligar e o limite ficam com a gestão")).toBeVisible();
});
```

Em `e2e/cliente.spec.ts`, no teste "fechar venda sem serviço cadastrado…" (linhas ~169-186):
- título: `"fechar venda sem serviço cadastrado: quem configura o dia a dia (gestão e atendente) vai à aba Serviços e cadastra"`;
- comentário `// Atendente: aviso claro, sem link` vira `// Atendente (Configurar o dia a dia): também tem o atalho para cadastrar`;
- trocar as duas linhas `toContainText("Peça à gestão para cadastrar os serviços")` e `getByRole("link", { name: "Cadastrar serviços" })).toHaveCount(0)` por:

```ts
    await expect(dlgAna.getByRole("link", { name: "Cadastrar serviços" })).toBeVisible();
```

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/config-lote4.spec.ts e2e/cliente.spec.ts e2e/permissoes.spec.ts e2e/distribuicao.spec.ts e2e/config-mensagens.spec.ts`
Esperado: PASS.

- [ ] **Passo 9: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts src/lib/config-tabs.ts src/lib/config-tabs.test.ts src/server/db/seed.ts src/server/auth/profiles-seed.test.ts \
  "src/app/(app)/config" src/components/config/config-nav.tsx src/components/config/distribution.tsx src/components/shell/sidebar.tsx \
  src/components/shell/connection-banner.tsx src/components/queue/use-lead-actions.tsx "src/app/(app)/atendimento/[id]/page.tsx" \
  "src/app/(app)/atendimento/[id]/cliente/page.tsx" "src/app/(app)/contatos/page.tsx" "src/app/(app)/contatos/actions.ts" "src/app/(app)/quiet/actions.ts" \
  src/app/dev/simulador e2e/config-lote4.spec.ts e2e/cliente.spec.ts
git commit -m "feat(config): Configurar o dia a dia (equipe) e Configurar o sistema (gestão) no lugar de config.editar, com a troca nos perfis guardados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.2: Tela Etiquetas (cor, renomear, juntar, contagem) e a cor nas etiquetas da Fila e da conversa

**Arquivos:**
- Criar: `src/lib/tag-colors.ts`, `src/components/tags/tag-dot.tsx`, `src/app/(app)/config/etiquetas/page.tsx`, `src/components/config/tags.tsx`
- Modificar: `src/server/domain/tags.ts`, `src/app/(app)/config/actions.ts`, `src/lib/config-tabs.ts` (+ teste), `src/server/queries/queue.ts` (campo `tagColors`), `src/components/queue/queue-item.tsx:180-184`, `src/components/queue/tags-editor.tsx`
- Testes: `src/server/domain/tags.test.ts`, `src/components/config/tags.test.tsx`, `src/lib/config-tabs.test.ts`, `e2e/config-lote4.spec.ts` (ajuste da 4.1)

**Interfaces:**
- Consome: `tags.color` (Tarefa 0); `run`, `DIA` (4.1); `IMAGE_USE_TAG` (`src/server/domain/avec/context.ts`).
- Produz:
  - `TAG_COLORS` (8 cores, em `src/lib/tag-colors.ts`); `TagDot({ color, className })`
  - `type Tag = { id: string; name: string; color?: string | null }` (`tagsOf` passa a trazer a cor)
  - `type TagAdmin = { id; name; color: string | null; uses: number; protected: boolean }`, `listTagsAdmin()`, `renameTag(id, name, userId)`, `setTagColor(id, color | null, userId)`, `mergeTags(fromId, intoId, userId): Promise<{ moved: number }>`
  - actions `renameTagAction(id, name)`, `setTagColorAction(id, color)`, `mergeTagsAction(fromId, intoId)` (todas `config.diaadia`)
  - aba "Etiquetas" (`/config/etiquetas`, dia a dia), logo depois de "Equipe"
  - `QueueItem.tagColors?: Record<string, string>` (nome → cor)

- [ ] **Passo 1: Escrever os testes que falham**

Em `src/server/domain/tags.test.ts`, acrescentar `listTagsAdmin, renameTag, setTagColor, mergeTags` ao import, `import { contactTags, tags } from "../db/schema";`, e:

```ts
describe("Configurações › Etiquetas", () => {
  it("lista com a contagem de clientes (mais usadas primeiro), a cor e quem é protegida", async () => {
    await addTag(c1, "VIP", ana); await addTag(c2, "VIP", ana); await addTag(c1, "Noiva", ana);
    expect((await listTagsAdmin()).map((t) => [t.name, t.uses, t.color, t.protected])).toEqual([["VIP", 2, null, false], ["Noiva", 1, null, false]]);
  });

  it("renomear: recusa vazio e nome que já existe (sugere Juntar); o histórico guarda de → para", async () => {
    const vip = await addTag(c1, "VIP", ana); await addTag(c2, "Noiva", ana);
    await expect(renameTag(vip.id, "  ", ana)).rejects.toThrow("Escreva o nome da etiqueta");
    await expect(renameTag(vip.id, "noiva", ana)).rejects.toThrow(/Já existe a etiqueta "noiva".*Juntar/);
    expect(await renameTag(vip.id, " Cliente VIP ", ana)).toMatchObject({ name: "Cliente VIP" });
  });

  it("cor: só #rrggbb ou sem cor", async () => {
    const vip = await addTag(c1, "VIP", ana);
    await expect(setTagColor(vip.id, "vermelho", ana)).rejects.toThrow("Escolha uma das cores");
    await setTagColor(vip.id, "#2F6B4F", ana);
    expect((await listTagsAdmin())[0].color).toBe("#2f6b4f");
    await setTagColor(vip.id, null, ana);
    expect((await listTagsAdmin())[0].color).toBeNull();
  });

  it("juntar: as clientes passam para a outra sem repetir e a antiga some", async () => {
    const vip = await addTag(c1, "VIP", ana);
    const vip2 = await addTag(c1, "vip cliente", ana); await addTag(c2, "vip cliente", ana);
    expect(await mergeTags(vip2.id, vip.id, ana)).toEqual({ moved: 1 }); // c1 já tinha VIP: não repete
    expect((await tagsOf([c1, c2])).get(c2)!.map((t) => t.name)).toEqual(["VIP"]);
    expect(await db.select().from(tags)).toHaveLength(1);
    expect(await db.select().from(contactTags)).toHaveLength(2);
    await expect(mergeTags(vip.id, vip.id, ana)).rejects.toThrow("Escolha outra etiqueta");
  });

  it("'Uso de imagem' não muda de nome nem some (a importação do Avec procura por ela); juntar outras NELA pode", async () => {
    const uso = await addTag(c1, "Uso de imagem", ana);
    const foto = await addTag(c2, "Autoriza foto", ana);
    await expect(renameTag(uso.id, "Imagem", ana)).rejects.toThrow(/não muda de nome/);
    await expect(mergeTags(uso.id, foto.id, ana)).rejects.toThrow(/junte as outras nela/);
    expect(await mergeTags(foto.id, uso.id, ana)).toEqual({ moved: 1 });
    expect((await listTagsAdmin()).map((t) => [t.name, t.uses, t.protected])).toEqual([["Uso de imagem", 2, true]]);
  });
});
```

Em `src/lib/config-tabs.test.ts`, na primeira lista de `hrefs(["config.diaadia"])`, a esperada passa a ser `["/config/etiquetas", "/config/listas", "/config/profissionais", "/config/origens", "/config/distribuicao"]` e, em `firstConfigPath(["config.diaadia"])`, `"/config/etiquetas"`.

Em `e2e/config-lote4.spec.ts` (teste da 4.1): `toHaveURL(/\/config\/listas/)` vira `toHaveURL(/\/config\/etiquetas/)` e "Etiquetas" entra na lista de abas visíveis para a atendente.

Criar `src/components/config/tags.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rename, color, merge } = vi.hoisted(() => ({
  rename: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  color: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  merge: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { moved: 3 } })),
}));
vi.mock("@/app/(app)/config/actions", () => ({
  renameTagAction: (...a: unknown[]) => rename(...a), setTagColorAction: (...a: unknown[]) => color(...a), mergeTagsAction: (...a: unknown[]) => merge(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { TagsAdmin } from "./tags";

afterEach(cleanup);

it("mostra a contagem, troca a cor, renomeia e junta; 'Uso de imagem' não muda de nome nem tem Juntar", async () => {
  render(<TagsAdmin tags={[
    { id: "t1", name: "VIP", color: null, uses: 12, protected: false },
    { id: "t2", name: "vip cliente", color: "#2f6b4f", uses: 3, protected: false },
    { id: "t3", name: "Uso de imagem", color: null, uses: 38, protected: true },
  ]} />);
  expect(screen.getByText("12 clientes")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Cor 2 de VIP" }));
  await waitFor(() => expect(color).toHaveBeenCalledWith("t1", "#2f6b4f"));
  const nome = screen.getByLabelText("Nome da etiqueta VIP");
  fireEvent.change(nome, { target: { value: "VIPs" } });
  fireEvent.blur(nome);
  await waitFor(() => expect(rename).toHaveBeenCalledWith("t1", "VIPs"));
  fireEvent.click(screen.getByRole("button", { name: "Juntar vip cliente com outra" }));
  fireEvent.change(screen.getByLabelText("Juntar em"), { target: { value: "t1" } });
  fireEvent.click(screen.getByRole("button", { name: "Juntar" }));
  await waitFor(() => expect(merge).toHaveBeenCalledWith("t2", "t1"));
  expect(screen.queryByLabelText("Nome da etiqueta Uso de imagem")).toBeNull();
  expect(screen.queryByRole("button", { name: "Juntar Uso de imagem com outra" })).toBeNull();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/tags.test.ts src/components/config/tags.test.tsx src/lib/config-tabs.test.ts`
Esperado: FAIL (funções e componente não existem; aba Etiquetas ausente).

- [ ] **Passo 3: Cores e domínio**

Criar `src/lib/tag-colors.ts`:

```ts
/** Cores das etiquetas (Configurações › Etiquetas): uma bolinha ao lado do nome; o texto continua na cor normal (contraste garantido). */
export const TAG_COLORS = ["#b8863f", "#2f6b4f", "#6b5b8a", "#9a3b3b", "#3d5a80", "#8a6a2f", "#5c5c5c", "#c05a8a"] as const;
```

Criar `src/components/tags/tag-dot.tsx`:

```tsx
import { cn } from "@/lib/cn";

/** Bolinha da cor da etiqueta. Decorativa: o nome está sempre escrito ao lado. */
export function TagDot({ color, className }: { color: string | null | undefined; className?: string }) {
  if (!color) return null;
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
```

Em `src/server/domain/tags.ts`:
- imports: `import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";` e `import { IMAGE_USE_TAG } from "./avec/context";`;
- `export type Tag = { id: string; name: string; color?: string | null };`;
- em `tagsOf`, acrescentar `color: tags.color` ao `select` e `color: r.color` ao objeto empurrado no mapa;
- no fim do arquivo:

```ts
/* ───────────── Configurações › Etiquetas (Lote 4) ───────────── */

export { TAG_COLORS } from "../../lib/tag-colors";
export type TagAdmin = { id: string; name: string; color: string | null; uses: number; protected: boolean };
const HEX = /^#[0-9a-f]{6}$/i;
/** A importação do Avec procura "Uso de imagem" pelo nome: renomear (ou juntar a partir dela) criaria outra igual na próxima importação. */
const isProtected = (name: string) => name.trim().toLowerCase() === IMAGE_USE_TAG.toLowerCase();

/** Todas as etiquetas, mais usadas primeiro, com quantas clientes têm cada uma. */
export async function listTagsAdmin(): Promise<TagAdmin[]> {
  const rows = await db.select({ id: tags.id, name: tags.name, color: tags.color, uses: sql<number>`count(${contactTags.contactId})::int` }).from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id)
    .orderBy(desc(sql`count(${contactTags.contactId})`), asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ ...r, protected: isProtected(r.name) }));
}

export async function renameTag(id: string, rawName: string, userId: string): Promise<Tag> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da etiqueta.");
  if (name.length > TAG_MAX) throw new UserFacingError(`Use até ${TAG_MAX} caracteres.`);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tags).where(eq(tags.id, id));
    if (!cur) throw new UserFacingError("Essa etiqueta não existe mais.");
    if (isProtected(cur.name)) throw new UserFacingError(`"${IMAGE_USE_TAG}" vem da importação do Avec e não muda de nome.`);
    const [other] = await tx.select({ id: tags.id }).from(tags).where(sql`lower(${tags.name}) = lower(${name}) and ${tags.id} <> ${id}`);
    if (other) throw new UserFacingError(`Já existe a etiqueta "${name}". Para unir as duas, use Juntar.`);
    await tx.update(tags).set({ name }).where(eq(tags.id, id));
    await tx.insert(auditLog).values({ userId, action: "renomeou_etiqueta", entity: "tag", entityId: id, data: { de: cur.name, para: name } });
    return { id, name, color: cur.color };
  });
}

export async function setTagColor(id: string, color: string | null, userId: string): Promise<void> {
  if (color !== null && !HEX.test(color)) throw new UserFacingError("Escolha uma das cores.");
  const [t] = await db.update(tags).set({ color: color ? color.toLowerCase() : null }).where(eq(tags.id, id)).returning({ id: tags.id });
  if (!t) throw new UserFacingError("Essa etiqueta não existe mais.");
  await db.insert(auditLog).values({ userId, action: "coloriu_etiqueta", entity: "tag", entityId: id, data: { cor: color } });
}

/** Juntar: as clientes de `fromId` passam para `intoId` (sem repetir) e `fromId` deixa de existir. */
export async function mergeTags(fromId: string, intoId: string, userId: string): Promise<{ moved: number }> {
  if (fromId === intoId) throw new UserFacingError("Escolha outra etiqueta para juntar.");
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(tags).where(eq(tags.id, fromId));
    const [into] = await tx.select().from(tags).where(eq(tags.id, intoId));
    if (!from || !into) throw new UserFacingError("Essa etiqueta não existe mais.");
    if (isProtected(from.name)) throw new UserFacingError(`"${IMAGE_USE_TAG}" vem da importação do Avec: junte as outras nela, não ela nas outras.`);
    const moved = await tx.execute(sql`insert into contact_tags (contact_id, tag_id, created_by, created_at)
      select contact_id, ${intoId}::uuid, created_by, created_at from contact_tags where tag_id = ${fromId}::uuid on conflict do nothing`);
    await tx.delete(tags).where(eq(tags.id, fromId)); // as linhas de contact_tags da antiga saem junto (on delete cascade)
    await tx.insert(auditLog).values({ userId, action: "juntou_etiquetas", entity: "tag", entityId: intoId, data: { de: from.name, para: into.name, clientes: moved.rowCount ?? 0 } });
    return { moved: moved.rowCount ?? 0 };
  });
}
```

(`and` e `inArray` continuam usados pelas funções antigas; se o lint acusar import sem uso, tirar só o que sobrar.)

- [ ] **Passo 4: Actions, aba e tela**

Em `src/app/(app)/config/actions.ts`, acrescentar `import * as tagAdmin from "@/server/domain/tags";` e:

```ts
/* Etiquetas (dia a dia). */
export const renameTagAction = async (id: string, name: string) => run((u) => tagAdmin.renameTag(z.string().uuid().parse(id), name, u), "/config/etiquetas", DIA);
export const setTagColorAction = async (id: string, color: string | null) => run((u) => tagAdmin.setTagColor(z.string().uuid().parse(id), color, u), "/config/etiquetas", DIA);
export const mergeTagsAction = async (fromId: string, intoId: string) =>
  run((u) => tagAdmin.mergeTags(z.string().uuid().parse(fromId), z.string().uuid().parse(intoId), u), "/config/etiquetas", DIA);
```

Em `src/lib/config-tabs.ts`, em `CONFIG_TABS`, logo depois de Equipe: `{ href: "/config/etiquetas", label: "Etiquetas", need: "diaadia" },`.

Criar `src/app/(app)/config/etiquetas/page.tsx`:

```tsx
import { requirePerm } from "@/server/auth/session";
import { listTagsAdmin } from "@/server/domain/tags";
import { TagsAdmin } from "@/components/config/tags";

export const metadata = { title: "Etiquetas" };

/** Etiquetas das clientes: cor, renomear, juntar e quantas clientes têm cada uma (dia a dia). */
export default async function EtiquetasPage() {
  await requirePerm("config.diaadia");
  return <TagsAdmin tags={await listTagsAdmin()} />;
}
```

Criar `src/components/config/tags.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { TagDot } from "@/components/tags/tag-dot";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/cn";
import { mergeTagsAction, renameTagAction, setTagColorAction } from "@/app/(app)/config/actions";

type T = { id: string; name: string; color: string | null; uses: number; protected: boolean };
const clientes = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "cliente" : "clientes"}`;

/** Configurações › Etiquetas: a equipe cria as etiquetas na conversa; aqui ela dá cor, renomeia e junta as que dizem a mesma coisa. */
export function TagsAdmin({ tags }: { tags: T[] }) {
  const [merging, setMerging] = useState<T | null>(null);
  if (!tags.length) return <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-sm text-graphite">Nenhuma etiqueta ainda. Elas nascem na conversa, em “+ Etiqueta”.</p>;
  return (
    <div>
      <p className="mb-4 max-w-[70ch] text-sm text-graphite">Etiquetas que a equipe põe nas clientes. Dê uma cor para achar rápido na Fila, renomeie e junte duas que querem dizer a mesma coisa. A contagem é de clientes com a etiqueta.</p>
      <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
        {tags.map((t) => <li key={t.id}><Row t={t} onMerge={() => setMerging(t)} /></li>)}
      </ul>
      {merging && <MergeDialog from={merging} options={tags.filter((x) => x.id !== merging.id)} onClose={() => setMerging(null)} />}
    </div>
  );
}

function Row({ t, onMerge }: { t: T; onMerge: () => void }) {
  const [name, setName] = useState(t.name);
  const [color, setColor] = useState(t.color);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const rename = () => {
    const v = name.trim().replace(/\s+/g, " ");
    if (!v || v === t.name) { setName(t.name); return; }
    start(async () => { const r = await renameTagAction(t.id, v); if (r.ok) { toast("Etiqueta renomeada"); router.refresh(); } else { toast(r.error, "error"); setName(t.name); } });
  };
  const paint = (c: string | null) => { setColor(c); start(async () => { const r = await setTagColorAction(t.id, c); if (!r.ok) { toast(r.error, "error"); setColor(t.color); } }); };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex min-w-[12rem] flex-1 items-center gap-2">
        <TagDot color={color} />
        {t.protected
          ? <span className="font-medium">{t.name} <span className="text-xs font-normal text-muted">(vem do Avec; não muda de nome)</span></span>
          : <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              maxLength={30} aria-label={`Nome da etiqueta ${t.name}`} className="h-9 max-w-[16rem]" disabled={pending} />}
      </span>
      <span className="text-sm text-graphite tabular">{clientes(t.uses)}</span>
      <span role="radiogroup" aria-label={`Cor de ${t.name}`} className="flex flex-wrap items-center gap-1">
        <button type="button" role="radio" aria-checked={!color} aria-label={`Sem cor em ${t.name}`} onClick={() => paint(null)} disabled={pending}
          className={cn("grid size-8 place-items-center rounded-full border text-xs text-muted", !color ? "border-ink" : "border-line")}>–</button>
        {TAG_COLORS.map((c, i) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${i + 1} de ${t.name}`} onClick={() => paint(c)} disabled={pending}
            className={cn("grid size-8 place-items-center rounded-full border", color === c ? "border-ink" : "border-transparent")}>
            <span className="size-4 rounded-full" style={{ background: c }} />
          </button>
        ))}
      </span>
      {!t.protected && <Button variant="secondary" size="sm" onClick={onMerge} aria-label={`Juntar ${t.name} com outra`}>Juntar…</Button>}
    </div>
  );
}

function MergeDialog({ from, options, onClose }: { from: T; options: T[]; onClose: () => void }) {
  const [into, setInto] = useState(options[0]?.id ?? "");
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const target = options.find((o) => o.id === into);
  const go = () => start(async () => {
    const r = await mergeTagsAction(from.id, into);
    if (r.ok) { toast(`Juntadas: ${clientes(r.data?.moved ?? 0)} passaram para “${target?.name}”`); onClose(); router.refresh(); } else toast(r.error, "error");
  });
  return (
    <Dialog open onClose={onClose} title={`Juntar “${from.name}”`}
      description={<>As {clientes(from.uses)} de “{from.name}” passam para a etiqueta escolhida e “{from.name}” deixa de existir.</>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={pending} disabled={!into} onClick={go}>Juntar</Button></>}>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Juntar em
        <Select value={into} onChange={(e) => setInto(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.name} ({clientes(o.uses)})</option>)}</Select>
      </label>
    </Dialog>
  );
}
```

- [ ] **Passo 5: A cor nas etiquetas da Fila e da conversa**

Em `src/server/queries/queue.ts`:
- no tipo `QueueItem`, depois de `tags: string[];`: `/** Cor de cada etiqueta (nome → #rrggbb), só das que têm cor. */ tagColors?: Record<string, string>;`;
- na montagem do item (depois de `tags: ...`):

```ts
      ...(() => { const c = Object.fromEntries((tagMap.get(r.contactId) ?? []).filter((t) => t.color).map((t) => [t.name, t.color as string])); return Object.keys(c).length ? { tagColors: c } : {}; })(),
```

Em `src/components/queue/queue-item.tsx`, na linha das etiquetas (~183), trocar o `<span ...>{t}</span>` por (importar `TagDot` de `@/components/tags/tag-dot`):

```tsx
              {item.tags.map((t) => <span key={`t-${t}`} data-tag="" title={TAG_HELP} className="inline-flex items-center gap-1 rounded-full border border-line-strong px-1.5 font-medium text-ink-2"><TagDot color={item.tagColors?.[t]} />{t}</span>)}
```

Em `src/components/queue/tags-editor.tsx`: `type Tag = { id: string; name: string; color?: string | null };` e, no chip, antes de `{t.name}`: `<TagDot color={t.color} className="mr-1" />` (importar `TagDot`).

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/tags.test.ts src/components/config/tags.test.tsx src/lib/config-tabs.test.ts src/server/queries/queue.test.ts src/components/queue && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 7: Commit**

```bash
git add src/lib/tag-colors.ts src/components/tags/tag-dot.tsx src/server/domain/tags.ts src/server/domain/tags.test.ts "src/app/(app)/config/actions.ts" \
  "src/app/(app)/config/etiquetas/page.tsx" src/components/config/tags.tsx src/components/config/tags.test.tsx src/lib/config-tabs.ts src/lib/config-tabs.test.ts \
  src/server/queries/queue.ts src/components/queue/queue-item.tsx src/components/queue/tags-editor.tsx e2e/config-lote4.spec.ts
git commit -m "feat(config): tela Etiquetas (cor, renomear, juntar, contagem) e a cor nas etiquetas da Fila e da conversa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.3: Filtro por etiqueta na Fila e em Contatos

**Arquivos:**
- Criar: `src/components/tags/tag-filter.tsx`
- Modificar: `src/server/queries/queue.ts` (`QueueOptions`, `getQueue`), `src/lib/queue.ts` (`QueueParams`, `queueQuery`), `src/app/(app)/atendimento/page.tsx`, `src/app/(app)/atendimento/[id]/page.tsx` (passa as etiquetas à `QueueColumn` do desktop), `src/components/queue/queue-column.tsx`, `src/components/queue/queue-filters.tsx`
- Modificar: `src/server/queries/contacts.ts` (`listContacts`), `src/app/(app)/contatos/page.tsx`
- Testes: `src/server/queries/queue.test.ts`, `src/server/queries/contacts.test.ts`

**Interfaces:**
- Consome: `listTags()` (`src/server/domain/tags.ts`, já existe: `{ id, name, uses }[]`); `addTag` (testes).
- Produz:
  - `QueueOptions.etiqueta?: string | null` (id da etiqueta; vale para as seções, os números do resumo, "Encerradas" e "Sem contato há 90 dias")
  - `QueueParams.etiqueta` e `queueQuery` com `etiqueta`
  - `listContacts({ ..., tagId?: string | null })`
  - `TagFilter({ tags, value, basePath })` (parâmetro de URL `etiqueta`)

- [ ] **Passo 1: Escrever os testes que falham**

Em `src/server/queries/queue.test.ts`, acrescentar `import { addTag } from "../domain/tags";` e:

```ts
describe("filtro por etiqueta (Lote 4)", () => {
  it("só as conversas de clientes com a etiqueta, e os números do resumo seguem o filtro", async () => {
    const { gestora, lead } = await setup();
    const a = await lead({ awaitingReplySince: ago(2), last: { direction: "in" } });
    await lead({ awaitingReplySince: ago(3), last: { direction: "in" } });
    const noiva = await addTag(a.contactId, "Noiva", gestora.id);
    const q = await getQueue(asUser(gestora), { etiqueta: noiva.id, now: NOW });
    expect(q.sections.flatMap((s) => s.items.map((i) => i.dealId))).toEqual([a.id]);
    expect(q.counts.total).toBe(1);
    expect((await getQueue(asUser(gestora), { now: NOW })).counts.total).toBe(2);
  });
  it("etiqueta que não é id (link velho, digitado) é ignorada sem erro", async () => {
    const { gestora, lead } = await setup();
    await lead({ awaitingReplySince: ago(2), last: { direction: "in" } });
    expect((await getQueue(asUser(gestora), { etiqueta: "vip", now: NOW })).counts.total).toBe(1);
  });
});
```

Em `src/server/queries/contacts.test.ts`, acrescentar `import { addTag } from "../domain/tags";` e:

```ts
describe("filtro por etiqueta (Lote 4)", () => {
  it("lista só quem tem a etiqueta, também junto com a busca", async () => {
    const [carla] = await db.select().from(contacts).where(eq(contacts.name, "Carla Mendes"));
    const t = await addTag(carla.id, "VIP", null);
    expect(await names({ tagId: t.id })).toEqual(["Carla Mendes"]);
    expect(await names({ tagId: t.id, q: "Mariana" })).toEqual([]);
    expect((await listContacts({ tagId: t.id })).total).toBe(1);
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/queries/queue.test.ts src/server/queries/contacts.test.ts`
Esperado: FAIL (o filtro é ignorado: 2 conversas; 4 contatos).

- [ ] **Passo 3: Fila**

Em `src/server/queries/queue.ts`:
- em `QueueOptions`, depois de `dono?: …`: `/** Id de uma etiqueta: só clientes com ela (Lote 4). */ etiqueta?: string | null;`;
- em `getQueue`, logo depois de `if (sc) conds.push(sc);` (antes de montar `archivedConds`, para valer também em "Encerradas"):

```ts
  // Filtro por etiqueta (Lote 4): só clientes com ela. Id que não é uuid (link velho) é ignorado.
  const tagCond = isUuid(opts.etiqueta) ? sql`exists (select 1 from contact_tags ct where ct.contact_id = ${deals.contactId} and ct.tag_id = ${opts.etiqueta})` : null;
  if (tagCond) conds.push(tagCond);
```

- nas duas chamadas de `reengageConds(user, now)` dentro do `Promise.all` (a contagem e as linhas), acrescentar o filtro: `[...reengageConds(user, now), ...(tagCond ? [tagCond] : [])]` (na das linhas, junto do `qCond` que já está lá);
- em `refined`, acrescentar `|| opts.etiqueta`.

Em `src/lib/queue.ts`:
- `QueueParams` ganha `etiqueta?: string | null;`;
- em `queueQuery`, a lista de chaves vira `["view", "foco", "filtro", "etapa", "dono", "fonte", "etiqueta", "q", "lead"] as const`.

Criar `src/components/tags/tag-filter.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

/** Filtro por etiqueta (Fila e Contatos): troca só o `etiqueta` da URL e mantém os outros filtros. */
export function TagFilter({ tags, value, basePath, className }: { tags: { id: string; name: string; uses: number }[]; value: string | null; basePath: "/atendimento" | "/contatos"; className?: string }) {
  const router = useRouter(); const sp = useSearchParams();
  if (!tags.length) return null;
  return (
    <select aria-label="Filtrar por etiqueta" value={value ?? ""} className={className ?? "h-11 lg:h-9 w-full rounded-[var(--radius-control)] border border-control bg-paper px-3 text-[16px] lg:text-sm"}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set("etiqueta", e.target.value); else p.delete("etiqueta");
        p.delete("p"); // Contatos: volta para a 1ª página
        router.replace(p.size ? `${basePath}?${p}` : basePath, { scroll: false });
      }}>
      <option value="">Todas as etiquetas</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.uses})</option>)}
    </select>
  );
}
```

Em `src/components/queue/queue-filters.tsx`:
- assinatura: `export function QueueFilters({ view, q, counts, tags = [], etiqueta = null }: { view: QueueView; q: string; counts: QueueCounts; tags?: { id: string; name: string; uses: number }[]; etiqueta?: string | null }) {`;
- depois do `</Menu>` e antes de fechar a `div` do grid: `{tags.length > 0 && <div className="col-span-2"><TagFilter tags={tags} value={etiqueta} basePath="/atendimento" /></div>}` (importar `TagFilter` de `@/components/tags/tag-filter`).

Em `src/components/queue/queue-column.tsx`:
- props novas (opcionais): `tags?: { id: string; name: string; uses: number }[]; etiqueta?: string | null;`;
- `<QueueFilters view={view} q={q ?? ""} counts={queue.counts} tags={tags} etiqueta={etiqueta} />`.

Em `src/app/(app)/atendimento/page.tsx`:
- `import { listTags } from "@/server/domain/tags";`;
- depois de `const q = …`: `const etiqueta = isUuid(str("etiqueta")) ? str("etiqueta") : null;`;
- `getQueue(user, { view, foco, q, filtro, dono, etapa, fonte, etiqueta })` e `listTags()` no `Promise.all` (`const [queue, bulk, etapaName, team, tagList] = …`);
- `queueQuery({ …, etiqueta, q })`;
- `<QueueColumn … tags={tagList} etiqueta={etiqueta} />`.

Em `src/app/(app)/atendimento/[id]/page.tsx` (a Fila do desktop ao lado da conversa): repetir o mesmo `etiqueta`, o `listTags()` e as props da `QueueColumn` (achar com `grep -n "getQueue(user" "src/app/(app)/atendimento/[id]/page.tsx"`).

- [ ] **Passo 4: Contatos**

Em `src/server/queries/contacts.ts`:
- `import { isUuid } from "../../lib/uuid";`;
- assinatura: `export async function listContacts(opts: { q?: string | null; onlyClients?: boolean; includeIgnored?: boolean; page?: number; tagId?: string | null }) {`;
- depois de `if (opts.onlyClients) conds.push(sql\`c.is_client\`);`:

```ts
  // Lote 4: só quem tem a etiqueta (id que não é uuid é ignorado).
  if (isUuid(opts.tagId)) conds.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${opts.tagId})`);
```

Em `src/app/(app)/contatos/page.tsx`:
- imports: `listTags` de `@/server/domain/tags`, `TagFilter` de `@/components/tags/tag-filter`, `isUuid` de `@/lib/uuid`;
- `const etiqueta = typeof sp.etiqueta === "string" && isUuid(sp.etiqueta) ? sp.etiqueta : null;`;
- `const [data, tagList] = await Promise.all([listContacts({ q, onlyClients: clientes, includeIgnored: ignorados, page, tagId: etiqueta }), listTags()]);`;
- `href()` e `keep` levam a etiqueta junto: em `href`, `if (etiqueta) s.set("etiqueta", etiqueta);`; em `keep`, `...(etiqueta ? { etiqueta } : {})`;
- na linha dos chips (`order-3`), depois dos dois `Link`: `<TagFilter tags={tagList} value={etiqueta} basePath="/contatos" className="h-11 sm:h-10 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm" />`.

O Lote 2 também mexe nos filtros de Contatos: se ele já tiver entrado na junção, reaproveitar o parâmetro `etiqueta` e a condição de `listContacts` daqui em vez de criar outro.

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/queries src/lib/queue.test.ts && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/components/tags/tag-filter.tsx src/server/queries/queue.ts src/server/queries/queue.test.ts src/lib/queue.ts "src/app/(app)/atendimento/page.tsx" \
  "src/app/(app)/atendimento/[id]/page.tsx" src/components/queue/queue-column.tsx src/components/queue/queue-filters.tsx \
  src/server/queries/contacts.ts src/server/queries/contacts.test.ts "src/app/(app)/contatos/page.tsx"
git commit -m "feat(fila, contatos): filtro por etiqueta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 4.4: Criar e apagar etapa (tipo, ordem, quais perfis veem no Quadro)

**Arquivos:**
- Criar: `src/lib/stage-kind-labels.ts`, `src/lib/stage-visibility.ts`, `src/server/domain/stage-admin.ts`
- Modificar: `src/server/domain/config.ts` (`moveStage`, linhas 27-36), `src/app/(app)/config/actions.ts`, `src/app/(app)/config/etapas/page.tsx`, `src/components/config/stages.tsx`, `src/server/queries/board.ts` (`Who` e `getBoard`)
- Testes: `src/server/domain/stage-admin.test.ts`, `e2e/config-lote4.spec.ts` (novo caso)

**Interfaces:**
- Consome: `stages.visibleProfileIds` (Tarefa 0); `run`, `SIS` (4.1); do 1C: `stageByKind` (`src/server/domain/deals.ts`); `saveAutomation`, `deleteAutomation` (`src/server/domain/config.ts`, só no teste); `seed` (`src/server/db/seed.ts`, só no teste); `getBoard` (`src/server/queries/board.ts`).
- Produz:
  - `STAGE_KINDS`, `type StageKindName`, `KIND_LABEL` (em `src/lib/stage-kind-labels.ts`, servidor e tela)
  - `stageVisibleTo(stage: { visibleProfileIds: string[] | null }, viewer?: { perms: readonly string[]; profileId?: string | null }): boolean`
  - `stageCreateSchema`, `createStage(input, userId): Promise<{ id: string; key: string }>`, `deleteStage(id, userId): Promise<{ mode: "apagada" | "desativada" }>`, `setStageProfiles(id, profileIds | null, userId)`
  - `moveStage` recusa pôr uma etapa à frente de outra ativa do mesmo tipo
  - actions `createStageAction(v)`, `deleteStageAction(id)`, `setStageProfilesAction(id, ids | null)` (todas `config.sistema`)
  - `StagesEditor({ stages, profiles })` com "Nova etapa", "Quem vê no Quadro", "Apagar" e as desativadas recolhidas
- Regras: a etapa nova fica **depois da primeira do mesmo tipo** (a primeira é a que o sistema usa em `stageByKind`: Novo contato, Agendado, Atendida…), copia prazo, limite e cor dela e entra nas mesmas condições "etapa em" das automações (com versão nova, para o seed não desfazer). "Quem vê" vale para as colunas do Quadro; a gestão (`config.sistema`) vê todas; a Fila não muda.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/domain/stage-admin.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { automations, contacts, deals, profiles, stages, users } from "../db/schema";
import { seed } from "../db/seed";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { getBoard } from "../queries/board";
import { deleteAutomation, moveStage, saveAutomation } from "./config";
import { stageByKind } from "./deals";
import { createStage, deleteStage } from "./stage-admin";

beforeEach(resetDb);
const gestor = async () => (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor" }).returning())[0].id;
const espera = async () => (await db.select().from(automations).where(eq(automations.key, "atendimento_3min")))[0];
const stagesOf = (a: { conditions: unknown }) => (a.conditions as { stages: string[] }[])[0].stages;

describe("Configurações › Etapas: criar e apagar (Lote 4)", () => {
  it("etapa nova recebe os avisos de espera e o seed não tira; copia prazo e cor; fica depois da principal do tipo", async () => {
    const g = await gestor();
    const principal = await stageByKind("followup");
    const { key } = await createStage({ name: "Aguardando foto", kind: "followup", afterId: null, visibleProfileIds: null }, g);
    const s = (await db.select().from(stages).where(eq(stages.key, key)))[0];
    expect(s).toMatchObject({ name: "Aguardando foto", kind: "followup", slaMinutes: principal.slaMinutes, color: principal.color, active: true, visibleProfileIds: null });
    expect(s.position).toBeGreaterThan(principal.position);
    expect((await stageByKind("followup")).id).toBe(principal.id); // a principal continua sendo a que o sistema usa
    expect(stagesOf(await espera())).toContain(key);
    expect((await espera()).version).toBe(2);
    await seed(db); // o próximo deploy
    expect(stagesOf(await espera())).toContain(key);
  });

  it("nome repetido é recusado", async () => {
    const g = await gestor();
    await expect(createStage({ name: "em conversa", kind: "atendimento", afterId: null, visibleProfileIds: null }, g)).rejects.toThrow('Já existe a etapa "em conversa"');
  });

  it("quem vê: a coluna some do Quadro da atendente, aparece para a recepção e para a gestão", async () => {
    const g = await gestor();
    const [recepcao] = await db.select().from(profiles).where(eq(profiles.key, "recepcao"));
    const [atendente] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
    const { id } = await createStage({ name: "Pós-venda", kind: "atendido", afterId: null, visibleProfileIds: [recepcao.id] }, g);
    const ana = { id: g, perms: permsFor("atendente"), profileId: atendente.id };
    expect((await getBoard({}, ana)).map((s) => s.id)).not.toContain(id);
    expect((await getBoard({}, { ...ana, profileId: recepcao.id })).map((s) => s.id)).toContain(id);
    expect((await getBoard({}, { id: g, perms: permsFor("gestor"), profileId: null })).map((s) => s.id)).toContain(id);
  });

  it("não apaga a única etapa do tipo nem etapa com conversa aberta; com histórico, desativa", async () => {
    const g = await gestor();
    await expect(deleteStage((await stageByKind("agendado")).id, g)).rejects.toThrow(/única etapa do tipo Agendado/);
    const { id } = await createStage({ name: "Agendado VIP", kind: "agendado", afterId: null, visibleProfileIds: null }, g);
    const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571990000201" }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: id }).returning();
    await expect(deleteStage(id, g)).rejects.toThrow('1 conversa está em "Agendado VIP"');
    await db.update(deals).set({ closedAt: new Date() }).where(eq(deals.id, d.id));
    expect(await deleteStage(id, g)).toEqual({ mode: "desativada" });
    expect((await db.select().from(stages).where(eq(stages.id, id)))[0].active).toBe(false);
  });

  it("sem histórico some de vez e sai das automações; automação que move para ela impede", async () => {
    const g = await gestor();
    const { id, key } = await createStage({ name: "Teste vazia", kind: "atendimento", afterId: null, visibleProfileIds: null }, g);
    const auto = await saveAutomation(null, { name: "Move para teste", enabled: false, trigger: { type: "parado_dias", days: 3 }, conditions: [], actions: [{ type: "mover_para_etapa", stage: key }] }, g);
    await expect(deleteStage(id, g)).rejects.toThrow('move conversas para "Teste vazia"');
    await deleteAutomation(auto, g);
    expect(await deleteStage(id, g)).toEqual({ mode: "apagada" });
    expect(await db.select().from(stages).where(eq(stages.id, id))).toEqual([]);
    expect(stagesOf(await espera())).not.toContain(key);
  });

  it("a etapa extra não passa à frente da principal do mesmo tipo", async () => {
    const g = await gestor();
    const { id } = await createStage({ name: "Em conversa 2", kind: "atendimento", afterId: null, visibleProfileIds: null }, g);
    await expect(moveStage(id, -1, g)).rejects.toThrow(/primeira etapa de cada tipo/);
    const order = (await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position))).map((s) => s.name);
    expect(order.indexOf("Em conversa")).toBeLessThan(order.indexOf("Em conversa 2"));
  });
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/stage-admin.test.ts`
Esperado: FAIL ("Failed to resolve import ./stage-admin").

- [ ] **Passo 3: Rótulos, visibilidade e domínio**

Criar `src/lib/stage-kind-labels.ts`:

```ts
/** Tipos de etapa (o código decide pelo tipo; Lote 1C) e o nome de cada tipo na tela de Etapas. Servidor e tela. */
export const STAGE_KINDS = ["lead", "atendimento", "followup", "proposta", "agendado", "atendido", "retorno", "fechado", "perdido"] as const;
export type StageKindName = (typeof STAGE_KINDS)[number];
export const KIND_LABEL: Record<StageKindName, string> = {
  lead: "Entrada", atendimento: "Conversa", followup: "Aguardando cliente", proposta: "Orçamento", agendado: "Agendado", atendido: "Atendida",
  retorno: "Retorno", fechado: "Ganho", perdido: "Perda",
};
```

Criar `src/lib/stage-visibility.ts`:

```ts
import { can } from "./permissions";

/**
 * A coluna da etapa aparece no Quadro de quem vê? Sem lista (null ou vazia) = todos. Quem configura o sistema (a gestão) vê todas.
 * Sem quem vê (Jornada, testes), todas. A Fila não usa isto: conversa esperando resposta nunca some.
 */
export function stageVisibleTo(s: { visibleProfileIds: string[] | null }, viewer?: { perms: readonly string[]; profileId?: string | null }): boolean {
  if (!viewer || !s.visibleProfileIds?.length || can(viewer.perms, "config.sistema")) return true;
  return !!viewer.profileId && s.visibleProfileIds.includes(viewer.profileId);
}
```

Criar `src/server/domain/stage-admin.ts`:

```ts
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, automations, automationVersions, stages } from "../db/schema";
import { KIND_LABEL, STAGE_KINDS } from "../../lib/stage-kind-labels";
import { UserFacingError } from "./errors";

export const stageCreateSchema = z.object({
  name: z.string().trim().min(2, "Use pelo menos 2 letras no nome.").max(40, "Use até 40 letras no nome."),
  kind: z.enum(STAGE_KINDS, { error: "Escolha o tipo da etapa." }),
  /** Fica logo depois desta (nunca antes da primeira do mesmo tipo). null = logo depois da primeira do mesmo tipo. */
  afterId: z.string().uuid().nullable(),
  visibleProfileIds: z.array(z.string().uuid()).max(20).nullable(),
});

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "etapa";
type Cond = { type?: string; stages?: string[] };
type Auto = typeof automations.$inferSelect;

/** Grava a automação com condições novas como uma versão nova, editada pela pessoa (o seed não sobrescreve automação editada). */
async function saveConditionsTx(tx: Tx, a: Auto, conditions: Cond[], userId: string) {
  const version = a.version + 1;
  await tx.update(automations).set({ conditions: conditions as Record<string, unknown>[], version, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, a.id));
  await tx.insert(automationVersions).values({ automationId: a.id, version, snapshot: { name: a.name, enabled: a.enabled, trigger: a.trigger, conditions, actions: a.actions }, userId });
}

/**
 * Etapa nova (Configurações › Etapas, Lote 4). Fica depois da primeira do mesmo tipo (a que o sistema usa); copia dela prazo, limite e cor
 * e entra nas mesmas condições "etapa em" das automações: sem isso, cliente esperando na etapa nova não geraria aviso.
 */
export async function createStage(input: z.input<typeof stageCreateSchema>, userId: string): Promise<{ id: string; key: string }> {
  const v = stageCreateSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7120031)`); // duas telas criando ao mesmo tempo não repetem chave nem ordem
    const all = await tx.select().from(stages).orderBy(asc(stages.position));
    if (all.some((s) => s.active && s.name.trim().toLowerCase() === v.name.toLowerCase())) throw new UserFacingError(`Já existe a etapa "${v.name}".`);
    const keys = new Set(all.map((s) => s.key));
    let key = slug(v.name);
    for (let i = 2; keys.has(key); i++) key = `${slug(v.name)}_${i}`;
    const after = v.afterId ? all.find((s) => s.id === v.afterId) : undefined;
    if (v.afterId && !after) throw new UserFacingError("A etapa de referência não existe mais.");
    const model = all.find((s) => s.active && s.kind === v.kind);
    const anchor = Math.max(after?.position ?? -1, model?.position ?? -1);
    const position = anchor >= 0 ? anchor + 1 : (all.at(-1)?.position ?? -1) + 1;
    await tx.update(stages).set({ position: sql`${stages.position} + 1` }).where(sql`${stages.position} >= ${position}`);
    const [row] = await tx.insert(stages).values({
      key, name: v.name, kind: v.kind, position, slaMinutes: model?.slaMinutes ?? 15, staleDays: model?.staleDays ?? null, color: model?.color ?? "#5c5c5c",
      active: true, visibleProfileIds: v.visibleProfileIds?.length ? [...new Set(v.visibleProfileIds)] : null,
    }).returning({ id: stages.id });
    if (model) {
      for (const a of await tx.select().from(automations)) {
        const conds = (a.conditions ?? []) as Cond[];
        if (!conds.some((c) => c.type === "etapa_em" && c.stages?.includes(model.key) && !c.stages.includes(key))) continue;
        await saveConditionsTx(tx, a, conds.map((c) => (c.type === "etapa_em" && c.stages?.includes(model.key) && !c.stages.includes(key) ? { ...c, stages: [...c.stages, key] } : c)), userId);
      }
    }
    await tx.insert(auditLog).values({ userId, action: "criou_etapa", entity: "stage", entityId: row.id, data: { key, name: v.name, kind: v.kind } });
    return { id: row.id, key };
  });
}

/**
 * Apagar etapa. Recusa: a única ativa do tipo (o sistema precisa dela), conversa aberta nela, automação que MOVE para ela, automação
 * que só vale para ela. Sai das condições "etapa em". Com histórico (alguma conversa já passou por ela) é desativada; sem, apagada.
 */
export async function deleteStage(id: string, userId: string): Promise<{ mode: "apagada" | "desativada" }> {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(stages).where(eq(stages.id, id)).for("update");
    if (!s || !s.active) throw new UserFacingError("Essa etapa não existe mais.");
    const [same] = await tx.select({ id: stages.id }).from(stages).where(and(eq(stages.kind, s.kind), eq(stages.active, true), ne(stages.id, s.id))).limit(1);
    if (!same) throw new UserFacingError(`"${s.name}" é a única etapa do tipo ${KIND_LABEL[s.kind]}: o sistema precisa dela. Renomeie em vez de apagar.`);
    const [{ open }] = (await tx.execute(sql`select count(*)::int as open from deals where stage_id = ${s.id} and closed_at is null and archived_at is null`)).rows as { open: number }[];
    if (open > 0) throw new UserFacingError(`${open} ${open === 1 ? "conversa está" : "conversas estão"} em "${s.name}". Mova para outra etapa antes de apagar.`);
    const autos = await tx.select().from(automations);
    const mover = autos.find((a) => ((a.actions ?? []) as { type?: string; stage?: string }[]).some((x) => x.type === "mover_para_etapa" && x.stage === s.key));
    if (mover) throw new UserFacingError(`A automação "${mover.name}" move conversas para "${s.name}". Mude a automação antes.`);
    for (const a of autos) {
      const conds = (a.conditions ?? []) as Cond[];
      if (!conds.some((c) => c.type === "etapa_em" && c.stages?.includes(s.key))) continue;
      const next = conds.map((c) => (c.type === "etapa_em" && c.stages ? { ...c, stages: c.stages.filter((k) => k !== s.key) } : c));
      if (next.some((c) => c.type === "etapa_em" && !c.stages?.length)) throw new UserFacingError(`A automação "${a.name}" só vale para "${s.name}". Mude ou apague a automação antes.`);
      await saveConditionsTx(tx, a, next, userId);
    }
    const used = (await tx.execute(sql`select 1 from deals where stage_id = ${s.id} or archived_stage_id = ${s.id}
      union all select 1 from deal_events where type = 'etapa_alterada' and (payload->>'de' = ${s.key} or payload->>'para' = ${s.key}) limit 1`)).rows.length > 0;
    if (used) {
      const [{ max }] = (await tx.execute(sql`select coalesce(max(position), 0)::int as max from stages`)).rows as { max: number }[];
      await tx.update(stages).set({ active: false, position: max + 1 }).where(eq(stages.id, s.id));
    } else {
      await tx.delete(stages).where(eq(stages.id, s.id));
    }
    await tx.insert(auditLog).values({ userId, action: used ? "desativou_etapa" : "apagou_etapa", entity: "stage", entityId: s.id, data: { key: s.key, name: s.name } });
    return { mode: used ? "desativada" : "apagada" };
  });
}

/** Quais perfis veem a etapa no Quadro (null ou vazio = todos). */
export async function setStageProfiles(id: string, profileIds: string[] | null, userId: string): Promise<void> {
  const ids = z.array(z.string().uuid()).max(20).nullable().parse(profileIds);
  const [s] = await db.update(stages).set({ visibleProfileIds: ids?.length ? [...new Set(ids)] : null }).where(eq(stages.id, id)).returning({ id: stages.id });
  if (!s) throw new UserFacingError("Essa etapa não existe mais.");
  await db.insert(auditLog).values({ userId, action: "editou", entity: "stage", entityId: id, data: { perfis: ids } });
}
```

Em `src/server/domain/config.ts`, `moveStage` passa a ser:

```ts
export async function moveStage(id: string, dir: -1 | 1, userId: string) {
  const all = await db.select().from(stages).orderBy(asc(stages.position));
  const i = all.findIndex((s) => s.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  // Lote 4: a primeira etapa de cada tipo é a que o sistema usa (stageByKind); uma extra do mesmo tipo nunca passa à frente dela.
  if (all[i].kind === all[j].kind && all[i].active && all[j].active)
    throw new UserFacingError("A primeira etapa de cada tipo é a que o sistema usa: uma etapa extra do mesmo tipo fica depois dela.");
  await db.transaction(async (tx) => {
    await tx.update(stages).set({ position: all[j].position }).where(eq(stages.id, all[i].id));
    await tx.update(stages).set({ position: all[i].position }).where(eq(stages.id, all[j].id));
  });
  await audit(userId, "reordenou", "stage", id, { dir });
}
```

- [ ] **Passo 4: Quadro respeita "quem vê"**

Em `src/server/queries/board.ts`:
- `import { stageVisibleTo } from "../../lib/stage-visibility";`;
- `type Who = Pick<SessionUser, "id" | "perms"> & { profileId?: string | null };`;
- em `getBoard`, a primeira linha vira:

```ts
  const st = (await db.select().from(stages).where(eq(stages.active, true)).orderBy(asc(stages.position))).filter((s) => stageVisibleTo(s, viewer));
```

(`src/app/(app)/funil/page.tsx` já passa o `user` da sessão, que tem `profileId`.)

- [ ] **Passo 5: Actions e tela**

Em `src/app/(app)/config/actions.ts`, acrescentar `import * as stageAdmin from "@/server/domain/stage-admin";` e:

```ts
/* Etapas: criar, apagar e quem vê (sistema). */
export const createStageAction = async (v: z.input<typeof stageAdmin.stageCreateSchema>) => run((u) => stageAdmin.createStage(v, u), "/config/etapas", SIS);
export const deleteStageAction = async (id: string) => run((u) => stageAdmin.deleteStage(z.string().uuid().parse(id), u), "/config/etapas", SIS);
export const setStageProfilesAction = async (id: string, profileIds: string[] | null) => run((u) => stageAdmin.setStageProfiles(z.string().uuid().parse(id), profileIds, u), "/config/etapas", SIS);
```

`src/app/(app)/config/etapas/page.tsx` inteiro:

```tsx
import { requirePerm } from "@/server/auth/session";
import { asc } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, stages } from "@/server/db/schema";
import { StagesEditor } from "@/components/config/stages";
import { HoursEditor } from "@/components/config/hours";
import { getBusinessHours } from "@/server/rules/engine";
export const metadata = { title: "Etapas e prazos" };
export default async function EtapasPage() {
  await requirePerm("config.sistema");
  const [st, hours, profs] = await Promise.all([
    db.select().from(stages).orderBy(asc(stages.position)), getBusinessHours(),
    db.select({ id: profiles.id, name: profiles.name, key: profiles.key }).from(profiles).orderBy(asc(profiles.name)),
  ]);
  return (
    <>
      <HoursEditor hours={hours} />
      <StagesEditor
        stages={st.map((s) => ({ id: s.id, key: s.key, name: s.name, kind: s.kind, slaMinutes: s.slaMinutes, staleDays: s.staleDays, color: s.color, active: s.active, visibleProfileIds: s.visibleProfileIds, attemptDays: s.attemptDays }))}
        profiles={profs.filter((p) => p.key !== "gestao").map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
```

Trocar `src/components/config/stages.tsx` inteiro por:

```tsx
"use client";
import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createStageAction, deleteStageAction, moveStageAction, setStageProfilesAction, updateStageAction } from "@/app/(app)/config/actions";
import { SPRING_UI } from "@/lib/motion";
import { KIND_LABEL, STAGE_KINDS, type StageKindName } from "@/lib/stage-kind-labels";

type S = {
  id: string; key: string; name: string; kind: StageKindName; slaMinutes: number | null; staleDays: number | null; color: string; active: boolean;
  visibleProfileIds: string[] | null; attemptDays: number[] | null;
};
type P = { id: string; name: string };
const GRID = "lg:grid-cols-[64px_1.4fr_120px_130px_120px_70px_auto]";

/** Etapas: nome, ordem, tipo, prazo, limite e cor; criar, apagar e quem vê no Quadro (Lote 4). As desativadas ficam recolhidas. */
export function StagesEditor({ stages, profiles }: { stages: S[]; profiles: P[] }) {
  const active = stages.filter((s) => s.active), inactive = stages.filter((s) => !s.active);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-graphite mb-4 max-w-[70ch]">O <b>prazo de resposta</b> é quando o card fica vermelho para quem atende. O <b>limite parado</b> é usado pela automação de conversa parada. Deixe em branco para não usar. A <b>primeira etapa de cada tipo</b> é a que o sistema usa (novo contato, agendado, atendida…); uma etapa extra do mesmo tipo fica depois dela e serve para mover à mão.</p>
        <div className="rounded-[var(--radius-card)] border border-line bg-paper">
          <div className={`hidden lg:grid ${GRID} gap-3 px-4 py-2.5 text-xs text-muted border-b border-line`}>
            <span>Ordem</span><span>Nome</span><span>Tipo</span><span>Prazo de resposta</span><span>Limite parado</span><span>Cor</span><span />
          </div>
          {active.map((s, i) => <Row key={s.id} s={s} profiles={profiles} first={i === 0} last={i === active.length - 1} />)}
        </div>
      </div>
      <NewStage stages={active} profiles={profiles} />
      {inactive.length > 0 && (
        <details className="rounded-[var(--radius-card)] border border-line bg-paper-2/60">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm text-graphite">Desativadas ({inactive.length}): somem das telas; o histórico antigo continua com o nome</summary>
          <ul className="border-t border-line px-4 py-2 text-sm text-graphite">{inactive.map((s) => <li key={s.id} className="py-1">{s.name} · {KIND_LABEL[s.kind]}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ s, profiles, first, last }: { s: S; profiles: P[]; first: boolean; last: boolean }) {
  const [v, setV] = useState({ name: s.name, sla: s.slaMinutes?.toString() ?? "", stale: s.staleDays?.toString() ?? "", color: s.color });
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = v.name !== s.name || v.sla !== (s.slaMinutes?.toString() ?? "") || v.stale !== (s.staleDays?.toString() ?? "") || v.color !== s.color;
  const save = () => start(async () => {
    const r = await updateStageAction(s.id, { name: v.name, slaMinutes: v.sla ? Number(v.sla) : null, staleDays: v.stale ? Number(v.stale) : null, color: v.color });
    toast(r.ok ? `Etapa "${v.name}" salva` : r.error, r.ok ? "ok" : "error");
  });
  const move = (dir: -1 | 1) => start(async () => { const r = await moveStageAction(s.id, dir); if (!r.ok) toast(r.error, "error"); });
  const remove = () => start(async () => {
    const r = await deleteStageAction(s.id);
    setConfirm(false);
    toast(r.ok ? (r.data?.mode === "desativada" ? `"${s.name}" desativada (já teve conversas)` : `"${s.name}" apagada`) : r.error, r.ok ? "ok" : "error");
  });
  return (
    <motion.div layout transition={SPRING_UI} className="border-b border-line/70 last:border-0">
      <div className={`flex flex-wrap lg:grid ${GRID} gap-3 px-4 py-3 lg:py-2.5 items-center`}>
        <div className="flex gap-1">
          <button disabled={first || pending} aria-label={`Subir ${s.name}`} onClick={() => move(-1)} className="size-7 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↑</button>
          <button disabled={last || pending} aria-label={`Descer ${s.name}`} onClick={() => move(1)} className="size-7 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↓</button>
        </div>
        <Input className="flex-1 min-w-[160px] lg:flex-none" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Nome da etapa" />
        <span className="text-sm text-graphite">{KIND_LABEL[s.kind]}</span>
        <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.sla} onChange={(e) => setV({ ...v, sla: e.target.value })} className="w-20" aria-label="Prazo de resposta em minutos" /><span className="text-xs text-muted">min</span></label>
        <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.stale} onChange={(e) => setV({ ...v, stale: e.target.value })} className="w-16" aria-label="Limite parado em dias" /><span className="text-xs text-muted">dias</span></label>
        <input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} aria-label="Cor" className="size-9 rounded-[8px] border border-line cursor-pointer bg-transparent" />
        <div className="flex gap-1.5">
          <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={pending} onClick={save}>Salvar</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Apagar a etapa ${s.name}`}>Apagar</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-3 text-sm">
        <WhoSees s={s} profiles={profiles} />
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Apagar "${s.name}"?`}
        description="Se alguma conversa já passou por ela, a etapa é desativada: some das telas e o histórico continua com o nome. Conversas abertas nela precisam ser movidas antes."
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={remove}>Apagar</Button></>} />
    </motion.div>
  );
}

function WhoSees({ s, profiles }: { s: S; profiles: P[] }) {
  const [ids, setIds] = useState<string[]>(s.visibleProfileIds ?? []);
  const [pending, start] = useTransition(); const toast = useToast();
  const toggle = (id: string) => {
    const before = ids, next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    start(async () => { const r = await setStageProfilesAction(s.id, next.length ? next : null); if (!r.ok) { toast(r.error, "error"); setIds(before); } });
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1" disabled={pending}>
      <legend className="sr-only">Quem vê {s.name} no Quadro</legend>
      <span className="text-muted">No Quadro, quem vê: {ids.length ? "" : "todos"}</span>
      {profiles.map((p) => (
        <label key={p.id} className="inline-flex min-h-11 lg:min-h-0 items-center gap-1.5">
          <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`${p.name} vê ${s.name}`} />{p.name}
        </label>
      ))}
      <span className="text-xs text-muted">(a gestão vê todas; a Fila mostra toda conversa esperando resposta)</span>
    </fieldset>
  );
}

function NewStage({ stages, profiles }: { stages: S[]; profiles: P[] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StageKindName>("atendimento");
  const [after, setAfter] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [pending, start] = useTransition(); const toast = useToast();
  const submit = () => start(async () => {
    const r = await createStageAction({ name, kind, afterId: after || null, visibleProfileIds: ids.length ? ids : null });
    if (r.ok) { toast(`Etapa "${name.trim()}" criada`); setName(""); setIds([]); setAfter(""); } else toast(r.error, "error");
  });
  return (
    <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4 max-w-[760px]" aria-label="Nova etapa"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-base font-medium">Nova etapa</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-graphite">Nome<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex.: Avaliação marcada" /></label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Tipo
          <Select value={kind} onChange={(e) => setKind(e.target.value as StageKindName)}>{STAGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Depois de
          <Select value={after} onChange={(e) => setAfter(e.target.value)}><option value="">a primeira do mesmo tipo</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <legend className="mb-1 text-graphite">Quem vê no Quadro (nenhum marcado = todos)</legend>
        {profiles.map((p) => (
          <label key={p.id} className="inline-flex min-h-11 lg:min-h-0 items-center gap-1.5">
            <input type="checkbox" checked={ids.includes(p.id)} onChange={() => setIds((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} />{p.name}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-muted">A etapa nova copia o prazo, o limite e a cor da primeira do mesmo tipo e entra nos mesmos avisos de espera.</p>
      <div><Button type="submit" loading={pending} disabled={name.trim().length < 2}>Criar etapa</Button></div>
    </form>
  );
}
```

- [ ] **Passo 6: e2e (criar, ver no Quadro, apagar)**

Em `e2e/config-lote4.spec.ts`, acrescentar:

```ts
test("gestão cria uma etapa, ela aparece no Quadro; apagar sem histórico tira de vez", async ({ page }) => {
  await login(page);
  await page.goto("/config/etapas");
  const form = page.getByRole("form", { name: "Nova etapa" });
  await form.getByLabel("Nome").fill("Avaliação marcada");
  await form.getByLabel("Tipo").selectOption({ label: "Agendado" });
  await form.getByRole("button", { name: "Criar etapa" }).click();
  await expect(page.getByText('Etapa "Avaliação marcada" criada')).toBeVisible();
  await page.goto("/funil");
  await expect(page.getByText("Avaliação marcada", { exact: true }).first()).toBeVisible();
  await page.goto("/config/etapas");
  await page.getByRole("button", { name: "Apagar a etapa Avaliação marcada" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByText('"Avaliação marcada" apagada')).toBeVisible();
});
```

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/stage-admin.test.ts src/server/domain/config.test.ts src/server/queries/board.test.ts src/server/db && npm run typecheck && npm run lint`
Esperado: PASS.

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/config-lote4.spec.ts e2e/quadro.spec.ts`
Esperado: PASS.

- [ ] **Passo 8: Commit**

```bash
git add src/lib/stage-kind-labels.ts src/lib/stage-visibility.ts src/server/domain/stage-admin.ts src/server/domain/stage-admin.test.ts src/server/domain/config.ts \
  "src/app/(app)/config/actions.ts" "src/app/(app)/config/etapas/page.tsx" src/components/config/stages.tsx src/server/queries/board.ts e2e/config-lote4.spec.ts
git commit -m "feat(config): criar e apagar etapa (tipo, ordem, quem vê no Quadro), com os avisos de espera garantidos na etapa nova

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.5: Sequência do "Aguardando" configurável (os 3 dias das tentativas por etapa)

**Arquivos:**
- Modificar (código do 1C): `src/lib/attempts.ts` (+ `attemptDaysOf`), `src/server/domain/attempts.ts` (`startAttemptsTx`), `src/server/domain/funnel.ts` (`sweepAttempts`)
- Modificar: `src/server/domain/stage-admin.ts` (+ `setStageAttemptDays`), `src/app/(app)/config/actions.ts`, `src/components/config/stages.tsx` (+ `AttemptDays`)
- Teste: `src/server/domain/attempt-days.test.ts`

**Interfaces:**
- Consome: `stages.attemptDays` (Tarefa 0); do 1C: `ATTEMPT_DAYS`, `MAX_ATTEMPTS`, `WaitingKind`, `isWaitingKind` (`src/lib/attempts.ts`), `startAttemptsTx`, `sweepAttempts`, `moveToKindTx`, `stageByKind`.
- Produz:
  - `attemptDaysOf(kind: WaitingKind, custom: readonly number[] | null | undefined): readonly [number, number, number]`
  - `attemptDaysSchema` e `setStageAttemptDays(id, days: number[] | null, userId)` (só Aguardando cliente e Orçamento; 3 números de 1 a 60, crescentes; `null` = padrão)
  - action `setStageAttemptDaysAction(id, days | null)` (`config.sistema`)
- Regra: continuam 3 tentativas (decisão 3 do dono); muda só em que dias elas caem.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/server/domain/attempt-days.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { attemptDaysOf } from "../../lib/attempts";
import { moveToKindTx, recordOutbound, stageByKind } from "./deals";
import { sweepAttempts } from "./funnel";
import { setStageAttemptDays } from "./stage-admin";

const T = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m)); // outubro/2026, hora de Salvador
let g = "";
beforeEach(async () => { await resetDb(); g = (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor" }).returning())[0].id; });

async function conversaEmAguardando(at: Date) {
  const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571990000301" }).returning();
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: (await stageByKind("atendimento")).id, stageEnteredAt: at, createdAt: at }).returning();
  await db.transaction((tx) => moveToKindTx(tx, d.id, "followup", null, "manual", at));
  return d.id;
}

describe("dias das tentativas por etapa (Lote 4)", () => {
  it("lista torta vale o padrão do tipo", () => {
    expect(attemptDaysOf("followup", null)).toEqual([1, 3, 7]);
    expect(attemptDaysOf("proposta", [2, 4])).toEqual([2, 4, 8]);
    expect(attemptDaysOf("followup", [3, 2, 9])).toEqual([1, 3, 7]);
    expect(attemptDaysOf("followup", [2, 5, 10])).toEqual([2, 5, 10]);
  });

  it("só aceita 3 números de 1 a 60, crescentes, e só em Aguardando cliente ou Orçamento", async () => {
    const f = await stageByKind("followup");
    await expect(setStageAttemptDays(f.id, [2, 2, 9], g)).rejects.toThrow("cada tentativa depois da anterior");
    await expect(setStageAttemptDays(f.id, [1, 3, 90], g)).rejects.toThrow("de 1 a 60");
    await expect(setStageAttemptDays((await stageByKind("agendado")).id, [1, 3, 7], g)).rejects.toThrow("só Aguardando cliente e Orçamento");
  });

  it("a 1ª tentativa nasce no 1º dia da etapa e a varredura usa o 2º", async () => {
    const f = await stageByKind("followup");
    await setStageAttemptDays(f.id, [2, 5, 10], g);
    const id = await conversaEmAguardando(T(13, 10)); // terça 10h
    let [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.followupAttempt).toBe(1);
    expect(d.followupDueAt!.toISOString()).toBe(T(15, 10).toISOString()); // D+2, quinta 10h

    await recordOutbound({ dealId: id, channelId: null, externalId: "o1", body: "Oi, tudo bem?", fromPhone: true, at: T(15, 11) }); // a Casa tentou no dia
    await sweepAttempts(T(15, 11, 5));
    [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.followupAttempt).toBe(2);
    expect(d.followupDueAt!.toISOString()).toBe(T(19, 10).toISOString()); // D+5 a partir da entrada = domingo 18 → fechado → segunda 19
  });
});
```

Observação para o executor: o último `expect` depende de qual dia a Casa está fechada no horário dos testes. Sem `business_hours` salvo, vale o padrão de `src/lib/business-hours.ts:5` (seg–sex 8–20h, sáb 8–17h; domingo fechado), então D+5 de terça 13/10 = domingo 18/10 → segunda 19/10 às 10h. Se o `DEFAULT_HOURS` for outro, ajuste só a data esperada com a regra de `attemptDueAt` (próximo dia aberto, 10h).

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/attempt-days.test.ts`
Esperado: FAIL ("attemptDaysOf is not a function", "setStageAttemptDays is not a function").

- [ ] **Passo 3: Implementar**

Em `src/lib/attempts.ts` (1C), depois de `ATTEMPT_DAYS`:

```ts
/** Os 3 dias das tentativas da etapa: os de Configurações › Etapas (Lote 4) ou o padrão do tipo. Lista torta vale o padrão. */
export function attemptDaysOf(kind: WaitingKind, custom: readonly number[] | null | undefined): readonly [number, number, number] {
  if (custom && custom.length === MAX_ATTEMPTS && custom.every((d, i) => Number.isInteger(d) && d >= 1 && d <= 60 && (i === 0 || d > custom[i - 1]))) {
    return [custom[0], custom[1], custom[2]];
  }
  return ATTEMPT_DAYS[kind];
}
```

Em `src/server/domain/attempts.ts` (1C), `startAttemptsTx`:
- acrescentar `stages` ao import do schema e `attemptDaysOf` ao import de `../../lib/attempts`;
- trocar a linha `dueAt = opts.resumeAt ?? attemptDueAt(at.getTime(), ATTEMPT_DAYS[kind][0], await getBusinessHours(tx));` por:

```ts
    const [st] = await tx.select({ attemptDays: stages.attemptDays }).from(stages).where(eq(stages.id, deal.stageId));
    dueAt = opts.resumeAt ?? attemptDueAt(at.getTime(), attemptDaysOf(kind, st?.attemptDays)[0], await getBusinessHours(tx));
```

(o `deal` que chega é o já movido: `moveDealTx` chama `startAttemptsTx(tx, updated, …)`; conferir com `grep -n "startAttemptsTx(tx" src/server/domain/deals.ts`).

Em `src/server/domain/funnel.ts` (1C), `sweepAttempts`:
- no `select` do SQL, acrescentar `s.attempt_days as "attemptDays",` (logo depois de `s.kind::text as kind,`);
- no tipo `AttemptRow`, acrescentar `attemptDays: number[] | null;`;
- trocar `ATTEMPT_DAYS[r.kind][next - 1]` por `attemptDaysOf(r.kind, r.attemptDays)[next - 1]` (e o import).

Conferir que não sobrou uso direto: `grep -rn "ATTEMPT_DAYS\[" src` só pode mostrar `src/lib/attempts.ts`. Se algum texto de tela do 1C mostrar "D+1/D+3/D+7" fixo, trocar pelos dias da etapa quando ela estiver à mão, ou deixar escrito "padrão".

Em `src/server/domain/stage-admin.ts`, acrescentar (com `isWaitingKind` importado de `../../lib/attempts`):

```ts
export const attemptDaysSchema = z.array(z.number().int("Use dias inteiros.").min(1, "Use de 1 a 60 dias.").max(60, "Use de 1 a 60 dias.")).length(3, "São 3 tentativas.")
  .refine((d) => d[0] < d[1] && d[1] < d[2], "Coloque cada tentativa depois da anterior (ex.: 1, 3 e 7 dias).").nullable();

/** Em que dias caem as 3 tentativas da etapa (Aguardando cliente, Orçamento). null = o padrão do tipo. */
export async function setStageAttemptDays(id: string, days: number[] | null, userId: string): Promise<void> {
  const [s] = await db.select().from(stages).where(eq(stages.id, id));
  if (!s) throw new UserFacingError("Essa etapa não existe mais.");
  if (!isWaitingKind(s.kind)) throw new UserFacingError("Tentativas existem só Aguardando cliente e Orçamento.");
  const v = attemptDaysSchema.parse(days);
  await db.update(stages).set({ attemptDays: v }).where(eq(stages.id, id));
  await db.insert(auditLog).values({ userId, action: "editou", entity: "stage", entityId: id, data: { tentativas: v } });
}
```

A mensagem de erro do tipo errado precisa conter "só Aguardando cliente e Orçamento" (o teste procura esse trecho). Para o zod virar texto na tela, a action usa o `run` (o `fail` junta as mensagens do zod).

Em `src/app/(app)/config/actions.ts`:

```ts
export const setStageAttemptDaysAction = async (id: string, days: number[] | null) =>
  run((u) => stageAdmin.setStageAttemptDays(z.string().uuid().parse(id), days, u), "/config/etapas", SIS);
```

Em `src/components/config/stages.tsx`:
- imports: `setStageAttemptDaysAction` (de actions) e `ATTEMPT_DAYS, isWaitingKind` de `@/lib/attempts`;
- em `Row`, no `div` de baixo (onde está `<WhoSees … />`), acrescentar `{isWaitingKind(s.kind) && <AttemptDays s={s} />}`;
- acrescentar:

```tsx
function AttemptDays({ s }: { s: S }) {
  const def = ATTEMPT_DAYS[s.kind as "followup" | "proposta"];
  const [d, setD] = useState((s.attemptDays ?? [...def]).map(String));
  const [pending, start] = useTransition(); const toast = useToast();
  const nums = d.map(Number);
  const isDefault = nums.every((n, i) => n === def[i]);
  const dirty = nums.some((n, i) => n !== (s.attemptDays ?? def)[i]);
  const save = () => start(async () => {
    const r = await setStageAttemptDaysAction(s.id, isDefault ? null : nums);
    toast(r.ok ? "Tentativas salvas" : r.error, r.ok ? "ok" : "error");
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-muted">Tentativas:</span>
      {d.map((x, i) => (
        <label key={i} className="inline-flex items-center gap-1">D+<Input type="number" min={1} max={60} value={x} className="w-16 h-9" aria-label={`Dias até a tentativa ${i + 1} em ${s.name}`}
          onChange={(e) => setD(d.map((y, j) => (j === i ? e.target.value : y)))} /></label>
      ))}
      <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={pending} onClick={save}>Salvar</Button>
      <span className="text-xs text-muted">padrão {def.map((n) => `D+${n}`).join(", ")}; depois da 3ª, 2 dias para a cliente responder</span>
    </span>
  );
}
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/attempt-days.test.ts src/server/domain/funnel-attempts.test.ts src/server/domain/attempts.test.ts src/lib/attempts.test.ts && npm run typecheck && npm run lint`
Esperado: PASS (os testes do 1C continuam verdes: sem dias na etapa, vale o padrão).

- [ ] **Passo 5: Commit**

```bash
git add src/lib/attempts.ts src/server/domain/attempts.ts src/server/domain/funnel.ts src/server/domain/stage-admin.ts src/server/domain/attempt-days.test.ts \
  "src/app/(app)/config/actions.ts" src/components/config/stages.tsx
git commit -m "feat(config): dias das 3 tentativas do Aguardando e do Orçamento configuráveis por etapa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.6: Profissionais em lista compacta (ativas; desativadas recolhidas)

**Arquivos:**
- Modificar: `src/components/config/professionals.tsx`
- Teste: `src/components/config/professionals.test.tsx`

**Interfaces:**
- Consome: `Professional` (`src/server/domain/professionals.ts`), `createProfessionalAction`, `updateProfessionalAction` (já existem).
- Produz: `ProfessionalsEditor({ items, services })` com busca, "Ativas (N)" em linhas compactas, "Desativadas (N)" num `<details>` fechado, e o editor completo de hoje (`Row`, com os serviços) só ao tocar em "Editar".
- **Não muda** o editor de serviços (`ServicePicker`, `serviceIds`): é da outra frente (vínculo profissional↔serviço). Só passa a aparecer dentro do "Editar", o que tira os 88 mil px da página.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/components/config/professionals.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/config/actions", () => ({ createProfessionalAction: vi.fn(), updateProfessionalAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ProfessionalsEditor } from "./professionals";

afterEach(cleanup);

const items = [
  { id: "1", name: "MAIARA", fullName: "Maiara Teste", role: "Cabeleireira", active: true, serviceIds: ["s1"] },
  { id: "2", name: "JOÃO", fullName: null, role: null, active: true, serviceIds: [] },
  { id: "3", name: "ANTIGA", fullName: null, role: null, active: false, serviceIds: [] },
];
const services = [{ id: "s1", label: "Corte" }, { id: "s2", label: "Escova" }];

it("lista compacta: ativas por nome, desativadas recolhidas, serviços só ao abrir Editar; busca sem acento", () => {
  const { container } = render(<ProfessionalsEditor items={items} services={services} />);
  expect(screen.getByText("Ativas (2)")).toBeTruthy();
  expect(screen.getByText("Desativadas (1)").closest("details")!.hasAttribute("open")).toBe(false);
  const pickers = () => container.querySelectorAll("button[aria-pressed]").length;
  expect(pickers()).toBe(2); // só os do formulário "Adicionar profissional"
  expect(screen.getByText("1 serviço")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Editar MAIARA" }));
  expect(pickers()).toBe(4);
  fireEvent.change(screen.getByLabelText("Buscar profissional"), { target: { value: "joao" } });
  expect(screen.getByText("Ativas (1)")).toBeTruthy();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/components/config/professionals.test.tsx`
Esperado: FAIL (não existe "Ativas (2)"; todos os cadastros já mostram os serviços).

- [ ] **Passo 3: Implementar**

Em `src/components/config/professionals.tsx`:
- `ServicePicker` e `Row` ficam **como estão**;
- trocar a lista do `ProfessionalsEditor` (o `<ul>` com `items.map(...)`) pela lista compacta; o formulário "Adicionar profissional" à direita continua igual. O componente passa a ser:

```tsx
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ProfessionalsEditor({ items, services }: { items: Pro[]; services: Service[] }) {
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const match = (p: Pro) => !q.trim() || norm(`${p.name} ${p.fullName ?? ""} ${p.role ?? ""}`).includes(norm(q.trim()));
  const ativas = items.filter((p) => p.active && match(p)), desativadas = items.filter((p) => !p.active && match(p));
  const list = (ps: Pro[]) => (
    <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
      {ps.map((p) => <li key={p.id}><Compact p={p} services={services} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} /></li>)}
    </ul>
  );

  if (!services.length) return (
    <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-sm text-graphite">
      Cadastre primeiro os serviços da Casa em <Link className="font-medium text-gold-ink underline underline-offset-4" href="/config/listas?aba=service">Listas e respostas › Serviços</Link>.
    </p>
  );
  return (
    <div>
      <p className="mb-4 text-sm text-graphite">Quem faz cada serviço. Ao agendar, a equipe escolhe o serviço e aparecem só as profissionais que fazem. O apelido é o nome que aparece na agenda; o nome completo liga as vendas que vêm do Avec. Toque em Editar para mudar nome, cargo e serviços.</p>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar profissional" aria-label="Buscar profissional" className="max-w-[20rem]" />
          <section aria-labelledby="pros-ativas">
            <h2 id="pros-ativas" className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Ativas ({ativas.length})</h2>
            {ativas.length ? list(ativas) : <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-center text-sm text-muted">{q ? "Nenhuma ativa com esse nome." : "Nenhuma profissional ativa."}</p>}
          </section>
          {desativadas.length > 0 && (
            <details className="rounded-[var(--radius-card)] border border-line bg-paper-2/60">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm text-graphite">Desativadas ({desativadas.length})</summary>
              <div className="p-2">{list(desativadas)}</div>
            </details>
          )}
        </div>
        {/* o <form> "Adicionar profissional" de hoje, sem mudança */}
      </div>
    </div>
  );
}

/** Uma linha por profissional: apelido, cargo e quantos serviços; o editor completo (Row) só abre no "Editar". */
function Compact({ p, services, open, onToggle }: { p: Pro; services: Service[]; open: boolean; onToggle: () => void }) {
  const n = p.serviceIds.length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1"><span className="font-medium">{p.name}</span>{p.role && <span className="text-sm text-muted"> · {p.role}</span>}</span>
        <span className="text-sm text-graphite tabular">{n} {n === 1 ? "serviço" : "serviços"}</span>
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={onToggle} aria-label={`${open ? "Fechar" : "Editar"} ${p.name}`}>{open ? "Fechar" : "Editar"}</Button>
      </div>
      {open && <div className="border-t border-line/70"><Row p={p} services={services} /></div>}
    </div>
  );
}
```

(no lugar do comentário `{/* o <form> … */}`, manter o `<form>` "Adicionar profissional" que já existe hoje, sem mudar uma linha.)

- os imports `motion` e `AnimatePresence` saem se ficarem sem uso (o `npm run lint` acusa).

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/components/config/professionals.test.tsx src/server/domain/professionals.test.ts && npm run typecheck && npm run lint`
Esperado: PASS.

- [ ] **Passo 5: Commit**

```bash
git add src/components/config/professionals.tsx src/components/config/professionals.test.tsx
git commit -m "feat(config): Profissionais em lista compacta (ativas; desativadas recolhidas; editar abre o cadastro completo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Tarefa 4.7: Origens numa lista só ("Origens e links")

**Arquivos:**
- Criar: `src/components/config/origins.tsx`
- Modificar: `src/app/(app)/config/origens/page.tsx`, `src/components/config/sources.tsx` (exportar `NewSource` com nome já preenchido), `src/components/config/lists.tsx:15` (sai a aba Origens), `src/app/(app)/config/listas/page.tsx` (`?aba=origin` vai para Origens)
- Testes: `src/components/config/origins.test.tsx`, `e2e/config-lote4.spec.ts` (novo caso)

**Interfaces:**
- Consome: `addListItemAction`, `updateListItemAction`, `createSourceAction` (já existem); `listSources` (`src/server/domain/sources.ts`).
- Produz:
  - `SimpleOrigins({ items: { id; label; active }[], linked: string[] })` (origens de "Como conheceu?", com "Criar link e QR")
  - `NewSource({ open, onClose, initialLabel? })` exportado de `sources.tsx`
  - A aba "Origens e links" (`/config/origens`) mostra as duas listas; Listas e respostas não tem mais "Origens". Os dados continuam nas duas tabelas (`lists` kind `origin` e `lead_sources`); `originChoices` já junta as duas na conversa.

- [ ] **Passo 1: Escrever o teste que falha**

Criar `src/components/config/origins.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/config/actions", () => ({
  addListItemAction: vi.fn(async () => ({ ok: true })), updateListItemAction: vi.fn(async () => ({ ok: true })), setKeywordBoostAction: vi.fn(),
  saveServiceCycleDaysAction: vi.fn(), createSourceAction: vi.fn(async () => ({ ok: true })), setSourceActiveAction: vi.fn(),
}));
vi.mock("@/app/(app)/config/listas/actions", () => ({ saveServiceDetailsAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { SimpleOrigins } from "./origins";
import { ListsEditor } from "./lists";

afterEach(cleanup);

it("origens numa lista só: a que já tem link aparece assim; 'Criar link e QR' abre a origem com link já com o nome", () => {
  render(<SimpleOrigins items={[{ id: "o1", label: "Instagram", active: true }, { id: "o2", label: "Indicação", active: true }]} linked={["indicacao"]} />);
  expect(screen.getByText("Tem link e QR")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Criar link e QR para Indicação" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Criar link e QR para Instagram" }));
  expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Instagram");
});

it("Listas e respostas não tem mais a aba Origens", () => {
  render(<ListsEditor items={[]} />);
  expect(screen.queryByRole("tab", { name: "Origens" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Serviços" })).toBeTruthy();
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/components/config/origins.test.tsx`
Esperado: FAIL ("Failed to resolve import ./origins"; a aba Origens ainda existe).

- [ ] **Passo 3: Implementar**

Em `src/components/config/sources.tsx`, trocar a assinatura e o estado inicial do `NewSource`:

```tsx
export function NewSource({ open, onClose, initialLabel = "" }: { open: boolean; onClose: () => void; initialLabel?: string }) {
  const [label, setLabel] = useState(initialLabel); const [kind, setKind] = useState<SourceKind>("instagram"); const [prefill, setPrefill] = useState(PREFILL_HINT.instagram);
```

(o resto do `NewSource` não muda).

Criar `src/components/config/origins.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addListItemAction, updateListItemAction } from "@/app/(app)/config/actions";
import { NewSource } from "./sources";

type O = { id: string; label: string; active: boolean };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Origens numa lista só (Lote 4): as de "Como conheceu?" (só o nome) e, abaixo, as que têm link e QR. "Criar link e QR" abre a origem com
 * link já com o nome. Na conversa as duas aparecem juntas (`originChoices`).
 */
export function SimpleOrigins({ items, linked }: { items: O[]; linked: string[] }) {
  const [label, setLabel] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const hasLink = new Set(linked.map(norm));
  return (
    <section aria-labelledby="origens-simples">
      <h2 id="origens-simples" className="font-display text-[22px] font-medium">Origens</h2>
      <p className="mt-1 mb-4 max-w-[70ch] text-sm text-graphite">De onde as clientes vêm, para escolher em “Como conheceu?”. Para medir de verdade, crie um link e um QR: a cliente que chega por ele já entra com a origem certa.</p>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
          {items.map((o) => <li key={o.id}><OriginRow o={o} linked={hasLink.has(norm(o.label))} onLink={() => setLinking(o.label)} /></li>)}
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nenhuma origem ainda.</li>}
        </ul>
        <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4"
          onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addListItemAction("origin", label, null); if (r.ok) { setLabel(""); toast("Origem adicionada"); } else toast(r.error, "error"); }); }}>
          <p className="text-base font-medium">Adicionar origem</p>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Instagram" aria-label="Nome da nova origem" maxLength={60} />
          <Button type="submit" loading={pending} disabled={!label.trim()}>Adicionar</Button>
        </form>
      </div>
      <NewSource key={linking ?? "nova"} open={linking !== null} onClose={() => setLinking(null)} initialLabel={linking ?? ""} />
    </section>
  );
}

function OriginRow({ o, linked, onLink }: { o: O; linked: boolean; onLink: () => void }) {
  const [label, setLabel] = useState(o.label);
  const [pending, start] = useTransition(); const toast = useToast();
  const save = (active = o.active) => start(async () => { const r = await updateListItemAction(o.id, label, null, active); if (!r.ok) { toast(r.error, "error"); setLabel(o.label); } });
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${o.active ? "" : "opacity-60"}`}>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (label.trim() && label !== o.label) save(); }}
        aria-label={`Nome da origem ${o.label}`} className="h-9 max-w-[16rem] flex-1" maxLength={60} />
      {linked ? <span className="text-sm text-ok">Tem link e QR</span>
        : <Button size="sm" variant="secondary" onClick={onLink} aria-label={`Criar link e QR para ${o.label}`}>Criar link e QR</Button>}
      <Switch checked={o.active} disabled={pending} label={o.active ? `Desativar ${o.label}` : `Ativar ${o.label}`} onChange={(v) => save(v)} />
    </div>
  );
}
```

`src/app/(app)/config/origens/page.tsx`:
- imports: `lists` do schema e `SimpleOrigins` de `@/components/config/origins`;
- `export const metadata = { title: "Origens e links" };`;
- buscar as origens simples junto com as fontes:

```tsx
  const [srcs, simple] = await Promise.all([
    listSources(),
    db.select({ id: lists.id, label: lists.label, active: lists.active }).from(lists).where(eq(lists.kind, "origin")).orderBy(asc(lists.position), asc(lists.label)),
  ]);
```

- o `rows` passa a mapear `srcs` (no lugar de `await listSources()`), e o retorno vira:

```tsx
  return (
    <div className="flex flex-col gap-10">
      <SimpleOrigins items={simple} linked={srcs.map((s) => s.label)} />
      <section aria-labelledby="origens-links">
        <h2 id="origens-links" className="mb-1 font-display text-[22px] font-medium">Links e QR</h2>
        <SourcesEditor sources={rows} hasChannel={!!phone} />
      </section>
    </div>
  );
```

`src/components/config/lists.tsx:15`: tirar `["origin", "Origens", "De onde vêm os leads."],` de `TABS`.

`src/app/(app)/config/listas/page.tsx`:
- `import { redirect } from "next/navigation";`;
- `TAB_KINDS` sem `"origin"`;
- logo depois de ler `aba`: `if (aba === "origin") redirect("/config/origens");`;
- a página passa a mandar para o `ListsEditor` só os itens das abas que existem: `rows.filter((r) => r.kind !== "origin")`.

Em `src/lib/config-tabs.ts` a aba já se chama "Origens e links" (4.1).

- [ ] **Passo 4: e2e**

Em `e2e/config-lote4.spec.ts`, acrescentar:

```ts
test("Origens numa lista só: o link antigo de Listas leva para Origens e links", async ({ page }) => {
  await login(page);
  await page.goto("/config/listas?aba=origin");
  await expect(page).toHaveURL(/\/config\/origens$/);
  await expect(page.getByRole("heading", { name: "Origens", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Links e QR" })).toBeVisible();
  await page.goto("/config/listas");
  await expect(page.getByRole("tab", { name: "Origens" })).toHaveCount(0);
});
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/components/config src/lib/origin-choices.test.ts && npm run typecheck && npm run lint`
Esperado: PASS.

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/config-lote4.spec.ts e2e/atendimento-b.spec.ts e2e/config-mensagens.spec.ts`
Esperado: PASS.

- [ ] **Passo 6: Commit**

```bash
git add src/components/config/origins.tsx src/components/config/origins.test.tsx src/components/config/sources.tsx src/components/config/lists.tsx \
  "src/app/(app)/config/origens/page.tsx" "src/app/(app)/config/listas/page.tsx" e2e/config-lote4.spec.ts
git commit -m "feat(config): Origens e links numa lista só (origens de Como conheceu? e as com link e QR)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.8: Mensagens automáticas de boas-vindas, ausência e encerramento (prontas e DESLIGADAS)

**Arquivos:**
- Criar: `src/lib/auto-message-text.ts`, `src/server/domain/auto-message-settings.ts`, `src/server/domain/auto-messages.ts`, `src/components/config/auto-messages.tsx`
- Modificar: `src/server/domain/outbox.ts` (`processItem`, depois do ramo `automacao:`), `src/server/domain/deals.ts` (`recordInbound`, depois do `maybeAutoReply`), `src/server/domain/conversation-archive.ts` (`archiveConversation`), `src/server/domain/auto-reply.ts` (`{nome}`), `src/app/(app)/config/actions.ts`, `src/app/(app)/config/mensagens/page.tsx`
- Testes: `src/server/domain/auto-messages.test.ts`, `src/components/config/auto-messages.test.tsx`

**Interfaces:**
- Consome: `enqueueAutomated`, `drainOutbox` (`outbox.ts`); `AUTO_REPLY_GAP_MS`, `AUTO_REPLY_MAX_AGE_MS` (`auto-reply.ts`); `isOpen`, `getBusinessHours`, `isQuiet`; `runSafe`, `SIS` (4.1); `SendConfirmDialog`.
- Produz:
  - `fillName(tpl, name): string` (`{nome}` → primeiro nome; sem nome, some com a vírgula; nunca o telefone)
  - `AUTO_MESSAGE_KINDS = ["boas_vindas", "ausencia", "encerramento"]`, `type AutoMessageKind`, `AUTO_MESSAGE_SOURCE = "msg_auto:"`, `autoMessageSchema`, `getAutoMessage(kind)`, `saveAutoMessage(kind, input, userId)`, `autoMessageCancelReason(source, meta, deal, createdAt, now)` (chaves em `settings`: `msg_boas_vindas`, `msg_ausencia`, `msg_encerramento`; sem a chave = desligada)
  - `afterInbound({ dealId, created, at, now? }): Promise<AutoMessageKind | null>` e `afterConversationClosed(dealId, now?): Promise<boolean>`
  - action `saveAutoMessageAction(kind, v)` (`config.sistema`) e `AutoMessageEditor({ kind, initial, note? })`
- Regras: boas-vindas = primeira mensagem do contato, Casa aberta; ausência = Casa aberta e ninguém Disponível; as duas dividem com a "fora do horário" a janela de 12 h por cliente e no máximo uma sai por mensagem; encerramento = ao tocar em "Encerrar conversa". Item que fica mais de 30 min na fila, cuja mensagem foi desligada ou cuja conversa mudou é cancelado na hora de enviar. Nada é ligado pelo seed nem pelo plano.

- [ ] **Passo 1: Escrever os testes que falham**

Criar `src/server/domain/auto-messages.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { fillName } from "../../lib/auto-message-text";
import { recordInbound } from "./deals";
import { archiveConversation } from "./conversation-archive";
import { drainOutbox } from "./outbox";
import { getAutoMessage, saveAutoMessage } from "./auto-message-settings";

// Provider falso (como em outbox.test.ts): nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: "OUT" + sent.length }; },
  sendPoll: async () => ({ externalId: "POLL1" }),
};
const OPEN = new Date("2026-10-13T13:00:00Z");   // terça 10h em Salvador: aberta no horário padrão
const CLOSED = new Date("2026-10-13T02:00:00Z"); // segunda 23h: fechada
let g = "", chId = "";

beforeEach(async () => {
  sent.length = 0; await resetDb(); setWhatsappProvider(fake);
  g = (await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor", availability: "ausente" }).returning())[0].id;
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});
afterEach(() => setWhatsappProvider(null));

const escreve = (phone: string, at: Date, name = "Carla Werneck") =>
  recordInbound({ channelId: chId, externalId: `${phone}-${at.getTime()}`, phoneRaw: phone, pushName: name, body: "oi", at, now: at });
const fila = () => db.select().from(outbox);

describe("mensagens automáticas novas (Lote 4)", () => {
  it("nascem desligadas: cliente nova escreve com a Casa aberta e nada entra na fila", async () => {
    for (const k of ["boas_vindas", "ausencia", "encerramento"] as const) expect(await getAutoMessage(k)).toEqual({ enabled: false, text: "" });
    await escreve("71990000401", OPEN);
    expect(await fila()).toEqual([]);
  });

  it("boas-vindas ligada: só no primeiro contato, com a Casa aberta, com o primeiro nome", async () => {
    await saveAutoMessage("boas_vindas", { enabled: true, text: "Oi, {nome}! Que bom te ver por aqui." }, g);
    await escreve("71990000402", OPEN);
    expect((await fila()).map((i) => i.text)).toEqual(["Oi, Maria! Que bom te ver por aqui."]);
    await escreve("71990000402", new Date(OPEN.getTime() + 60_000));        // a mesma cliente de novo
    await escreve("71990000403", CLOSED, "Bia Teste");                         // Casa fechada: é a "fora do horário" (desligada)
    expect(await fila()).toHaveLength(1);
  });

  it("ausência ligada: sai quando ninguém está Disponível; com alguém Disponível, não", async () => {
    await saveAutoMessage("ausencia", { enabled: true, text: "Oi! Já, já alguém te responde." }, g);
    await escreve("71990000404", OPEN);
    expect(await fila()).toHaveLength(1);
    await db.update(users).set({ availability: "disponivel" }).where(eq(users.id, g));
    await escreve("71990000405", OPEN, "Caio Teste");
    expect(await fila()).toHaveLength(1);
  });

  it("encerramento ligado: sai ao encerrar a conversa", async () => {
    await saveAutoMessage("encerramento", { enabled: true, text: "Obrigada, {nome}! Até a próxima." }, g);
    const r = await escreve("71990000406", OPEN);
    if (!("dealId" in r)) throw new Error("sem lead");
    await archiveConversation(r.dealId, g);
    expect((await fila()).map((i) => i.text)).toEqual(["Obrigada, Maria! Até a próxima."]);
  });

  it("desligada depois de entrar na fila: na hora de enviar é cancelada e nada sai", async () => {
    await saveAutoMessage("boas_vindas", { enabled: true, text: "Oi, {nome}!" }, g);
    await escreve("71990000407", OPEN);
    await saveAutoMessage("boas_vindas", { enabled: false, text: "Oi, {nome}!" }, g);
    await drainOutbox(new Date(OPEN.getTime() + 60_000));
    expect(sent).toEqual([]);
    expect((await fila())[0]).toMatchObject({ status: "cancelled", error: "A mensagem automática foi desligada." });
  });

  it("ligar exige texto", async () => {
    await expect(saveAutoMessage("ausencia", { enabled: true, text: "" }, g)).rejects.toThrow("Escreva o texto antes de ligar");
  });

  it("{nome}: o primeiro nome; sem nome some com a vírgula (nunca o telefone)", () => {
    expect(fillName("Oi, {nome}! Tudo bem?", "Carla Werneck")).toBe("Oi, Maria! Tudo bem?");
    expect(fillName("Oi, {nome}! Tudo bem?", null)).toBe("Oi! Tudo bem?");
  });

  it("a fora do horário (que já existia) também troca {nome} pelo primeiro nome", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi, {nome}! Respondemos quando a Casa abrir." } });
    await escreve("71990000408", CLOSED);
    expect((await fila()).map((i) => i.text)).toEqual(["Oi, Maria! Respondemos quando a Casa abrir."]);
  });
});
```

Criar `src/components/config/auto-messages.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save } = vi.hoisted(() => ({ save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })) }));
vi.mock("@/app/(app)/config/actions", () => ({ saveAutoMessageAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AutoMessageEditor } from "./auto-messages";

afterEach(cleanup);

it("ligar pede a confirmação de envio real; cancelar não liga nada", async () => {
  render(<AutoMessageEditor kind="ausencia" initial={{ enabled: false, text: "Oi, {nome}!" }} />);
  expect(screen.getByLabelText("Prévia de Ausência").textContent).toBe("Oi, Maria!");
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Ausência" }));
  expect(screen.getByText("Isto vai enviar mensagens reais para clientes.", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Ausência" }));
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("ausencia", { enabled: true, text: "Oi, {nome}!" }));
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/domain/auto-messages.test.ts src/components/config/auto-messages.test.tsx`
Esperado: FAIL (módulos não existem; a "fora do horário" manda `{nome}` cru).

- [ ] **Passo 3: Texto, configurações e a regra**

Criar `src/lib/auto-message-text.ts`:

```ts
/** {nome} → o primeiro nome da cliente; sem nome, some junto com a vírgula ("Oi, {nome}!" → "Oi!"). Nunca o telefone. */
export function fillName(tpl: string, name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (first) return tpl.replaceAll("{nome}", first).trim();
  return tpl.replace(/,?\s*\{nome\}/g, "").replace(/ {2,}/g, " ").replace(/\s+([!?.,])/g, "$1").trim();
}
```

Criar `src/server/domain/auto-message-settings.ts`:

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, settings, type Deal } from "../db/schema";

/** Mensagens automáticas do Lote 4 (além da "fora do horário"). Todas nascem DESLIGADAS; ligar pede a confirmação de envio real na tela. */
export const AUTO_MESSAGE_KINDS = ["boas_vindas", "ausencia", "encerramento"] as const;
export type AutoMessageKind = (typeof AUTO_MESSAGE_KINDS)[number];
/** `source` do item na fila de envio ("msg_auto:boas_vindas"…): reconferido na hora de enviar. */
export const AUTO_MESSAGE_SOURCE = "msg_auto:";
const KEY: Record<AutoMessageKind, string> = { boas_vindas: "msg_boas_vindas", ausencia: "msg_ausencia", encerramento: "msg_encerramento" };
export const AUTO_MESSAGE_MAX_CHARS = 500;
/** Item que ficou mais que isso na fila perdeu a hora (a Casa fechou no meio, o worker parou). */
export const AUTO_MESSAGE_MAX_QUEUE_MS = 30 * 60_000;

export const autoMessageSchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(AUTO_MESSAGE_MAX_CHARS, `O texto passou de ${AUTO_MESSAGE_MAX_CHARS} caracteres.`),
}).refine((v) => !v.enabled || v.text.length >= 3, { message: "Escreva o texto antes de ligar.", path: ["text"] });
export type AutoMessageConfig = z.infer<typeof autoMessageSchema>;

/** Sem a chave em `settings` = desligada e sem texto. */
export async function getAutoMessage(kind: AutoMessageKind): Promise<AutoMessageConfig> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY[kind]));
  const v = r?.value as Partial<AutoMessageConfig> | undefined;
  return { enabled: !!v?.enabled, text: v?.text ?? "" };
}

/** Salva o texto e liga/desliga. A confirmação "isto envia mensagens reais" é da tela; aqui fica a auditoria de quem ligou. */
export async function saveAutoMessage(kind: AutoMessageKind, input: unknown, userId: string): Promise<void> {
  const v = autoMessageSchema.parse(input);
  const before = await getAutoMessage(kind);
  await db.insert(settings).values({ key: KEY[kind], value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: KEY[kind], data: { enabled: v.enabled, text: v.text } });
}

/** Na hora de enviar: o motivo para cancelar (desligada, velha, a conversa mudou) ou null para seguir. */
export async function autoMessageCancelReason(source: string, meta: { awaiting?: string },
  deal: Pick<Deal, "awaitingReplySince" | "conversationArchivedAt" | "closedAt" | "lastInboundAt">, createdAt: Date, now: Date): Promise<string | null> {
  const kind = source.slice(AUTO_MESSAGE_SOURCE.length) as AutoMessageKind;
  if (!AUTO_MESSAGE_KINDS.includes(kind)) return "Mensagem automática desconhecida.";
  if (!(await getAutoMessage(kind)).enabled) return "A mensagem automática foi desligada.";
  if (now.getTime() - createdAt.getTime() > AUTO_MESSAGE_MAX_QUEUE_MS) return "A mensagem automática ficou mais de 30 minutos na fila.";
  if (kind === "encerramento") {
    if (!deal.conversationArchivedAt && !deal.closedAt) return "A conversa foi reaberta.";
    if (deal.lastInboundAt && deal.lastInboundAt.getTime() > createdAt.getTime()) return "A cliente escreveu depois do encerramento.";
    return null;
  }
  if (!deal.awaitingReplySince || deal.awaitingReplySince.toISOString() !== meta.awaiting) return "A cliente já foi atendida ou a espera mudou.";
  return null;
}
```

Criar `src/server/domain/auto-messages.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, users } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { fillName } from "../../lib/auto-message-text";
import { getBusinessHours } from "./hours";
import { isQuiet } from "./quiet";
import { AUTO_REPLY_GAP_MS, AUTO_REPLY_MAX_AGE_MS } from "./auto-reply";
import { enqueueAutomated } from "./outbox";
import { AUTO_MESSAGE_SOURCE, getAutoMessage, type AutoMessageKind } from "./auto-message-settings";

type Row = { deal: typeof deals.$inferSelect; contact: typeof contacts.$inferSelect };
const rowOf = async (dealId: string): Promise<Row | undefined> =>
  (await db.select({ deal: deals, contact: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId)))[0];

/** Reserva a janela de 12 h do contato (a mesma da "fora do horário") e enfileira, de forma atômica: duas mensagens juntas dão um envio só. */
async function claimAndEnqueue(kind: AutoMessageKind, text: string, row: Row, at: Date, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx.update(contacts).set({ lastAutoReplyAt: at })
      .where(sql`${contacts.id} = ${row.contact.id} and (${contacts.lastAutoReplyAt} is null or ${contacts.lastAutoReplyAt} <= ${new Date(at.getTime() - AUTO_REPLY_GAP_MS).toISOString()}::timestamptz)`)
      .returning({ id: contacts.id });
    if (!claimed.length) return false;
    await enqueueAutomated({ dealId: row.deal.id, kind: "text", text: fillName(text, row.contact.name), source: `${AUTO_MESSAGE_SOURCE}${kind}`, guard: { awaitingSince: at }, at: now }, tx);
    return true;
  });
}

/**
 * Depois de gravar a mensagem da cliente (recordInbound, depois do commit; nunca derruba a ingestão). Com a Casa ABERTA (fechada, quem
 * responde é a "fora do horário") e só quando esta mensagem começou uma espera:
 * - boas-vindas: é a primeira mensagem do contato no CRM;
 * - ausência: ninguém da equipe está Disponível.
 * No máximo uma das duas, e uma resposta automática a cada 12 h por cliente. Mensagem velha (webhook reprocessado) não recebe nada.
 */
export async function afterInbound(input: { dealId: string; created: boolean; at: Date; now?: Date }): Promise<AutoMessageKind | null> {
  const now = input.now ?? new Date();
  if (now.getTime() - input.at.getTime() > AUTO_REPLY_MAX_AGE_MS) return null;
  const [welcome, away] = await Promise.all([getAutoMessage("boas_vindas"), getAutoMessage("ausencia")]);
  const welcomeOn = welcome.enabled && !!welcome.text.trim(), awayOn = away.enabled && !!away.text.trim();
  if (!welcomeOn && !awayOn) return null;
  const hours = await getBusinessHours();
  if (!isOpen(input.at.getTime(), hours) || !isOpen(now.getTime(), hours)) return null;
  const row = await rowOf(input.dealId);
  if (!row || row.deal.archivedAt || row.contact.ignored) return null;
  if (row.deal.awaitingReplySince?.getTime() !== input.at.getTime()) return null;
  if (await isQuiet(row.deal.channelId, input.at)) return null;
  if (welcomeOn && input.created) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.contactId, row.contact.id));
    if (n === 1) return (await claimAndEnqueue("boas_vindas", welcome.text, row, input.at, now)) ? "boas_vindas" : null;
  }
  if (awayOn) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.active, true), eq(users.availability, "disponivel")));
    if (n === 0) return (await claimAndEnqueue("ausencia", away.text, row, input.at, now)) ? "ausencia" : null;
  }
  return null;
}

/** Depois de "Encerrar conversa" (depois do commit). Uma por encerramento; nunca para "Não é cliente" nem com o canal em modo quieto. */
export async function afterConversationClosed(dealId: string, now = new Date()): Promise<boolean> {
  const conf = await getAutoMessage("encerramento");
  if (!conf.enabled || !conf.text.trim()) return false;
  const row = await rowOf(dealId);
  if (!row || row.deal.archivedAt || row.contact.ignored || (!row.deal.conversationArchivedAt && !row.deal.closedAt)) return false;
  if (await isQuiet(row.deal.channelId, now)) return false;
  await enqueueAutomated({ dealId, kind: "text", text: fillName(conf.text, row.contact.name), source: `${AUTO_MESSAGE_SOURCE}encerramento`, at: now });
  return true;
}
```

- [ ] **Passo 4: Ligar nos pontos certos**

Em `src/server/domain/outbox.ts`:
- `import { AUTO_MESSAGE_SOURCE, autoMessageCancelReason } from "./auto-message-settings";`;
- em `processItem`, logo depois do ramo `} else if (source?.startsWith("automacao:")) { … }`:

```ts
  } else if (source?.startsWith(AUTO_MESSAGE_SOURCE)) {
    // Boas-vindas, ausência, encerramento (Lote 4): desligada, velha ou conversa que mudou não sai.
    const why = await autoMessageCancelReason(source, meta, row.deal, item.createdAt, now);
    if (why) return cancel(why);
  }
```

(o `claimNext` não muda: com a Casa fechada estes itens esperam abrir e, passados 30 min, são cancelados.)

Em `src/server/domain/deals.ts`, em `recordInbound`, logo depois do `try { … maybeAutoReply … } catch …`:

```ts
    // Boas-vindas e ausência (Lote 4; nascem desligadas). Depois do commit e sem nunca derrubar a ingestão.
    try { if (result.dealId) { const { afterInbound } = await import("./auto-messages"); await afterInbound({ dealId: result.dealId, created: result.created, at, now: input.now }); } }
    catch (e) { console.error("[mensagem automática] não enfileirou", result.dealId, e instanceof Error ? e.message : e); }
```

Em `src/server/domain/conversation-archive.ts`, no fim de `archiveConversation` (depois do `await emit(...)`); se o 1C fez o "Encerrar conversa" da Atendida passar por outra função (conferir com `grep -rn "Encerrar conversa" src/components src/app` e seguir até a action), pôr a mesma chamada também no fim dela:

```ts
  // Mensagem de encerramento (Lote 4; nasce desligada). Nunca derruba o encerramento.
  try { const { afterConversationClosed } = await import("./auto-messages"); await afterConversationClosed(dealId); }
  catch (e) { console.error("[mensagem automática] encerramento não enfileirou", dealId, e instanceof Error ? e.message : e); }
```

Em `src/server/domain/auto-reply.ts`, a "fora do horário" passa a trocar `{nome}` (a tela já mostrava a prévia com o nome, mas o texto saía cru):
- `import { fillName } from "../../lib/auto-message-text";`;
- no `enqueueAutomated(...)`, `text` vira `text: fillName(text, row.contact.name)`.

- [ ] **Passo 5: Tela e action**

Em `src/app/(app)/config/actions.ts`, acrescentar `import * as autoMsg from "@/server/domain/auto-message-settings";` e:

```ts
export const saveAutoMessageAction = async (kind: string, v: unknown) =>
  runSafe((u) => autoMsg.saveAutoMessage(z.enum(autoMsg.AUTO_MESSAGE_KINDS).parse(kind), v, u), "/config/mensagens", "Não deu para salvar a mensagem automática. Tente de novo.", SIS);
```

Criar `src/components/config/auto-messages.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { saveAutoMessageAction } from "@/app/(app)/config/actions";
import { fillName } from "@/lib/auto-message-text";

type Kind = "boas_vindas" | "ausencia" | "encerramento";
const COPY: Record<Kind, { title: string; help: string; what: string; placeholder: string }> = {
  boas_vindas: { title: "Boas-vindas", help: "Para quem escreve pela primeira vez, com a Casa aberta. Com a Casa fechada, vale a resposta fora do horário.",
    what: "Responde automaticamente quem escreve pela primeira vez para a Casa.", placeholder: "Oi, {nome}! Que bom falar com você. Já vamos te responder." },
  ausencia: { title: "Ausência", help: "Quando a Casa está aberta e ninguém da equipe está Disponível no CRM. No máximo uma resposta automática a cada 12 horas por cliente.",
    what: "Responde automaticamente quando ninguém da equipe está Disponível.", placeholder: "Oi, {nome}! Recebemos sua mensagem e já, já alguém te responde." },
  encerramento: { title: "Encerramento", help: "Quando alguém toca em Encerrar conversa. Não sai se a cliente escrever antes.",
    what: "Envia uma mensagem toda vez que uma conversa é encerrada.", placeholder: "Obrigada, {nome}! Qualquer coisa, é só chamar." },
};
const MAX = 500;

/** Uma mensagem automática (Lote 4): texto, prévia e liga/desliga com o aviso de envio real. Nasce desligada. */
export function AutoMessageEditor({ kind, initial, note }: { kind: Kind; initial: { enabled: boolean; text: string }; note?: string }) {
  const c = COPY[kind];
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial.text);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = text.trim() !== saved.text.trim();
  const persist = (enabled: boolean, msg: string) => start(async () => {
    setErr(null);
    const r = await saveAutoMessageAction(kind, { enabled, text });
    setConfirm(false);
    if (!r.ok) return setErr(r.error);
    setSaved({ enabled, text: text.trim() }); setText(text.trim());
    toast(msg, "ok");
  });
  const preview = fillName(text.trim(), "Maria");
  return (
    <section aria-labelledby={`msg-${kind}`} className="rounded-[var(--radius-card)] border border-line bg-paper p-5 max-w-[760px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={`msg-${kind}`} className="font-display text-[22px] font-medium">{c.title}</h2>
          <p className="text-sm text-graphite mt-1 max-w-[60ch]">{c.help}</p>
        </div>
        <Switch checked={saved.enabled} label={saved.enabled ? `Desligar ${c.title}` : `Ligar ${c.title}`} disabled={pending}
          onChange={(on) => (on ? setConfirm(true) : persist(false, `${c.title} desligada`))} />
      </div>
      {note && <p className="text-sm mt-3 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2">{note}</p>}
      <label className="block mt-4">
        <span className="text-sm font-medium text-graphite">Texto</span>
        <Textarea className="mt-1.5 min-h-24" value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} placeholder={c.placeholder} aria-describedby={`msg-${kind}-count`} />
      </label>
      <p id={`msg-${kind}-count`} className="text-xs text-muted mt-1 tabular">{text.length}/{MAX} · use {"{nome}"} para o primeiro nome da cliente</p>
      {preview && <p aria-label={`Prévia de ${c.title}`} className="mt-3 inline-block max-w-full whitespace-pre-wrap break-words rounded-[14px] rounded-tl-[4px] bg-ok-soft px-3.5 py-2 text-base">{preview}</p>}
      {err && <p className="text-sm text-alert mt-3" role="alert">{err}</p>}
      <div className="flex justify-end mt-4">
        <Button disabled={!dirty} loading={pending && !confirm} onClick={() => persist(saved.enabled, saved.enabled ? "Texto salvo" : `Texto salvo. ${c.title} continua desligada`)}>Salvar texto</Button>
      </div>
      <SendConfirmDialog open={confirm} pending={pending} onClose={() => setConfirm(false)} onConfirm={() => persist(true, `${c.title} ligada`)} what={c.what} />
    </section>
  );
}
```

`src/app/(app)/config/mensagens/page.tsx` inteiro:

```tsx
import { requirePerm } from "@/server/auth/session";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { settings, users } from "@/server/db/schema";
import { getBusinessHours } from "@/server/domain/hours";
import { getAutoReply } from "@/server/domain/messaging-settings";
import { getAutoMessage } from "@/server/domain/auto-message-settings";
import { summarizeHours } from "@/lib/hours-summary";
import { AutoReplyEditor } from "@/components/config/messages";
import { AutoMessageEditor } from "@/components/config/auto-messages";

export const metadata = { title: "Mensagens automáticas" };

export default async function MensagensPage() {
  await requirePerm("config.sistema");
  const [reply, hours, savedHours, welcome, away, closing, [{ n: disponiveis }]] = await Promise.all([
    getAutoReply(), getBusinessHours(), db.select({ key: settings.key }).from(settings).where(eq(settings.key, "business_hours")),
    getAutoMessage("boas_vindas"), getAutoMessage("ausencia"), getAutoMessage("encerramento"),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.active, true), eq(users.availability, "disponivel"))),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AutoReplyEditor initial={reply} hoursSummary={summarizeHours(hours)} hoursSaved={savedHours.length > 0} />
      <AutoMessageEditor kind="boas_vindas" initial={welcome} />
      <AutoMessageEditor kind="ausencia" initial={away}
        note={`Agora: ${disponiveis} ${disponiveis === 1 ? "pessoa Disponível" : "pessoas Disponíveis"} no CRM. Com ninguém Disponível, toda cliente que escrever com a Casa aberta recebe este texto (uma vez a cada 12 h).`} />
      <AutoMessageEditor kind="encerramento" initial={closing} />
    </div>
  );
}
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/auto-messages.test.ts src/components/config/auto-messages.test.tsx src/server/domain/outbox.test.ts src/server/domain/messaging-settings.test.ts src/server/domain/conversation-archive.test.ts test/evolution-guard.test.ts && npm run typecheck && npm run lint`
Esperado: PASS.

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/config-mensagens.spec.ts`
Esperado: PASS (a página ganhou três blocos; o da "fora do horário" não mudou).

- [ ] **Passo 7: Commit**

```bash
git add src/lib/auto-message-text.ts src/server/domain/auto-message-settings.ts src/server/domain/auto-messages.ts src/server/domain/auto-messages.test.ts \
  src/server/domain/outbox.ts src/server/domain/deals.ts src/server/domain/conversation-archive.ts src/server/domain/auto-reply.ts \
  "src/app/(app)/config/actions.ts" "src/app/(app)/config/mensagens/page.tsx" src/components/config/auto-messages.tsx src/components/config/auto-messages.test.tsx
git commit -m "feat(config): mensagens automáticas de boas-vindas, ausência e encerramento (prontas e desligadas); fora do horário troca {nome}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4.9: Verificação final e roteiro de produção no `docs/deploy-contabo.md`

**Arquivos:**
- Modificar: `docs/deploy-contabo.md` (seção nova "Lotes 3 e 4"), `e2e/a11y.spec.ts` (rotas novas na varredura da gestão)

**Interfaces:**
- Consome: tudo acima.
- Produz: suíte verde, as rotas novas com a11y conferida e o roteiro de produção escrito.

- [ ] **Passo 1: a11y das telas novas**

Em `e2e/a11y.spec.ts:32`, acrescentar à `rotasGestao`: `"/config/etiquetas"`, `"/relatorios?aba=salao"`, `"/relatorios/avec"`, e à `rotasComuns` nada (a atendente não abre Relatórios).

Rodar: `E2E_PORT=$E2E_PORT npx playwright test e2e/a11y.spec.ts`
Esperado: PASS (sem violação séria, sem rolagem lateral, um `h1` e um `main` por tela).

- [ ] **Passo 2: Conferências que não podem falhar**

```bash
grep -rn "config.editar" src scripts worker e2e test        # só LEGACY_CONFIG_PERM (permissions.ts) e o uso no seed.ts
grep -rn "ATTEMPT_DAYS\[" src                                 # só src/lib/attempts.ts
grep -nE "DROP|ALTER COLUMN|TYPE " drizzle/0025_*.sql         # nada
grep -rn "msg_boas_vindas\|msg_ausencia\|msg_encerramento" src/server/db                               # nada (o seed não cria nem liga mensagem)
```

- [ ] **Passo 3: Suíte inteira**

```bash
npm test && npm run typecheck && npm run lint && npm run build
E2E_PORT=$E2E_PORT npx playwright test
npx vitest run test/evolution-guard.test.ts
```

Esperado: tudo PASS. Falha: corrigir na tarefa dona antes de seguir.

- [ ] **Passo 4: Roteiro de produção**

Em `docs/deploy-contabo.md`, acrescentar ao fim a seção "Lotes 3 e 4 (relatórios do salão e configurações)" com o texto da seção **Implantação** deste plano (passos J0 a J9, com os comandos).

- [ ] **Passo 5: Commit**

```bash
git add docs/deploy-contabo.md e2e/a11y.spec.ts
git commit -m "docs: roteiro de produção dos Lotes 3 e 4; a11y das telas novas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Interfaces que este plano expõe (para a junção e para os outros lotes)

**Banco (migration `0025_relatorios_config`, aditiva, `ADD COLUMN IF NOT EXISTS`)**
- `sales_items.commission_pct numeric(5,2)`, `sales_items.commission_cents integer` (nomes combinados com a frente 6C, que grava nas mesmas colunas)
- `tags.color text`
- `stages.visible_profile_ids uuid[]`, `stages.attempt_days smallint[]`
- `settings`: `migracao_permissoes_config` (marca da troca de permissões), `msg_boas_vindas`, `msg_ausencia`, `msg_encerramento` (só existem depois que alguém salvar na tela)

**Permissões**
- `config.diaadia` e `config.sistema` no lugar de `config.editar` (`LEGACY_CONFIG_PERM`); `canConfigure`, `canSeeSalon`; `configTabs`, `firstConfigPath`
- Action nova de Configurações escolhe a permissão em `run(fn, path, perm)` / `runSafe(fn, path, fallback, perm)`: Automações e mensagens = `SIS`; listas, etiquetas, profissionais e origens = `DIA` (vale para a action do Retorno sugerido do Lote 2: `SIS`)

**Relatórios**
- `src/lib/salon-period.ts`: `salonRange`, `salonBuckets`, `salonQuery`, `todayBahia`, `brDay`, `rangeLabel`, `bucketLabel`
- `src/server/reports/salon.ts`: `REVENUE`, `COMANDA_KEY`, `revenueTotals`, `salonRevenue`, `avecUntil`, `salonByProfessional`, `salonByService`, `salonPayments`, `yearlyCheck`, `salonClients`, `salonAttendance`, `salonFunnel`, `loadSalon`, `salonFinance` e os tipos
- `src/server/reports/cohort.ts`: `returnCohorts`; `src/server/reports/replies.ts`: `REPLY_MESSAGE_JOIN`, `repliesWithAuthor`, `replyTimesByAuthor`
- `Analysis` ganha `cohort`, `salon`, `replies`; evento `resposta` ganha `payload.messageId`

**Avec**
- `pctOrNull`; a importação grava `commissionPct`/`commissionCents`; `src/server/domain/avec/commission-backfill.ts` (`planCommissionBackfill`, `applyCommissionBackfill`, `restoreCommissionBackfill`, `commissionByProfessional`); `src/lib/avec-catalog.ts` (`organizeAvecReports`, `PRINCIPAIS`, `sectionOf`)

**Configurações**
- Etiquetas: `listTagsAdmin`, `renameTag`, `setTagColor`, `mergeTags`, `TAG_COLORS`, `TagDot`, `QueueItem.tagColors`
- Filtro: `QueueOptions.etiqueta`, `QueueParams.etiqueta`, `listContacts({ tagId })`, `TagFilter`
- Etapas: `STAGE_KINDS`, `KIND_LABEL`, `stageVisibleTo`, `createStage`, `deleteStage`, `setStageProfiles`, `setStageAttemptDays`, `attemptDaysOf`
- Mensagens: `fillName`, `AUTO_MESSAGE_KINDS`, `getAutoMessage`, `saveAutoMessage`, `autoMessageCancelReason`, `afterInbound`, `afterConversationClosed`

**Funil (herdado do 1C)**
- Lead de cliente que volta depois de Fechado/Perdido nasce em Em conversa, com `lead_criado.payload.voltou = true`

---

## Implantação

Só depois das tarefas 0 a 4.9 commitadas, de juntar com a `rodada-2` (ver "Riscos da junção" abaixo) e com o ok do dono em cada passo que grava em produção. Fora do expediente da Casa (ter–sáb, 9h–18h). Nada aqui envia WhatsApp: as mensagens automáticas novas sobem desligadas. O procedimento de publicação é o mesmo do plano dos Lotes 1 (tarball, pasta nova `/opt/crm-rN`, backup, migrate + seed com tudo parado, troca de pasta); abaixo, só o que muda.

**J0. Testes verdes na `rodada-2` já juntada**

```bash
npm test && npm run typecheck && npm run lint && npm run build && E2E_PORT=$E2E_PORT npx playwright test
npx vitest run test/evolution-guard.test.ts
```

**J1. Pacote e build em pasta nova** (I1 e I2 do plano dos Lotes 1, com o próximo número de pasta).

**J2. Backup** com a versão antiga no ar: `cd /opt/crm && sudo -u crm bash scripts/backup.sh` (anotar a pasta).

**J3. Retrato das permissões antes** (só leitura):

```bash
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key, name, permissions from profiles order by key nulls last, name"
```

**J4. Parar, migrar e semear**

```bash
sudo -u crm pm2 stop crm-web crm-worker
cd /opt/crm-rN && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key, permissions from profiles order by key nulls last, name"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key from settings where key = 'migracao_permissoes_config' or key like 'msg_%'"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "\d sales_items" | grep commission
```

Esperado:
- a migration `0025_relatorios_config` (ou o número da junção) aplicada;
- Gestão com `config.diaadia` e `config.sistema`; Atendente e Recepção com `config.diaadia`; nenhum perfil com `config.editar` (perfis criados pela gestão que tinham `config.editar` ficam com as duas);
- em `settings`, só `migracao_permissoes_config` (nenhuma `msg_%`: as mensagens novas estão desligadas);
- `commission_pct` e `commission_cents` em `sales_items`.

**J5. Troca de pasta, web e worker de volta** (I6 do plano dos Lotes 1; aqui o worker pode voltar junto: nada novo roda nele).

**J6. Conferência do faturamento (só leitura; mostrar ao dono)**

```bash
cd /opt/crm && sudo -u crm npx tsx scripts/conferir-faturamento.ts
```

Esperado: por ano, o faturamento (sem as sessões de pacote) perto dos pagamentos (spec: diferença menor que 5%; a auditoria de 15/10 tinha 2024 ≈ R$ 2,57 mi × R$ 2,43 mi, 2025 ≈ R$ 3,06 mi × R$ 2,88 mi, 2026 ≈ R$ 3,12 mi × R$ 3,01 mi, contando as sessões). Se algum ano ficar em 5% ou mais, **não mexer na conta**: mostrar ao dono as duas colunas (com e sem sessões) e decidir com ele.

**J7. Comissão histórica (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/comissao-avec.ts --dry-run
```

Esperado: os relatórios usados ("Itens de comanda", "Comissão por item"), quantos itens ganham comissão (perto dos 25.9 mil itens; os que o Avec escreveu de outro jeito aparecem em "sem o item no CRM") e a tabela por profissional do último mês fechado. O dono confere 2 profissionais com o relatório "Comissão por profissional" do Avec do mesmo mês. Com o ok:

```bash
sudo -u crm npx tsx scripts/comissao-avec.ts --aplicar --backup /home/crm/backups/comissao-avec-$(date +%F)-antes.json
```

Esperado: "Conferência: nada pendente." e a tabela "Como ficou". Para voltar: `--desfazer <esse arquivo>`.

**J8. Conferir nas telas (sem clicar em nada que envie)**
- Gestão: Relatórios › Salão (mês passado), Análise (Retorno por coorte com números, Financeiro com "Fonte: Avec até …", Tempo de resposta por atendente com Sara e Cati), Relatórios do Avec (11 cartões, assuntos recolhidos, "Vazios (N)" no fim).
- Atendente (pedir para a Sara abrir, ou usar um acesso de teste): Configurações mostra Etiquetas, Listas, Profissionais, Origens e links e Distribuição; não mostra WhatsApp, Etapas, Mensagens nem Automações.
- Avisar a equipe: quem atende passa a ajustar etiquetas, respostas prontas, serviços, profissionais e origens.

**J9. Voltar, se precisar**
- Código: trocar a pasta de volta (`/opt/crm-anterior-rN`). A migration é aditiva: o código antigo ignora as colunas novas. No próximo seed do código antigo a Gestão volta a ter `config.editar`; a Atendente fica sem Configurações, como era.
- Comissão: `scripts/comissao-avec.ts --desfazer <backup>`.
- Etapas criadas pela tela continuam no banco (o código antigo as mostra como etapas comuns).

---

## Autoconferência (skill writing-plans)

### 1. Cobertura da spec

| Spec (seção 3, Lotes 3 e 4) | Onde no plano |
|---|---|
| 3 · Painel "Salão" ao lado da Visão geral | 3.4 (aba, permissão, período) |
| 3 · faturamento por dia, mês ou período livre, com comparação | 3.1 (período e anterior), 3.2 (`salonRevenue`), 3.4 (barras e Delta) |
| 3 · por profissional (faturado, ticket, comissão depois de importada) | 3.2 (`salonByProfessional`), 3.8 (comissão) |
| 3 · por serviço e categoria | 3.2 (`salonByService`) |
| 3 · formas de pagamento | 3.2 (`salonPayments`) |
| 3 · clientes novas × recorrentes | 3.3 (`salonClients`) |
| 3 · comparecimento, faltas e cancelamentos por profissional | 3.3 (`salonAttendance`) |
| 3 · agenda sem desfecho | 3.3 (`noOutcome`), 3.4 (lista com link para a ficha) |
| 3 · funil conversa → horário → compareceu → comprou | 3.3 (`salonFunnel`) |
| 3 · sumidas e retorno sugerido calculados | **fora** (lacuna 1: dependem do Lote 2) |
| 3 · "Retorno por coorte" de verdade | 3.5 |
| 3 · "Financeiro" com Avec e CRM e a legenda "fonte: Avec até" | 3.6 |
| 3 · "Tempo de resposta por atendente" pela autora (1A) | 3.7 |
| 3 · importar comissão ("Itens de comanda" e "Comissão por item") | 3.8 |
| 3 · Relatórios do Avec: 11 principais, seções recolhíveis, selo, "Vazios", repetidos | 3.9 |
| 3 · como testar: faturamento por ano × pagamentos (< 5%); 2 profissionais à mão | 3.2 (`yearlyCheck`, script) + J6; 3.8 (conferência) + J7 |
| 3 · valores só para quem pode ver | 3.4 (`loadSalon`, teste e e2e), 3.6 (`team && money`) |
| 1C (herdado) · Fechado/Perdido e a cliente escreve → Em conversa; "respondidos" | 3.10 |
| 4 · `config.diaadia` × `config.sistema`, migração das permissões | 4.1 |
| 4 · pontos no código (`permissions.ts:66,72`, `config/actions.ts:19`, `config-nav.tsx:13`) | 4.1 |
| 4 · Etiquetas (cor, renomear, juntar, contagem) | 4.2 |
| 4 · filtro por etiqueta na Fila e em Contatos | 4.3 |
| 4 · criar e apagar etapa (tipo, ordem, quais perfis veem) | 4.4 |
| 4 · sequência de "Aguardando" configurável | 4.5 |
| 4 · Profissionais: compacta, só ativas, desativadas recolhidas | 4.6 |
| 4 · Profissionais: vínculos com serviços pelo histórico; "Agendar lista profissionais" | **fora** (outra frente, 6A) |
| 4 · Serviços: duração e ciclo de retorno | **fora** (duração: outra frente; o ciclo já existe em Listas) |
| 4 · Origens: juntar as duas listas | 4.7 |
| 4 · Mensagens automáticas: boas-vindas, fora do horário, ausência, encerramento | 4.8 (as três novas, desligadas; a fora do horário passa a trocar `{nome}`) |
| 4 · Assinatura por pessoa | já feita no 1A |
| 4 · como testar: atendente com dia a dia não vê WhatsApp; etapa de teste no Quadro | 4.1 (e2e), 4.4 (e2e) |
| Seção 4 (decisões) · Lote 0 (horário, prazos) não é desfeito | o seed só mexe em perfis; nenhum teste/seed toca em `business_hours` ou nos prazos |
| Seção 4 · decisão 5 (total do item = valor − desconto) | `REVENUE` usa `total_cents` e, sem ele, valor − desconto (3.2) |
| Seção 5 · fora de escopo (ocupação da agenda, estoque, taxas, restrição por etiqueta) | nada disso entra |

### 2. Placeholders

Procurados: "TBD", "TODO", "implementar depois", "similar à Tarefa", "tratar erros adequadamente". Nenhum. Os pontos condicionais são conferências explícitas com o comando a rodar: nomes do 1C (`grep -n`), a data esperada do teste da 4.5 (depende do horário padrão), o número da migration na junção, o "Encerrar conversa" do 1C (4.8, Passo 4) e o filtro de Contatos se o Lote 2 já tiver entrado (4.3, Passo 4).

### 3. Consistência de nomes e tipos

- `todayBahia`/`brDay` (3.1) usados em 3.5, 3.6, 3.8 e na tela; `DayRange` (3.2) usado em 3.3 e 3.6.
- `loadSalon` (3.4) recebe `{ perms }`; `SalonView` é a mesma no servidor, na tela e no teste de tela.
- `Analysis` cresce em três passos com o mesmo `Promise.all` reescrito inteiro em cada tarefa (3.5 `cohort`, 3.6 `salon`, 3.7 `replies`).
- `run`/`runSafe` com `perm` obrigatório (4.1) e as actions novas de 4.2, 4.4, 4.5 e 4.8 passam `DIA` ou `SIS`.
- `CONFIG_TABS` ganha "Etiquetas" em 4.2 (o teste de 4.1 é atualizado na mesma tarefa).
- `StagesEditor` (4.4) já recebe `attemptDays`, que a 4.5 passa a usar.
- `fillName` (4.8) é usado pela fora do horário e pelas três mensagens novas.
- Migration: uma só, na Tarefa 0.

### 4. Review Focus

Os cinco itens do topo têm teste: 3.4 Passos 1 e 8; 3.1 Passo 1 e 3.3 Passo 1; 4.4 Passo 1; 4.2 Passo 1; 4.1 Passo 1 (`profiles-seed.test.ts`).

### Lacunas e o que ficou fora (de propósito)

1. **"Sumidas" e "retorno sugerido calculados" no Salão:** dependem da visão por contato do Lote 2 (`contact_stats`); entram depois da junção.
2. **Vínculos profissional↔serviço** (pelo relatório "Serviços por profissional"), "o Agendar lista profissionais", **duração de serviço**, horário de trabalho e bloqueios: da outra frente (6A). A lista compacta só esconde o editor de serviços de hoje atrás do "Editar".
3. **Comissão das comandas novas:** da frente 6C, nas mesmas colunas.
4. **"Quem vê" a etapa** vale para o Quadro; a Fila continua mostrando toda conversa que espera resposta. O plano não pré-configura a divisão Atendente (0–4, 6) × Recepção (4–6) da spec do 1C: a gestão marca pela tela.
5. **Conferência automática da comissão com o Avec:** o relatório "Comissão por profissional" não tem coluna de data, então a conferência de 2 profissionais é à mão (J7).
6. **Tela para configurar o "VIP"** que o plano do Lote 2 deixou para o Lote 4: depende das constantes do Lote 2 (`src/lib/client-rhythm.ts`); fica para depois da junção.
7. **CSV/PDF do Salão:** não pedido.

### Riscos da junção (este plano roda num worktree próprio)

- **Número da migration:** o Lote 2 também gera uma `0025` (`0025_ficha_contatos`) e a frente 6x pode gerar outras. Na junção, renumerar com o drizzle-kit (apagar a 0025 deste plano, juntar o schema e rodar `npx drizzle-kit generate --name relatorios_config` de novo, conferindo que só saem os `ADD COLUMN IF NOT EXISTS`).
- **`src/app/(app)/config/actions.ts`:** o Lote 2 acrescenta a action do Retorno sugerido; depois da 4.1 ela precisa do argumento `SIS` (o `typecheck` acusa).
- **Arquivos mexidos por mais de um lote:** `src/components/reports/analysis.tsx` e `src/server/reports/queries.ts` (Lote 2: nomes clicáveis), `src/server/domain/tags.ts` e `src/server/queries/contacts.ts`/`contatos/page.tsx` (Lote 2: etiquetas na ficha e filtros de Contatos; reaproveitar o parâmetro `etiqueta` daqui), `src/components/config/professionals.tsx` (6A). Resolver mantendo as duas mudanças.
- **Código do 1C ainda em construção:** `src/lib/attempts.ts`, `src/server/domain/attempts.ts`, `src/server/domain/funnel.ts`, `recordInbound` e o "Encerrar conversa" podem ter nomes ou linhas diferentes dos do plano do 1C; as tarefas 3.10, 4.5 e 4.8 mandam conferir com `grep -n` antes de editar.
