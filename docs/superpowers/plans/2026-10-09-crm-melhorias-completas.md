# CRM Casa Fiaes — Melhorias completas · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** implementar a spec de melhorias completas: segurança, dados reversíveis, alertas que chegam, Fila como tela principal, relatórios honestos, origem por link/QR, motion e celular. Deixar tudo pronto para o Contabo sem fazer o deploy.

**Architecture:** a stack continua a mesma: Next 16.4 App Router (sem cacheComponents), Drizzle/Postgres, worker pg-boss, SSE e Evolution 2.3.7. Todo o banco muda numa única migração aditiva (Task 1), feita antes de qualquer trabalho em paralelo. O domínio fica em `src/server/domain/*`, as consultas em `src/server/queries/*` e as telas em `src/app/(app)/*` + `src/components/*`. A Fila (`/atendimento`) é a tela nova principal; o kanban vira Quadro (`/funil`).

**Tech Stack:** next 16.4.0, react 19.3, drizzle-orm 0.45, pg-boss 12, zod 4, motion 14, vitest, @playwright/test. Dependências novas: `web-push` (Task 11), `qrcode` (já instalado) e, em dev, `@axe-core/playwright` (Task 24).

**Spec:** `docs/superpowers/specs/2026-10-09-crm-melhorias-completas-design.md`. Os SQLs de referência dos relatórios estão em `~/Projects/casa-fiaes/investigacao-2026-10-09/04-relatorios-bi.md` §3. **Leia a spec antes de qualquer tarefa.**

**Ledger de progresso:** `docs/superpowers/plans/2026-10-09-ledger.md`. Atualize ao terminar cada tarefa: status, commits, testes rodados, achados da revisão e bloqueios.

## Global Constraints

- Português do Brasil em toda a interface, sentence case, verbos de ação. Sem jargão de vendas em inglês.
- Marca: papel `#fdfdfc`, tinta `#121212`, dourado `#b8863f`. Texto pequeno em dourado usa `gold-ink #946c2e`. Newsreader nos títulos, Inter na interface.
- Sem Three.js, GSAP ou ranking de atendentes. Animação só com `motion/react`, animando apenas `transform`/`opacity`, e sempre respeitando `prefers-reduced-motion`.
- **Toda automação que envia mensagem nasce `enabled:false`.** Nenhum teste ou script envia mensagem real. Nos testes, o provider é sempre o fake (`setWhatsappProvider`).
- Migrações só aditivas: nada de `DROP TABLE`/`DROP COLUMN` nem apagar dados. Exceção permitida: **recriar índice** (`DROP INDEX` + `CREATE INDEX`), porque não apaga dado.
- **Só o orquestrador escreve no ledger** (os subagentes devolvem o resumo e o orquestrador registra), para os worktrees não conflitarem.
- Toda Server Action ou Route Handler revalida a sessão (`requireUser`/`assertUser`/`findSessionUser`).
- Dinheiro em centavos (`integer`). Datas em `timestamptz`, fuso America/Bahia, e o SLA conta só o horário de expediente (`businessSecondsBetween`).
- Leads arquivados (`deals.archived_at is not null`) e contatos `ignored` ficam fora da Fila, do Quadro, do Hoje, dos Relatórios e do motor.
- Celular: inputs com `font-size ≥ 16px`, alvos com ≥ 44 px e zero rolagem horizontal em 390 px.
- Rodam limpos ao fim de cada tarefa: `npx tsc --noEmit` (ignorando só `validator.ts`), `npx eslint src worker e2e --quiet` e `npx vitest run`. O e2e (`npx playwright test`) é obrigatório nas tarefas marcadas com **[e2e]**.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Mensagem chegando com o lead arquivado** ("não é cliente"): não pode reabrir lead nem gerar alerta, e o Desfazer depois traz a conversa completa. → Task 5, teste "arquivado + nova mensagem".
2. **Webhook do pareamento com ~5 mil mensagens durante o modo quieto:** zero alertas e zero follow-ups. Depois de `quiet_until`, um lead novo dispara normalmente. → Task 5, teste "modo quieto".
3. **Valor digitado de jeitos diferentes** (`1.158,50`, `1158.50`, `R$ 1.158`, `1.158`, `abc`): grava os centavos certos ou dá erro claro. Nunca grava ×100. → Task 2.
4. **O mesmo atraso avaliado várias vezes pelo motor no mesmo minuto e depois de escalar:** nunca existem dois alertas ativos para a mesma espera. → Task 6.
5. **Arquivo `.html`/`.svg` disfarçado de imagem** (mimetype declarado `image/jpeg`): é sempre servido como download, nunca inline. → Task 3.

## Ondas de execução e dependências

```
Onda 0 (sequencial):  T1 migração única ─▶ T2 dinheiro+design system
Onda 1 (até 3):       T3 segurança mídia/headers │ T4a IP real+health+heartbeat ─▶ T4b backup/restauração+pm2/Caddy/rollback │ T5 arquivar + modo quieto
Onda 2 (sequencial):  T6 alerta único ─▶ T7 auditoria+assumir+origem/serviço/pago ─▶ T8 tarefas (usa closeSale da T7)
Onda 3 (até 3):       T9 origens link/QR │ T10 enviar mídia+citar+visto │ T11a push+sw+opt-in ─▶ T11b sino+banner+LateWatch
Onda 4 (até 3):       T12 envios automáticos (após T10) │ T13a consultas+testes ─▶ T13b tela+drill-down+CSV │ T14 SSE seletivo (só events.ts/live.tsx/stream)
Onda 5 (sequencial):  T15 Fila lista+rotas (após T14) ─▶ T16 conversa na Fila ─▶ T17a ações+fechar venda+etapas ─▶ T17b próxima ação+triagem+histórico
Onda 6 (até 3):       T18 ficha do contato+busca+views (após T17) │ T19 Quadro+Jornada │ T20 Hoje+resumo 19h (após T13)
Onda 7 (até 3):       T21 motion+desempenho (após T17b) │ T22 Config (após T12,T9) │ T23 sinais+importação+retenção (SÓ domínio e worker; ligar etiquetas na Fila e 'mídia expirada' na conversa fica na T24)
Onda 8 (sequencial):  T24 celular+acessibilidade+axe ─▶ T25 e2e dos critérios ─▶ T26 verificação final e revisão do branch
```

Em paralelo, cada tarefa roda em seu próprio worktree, com os arquivos listados na seção **Files**. Duas tarefas da mesma onda não editam o mesmo arquivo. Exceções declaradas: T6 e T7 tocam `deals.ts` em funções diferentes, mas rodam em sequência dentro da onda (T6, depois T7).

**Subagentes (papéis):**
- Arquiteto (T1, T14, T26)
- Segurança (T3, T4)
- Backend/CRM (T5–T10, T12)
- Dados (T13, T20)
- Frontend/Design (T2, T15–T19, T22–T24)
- Motion (T21)
- QA (T25)
- Revisor independente: após cada tarefa e no fim

---

### Task 1: Migração única (todas as colunas e tabelas novas)

**Objetivo:** criar de uma vez toda a estrutura nova, para que nenhuma tarefa paralela gere migração.

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0008_melhorias.sql` (gerado), `src/server/db/schema.test.ts`
- Modify: `src/server/db/seed-data.ts` (lista `service`, modelos `lead_sources` não), `test/db.ts` (truncate das tabelas novas), `e2e/reset.ts` (truncate)

**Interfaces (Produces):**
- `deals`:
  - `archivedAt timestamp`, `archivedBy uuid→users`, `archivedStageId uuid→stages`
  - `sourceId uuid→lead_sources`, `sourceLabel text`
  - `serviceId uuid→lists`
  - `paidAt timestamp`, `paidCents integer`
  - `attendance text` (`compareceu`|`faltou`|`remarcou`), `attendanceAt timestamp`
- `lists.cycleDays smallint` (null = sem ciclo); `listKinds` passa a incluir `"service"`.
- `leadSources`:
  - `id`, `code text unique` (6–12 chars `[a-z0-9]`), `label text`
  - `kind text` (`instagram`|`google`|`panfleto`|`indicacao`|`anuncio`|`recepcao`|`outro`)
  - `prefill text`, `referrerContactId uuid?`, `active bool default true`, `createdAt`
- `tasks`:
  - `id`, `dealId uuid? → deals (cascade)`, `contactId uuid → contacts`
  - `kind text` (`proxima_acao`|`retorno`|`comparecimento`|`geral`), `title text`
  - `dueAt timestamptz`, `assigneeId uuid?`, `doneAt timestamptz?`, `createdBy uuid?`, `createdAt`
  - índice `(done_at, due_at)`
- `alerts`: `waitKey text?`, `level smallint default 1`, `escalatedAt timestamp?`, `pushedAt timestamp?`; índice único parcial `alerts_wait_uq` em `(wait_key) where resolved_at is null and wait_key is not null`.
- `channels.quietUntil timestamp?`
- `messages.mediaPurgedAt timestamp?`
- `pushSubscriptions`: `id`, `userId → users (cascade)`, `endpoint text unique`, `p256dh text`, `auth text`, `createdAt`, `lastOkAt?`
- `contacts.lastAutoReplyAt timestamp?`
- Extensão `pg_trgm` + índice GIN trigram em `contacts.name` e em `messages.body` (para a busca da T18).

- [ ] **Step 1: teste que falha.** Em `src/server/db/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from ".";
const cols = async (t: string) => ((await db.execute(sql`select column_name from information_schema.columns where table_name = ${t}`)).rows as { column_name: string }[]).map((r) => r.column_name);
describe("migração das melhorias", () => {
  it("deals tem arquivamento, origem, serviço, pago e comparecimento", async () => {
    const c = await cols("deals");
    for (const k of ["archived_at", "archived_by", "archived_stage_id", "source_id", "source_label", "service_id", "paid_at", "paid_cents", "attendance", "attendance_at"]) expect(c).toContain(k);
  });
  it("tabelas novas existem", async () => {
    for (const t of ["lead_sources", "tasks", "push_subscriptions"]) expect((await cols(t)).length).toBeGreaterThan(3);
    expect(await cols("alerts")).toEqual(expect.arrayContaining(["wait_key", "level", "escalated_at", "pushed_at"]));
    expect(await cols("channels")).toContain("quiet_until");
    expect(await cols("messages")).toContain("media_purged_at");
    expect(await cols("contacts")).toContain("last_auto_reply_at");
    expect(await cols("lists")).toContain("cycle_days");
  });
  it("pg_trgm ativo", async () => {
    const r = await db.execute(sql`select 1 from pg_extension where extname = 'pg_trgm'`);
    expect(r.rows.length).toBe(1);
  });
});
```
- [ ] **Step 2:** `npx vitest run src/server/db/schema.test.ts` → FAIL (colunas ausentes).
- [ ] **Step 3:** editar `schema.ts` com as colunas e tabelas acima, seguindo o padrão `id()`/`createdAt()` do arquivo. Rodar `npx drizzle-kit generate --name melhorias`. **Editar o SQL gerado** e acrescentar no topo `CREATE EXTENSION IF NOT EXISTS pg_trgm;`; no fim, `CREATE INDEX IF NOT EXISTS contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);` e `CREATE INDEX IF NOT EXISTS messages_body_trgm ON messages USING gin (body gin_trgm_ops);`. O índice parcial `alerts_wait_uq` fica no schema via `uniqueIndex(...).on(t.waitKey).where(sql\`resolved_at is null and wait_key is not null\`)`.
- [ ] **Step 4:** `test/db.ts` e `e2e/reset.ts`: acrescentar `tasks, lead_sources, push_subscriptions` ao `truncate`. `seed-data.ts`: `DEFAULT_LISTS.service = ["Avaliação capilar", "Tratamento de queda", "Coloração", "Corte", "Hidratação"]`, com `cycleDays` 35 para Coloração e 30 para Hidratação. O `seed.ts` insere `cycleDays` quando definido. `config.ts listKinds` acrescenta `"service"`.
- [ ] **Step 5:** `npm run db:migrate && npx vitest run` → tudo PASS. Também aplicar no banco e2e: `DATABASE_URL=<crm_e2e> npx drizzle-kit migrate`.
- [ ] **Step 6:** commit `feat(db): migração única das melhorias (arquivamento, origens, tarefas, push, alertas por espera, retenção, trigram)`.

**Aceite:** os testes de schema passam e o `vitest` continua 100%. **Verificação:** `\d deals` no psql mostra as colunas.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Recriar o índice `deals_one_open_per_contact` com `where closed_at is null and archived_at is null` (drop/create index, no schema via `uniqueIndex(...).where(sql`...`)`).
- `list_kind` é **enum do Postgres**: `listKindEnum` ganha `'service'` (o SQL gerado terá `ALTER TYPE ... ADD VALUE`); ajustar também o cast em `seed.ts`.
- `deals.attendance` aceita `confirmado|compareceu|faltou|remarcou` (texto; validar no domínio).
- Criar aqui também a tabela **`outbox`** (`id`, `dealId → deals cascade`, `kind text` text|poll, `text`, `options jsonb?`, `status text` pending|sent|failed default pending, `notBefore timestamptz default now()`, `sentAt?`, `error?`, `attempts smallint default 0`, `createdAt`; índice `(status, not_before)`). A T12 **não** cria migração.
- Passo 4: `test/db.ts` e `e2e/reset.ts` truncam também **`settings, outbox`** (além de `tasks, lead_sources, push_subscriptions`). Atenção: `e2e/reset.ts` já insere `business_hours` depois do truncate; manter.
- `pg_trgm`: o usuário `crm` é superusuário no Docker local (conferido); no Contabo, o `docs/deploy-contabo.md` deve dizer que a extensão precisa existir (criar como superusuário se o papel da app não for).

---

### Task 2: Dinheiro (parseBRL) + base do design system

**Objetivo:** um parser único para valores em reais; tokens e componentes padrão que todas as telas seguintes vão usar.

**Files:**
- Create: `src/lib/money.ts`, `src/lib/money.test.ts`
- Create: `src/components/ui/{sheet,tabs,menu,icon-button,segmented}.tsx`
- Modify: `src/app/globals.css` (`@theme`), `src/components/ui/field.tsx` (Select usa token, `text-[16px]` no celular), `src/components/pipeline/stage-dialogs.tsx:37`, `src/components/lead/fields.tsx:30` (usar `parseBRL`)

**Interfaces (Produces):**
- `parseBRL(input: string): { ok: true; cents: number } | { ok: false; error: string }`
- `formatBRL(cents: number): string`
- `<Sheet open onClose title labelledBy? side="right"|"bottom" initialFocusRef?>`: `role="dialog"`, `aria-modal`, foco preso, Esc fecha, devolve o foco a quem abriu.
- `<Tabs value onChange items={[{value,label,count?}]}>`: `role=tablist`, navegação por setas.
- `<Menu trigger items={[{label,onSelect,danger?}]}>`: Esc, setas, foco.
- `<IconButton label size="md|lg">`: 44 px no toque (`min-h-11 min-w-11` em `pointer:coarse`).
- `<Segmented options value onChange>`, usado para os chips de pagamento.
- Tokens em `@theme`:
  - texto: `--text-xs:12px --text-sm:13px --text-base:14px --text-md:16px --text-lg:18px --text-xl:22px --text-2xl:28px --text-3xl:40px`
  - raios: `--radius-control:10px --radius-card:14px --radius-panel:18px`
  - cores: `--color-gold-ink:#946c2e`; `--color-line-strong` com ≥ 3:1 sobre o papel (`#8f887c`)

- [ ] **Step 1: teste que falha** (`src/lib/money.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { parseBRL, formatBRL } from "./money";
describe("parseBRL", () => {
  it.each([
    ["1.158,50", 115850], ["1158,50", 115850], ["1158.50", 115850], ["R$ 1.158,50", 115850],
    ["1.158", 115800], ["1158", 115800], ["0,5", 50], ["12.345.678,90", 1234567890], [" 99 ", 9900],
  ])("%s → %i centavos", (i, c) => expect(parseBRL(i)).toEqual({ ok: true, cents: c }));
  it.each(["", "abc", "1,2,3", "-10", "1.15.8,50"])("%s é inválido", (i) => expect(parseBRL(i).ok).toBe(false));
  it("formata", () => expect(formatBRL(115850)).toBe("R$ 1.158,50"));
});
```
- [ ] **Step 2:** rodar → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar:
```ts
// src/lib/money.ts — um único jeito de ler dinheiro digitado (pt-BR primeiro, "1158.50" aceito).
export function parseBRL(input: string): { ok: true; cents: number } | { ok: false; error: string } {
  const s = input.replace(/R\$|\s/g, "");
  if (!s || !/^\d[\d.,]*$/.test(s)) return { ok: false, error: "Digite um valor, ex.: 1.158,50" };
  let intPart: string, dec = "";
  if (s.includes(",")) {
    const [a, b, ...rest] = s.split(",");
    if (rest.length || !/^\d{1,2}$/.test(b) || !/^\d{1,3}(\.\d{3})*$|^\d+$/.test(a)) return { ok: false, error: "Valor inválido" };
    intPart = a.replace(/\./g, ""); dec = b;
  } else if (/^\d+\.\d{1,2}$/.test(s)) { [intPart, dec] = s.split("."); }          // 1158.50
  else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) intPart = s.replace(/\./g, "");      // 1.158 = milhar
  else return { ok: false, error: "Valor inválido" };
  return { ok: true, cents: Number(intPart) * 100 + Number(dec.padEnd(2, "0") || 0) };
}
export const formatBRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
```
- [ ] **Step 4:** rodar → PASS. Trocar os parsers de `stage-dialogs.tsx` e `fields.tsx` por `parseBRL`, mostrando `error` abaixo do campo.
- [ ] **Step 5:** tokens e componentes. Codemod em `src/**/*.tsx`: `rounded-[10px|11px|12px]` → `rounded-[var(--radius-control)]`; `rounded-[14px|16px]` → `rounded-[var(--radius-card)]`; `rounded-[18px|20px]` → `rounded-[var(--radius-panel)]`; tamanhos `text-[11px|11.5px|12px]` → `text-xs`, `text-[12.5px|13px|13.5px]` → `text-sm`, `text-[14px|14.5px|15px]` → `text-base`. Fazer com script `node` revisado e conferir o diff. `text-gold` em texto menor que 18 px → `text-gold-ink`. Os componentes novos seguem o padrão de `ui/dialog.tsx` (que já tem trava de foco).
- [ ] **Step 6:** `npx tsc --noEmit && npx eslint src --quiet && npx vitest run && npx playwright test` **[e2e]** → verde. Capturas antes e depois do Funil e do card, com olho humano: nada quebrado.
- [ ] **Step 7:** commit `feat(ui): parseBRL único + tokens (tipo, raio, gold-ink, borda 3:1) + Sheet/Tabs/Menu/IconButton/Segmented`.

**Aceite:** "1158.50" salva R$ 1.158,50 no fechar venda (e2e); contraste das bordas ≥ 3:1 (calculado no teste de tokens, se der, ou anotado no ledger).

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- `formatBRL` troca o espaço inquebrável: `.replace(/\u00a0/g, " ")`.
- **Não** redefinir `--color-line-strong` (escureceria 19 divisórias). A borda de campo usa o `--color-control` (`#a39d92`, já 3:1). O `--color-gold-ink` **já existe** (`#7a5524`, 4,9:1): manter, não clarear para `#946c2e`.
- No codemod de tamanho de texto, conferir o `line-height` (as classes `text-xs/sm/base` do Tailwind trazem line-height próprio); se mudar o layout, usar `text-[length:var(--text-sm)]` para preservar o line-height atual.

---

### Task 3: Mídia segura + cabeçalhos de segurança + CSP com nonce

**Files:**
- Create: `src/server/security/sniff.ts`, `src/server/security/sniff.test.ts`, `src/server/security/headers.test.ts`
- Modify: `src/app/api/media/[id]/route.ts`, `src/app/api/avatar/[id]/route.ts`, `src/server/whatsapp/media.ts` (gravar o tipo detectado), `next.config.ts` (`headers()`), `src/proxy.ts` (nonce + CSP), `src/app/layout.tsx` (ler o nonce, se precisar para scripts próprios)

**Interfaces (Produces):**
- `sniffMime(buf: Uint8Array): SafeMime | null`, com `SafeMime = "image/jpeg"|"image/png"|"image/webp"|"image/gif"|"audio/ogg"|"audio/mpeg"|"audio/mp4"|"video/mp4"|"video/webm"|"application/pdf"`
- `mediaHeaders(detected: SafeMime | null, fileName: string): Record<string,string>`

- [ ] **Step 1: testes que falham** (`sniff.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { sniffMime, mediaHeaders } from "./sniff";
const b = (...x: number[]) => new Uint8Array(x);
describe("sniffMime", () => {
  it("reconhece jpeg/png/pdf/ogg", () => {
    expect(sniffMime(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("OggS\0"))).toBe("audio/ogg");
  });
  it("html e svg nunca são aceitos, mesmo começando com espaço", () => {
    expect(sniffMime(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("  <svg onload=alert(1)>"))).toBeNull();
  });
});
describe("mediaHeaders", () => {
  it("tipo seguro abre inline com nosniff e sandbox", () => {
    const h = mediaHeaders("image/jpeg", "foto.jpg");
    expect(h["content-type"]).toBe("image/jpeg");
    expect(h["content-disposition"]).toMatch(/^inline/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toBe("sandbox");
  });
  it("desconhecido vira download octet-stream com nome sanitizado", () => {
    const h = mediaHeaders(null, '../"x".html');
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(h["content-disposition"]).toBe('attachment; filename="x.html"');
  });
});
```
  E `headers.test.ts`, que testa `next.config` diretamente:
```ts
import { it, expect } from "vitest";
import config from "../../../next.config";
it("cabeçalhos globais", async () => {
  const all = await config.headers!();
  const h = Object.fromEntries(all.find((r) => r.source === "/:path*")!.headers.map((x) => [x.key.toLowerCase(), x.value]));
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["permissions-policy"]).toContain("camera=()");
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar `sniff.ts`, com assinaturas por bytes: JPEG `FF D8 FF`; PNG `89 50 4E 47`; GIF `47 49 46 38`; WebP `RIFF....WEBP`; PDF `%PDF-`; OGG `OggS`; MP3 `ID3` ou `FF Fx`; MP4/M4A `....ftyp` (`ftypM4A` → `audio/mp4`, o resto → `video/mp4`); WebM `1A 45 DF A3`. `mediaHeaders` sanitiza o nome com `path.basename`, remove `"`, limita a 80 caracteres e põe `cache-control: private, max-age=31536000, immutable`. Nas rotas: ler o arquivo, `sniffMime(data.subarray(0, 32))` e responder com `mediaHeaders`. `media.ts`: ao salvar, grava `mediaMime = sniffMime(buf) ?? "application/octet-stream"`, desconfiando do mimetype declarado.
- [ ] **Step 4:** `next.config.ts`: `async headers() { return [{ source: "/:path*", headers: [...] }] }` com nosniff, Referrer-Policy, `X-Frame-Options: DENY` e `Permissions-Policy: camera=(), microphone=(self), geolocation=(), notifications=(self)`. O microfone fica liberado para gravar áudio (T10). `proxy.ts`: gerar o nonce (`btoa(crypto.randomUUID())`) e montar a CSP do guia `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, com `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self'` (em dev, `ws:`), `worker-src 'self'`, `frame-ancestors 'none'`. A CSP vai em requisições de página; o matcher continua excluindo `api/webhooks` e os estáticos.
- [ ] **Step 5:** rodar os testes → PASS. No navegador (Playwright headless), abrir `/`, `/funil` e o card de um lead com foto: **0 violações de CSP no console** e a foto carrega.
- [ ] **Step 6:** commit `fix(segurança): mídia por assinatura (html/svg nunca inline) + cabeçalhos + CSP com nonce`.

**Aceite:** Review Focus 5 coberto (teste de mídia com mimetype declarado `image/jpeg` e conteúdo `<svg>` → download). Console sem violação de CSP.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Atualizar a fixture de `src/server/whatsapp/media.test.ts` (incluir nos Files): o conteúdo baixado vira bytes JPEG reais (`Buffer.from([0xff,0xd8,0xff,0xe0, ...])`), porque o `mediaMime` passa a vir do `sniffMime`.
- `Permissions-Policy`: **sem** `notifications=` (o Chrome não reconhece e loga erro). Usar `camera=(), microphone=(self), geolocation=()`.
- PDF: servir como **download** (`attachment`), porque `CSP: sandbox` em PDF inline bloqueia o visualizador do Chrome. Inline só para imagem, áudio e vídeo.
- O nonce: `await headers()` no `app/layout.tsx` raiz (deixa a renderização dinâmica; o app já é dinâmico) para o Next aplicar o nonce nos scripts.
- A CSP vale também para as rotas públicas (`/login`, `/convite`): o `proxy.ts` monta a CSP **antes** do `return` de rota pública.

---

### Task 4: Operação: IP real, health, heartbeat, backup e restauração, deploy

**Files:**
- Create: `src/server/auth/client-ip.ts` (+ test), `scripts/backup.sh`, `scripts/restore.sh`, `scripts/restore-test.sh`, `deploy/ecosystem.config.cjs`, `deploy/Caddyfile.example`, `docs/backup-restauracao.md`
- Modify: `src/app/login/actions.ts`, `src/app/convite/[token]/actions.ts` (se houver rate limit), `src/app/api/health/route.ts`, `worker/index.ts` (heartbeat), `src/server/env.ts` (`TRUSTED_PROXY_HOPS`, `BACKUP_DIR`), `docs/deploy-contabo.md` (roteiro + rollback), `.env.example`

**Interfaces (Produces):**
- `clientIp(h: Headers, socketIp?: string): string`: com `TRUSTED_PROXY_HOPS=n`, pega o n-ésimo IP **da direita** do `x-forwarded-for`; com 0, ignora o XFF e devolve `socketIp ?? "local"`.
- `getHealth(): Promise<{ status: "ok"|"degraded"|"down"; db: boolean; worker: { ok: boolean; lastBeatAt: string|null }; whatsapp: { name: string; status: string }[] }>`, em `src/server/health.ts`.

- [ ] **Step 1: testes que falham:**
```ts
// src/server/auth/client-ip.test.ts
import { it, expect } from "vitest";
import { clientIp } from "./client-ip";
const H = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});
it("atrás de 1 proxy confiável pega o IP adicionado pelo proxy (último)", () => {
  expect(clientIp(H("6.6.6.6, 1.2.3.4"), undefined, 1)).toBe("1.2.3.4");
});
it("sem proxy confiável ignora XFF forjado", () => {
  expect(clientIp(H("6.6.6.6"), "10.0.0.9", 0)).toBe("10.0.0.9");
});
// src/server/health.test.ts
import { it, expect } from "vitest";
import { db } from "./db"; import { settings, channels } from "./db/schema";
import { getHealth } from "./health"; import { resetDb } from "../../test/db";
it("worker sem batida há 5 min = degraded; banco ok", async () => {
  await resetDb();
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date(Date.now() - 5 * 60_000).toISOString() });
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado" });
  const h = await getHealth();
  expect(h).toMatchObject({ status: "degraded", db: true, worker: { ok: false } });
  expect(h.whatsapp[0]).toEqual({ name: "Recepção", status: "conectado" });
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar `clientIp` (assinatura `clientIp(h, socketIp?, hops = env().TRUSTED_PROXY_HOPS)`) e usar no login e no convite. Implementar `health.ts`: `select 1`; heartbeat em `settings.worker_heartbeat` (ok se < 3 min); canais não removidos. Status: `down` se o banco falhar, `degraded` se o worker ou algum canal "conectado" estiver em erro ou desconectado, senão `ok`. A rota devolve 503 só em `down`. O worker grava o heartbeat a cada minuto (`upsert settings`).
- [ ] **Step 4:** scripts:
  - `backup.sh`: `set -euo pipefail`, `umask 077`, pasta `$BACKUP_DIR/AAAA-MM-DD_HHMM/`, `pg_dump -Fc` de `crm` e `evolution` via `docker compose exec -T db`, `tar czf media.tgz -C $MEDIA_DIR .`, tar do volume `evolution_instances` via `docker run --rm -v ...:/v alpine tar`, `sha256sum * > SHA256SUMS`, apagar pastas com mais de 14 dias.
  - `restore.sh <pasta> [--into-db nome]`: confere o `sha256sum -c` e faz `pg_restore` no banco indicado.
  - `restore-test.sh`: roda o backup, restaura em `crm_restore_test` e compara `count(*)` de `deals`, `messages` e `contacts` com o original. Sai ≠ 0 se divergir. Depois faz drop do banco temporário (só ele).
  - `docs/backup-restauracao.md`: cron sugerido (`0 3 * * *`) e cópia fora do VPS (rclone, decisão do dono).
- [ ] **Step 5:** `bash scripts/restore-test.sh` localmente → "restauração OK" (só o banco temporário é tocado). `ecosystem.config.cjs` com os apps `crm-web` (`next start -p 3000`) e `crm-worker` (`tsx worker/index.ts`), ambos com `max_memory_restart`. `Caddyfile.example`: `reverse_proxy localhost:3000 { flush_interval -1 }` (SSE), `encode gzip`, `header -Server`. `deploy-contabo.md`: passos numerados, checagem do `/api/health` e **rollback** (`git checkout <tag anterior> && npm ci && npm run build && pm2 reload` + restore do backup).
- [ ] **Step 6:** testes verdes. `npm run build` passa (primeira verificação de build). Commit `feat(operação): IP real no rate limit, health com worker/WhatsApp, backup+restauração testada, pm2/Caddy/rollback`.

**Aceite:** o restore-test passa; o build passa; o health mostra 3 partes.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Dividir em duas sub-tarefas sequenciais:** T4a = `clientIp` + `health` + heartbeat; T4b = backup/restore/restore-test + pm2/Caddy + roteiro de deploy e rollback.
- Volume da Evolution: `casa-fiaes-crm_evolution_instances` (conferir com `docker volume ls`).
- Server Action não tem IP da conexão: com `TRUSTED_PROXY_HOPS=0`, a chave cai em `"local"` (todos dividem o limite). Documentar que em produção (atrás do Caddy) o valor é 1; em dev local tudo bem.
- `/api/health` responde **200 em `ok` e `degraded`** e 503 só em `down` (o webServer do Playwright depende disso).

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- S3 (limite no webhook): além do segredo, limite por instância de 600 req/min em memória; acima disso responde 429 (a Evolution reenvia).

---

### Task 5: "Não é cliente" reversível + triagem em massa + modo quieto

**Files:**
- Modify: `src/server/domain/deals.ts` (`ignoreContact`, `unignoreContact`, `findOpenDeal`, `recordInbound`, `importHistoryChat`), `src/server/rules/engine.ts` (`candidatesFor` exclui arquivados e canais em modo quieto), `src/server/whatsapp/webhook.ts` (`connection.update` liga o modo quieto), `src/server/queries/{board,today,alerts}.ts` (`archived_at is null`), `src/server/reports/index.ts` (filtro), `worker/index.ts` (nada; o motor já usa `now`)
- Create: `src/server/domain/archive.ts`, `src/server/domain/archive.test.ts`, `src/server/domain/quiet.ts`
- Test: `src/server/whatsapp/auditoria-real.test.ts` (ajustar o teste de ignorar)

**Interfaces (Produces):**
- `archiveDeals(dealIds: string[], userId: string): Promise<{ archived: number }>`: grava `archivedAt`, `archivedBy` e `archivedStageId` com a etapa atual, marca `contacts.ignored = true` e registra o evento `arquivado`.
- `restoreDeals(dealIds: string[], userId: string): Promise<{ restored: number; conflicts: string[] }>`: só restaura se o contato não tiver outro lead aberto; senão o id vai para `conflicts`. Limpa os campos de arquivamento, `ignored = false` e registra o evento `restaurado`.
- `isQuiet(channelId: string|null, now: Date): Promise<boolean>`; `startQuiet(channelId: string, hours = 48)`; `endQuiet(channelId: string)`.
- `ignoreContact` e `unignoreContact` passam a delegar para `archiveDeals`/`restoreDeals`. **Remover o delete em cascata.**

- [ ] **Step 1: testes que falham** (`archive.test.ts`), com o fake provider e `resetDb`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { deals, messages, contacts, users, channels, alerts } from "../db/schema";
import { recordInbound } from "./deals"; import { archiveDeals, restoreDeals } from "./archive";
import { startQuiet } from "./quiet"; import { runRules } from "../rules/engine";
import { resetDb } from "../../../test/db";
let uid = "";
beforeEach(async () => { await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "T", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning(); });
describe("arquivar (não é cliente)", () => {
  it("arquiva sem apagar e Desfazer restaura etapa e mensagens", async () => {
    const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71999990001", body: "oi primo" });
    if (!("dealId" in r)) throw new Error();
    await archiveDeals([r.dealId], uid);
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.archivedAt).not.toBeNull();
    expect((await db.select().from(messages)).every((m) => m.dealId === r.dealId)).toBe(true);
    await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71999990001", body: "e aí" }); // Review Focus 1
    expect((await db.select().from(deals)).length).toBe(1);
    expect(await db.select().from(alerts)).toHaveLength(0);
    const res = await restoreDeals([r.dealId], uid);
    expect(res).toEqual({ restored: 1, conflicts: [] });
    const [back] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(back.archivedAt).toBeNull();
    expect((await db.select().from(contacts))[0].ignored).toBe(false);
    expect((await db.select().from(messages)).length).toBe(2);
  });
  it("em massa", async () => {
    const ids: string[] = [];
    for (const p of ["71999990002", "71999990003", "71999990004"]) { const r = await recordInbound({ channelId: null, externalId: p, phoneRaw: p, body: "oi" }); if ("dealId" in r) ids.push(r.dealId); }
    expect(await archiveDeals(ids, uid)).toEqual({ archived: 3 });
  });
});
describe("modo quieto", () => {
  it("canal em modo quieto não gera alerta; depois de quiet_until gera", async () => { // Review Focus 2
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado" }).returning();
    await startQuiet(ch.id, 48);
    const t0 = new Date("2026-10-13T13:00:00Z");
    await recordInbound({ channelId: ch.id, externalId: "Q1", phoneRaw: "71999990005", body: "oi", at: t0 });
    await runRules(new Date(t0.getTime() + 30 * 60_000));
    expect(await db.select().from(alerts)).toHaveLength(0);
    await db.update(channels).set({ quietUntil: new Date(t0.getTime() - 1) });
    await runRules(new Date(t0.getTime() + 31 * 60_000));
    expect((await db.select().from(alerts)).length).toBeGreaterThan(0);
  });
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar `archive.ts` e `quiet.ts`:
  - `findOpenDeal` passa a considerar aberto só `closed_at is null and archived_at is null`. **Atenção:** contatos `ignored` continuam caindo no caminho "ignorado" do `recordInbound` (a mensagem é guardada vinculada ao lead **arquivado** mais recente, não com `dealId null`, para o Desfazer trazer a conversa).
  - `candidatesFor` ganha `and d.archived_at is null and (ch.quiet_until is null or ch.quiet_until < $now)`, com `left join channels ch on ch.id = d.channel_id`.
  - `webhook.ts`, em `connection.update`: se `status === "conectado"` e (`before.status !== "conectado"` ou `before.phone` mudou), chamar `startQuiet(before.id, 48)`.
  - Consultas e relatórios ganham `isNull(deals.archivedAt)`.
- [ ] **Step 4:** ajustar o teste antigo de `ignoreContact` em `auditoria-real.test.ts` (agora arquiva) → rodar tudo → PASS.
- [ ] **Step 5:** commit `feat(dados): "não é cliente" vira arquivamento reversível (individual e em massa) + modo quieto de 48 h após parear`.

**Aceite:** Review Focus 1 e 2 cobertos. Nenhum `delete from deals` em `src/`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- `startQuiet(channelId, hours = 48, now = new Date())`; o teste chama `startQuiet(ch.id, 48, t0)` (senão `quiet_until` usa o relógio real e o teste falha).
- Com o índice recriado na T1, o ramo `conflicts` do `restoreDeals` passa a existir de verdade. Teste obrigatório: arquivar o lead A; a gestão cria um lead manual B para o mesmo contato (`createManualLead`); `restoreDeals([A])` devolve `{ restored: 0, conflicts: [A] }` e A continua arquivado.

---

### Task 6: Um alerta por espera, com escalonamento

**Files:**
- Modify: `src/server/rules/engine.ts` (ações `alertar_*` dos gatilhos `sem_resposta_minutos`), `src/server/domain/deals.ts` (`recordOutbound`: resolver por `waitKey`), `src/server/db/seed-data.ts` (`gestao_10min` vira escalonamento: ação `escalar_gestao`), `src/server/rules/types.ts` (nova ação `escalar_gestao`), `src/server/queries/alerts.ts`
- Test: `src/server/rules/alertas-unicos.test.ts`

**Interfaces (Produces):**
- `waitKeyOf(dealId: string, awaitingSince: Date): string` = `` `${dealId}:${awaitingSince.toISOString()}` `` (em `src/server/rules/wait-key.ts`).
- Ação `{ type: "escalar_gestao" }`: faz `update alerts set level = 2, audience = 'gestao', escalated_at = now` onde `wait_key = X and resolved_at is null`. Se não existir alerta, cria um de nível 2.
- Os alertas de espera são inseridos com `waitKey` e `level = 1`, usando `onConflictDoNothing` (índice `alerts_wait_uq`).

- [ ] **Step 1: teste que falha:**
```ts
import { it, expect, beforeEach } from "vitest";
import { db } from "../db"; import { alerts, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals"; import { runRules } from "./engine";
import { resetDb } from "../../../test/db";
beforeEach(async () => { await resetDb(); await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }); });
it("mesma espera: 1 alerta, escala para gestão e resolve com a resposta", async () => { // Review Focus 4
  const t0 = new Date("2026-10-13T13:00:00Z");
  const r = await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999991111", body: "oi", at: t0 });
  if (!("dealId" in r)) throw new Error();
  for (const m of [3, 3, 5, 11, 12, 30]) await runRules(new Date(t0.getTime() + m * 60_000));
  const active = (await db.select().from(alerts)).filter((a) => !a.resolvedAt);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ level: 2, audience: "gestao" });
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi!", at: new Date(t0.getTime() + 31 * 60_000) });
  expect((await db.select().from(alerts)).every((a) => a.resolvedAt)).toBe(true);
});
```
- [ ] **Step 2:** rodar → FAIL (hoje há 2 alertas).
- [ ] **Step 3:** implementar. No `executeAction`, para gatilhos `sem_resposta_minutos` com ações `alertar_responsavel`/`alertar_gestao`: `waitKey = waitKeyOf(c.dealId, c.awaitingSince)` (incluir `awaitingSince` no `Candidate`) e inserir com `onConflictDoNothing` em `alerts_wait_uq`. A automação `gestao_10min` passa a ter `actions:[{type:"escalar_gestao"}]`; o seed atualiza só se não foi editada, como já faz. Em `recordOutbound`, resolver os alertas onde `wait_key like dealId || ':%' and resolved_at is null`.
- [ ] **Step 4:** `npx vitest run` → PASS (ajustar `engine.test.ts`, que esperava 2 alertas).
- [ ] **Step 5:** commit `feat(alertas): um alerta por espera que escala do responsável para a gestão`.

---

### Task 7: Auditoria antes/depois + Assumir + origem × canal + serviço + pago + comparecimento (domínio)

**Files:**
- Modify: `src/server/domain/updates.ts` (`dealPatchSchema` ganha `serviceId`, `sourceId`, `paidAt`, `paidCents`, `attendance`; o `origin` legado continua aceito e mapeia para `sourceLabel`), `src/server/domain/deals.ts` (`detectOrigin` → `detectSource`: devolve `null` para "WhatsApp"/canal; `recordOutbound` atribui a resposta pelo celular ao `owner_id` atual)
- Create: `src/server/domain/assign.ts`, `src/server/domain/updates.test.ts`

**Interfaces (Produces):**
- `claimDeal(dealId: string, userId: string): Promise<{ previousOwnerId: string|null }>`: registra o evento `assumiu`.
- Evento `campo_alterado.payload = { campos: [{ campo: string; de: unknown; para: unknown }] }`.
- `closeSale(dealId, { serviceId, valueCents, paymentMethod, paidNow: boolean }, userId)`: move para `fechado` numa única transação. É idempotente: se já estiver fechado, devolve sem duplicar o evento `venda`.
- `setAttendance(dealId, "compareceu"|"faltou"|"remarcou", userId)`.

- [ ] **Step 1: testes que falham:**
```ts
import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { dealEvents, deals, users, lists } from "../db/schema";
import { recordInbound, recordOutbound } from "./deals"; import { updateDeal, closeSale } from "./updates";
import { claimDeal } from "./assign"; import { resetDb } from "../../../test/db";
let ana = "", bia = "";
beforeEach(async () => { await resetDb(); [{ id: ana }, { id: bia }] = await db.insert(users).values([{ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }, { name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }]).returning(); });
const lead = async () => { const r = await recordInbound({ channelId: null, externalId: Math.random().toString(), phoneRaw: "71999992222", body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
it("auditoria guarda de/para", async () => {
  const id = await lead();
  await updateDeal(id, { observations: "quer luzes" }, ana);
  await updateDeal(id, { observations: "quer luzes e corte" }, bia);
  const ev = (await db.select().from(dealEvents).where(eq(dealEvents.type, "campo_alterado"))).at(-1)!;
  expect(ev.payload).toEqual({ campos: [{ campo: "observations", de: "quer luzes", para: "quer luzes e corte" }] });
  expect(ev.userId).toBe(bia);
});
it("assumir atribui a resposta dada pelo celular", async () => {
  const id = await lead();
  await claimDeal(id, bia);
  await recordOutbound({ phoneRaw: "557199992222@s.whatsapp.net", channelId: null, externalId: "X", body: "oi", fromPhone: true });
  const [r] = await db.select().from(dealEvents).where(eq(dealEvents.type, "resposta"));
  expect(r.userId).toBe(bia);
});
it("fechar venda grava serviço, valor e pagamento, sem duplicar", async () => {
  const id = await lead();
  const [svc] = await db.select().from(lists).where(eq(lists.kind, "service"));
  await closeSale(id, { serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidNow: true }, ana);
  await closeSale(id, { serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidNow: true }, ana);
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d).toMatchObject({ serviceId: svc.id, valueCents: 115850, paymentMethod: "pix", paidCents: 115850 });
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "venda"))).length).toBe(1);
});
it("origem ≠ canal: mensagem comum fica sem origem identificada", async () => {
  const id = await lead();
  const [d] = await db.select().from(deals).where(eq(deals.id, id));
  expect(d.sourceId).toBeNull(); expect(d.sourceLabel).toBeNull();
});
```
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar.
  - `DealEventType` ganha `"assumiu"|"venda"|"arquivado"|"restaurado"|"comparecimento"|"tarefa"`.
  - `updateDeal`: ler os valores antigos e registrar `{campo,de,para}` só dos campos que mudaram.
  - `detectSource` só devolve um label quando há evidência (anúncio, "vim pelo instagram", indicação, site). O `recordInbound` grava `sourceLabel`. O `origin` legado continua sendo gravado como antes, por compatibilidade com telas antigas até a T13.
  - `recordOutbound`, quando `fromPhone`: `responder = deal.ownerId`.
- [ ] **Step 4:** PASS. Commit `feat(crm): auditoria de/para, assumir, fechar venda idempotente, origem separada do canal, serviço/pago/comparecimento`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Files incluem `src/server/domain/events.ts` (novos tipos de evento, inclusive `lido` usado na T10).
- Payloads: `resposta.payload` ganha `stage` e `slaSeconds` (SLA da etapa vigente); `lead_criado.payload` ganha `initialStage` e `historico` (já existe no histórico).

---

### Task 8: Tarefas (próxima ação, comparecimento, retorno por serviço)

**Files:**
- Create: `src/server/domain/tasks.ts`, `src/server/domain/tasks.test.ts`
- Modify: `src/server/domain/updates.ts` (ao agendar, cria a tarefa `comparecimento` para o dia seguinte; o `closeSale` com serviço de `cycleDays` cria a tarefa `retorno`)

**Interfaces (Produces):**
- `createTask({ dealId?, contactId, kind, title, dueAt, assigneeId? }, userId)`
- `completeTask(id, userId)`
- `listTasks({ assigneeId?, dueBefore: Date, open: true })`
- `nextActionOf(dealId): Promise<Task|null>`: a tarefa `proxima_acao` aberta mais próxima.

- [ ] **Step 1: testes que falham:**
```ts
import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { tasks, users, lists } from "../db/schema";
import { recordInbound } from "./deals"; import { updateDeal, closeSale } from "./updates";
import { createTask, completeTask, nextActionOf } from "./tasks"; import { resetDb } from "../../../test/db";
let uid = ""; let dealId = ""; let contactId = "";
beforeEach(async () => { await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "T1", phoneRaw: "71999993333", body: "oi" }); if (!("dealId" in r)) throw new Error(); dealId = r.dealId;
  contactId = (await db.query.deals.findFirst({ where: (d, { eq }) => eq(d.id, dealId) }))!.contactId; });
it("próxima ação com data e responsável", async () => {
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Mandar valores", dueAt: new Date("2026-10-14T12:00:00Z"), assigneeId: uid }, uid);
  expect(await nextActionOf(dealId)).toMatchObject({ title: "Mandar valores", assigneeId: uid });
});
it("agendar cria comparecimento no dia seguinte", async () => {
  await updateDeal(dealId, { scheduledAt: "2026-10-15T13:00:00.000Z" }, uid);
  const [t] = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  expect(t.dueAt.toISOString().slice(0, 10)).toBe("2026-10-16");
});
it("venda de serviço com ciclo cria retorno", async () => {
  const [col] = await db.select().from(lists).where(eq(lists.label, "Coloração"));
  await closeSale(dealId, { serviceId: col.id, valueCents: 30000, paymentMethod: "pix", paidNow: true }, uid);
  const [t] = await db.select().from(tasks).where(eq(tasks.kind, "retorno"));
  expect(Math.round((t.dueAt.getTime() - Date.now()) / 86_400_000)).toBe(35);
});
it("concluir tira da lista", async () => {
  const t = await createTask({ dealId, contactId, kind: "geral", title: "x", dueAt: new Date() }, uid);
  await completeTask(t.id, uid);
  expect(await nextActionOf(dealId)).toBeNull();
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar. Remarcar o agendamento substitui a tarefa `comparecimento` aberta. **Step 4:** PASS. **Step 5:** commit `feat(crm): tarefas — próxima ação, comparecimento no dia seguinte, retorno por ciclo do serviço`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Roda **depois da T7** (usa `closeSale` e edita `updates.ts`).
- Teste "concluir tira da lista": usar `kind: "proxima_acao"` (com `geral` passaria sem `completeTask`).
- Teste do retorno: comparar `t.dueAt` com `closedAt + 35 dias` (ler `deals.closedAt`), não com `Date.now()` arredondado.
- Incluir o job de worker `lembretes` (a cada 5 min): tarefas vencendo nos próximos 15 min sem aviso → alerta `tarefa_vencendo` (nível 1, `waitKey = 'task:'+id`) para o responsável.

---

### Task 9: Origens por link e QR

**Files:**
- Create: `src/server/domain/sources.ts`, `src/server/domain/sources.test.ts`, `src/app/(app)/config/origens/page.tsx`, `src/components/config/sources.tsx`
- Modify: `src/server/domain/deals.ts` (`recordInbound`, só quando cria o lead, chama `matchSource(body)`), `src/components/config/config-nav.tsx` (aba "Origens"), `src/app/(app)/config/actions.ts`

**Interfaces (Produces):**
- `createSource({ label, kind, prefill?, referrerContactId? }, userId) → { id, code }`, com o código gerado em 8 chars `[a-z0-9]`.
- `sourceLink(source, phoneE164): string` = `https://wa.me/<digits>?text=` + `encodeURIComponent(prefill + " #" + code)`.
- `matchSource(firstMessage: string|null): Promise<{ id: string; label: string } | null>`: procura `#code` e, como reserva, a frase exata do prefill (sem diferenciar maiúsculas, ignorando espaços).
- O QR é gerado com `qrcode.toString(link, { type: "svg" })` no servidor, com botão de download em PNG/SVG.

- [ ] **Step 1: testes que falham:**
```ts
import { it, expect, beforeEach } from "vitest";
import { db } from "../db"; import { deals, users } from "../db/schema";
import { createSource, sourceLink, matchSource } from "./sources"; import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";
let uid = ""; beforeEach(async () => { await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "T", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning(); });
it("link wa.me com frase + código e reconhecimento na 1ª mensagem", async () => {
  const s = await createSource({ label: "Bio do Instagram", kind: "instagram", prefill: "Oi! Vi vocês no Instagram" }, uid);
  expect(sourceLink(s, "+557199990404")).toBe(`https://wa.me/557199990404?text=${encodeURIComponent(`Oi! Vi vocês no Instagram #${s.code}`)}`);
  await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71999994444", body: `Oi! Vi vocês no Instagram #${s.code}` });
  expect((await db.select().from(deals))[0]).toMatchObject({ sourceId: s.id, sourceLabel: "Bio do Instagram" });
});
it("cliente apagou o código mas manteve a frase → reconhece pela frase", async () => {
  const s = await createSource({ label: "Panfleto", kind: "panfleto", prefill: "Peguei o panfleto da Casa" }, uid);
  expect(await matchSource("peguei o panfleto da casa")).toEqual({ id: s.id, label: "Panfleto" });
});
it("mensagem comum → null", async () => { expect(await matchSource("oi, qual o valor?")).toBeNull(); });
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar o domínio e a tela de Configurações › Origens, que tem: lista, "Nova origem" (nome, tipo, frase), link copiável, QR em SVG, botões "Baixar PNG/SVG" e ativar/desativar. A tela só aparece para a gestão (`assertUser("gestor")`). **Step 4:** PASS + verificação no navegador (criar origem e ver o QR). **Step 5:** commit `feat(origens): links e QR por canal com reconhecimento automático da origem`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- `createSource` devolve `{ id, code, label, prefill }` (o `sourceLink` precisa do `prefill`).

---

### Task 10: Enviar mídia, responder citando, visto azul ao abrir

**Files:**
- Modify: `src/server/whatsapp/provider.ts` (`sendMedia?`, `sendAudio?`, `markRead?`, `sendText(…, quotedExternalId?)`), `src/server/whatsapp/evolution.ts`, `src/server/domain/send.ts` (`sendMediaFromCrm`, `sendFromCrm(…, { quoteMessageId? })`), `src/app/(app)/funil/actions.ts` (actions novas), `src/components/lead/composer.tsx` (anexo, gravador de áudio e citação), `src/components/lead/conversation.tsx` (botão "Responder" em cada balão)
- Create: `src/server/domain/send-media.test.ts`

**Interfaces (Produces):**
- `sendMediaFromCrm(dealId, file: { name: string; mime: string; data: Buffer }, caption: string|null, userId)`: valida o tipo com `sniffMime` (T3); áudio OGG/WebM vira `sendWhatsAppAudio`; aceita até 16 MB.
- `markConversationRead(dealId, userId)`: chama `markRead` nas mensagens recebidas depois da última lida (rastreado pelo evento `lido`).
- Evolution:
  - `POST /message/sendMedia/{i}` com `{ number, mediatype, mimetype, caption, media: base64, fileName }`;
  - `POST /message/sendWhatsAppAudio/{i}` com `{ number, audio: base64 }`;
  - `POST /chat/markMessageAsRead/{i}` com `{ readMessages: [{ remoteJid, fromMe: false, id }] }`;
  - `sendText` com `quoted: { key: { id } }`.

- [ ] **Step 1: testes que falham** (fake provider):
```ts
import { it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db"; import { channels, messages, users } from "../db/schema";
import { recordInbound } from "./deals"; import { sendFromCrm, sendMediaFromCrm, markConversationRead } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution"; import { resetDb } from "../../../test/db";
let uid = ""; let dealId = ""; const calls: string[] = [];
const fake = { createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string, q?: string) => { calls.push(`text:${text}:${q ?? ""}`); return { externalId: "OUT1" }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string }) => { calls.push(`media:${f.mime}`); return { externalId: "OUT2" }; },
  markRead: async (_i: string, ids: string[]) => { calls.push(`read:${ids.join(",")}`); } };
beforeEach(async () => { calls.length = 0; await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
  const r = await recordInbound({ channelId: (await db.select().from(channels))[0].id, externalId: "IN1", phoneRaw: "71999995555", body: "oi" }); if (!("dealId" in r)) throw new Error(); dealId = r.dealId; setWhatsappProvider(fake); });
afterEach(() => setWhatsappProvider(null));
it("envia PDF e grava como documento", async () => {
  await sendMediaFromCrm(dealId, { name: "tabela.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.7 ...") }, "Nossa tabela", uid);
  expect(calls).toContain("media:application/pdf");
  expect((await db.select().from(messages)).find((m) => m.direction === "out")!.kind).toBe("document");
});
it("recusa html disfarçado", async () => {
  await expect(sendMediaFromCrm(dealId, { name: "x.jpg", mime: "image/jpeg", data: Buffer.from("<html>") }, null, uid)).rejects.toThrow(/tipo de arquivo/);
});
it("responde citando", async () => {
  const [inMsg] = await db.select().from(messages);
  await sendFromCrm(dealId, "Sim!", uid, { quoteMessageId: inMsg.id });
  expect(calls).toContain("text:Sim!:IN1");
});
it("marca como lido ao abrir", async () => { await markConversationRead(dealId, uid); expect(calls).toContain("read:IN1"); });
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar o domínio e a tela:
  - no composer, clipe (input file: `accept="image/*,application/pdf,audio/*"`), gravação de áudio com `MediaRecorder` (`audio/webm;codecs=opus` ou `audio/ogg`, só quando `isTypeSupported`) e uma faixa "Respondendo a: …" com ✕;
  - Server Action com limite de 16 MB (`next.config` já tem `bodySizeLimit 16mb`);
  - o `lead-sheet` chama `markConversationReadAction` ao abrir, uma vez por abertura.
- [ ] **Step 4:** PASS. Verificar no navegador com o simulador/fake: anexar uma imagem mostra a prévia e o envio aparece na conversa (sem número real). **Step 5:** commit `feat(whatsapp): enviar foto/PDF/áudio, responder citando, visto azul só ao abrir`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Upload: `next.config.ts` → `experimental.proxyClientMaxBodySize: "20mb"` e `serverActions.bodySizeLimit: "20mb"` (o proxy corta acima de 10 MB por padrão).
- `markRead?(instance, toE164, ids)` (a Evolution precisa do `remoteJid`); ajustar o fake do teste.
- Safari/iOS grava `audio/mp4`: aceitar `audio/mp4` como gravação e garantir que o `sniffMime` reconhece `ftypM4A`/`ftypmp42`/`ftypisom` de áudio.
- Files incluem `src/components/lead/lead-sheet.tsx`.

---

### Task 11: Avisos no aparelho: som, título, push PWA, painel de alertas no celular e banner de conexão

**Files:**
- Create:
  - `public/sw.js` (push e `notificationclick` abrindo `/atendimento?lead=ID`)
  - `src/server/push.ts`, `src/server/push.test.ts`
  - `src/app/(app)/push/actions.ts` (salvar e remover a inscrição)
  - `src/components/shell/push-optin.tsx`
  - `src/components/shell/connection-banner.tsx`
  - `src/components/shell/late-watch.tsx` (som e título quando um lead **cruza** o prazo)
- Modify:
  - `src/components/shell/alerts-bell.tsx` (portal fora do header com `backdrop-blur`; Esc; tocar no alerta abre o lead)
  - `src/components/shell/sidebar.tsx`
  - `src/app/(app)/layout.tsx`
  - `worker/index.ts` (job `push`: alertas com `pushed_at is null` → envia para o `user_id` ou, no nível 2, para todos os gestores)
  - `src/server/env.ts` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
  - `scripts/vapid.ts` (gerar as chaves)
  - `package.json` (`web-push`)

**Interfaces (Produces):**
- `sendPushForPendingAlerts(sender = webPushSender): Promise<{ sent: number; failed: number }>`: marca `pushedAt`, apaga a inscrição em 404/410 e é injetável para teste.
- `<LateWatch />`: usa `useCrossedThreshold` (T21 cria a versão final; aqui usar uma versão simples local, que a T21 substitui) para tocar `playAlert()` e trocar `document.title` para `(N) atrasados · Casa Fiaes`.

- [ ] **Step 1: teste que falha** (`push.test.ts`, com sender injetado):
```ts
import { it, expect, beforeEach } from "vitest";
import { db } from "./db"; import { alerts, pushSubscriptions, users } from "./db/schema";
import { sendPushForPendingAlerts } from "./push"; import { resetDb } from "../../test/db";
beforeEach(async () => { await resetDb(); });
it("envia push para o responsável e marca pushed_at; inscrição expirada é removida", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(pushSubscriptions).values([{ userId: ana.id, endpoint: "https://p/ok", p256dh: "k", auth: "a" }, { userId: ana.id, endpoint: "https://p/gone", p256dh: "k", auth: "a" }]);
  await db.insert(alerts).values({ userId: ana.id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "Maria esperando há 3 min", dedupeKey: "k1" });
  const sent: string[] = [];
  const r = await sendPushForPendingAlerts(async (sub) => { if (sub.endpoint.endsWith("gone")) return 410; sent.push(sub.endpoint); return 201; });
  expect(r).toEqual({ sent: 1, failed: 1 });
  expect(sent).toEqual(["https://p/ok"]);
  expect((await db.select().from(alerts))[0].pushedAt).not.toBeNull();
  expect((await db.select().from(pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://p/ok"]);
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar:
  - instalar `web-push` (`npm i web-push` e `npm i -D @types/web-push`);
  - `push-optin` aparece **uma vez** no Hoje: "Receber aviso no celular quando um lead atrasar" → `Notification.requestPermission()` + `pushManager.subscribe({ applicationServerKey })`;
  - `sw.js` mostra a notificação `{ title: "Lead esperando", body, data: { url } }` e o clique abre ou foca a aba.
- [ ] **Step 4: [e2e]** no celular (iPhone 13), abrir o sino → o painel ocupa a parte de baixo, legível, e um toque no alerta abre o lead. O banner aparece quando o canal está `erro` (forçar no banco do e2e). O título da aba muda quando o `ageLead` estoura o prazo.
- [ ] **Step 5:** commit `feat(alertas): push no celular (PWA), som e título ao atrasar, painel de alertas no celular, banner de conexão`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Dividir:** T11a = `web-push` + `push.ts` + `sw.js` + opt-in + job do worker; T11b = sino em portal + banner de conexão **e banner global do modo quieto** + `LateWatch` + `aria-live=polite` anunciando "lead atrasado".
- `VAPID_*` opcionais no `env.ts` (sem chave = push desligado, sem erro). Registrar no ledger: push no iPhone só funciona com o PWA instalado na tela inicial (iOS 16.4+).
- `LateWatch` usa uma versão local simples de "cruzou o limite" (`useRef` do valor anterior); a T21 troca pela primitiva final.

---

### Task 12: Envios automáticos com segurança (resposta fora do horário, teto, enquete D-1)

**Files:**
- Create: `src/server/domain/outbox.ts` (fila com teto), `src/server/domain/auto-reply.ts`, `src/server/domain/outbox.test.ts`
- Modify:
  - `src/server/domain/send.ts` (`sendAutomated` passa pelo outbox)
  - `src/server/domain/deals.ts` (`recordInbound` chama `maybeAutoReply` depois do commit)
  - `src/server/rules/types.ts` (ação `enviar_enquete_confirmacao`)
  - `src/server/rules/engine.ts`
  - `src/server/whatsapp/webhook.ts` (voto de enquete em `messages.update` → `setAttendance`/tarefa)
  - `src/server/db/seed-data.ts` (automação `confirmacao_d1`, `enabled:false`)

**Interfaces (Produces):**
- `enqueueAutomated({ dealId, kind: "text"|"poll", text, options? })`: grava em `settings.outbox` (fila em tabela) ou numa tabela própria `outbox` (decidir: **tabela `outbox`**, criada aqui numa migração aditiva própria, porque precisa de índice; é a única exceção à T1, documentada no ledger).
- `drainOutbox(now)`: o worker roda a cada minuto e respeita `envio_teto_hora`.
- `maybeAutoReply(dealId, at)`:
  - só se `settings.auto_resposta.enabled` e a Casa estiver fechada (`!isOpen`);
  - é a primeira mensagem da cliente nesta espera;
  - o contato recebeu a última resposta automática há mais de 12 h.

- [ ] **Step 1: testes que falham** (`src/server/domain/outbox.test.ts`):
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { channels, settings, outbox, deals, tasks, messages } from "../db/schema";
import { enqueueAutomated, drainOutbox } from "./outbox"; import { recordInbound } from "./deals";
import { ingestEvolution } from "../whatsapp/webhook"; import { setWhatsappProvider } from "../whatsapp/evolution";
import { resetDb } from "../../../test/db";
const sent: string[] = [];
const fake = { createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: "OUT" + sent.length }; },
  sendPoll: async (_i: string, _to: string, name: string) => { sent.push("poll:" + name); return { externalId: "POLL1" }; } };
let chId = "";
const lead = async (phone: string, at: Date) => { const r = await recordInbound({ channelId: chId, externalId: phone + at.getTime(), phoneRaw: phone, body: "oi", at }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
beforeEach(async () => { sent.length = 0; await resetDb(); setWhatsappProvider(fake);
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning(); });
afterEach(() => setWhatsappProvider(null));
describe("fila de envios automáticos", () => {
  it("teto por hora: com teto 2, 3 envios → 2 agora e 1 na hora seguinte", async () => {
    await db.insert(settings).values({ key: "envio_teto_hora", value: 2 });
    const t0 = new Date("2026-10-13T13:00:00Z");
    for (const p of ["71999990101", "71999990102", "71999990103"]) await enqueueAutomated({ dealId: await lead(p, t0), kind: "text", text: "lembrete " + p });
    await drainOutbox(t0);
    expect(sent).toHaveLength(2);
    await drainOutbox(new Date(t0.getTime() + 61 * 60_000));
    expect(sent).toHaveLength(3);
  });
});
describe("resposta fora do horário", () => {
  const night = new Date("2026-10-14T02:00:00Z"); // ter 23h em Salvador
  it("desligada por padrão: não enfileira nada", async () => {
    await lead("71999990201", night);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
  it("ligada: 1 vez a cada 12 h por contato e nunca no expediente", async () => {
    await db.insert(settings).values({ key: "auto_resposta", value: { enabled: true, text: "Oi! A Casa abre às 8h." } });
    await lead("71999990202", night);
    await recordInbound({ channelId: chId, externalId: "x2", phoneRaw: "71999990202", body: "?", at: new Date(night.getTime() + 30 * 60_000) });
    expect(await db.select().from(outbox)).toHaveLength(1);
    await lead("71999990203", new Date("2026-10-14T13:00:00Z")); // qua 10h, aberto
    expect(await db.select().from(outbox)).toHaveLength(1);
  });
});
describe("confirmação por enquete", () => {
  it("voto 'Confirmo' marca confirmado; 'Preciso remarcar' cria tarefa", async () => {
    const d1 = await lead("71999990301", new Date("2026-10-13T13:00:00Z"));
    const [d] = await db.select().from(deals).where(eq(deals.id, d1));
    await db.insert(messages).values({ dealId: d1, contactId: d.contactId, channelId: chId, externalId: "POLL1", direction: "out", kind: "poll", body: "Confirma seu horário?", status: "sent" });
    await ingestEvolution({ event: "messages.update", instance: "rec", data: { keyId: "POLL1", pollUpdates: [{ vote: { selectedOptions: ["Confirmo"] } }] } as never });
    expect((await db.select().from(deals).where(eq(deals.id, d1)))[0].attendance).toBe("confirmado");
    await ingestEvolution({ event: "messages.update", instance: "rec", date_time: "2", data: { keyId: "POLL1", pollUpdates: [{ vote: { selectedOptions: ["Preciso remarcar"] } }] } as never });
    expect((await db.select().from(tasks).where(eq(tasks.dealId, d1))).some((t) => t.kind === "proxima_acao" && /remarcar/i.test(t.title))).toBe(true);
  });
});
```
  Notas:
  - `deals.attendance` também aceita `"confirmado"` (vem da enquete), então os valores possíveis ficam `confirmado|compareceu|faltou|remarcou`. Registrar no ledger.
  - **Antes de implementar**, conferir o formato real do voto na Evolution 2.3.7 (procurar `pollUpdates` em `dist/main.js` dentro do container: `docker compose cp evolution:/evolution/dist/main.js /tmp/x.js`) e ajustar o payload do teste a esse formato.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (migração `outbox`; `sendPoll` no provider: `POST /message/sendPoll/{i}` com `{ number, name, selectableCount: 1, values }`). **Step 4:** PASS. Garantir no `seed.test.ts` que **todas** as automações com `enviar_*` vêm `enabled:false`. **Step 5:** commit `feat(automação): fila com teto por hora, resposta fora do horário e confirmação por enquete (desligadas por padrão)`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Não** criar migração: a tabela `outbox` vem da T1.
- Dedupe do webhook: em `ingestEvolution`, a chave de `messages.update` com `pollUpdates` inclui um hash curto de `JSON.stringify(pollUpdates)` (senão a troca de voto é descartada como duplicada). Teste da enquete cobre isso.

---

### Task 13: Relatórios honestos (R1–R16)

**Files:**
- Modify: `src/server/reports/index.ts` (reescrever; a assinatura `ReportFilter` ganha `source?` e `compare: boolean`), `src/server/reports/reports.test.ts`, `src/app/(app)/relatorios/page.tsx`, `src/components/reports/*`, `src/app/api/relatorios/[tipo]/route.ts`
- Create: `src/server/reports/summary-text.ts` (R1), `src/components/reports/{bullet,bands,heatmap,funnel-milestones}.tsx`

**Interfaces (Produces):**
- `firstResponse(f) → { n, p50, p90, bands: { ate2, de2a10, de10a60, mais1h }, slaHitPct, previous? }`
- `funnelMilestones(f) → { leads, respondidos, agendados, fechados, perdidos, emAberto, conv: { respondido, agendado, fechado } }`
- `staleNow() → { stage, total, parados, maisAntigoSeg }[]`
- `sourceToSale(f) → { origem, leads, agendados, fechados, receitaCents }[]` ("Não identificada" sempre presente)
- `lossesByReasonAndStage(f)`
- `financeWithPaid(f)`
- `dataQuality()`
- `crmVsPhone(f)`
- `followupEfficacy(f)`
- `demandHeatmap(f) → number[7][24]`
- `personVsGoal(f)` (só n ≥ 20, ordem alfabética)
- `dailySummaryText(user, now) → { text, links: { label, href }[] }`

Todos excluem arquivados, ignorados e leads de histórico (`lead_criado.payload.historico`) das contagens de "novos". A comparação é com o período anterior de mesmo tamanho; "hoje" compara com **ontem até a mesma hora**.

- [ ] **Step 1: testes que falham** (acrescentar em `src/server/reports/reports.test.ts`; `ReportFilter` ganha `now?: Date`, com padrão `new Date()`, para o teste ser determinístico):
```ts
import { firstResponse, funnelMilestones, sourceToSale, dailySummaryText } from "./index";
import { recordInbound, recordOutbound, moveDeal } from "../domain/deals"; import { archiveDeals } from "../domain/archive";
import { users } from "../db/schema";
const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // ter 13/10, hora local h:m
it("primeira resposta ignora as seguintes (35 min vs 3 min)", async () => {
  const r = await recordInbound({ channelId: null, externalId: "F1", phoneRaw: "71999994001", body: "oi", at: T(10) }); if (!("dealId" in r)) throw new Error();
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "a", at: T(10, 35) });
  await recordInbound({ channelId: null, externalId: "F2", phoneRaw: "71999994001", body: "e o valor?", at: T(11) });
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "b", at: T(11, 3) });
  const fr = await firstResponse({ period: "hoje", now: T(18) });
  expect(fr.n).toBe(1); expect(fr.p50).toBe(2100); expect(fr.bands.de10a60).toBe(1);
});
it("conversão nunca passa de 100%: fechado de lead antigo não entra na coorte", async () => {
  const old = await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71999994002", body: "oi", at: new Date("2026-09-01T13:00:00Z") }); if (!("dealId" in old)) throw new Error();
  await moveDeal(old.dealId, "fechado", null);
  expect((await funnelMilestones({ period: "hoje", now: T(18) })).fechados).toBe(0);
});
it("WhatsApp vira 'Não identificada' e arquivado não conta", async () => {
  const a = await recordInbound({ channelId: null, externalId: "W1", phoneRaw: "71999994003", body: "oi", at: T(10) });
  const b = await recordInbound({ channelId: null, externalId: "W2", phoneRaw: "71999994004", body: "oi", at: T(10) });
  if (!("dealId" in a) || !("dealId" in b)) throw new Error();
  const [u] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  await archiveDeals([b.dealId], u.id);
  const rows = await sourceToSale({ period: "hoje", now: T(18) });
  expect(rows.find((x) => x.origem === "Não identificada")!.leads).toBe(1);
  expect(rows.some((x) => x.origem === "WhatsApp")).toBe(false);
});
it("resumo do dia tem os números e o link para os atrasados", async () => {
  await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999994005", body: "oi", at: T(10) });
  const [g] = await db.insert(users).values({ name: "G2", email: "g2@c.com", role: "gestor", passwordHash: "x" }).returning();
  const s = await dailySummaryText({ id: g.id, role: "gestor", name: "G2", email: "g2@c.com" }, T(19));
  expect(s.text).toMatch(/1 lead novo/); expect(s.text).toMatch(/esper/);
  expect(s.links.some((l) => l.href.includes("/atendimento?filtro=atrasados"))).toBe(true);
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar as consultas e a tela:
  - abas "Visão geral" (R1, R2, R4, R5, R6, R8, R9, R16) e "Análise" (R10, R11, R7, R13);
  - `n` visível e `%` oculto quando n < 20 ("3 de 9");
  - todo número é `<Link>` para `/atendimento?…` ou `/funil?…` com o filtro;
  - bullet graph em SVG próprio, barras com `scaleX`, heatmap em tom único com o número escrito na célula;
  - sem pizza; CSV de cada bloco mantido.
- [ ] **Step 4:** PASS + **[e2e]** exportar o CSV continua funcionando; clicar em "Atrasados" abre a lista filtrada. **Step 5:** commit `feat(relatórios): primeira resposta em faixas, funil por marcos, origem→venda, parados, qualidade, comparação e drill-down`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Dividir:** T13a = consultas + testes (`src/server/reports/*`); T13b = tela, abas, drill-down e CSV.
- Os testes novos ficam num `describe` próprio com `beforeEach(async () => { await resetDb(); })`; **não** reimportar `users` (já importado no arquivo).
- Teste "conversão nunca passa de 100%": fechar o lead antigo com data antiga — `await db.transaction((tx) => moveDealTx(tx, old.dealId, "fechado", null, "manual", new Date("2026-09-02T13:00:00Z")))` — e afirmar que a coorte de hoje tem `fechados = 0` **e** que a coorte de setembro tem 1.
- R2: os 5 números são `leadsNovos`, `pctPrimeiraRespostaNoSla`, `agendamentosMarcados`, `vendas` (n e R$) e `ticketMedio`, cada um com `atual`/`anterior`; função `executiveNumbers(f)` com teste.

---

### Task 14: Tempo real seletivo (SSE por escopo)

**Files:**
- Modify: `src/server/domain/events.ts` (`emit(type, { dealId, scope })`, com escopos `queue`, `deal:<id>`, `alerts`, `channels`, `reports`), `src/components/shell/live.tsx` (`useLive(scopes, handler)`), `src/app/api/stream/route.ts`
- Test: `src/components/shell/live.test.ts` (função pura `shouldRefresh(event, subscribedScopes)`)

**Interfaces (Produces):**
- `useLive(scopes: string[], onEvent: (e) => void)`
- `shouldRefresh(e: { type: string; scope?: string; dealId?: string }, scopes: string[]): boolean`

As telas chamam `router.refresh()` só quando `shouldRefresh` for verdadeiro. Relatórios não assinam `queue` (atualizam a cada 60 s ou ao focar).

- [ ] **Step 1:** teste unitário de `shouldRefresh` (mensagem de outro lead não atualiza o card aberto; atualiza a Fila). **Step 2:** FAIL. **Step 3:** implementar e passar todos os `emit` existentes para incluir `scope`. **Step 4:** PASS + medição: com o Relatórios aberto, um webhook simulado **não** gera `GET /relatorios` no log. **Step 5:** commit `perf(tempo-real): SSE por escopo — cada tela atualiza só o que mostra`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Não** mexer nas chamadas de `emit` espalhadas (colidiria com a T12): `events.ts` deriva o escopo de um mapa `SCOPE_OF: Record<string, string[]>` pelo `type` (ex.: `mensagem_recebida → ["queue", "deal:<id>"]`). Files: só `events.ts`, `live.tsx`, `stream/route.ts` e o teste.

---

### Task 15: Fila — lista, rotas e estado preservado [e2e]

**Files:**
- Create:
  - `src/app/(app)/atendimento/page.tsx`, `src/app/(app)/atendimento/[id]/page.tsx`, `src/app/(app)/atendimento/[id]/cliente/page.tsx`
  - `src/server/queries/queue.ts` (+ test)
  - `src/components/queue/{queue-list,queue-item,queue-summary,queue-filters,use-queue-state}.tsx`
- Modify: `src/components/shell/sidebar.tsx` (navegação: Hoje, Atendimento, Contatos, Relatórios, Mais/Config; o Quadro fica dentro de Atendimento), `src/proxy.ts` (nada), `src/app/(app)/page.tsx` ("Atender próximo" → `/atendimento?lead=`)

**Interfaces (Produces):**
- `getQueue(user, { view?: "meus"|"sem-dono"|"parados"|"agendados-hoje"|"todos", q?, filtro?: "atrasados" }) → { sections: { key: "atrasados"|"perto"|"aguardando"|"acoes-hoje"|"parados"|"aguardando-cliente"; items: QueueItem[] }[]; counts }`
- `QueueItem = { dealId, contactId, name, phone, hasAvatar, awaitingSince, slaMinutes, lastMessage, lastKind, lastDirection, stageKey, stageName, sourceLabel, ownerName, nextAction?: { title, dueAt }, signals: string[] }`
- `useQueueState()`: guarda e restaura `scrollTop`, filtros e o último lead aberto em `sessionStorage` (`cf-queue`), com espelho na URL.

- [ ] **Step 1: testes que falham:**
  - unit `queue.test.ts`: ordem (atrasado antes de perto, que vem antes de aguardando), arquivado fora, lead sem próxima ação há mais que `stale_days` em "parados", "aguardando cliente" separado;
  - e2e `e2e/fila.spec.ts`:
```ts
test("fila: abrir conversa e voltar preserva filtro e rolagem (celular)", async ({ page }) => {
  await login(page); for (let i = 0; i < 12; i++) await simulate(page, { phone: `7198800${String(i).padStart(4, "0")}`, name: `Cliente ${i}`, text: "oi" });
  await page.goto("/atendimento?view=todos");
  await page.getByRole("listbox", { name: "Fila" }).evaluate((el) => (el.scrollTop = 400));
  await page.getByRole("option").nth(8).click();
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}/);
  await page.getByRole("link", { name: "Voltar para a fila" }).click();
  await expect(page).toHaveURL(/view=todos/);
  expect(await page.getByRole("listbox", { name: "Fila" }).evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
});
```
  (o projeto "celular" do Playwright roda este spec; no desktop, `?lead=` abre no painel do meio).
- [ ] **Step 2:** FAIL. **Step 3:** implementar.
  - No desktop (≥ 1024 px): 3 colunas, com a fila de 340 px, a conversa flexível e o cliente com 300 px (painel vazio: "Escolha uma conversa").
  - No celular: só a lista, e o item é um link para `/atendimento/[id]`.
  - Resumo no topo: "12 aguardando · 3 atrasados · 5 agendados hoje" (cada número filtra).
  - Item com `ContactAvatar` + anel SVG de SLA (`businessSecondsBetween`, cores ok/warn/late com texto), nome, tempo (`tabular-nums`), última mensagem (1 linha), etapa, origem, dono e as etiquetas.
  - `role=listbox`/`option`, setas para navegar, Enter abre.
- [ ] **Step 4:** PASS (unit + e2e desktop e celular). **Step 5:** commit `feat(fila): /atendimento com seções por urgência, 3 painéis no desktop e sequência no celular, estado preservado`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- `playwright.config.ts`: o projeto `celular` passa a `testMatch: /(mobile|fila|a11y)\.spec\.ts/` e o `desktop` ignora `mobile`; `fila.spec` tem um teste por projeto (`test.skip(isMobile)`/`!isMobile` conforme o caso).
- `QueueItem.awaitingSince: string | null` (ISO).
- `QueueList` recebe só `sections` (e callbacks opcionais) e **não** usa `next/navigation`; hooks de rota ficam num wrapper `QueueListRoute` (para o teste em jsdom da T21).
- `view` inclui as 6 views da spec C7: `meus`, `sem-dono`, `parados`, `agendados-hoje`, `clientes-ativos`, `sem-contato-90d` (+ `todos`).
- `vitest.config.ts`: `include` passa a `["src/**/*.test.{ts,tsx}", ...]` (os testes .tsx da T21 precisam).

---

### Task 16: Conversa dentro da Fila [e2e]

**Files:**
- Create: `src/components/queue/conversation-pane.tsx`
- Modify: `src/components/lead/{conversation,composer}.tsx` (reuso; a conversa abre no fim **sem** smooth; `memo`), `src/app/(app)/atendimento/[id]/page.tsx`

**Interfaces:** `ConversationPane({ dealId, initial: QueueItem })`. Renderiza na hora com os dados do item (nome, foto, última mensagem) e busca o restante (`getDealDetail`) por Server Action. Depois de enviar, oferece "Próximo da fila" (vai para o próximo item atrasado ou aguardando).

- [ ] **Step 1:** e2e: responder pela Fila move o lead para Atendimento e oferece "Próximo"; no celular, o composer fica visível sem rolar (o teclado não cobre o botão Enviar: `position: sticky` + `env(safe-area-inset-bottom)`). **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** commit `feat(fila): conversa no painel central com abertura instantânea e "próximo da fila"`.

---

### Task 17: Painel do cliente e ações [e2e]

**Files:**
- Create: `src/components/queue/client-pane.tsx`, `src/components/queue/stage-path.tsx`, `src/components/queue/close-sale-sheet.tsx`, `src/components/queue/next-action.tsx`, `src/components/queue/why-late.tsx`, `src/components/queue/bulk-bar.tsx`
- Modify: `src/app/(app)/funil/actions.ts` (`claimAction`, `closeSaleAction`, `archiveAction`, `restoreAction`, `setAttendanceAction`, `createTaskAction`, `completeTaskAction`)

**Interfaces:**
- `whyLate(item, hours, now): string`, que é pura e testada. Exemplos: "Cliente escreveu às 14:02 e ninguém respondeu (8 min no expediente; prazo 2 min)" ou "Sem resposta da Casa desde sexta 19:40 — Casa fechada até seg 8:00".
- O toast de "Não é cliente" tem "Desfazer", que chama `restoreAction`.

- [ ] **Step 1:** unit `why-late.test.ts` (3 casos: no expediente, cruzando o fechamento, aguardando a cliente) + e2e:
  - "Fechar venda" em 4 cliques ou toques (chips de pagamento, valor "1158.50" → R$ 1.158,50);
  - "Não é cliente" com Desfazer volta o lead;
  - "Assumir" troca o dono exibido;
  - triagem em massa: selecionar 3 e arquivar.
- [ ] **Step 2:** FAIL. **Step 3:** implementar.
  - Path com as etapas atuais (Follow-up agrupado), tocável para mudar de etapa.
  - Agendar abre um `Sheet` com data e hora (validada: futuro e expediente), com aviso se for fora do horário.
  - Perdido pede o motivo.
  - Próxima ação: texto, data e responsável.
  - Seção "Histórico" com os eventos e a auditoria de/para.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(fila): painel do cliente — etapas, assumir, fechar venda em 4 toques, próxima ação, por que atrasou, triagem em massa`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- **Dividir:** T17a = ações (assumir, fechar venda em `Sheet` com chips, agendar com validação, perdido com motivo, etapas/Path); T17b = próxima ação, "Como conheceu?" (quando origem não identificada), botões Compareceu/Faltou na Fila, triagem em massa e histórico com auditoria de/para.

---

### Task 18: Ficha do contato, busca e views prontas [e2e]

**Files:**
- Create: `src/app/(app)/contatos/[id]/page.tsx`, `src/server/queries/contact.ts` (+ test), `src/components/contacts/{contact-timeline,start-conversation}.tsx`
- Modify: `src/server/queries/contacts.ts` (busca trigram: nome, telefone e trecho de mensagem), `src/app/(app)/contatos/page.tsx` (cartões no celular, sem rolagem lateral), `src/server/queries/queue.ts` (views)

**Interfaces:**
- `getContact(id) → { contact, deals[], messages(last 200), tasks[], events[] }`
- `startConversationAction(contactId)`: cria ou reabre o lead (respeitando o conflito de lead aberto), **não envia mensagem** e redireciona para `/atendimento/[dealId]` com o composer focado.

- [ ] **Step 1:** unit (a busca por um trecho de mensagem acha o contato; `startConversation` não duplica lead aberto) + e2e (Contatos → buscar → abrir a ficha → "Iniciar conversa" abre a Fila no lead). **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** commit `feat(contatos): ficha com histórico completo, busca por mensagem e "iniciar conversa"`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Triagem em massa também em Contatos (seleção + "Não é cliente" + Desfazer).

---

### Task 19: Quadro (kanban) e Jornada

**Files:**
- Modify: `src/components/pipeline/board.tsx` (ordenar por urgência; `KeyboardSensor` do dnd-kit; arrastar respeitando RM via `useReducedMotion` → `dropAnimation: null`), `src/app/(app)/funil/page.tsx` (título "Quadro"; tabs Fila/Quadro/Jornada)
- Create: `src/app/(app)/jornada/page.tsx`, `src/components/journey/{journey,station}.tsx`, `src/server/queries/journey.ts`

**Interfaces:** `getJourney() → { stations: { key, name, count, late, people: { dealId, name, contactId, hasAvatar, awaitingSince }[] (máx 12 + "+N") }[] }`. Clicar numa estação abre `/atendimento?etapa=<key>`.

- [ ] **Step 1:** unit `journey.test.ts` (contagens batem com o board, sem arquivados) + teste e2e de teclado (mover um card com Espaço e setas). **Step 2:** FAIL. **Step 3:** implementar a Jornada em 2D (CSS grid e anel SVG), baseada no protótipo B, **sem 3D**; na gestão, o link aparece no menu. **Step 4:** PASS. **Step 5:** commit `feat(funil): Quadro ordenado por urgência e com teclado; Jornada para a gestão`.

---

### Task 20: Hoje + resumo das 19h + comparecimento

**Files:**
- Modify: `src/app/(app)/page.tsx`, `src/server/queries/today.ts` (tarefas do dia, comparecimentos pendentes e parados; contador de atrasos = esperas acima do SLA)
- Create: `src/components/today/{daily-summary,attendance-list}.tsx`

**Interfaces:** consome `dailySummaryText` (T13), `listTasks` (T8) e `setAttendanceAction` (T17).

- [ ] **Step 1:** unit: o contador de atrasos do Hoje conta esperas, não alertas (cenário com 2 alertas da mesma espera → 1); e2e: na gestão aparece o resumo e "Compareceu" marca e some da lista. **Step 2:** FAIL. **Step 3:** implementar.
  - A gestão vê o resumo no topo (a partir das 19h em destaque; antes, recolhido como "Resumo até agora").
  - A atendente vê "Minhas próximas ações" e "Comparecimentos de ontem".
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(hoje): resumo do dia, próximas ações e comparecimento`.

---

### Task 21: Motion e desempenho

**Files:**
- Modify: `src/lib/motion.ts` (tokens: `T = { instant: .1, fast: .15, base: .2, enter: .25, slow: .3 }`, saída = 0.75 × entrada, `SPRING_UI = { stiffness: 500, damping: 40 }`), `src/components/pipeline/{deal-card,board,timer}.tsx`, `src/components/lead/*`, `src/components/queue/*`, `src/components/reports/bars.tsx`
- Create: `src/components/motion/{use-crossed-threshold,change-flash,bar}.tsx`, `src/components/motion/use-crossed-threshold.test.ts`

**Interfaces:**
- `useCrossedThreshold(value: number, threshold: number): boolean`: verdadeiro só no render em que passa do limite.
- `<ChangeFlash value>`: fundo dourado suave por 600 ms quando o valor muda; sem efeito em RM.
- `<Bar value max>`: animado com `scaleX`.

- [ ] **Step 1: testes que falham.** Instalar em dev `@testing-library/react` e `jsdom`, se ainda não houver.
  `src/components/motion/use-crossed-threshold.test.ts`:
```ts
// @vitest-environment jsdom
import { it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCrossedThreshold } from "./use-crossed-threshold";
it("verdadeiro só no render que cruza o limite", () => {
  const { result, rerender } = renderHook(({ v }) => useCrossedThreshold(v, 120), { initialProps: { v: 100 } });
  expect(result.current).toBe(false);
  rerender({ v: 121 }); expect(result.current).toBe(true);
  rerender({ v: 122 }); expect(result.current).toBe(false);
  rerender({ v: 10 }); rerender({ v: 130 }); expect(result.current).toBe(true);
});
```
  `src/components/queue/queue-item.render.test.tsx`:
```tsx
// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { QueueList, __itemRenderCount } from "./queue-list";
it("o relógio não re-renderiza os itens da fila (só as folhas do tempo)", () => {
  vi.useFakeTimers();
  const items = Array.from({ length: 100 }, (_, i) => ({ dealId: String(i), contactId: String(i), name: `C${i}`, phone: "+55", hasAvatar: false,
    awaitingSince: new Date(Date.now() - 60_000).toISOString(), slaMinutes: 2, lastMessage: "oi", lastKind: "text", lastDirection: "in" as const,
    stageKey: "lead", stageName: "Lead", sourceLabel: null, ownerName: null, signals: [] }));
  render(<QueueList sections={[{ key: "aguardando", items }]} />);
  const before = __itemRenderCount.value;
  act(() => { vi.advanceTimersByTime(3000); });
  expect(__itemRenderCount.value - before).toBe(0);
  vi.useRealTimers();
});
```
  `queue-list.tsx` exporta `__itemRenderCount = { value: 0 }`, incrementado no corpo do `QueueItem` (`memo`) só quando `process.env.NODE_ENV === "test"`. O relógio é um componente folha (`<Elapsed since sla />`) com estado próprio.
- [ ] **Step 2:** FAIL. **Step 3:** implementar:
  - relógio em componente folha;
  - `layoutDependency` nos itens e balões;
  - `memo`;
  - remover os pulsos infinitos (`animate-[pulse…]` e `animate-ping`) em favor do `useCrossedThreshold`;
  - Fila: saída por opacidade e altura FLIP;
  - Sheet que troca de lead sem fechar.
- [ ] **Step 4:** PASS + roteiro do doc 03 §4.4 no Chrome Performance (CPU 4×, 100 cards) **com o build de produção**: nenhuma tarefa longa (> 50 ms) por segundo em 10 s; resultado no ledger. **Step 5:** commit `perf(motion): relógio sem medir layout, pulso único ao atrasar, tokens e primitivas`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Instalar em dev `jsdom`, `@testing-library/react` **e** `@testing-library/dom`.

---

### Task 22: Configurações: modelos de automação, resposta fora do horário, teto, modo quieto, retenção

**Files:**
- Modify: `src/components/config/automations.tsx` ("Começar de um modelo" com 8 modelos de `src/server/rules/templates.ts`), `src/app/(app)/config/whatsapp/page.tsx` (modo quieto: estado e "Encerrar agora"; teto por hora), `src/app/(app)/config/etapas/page.tsx` ou uma nova aba "Mensagens automáticas" (resposta fora do horário: texto e liga/desliga com aviso "envia mensagem real")
- Create: `src/server/rules/templates.ts` (+ test: todo modelo é válido no `automationSchema` e os que enviam vêm desligados)

- [ ] **Step 1:** teste dos modelos. **Step 2:** FAIL. **Step 3:** implementar. Ligar qualquer envio automático mostra um `Dialog` explícito: "Isto vai enviar mensagens reais para clientes." **Step 4:** PASS + verificação no navegador. **Step 5:** commit `feat(config): modelos de automação, resposta fora do horário, teto de envios, modo quieto e retenção`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Config › Listas: editar `cycle_days` dos serviços ("Lembrar retorno em N dias").

---

### Task 23: Etiquetas de sinal + importação com pré-visualização + retenção de mídia

**Files:**
- Create: `src/server/domain/signals.ts` (+ test), `src/components/contacts/import-preview.tsx`, `src/server/whatsapp/retention.ts` (+ test)
- Modify: `src/server/domain/import.ts` (`previewImport(csv) → { rows, duplicates, invalid }`), `worker/index.ts` (job diário de retenção às 04h)

**Interfaces:**
- `signalsOf(messages: { direction; body; createdAt }[]): ("pediu_preco"|"pediu_horario"|"sumiu_apos_preco"|"respondeu_rapido")[]`
- `purgeExpiredMedia(now, months = 12) → { purged }`: apaga o arquivo, marca `mediaPurgedAt` e a tela mostra "Mídia expirada (mais de 12 meses)".

- [ ] **Step 1: testes que falham.**
  `src/server/domain/signals.test.ts`:
```ts
import { it, expect } from "vitest";
import { signalsOf } from "./signals";
const m = (direction: "in" | "out", body: string, min: number) => ({ direction, body, createdAt: new Date(Date.UTC(2026, 9, 13, 13, min)) });
it("pediu preço e horário, com acento e variações", () => {
  expect(signalsOf([m("in", "Quanto custa a hidratação?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "qual o VALOR?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "tem horário sábado?", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "tem vaga amanha de manhã", 0)])).toContain("pediu_horario");
});
it("sumiu depois do preço: Casa mandou valor e cliente não respondeu há > 24 h", () => {
  const msgs = [m("in", "quanto é?", 0), m("out", "A avaliação é R$ 150", 2)];
  expect(signalsOf(msgs, new Date(Date.UTC(2026, 9, 14, 14, 0)))).toContain("sumiu_apos_preco");
});
it("respondeu rápido: cliente respondeu em < 2 min à Casa", () => {
  expect(signalsOf([m("out", "Oi!", 0), m("in", "oi", 1)])).toContain("respondeu_rapido");
});
```
  `src/server/whatsapp/retention.test.ts`:
```ts
import { it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { db } from "../db"; import { messages, contacts } from "../db/schema";
import { purgeExpiredMedia } from "./retention"; import { resetDb } from "../../../test/db";
const DIR = mkdtempSync(path.join(tmpdir(), "cf-ret-")); process.env.MEDIA_DIR = DIR;
beforeEach(async () => { await resetDb(); });
it("apaga arquivo com mais de 12 meses e mantém o registro", async () => {
  const [c] = await db.insert(contacts).values({ phoneE164: "+5571999990009" }).returning();
  writeFileSync(path.join(DIR, "old.jpg"), "x"); writeFileSync(path.join(DIR, "new.jpg"), "y");
  await db.insert(messages).values([
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "old.jpg", createdAt: new Date("2025-09-01T12:00:00Z") },
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "new.jpg", createdAt: new Date("2026-09-01T12:00:00Z") }]);
  expect(await purgeExpiredMedia(new Date("2026-10-09T12:00:00Z"), 12)).toEqual({ purged: 1 });
  expect(existsSync(path.join(DIR, "old.jpg"))).toBe(false); expect(existsSync(path.join(DIR, "new.jpg"))).toBe(true);
  expect((await db.select().from(messages)).length).toBe(2);
});
```
  Em `src/server/domain/import.test.ts`:
```ts
it("prévia aponta duplicado pelo telefone normalizado e linha inválida", () => {
  expect(previewImport("nome;telefone\nAna;71 99999-0001\nAna B;(71)999990001\nX;123")).toMatchObject({ rows: 1, duplicates: 1, invalid: [{ line: 4, value: "123" }] });
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. **Step 5:** commit `feat: etiquetas de sinal, importação com prévia, retenção de mídia de 12 meses`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Só domínio e worker. Ligar as etiquetas na Fila (`queue.ts`) e mostrar "mídia expirada" na conversa ficam na **T24** (evita conflito com a T21).

---

### Task 24: Celular e acessibilidade [e2e]

**Files:**
- Modify: todos os `src/components/**` e `src/app/**` apontados pelo axe e pela inspeção
- Create: `e2e/a11y.spec.ts`
- Modify: `package.json` (`@axe-core/playwright` em dev)

- [ ] **Step 1:** `e2e/a11y.spec.ts`:
```ts
import AxeBuilder from "@axe-core/playwright";
for (const path of ["/", "/atendimento", "/funil", "/jornada", "/contatos", "/relatorios", "/config/automacoes", "/config/origens"]) {
  test(`a11y ${path}`, async ({ page }) => {
    await login(page); await page.goto(path); await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
```
  Mais um teste que verifica que todo `input`, `select` e `textarea` visível no celular tem `font-size ≥ 16` (via `getComputedStyle`) e que os botões visíveis têm ≥ 44×44 em `pointer: coarse` (exceções: links em texto corrido).
- [ ] **Step 2:** rodar → listar as violações. **Step 3:** corrigir até zerar. **Step 4:** PASS nos dois projetos (desktop e celular). **Step 5:** commit `fix(a11y/celular): zero violações sérias, sem rolagem lateral, 16 px nos campos, alvos de 44 px`.

**Correções da revisão do plano (obrigatórias, valem sobre o texto acima):**
- Esperar `load` + um heading visível em vez de `networkidle` (o SSE nunca deixa a rede ociosa).
- Inclui: ligar `signalsOf` na `getQueue` e o "mídia expirada" na conversa (vindos da T23).

---

### Task 25: e2e dos critérios de conclusão (spec §12)

**Files:**
- Create: `e2e/criterios.spec.ts`

Um teste por critério da §12 que ainda não está coberto (mapear no ledger: critério → teste). Usa só o simulador e o fake (DEV_TOOLS no e2e) e **nenhum número real**. O critério 11 (backup) é o `scripts/restore-test.sh`, rodado aqui. O 13 e o 14 são revisão documental no ledger.

- [ ] Steps: escrever → rodar → corrigir o que falhar (sistematic-debugging para falha real) → PASS → commit `test(e2e): critérios de conclusão da spec`.

---

### Task 26: Verificação final e revisão do branch

- [ ] `npx tsc --noEmit`, `npx eslint src worker e2e --quiet`, `npx vitest run`, `npx playwright test` (desktop, celular e axe), `npm run build` e `bash scripts/restore-test.sh` → anotar os números no ledger.
- [ ] Verificar no navegador com o build de produção (`next start` numa porta de teste) e o banco e2e: os fluxos do dia (atender, agendar, comparecer, vender, arquivar e desfazer, origem por link, relatório com drill-down), no desktop e no celular, com 0 erros de console e 0 violações de CSP.
- [ ] Revisão independente do branch inteiro (subagente revisor no modelo mais capaz) com a spec em mãos. Achados críticos corrigidos antes de encerrar.
- [ ] Atualizar `README.md` (rotas novas, scripts e variáveis), `docs/deploy-contabo.md` e o `.env.example` (VAPID, TRUSTED_PROXY_HOPS, BACKUP_DIR).
- [ ] Relatório final ao dono, seguindo os 11 itens do pedido: features, correções, arquitetura, UI/UX, motion, relatórios, testes, desempenho, limitações, dependências externas e prontidão para produção. **Sem deploy.**
