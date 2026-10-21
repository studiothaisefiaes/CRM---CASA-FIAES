# Lote 6A — Base da agenda: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Cada tarefa segue superpowers:test-driven-development (teste que falha, mínimo, verde, commit).

**Goal:** ter tudo o que o cálculo de horário livre precisa (duração e folga, quem faz o quê, horário de trabalho, bloqueios criados no CRM) e o próprio cálculo, puro e testado, com as telas de Configurações (Serviços, Profissionais, Quem faz o quê, Agenda) e da Agenda (Bloquear, hachura, Procurar horário), sem marcar nenhum horário.

**Architecture:** o motor (`src/lib/free-slots.ts`) é puro e só conhece minutos do dia em Salvador. `src/server/domain/agenda/availability.ts` lê o banco e monta o `DayRules` de cada profissional (faixas de `src/lib/work-hours.ts`, bloqueios vivos, ocupados do Avec, do CRM e dos leads antigos). Bloqueios, modo da agenda e quem faz o quê ficam em `src/server/domain/agenda/*`. Migration aditiva `0025_agenda_base`.

**Tech Stack:** Next 16.4 (App Router, server actions; ler `node_modules/next/dist/docs/` antes de rota nova), React 19.3, Drizzle 0.45 + Postgres, zod 4, vitest 5 (+ jsdom), Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-15-agenda-app-cliente-design.md` §5 (com §3, §4, §11, §12 e §13).

## Global Constraints

- Migration só aditiva (`ADD COLUMN` — `NOT NULL` só com `DEFAULT` —, FK, `CREATE INDEX`). `DROP`, `ALTER COLUMN … TYPE` ou `SET NOT NULL` gerado = parar e corrigir.
- Nunca inventar dado: serviço sem duração → `sem_duracao`; o motor nunca supõe 60 min.
- Fuso America/Bahia (UTC−3 fixo). O motor só usa minutos do dia; conversão só por `bahiaParts`, `slotMs`, `minuteOfDay`; tela com `Intl` e `timeZone: "America/Bahia"` (ou `UTC` sobre `AAAA-MM-DDT12:00Z`).
- Nada se apaga: apagar bloqueio marca `deleted_at`/`deleted_by`; toda mudança vai para `audit_log` com de/para.
- Quem decide é o servidor (modo da agenda, permissão, validação). Tela nova: `requirePerm`; action nova: `assertPerm` ou `run(...)`.
- Configurações: `config.editar`. Bloquear e Procurar horário: `agenda.marcar`. `nextFreeSlots` nunca devolve nome de outra cliente.
- Textos em PT-BR, sem jargão. Commits em PT-BR terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` só dos arquivos mexidos.
- Nenhum envio de WhatsApp. `scripts/quem-faz-o-que.ts --aplicar` em produção só com o ok do dono.
- vitest no banco `crm_agenda`; Playwright com `E2E_PORT=3320` e `DATABASE_URL=…/crm_e2e_agenda`.

## Rulings (decididos aqui, sem o dono)

1. **Permissões por lote:** o 6A cria só `agenda.marcar` e `agenda.encaixar` (grupo "Agenda e caixa") e a concessão única. `caixa.*` e `comissao.ver` entram no 6C; `pro.*` e o perfil Profissional no 7A (o perfil sem a tela `/pro` mandaria a pessoa para uma página que não existe). A concessão guarda `"<perfil>:<permissão>"` em `settings.perfis_permissoes_concedidas`; os lotes seguintes só acrescentam.
2. **Gêmeos do Avec:** `avec_twin_of` é do 0026 (6B); o filtro em `dayRulesFor` entra com ela. O teste do 6A cobre Avec, CRM, lead antigo e cancelado.
3. **`appointments.buffer_min`** é do 0026: no 6A a folga de um ocupado vem só do serviço (senão 0).
4. **Tipos do motor:** `DayRules.name?` (apelido para os avisos) e `BusyItem.clientEnd?` (fim sem a folga) e `BusyItem.otherPro?` (horário da mesma cliente com outra profissional, que só conta para conflito de cliente). Sem eles o motor não aplica as regras 1 e 4 da §5.4.
5. **Duração desconhecida num ocupado:** quem monta o dia já grava `end = start + passo`; o motor só avisa (candidatos da mesma profissional que começam até 3 h depois).
6. **Rótulo privado** do `nextFreeSlots`: "outra cliente" ("Ana tem outra cliente às 10:00 sem duração informada: confira antes").
7. **Passo** (`agenda_regras.passoMin` ∈ 10/15/20/30/60): no 6A vale para as sugestões; as linhas da grade continuam de 30 min (tocar no livre é do 6B).
8. **Contagem de quem faz o quê:** por par, a MAIOR contagem entre o relatório `6f695f67` (sem repetir entre relatórios: chave profissional|data|comanda|serviço, máximo por relatório) e `sales_items` (`kind = 'servico'` com profissional) — o mesmo atendimento não conta duas vezes. Só profissionais ativas e pares ainda não ligados.
9. **e2e:** `e2e/reset.ts` só aceita banco com `crm_e2e` no nome; o Playwright roda com `DATABASE_URL=postgresql://…/crm_e2e_agenda` (criado por este lote, só dele).
10. **Copiar opções:** os horários viram botões que entram e saem do texto; de saída, os 3 mais cedo entre todas. Texto: "Tenho quinta, 16/10, às 10h com a Ana ou às 14h30 com a Bia" (outro dia: ". Ou sexta, 17/10, às 9h com a Ana").

## Review Focus

1. **Profissional sem horário próprio num dia em que a Casa fecha** (segunda): sugestões → `nao_trabalha` sem erro; `checkStart` → `fora_do_horario` (só passa com `allowOutsideHours`); com horário próprio na segunda, vale o dela. *Testes:* Task 2 e Task 3.
2. **Fuso e meia-noite:** mesmas respostas com `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo`; 23:30 + 60 min → `atravessa_meia_noite`; cancelamento "sem hora" do Avec (00:00) não ocupa; procura que atravessa o fim do mês. *Testes:* Task 3 e Task 8.
3. **Bloqueio do Avec apagado e relatório reimportado:** continua apagado. *Teste:* Task 7.
4. **Bloqueio por cima de clientes marcadas:** salva, lista as clientes, não mexe nelas. *Teste:* Task 7.
5. **Duas pessoas salvando o horário da mesma profissional:** vale o último; as duas gravações ficam na auditoria. *Teste:* Task 4.

---

### Task 1: Migration `0025_agenda_base`

**Files:** Modify `src/server/db/schema.ts` (lists, professionals, professionalServices, agendaBlocks); Create `drizzle/0025_agenda_base.sql` + `drizzle/meta/0025_snapshot.json` + `_journal.json` (drizzle-kit); Test `src/server/db/schema.test.ts`.

**Interfaces — Produces:** colunas `lists.bufferMin`, `professionals.workHours` (jsonb `WorkHours | null`), `professionals.color`, `professionals.agendaPosition`, `professionalServices.source|createdAt|createdBy`, `agendaBlocks.origin|reason|createdBy|updatedAt|updatedBy|deletedAt|deletedBy`, índice `agenda_blocks_live_idx`.

- [ ] Teste em `schema.test.ts`: `it("agenda base (Lote 6A): folga, horário, cor, ordem, origem dos vínculos e bloqueios do CRM")` conferindo as colunas acima em `information_schema` e o `indexdef` de `agenda_blocks_live_idx` com `deleted_at IS NULL`.
- [ ] `npx vitest run src/server/db/schema.test.ts` → FALHA (colunas não existem).
- [ ] Schema + `npx drizzle-kit generate --name agenda_base`; ler o SQL: só `ADD COLUMN`/`ADD CONSTRAINT … FOREIGN KEY`/`CREATE INDEX`.
- [ ] Rodar de novo → PASSA (o globalSetup do vitest aplica a migration).
- [ ] Commit `feat(agenda): migration 0025 (folga, horário de trabalho, cor e ordem, origem dos vínculos, bloqueios do CRM)`.

### Task 2: Horário de trabalho (`src/lib/work-hours.ts`, puro)

**Files:** Create `src/lib/work-hours.ts`, `src/lib/work-hours.test.ts`.

**Interfaces — Produces:**
```ts
export type DayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type WorkRange = [string, string];
export type WorkHours = Record<DayKey, WorkRange[] | null>;
export const WEEKDAY_LONG: string[]; // "Domingo"…"Sábado"
export const workHoursSchema: z.ZodType<WorkHours>; // erros "Terça, 2ª faixa: o fim precisa ser depois do início." etc.
export function effectiveRanges(day: string /* AAAA-MM-DD */, pro: WorkHours | null, casa: BusinessHours): [number, number][];
export function casaAsWorkHours(casa: BusinessHours): WorkHours;
export function summarizeWorkHours(h: WorkHours): string; // "ter–sáb, 9h–18h"; "ter–sex, 9h–12h e 13h–18h; sáb, 9h–14h"; nada → "não trabalha"
export function describeWorkHours(pro: WorkHours | null, casa: BusinessHours): string; // null → "ter–sáb, 9h–18h · igual ao da Casa"
export function daysOutsideCasa(pro: WorkHours, casa: BusinessHours): string[]; // ["segunda"]
```

- [ ] Testes (`CASA` = ter–sáb 09:00–18:00):
```ts
it("valida: 1 ou 2 faixas, início antes do fim, sem sobrepor, entre 06:00 e 24:00, com o dia e a faixa no erro")
  // ok: {"2": [["09:00","12:00"],["13:00","18:00"]], resto null}
  // "Terça, 2ª faixa: o fim precisa ser depois do início." para [["09:00","12:00"],["13:00","12:30"]]
  // "Terça: as faixas se sobrepõem." para [["09:00","13:00"],["12:00","18:00"]]
  // "Terça, 1ª faixa: use horários entre 06:00 e 24:00." para [["05:00","12:00"]]
  // 3 faixas → "Terça: no máximo 2 faixas (use o intervalo para o almoço)."
it("sem horário próprio, herda o da Casa; segunda (Casa fechada) → []")
  // effectiveRanges("2026-10-13", null, CASA) → [[540,1080]]; ("2026-10-12", null, CASA) → []
it("horário próprio vence o da Casa, inclusive num dia em que a Casa fecha (Review Focus 1)")
  // pro com segunda [["10:00","14:00"]] → effectiveRanges("2026-10-12", pro, CASA) → [[600,840]]; terça null → []
it("descrição: 'ter–sáb, 9h–18h · igual ao da Casa' e a do horário próprio com intervalo")
it("dias em que ela trabalha e a Casa fecha: ['segunda']")
```
- [ ] Rodar → FALHA; implementar; rodar → PASSA; commit `feat(agenda): horário de trabalho da profissional (validação, herança da Casa, descrição)`.

### Task 3: Motor de horários livres (`src/lib/free-slots.ts`, puro)

**Files:** Create `src/lib/free-slots.ts`, `src/lib/free-slots.test.ts`.

**Interfaces — Produces** (a da §5.4, mais o Ruling 4):
```ts
export type Interval = { start: number; end: number };
export type BusyItem = Interval & { id: string; label: string; unknownDuration?: boolean; fitIn?: boolean; clientId?: string | null;
  /** fim sem a folga (para conflito de cliente); vazio = end */ clientEnd?: number; /** horário da mesma cliente com outra profissional */ otherPro?: boolean };
export type BlockItem = Interval & { id: string; title: string; pending?: boolean };
export type DayRules = { ranges: [number, number][]; blocks: BlockItem[]; busy: BusyItem[]; /** apelido para os avisos */ name?: string };
export type SlotQuery = { durationMin: number | null; bufferMin?: number | null; stepMin?: number; notBeforeMin?: number | null; clientId?: string | null; allowFitIn?: boolean; allowOutsideHours?: boolean };
export type SlotKind = "livre" | "encaixe" | "fora_do_horario";
export type Slot = { start: number; end: number; kind: SlotKind; conflicts: { id: string; label: string }[]; warnings: string[] };
export function freeSlots(day: DayRules, q: SlotQuery): { ok: true; slots: Slot[] } | { ok: false; reason: "sem_duracao" | "duracao_invalida" | "nao_trabalha" };
export function checkStart(day: DayRules, start: number, q: SlotQuery): CheckResult; // ok:true {kind, conflicts, warnings} | ok:false {reason, conflicts, blockedBy?}
export function planVisit(items: { day: DayRules; durationMin: number | null; bufferMin?: number | null; mode: "depois" | "junto" }[], start: number, q: Omit<SlotQuery, "durationMin" | "bufferMin">): { start: number; end: number; check: CheckResult }[];
export function pickAny(cands: { id: string; name: string; position: number | null; dayCount: number; kind: SlotKind | null }[]): string | null;
export const hhmm: (min: number) => string; // 600 → "10:00"
```
Ordem de recusa no `checkStart`: duração → `passou` → `atravessa_meia_noite` → `bloqueado` → `conflito` (sem `allowFitIn`) → `fora_do_horario` (sem `allowOutsideHours`). `kind`: fora do horário vence encaixe. `freeSlots` com `ranges` vazio e sem `allowOutsideHours` → `nao_trabalha`; com a flag, varre o dia todo.

- [ ] Testes (dia `DIA = { ranges: [[540,720],[780,1080]], blocks: [], busy: [], name: "Ana" }`):
```ts
it("dia simples: múltiplos do passo dentro das faixas, a ocupação inteira cabe") // 60 min: 09:00…11:00, 13:00…17:00
it("intervalo de almoço não recebe horário; folga soma na ocupação") // 60+15: 11:00 sai (12:15 > 12:00), 17:00 sai
it("bloqueio de 'todas' recusa; terminar 11:00 e começar 11:00 não sobrepõe; pedido pendente só avisa 'Ana pediu folga nesse horário'")
it("conflito com a mesma profissional e com a mesma cliente (outra profissional, sem a folga)")
it("encaixe só com allowFitIn (lista com quem conflita); fora do horário só com allowOutsideHours")
it("ocupado sem duração ocupa um passo e avisa até 3 h depois: 'Ana tem Paula · Corte às 10:00 sem duração informada: confira antes'")
it("duração vazia → sem_duracao; 0 ou 1441 → duracao_invalida (nunca chuta)")
it("passado (notBeforeMin) some das sugestões e checkStart diz passou")
it("23:30 + 60 min → atravessa_meia_noite (Review Focus 2)")
it("passo de 15 e de 30")
it("Casa fechada na segunda: nao_trabalha sem erro; checkStart fora_do_horario, ok com allowOutsideHours (Review Focus 1)")
it("'qualquer uma': menos horários no dia; empate pela ordem na agenda e depois pelo nome")
it("planVisit 'depois' começa no fim da duração (sem a folga); 'junto' começa junto")
it("as mesmas entradas dão o mesmo resultado com TZ=UTC, America/Sao_Paulo e Asia/Tokyo") // troca process.env.TZ e compara JSON, mais minuteOfDay/bahiaParts
```
- [ ] FALHA → implementar → PASSA (rodar também `TZ=Asia/Tokyo npx vitest run src/lib/free-slots.test.ts`) → commit `feat(agenda): motor de horários livres puro (ocupação, folga, bloqueio, conflito, encaixe, meia-noite)`.

### Task 4: Paleta, profissionais e folga do serviço

**Files:** Create `src/lib/palette.ts`, `src/lib/palette.test.ts`; Modify `src/server/domain/professionals.ts`, `src/server/domain/professionals.test.ts`, `src/server/domain/service-details.ts`, `src/server/domain/service-details.test.ts`.

**Interfaces — Produces:**
```ts
// palette.ts
export const PALETTE: readonly { key: PaletteKey; label: string; hex: string }[]; // 12: ameixa, vinho, terracota, caramelo, mostarda, oliva, musgo, petroleo, oceano, anil, lavanda, rosa
export type PaletteKey; export function isPaletteKey(v: unknown): v is PaletteKey; export function paletteHex(key: string | null | undefined): string | null;
export function contrastRatio(a: string, b: string): number; export function textOn(hex: string): "#121212" | "#ffffff";
// professionals.ts
export type Professional = { id; name; fullName; role; active; serviceIds: string[]; workHours: WorkHours | null; color: PaletteKey | null; agendaPosition: number | null };
export async function listProfessionals(opts?: { all?: boolean }): Promise<Professional[]>; // ordem: agenda_position (vazio por último), depois nome
export async function setWorkHours(id: string, hours: unknown | null, userId: string): Promise<void>; // audit "horario_profissional" {de, para}
export async function setAppearance(id: string, patch: { color?: string | null; agendaPosition?: number | null }, userId: string): Promise<void>;
export async function setProfessionalService(professionalId: string, serviceId: string, on: boolean, userId: string): Promise<void>; // manual
// service-details.ts
export type ServiceDetailsPatch = { priceCents?; durationMin?; category?; bufferMin?: number | null }; export const SERVICE_BUFFER_MAX = 120;
```
`updateProfessional({ serviceIds })` passa a manter os vínculos que ficam (com `source`/`created_at`) e só tira/acrescenta a diferença.

- [ ] Testes: paleta (12 chaves únicas; cada cor ≥ 3:1 contra o papel `#fdfdfc` e contra a tinta `#121212`; `textOn` ≥ 4,5:1); profissionais (`setWorkHours` grava e `null` volta ao da Casa; erro com dia e faixa; **duas gravações seguidas: vale a última e as duas estão no `audit_log` (Review Focus 5)**; `setAppearance` recusa cor fora da paleta e ordem fora de 1–999; lista por ordem e depois nome; editar serviços mantém `source = 'avec_historico'` de quem continua); serviço (`bufferMin` 0–120, `null` limpa, 121 recusado "Confira a folga: de 0 a 120 minutos.").
- [ ] FALHA → implementar → PASSA → commit `feat(agenda): paleta de 12 cores, horário/cor/ordem da profissional e folga do serviço`.

### Task 5: Permissões novas e concessão única

**Files:** Modify `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `src/server/db/seed.ts`, `src/server/auth/profiles-seed.test.ts`.

**Interfaces — Produces:** `Perm` com `"agenda.marcar" | "agenda.encaixar"`; `PermGroup` com `"Agenda e caixa"`; `ONE_TIME_GRANTS: { profile: "atendente" | "recepcao"; perm: Perm }[]`; `GRANTS_KEY = "perfis_permissoes_concedidas"` (seed).

- [ ] Testes: Gestão tem as duas (obrigatórias); Atendente e Recepção nascem com elas; **perfil que já existia sem elas ganha uma vez; a gestão tira; o seed de novo não devolve**; `settings.perfis_permissoes_concedidas` lista `atendente:agenda.marcar` etc.
- [ ] FALHA → implementar → PASSA → commit `feat(agenda): permissões Marcar e Encaixar, concedidas uma única vez a Atendente e Recepção`.

### Task 6: Modo da agenda e Configurações › Agenda

**Files:** Create `src/lib/agenda-settings.ts` (puro), `src/server/domain/agenda/mode.ts`, `src/server/domain/agenda/mode.test.ts`, `src/app/(app)/config/agenda/page.tsx`, `src/components/config/agenda-settings.tsx`; Modify `src/app/(app)/config/actions.ts`, `src/components/config/config-nav.tsx`.

**Interfaces — Produces:**
```ts
// agenda-settings.ts
export type AgendaMode = "consulta" | "dupla" | "so_crm"; export const AGENDA_MODES: AgendaMode[]; export const STEP_OPTIONS = [10, 15, 20, 30, 60];
export const DEFAULT_AGENDA_RULES = { passoMin: 30 };
export const CONSULTA_MSG = "A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda.";
export const AVEC_TAMBEM_MSG = "Enquanto o Avec estiver ligado, faça também no Avec.";
// mode.ts
export async function getAgendaMode(tx?: Tx | Db): Promise<AgendaMode>; // sem chave → "consulta"
export async function getAgendaRules(tx?: Tx | Db): Promise<{ passoMin: number }>;
export async function assertCanBook(tx?: Tx | Db): Promise<AgendaMode>; // consulta → UserFacingError(CONSULTA_MSG)
export async function saveAgendaSettings(input: { mode: AgendaMode; passoMin: number }, userId: string): Promise<void>;
// actions.ts
export const saveAgendaSettingsAction = async (v: { mode: string; passoMin: number }) => run(..., "/config/agenda");
```
- [ ] Testes: padrão `consulta` e passo 30 sem chave; `assertCanBook` recusa no consulta com a frase exata e passa em dupla/so_crm; salvar audita e recusa modo/passo inválidos.
- [ ] FALHA → implementar (tela com as 3 posições explicadas e o passo; aba "Agenda" no menu de Configurações) → PASSA → commit `feat(agenda): modo da agenda (consulta, dupla, só CRM) e passo, em Configurações › Agenda`.

### Task 7: Bloqueios do CRM

**Files:** Create `src/server/domain/agenda/blocks.ts`, `src/server/domain/agenda/blocks.test.ts`; Modify `src/lib/agenda-blocks.ts` (+ test), `src/server/queries/avec.ts` (`listAgendaBlocks`), `src/server/domain/avec/import-agenda.ts` (merge do bloqueio).

**Interfaces — Produces:**
```ts
// agenda-blocks.ts (puro)
export const BLOCK_REASONS = ["almoco", "folga", "atestado", "feriado", "curso", "outro"] as const; export type BlockReason;
export const BLOCK_REASON_LABEL: Record<BlockReason, string>;
export type ClientInside = { name: string; startsAt: string; professionalName: string | null };
export function clientsInsideText(list: ClientInside[]): string; // "3 clientes marcadas: Paula 10:00, Rita 11:00, Lia 14:00"
// blocks.ts
export type BlockInput = { professionalId: string | null; startsOn: string; endsOn: string; startTime: string; endTime: string; weekdays: number[] | null; reason: BlockReason; note?: string | null };
export async function createBlock(input: BlockInput, userId: string): Promise<{ id: string; clientsInside: ClientInside[] }>;
export async function updateBlock(id: string, input: BlockInput, userId: string): Promise<{ clientsInside: ClientInside[] }>;
export async function deleteBlock(id: string, userId: string): Promise<void>;
// AgendaBlockItem ganha origin e reason; listAgendaBlocks ignora deleted_at
```
Regras: motivo obrigatório ("Outro" exige texto, que vira o título); fim ≥ início e no máximo 366 dias; hora final depois da inicial ("24:00" = fim do dia); "Todas" = `professional_id` nulo; `origin = 'crm'`, `external_key = 'crm:blq:<uuid>'`; modo consulta recusa criar, editar e apagar (`assertCanBook`); apagar marca `deleted_at` também nos do Avec; auditoria `criou_bloqueio`/`editou_bloqueio` (de/para)/`apagou_bloqueio`.

- [ ] Testes: criar/editar/apagar com auditoria; validações (motivo, Outro sem texto, fim antes do início, 367 dias, hora final antes); consulta recusa os três; **clientes dentro: salva, devolve "Paula 10:00" e o horário dela continua `agendado` (Review Focus 4)**; **bloqueio do Avec apagado + `applyAvecFile` do mesmo relatório → continua apagado e fora de `listAgendaBlocks` (Review Focus 3)**.
- [ ] FALHA → implementar → PASSA → commit `feat(agenda): criar, editar e apagar bloqueio (sem apagar de verdade), e a reimportação nunca traz de volta`.

### Task 8: Disponibilidade (`src/server/domain/agenda/availability.ts`)

**Files:** Create `src/server/domain/agenda/availability.ts`, `src/server/domain/agenda/availability.test.ts`, `src/lib/slot-text.ts` (só `proDisplayName` aqui; o resto na Task 12).

**Interfaces — Consumes:** `effectiveRanges` (T2), `freeSlots`/`checkStart` (T3), `getAgendaRules` (T6), `blockAppliesOn`. **Produces:**
```ts
export const OCCUPYING_STATUSES = ["solicitado", "agendado", "confirmado", "chegou", "em_atendimento", "compareceu"] as const;
export async function dayRulesFor(o: { professionalId: string; day: string; clientId?: string | null; ignoreAppointmentId?: string | null; privacy?: boolean }, tx?): Promise<DayRules & { name: string }>;
export async function checkStartFor(o: { professionalId: string; startsAt: Date; serviceId?: string | null; durationMin?: number | null; bufferMin?: number | null; clientId?: string | null; ignoreAppointmentId?: string | null; allowFitIn?: boolean; allowOutsideHours?: boolean; now?: Date }, tx?): Promise<CheckResult>;
export type NextFree =
  | { ok: false; reason: "sem_duracao" | "ninguem_faz"; service: { id: string; label: string }; professionalName?: string }
  | { ok: true; service: { id: string; label: string; durationMin: number; bufferMin: number }; stepMin: number;
      pros: { id: string; name: string; color: string | null; slots: { day: string; start: number; warnings: string[] }[] }[] };
export async function nextFreeSlots(o: { serviceId: string; professionalId?: string | null; now?: Date }, tx?): Promise<NextFree>; // 14 dias, 3 por profissional
// slot-text.ts
export function proDisplayName(name: string): string; // "MAIARA" → "Maiara"
```
Ocupados: `appointments` nos status que ocupam (sem o que está sendo remarcado e sem os do Avec às 00:00 = "sem hora") e leads com `scheduled_at` + profissional, fora de perdido/faltou/remarcou e sem horário na agenda (mesmo `deal_id` ou mesma cliente no mesmo minuto). Duração: a do horário, senão a do serviço, senão desconhecida (`end = start + passo`). Horário que atravessa a meia-noite é cortado em 1440 e continua no dia seguinte.

- [ ] Testes: dia com horário do Avec, do CRM, lead antigo dentro, cancelado e "sem hora" (00:00) de fora; cliente com outra profissional vira `otherPro`; atravessar a meia-noite (23:00 + 120 → 1380–1440 num dia, 0–60 no outro); `nextFreeSlots`: `sem_duracao`, `ninguem_faz`, desativada fora, folga do dia sem sugestão, 3 por profissional, privacidade (nenhum nome de cliente no resultado), procura que atravessa o fim do mês (31/10 → 01/11) (Review Focus 2); `checkStartFor` recusa conflito e aceita encaixe com a flag.
- [ ] FALHA → implementar → PASSA → commit `feat(agenda): disponibilidade a partir do banco (dia de cada profissional, conferir início e próximos horários livres)`.

### Task 9: Quem faz o quê (sugestões do histórico) e script

**Files:** Create `src/server/domain/agenda/who-does-what.ts`, `src/server/domain/agenda/who-does-what.test.ts`, `scripts/quem-faz-o-que.ts`.

**Interfaces — Produces:**
```ts
export type WhoSuggestion = { professionalId: string; professionalName: string; serviceId: string; serviceLabel: string; count: number };
export type WhoUnmatched = { kind: "servico" | "profissional"; name: string; count: number };
export async function suggestProfessionalServices(o?: { since?: string; minCount?: number; now?: Date }, tx?): Promise<{ suggestions: WhoSuggestion[]; unmatched: WhoUnmatched[] }>;
export async function acceptSuggestions(o: { professionalId?: string | null; pairs?: { professionalId: string; serviceId: string }[] }, userId: string | null, tx?): Promise<{ added: number }>;
```
- [ ] Testes (linhas SINTÉTICAS de `6f695f67` em `avec_reports` e de `sales_items`): 2 vezes em 12 meses vira sugestão, 1 não, 13 meses atrás não conta; o mesmo atendimento em dois relatórios conta uma vez; profissional pelo apelido ou nome completo; serviço pelo nome normalizado; não casou → `unmatched` ("Escova progressiva", 12); aceitar grava `source = 'avec_historico'`, é idempotente e nunca tira vínculo manual; aceitar só de uma profissional; par que não é sugestão é ignorado.
- [ ] FALHA → implementar (+ script `--dry-run` imprime a matriz e o que não casou; `--aplicar --backup <arquivo>` grava o JSON de antes e aplica) → PASSA → commit `feat(agenda): quem faz o quê sugerido pelo histórico do Avec, aceitar e script com ensaio e backup`.

### Task 10: Configurações › Serviços (aviso, filtro, folga)

**Files:** Modify `src/components/config/lists.tsx`, `src/app/(app)/config/listas/page.tsx`, `src/app/(app)/config/listas/actions.ts`; Create `src/components/config/lists.test.tsx`.

- [ ] Teste (jsdom): na aba Serviços com 2 sem duração aparece "2 serviços sem duração. Sem a duração, a agenda não sugere horário livre para eles."; "Só os sem duração" esconde os que têm; campo "Folga depois (min)" chama `saveServiceDetailsAction(id, { bufferMin: 10 })`; cada linha tem `id="servico-<id>"` (link direto do Procurar horário).
- [ ] FALHA → implementar → PASSA → commit `feat(agenda): Serviços com aviso dos sem duração, filtro e folga depois`.

### Task 11: Configurações › Profissionais (lista compacta, 3 partes, Quem faz o quê)

**Files:** Rewrite `src/components/config/professionals.tsx`; Create `src/components/config/professional-sheet.tsx`, `src/components/config/work-hours-editor.tsx` (+ `.test.tsx`), `src/components/config/who-does-what.tsx`; Modify `src/app/(app)/config/profissionais/page.tsx`, `src/app/(app)/config/actions.ts`.

**Interfaces — Produces (actions, todas `config.editar` via `run`):** `setWorkHoursAction(id, hours | null)`, `setAppearanceAction(id, { color, agendaPosition })`, `setProfessionalServiceAction(professionalId, serviceId, on)`, `acceptSuggestionsAction({ professionalId?, pairs? })`.

- [ ] Teste (jsdom, `work-hours-editor.test.tsx`): sem horário próprio mostra "Segue o horário da Casa: ter–sáb, 9h–18h"; "Definir horário próprio" parte do da Casa; ligar segunda e salvar pergunta "A Casa não abre na segunda. Ela vai atender mesmo assim?" antes de chamar a action; "Igual ao da Casa" chama `setWorkHoursAction(id, null)`.
- [ ] FALHA → implementar (ativas primeiro, desativadas recolhidas; folha com Dados, Horário de trabalho e Serviços que faz com as sugestões "fez 14 vezes em 12 meses" e "Aceitar as sugestões"; aba "Quem faz o quê" com a matriz e "Aceitar todas as sugestões") → PASSA → commit `feat(agenda): Profissionais em lista compacta com dados, horário de trabalho, serviços e a matriz Quem faz o quê`.

### Task 12: Agenda (Bloquear, hachura e Folga, Procurar horário)

**Files:** Create `src/components/agenda/block-sheet.tsx`, `src/components/agenda/slot-finder.tsx`, `src/components/agenda/agenda-tools.tsx`, `src/lib/slot-text.test.ts`; Modify `src/lib/slot-text.ts`, `src/components/agenda/pro-grid.tsx` (+ test), `src/app/(app)/agenda/page.tsx`, `src/app/(app)/agenda/actions.ts`.

**Interfaces — Produces:**
```ts
// slot-text.ts
export function hourLabel(min: number): string; // 600 → "10h", 870 → "14h30"
export function slotDayLabel(day: string): string; // "2026-10-16" → "quinta, 16/10"
export function optionsText(opts: { day: string; start: number; proName: string }[]): string;
// actions.ts (agenda.marcar)
export async function saveBlockAction(id: string | null, input: BlockInput): Promise<ActionResult<{ clientsInside: ClientInside[] }>>;
export async function deleteBlockAction(id: string): Promise<ActionResult>;
export async function findFreeSlotsAction(input: { serviceId: string; professionalId?: string | null }): Promise<ActionResult<NextFree>>;
// pro-grid.tsx
export type ColumnHours = { ranges: [number, number][]; off: boolean }; // por coluna (chave = id da profissional)
```
- [ ] Testes: `optionsText` ("Tenho quinta, 16/10, às 10h com a Ana ou às 14h30 com a Bia"; dois dias; mesma profissional seguida "às 10h ou às 11h com a Ana"); `ProGrid` com `hours` desenha "Fora do horário de trabalho" acima de 09:00 e mostra "Folga" no topo da coluna sem faixa; bloqueio editável vira botão que chama `onEditBlock`.
- [ ] FALHA → implementar (Bloquear: quem, dia ou período, das … às … ou dia inteiro, repete em dias da semana, motivo; editar/apagar; lembrete do Avec no modo dupla e no bloqueio que veio do Avec; consulta mostra a frase; clientes dentro listadas. Procurar horário: serviço e profissional opcional; "Mechas não tem duração cadastrada…" com link; "Ninguém está marcado para fazer Mechas…"; chips; "Copiar opções") → PASSA → commit `feat(agenda): Bloquear, hachura fora do horário e Folga, e Procurar horário com Copiar opções`.

### Task 13: e2e do lote

**Files:** Modify `e2e/reset.ts` (truncate de profissionais/bloqueios/agenda; `agenda_modo = "dupla"`; Corte com 60 min; Maiara 9h–18h todos os dias, faz Corte; Bia sem horário próprio), `playwright.config.ts` (`celular` roda `agenda-base`); Create `e2e/agenda-base.spec.ts`.

- [ ] Specs: Configurações › Profissionais › Bia › Horário de trabalho: definir, salvar, "Igual ao da Casa"; Agenda › Bloquear (Maiara, amanhã, 12:00–13:00, Almoço) aparece listrado e some ao apagar; Procurar horário (Corte) → "Copiar opções" → área de transferência começa com "Tenho " e termina em "com a Maiara".
- [ ] `createdb crm_e2e_agenda`; `E2E_PORT=3320 DATABASE_URL=…/crm_e2e_agenda npx playwright test e2e/agenda-base.spec.ts --project=desktop --project=celular` → PASSA → commit `test(agenda): e2e do 6A (horário da profissional, bloquear e procurar horário)`.

### Task 14: Fechamento

- [ ] `npm test`, `npm run typecheck`, `npm run lint` (2 erros + 1 aviso de client-pane/context-strip/lead-sheet são de antes), Playwright do lote (desktop e celular). Restaurar `tsconfig.json`/`AGENTS.md` se o next mexer. Apagar `.next-*`, `test-results/`, `playwright-report/`. Ledger em `.superpowers/sdd/agenda-app-cliente/progress.md`.
