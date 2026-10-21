# Lotes 1A, 1B e 1C (atendimento): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar o andamento.

**Goal:** "Sem dono" só quando for verdade e o nome de quem respondeu em todas as telas (1A); cada aviso diz o que aconteceu, de quem é e o que fazer (1B); o funil reflete a jornada da cliente e o Atendimento deixa de ser "qualquer conversa" (1C).

**Architecture:** Três lotes em sequência sobre os mesmos arquivos (`queue-item.tsx`, `client-pane.tsx`, `queue.ts`, `deals.ts`…), executados na ordem 1A → 1B → 1C. Regras puras ficam em `src/lib/*` (assinatura, autoria, textos dos avisos, tentativas), usadas pelo servidor e pela tela; o domínio (`src/server/domain/*`) grava autoria, dona, tentativas e passagens de etapa; os dados antigos de produção são acertados por três scripts com ensaio, backup JSON e conferência. Nada envia WhatsApp: tentativas e lembretes são tarefas que viram aviso.

**Tech Stack:** Next 16 (App Router, server actions), React 19, TypeScript, Drizzle ORM + drizzle-kit, Postgres 17 (Docker), pg-boss (worker), Vitest (+ Testing Library/jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md` (seções 3 › Lote 1A, Lote 1B, Lote 1C e 4 › Decisões confirmadas pelo dono). Auditorias com arquivo:linha em `docs/analise-2026-10-15/*.md`.

## Global Constraints

- Ordem de execução: Lote 1A (A1→A10), depois Lote 1B (B0→B14), depois Lote 1C (C1→C12). Os lotes mexem nos mesmos arquivos; os números de linha citados valem para o código **antes** do lote, então confirme com `grep -n` antes de editar.
- Testes: Postgres local de pé (`npm run infra:up`); o `vitest` migra o `crm_test` sozinho (`test/global-setup.ts`) e cada teste de banco usa `resetDb` (`test/db.ts`).
- Nada de enviar WhatsApp em teste: a Evolution dos testes aponta para `http://127.0.0.1:9` (`test/setup-env.ts`), conferido por `test/evolution-guard.test.ts`. Nenhum número real em teste nem em conferência na tela.
- Migrations de schema só aditivas: `0023_quem_atende` (1A) e `0024_funil_novo` (1C). Qualquer `DROP` ou `ALTER COLUMN ... TYPE` gerado é erro: parar.
- Migração de dados de produção SEMPRE como script idempotente com modo ensaio (`--dry-run`, que imprime a tabela de antes/depois), backup JSON antes de gravar e conferência depois; só aplica com o ok do dono.
- Perfis: `gestor` (Gestão) e `atendente` (Atendente = Recepção). Não há divisão de etapas por perfil neste plano.
- PT-BR em tudo que a equipe lê (textos de tela, avisos, histórico, saída dos scripts); código no estilo do arquivo ao redor.
- Assinatura do WhatsApp: `*NOME - CASA FIAES:*` na primeira linha da mensagem (spec: `^\*([A-ZÇÃÉÍ ]+) - CASA FIAES:\*`).
- Dona automática pela assinatura vale também para a Gestão (Cati) e também para trás; com dona definida, a dona não muda e aparece "Respondida por X" (decisão 2). A distribuição (`pickOwner`) continua nunca entregando conversa nova à gestão.
- "Perto do prazo" = 60% em todas as telas; vermelho só quando existe alerta; o mesmo anel e as mesmas cores na Fila, no Quadro, na Jornada e no cabeçalho.
- Horário da Casa (Lote 0, já em produção): ter–sáb 9h–18h; prazos Novo contato 10 min, demais 15 min, Agendado 30 min; escala para a gestão em 30 min. O seed nunca pode desfazer isso.
- Horário futuro só conta até 180 dias (datas absurdas do Avec ficam de fora).
- Decisão 4: importação do Avec, Agenda e migração só mexem em contatos com mensagem nos últimos 30 dias; os outros aparecem só na Agenda e na ficha.
- Funil (decisão 3): Novo contato → Em conversa → Aguardando cliente (3 tentativas: D+1, D+3, D+7, depois Perdido "Não respondeu mais") → Orçamento enviado → Agendado → Atendida (fecha sozinha em 3 dias) → Retorno sugerido → Fechado/Perdido. Follow-up 2 a 4 deixam de existir.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Cinco situações que a spec implica, que nenhum teste original exercitava e que mais devem morder quem usa. Cada uma tem o teste na tarefa dona:

1. **Espera que atravessa dias fechados** (cliente escreve sábado 17:55, a Casa só abre terça 9h): às 9:02 de terça ela espera 7 min de expediente, então a linha fica no prazo, e não "3 dias além do prazo". Teste: Tarefa B3, Passo 1 (`timer.test.ts`, "espera que atravessa dias fechados").
2. **Eco do envio pelo CRM chegando pelo webhook antes do retorno do envio** (a Evolution manda o `send.message` do próprio texto assinado): continua uma mensagem só, a autora é quem está logada, "por onde" = CRM e ninguém recebe aviso de "respondida por outra". Teste: Tarefa A4, Passo 1 ("eco do envio assinado pelo CRM").
3. **Assinatura na mesma linha do texto e em legenda de foto** (`*CATI - CASA FIAES:* Segue a foto`, comum no ChatGuru): conta a autora, dá a dona e o balão mostra só o texto. Testes: Tarefa A1, Passo 1 ("assinatura na mesma linha") e Tarefa A3, Passo 1 ("foto com legenda assinada").
4. **A dona respondendo a própria conversa** (pelo celular e depois pelo CRM): nenhum aviso "respondida por outra", a dona não muda e a última resposta fica com ela. Teste: Tarefa A3, Passo 1 ("a dona respondendo a própria conversa").
5. **Dona desativada no meio das tentativas** (alguém sai da equipe com conversas em Aguardando cliente): a varredura não trava nem dá erro, e a próxima tentativa nasce sem responsável. Teste: Tarefa C4, Passo 1 ("dona saiu da equipe no meio das tentativas").

## Decisões de junção (para quem revisa)

As três partes foram escritas em separado. Ao juntá-las, estes pontos foram acertados no texto das tarefas:

- **Um `firstName` só.** `src/lib/authorship.ts` (A5) é o dono de `firstName(name): string | null`. `src/lib/alert-copy.ts` (B2) reexporta o mesmo. No 1C, a versão com "a cliente" de reserva chama-se `clientFirstName` (`src/lib/attempts.ts`), para não haver dois `firstName` com tipos diferentes.
- **1B não desfaz o 1A.** B4 (montagem do `QueueItem`), B6 (linha da Fila) e B7 (painel "Responsável") mantêm os campos e textos do 1A: `ownerShort`, `lastAuthorName`, `repliedByName`, o prefixo "Cati:" no lugar de "Você:", `stripSignature` e "Respondida por".
- **1B usa a autora do 1A.** B9 (`defaultAssignee`) usa `deals.lastReplyById` (gravado pela A3/A9) antes de olhar as mensagens; B7 usa o `sender` que a A5 já entrega como nome da equipe; o aviso `respondida_por_outra` (A3) entra no sino agrupado e na ajuda (B2) e passa a usar `alertText.repliedByOther` (B8).
- **1C usa os textos do 1B.** C3 troca `PARADOS_ACTIONS` para "Agendar, Aguardar cliente ou Encerrar" (frase da spec), C9 acrescenta à ajuda os selos "Tentativa 1/3" e "Pacote 3/10", e C1 ajusta o teste de texto do escalado da B8 para os 30 min do Lote 0.
- **A5 → A6:** o `lastAuthorName` na prévia da conversa (`conversation-pane.tsx`) só entra na A6, quando o campo passa a existir no `QueueItem`.
- **Produção:** os roteiros de produção que estavam espalhados (A10, B9, C12) foram juntados na seção **Implantação**, no fim, com o procedimento real de publicação (tarball em `/opt/crm-rN` e troca de pasta).

---

## Lote 1A: Quem está atendendo

Este lote implementa as regras e telas do Lote 1A da spec, mais as decisões 2 e 4 da seção 4.

Três pontos de interpretação, registrados para quem for revisar:

- **"Muda `deals.ts:50`".** A função `pickOwner` continua igual. A Casa pediu em 14/10 que a gestão nunca receba conversa nova pela distribuição, e isso se mantém. O que muda são os pontos que hoje chamam `pickOwner` ou ignoram a assinatura:
  - conversa nova que a Casa começa pelo celular;
  - conversa nova que vem do histórico;
  - a regra da resposta em `deals.ts:280`/`:293`.

  Nesses três pontos, quem assinou vira a dona, inclusive quem tem perfil Gestão.
- **"Visto quando ela clica em responder".** O visto é mandado quando a pessoa **envia** a resposta pelo CRM.
- **"Fulana está nesta conversa"** (presença em tempo real) fica fora deste lote, como recomenda `docs/analise-2026-10-15/critica.md` (d).

**Pré-requisito para os testes:** Postgres local de pé (`npm run infra:up`). O `vitest` migra o `crm_test` sozinho (`test/global-setup.ts`).

---

### Tarefa A1: Ler, tirar e pôr a assinatura (módulo puro)

**Files:**
- Create: `src/lib/signature.ts`
- Test: `src/lib/signature.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizeSignature(raw: string): string`
  - `signatureKey(raw: string): string`
  - `isValidSignature(raw: string): boolean`
  - `parseSignature(body: string | null | undefined): string | null`
  - `stripSignature(body: string | null | undefined): string`
  - `signatureLine(sig: string): string`
  - `signBody(signature: string | null | undefined, text: string): string`
  - `signatureDisplayName(sig: string | null | undefined): string | null`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/signature.test.ts
import { describe, expect, it } from "vitest";
import { isValidSignature, normalizeSignature, parseSignature, signBody, signatureDisplayName, signatureKey, signatureLine, stripSignature } from "./signature";

describe("parseSignature", () => {
  it("lê a assinatura do ChatGuru no começo da mensagem", () => {
    expect(parseSignature("*SARA - CASA FIAES:*\nOlá! Tudo bem?")).toBe("SARA");
    expect(parseSignature("*CATI - CASA FIAES:*\r\nConfirmado")).toBe("CATI");
    expect(parseSignature("*SARA - CASA FIAES:*")).toBe("SARA");
  });
  it("aceita minúsculas, acento, nome composto, espaço antes e travessão", () => {
    expect(parseSignature("*Sara - Casa Fiaes:*\nOi")).toBe("SARA");
    expect(parseSignature("*MARIA JOSÉ - CASA FIAES:*\nOi")).toBe("MARIA JOSÉ");
    expect(parseSignature("  *CATI – CASA FIAES:*\nOi")).toBe("CATI");
  });
  it("assinatura no meio do texto, citada, com número ou de outro lugar não conta", () => {
    expect(parseSignature("Oi! A Sara mandou: *SARA - CASA FIAES:*")).toBeNull();
    expect(parseSignature("> *SARA - CASA FIAES:*\nOi")).toBeNull();
    expect(parseSignature("*SARA2 - CASA FIAES:*\nOi")).toBeNull();
    expect(parseSignature("*SARA - OUTRO SALÃO:*\nOi")).toBeNull();
    expect(parseSignature("Olá! Boa tarde, tudo bem?")).toBeNull();
    expect(parseSignature(null)).toBeNull();
    expect(parseSignature("")).toBeNull();
  });
  it("assinatura na mesma linha do texto (legenda de foto, ChatGuru sem quebra) conta e sai do balão", () => {
    expect(parseSignature("*CATI - CASA FIAES:* Segue a foto do resultado")).toBe("CATI");
    expect(stripSignature("*CATI - CASA FIAES:* Segue a foto do resultado")).toBe("Segue a foto do resultado");
  });
});

describe("stripSignature", () => {
  it("tira só a assinatura do começo", () => {
    expect(stripSignature("*SARA - CASA FIAES:*\nOlá!")).toBe("Olá!");
    expect(stripSignature("Olá!")).toBe("Olá!");
    expect(stripSignature("Oi *SARA - CASA FIAES:*")).toBe("Oi *SARA - CASA FIAES:*");
    expect(stripSignature(null)).toBe("");
  });
});

describe("signBody", () => {
  it("põe a assinatura na primeira linha", () => {
    expect(signBody("sara", "Olá!")).toBe("*SARA - CASA FIAES:*\nOlá!");
  });
  it("sem assinatura cadastrada ou com texto já assinado, vai como está", () => {
    expect(signBody(null, "Olá!")).toBe("Olá!");
    expect(signBody("  ", "Olá!")).toBe("Olá!");
    expect(signBody("SARA", "*CATI - CASA FIAES:*\nOi")).toBe("*CATI - CASA FIAES:*\nOi");
  });
});

describe("cadastro da assinatura", () => {
  it("normaliza, compara sem acento e valida", () => {
    expect(normalizeSignature("  sara   taise ")).toBe("DANIELA REZENDE");
    expect(signatureKey("José")).toBe(signatureKey("JOSE"));
    expect(isValidSignature("Sara")).toBe(true);
    expect(isValidSignature("Maria José")).toBe(true);
    expect(isValidSignature("S")).toBe(false);
    expect(isValidSignature("SARA 2")).toBe(false);
    expect(isValidSignature("SARA-CASA")).toBe(false);
    expect(isValidSignature("A".repeat(31))).toBe(false);
    expect(signatureLine("cati")).toBe("*CATI - CASA FIAES:*");
    expect(signatureDisplayName("MARIA JOSÉ")).toBe("Maria José");
    expect(signatureDisplayName(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/signature.test.ts`
Expected: FAIL com `Failed to resolve import "./signature"`

- [ ] **Step 3: Implementar**

```ts
// src/lib/signature.ts
/**
 * Assinatura da equipe no começo da mensagem do WhatsApp: "*SARA - CASA FIAES:*" e o texto na linha de baixo (padrão do ChatGuru).
 * Módulo puro: o servidor usa para saber quem respondeu pelo celular; a tela, para tirar a assinatura do balão e da prévia.
 */
const SIGNATURE_RE = /^\s*\*\s*(\p{L}[\p{L} ]{0,29}?)\s*[-–]\s*CASA\s+FIAES\s*:\s*\*[ \t]*(?:\r?\n)?/iu;
const VALID = /^\p{Lu}[\p{Lu} ]{1,29}$/u;

/** "  sara  taise " → "DANIELA REZENDE". */
export function normalizeSignature(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/** Chave de comparação, sem acento: "JOSÉ" e "JOSE" são a mesma pessoa. */
export function signatureKey(raw: string): string {
  return normalizeSignature(raw).normalize("NFD").replace(/\p{M}/gu, "");
}

/** Assinatura aceita no cadastro: só letras e espaço, de 2 a 30. */
export function isValidSignature(raw: string): boolean {
  return VALID.test(normalizeSignature(raw));
}

/** O nome da assinatura no começo da mensagem ("SARA"), ou null. Assinatura no meio do texto (citação, encaminhada) não conta. */
export function parseSignature(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = SIGNATURE_RE.exec(body);
  return m ? normalizeSignature(m[1]) : null;
}

/** O texto sem a assinatura do começo (o balão e a prévia já mostram o nome de quem enviou). */
export function stripSignature(body: string | null | undefined): string {
  if (!body) return "";
  return parseSignature(body) ? body.replace(SIGNATURE_RE, "") : body;
}

/** A linha da assinatura como a cliente vê no WhatsApp: "*SARA - CASA FIAES:*". */
export const signatureLine = (sig: string) => `*${normalizeSignature(sig)} - CASA FIAES:*`;

/** Põe a assinatura na primeira linha. Sem assinatura cadastrada, ou se o texto já começa com uma, vai como está. */
export function signBody(signature: string | null | undefined, text: string): string {
  if (!signature?.trim() || parseSignature(text)) return text;
  return `${signatureLine(signature)}\n${text}`;
}

/** "MARIA JOSÉ" → "Maria José": é o nome que a equipe usa entre si ("Cati"), e o que aparece quando a assinatura não é de ninguém cadastrado. */
export const signatureDisplayName = (sig: string | null | undefined): string | null =>
  sig ? sig.toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (c) => c.toLocaleUpperCase("pt-BR")) : null;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/signature.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/signature.ts src/lib/signature.test.ts
git commit -m "feat(1A): ler, tirar e pôr a assinatura *NOME - CASA FIAES:*

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A2: Colunas novas e campo "Assinatura" em Configurações › Equipe

**Files:**
- Modify: `src/server/db/schema.ts`
  - `users`: coluna `signature` e índice `users_signature_uq`;
  - `messages`: coluna `sentVia` e índice `messages_sent_by_idx`;
  - `deals`: colunas `lastReplyById` e `lastReplyVia`.
- Create: `drizzle/0023_quem_atende.sql`, gerado pelo drizzle-kit (o último hoje é `0022_avec_agenda.sql`).
- Modify: `src/server/db/schema.test.ts`
- Modify: `src/server/domain/profiles.ts` (função nova `setMemberSignature`)
- Modify: `src/server/domain/members.test.ts`
- Modify: `src/app/(app)/config/actions.ts` (`setMemberSignatureAction`)
- Modify: `src/app/(app)/config/equipe/page.tsx`
- Modify: `src/components/config/team.tsx`
- Create: `src/components/config/team.test.tsx`

**Interfaces:**
- Consumes: A1 (`normalizeSignature`, `isValidSignature`, `signatureKey`, `signatureLine`).
- Produces:
  - Colunas Drizzle:
    - `users.signature: string | null`
    - `messages.sentVia: "celular" | "crm" | null`
    - `deals.lastReplyById: string | null`
    - `deals.lastReplyVia: "celular" | "crm" | null`
  - `setMemberSignature(userId: string, raw: string | null, actorId: string): Promise<{ signature: string | null }>` (em `src/server/domain/profiles.ts`).
  - `setMemberSignatureAction(id: string, signature: string): Promise<{ ok: true; data?: { signature: string | null } } | { ok: false; error: string }>`.

- [ ] **Step 1: Teste de schema que falha**

Acrescentar no fim do `describe` de `src/server/db/schema.test.ts`:

```ts
  it("quem atende: assinatura, por onde saiu e quem respondeu por último", async () => {
    expect(await cols("users")).toContain("signature");
    expect(await cols("messages")).toContain("sent_via");
    expect(await cols("deals")).toEqual(expect.arrayContaining(["last_reply_by_id", "last_reply_via"]));
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('users_signature_uq', 'messages_sent_by_idx')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(m.users_signature_uq).toContain("upper(signature)");
    expect(m.messages_sent_by_idx).toContain("sent_by_user_id");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/db/schema.test.ts`
Expected: FAIL em "quem atende" (`expected [...] to contain 'signature'`)

- [ ] **Step 3: Mudar o schema**

Em `src/server/db/schema.ts`, no `users`, logo depois de `lastAssignedAt`:

```ts
  /** Assinatura no WhatsApp ("SARA" em "*SARA - CASA FIAES:*"): vai nas mensagens enviadas pelo CRM e diz quem respondeu pelo celular ou pelo ChatGuru. */
  signature: text("signature"),
```

e trocar o callback de índices do `users` por:

```ts
}, (t) => [
  uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
  // Duas pessoas nunca com a mesma assinatura (o domínio confere também sem acento).
  uniqueIndex("users_signature_uq").on(sql`upper(${t.signature})`).where(sql`${t.signature} is not null`),
]);
```

No `deals`, logo depois de `firstResponseAt`:

```ts
  /** Quem respondeu por último (pessoa logada no CRM ou assinatura do celular) e por onde: "Dona: Sara · respondida por Cati". */
  lastReplyById: uuid("last_reply_by_id").references(() => users.id),
  lastReplyVia: text("last_reply_via").$type<"celular" | "crm">(),
```

No `messages`, logo depois de `sentByUserId`:

```ts
  /** Por onde saiu a mensagem da Casa: "celular" (celular ou ChatGuru) ou "crm". Automática fica null. */
  sentVia: text("sent_via").$type<"celular" | "crm">(),
```

e no callback de índices do `messages` acrescentar:

```ts
  // "Equipe agora": a última resposta de cada pessoa.
  index("messages_sent_by_idx").on(t.sentByUserId, t.createdAt),
```

- [ ] **Step 4: Gerar a migration (só aditiva)**

Run: `npm run db:generate -- --name quem_atende`
Expected: arquivo `drizzle/0023_quem_atende.sql`, só com `ADD COLUMN`, `ADD CONSTRAINT ... FOREIGN KEY` e `CREATE ... INDEX`, equivalente a:

```sql
ALTER TABLE "deals" ADD COLUMN "last_reply_by_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "last_reply_via" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_last_reply_by_id_users_id_fk" FOREIGN KEY ("last_reply_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sent_by_idx" ON "messages" USING btree ("sent_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_signature_uq" ON "users" USING btree (upper("signature")) WHERE "users"."signature" is not null;
```

Se aparecer qualquer `DROP` ou `ALTER COLUMN ... TYPE`, parar: o schema local está diferente do último snapshot. Conferir com `git diff drizzle/meta`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/server/db/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Teste do domínio que falha**

Em `src/server/domain/members.test.ts`:
- trocar os imports por:
  - `import { auditLog, profiles, sessions, users } from "../db/schema";`
  - `import { createMember, resetMemberPassword, setMemberSignature } from "./profiles";`
- acrescentar no fim:

```ts
describe("assinatura (Configurações › Equipe)", () => {
  it("guarda em maiúsculas, recusa repetida (mesmo com acento) e inválida, vazio tira; tudo auditado", async () => {
    const sara = await createMember({ name: "Daniela Rezende", email: "s@c.com", password: "12345678", profileId: recepcao }, g);
    const cati = await createMember({ name: "Caticilene", email: "c@c.com", password: "12345678", profileId: recepcao }, g);
    expect(await setMemberSignature(sara.id, "  sara ", g)).toEqual({ signature: "SARA" });
    await expect(setMemberSignature(cati.id, "Sára", g)).rejects.toThrow("A assinatura SÁRA já é de Daniela Rezende.");
    await expect(setMemberSignature(cati.id, "CATI 2", g)).rejects.toThrow("Use só letras e espaço");
    expect(await setMemberSignature(cati.id, "cati", g)).toEqual({ signature: "CATI" });
    expect(await setMemberSignature(sara.id, "   ", g)).toEqual({ signature: null });
    expect((await db.select().from(users).where(eq(users.id, cati.id)))[0].signature).toBe("CATI");
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "assinatura_alterada"))).toHaveLength(3);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run src/server/domain/members.test.ts`
Expected: FAIL com `setMemberSignature is not a function`

- [ ] **Step 8: Implementar `setMemberSignature`**

Em `src/server/domain/profiles.ts`:
- acrescentar o import `import { isValidSignature, normalizeSignature, signatureKey } from "@/lib/signature";`;
- acrescentar a função depois de `setMemberActive`:

```ts
/** Assinatura de quem atende (Configurações › Equipe). Vazio tira a assinatura. Duas pessoas não podem ter a mesma (sem diferenciar acento). */
export async function setMemberSignature(userId: string, raw: string | null, actorId: string): Promise<{ signature: string | null }> {
  const signature = raw?.trim() ? normalizeSignature(raw) : null;
  if (signature && !isValidSignature(signature)) throw new UserFacingError("Use só letras e espaço, de 2 a 30, como SARA.");
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, signature: users.signature }).from(users).where(eq(users.id, userId)).for("update");
    if (!u) throw new UserFacingError("Essa pessoa não está mais na equipe.");
    if (signature) {
      const others = await tx.select({ name: users.name, signature: users.signature }).from(users)
        .where(and(ne(users.id, userId), sql`${users.signature} is not null`));
      const dup = others.find((o) => signatureKey(o.signature!) === signatureKey(signature));
      if (dup) throw new UserFacingError(`A assinatura ${signature} já é de ${dup.name}.`);
    }
    await tx.update(users).set({ signature }).where(eq(users.id, userId));
    await audit(tx, actorId, "assinatura_alterada", "user", userId, { de: u.signature, para: signature });
    return { signature };
  });
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run src/server/domain/members.test.ts`
Expected: PASS

- [ ] **Step 10: Ação e página**

Em `src/app/(app)/config/actions.ts`, depois de `resetMemberPasswordAction`:

```ts
export const setMemberSignatureAction = async (id: string, signature: string) =>
  run((u) => profiles.setMemberSignature(z.string().uuid().parse(id), signature, u), "/config/equipe", "equipe.gerir");
```

Em `src/app/(app)/config/equipe/page.tsx`, no `members={rows.map(...)}`, acrescentar `signature: u.signature`:

```tsx
        members={rows.map((u) => ({ id: u.id, name: u.name, email: u.email, profileId: u.profileId, active: u.active, pending: !u.passwordHash, signature: u.signature }))} />
```

- [ ] **Step 11: Teste da tela que falha**

```tsx
// src/components/config/team.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { setSig } = vi.hoisted(() => ({ setSig: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { signature: "SARA" } })) }));
vi.mock("@/app/(app)/config/actions", () => ({
  createMemberAction: vi.fn(), resetMemberPasswordAction: vi.fn(), setMemberActiveAction: vi.fn(), setMemberProfileAction: vi.fn(),
  setMemberSignatureAction: (...a: unknown[]) => setSig(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { TeamEditor } from "./team";

afterEach(cleanup);

it("assinatura: mostra como a cliente vê e salva em maiúsculas", async () => {
  render(<TeamEditor me="g" profiles={[{ id: "p", name: "Atendente", key: "atendente" }]}
    members={[{ id: "u1", name: "Daniela Rezende", email: "s@c.com", profileId: "p", active: true, pending: false, signature: null }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Assinatura de Daniela Rezende: sem assinatura" }));
  fireEvent.change(screen.getByLabelText("Assinatura"), { target: { value: "sara" } });
  expect(screen.getByText("*SARA - CASA FIAES:*")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Salvar assinatura" }));
  await waitFor(() => expect(setSig).toHaveBeenCalledWith("u1", "SARA"));
});
```

- [ ] **Step 12: Rodar e ver falhar**

Run: `npx vitest run src/components/config/team.test.tsx`
Expected: FAIL com `Unable to find an accessible element with the role "button" and name "Assinatura de Daniela Rezende: sem assinatura"`

- [ ] **Step 13: Implementar na tela**

Em `src/components/config/team.tsx`:

1. Imports:

```tsx
import { createMemberAction, resetMemberPasswordAction, setMemberActiveAction, setMemberProfileAction, setMemberSignatureAction } from "@/app/(app)/config/actions";
import { signatureLine } from "@/lib/signature";
```

2. Tipo:

```tsx
type M = { id: string; name: string; email: string; profileId: string | null; active: boolean; pending: boolean; signature: string | null };
```

3. Estado e ação, logo depois de `const [resetFor, ...]`:

```tsx
  const [sigFor, setSigFor] = useState<M | null>(null); const [sigValue, setSigValue] = useState("");
  const saveSig = () => start(async () => {
    const r = await setMemberSignatureAction(sigFor!.id, sigValue);
    if (r.ok) { toast(sigValue.trim() ? "Assinatura salva" : "Assinatura removida", "ok"); setSigFor(null); setErr(null); } else setErr(r.error);
  });
```

4. Grade da linha: trocar `sm:grid-cols-[36px_1fr_auto_150px_auto_110px]` por `sm:grid-cols-[36px_1fr_auto_150px_150px_auto_110px]`.

5. Botão novo, logo depois do `<Select ...>` do perfil:

```tsx
            <Button size="sm" variant="ghost" className={`col-start-2 sm:col-start-auto justify-self-start ${m.signature ? "" : "text-gold-ink"}`} disabled={pending}
              aria-label={`Assinatura de ${m.name}: ${m.signature ?? "sem assinatura"}`}
              onClick={() => { setSigFor(m); setSigValue(m.signature ?? ""); setErr(null); }}>{m.signature ?? "Sem assinatura"}</Button>
```

6. Diálogo novo, antes do diálogo de troca de senha:

```tsx
      <Dialog open={!!sigFor} onClose={() => setSigFor(null)} title={`Assinatura de ${sigFor?.name.split(" ")[0] ?? ""}`}
        description="Vai no começo das mensagens que ela manda pelo CRM, como no ChatGuru. O CRM também usa a assinatura para saber quem respondeu pelo celular ou pelo ChatGuru e quem é a dona da conversa."
        footer={<><Button variant="secondary" onClick={() => setSigFor(null)}>Cancelar</Button><Button loading={pending} onClick={saveSig}>Salvar assinatura</Button></>}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); saveSig(); }}>
          <Field label="Assinatura" htmlFor="t-sig" hint="Use o mesmo nome que ela já usa no ChatGuru, por exemplo SARA ou CATI. Deixe vazio para ela mandar sem assinatura.">
            <Input id="t-sig" autoComplete="off" maxLength={30} value={sigValue} onChange={(e) => setSigValue(e.target.value.toLocaleUpperCase("pt-BR"))} />
          </Field>
          <p className="text-sm text-graphite">Como a cliente vê: <span className="font-mono">{sigValue.trim() ? signatureLine(sigValue) : "sem assinatura"}</span></p>
          {err && <p className="text-sm text-alert" role="alert">{err}</p>}
          <button type="submit" hidden />
        </form>
      </Dialog>
```

7. No parágrafo do topo, acrescentar ao texto: ` A <b>assinatura</b> de cada pessoa diz quem respondeu, inclusive pelo celular.`

- [ ] **Step 14: Rodar e ver passar, mais a checagem de tipos**

Run: `npx vitest run src/components/config/team.test.tsx src/server/domain/members.test.ts && npm run typecheck`
Expected: PASS e `tsc` sem erros

- [ ] **Step 15: Commit**

```bash
git add src/server/db/schema.ts src/server/db/schema.test.ts drizzle/ src/server/domain/profiles.ts src/server/domain/members.test.ts "src/app/(app)/config/actions.ts" "src/app/(app)/config/equipe/page.tsx" src/components/config/team.tsx src/components/config/team.test.tsx
git commit -m "feat(1A): assinatura por pessoa em Configurações › Equipe e colunas de autoria

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A3: Autora e dona automática na mensagem que sai

**Files:**
- Create: `src/server/domain/authorship.ts`
- Modify: `src/server/domain/deals.ts` (`recordOutbound`, linhas 223–311; `importHistoryChat`, linhas 361–406)
- Modify: `src/lib/history.ts` (case `"assumiu"`)
- Modify: `src/lib/history.test.ts`
- Test: `src/server/domain/authorship.test.ts`

**Interfaces:**
- Consumes:
  - A1: `parseSignature`, `signatureKey`.
  - A2: as colunas `users.signature`, `messages.sentVia`, `deals.lastReplyById` e `deals.lastReplyVia`.
- Produces (em `src/server/domain/authorship.ts`):
  - `type SentVia = "celular" | "crm"`
  - `type SignatureOwner = { id: string; name: string; active: boolean }`
  - `signatureMap(tx?): Promise<Map<string, SignatureOwner>>`, com a chave igual a `signatureKey`
  - `signerOf(tx, body, map?): Promise<SignatureOwner | null>`
  - `sentViaOf({ fromPhone?, automated?, authorId? }): SentVia | null`
  - `warnOwnerRepliedByOther(tx, { dealId, ownerId, authorId, at }): Promise<boolean>` (a B8 troca o texto pelo `alertText.repliedByOther`, com a mesma frase)
- Comportamento novo de `recordOutbound`:
  - grava `sentByUserId` (a pessoa logada ou quem assinou) e `sentVia`;
  - atualiza `deals.lastReplyById` e `deals.lastReplyVia`;
  - dá a dona quando a conversa está sem dona;
  - com dona definida, cria o alerta `type = "respondida_por_outra"` para a dona.
- O evento `assumiu` ganha `payload.motivo = "assinatura"` (e `migracao: true` no script da A9).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/server/domain/authorship.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, messages, profiles, users } from "../db/schema";
import { importHistoryChat, recordInbound, recordOutbound } from "./deals";
import { resetDb } from "../../../test/db";

const T0 = new Date("2026-10-14T13:00:00Z"); // terça, 10h em Salvador
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
type U = typeof users.$inferSelect;
let sara: U, cati: U;
let c = 0, o = 0;

const person = async (name: string, key: "atendente" | "gestao", signature: string | null, active = true) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, key));
  return (await db.insert(users).values({ name, email: `${name.split(" ")[0].toLowerCase()}@c.com`, passwordHash: "x",
    role: key === "gestao" ? "gestor" : "atendente", profileId: p.id, signature, active }).returning())[0];
};
/** Conversa da cliente "Cliente N", com a dona pedida (sem dona por padrão). */
const conversa = async (ownerId: string | null = null) => {
  c++;
  const phone = `7199955${String(c).padStart(4, "0")}`;
  const r = await recordInbound({ channelId: null, externalId: `IN${c}`, phoneRaw: phone, pushName: `Cliente ${c}`, body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error();
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return { dealId: r.dealId, phone };
};
const pelocelular = (phone: string, body: string | null, at = min(2), kind = "text") =>
  recordOutbound({ phoneRaw: phone, channelId: null, externalId: `OUT${++o}`, body, kind, fromPhone: true, at });
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const outs = (dealId: string) => db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out")));
const avisos = () => db.select().from(alerts).where(eq(alerts.type, "respondida_por_outra"));

beforeEach(async () => {
  c = 0; o = 0; await resetDb();
  sara = await person("Daniela Rezende", "atendente", "SARA");
  cati = await person("Natália Campos", "gestao", "CATI");
});

describe("autoria pela assinatura", () => {
  it("resposta assinada pelo celular registra a autora e por onde saiu", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*SARA - CASA FIAES:*\nOlá! Tudo bem?");
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: sara.id, sentVia: "celular", fromPhone: true });
    expect(await deal(dealId)).toMatchObject({ lastReplyById: sara.id, lastReplyVia: "celular" });
  });

  it("conversa sem dona: quem assinou vira a dona, inclusive a gestão; o histórico e o tempo de resposta contam para ela", async () => {
    const a = await conversa(); const b = await conversa();
    await pelocelular(a.phone, "*SARA - CASA FIAES:*\nOi");
    await pelocelular(b.phone, "*CATI - CASA FIAES:*\nOi");
    expect((await deal(a.dealId)).ownerId).toBe(sara.id);
    expect((await deal(b.dealId)).ownerId).toBe(cati.id);
    const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, b.dealId), eq(dealEvents.type, "assumiu")));
    expect(ev).toMatchObject({ userId: cati.id, payload: { de: null, para: cati.id, motivo: "assinatura" } });
    const [resp] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, b.dealId), eq(dealEvents.type, "resposta")));
    expect(resp.userId).toBe(cati.id);
  });

  it("com dona: a dona não muda, fica quem respondeu e a dona recebe UM aviso por dia", async () => {
    const { dealId, phone } = await conversa(sara.id);
    await pelocelular(phone, "*CATI - CASA FIAES:*\nOi", min(2));
    await recordInbound({ channelId: null, externalId: "IN-X", phoneRaw: phone, body: "e aí?", at: min(3) });
    await pelocelular(phone, "*CATI - CASA FIAES:*\nJá vejo", min(4));
    expect(await deal(dealId)).toMatchObject({ ownerId: sara.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    const a = await avisos();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: sara.id, audience: "responsavel", dealId });
    expect(a[0].message).toBe("Caticilene respondeu a conversa de Cliente 1. Ela continua sua; se for para passar, use Transferir.");
  });

  it("a dona respondendo a própria conversa (pelo celular e depois pelo CRM) não gera aviso", async () => {
    const { dealId, phone } = await conversa(sara.id);
    await pelocelular(phone, "*SARA - CASA FIAES:*\nOi", min(2));
    await recordOutbound({ dealId, channelId: null, body: "Tudo certo?", userId: sara.id, at: min(3) });
    expect(await avisos()).toHaveLength(0);
    expect(await deal(dealId)).toMatchObject({ ownerId: sara.id, lastReplyById: sara.id, lastReplyVia: "crm" });
  });

  it("foto com legenda assinada na mesma linha conta a autora e dá a dona", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*CATI - CASA FIAES:* Segue a foto do resultado", min(2), "image");
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: cati.id, sentVia: "celular" });
    expect((await deal(dealId)).ownerId).toBe(cati.id);
  });

  it("sem assinatura (áudio), assinatura no meio do texto ou nome desconhecido: não muda autora nem dona", async () => {
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*MARIA - CASA FIAES:*\nOi", min(2));
    await pelocelular(phone, "Oi! A *SARA - CASA FIAES:* pediu para avisar", min(3));
    await pelocelular(phone, null, min(4), "audio");
    expect((await deal(dealId)).ownerId).toBeNull();
    expect((await outs(dealId)).map((m) => [m.sentByUserId, m.sentVia])).toEqual([[null, "celular"], [null, "celular"], [null, "celular"]]);
    expect(await avisos()).toHaveLength(0);
  });

  it("assinatura de quem foi desativada registra a autora, mas não vira dona", async () => {
    const ex = await person("Ex Atendente", "atendente", "EX", false);
    const { dealId, phone } = await conversa();
    await pelocelular(phone, "*EX - CASA FIAES:*\nOi");
    expect((await outs(dealId))[0].sentByUserId).toBe(ex.id);
    expect((await deal(dealId)).ownerId).toBeNull();
  });

  it("a Casa começa a conversa pelo celular assinando: a conversa nova já nasce com a dona", async () => {
    const r = await recordOutbound({ phoneRaw: "71988887777", channelId: null, externalId: "NOVA", body: "*CATI - CASA FIAES:*\nOi, Bruna!", fromPhone: true, at: T0 });
    if (!("dealId" in r)) throw new Error();
    expect((await deal(r.dealId)).ownerId).toBe(cati.id);
  });

  it("pelo CRM a autora é quem está logada (o texto não decide)", async () => {
    const { dealId } = await conversa();
    await recordOutbound({ dealId, channelId: null, body: "*CATI - CASA FIAES:*\nOi", userId: sara.id, at: min(2) });
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: sara.id, sentVia: "crm" });
    expect((await deal(dealId)).ownerId).toBe(sara.id);
  });

  it("mensagem automática não tem autora nem muda a dona", async () => {
    const { dealId } = await conversa();
    await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nLembrete", automated: true, at: min(2) });
    expect((await outs(dealId))[0]).toMatchObject({ sentByUserId: null, sentVia: null });
    expect((await deal(dealId)).ownerId).toBeNull();
  });

  it("histórico do WhatsApp: a mensagem assinada ganha autora e a conversa nova, a dona", async () => {
    const r = await importHistoryChat(null, "5571977776666@s.whatsapp.net", [
      { externalId: "H1", fromMe: false, at: new Date("2026-10-14T12:00:00Z"), kind: "text", body: "oi", pushName: "Lia" },
      { externalId: "H2", fromMe: true, at: new Date("2026-10-14T12:05:00Z"), kind: "text", body: "*CATI - CASA FIAES:*\nOi, Lia!" },
    ], new Date("2026-10-15T12:00:00Z"));
    if (!("dealId" in r) || !r.dealId) throw new Error();
    expect(await deal(r.dealId)).toMatchObject({ ownerId: cati.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    const [m] = await db.select().from(messages).where(eq(messages.externalId, "H2"));
    expect(m).toMatchObject({ sentByUserId: cati.id, sentVia: "celular" });
  });
});
```

E em `src/lib/history.test.ts`, no fim:

```ts
it("dona pela assinatura do celular fica explicada (inclusive no acerto das conversas antigas)", () => {
  const es = historyEntries([
    ev("1", "assumiu", { de: null, para: "u1", motivo: "assinatura" }, "2026-10-13T17:02:00Z"),
    ev("2", "assumiu", { de: null, para: "u1", motivo: "assinatura", migracao: true }, "2026-10-13T17:03:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual([
    "Virou a dona: respondeu assinando pelo celular (acerto das conversas antigas)",
    "Virou a dona: respondeu assinando pelo celular",
  ]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/domain/authorship.test.ts src/lib/history.test.ts`
Expected: FAIL. Por exemplo, `expected { sentByUserId: null, … } to match object { sentByUserId: '…' }` e `expected 'Assumiu o lead' to be 'Virou a dona: …'`.

- [ ] **Step 3: Criar o módulo de autoria**

```ts
// src/server/domain/authorship.ts
import { eq, isNotNull } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, users } from "../db/schema";
import { parseSignature, signatureKey } from "@/lib/signature";
import { formatPhone } from "./phone";

export type SentVia = "celular" | "crm";
export type SignatureOwner = { id: string; name: string; active: boolean };

/** Assinaturas cadastradas (Configurações › Equipe) → pessoa, pela chave sem acento. Inclui quem foi desativada: a mensagem antiga continua sendo dela. */
export async function signatureMap(tx: Tx | typeof db = db): Promise<Map<string, SignatureOwner>> {
  const rows = await tx.select({ id: users.id, name: users.name, active: users.active, signature: users.signature }).from(users).where(isNotNull(users.signature));
  return new Map(rows.map((r) => [signatureKey(r.signature!), { id: r.id, name: r.name, active: r.active }]));
}

/** Quem assinou a mensagem ("*SARA - CASA FIAES:*" → Sara), ou null (sem assinatura, ou nome que ninguém da equipe usa). */
export async function signerOf(tx: Tx | typeof db, body: string | null | undefined, map?: Map<string, SignatureOwner>): Promise<SignatureOwner | null> {
  const sig = parseSignature(body);
  if (!sig) return null;
  return (map ?? (await signatureMap(tx))).get(signatureKey(sig)) ?? null;
}

/** Por onde saiu a mensagem da Casa. Automática (e eco sem autora fora do celular) fica sem. */
export const sentViaOf = (m: { fromPhone?: boolean; automated?: boolean; authorId?: string | null }): SentVia | null =>
  m.automated ? null : m.fromPhone ? "celular" : m.authorId ? "crm" : null;

const bahiaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Bahia" });

/**
 * Outra pessoa respondeu a conversa de alguém: a dona continua a mesma e recebe UM aviso por dia, por conversa e por quem respondeu
 * (a gestão decide se transfere). Devolve se criou o aviso.
 */
export async function warnOwnerRepliedByOther(tx: Tx, p: { dealId: string; ownerId: string; authorId: string; at: Date }): Promise<boolean> {
  const [[who], [c]] = await Promise.all([
    tx.select({ name: users.name }).from(users).where(eq(users.id, p.authorId)),
    tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).innerJoin(deals, eq(deals.contactId, contacts.id)).where(eq(deals.id, p.dealId)),
  ]);
  const quem = who?.name.trim().split(/\s+/)[0] || "Outra pessoa";
  const cliente = c?.name?.trim() || (c ? formatPhone(c.phone) : "uma cliente");
  const r = await tx.insert(alerts).values({
    dealId: p.dealId, userId: p.ownerId, audience: "responsavel", type: "respondida_por_outra", severity: "info",
    message: `${quem} respondeu a conversa de ${cliente}. Ela continua sua; se for para passar, use Transferir.`,
    dedupeKey: `respondida:${p.dealId}:${p.authorId}:${bahiaDay(p.at)}`,
  }).onConflictDoNothing().returning({ id: alerts.id });
  return r.length > 0;
}
```

- [ ] **Step 4: Mudar `recordOutbound` em `src/server/domain/deals.ts`**

Imports novos no topo do arquivo:

```ts
import { sentViaOf, signatureMap, signerOf, warnOwnerRepliedByOther } from "./authorship";
import { parseSignature, signatureKey } from "../../lib/signature";
```

Trocar a função inteira (linhas 223–311) por:

```ts
/**
 * Mensagem enviada pela Casa (pelo CRM ou pelo celular): conta como resposta e move Lead → Atendimento.
 * Autora: no CRM, a pessoa logada; pelo celular ou ChatGuru, a assinatura "*NOME - CASA FIAES:*" (Configurações › Equipe).
 * Sem dona, quem respondeu vira a dona (também a gestão). Com dona, a dona não muda e, se foi outra pessoa, recebe um aviso.
 */
export async function recordOutbound(input: OutboundInput) {
  const at = input.at ?? new Date();
  const result = await db.transaction(async (tx) => {
    const signer = input.automated || input.userId ? null : await signerOf(tx, input.body);
    const authorId = input.automated ? null : input.userId ?? signer?.id ?? null;
    const sentVia = sentViaOf({ fromPhone: input.fromPhone, automated: input.automated, authorId });
    // Dona automática só para quem está na equipe: assinatura de pessoa desativada só registra a autora.
    const signerOwner = signer?.active ? signer.id : null;
    let dealId = input.dealId ?? null;
    let contactId = input.contactId ?? null;
    const lid = input.lid?.replace(/\D/g, "") || null;
    if (!contactId && (input.phoneRaw || lid)) {
      const phone = input.phoneRaw ? normalizePhone(input.phoneRaw) : null;
      if (!phone && !lid) return { skipped: "telefone_invalido" as const };
      // Conversa que a Casa iniciou pelo celular também é lead: número conectado = todas as conversas no CRM.
      const c = input.fromPhone ? await resolveContact(tx, phone, lid, null)
        : phone ? (await tx.select().from(contacts).where(eq(contacts.phoneE164, phone)))[0]
        : (await tx.select().from(contacts).where(eq(contacts.waLid, lid!)))[0];
      if (!c) return { skipped: "sem_contato" as const };
      if (c.ignored && !(await findOpenDeal(c.id, tx))) {
        await tx.insert(messages).values({ dealId: await latestArchivedDealId(c.id, tx), contactId: c.id, channelId: input.channelId, externalId: input.externalId ?? null, direction: "out",
          kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent", fromPhone: !!input.fromPhone, sentByUserId: authorId, sentVia, media: input.media ?? null, createdAt: at }).onConflictDoNothing();
        return { skipped: "contato_ignorado" as const };
      }
      contactId = c.id;
    }
    if (!dealId && contactId) dealId = (await findOpenDeal(contactId, tx))?.id ?? null;
    if (!dealId && contactId && input.fromPhone) {
      const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      const lead = await stageByKey("lead", tx);
      const origin = detectOrigin({ isClient: c?.isClient });
      const [created] = await tx.insert(deals).values({
        // Quem assinou a primeira mensagem já é a dona; sem assinatura, a regra antiga (distribuição, nunca a gestão).
        contactId, stageId: lead.id, ownerId: signerOwner ?? await pickOwner(tx), channelId: input.channelId, origin, stageEnteredAt: at, createdAt: at,
      }).returning();
      await logEvent(tx, created.id, "lead_criado", { origin, initialStage: lead.key, historico: false, iniciadoPelaCasa: true });
      dealId = created.id;
    }
    if (!dealId) return { skipped: "sem_lead_aberto" as const };
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) return { skipped: "sem_lead_aberto" as const };

    const [msg] = input.claimMessageId
      ? await tx.update(messages).set({ status: sql`case when ${messages.status} in ('pending','sent') then ${input.status ?? "sent"} else ${messages.status} end`,
          externalId: sql`coalesce(${messages.externalId}, ${input.externalId ?? null})`, channelId: input.channelId ?? deal.channelId })
          .where(eq(messages.id, input.claimMessageId)).returning({ id: messages.id })
      : await tx.insert(messages).values({
          dealId, contactId: deal.contactId, channelId: input.channelId ?? deal.channelId, externalId: input.externalId ?? null,
          direction: "out", kind: input.kind ?? "text", body: input.body ?? null, status: input.status ?? "sent",
          sentByUserId: authorId, sentVia, fromPhone: !!input.fromPhone, media: input.media ?? null, quotedBody: input.quotedBody ?? null, createdAt: at,
        }).onConflictDoNothing().returning({ id: messages.id });
    if (!msg) return { duplicate: true as const, dealId };

    // Mensagem da Casa mais antiga que a espera atual (chegou atrasada no webhook): só entra na conversa.
    // A cliente escreveu depois dela, então continua esperando resposta.
    const stale = !!deal.awaitingReplySince && at < deal.awaitingReplySince;
    if (input.automated || stale) {
      await tx.update(deals).set({ lastOutboundAt: sql`greatest(${deals.lastOutboundAt}, ${at.toISOString()}::timestamptz)` }).where(eq(deals.id, dealId));
      await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, ...(input.automated ? { automatica: true } : { atrasada: true }) }, null);
      return { dealId, messageId: msg.id, warned: false };
    }
    // Quem respondeu: pelo celular, quem assinou; sem assinatura (áudio, foto), conta para a dona.
    const responder = input.fromPhone ? (signer?.id ?? deal.ownerId ?? input.userId ?? null) : (input.userId ?? deal.ownerId ?? null);
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    if (deal.awaitingReplySince) {
      // Tempo de resposta conta só o expediente: mensagem das 23h respondida às 8h não é "9 horas de atraso".
      const waited = businessSecondsBetween(deal.awaitingReplySince.getTime(), at.getTime(), await getBusinessHours(tx));
      await logEvent(tx, dealId, "resposta", {
        waitedSeconds: waited, first: !deal.firstResponseAt, fromPhone: !!input.fromPhone,
        stage: stage?.key ?? null, slaSeconds: stage?.slaMinutes ? stage.slaMinutes * 60 : null,
      }, responder);
    }
    await tx.update(deals).set({
      lastOutboundAt: at, awaitingReplySince: null, conversationArchivedAt: null, // a Casa escreveu: a conversa arquivada volta
      firstResponseAt: deal.firstResponseAt ?? (deal.awaitingReplySince ? at : null),
      ownerId: deal.ownerId ?? input.userId ?? signerOwner ?? null,
      ...(authorId ? { lastReplyById: authorId, lastReplyVia: sentVia } : {}),
    }).where(eq(deals.id, dealId));
    if (!deal.ownerId && !input.userId && signerOwner) await logEvent(tx, dealId, "assumiu", { de: null, para: signerOwner, motivo: "assinatura" }, signerOwner);
    let warned = false;
    if (authorId && deal.ownerId && authorId !== deal.ownerId) warned = await warnOwnerRepliedByOther(tx, { dealId, ownerId: deal.ownerId, authorId, at });
    await logEvent(tx, dealId, "mensagem_enviada", { messageId: msg.id, fromPhone: !!input.fromPhone }, authorId);
    // Respondeu: os alertas de espera deste lead se resolvem sozinhos.
    const resolvedNow = new Date(); // hora real da resolução (a mensagem pode ter chegado atrasada)
    await tx.update(alerts).set({ resolvedAt: resolvedNow, readAt: sql`coalesce(${alerts.readAt}, ${resolvedNow.toISOString()}::timestamptz)` })
      .where(and(sql`${alerts.resolvedAt} is null`, or(
        // alertas de espera deste lead (wait_key = "<dealId>:<desde>") e, por compatibilidade, os anteriores à chave
        // (lembretes de tarefa, wait_key "task:<id>", não são espera: só se resolvem ao concluir a tarefa — mesma regra de `lateWhere`)
        and(eq(alerts.dealId, dealId), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")),
        and(eq(alerts.dealId, dealId), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.waitKey)),
      )));

    if (stage?.kind === "lead") await moveDealTx(tx, dealId, "atendimento", input.userId ?? null, "respondido", at);
    return { dealId, messageId: msg.id, warned };
  });
  if ("messageId" in result) await emit("mensagem_enviada", { dealId: result.dealId });
  if ("warned" in result && result.warned) await emit("alerta", { dealId: result.dealId });
  return result;
}
```

- [ ] **Step 5: Autoria no histórico do WhatsApp (`importHistoryChat`)**

Dentro de `db.transaction(async (tx) => {` em `importHistoryChat`, como primeiras linhas:

```ts
    const sigs = await signatureMap(tx);
    /** Quem assinou a mensagem da Casa no histórico (ou null). */
    const signer = (m: HistoryMessage) => { const s = m.fromMe ? parseSignature(m.body) : null; return s ? sigs.get(signatureKey(s)) ?? null : null; };
    const lastSigner = [...outbound].reverse().map(signer).find((s) => s !== null) ?? null;
```

No `tx.insert(deals).values({...})` do lead novo, trocar `ownerId: await pickOwner(tx)` e acrescentar a última resposta:

```ts
        contactId: contact.id, stageId: stage.id, ownerId: (lastSigner?.active ? lastSigner.id : null) ?? await pickOwner(tx), channelId, origin, sourceLabel: detectSource({ body: inbound[0]?.body }),
        stageEnteredAt: now, createdAt: msgs[0].at, lastInboundAt: lastIn, lastOutboundAt: lastOut, awaitingReplySince: waitingSince,
        lastReplyById: lastSigner?.id ?? null, lastReplyVia: lastSigner ? "celular" : null,
```

No `msgs.map((m) => ({...}))`, acrescentar ao objeto:

```ts
      sentByUserId: signer(m)?.id ?? null, sentVia: m.fromMe ? ("celular" as const) : null,
```

- [ ] **Step 6: Texto do histórico**

Em `src/lib/history.ts`, trocar a linha do case `"assumiu"` por:

```ts
    case "assumiu":
      if (p.motivo === "assinatura") return one(`Virou a dona: respondeu assinando pelo celular${p.migracao ? " (acerto das conversas antigas)" : ""}`);
      return one(p.porOferta ? "Assumiu o lead pela oferta" : "Assumiu o lead");
```

- [ ] **Step 7: Rodar e ver passar, sem quebrar o resto**

Run: `npx vitest run src/server/domain/authorship.test.ts src/lib/history.test.ts src/server/domain/deals.test.ts src/server/domain/lid-merge.test.ts src/server/whatsapp/webhook.test.ts src/server/audit-gaps.test.ts src/server/domain/presence.test.ts`
Expected: PASS em todos

- [ ] **Step 8: Commit**

```bash
git add src/server/domain/authorship.ts src/server/domain/authorship.test.ts src/server/domain/deals.ts src/lib/history.ts src/lib/history.test.ts
git commit -m "feat(1A): autora pela assinatura e dona automática (também para a gestão)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A4: Envio pelo CRM assinado e "visto" só da dona

**Files:**
- Modify: `src/server/domain/send.ts`:
  - `sendFromCrm`, linhas 79–103;
  - `sendMediaFromCrm`, linhas 133–173;
  - `absorbEcho`, linhas 200–213;
  - `markConversationRead`, linhas 226–248.
- Test: `src/server/domain/send-media.test.ts`

**Interfaces:**
- Consumes:
  - A1: `signBody`.
  - A2: `users.signature`, `messages.sentVia`.
  - A3: `recordOutbound` grava `sentVia = "crm"` quando há `userId`.
- Produces:
  - `markConversationRead(dealId: string, userId: string, opts?: { replying?: boolean }): Promise<void>`. Só manda o visto se `userId` for a dona do lead ou se `replying` for verdadeiro.
  - `sendFromCrm` e `sendMediaFromCrm` mandam o visto depois de confirmar o envio.
  - O texto enviado leva `*ASSINATURA - CASA FIAES:*\n` quando a pessoa tem assinatura cadastrada. Legenda de mídia vai sem assinatura.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/server/domain/send-media.test.ts`:
- trocar o import do schema por `import { alerts, channels, dealEvents, deals, messages, users } from "../db/schema";`;
- acrescentar no fim (o `echo` e o `outs` já existem no arquivo):

```ts
it("envio pelo CRM leva a assinatura de quem está logada na primeira linha", async () => {
  await db.update(users).set({ signature: "SARA" }).where(eq(users.id, uid));
  await sendFromCrm(dealId, "Oi, tudo bem?", uid);
  expect(calls).toContain("text:*SARA - CASA FIAES:*\nOi, tudo bem?:");
  expect((await outs())[0]).toMatchObject({ body: "*SARA - CASA FIAES:*\nOi, tudo bem?", sentByUserId: uid, sentVia: "crm", status: "sent" });
});
it("sem assinatura cadastrada vai o texto como está", async () => {
  await sendFromCrm(dealId, "Oi!", uid);
  expect(calls).toContain("text:Oi!:");
});
it("texto que já começa com assinatura não ganha outra", async () => {
  await db.update(users).set({ signature: "SARA" }).where(eq(users.id, uid));
  await sendFromCrm(dealId, "*SARA - CASA FIAES:*\nDe novo", uid);
  expect(calls).toContain("text:*SARA - CASA FIAES:*\nDe novo:");
});
it("visto azul ao abrir: só a dona; a gestão espiando não manda", async () => {
  const [g] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  await markConversationRead(dealId, g.id);
  expect(calls).toEqual([]);
  await markConversationRead(dealId, uid); // Ana é a dona (recebeu pela distribuição)
  expect(calls).toEqual(["read:IN1"]);
});
it("conversa sem dona: abrir não manda visto; responder manda", async () => {
  await db.update(deals).set({ ownerId: null }).where(eq(deals.id, dealId));
  await markConversationRead(dealId, uid);
  expect(calls).toEqual([]);
  await sendFromCrm(dealId, "Oi!", uid);
  expect(calls).toEqual(["text:Oi!:", "read:IN1"]);
});
it("eco do envio assinado pelo CRM chegando antes do retorno: uma linha só, autora a pessoa logada, por onde = CRM e nenhum aviso", async () => {
  await db.update(users).set({ signature: "ANA" }).where(eq(users.id, uid));
  const origin = fake.sendText;
  fake.sendText = async (...a: Parameters<typeof origin>) => { const r = await origin(...a); await echo("OUT1", { conversation: a[2] }); return r; };
  try { await sendFromCrm(dealId, "Oi!", uid); } finally { fake.sendText = origin; }
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT1", body: "*ANA - CASA FIAES:*\nOi!", sentByUserId: uid, sentVia: "crm", status: "sent" });
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(d).toMatchObject({ lastReplyById: uid, lastReplyVia: "crm" });
  expect(await db.select().from(alerts).where(eq(alerts.type, "respondida_por_outra"))).toHaveLength(0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/domain/send-media.test.ts`
Expected: FAIL em cinco testes:
- "leva a assinatura": `calls` não contém o texto assinado;
- "texto que já começa": passa por acaso, porque o texto já vem assinado. Tudo bem;
- "gestão espiando": recebe `["read:IN1"]` em vez de `[]`;
- "sem dona": recebe `["read:IN1"]` na abertura;
- "eco do envio assinado": o corpo enviado não tem a assinatura e a linha fica com `sentVia` errado.

- [ ] **Step 3: Implementar**

Em `src/server/domain/send.ts`:

1. Imports:

```ts
import { channels, contacts, dealEvents, deals, messages, users } from "../db/schema";
import { signBody } from "@/lib/signature";
```

2. `sendFromCrm` inteira:

```ts
export async function sendFromCrm(dealId: string, text: string, userId: string, opts: { quoteMessageId?: string | null } = {}) {
  const typed = text.trim();
  if (!typed) throw new SendError("Escreva uma mensagem antes de enviar.");
  if (typed.length > 4000) throw new SendError("Mensagem muito longa (máximo 4.000 caracteres).");
  // A assinatura da pessoa logada vai na primeira linha, como no ChatGuru (as clientes já conhecem). Sem assinatura cadastrada, vai sem.
  const [me] = await db.select({ signature: users.signature }).from(users).where(eq(users.id, userId));
  const body = signBody(me?.signature, typed);
  const row = await loadTarget(dealId);
  const quote = await loadQuote(dealId, opts.quoteMessageId);
  const channel = await resolveChannel(dealId, row.deal);
  if (!channel) return recordOutbound({ dealId, channelId: null, body, userId, status: "simulado", quotedBody: quote?.text ?? null });

  const [pending] = await db.insert(messages).values({
    dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: "text", body, status: "pending", sentByUserId: userId, sentVia: "crm", quotedBody: quote?.text ?? null,
  }).returning({ id: messages.id });
  await emit("mensagem_enviando", { dealId });

  let externalId: string | null = null;
  try {
    ({ externalId } = await whatsapp().sendText(channel.instanceName, row.phone, body, quote ?? undefined));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(messages.id, pending.id));
    await emit("mensagem_falhou", { dealId });
    throw new SendError(`Não foi possível enviar: ${msg}`);
  }
  const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, body, userId });
  // Respondeu: agora sim a cliente vê o visto azul (abrir sem responder só manda visto quando é a dona).
  await markConversationRead(dealId, userId, { replying: true });
  return res;
}
```

3. Em `sendMediaFromCrm`:
   - no `db.insert(messages).values({...})` da linha pendente, acrescentar `sentVia: "crm",` logo depois de `sentByUserId: userId,`;
   - trocar a última linha `return confirmSent(...)` por:

```ts
  const res = await confirmSent(pending.id, { dealId, channelId: channel.id, externalId, userId });
  await markConversationRead(dealId, userId, { replying: true });
  return res;
```

4. Em `absorbEcho`, no `tx.update(messages).set({...})`, acrescentar `sentVia: p.sentVia,` depois de `sentByUserId: p.sentByUserId,`.

5. `markConversationRead`: trocar a assinatura e o comentário, e acrescentar a guarda logo depois de `const row = await loadTarget(dealId);`:

```ts
/**
 * Visto azul: marca como lidas, no WhatsApp, as mensagens recebidas desde a última vez que a conversa foi aberta.
 * Só quando quem abre é a dona da conversa, ou quando alguém responde (`replying`): a gestão espiando não avisa a cliente que foi lida.
 * O ponto de leitura fica no evento `lido`. Nunca lança: se a Evolution estiver fora do ar, tenta de novo na próxima abertura.
 */
export async function markConversationRead(dealId: string, userId: string, opts: { replying?: boolean } = {}): Promise<void> {
  try {
    const p = whatsapp();
    if (!p.markRead) return;
    const row = await loadTarget(dealId);
    if (!opts.replying && row.deal.ownerId !== userId) return;
```

O resto da função fica igual.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/domain/send-media.test.ts src/server/audit-gaps.test.ts src/server/whatsapp/numero-real.test.ts src/server/domain/tasks.test.ts src/server/domain/lid.test.ts`
Expected: PASS. Se o teste do eco falhar porque a linha do eco ficou separada da pendente, conferir em `absorbEcho` se o eco foi gravado com o mesmo `channelId` (`rec`) e o mesmo `externalId` (`OUT1`); a correção é na fusão, nunca no teste.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/send.ts src/server/domain/send-media.test.ts
git commit -m "feat(1A): envio pelo CRM com a assinatura de quem está logada; visto só da dona ou ao responder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A5: Balão com o nome de quem enviou

**Files:**
- Create: `src/lib/authorship.ts`
- Test: `src/lib/authorship.test.ts`
- Create: `src/server/queries/team-name.ts`
- Modify: `src/server/queries/deal.ts`, linha 43 (`sender`)
- Modify: `src/components/lead/conversation.tsx`:
  - tipo `Msg`, linha 8;
  - `sameMsg`, linhas 40–42;
  - corpo do balão, linhas 62–70;
  - rodapé, linha 77;
  - `withDays`, linha 101.
- Modify: `src/components/queue/conversation-pane.tsx`, linha 141 (o `lastMessageOf`, linhas 29–32, muda só na A6)
- Modify: `src/components/lead/lead-sheet.tsx`, linha 214
- Test: `src/components/lead/conversation.test.tsx`

**Interfaces:**
- Consumes:
  - A1: `parseSignature`, `signatureDisplayName`, `stripSignature`.
  - A2: `messages.sentVia`, `users.signature`.
- Produces:
  - Em `src/lib/authorship.ts`:
    - `firstName(name): string | null` (o único `firstName` de nomes da equipe e de clientes; a B2 reexporta)
    - `teamShortName(u: { name: string; signature?: string | null }): string`
    - `outMeta(m: { fromPhone: boolean; sentVia?: string | null; sender: string | null; body?: string | null }): string`
    - `lastMessagePrefix(direction: "in" | "out" | null, authorName?: string | null, body?: string | null): string | null`
    - `ownerLine(owner?: string | null, repliedBy?: string | null): string`
    - `conversationWith(ownerName?: string | null): string`
  - Em `src/server/queries/team-name.ts`:
    - `teamNameCol(): SQL<string | null>`, para quando `users` já está juntado;
    - `teamNameOf(id: AnyPgColumn | SQL): SQL<string | null>`.
    - Os dois devolvem a assinatura em "Cati" ou, sem ela, o nome cadastrado.
  - `Msg.sentVia?: "celular" | "crm" | null`.

- [ ] **Step 1: Teste do módulo puro que falha**

```ts
// src/lib/authorship.test.ts
import { describe, expect, it } from "vitest";
import { conversationWith, firstName, lastMessagePrefix, outMeta, ownerLine, teamShortName } from "./authorship";

describe("nomes de quem atende", () => {
  it("primeiro nome e nome da equipe (assinatura primeiro)", () => {
    expect(firstName("Daniela Rezende")).toBe("Sara");
    expect(firstName("  ")).toBeNull();
    expect(teamShortName({ name: "Natália Campos", signature: "CATI" })).toBe("Cati");
    expect(teamShortName({ name: "Joaquim Salles", signature: null })).toBe("Joaquim");
  });
});

describe("outMeta (rodapé do balão da Casa)", () => {
  it("nome e por onde saiu", () => {
    expect(outMeta({ fromPhone: true, sentVia: "celular", sender: "Cati" })).toBe("Cati · pelo celular · ");
    expect(outMeta({ fromPhone: false, sentVia: "crm", sender: "Daniela Rezende" })).toBe("Sara · ");
    expect(outMeta({ fromPhone: true, sender: null, body: "*MARIA JOSÉ - CASA FIAES:*\nOi" })).toBe("Maria José · pelo celular · ");
    expect(outMeta({ fromPhone: true, sender: null, body: "Oi" })).toBe("pelo celular · ");
    expect(outMeta({ fromPhone: false, sender: null, body: "Lembrete" })).toBe("automática · ");
  });
});

describe("Fila e Quadro", () => {
  it("prefixo da última mensagem: quem escreveu, ou Casa", () => {
    expect(lastMessagePrefix("in", "Sara")).toBeNull();
    expect(lastMessagePrefix("out", "Cati")).toBe("Cati: ");
    expect(lastMessagePrefix("out", null, "*SARA - CASA FIAES:*\nOi")).toBe("Sara: ");
    expect(lastMessagePrefix("out", null, "Lembrete")).toBe("Casa: ");
  });
  it("linha da dona", () => {
    expect(ownerLine("Daniela Rezende", null)).toBe("Sara");
    expect(ownerLine("Sara", "Cati")).toBe("Dona: Sara · respondida por Cati");
    expect(ownerLine(null, null)).toBe("Sem dono");
    expect(ownerLine(null, "Cati")).toBe("Sem dono · respondida por Cati");
  });
  it("agenda: com quem está a conversa", () => {
    expect(conversationWith("Daniela Rezende")).toBe("Conversa com: Sara");
    expect(conversationWith(null)).toBe("Conversa sem dono");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/authorship.test.ts`
Expected: FAIL com `Failed to resolve import "./authorship"`

- [ ] **Step 3: Implementar o módulo puro e o SQL do nome**

```ts
// src/lib/authorship.ts
import { parseSignature, signatureDisplayName } from "./signature";

/** "Daniela Rezende" → "Sara". */
export const firstName = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;

/** Como a equipe se chama: pela assinatura ("CATI" → "Cati"); sem assinatura, o primeiro nome. */
export const teamShortName = (u: { name: string; signature?: string | null }): string =>
  signatureDisplayName(u.signature ?? null) ?? firstName(u.name) ?? u.name;

/** Rodapé do balão da Casa: "Cati · pelo celular · ", "Sara · " (pelo CRM), "pelo celular · " (sem assinatura) ou "automática · ". */
export function outMeta(m: { fromPhone: boolean; sentVia?: string | null; sender: string | null; body?: string | null }): string {
  const name = firstName(m.sender) ?? signatureDisplayName(parseSignature(m.body));
  const phone = m.sentVia ? m.sentVia === "celular" : m.fromPhone;
  if (phone) return name ? `${name} · pelo celular · ` : "pelo celular · ";
  return name ? `${name} · ` : "automática · ";
}

/** Antes da última mensagem na Fila e no Quadro: "Sara: ", "Cati: " ou "Casa: " (automática ou sem assinatura). Mensagem da cliente: nada. */
export function lastMessagePrefix(direction: "in" | "out" | null, authorName?: string | null, body?: string | null): string | null {
  if (direction !== "out") return null;
  return `${firstName(authorName) ?? signatureDisplayName(parseSignature(body)) ?? "Casa"}: `;
}

/** Linha da dona: "Sara", "Dona: Sara · respondida por Cati", "Sem dono" ou "Sem dono · respondida por Cati". `repliedBy` só vem quando não é a dona. */
export function ownerLine(owner?: string | null, repliedBy?: string | null): string {
  const o = firstName(owner), r = firstName(repliedBy);
  if (!o) return r ? `Sem dono · respondida por ${r}` : "Sem dono";
  return r ? `Dona: ${o} · respondida por ${r}` : o;
}

/** Agenda: com quem está a conversa do horário (não confundir com a profissional que atende). */
export const conversationWith = (ownerName?: string | null): string => {
  const n = firstName(ownerName);
  return n ? `Conversa com: ${n}` : "Conversa sem dono";
};
```

```ts
// src/server/queries/team-name.ts
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "../db/schema";

/** Como a equipe se chama, para consultas que já juntam `users`: a assinatura ("CATI" → "Cati"); sem ela, o nome cadastrado. */
export const teamNameCol = () => sql<string | null>`coalesce(initcap(lower(${users.signature})), ${users.name})`;

/** O mesmo, buscando a pessoa pelo id (coluna ou trecho SQL): para quem não junta `users`. */
export const teamNameOf = (id: AnyPgColumn | SQL) =>
  sql<string | null>`(select coalesce(initcap(lower(tn.signature)), tn.name) from users tn where tn.id = ${id})`;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/authorship.test.ts`
Expected: PASS

- [ ] **Step 5: Teste do balão que falha**

Em `src/components/lead/conversation.test.tsx`, no fim:

```tsx
describe("quem enviou", () => {
  it("balão da Casa mostra nome e por onde saiu, sem repetir a assinatura no texto", () => {
    render(<Conversation onReply={() => {}} messages={[
      msg({ id: "a", direction: "out", status: "sent", fromPhone: true, sentVia: "celular", sender: "Cati", body: "*CATI - CASA FIAES:*\nConfirmado!" }),
      msg({ id: "b", direction: "out", status: "sent", fromPhone: false, sentVia: "crm", sender: "Daniela Rezende", body: "*SARA - CASA FIAES:*\nOi" }),
      msg({ id: "c", direction: "out", status: "sent", fromPhone: true, sender: null, body: "*MARIA - CASA FIAES:*\nOlá" }),
      msg({ id: "d", direction: "out", status: "sent", fromPhone: false, sender: null, body: "Lembrete" }),
    ]} />);
    expect(screen.getByText("Confirmado!")).toBeTruthy();
    expect(screen.queryByText(/CASA FIAES/)).toBeNull();
    expect(screen.getByText(/Cati · pelo celular ·/)).toBeTruthy();
    expect(screen.getByText(/Sara · \d/)).toBeTruthy();
    expect(screen.getByText(/Maria · pelo celular ·/)).toBeTruthy();
    expect(screen.getByText(/automática ·/)).toBeTruthy();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/components/lead/conversation.test.tsx`
Expected: FAIL. `queryByText(/CASA FIAES/)` encontra o texto, e não existe nenhum elemento com "Cati · pelo celular ·".

- [ ] **Step 7: Implementar no balão e nos mapeamentos**

Em `src/components/lead/conversation.tsx`:

1. Imports:

```tsx
import { outMeta } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
```

2. No tipo `Msg`, depois de `fromPhone: boolean;`:

```tsx
  /** Por onde saiu a mensagem da Casa ("celular" | "crm"); ausente nas antigas, que usam `fromPhone`. */ sentVia?: "celular" | "crm" | null;
```

3. Em `sameMsg`, acrescentar `&& a.sentVia === b.sentVia` antes de `&& a.direction === b.direction`.

4. No corpo do `Bubble`, logo depois de `const out = ...`:

```tsx
  // A assinatura "*SARA - CASA FIAES:*" vira o nome no rodapé; no texto ela some.
  const text = out ? stripSignature(m.body) : m.body;
```

e nos dois lugares que mostram o texto:
- trocar `{m.body && m.kind !== "document" && <span className="block whitespace-pre-wrap break-words">{m.body}</span>}` por `{text && m.kind !== "document" && <span className="block whitespace-pre-wrap break-words">{text}</span>}`;
- trocar `<span className="whitespace-pre-wrap break-words">{m.body}</span>` por `<span className="whitespace-pre-wrap break-words">{text}</span>`.

5. Rodapé (linha 77): trocar a linha inteira por:

```tsx
            {out && outMeta(m)}
```

6. Em `withDays` (linha 101), acrescentar `&& (prev.sentVia ?? null) === (m.sentVia ?? null)` depois de `prev.fromPhone === m.fromPhone`.

Em `src/components/queue/conversation-pane.tsx`, no map da linha 141, acrescentar `sentVia: m.sentVia,` depois de `fromPhone: m.fromPhone,`. O `lastMessageOf` (linhas 29–32) fica com `sender: null` até a A6 criar o campo `lastAuthorName`.

Em `src/components/lead/lead-sheet.tsx`, linha 214: acrescentar `sentVia: m.sentVia,` depois de `fromPhone: m.fromPhone,`.

Em `src/server/queries/deal.ts`:
- import `import { teamNameCol } from "./team-name";`;
- na consulta das mensagens (linha 43), trocar `sender: users.name` por `sender: teamNameCol()`. O balão mostra "Cati", não "Caticilene".

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/components/lead/conversation.test.tsx src/components/lead/conversation-rows.test.ts src/server/queries/deal-sheet.test.ts && npm run typecheck`
Expected: PASS e `tsc` sem erros

- [ ] **Step 9: Commit**

```bash
git add src/lib/authorship.ts src/lib/authorship.test.ts src/server/queries/team-name.ts src/server/queries/deal.ts src/components/lead/conversation.tsx src/components/lead/conversation.test.tsx src/components/queue/conversation-pane.tsx src/components/lead/lead-sheet.tsx
git commit -m "feat(1A): balão mostra quem enviou (Cati · pelo celular) e esconde a assinatura do texto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A6: Fila, Quadro e painel: "Cati:" no lugar de "Você:" e "respondida por"

**Files:**
- Modify: `src/server/queries/queue.ts`:
  - `QueueItem`, linhas 16–29;
  - `Light` e `lightRows`, linhas 85–108;
  - `details`, linhas 111–123;
  - montagem dos itens, linhas 371–379 e 410–415.
- Modify: `src/server/queries/board.ts`:
  - `BoardCard`, linhas 14–20;
  - select e montagem, linhas 72–97.
- Modify: `src/server/queries/deal.ts` (select do `row`, linha 36)
- Modify: `src/components/queue/queue-item.tsx`, linhas 132–184
- Modify: `src/components/pipeline/deal-card.tsx`, linhas 27–50
- Modify: `src/components/queue/client-pane.tsx` (`Owner`, linhas 39–50)
- Modify: `src/components/queue/conversation-pane.tsx` (`lastMessageOf`, linhas 29–32)
- Test: `src/server/queries/queue.test.ts`, `src/server/queries/board.test.ts`, `src/components/queue/queue-item.render.test.tsx`

**Interfaces:**
- Consumes:
  - A2: `deals.lastReplyById`, `deals.lastReplyVia`.
  - A5: `teamNameCol`, `teamNameOf`, `lastMessagePrefix`, `ownerLine`, `firstName`.
  - A1: `stripSignature`.
- Produces:
  - `QueueItem` e `BoardCard` ganham campos opcionais (todos com nome da equipe):
    - `ownerShort?: string | null`
    - `lastAuthorName?: string | null`
    - `repliedByName?: string | null`, só quando quem respondeu por último não é a dona.
  - O tipo `Light` (interno de `queue.ts`) ganha `ownerShort`, `lastReplyById` e `lastReplyName`; o helper `repliedBy(r)` fica acima de `getQueue` (a B4 usa os dois).
  - O retorno de `getDealDetail` ganha `lastReplyName: string | null`.

- [ ] **Step 1: Testes que falham**

Em `src/server/queries/queue.test.ts`, no fim:

```ts
describe("quem respondeu", () => {
  it("traz quem escreveu a última mensagem e 'respondida por' quando não é a dona", async () => {
    const { ana, bia, gestora, lead } = await setup();
    await db.update(users).set({ signature: "BIBI" }).where(eq(users.id, bia.id));
    const d = await lead({ ownerId: ana.id, lastReplyById: bia.id, lastReplyVia: "celular" });
    await db.insert(messages).values({ dealId: d.id, contactId: d.contactId, direction: "out", body: "*BIBI - CASA FIAES:*\nOi", sentByUserId: bia.id, sentVia: "celular", fromPhone: true, createdAt: ago(1) });
    const own = await lead({ ownerId: ana.id, lastReplyById: ana.id, last: { direction: "out" } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    const items = q.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.dealId === d.id)).toMatchObject({ ownerShort: "Ana", lastAuthorName: "Bibi", repliedByName: "Bibi" });
    expect(items.find((i) => i.dealId === own.id)).toMatchObject({ lastAuthorName: null, repliedByName: null });
    expect(await getQueueItem(d.id)).toMatchObject({ lastAuthorName: "Bibi", repliedByName: "Bibi" });
  });
});
```

Em `src/server/queries/board.test.ts`:
- import do schema: `import { alerts, contacts, deals, messages, stages, users } from "../db/schema";`;
- dentro do `describe` existente:

```ts
  it("card traz quem escreveu por último e 'respondida por' quando não é a dona", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana Souza", email: "a2@c.com", role: "atendente", passwordHash: "x" }).returning();
    const [bia] = await db.insert(users).values({ name: "Bia Lima", email: "b2@c.com", role: "atendente", passwordHash: "x", signature: "BIA" }).returning();
    const [d] = await db.select().from(deals).where(eq(deals.id, calm));
    await db.update(deals).set({ ownerId: ana.id, lastReplyById: bia.id, lastReplyVia: "crm" }).where(eq(deals.id, calm));
    await db.insert(messages).values({ dealId: calm, contactId: d.contactId, direction: "out", body: "Oi", sentByUserId: bia.id, sentVia: "crm", createdAt: new Date() });
    const card = (await getBoard()).flatMap((s) => s.cards).find((c) => c.id === calm)!;
    expect(card).toMatchObject({ ownerName: "Ana Souza", ownerShort: "Ana Souza", lastAuthorName: "Bia", repliedByName: "Bia" });
  });
```

Em `src/components/queue/queue-item.render.test.tsx`, no fim:

```tsx
it("mostra quem respondeu no lugar de 'Você:' e 'Dona: … · respondida por …'", () => {
  const items: QueueItem[] = [{
    dealId: "1", contactId: "1", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 5,
    lastMessage: "*CATI - CASA FIAES:*\nConfirmado!", lastKind: "text", lastDirection: "out", lastAt: null, stageKey: "atendimento", stageName: "Atendimento",
    sourceLabel: "", ownerName: "Daniela Rezende", ownerShort: "Sara", lastAuthorName: "Cati", repliedByName: "Cati", signals: [], tags: [],
  }];
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items }]} /></HoursProvider>);
  expect(container.textContent).toContain("Cati: Confirmado!");
  expect(container.textContent).not.toContain("Você:");
  expect(container.textContent).not.toContain("CASA FIAES");
  expect(container.textContent).toContain("Dona: Sara · respondida por Cati");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/queries/queue.test.ts src/server/queries/board.test.ts src/components/queue/queue-item.render.test.tsx`
Expected: FAIL nos três testes novos: falta `ownerShort` e `lastAuthorName`, e a tela mostra "Você:".

- [ ] **Step 3: Fila no servidor (`src/server/queries/queue.ts`)**

1. Import: `import { teamNameCol, teamNameOf } from "./team-name";`

2. No tipo `QueueItem`, depois de `ownerName: string | null;`:

```ts
  /** Nome da equipe da dona ("Cati"), quem escreveu a última mensagem da Casa e quem respondeu por último quando não é a dona. */
  ownerShort?: string | null; lastAuthorName?: string | null; repliedByName?: string | null;
```

3. No tipo `Light`, acrescentar `ownerShort: string | null; lastReplyById: string | null; lastReplyName: string | null;`.

4. No `lightRows`, dentro do `db.select({...})`, depois de `ownerName: users.name,`:

```ts
    ownerShort: teamNameCol(), lastReplyById: deals.lastReplyById, lastReplyName: teamNameOf(deals.lastReplyById),
```

5. `details`:
   - trocar o tipo do `Map` vazio por `new Map<string, { hasAvatar: boolean; sourceLabel: string; lastMessage: string | null; lastKind: string | null; taskTitle: string | null; lastAuthorName: string | null }>()`;
   - no select, depois de `lastKind: sql<string | null>\`lm.kind\`,`, acrescentar `lastAuthorName: teamNameOf(sql\`lm.sent_by_user_id\`),`;
   - na lateral, trocar `select m.body, m.kind from messages m` por `select m.body, m.kind, m.sent_by_user_id from messages m`.

6. Logo acima de `export async function getQueue`, acrescentar o helper:

```ts
/** Quem respondeu por último, só quando não é a dona ("Dona: Sara · respondida por Cati"). */
const repliedBy = (r: Pick<Light, "ownerId" | "lastReplyById" | "lastReplyName">) => (r.lastReplyById && r.lastReplyById !== r.ownerId ? r.lastReplyName : null);
```

7. Nos dois lugares que montam o item (`getQueue` e `getQueueItem`), trocar `ownerName: r.ownerName,` por:

```ts
      ownerName: r.ownerName, ownerShort: r.ownerShort, lastAuthorName: d?.lastAuthorName ?? null, repliedByName: repliedBy(r),
```

- [ ] **Step 4: Quadro no servidor (`src/server/queries/board.ts`)**

1. Import: `import { teamNameCol, teamNameOf } from "./team-name";`

2. No `BoardCard`, depois de `ownerName: string | null;`:

```ts
  /** Nome da equipe da dona, quem escreveu a última mensagem da Casa e quem respondeu por último quando não é a dona. */
  ownerShort?: string | null; lastAuthorName?: string | null; repliedByName?: string | null;
```

3. No select, depois de `ownerName: users.name,`:

```ts
ownerShort: teamNameCol(), lastReplyById: deals.lastReplyById, lastReplyName: teamNameOf(deals.lastReplyById), lastAuthorName: teamNameOf(sql`lm.sent_by_user_id`),
```

4. Na lateral, trocar `select m.body, m.kind, m.created_at, m.direction from` por `select m.body, m.kind, m.created_at, m.direction, m.sent_by_user_id from`.

5. Trocar o corpo do `.map((r): BoardCard => {...})` por:

```ts
      cards: orderByUrgency(rows.filter((r) => r.stageId === s.id).map((r): BoardCard => {
        const { lastReplyById, lastReplyName, ...rest } = r;
        const waitSeconds = open && r.awaitingReplySince ? businessSecondsBetween(new Date(r.awaitingReplySince).getTime(), now.getTime(), hours) : 0;
        return {
          ...rest, awaitingReplySince: iso(r.awaitingReplySince), stageEnteredAt: r.stageEnteredAt.toISOString(),
          lastMessageAt: iso(r.lastMessageAt), scheduledAt: iso(r.scheduledAt), waitSeconds,
          valueCents: money ? r.valueCents : null,
          repliedByName: lastReplyById && lastReplyById !== r.ownerId ? lastReplyName : null,
          urgency: open ? boardUrgency({ late: lateIds.has(r.id), awaiting: !!r.awaitingReplySince, waitSeconds, slaMinutes: s.slaMinutes }) : "idle",
        };
      })),
```

- [ ] **Step 5: Detalhe da conversa (`src/server/queries/deal.ts`)**

1. Import: a A5 já importou `teamNameCol`; trocar por `import { teamNameCol, teamNameOf } from "./team-name";`.

2. No select do `row` (linha 36), depois de `ownerName: users.name,`:

```ts
lastReplyName: teamNameOf(deals.lastReplyById),
```

- [ ] **Step 6: Telas**

`src/components/queue/queue-item.tsx`:

1. Imports:

```tsx
import { lastMessagePrefix, ownerLine } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
```

2. Trocar a linha do `snippet` por:

```tsx
  const snippet = (item.lastMessage ? stripSignature(item.lastMessage) : "") || (item.lastKind ? KIND[item.lastKind] ?? null : null);
  const prefix = lastMessagePrefix(item.lastDirection, item.lastAuthorName, item.lastMessage);
```

3. Trocar `{item.lastDirection === "out" && <span className="text-muted">Você: </span>}{snippet}` por:

```tsx
            {prefix && <span className="text-muted">{prefix}</span>}{snippet}
```

4. Trocar o span da dona por:

```tsx
          <span className={item.ownerName ? "" : "text-gold-ink font-medium"}>{ownerLine(item.ownerShort ?? item.ownerName, item.repliedByName)}</span>
```

`src/components/pipeline/deal-card.tsx`:

1. Imports:

```tsx
import { lastMessagePrefix, ownerLine } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
```

2. Trocar a linha do `snippet` por:

```tsx
  const snippet = (card.lastMessage ? stripSignature(card.lastMessage) : "") || (card.lastMessageKind ? KIND[card.lastMessageKind] ?? null : null);
  const prefix = lastMessagePrefix(card.lastDirection, card.lastAuthorName, card.lastMessage);
```

3. No círculo de iniciais, trocar `title={card.ownerName}` por `title={\`Dona: ${card.ownerShort ?? card.ownerName}\`}`.

4. Trocar a linha de origem (linha 45) por:

```tsx
      <p className="text-xs text-muted mt-0.5 truncate">{card.origin}{card.isClient ? " · já é cliente" : ""}{card.repliedByName ? ` · ${ownerLine(card.ownerShort ?? card.ownerName, card.repliedByName)}` : ""}</p>
```

5. Trocar `{card.lastDirection === "out" && <span className="text-muted">Você: </span>}{snippet}` por:

```tsx
          {prefix && <span className="text-muted">{prefix}</span>}{snippet}
```

`src/components/queue/client-pane.tsx`:

1. Import: `import { firstName } from "@/lib/authorship";`

2. No `Owner`, logo depois do `<p data-testid="responsavel" ...>…</p>`:

```tsx
        {d.lastReplyName && d.deal.lastReplyById !== d.deal.ownerId && (
          <p data-testid="respondida-por" className="mt-0.5 text-xs text-graphite">Respondida por {firstName(d.lastReplyName)}{d.deal.lastReplyVia === "celular" ? " pelo celular" : " pelo CRM"}</p>
        )}
```

`src/components/queue/conversation-pane.tsx`: no `lastMessageOf` (linhas 29–32), trocar `sender: null` por `sender: item.lastAuthorName ?? null` (a prévia otimista mostra o nome de quem escreveu, como o balão).

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run src/server/queries/queue.test.ts src/server/queries/board.test.ts src/components/queue/queue-item.render.test.tsx src/server/queries/journey.test.ts src/server/queries/queue-signals.test.ts && npm run typecheck`
Expected: PASS e `tsc` sem erros

- [ ] **Step 8: Commit**

```bash
git add src/server/queries/queue.ts src/server/queries/board.ts src/server/queries/deal.ts src/components/queue/queue-item.tsx src/components/pipeline/deal-card.tsx src/components/queue/client-pane.tsx src/components/queue/conversation-pane.tsx src/server/queries/queue.test.ts src/server/queries/board.test.ts src/components/queue/queue-item.render.test.tsx
git commit -m "feat(1A): Fila, Quadro e painel mostram quem respondeu (Cati:) e 'Dona: Sara · respondida por Cati'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A7: Jornada com as iniciais da dona e Agenda "Conversa com: Sara"

**Files:**
- Modify: `src/server/queries/journey.ts` (`JourneyPerson`, linhas 14–21; subconsulta `top`, linhas 50–55; montagem, linhas 70–76)
- Modify: `src/components/journey/station.tsx` (`Person`, linhas 30–55)
- Modify: `src/server/queries/agenda.ts`, linha 33
- Modify: `src/components/agenda/agenda-board.tsx`, linhas 19–23
- Modify: `src/components/agenda/entry-sheet.tsx`, linha 76
- Test: `src/server/queries/journey.test.ts`, `src/components/agenda/agenda-board.test.tsx`

**Interfaces:**
- Consumes:
  - A5: `teamNameOf`, `teamNameCol`, `conversationWith`, `firstName`.
  - `initials` (de `src/lib/format.ts`).
- Produces:
  - `JourneyPerson.ownerName: string | null`, com o nome da equipe.
  - `JourneyPerson.ownerInitials: string | null`, com as iniciais do nome completo.
  - `AgendaItem.ownerName` passa a ser o nome da equipe.

- [ ] **Step 1: Testes que falham**

Em `src/server/queries/journey.test.ts`, dentro do `describe("getJourney")`:

```ts
  it("cada pessoa traz a dona: nome da equipe e iniciais", async () => {
    const [u] = await db.insert(users).values({ name: "Natália Campos", email: "c@c.com", role: "gestor", passwordHash: "x", signature: "CATI" }).returning();
    const a = await mk("atendimento", { owner: u.id }); const b = await mk("atendimento");
    const people = (await getJourney()).stations.find((s) => s.key === "atendimento")!.people;
    expect(people.find((p) => p.dealId === a.id)).toMatchObject({ ownerName: "Cati", ownerInitials: "CC" });
    expect(people.find((p) => p.dealId === b.id)).toMatchObject({ ownerName: null, ownerInitials: null });
  });
```

Em `src/components/agenda/agenda-board.test.tsx`, no fim:

```tsx
it("lead da agenda diz com quem está a conversa (não confunde com a profissional)", () => {
  render(<AgendaBoard view="dia" days={["2026-10-14"]} today="2026-10-13" nowMs={Date.UTC(2026, 9, 13, 12)} items={[
    base,
    { ...base, key: "lead:d2", dealId: "d2", name: "Sem Dona", ownerName: null, scheduledAt: at(10) },
  ]} />);
  expect(screen.getByText(/Conversa com: Ana/)).toBeTruthy();
  expect(screen.getByText(/Conversa sem dono/)).toBeTruthy();
  expect(screen.queryByText(/atende:/)).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/queries/journey.test.ts src/components/agenda/agenda-board.test.tsx`
Expected: FAIL. `ownerName` vem `undefined` na Jornada, e a Agenda não acha "Conversa com: Ana".

- [ ] **Step 3: Jornada**

Em `src/server/queries/journey.ts`:

1. Imports:

```ts
import { teamNameOf } from "./team-name";
import { initials } from "../../lib/format";
```

2. No tipo `JourneyPerson`, depois de `hasAvatar: boolean;`:

```ts
  /** A dona da conversa (nome da equipe, "Cati") e as iniciais do nome completo para o selo na foto; null quando é sem dono. */
  ownerName: string | null; ownerInitials: string | null;
```

3. Na subconsulta `top`, depois de `valueCents: deals.valueCents,`:

```ts
        ownerName: teamNameOf(deals.ownerId).as("owner_name"),
        ownerFull: sql<string | null>`(select ou.name from users ou where ou.id = ${deals.ownerId})`.as("owner_full"),
```

4. No `list.push({...})`, depois de `hasAvatar: r.hasAvatar,`:

```ts
 ownerName: r.ownerName ?? null, ownerInitials: r.ownerFull ? initials(r.ownerFull) : null,
```

Em `src/components/journey/station.tsx`:

1. Import: `import { firstName } from "@/lib/authorship";`

2. No `Person`, trocar a linha do `label` por:

```tsx
  const label = `${short}${short === p.name.trim() ? "" : ` (${p.name})`}, ${text}, ${p.ownerName ? `dona ${firstName(p.ownerName)}` : "sem dono"}`;
```

3. Logo depois do selo `{ring === "late" && …}`:

```tsx
          {p.ownerInitials && (
            <span aria-hidden title={`Dona: ${p.ownerName}`} className="absolute -bottom-0.5 -left-0.5 grid size-[24px] place-items-center rounded-full border-2 border-paper bg-paper-3 text-[10px] font-semibold leading-none text-graphite">{p.ownerInitials}</span>
          )}
```

- [ ] **Step 4: Agenda**

Em `src/server/queries/agenda.ts`:
- import `import { teamNameCol } from "./team-name";`;
- na linha 33, trocar `ownerName: users.name` por `ownerName: teamNameCol()`.

Em `src/components/agenda/agenda-board.tsx`:
- import `import { conversationWith } from "@/lib/authorship";`;
- na função `detail`, trocar `i.source === "lead" ? \`atende: ${first(i.ownerName) ?? "sem dono"}\` : null,` por:

```tsx
  i.source === "lead" ? conversationWith(i.ownerName) : null,
```

Em `src/components/agenda/entry-sheet.tsx`:
- import `import { firstName } from "@/lib/authorship";`;
- trocar a linha 76 por:

```tsx
            {i.source === "lead" && <Row k="Conversa com" v={firstName(i.ownerName) ?? "Ninguém (sem dono)"} muted={!i.ownerName} />}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/server/queries/journey.test.ts src/components/agenda/agenda-board.test.tsx src/server/queries/agenda.test.ts src/components/agenda/pro-grid.test.tsx && npm run typecheck`
Expected: PASS. O `agenda.test.ts` continua com "Ana" e "Bia", porque esses usuários não têm assinatura e `teamNameCol` devolve o nome cadastrado.

- [ ] **Step 6: Commit**

```bash
git add src/server/queries/journey.ts src/components/journey/station.tsx src/server/queries/agenda.ts src/components/agenda/agenda-board.tsx src/components/agenda/entry-sheet.tsx src/server/queries/journey.test.ts src/components/agenda/agenda-board.test.tsx
git commit -m "feat(1A): Jornada com as iniciais da dona; Agenda diz 'Conversa com: Sara'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A8: Painel "Equipe agora" (Fila e Hoje)

**Files:**
- Create: `src/lib/team-now.ts`
- Test: `src/lib/team-now.test.ts`
- Create: `src/server/queries/team-now.ts`
- Test: `src/server/queries/team-now.test.ts`
- Create: `src/components/team/team-now.tsx`
- Test: `src/components/team/team-now.test.tsx`
- Modify: `src/components/queue/queue-column.tsx` (props e topo)
- Modify: `src/app/(app)/atendimento/page.tsx`, `src/app/(app)/atendimento/[id]/page.tsx` e `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes:
  - A2: `messages.sentVia`, `users.signature`.
  - A3 e A4: `messages.sentByUserId` preenchido.
  - `queueHref` (de `src/lib/queue.ts`).
- Produces:
  - Em `src/lib/team-now.ts`:
    - `type TeamState = "respondendo" | "no_crm" | "pausa" | "sem_sinal"`
    - `TEAM_STATE_LABEL`, `REPLYING_WINDOW_MIN = 15`, `SEEN_WINDOW_MIN = 5`
    - `teamState(p, now): TeamState`
    - `lastReplyLabel(at, via, now): string`
  - Em `src/server/queries/team-now.ts`:
    - `type TeamMemberNow = { id; name; state; waiting; mine; lastReplyAt: string | null; lastReplyVia: "celular" | "crm" | null }`
    - `type TeamNow = { members: TeamMemberNow[]; unowned: { waiting: number; total: number } }`
    - `getTeamNow(now?: Date): Promise<TeamNow>`
  - Em `src/components/team/team-now.tsx`:
    - `TeamNowPanel({ team, now })`
    - `TeamNowStrip({ team, now })`
  - `QueueColumn` aceita `team?: TeamNow`.

- [ ] **Step 1: Teste do módulo puro que falha**

```ts
// src/lib/team-now.test.ts
import { describe, expect, it } from "vitest";
import { lastReplyLabel, teamState } from "./team-now";

const NOW = new Date("2026-10-15T15:00:00Z"); // 12:00 em Salvador
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("teamState", () => {
  it("pausa vale sobre tudo; resposta recente (até pelo celular) é 'respondendo'; batida recente é CRM aberto", () => {
    expect(teamState({ availability: "pausa", lastSeenAt: minAgo(1), lastReplyAt: minAgo(1) }, NOW)).toBe("pausa");
    expect(teamState({ availability: "ausente", lastSeenAt: null, lastReplyAt: minAgo(10) }, NOW)).toBe("respondendo");
    expect(teamState({ availability: "disponivel", lastSeenAt: minAgo(2), lastReplyAt: minAgo(20) }, NOW)).toBe("no_crm");
    expect(teamState({ availability: "ausente", lastSeenAt: minAgo(30), lastReplyAt: null }, NOW)).toBe("sem_sinal");
  });
});

describe("lastReplyLabel", () => {
  it("diz quando e por onde", () => {
    expect(lastReplyLabel(minAgo(4), "celular", NOW)).toBe("há 4 min, pelo celular");
    expect(lastReplyLabel(new Date(NOW.getTime() - 30_000), "crm", NOW)).toBe("agora, pelo CRM");
    expect(lastReplyLabel(new Date("2026-10-15T12:12:00Z"), "crm", NOW)).toBe("hoje 09:12, pelo CRM");
    expect(lastReplyLabel(new Date("2026-10-14T16:15:00Z"), "celular", NOW)).toBe("ontem 13:15, pelo celular");
    expect(lastReplyLabel(new Date("2026-10-12T20:40:00Z"), "crm", NOW)).toBe("12/10 17:40, pelo CRM");
    expect(lastReplyLabel(null, null, NOW)).toBe("nenhuma resposta nos últimos 7 dias");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/team-now.test.ts`
Expected: FAIL com `Failed to resolve import "./team-now"`

- [ ] **Step 3: Implementar o módulo puro**

```ts
// src/lib/team-now.ts
/** Estado de cada pessoa no painel "Equipe agora". A cor nunca vem sozinha: a tela sempre escreve o rótulo. */
export type TeamState = "respondendo" | "no_crm" | "pausa" | "sem_sinal";
export const TEAM_STATE_LABEL: Record<TeamState, string> = {
  respondendo: "Respondendo agora", no_crm: "Com o CRM aberto", pausa: "Em pausa", sem_sinal: "Sem atividade agora",
};
/** Respondeu há até isto (pelo CRM ou, pela assinatura, pelo celular): conta como "respondendo agora". */
export const REPLYING_WINDOW_MIN = 15;
/** O CRM aberto bate a cada minuto; sem batida há mais que isto, a pessoa não está com o CRM aberto (mesmo prazo da distribuição). */
export const SEEN_WINDOW_MIN = 5;

export function teamState(p: { availability: string; lastSeenAt: Date | string | null; lastReplyAt: Date | string | null }, now: Date): TeamState {
  const ago = (d: Date | string | null) => (d ? now.getTime() - new Date(d).getTime() : Infinity);
  if (p.availability === "pausa") return "pausa";
  if (ago(p.lastReplyAt) <= REPLYING_WINDOW_MIN * 60_000) return "respondendo";
  if (ago(p.lastSeenAt) <= SEEN_WINDOW_MIN * 60_000) return "no_crm";
  return "sem_sinal";
}

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" });
const DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/** "há 4 min, pelo celular", "hoje 09:12, pelo CRM", "ontem 13:15, pelo celular", "12/10 17:40, pelo CRM"; sem resposta: "nenhuma resposta nos últimos 7 dias". */
export function lastReplyLabel(at: Date | string | null, via: "celular" | "crm" | null, now: Date): string {
  if (!at) return "nenhuma resposta nos últimos 7 dias";
  const t = new Date(at);
  const min = Math.floor((now.getTime() - t.getTime()) / 60_000);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const when = min < 1 ? "agora" : min < 60 ? `há ${min} min`
    : DIA.format(t) === DIA.format(now) ? `hoje ${HORA.format(t)}`
    : DIA.format(t) === DIA.format(yesterday) ? `ontem ${HORA.format(t)}`
    : `${DATA.format(t)} ${HORA.format(t)}`;
  return via ? `${when}, ${via === "celular" ? "pelo celular" : "pelo CRM"}` : when;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/team-now.test.ts`
Expected: PASS

- [ ] **Step 5: Teste da consulta que falha**

```ts
// src/server/queries/team-now.test.ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getTeamNow } from "./team-now";

const NOW = new Date("2026-10-15T15:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
beforeEach(resetDb);

it("cada pessoa com estado, esperando, dela e a última resposta; quem não fez nada (e convite pendente) fica de fora", async () => {
  const [sara] = await db.insert(users).values({ name: "Daniela Rezende", email: "s@c.com", role: "atendente", passwordHash: "x", signature: "SARA", availability: "ausente" }).returning();
  const [cati] = await db.insert(users).values({ name: "Natália Campos", email: "c@c.com", role: "gestor", passwordHash: "x", signature: "CATI", availability: "disponivel", lastSeenAt: minAgo(2) }).returning();
  await db.insert(users).values({ name: "Joaquim", email: "j@c.com", role: "gestor", passwordHash: "x" });
  await db.insert(users).values({ name: "Convite", email: "v@c.com", role: "atendente", passwordHash: null, availability: "disponivel", lastSeenAt: minAgo(1) });
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  let n = 0;
  const mk = async (ownerId: string | null, awaiting: boolean, extra: { ignored?: boolean } = {}) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `C${n}`, phoneE164: `+5571999000${String(n).padStart(3, "0")}`, ignored: extra.ignored ?? false }).returning();
    return (await db.insert(deals).values({ contactId: c.id, stageId: lead.id, ownerId, awaitingReplySince: awaiting ? minAgo(5) : null }).returning())[0];
  };
  const d1 = await mk(sara.id, true); await mk(sara.id, false); await mk(sara.id, true, { ignored: true });
  await mk(null, true); await mk(null, false);
  await db.insert(messages).values({ dealId: d1.id, contactId: d1.contactId, direction: "out", body: "*SARA - CASA FIAES:*\nOi", sentByUserId: sara.id, sentVia: "celular", fromPhone: true, createdAt: minAgo(4) });

  const t = await getTeamNow(NOW);
  expect(t.members).toEqual([
    { id: sara.id, name: "Sara", state: "respondendo", waiting: 1, mine: 2, lastReplyAt: minAgo(4).toISOString(), lastReplyVia: "celular" },
    { id: cati.id, name: "Cati", state: "no_crm", waiting: 0, mine: 0, lastReplyAt: null, lastReplyVia: null },
  ]);
  expect(t.unowned).toEqual({ waiting: 1, total: 2 });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/server/queries/team-now.test.ts`
Expected: FAIL com `Failed to resolve import "./team-now"`

- [ ] **Step 7: Implementar a consulta**

```ts
// src/server/queries/team-now.ts
import { sql } from "drizzle-orm";
import { db } from "../db";
import { teamState, type TeamState } from "../../lib/team-now";

export type TeamMemberNow = { id: string; name: string; state: TeamState; waiting: number; mine: number; lastReplyAt: string | null; lastReplyVia: "celular" | "crm" | null };
export type TeamNow = { members: TeamMemberNow[]; unowned: { waiting: number; total: number } };

const REPLY_LOOKBACK_DAYS = 7;

/**
 * "Equipe agora" (Fila e Hoje): cada pessoa com o estado, quantas conversas esperam resposta dela, quantas são dela e a última resposta
 * (pelo CRM ou, pela assinatura, pelo celular). Fica de fora quem não tem conversa, não respondeu em 7 dias e não está com o CRM aberto.
 * As contagens são da equipe toda, não de quem vê: é o quadro da sala. Conversa encerrada, arquivada ou de contato ignorado não conta.
 */
export async function getTeamNow(now = new Date()): Promise<TeamNow> {
  const since = new Date(now.getTime() - REPLY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const open = sql`d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null and not c.ignored`;
  const [people, unowned] = await Promise.all([
    db.execute(sql`
      select u.id, coalesce(initcap(lower(u.signature)), u.name) as name, u.availability, u.last_seen_at,
        (select count(*)::int from deals d join contacts c on c.id = d.contact_id where d.owner_id = u.id and ${open}) as mine,
        (select count(*)::int from deals d join contacts c on c.id = d.contact_id where d.owner_id = u.id and ${open} and d.awaiting_reply_since is not null) as waiting,
        lr.created_at as last_reply_at, lr.via as last_reply_via
      from users u
      left join lateral (
        select m.created_at, coalesce(m.sent_via, case when m.from_phone then 'celular' else 'crm' end) as via
        from messages m
        where m.sent_by_user_id = u.id and m.direction = 'out' and m.created_at >= ${since}::timestamptz and m.created_at <= ${now.toISOString()}::timestamptz
        order by m.created_at desc limit 1) lr on true
      where u.active and u.password_hash is not null
      order by waiting desc, u.name`),
    db.execute(sql`
      select count(*)::int as total, (count(*) filter (where d.awaiting_reply_since is not null))::int as waiting
      from deals d join contacts c on c.id = d.contact_id where d.owner_id is null and ${open}`),
  ]);
  type Row = { id: string; name: string; availability: string; last_seen_at: Date | string | null; mine: number; waiting: number; last_reply_at: Date | string | null; last_reply_via: "celular" | "crm" | null };
  const members = (people.rows as Row[]).map((r): TeamMemberNow => ({
    id: r.id, name: r.name, mine: r.mine, waiting: r.waiting,
    state: teamState({ availability: r.availability, lastSeenAt: r.last_seen_at, lastReplyAt: r.last_reply_at }, now),
    lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at).toISOString() : null, lastReplyVia: r.last_reply_at ? r.last_reply_via : null,
  })).filter((m) => m.mine > 0 || m.lastReplyAt !== null || m.state !== "sem_sinal");
  const u = unowned.rows[0] as { total: number; waiting: number };
  return { members, unowned: { waiting: u.waiting, total: u.total } };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/server/queries/team-now.test.ts`
Expected: PASS

- [ ] **Step 9: Teste do componente que falha**

```tsx
// src/components/team/team-now.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamNowPanel, TeamNowStrip } from "./team-now";
import type { TeamNow } from "@/server/queries/team-now";

afterEach(cleanup);
const NOW = new Date("2026-10-15T15:00:00Z");
const team: TeamNow = {
  members: [{ id: "s", name: "Sara", state: "respondendo", waiting: 4, mine: 30, lastReplyAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(), lastReplyVia: "celular" }],
  unowned: { waiting: 1, total: 3 },
};

it("painel do Hoje escreve o estado, a última resposta, quantas esperam e leva aos sem dono", () => {
  render(<TeamNowPanel team={team} now={NOW} />);
  expect(screen.getByText("Respondendo agora", { exact: false })).toBeTruthy();
  expect(screen.getByText("Última resposta: há 4 min, pelo celular")).toBeTruthy();
  expect(screen.getByText("4 esperando")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Sem dono/ }).getAttribute("href")).toContain("view=sem-dono");
});

it("faixa da Fila resume numa linha", () => {
  render(<TeamNowStrip team={team} now={NOW} />);
  expect(screen.getByText("Sara 4 · sem dono 1")).toBeTruthy();
});
```

- [ ] **Step 10: Rodar e ver falhar**

Run: `npx vitest run src/components/team/team-now.test.tsx`
Expected: FAIL com `Failed to resolve import "./team-now"`

- [ ] **Step 11: Implementar o componente**

```tsx
// src/components/team/team-now.tsx
import Link from "next/link";
import type { TeamNow } from "@/server/queries/team-now";
import { lastReplyLabel, TEAM_STATE_LABEL, type TeamState } from "@/lib/team-now";
import { queueHref } from "@/lib/queue";
import { cn } from "@/lib/cn";

const DOT: Record<TeamState, string> = { respondendo: "bg-ok", no_crm: "bg-ok/50", pausa: "bg-gold", sem_sinal: "bg-line-strong" };

/** As linhas: nome, estado, última resposta (pelo CRM ou pelo celular), quantas esperam e quantas são dela; no fim, "Sem dono". */
function Rows({ team, now, compact = false }: { team: TeamNow; now: Date; compact?: boolean }) {
  const pad = compact ? "py-2" : "py-2.5";
  return (
    <ul className="divide-y divide-line/70">
      {team.members.map((m) => (
        <li key={m.id} className={cn("flex items-start justify-between gap-3", pad)}>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[m.state])} />{m.name}
              <span className="font-normal text-muted">· {TEAM_STATE_LABEL[m.state]}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">Última resposta: {lastReplyLabel(m.lastReplyAt, m.lastReplyVia, now)}</p>
          </div>
          <p className="shrink-0 text-right text-xs tabular text-graphite">
            <span className={m.waiting ? "font-semibold text-ink" : ""}>{m.waiting} esperando</span><br />{m.mine} {m.mine === 1 ? "conversa" : "conversas"} dela
          </p>
        </li>
      ))}
      <li className={pad}>
        <Link href={queueHref({ view: "sem-dono" })} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
          <span className={team.unowned.total ? "font-medium text-gold-ink" : "text-muted"}>Sem dono</span>
          <span className="text-xs tabular text-graphite">{team.unowned.waiting} esperando · {team.unowned.total} no total</span>
        </Link>
      </li>
    </ul>
  );
}

/** Hoje: o painel inteiro. */
export function TeamNowPanel({ team, now }: { team: TeamNow; now: Date }) {
  return (
    <section aria-labelledby="h-equipe" className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
      <h2 id="h-equipe" className="text-base font-semibold">Equipe agora</h2>
      <p className="mt-0.5 text-xs text-muted">Quem está respondendo (pelo CRM ou, pela assinatura, pelo celular) e quantas conversas esperam cada uma.</p>
      {team.members.length === 0 && <p className="mt-2 text-sm text-muted">Ninguém respondeu nos últimos 7 dias.</p>}
      <div className="mt-2"><Rows team={team} now={now} /></div>
    </section>
  );
}

/** Fila: uma linha que abre a lista ("Sara 4 · Cati 2 · sem dono 1"). Começa fechada para não roubar altura da lista. */
export function TeamNowStrip({ team, now }: { team: TeamNow; now: Date }) {
  const resumo = [...team.members.map((m) => `${m.name} ${m.waiting}`), `sem dono ${team.unowned.waiting}`].join(" · ");
  return (
    <details className="mt-1 text-sm">
      <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] px-2 text-graphite hover:bg-paper-2 lg:min-h-8">
        <span className="font-medium text-ink">Equipe agora</span><span className="truncate text-xs tabular">{resumo}</span>
      </summary>
      <p className="text-xs text-muted">O número ao lado de cada nome é quantas conversas esperam resposta dela.</p>
      <Rows team={team} now={now} compact />
    </details>
  );
}
```

- [ ] **Step 12: Ligar na Fila e no Hoje**

`src/components/queue/queue-column.tsx`:

1. Imports:

```tsx
import type { TeamNow } from "@/server/queries/team-now";
import { TeamNowStrip } from "@/components/team/team-now";
```

2. Props: acrescentar `team` na desestruturação e `/** "Equipe agora" no topo. */ team?: TeamNow;` no tipo.

3. Logo depois do `</div>` que fecha o bloco do `QueueSummary`/`SelectToggle`:

```tsx
        {team && <HideWhileSelecting><TeamNowStrip team={team} now={new Date()} /></HideWhileSelecting>}
```

`src/app/(app)/atendimento/page.tsx`:
- import `import { getTeamNow } from "@/server/queries/team-now";`;
- trocar o `Promise.all` por `const [queue, bulk, etapaName, team] = await Promise.all([getQueue(user, { view, foco, q, filtro, dono, etapa, fonte }), getBulkOptions(user), queueStageLabel(etapa), getTeamNow()]);`;
- trocar `<LiveRefresh scopes={["queue"]} />` por `<LiveRefresh scopes={["queue", "team"]} />`;
- passar `team={team}` no `<QueueColumn …/>`.

`src/app/(app)/atendimento/[id]/page.tsx`:
- import `import { getTeamNow } from "@/server/queries/team-now";`;
- trocar o `Promise.all` da linha 30 por `const [item, queue, banners, bulk, team] = await Promise.all([getQueueItem(id), withList ? getQueue(user, {}) : Promise.resolve(null), getShellBanners(), withList ? getBulkOptions(user) : Promise.resolve(null), withList ? getTeamNow() : Promise.resolve(undefined)]);`;
- `LiveRefresh` com `["queue", "team"]`;
- passar `team={team}` no `<QueueColumn …/>`.

`src/app/(app)/page.tsx` (Hoje):
- imports:

```tsx
import { getTeamNow } from "@/server/queries/team-now";
import { TeamNowPanel } from "@/components/team/team-now";
```

- trocar `const [t, summary] = await Promise.all([...])` por `const [t, summary, team] = await Promise.all([getToday(user, now), gestor ? dailySummaryText(user, now) : Promise.resolve(null), getTeamNow(now)]);`;
- trocar `<LiveRefresh scopes={["queue"]} />` por `<LiveRefresh scopes={["queue", "team"]} />`;
- na coluna da direita, como primeiro filho do `<div className="flex flex-col gap-5 min-w-0">` que tem o bloco "Agenda de hoje": `<TeamNowPanel team={team} now={now} />`.

- [ ] **Step 13: Rodar e ver passar**

Run: `npx vitest run src/lib/team-now.test.ts src/server/queries/team-now.test.ts src/components/team/team-now.test.tsx src/server/auth/guard-coverage.test.ts && npm run typecheck`
Expected: PASS e `tsc` sem erros

- [ ] **Step 14: Conferir na tela**

Run: `npm run dev`. Abrir `/` e `/atendimento` com o banco de desenvolvimento (navegador headless em segundo plano, sem tomar o foco).
Expected:
- O Hoje mostra "Equipe agora" no topo da coluna da direita.
- A Fila mostra a linha "Equipe agora · … · sem dono N" logo abaixo do resumo e abre ao clicar.
- No celular (390 px), a linha não estoura a largura.

- [ ] **Step 15: Commit**

```bash
git add src/lib/team-now.ts src/lib/team-now.test.ts src/server/queries/team-now.ts src/server/queries/team-now.test.ts src/components/team/ src/components/queue/queue-column.tsx "src/app/(app)/atendimento/page.tsx" "src/app/(app)/atendimento/[id]/page.tsx" "src/app/(app)/page.tsx"
git commit -m "feat(1A): painel Equipe agora na Fila e no Hoje

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A9: Script de acerto para trás (autoras dos últimos 30 dias e donas dos ~140 sem dono)

**Files:**
- Create: `src/server/domain/authorship-backfill.ts`
- Test: `src/server/domain/authorship-backfill.test.ts`
- Create: `scripts/autoria-assinaturas.ts`

**Interfaces:**
- Consumes:
  - A1: `parseSignature`, `signatureKey`.
  - A3: `signatureMap`, `sentViaOf`, `SentVia`.
  - A5: `teamShortName`.
  - `reassignWaitAlerts` e `logEvent`.
- Produces:
  - `type OwnerReplyRow = { dona: string; respondeu: string; conversas: number }`
  - `type BackfillPlan` com os campos `since`, `messages`, `unknownSignatures`, `owners`, `replies`, `before` e `after`.
  - `type BackfillBackup = { criadoEm; desde; mensagens; conversas }`
  - `planBackfill(opts: { days: number; now?: Date }): Promise<BackfillPlan>`, só leitura.
  - `applyBackfill(plan, writeBackup: (b: BackfillBackup) => Promise<void>, actorId?: string | null): Promise<{ messages: number; owners: number; replies: number }>`. Tudo numa transação, e o backup é gravado antes de qualquer UPDATE.
  - `restoreBackfill(b: BackfillBackup): Promise<{ messages: number; deals: number }>`
  - CLI `npx tsx scripts/autoria-assinaturas.ts --dry-run | --aplicar [--backup arq.json] | --desfazer arq.json [--dias 30]`.

**Regras do acerto:**
- **Mensagens.** Entram as da Casa dos últimos N dias e todas as das conversas abertas.
  - Sem autora e com assinatura conhecida: ganham autora.
  - Sem `sent_via`: ganham `"celular"` se `from_phone`, ou `"crm"` se têm autora. Automática fica null.
- **Dona.** Conversa aberta, sem dona e de contato não ignorado ganha dona quando a **última mensagem da Casa com autora** é de alguém ativo.
  - Áudio ou foto sem assinatura que veio depois não apaga essa assinatura.
  - Sem nenhuma assinatura, a conversa continua "Sem dono".
- **Idempotente.** Um segundo ensaio depois do acerto tem de vir vazio.
- **O que não faz.**
  - Não cria aviso e não mexe em etapa, então não dispara o motor.
  - Move só os alertas de espera nível 1 abertos para a nova dona (`reassignWaitAlerts`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/server/domain/authorship-backfill.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, messages, profiles, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyBackfill, planBackfill, restoreBackfill, type BackfillBackup } from "./authorship-backfill";

const NOW = new Date("2026-10-15T15:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
type U = typeof users.$inferSelect;
let sara: U, cati: U, n = 0;

const person = async (name: string, key: "atendente" | "gestao", signature: string) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, key));
  return (await db.insert(users).values({ name, email: `${name[0]}@c.com`, passwordHash: "x", role: key === "gestao" ? "gestor" : "atendente", profileId: p.id, signature }).returning())[0];
};
const conversa = async (o: { owner?: string | null; closed?: boolean } = {}) => {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+557199900${String(n).padStart(4, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, o.closed ? "fechado" : "atendimento"));
  return (await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId: o.owner ?? null, closedAt: o.closed ? ago(40) : null }).returning())[0];
};
const saiu = (d: { id: string; contactId: string }, body: string | null, at: Date, kind = "text") =>
  db.insert(messages).values({ dealId: d.id, contactId: d.contactId, direction: "out", body, kind, fromPhone: true, createdAt: at });
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

/** a: Sara assinou · b: Cati assinou e depois mandou áudio · c: sem assinatura · d: da Sara, Cati respondeu · e: nome desconhecido · f: fechada e antiga. */
async function cenario() {
  const a = await conversa(); await saiu(a, "*SARA - CASA FIAES:*\nOi", ago(1));
  const b = await conversa(); await saiu(b, "*CATI - CASA FIAES:*\nOi", ago(1)); await saiu(b, null, ago(0.5), "audio");
  const c = await conversa(); await saiu(c, "Oi, tudo bem?", ago(1));
  const d = await conversa({ owner: sara.id }); await saiu(d, "*CATI - CASA FIAES:*\nOi", ago(1));
  const e = await conversa(); await saiu(e, "*MARIA - CASA FIAES:*\nOi", ago(2));
  const f = await conversa({ closed: true }); await saiu(f, "*SARA - CASA FIAES:*\nOi", ago(40));
  return { a, b, c, d, e, f };
}

beforeEach(async () => {
  n = 0; await resetDb();
  sara = await person("Daniela Rezende", "atendente", "SARA");
  cati = await person("Natália Campos", "gestao", "CATI");
});

describe("acerto para trás pela assinatura", () => {
  it("ensaio: tabela dona × quem respondeu, antes e depois, sem gravar nada", async () => {
    const { a, b, d } = await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    expect(plan.before).toEqual([
      { dona: "Sara", respondeu: "Cati", conversas: 1 },
      { dona: "Sem dono", respondeu: "ninguém / sem assinatura", conversas: 2 },
      { dona: "Sem dono", respondeu: "Cati", conversas: 1 },
      { dona: "Sem dono", respondeu: "Sara", conversas: 1 },
    ]);
    expect(plan.after).toEqual([
      { dona: "Cati", respondeu: "Cati", conversas: 1 },
      { dona: "Sara", respondeu: "Cati", conversas: 1 },
      { dona: "Sara", respondeu: "Sara", conversas: 1 },
      { dona: "Sem dono", respondeu: "ninguém / sem assinatura", conversas: 2 },
    ]);
    expect(plan.owners).toHaveLength(2);
    expect(plan.owners).toEqual(expect.arrayContaining([{ dealId: a.id, ownerId: sara.id }, { dealId: b.id, ownerId: cati.id }]));
    expect(plan.replies.map((r) => r.dealId).sort()).toEqual([a.id, b.id, d.id].sort());
    expect(plan.unknownSignatures).toEqual({ MARIA: 1 });
    expect(plan.messages).toHaveLength(6); // a, b (2), c, d, e — a f fica fora (fechada e de 40 dias)
    expect(plan.messages.filter((m) => m.sentByUserId)).toHaveLength(3);
    expect(await db.select().from(deals).where(isNull(deals.ownerId))).toHaveLength(5); // nada mudou
  });

  it("aplicar: backup antes, donas e autoras gravadas, segundo ensaio vazio; desfazer volta tudo", async () => {
    const { a, b, c, d } = await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    let backup: BackfillBackup | null = null;
    expect(await applyBackfill(plan, async (bk) => { backup = bk; })).toEqual({ messages: 6, owners: 2, replies: 3 });
    expect((await deal(a.id)).ownerId).toBe(sara.id);
    expect(await deal(b.id)).toMatchObject({ ownerId: cati.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    expect(await deal(d.id)).toMatchObject({ ownerId: sara.id, lastReplyById: cati.id });
    expect((await deal(c.id)).ownerId).toBeNull();
    expect(backup!.conversas).toHaveLength(3);
    expect(backup!.mensagens).toHaveLength(6);
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.type, "assumiu"));
    expect(ev.map((e) => e.payload)).toEqual(expect.arrayContaining([expect.objectContaining({ motivo: "assinatura", migracao: true })]));
    const again = await planBackfill({ days: 30, now: NOW });
    expect([again.messages.length, again.owners.length, again.replies.length]).toEqual([0, 0, 0]);
    expect(again.before).toEqual(plan.after);

    expect(await restoreBackfill(backup!)).toEqual({ messages: 6, deals: 3 });
    expect((await deal(a.id)).ownerId).toBeNull();
    expect(await db.select().from(messages).where(isNotNull(messages.sentByUserId))).toHaveLength(0);
    expect(await db.select().from(dealEvents).where(eq(dealEvents.type, "assumiu"))).toHaveLength(0);
  });

  it("backup que falha ao gravar não aplica nada", async () => {
    await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    await expect(applyBackfill(plan, async () => { throw new Error("disco cheio"); })).rejects.toThrow("disco cheio");
    expect(await db.select().from(deals).where(isNotNull(deals.ownerId))).toHaveLength(1); // só a d, que já era da Sara
    expect(await db.select().from(messages).where(isNotNull(messages.sentVia))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/domain/authorship-backfill.test.ts`
Expected: FAIL com `Failed to resolve import "./authorship-backfill"`

- [ ] **Step 3: Implementar o domínio**

```ts
// src/server/domain/authorship-backfill.ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, dealEvents, deals, messages, users } from "../db/schema";
import { parseSignature, signatureKey } from "@/lib/signature";
import { teamShortName } from "@/lib/authorship";
import { sentViaOf, signatureMap, type SentVia } from "./authorship";
import { logEvent } from "./events";
import { reassignWaitAlerts } from "./wait-alerts";

export type OwnerReplyRow = { dona: string; respondeu: string; conversas: number };
export type BackfillPlan = {
  since: string;
  /** Mensagens da Casa que ganham autora (assinatura) e/ou o "por onde saiu". */
  messages: { id: string; sentByUserId: string | null; sentVia: SentVia | null; before: { sentByUserId: string | null; sentVia: string | null } }[];
  /** Assinaturas no formato certo que ninguém da equipe usa (nome → quantas mensagens): ficam sem autora. */
  unknownSignatures: Record<string, number>;
  /** Conversas abertas sem dona que ganham a dona pela última resposta com autora. */
  owners: { dealId: string; ownerId: string }[];
  /** Conversas abertas cujo "quem respondeu por último" muda. */
  replies: { dealId: string; lastReplyById: string; lastReplyVia: SentVia }[];
  /** Dona × quem respondeu por último (pela assinatura), antes e depois. */
  before: OwnerReplyRow[]; after: OwnerReplyRow[];
};
export type BackfillBackup = {
  criadoEm: string; desde: string;
  mensagens: { id: string; sentByUserId: string | null; sentVia: string | null }[];
  conversas: { id: string; ownerId: string | null; lastReplyById: string | null; lastReplyVia: string | null }[];
};

type MsgRow = { id: string; deal_id: string | null; body: string | null; from_phone: boolean; sent_via: string | null; sent_by_user_id: string | null };
const NONE = "ninguém / sem assinatura";

function table(m: Map<string, number>): OwnerReplyRow[] {
  return [...m].map(([k, conversas]) => { const [dona, respondeu] = k.split("\u0000"); return { dona, respondeu, conversas }; })
    .sort((a, b) => a.dona.localeCompare(b.dona, "pt-BR") || b.conversas - a.conversas || a.respondeu.localeCompare(b.respondeu, "pt-BR"));
}

/**
 * Ensaio (só leitura): quem assinou cada mensagem da Casa do período (e de todas as conversas abertas) e quem vira a dona.
 * A dona sai da ÚLTIMA mensagem da Casa com autora: áudio ou foto sem assinatura depois não apagam quem respondeu.
 */
export async function planBackfill(opts: { days: number; now?: Date }): Promise<BackfillPlan> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);
  const sigs = await signatureMap();
  const people = await db.select({ id: users.id, name: users.name, signature: users.signature, active: users.active }).from(users);
  const names = new Map(people.map((u) => [u.id, teamShortName(u)]));
  const active = new Set(people.filter((u) => u.active).map((u) => u.id));
  const rows = (await db.execute(sql`
    select m.id, m.deal_id, m.body, m.from_phone, m.sent_via, m.sent_by_user_id
    from messages m left join deals d on d.id = m.deal_id
    where m.direction = 'out'
      and (m.created_at >= ${since.toISOString()}::timestamptz or (d.id is not null and d.closed_at is null and d.archived_at is null))
    order by m.created_at desc, m.id desc`)).rows as MsgRow[];

  const unknown: Record<string, number> = {};
  const authorOf = new Map<string, string | null>();
  const viaOf = new Map<string, SentVia | null>();
  const msgs: BackfillPlan["messages"] = [];
  for (const r of rows) {
    const sig = r.sent_by_user_id ? null : parseSignature(r.body);
    const signer = sig ? sigs.get(signatureKey(sig)) ?? null : null;
    if (sig && !signer) unknown[sig] = (unknown[sig] ?? 0) + 1;
    const by = r.sent_by_user_id ?? signer?.id ?? null;
    const via = (r.sent_via as SentVia | null) ?? sentViaOf({ fromPhone: r.from_phone, authorId: by });
    authorOf.set(r.id, by); viaOf.set(r.id, via);
    if (by !== r.sent_by_user_id || via !== r.sent_via) msgs.push({ id: r.id, sentByUserId: by, sentVia: via, before: { sentByUserId: r.sent_by_user_id, sentVia: r.sent_via } });
  }

  // Última mensagem da Casa com autora, por conversa (as linhas vêm da mais nova para a mais antiga).
  const last = new Map<string, { by: string; via: SentVia }>();
  for (const r of rows) {
    const by = authorOf.get(r.id);
    if (!r.deal_id || last.has(r.deal_id) || !by) continue;
    last.set(r.deal_id, { by, via: viaOf.get(r.id) ?? "celular" });
  }

  const open = await db.select({ id: deals.id, ownerId: deals.ownerId, lastReplyById: deals.lastReplyById, lastReplyVia: deals.lastReplyVia })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), eq(contacts.ignored, false)));
  const owners: BackfillPlan["owners"] = [], replies: BackfillPlan["replies"] = [];
  const before = new Map<string, number>(), after = new Map<string, number>();
  const label = (id: string | null, none: string) => (id ? names.get(id) ?? "?" : none);
  const bump = (m: Map<string, number>, dona: string, resp: string) => { const k = `${dona}\u0000${resp}`; m.set(k, (m.get(k) ?? 0) + 1); };
  for (const d of open) {
    const l = last.get(d.id) ?? null;
    const newOwner = d.ownerId ?? (l && active.has(l.by) ? l.by : null);
    if (!d.ownerId && newOwner) owners.push({ dealId: d.id, ownerId: newOwner });
    if (l && (l.by !== d.lastReplyById || l.via !== d.lastReplyVia)) replies.push({ dealId: d.id, lastReplyById: l.by, lastReplyVia: l.via });
    bump(before, label(d.ownerId, "Sem dono"), label(l?.by ?? null, NONE));
    bump(after, label(newOwner, "Sem dono"), label(l?.by ?? null, NONE));
  }
  return { since: since.toISOString(), messages: msgs, unknownSignatures: unknown, owners, replies, before: table(before), after: table(after) };
}

const valuesOf = (rows: { id: string; uid: string | null; via: string | null }[]) =>
  sql.join(rows.map((r) => sql`(${r.id}::uuid, ${r.uid}::uuid, ${r.via}::text)`), sql`, `);

/**
 * Aplica o plano numa transação. `writeBackup` recebe os valores ATUAIS de tudo que vai mudar e roda antes de qualquer UPDATE:
 * se falhar, nada é gravado. Não cria aviso nem mexe em etapa (o motor não dispara); a dona nova recebe os alertas de espera abertos.
 */
export async function applyBackfill(plan: BackfillPlan, writeBackup: (b: BackfillBackup) => Promise<void>, actorId: string | null = null) {
  const msgIds = plan.messages.map((m) => m.id);
  const dealIds = [...new Set([...plan.owners.map((o) => o.dealId), ...plan.replies.map((r) => r.dealId)])];
  return db.transaction(async (tx) => {
    const curMsgs = msgIds.length ? await tx.select({ id: messages.id, sentByUserId: messages.sentByUserId, sentVia: messages.sentVia }).from(messages).where(inArray(messages.id, msgIds)) : [];
    const curDeals = dealIds.length ? await tx.select({ id: deals.id, ownerId: deals.ownerId, lastReplyById: deals.lastReplyById, lastReplyVia: deals.lastReplyVia }).from(deals).where(inArray(deals.id, dealIds)).for("update") : [];
    await writeBackup({ criadoEm: new Date().toISOString(), desde: plan.since, mensagens: curMsgs, conversas: curDeals });
    for (let i = 0; i < plan.messages.length; i += 500) {
      const chunk = plan.messages.slice(i, i + 500).map((m) => ({ id: m.id, uid: m.sentByUserId, via: m.sentVia }));
      await tx.execute(sql`update messages m set sent_by_user_id = v.uid, sent_via = v.via from (values ${valuesOf(chunk)}) as v(id, uid, via) where m.id = v.id`);
    }
    let owners = 0;
    for (const o of plan.owners) {
      // Só se continuar sem dona: alguém pode ter assumido entre o ensaio e agora.
      const hit = await tx.update(deals).set({ ownerId: o.ownerId }).where(and(eq(deals.id, o.dealId), isNull(deals.ownerId))).returning({ id: deals.id });
      if (!hit.length) continue;
      owners++;
      await reassignWaitAlerts(tx, o.dealId, o.ownerId);
      await logEvent(tx, o.dealId, "assumiu", { de: null, para: o.ownerId, motivo: "assinatura", migracao: true }, o.ownerId);
    }
    for (const r of plan.replies) await tx.update(deals).set({ lastReplyById: r.lastReplyById, lastReplyVia: r.lastReplyVia }).where(eq(deals.id, r.dealId));
    await tx.insert(auditLog).values({ userId: actorId, action: "autoria_assinaturas", entity: "deal", entityId: null,
      data: { mensagens: plan.messages.length, donas: owners, ultimasRespostas: plan.replies.length, desde: plan.since } });
    return { messages: plan.messages.length, owners, replies: plan.replies.length };
  });
}

/** Desfaz a partir do backup: volta autora, "por onde saiu", dona e última resposta, e apaga os eventos "assumiu" do acerto. */
export async function restoreBackfill(b: BackfillBackup): Promise<{ messages: number; deals: number }> {
  return db.transaction(async (tx) => {
    for (let i = 0; i < b.mensagens.length; i += 500) {
      const chunk = b.mensagens.slice(i, i + 500).map((m) => ({ id: m.id, uid: m.sentByUserId, via: m.sentVia }));
      await tx.execute(sql`update messages m set sent_by_user_id = v.uid, sent_via = v.via from (values ${valuesOf(chunk)}) as v(id, uid, via) where m.id = v.id`);
    }
    for (const d of b.conversas) {
      await tx.update(deals).set({ ownerId: d.ownerId, lastReplyById: d.lastReplyById, lastReplyVia: d.lastReplyVia as SentVia | null }).where(eq(deals.id, d.id));
    }
    const ids = b.conversas.map((d) => d.id);
    if (ids.length) await tx.delete(dealEvents).where(and(inArray(dealEvents.dealId, ids), eq(dealEvents.type, "assumiu"), sql`${dealEvents.payload}->>'migracao' = 'true'`));
    return { messages: b.mensagens.length, deals: b.conversas.length };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/domain/authorship-backfill.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Script de linha de comando**

```ts
// scripts/autoria-assinaturas.ts
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../src/server/db";
import { emit } from "../src/server/domain/events";
import { signatureMap } from "../src/server/domain/authorship";
import { applyBackfill, planBackfill, restoreBackfill, type BackfillBackup, type BackfillPlan, type OwnerReplyRow } from "../src/server/domain/authorship-backfill";

// Lote 1A: autora pela assinatura "*NOME - CASA FIAES:*" nas mensagens antigas e dona para as conversas abertas sem dona.
// No servidor: cd /opt/crm && sudo -u crm npx tsx scripts/autoria-assinaturas.ts <modo>
//   --dry-run [--dias 30]                      ensaio: imprime a tabela dona × quem respondeu, antes e depois; não grava nada
//   --aplicar [--dias 30] [--backup arq.json]  grava o backup JSON, aplica numa transação e confere (um segundo ensaio tem de vir vazio)
//   --desfazer arq.json                        volta autora, dona e última resposta ao que estava no backup
const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const value = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function printTable(title: string, rows: OwnerReplyRow[]) {
  console.log(`\n${title}`);
  const w1 = Math.max(4, ...rows.map((r) => r.dona.length)), w2 = Math.max(14, ...rows.map((r) => r.respondeu.length));
  console.log(`${"Dona".padEnd(w1)} | ${"Quem respondeu".padEnd(w2)} | Conversas`);
  for (const r of rows) console.log(`${r.dona.padEnd(w1)} | ${r.respondeu.padEnd(w2)} | ${r.conversas}`);
  console.log(`Sem dono: ${rows.filter((r) => r.dona === "Sem dono").reduce((a, r) => a + r.conversas, 0)}`);
}

function report(plan: BackfillPlan) {
  console.log(`Mensagens da Casa desde ${plan.since} e todas as das conversas abertas.`);
  console.log(`Mensagens que ganham autora: ${plan.messages.filter((m) => m.sentByUserId && m.sentByUserId !== m.before.sentByUserId).length}`);
  console.log(`Mensagens que ganham "por onde saiu": ${plan.messages.filter((m) => m.sentVia !== m.before.sentVia).length}`);
  console.log(`Conversas que ganham dona: ${plan.owners.length}`);
  console.log(`Conversas com "quem respondeu por último" atualizado: ${plan.replies.length}`);
  const unk = Object.entries(plan.unknownSignatures);
  if (unk.length) console.log(`Assinaturas que ninguém da equipe usa (ficam sem autora): ${unk.map(([k, n]) => `${k} (${n})`).join(", ")}`);
  printTable("ANTES: dona no CRM × quem respondeu por último (pela assinatura)", plan.before);
  printTable("DEPOIS", plan.after);
}

async function main() {
  if (flag("--desfazer")) {
    const file = value("--desfazer");
    if (!file) throw new Error("Informe o arquivo de backup: --desfazer <arquivo.json>");
    const b = JSON.parse(await readFile(file, "utf8")) as BackfillBackup;
    const r = await restoreBackfill(b);
    await emit("lead_atualizado", {});
    console.log(`Desfeito: ${r.messages} mensagens e ${r.deals} conversas voltaram ao backup de ${b.criadoEm}.`);
    return;
  }
  if (!flag("--dry-run") && !flag("--aplicar")) throw new Error("Use --dry-run (ensaio) ou --aplicar. Veja o cabeçalho do script.");
  const dias = Number(value("--dias") ?? 30);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error("--dias precisa ser um número inteiro de 1 a 365.");
  if ((await signatureMap()).size === 0) throw new Error("Ninguém tem assinatura cadastrada. Cadastre em Configurações › Equipe (ex.: SARA, CATI) antes.");
  const plan = await planBackfill({ days: dias });
  report(plan);
  if (flag("--dry-run")) { console.log("\nEnsaio: nada foi gravado."); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = value("--backup") ?? path.join(os.homedir(), "backups", `autoria-assinaturas-${stamp}-antes.json`);
  if (existsSync(file)) throw new Error(`O backup ${file} já existe. Escolha outro nome.`);
  await mkdir(path.dirname(file), { recursive: true });
  const res = await applyBackfill(plan, (b) => writeFile(file, JSON.stringify(b, null, 1), { flag: "wx" }));
  await emit("lead_atualizado", {});
  console.log(`\nBackup: ${file}`);
  console.log(`Aplicado: ${res.messages} mensagens, ${res.owners} donas, ${res.replies} últimas respostas.`);

  const check = await planBackfill({ days: dias });
  printTable("CONFERÊNCIA: como ficou agora", check.before);
  const same = JSON.stringify(check.before) === JSON.stringify(plan.after);
  const pend = check.messages.length + check.owners.length + check.replies.length;
  console.log(same ? "\nA tabela bate com o DEPOIS do ensaio." : "\nAtenção: a tabela não bate com o DEPOIS do ensaio (alguém mexeu durante a aplicação?).");
  if (pend) { console.log(`Ainda há ${pend} pendências. Rode --dry-run de novo.`); process.exitCode = 1; }
  else console.log("Conferência: nada pendente.");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Step 6: Ensaio local**

Run: `npx tsx scripts/autoria-assinaturas.ts --dry-run` (contra o banco de desenvolvimento).
Expected:
- sem assinaturas cadastradas, a mensagem "Ninguém tem assinatura cadastrada. Cadastre em Configurações › Equipe…" e saída 1;
- depois de cadastrar SARA em um usuário de desenvolvimento, as duas tabelas e "Ensaio: nada foi gravado.".

- [ ] **Step 7: Commit**

```bash
git add src/server/domain/authorship-backfill.ts src/server/domain/authorship-backfill.test.ts scripts/autoria-assinaturas.ts
git commit -m "feat(1A): script de acerto para trás (autoras e donas pela assinatura) com ensaio, backup e desfazer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa A10: Verificação do lote

**Files:** nenhum código novo. Só verificação. O roteiro de produção deste lote (assinaturas, ensaio, aplicar, conferir, desfazer) está na seção **Implantação**, passos I3 a I5.

**Interfaces:**
- Consumes: tudo de A1 a A9.
- Produces: o lote verificado.

- [ ] **Step 1: Suíte inteira, tipos, lint e build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: todos os testes passam, `tsc` e `eslint` sem erros, e `next build` termina com sucesso.

- [ ] **Step 2: Nenhum WhatsApp de verdade nos testes**

Run: `npx vitest run test/evolution-guard.test.ts`
Expected: PASS. A Evolution dos testes continua no endereço morto `http://127.0.0.1:9`.

- [ ] **Step 3: Conferência visual (dev)**

Run: `npm run dev` e abrir, com dados de desenvolvimento, uma conversa com mensagem assinada pelo simulador (`/dev/simulador`, "Enviada pela Casa pelo celular", texto `*SARA - CASA FIAES:*` + quebra de linha + `Oi`). Navegador headless em segundo plano.

Expected:
- **Balão:** "Sara · pelo celular · hh:mm", sem a assinatura no texto.
- **Fila:** "Sara: Oi" e a dona "Sara".
- **Quadro:** "Sara: Oi".
- **Jornada:** selo com as iniciais na foto.
- **Agenda:** um lead agendado mostra "Conversa com: Sara".
- **Hoje e Fila:** "Equipe agora" mostra Sara "Respondendo agora".
- Conferir no celular (390 px) e no computador.

- [ ] **Step 4: Commit (só se algo mudou na verificação)**

```bash
git status --short   # Expected: vazio; se houver ajuste da verificação, commitar com mensagem "fix(1A): …" e a linha Co-Authored-By
```

---

### Interfaces que o Lote 1A expõe

**Puro (`src/lib/signature.ts`):**
- `normalizeSignature(raw: string): string`
- `signatureKey(raw: string): string`
- `isValidSignature(raw: string): boolean`
- `parseSignature(body: string | null | undefined): string | null`
- `stripSignature(body: string | null | undefined): string`
- `signatureLine(sig: string): string`
- `signBody(signature: string | null | undefined, text: string): string`
- `signatureDisplayName(sig: string | null | undefined): string | null`

**Puro (`src/lib/authorship.ts`):**
- `firstName(name): string | null`
- `teamShortName(u: { name: string; signature?: string | null }): string`
- `outMeta(m: { fromPhone: boolean; sentVia?: string | null; sender: string | null; body?: string | null }): string`
- `lastMessagePrefix(direction, authorName?, body?): string | null`
- `ownerLine(owner?, repliedBy?): string`
- `conversationWith(ownerName?): string`

**Puro (`src/lib/team-now.ts`):**
- `type TeamState`, `TEAM_STATE_LABEL`, `REPLYING_WINDOW_MIN = 15`, `SEEN_WINDOW_MIN = 5`
- `teamState(p: { availability; lastSeenAt; lastReplyAt }, now: Date): TeamState`
- `lastReplyLabel(at, via, now): string`

**Banco (migration `0023_quem_atende`, só aditiva):**
- `users.signature text`, com `users_signature_uq` único em `upper(signature)`
- `messages.sent_via text ("celular" | "crm" | null)`, com o índice `messages_sent_by_idx (sent_by_user_id, created_at)`
- `deals.last_reply_by_id uuid → users.id`
- `deals.last_reply_via text`

**Servidor (`src/server/domain/authorship.ts`):**
- `type SentVia`, `type SignatureOwner`
- `signatureMap(tx?)`
- `signerOf(tx, body, map?)`
- `sentViaOf({ fromPhone?, automated?, authorId? })`
- `warnOwnerRepliedByOther(tx, { dealId, ownerId, authorId, at })`

**Servidor, comportamentos novos:**
- `recordOutbound` grava autora e `sentVia`, atualiza `lastReplyBy/Via`, dá a dona pela assinatura (também para a Gestão, só para pessoa ativa) e avisa a dona quando outra pessoa responde.
- **Alerta novo** `type = "respondida_por_outra"`: `audience = "responsavel"`, um por dia, por conversa e por quem respondeu. A chave de deduplicação é `respondida:<deal>:<autora>:<dia>`.
- **Evento** `assumiu` com `payload.motivo = "assinatura"` (e `migracao: true` quando vem do script).
- `importHistoryChat` aplica a mesma autoria e a mesma dona.
- `sendFromCrm` assina o texto com a assinatura de quem está logada e manda o visto depois de enviar. `sendMediaFromCrm` também manda o visto, mas a legenda vai sem assinatura.
- `markConversationRead(dealId, userId, opts?: { replying?: boolean })` só manda o visto para a dona ou quando alguém responde.
- `setMemberSignature(userId, raw, actorId)` (em `profiles.ts`) e a ação `setMemberSignatureAction(id, signature)`.

**Servidor (consultas):**
- `teamNameCol()`, `teamNameOf(id)` (em `src/server/queries/team-name.ts`)
- `getTeamNow(now?): Promise<TeamNow>`, com `TeamMemberNow` e `TeamNow` (em `src/server/queries/team-now.ts`)
- `QueueItem` e `BoardCard`: `ownerShort?`, `lastAuthorName?`, `repliedByName?`
- `getDealDetail(...)`: `lastReplyName`
- `JourneyPerson`: `ownerName`, `ownerInitials`
- `AgendaItem.ownerName` passa a ser o nome da equipe

**Servidor (acerto para trás, `src/server/domain/authorship-backfill.ts`):**
- `planBackfill`, `applyBackfill`, `restoreBackfill`
- tipos `BackfillPlan`, `BackfillBackup`, `OwnerReplyRow`

**Tela:**
- `TeamNowPanel` e `TeamNowStrip` (em `src/components/team/team-now.tsx`)
- `QueueColumn` com a prop `team?: TeamNow`
- `Msg.sentVia?`
- O escopo de tempo real `"team"` passa a ser ouvido no Hoje e na Fila.

**CLI:**
- `npx tsx scripts/autoria-assinaturas.ts --dry-run | --aplicar [--backup arq] | --desfazer arq [--dias N]`

### Arquivos que o Lote 1A mexe

**Criados:**
- `src/lib/signature.ts`, `src/lib/signature.test.ts`
- `src/lib/authorship.ts`, `src/lib/authorship.test.ts`
- `src/lib/team-now.ts`, `src/lib/team-now.test.ts`
- `src/server/domain/authorship.ts`, `src/server/domain/authorship.test.ts`
- `src/server/domain/authorship-backfill.ts`, `src/server/domain/authorship-backfill.test.ts`
- `src/server/queries/team-name.ts`
- `src/server/queries/team-now.ts`, `src/server/queries/team-now.test.ts`
- `src/components/team/team-now.tsx`, `src/components/team/team-now.test.tsx`
- `src/components/config/team.test.tsx`
- `drizzle/0023_quem_atende.sql`, mais `drizzle/meta/0023_snapshot.json` e `drizzle/meta/_journal.json`
- `scripts/autoria-assinaturas.ts`

**Alterados:**

| Área | Arquivos |
|---|---|
| Banco | `src/server/db/schema.ts`, `src/server/db/schema.test.ts` |
| Domínio | `src/server/domain/deals.ts`, `src/server/domain/send.ts`, `src/server/domain/send-media.test.ts`, `src/server/domain/profiles.ts`, `src/server/domain/members.test.ts` |
| Consultas | `src/server/queries/queue.ts`, `src/server/queries/queue.test.ts`, `src/server/queries/board.ts`, `src/server/queries/board.test.ts`, `src/server/queries/deal.ts`, `src/server/queries/journey.ts`, `src/server/queries/journey.test.ts`, `src/server/queries/agenda.ts` |
| Histórico | `src/lib/history.ts`, `src/lib/history.test.ts` |
| Telas e páginas | `src/app/(app)/config/actions.ts`, `src/app/(app)/config/equipe/page.tsx`, `src/app/(app)/atendimento/page.tsx`, `src/app/(app)/atendimento/[id]/page.tsx`, `src/app/(app)/page.tsx` |
| Configurações | `src/components/config/team.tsx` |
| Conversa | `src/components/lead/conversation.tsx`, `src/components/lead/conversation.test.tsx`, `src/components/lead/lead-sheet.tsx` |
| Fila e painel | `src/components/queue/conversation-pane.tsx`, `src/components/queue/queue-item.tsx`, `src/components/queue/queue-item.render.test.tsx`, `src/components/queue/queue-column.tsx`, `src/components/queue/client-pane.tsx` |
| Quadro | `src/components/pipeline/deal-card.tsx` |
| Jornada | `src/components/journey/station.tsx` |
| Agenda | `src/components/agenda/agenda-board.tsx`, `src/components/agenda/agenda-board.test.tsx`, `src/components/agenda/entry-sheet.tsx` |

---

## Lote 1B: Avisos explicados

> Valem para todas as tarefas abaixo:
> - O Postgres de teste precisa estar no ar: `npm run infra:up`.
> - Todos os testes de banco usam `crm_test` (`test/db.ts` → `resetDb`).
> - Nenhum teste envia WhatsApp. `EVOLUTION_URL` já aponta para um endereço morto em `test/setup-env.ts`.
> - Textos de tela e mensagens ficam em PT-BR. O código segue o estilo do arquivo ao redor.
> - Todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
> - Ordem de dependência: B1 → B2 → B3 → B4 → (B5, B6, B7) → B8 → B9 → B10 → B11 → B12 → B13 → B14.
> - **O Lote 1A já está feito quando este lote começa.** Ele preenche a autora das mensagens (`messages.sent_by_user_id`) e quem respondeu por último (`deals.last_reply_by_id`) pela assinatura, e mudou a linha da Fila ("Cati:" no lugar de "Você:", "Dona: Sara · respondida por Cati"). Por isso:
>   - B4, B6 e B7 reescrevem trechos que a A6 já tinha mexido: o texto de cada uma já traz os campos e textos do 1A, nunca os apague;
>   - o "quem respondeu" do WhyLate (B7) usa o `sender` (nome da equipe) que a A5 entrega; sem autora, o texto cai em "A Casa respondeu";
>   - o script de B9 roda em produção só depois do acerto para trás do 1A (seção Implantação). Antes disso, ele não acha destino para as tarefas.
> - Fora deste pedido: o item "Push" da spec (tarefas e transferências gerando push).

---

### Tarefa B0: prints de antes (sem código)

- [ ] **Passo 1: tirar os prints da Fila e do Hoje antes de qualquer mudança**

```bash
mkdir -p e2e/shots/lote1b/antes
CF_SHOTS_DIR=e2e/shots/lote1b/antes npx playwright test e2e/fila.spec.ts e2e/hoje.spec.ts --project=desktop
```
Esperado: os specs passam e aparecem PNGs em `e2e/shots/lote1b/antes/`. Os prints não entram em commit.

---

### Tarefa B1: sinais automáticos valem só enquanto não respondidos

**Arquivos:**
- Modificar: `src/server/domain/signals.ts:1-61`
- Teste: `src/server/domain/signals.test.ts:28-37`
- Teste: `src/server/queries/queue.test.ts:390-399`

**Interfaces:**
- Consome: nada.
- Produz:
  - `type Signal = "pediu_preco" | "pediu_horario" | "sumiu_apos_preco" | "pediu_desconto" | "remarcar_cancelar" | "reclamacao" | "evento" | "urgente" | "indicacao"`. Sai `respondeu_rapido`.
  - `SIGNAL_LABEL: Record<Signal, string>`, `SIGNAL_ORDER: Signal[]` e `signalsOf(messages, now): Signal[]`.
  - `pediu_preco` some quando, depois da última pergunta de preço, a Casa manda um valor.
  - `pediu_horario` some quando, depois da última pergunta de horário, a Casa manda um horário (`14h`, `15:30`, `10 horas`).

- [ ] **Passo 1: escrever os testes que falham**

Em `src/server/domain/signals.test.ts`, troque o import da linha 2 por:
```ts
import { signalsOf, signalLabels, SIGNAL_LABEL } from "./signals";
```
Depois, substitua os testes "respondeu rápido…" e "rótulos curtos…" (linhas 28-37) por:
```ts
it("pediu preço some quando a Casa manda um valor; volta se ela perguntar de novo", () => {
  expect(signalsOf([m("in", "quanto custa a escova?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "A escova é R$ 80", 1)])).not.toContain("pediu_preco");
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "Oi! Já te passo", 1)])).toContain("pediu_preco"); // respondeu sem valor
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "R$ 80", 1), m("in", "e qual o valor da hidratação?", 2)])).toContain("pediu_preco");
});
it("pediu horário some quando a Casa oferece um horário", () => {
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Temos sábado às 14h", 1)])).not.toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Pode ser 15:30?", 1)])).not.toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Vou ver a agenda", 1)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Fica R$ 150", 1)])).toContain("pediu_horario"); // valor não é horário
});
it("'Responde rápido' não existe mais (era ruído)", () => {
  expect(signalsOf([m("out", "Oi!", 0), m("in", "oi", 1)])).toEqual([]);
  expect(Object.values(SIGNAL_LABEL)).not.toContain("Responde rápido");
});
it("rótulos curtos, no máximo 2, na ordem de prioridade", () => {
  const all = signalsOf([m("in", "estragou meu cabelo, é urgente, quanto custa arrumar?", 0)]);
  expect(all.slice(0, 3)).toEqual(["reclamacao", "urgente", "pediu_preco"]);
  expect(signalLabels(all)).toEqual(["Reclamação", "Urgente"]);
});
```

Em `src/server/queries/queue.test.ts`, no teste "mostra as etiquetas pelas últimas mensagens", troque as duas últimas linhas por:
```ts
    const sinais = item.signals.filter((s) => ["Pediu preço", "Pediu horário", "Sumiu após preço"].includes(s));
    expect(sinais).toEqual(["Pediu horário"]); // a Casa mandou o valor: "Pediu preço" some; horário ninguém ofereceu
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/domain/signals.test.ts`
Esperado: FAIL nos testes "pediu preço some…", "pediu horário some…" e "'Responde rápido' não existe mais".

- [ ] **Passo 3: implementar**

Em `src/server/domain/signals.ts`, substitua as linhas 2-3 e 6-19:
```ts
export type Signal = "pediu_preco" | "pediu_horario" | "sumiu_apos_preco"
  | "pediu_desconto" | "remarcar_cancelar" | "reclamacao" | "evento" | "urgente" | "indicacao";
export type SignalMessage = { direction: "in" | "out"; body: string | null; createdAt: Date | string };

/** Rótulos curtos, na ordem de prioridade (a Fila mostra no máximo 2). */
export const SIGNAL_LABEL: Record<Signal, string> = {
  reclamacao: "Reclamação", urgente: "Urgente", sumiu_apos_preco: "Sumiu após preço", remarcar_cancelar: "Quer remarcar/cancelar",
  pediu_preco: "Pediu preço", pediu_horario: "Pediu horário", evento: "Evento/noiva", pediu_desconto: "Pediu desconto",
  indicacao: "Indicação",
};
/** Ordem de prioridade (a Fila mostra no máximo 2): risco primeiro. */
export const SIGNAL_ORDER: Signal[] = ["reclamacao", "urgente", "sumiu_apos_preco", "remarcar_cancelar", "pediu_preco", "pediu_horario", "evento", "pediu_desconto", "indicacao"];
export const QUEUE_SIGNAL_MAX = 2;
export const SIGNAL_WINDOW = 30;

const HOUR_MS = 3_600_000;
export const GHOST_AFTER_PRICE_MS = 24 * HOUR_MS;
```
Logo depois de `const sentPrice = …` (linha 34), acrescente:
```ts
// A Casa ofereceu um horário: "14h", "às 9h30", "15:30", "10 horas".
const OFFERS_TIME = /\b\d{1,2}\s?(h\d{0,2}|:\d{2}|horas?)\b/;
const sentTime = (body: string) => OFFERS_TIME.test(fold(body));
```
Substitua o corpo de `signalsOf` (linhas 37-61):
```ts
/**
 * Sinais das últimas mensagens. "Pediu preço" e "Pediu horário" valem só enquanto não respondidos: somem quando a Casa manda um valor
 * (ou um horário) depois da última pergunta da cliente, e voltam se ela perguntar de novo.
 */
export function signalsOf(messages: SignalMessage[], now: Date = new Date()): Signal[] {
  const msgs = [...messages].sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
  const out = new Set<Signal>();
  let askPrice = -1, askTime = -1;
  msgs.forEach((m, i) => {
    if (m.direction !== "in" || !m.body) return;
    const t = fold(m.body);
    if (ASKS_PRICE.test(t)) askPrice = i;
    if (ASKS_TIME.test(t)) askTime = i;
    if (ASKS_DISCOUNT.test(t)) out.add("pediu_desconto");
    if (RESCHEDULE.test(t)) out.add("remarcar_cancelar");
    if (COMPLAINT.test(t)) out.add("reclamacao");
    if (EVENT.test(t)) out.add("evento");
    if (URGENT.test(t)) out.add("urgente");
    if (REFERRAL.test(t)) out.add("indicacao");
  });
  const answered = (from: number, test: (body: string) => boolean) => msgs.slice(from + 1).some((m) => m.direction === "out" && !!m.body && test(m.body));
  if (askPrice >= 0 && !answered(askPrice, sentPrice)) out.add("pediu_preco");
  if (askTime >= 0 && !answered(askTime, sentTime)) out.add("pediu_horario");
  // Sumiu após o preço: a Casa mandou valor e, desde então, a cliente não disse mais nada há mais de 24 h.
  let lastPrice = -1;
  msgs.forEach((m, i) => { if (m.direction === "out" && m.body && sentPrice(m.body)) lastPrice = i; });
  if (lastPrice >= 0 && !msgs.slice(lastPrice + 1).some((m) => m.direction === "in") && now.getTime() - ts(msgs[lastPrice].createdAt) > GHOST_AFTER_PRICE_MS) out.add("sumiu_apos_preco");
  return SIGNAL_ORDER.filter((s) => out.has(s));
}
```
Apague a constante `FAST_REPLY_MS`, que não tem outro uso: `grep -rn FAST_REPLY_MS src` deve voltar vazio.

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/domain/signals.test.ts src/server/domain/signals-novos.test.ts src/server/queries/queue.test.ts src/server/queries/queue-signals.test.ts`
Esperado: PASS.
Rode: `npm run typecheck`
Esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add src/server/domain/signals.ts src/server/domain/signals.test.ts src/server/queries/queue.test.ts
git commit -m "feat(avisos): Pediu preço/horário somem quando a Casa responde; sai o sinal Responde rápido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B2: módulo único de textos (`src/lib/alert-copy.ts`)

**Arquivos:**
- Criar: `src/lib/alert-copy.ts`
- Teste: `src/lib/alert-copy.test.ts`

**Interfaces:**
- Consome: `dueLabel(dueMs, nowMs)` de `src/lib/next-action.ts`, `isHiddenNumber` de `src/lib/phone-client.ts`, `firstName` de `src/lib/authorship.ts` (A5), `SIGNAL_LABEL`, `SIGNAL_ORDER` e `Signal` (B1), e o tipo `QueueSectionKey` de `src/lib/queue.ts`.
- Produz (puro, servidor e navegador):
  - Quem e quando:
    - `HELP_HREF = "/ajuda/avisos"`
    - `firstName` (reexportado de `src/lib/authorship.ts`, mesmo tipo `(name: string | null | undefined) => string | null`)
    - `clientLabel(name: string | null | undefined, phone: string): string`
    - `sinceLabel(ms: number, now: number): string`
    - `dueText(dueMs: number, now: number): string`
    - `stoppedText(days: number): string`
  - Prazo:
    - `slaText(waitSeconds: number, slaMinutes: number | null): string | null`
    - `WAIT_CLOCK_PREFIX`, `waitClockSuffix(sla)`, `waitClockText(waited, sla)` e `WAIT_CLOCK_HELP`
  - Seções da Fila:
    - `SECTION_TITLE: Record<QueueSectionKey, string>`
    - `sectionHelp(key: QueueSectionKey, n?: number | null): string`
    - `PARADOS_ACTIONS`, `ATTENDANCE_TITLE`, `ATTENDANCE_HELP`, `SUMMARY_HELP` e `ARCHIVED_ROW`
  - Dona e transferência:
    - `NO_OWNER`, `NO_OWNER_HINT`
    - `ownerHint(ownerName: string | null, mine: boolean): string`
    - `transferText(byName: string, toName: string | null, viewerIsNewOwner: boolean): string`
    - `answeredText({ by, fromPhone, at }): string`
  - Chips:
    - `CHIP_HELP`, `SIGNAL_HELP: Record<Signal, string>`, `INTEREST_HELP`, `KEYWORD_HELP` e `TAG_HELP`
    - `chipHelp(label: string): string`
  - Cores: `COLOR_HELP: HelpEntry[]`
  - Alertas:
    - `taskTitleFor(title, contactName): string`
    - `alertText.{wait, escalated, taskDue, offer, claimed, transferred, repliedByOther, birthday, autoSendFailed}`
  - Sino:
    - `type AlertGroup`, `ALERT_GROUP_ORDER` e `ALERT_GROUP_TITLE`
    - `ALERT_TYPES: string[]` (inclui `respondida_por_outra`, do Lote 1A), `alertGroupOf(type: string): AlertGroup`
    - `ALERT_HELP: (HelpEntry & { types: string[] })[]` e `BELL_LEGEND`
  - Ajuda: `type HelpEntry`, `type HelpGroup` e `helpCatalog(): HelpGroup[]`

- [ ] **Passo 1: escrever o teste que falha**

`src/lib/alert-copy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  ALERT_HELP, ALERT_TYPES, SECTION_TITLE, alertGroupOf, alertText, answeredText, chipHelp, clientLabel, dueText, firstName, helpCatalog,
  ownerHint, sectionHelp, sinceLabel, slaText, stoppedText, taskTitleFor, transferText, waitClockText,
} from "./alert-copy";
import { SIGNAL_LABEL, SIGNAL_ORDER } from "../server/domain/signals";

const bahia = (iso: string) => new Date(`${iso}-03:00`).getTime();
const NOW = bahia("2026-10-15T14:30:00"); // quinta 14:30 em Salvador

describe("quem e quando", () => {
  it("cliente: nome; sem nome, final do telefone; número oculto, 'cliente sem nome'. Nunca o +55 cru", () => {
    expect(clientLabel("  Edson Moreira ", "+5571999990000")).toBe("Edson Moreira");
    expect(clientLabel(null, "+5571999990000")).toBe("cliente com final 0000");
    expect(clientLabel("", "lid:123456")).toBe("cliente sem nome");
    expect(firstName("Caticilene Souza")).toBe("Caticilene");
    expect(firstName(null)).toBeNull();
  });
  it("hora com o dia quando não é hoje", () => {
    expect(sinceLabel(bahia("2026-10-15T14:02:00"), NOW)).toBe("14:02");
    expect(sinceLabel(bahia("2026-10-14T13:00:00"), NOW)).toBe("ontem 13:00");
    expect(dueText(bahia("2026-10-14T13:00:00"), NOW)).toBe("venceu ontem 13:00");
    expect(dueText(bahia("2026-10-15T16:00:00"), NOW)).toBe("vence hoje 16:00");
    expect(stoppedText(1)).toBe("parado há 1 dia");
    expect(stoppedText(3)).toBe("parado há 3 dias");
  });
});

describe("prazo", () => {
  it("um texto só: quanto falta ou quanto passou", () => {
    expect(slaText(4 * 60, 15)).toBe("Responda em 11 min");
    expect(slaText(14 * 60 + 30, 15)).toBe("Responda em menos de 1 min");
    expect(slaText(15 * 60 + 20, 15)).toBe("Responder agora: o prazo acabou");
    expect(slaText(19 * 60, 15)).toBe("Responder agora: 4 min além do prazo");
    expect(slaText(80 * 60, 15)).toBe("Responder agora: 1 h 05 além do prazo");
    expect(slaText(600, null)).toBeNull();
  });
  it("relógio do cabeçalho", () => {
    expect(waitClockText("12 min", 15)).toBe("Esperando há 12 min (prazo 15)");
    expect(waitClockText("3 min", null)).toBe("Esperando há 3 min");
  });
});

describe("Fila", () => {
  it("títulos novos e a frase fixa de cada seção", () => {
    expect(SECTION_TITLE).toEqual({
      atrasados: "Atrasados", perto: "Quase no prazo", aguardando: "Esperando a Casa responder", "acoes-hoje": "Combinados para hoje e atrasados",
      parados: "Parados", "aguardando-cliente": "Bola com a cliente", reengajar: "Para reengajar", arquivadas: "Encerradas",
    });
    expect(sectionHelp("atrasados")).toBe("A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.");
    expect(sectionHelp("perto", 3)).toBe("Responda em até 3 min.");
    expect(sectionHelp("aguardando")).toBe("A cliente escreveu; ainda está no prazo.");
    expect(sectionHelp("parados", 2)).toBe("Há 2 dias ou mais sem ninguém decidir o próximo passo. Marque Agendar, Retomar depois ou Encerrar.");
    expect(sectionHelp("aguardando-cliente")).toBe("A Casa respondeu; agora é com ela.");
    expect(sectionHelp("arquivadas")).toBe("Voltam sozinhas se a cliente escrever.");
  });
  it("dona, transferência e quem respondeu", () => {
    expect(ownerHint(null, false)).toBe("Ninguém assumiu. Toque em Assumir se for você.");
    expect(ownerHint("Sara Lima", false)).toBe("Sara está cuidando. Assumir tira dela.");
    expect(ownerHint("Sara Lima", true)).toBe("Você está cuidando desta conversa.");
    expect(transferText("Caticilene Souza", "Sara Lima", true)).toBe("Caticilene te passou esta conversa");
    expect(transferText("Caticilene Souza", "Sara Lima", false)).toBe("Caticilene passou para Sara");
    expect(answeredText({ by: "Cati Souza", fromPhone: true, at: "ontem 13:15" })).toBe("Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente.");
    expect(answeredText({ by: null, fromPhone: true, at: "hoje 09:00" })).toBe("A Casa respondeu hoje 09:00 pelo celular; agora é a vez da cliente.");
    expect(answeredText({ by: null, fromPhone: false, at: "hoje 09:00" })).toBe("A mensagem automática saiu hoje 09:00; agora é a vez da cliente.");
  });
  it("todo chip que a Fila mostra tem dica", () => {
    for (const s of SIGNAL_ORDER) expect(chipHelp(SIGNAL_LABEL[s]).length).toBeGreaterThan(10);
    for (const c of ["Sem dono", "Novo", "Agendado hoje", "Agendado amanhã", "Interesse: Progressiva", "Mega hair"]) expect(chipHelp(c).length).toBeGreaterThan(10);
  });
});

describe("alertas: sem nome repetido nem telefone cru", () => {
  it("espera e escalado dizem desde quando, o prazo e a dona", () => {
    expect(alertText.wait({ client: "Fulana", sinceMs: bahia("2026-10-15T14:02:00"), slaMinutes: 15, ownerName: "Sara Lima", now: NOW })).toBe("Fulana espera resposta desde 14:02 (prazo 15 min). Dona: Sara.");
    expect(alertText.wait({ client: "Edson", sinceMs: bahia("2026-10-14T17:50:00"), slaMinutes: 15, ownerName: null, now: NOW })).toBe("Edson espera resposta desde ontem 17:50 (prazo 15 min). Sem dono.");
    expect(alertText.escalated({ client: "Fulana", sinceMs: bahia("2026-10-15T14:02:00"), ownerName: "Sara", now: NOW })).toBe("Escalado: Fulana sem resposta desde 14:02. Dona: Sara.");
  });
  it("combinado: o título sem o nome da cliente nem telefone", () => {
    expect(taskTitleFor("Retomar contato com Joana Lima", "Joana Lima")).toBe("retomar contato");
    expect(taskTitleFor("Retomar contato com a cliente", null)).toBe("retomar contato");
    expect(taskTitleFor("Retomar contato com +5571999990000", null)).toBe("retomar contato");
    expect(taskTitleFor("Remarcar com Bianca", "Bianca Teles")).toBe("remarcar");
    expect(taskTitleFor("Mandar valores", "Joana")).toBe("mandar valores");
    expect(alertText.taskDue({ title: "Retomar contato com Joana Lima", contactName: "Joana Lima", client: "Joana Lima", overdue: false })).toBe("Combinado vencendo: retomar contato (Joana Lima).");
    expect(alertText.taskDue({ title: "Retomar contato com +5571999990000", contactName: null, client: clientLabel(null, "+5571999990000"), overdue: true })).toBe("Combinado vencido: retomar contato (cliente com final 0000).");
  });
  it("conversa passada: sem artigo, funciona com nome masculino", () => {
    expect(alertText.claimed("Caticilene Souza", "Edson")).toBe("Caticilene assumiu a conversa de Edson");
    expect(alertText.transferred("Caticilene Souza", "Edson")).toBe("Caticilene te passou a conversa de Edson");
    expect(alertText.offer("Edson")).toBe("A dona não respondeu. Pode assumir Edson?");
  });
  it("outra pessoa respondeu a conversa da dona (aviso do Lote 1A): mesma frase, sem telefone", () => {
    expect(alertText.repliedByOther("Caticilene Souza", "Edson")).toBe("Caticilene respondeu a conversa de Edson. Ela continua sua; se for para passar, use Transferir.");
    expect(alertText.repliedByOther(null, "Edson")).toBe("Outra pessoa respondeu a conversa de Edson. Ela continua sua; se for para passar, use Transferir.");
  });
  it("aniversário diz o dia e não promete mensagem pronta", () => {
    expect(alertText.birthday("Fulana", 17, 10)).toBe("Aniversário de Fulana dia 17/10. Que tal mandar um parabéns?");
  });
  it("envio automático que falhou diz o que fazer", () => {
    expect(alertText.autoSendFailed("Fulana", "WhatsApp desconectado")).toBe("Mensagem automática para Fulana não saiu (WhatsApp desconectado). Abra a conversa e envie manualmente.");
  });
  it("nenhum texto de alerta mostra +55 cru", () => {
    const client = clientLabel(null, "+5571988887777");
    for (const t of [alertText.wait({ client, sinceMs: NOW, slaMinutes: 15, ownerName: null, now: NOW }), alertText.offer(client), alertText.claimed("Ana", client), alertText.repliedByOther("Ana", client), alertText.birthday(client, 1, 2), alertText.autoSendFailed(client)])
      expect(t).not.toMatch(/\+55/);
  });
});

describe("ajuda e sino", () => {
  it("a página cobre toda seção, todo sinal e todo tipo de alerta, com âncoras únicas", () => {
    const ids = helpCatalog().flatMap((g) => g.entries.map((e) => e.id));
    for (const k of Object.keys(SECTION_TITLE)) expect(ids).toContain(`fila-${k}`);
    for (const s of SIGNAL_ORDER) expect(ids).toContain(`sinal-${s}`);
    for (const t of ALERT_TYPES) expect(ALERT_HELP.some((h) => h.types.includes(t))).toBe(true);
    for (const h of ALERT_HELP) expect(ids).toContain(h.id);
    expect(ALERT_TYPES).toContain("respondida_por_outra");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("tipo desconhecido cai em Outros", () => {
    expect(alertGroupOf("sem_resposta_minutos")).toBe("espera");
    expect(alertGroupOf("tarefa_vencendo")).toBe("combinados");
    expect(alertGroupOf("respondida_por_outra")).toBe("conversas");
    expect(alertGroupOf("x")).toBe("outros");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/lib/alert-copy.test.ts`
Esperado: FAIL com "Failed to resolve import ./alert-copy".

- [ ] **Passo 3: implementar `src/lib/alert-copy.ts`**

```ts
/**
 * Os textos que explicam os avisos, num lugar só: seções e linhas da Fila, cabeçalho e painel da conversa, sino e Hoje.
 * A página "O que cada aviso quer dizer" (/ajuda/avisos) é montada destas mesmas constantes e funções: mudar uma frase aqui
 * muda a tela e a ajuda juntas. Puro (servidor e navegador), sempre no relógio de Salvador.
 */
import { dueLabel } from "./next-action";
import { isHiddenNumber } from "./phone-client";
import { firstName } from "./authorship";
import type { QueueSectionKey } from "./queue";
import { SIGNAL_LABEL, SIGNAL_ORDER, type Signal } from "../server/domain/signals";

export const HELP_HREF = "/ajuda/avisos";

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (ms: number) => Math.floor((ms - OFFSET_MS) / DAY_MS);
const hhmm = (ms: number) => { const d = new Date(ms - OFFSET_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const minutesText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${pad(min % 60)}`);
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type HelpEntry = { id: string; title: string; text: string; example?: string };
export type HelpGroup = { id: string; title: string; entries: HelpEntry[] };

/* ---------- Quem e quando ---------- */
/** "Caticilene Souza" → "Caticilene": o mesmo `firstName` do Lote 1A (src/lib/authorship.ts), reexportado para quem já importa daqui. */
export { firstName };

/** A cliente num aviso: o nome; sem nome, "cliente com final 1234"; número oculto, "cliente sem nome". Nunca o +55 cru. */
export function clientLabel(name: string | null | undefined, phone: string): string {
  const n = name?.trim();
  if (n) return n;
  if (isHiddenNumber(phone)) return "cliente sem nome";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `cliente com final ${digits.slice(-4)}` : "cliente sem nome";
}

/** "14:02" no mesmo dia; outro dia, sempre com o dia: "ontem 19:40", "sex 10/10 19:40". */
export const sinceLabel = (ms: number, now: number): string => (dayOf(ms) === dayOf(now) ? hhmm(ms) : dueLabel(ms, now));
/** Combinado: "venceu ontem 13:00" ou "vence hoje 15:00" (sempre com o dia). */
export const dueText = (dueMs: number, now: number): string => `${dueMs < now ? "venceu" : "vence"} ${dueLabel(dueMs, now)}`;
export const stoppedText = (days: number): string => `parado há ${days} ${days === 1 ? "dia" : "dias"}`;

/* ---------- Prazo ---------- */
/** O único texto de prazo da linha (Fila, Hoje). Dentro: "Responda em 3 min". Passou: "Responder agora: 4 min além do prazo". Sem prazo na etapa: null. */
export function slaText(waitSeconds: number, slaMinutes: number | null): string | null {
  if (!slaMinutes || slaMinutes <= 0) return null;
  const left = slaMinutes * 60 - waitSeconds;
  if (left <= 0) {
    const over = Math.floor(-left / 60);
    return over >= 1 ? `Responder agora: ${minutesText(over)} além do prazo` : "Responder agora: o prazo acabou";
  }
  return left < 60 ? "Responda em menos de 1 min" : `Responda em ${Math.ceil(left / 60)} min`;
}
export const WAIT_CLOCK_PREFIX = "Esperando há ";
export const waitClockSuffix = (slaMinutes: number | null): string => (slaMinutes ? ` (prazo ${slaMinutes})` : "");
/** Relógio do cabeçalho da conversa: "Esperando há 12 min (prazo 15)". */
export const waitClockText = (waited: string, slaMinutes: number | null): string => `${WAIT_CLOCK_PREFIX}${waited}${waitClockSuffix(slaMinutes)}`;
export const WAIT_CLOCK_HELP = "Quanto tempo a cliente espera resposta, contando só o horário da Casa. Entre parênteses, o prazo da etapa em minutos.";

/* ---------- Seções da Fila ---------- */
export const SECTION_TITLE: Record<QueueSectionKey, string> = {
  atrasados: "Atrasados", perto: "Quase no prazo", aguardando: "Esperando a Casa responder", "acoes-hoje": "Combinados para hoje e atrasados",
  parados: "Parados", "aguardando-cliente": "Bola com a cliente", reengajar: "Para reengajar", arquivadas: "Encerradas",
};
/** As saídas de uma conversa parada. O Lote 1C (Tarefa C3) troca "Retomar depois" por "Aguardar cliente" aqui, quando o botão novo entra. */
export const PARADOS_ACTIONS = "Agendar, Retomar depois ou Encerrar";
/** A frase fixa abaixo do título. `n`: minutos que faltam (Quase no prazo) ou dias parados (Parados), o menor da seção. */
export function sectionHelp(key: QueueSectionKey, n?: number | null): string {
  switch (key) {
    case "atrasados": return "A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.";
    case "perto": return n != null ? `Responda em até ${Math.max(1, n)} min.` : "Responda antes que o prazo acabe.";
    case "aguardando": return "A cliente escreveu; ainda está no prazo.";
    case "acoes-hoje": return "O que a equipe combinou de fazer hoje e o que já venceu.";
    case "parados": return `${n != null ? `Há ${n} ${n === 1 ? "dia" : "dias"} ou mais` : "Há dias"} sem ninguém decidir o próximo passo. Marque ${PARADOS_ACTIONS}.`;
    case "aguardando-cliente": return "A Casa respondeu; agora é com ela.";
    case "reengajar": return "Sem conversa há mais de 90 dias. Vale mandar um oi.";
    case "arquivadas": return "Voltam sozinhas se a cliente escrever.";
  }
}
export const ATTENDANCE_TITLE = "Ela veio?";
export const ATTENDANCE_HELP = "Já passou do horário. Toque em Compareceu ou Faltou.";
export const SUMMARY_HELP = "Os números do topo da Fila: quem espera resposta, quem passou do prazo, conversas sem dono, combinados que já venceram e horários de hoje. Toque num número para filtrar.";
export const ARCHIVED_ROW = "encerrada · volta se a cliente escrever";

/* ---------- Dona, transferência, quem respondeu ---------- */
export const NO_OWNER = "Sem dono";
export const NO_OWNER_HINT = "Ninguém assumiu. Toque em Assumir se for você.";
export function ownerHint(ownerName: string | null, mine: boolean): string {
  if (!ownerName) return NO_OWNER_HINT;
  if (mine) return "Você está cuidando desta conversa.";
  return `${firstName(ownerName)} está cuidando. Assumir tira dela.`;
}
/** "Fulana te passou esta conversa" (para quem recebeu) ou "Fulana passou para Sara" (para quem olha de fora). */
export function transferText(byName: string, toName: string | null, viewerIsNewOwner: boolean): string {
  return viewerIsNewOwner ? `${firstName(byName)} te passou esta conversa` : `${firstName(byName)} passou para ${firstName(toName) ?? "outra pessoa"}`;
}
/** A Casa respondeu e a bola está com a cliente: quem, quando (`at` já com o dia) e por onde. */
export function answeredText(o: { by: string | null; fromPhone: boolean; at: string }): string {
  if (!o.by && !o.fromPhone) return `A mensagem automática saiu ${o.at}; agora é a vez da cliente.`;
  return `${o.by ? firstName(o.by) : "A Casa"} respondeu ${o.at}${o.fromPhone ? " pelo celular" : ""}; agora é a vez da cliente.`;
}

/* ---------- Chips da linha ---------- */
export const CHIP_HELP: Record<string, string> = {
  [NO_OWNER]: NO_OWNER_HINT,
  Novo: "Primeira conversa: chegou hoje.",
  "Agendado hoje": "Tem horário marcado para hoje.",
  "Agendado amanhã": "Tem horário marcado para amanhã.",
};
export const SIGNAL_HELP: Record<Signal, string> = {
  reclamacao: "Ela reclamou de algo. Responda com cuidado; a conversa sobe dentro da seção.",
  urgente: "Ela pediu urgência. A conversa sobe dentro da seção.",
  sumiu_apos_preco: "A Casa mandou o valor e ela não respondeu há mais de 1 dia.",
  remarcar_cancelar: "Ela quer remarcar ou cancelar o horário.",
  pediu_preco: "Ela perguntou o valor e a Casa ainda não mandou. Some quando a Casa mandar um valor.",
  pediu_horario: "Ela perguntou por horário e a Casa ainda não ofereceu. Some quando a Casa mandar um horário.",
  evento: "Fala de noiva, casamento, formatura ou festa.",
  pediu_desconto: "Ela perguntou por desconto ou promoção.",
  indicacao: "Veio por indicação de alguém.",
};
export const INTEREST_HELP = "Ela citou um serviço cadastrado (Configurações › Listas).";
export const KEYWORD_HELP = "Palavra-chave cadastrada pela gestão (Configurações › Listas).";
export const TAG_HELP = "Etiqueta que a equipe colocou na cliente. Fica separada dos sinais automáticos.";
const SIGNAL_BY_LABEL = new Map(SIGNAL_ORDER.map((s) => [SIGNAL_LABEL[s], s] as const));
/** A dica (title) de um chip da linha da Fila. */
export function chipHelp(label: string): string {
  if (CHIP_HELP[label]) return CHIP_HELP[label];
  const s = SIGNAL_BY_LABEL.get(label);
  if (s) return SIGNAL_HELP[s];
  return label.startsWith("Interesse: ") ? INTEREST_HELP : KEYWORD_HELP;
}

/* ---------- Cores ---------- */
export const COLOR_HELP: HelpEntry[] = [
  { id: "cor-vermelho", title: "Vermelho", text: "Existe um alerta aberto: a cliente passou do prazo sem resposta. Só fica vermelho quando o alerta existe." },
  { id: "cor-dourado", title: "Dourado", text: "Atenção: a espera passou de 60% do prazo, ou o prazo acabou e o alerta nasce no próximo minuto." },
  { id: "cor-cinza", title: "Cinza", text: "Dentro do prazo." },
  { id: "cor-anel", title: "Anel em volta da foto", text: "Quanto do prazo da etapa já passou. Cores iguais na Fila, no Quadro, na Jornada e no cabeçalho da conversa." },
];

/* ---------- Alertas ---------- */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O título do combinado sem repetir a cliente: "Retomar contato com Joana Lima" → "retomar contato". */
export function taskTitleFor(title: string, contactName: string | null): string {
  let t = title.trim();
  const full = contactName?.trim();
  for (const n of [full, firstName(full)].filter((x): x is string => !!x)) t = t.replace(new RegExp(`\\s+(com|para|de|da|do)\\s+${escapeRe(n)}\\s*$`, "i"), "");
  t = t.replace(/\s+(com|para)\s+(a cliente|o cliente|\+?\d[\d\s().-]{7,})\s*$/i, "").replace(/\s+[—-]\s+.*$/, "").trim();
  return t ? t[0].toLocaleLowerCase("pt-BR") + t.slice(1) : "combinado";
}
const ownerPart = (ownerName: string | null) => (ownerName ? `Dona: ${firstName(ownerName)}.` : "Sem dono.");
export const alertText = {
  wait: (o: { client: string; sinceMs: number; slaMinutes: number | null; ownerName: string | null; now: number }) =>
    `${o.client} espera resposta desde ${sinceLabel(o.sinceMs, o.now)}${o.slaMinutes ? ` (prazo ${o.slaMinutes} min)` : ""}. ${ownerPart(o.ownerName)}`,
  escalated: (o: { client: string; sinceMs: number; ownerName: string | null; now: number }) =>
    `Escalado: ${o.client} sem resposta desde ${sinceLabel(o.sinceMs, o.now)}. ${ownerPart(o.ownerName)}`,
  taskDue: (o: { title: string; contactName: string | null; client: string; overdue: boolean }) =>
    `${o.overdue ? "Combinado vencido" : "Combinado vencendo"}: ${taskTitleFor(o.title, o.contactName)} (${o.client}).`,
  offer: (client: string) => `A dona não respondeu. Pode assumir ${client}?`,
  claimed: (actor: string | null, client: string) => `${firstName(actor) ?? "Alguém"} assumiu a conversa de ${client}`,
  transferred: (actor: string | null, client: string) => `${firstName(actor) ?? "Alguém"} te passou a conversa de ${client}`,
  /** Lote 1A: outra pessoa respondeu a conversa da dona (a dona não muda). */
  repliedByOther: (actor: string | null, client: string) => `${firstName(actor) ?? "Outra pessoa"} respondeu a conversa de ${client}. Ela continua sua; se for para passar, use Transferir.`,
  birthday: (client: string, day: number, month: number) => `Aniversário de ${client} dia ${pad(day)}/${pad(month)}. Que tal mandar um parabéns?`,
  autoSendFailed: (client: string, why?: string) => `Mensagem automática para ${client} não saiu${why ? ` (${why})` : ""}. Abra a conversa e envie manualmente.`,
};

/* ---------- Sino ---------- */
export type AlertGroup = "espera" | "combinados" | "conversas" | "lembretes" | "sistema" | "outros";
export const ALERT_GROUP_ORDER: AlertGroup[] = ["espera", "combinados", "conversas", "lembretes", "sistema", "outros"];
export const ALERT_GROUP_TITLE: Record<AlertGroup, string> = {
  espera: "Esperando resposta", combinados: "Combinados", conversas: "Quem está com a conversa", lembretes: "Lembretes das clientes", sistema: "WhatsApp e envios", outros: "Outros",
};
const GROUP_OF: Record<string, AlertGroup> = {
  sem_resposta_minutos: "espera", tarefa_vencendo: "combinados", tarefa_vencida: "combinados",
  oferta: "conversas", assumiu_sua_conversa: "conversas", transferido_para_voce: "conversas", respondida_por_outra: "conversas",
  aniversario_em_dias: "lembretes", parado_dias: "lembretes", sem_retorno_cliente_dias: "lembretes", data_recontato: "lembretes", data_cobranca: "lembretes", agendamento_em_horas: "lembretes",
  whatsapp_desconectado: "sistema", whatsapp_sem_conexao: "sistema", envio_automatico_falhou: "sistema", webhook_falhou: "sistema", mensagem_sem_numero: "sistema",
};
export const ALERT_TYPES = Object.keys(GROUP_OF);
export const alertGroupOf = (type: string): AlertGroup => GROUP_OF[type] ?? "outros";
export const BELL_LEGEND = [{ tone: "alert", text: "Urgente" }, { tone: "gold", text: "Para saber" }, { tone: "ok", text: "Resolvido" }] as const;

const EX_NOW = Date.UTC(2026, 9, 15, 17, 30); // exemplos da ajuda: 14:30 em Salvador
const EX_SINCE = Date.UTC(2026, 9, 15, 17, 2); // 14:02
export const ALERT_HELP: (HelpEntry & { types: string[] })[] = [
  { id: "alerta-espera", types: ["sem_resposta_minutos"], title: "Espera passou do prazo",
    text: "A cliente escreveu e ninguém respondeu no prazo da etapa. Vai para a dona; sem dona, para a gestão. Some sozinho quando alguém responde.",
    example: alertText.wait({ client: "Fulana", sinceMs: EX_SINCE, slaMinutes: 15, ownerName: "Sara", now: EX_NOW }) },
  { id: "alerta-escalado", types: [], title: "Escalado para a gestão",
    text: "A espera continuou sem resposta e o mesmo aviso subiu para a gestão. A gestão decide se responde ou transfere.",
    example: alertText.escalated({ client: "Fulana", sinceMs: EX_SINCE, ownerName: "Sara", now: EX_NOW }) },
  { id: "alerta-combinado", types: ["tarefa_vencendo", "tarefa_vencida"], title: "Combinado vencendo ou vencido",
    text: "Uma próxima ação está para vencer (ou venceu). Nunca chega com a Casa fechada. Some quando o combinado é concluído.",
    example: alertText.taskDue({ title: "Retomar contato", contactName: "Fulana", client: "Fulana", overdue: false }) },
  { id: "alerta-oferta", types: ["oferta"], title: "Pode assumir?",
    text: "A dona não respondeu no prazo e a distribuição oferece a conversa para você. Toque em Assumir para ficar com ela.", example: alertText.offer("Fulana") },
  { id: "alerta-assumiu", types: ["assumiu_sua_conversa"], title: "Assumiu a sua conversa",
    text: "Outra pessoa ficou com uma conversa que era sua.", example: alertText.claimed("Cati", "Fulana") },
  { id: "alerta-passou", types: ["transferido_para_voce"], title: "Te passou a conversa",
    text: "Alguém transferiu uma conversa para você. Ela é sua agora.", example: alertText.transferred("Cati", "Fulana") },
  { id: "alerta-respondida", types: ["respondida_por_outra"], title: "Outra pessoa respondeu a sua conversa",
    text: "Alguém da equipe respondeu uma conversa que é sua (pelo CRM ou, pela assinatura, pelo celular). A conversa continua sua; se for para passar, use Transferir. Vem no máximo um aviso por dia para cada conversa.",
    example: alertText.repliedByOther("Cati", "Fulana") },
  { id: "alerta-aniversario", types: ["aniversario_em_dias"], title: "Aniversário chegando",
    text: "Uma cliente faz aniversário em breve. Não existe mensagem pronta: escreva o parabéns do seu jeito.", example: alertText.birthday("Fulana", 17, 10) },
  { id: "alerta-lembretes", types: ["parado_dias", "sem_retorno_cliente_dias", "data_recontato", "data_cobranca", "agendamento_em_horas"], title: "Lembretes das automações",
    text: "Avisos configurados em Configurações › Automações: conversa parada, cliente sem retorno, dia de recontato ou de cobrança." },
  { id: "alerta-whatsapp", types: ["whatsapp_desconectado", "whatsapp_sem_conexao"], title: "WhatsApp caiu",
    text: "Mensagens novas não estão chegando. Leia o QR code de novo em Configurações › WhatsApp." },
  { id: "alerta-envio", types: ["envio_automatico_falhou"], title: "Mensagem automática não saiu",
    text: "Uma mensagem automática não foi entregue. Abra a conversa e envie manualmente.", example: alertText.autoSendFailed("Fulana", "WhatsApp desconectado") },
  { id: "alerta-registro", types: ["webhook_falhou", "mensagem_sem_numero"], title: "Mensagem que não entrou no CRM",
    text: "Uma mensagem do WhatsApp não pôde ser registrada. Avise quem cuida do sistema." },
];

/* ---------- A página "O que cada aviso quer dizer" ---------- */
const COLOR_WORD = { alert: "Vermelha", gold: "Dourada", ok: "Verde" } as const;
export function helpCatalog(): HelpGroup[] {
  return [
    { id: "fila", title: "Seções da Fila", entries: [
      ...(Object.keys(SECTION_TITLE) as QueueSectionKey[]).map((k) => ({ id: `fila-${k}`, title: SECTION_TITLE[k], text: sectionHelp(k) })),
      { id: "fila-ela-veio", title: ATTENDANCE_TITLE, text: ATTENDANCE_HELP },
      { id: "fila-resumo", title: "Resumo do topo", text: SUMMARY_HELP },
    ] },
    { id: "linha", title: "Na linha de cada conversa", entries: [
      { id: "linha-prazo", title: "Prazo", text: "Um texto só: quanto falta para o prazo da etapa ou quanto já passou.", example: `${slaText(4 * 60, 15)} · ${slaText(19 * 60, 15)}` },
      { id: "linha-sem-dono", title: NO_OWNER, text: NO_OWNER_HINT },
      { id: "linha-quem-respondeu", title: "Cati: … e Dona: Sara · respondida por Cati", text: "Antes da última mensagem aparece quem da Casa escreveu (pela pessoa logada no CRM ou pela assinatura do celular). Quando quem respondeu não é a dona, a linha diz as duas." },
      { id: "linha-passou", title: "Fulana te passou esta conversa", text: "Outra pessoa transferiu a conversa e a nova dona ainda não respondeu. Some depois da primeira resposta." },
      { id: "linha-parado", title: "parado há N dias", text: "Ninguém decidiu o próximo passo desde que a conversa entrou nesta etapa." },
      ...Object.keys(CHIP_HELP).filter((k) => k !== NO_OWNER).map((k) => ({ id: `chip-${slug(k)}`, title: k, text: CHIP_HELP[k] })),
      ...SIGNAL_ORDER.map((s) => ({ id: `sinal-${s}`, title: SIGNAL_LABEL[s], text: SIGNAL_HELP[s] })),
      { id: "linha-interesse", title: "Interesse: serviço", text: INTEREST_HELP },
      { id: "linha-palavra-chave", title: "Palavra-chave", text: KEYWORD_HELP },
      { id: "linha-etiqueta", title: "Etiqueta (com borda)", text: TAG_HELP },
      { id: "linha-limite", title: "No máximo 2 sinais", text: "Cada linha mostra no máximo 2 sinais automáticos, os mais importantes primeiro." },
    ] },
    { id: "cores", title: "Cores e anel", entries: COLOR_HELP },
    { id: "conversa", title: "Na conversa", entries: [
      { id: "conversa-relogio", title: "Esperando há…", text: WAIT_CLOCK_HELP, example: waitClockText("12 min", 15) },
      { id: "conversa-por-que", title: "Por que está esperando", text: "Diz quem falou por último, quando (sempre com o dia) e por onde.", example: answeredText({ by: "Cati", fromPhone: true, at: "ontem 13:15" }) },
      { id: "conversa-responsavel", title: "Responsável", text: "Quem está cuidando da conversa. Assumir tira a conversa dela.", example: ownerHint("Sara", false) },
      { id: "conversa-compareceu", title: "Compareceu?", text: "Só aparece depois do horário marcado. Antes disso não dá para saber se ela veio." },
      { id: "conversa-encerrar", title: "Encerrar conversa", text: "Tira a conversa da Fila quando o atendimento terminou. Ela volta sozinha se a cliente escrever." },
    ] },
    { id: "sino", title: "Sino", entries: [
      { id: "sino-cores", title: "Bolinhas", text: BELL_LEGEND.map((l) => `${COLOR_WORD[l.tone]}: ${l.text.toLowerCase()}`).join(" · ") },
      { id: "sino-filtros", title: "Para mim e Para a gestão", text: "Para mim: avisos no seu nome. Para a gestão: avisos sem dona e escalados (só para quem recebe escaladas)." },
      { id: "sino-resolver", title: "Resolver", text: "Tira o aviso do sino quando você já cuidou. A espera não tem Resolver: some sozinha quando alguém responde." },
      ...ALERT_HELP.map(({ types: _types, ...e }) => e),
    ] },
    { id: "hoje", title: "Tela Hoje", entries: [
      { id: "hoje-equipe-agora", title: "Equipe agora", text: "Quem está respondendo (pelo CRM ou, pela assinatura, pelo celular), quantas conversas esperam cada uma e quantas estão sem dono." },
      { id: "hoje-sem-responsavel", title: "Sem responsável", text: "Combinados que não são de ninguém. Toda tarefa nova já vai para a dona da conversa ou, sem dona, para quem respondeu por último; esta aba mostra o que sobrou." },
      { id: "hoje-aniversarios", title: "Aniversários da semana", text: "Todas as clientes que fazem aniversário nos próximos 7 dias, com ou sem conversa aberta." },
    ] },
  ];
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/lib/alert-copy.test.ts`
Esperado: PASS.
Rode: `npm run typecheck`
Esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add src/lib/alert-copy.ts src/lib/alert-copy.test.ts
git commit -m "feat(avisos): módulo único de textos dos avisos (Fila, conversa, sino, ajuda)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B3: uma regra só de prazo (60%, vermelho só com alerta, mesmas cores)

**Arquivos:**
- Modificar: `src/lib/queue.ts:26-63`
- Modificar: `src/components/pipeline/timer.tsx:40-60`
- Modificar: `src/components/motion/elapsed.tsx`
- Modificar: `src/components/pipeline/deal-card.tsx` (as linhas do `urgency` e do `<Elapsed>`; a A6 já mexeu neste arquivo, então ache com `grep -n "useUrgencyLevel\|<Elapsed" src/components/pipeline/deal-card.tsx`)
- Modificar: `src/components/journey/station.tsx:15`
- Modificar: `src/components/today/waiting-list.tsx:32-78`
- Modificar: `src/components/lead/lead-sheet.tsx:149-162`
- Modificar: `src/components/queue/pane-header.tsx:33-50,68,112`
- Modificar: `src/components/queue/why-late.tsx`
- Modificar: `src/server/queries/deal.ts:34-90`
- Modificar: `src/server/queries/queue.ts:16-29`, só o tipo
- Teste: `src/lib/queue.test.ts:4-33`, `src/lib/board-order.test.ts:10-13`
- Teste novo: `src/components/pipeline/timer.test.ts` e `src/server/queries/deal-late.test.ts`

**Interfaces:**
- Consome: `slaText` (B2).
- Produz:
  - `NEAR_SLA_RATIO = 0.6`
  - `type SlaLevel = "none" | "ok" | "near" | "over" | "late"`
  - `slaLevel({ awaiting, alert, waitSeconds, slaMinutes }): SlaLevel`, a função única
  - `RING_COLOR: Record<RingState, string>`
  - `ringState({ awaiting, late, waitSeconds, slaMinutes })`, com a mesma assinatura. `late` agora significa só alerta aberto.
  - `slaStatus(...)` com os textos novos
  - `urgencyOf(sinceIso, slaMinutes, now, hours?, alert = false)`, `useUrgency(since, sla, alert = false)` e `useUrgencyLevel(since, sla, alert = false)`
  - Prop nova `alert?: boolean` em `<Elapsed>`
  - Campo novo `QueueItem.alert?: boolean`. O B4 preenche.
  - Campo novo `DealDetail.late: boolean`: há alerta de espera aberto (`lateExists`).

- [ ] **Passo 1: escrever os testes que falham**

Em `src/lib/queue.test.ts`, substitua o import e o `describe("anel de SLA", …)` (linhas 2-33):
```ts
import { NEAR_SLA_RATIO, parseQueueView, queueHref, queueQuery, ringState, slaLevel, slaProgress, slaStatus } from "./queue";

describe("regra única do prazo", () => {
  it("'quase no prazo' é 60% do prazo, em todas as telas", () => {
    expect(NEAR_SLA_RATIO).toBe(0.6);
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 71, slaMinutes: 2 })).toBe("ok");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 72, slaMinutes: 2 })).toBe("near");
  });
  it("vermelho só com alerta: passou do prazo sem alerta é 'over' (dourado)", () => {
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 360, slaMinutes: 2 })).toBe("over");
    expect(slaLevel({ awaiting: true, alert: true, waitSeconds: 1, slaMinutes: 2 })).toBe("late");
    expect(slaLevel({ awaiting: false, alert: false, waitSeconds: 0, slaMinutes: 2 })).toBe("none");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 500, slaMinutes: null })).toBe("ok");
    expect(ringState({ awaiting: true, late: false, waitSeconds: 360, slaMinutes: 2 })).toBe("near");
    expect(ringState({ awaiting: true, late: true, waitSeconds: 1, slaMinutes: 2 })).toBe("late");
  });
  it("um texto de prazo só, com o tom da regra", () => {
    const at = (waitSeconds: number, alert = false) => slaStatus({ ring: ringState({ awaiting: true, late: alert, waitSeconds, slaMinutes: 2 }), alert, waitSeconds, slaMinutes: 2 });
    expect(at(360)).toEqual({ text: "Responder agora: 4 min além do prazo", tone: "near" });
    expect(at(360, true)).toEqual({ text: "Responder agora: 4 min além do prazo", tone: "late" });
    expect(at(90)).toEqual({ text: "Responda em 1 min", tone: "near" });
    expect(at(30)).toEqual({ text: "Responda em 2 min", tone: "ok" });
    expect(slaStatus({ ring: "none", alert: false, waitSeconds: 0, slaMinutes: 2 })).toBeNull();
  });
  it("o progresso vai de 0 a 1 e trava no fim", () => {
    expect(slaProgress(30, 2)).toBe(0.25);
    expect(slaProgress(600, 2)).toBe(1);
    expect(slaProgress(10, null)).toBe(0);
  });
});
```

Em `src/lib/board-order.test.ts`, no teste "perto do prazo a partir de metade…":
```ts
  it("perto do prazo a partir de 60% do prazo da etapa", () => {
    expect(boardUrgency({ late: false, awaiting: true, waitSeconds: 72, slaMinutes: 2 })).toBe("near");
    expect(boardUrgency({ late: false, awaiting: true, waitSeconds: 71, slaMinutes: 2 })).toBe("waiting");
  });
```

Crie `src/components/pipeline/timer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { urgencyOf } from "./timer";
import { slaLevel } from "@/lib/queue";
import { businessSecondsBetween, type BusinessHours } from "@/lib/business-hours";

const allDay: [string, string] = ["00:00", "24:00"];
const H: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };
/** Horário da Casa (Lote 0): terça a sábado, 9h às 18h. */
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const now = Date.parse("2026-10-15T17:00:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("urgencyOf: a mesma regra da Fila (cabeçalho, Quadro, WhyLate)", () => {
  it("dourado a partir de 60% do prazo, nunca antes", () => {
    expect(urgencyOf(ago(8 * 60), 15, now, H)).toBe("ok"); // 53%
    expect(urgencyOf(ago(9 * 60), 15, now, H)).toBe("warn"); // 60%
  });
  it("vermelho só com alerta aberto; passou do prazo sem alerta continua dourado", () => {
    expect(urgencyOf(ago(20 * 60), 15, now, H)).toBe("warn");
    expect(urgencyOf(ago(20 * 60), 15, now, H, true)).toBe("late");
    expect(urgencyOf(null, 15, now, H, true)).toBe("late");
  });
  it("espera que atravessa dias fechados conta só o expediente (sábado 17:55 → terça 9:02 = 7 min de 15)", () => {
    const sabado = "2026-10-17T20:55:00Z"; // sábado 17:55 em Salvador
    const terca = Date.parse("2026-10-20T12:02:00Z"); // terça 9:02 (domingo e segunda fechados)
    expect(businessSecondsBetween(Date.parse(sabado), terca, CASA)).toBe(7 * 60);
    expect(urgencyOf(sabado, 15, terca, CASA)).toBe("ok");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: businessSecondsBetween(Date.parse(sabado), terca, CASA), slaMinutes: 15 })).toBe("ok");
  });
});
```

Crie `src/server/queries/deal-late.test.ts`:
```ts
import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { alerts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { getDealDetail } from "./deal";

beforeEach(async () => { await resetDb(); });
const lead = async (phone: string) => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}`, phoneRaw: phone, body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};

it("o detalhe diz se a espera tem alerta aberto (a regra do vermelho); aviso de tarefa não conta", async () => {
  const a = await lead("71999994441");
  const b = await lead("71999994442");
  expect((await getDealDetail(a))!.late).toBe(false);
  await db.insert(alerts).values({ dealId: a, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `${a}:2026-10-15T12:00:00.000Z` });
  await db.insert(alerts).values({ dealId: b, audience: "gestao", type: "tarefa_vencendo", severity: "info", message: "t", dedupeKey: "k2", waitKey: "task:abc" });
  expect((await getDealDetail(a))!.late).toBe(true);
  expect((await getDealDetail(b))!.late).toBe(false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/lib/queue.test.ts src/lib/board-order.test.ts src/components/pipeline/timer.test.ts src/server/queries/deal-late.test.ts`
Esperado: FAIL. As causas são `slaLevel` não exportado, `NEAR_SLA_RATIO` igual a 0.5, `urgencyOf` dando "late" sem alerta e `late` undefined. O caso "dias fechados" pode já passar no `businessSecondsBetween`; ele fica como guarda da regra.

- [ ] **Passo 3a: `src/lib/queue.ts`**

Substitua as linhas 1 e 26-63:
```ts
import { slaText } from "./alert-copy";
```
```ts
/** "Quase no prazo": a partir de 60% do prazo da etapa. A mesma regra na Fila, no Quadro, na Jornada, no cabeçalho, no WhyLate e no Hoje. */
export const NEAR_SLA_RATIO = 0.6;

/** Quanto do prazo já passou, de 0 a 1 (o anel de SLA); sem prazo ou sem espera, 0. */
export function slaProgress(waitSeconds: number, slaMinutes: number | null): number {
  if (!slaMinutes || slaMinutes <= 0 || waitSeconds <= 0) return 0;
  return Math.min(1, waitSeconds / (slaMinutes * 60));
}

export type SlaLevel = "none" | "ok" | "near" | "over" | "late";
/**
 * O estado do prazo: uma função só para todas as telas. `late` (vermelho) só existe com alerta de espera aberto. Passou do prazo
 * sem alerta ainda é `over` (dourado cheio): o alerta nasce no próximo ciclo do motor. `near` é a partir de NEAR_SLA_RATIO.
 */
export function slaLevel(o: { awaiting: boolean; alert: boolean; waitSeconds: number; slaMinutes: number | null }): SlaLevel {
  if (o.alert) return "late";
  if (!o.awaiting) return "none";
  if (!o.slaMinutes || o.slaMinutes <= 0) return "ok";
  const p = o.waitSeconds / (o.slaMinutes * 60);
  return p >= 1 ? "over" : p >= NEAR_SLA_RATIO ? "near" : "ok";
}

export type RingState = "none" | "ok" | "near" | "late";
/** As cores do anel, iguais na Fila, no Quadro, na Jornada e no cabeçalho. */
export const RING_COLOR: Record<RingState, string> = { none: "transparent", ok: "var(--color-graphite)", near: "var(--color-gold)", late: "var(--color-alert)" };

/** O anel: `late` é o alerta aberto (vermelho); passou do prazo sem alerta fica dourado (`near`). Ver `slaLevel`. */
export function ringState(opts: { awaiting: boolean; late: boolean; waitSeconds: number; slaMinutes: number | null }): RingState {
  const l = slaLevel({ awaiting: opts.awaiting, alert: opts.late, waitSeconds: opts.waitSeconds, slaMinutes: opts.slaMinutes });
  return l === "over" ? "near" : l;
}

/** O texto de prazo da linha (Fila, Hoje): um só, de `slaText`. Sem espera: null (quem chama escolhe outro texto). */
export function slaStatus(opts: { ring: RingState; alert: boolean; waitSeconds: number; slaMinutes: number | null }): { text: string; tone: "late" | "near" | "ok" } | null {
  if (opts.ring === "none") return null;
  return { text: slaText(opts.waitSeconds, opts.slaMinutes) ?? "Esperando resposta", tone: opts.ring === "late" ? "late" : opts.ring === "near" ? "near" : "ok" };
}
```
A linha 1 antiga, `import { seconds } from "./format";`, sai, porque o import fica sem uso.

- [ ] **Passo 3b: `src/components/pipeline/timer.tsx`** (linhas 40-60)

```ts
export type Urgency = "ok" | "warn" | "late";
/** A regra única (`slaLevel`): vermelho só com alerta aberto; dourado a partir de 60% do prazo, inclusive quando já passou sem alerta. */
export function urgencyOf(sinceIso: string | null, slaMinutes: number | null, now: number, hours: BusinessHours = DEFAULT_HOURS, alert = false): Urgency {
  if (alert) return "late";
  if (!sinceIso) return "ok";
  const level = slaLevel({ awaiting: true, alert: false, waitSeconds: businessSecondsBetween(new Date(sinceIso).getTime(), now, hours), slaMinutes });
  return level === "near" || level === "over" ? "warn" : "ok";
}

export function useUrgency(sinceIso: string | null, slaMinutes: number | null, alert = false) {
  const now = useNow();
  const hours = useContext(HoursCtx);
  const since = sinceIso ? new Date(sinceIso).getTime() : null;
  return { urgency: urgencyOf(sinceIso, slaMinutes, now, hours, alert), label: since != null ? fmtWait(businessSecondsBetween(since, now, hours)) : null };
}

/** Só o nível de urgência (ok, atenção, atrasado): re-renderiza quando ele muda, não a cada segundo. */
export function useUrgencyLevel(sinceIso: string | null, slaMinutes: number | null, alert = false): Urgency {
  const hours = useContext(HoursCtx);
  return useClock((now) => urgencyOf(sinceIso, slaMinutes, now, hours, alert));
}
```
No topo, acrescente: `import { slaLevel } from "@/lib/queue";`.

- [ ] **Passo 3c: `src/components/motion/elapsed.tsx`**

Acrescente a prop `alert` e passe-a para o `urgencyOf`:
```tsx
export function Elapsed({ since, sla, alert = false, format = fmtWait, wall, prefix, className }: {
  since: string | null; sla: number | null; /** Alerta de espera aberto: só ele pinta de vermelho. */ alert?: boolean; format?: (seconds: number) => string; /** Tempo corrido no relógio de parede (com dias), sem o horário de atendimento. */ wall?: boolean; prefix?: string; className?: string;
}) {
  const hours = useHours();
  const t = since ? new Date(since).getTime() : null;
  const key = useClock((now) => (t == null ? "" : `${urgencyOf(since, sla, now, hours, alert)}|${wall ? elapsed(since!, now) : format(businessSecondsBetween(t, now, hours))}`), t ?? undefined);
```

- [ ] **Passo 3d: Quadro, Jornada, Hoje e folha do Quadro**

Em `src/components/pipeline/deal-card.tsx`:
- no lugar da linha do `useUrgencyLevel`: `const alert = card.urgency === "late"; // alerta aberto (do servidor): a única coisa que pinta de vermelho`
- logo abaixo: `const urgency = useUrgencyLevel(card.awaitingReplySince, slaMinutes, alert);`
- as linhas do relógio:
```tsx
            <IconClock size={13} aria-hidden /><span className="sr-only">Esperando resposta há </span><span aria-hidden>Esperando · </span>
            <Elapsed since={card.awaitingReplySince} sla={slaMinutes} alert={alert} />
```
O prefixo "Cati:" e o "respondida por" da A6 ficam como estão.

Em `src/components/journey/station.tsx`:
- apague a linha 15 (o `RING_COLOR` local);
- troque o import da linha 9 por `import { RING_COLOR, type RingState } from "@/lib/queue";`. O import de `firstName` da A7 fica.

Em `src/components/today/waiting-list.tsx`:
- linha 42: `const red = !!i.late, gold = !red && level === "near";`
- linha 70, no `StatusText`: `return slaStatus({ ring, alert: !!i.late, waitSeconds, slaMinutes: i.slaMinutes })?.text ?? "Esperando resposta";`
- o comentário das linhas 32-35 passa a ser:
```ts
/**
 * A regra única (`slaLevel`): vermelho é o alerta de espera aberto (`late`, o mesmo do contador); passou do prazo sem alerta ainda: dourado.
 * O texto vem de `slaStatus`, o mesmo da linha da Fila.
 */
```

Em `src/components/lead/lead-sheet.tsx` (`WaitPill`, linhas 149-162):
```tsx
function WaitPill({ since, sla, alert, hidden }: { since: string | null; sla: number | null; alert: boolean; hidden: boolean }) {
  const urgency = useUrgencyLevel(since, sla, alert);
  return (
    <AnimatePresence initial={false}>
      {since && !hidden && (
        <motion.div key="wait" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: T.enter, ease: EASE }}>
          <p title={WAIT_CLOCK_HELP} className={`mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-sm font-semibold ${urgency === "late" ? "bg-alert text-white" : urgency === "warn" ? "bg-gold-soft text-gold-ink" : "bg-paper-2 text-ink"}`}>
            <IconClock size={14} />{WAIT_CLOCK_PREFIX}<Elapsed since={since} sla={sla} alert={alert} />{waitClockSuffix(sla)}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```
Acrescente `import { WAIT_CLOCK_HELP, WAIT_CLOCK_PREFIX, waitClockSuffix } from "@/lib/alert-copy";`. No ponto onde o `WaitPill` é usado, passe `alert={d.late}`. Para achar: `grep -n "<WaitPill" src/components/lead/lead-sheet.tsx`.

- [ ] **Passo 3e: `DealDetail.late`, `QueueItem.alert` e quem consome**

Em `src/server/queries/deal.ts`:
- acrescente `import { lateExists } from "./late-count";`;
- no `Promise.all` de `getDealDetail`, acrescente ao fim da desestruturação um `late` e ao fim do array:
```ts
    // Alerta de espera aberto: a única coisa que pinta a espera de vermelho (a regra do sino, da Fila e do Quadro).
    db.execute(sql`select ${lateExists(sql`${id}::uuid`)} as late`).then((r) => !!(r.rows[0] as { late?: boolean } | undefined)?.late),
```
- no objeto devolvido, acrescente `late,` logo depois de `...row,`.

Em `src/server/queries/queue.ts`, no tipo `QueueItem`, acrescente depois de `slaMinutes`:
```ts
  /** Alerta de espera aberto (o mesmo do sino): só ele pinta de vermelho. */
  alert?: boolean;
```

Em `src/components/queue/pane-header.tsx`:
```tsx
function SlaChip({ since, slaMinutes, alert, hidden }: { since: string | null; slaMinutes: number | null; alert: boolean; hidden: boolean }) {
  const urgency = useUrgencyLevel(since, slaMinutes, alert);
```
Dentro dele, troque `<Elapsed since={since} sla={slaMinutes} />` (duas vezes) por `<Elapsed since={since} sla={slaMinutes} alert={alert} />`. Depois da linha 69, acrescente `const alert = d ? d.late : !!item?.alert;`. Na linha 112, passe `alert={alert}` para o `<SlaChip>`.

Em `src/components/queue/why-late.tsx`:
```tsx
export function WhyLate({ awaitingSince, slaMinutes, alert = false, lastAt, lastDirection }: {
  awaitingSince: string | null; slaMinutes: number | null; alert?: boolean; lastAt?: string | null; lastDirection?: "in" | "out" | null;
}) {
  const now = useNow();
  const hours = useHours();
  const waiting = !!awaitingSince;
  if (!waiting && lastDirection !== "out") return null;
  const urgency = urgencyOf(awaitingSince, slaMinutes, now, hours, alert);
```
Em `src/components/queue/client-pane.tsx` (`grep -n "<WhyLate" src/components/queue/client-pane.tsx`), passe `alert={d.late}` ao `<WhyLate>`.

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/lib src/components src/server/queries/deal-late.test.ts src/server/queries/board.test.ts src/server/queries/journey.test.ts`
Esperado: PASS. Se `journey-status.test.ts` acusar um caso abaixo de 60%, troque só o tempo, para manter a intenção do teste. O caso de 75 s em 2 min dá 62,5% e continua "near".
Rode: `npm run typecheck`
Esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add src/lib/queue.ts src/lib/queue.test.ts src/lib/board-order.test.ts src/components/pipeline/timer.tsx src/components/pipeline/timer.test.ts src/components/motion/elapsed.tsx src/components/pipeline/deal-card.tsx src/components/journey/station.tsx src/components/today/waiting-list.tsx src/components/lead/lead-sheet.tsx src/components/queue/pane-header.tsx src/components/queue/why-late.tsx src/components/queue/client-pane.tsx src/server/queries/deal.ts src/server/queries/deal-late.test.ts src/server/queries/queue.ts
git commit -m "feat(avisos): regra única de prazo (60%, vermelho só com alerta, mesmas cores em todas as telas)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B4: Fila no servidor (sem "Prazo estourado", números do resumo, campos da linha)

**Arquivos:**
- Modificar: `src/lib/queue.ts:7-24`
- Modificar: `src/server/queries/queue.ts`: tipos (16-44), `transferredBy` (168-185), `getQueue` (240-388), `nextWaitingId` (391-398) e `getQueueItem` (404-416). Os números são de antes da A6; confirme com `grep -n`.
- Modificar: `src/components/queue/queue-list.tsx:17` e `src/components/queue/queue-item.tsx:71`, só para tirar a chave `estourado`
- Teste: `src/server/queries/queue.test.ts`, `src/server/queries/queue-signals.test.ts`

**Interfaces:**
- Consome: `slaLevel` (B3), `transferText` (B2), `signalsOf` (B1) e, da A6, os campos `Light.ownerShort/lastReplyById/lastReplyName`, o helper `repliedBy(r)` e o `lastAuthorName` de `details`.
- Produz:
  - `QueueSectionKey` sem `"estourado"`. `SECTION_ORDER` fica `["atrasados","perto","aguardando","acoes-hoje","parados","aguardando-cliente","reengajar","arquivadas"]`.
  - `QUEUE_FOCOS` ganha `"combinados"`, com `FOCO_LABEL.combinados = "Combinados vencidos"`. `VIEW_LABEL.arquivadas` vira `"Encerradas"`.
  - Campos novos em `QueueItem` (os da A6 continuam):
    - `badges?: string[]`: Novo, Agendado hoje ou amanhã
    - `signals: string[]`: só sinais automáticos, no máximo 2
    - `stoppedDays?: number`
    - `transferNote?: string`
    - `alert?: boolean`
  - `QueueSection` ganha `n?: number`: o menor tempo que falta em "perto", o menor número de dias em "parados".
  - `counts.atrasados` passa a ser o tamanho da seção Atrasados: alerta OU prazo passado. O sino continua contando só alerta.
  - `nextWaitingId` ignora conversa encerrada.

- [ ] **Passo 1: escrever e ajustar os testes**

Em `src/server/queries/queue.test.ts`:

1. No primeiro teste, troque `const perto = await lead({ awaitingReplySince: ago(1.2) }); // 60% do prazo` por:
```ts
    const perto = await lead({ awaitingReplySince: ago(1.3) }); // 65% do prazo
```
2. Substitua o teste "prazo já estourado sem alerta ainda…" por:
```ts
  it("passou do prazo sem alerta ainda: já entra em Atrasados (não existe 'Prazo estourado'); só quem tem alerta é vermelho", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const perto = await lead({ awaitingReplySince: ago(1.3) }); // 65% do prazo de 2 min
    const estourado = await lead({ awaitingReplySince: ago(5) }); // passou do prazo; o motor ainda não gerou o alerta
    const atrasado = await lead({ awaitingReplySince: ago(30) });
    await lateAlert(atrasado.id);
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(keys(q)).toEqual(["atrasados", "perto"]);
    expect(ids(q, "atrasados")).toEqual([atrasado.id, estourado.id]);
    expect(ids(q, "perto")).toEqual([perto.id]);
    expect(q.sections[0].items.map((i) => !!i.alert)).toEqual([true, false]);
    expect(q.counts.atrasados).toBe(2);
    expect(await countLateLeads(asUser(gestora))).toBe(1); // o sino conta só alerta; a diferença dura até o próximo ciclo do motor
  });
```
3. Substitua o teste "perto do prazo é acima de 50%…" por:
```ts
  it("quase no prazo é a partir de 60% do prazo da etapa, contado só no expediente; a seção diz quantos minutos faltam", async () => {
    const { gestora, lead } = await setup();
    const abaixo = await lead({ awaitingReplySince: ago(1.1) }); // 55% de 2 min
    const acima = await lead({ awaitingReplySince: ago(1.3) }); // 65%: faltam 42 s
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "aguardando")).toEqual([abaixo.id]);
    expect(ids(q, "perto")).toEqual([acima.id]);
    expect(q.sections.find((s) => s.key === "perto")!.n).toBe(1);
  });
```
4. No teste "sem próxima ação há mais que stale_days…", acrescente ao fim:
```ts
    const sec = q.sections.find((s) => s.key === "parados")!;
    expect(sec.items[0].stoppedDays).toBe(3);
    expect(sec.n).toBe(3);
```
5. No teste "próximas ações de hoje…", troque as duas últimas linhas por:
```ts
    expect(item.signals).toEqual([]);
    expect(item.badges ?? []).not.toContain("Tarefa atrasada"); // o "venceu" já está no texto da linha
```
6. No teste "o item traz tudo que a linha mostra", troque a última linha por:
```ts
    const it0 = q.sections[0].items[0];
    expect(it0.badges ?? []).not.toContain("Cliente"); // "Cliente" mora no painel, não na linha
    expect(it0.signals).not.toContain("Sem dono");
```
7. Acrescente ao `describe("getQueue: seções por urgência")`:
```ts
  it("foco 'combinados' (resumo: combinados vencidos) mostra só quem tem tarefa vencida", async () => {
    const { gestora, lead } = await setup();
    const vencida = await lead({ last: { direction: "out" } });
    const futura = await lead({ last: { direction: "out" } });
    await db.insert(tasks).values([
      { dealId: vencida.id, contactId: vencida.contactId, kind: "proxima_acao", title: "Retomar", dueAt: ago(60 * 26) },
      { dealId: futura.id, contactId: futura.contactId, kind: "proxima_acao", title: "Depois", dueAt: new Date(NOW.getTime() + 86_400_000) },
    ]);
    const q = await getQueue(asUser(gestora), { now: NOW, foco: "combinados" });
    expect(all(q)).toEqual([vencida.id]);
    expect(q.counts.tarefasAtrasadas).toBe(1);
  });

  it("nextWaitingId pula conversa encerrada", async () => {
    const { ana, lead } = await setup();
    const a = await lead({ ownerId: ana.id, awaitingReplySince: ago(5) });
    await lead({ ownerId: ana.id, awaitingReplySince: ago(30), conversationArchivedAt: ago(1) });
    expect(await nextWaitingId(asUser(ana), "00000000-0000-4000-8000-000000000000")).toBe(a.id);
  });
```
O teste "quem respondeu" da A6 continua no arquivo e tem de continuar passando.

Em `src/server/queries/queue-signals.test.ts`:
- teste "interesse pelo serviço…": troque a linha `expect(it.signals.filter(…)…)` por:
```ts
    expect(it.signals.length).toBeLessThanOrEqual(2); // só sinais automáticos, no máximo 2
    expect(it.badges).toContain("Novo"); // estado fica separado dos sinais
```
- teste "'Transferida por Bruna'…": troque o corpo depois do `transferDeal` por:
```ts
    const it1 = (await itemsOf()).find((i) => i.name === "Rita")!;
    expect(it1.transferNote).toBe("Bruna passou para Ana"); // quem olha é a gestão
    const comoAna = (await getQueue({ id: ana.id, perms: permsFor("atendente") }, { now: NOW })).sections.flatMap((s) => s.items).find((i) => i.name === "Rita")!;
    expect(comoAna.transferNote).toBe("Bruna te passou esta conversa");
    // a Ana respondeu (1 s depois: o evento usa o relógio do banco, que no Docker do Mac pode estar adiantado)
    await db.update(deals).set({ lastOutboundAt: new Date(Date.now() + 1000) }).where(eq(deals.id, id));
    expect((await itemsOf()).find((i) => i.name === "Rita")!.transferNote).toBeUndefined();
```
- teste "quem pega para si…": `expect((await itemsOf()).find((i) => i.name === "Sol")!.transferNote).toBeUndefined();`
- renomeie os dois testes para "'Bruna te passou esta conversa' até a nova responsável responder" e mantenha "quem pega para si (assumir) não vira transferida".

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/queries/queue.test.ts src/server/queries/queue-signals.test.ts`
Esperado: FAIL. As causas são a seção `estourado`, `n` undefined, `badges` undefined, `transferNote` undefined e o foco `combinados` desconhecido.

- [ ] **Passo 3a: `src/lib/queue.ts` (linhas 7-24)**

```ts
export const VIEW_LABEL: Record<QueueView, string> = {
  todos: "Todos", meus: "Meus leads", "sem-dono": "Sem dono", parados: "Parados", "agendados-hoje": "Agendados hoje",
  "clientes-ativos": "Clientes ativos", "sem-contato-90d": "Sem contato há 90 dias", arquivadas: "Encerradas",
};
export const parseQueueView = (v: unknown): QueueView => ((QUEUE_VIEWS as readonly unknown[]).includes(v) ? (v as QueueView) : "todos");

export type QueueSectionKey = "atrasados" | "perto" | "aguardando" | "acoes-hoje" | "parados" | "aguardando-cliente" | "reengajar" | "arquivadas";
export const SECTION_ORDER: QueueSectionKey[] = ["atrasados", "perto", "aguardando", "acoes-hoje", "parados", "aguardando-cliente", "reengajar", "arquivadas"];
export const SECTION_LABEL: Record<QueueSectionKey, string> = {
  atrasados: "Atrasados", perto: "Perto do prazo", aguardando: "Aguardando resposta", "acoes-hoje": "Próximas ações de hoje",
  parados: "Parados", "aguardando-cliente": "Aguardando a cliente", reengajar: "Para reengajar", arquivadas: "Arquivadas",
};

/** Os números do resumo da Fila (chips). Parâmetro da própria Fila, não o `filtro` dos relatórios: mesmo escopo dos `counts`, sem "só os seus". */
export const QUEUE_FOCOS = ["aguardando", "atrasados", "combinados", "reclamacao", "evento"] as const;
export type QueueFoco = (typeof QUEUE_FOCOS)[number];
export const parseQueueFoco = (v: unknown): QueueFoco | null => ((QUEUE_FOCOS as readonly unknown[]).includes(v) ? (v as QueueFoco) : null);
export const FOCO_LABEL: Record<QueueFoco, string> = { aguardando: "Leads esperando resposta", atrasados: "Leads atrasados", combinados: "Combinados vencidos", reclamacao: "Reclamações", evento: "Eventos e noivas" };
```
O B5 troca `SECTION_LABEL` por `SECTION_TITLE`. Nesta tarefa ele só perde a chave `estourado`.

- [ ] **Passo 3b: tirar a chave `estourado` dos mapas de estilo**

- `src/components/queue/queue-list.tsx`: apague a linha 17 (`estourado: …`).
- `src/components/queue/queue-item.tsx`: apague a linha `estourado: { … }` do mapa `WEIGHT`.

- [ ] **Passo 3c: `src/server/queries/queue.ts`**

Troque o import da linha 10:
```ts
import { SECTION_ORDER, slaLevel, type QueueFoco, type QueueSectionKey, type QueueView } from "../../lib/queue";
import { transferText } from "../../lib/alert-copy";
```
(o import de `teamNameCol, teamNameOf` da A6 continua).

Substitua o tipo `QueueItem` e o `QueueSection` inteiros (mantendo os campos da A6):
```ts
export type QueueItem = {
  dealId: string; contactId: string; name: string; phone: string; hasAvatar: boolean;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null; slaMinutes: number | null;
  /** Alerta de espera aberto (o mesmo do sino): só ele pinta de vermelho. */
  alert?: boolean;
  lastMessage: string | null; lastKind: string | null; lastDirection: "in" | "out" | null;
  /** Última mensagem do lead (ISO); em "Para reengajar", a última do contato. */
  lastAt: string | null;
  stageKey: string; stageName: string; sourceLabel: string; ownerName: string | null;
  /** Nome da equipe da dona ("Cati"), quem escreveu a última mensagem da Casa e quem respondeu por último quando não é a dona (Lote 1A). */
  ownerShort?: string | null; lastAuthorName?: string | null; repliedByName?: string | null;
  nextAction?: { title: string; dueAt: string };
  /** Estado da conversa: Novo, Agendado hoje ou amanhã. */
  badges?: string[];
  /** Sinais automáticos das mensagens (risco, palavra-chave, interesse), no máximo 2. */
  signals: string[];
  /** Etiquetas da cliente (criadas pela equipe na conversa), mostradas separadas dos sinais. */
  tags: string[];
  /** Sem próxima ação e além do limite da etapa: há quantos dias está parada. */
  stoppedDays?: number;
  /** "Bruna te passou esta conversa" (para a nova dona) ou "Bruna passou para Ana" (para quem olha de fora), até a nova dona responder. */
  transferNote?: string;
};
/** `n`: o número da frase fixa da seção (minutos que faltam em "Quase no prazo"; dias parados em "Parados"), o menor da seção. */
export type QueueSection = { key: QueueSectionKey; items: QueueItem[]; n?: number };
```

Substitua `transferredBy`:
```ts
/**
 * Transferência ainda não respondida: a última troca de dona foi feita por outra pessoa (Transferir, atribuir em massa) e a nova dona
 * ainda não respondeu desde então. Assumir para si, distribuição automática e devolução à fila não marcam. Devolve o nome de quem passou.
 */
async function transferredBy(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = (await db.execute(sql`select distinct on (e.deal_id) e.deal_id, e.type, e.user_id, e.created_at, u.name, d.owner_id, d.last_outbound_at
    from deal_events e join deals d on d.id = e.deal_id left join users u on u.id = e.user_id
    where e.deal_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) and e.type in ('assumiu', 'responsavel_alterado', 'distribuido', 'devolvido_a_fila')
    order by e.deal_id, e.created_at desc`)).rows as { deal_id: string; type: string; user_id: string | null; created_at: Date; name: string | null; owner_id: string | null; last_outbound_at: Date | null }[];
  for (const r of rows) {
    if (r.type !== "responsavel_alterado" || !r.user_id || !r.owner_id || r.user_id === r.owner_id || !r.name) continue;
    if (r.last_outbound_at && new Date(r.last_outbound_at).getTime() >= new Date(r.created_at).getTime()) continue;
    out.set(r.deal_id, r.name);
  }
  return out;
}
```
Repare: o evento `assumiu` com `motivo: "assinatura"` (A3) também não marca transferência, porque só `responsavel_alterado` marca.

No comentário de `getQueue`, troque o trecho de seções por:
```ts
 * A Fila: os leads abertos de quem pediu, em seções por urgência. Cada lead cai em UMA seção, na primeira que valer:
 * atrasados (alerta de espera aberto, ou já passou do prazo e o alerta nasce no próximo ciclo do motor) → quase no prazo (≥ 60% do prazo,
 * em horas de expediente; `slaLevel`). Canal em modo quieto não tem prazo (o motor não avisa): fica em "esperando a Casa responder".
 * → esperando a Casa responder → combinados para hoje e atrasados → parados (sem próxima ação e além do `stale_days`) → bola com a cliente.
```

Substitua o bloco do tipo `Entry` e `entries`:
```ts
  type Entry = { r: Light; section: QueueSectionKey; waitSec: number; alert: boolean; stale: boolean; stoppedDays: number | null; leftMin: number | null;
    scheduledToday: boolean; scheduledTomorrow: boolean; overdueTask: boolean; noContact90: boolean; isNew: boolean; badges: string[] };
  const entries: Entry[] = rows.map((r) => {
    const awaiting = r.awaitingReplySince;
    const waitSec = awaiting ? businessSecondsBetween(awaiting.getTime(), nowMs, hours) : 0;
    const alert = lateIds.has(r.id);
    // Modo quieto suspende os avisos do canal: sem prazo correndo, o lead não aparece como atrasado nem quase no prazo.
    const timed = !alert && !!awaiting && !!r.slaMinutes && !(r.channelId && quietChannels.has(r.channelId));
    const level = timed ? slaLevel({ awaiting: true, alert: false, waitSeconds: waitSec, slaMinutes: r.slaMinutes }) : null;
    const taskDue = r.taskDueAt ? new Date(r.taskDueAt) : null;
    const actionToday = !!taskDue && taskDue.getTime() < today1;
    const stale = r.staleDays != null && r.stageEnteredAt.getTime() <= nowMs - r.staleDays * DAY_MS;
    const section: QueueSectionKey = alert || level === "over" ? "atrasados" : level === "near" ? "perto" : awaiting ? "aguardando" : actionToday ? "acoes-hoje" : stale && !taskDue ? "parados" : "aguardando-cliente";
    const stoppedDays = stale && !taskDue ? Math.max(1, Math.floor((nowMs - r.stageEnteredAt.getTime()) / DAY_MS)) : null;
    const leftMin = level === "near" ? Math.max(1, Math.ceil((r.slaMinutes! * 60 - waitSec) / 60)) : null;
    const scheduledToday = within(r.scheduledAt, today0, today1);
    const scheduledTomorrow = within(r.scheduledAt, today1, tomorrow1);
    const overdueTask = !!taskDue && taskDue.getTime() < nowMs;
    const isNew = !r.imported && within(r.createdAt, today0, today1);
    // Só estado de verdade: "Cliente" (74% das linhas) mora no painel; "Sem dono" já está na linha; "Tarefa atrasada" e "Parado" viram texto.
    const badges = [...(isNew ? ["Novo"] : []), ...(scheduledToday ? ["Agendado hoje"] : scheduledTomorrow ? ["Agendado amanhã"] : [])];
    return { r, section, waitSec, alert, stale, stoppedDays, leftMin, scheduledToday, scheduledTomorrow, overdueTask, noContact90: false, isNew, badges };
  });
```

No `focoTest`, acrescente `combinados: (e) => e.overdueTask,`.

No `order`, apague a entrada `estourado`.

Substitua o `picked`:
```ts
  const picked: { r: Light; section: QueueSectionKey; badges: string[] }[] = archivedView
    ? archivedRows.map((r) => ({ r, section: "arquivadas" as const, badges: [] as string[] })).sort((a, b) => time(b.r.lastAt) - time(a.r.lastAt))
    : reengage
    ? reengageRows.map((r) => ({ r, section: "reengajar" as const, badges: [] as string[] })).sort((a, b) => time(b.r.lastAt ?? b.r.createdAt) - time(a.r.lastAt ?? a.r.createdAt))
    // Reclamação, urgente e palavra-chave com "subir na Fila" vêm primeiro DENTRO da seção (nunca passam de seção).
    : SECTION_ORDER.flatMap((key) => wanted.filter((e) => e.section === key).sort((a, b) => Number(!!info.get(b.r.id)?.boost) - Number(!!info.get(a.r.id)?.boost) || order[key](a, b)));
```

Substitua a montagem das seções (o laço `for (const p of shown)` que a A6 já mexeu), mantendo os campos da A6:
```ts
  const byId = new Map(entries.map((e) => [e.r.id, e]));
  const sections: QueueSection[] = [];
  for (const p of shown) {
    const d = det.get(p.r.id);
    const r = p.r;
    const e = byId.get(r.id);
    const by = transfers.get(r.id);
    const item: QueueItem = {
      dealId: r.id, contactId: r.contactId, name: r.name?.trim() || r.phone, phone: r.phone, hasAvatar: d?.hasAvatar ?? false,
      awaitingSince: p.section === "reengajar" || !r.awaitingReplySince ? null : new Date(r.awaitingReplySince).toISOString(), slaMinutes: r.slaMinutes,
      lastMessage: d?.lastMessage ?? null, lastKind: d?.lastKind ?? null, lastDirection: r.lastDirection, lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
      stageKey: r.stageKey, stageName: r.stageName, sourceLabel: d?.sourceLabel ?? "",
      ownerName: r.ownerName, ownerShort: r.ownerShort, lastAuthorName: d?.lastAuthorName ?? null, repliedByName: repliedBy(r),
      ...(r.taskDueAt && d?.taskTitle && p.section !== "reengajar" ? { nextAction: { title: d.taskTitle, dueAt: new Date(r.taskDueAt).toISOString() } } : {}),
      badges: p.badges,
      signals: info.get(r.id)?.labels ?? [],
      tags: (tagMap.get(r.contactId) ?? []).map((t) => t.name),
      ...(e?.alert ? { alert: true } : {}),
      ...(e?.stoppedDays ? { stoppedDays: e.stoppedDays } : {}),
      ...(by ? { transferNote: transferText(by, r.ownerName, r.ownerId === user.id) } : {}),
    };
    const last = sections.at(-1);
    if (last && last.key === p.section) last.items.push(item); else sections.push({ key: p.section, items: [item] });
  }
  // O número da frase fixa: em "Quase no prazo", quantos minutos faltam para o primeiro estourar; em "Parados", há quantos dias (o menor).
  for (const s of sections) {
    const vals = s.items.map((i) => (s.key === "perto" ? byId.get(i.dealId)?.leftMin : s.key === "parados" ? byId.get(i.dealId)?.stoppedDays : null)).filter((v): v is number => v != null);
    if (vals.length) s.n = Math.min(...vals);
  }
```

Em `nextWaitingId`, acrescente `isNull(deals.conversationArchivedAt),` depois de `isNull(deals.archivedAt),` e acrescente ao comentário: "Conversa encerrada fica de fora: ela não está na Fila."

Em `getQueueItem`, troque `signals: [], tags: [],` por `badges: [], signals: [], tags: [],` (os campos `ownerShort`, `lastAuthorName` e `repliedByName` da A6 ficam).

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/queries src/server/domain/conversation-archive.test.ts src/server/domain/resume-later.test.ts`
Esperado: PASS (inclusive o teste "quem respondeu" da A6).
Rode: `npm run typecheck`
Esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add src/lib/queue.ts src/server/queries/queue.ts src/server/queries/queue.test.ts src/server/queries/queue-signals.test.ts src/components/queue/queue-list.tsx src/components/queue/queue-item.tsx
git commit -m "feat(fila): Prazo estourado entra em Atrasados; badges, sinais e transferência separados; parado há N dias; foco combinados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B5: Fila na tela (títulos com frase e "?", resumo, "Ela veio?", "Encerradas")

**Arquivos:**
- Modificar: `src/components/queue/queue-list.tsx:1-145`
- Modificar: `src/components/queue/queue-summary.tsx`
- Modificar: `src/components/queue/attendance-strip.tsx:24-50`
- Modificar: `src/components/queue/pane-header.tsx:91`
- Modificar: `src/components/queue/client-pane.tsx:229-234`
- Modificar: `src/lib/queue.ts`, onde sai o `SECTION_LABEL`
- Teste novo: `src/components/queue/queue-list.render.test.tsx` e `src/components/queue/queue-summary.render.test.tsx`
- Teste e2e: `e2e/fila.spec.ts:37-56`, `e2e/mobile.spec.ts:125-133`, `e2e/acoes-fila.spec.ts:270-272,311` e `e2e/relatorios.spec.ts:30`

**Interfaces:**
- Consome:
  - `SECTION_TITLE`, `sectionHelp`, `ATTENDANCE_TITLE`, `ATTENDANCE_HELP`, `HELP_HREF` e `SUMMARY_HELP` (B2)
  - `QueueSection.n` e `counts.views["sem-dono"]`, `counts.tarefasAtrasadas` e o foco `"combinados"` (B4)
- Produz:
  - Cada grupo da Fila ganha `aria-describedby="fila-<key>-ajuda"` com a frase fixa visível e um "?" (`data-ajuda`, `title` = frase). Não há nada clicável dentro do listbox.
  - Resumo: "N esperando resposta · N atrasados · N sem dono · N combinados vencidos · N agendados hoje" e o link "O que cada aviso quer dizer" para `/ajuda/avisos`.
  - A seção recolhida se chama "Bola com a cliente".
  - "Ela veio?" começa aberta.
  - A ação se chama sempre "Encerrar conversa".

- [ ] **Passo 1: escrever os testes que falham**

`src/components/queue/queue-list.render.test.tsx`:
```tsx
// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { QueueItem } from "@/server/queries/queue";
import { HoursProvider } from "@/components/pipeline/timer";
import type { BusinessHours } from "@/lib/business-hours";
import { QueueList } from "./queue-list";

const allDay: [string, string] = ["00:00", "24:00"];
const HOURS: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };
const item = (id: string): QueueItem => ({ dealId: id, contactId: id, name: `C${id}`, phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 15,
  lastMessage: "oi", lastKind: "text", lastDirection: "in", lastAt: null, stageKey: "lead", stageName: "Lead", sourceLabel: "", ownerName: null, signals: [], tags: [] });
afterEach(() => cleanup());

it("cada seção: título novo, frase fixa visível como descrição do grupo e '?' com a mesma frase; nada clicável além das conversas", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[
    { key: "atrasados", items: [item("1")] }, { key: "perto", n: 3, items: [item("2")] }, { key: "parados", n: 4, items: [item("3")] },
  ]} /></HoursProvider>);
  const groups = [...container.querySelectorAll("[role=group]")];
  const info = groups.map((g) => [
    container.querySelector(`#${g.getAttribute("aria-labelledby")}`)!.textContent,
    container.querySelector(`#${g.getAttribute("aria-describedby")}`)!.textContent,
  ]);
  expect(info).toEqual([
    ["Atrasados", "A cliente escreveu e ninguém respondeu no prazo. Responda primeiro."],
    ["Quase no prazo", "Responda em até 3 min."],
    ["Parados", "Há 4 dias ou mais sem ninguém decidir o próximo passo. Marque Agendar, Retomar depois ou Encerrar."],
  ]);
  expect(groups[0].querySelector("[data-ajuda]")!.getAttribute("title")).toBe(info[0][1]);
  expect(container.querySelectorAll("[role=listbox] button, [role=listbox] a:not([role=option])")).toHaveLength(0);
});

it("'Bola com a cliente' começa recolhida, com o nome novo no botão", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando", items: [item("1")] }, { key: "aguardando-cliente", items: [item("2")] }]} /></HoursProvider>);
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Bola com a cliente"))!;
  expect(btn.textContent).toContain("Bola com a cliente (1)");
  expect(btn.getAttribute("aria-expanded")).toBe("false");
});
```

`src/components/queue/queue-summary.render.test.tsx`:
```tsx
// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { QueueCounts } from "@/server/queries/queue";
import { QueueSummary } from "./queue-summary";
afterEach(() => cleanup());

it("resumo do topo: esperando, atrasados, sem dono, combinados vencidos e agendados hoje, cada um com o seu filtro; e o link da ajuda", () => {
  const counts: QueueCounts = { total: 9, aguardando: 3, atrasados: 1, perto: 0, agendadosHoje: 2, parados: 0, acoesHoje: 0, tarefasAtrasadas: 45, reclamacoes: 0, eventos: 0,
    views: { todos: 9, meus: 0, "sem-dono": 12, parados: 0, "agendados-hoje": 2, "clientes-ativos": 0, "sem-contato-90d": 0, arquivadas: 0 } };
  const { container } = render(<QueueSummary counts={counts} view="todos" foco={null} filtro={null} />);
  const links = [...container.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
  expect(links.slice(0, 5)).toEqual([
    ["3 esperando resposta", "/atendimento?foco=aguardando"], ["1 atrasado", "/atendimento?foco=atrasados"], ["12 sem dono", "/atendimento?view=sem-dono"],
    ["45 combinados vencidos", "/atendimento?foco=combinados"], ["2 agendados hoje", "/atendimento?view=agendados-hoje"],
  ]);
  expect(container.querySelector('a[href="/ajuda/avisos"]')!.textContent).toContain("O que cada aviso quer dizer");
});
```

e2e `e2e/fila.spec.ts`, linhas 37-56:
```ts
  // Ordem por urgência: atrasados, quase no prazo, esperando a Casa, combinados, parados, bola com a cliente.
  const ids = await fila.locator("[role=group]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby")));
  expect(ids).toEqual(["fila-atrasados", "fila-perto", "fila-aguardando", "fila-acoes-hoje", "fila-parados"]); // a sexta, bola com a cliente, começa recolhida
  const atrasados = fila.getByRole("group", { name: "Atrasados" });
  await expect(atrasados).toContainText("A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.");
  await expect(atrasados.getByRole("option", { name: /Valéria Nogueira/ })).toContainText(/Responder agora/);
  await expect(fila.getByRole("group", { name: "Quase no prazo" }).getByRole("option", { name: /Rosana Tavares/ })).toContainText(/Responda em/);
  await expect(fila.getByRole("group", { name: "Esperando a Casa responder" }).getByRole("option", { name: /Tatiane Moura/ })).toBeVisible();
  await expect(fila.getByRole("group", { name: "Combinados para hoje e atrasados" }).getByRole("option", { name: /Márcia Lopes/ })).toContainText(/Ligar com os valores · venceu hoje \d{2}:\d{2}/);
  await expect(fila.getByRole("group", { name: "Parados" }).getByRole("option", { name: /Priscila Andrade/ })).toContainText("parado há 3 dias");
  await shot(page, "02-desktop-sem-lead");
  // "Bola com a cliente" começa recolhida
  const recolhida = fila.getByRole("group", { name: "Bola com a cliente" });
  await expect(recolhida).toHaveCount(0);
  await expect(fila.getByRole("button")).toHaveCount(0); // nada interativo dentro do listbox além dos itens
  await page.getByRole("button", { name: /Bola com a cliente/ }).click();
  await expect(recolhida.getByRole("option", { name: /Elaine Pacheco/ })).toBeVisible();
  // resumo: cada número filtra
  const resumo = page.getByLabel("Resumo da fila");
  await expect(resumo).toContainText(/esperando resposta/);
  await expect(resumo).toContainText(/sem dono/);
  await expect(resumo.getByRole("link", { name: /atrasado/ })).toContainText(/^1 atrasado$/);
  await expect(page.getByRole("link", { name: /O que cada aviso quer dizer/ })).toHaveAttribute("href", "/ajuda/avisos");
```

`e2e/mobile.spec.ts`, linhas 125-133:
```ts
  const conferir = page.getByRole("region", { name: "Ela veio?" });
  await expect(conferir.getByRole("button", { name: /Ela veio\? \(\d+\)/ })).toHaveAttribute("aria-expanded", "true"); // começa aberta
  await expect(conferir.getByTestId("conferir-item").first()).toBeVisible();
  const first = page.getByRole("option").first();
  await expect(first).toBeVisible();
```
As linhas que medem a caixa da opção e a barra de baixo ficam como estão. A antiga linha 132, que clicava para abrir, sai.

`e2e/acoes-fila.spec.ts`:
- linhas 270-271: `const conferir = page.getByRole("region", { name: "Ela veio?" });` e `const abre = conferir.getByRole("button", { name: /Ela veio\?/ });`
- linha 272: o comentário vira `// começa aberta`;
- linha 311: `await expect(page.getByRole("region", { name: "Ela veio?" })).toHaveCount(0);`

`e2e/relatorios.spec.ts:30`: `await page.getByRole("button", { name: /Bola com a cliente/ }).click(); // a Casa já respondeu: fica em "Bola com a cliente", seção recolhida`

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/components/queue/queue-list.render.test.tsx src/components/queue/queue-summary.render.test.tsx`
Esperado: FAIL. Faltam `aria-describedby`, o texto "Quase no prazo", o link "sem dono" e o link da ajuda.

- [ ] **Passo 3a: `src/components/queue/queue-list.tsx`**

Troque o import da linha 5 por:
```ts
import type { QueueSectionKey } from "@/lib/queue";
import { SECTION_TITLE, sectionHelp } from "@/lib/alert-copy";
```
Substitua o bloco do grupo (linhas 119-125):
```tsx
          const headId = `fila-${s.key}`;
          const help = sectionHelp(s.key, s.n);
          return (
            <div key={s.key} role="group" aria-labelledby={headId} aria-describedby={`${headId}-ajuda`} className="relative">
              <div className={cn("sticky top-0 z-[1] px-4", HEAD[s.key])}>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5" role="presentation">
                    <span id={headId} role="presentation">{SECTION_TITLE[s.key]}</span>
                    {/* "?" só desenho com dica: a frase já está escrita logo abaixo e é a descrição do grupo (nada clicável dentro do listbox). */}
                    <span aria-hidden data-ajuda="" title={help} className="grid size-4 cursor-help place-items-center rounded-full border border-current text-[10px] font-semibold leading-none opacity-70">?</span>
                  </span>
                  <span className="tabular opacity-90" role="presentation">{s.items.length}</span>
                </div>
                <p id={`${headId}-ajuda`} role="presentation" className="pb-1 font-sans text-[12px] font-normal leading-snug opacity-85">{help}</p>
              </div>
```
Na linha 139, use `SECTION_TITLE["aguardando-cliente"]`. No comentário da linha 53, troque "Aguardando a cliente" por "Bola com a cliente".

- [ ] **Passo 3b: `src/lib/queue.ts`**

Apague o `SECTION_LABEL` inteiro. `SECTION_TITLE` (B2) é o único dono dos títulos. Confira que não sobrou uso: `grep -rn SECTION_LABEL src` deve voltar vazio.

- [ ] **Passo 3c: `src/components/queue/queue-summary.tsx`**

```tsx
import Link from "next/link";
import type { QueueCounts } from "@/server/queries/queue";
import { queueHref, type QueueFoco } from "@/lib/queue";
import { HELP_HREF, SUMMARY_HELP } from "@/lib/alert-copy";
import { cn } from "@/lib/cn";
import { ChangeFlash } from "@/components/motion/change-flash";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "12 esperando · 3 atrasados · 12 sem dono · 45 combinados vencidos · 5 agendados hoje": cada número é um link que filtra a Fila
 * (foco ou visão), com o mesmo escopo dos números mostrados; clicar de novo tira o filtro. No fim, a ajuda dos avisos.
 * No celular ficam numa linha só, com rolagem para o lado: sobra altura para a lista.
 */
export function QueueSummary({ counts, view, foco, filtro }: { counts: QueueCounts; view: string; foco: QueueFoco | null; filtro: string | null }) {
  const semDono = counts.views["sem-dono"] ?? 0;
  const items = [
    { key: "aguardando", label: plural(counts.aguardando, "esperando resposta", "esperando resposta"), href: queueHref({ foco: "aguardando" }), on: foco === "aguardando", tone: "" },
    { key: "atrasados", label: plural(counts.atrasados, "atrasado", "atrasados"), href: queueHref({ foco: "atrasados" }), on: foco === "atrasados", tone: counts.atrasados ? "text-alert font-semibold" : "" },
    { key: "sem-dono", label: plural(semDono, "sem dono", "sem dono"), href: queueHref({ view: "sem-dono" }), on: view === "sem-dono" && !filtro && !foco, tone: semDono ? "text-gold-ink" : "" },
    { key: "combinados", label: plural(counts.tarefasAtrasadas, "combinado vencido", "combinados vencidos"), href: queueHref({ foco: "combinados" }), on: foco === "combinados", tone: counts.tarefasAtrasadas ? "text-gold-ink" : "" },
    { key: "agendados-hoje", label: plural(counts.agendadosHoje, "agendado hoje", "agendados hoje"), href: queueHref({ view: "agendados-hoje" }), on: view === "agendados-hoje" && !filtro && !foco, tone: "" },
    // Sinais das mensagens: só aparecem quando há (ou quando o filtro está ligado).
    ...((counts.reclamacoes ?? 0) || foco === "reclamacao" ? [{ key: "reclamacao", label: plural(counts.reclamacoes ?? 0, "reclamação", "reclamações"), href: queueHref({ foco: "reclamacao" }), on: foco === "reclamacao", tone: counts.reclamacoes ? "text-alert" : "" }] : []),
    ...((counts.eventos ?? 0) || foco === "evento" ? [{ key: "evento", label: plural(counts.eventos ?? 0, "evento/noiva", "eventos/noivas"), href: queueHref({ foco: "evento" }), on: foco === "evento", tone: "" }] : []),
  ];
  return (
    <p className="mt-2.5 flex items-center gap-x-1 text-sm lg:text-[13px] text-graphite max-lg:-ml-2 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] lg:flex-wrap" aria-label="Resumo da fila">
      {items.map((it) => (
        <Link key={it.key} href={it.on ? queueHref({ view: "todos" }) : it.href} replace scroll={false} aria-current={it.on ? "true" : undefined}
          className={cn("inline-flex shrink-0 whitespace-nowrap items-center min-h-11 lg:min-h-8 px-2 rounded-[var(--radius-control)] tabular hover:bg-paper-2 hover:text-ink", it.tone, it.on && "bg-ink text-paper hover:bg-ink hover:text-paper")}>
          {/* O número que mudou (chegou gente esperando, alguém atrasou) brilha 600 ms; o filtro ligado fica sem brilho (texto claro em fundo escuro). */}
          <ChangeFlash value={it.label} disabled={it.on}>{it.label}</ChangeFlash>
        </Link>
      ))}
      <Link href={HELP_HREF} title={SUMMARY_HELP} className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 min-h-11 lg:min-h-8 px-2 rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink">
        <span aria-hidden className="grid size-4 place-items-center rounded-full border border-current text-[10px] font-semibold leading-none">?</span>O que cada aviso quer dizer
      </Link>
    </p>
  );
}
```

- [ ] **Passo 3d: `src/components/queue/attendance-strip.tsx`**

Acrescente `import { ATTENDANCE_HELP, ATTENDANCE_TITLE } from "@/lib/alert-copy";`. Na linha 29, use `const [open, setOpen] = useState(true); // começa aberta: é pendência`. Substitua as linhas 43-50:
```tsx
    <section aria-label={ATTENDANCE_TITLE} className="shrink-0 border-b border-line bg-gold-soft/50 px-4">
      <h2 className="m-0">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="conferir-lista"
          className="flex w-full min-h-11 lg:min-h-9 items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-gold-ink">
          <span>{ATTENDANCE_TITLE} <span className="tabular">({list.length})</span></span>
          <span aria-hidden className={cn("text-[10px] transition-transform", open && "rotate-180")}>▼</span>
        </button>
      </h2>
      {open && <p className="-mt-1 pb-1 text-[12px] text-gold-ink/90">{ATTENDANCE_HELP}</p>}
      {open && <ul id="conferir-lista" className="flex max-h-28 lg:max-h-44 flex-col overflow-y-auto overscroll-contain pb-2">
```
Atualize o comentário das linhas 18-23: "Ela veio?" começa aberta, porque é pendência, e no celular a lista mostra no máximo 2 itens e rola.

- [ ] **Passo 3e: uma ação só, "Encerrar conversa"**

- `src/components/queue/pane-header.tsx:91`: `[{ label: "Encerrar conversa", onSelect: actions.archiveConversation }]`
- `src/components/queue/client-pane.tsx:229-234`:
```tsx
          {d.deal.conversationArchivedAt && (
            <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2.5 text-sm text-graphite">
              <span>Conversa encerrada. Volta sozinha se a cliente escrever.</span>
              <button type="button" disabled={actions.busy} onClick={actions.unarchiveConversation} className={link}>Reabrir conversa</button>
            </p>
          )}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/components/queue`
Esperado: PASS.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.
Rode: `npx playwright test e2e/fila.spec.ts e2e/mobile.spec.ts e2e/acoes-fila.spec.ts e2e/relatorios.spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/components/queue/queue-list.tsx src/components/queue/queue-summary.tsx src/components/queue/attendance-strip.tsx src/components/queue/pane-header.tsx src/components/queue/client-pane.tsx src/lib/queue.ts src/components/queue/queue-list.render.test.tsx src/components/queue/queue-summary.render.test.tsx e2e/fila.spec.ts e2e/mobile.spec.ts e2e/acoes-fila.spec.ts e2e/relatorios.spec.ts
git commit -m "feat(fila): seções com nome novo, frase fixa e ?, resumo com sem dono e combinados vencidos, Ela veio? aberta, Encerradas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B6: linha da conversa (um texto de prazo, chips enxutos, "Sem dono" com dica, "te passou")

**Arquivos:**
- Modificar: `src/components/queue/queue-item.tsx`
- Teste: `src/components/queue/queue-item.render.test.tsx`, só acréscimos
- Teste e2e: `e2e/cliente.spec.ts:51`

**Interfaces:**
- Consome:
  - `RING_COLOR`, `ringState` e `slaStatus` (B3)
  - `ARCHIVED_ROW`, `NO_OWNER`, `NO_OWNER_HINT`, `TAG_HELP`, `chipHelp`, `dueText` e `stoppedText` (B2)
  - os campos `alert`, `badges`, `signals`, `stoppedDays` e `transferNote` do `QueueItem` (B4)
  - da A6: `lastMessagePrefix`, `ownerLine`, `stripSignature` e os campos `ownerShort`, `lastAuthorName`, `repliedByName`
- Produz:
  - `[data-sem-dono]` com `title` = dica
  - `[data-badge]`, `[data-signal]` (com `title`), `[data-tag]` agrupados à parte e `[data-transfer]`
  - na seção Atrasados, item sem alerta usa o estilo dourado
  - o prefixo "Cati:" e "Dona: Sara · respondida por Cati" da A6 continuam

- [ ] **Passo 1: escrever os testes que falham**

Acrescente ao fim de `src/components/queue/queue-item.render.test.tsx` (o teste da A6 continua lá):
```tsx
const base: QueueItem = { dealId: "x", contactId: "x", name: "Ana", phone: "+55", hasAvatar: false, awaitingSince: null, slaMinutes: 15, lastMessage: "oi", lastKind: "text",
  lastDirection: "out", lastAt: null, stageKey: "atendimento", stageName: "Atendimento", sourceLabel: "Não identificada", ownerName: null, signals: [], tags: [] };

it("linha enxuta: sem origem desconhecida, 'Sem dono' com dica, sinais com dica e etiquetas da equipe à parte", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items: [
    { ...base, badges: ["Novo"], signals: ["Pediu horário"], tags: ["Uso de imagem"], transferNote: "Cati te passou esta conversa" },
  ] }]} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  expect(row.textContent).not.toContain("Não identificada");
  expect(row.querySelector("[data-sem-dono]")!.getAttribute("title")).toBe("Ninguém assumiu. Toque em Assumir se for você.");
  expect(row.querySelector("[data-signal]")!.getAttribute("title")).toMatch(/horário/);
  expect(row.querySelector("[data-badge]")!.textContent).toBe("Novo");
  expect(row.querySelector("[data-tag]")!.textContent).toBe("Uso de imagem");
  expect(row.querySelector("[data-transfer]")!.textContent).toBe("Cati te passou esta conversa");
});

it("um texto de prazo só; sem alerta não fica vermelho mesmo depois do prazo", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T17:30:00Z"));
  const since = new Date(Date.now() - 19 * 60_000).toISOString();
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "atrasados", items: [{ ...base, awaitingSince: since, lastDirection: "in" }] }]} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  expect(row.textContent).toContain("Responder agora: 4 min além do prazo");
  expect(row.className).not.toContain("bg-alert-soft");
});

it("combinado vencido mostra o dia; parado mostra há quantos dias", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T17:30:00Z")); // 14:30 em Salvador
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[
    { key: "acoes-hoje", items: [{ ...base, dealId: "a", nextAction: { title: "Retomar contato", dueAt: "2026-10-14T16:00:00Z" } }] },
    { key: "parados", items: [{ ...base, dealId: "b", stoppedDays: 3 }] },
  ]} /></HoursProvider>);
  const [a, b] = [...container.querySelectorAll("[role=option]")];
  expect(a.textContent).toContain("Retomar contato · venceu ontem 13:00");
  expect(b.textContent).toContain("parado há 3 dias");
});

it("sem dono e respondida por alguém: a dica do 'Sem dono' continua e o nome de quem respondeu aparece", () => {
  const { container } = render(<HoursProvider hours={HOURS}><QueueList sections={[{ key: "aguardando-cliente", items: [
    { ...base, lastMessage: "*CATI - CASA FIAES:*\nJá te mando", lastAuthorName: "Cati", repliedByName: "Cati" },
  ] }]} /></HoursProvider>);
  const row = container.querySelector("[role=option]")!;
  expect(row.textContent).toContain("Cati: Já te mando");
  expect(row.querySelector("[data-sem-dono]")!.textContent).toContain("Sem dono · respondida por Cati");
});
```
Se `vi` ainda não estiver no import do `vitest` do arquivo, acrescente, e garanta `afterEach(() => { vi.useRealTimers(); cleanup(); })`.

e2e `e2e/cliente.spec.ts:51`:
```ts
  await expect(page.getByRole("option", { name: /Bianca Teles/ })).toContainText(/Responder agora: [345] min além do prazo/);
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/components/queue/queue-item.render.test.tsx`
Esperado: FAIL. Faltam `[data-sem-dono]`, o texto "Responder agora…" e o "venceu ontem".

- [ ] **Passo 3: implementar em `src/components/queue/queue-item.tsx`**

Troque os imports de `@/lib/queue`, `@/lib/source-kinds` e `@/lib/cn` e apague o `RING_COLOR` local da linha 19. Os imports da A6 (`lastMessagePrefix`, `ownerLine`, `stripSignature`) ficam:
```ts
import { RING_COLOR, ringState, slaProgress, slaStatus, type QueueSectionKey, type RingState } from "@/lib/queue";
import { ARCHIVED_ROW, NO_OWNER, NO_OWNER_HINT, TAG_HELP, chipHelp, dueText, stoppedText } from "@/lib/alert-copy";
import { NOT_IDENTIFIED, isChannelOrigin } from "@/lib/source-kinds";
import { cn } from "@/lib/cn";
```
No `Ring`, a linha do círculo usa `stroke={RING_COLOR[state]}`, sem mudança de código.

Substitua `waitOf`, `RowRing` e `RowTime`:
```tsx
/** Quanto o lead espera e o estado do anel. Vermelho só com alerta aberto (`alert`): a regra única de `slaLevel`. */
function waitOf(alert: boolean, since: number | null, slaMinutes: number | null, now: number, hours: BusinessHours) {
  const waitSec = since != null ? businessSecondsBetween(since, now, hours) : 0;
  const ring = ringState({ awaiting: since != null, late: alert, waitSeconds: waitSec, slaMinutes });
  return { waitSec, ring, progress: ring === "late" ? 1 : slaProgress(waitSec, slaMinutes) };
}

/** Folha do anel: escuta o relógio sozinha e só re-renderiza quando o anel muda de fato (a cada 1% do prazo), nunca a linha inteira. */
function RowRing({ alert, since, slaMinutes, size, children }: { alert: boolean; since: number | null; slaMinutes: number | null; size: number; children: ReactNode }) {
  const hours = useHours();
  const key = useClock((now) => { const w = waitOf(alert, since, slaMinutes, now, hours); return `${w.ring}:${Math.round(w.progress * 100)}`; }, since ?? 0);
  const [state, pct] = key.split(":") as [RingState, string];
  const pulse = useCrossedThreshold(state === "late" ? 1 : 0, 1);
  return <Ring state={state} progress={Number(pct) / 100} size={size} pulse={pulse}>{children}</Ring>;
}

/** Folha do tempo de espera ("3 min 20 s"): só o texto muda, a linha não re-renderiza. */
function RowTime({ alert, since, slaMinutes, className }: { alert: boolean; since: number; slaMinutes: number | null; className: string }) {
  const hours = useHours();
  const text = useClock((now) => seconds(waitOf(alert, since, slaMinutes, now, hours).waitSec), since);
  return <span className={cn("shrink-0 tabular", className)}>{text}</span>;
}
```

Substitua `statusOf`:
```tsx
function statusOf(section: QueueSectionKey, item: QueueItem, since: number | null, now: number, hours: BusinessHours): { text: string; tone: string } | null {
  const { ring, waitSec } = waitOf(!!item.alert, since, item.slaMinutes, now, hours);
  const sla = slaStatus({ ring, alert: !!item.alert, waitSeconds: waitSec, slaMinutes: item.slaMinutes });
  if (sla) return { text: sla.text, tone: sla.tone === "late" ? "text-alert font-semibold" : sla.tone === "near" ? "text-gold-ink font-semibold" : "text-graphite" };
  if (section === "acoes-hoje" && item.nextAction) return { text: `${item.nextAction.title} · ${dueText(new Date(item.nextAction.dueAt).getTime(), now)}`, tone: "text-gold-ink font-medium" };
  if (section === "reengajar") {
    const days = item.lastAt ? Math.max(0, Math.floor((now - new Date(item.lastAt).getTime()) / 86_400_000)) : null;
    return { text: days == null ? "sem mensagens ainda" : `sem contato há ${days} d`, tone: "text-graphite" };
  }
  if (section === "arquivadas") return { text: ARCHIVED_ROW, tone: "text-muted" };
  if (section === "parados") return { text: `${stoppedText(item.stoppedDays ?? 1)}, sem próxima ação`, tone: "text-graphite" };
  if (section === "aguardando-cliente") return { text: item.nextAction ? `próxima ação: ${item.nextAction.title} · ${dueText(new Date(item.nextAction.dueAt).getTime(), now)}` : "esperando a cliente", tone: "text-muted" };
  return null;
}
```

No corpo de `QueueRow`, substitua do `countRender()` até o fim do `return` (o prefixo, o `stripSignature` e o `ownerLine` da A6 estão incluídos):
```tsx
  countRender();
  const alert = !!item.alert;
  // Atrasados sem alerta ainda (o prazo acabou há segundos) fica dourado: vermelho só com alerta.
  const look: QueueSectionKey = section === "atrasados" && !alert ? "perto" : section;
  const w = WEIGHT[look];
  const since = item.awaitingSince ? new Date(item.awaitingSince).getTime() : null;
  const name = item.name === item.phone ? formatPhoneClient(item.phone) : item.name;
  const snippet = (item.lastMessage ? stripSignature(item.lastMessage) : "") || (item.lastKind ? KIND[item.lastKind] ?? null : null);
  const prefix = lastMessagePrefix(item.lastDirection, item.lastAuthorName, item.lastMessage);
  const origin = item.sourceLabel && item.sourceLabel !== NOT_IDENTIFIED && !isChannelOrigin(item.sourceLabel) ? item.sourceLabel : null;
  return (
    <Link href={href} prefetch={false} scroll={false} role="option" aria-selected={selecting ? checked : selected} tabIndex={tabIndex} data-deal-id={item.dealId}
      onClick={(e) => {
        if (selecting) { e.preventDefault(); onSelect?.(item.dealId, e.shiftKey); return; }
        onOpen?.(item, e);
      }}
      className={cn(
        "group relative flex items-start gap-3 pl-3 pr-4 min-h-[72px] border-b border-line/80 outline-offset-[-2px] scroll-mt-12 scroll-mb-2 transition-colors aria-selected:ring-2 aria-selected:ring-inset aria-selected:ring-gold",
        w.row, (selecting ? checked : selected) ? "bg-gold-soft/70 hover:bg-gold-soft" : look === "atrasados" ? "hover:bg-alert-soft/70" : "hover:bg-paper-2",
      )}>
      {selecting && <span aria-hidden data-testid="item-caixa" className="-ml-1.5 -mr-1 grid size-11 shrink-0 place-items-center self-center"><Box checked={checked} /></span>}
      <span className="relative shrink-0">
        <RowRing alert={alert} since={since} slaMinutes={item.slaMinutes} size={w.avatar}>
          <ContactAvatar contactId={item.contactId} hasAvatar={item.hasAvatar} name={name} size={w.avatar} />
        </RowRing>
        {selectable && !selecting && (
          <span aria-hidden data-testid="item-selecionar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect?.(item.dealId, e.shiftKey); }}
            className="absolute inset-0 hidden place-items-center rounded-full bg-paper/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-fine:grid"><Box checked={false} /></span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate", w.name)}>{name}</span>
          {since != null && <RowTime alert={alert} since={since} slaMinutes={item.slaMinutes} className={w.time} />}
        </span>
        {snippet && (
          <span className={cn("mt-0.5 block truncate text-sm", item.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
            {item.lastKind === "audio" && <IconMic size={13} className="inline -mt-0.5 mr-1" />}
            {prefix && <span className="text-muted">{prefix}</span>}{snippet}
          </span>
        )}
        <RowStatus section={section} item={item} since={since} />
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{item.stageName}</span>
          {origin && <><span aria-hidden>·</span><span className="truncate max-w-[16ch]">{origin}</span></>}
          <span aria-hidden>·</span>
          {item.ownerName
            ? <span>{ownerLine(item.ownerShort ?? item.ownerName, item.repliedByName)}</span>
            : <span data-sem-dono="" title={NO_OWNER_HINT} className="text-gold-ink font-medium">{NO_OWNER}{item.repliedByName ? ` · respondida por ${item.repliedByName}` : ""}<span className="sr-only">: {NO_OWNER_HINT}</span></span>}
          {item.stoppedDays && section !== "parados" ? <><span aria-hidden>·</span><span>{stoppedText(item.stoppedDays)}</span></> : null}
          {item.transferNote && <span data-transfer="" className="font-medium text-gold-ink">{item.transferNote}</span>}
          {(item.badges ?? []).map((s) => <span key={`b-${s}`} data-badge="" title={chipHelp(s)} className="rounded-full bg-paper-2 px-1.5 py-px font-medium text-graphite">{s}</span>)}
          {item.signals.map((s) => <span key={`s-${s}`} data-signal="" title={chipHelp(s)} className="rounded-full bg-gold-soft px-1.5 py-px font-medium text-gold-ink">{s}</span>)}
          {/* Etiquetas da equipe ficam separadas dos sinais automáticos (borda à esquerda). */}
          {item.tags.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1 border-l border-line pl-2">
              <span className="sr-only">Etiquetas da equipe:</span>
              {item.tags.map((t) => <span key={`t-${t}`} data-tag="" title={TAG_HELP} className="rounded-full border border-line-strong px-1.5 font-medium text-ink-2">{t}</span>)}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
```
O `import { SIGNAL_LABELS } …` antigo sai, se ainda existir.

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/components/queue`
Esperado: PASS, inclusive o teste da A6 ("Cati: Confirmado!", "Dona: Sara · respondida por Cati") e o teste do relógio que não re-renderiza as linhas.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.
Rode: `npx playwright test e2e/cliente.spec.ts e2e/fila.spec.ts e2e/sinais-importacao.spec.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add src/components/queue/queue-item.tsx src/components/queue/queue-item.render.test.tsx e2e/cliente.spec.ts
git commit -m "feat(fila): linha com um texto de prazo só, Sem dono com dica, no máximo 2 sinais e etiquetas da equipe à parte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B7: cabeçalho e painel (relógio, WhyLate com quem e quando, Responsável, "Compareceu?" depois do horário)

**Arquivos:**
- Modificar: `src/lib/why-late.ts:1-66`
- Modificar: `src/components/queue/why-late.tsx`
- Modificar: `src/components/queue/pane-header.tsx:33-50`
- Modificar: `src/lib/primary-action.ts`
- Modificar: `src/components/queue/client-pane.tsx` (`Owner` e o bloco do `WhyLate`/`AttendanceBar`; ache com `grep -n "data-testid=\"responsavel\"\|<WhyLate\|<AttendanceBar" src/components/queue/client-pane.tsx`)
- Teste: `src/lib/why-late.test.ts:31-34`, `src/lib/primary-action.test.ts`, só acréscimos

**Interfaces:**
- Consome:
  - `answeredText`, `ownerHint`, `NO_OWNER`, `WAIT_CLOCK_PREFIX`, `waitClockSuffix` e `WAIT_CLOCK_HELP` (B2)
  - `DealDetail.late` (B3)
  - `d.messages[i].sender` (nome da equipe, A5) e `.fromPhone`, que já vêm de `getDealDetail`
  - da A6: `firstName`, `d.lastReplyName` e o parágrafo `respondida-por`
- Produz:
  - `WhyLateItem` ganha `lastBy?: string | null` e `lastFromPhone?: boolean`
  - `askAttendance({ stageKind, scheduledAt, attendance }, nowMs): boolean`
  - `[data-testid=responsavel-dica]` no painel

- [ ] **Passo 1: escrever os testes que falham**

Em `src/lib/why-late.test.ts`, substitua o teste "aguardando a cliente: a bola está com ela":
```ts
  it("aguardando a cliente: diz quem respondeu, quando (com o dia) e por onde", () => {
    const at = bahia("2026-10-06T13:15:00").toISOString(); // ontem
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: at, lastBy: "Cati Souza", lastFromPhone: true }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente.");
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: bahia("2026-10-07T14:02:00").toISOString(), lastFromPhone: true }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("A Casa respondeu hoje 14:02 pelo celular; agora é a vez da cliente.");
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: bahia("2026-10-07T14:02:00").toISOString(), lastBy: "Sara", lastFromPhone: false }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("Sara respondeu hoje 14:02; agora é a vez da cliente.");
  });
```
Acrescente a `src/lib/primary-action.test.ts`:
```ts
import { askAttendance } from "./primary-action";
it("'Compareceu?' só depois do horário; já marcado continua visível para corrigir; fora de Agendado nunca", () => {
  const now = Date.parse("2026-10-15T15:00:00Z");
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: null }, now)).toBe(false);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: "confirmado" }, now)).toBe(false);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-15T14:00:00Z", attendance: null }, now)).toBe(true);
  expect(askAttendance({ stageKind: "agendado", scheduledAt: "2026-10-17T13:00:00Z", attendance: "faltou" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "atendimento", scheduledAt: "2026-10-15T14:00:00Z", attendance: null }, now)).toBe(false);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/lib/why-late.test.ts src/lib/primary-action.test.ts`
Esperado: FAIL. O texto ainda é "A Casa respondeu às…" e `askAttendance` não existe.

- [ ] **Passo 3a: `src/lib/why-late.ts`**

Acrescente os imports:
```ts
import { dueLabel } from "./next-action";
import { answeredText } from "./alert-copy";
```
No tipo `WhyLateItem`, acrescente:
```ts
  /** Quem mandou a última mensagem da Casa (nome; null = sem autora registrada) e se saiu pelo celular. */
  lastBy?: string | null;
  lastFromPhone?: boolean;
```
Em `whyLate`, troque o bloco `if (!item.awaitingSince) {…}`:
```ts
  if (!item.awaitingSince) {
    if (item.lastDirection === "out" && item.lastAt) return answeredText({ by: item.lastBy ?? null, fromPhone: !!item.lastFromPhone, at: dueLabel(new Date(item.lastAt).getTime(), nowMs) });
    return "Aguardando a cliente";
  }
```
No comentário, acrescente: "sem espera: quem respondeu por último, quando (sempre com o dia) e se foi pelo celular".

- [ ] **Passo 3b: `src/components/queue/why-late.tsx`**

```tsx
export function WhyLate({ awaitingSince, slaMinutes, alert = false, lastAt, lastDirection, lastBy, lastFromPhone }: {
  awaitingSince: string | null; slaMinutes: number | null; alert?: boolean; lastAt?: string | null; lastDirection?: "in" | "out" | null; lastBy?: string | null; lastFromPhone?: boolean;
}) {
```
Na linha do texto, use `whyLate({ awaitingSince, slaMinutes, lastAt, lastDirection, lastBy, lastFromPhone }, hours, now)`.

- [ ] **Passo 3c: relógio do cabeçalho (`pane-header.tsx`, `SlaChip`)**

```tsx
        <motion.span key="sla" title={WAIT_CLOCK_HELP} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
          className={cn("inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 lg:px-3 rounded-full text-sm font-semibold lg:col-span-3 lg:row-start-2 lg:justify-self-start lg:mt-3 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:mt-0 xl:justify-self-end", URGENCY[urgency])}>
          <IconClock size={14} aria-hidden />
          {/* Celular: só o tempo. Desktop: "Esperando há 12 min (prazo 15)". O relógio é o mesmo. */}
          <span className="lg:hidden"><Elapsed since={since} sla={slaMinutes} alert={alert} /></span>
          <span className="hidden lg:inline">{WAIT_CLOCK_PREFIX}<Elapsed since={since} sla={slaMinutes} alert={alert} /><span className="font-normal opacity-80">{waitClockSuffix(slaMinutes)}</span></span>
        </motion.span>
```
Acrescente `import { WAIT_CLOCK_HELP, WAIT_CLOCK_PREFIX, waitClockSuffix } from "@/lib/alert-copy";`. Atualize o comentário do `SlaChip`: um chip só, "Esperando há 12 min (prazo 15)" no desktop e só o tempo no celular.

- [ ] **Passo 3d: `src/lib/primary-action.ts`**, ao fim

```ts
/** "Compareceu?" só depois do horário (antes, a pergunta não faz sentido). Já marcado (compareceu/faltou), continua para poder corrigir. */
export function askAttendance(d: { stageKind: string; scheduledAt: string | Date | null; attendance: string | null }, now: number): boolean {
  if (d.stageKind !== "agendado") return false;
  if (d.attendance === "compareceu" || d.attendance === "faltou") return true;
  return !!d.scheduledAt && new Date(d.scheduledAt).getTime() <= now;
}
```

- [ ] **Passo 3e: `src/components/queue/client-pane.tsx`**

Imports:
```ts
import { PRIMARY_LABEL, askAttendance, primaryAction } from "@/lib/primary-action";
import { NO_OWNER, ownerHint } from "@/lib/alert-copy";
import { useClock } from "@/components/pipeline/timer";
```
(o `import { firstName } from "@/lib/authorship";` da A6 fica.)

No `Owner`, troque o bloco que mostra "Responsável" (o `<div className="min-w-0">` com o `responsavel` e o `respondida-por` da A6) por:
```tsx
      <div className="min-w-0">
        <p className="text-xs text-muted">Responsável</p>
        <p data-testid="responsavel" className={cn("truncate text-md font-medium lg:text-base", d.ownerName ? "text-ink" : "text-gold-ink")}>{d.ownerName ?? NO_OWNER}</p>
        {d.lastReplyName && d.deal.lastReplyById !== d.deal.ownerId && (
          <p data-testid="respondida-por" className="mt-0.5 text-xs text-graphite">Respondida por {firstName(d.lastReplyName)}{d.deal.lastReplyVia === "celular" ? " pelo celular" : " pelo CRM"}</p>
        )}
        <p data-testid="responsavel-dica" className="mt-0.5 text-[13px] leading-snug text-graphite">{ownerHint(d.ownerName, mine)}</p>
      </div>
```
Em `ClientPane`, logo depois de `const last = d.messages.at(-1);`:
```ts
  const lastOut = [...d.messages].reverse().find((m) => m.direction === "out");
  // "Compareceu?" aparece sozinho quando o horário passa (re-renderiza só quando o valor muda).
  const showAttendance = useClock((now) => askAttendance({ stageKind: k, scheduledAt: d.deal.scheduledAt, attendance: d.deal.attendance }, now));
```
Troque as linhas do `AttendanceBar` e do `WhyLate`:
```tsx
            {showAttendance && <AttendanceBar attendance={d.deal.attendance} busy={actions.busy} onPick={actions.attendance} />}
            {open && <WhyLate awaitingSince={d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null} slaMinutes={d.stage.slaMinutes} alert={d.late}
              lastAt={last ? new Date(last.createdAt).toISOString() : null} lastDirection={last?.direction ?? null} lastBy={lastOut?.sender ?? null} lastFromPhone={lastOut?.fromPhone ?? false} />}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/lib/why-late.test.ts src/lib/primary-action.test.ts src/components/queue`
Esperado: PASS.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.
Rode: `npx playwright test e2e/cliente.spec.ts e2e/acoes-fila.spec.ts e2e/criterios.spec.ts`
Esperado: PASS. Esses specs usam "Compareceu" só em horários que já passaram e conferem `responsavel` pelo nome.

- [ ] **Passo 5: commit**

```bash
git add src/lib/why-late.ts src/lib/why-late.test.ts src/components/queue/why-late.tsx src/components/queue/pane-header.tsx src/lib/primary-action.ts src/lib/primary-action.test.ts src/components/queue/client-pane.tsx
git commit -m "feat(conversa): Esperando há X (prazo N), WhyLate com quem e quando, Responsável explicado, Compareceu? só depois do horário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B8: textos novos dos alertas no servidor

**Arquivos:**
- Modificar: `src/server/rules/engine.ts:15-20,30-110,165-185`
- Modificar: `src/server/domain/tasks.ts:132-156`, o `remindDueTasks`
- Modificar: `src/server/domain/offers.ts`, linha do `message: \`Pode assumir…\``
- Modificar: `src/server/domain/assign.ts:29-31,52-54`
- Modificar: `src/server/domain/outbox.ts`: os textos de `envio_automatico_falhou`, `alertInterrupted` e `alertUnexpected`
- Modificar: `src/server/domain/authorship.ts` (A3): `warnOwnerRepliedByOther` usa `alertText.repliedByOther`
- Modificar: `src/server/db/seed-data.ts:35,47,68`
- Teste: `src/server/rules/engine.test.ts`, `src/server/domain/tasks.test.ts`, `src/server/domain/transfer.test.ts:26`, `src/server/domain/offers.test.ts:46` e `src/server/domain/outbox.test.ts:105`

**Interfaces:**
- Consome: `alertText`, `clientLabel` (B2) e `isOpen` de `src/lib/business-hours.ts`.
- Produz:
  - As duas automações de espera (`lead_2min` e `atendimento_3min`) gravam o mesmo texto fixo, com desde quando, prazo e dona. O escalado também.
  - `remindDueTasks(now = new Date(), hours?: BusinessHours): Promise<{ alerts: number }>`: não faz nada com a Casa fechada.
  - `Candidate` ganha `ownerName`, `birthDay`, `birthMonth` e `limitMinutes`.
  - O aviso `respondida_por_outra` (A3) passa a sair do mesmo módulo de textos, com a mesma frase.

- [ ] **Passo 1: escrever os testes que falham**

Em `src/server/rules/engine.test.ts`, acrescente ao `describe("motor de automações")`:
```ts
  it("texto da espera: desde quando, prazo e dona; o escalado diz o mesmo, sem número congelado", async () => {
    await lead();
    await runRules(min(2));
    let [a] = await db.select().from(alerts);
    expect(a.message).toBe("Mariana espera resposta desde 10:00 (prazo 2 min). Dona: Ana.");
    await runRules(min(10));
    [a] = await db.select().from(alerts);
    expect(a.message).toBe("Escalado: Mariana sem resposta desde 10:00. Dona: Ana.");
  });
```
(O `min(10)` vale para o seed atual, com a escalada em 10 min; a C1 muda o seed para 30 min e troca este `min(10)` por `min(30)`.)

No teste de aniversário da linha 124, acrescente:
```ts
    const aniv = (await db.select().from(alerts)).find((a) => a.type === "aniversario_em_dias")!;
    expect(aniv.message).toMatch(/^Aniversário de Mariana dia \d{2}\/\d{2}\. Que tal mandar um parabéns\?$/);
```

Em `src/server/domain/tasks.test.ts`, acrescente:
```ts
it("lembrete nunca dispara com a Casa fechada; o texto diz 'Combinado' sem repetir o nome", async () => {
  await db.update(contacts).set({ name: "Joana Lima" }).where(eq(contacts.id, contactId));
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Retomar contato com Joana Lima", dueAt: new Date("2026-10-15T03:10:00Z"), assigneeId: uid }, uid);
  expect(await remindDueTasks(new Date("2026-10-15T03:00:00Z"))).toEqual({ alerts: 0 }); // meia-noite em Salvador
  expect(await remindDueTasks(new Date("2026-10-15T11:05:00Z"))).toEqual({ alerts: 1 }); // 08:05, a Casa abriu
  expect((await db.select().from(alerts))[0].message).toBe("Combinado vencido: retomar contato (Joana Lima).");
});
it("lembrete antes de vencer diz 'vencendo'", async () => {
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Mandar valores", dueAt: new Date("2026-10-15T12:10:00Z"), assigneeId: uid }, uid);
  await remindDueTasks(new Date("2026-10-15T12:00:00Z"));
  expect((await db.select().from(alerts))[0].message).toBe("Combinado vencendo: mandar valores (cliente com final 3333).");
});
```
Se `contacts` ainda não estiver no import de schema do arquivo, acrescente.

Em `src/server/domain/transfer.test.ts:26`: `expect(a.message).toBe("Ana te passou a conversa de Fulana");`
Em `src/server/domain/offers.test.ts:46`: `expect(o.message).toMatch(/^A dona não respondeu\. Pode assumir /);`
Em `src/server/domain/outbox.test.ts`, depois da linha 105:
```ts
    const falha = (await db.select().from(alerts)).find((a) => a.type === "envio_automatico_falhou")!;
    expect(falha.message).toMatch(/^Mensagem automática para .+ não saiu \(3 tentativas sem sucesso\)\. Abra a conversa e envie manualmente\.$/);
    expect(falha.message).not.toMatch(/\+55/);
```
O teste da A3 que confere "Caticilene respondeu a conversa de Cliente 1. Ela continua sua; se for para passar, use Transferir." fica como está: a frase não muda.

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/rules/engine.test.ts src/server/domain/tasks.test.ts src/server/domain/transfer.test.ts src/server/domain/offers.test.ts src/server/domain/outbox.test.ts`
Esperado: FAIL nos textos e no lembrete com a Casa fechada.

- [ ] **Passo 3a: `src/server/rules/engine.ts`**

Import novo: `import { alertText, clientLabel } from "../../lib/alert-copy";`.

No tipo `Candidate`, acrescente:
```ts
  /** Dona (nome), aniversário e o prazo que valeu na espera: o texto fixo dos alertas de espera e de aniversário. */
  ownerName?: string | null; birthDay?: number | null; birthMonth?: number | null; limitMinutes?: number | null;
```
No `base` de `candidatesFor`, acrescente as colunas:
```ts
  const base = sql`select d.id as "dealId", d.owner_id as "ownerId", s.key as "stageKey", s.name as "stageName",
    c.name as "contactName", c.phone_e164 as phone, s.sla_minutes as "slaMinutes", d.last_outbound_at as "lastOutboundAt",
    (select u.name from users u where u.id = d.owner_id) as "ownerName", c.birth_day as "birthDay", c.birth_month as "birthMonth"`;
```
No filtro de `sem_resposta_minutos`, depois de `(r as { waited?: number }).waited = waited;`, acrescente `(r as { limit?: number }).limit = limit;`. No `return { ...r, windowKey, … }` do `map`, acrescente:
```ts
      ...(trigger.type === "sem_resposta_minutos" ? { limitMinutes: (r as { limit?: number }).limit ?? null } : {}),
```
Antes de `escalate`, acrescente:
```ts
/** O texto do alerta: espera e aniversário têm frase fixa (alert-copy, igual nas duas automações de espera); as outras usam o modelo configurado. */
function alertMessage(trigger: Trigger, tpl: string, c: Candidate, stageName: string, now: Date): string {
  const client = clientLabel(c.contactName, c.phone);
  if (trigger.type === "sem_resposta_minutos" && c.awaitingSince)
    return alertText.wait({ client, sinceMs: c.awaitingSince.getTime(), slaMinutes: c.limitMinutes ?? null, ownerName: c.ownerName ?? null, now: now.getTime() });
  if (trigger.type === "aniversario_em_dias" && c.birthDay && c.birthMonth) return alertText.birthday(client, c.birthDay, c.birthMonth);
  return render(tpl, c, stageName);
}
const escalatedMessage = (c: Candidate, now: Date) =>
  alertText.escalated({ client: clientLabel(c.contactName, c.phone), sinceMs: c.awaitingSince!.getTime(), ownerName: c.ownerName ?? null, now: now.getTime() });
```
Em `execute`:
```ts
      if (c.awaitingSince && a.type === "alertar_gestao") return escalate(tx, c, trigger, now, escalatedMessage(c, now), `${dedupeBase}:${a.type}`);
      const audience = a.type === "alertar_gestao" || !c.ownerId ? "gestao" : "responsavel";
      const message = alertMessage(trigger, a.message, c, ctx.stageName, now);
```
```ts
    case "escalar_gestao":
      if (!c.awaitingSince) return null;
      return escalate(tx, c, trigger, now, escalatedMessage(c, now), `${dedupeBase}:${a.type}`);
```

- [ ] **Passo 3b: `src/server/domain/tasks.ts`, `remindDueTasks`**

```ts
import { isOpen, type BusinessHours } from "../../lib/business-hours";
import { alertText, clientLabel } from "../../lib/alert-copy";
import { getBusinessHours } from "./hours";
```
```ts
/**
 * Lembretes (worker, a cada 5 min): tarefa que vence nos próximos 15 min (ou venceu há até 2 dias) e ainda não foi avisada vira um alerta
 * `tarefa_vencendo` (nível 1) para o responsável, ou para a gestão se não tem. `wait_key = task:<id>` garante um aviso só por tarefa.
 * Nunca com a Casa fechada (madrugada, domingo): o aviso sai quando ela abrir, se a tarefa ainda estiver aberta.
 */
export async function remindDueTasks(now = new Date(), hours?: BusinessHours): Promise<{ alerts: number }> {
  const bh = hours ?? (await getBusinessHours());
  if (!isOpen(now.getTime(), bh)) return { alerts: 0 };
  const until = new Date(now.getTime() + 15 * 60_000);
  const floor = new Date(now.getTime() - 2 * 86_400_000); // vencida há mais de 2 dias não avisa (evita rajada ao religar o worker)
  const due = await db.select({ t: tasks, contactName: contacts.name, phone: contacts.phoneE164 }).from(tasks)
    .innerJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(
      isNull(tasks.doneAt), gte(tasks.dueAt, floor), lte(tasks.dueAt, until),
      or(isNull(tasks.dealId), isNull(deals.archivedAt)), eq(contacts.ignored, false),
    ));
  let created = 0;
  for (const { t, contactName, phone } of due) {
    const message = alertText.taskDue({ title: t.title, contactName, client: clientLabel(contactName, phone), overdue: t.dueAt.getTime() < now.getTime() });
    const [row] = await db.insert(alerts).values({
      dealId: t.dealId, userId: t.assigneeId, audience: t.assigneeId ? "responsavel" : "gestao", type: "tarefa_vencendo", severity: "info",
      message, dedupeKey: `task:${t.id}`, waitKey: `task:${t.id}`, level: 1, createdAt: now,
    }).onConflictDoNothing().returning({ id: alerts.id });
    if (row) { created++; await emit("regras", { deals: t.dealId ? [t.dealId] : [] }); }
  }
  return { alerts: created };
}
```

- [ ] **Passo 3c: oferta, assumir, transferir e "respondida por outra"**

`src/server/domain/offers.ts`:
- troque `const who = d.name === d.phone ? formatPhone(d.phone) : d.name;` por `const who = clientLabel(d.name === d.phone ? null : d.name, d.phone);`
- troque o `message` por `message: alertText.offer(who),`
- import: `import { alertText, clientLabel } from "../../lib/alert-copy";`
- tire `formatPhone` e `minutes`, que ficam sem uso. Confira com `npm run lint`.

`src/server/domain/assign.ts`:
- linhas 29-31:
```ts
      const cliente = clientLabel(c?.name, c?.phone ?? "");
      await tx.insert(alerts).values({ dealId, userId: deal.ownerId, audience: "responsavel", type: "assumiu_sua_conversa", severity: "info",
        message: alertText.claimed(who?.name ?? null, cliente), dedupeKey: `assumiu:${dealId}:${Date.now()}` });
```
- linhas 52-54:
```ts
    const cliente = clientLabel(c?.name, c?.phone ?? "");
    await tx.insert(alerts).values({ dealId, userId: toUserId, audience: "responsavel", type: "transferido_para_voce", severity: "info",
      message: alertText.transferred(who?.name ?? null, cliente), dedupeKey: `transferido:${dealId}:${Date.now()}` });
```
- import novo: `import { alertText, clientLabel } from "../../lib/alert-copy";`. O `formatPhone` sai.

`src/server/domain/authorship.ts` (A3), em `warnOwnerRepliedByOther`:
- troque as duas linhas `const quem = …` e `const cliente = …` e o `message` por:
```ts
  const cliente = c ? clientLabel(c.name, c.phone) : "uma cliente";
  const r = await tx.insert(alerts).values({
    dealId: p.dealId, userId: p.ownerId, audience: "responsavel", type: "respondida_por_outra", severity: "info",
    message: alertText.repliedByOther(who?.name ?? null, cliente),
    dedupeKey: `respondida:${p.dealId}:${p.authorId}:${bahiaDay(p.at)}`,
  }).onConflictDoNothing().returning({ id: alerts.id });
```
- import novo: `import { alertText, clientLabel } from "@/lib/alert-copy";`; o `import { formatPhone } from "./phone";` sai.

- [ ] **Passo 3d: `src/server/domain/outbox.ts`**

Import: `import { alertText, clientLabel } from "../../lib/alert-copy";`.

1. Falha do canal (WhatsApp desconectado):
```ts
      message: alertText.autoSendFailed(clientLabel(row.contact.name, row.contact.phoneE164), "WhatsApp desconectado"), dedupeKey: `auto:${item.id}` }).onConflictDoNothing();
```
2. Última tentativa:
```ts
      message: alertText.autoSendFailed(clientLabel(row.contact.name, row.contact.phoneE164), `${item.attempts} tentativas sem sucesso`),
```
3. `alertInterrupted(item, row.contact.name ?? row.contact.phoneE164, …)` vira `alertInterrupted(item, clientLabel(row.contact.name, row.contact.phoneE164), …)`. O texto do "incerto" fica: ele manda conferir antes de reenviar.
4. `alertUnexpected`:
```ts
  const who = c ? clientLabel(c.name, c.phone) : "a cliente";
  const message = maybeSent
    ? `Mensagem automática para ${who}: envio incerto. Confira no WhatsApp antes de reenviar (erro inesperado depois do envio).`
    : alertText.autoSendFailed(who, "erro antes do envio");
```

- [ ] **Passo 3e: `src/server/db/seed-data.ts`**

Deixe os modelos de texto iguais ao que o motor grava. São só para quem lê a tela de Automações.
```ts
    actions: [{ type: "alertar_responsavel", message: "{nome} espera resposta (texto fixo: desde quando, prazo e dona)" }],
```
Use isso nas linhas 35 e 47. Na linha 68:
```ts
    actions: [{ type: "alertar_responsavel", message: "Aniversário de {nome}. Que tal mandar um parabéns?" }],
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/rules src/server/domain`
Esperado: PASS, inclusive `authorship.test.ts` (A3). `alertas-unicos.test.ts` confere só público e nível, então continua passando.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.

- [ ] **Passo 5: commit**

```bash
git add src/server/rules/engine.ts src/server/rules/engine.test.ts src/server/domain/tasks.ts src/server/domain/tasks.test.ts src/server/domain/offers.ts src/server/domain/offers.test.ts src/server/domain/assign.ts src/server/domain/transfer.test.ts src/server/domain/outbox.ts src/server/domain/outbox.test.ts src/server/domain/authorship.ts src/server/db/seed-data.ts
git commit -m "feat(avisos): textos novos dos alertas (espera unificada, escalado, combinado, oferta, assumir, aniversário, envio); lembrete nunca com a Casa fechada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B9: tarefa sem responsável vai para a dona ou para quem respondeu (regra e script das existentes)

**Arquivos:**
- Criar: `src/server/domain/task-assignee.ts`
- Modificar: `src/server/domain/tasks.ts:24-34`, o `createTaskTx`
- Criar: `scripts/tarefas-sem-responsavel.ts`
- Teste: `src/server/domain/task-assignee.test.ts`

**Interfaces:**
- Consome: `clientLabel` (B2) e, do Lote 1A, `deals.lastReplyById` (A2/A3/A9) e `messages.sentByUserId`.
- Produz:
  - `defaultAssignee(q: Tx | typeof db, dealId: string): Promise<{ id: string; via: "dona" | "ultima_resposta" } | null>`
  - `type AssigneeFix = { taskId: string; kind: string; title: string; client: string; dueAt: string; to: string | null; toName: string | null; via: "dona" | "ultima_resposta" | null }`
  - `planTaskAssigneeFix(): Promise<AssigneeFix[]>`
  - `applyTaskAssigneeFix(plan: AssigneeFix[]): Promise<number>`
  - `fixSummary(plan): { kind: string; para: string; via: string; n: number }[]`
  - `createTaskTx` passa a preencher `assigneeId` quando ele vem vazio (também quando vem `null` explícito: `setNextActionTx` e `replaceOpenTaskTx` passam `null` quando a conversa não tem dona).

- [ ] **Passo 1: escrever o teste que falha**

`src/server/domain/task-assignee.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyTaskAssigneeFix, defaultAssignee, fixSummary, planTaskAssigneeFix } from "./task-assignee";
import { createTask } from "./tasks";

beforeEach(async () => { await resetDb(); });

async function setup() {
  const [sara] = await db.insert(users).values({ name: "Sara Lima", email: "s@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [cati] = await db.insert(users).values({ name: "Caticilene", email: "c@c.com", role: "gestor", passwordHash: "x" }).returning();
  const [saiu] = await db.insert(users).values({ name: "Ex", email: "x@c.com", role: "atendente", passwordHash: "x", active: false }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  let n = 0;
  const lead = async (ownerId: string | null, lastBy?: string | null) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+55719999300${n}` }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId }).returning();
    if (lastBy !== undefined) await db.insert(messages).values({ dealId: d.id, contactId: c.id, direction: "out", body: "oi", sentByUserId: lastBy, createdAt: new Date() });
    return { c, d };
  };
  const openTask = async (l: { c: { id: string }; d: { id: string } }, title = "Retomar contato") =>
    (await db.insert(tasks).values({ dealId: l.d.id, contactId: l.c.id, kind: "proxima_acao", title, dueAt: new Date() }).returning())[0];
  return { sara, cati, saiu, lead, openTask };
}

describe("para quem vai a tarefa sem responsável", () => {
  it("dona do lead; sem dona, quem respondeu por último; ninguém ativo, null", async () => {
    const { sara, cati, saiu, lead } = await setup();
    expect(await defaultAssignee(db, (await lead(sara.id, cati.id)).d.id)).toEqual({ id: sara.id, via: "dona" });
    expect(await defaultAssignee(db, (await lead(null, cati.id)).d.id)).toEqual({ id: cati.id, via: "ultima_resposta" });
    expect(await defaultAssignee(db, (await lead(null, saiu.id)).d.id)).toBeNull();
    expect(await defaultAssignee(db, (await lead(null)).d.id)).toBeNull();
    // Lote 1A: quem respondeu por último fica gravado na conversa (vale mesmo sem a mensagem com autora no banco)
    const l5 = await lead(null);
    await db.update(deals).set({ lastReplyById: cati.id, lastReplyVia: "celular" }).where(eq(deals.id, l5.d.id));
    expect(await defaultAssignee(db, l5.d.id)).toEqual({ id: cati.id, via: "ultima_resposta" });
  });
  it("tarefa nova sem responsável já nasce com quem respondeu (vale para gestão também)", async () => {
    const { cati, lead } = await setup();
    const l = await lead(null, cati.id);
    const t = await createTask({ dealId: l.d.id, contactId: l.c.id, kind: "proxima_acao", title: "Retomar", dueAt: new Date() }, cati.id);
    expect(t.assigneeId).toBe(cati.id);
  });
});

describe("correção das tarefas antigas (script)", () => {
  it("ensaio não grava; aplicar grava só onde ainda está vazio e leva o aviso junto; rodar de novo não muda nada", async () => {
    const { sara, cati, lead, openTask } = await setup();
    const a = await openTask(await lead(sara.id));
    const b = await openTask(await lead(null, cati.id));
    const c = await openTask(await lead(null));
    await db.insert(alerts).values({ dealId: b.dealId, audience: "gestao", type: "tarefa_vencendo", severity: "info", message: "m", dedupeKey: `task:${b.id}`, waitKey: `task:${b.id}` });
    const plan = await planTaskAssigneeFix();
    expect(plan.map((p) => [p.taskId, p.to, p.via])).toEqual(expect.arrayContaining([[a.id, sara.id, "dona"], [b.id, cati.id, "ultima_resposta"], [c.id, null, null]]));
    expect((await db.select().from(tasks)).every((t) => t.assigneeId === null)).toBe(true); // ensaio não grava
    expect(fixSummary(plan)).toEqual(expect.arrayContaining([
      { kind: "proxima_acao", para: "Sara Lima", via: "dona", n: 1 }, { kind: "proxima_acao", para: "Caticilene", via: "última resposta", n: 1 },
      { kind: "proxima_acao", para: "(ninguém)", via: "sem destino", n: 1 },
    ]));
    expect(await applyTaskAssigneeFix(plan)).toBe(2);
    expect(await applyTaskAssigneeFix(plan)).toBe(0); // idempotente
    const [al] = await db.select().from(alerts).where(eq(alerts.waitKey, `task:${b.id}`));
    expect(al).toMatchObject({ userId: cati.id, audience: "responsavel" });
    expect((await planTaskAssigneeFix()).map((p) => p.taskId)).toEqual([c.id]); // conferência: só a sem destino continua vazia
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/domain/task-assignee.test.ts`
Esperado: FAIL com "Failed to resolve import ./task-assignee".

- [ ] **Passo 3a: `src/server/domain/task-assignee.ts`**

```ts
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, messages, tasks, users } from "../db/schema";
import { clientLabel } from "../../lib/alert-copy";

type Q = Tx | typeof db;

/**
 * Para quem vai uma tarefa sem responsável: a dona do lead; sem dona, quem respondeu a cliente por último — primeiro o que o Lote 1A
 * grava na conversa (`last_reply_by_id`: pessoa logada no CRM ou assinatura do celular), depois a última mensagem enviada com autora.
 * Só gente ativa. Ninguém: null (o aviso da tarefa cai na gestão).
 */
export async function defaultAssignee(q: Q, dealId: string): Promise<{ id: string; via: "dona" | "ultima_resposta" } | null> {
  const [owner] = await q.select({ id: users.id }).from(deals).innerJoin(users, eq(users.id, deals.ownerId)).where(and(eq(deals.id, dealId), eq(users.active, true)));
  if (owner) return { id: owner.id, via: "dona" };
  const [replied] = await q.select({ id: users.id }).from(deals).innerJoin(users, eq(users.id, deals.lastReplyById)).where(and(eq(deals.id, dealId), eq(users.active, true)));
  if (replied) return { id: replied.id, via: "ultima_resposta" };
  const [last] = await q.select({ id: users.id }).from(messages).innerJoin(users, eq(users.id, messages.sentByUserId))
    .where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"), eq(users.active, true))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
  return last ? { id: last.id, via: "ultima_resposta" } : null;
}

export type AssigneeFix = { taskId: string; kind: string; title: string; client: string; dueAt: string; to: string | null; toName: string | null; via: "dona" | "ultima_resposta" | null };

/** Ensaio: as tarefas abertas sem responsável e para quem cada uma iria. Não grava nada. */
export async function planTaskAssigneeFix(): Promise<AssigneeFix[]> {
  const open = await db.select({ id: tasks.id, kind: tasks.kind, title: tasks.title, dueAt: tasks.dueAt, dealId: tasks.dealId, name: contacts.name, phone: contacts.phoneE164 })
    .from(tasks).innerJoin(contacts, eq(contacts.id, tasks.contactId)).where(and(isNull(tasks.doneAt), isNull(tasks.assigneeId))).orderBy(asc(tasks.dueAt));
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const out: AssigneeFix[] = [];
  for (const t of open) {
    const to = t.dealId ? await defaultAssignee(db, t.dealId) : null;
    out.push({ taskId: t.id, kind: t.kind, title: t.title, client: clientLabel(t.name, t.phone), dueAt: t.dueAt.toISOString(), to: to?.id ?? null, toName: to ? names.get(to.id) ?? null : null, via: to?.via ?? null });
  }
  return out;
}

/** Aplica o ensaio: só onde ainda está sem responsável e aberta (idempotente). O aviso aberto da tarefa vai junto para a pessoa. */
export async function applyTaskAssigneeFix(plan: AssigneeFix[]): Promise<number> {
  let n = 0;
  await db.transaction(async (tx) => {
    for (const f of plan) {
      if (!f.to) continue;
      const r = await tx.update(tasks).set({ assigneeId: f.to }).where(and(eq(tasks.id, f.taskId), isNull(tasks.assigneeId), isNull(tasks.doneAt))).returning({ id: tasks.id });
      if (!r.length) continue;
      n++;
      await tx.update(alerts).set({ userId: f.to, audience: "responsavel", readAt: null, pushedAt: null }).where(and(eq(alerts.waitKey, `task:${f.taskId}`), isNull(alerts.resolvedAt)));
    }
  });
  return n;
}

/** A tabela do ensaio: por tipo de tarefa, quantas vão para cada pessoa e por quê. */
export function fixSummary(plan: AssigneeFix[]): { kind: string; para: string; via: string; n: number }[] {
  const m = new Map<string, { kind: string; para: string; via: string; n: number }>();
  for (const f of plan) {
    const para = f.toName ?? "(ninguém)", via = f.via === "dona" ? "dona" : f.via === "ultima_resposta" ? "última resposta" : "sem destino";
    const k = `${f.kind}|${para}|${via}`;
    const row = m.get(k) ?? { kind: f.kind, para, via, n: 0 };
    row.n++; m.set(k, row);
  }
  return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.n - a.n);
}
```

- [ ] **Passo 3b: `createTaskTx` (`src/server/domain/tasks.ts:24-34`)**

```ts
import { defaultAssignee } from "./task-assignee";
```
```ts
/** Cria a tarefa. Sem responsável, vai para a dona do lead ou, sem dona, para quem respondeu por último (`defaultAssignee`): nenhuma fica sem ninguém por descuido. */
export async function createTaskTx(tx: Tx, input: NewTask, userId: string | null): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new Error("Escreva o que precisa ser feito");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("Data inválida");
  const assigneeId = input.assigneeId ?? (input.dealId ? (await defaultAssignee(tx, input.dealId))?.id ?? null : null);
  const [t] = await tx.insert(tasks).values({
    dealId: input.dealId ?? null, contactId: input.contactId, kind: input.kind, title,
    dueAt: input.dueAt, assigneeId, createdBy: userId,
  }).returning();
  if (t.dealId) await logEvent(tx, t.dealId, "tarefa", { acao: "criada", tarefa: t.id, tipo: t.kind, titulo: t.title, para: t.dueAt.toISOString(), ...(input.meta ? input.meta : {}) }, userId);
  return t;
}
```

- [ ] **Passo 3c: script `scripts/tarefas-sem-responsavel.ts`**

```ts
import "dotenv/config";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/server/db";
import { applyTaskAssigneeFix, fixSummary, planTaskAssigneeFix, type AssigneeFix } from "../src/server/domain/task-assignee";

// Tarefas abertas sem responsável → dona do lead ou quem respondeu por último. Idempotente.
// Ensaio:  npx tsx scripts/tarefas-sem-responsavel.ts --dry-run   (imprime a tabela antes/depois, não grava)
// Aplicar: BACKUP_DIR=/home/crm/backups npx tsx scripts/tarefas-sem-responsavel.ts --aplicar   (backup JSON, aplica, confere)

const table = (plan: AssigneeFix[]) => {
  console.table(fixSummary(plan));
  const semDestino = plan.filter((p) => !p.to).length;
  console.log(`Sem responsável antes: ${plan.length} · depois: ${semDestino} · vão receber dona: ${plan.length - semDestino}`);
};

async function main() {
  const mode = process.argv.includes("--aplicar") ? "aplicar" : process.argv.includes("--dry-run") ? "ensaio" : null;
  if (!mode) throw new Error("Use --dry-run (ensaio) ou --aplicar");
  const plan = await planTaskAssigneeFix();
  table(plan);
  if (mode === "ensaio") return;
  const dir = process.env.BACKUP_DIR ?? path.resolve("data/backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `tarefas-sem-responsavel-${new Date().toISOString().replace(/[:.]/g, "-")}-antes.json`);
  await access(file).then(() => { throw new Error(`Backup já existe: ${file}`); }, () => undefined);
  await writeFile(file, JSON.stringify({ geradoEm: new Date().toISOString(), tarefas: plan }, null, 2));
  console.log(`Backup: ${file}`);
  const n = await applyTaskAssigneeFix(plan);
  const after = await planTaskAssigneeFix();
  console.log(`Aplicado: ${n} tarefas. Conferência: ${after.length} continuam sem responsável.`);
  if (after.length !== plan.length - n) throw new Error(`Conferência falhou: esperava ${plan.length - n}, ficou ${after.length}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/domain/task-assignee.test.ts src/server/domain/tasks.test.ts src/server/domain/updates.test.ts src/server/domain/resume-later.test.ts`
Esperado: PASS.
Rode: `npm run typecheck`
Esperado: sem erros.
Rode, no banco local de desenvolvimento: `npx tsx scripts/tarefas-sem-responsavel.ts --dry-run`
Esperado: uma tabela e a linha "Sem responsável antes: … · depois: …", sem nada gravado.

- [ ] **Passo 5: commit**

```bash
git add src/server/domain/task-assignee.ts src/server/domain/task-assignee.test.ts src/server/domain/tasks.ts scripts/tarefas-sem-responsavel.ts
git commit -m "feat(tarefas): tarefa sem responsável vai para a dona ou para quem respondeu por último; script com ensaio, backup e conferência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

A execução em produção deste script está na seção **Implantação**, passo I6 (depois do acerto do 1A, com o ok do dono).

---

### Tarefa B10: sino agrupado, filtros "Para mim" e "Para a gestão", botão Resolver e legenda

**Arquivos:**
- Criar: `src/server/domain/alert-actions.ts`
- Modificar: `src/server/queries/alerts.ts`
- Modificar: `src/app/(app)/funil/actions.ts`, com a nova `resolveAlertsAction`
- Modificar: `src/server/auth/guard-coverage.test.ts:37-43`
- Modificar: `src/components/shell/alerts-bell.tsx`
- Modificar: `src/components/shell/sidebar.tsx:55,100`
- Teste: `src/server/domain/alert-actions.test.ts`

**Interfaces:**
- Consome: `ALERT_GROUP_ORDER`, `ALERT_GROUP_TITLE`, `alertGroupOf`, `BELL_LEGEND` e `HELP_HREF` (B2).
- Produz:
  - `alertsOf(user)`: a condição de quem vê cada aviso
  - `isWaitAlertKey(k): boolean`
  - `resolveAlerts(user: Pick<SessionUser,"id"|"perms">, ids: string[], now?): Promise<number>`
  - `AlertItem` ganha `forMe: boolean`, `forGestao: boolean` e `resolvable: boolean`
  - `resolveAlertsAction(ids: string[]): Promise<ActionResult>`
  - prop `gestao?: boolean` no `AlertsBell`

- [ ] **Passo 1: escrever o teste que falha**

`src/server/domain/alert-actions.test.ts`:
```ts
import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { alerts, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { resolveAlerts } from "./alert-actions";
import { getMyAlerts } from "../queries/alerts";
import type { SessionUser } from "../auth/sessions-store";

beforeEach(async () => { await resetDb(); });

it("Resolver: só os avisos de quem resolve; a espera não se resolve pelo sino; a gestão resolve os dela", async () => {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gest] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const mk = (over: Partial<typeof alerts.$inferInsert>) => db.insert(alerts).values({ audience: "responsavel", type: "tarefa_vencendo", severity: "info", message: "m", dedupeKey: crypto.randomUUID(), ...over }).returning().then((r) => r[0]);
  const tarefa = await mk({ userId: ana.id, waitKey: "task:1" });
  const espera = await mk({ userId: ana.id, type: "sem_resposta_minutos", waitKey: "00000000-0000-4000-8000-000000000001:2026-10-15T12:00:00.000Z" });
  const daBia = await mk({ userId: bia.id });
  const gestao = await mk({ audience: "gestao", type: "envio_automatico_falhou" });
  const asAna = { id: ana.id, perms: permsFor("atendente") }, asGest = { id: gest.id, perms: permsFor("gestor") };

  expect(await resolveAlerts(asAna, [tarefa.id, espera.id, daBia.id, gestao.id])).toBe(1);
  expect(await resolveAlerts(asGest, [gestao.id])).toBe(1);
  const rows = new Map((await db.select().from(alerts)).map((a) => [a.id, !!a.resolvedAt]));
  expect([rows.get(tarefa.id), rows.get(espera.id), rows.get(daBia.id), rows.get(gestao.id)]).toEqual([true, false, false, true]);

  const anaVe = await getMyAlerts(asAna as SessionUser);
  expect(anaVe.find((a) => a.id === espera.id)).toMatchObject({ forMe: true, forGestao: false, resolvable: false });
  const novo = await mk({ audience: "gestao", type: "whatsapp_desconectado" });
  expect((await getMyAlerts(asGest as SessionUser)).find((a) => a.id === novo.id)).toMatchObject({ forMe: false, forGestao: true, resolvable: true });
  // o aviso "outra pessoa respondeu" (Lote 1A, sem wait_key) se resolve pelo sino
  const respondida = await mk({ userId: ana.id, type: "respondida_por_outra" });
  expect((await getMyAlerts(asAna as SessionUser)).find((a) => a.id === respondida.id)).toMatchObject({ forMe: true, resolvable: true });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/domain/alert-actions.test.ts`
Esperado: FAIL com "Failed to resolve import ./alert-actions".

- [ ] **Passo 3a: `src/server/domain/alert-actions.ts`**

```ts
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { db } from "../db";
import { alerts } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";

type Who = Pick<SessionUser, "id" | "perms">;
/** Os avisos que esta pessoa vê no sino: os dela e, para quem recebe escaladas, os da gestão. */
export const alertsOf = (user: Who) => (can(user.perms, "alertas.escalada") ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id));
/** Espera em aberto (`<lead>:<instante>`): some só quando alguém responde, nunca pelo sino. Tarefa (`task:`) e oferta (`oferta:`) resolvem. */
export const isWaitAlertKey = (k: string | null | undefined): boolean => !!k && !k.startsWith("task:") && !k.startsWith("oferta:");

/** "Resolver" no sino: a pessoa já cuidou. Só avisos que ela vê e que não são espera. Devolve quantos resolveu. */
export async function resolveAlerts(user: Who, ids: string[], now = new Date()): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(alertsOf(user), inArray(alerts.id, ids), isNull(alerts.resolvedAt), or(isNull(alerts.waitKey), like(alerts.waitKey, "task:%"), like(alerts.waitKey, "oferta:%"))))
    .returning({ id: alerts.id });
  return rows.length;
}
```

- [ ] **Passo 3b: `src/server/queries/alerts.ts`**

```ts
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { alertsOf, isWaitAlertKey } from "../domain/alert-actions";

export async function getMyAlerts(user: Pick<SessionUser, "id" | "perms">, limit = 30) {
  const rows = await db.select({ a: alerts, contactName: contacts.name, phone: contacts.phoneE164 }).from(alerts)
    .leftJoin(deals, eq(deals.id, alerts.dealId)).leftJoin(contacts, eq(contacts.id, deals.contactId))
    // Aviso de lead arquivado some junto (os avisos sem lead, como WhatsApp caiu, continuam).
    .where(and(alertsOf(user), gte(alerts.createdAt, new Date(Date.now() - 7 * 86_400_000)), isNull(deals.archivedAt)))
    .orderBy(desc(alerts.createdAt)).limit(limit);
  return rows.map(({ a, contactName, phone }) => ({
    id: a.id, dealId: a.dealId, type: a.type, severity: a.severity, level: a.level, message: a.message, createdAt: a.createdAt.toISOString(),
    read: !!a.readAt || !!a.resolvedAt, resolved: !!a.resolvedAt, contactName, phone,
    /** No nome desta pessoa ("Para mim") e/ou da gestão ("Para a gestão"). */
    forMe: a.userId === user.id, forGestao: a.audience === "gestao",
    /** Dá para tirar pelo botão Resolver (a espera some sozinha quando alguém responde). */
    resolvable: !a.resolvedAt && !isWaitAlertKey(a.waitKey),
  }));
}
export type AlertItem = Awaited<ReturnType<typeof getMyAlerts>>[number];
```

- [ ] **Passo 3c: ação e lista de exceções**

Em `src/app/(app)/funil/actions.ts`, acrescente `import { resolveAlerts } from "@/server/domain/alert-actions";` e, depois de `markAlertsReadAction`:
```ts
/** "Resolver" no sino: a pessoa já cuidou (ver `resolveAlerts`). */
export async function resolveAlertsAction(ids: string[]): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const valid = z.array(z.string().uuid()).min(1).max(100).parse(ids);
    await resolveAlerts(user, valid);
    await emit("alerta", {});
    return { ok: true };
  } catch (e) { return fail(e); }
}
```
Em `src/server/auth/guard-coverage.test.ts`, no `ACTION_SESSION_ONLY`:
```ts
  resolveAlertsAction: "resolve avisos da própria pessoa (e da gestão, para quem recebe escaladas); a espera não",
```

- [ ] **Passo 3d: `src/components/shell/alerts-bell.tsx`**

Imports novos:
```ts
import { claimAction, markAlertsReadAction, resolveAlertsAction } from "@/app/(app)/funil/actions";
import { Tabs } from "@/components/ui/tabs";
import { ALERT_GROUP_ORDER, ALERT_GROUP_TITLE, BELL_LEGEND, HELP_HREF, alertGroupOf } from "@/lib/alert-copy";
```
Assinatura e estado:
```tsx
type Filtro = "tudo" | "mim" | "gestao";
const DOT = { alert: "bg-alert", gold: "bg-gold", ok: "bg-ok" } as const;

export function AlertsBell({ alerts, reload, gestao = false }: { alerts: AlertItem[]; reload?: () => Promise<void>;
  /** Recebe escaladas: mostra os filtros "Para mim" e "Para a gestão". */ gestao?: boolean }) {
```
Depois de `const unread = …`:
```tsx
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const shown = alerts.filter((a) => filtro === "tudo" || (filtro === "mim" ? a.forMe : a.forGestao));
  const groups = ALERT_GROUP_ORDER.map((g) => ({ g, items: shown.filter((a) => alertGroupOf(a.type) === g) })).filter((x) => x.items.length > 0);
  const resolve = (a: AlertItem) => start(async () => { const r = await resolveAlertsAction([a.id]); if (r.ok) await reload?.(); });
```
Substitua o conteúdo de `<div className="overflow-y-auto scroll-thin min-h-0">…</div>` (linhas 122-151):
```tsx
            <div className="overflow-y-auto scroll-thin min-h-0">
              {notifPerm === "default" && (
                <button className="w-full text-left px-4 py-3 min-h-11 text-sm bg-gold-soft text-gold-ink" onClick={async () => { await Notification.requestPermission(); setPermTick((t) => t + 1); }}>
                  Ativar notificações do navegador para não perder nenhum lead
                </button>
              )}
              {gestao && alerts.length > 0 && (
                <Tabs<Filtro> label="Para quem" value={filtro} onChange={setFiltro} className="mx-3 mt-2"
                  items={[{ value: "tudo", label: "Tudo", count: alerts.length }, { value: "mim", label: "Para mim", count: alerts.filter((a) => a.forMe).length },
                    { value: "gestao", label: "Para a gestão", count: alerts.filter((a) => a.forGestao).length }]} />
              )}
              {shown.length === 0 ? <p className="px-4 py-8 text-center text-muted text-sm">{alerts.length === 0 ? "Nenhum alerta nos últimos 7 dias." : "Nada neste filtro."}</p> : groups.map(({ g, items }) => (
                <section key={g} aria-labelledby={`sino-${g}`}>
                  <h3 id={`sino-${g}`} className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{ALERT_GROUP_TITLE[g]} <span className="tabular">({items.length})</span></h3>
                  <ul>
                    {items.map((a) => (
                      <li key={a.id} className="relative flex items-stretch border-b border-line/70">
                        <Link href={leadHref(a.dealId)} onClick={(e) => openAlert(e, a)} className="flex flex-1 min-w-0 gap-3 px-4 py-3 min-h-11 hover:bg-paper-2 transition-colors">
                          <span className={`mt-1.5 size-2 rounded-full shrink-0 ${a.read ? "opacity-50" : ""} ${a.resolved ? DOT.ok : a.severity === "urgente" ? DOT.alert : DOT.gold}`} />
                          <span className="min-w-0">
                            <span className={`block text-sm leading-snug ${a.read ? "text-graphite" : "font-medium"}`}>{!a.read && <span className="sr-only">não lido: </span>}{a.message}</span>
                            <span className="block text-xs text-muted mt-0.5">{relTime(a.createdAt)}{a.resolved ? " · resolvido" : ""}{gestao && a.forGestao && !a.forMe ? " · para a gestão" : ""}</span>
                          </span>
                        </Link>
                        {/* Oferta da distribuição: assume com um toque e abre a conversa. */}
                        {a.type === "oferta" && !a.resolved && a.dealId && (
                          <button type="button" disabled={pending} onClick={() => claimFromOffer(a)}
                            className="self-center mr-2 h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-medium shrink-0 disabled:opacity-60">Assumir</button>
                        )}
                        {a.resolvable && (
                          <button type="button" disabled={pending} onClick={() => resolve(a)} aria-label={`Resolver: ${a.message}`}
                            className="self-center mr-3 h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] border border-line-strong text-sm font-medium text-ink shrink-0 hover:bg-paper-2 disabled:opacity-60">Resolver</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-1.5 text-xs text-graphite">
              {BELL_LEGEND.map((l) => <span key={l.tone} className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2 rounded-full ${DOT[l.tone]}`} />{l.text}</span>)}
              <Link href={HELP_HREF} onClick={() => setOpen(false)} className="ml-auto inline-flex min-h-11 lg:min-h-8 items-center text-gold-ink hover:underline">O que cada aviso quer dizer</Link>
            </footer>
```
Em `src/components/shell/sidebar.tsx`, nas linhas 55 e 100: `<AlertsBell alerts={alerts} reload={reload} gestao={can(user.perms, "alertas.escalada")} />`.

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/domain/alert-actions.test.ts src/server/auth/guard-coverage.test.ts`
Esperado: PASS.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.
Rode: `npx playwright test e2e/alertas.spec.ts e2e/distribuicao.spec.ts`
Esperado: PASS. "Assumir" e "Marcar como lidos" continuam como estavam.

- [ ] **Passo 5: commit**

```bash
git add src/server/domain/alert-actions.ts src/server/domain/alert-actions.test.ts src/server/queries/alerts.ts "src/app/(app)/funil/actions.ts" src/server/auth/guard-coverage.test.ts src/components/shell/alerts-bell.tsx src/components/shell/sidebar.tsx
git commit -m "feat(sino): agrupado por tipo, filtros Para mim/Para a gestão, botão Resolver e legenda das cores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B11: Hoje (aba "Sem responsável" para a gestão, aniversários sem exigir lead e no dia certo)

**Arquivos:**
- Modificar: `src/server/domain/tasks.ts:62-67`, o `listTasks`
- Modificar: `src/server/queries/today.ts`
- Modificar: `src/components/today/next-actions.tsx`
- Modificar: `src/app/(app)/page.tsx` (bloco "Minhas próximas ações" e "Aniversários da semana"; a A8 já pôs o `TeamNowPanel` neste arquivo, ele fica)
- Teste: `src/server/queries/today.test.ts`, só acréscimos

**Interfaces:**
- Consome: `clientLabel` (B2) e o componente `Tabs` de `src/components/ui/tabs.tsx`.
- Produz:
  - `listTasks({ assigneeId?, unassigned?, dueBefore, open: true })`
  - `type TodayBirthday = { contactId: string; dealId: string | null; name: string; label: string; today: boolean }`
  - `getToday(...)` passa a devolver `birthdays: TodayBirthday[]` e `unassigned: TodayTask[] | null` (null quando quem vê não é gestão)
  - `<NextActionsPanel mine unassigned nowMs />`

- [ ] **Passo 1: escrever os testes que falham**

Acrescente a `src/server/queries/today.test.ts`:
```ts
describe("Hoje: Sem responsável e aniversários", () => {
  it("gestão vê a aba Sem responsável; atendente não recebe a lista", async () => {
    const { ana, gestora, mk, task } = await setup();
    const { c, d } = await mk(null);
    await task(c, d, { title: "Retomar orçamento", dueAt: new Date(NOW.getTime() - 3_600_000), assigneeId: null });
    await task(c, d, { title: "Da Ana", assigneeId: ana.id });
    const g = await getToday(as(gestora), NOW);
    expect(g.unassigned!.map((t) => t.title)).toEqual(["Retomar orçamento"]);
    expect(g.tasks).toEqual([]);
    expect((await getToday(as(ana), NOW)).unassigned).toBeNull();
  });

  it("aniversários sem exigir lead, no dia certo (29, 30 e 31 não caem no 28) e no escopo de quem vê", async () => {
    const { ana, bia, gestora, mk } = await setup();
    const now = new Date(Date.UTC(2026, 9, 27, 15, 0)); // terça 27/10, 12h em Salvador
    const daBia = await mk(bia.id);
    await db.update(contacts).set({ birthDay: 29, birthMonth: 10 }).where(eq(contacts.id, daBia.c.id));
    await db.insert(contacts).values([
      { name: "Sem Lead", phoneE164: "+5571999920001", birthDay: 30, birthMonth: 10 },
      { name: "Dia 31", phoneE164: "+5571999920002", birthDay: 31, birthMonth: 10 },
      { name: "Longe", phoneE164: "+5571999920003", birthDay: 10, birthMonth: 11 },
      { name: "Ignorada", phoneE164: "+5571999920004", birthDay: 28, birthMonth: 10, ignored: true },
    ]);
    const g = await getToday(as(gestora), now);
    expect(g.birthdays.map((b) => [b.name, b.label])).toEqual([["Cliente 1", "29/10"], ["Sem Lead", "30/10"], ["Dia 31", "31/10"]]);
    expect(g.birthdays.find((b) => b.name === "Sem Lead")!.dealId).toBeNull();
    expect(g.birthdays.find((b) => b.name === "Cliente 1")!.dealId).toBe(daBia.d.id);
    expect((await getToday(as(ana), now)).birthdays.map((b) => b.name)).toEqual(["Sem Lead", "Dia 31"]); // a da Bia fica com a Bia
  });

  it("29/02 em ano que não é bissexto aparece no 28/02", async () => {
    const { gestora } = await setup();
    await db.insert(contacts).values({ name: "Bissexta", phoneE164: "+5571999920009", birthDay: 29, birthMonth: 2 });
    const g = await getToday(as(gestora), new Date(Date.UTC(2027, 1, 25, 15, 0)));
    expect(g.birthdays.map((b) => [b.name, b.label])).toEqual([["Bissexta", "29/02"]]);
  });
});
```
Atenção ao primeiro teste: a B9 faz `createTaskTx` preencher o responsável vazio. Se o helper `task` do arquivo cria pela `createTask`, a tarefa "Retomar orçamento" de uma conversa sem dona e sem resposta continua sem responsável (não há para quem ir). Se o helper insere direto na tabela, nada muda.

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/server/queries/today.test.ts`
Esperado: FAIL. `unassigned` está undefined, os aniversários sem lead não aparecem e o 30/10 cai no 28.

- [ ] **Passo 3a: `listTasks` (`src/server/domain/tasks.ts`)**

```ts
/** Tarefas em aberto com vencimento até `dueBefore`, da mais urgente para a menos. `unassigned`: só as sem responsável. */
export async function listTasks(opts: { assigneeId?: string; unassigned?: boolean; dueBefore: Date; open: true }) {
  return db.select().from(tasks)
    .where(and(isNull(tasks.doneAt), lte(tasks.dueAt, opts.dueBefore), opts.assigneeId ? eq(tasks.assigneeId, opts.assigneeId) : opts.unassigned ? isNull(tasks.assigneeId) : undefined))
    .orderBy(asc(tasks.dueAt));
}
```

- [ ] **Passo 3b: `src/server/queries/today.ts`**

Imports: acrescente `import { clientLabel } from "../../lib/alert-copy";`.

Troque `myTasks` por:
```ts
/**
 * Próximas ações vencidas ou para hoje (Salvador), da mais antiga para a mais nova (vencidas primeiro): as da pessoa ("Minhas") ou as sem
 * responsável (aba da gestão). O comparecimento tem lista própria; lead arquivado e contato ignorado ficam de fora.
 */
async function tasksOf(filter: { assigneeId: string } | { unassigned: true }, now: Date): Promise<TodayTask[]> {
  const endOfToday = new Date(bahiaAt(now.getTime(), 1, 0).getTime() - 1);
  const open = (await listTasks({ ...filter, dueBefore: endOfToday, open: true })).filter((t) => t.kind !== "comparecimento");
  if (!open.length) return [];
  const [cs, ds] = await Promise.all([
    db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164, ignored: contacts.ignored }).from(contacts).where(inArray(contacts.id, [...new Set(open.map((t) => t.contactId))])),
    db.select({ id: deals.id, archivedAt: deals.archivedAt }).from(deals).where(and(inArray(deals.id, open.flatMap((t) => (t.dealId ? [t.dealId] : []))))),
  ]);
  const contact = new Map(cs.map((c) => [c.id, c])), deal = new Map(ds.map((d) => [d.id, d]));
  return open
    .filter((t) => !contact.get(t.contactId)?.ignored && !(t.dealId && deal.get(t.dealId)?.archivedAt))
    .slice(0, TASKS_LIMIT)
    .map((t) => {
      const c = contact.get(t.contactId);
      return { id: t.id, title: t.title, kind: t.kind, dueAt: t.dueAt.toISOString(), overdue: t.dueAt.getTime() < now.getTime(), dealId: t.dealId, contactId: t.contactId,
        name: c ? clientLabel(c.name, c.phone) : "Contato" };
    });
}

export type TodayBirthday = { contactId: string; dealId: string | null; name: string; label: string; today: boolean };
const pad2 = (n: number) => String(n).padStart(2, "0");
/**
 * Aniversários dos próximos 7 dias (hoje incluído), de TODOS os contatos (não exige lead), no dia certo: compara dia e mês de cada um dos
 * 8 dias, então 29, 30 e 31 caem no próprio dia. Quem nasceu em 29/02 comemora no 28/02 em ano não bissexto. Atendente não vê quem tem
 * conversa aberta com outra dona. O link vai para o lead mais recente, ou para a ficha quando não há lead.
 */
async function birthdaysOf(user: Pick<SessionUser, "id">, all: boolean, now: Date): Promise<TodayBirthday[]> {
  const day0 = sql`(${now.toISOString()}::timestamptz - ${sql.raw(OFFSET)})::date`;
  const rows = (await db.execute(sql`
    with dias as (select (${day0} + g)::date as dia, g from generate_series(0, 7) g)
    select c.id as "contactId", c.name, c.phone_e164 as phone, c.birth_day as day, c.birth_month as month, min(dias.g)::int as "in_days",
      (select d.id from deals d where d.contact_id = c.id and d.archived_at is null order by d.closed_at nulls first, d.created_at desc limit 1) as "dealId"
    from contacts c
    join dias on extract(month from dias.dia)::int = c.birth_month and (
      extract(day from dias.dia)::int = c.birth_day
      or (c.birth_month = 2 and c.birth_day = 29 and extract(day from dias.dia)::int = 28
          and extract(day from (date_trunc('year', dias.dia) + interval '1 month 28 days'))::int <> 29))
    where c.ignored = false
      ${all ? sql`` : sql`and not exists (select 1 from deals o where o.contact_id = c.id and o.archived_at is null and o.closed_at is null and o.owner_id is not null and o.owner_id <> ${user.id})`}
    group by c.id
    order by min(dias.g), c.name
    limit 200`)).rows as { contactId: string; name: string | null; phone: string; day: number; month: number; in_days: number; dealId: string | null }[];
  return rows.map((r) => ({ contactId: r.contactId, dealId: r.dealId, name: clientLabel(r.name, r.phone), label: `${pad2(r.day)}/${pad2(r.month)}`, today: r.in_days === 0 }));
}
```
Em `getToday`:
- tire do `Promise.all` a consulta `birthdays` antiga, a das linhas 55-57;
- troque `myTasks(user, now)` por `tasksOf({ assigneeId: user.id }, now)`;
- acrescente ao `Promise.all`: `birthdaysOf(user, all, now)` e `all ? tasksOf({ unassigned: true }, now) : Promise.resolve(null)`;
- acrescente à desestruturação, na mesma ordem: `birthdays, unassigned`;
- no `return`, acrescente `unassigned`.

- [ ] **Passo 3c: `src/components/today/next-actions.tsx`**

Mude a assinatura de `NextActions` para aceitar um texto vazio:
```tsx
export function NextActions({ items, nowMs, empty = "Nenhuma ação vencida nem marcada para hoje. Defina a próxima ação de um lead na Fila." }: { items: TodayTask[]; nowMs: number; empty?: string }) {
```
Use `empty` no `if (!list.length) return <p …>{empty}</p>;`.

Acrescente ao fim do arquivo, com `import { Tabs } from "@/components/ui/tabs";` no topo:
```tsx
/**
 * "Minhas próximas ações" com a aba "Sem responsável" para a gestão: nada some em silêncio (antes, a gestão via "Nenhuma ação vencida" com 50
 * vencidas sem dono). Abre em "Sem responsável" quando a pessoa não tem nada e lá há pendência.
 */
export function NextActionsPanel({ mine, unassigned, nowMs }: { mine: TodayTask[]; unassigned: TodayTask[] | null; nowMs: number }) {
  const [tab, setTab] = useState<"minhas" | "sem">(!mine.length && unassigned?.length ? "sem" : "minhas");
  if (!unassigned) return <NextActions items={mine} nowMs={nowMs} />;
  return (
    <>
      <Tabs<"minhas" | "sem"> idPrefix="proximas" label="De quem" value={tab} onChange={setTab} className="mx-5 mb-2"
        items={[{ value: "minhas", label: "Minhas", count: mine.length }, { value: "sem", label: "Sem responsável", count: unassigned.length }]} />
      <div id="proximas-panel" role="tabpanel" aria-labelledby={`proximas-tab-${tab}`}>
        {tab === "minhas" ? <NextActions items={mine} nowMs={nowMs} />
          : <NextActions items={unassigned} nowMs={nowMs} empty="Nenhum combinado sem responsável. Toda tarefa nova já vai para a dona da conversa ou para quem respondeu por último." />}
      </div>
    </>
  );
}
```
Se `useState` ainda não estiver importado de `react` no arquivo, acrescente.

- [ ] **Passo 3d: `src/app/(app)/page.tsx`**

Import: `import { NextActionsPanel } from "@/components/today/next-actions";`, no lugar de `NextActions`.

No bloco "Minhas próximas ações": `<NextActionsPanel mine={t.tasks} unassigned={t.unassigned} nowMs={now.getTime()} />`.

Troque o `<Block title="Aniversários da semana" …/>` por:
```tsx
          <section aria-labelledby="h-aniversarios" className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
            <h2 id="h-aniversarios" className="flex items-center gap-2 text-base font-semibold"><span className="text-gold"><IconCake size={16} /></span>Aniversários da semana<span className="text-muted font-normal tabular">{t.birthdays.length || ""}</span></h2>
            {t.birthdays.length === 0 ? <p className="text-sm text-muted mt-2">Nenhum aniversário nos próximos 7 dias.</p> : (
              <ul className="mt-2 divide-y divide-line/70">
                {t.birthdays.slice(0, 8).map((b) => (
                  <li key={b.contactId}>
                    <Link href={b.dealId ? leadHref(b.dealId) : `/contatos/${b.contactId}`} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink transition-colors">
                      <span className="truncate">{b.name}</span><span className="text-muted shrink-0 tabular">{b.today ? "hoje" : b.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {t.birthdays.length > 8 && <p className="mt-2 text-xs text-muted">e mais {t.birthdays.length - 8} nesta semana</p>}
          </section>
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/server/queries/today.test.ts src/server/domain/tasks.test.ts`
Esperado: PASS.
Rode: `npm run typecheck && npm run lint`
Esperado: sem erros.
Rode: `npx playwright test e2e/hoje.spec.ts`
Esperado: PASS. A atendente continua vendo a região "Minhas próximas ações" sem abas.

- [ ] **Passo 5: commit**

```bash
git add src/server/domain/tasks.ts src/server/queries/today.ts src/server/queries/today.test.ts src/components/today/next-actions.tsx "src/app/(app)/page.tsx"
git commit -m "feat(hoje): aba Sem responsável para a gestão; aniversários da semana sem exigir lead e no dia certo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B12: Histórico sem códigos crus

**Arquivos:**
- Modificar: `src/lib/history.ts:61-107`
- Teste: `src/lib/history.test.ts`, só acréscimos

**Interfaces:**
- Consome: `dueLabel`, que já é importado ali.
- Produz:
  - textos para `conversa_arquivada`, `conversa_desarquivada`, `contato_mesclado`, `espera_virou_followup`, `espera_encerrada_agradecimento` e `retomar_depois`;
  - código desconhecido vira "Outro registro do sistema" e nunca aparece cru.

- [ ] **Passo 1: escrever o teste que falha**

```ts
it("códigos do sistema viram frases (nada de conversa_arquivada na tela)", () => {
  const es = historyEntries([
    ev("1", "conversa_arquivada", {}, "2026-10-13T17:00:00Z"),
    ev("2", "conversa_desarquivada", { motivo: "cliente_escreveu" }, "2026-10-13T17:01:00Z", null),
    ev("3", "contato_mesclado", { lid: "1020" }, "2026-10-13T17:02:00Z", null),
    ev("4", "espera_virou_followup", { etapaAntes: "lead" }, "2026-10-13T17:03:00Z", null),
    ev("5", "espera_encerrada_agradecimento", { mensagens: 1 }, "2026-10-13T17:04:00Z", null),
    ev("6", "retomar_depois", { dueAt: "2026-10-14T13:00:00.000Z", etapaAntes: "atendimento" }, "2026-10-13T17:05:00Z"),
    ev("7", "codigo_que_nao_existe", {}, "2026-10-13T17:06:00Z", null),
    ev("8", "conversa_desarquivada", { motivo: "manual" }, "2026-10-13T17:07:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual([
    "Conversa reaberta",
    "Outro registro do sistema",
    "Retomar depois: lembrete para amanhã 10:00",
    "Espera encerrada: a cliente só agradeceu",
    "Ninguém respondeu até o fim do dia: virou follow-up",
    "Contatos juntados (mesmo número)",
    "Conversa reaberta: a cliente escreveu",
    "Conversa encerrada (saiu da Fila)",
  ]);
  for (const e of es) expect(e.text).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx vitest run src/lib/history.test.ts`
Esperado: FAIL. Os códigos crus ainda aparecem, por exemplo "conversa_arquivada".

- [ ] **Passo 3: implementar**

Em `lines()`, antes de `default:`:
```ts
    case "conversa_arquivada": return one("Conversa encerrada (saiu da Fila)");
    case "conversa_desarquivada": return one(p.motivo === "cliente_escreveu" ? "Conversa reaberta: a cliente escreveu" : "Conversa reaberta");
    case "contato_mesclado": return one("Contatos juntados (mesmo número)");
    case "espera_virou_followup": return one("Ninguém respondeu até o fim do dia: virou follow-up", "etapa");
    case "espera_encerrada_agradecimento": return one("Espera encerrada: a cliente só agradeceu");
    case "retomar_depois": return one(`Retomar depois${typeof p.dueAt === "string" ? `: lembrete para ${dueLabel(Date.parse(p.dueAt), ms(e.createdAt))}` : ""}`);
```
Troque o `default:`:
```ts
    // Código novo sem frase ainda: nunca mostrar o código cru para a equipe.
    default: return one("Outro registro do sistema");
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx vitest run src/lib/history.test.ts src/lib/contact-timeline.test.ts`
Esperado: PASS (inclusive o teste do "Virou a dona" da A3).

- [ ] **Passo 5: commit**

```bash
git add src/lib/history.ts src/lib/history.test.ts
git commit -m "feat(historico): traduz os códigos crus (encerrada, reaberta, contatos juntados, espera virou follow-up, retomar depois)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B13: página "O que cada aviso quer dizer"

**Arquivos:**
- Criar: `src/app/(app)/ajuda/avisos/page.tsx`
- Teste e2e: `e2e/a11y.spec.ts:30` (rota nova em `rotasComuns`)
- Teste: `src/server/auth/guard-coverage.test.ts`. Não muda nada: a página usa `requirePerm`.

**Interfaces:**
- Consome: `helpCatalog()` (B2).
- Produz: a rota `/ajuda/avisos`, com âncoras `#<grupo>` e `#<entrada>`, por exemplo `#fila-atrasados` e `#alerta-espera`. Os links do resumo da Fila (B5) e do sino (B10) apontam para ela.

- [ ] **Passo 1: escrever o teste que falha**

Em `e2e/a11y.spec.ts`, linha 30:
```ts
const rotasComuns = ["/", "/atendimento", "/funil", "/contatos", "/relatorios", "/atendimento/<id>", "/contatos/<id>", "/ajuda/avisos"];
```
Acrescente ao fim do arquivo:
```ts
test("ajuda dos avisos: gerada das mesmas frases da Fila e do sino", async ({ page }) => {
  await login(page, ATENDENTE);
  await page.goto("/ajuda/avisos");
  await expect(page.getByRole("heading", { name: "O que cada aviso quer dizer" })).toBeVisible();
  await expect(page.locator("#fila-atrasados")).toContainText("A cliente escreveu e ninguém respondeu no prazo. Responda primeiro.");
  await expect(page.locator("#alerta-espera")).toContainText("espera resposta desde 14:02 (prazo 15 min)");
  await expect(page.locator("#alerta-respondida")).toContainText("Ela continua sua; se for para passar, use Transferir.");
  await expect(page.locator("#sinal-pediu_preco")).toContainText("Some quando a Casa mandar um valor.");
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx playwright test e2e/a11y.spec.ts -g "ajuda dos avisos"`
Esperado: FAIL com 404.

- [ ] **Passo 3: implementar `src/app/(app)/ajuda/avisos/page.tsx`**

```tsx
import { requirePerm } from "@/server/auth/session";
import { helpCatalog } from "@/lib/alert-copy";

export const metadata = { title: "O que cada aviso quer dizer" };

/** Para treinar a equipe: cada seção, chip, cor e alerta, com a mesma frase da tela (gerada de `alert-copy`, nunca escrita à parte). */
export default async function AvisosPage() {
  await requirePerm("atendimento.ver");
  const groups = helpCatalog();
  return (
    <main className="px-5 lg:px-8 pt-6 lg:pt-9 pb-12 max-w-[860px]">
      <h1 className="font-display text-[34px] lg:text-[40px] leading-tight font-light">O que cada aviso quer dizer</h1>
      <p className="mt-2 text-graphite max-w-[60ch]">Cada aviso diz o que aconteceu, de quem é e o que fazer. As frases aqui são as mesmas que aparecem na Fila, na conversa, no sino e no Hoje.</p>
      <nav aria-label="Assuntos" className="mt-5 flex flex-wrap gap-2">
        {groups.map((g) => <a key={g.id} href={`#${g.id}`} className="inline-flex min-h-11 lg:min-h-9 items-center rounded-full border border-line-strong px-3 text-sm hover:bg-paper-2">{g.title}</a>)}
      </nav>
      {groups.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`h-${g.id}`} className="mt-8 scroll-mt-6">
          <h2 id={`h-${g.id}`} className="font-display text-[24px] font-medium">{g.title}</h2>
          <dl className="mt-3 divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
            {g.entries.map((e) => (
              <div key={e.id} id={e.id} className="scroll-mt-6 px-4 py-3">
                <dt className="font-semibold text-ink">{e.title}</dt>
                <dd className="mt-0.5 text-sm text-graphite">
                  {e.text}
                  {e.example && <span className="mt-1 block text-ink-2">Exemplo: “{e.example}”</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Passo 4: rodar e ver passar**

Rode: `npx playwright test e2e/a11y.spec.ts`
Esperado: PASS, sem violação grave de axe e sem rolagem lateral em `/ajuda/avisos` nos dois perfis.
Rode: `npx vitest run src/server/auth/guard-coverage.test.ts`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
git add "src/app/(app)/ajuda/avisos/page.tsx" e2e/a11y.spec.ts
git commit -m "feat(ajuda): página O que cada aviso quer dizer, gerada das mesmas frases da tela

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa B14: verificação final do 1B e prints de depois

**Arquivos:** nenhum novo. Só verificação.

- [ ] **Passo 1: suíte inteira, tipos e lint**

Rode: `npm run typecheck && npm run lint && npm test`
Esperado: zero erros e todos os testes PASS.

- [ ] **Passo 2: e2e inteiro**

Rode: `npx playwright test`
Esperado: PASS nos dois projetos (desktop e celular).

- [ ] **Passo 3: prints de depois e comparação**

```bash
mkdir -p e2e/shots/lote1b/depois
CF_SHOTS_DIR=e2e/shots/lote1b/depois npx playwright test e2e/fila.spec.ts e2e/hoje.spec.ts --project=desktop
```
Esperado: os PNGs de `e2e/shots/lote1b/depois/` mostram:
- os títulos novos com a frase embaixo;
- o resumo com "sem dono" e "combinados vencidos";
- nenhuma seção "Prazo estourado";
- linhas sem "Cliente" e sem "Não identificada";
- "Ela veio?" aberta;
- "Combinados para hoje e atrasados" com "venceu … HH:MM";
- o prefixo "Sara:"/"Cati:" do 1A no lugar de "Você:".

Compare com `e2e/shots/lote1b/antes/`. Depois, apague as duas pastas: `rm -rf e2e/shots/lote1b`.

- [ ] **Passo 4: conferir que nada sobrou do vocabulário antigo**

Rode:
```bash
grep -rn -E "Prazo estourado|prazo estourado há|Perto do prazo|Aguardando resposta\"|Aguardando a cliente\"|Próximas ações de hoje|Conferir comparecimento|Responde rápido|Transferida por|A mensagem está pronta|transferiu a |Pode assumir a |SECTION_LABEL|respondeu_rapido|>Você: " src e2e --exclude="*.test.ts" --exclude="*.test.tsx"
```
Esperado: nenhuma linha (os testes ficam de fora: eles citam os textos antigos de propósito, para garantir que sumiram). Só comentários históricos são aceitáveis, e nesse caso reescreva o comentário.

- [ ] **Passo 5: `git status` limpo**

Rode: `git status --short`
Esperado: nenhum arquivo do lote fora de commit. Os arquivos que já estavam modificados ou soltos antes do plano (`e2e/shots/relatorios-pdf/*.pdf`, `tsconfig.json`, `.next-copia/`, `emoji-*.png`) continuam fora e não entram em nenhum commit.

---

### Interfaces que o Lote 1B expõe

**`src/lib/alert-copy.ts` (novo, puro, servidor e navegador)**
- Quem e quando:
  - `HELP_HREF = "/ajuda/avisos"`
  - `firstName` (reexportado de `src/lib/authorship.ts`)
  - `clientLabel(name: string | null | undefined, phone: string): string`: nome; sem nome, "cliente com final 1234"; `lid:`, "cliente sem nome"
  - `sinceLabel(ms: number, now: number): string`, `dueText(dueMs: number, now: number): string` e `stoppedText(days: number): string`
- Prazo:
  - `slaText(waitSeconds: number, slaMinutes: number | null): string | null`
  - `WAIT_CLOCK_PREFIX`, `waitClockSuffix(sla: number | null)`, `waitClockText(waited: string, sla: number | null)` e `WAIT_CLOCK_HELP`
- Seções da Fila:
  - `SECTION_TITLE: Record<QueueSectionKey, string>`, `sectionHelp(key: QueueSectionKey, n?: number | null): string`
  - `PARADOS_ACTIONS`: o 1C (C3) troca para "Agendar, Aguardar cliente ou Encerrar"
  - `ATTENDANCE_TITLE`, `ATTENDANCE_HELP`, `SUMMARY_HELP` e `ARCHIVED_ROW`
- Dona e quem respondeu:
  - `NO_OWNER`, `NO_OWNER_HINT`, `ownerHint(ownerName: string | null, mine: boolean)`
  - `transferText(byName, toName, viewerIsNewOwner)`
  - `answeredText({ by: string | null; fromPhone: boolean; at: string })`
- Chips:
  - `CHIP_HELP`, `SIGNAL_HELP: Record<Signal, string>`, `INTEREST_HELP`, `KEYWORD_HELP` e `TAG_HELP`
  - `chipHelp(label: string): string`
- Cores: `COLOR_HELP: HelpEntry[]`
- Alertas:
  - `taskTitleFor(title: string, contactName: string | null): string`
  - `alertText.wait({ client, sinceMs, slaMinutes, ownerName, now })`
  - `alertText.escalated({ client, sinceMs, ownerName, now })`
  - `alertText.taskDue({ title, contactName, client, overdue })`
  - `alertText.offer(client)`, `alertText.claimed(actor, client)`, `alertText.transferred(actor, client)` e `alertText.repliedByOther(actor, client)`
  - `alertText.birthday(client, day, month)` e `alertText.autoSendFailed(client, why?)`
- Sino:
  - `type AlertGroup`, `ALERT_GROUP_ORDER` e `ALERT_GROUP_TITLE`
  - `ALERT_TYPES: string[]`, `alertGroupOf(type: string): AlertGroup`
  - `ALERT_HELP: (HelpEntry & { types: string[] })[]` e `BELL_LEGEND`
- Ajuda:
  - `type HelpEntry = { id; title; text; example? }` e `type HelpGroup = { id; title; entries }`
  - `helpCatalog(): HelpGroup[]`

**`src/lib/queue.ts`**
- `NEAR_SLA_RATIO = 0.6`
- `type SlaLevel = "none" | "ok" | "near" | "over" | "late"`
- `slaLevel({ awaiting, alert, waitSeconds, slaMinutes }): SlaLevel`, a regra única
- `RING_COLOR: Record<RingState, string>`
- `ringState({ awaiting, late, waitSeconds, slaMinutes })`: `late` = só alerta aberto
- `slaStatus(...)` com os textos de `slaText`
- `QueueSectionKey` sem `"estourado"`
- `QUEUE_FOCOS` com `"combinados"`
- `VIEW_LABEL.arquivadas = "Encerradas"`
- `SECTION_LABEL` foi removido. Use `SECTION_TITLE`.

**`src/components/pipeline/timer.tsx`**
- `urgencyOf(sinceIso, slaMinutes, now, hours?, alert = false)`
- `useUrgency(since, sla, alert = false)` e `useUrgencyLevel(since, sla, alert = false)`

**`src/components/motion/elapsed.tsx`**
- prop `alert?: boolean`

**`src/server/queries/queue.ts`**
- `QueueItem` ganha (além dos campos da A6):
  - `alert?: boolean`
  - `badges?: string[]`
  - `stoppedDays?: number`
  - `transferNote?: string`
  - `signals`: só sinais automáticos, no máximo 2
- `QueueSection` ganha `n?: number`
- `counts.atrasados`: alerta OU prazo passado. `countLateLeads` continua só com alerta.
- `nextWaitingId` ignora conversa encerrada.

**`src/server/queries/deal.ts`**
- `DealDetail.late: boolean`

**`src/server/domain/signals.ts`**
- `Signal` sem `respondeu_rapido`
- `pediu_preco` e `pediu_horario` valem só enquanto não respondidos

**`src/lib/why-late.ts`**
- `WhyLateItem` ganha `lastBy?: string | null` e `lastFromPhone?: boolean`

**`src/lib/primary-action.ts`**
- `askAttendance({ stageKind, scheduledAt, attendance }, nowMs): boolean`

**`src/server/domain/task-assignee.ts` (novo)**
- `defaultAssignee(q, dealId): Promise<{ id; via: "dona" | "ultima_resposta" } | null>`
- `type AssigneeFix`
- `planTaskAssigneeFix(): Promise<AssigneeFix[]>`
- `applyTaskAssigneeFix(plan): Promise<number>`
- `fixSummary(plan)`

**`src/server/domain/tasks.ts`**
- `createTaskTx` preenche o responsável vazio
- `listTasks({ assigneeId?, unassigned?, dueBefore, open })`
- `remindDueTasks(now?, hours?)`: não faz nada com a Casa fechada

**`src/server/rules/engine.ts`**
- `Candidate` ganha `ownerName`, `birthDay`, `birthMonth` e `limitMinutes`
- espera, escalado e aniversário passam a ter texto fixo

**`src/server/domain/alert-actions.ts` (novo)**
- `alertsOf(user)`, `isWaitAlertKey(k)`
- `resolveAlerts(user, ids, now?): Promise<number>`

**`src/server/queries/alerts.ts`**
- `getMyAlerts(user: Pick<SessionUser,"id"|"perms">, limit?)`
- `AlertItem` ganha `forMe`, `forGestao` e `resolvable`

**`src/app/(app)/funil/actions.ts`**
- `resolveAlertsAction(ids: string[]): Promise<ActionResult>`

**`src/server/queries/today.ts`**
- `type TodayBirthday = { contactId; dealId: string | null; name; label; today }`
- `getToday` devolve também `birthdays: TodayBirthday[]` e `unassigned: TodayTask[] | null`

**Componentes**
- `<NextActionsPanel mine unassigned nowMs />`
- `<NextActions items nowMs empty? />`
- `<AlertsBell alerts reload gestao? />`
- `<WhyLate … alert? lastBy? lastFromPhone? />`

**Rota nova:** `/ajuda/avisos`

**Script:** `scripts/tarefas-sem-responsavel.ts --dry-run | --aplicar`, com `BACKUP_DIR`.

### Arquivos que o Lote 1B mexe

**Criados**
- `src/lib/alert-copy.ts`, `src/lib/alert-copy.test.ts`
- `src/components/pipeline/timer.test.ts`
- `src/server/queries/deal-late.test.ts`
- `src/components/queue/queue-list.render.test.tsx`, `src/components/queue/queue-summary.render.test.tsx`
- `src/server/domain/task-assignee.ts`, `src/server/domain/task-assignee.test.ts`
- `src/server/domain/alert-actions.ts`, `src/server/domain/alert-actions.test.ts`
- `scripts/tarefas-sem-responsavel.ts`
- `src/app/(app)/ajuda/avisos/page.tsx`

**Modificados**
- `src/lib/`: `queue.ts`, `queue.test.ts`, `board-order.test.ts`, `why-late.ts`, `why-late.test.ts`, `primary-action.ts`, `primary-action.test.ts`, `history.ts`, `history.test.ts`
- `src/server/domain/`:
  - `signals.ts`, `signals.test.ts`
  - `tasks.ts`, `tasks.test.ts`
  - `offers.ts`, `offers.test.ts`
  - `assign.ts`, `transfer.test.ts`
  - `outbox.ts`, `outbox.test.ts`
  - `authorship.ts` (texto do aviso da A3)
- `src/server/rules/`: `engine.ts`, `engine.test.ts`
- `src/server/db/seed-data.ts`
- `src/server/queries/`:
  - `queue.ts`, `queue.test.ts`, `queue-signals.test.ts`
  - `deal.ts`
  - `alerts.ts`
  - `today.ts`, `today.test.ts`
- `src/server/auth/guard-coverage.test.ts`
- `src/app/(app)/funil/actions.ts`
- `src/app/(app)/page.tsx`
- `src/components/pipeline/`: `timer.tsx`, `deal-card.tsx`
- `src/components/motion/elapsed.tsx`
- `src/components/journey/station.tsx`
- `src/components/today/`: `waiting-list.tsx`, `next-actions.tsx`
- `src/components/lead/lead-sheet.tsx`
- `src/components/queue/`: `queue-list.tsx`, `queue-item.tsx`, `queue-item.render.test.tsx`, `queue-summary.tsx`, `attendance-strip.tsx`, `pane-header.tsx`, `client-pane.tsx`, `why-late.tsx`
- `src/components/shell/`: `alerts-bell.tsx`, `sidebar.tsx`
- `e2e/`: `fila.spec.ts`, `cliente.spec.ts`, `mobile.spec.ts`, `acoes-fila.spec.ts`, `relatorios.spec.ts`, `a11y.spec.ts`

**Dados de produção:** só o script de B9, com ensaio, backup JSON em `/home/crm/backups` e conferência. Roda depois do acerto do Lote 1A e com o ok do dono (seção Implantação). Não há migration de schema neste lote.

---

## Lote 1C: Funil novo e saída do Atendimento lotado

> **Notas do lote (antes da C1).** Valem para todas as tarefas.
> - **Os Lotes 1A e 1B já estão feitos quando este lote começa.** `recordOutbound` já é a versão da A3 (autora e dona pela assinatura), `createTaskTx` já preenche o responsável vazio (B9), os textos dos avisos e das seções da Fila já vêm de `src/lib/alert-copy.ts` (B2) e o card do Quadro já mostra "Cati:" e "respondida por" (A6). As tarefas abaixo partem desse código.
> - **As chaves das etapas não mudam.** Continuam `lead`, `atendimento`, `followup_1`, `agendado`, `fechado` e `perdido`, e entram três novas: `orcamento`, `atendida` e `retorno`. Mudam os **nomes**: Novo contato, Em conversa, Aguardando cliente. O código passa a decidir pelo **tipo** da etapa, com `stageByKind` e `moveToKindTx`. A chave fica só no seed, na migração e nas automações que a gestão configura.
> - **Tentativas.** A tentativa N "conta" quando a Casa manda mensagem no dia dela (ou depois) **ou** quando alguém conclui o combinado dela. A equipe responde pelo celular, então a mensagem é o sinal principal. Se ninguém tentou, a conversa **não** vira Perdido sozinha: o combinado fica vencido em "Combinados".
> - **Datas das tentativas.** Aguardando cliente: D+1, D+3 e D+7 às 10h. Orçamento enviado: começa em 2 dias e mantém o espaçamento (D+2, D+4, D+8). Se o dia cair com a Casa fechada (domingo, segunda), passa para o próximo dia aberto.
> - **Depois da 3ª tentativa** a cliente tem 2 dias de expediente para responder. Se não responder, vira Perdido "Não respondeu mais" com recontato em 30 dias, **só na 1ª vez**, para não criar um ciclo mensal sem fim.
> - **Nada envia WhatsApp.** As tentativas são tarefas (a "próxima ação"), e o aviso delas é o `tarefa_vencendo` que já existe (com o texto "Combinado vencendo: …" da B8, nunca com a Casa fechada). Em teste, a Evolution aponta para um endereço morto (`test/setup-env.ts`).
> - **Responsável das tentativas.** `activeOwnerTx` dá a dona se ela ainda está ativa; quando não há, `createTaskTx` (B9) ainda tenta quem respondeu por último; sem ninguém, a tentativa fica sem responsável e aparece na aba "Sem responsável" do Hoje (B11).
> - **Decisão 4 do dono.** A importação do Avec, a marcação na Agenda e a migração só mexem em contatos com mensagem nos últimos 30 dias. Quem não tem conversa aparece só na Agenda e na ficha.
> - **Fora deste lote (de propósito):**
>   - **Visibilidade por perfil.** Atendente = Recepção, então não há divisão por etapa.
>   - **Retorno sugerido automático.** Fica para o Lote 2. Aqui entram a etapa e a entrada manual (Quadro e menu Etapa).
>   - **Regra "Fechado/Perdido e a cliente escreve → Em conversa".** Fica para o Lote 3. Hoje a conversa nova nasceria em Em conversa e o relatório "respondidos" contaria como respondida sem resposta (`reports/queries.ts:95`).
> - **Lote 0 continua valendo.** `followup_diario` e `parado_1dia` seguem desligadas. No lugar delas entram `casa_falou_4h` e `parado_etapa`, com chaves novas.
> - **Risco encontrado e corrigido na C1.** Em produção, `gestao_10min` está com 30 min, mas `version=1` e `updated_by` vazio. O seed (`seed.ts:24-27`) sobrescreve o `trigger` das automações não editadas e voltaria para 10 min no próximo deploy.
> - **Riscos com teste próprio:**
>   - dona inativa não derruba a mudança de etapa (C2) nem a varredura (C4);
>   - dia fechado nas tentativas (C2);
>   - ciclo eterno de recontato (C4);
>   - falta antiga do Avec não derruba um Agendado feito no CRM (C8);
>   - o seed não desfaz o Lote 0 (C1).

---

### Tarefa C1: Tipos novos de etapa, contador de tentativas e etapas do funil no seed

**Arquivos:**
- Modificar: `src/server/db/schema.ts:7` (enum) e `:131-170` (deals)
- Criar: `drizzle/0024_funil_novo.sql` (gerado; a A2 criou a 0023) e `drizzle/meta/0024_snapshot.json`
- Modificar: `src/server/db/seed-data.ts:3-13` (etapas) e `:30-98` (automações)
- Modificar: `src/server/domain/deals.ts:21-29` (`stageByKind`)
- Modificar: `src/components/config/stages.tsx:11`
- Testes: `src/server/db/schema.test.ts`, `src/server/db/seed.test.ts`, `src/server/domain/stage-kind.test.ts` (novo), `src/server/queries/journey.test.ts`, `src/server/rules/engine.test.ts`

**Interfaces:**
- Consome: nada de outras tarefas deste lote.
- Produz:
  - `type StageKind = Stage["kind"]`, com os tipos `"lead" | "atendimento" | "agendado" | "followup" | "fechado" | "perdido" | "proposta" | "atendido" | "retorno"`;
  - `stageByKind(kind: StageKind, tx?: Tx | typeof db): Promise<Stage>`, que devolve a 1ª etapa **ativa** do tipo pela ordem e lança se não houver;
  - colunas em `deals`: `followupAttempt: number` (padrão 0), `followupDueAt: Date | null` e `followupTaskId: string | null` (FK para `tasks`, `on delete set null`);
  - etapas novas no seed: `orcamento` (proposta), `atendida` (atendido) e `retorno` (retorno).

- [ ] **Passo 1: Escrever os testes que falham**

Acrescentar em `src/server/db/schema.test.ts`, dentro do `describe`:

```ts
  it("funil novo (Lote 1C): tipos de etapa e contador de tentativas", async () => {
    expect(await cols("deals")).toEqual(expect.arrayContaining(["followup_attempt", "followup_due_at", "followup_task_id"]));
    const kinds = ((await db.execute(sql`select unnest(enum_range(null::stage_kind))::text as k`)).rows as { k: string }[]).map((r) => r.k);
    expect(kinds).toEqual(expect.arrayContaining(["proposta", "atendido", "retorno"]));
  });
```

Em `src/server/db/seed.test.ts`: trocar `toBe(9)` (linha 13) por `toBe(12)` e acrescentar:

```ts
  it("funil novo: 9 etapas ativas na ordem da jornada; Follow-up 2 a 4 desativadas", async () => {
    const rows = await db.select().from(stages).orderBy(stages.position);
    expect(rows.filter((s) => s.active).map((s) => s.name)).toEqual([
      "Novo contato", "Em conversa", "Aguardando cliente", "Orçamento enviado", "Agendado", "Atendida", "Retorno sugerido", "Fechado", "Perdido",
    ]);
    expect(rows.filter((s) => !s.active).map((s) => s.key)).toEqual(["followup_2", "followup_3", "followup_4"]);
  });
  it("o seed não desfaz o Lote 0 (15/10): escalada em 30 min; follow-up diário e parado de 1 dia nascem desligados", async () => {
    await seed(db);
    const byKey = new Map((await db.select().from(automations)).map((a) => [a.key, a]));
    expect(byKey.get("gestao_10min")!.trigger).toMatchObject({ type: "sem_resposta_minutos", minutes: 30 });
    expect(byKey.get("followup_diario")!.enabled).toBe(false);
    expect(byKey.get("parado_1dia")!.enabled).toBe(false);
    // conversa esperando resposta em Orçamento, Atendida e Retorno também avisa e escala
    for (const k of ["atendimento_3min", "gestao_10min"]) expect((byKey.get(k)!.conditions as { stages: string[] }[])[0].stages).toEqual(expect.arrayContaining(["orcamento", "atendida", "retorno"]));
  });
```

Criar `src/server/domain/stage-kind.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { stageByKind } from "./deals";

beforeEach(resetDb);

it("stageByKind: a primeira etapa ATIVA do tipo, pela ordem (Follow-up 2 a 4 desativadas não contam)", async () => {
  expect((await stageByKind("followup")).key).toBe("followup_1");
  expect((await stageByKind("proposta")).name).toBe("Orçamento enviado");
  expect((await stageByKind("atendido")).key).toBe("atendida");
  await db.update(stages).set({ active: false }).where(eq(stages.key, "retorno"));
  await expect(stageByKind("retorno")).rejects.toThrow(/retorno/);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/server/db/schema.test.ts src/server/db/seed.test.ts src/server/domain/stage-kind.test.ts`
Esperado: FAIL ("expected [...] to contain followup_attempt", "expected 9 to be 12", "stageByKind is not a function").

- [ ] **Passo 3: Schema**

Em `src/server/db/schema.ts`, linha 7 (os valores novos vão **no fim**, para a migration ser `ADD VALUE` simples):

```ts
export const stageKindEnum = pgEnum("stage_kind", ["lead", "atendimento", "agendado", "followup", "fechado", "perdido", "proposta", "atendido", "retorno"]);
```

Em `deals`, logo depois de `attendanceAt`:

```ts
  /** Aguardando cliente / Orçamento enviado: em que tentativa está (0 = fora dessas etapas; 1–3; 4 = as 3 feitas, esperando a última resposta). */
  followupAttempt: smallint("followup_attempt").notNull().default(0),
  /** Quando vence a tentativa atual (com as 3 feitas: quando vira Perdido "Não respondeu mais"). */
  followupDueAt: timestamp("followup_due_at", { withTimezone: true }),
  /** A próxima ação que representa a tentativa atual (a equipe pode trocar; a varredura adota a nova). */
  followupTaskId: uuid("followup_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),
```

- [ ] **Passo 4: Gerar a migration e torná-la idempotente**

Rodar: `npm run db:generate -- --name funil_novo`
Esperado: cria `drizzle/0024_funil_novo.sql` (se outro trabalho já ocupou o número, vale o que o drizzle-kit gerar).

Editar o SQL gerado para que os `ADD VALUE` fiquem com `IF NOT EXISTS`. O resultado esperado:

```sql
ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'proposta';--> statement-breakpoint
ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'atendido';--> statement-breakpoint
ALTER TYPE "public"."stage_kind" ADD VALUE IF NOT EXISTS 'retorno';--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_attempt" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "followup_task_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_followup_task_id_tasks_id_fk" FOREIGN KEY ("followup_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
```

A migration é só aditiva. Se aparecer qualquer `DROP` ou `ALTER COLUMN ... TYPE`, parar e conferir `git diff drizzle/meta`. Os valores novos do enum **não** são usados na própria migration, porque o Postgres 17 não deixa usar um valor de enum na mesma transação em que ele foi criado. Quem insere as etapas novas é o seed, que roda depois, em outro processo.

- [ ] **Passo 5: Seed das etapas e das automações**

Em `src/server/db/seed-data.ts`, trocar `DEFAULT_STAGES` (linhas 3-13):

```ts
/**
 * Funil da Casa (decisão do dono, 15/10): Novo contato → Em conversa → Aguardando cliente → Orçamento enviado → Agendado → Atendida →
 * Retorno sugerido → Fechado/Perdido. As chaves antigas ficam (o histórico e as automações usam); o código decide pelo `kind`.
 * Follow-up 2 a 4 deixaram de existir: ficam desativadas, só para o histórico antigo continuar com nome.
 * O seed só INSERE etapas que faltam (onConflictDoNothing): em produção, nome, ordem e prazos são acertados pelo script da C11.
 */
export const DEFAULT_STAGES = [
  { key: "lead", name: "Novo contato", kind: "lead", position: 0, slaMinutes: 2, staleDays: 1, color: "#b8863f", active: true },
  { key: "atendimento", name: "Em conversa", kind: "atendimento", position: 1, slaMinutes: 3, staleDays: 2, color: "#121212", active: true },
  { key: "followup_1", name: "Aguardando cliente", kind: "followup", position: 2, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: true },
  { key: "orcamento", name: "Orçamento enviado", kind: "proposta", position: 3, slaMinutes: 15, staleDays: null, color: "#8a6a2f", active: true },
  { key: "agendado", name: "Agendado", kind: "agendado", position: 4, slaMinutes: 3, staleDays: null, color: "#2f6b4f", active: true },
  { key: "atendida", name: "Atendida", kind: "atendido", position: 5, slaMinutes: 15, staleDays: null, color: "#3d7a5c", active: true },
  { key: "retorno", name: "Retorno sugerido", kind: "retorno", position: 6, slaMinutes: 15, staleDays: null, color: "#6b5b8a", active: true },
  { key: "fechado", name: "Fechado", kind: "fechado", position: 7, slaMinutes: null, staleDays: null, color: "#2f6b4f", active: true },
  { key: "perdido", name: "Perdido", kind: "perdido", position: 8, slaMinutes: null, staleDays: null, color: "#9a958c", active: true },
  { key: "followup_2", name: "Follow-up 2", kind: "followup", position: 20, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
  { key: "followup_3", name: "Follow-up 3", kind: "followup", position: 21, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
  { key: "followup_4", name: "Follow-up 4", kind: "followup", position: 22, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
] as const;
```

Em `DEFAULT_AUTOMATIONS` (os textos de mensagem que a B8 já trocou ficam como estão):
- `gestao_10min`:
  - `name: "Escalar para a gestão: sem resposta há 30 minutos"`;
  - `trigger: { type: "sem_resposta_minutos", minutes: 30 }`;
  - condições `["lead", "atendimento", "followup_1", "followup_2", "followup_3", "followup_4", "orcamento", "atendida", "retorno"]`.
- `atendimento_3min`: condições `["atendimento", "agendado", "followup_1", "followup_2", "followup_3", "followup_4", "orcamento", "atendida", "retorno"]`.
- `followup_diario`: `enabled: false`.
- `parado_1dia`: `enabled: false`.
- `recontato`: mensagem `"Dia de recontato com {nome}. A conversa voltou para {etapa}"`.

Acima de `DEFAULT_AUTOMATIONS`, acrescentar o comentário:

```ts
// Lote 0 (15/10): escalada para a gestão em 30 min; followup_diario e parado_1dia desligadas (o Lote 1C as substitui por casa_falou_4h e parado_etapa).
// O seed sobrescreve trigger/condições/ações das automações que a gestão nunca editou (seed.ts): os padrões daqui TÊM de ser os de produção.
```

`src/server/db/seed.ts` não muda: `DEFAULT_STAGES.map((s) => ({ ...s }))` já leva `active`.

- [ ] **Passo 6: `stageByKind`**

Em `src/server/domain/deals.ts`, depois de `stageByKey`:

```ts
export type StageKind = Stage["kind"];

/** A etapa ativa de um TIPO (a primeira pela ordem). O código decide pelo tipo; a chave é só o nome técnico (decisão do Lote 1C). */
export async function stageByKind(kind: StageKind, tx: Tx | typeof db = db): Promise<Stage> {
  const [s] = await tx.select().from(stages).where(and(eq(stages.kind, kind), eq(stages.active, true))).orderBy(asc(stages.position)).limit(1);
  if (!s) throw new Error(`Nenhuma etapa ativa do tipo "${kind}"`);
  return s;
}
```

- [ ] **Passo 7: Rótulos dos tipos na tela de Etapas**

`src/components/config/stages.tsx:11`:

```ts
const KIND: Record<string, string> = { lead: "Entrada", atendimento: "Conversa", followup: "Aguardando cliente", proposta: "Orçamento", agendado: "Agendado", atendido: "Atendida", retorno: "Retorno", fechado: "Ganho", perdido: "Perda" };
```

- [ ] **Passo 8: Ajustar os testes que descreviam o funil antigo**

Em `src/server/queries/journey.test.ts`:
- `mk("followup_3")` passa a ser `mk("followup_1")`;
- `mk("followup_2")` passa a ser `mk("followup_1")`, porque etapa desativada não aparece no Quadro;
- teste "as estações seguem a ordem das etapas…":

```ts
  it("as estações seguem a ordem das etapas e a de Aguardando cliente é uma só", async () => {
    const j = await getJourney();
    expect(j.stations.map((s) => s.key)).toEqual(["lead", "atendimento", "followup", "orcamento", "agendado", "atendida", "retorno", "fechado", "perdido"]);
    expect(j.stations.map((s) => s.kind)).toEqual(["lead", "atendimento", "followup", "proposta", "agendado", "atendido", "retorno", "fechado", "perdido"]);
  });
```

O nome da estação (`"Follow-up"`) só é corrigido na C9. Por enquanto, saia a linha `expect(...name).toBe("Follow-up")`.

Em `src/server/rules/engine.test.ts`:
- teste "lead sem resposta…": trocar `await runRules(min(10));` por `await runRules(min(30));` e o título para "…escala para a gestão aos 30 min";
- teste "texto da espera: desde quando, prazo e dona…" (da B8): trocar o segundo `await runRules(min(10));` por `await runRules(min(30));` (o texto esperado do escalado não muda: "Escalado: Mariana sem resposta desde 10:00. Dona: Ana.");
- teste "cliente sumiu…": colocar como 1ª linha `await db.update(automations).set({ enabled: true }).where(eq(automations.key, "followup_diario"));` (a C6 reescreve este teste);
- teste "parado há mais de 1 dia gera aviso": trocar a linha que desliga `followup_diario` por `await db.update(automations).set({ enabled: true }).where(eq(automations.key, "parado_1dia"));` (a C6 reescreve este teste).

- [ ] **Passo 9: Rodar e ver passar**

Rodar: `npx vitest run src/server/db src/server/domain/stage-kind.test.ts src/server/queries/journey.test.ts src/server/rules/engine.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck`
Esperado: tudo verde. Se algum teste depender do nome "Lead"/"Atendimento" ou de `staleDays: 1` em Em conversa, troque a expectativa pelo nome novo; a regra mudou por decisão do dono.

- [ ] **Passo 10: Commit**

```bash
git add src/server/db/schema.ts drizzle/ src/server/db/seed-data.ts src/server/domain/deals.ts src/components/config/stages.tsx \
  src/server/db/schema.test.ts src/server/db/seed.test.ts src/server/domain/stage-kind.test.ts src/server/queries/journey.test.ts src/server/rules/engine.test.ts
git commit -m "feat(funil): tipos proposta/atendido/retorno, contador de tentativas e etapas do funil novo no seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C2: Tentativas ao entrar e sair de Aguardando/Orçamento (no `moveDealTx`) e `moveToKindTx`

**Arquivos:**
- Criar: `src/lib/attempts.ts`, `src/lib/attempts.test.ts`
- Criar: `src/server/domain/attempts.ts`, `src/server/domain/attempts.test.ts`
- Modificar: `src/server/domain/deals.ts` (`moveDealTx` e `moveToKindTx`; ache com `grep -n "export async function moveDealTx" src/server/domain/deals.ts`)
- Modificar: `src/server/domain/deals.test.ts:71` (`followup_2` → `followup_1`)

**Interfaces:**
- Consome (C1): `stageByKind`, `StageKind` e as colunas `followupAttempt`, `followupDueAt`, `followupTaskId`.
- Produz (`src/lib/attempts.ts`, puro):
  - `WAITING_KINDS = ["followup", "proposta"]`, `type WaitingKind`, `isWaitingKind(k): k is WaitingKind`;
  - `MAX_ATTEMPTS = 3`;
  - `ATTEMPT_DAYS: Record<WaitingKind, readonly [number, number, number]>`;
  - `LAST_REPLY_DAYS = 2`, `RECONTACT_DAYS = 30`, `ATTEMPT_HOUR = 10`;
  - `attemptDueAt(fromMs: number, days: number, hours: BusinessHours): Date`;
  - `attemptTitle(n: number, name: string | null | undefined): string`;
  - `attemptLabel(attempt: number): string | null`;
  - `clientFirstName(name): string` (o primeiro nome da cliente, com "a cliente" de reserva; não confundir com o `firstName` de `src/lib/authorship.ts`, que devolve `string | null`).
- Produz (`src/server/domain/attempts.ts`):
  - `ATTEMPT_META = { origem: "tentativa" }`;
  - `type AttemptStart = { resumeAt?: Date | null; taskTitle?: string; assigneeId?: string | null; taskMeta?: Record<string, unknown> }`;
  - `activeOwnerTx(tx, ownerId): Promise<string | null>`;
  - `startAttemptsTx(tx, deal: Deal, kind: WaitingKind, userId, at, opts?): Promise<Deal>`;
  - `cancelAttemptTaskTx(tx, deal: Deal, userId, at): Promise<void>`;
  - `rescheduleAttemptTx(tx, dealId, input: { resumeAt: Date; title?: string; assigneeId?: string | null }, userId, now): Promise<{ dueAt: Date }>`;
  - `adoptWaitingTx(tx, deal: Deal, kind: WaitingKind, at): Promise<Deal>`.
- Produz (`deals.ts`):
  - `moveDealTx(tx, dealId, stageKey, userId, reason, at?, opts?: AttemptStart)`. Entrar num tipo de espera cria a tentativa 1; sair zera o contador e cancela a tentativa aberta (só a criada pelas tentativas); etapa inativa → `UserFacingError("Essa etapa foi desativada. Escolha outra.")`;
  - `moveToKindTx(tx, dealId, kind: StageKind, userId, reason, at?, opts?): Promise<Deal>`, que não faz nada se a conversa já está numa etapa do tipo.

- [ ] **Passo 1: Testes do módulo puro**

`src/lib/attempts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BusinessHours } from "./business-hours";
import { attemptDueAt, attemptLabel, attemptTitle, isWaitingKind } from "./attempts";

/** Horário da Casa (Lote 0): terça a sábado, 9h às 18h. */
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };

describe("attemptDueAt", () => {
  it("D+1 às 10h de Salvador", () => {
    expect(attemptDueAt(Date.parse("2026-10-13T13:00:00Z"), 1, CASA).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });
  it("noite de terça: D+1 é quarta (conta o dia de Salvador, não o de UTC)", () => {
    expect(attemptDueAt(Date.parse("2026-10-14T01:30:00Z"), 1, CASA).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });
  it("dia fechado passa para o próximo aberto: sábado + 1 → terça (domingo e segunda fechados)", () => {
    expect(attemptDueAt(Date.parse("2026-10-17T15:00:00Z"), 1, CASA).toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
  it("Casa que abre depois das 10h: vale a abertura", () => {
    expect(attemptDueAt(Date.parse("2026-10-13T13:00:00Z"), 1, { ...CASA, "3": ["11:30", "18:00"] }).toISOString()).toBe("2026-10-14T14:30:00.000Z");
  });
});

it("título, selo e tipos de espera", () => {
  expect(attemptTitle(1, "Rita Souza")).toBe("Tentativa 1 de 3: retomar contato com Rita");
  expect(attemptTitle(2, null)).toBe("Tentativa 2 de 3: retomar contato com a cliente");
  expect(attemptLabel(0)).toBeNull();
  expect(attemptLabel(2)).toBe("Tentativa 2/3");
  expect(attemptLabel(4)).toBe("3/3 · esperando a última resposta");
  expect(isWaitingKind("proposta")).toBe(true);
  expect(isWaitingKind("atendimento")).toBe(false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

Rodar: `npx vitest run src/lib/attempts.test.ts`
Esperado: FAIL ("Failed to resolve import ./attempts").

- [ ] **Passo 3: `src/lib/attempts.ts`**

```ts
import type { BusinessHours } from "./business-hours";
import { bahiaAt } from "./next-action";

/**
 * Tentativas de retomar a cliente (Lote 1C, decisão do dono de 15/10). Puro: servidor e navegador.
 * Nunca há envio automático: cada tentativa é uma próxima ação (combinado) que vira aviso no dia.
 */
export const WAITING_KINDS = ["followup", "proposta"] as const;
export type WaitingKind = (typeof WAITING_KINDS)[number];
export const isWaitingKind = (k: string | null | undefined): k is WaitingKind => (WAITING_KINDS as readonly string[]).includes(k ?? "");

export const MAX_ATTEMPTS = 3;
/** Dias depois de entrar na etapa. Aguardando cliente: D+1, D+3, D+7. Orçamento enviado: começa em 2 dias e mantém o espaçamento. */
export const ATTEMPT_DAYS: Record<WaitingKind, readonly [number, number, number]> = { followup: [1, 3, 7], proposta: [2, 4, 8] };
/** Depois da 3ª tentativa: dias de expediente para a cliente responder antes de virar Perdido "Não respondeu mais". */
export const LAST_REPLY_DAYS = 2;
/** Perdido "Não respondeu mais" volta a ser lembrado nesse prazo (só na 1ª vez). */
export const RECONTACT_DAYS = 30;
export const ATTEMPT_HOUR = 10;

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3

/**
 * Quando cai a tentativa: `days` dias depois do dia de `fromMs`, às 10h de Salvador. Dia com a Casa fechada passa para o próximo
 * dia aberto; se a Casa abre depois das 10h, vale a abertura. Sem nenhum dia aberto na semana, fica no dia calculado.
 */
export function attemptDueAt(fromMs: number, days: number, hours: BusinessHours): Date {
  for (let extra = 0; extra < 7; extra++) {
    const midnight = bahiaAt(fromMs, days + extra, 0);
    const span = hours[String(new Date(midnight.getTime() - OFFSET_MS).getUTCDay()) as keyof BusinessHours];
    if (!span) continue;
    const [oh, om] = span[0].split(":").map(Number);
    const at = Math.max(ATTEMPT_HOUR * 60, oh * 60 + om);
    return bahiaAt(fromMs, days + extra, Math.floor(at / 60), at % 60);
  }
  return bahiaAt(fromMs, days, ATTEMPT_HOUR);
}

/** Primeiro nome da cliente para títulos de tarefa; sem nome, "a cliente". */
export const clientFirstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "a cliente";

export const attemptTitle = (n: number, name: string | null | undefined) =>
  `Tentativa ${n} de ${MAX_ATTEMPTS}: retomar contato com ${clientFirstName(name)}`;

/** Selo do card: "Tentativa 1/3"; depois das 3, "3/3 · esperando a última resposta". 0 = sem selo. */
export function attemptLabel(attempt: number): string | null {
  if (attempt <= 0) return null;
  if (attempt > MAX_ATTEMPTS) return `${MAX_ATTEMPTS}/${MAX_ATTEMPTS} · esperando a última resposta`;
  return `Tentativa ${attempt}/${MAX_ATTEMPTS}`;
}
```

Rodar: `npx vitest run src/lib/attempts.test.ts`
Esperado: PASS.

- [ ] **Passo 4: Testes da entrada e saída de Aguardando**

`src/server/domain/attempts.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { deals, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, moveToKindTx, recordInbound, recordOutbound } from "./deals";
import { REMARCAR_META, setNextActionTx } from "./tasks";
import { UserFacingError } from "./errors";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador (sem horário salvo: vale o padrão seg–sex 8–20, sáb 8–17)
let ana = "";
const move = (id: string, key: string, at = T0, opts = {}) => db.transaction((tx) => moveDealTx(tx, id, key, null, "teste", at, opts));
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function emConversa(phone = "71988880001") {
  const r = await recordInbound({ channelId: null, externalId: `in-${phone}`, phoneRaw: phone, pushName: "Rita Souza", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi Rita!", at: T0 });
  return r.dealId;
}

it("entrar em Aguardando cliente: tentativa 1 de 3 em D+1 às 10h, como próxima ação da dona (nada é enviado)", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  const d = await dealOf(id);
  expect(d.followupAttempt).toBe(1);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
  const [t] = await openTasks(id);
  expect(t).toMatchObject({ id: d.followupTaskId, title: "Tentativa 1 de 3: retomar contato com Rita", assigneeId: ana });
});

it("Orçamento enviado começa em 2 dias", async () => {
  const id = await emConversa();
  await move(id, "orcamento");
  expect((await dealOf(id)).followupDueAt?.toISOString()).toBe("2026-10-15T13:00:00.000Z");
});

it("próxima ação futura que a equipe já combinou vira a tentativa 1 (não é trocada)", async () => {
  const id = await emConversa();
  const planned = await db.transaction((tx) => setNextActionTx(tx, id, { title: "Mandar valores", dueAt: new Date("2026-10-16T13:00:00Z") }, ana, T0));
  await move(id, "followup_1");
  const d = await dealOf(id);
  expect(d).toMatchObject({ followupAttempt: 1, followupTaskId: planned.id });
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Mandar valores"]);
});

it("sair de Aguardando zera o contador e cancela só a tentativa; o Remarcar fica", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  const tentativa = (await dealOf(id)).followupTaskId!;
  await move(id, "atendimento", new Date(T0.getTime() + 3_600_000));
  expect(await dealOf(id)).toMatchObject({ followupAttempt: 0, followupDueAt: null, followupTaskId: null });
  expect((await db.select().from(tasks).where(eq(tasks.id, tentativa)))[0].doneAt).not.toBeNull();

  await move(id, "followup_1", new Date(T0.getTime() + 2 * 3_600_000), { resumeAt: new Date("2026-10-14T13:00:00Z"), taskTitle: "Remarcar com Rita", taskMeta: { ...REMARCAR_META } });
  await move(id, "atendimento", new Date(T0.getTime() + 3 * 3_600_000));
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Remarcar com Rita"]);
});

it("etapa desativada (Follow-up 2) recusa com texto claro", async () => {
  const id = await emConversa();
  await expect(move(id, "followup_2")).rejects.toBeInstanceOf(UserFacingError);
  await expect(move(id, "followup_2")).rejects.toThrow("desativada");
});

it("moveToKindTx: já numa etapa do tipo, não faz nada (nem nova tentativa)", async () => {
  const id = await emConversa();
  await move(id, "followup_1");
  await db.transaction((tx) => moveToKindTx(tx, id, "followup", null, "teste", new Date(T0.getTime() + 60_000)));
  expect((await openTasks(id))).toHaveLength(1);
  expect((await dealOf(id)).followupAttempt).toBe(1);
});

it("dona que saiu da equipe não derruba a mudança de etapa: a tentativa fica sem responsável", async () => {
  const id = await emConversa();
  await db.update(users).set({ active: false }).where(eq(users.id, ana));
  await move(id, "followup_1");
  expect((await openTasks(id))[0].assigneeId).toBeNull();
});

it("data de retomar no passado: erro claro, nada muda", async () => {
  const id = await emConversa();
  await expect(move(id, "followup_1", T0, { resumeAt: new Date("2026-10-01T13:00:00Z") })).rejects.toThrow(/já passou/);
  expect((await dealOf(id)).followupAttempt).toBe(0);
});
```

Rodar: `npx vitest run src/server/domain/attempts.test.ts`
Esperado: FAIL (as colunas de tentativa ficam 0; nenhuma tarefa é criada).

- [ ] **Passo 5: `src/server/domain/attempts.ts`**

```ts
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { contacts, deals, tasks, users, type Deal } from "../db/schema";
import { getBusinessHours } from "./hours";
import { completeTaskTx, setNextActionTx } from "./tasks";
import { ATTEMPT_DAYS, MAX_ATTEMPTS, attemptDueAt, attemptTitle, type WaitingKind } from "../../lib/attempts";

/** Marca (no evento de criação da tarefa) das tentativas: só essas são canceladas quando a conversa sai de Aguardando/Orçamento. */
export const ATTEMPT_META = { origem: "tentativa" } as const;

export type AttemptStart = {
  /** "Retomar em": quando é a 1ª tentativa. Sem isso: D+1 (Orçamento: D+2), 10h, no próximo dia de expediente. */
  resumeAt?: Date | null;
  /** Título da 1ª tentativa (padrão "Tentativa 1 de 3: retomar contato com <nome>"). */
  taskTitle?: string;
  /** Quem retoma (padrão: a dona, se ainda está ativa na equipe). */
  assigneeId?: string | null;
  /** Marca no evento da tarefa (padrão { origem: "tentativa", tentativa: 1 }). */
  taskMeta?: Record<string, unknown>;
};

/** A dona, se ainda está ativa; senão ninguém (tarefa nunca derruba a mudança de etapa por causa de quem saiu da equipe). */
export async function activeOwnerTx(tx: Tx, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.active, true)));
  return u?.id ?? null;
}

/**
 * Entrou em Aguardando cliente / Orçamento enviado: tentativa 1. A próxima ação futura que a equipe já combinou vira a tentativa;
 * senão nasce "Tentativa 1 de 3" (ou o título pedido) na data pedida ou em D+1/D+2. Lead arquivado ganha o contador, sem tarefa.
 */
export async function startAttemptsTx(tx: Tx, deal: Deal, kind: WaitingKind, userId: string | null, at: Date, opts: AttemptStart = {}): Promise<Deal> {
  const [open] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, deal.id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  let taskId: string | null = null;
  let dueAt: Date;
  if (!opts.resumeAt && open && open.dueAt.getTime() >= at.getTime()) {
    taskId = open.id; dueAt = open.dueAt;
  } else {
    dueAt = opts.resumeAt ?? attemptDueAt(at.getTime(), ATTEMPT_DAYS[kind][0], await getBusinessHours(tx));
    if (!deal.archivedAt) {
      const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
      const t = await setNextActionTx(tx, deal.id, {
        title: opts.taskTitle ?? attemptTitle(1, c?.name), dueAt,
        assigneeId: opts.assigneeId !== undefined ? opts.assigneeId : await activeOwnerTx(tx, deal.ownerId),
        meta: opts.taskMeta ?? { ...ATTEMPT_META, tentativa: 1 },
      }, userId, at);
      taskId = t.id; dueAt = t.dueAt;
    }
  }
  const [u] = await tx.update(deals).set({ followupAttempt: 1, followupDueAt: dueAt, followupTaskId: taskId }).where(eq(deals.id, deal.id)).returning();
  return u;
}

const isAttemptTaskTx = async (tx: Tx, dealId: string, taskId: string) =>
  (await tx.execute(sql`select 1 from deal_events e where e.deal_id = ${dealId} and e.type = 'tarefa' and e.payload->>'acao' = 'criada'
    and e.payload->>'tarefa' = ${taskId} and e.payload->>'origem' = ${ATTEMPT_META.origem} limit 1`)).rows.length > 0;

/** Saiu de Aguardando/Orçamento: cancela a tentativa em aberto (só a criada pelas tentativas; "Remarcar" e o que a equipe escreveu ficam). */
export async function cancelAttemptTaskTx(tx: Tx, deal: Deal, userId: string | null, at: Date) {
  if (deal.followupTaskId && await isAttemptTaskTx(tx, deal.id, deal.followupTaskId)) await completeTaskTx(tx, deal.followupTaskId, userId, "cancelada", at);
}

/** Já aguardando: só troca a data (e o título) da tentativa atual. Com as 3 feitas, volta a ser a 3ª. */
export async function rescheduleAttemptTx(tx: Tx, dealId: string, input: { resumeAt: Date; title?: string; assigneeId?: string | null }, userId: string | null, now: Date): Promise<{ dueAt: Date }> {
  const [d] = await tx.select({ attempt: deals.followupAttempt, ownerId: deals.ownerId, name: contacts.name }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  const n = Math.min(Math.max(d?.attempt ?? 1, 1), MAX_ATTEMPTS);
  const t = await setNextActionTx(tx, dealId, {
    title: input.title ?? attemptTitle(n, d?.name), dueAt: input.resumeAt,
    assigneeId: input.assigneeId !== undefined ? input.assigneeId : await activeOwnerTx(tx, d?.ownerId ?? null),
    meta: { ...ATTEMPT_META, tentativa: n },
  }, userId, now);
  await tx.update(deals).set({ followupAttempt: n, followupDueAt: t.dueAt, followupTaskId: t.id }).where(eq(deals.id, dealId));
  return { dueAt: t.dueAt };
}

/** Conversa que JÁ estava em Aguardando antes do Lote 1C (sem contador): vira tentativa 1 mantendo a próxima ação aberta, mesmo vencida. */
export async function adoptWaitingTx(tx: Tx, deal: Deal, kind: WaitingKind, at: Date): Promise<Deal> {
  if (deal.followupAttempt > 0) return deal;
  const [open] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, deal.id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  if (!open) return startAttemptsTx(tx, deal, kind, null, at);
  const [u] = await tx.update(deals).set({ followupAttempt: 1, followupDueAt: open.dueAt, followupTaskId: open.id }).where(eq(deals.id, deal.id)).returning();
  return u;
}
```

- [ ] **Passo 6: `moveDealTx` e `moveToKindTx` em `deals.ts`**

Imports novos no topo de `src/server/domain/deals.ts`:

```ts
import { UserFacingError } from "./errors";
import { cancelAttemptTaskTx, startAttemptsTx, type AttemptStart } from "./attempts";
import { isWaitingKind } from "../../lib/attempts";
```

Substituir `moveDealTx`:

```ts
/**
 * Move para a etapa da chave. Entrar em Aguardando cliente / Orçamento enviado começa as tentativas (`opts`: data e título da 1ª);
 * sair delas zera o contador e cancela a tentativa em aberto. Etapa desativada (Follow-up 2 a 4) recusa.
 */
export async function moveDealTx(tx: Tx, dealId: string, stageKey: string, userId: string | null, reason: string, at = new Date(), opts: AttemptStart = {}) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new Error("Lead não encontrado");
  const to = await stageByKey(stageKey, tx);
  if (deal.stageId === to.id) return deal;
  if (!to.active) throw new UserFacingError("Essa etapa foi desativada. Escolha outra.");
  const [from] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
  const closing = to.kind === "fechado" || to.kind === "perdido";
  if (deal.closedAt && !closing) {
    // Reabrir: só se o contato não tiver outro lead aberto (nunca dois abertos ao mesmo tempo).
    const other = await findOpenDeal(deal.contactId, tx);
    if (other && other.id !== deal.id) throw new ReopenConflict(other.id);
  }
  const sameWait = isWaitingKind(to.kind) && from?.kind === to.kind;
  if (isWaitingKind(from?.kind) && !sameWait) await cancelAttemptTaskTx(tx, deal, userId, at);
  let [updated] = await tx.update(deals).set({
    stageId: to.id, stageEnteredAt: at, closedAt: closing ? at : null,
    awaitingReplySince: closing ? null : deal.awaitingReplySince,
    ...(sameWait ? {} : { followupAttempt: 0, followupDueAt: null, followupTaskId: null }),
  }).where(eq(deals.id, dealId)).returning();
  if (closing) {
    // Lead fechado ou perdido não espera mais resposta: os alertas abertos se resolvem.
    await tx.update(alerts).set({ resolvedAt: at, readAt: sql`coalesce(${alerts.readAt}, ${at.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
  }
  await logEvent(tx, dealId, "etapa_alterada", { de: from?.key, para: to.key, motivo: reason }, userId);
  if (isWaitingKind(to.kind) && !sameWait) updated = await startAttemptsTx(tx, updated, to.kind, userId, at, opts);
  return updated;
}

/** Move para a etapa ativa de um TIPO (o código não depende das chaves). Já numa etapa desse tipo: não faz nada. */
export async function moveToKindTx(tx: Tx, dealId: string, kind: StageKind, userId: string | null, reason: string, at = new Date(), opts: AttemptStart = {}) {
  const [cur] = await tx.select({ deal: deals, kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
  if (!cur) throw new Error("Lead não encontrado");
  if (cur.kind === kind) return cur.deal;
  return moveDealTx(tx, dealId, (await stageByKind(kind, tx)).key, userId, reason, at, opts);
}
```

Em `src/server/domain/deals.test.ts:71`, trocar `"followup_2"` por `"followup_1"` (Follow-up 2 agora está desativado).

- [ ] **Passo 7: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/attempts.test.ts src/lib/attempts.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck`
Esperado: verde. Alguns testes passam a ver uma próxima ação "Tentativa 1 de 3…" depois de mover para Follow-up 1:
- `bulk.test.ts` "mover etapa em massa";
- `stage-move.test.ts:46`;
- `resume-later.test.ts`.

Isso é o comportamento novo. Ajuste só as contagens de tarefas que mudaram e, para cada ajuste, escreva no commit o que mudou.

- [ ] **Passo 8: Commit**

```bash
git add src/lib/attempts.ts src/lib/attempts.test.ts src/server/domain/attempts.ts src/server/domain/attempts.test.ts src/server/domain/deals.ts src/server/domain/deals.test.ts
git commit -m "feat(funil): tentativas D+1/D+3/D+7 ao entrar em Aguardando/Orçamento (tarefas, sem envio) e moveToKindTx

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C3: Botões "Marcar como aguardando cliente" (com "retomar em" opcional) e "Enviei orçamento", integrados ao "Retomar depois"

**Arquivos:**
- Criar: `src/server/domain/funnel.ts`, `src/server/domain/funnel-waiting.test.ts`
- Modificar: `src/server/domain/resume-later.ts` (passa a ser um envoltório)
- Modificar: `src/server/domain/events.ts:5-9` (tipos de evento)
- Modificar: `src/app/(app)/funil/actions.ts` (ações novas, no lugar de `resumeLaterAction`)
- Modificar: `src/components/queue/resume-later-sheet.tsx`, `src/components/queue/use-lead-actions.tsx`, `src/components/queue/client-pane.tsx`
- Modificar: `src/lib/alert-copy.ts` (`PARADOS_ACTIONS`, texto da B2), `src/lib/alert-copy.test.ts`, `src/components/queue/queue-list.render.test.tsx`
- Testes: `src/server/domain/resume-later.test.ts` (mantém os casos)

**Interfaces:**
- Consome (C2): `moveToKindTx`, `rescheduleAttemptTx`, `attemptLabel`, `MAX_ATTEMPTS`, `clientFirstName` (de `src/lib/attempts.ts`). Do 1B: `PARADOS_ACTIONS`, `sectionHelp`.
- Produz:
  - `markWaitingForClient(dealId: string, input: { resumeAt?: Date | null; title?: string | null; assigneeId?: string | null }, userId: string | null, now?: Date): Promise<{ dueAt: Date }>`;
  - `markProposalSent(dealId: string, userId: string | null, now?: Date, input?: { resumeAt?: Date | null; title?: string | null; assigneeId?: string | null }): Promise<{ dueAt: Date }>`;
  - `waitForClientAction(input: { dealId: string; title?: string; dueAt: string | null; assigneeId: string | null }): Promise<ActionResult<{ dueAt: string }>>`;
  - `proposalSentAction(dealId: string): Promise<ActionResult<{ dueAt: string }>>`;
  - `DealEventType` ganha `"aguardando_cliente" | "orcamento_enviado" | "tentativa" | "espera_vencida"`;
  - `LeadActions.proposalSent: () => void`;
  - `resumeLater(...)` mantém a assinatura e chama `markWaitingForClient`;
  - `resumeLaterAction` sai, trocado por `waitForClientAction`;
  - `PARADOS_ACTIONS = "Agendar, Aguardar cliente ou Encerrar"` (frase da spec para a seção Parados).

- [ ] **Passo 1: Testes do domínio**

`src/server/domain/funnel-waiting.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, dealEvents, deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { markProposalSent, markWaitingForClient } from "./funnel";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h
const later = (min: number) => new Date(T0.getTime() + min * 60_000);
let ana = "";
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function conversa() {
  const r = await recordInbound({ channelId: null, externalId: "W1", phoneRaw: "71988887777", pushName: "Rita", body: "Quanto custa?", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "R$ 150", at: later(1) });
  await recordInbound({ channelId: null, externalId: "W2", phoneRaw: "71988887777", body: "vou ver com meu marido e te falo", at: later(2) });
  return r.dealId;
}

describe("Marcar como aguardando cliente", () => {
  it("automático: vai para Aguardando cliente, tentativa 1 em D+1, sai da espera e os avisos se resolvem", async () => {
    const id = await conversa();
    await db.insert(alerts).values({ dealId: id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "w1", level: 1 });
    const r = await markWaitingForClient(id, {}, ana, later(3));
    expect(r.dueAt.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(await stageOf(id)).toBe("followup_1");
    expect((await dealOf(id)).awaitingReplySince).toBeNull();
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, id), isNull(alerts.resolvedAt)))).toHaveLength(0);
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, id), eq(dealEvents.type, "aguardando_cliente")));
    expect(ev[0].payload).toMatchObject({ automatico: true, etapaAntes: "atendimento" });
  });

  it("com 'retomar em': a tentativa 1 é na data e com o título escolhidos", async () => {
    const id = await conversa();
    const due = new Date("2026-10-20T13:00:00Z");
    await markWaitingForClient(id, { resumeAt: due, title: "Ela vai falar com o marido" }, ana, later(3));
    const [t] = await openTasks(id);
    expect(t).toMatchObject({ title: "Ela vai falar com o marido", dueAt: due });
  });

  it("já aguardando: sem data recusa; com data só muda a data da tentativa atual", async () => {
    const id = await conversa();
    await markWaitingForClient(id, {}, ana, later(3));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já está em Aguardando cliente");
    await markWaitingForClient(id, { resumeAt: new Date("2026-10-22T13:00:00Z") }, ana, later(5));
    const d = await dealOf(id);
    expect(d.followupAttempt).toBe(1);
    expect((await openTasks(id)).map((t) => [t.title, t.dueAt.toISOString()])).toEqual([["Tentativa 1 de 3: retomar contato com Rita", "2026-10-22T13:00:00.000Z"]]);
  });

  it("Agendado: não sai da etapa; pede a data e cria só o lembrete", async () => {
    const id = await conversa();
    await db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "teste", later(3)));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já tem horário");
    await markWaitingForClient(id, { resumeAt: new Date("2026-10-16T13:00:00Z") }, ana, later(4));
    expect(await stageOf(id)).toBe("agendado");
    expect((await openTasks(id))[0].title).toBe("Retomar contato com Rita");
  });

  it("conversa encerrada (fechada ou perdida): erro claro", async () => {
    const id = await conversa();
    await db.transaction((tx) => moveDealTx(tx, id, "perdido", null, "teste", later(3)));
    await expect(markWaitingForClient(id, {}, ana, later(4))).rejects.toThrow("já foi encerrada");
  });
});

describe("Enviei orçamento", () => {
  it("vai para Orçamento enviado, retomada em 2 dias, sai da espera", async () => {
    const id = await conversa();
    const r = await markProposalSent(id, ana, later(3));
    expect(await stageOf(id)).toBe("orcamento");
    expect(r.dueAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
    expect((await dealOf(id)).awaitingReplySince).toBeNull();
  });

  it("de Aguardando cliente: recomeça as tentativas no ritmo do orçamento; de Agendado ou já em Orçamento: recusa", async () => {
    const id = await conversa();
    await markWaitingForClient(id, {}, ana, later(3));
    await markProposalSent(id, ana, later(4));
    expect((await openTasks(id)).map((t) => t.title)).toEqual(["Tentativa 1 de 3: retomar contato com Rita"]);
    await expect(markProposalSent(id, ana, later(5))).rejects.toThrow("Já está em Orçamento enviado");
    await db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "teste", later(6)));
    await expect(markProposalSent(id, ana, later(7))).rejects.toThrow("já tem horário");
  });
});
```

Em `src/lib/alert-copy.test.ts` (B2), no teste "títulos novos e a frase fixa de cada seção", troque a linha de `parados` por:

```ts
    expect(sectionHelp("parados", 2)).toBe("Há 2 dias ou mais sem ninguém decidir o próximo passo. Marque Agendar, Aguardar cliente ou Encerrar.");
```

Em `src/components/queue/queue-list.render.test.tsx` (B5), troque a frase esperada de Parados por:

```ts
    ["Parados", "Há 4 dias ou mais sem ninguém decidir o próximo passo. Marque Agendar, Aguardar cliente ou Encerrar."],
```

Rodar: `npx vitest run src/server/domain/funnel-waiting.test.ts src/lib/alert-copy.test.ts src/components/queue/queue-list.render.test.tsx`
Esperado: FAIL ("Failed to resolve import ./funnel" e a frase de Parados ainda com "Retomar depois").

- [ ] **Passo 2: Eventos novos**

`src/server/domain/events.ts:5-9`: acrescentar ao fim da união `| "aguardando_cliente" | "orcamento_enviado" | "tentativa" | "espera_vencida"`.

- [ ] **Passo 3: `src/server/domain/funnel.ts`**

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, stages } from "../db/schema";
import { moveToKindTx } from "./deals";
import { emit, logEvent } from "./events";
import { setNextActionTx } from "./tasks";
import { rescheduleAttemptTx } from "./attempts";
import { UserFacingError } from "./errors";
import { clientFirstName } from "../../lib/attempts";

/**
 * O funil da Casa (Lote 1C): as passagens que a equipe faz com um toque e as que o sistema faz sozinho.
 * Nada aqui envia mensagem: as tentativas são próximas ações (combinados) que viram aviso no dia.
 */

type WaitInput = { resumeAt?: Date | null; title?: string | null; assigneeId?: string | null };

async function openDealState(tx: Tx, dealId: string) {
  const [d] = await tx.select({ kind: stages.kind, closedAt: deals.closedAt, archivedAt: deals.archivedAt, name: contacts.name })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(eq(deals.id, dealId)).for("update", { of: deals });
  if (!d) throw new UserFacingError("Lead não encontrado");
  if (d.closedAt) throw new UserFacingError("Essa conversa já foi encerrada (venda fechada ou perdida).");
  if (d.archivedAt) throw new UserFacingError("Esse lead saiu da fila.");
  return d;
}

/** A conversa deixa de esperar a Casa: espera zerada e avisos resolvidos (como o "Retomar depois" fazia). */
async function clearWaitTx(tx: Tx, dealId: string, now: Date) {
  await tx.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, dealId));
  await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
}

/**
 * "Marcar como aguardando cliente" (o "Retomar depois" faz o mesmo, sempre com data): a bola está com a cliente.
 * Vai para Aguardando cliente com a tentativa 1 na data escolhida ou, sem data, em D+1. Já aguardando: só troca a data.
 * Agendado/Atendida: a etapa não muda, fica só o lembrete (pede a data).
 */
export async function markWaitingForClient(dealId: string, input: WaitInput, userId: string | null, now = new Date()): Promise<{ dueAt: Date }> {
  const dueAt = await db.transaction(async (tx) => {
    const d = await openDealState(tx, dealId);
    const title = input.title?.trim() || undefined;
    const assignee = input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {};
    let due: Date;
    if (d.kind === "agendado" || d.kind === "atendido") {
      if (!input.resumeAt) throw new UserFacingError("Essa cliente já tem horário. Escolha a data para retomar.");
      due = (await setNextActionTx(tx, dealId, { title: title ?? `Retomar contato com ${clientFirstName(d.name)}`, dueAt: input.resumeAt, ...assignee }, userId, now)).dueAt;
    } else if (d.kind === "followup") {
      if (!input.resumeAt) throw new UserFacingError("Ela já está em Aguardando cliente. Escolha a data para retomar.");
      due = (await rescheduleAttemptTx(tx, dealId, { resumeAt: input.resumeAt, title, ...assignee }, userId, now)).dueAt;
    } else {
      const moved = await moveToKindTx(tx, dealId, "followup", userId, "aguardando_cliente", now, { resumeAt: input.resumeAt ?? null, taskTitle: title, ...assignee });
      due = moved.followupDueAt!;
    }
    await clearWaitTx(tx, dealId, now);
    await logEvent(tx, dealId, "aguardando_cliente", { retomarEm: due.toISOString(), automatico: !input.resumeAt, etapaAntes: d.kind }, userId);
    return due;
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
  return { dueAt };
}

/** "Enviei orçamento/projeção": Orçamento enviado, com as tentativas no ritmo do orçamento (a 1ª em 2 dias). */
export async function markProposalSent(dealId: string, userId: string | null, now = new Date(), input: WaitInput = {}): Promise<{ dueAt: Date }> {
  const dueAt = await db.transaction(async (tx) => {
    const d = await openDealState(tx, dealId);
    if (d.kind === "agendado" || d.kind === "atendido") throw new UserFacingError("Essa cliente já tem horário marcado.");
    if (d.kind === "proposta") throw new UserFacingError("Já está em Orçamento enviado.");
    const moved = await moveToKindTx(tx, dealId, "proposta", userId, "orcamento_enviado", now, {
      resumeAt: input.resumeAt ?? null, taskTitle: input.title?.trim() || undefined, ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    });
    await clearWaitTx(tx, dealId, now);
    await logEvent(tx, dealId, "orcamento_enviado", { retomarEm: moved.followupDueAt?.toISOString() ?? null, etapaAntes: d.kind }, userId);
    return moved.followupDueAt!;
  });
  await emit("lead_atualizado", { dealId });
  await emit("etapa_alterada", { dealId });
  return { dueAt };
}
```

- [ ] **Passo 4: `resume-later.ts` vira envoltório**

Substituir o arquivo inteiro:

```ts
import { markWaitingForClient } from "./funnel";
import { UserFacingError } from "./errors";

/**
 * "Retomar depois" (pedido da Casa, 14/10) é o "Marcar como aguardando cliente" com data (Lote 1C): Aguardando cliente com a
 * tentativa 1 no dia e no motivo escolhidos; a espera e os avisos se resolvem. Agendado continua agendado (só o lembrete).
 */
export async function resumeLater(dealId: string, input: { title: string; dueAt: Date; assigneeId?: string | null }, userId: string | null, now = new Date()) {
  if (!input.title.trim()) throw new UserFacingError("Escreva o que precisa ser feito.");
  await markWaitingForClient(dealId, { resumeAt: input.dueAt, title: input.title, assigneeId: input.assigneeId }, userId, now);
}
```

- [ ] **Passo 5: Server actions**

Em `src/app/(app)/funil/actions.ts`:
- import: trocar `import { resumeLater } from "@/server/domain/resume-later";` por `import { markProposalSent, markWaitingForClient } from "@/server/domain/funnel";`;
- substituir `resumeLaterAction` (ache com `grep -n "resumeLaterAction" "src/app/(app)/funil/actions.ts"`):

```ts
const waitInput = z.object({
  dealId: uuid,
  title: z.string().trim().max(120, "Resuma em até 120 caracteres.").optional(),
  dueAt: z.string().datetime({ offset: true, message: "Escolha a data e a hora." }).nullable(),
  assigneeId: uuid.nullable(),
});
/** "Marcar como aguardando cliente" (e "Retomar depois"): com data, ou automático (tentativas D+1, D+3, D+7). Nunca manda mensagem. */
export async function waitForClientAction(input: z.input<typeof waitInput>): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const v = waitInput.safeParse(input);
    if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Confira os dados." };
    const r = await markWaitingForClient(v.data.dealId, { resumeAt: v.data.dueAt ? new Date(v.data.dueAt) : null, title: v.data.title || null, assigneeId: v.data.assigneeId }, user.id);
    revalidateLead();
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível marcar como aguardando. Tente de novo."); }
}

/** "Enviei orçamento": Orçamento enviado, retomada em 2 dias se ela não responder. */
export async function proposalSentAction(dealId: string): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const r = await markProposalSent(uuid.parse(dealId), user.id);
    revalidateLead();
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível registrar o orçamento. Tente de novo."); }
}
```

Rodar: `grep -rn "resumeLaterAction" src` → Esperado: só `resume-later-sheet.tsx`, que é trocado no próximo passo.

- [ ] **Passo 6: A folha (`resume-later-sheet.tsx`)**

Substituir o componente inteiro, mantendo `REASONS`:

```tsx
"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { waitForClientAction } from "@/app/(app)/funil/actions";
import { dueLabel, resumePresets, type ResumePreset } from "@/lib/next-action";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { cn } from "@/lib/cn";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

type When = "auto" | ResumePreset["key"] | "outra";
export type WaitMode = "aguardar" | "nova-data" | "lembrete";

/** Motivos que mais aparecem; tocar preenche o lembrete (dá para escrever outro). */
const REASONS = ["Vai dar retorno para agendar", "Vai ver a agenda e avisar", "Pediu para chamar depois", "Vai pensar no valor"];

/**
 * "Marcar como aguardando cliente" (antes "Retomar depois"). `aguardar`: vai para Aguardando cliente; "Automático" segue as
 * tentativas D+1, D+3, D+7 (cada uma vira um combinado com aviso; nada é enviado à cliente). `nova-data`: já aguardando, muda a data.
 * `lembrete`: tem horário (Agendado/Atendida), a etapa não muda. Nasce nova a cada abertura (`key`).
 */
export function ResumeLaterSheet({ open, onClose, dealId, name, people, defaultAssigneeId, mode, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; people: { id: string; name: string }[];
  defaultAssigneeId: string | null; mode: WaitMode; onDone: (dueMs: number) => void;
}) {
  const [openedAt] = useState(() => Date.now());
  const presets = resumePresets(openedAt);
  const first = name.split(/\s+/)[0] || name;
  const canAuto = mode === "aguardar";
  const [when, setWhen] = useState<When>(canAuto ? "auto" : "3dias");
  const [slot, setSlot] = useState(() => bahiaParts(presets[1].at.getTime()));
  const [title, setTitle] = useState(canAuto ? "" : `Retomar contato com ${first}`);
  const [assignee, setAssignee] = useState(people.some((p) => p.id === defaultAssigneeId) ? defaultAssigneeId! : "");
  const [error, setError] = useState<{ title?: string; when?: string; form?: string }>({});
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const auto = when === "auto";
  const ms = auto ? NaN : slotMs(slot.date, slot.time);
  const pretty = !auto && Number.isFinite(ms) ? dueLabel(ms, openedAt) : null;
  const pick = (key: When) => {
    setWhen(key);
    const p = presets.find((x) => x.key === key);
    if (p) setSlot(bahiaParts(p.at.getTime()));
    if (key !== "auto" && !title) setTitle(`Retomar contato com ${first}`);
    setError((e) => ({ ...e, when: undefined, form: undefined }));
  };
  const setField = (patch: Partial<typeof slot>) => { setSlot((s) => ({ ...s, ...patch })); setWhen("outra"); setError((e) => ({ ...e, when: undefined, form: undefined })); };

  const confirm = () => {
    if (pending || sending.current) return;
    const next: typeof error = {};
    if (!auto) {
      if (!title.trim()) next.title = "Escreva o motivo do lembrete.";
      if (!Number.isFinite(ms)) next.when = "Escolha o dia e a hora.";
      else if (ms < openedAt - 5 * 60_000) next.when = "Essa data já passou. Escolha uma data futura.";
    }
    setError(next);
    if (Object.keys(next).length) { if (next.title) titleRef.current?.focus(); return; }
    sending.current = true;
    start(async () => {
      const r = await waitForClientAction({ dealId, title: auto ? undefined : title.trim(), dueAt: auto ? null : new Date(ms).toISOString(), assigneeId: assignee || null });
      if (!r.ok) { sending.current = false; setError({ form: r.error }); return; }
      onDone(new Date(r.data!.dueAt).getTime());
    });
  };

  const intro = mode === "aguardar"
    ? <>{first} não precisa de resposta agora. A conversa vai para <b className="font-medium text-ink">Aguardando cliente</b> e sai de Atrasados.
        {" "}No <b className="font-medium text-ink">Automático</b>, a Casa retoma até 3 vezes (amanhã, em 3 dias e em 7 dias): cada tentativa aparece em Combinados no dia, com aviso. Nada é enviado sozinho para a cliente.</>
    : mode === "nova-data" ? <>{first} já está aguardando. Escolha quando retomar a tentativa atual.</>
    : <>{first} tem horário marcado: a etapa não muda. Fica só o lembrete para o dia escolhido.</>;

  return (
    <ActionSheet open={open} onClose={onClose} title={mode === "aguardar" ? "Aguardando cliente" : "Retomar depois"} initialFocusRef={titleRef}
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button size="lg" onClick={confirm} loading={pending}>{mode === "aguardar" ? "Marcar como aguardando" : "Salvar lembrete"}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-graphite">{intro}</p>
        <div>
          <SheetLabel id="retomar-quando">Retomar</SheetLabel>
          <Segmented<When> labelledBy="retomar-quando" value={when} onChange={pick}
            options={[...(canAuto ? [{ value: "auto" as const, label: "Automático" }] : []), ...presets.map((p) => ({ value: p.key as When, label: p.label })), { value: "outra" as const, label: "Outra data" }]} />
          {!auto && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <SheetLabel><label htmlFor="retomar-dia">Dia</label></SheetLabel>
                <Input id="retomar-dia" type="date" min={bahiaParts(openedAt).date} value={slot.date} onChange={(e) => setField({ date: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
              </div>
              <div>
                <SheetLabel><label htmlFor="retomar-hora">Hora</label></SheetLabel>
                <Input id="retomar-hora" type="time" step={300} value={slot.time} onChange={(e) => setField({ time: e.target.value })} aria-invalid={error.when ? true : undefined} className="h-12" />
              </div>
            </div>
          )}
          {pretty && !error.when && <p className="mt-2 font-display text-xl leading-snug first-letter:uppercase">{pretty}</p>}
          <FieldError>{error.when}</FieldError>
        </div>
        {!auto && (
          <div>
            <SheetLabel><label htmlFor="retomar-motivo">Lembrete</label></SheetLabel>
            <Input id="retomar-motivo" ref={titleRef} value={title} maxLength={120} autoComplete="off" enterKeyHint="done"
              aria-invalid={error.title ? true : undefined} aria-describedby={error.title ? "retomar-motivo-erro" : undefined}
              onChange={(e) => { setTitle(e.target.value); setError((x) => ({ ...x, title: undefined, form: undefined })); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }} className="h-12" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => { setTitle(r); setError((x) => ({ ...x, title: undefined })); }}
                  className={cn("min-h-9 rounded-full border px-3 text-sm transition-colors pointer-coarse:min-h-11",
                    title === r ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{r}</button>
              ))}
            </div>
            <div id="retomar-motivo-erro"><FieldError>{error.title}</FieldError></div>
          </div>
        )}
        <div>
          <SheetLabel><label htmlFor="retomar-quem">Quem retoma</label></SheetLabel>
          <Select id="retomar-quem" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-12">
            <option value="">Sem responsável</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <FieldError>{error.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
```

- [ ] **Passo 7: `use-lead-actions.tsx`**

- Import: acrescentar `proposalSentAction` ao import de `@/app/(app)/funil/actions`.
- No tipo `LeadActions`, depois de `attendance`:

```ts
  /** "Enviei orçamento": Orçamento enviado, retomada em 2 dias se ela não responder. */
  proposalSent: () => void;
```

- Dentro do hook, depois de `attendance`:

```ts
  const proposalSent = useCallback(() => {
    if (!d) return;
    start(async () => {
      const r = await proposalSentAction(d.deal.id);
      toast(r.ok ? `Orçamento enviado · retomar ${dueLabel(new Date(r.data!.dueAt).getTime(), Date.now())} se ela não responder` : r.error, r.ok ? "ok" : "error");
      if (r.ok) await reload();
    });
  }, [d, reload, toast]);
```

- Na folha `resume`, passar `mode` e trocar o aviso:

```tsx
      {sheet.kind === "resume" && (
        <ResumeLaterSheet key={`r${sheet.n}`} open={sheet.open} onClose={close} dealId={d.deal.id} name={name} people={d.people}
          defaultAssigneeId={d.deal.ownerId ?? viewer?.id ?? null}
          mode={d.stage.kind === "followup" ? "nova-data" : d.stage.kind === "agendado" || d.stage.kind === "atendido" ? "lembrete" : "aguardar"}
          onDone={(ms) => done(d.stage.kind === "agendado" || d.stage.kind === "atendido" ? `Lembrete salvo · ${dueLabel(ms, Date.now())}` : `${name} aguardando cliente · retomar ${dueLabel(ms, Date.now())}`)} />
      )}
```

- No `return` do hook e em `NO_ACTIONS`, acrescentar `proposalSent` (em `NO_ACTIONS`, `proposalSent: () => {}`).

- [ ] **Passo 8: `client-pane.tsx`: botões e situação das tentativas**

- Imports: acrescentar `IconSend` ao import de ícones; `import { attemptLabel, MAX_ATTEMPTS } from "@/lib/attempts";` e `import { dueLabel } from "@/lib/next-action";` (se ainda não estiver importado).
- Em `Outcome`, antes do `return null` final:

```tsx
  if ((k === "followup" || k === "proposta") && d.deal.followupAttempt > 0) {
    const when = d.deal.followupDueAt ? dueLabel(new Date(d.deal.followupDueAt).getTime(), Date.now()) : null;
    return (
      <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2.5 text-sm text-graphite" suppressHydrationWarning>
        <span className="font-semibold text-ink">{attemptLabel(d.deal.followupAttempt)}</span>
        {when && (d.deal.followupAttempt > MAX_ATTEMPTS
          ? <> · vira Perdido (Não respondeu mais) {when} se ela não responder</>
          : <> · próxima retomada {when}</>)}
      </p>
    );
  }
```

- No `NextSteps`, trocar o item `retomar` (ache com `grep -n 'key: "retomar"' src/components/queue/client-pane.tsx`) por:

```tsx
                k === "agendado" || k === "atendido"
                  ? { key: "retomar", icon: <IconClock size={18} />, label: "Retomar depois", hint: "Lembrete com dia e hora (a etapa não muda)", highlight: false, run: () => actions.open("resume") }
                  : { key: "aguardar", icon: <IconClock size={18} />, label: k === "followup" ? "Mudar a data da retomada" : "Marcar como aguardando cliente",
                      hint: k === "followup" ? "A tentativa atual vai para o dia escolhido" : "A bola está com ela: a Casa retoma em D+1, D+3 e D+7", highlight: false, run: () => actions.open("resume") },
                ...(["lead", "atendimento", "followup", "retorno"].includes(k) ? [{ key: "orcamento", icon: <IconSend size={18} />, label: "Enviei orçamento",
                  hint: "Retoma em 2 dias se ela não responder", highlight: false, run: actions.proposalSent }] : []),
```

- [ ] **Passo 9: Texto da seção Parados (1B)**

Em `src/lib/alert-copy.ts`, trocar a constante e o comentário:

```ts
/** As saídas de uma conversa parada (frase da spec): o botão "Marcar como aguardando cliente" entrou no Lote 1C. */
export const PARADOS_ACTIONS = "Agendar, Aguardar cliente ou Encerrar";
```

- [ ] **Passo 10: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/funnel-waiting.test.ts src/server/domain/resume-later.test.ts src/lib/alert-copy.test.ts src/components/queue/queue-list.render.test.tsx`
Esperado: PASS. O teste antigo "cria o lembrete, vai para Follow-up 1…" continua válido, porque o título e a data são os escolhidos.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela: rodar `npm run dev` (navegador headless em segundo plano). Na conversa de um lead de teste:
- abrir "Marcar como aguardando cliente" → Automático → salvar;
- o painel mostra "Tentativa 1/3 · próxima retomada amanhã 10:00";
- "Enviei orçamento" mostra o aviso "Orçamento enviado · retomar …";
- a seção Parados da Fila diz "Marque Agendar, Aguardar cliente ou Encerrar."
Usar o simulador (`/dev/simulador`); **nenhum número real**.

- [ ] **Passo 11: Commit**

```bash
git add src/server/domain/funnel.ts src/server/domain/funnel-waiting.test.ts src/server/domain/resume-later.ts src/server/domain/events.ts \
  "src/app/(app)/funil/actions.ts" src/components/queue/resume-later-sheet.tsx src/components/queue/use-lead-actions.tsx src/components/queue/client-pane.tsx \
  src/lib/alert-copy.ts src/lib/alert-copy.test.ts src/components/queue/queue-list.render.test.tsx
git commit -m "feat(funil): Marcar como aguardando cliente (retomar em opcional) e Enviei orçamento; Retomar depois usa o mesmo caminho

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C4: Varredura das tentativas (avança, adota a próxima ação trocada, Perdido "Não respondeu mais" com recontato único)

**Arquivos:**
- Modificar: `src/server/domain/funnel.ts` (acrescentar `sweepAttempts`)
- Modificar: `worker/index.ts:51-62`
- Teste: `src/server/domain/funnel-attempts.test.ts`

**Interfaces:**
- Consome (C2/C3): `ATTEMPT_DAYS`, `attemptDueAt`, `attemptTitle`, `MAX_ATTEMPTS`, `LAST_REPLY_DAYS`, `RECONTACT_DAYS`, `ATTEMPT_META`, `activeOwnerTx`, `moveToKindTx`, `markWaitingForClient`.
- Produz:
  - `sweepAttempts(now?: Date): Promise<{ advanced: number; adopted: number; lost: number; errors: string[] }>`;
  - `NO_REPLY_REASON = "Não respondeu mais"`;
  - evento `tentativa` com `{ feita: number, por: "mensagem" | "tarefa" }`.

- [ ] **Passo 1: Testes**

`src/server/domain/funnel-attempts.test.ts`:

```ts
import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, lists, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { markWaitingForClient, sweepAttempts } from "./funnel";
import { completeTask, setNextActionTx } from "./tasks";

const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10h (horário padrão: seg–sex 8–20, sáb 8–17)
const at = (iso: string) => new Date(iso);
let ana = "";
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const openTasks = (id: string) => db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
const casa = (id: string, iso: string) => recordOutbound({ dealId: id, channelId: null, body: "Oi Rita, conseguiu ver?", at: at(iso) });

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function aguardando() {
  const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71988886666", pushName: "Rita", body: "Quanto custa?", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "R$ 150", at: T0 });
  await markWaitingForClient(r.dealId, {}, ana, T0); // tentativa 1: quarta 14/10 10h
  return r.dealId;
}

it("D+1, D+3, D+7: a tentativa conta quando a Casa escreve no dia dela ou alguém conclui o combinado; depois de 2 dias vira Perdido", async () => {
  const id = await aguardando();
  await casa(id, "2026-10-13T16:00:00Z"); // terça: antes do dia da tentativa 1, não conta
  expect((await sweepAttempts(at("2026-10-14T12:00:00Z"))).advanced).toBe(0);

  await casa(id, "2026-10-14T14:00:00Z"); // quarta: tentativa 1 feita pelo celular
  expect((await sweepAttempts(at("2026-10-14T14:05:00Z"))).advanced).toBe(1);
  let d = await dealOf(id);
  expect(d).toMatchObject({ followupAttempt: 2 });
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-16T13:00:00.000Z"); // sexta (D+3)
  expect((await openTasks(id)).map((t) => t.title)).toEqual(["Tentativa 2 de 3: retomar contato com Rita"]);

  await completeTask(d.followupTaskId!, ana); // tentativa 2 marcada como feita (ligou)
  expect((await sweepAttempts(at("2026-10-16T14:00:00Z"))).advanced).toBe(1);
  d = await dealOf(id);
  expect(d.followupAttempt).toBe(3);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-20T13:00:00.000Z"); // terça seguinte (D+7)

  await casa(id, "2026-10-20T15:00:00Z");
  await sweepAttempts(at("2026-10-20T15:05:00Z"));
  d = await dealOf(id);
  expect(d.followupAttempt).toBe(4);
  expect(d.followupDueAt?.toISOString()).toBe("2026-10-22T13:00:00.000Z"); // 2 dias para a última resposta
  expect(await openTasks(id)).toHaveLength(0);

  expect((await sweepAttempts(at("2026-10-22T12:00:00Z"))).lost).toBe(0);
  expect((await sweepAttempts(at("2026-10-22T13:01:00Z"))).lost).toBe(1);
  expect(await stageOf(id)).toBe("perdido");
  d = await dealOf(id);
  const [reason] = await db.select().from(lists).where(eq(lists.id, d.lostReasonId!));
  expect(reason.label).toBe("Não respondeu mais");
  expect(d.recontactAt?.toISOString()).toBe("2026-11-21T13:00:00.000Z");
});

it("ninguém tentou: a conversa NÃO vira Perdido sozinha; o combinado fica vencido", async () => {
  const id = await aguardando();
  for (const iso of ["2026-10-15T13:00:00Z", "2026-10-21T13:00:00Z", "2026-10-30T13:00:00Z"]) await sweepAttempts(at(iso));
  expect(await stageOf(id)).toBe("followup_1");
  expect((await dealOf(id)).followupAttempt).toBe(1);
});

it("a equipe trocou a próxima ação: a nova passa a ser a tentativa atual", async () => {
  const id = await aguardando();
  const t = await db.transaction((tx) => setNextActionTx(tx, id, { title: "Ligar à tarde", dueAt: at("2026-10-15T18:00:00Z") }, ana, T0));
  expect((await sweepAttempts(at("2026-10-14T12:00:00Z"))).adopted).toBe(1);
  expect(await dealOf(id)).toMatchObject({ followupTaskId: t.id, followupAttempt: 1 });
});

it("a cliente respondeu: volta para Em conversa, contador zera e a tentativa aberta é cancelada", async () => {
  const id = await aguardando();
  await recordInbound({ channelId: null, externalId: "A2", phoneRaw: "71988886666", body: "Quero marcar sexta", at: at("2026-10-14T12:00:00Z") });
  expect(await stageOf(id)).toBe("atendimento");
  expect(await dealOf(id)).toMatchObject({ followupAttempt: 0, followupTaskId: null });
  expect(await openTasks(id)).toHaveLength(0);
});

it("2ª vez que perde por não responder: sem recontato (nada de ciclo eterno)", async () => {
  const id = await aguardando();
  await db.insert(dealEvents).values({ dealId: id, type: "etapa_alterada", payload: { de: "followup_1", para: "perdido", motivo: "nao_respondeu" } });
  await db.update(deals).set({ followupAttempt: 4, followupDueAt: at("2026-10-14T13:00:00Z") }).where(eq(deals.id, id));
  await sweepAttempts(at("2026-10-14T14:00:00Z"));
  expect(await stageOf(id)).toBe("perdido");
  expect((await dealOf(id)).recontactAt).toBeNull();
});

it("dona saiu da equipe no meio das tentativas: a varredura não trava e a próxima nasce sem responsável", async () => {
  const id = await aguardando();
  await db.update(users).set({ active: false }).where(eq(users.id, ana));
  await casa(id, "2026-10-14T14:00:00Z");
  expect(await sweepAttempts(at("2026-10-14T14:05:00Z"))).toMatchObject({ advanced: 1, errors: [] });
  const [t] = await openTasks(id);
  expect(t).toMatchObject({ title: "Tentativa 2 de 3: retomar contato com Rita", assigneeId: null });
});
```

Rodar: `npx vitest run src/server/domain/funnel-attempts.test.ts`
Esperado: FAIL ("sweepAttempts is not exported").

- [ ] **Passo 2: Implementar `sweepAttempts` em `funnel.ts`**

Imports novos em `funnel.ts` (juntar com os que já existem):

```ts
import { dealEvents, lists } from "../db/schema";
import { getBusinessHours } from "./hours";
import { completeTaskTx } from "./tasks";
import { ATTEMPT_META, activeOwnerTx } from "./attempts";
import { ATTEMPT_DAYS, LAST_REPLY_DAYS, MAX_ATTEMPTS, RECONTACT_DAYS, attemptDueAt, attemptTitle, type WaitingKind } from "../../lib/attempts";
import type { BusinessHours } from "../../lib/business-hours";
```

No fim do arquivo:

```ts
export const NO_REPLY_REASON = "Não respondeu mais";

/** Perdido "Não respondeu mais". Recontato em 30 dias só na 1ª vez deste lead (a automação "recontato" o devolve para Em conversa). */
async function loseNoReplyTx(tx: Tx, dealId: string, now: Date, hours: BusinessHours) {
  await tx.insert(lists).values({ kind: "lost_reason", label: NO_REPLY_REASON, position: 99 }).onConflictDoNothing();
  const [reason] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, NO_REPLY_REASON)));
  const before = await tx.select({ id: dealEvents.id }).from(dealEvents)
    .where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "etapa_alterada"), sql`${dealEvents.payload}->>'motivo' = 'nao_respondeu'`)).limit(1);
  await tx.update(deals).set({ lostReasonId: reason.id, recontactAt: before.length ? null : attemptDueAt(now.getTime(), RECONTACT_DAYS, hours) }).where(eq(deals.id, dealId));
  await moveToKindTx(tx, dealId, "perdido", null, "nao_respondeu", now);
}

type AttemptRow = {
  id: string; ownerId: string | null; name: string | null; kind: WaitingKind; enteredAt: Date; attempt: number; dueAt: Date | null;
  taskId: string | null; taskDone: boolean; openTaskId: string | null; openTaskDue: Date | null; casaEscreveu: boolean;
};

/**
 * Worker, a cada minuto. Em Aguardando cliente / Orçamento enviado:
 * - a tentativa atual conta como feita quando a Casa mandou mensagem no dia dela (ou depois) ou alguém concluiu o combinado dela;
 *   aí nasce a próxima (D+3, D+7; nunca no mesmo dia) ou, depois da 3ª, começam os 2 dias para a última resposta;
 * - a equipe trocou a próxima ação: a nova vira a tentativa;
 * - 2 dias depois da 3ª tentativa sem resposta: Perdido "Não respondeu mais".
 * Ninguém tentou: nada acontece (o combinado fica vencido em Combinados). Nunca envia mensagem.
 */
export async function sweepAttempts(now = new Date()): Promise<{ advanced: number; adopted: number; lost: number; errors: string[] }> {
  const rows = (await db.execute(sql`
    select d.id, d.owner_id as "ownerId", c.name, s.kind::text as kind, d.stage_entered_at as "enteredAt", d.followup_attempt as attempt,
      d.followup_due_at as "dueAt", d.followup_task_id as "taskId",
      exists (select 1 from deal_events e where e.deal_id = d.id and e.type = 'tarefa' and e.payload->>'acao' = 'concluida'
        and e.payload->>'tarefa' = d.followup_task_id::text) as "taskDone",
      ot.id as "openTaskId", ot.due_at as "openTaskDue",
      (d.followup_due_at is not null and exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'out'
        and m.status not in ('failed', 'pending') and m.created_at > d.stage_entered_at
        and m.created_at >= ((d.followup_due_at at time zone 'America/Bahia')::date)::timestamp at time zone 'America/Bahia')) as "casaEscreveu"
    from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
      left join lateral (select t.id, t.due_at from tasks t where t.deal_id = d.id and t.kind = 'proxima_acao' and t.done_at is null
        order by t.due_at asc limit 1) ot on true
    where d.closed_at is null and d.archived_at is null and c.ignored = false and s.kind in ('followup', 'proposta') and d.followup_attempt >= 1`)).rows as AttemptRow[];
  const out = { advanced: 0, adopted: 0, lost: 0, errors: [] as string[] };
  if (!rows.length) return out;
  const hours = await getBusinessHours();
  for (const r of rows) {
    try {
      const did = await db.transaction(async (tx): Promise<"advanced" | "adopted" | "lost" | null> => {
        const [cur] = await tx.select({ attempt: deals.followupAttempt, taskId: deals.followupTaskId, closedAt: deals.closedAt }).from(deals).where(eq(deals.id, r.id)).for("update");
        if (!cur || cur.closedAt || cur.attempt !== r.attempt || cur.taskId !== r.taskId) return null; // mudou nesse meio-tempo
        if (r.attempt > MAX_ATTEMPTS) {
          if (!r.dueAt || new Date(r.dueAt).getTime() > now.getTime()) return null;
          await loseNoReplyTx(tx, r.id, now, hours);
          return "lost";
        }
        if (!r.taskDone && !r.casaEscreveu) {
          if (r.openTaskId && r.openTaskId !== r.taskId) {
            await tx.update(deals).set({ followupTaskId: r.openTaskId, followupDueAt: new Date(r.openTaskDue!) }).where(eq(deals.id, r.id));
            return "adopted";
          }
          return null;
        }
        if (r.taskId && !r.taskDone) await completeTaskTx(tx, r.taskId, null, "concluida", now);
        await logEvent(tx, r.id, "tentativa", { feita: r.attempt, por: r.taskDone ? "tarefa" : "mensagem" });
        if (r.attempt < MAX_ATTEMPTS) {
          const next = r.attempt + 1;
          const planned = attemptDueAt(new Date(r.enteredAt).getTime(), ATTEMPT_DAYS[r.kind][next - 1], hours);
          const earliest = attemptDueAt(now.getTime(), 1, hours);
          const t = await setNextActionTx(tx, r.id, {
            title: attemptTitle(next, r.name), dueAt: planned > earliest ? planned : earliest,
            assigneeId: await activeOwnerTx(tx, r.ownerId), meta: { ...ATTEMPT_META, tentativa: next },
          }, null, now);
          await tx.update(deals).set({ followupAttempt: next, followupDueAt: t.dueAt, followupTaskId: t.id }).where(eq(deals.id, r.id));
        } else {
          await tx.update(deals).set({ followupAttempt: MAX_ATTEMPTS + 1, followupDueAt: attemptDueAt(now.getTime(), LAST_REPLY_DAYS, hours), followupTaskId: null }).where(eq(deals.id, r.id));
        }
        return "advanced";
      });
      if (did) { out[did]++; await emit(did === "lost" ? "etapa_alterada" : "lead_atualizado", { dealId: r.id }); }
    } catch (e) { out.errors.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
```

- [ ] **Passo 3: Worker**

Em `worker/index.ts`:
- import: `import { sweepAttempts } from "../src/server/domain/funnel";`;
- no job de regras, logo depois de `sweepClosingWaits`:

```ts
    // Aguardando cliente / Orçamento: tentativas D+1, D+3, D+7 (combinados com aviso) e Perdido "Não respondeu mais" depois da 3ª. Nunca envia mensagem.
    const tt = await sweepAttempts().catch((e) => { console.error("[tentativas]", e); return { advanced: 0, adopted: 0, lost: 0, errors: [] as string[] }; });
    if (tt.advanced || tt.adopted || tt.lost || tt.errors.length) console.log("[tentativas]", tt);
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/funnel-attempts.test.ts`
Esperado: PASS (6 testes).

Rodar: `npm test && npm run typecheck`
Esperado: verde.

- [ ] **Passo 5: Commit**

```bash
git add src/server/domain/funnel.ts src/server/domain/funnel-attempts.test.ts worker/index.ts
git commit -m "feat(funil): tentativas avançam pela mensagem da Casa ou pelo combinado concluído; Perdido Não respondeu mais com recontato único

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C5: Atendida (Compareceu move, fecha sozinha em 3 dias, Encerrar fecha) e a cliente que escreve volta para Em conversa

**Arquivos:**
- Modificar: `src/server/domain/tasks.ts:117-127` (cancelar por origem; marca do pós-atendimento)
- Modificar: `src/server/domain/funnel.ts` (`enterAttendedTx`, `enterMissedTx`, `closeAsWonTx`, `closeAttendedDeals`)
- Modificar: `src/server/domain/updates.ts:263-291` (`markAttendance`)
- Modificar: `src/server/domain/conversation-archive.ts:11-22`
- Modificar: `src/server/domain/deals.ts:187-189` (`recordInbound`)
- Modificar: `src/lib/primary-action.ts` (`primaryAction` e o `askAttendance` da B7), `worker/index.ts`
- Testes: `src/server/domain/funnel-attended.test.ts` (novo), `src/server/domain/bulk.test.ts:90-161`, `src/lib/primary-action.test.ts`

**Interfaces:**
- Consome (C2): `moveToKindTx`, `activeOwnerTx`, `clientFirstName` (de `src/lib/attempts.ts`). Do 1B: `askAttendance` (B7).
- Produz:
  - `POS_ATENDIMENTO_META = { origem: "pos_atendimento" }`;
  - `cancelOpenTasksByOriginTx(tx, dealId, origem: string, userId): Promise<number>`;
  - `enterAttendedTx(tx, dealId, userId, reason, at, opts?: { visitAt?: Date; postTask?: boolean }): Promise<Deal>`;
  - `enterMissedTx(tx, dealId, userId, reason, now): Promise<{ remarcar: boolean }>`;
  - `closeAsWonTx(tx, dealId, userId, reason, at, opts?: { visitAt?: Date | null }): Promise<Deal>`;
  - `closeAttendedDeals(now?): Promise<{ closed: number; errors: string[] }>`;
  - `ATTENDED_CLOSE_DAYS = 3`;
  - `BACK_TO_CONVERSATION_KINDS = ["followup", "proposta", "retorno"]` (em `deals.ts`);
  - `markAttendance` com a mesma assinatura; agora move a etapa;
  - `askAttendance` passa a mostrar "Compareceu?" também em Atendida e Aguardando quando já há marcação (para corrigir).

- [ ] **Passo 1: Testes novos**

`src/server/domain/funnel-attended.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, salesItems, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { moveDealTx, recordInbound, recordOutbound } from "./deals";
import { closeAttendedDeals } from "./funnel";
import { archiveConversation } from "./conversation-archive";
import { markAttendance } from "./updates";

const T0 = new Date("2026-10-13T13:00:00Z");
let ana = "";
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const openTitles = async (id: string) => (await db.select().from(tasks).where(and(eq(tasks.dealId, id), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)))).map((t) => t.title);

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

async function lead(phone = "71988885555") {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}`, phoneRaw: phone, pushName: "Rita Souza", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId: ana }).where(eq(deals.id, r.dealId));
  return r.dealId;
}
const toStage = (id: string, key: string, at = T0) => db.transaction((tx) => moveDealTx(tx, id, key, null, "teste", at));

describe("Atendida", () => {
  it("Compareceu: vai para Atendida com o pós-atendimento (agradecer, foto, avaliação) para a dona", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    await markAttendance(id, "compareceu", ana);
    expect(await stageOf(id)).toBe("atendida");
    expect(await openTitles(id)).toEqual(["Pós-atendimento de Rita: agradecer, pedir foto e avaliação"]);
  });

  it("Faltou: Aguardando cliente com o Remarcar como tentativa 1", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    expect(await markAttendance(id, "faltou", ana)).toEqual({ changed: true, remarcar: true });
    expect(await stageOf(id)).toBe("followup_1");
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    const [t] = await db.select().from(tasks).where(eq(tasks.id, d.followupTaskId!));
    expect(t.title).toMatch(/^Remarcar com /);
    expect(d.followupAttempt).toBe(1);
  });

  it("corrigir Compareceu → Faltou: o pós-atendimento é cancelado e entra o Remarcar", async () => {
    const id = await lead();
    await toStage(id, "agendado");
    await markAttendance(id, "compareceu", ana);
    await markAttendance(id, "faltou", ana);
    expect(await stageOf(id)).toBe("followup_1");
    expect((await openTitles(id))[0]).toMatch(/^Remarcar com /);
    expect((await openTitles(id)).some((t) => t.startsWith("Pós-atendimento"))).toBe(false);
  });

  it("fecha sozinha como ganho 3 dias depois, com o valor da comanda do dia da visita", async () => {
    const id = await lead();
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await toStage(id, "atendida", T0);
    await db.update(deals).set({ attendance: "compareceu", attendanceAt: T0 }).where(eq(deals.id, id));
    await db.insert(salesItems).values([
      { contactId: d.contactId, soldOn: "2026-10-13", item: "Corte", kind: "servico", totalCents: 15000, externalKey: "t:si1" },
      { contactId: d.contactId, soldOn: "2026-10-13", item: "Escova", kind: "servico", totalCents: 5000, externalKey: "t:si2" },
      { contactId: d.contactId, soldOn: "2026-09-01", item: "Antigo", kind: "servico", totalCents: 99900, externalKey: "t:si3" },
    ]);
    expect((await closeAttendedDeals(new Date(T0.getTime() + 2 * 86_400_000))).closed).toBe(0);
    expect((await closeAttendedDeals(new Date(T0.getTime() + 3 * 86_400_000 + 60_000))).closed).toBe(1);
    const [after] = await db.select().from(deals).where(eq(deals.id, id));
    expect(await stageOf(id)).toBe("fechado");
    expect(after.valueCents).toBe(20000);
    expect(after.closedAt).not.toBeNull();
  });

  it("Encerrar conversa em Atendida fecha como ganho (sem esperar os 3 dias)", async () => {
    const id = await lead();
    await toStage(id, "atendida");
    await archiveConversation(id, ana);
    expect(await stageOf(id)).toBe("fechado");
  });
});

describe("a cliente escreve com a bola com ela", () => {
  const phone = "71988884444";
  async function waiting(key: string) {
    const id = await lead(phone);
    await recordOutbound({ dealId: id, channelId: null, body: "Te mando o valor já", at: T0 });
    await toStage(id, key, new Date(T0.getTime() + 60_000));
    return id;
  }
  it("Aguardando cliente: 'Obrigada!' não tira de lá; mensagem de verdade volta para Em conversa", async () => {
    const id = await waiting("followup_1");
    await recordInbound({ channelId: null, externalId: "B1", phoneRaw: phone, body: "Obrigada!", at: new Date(T0.getTime() + 120_000) });
    expect(await stageOf(id)).toBe("followup_1");
    await recordInbound({ channelId: null, externalId: "B2", phoneRaw: phone, body: "Pode ser sexta?", at: new Date(T0.getTime() + 180_000) });
    expect(await stageOf(id)).toBe("atendimento");
  });
  it.each([["orcamento"], ["retorno"]])("%s → Em conversa quando ela escreve", async (key) => {
    const id = await waiting(key);
    await recordInbound({ channelId: null, externalId: `C-${key}`, phoneRaw: phone, body: "Quero marcar", at: new Date(T0.getTime() + 120_000) });
    expect(await stageOf(id)).toBe("atendimento");
  });
});
```

Ajustes em `src/server/domain/bulk.test.ts`:
- teste "Compareceu conclui a conferência e não cria próxima ação; fora de Agendado recusa":
  - novo título: "Compareceu conclui a conferência, vai para Atendida e cria o pós-atendimento; fora de Agendado recusa";
  - trocar `expect(await nextActionOf(leads[0])).toBeNull();` por `expect((await nextActionOf(leads[0]))?.title).toMatch(/^Pós-atendimento de /);`.
- teste "Faltou → Compareceu: a correção cancela o Remarcar…": trocar `expect(await nextActionOf(leads[0])).toBeNull();` por `expect((await nextActionOf(leads[0]))?.title).toMatch(/^Pós-atendimento de /);`.

Em `src/lib/primary-action.test.ts`, acrescentar:

```ts
it("Atendida: a ação principal é Fechar venda (sem permissão: nenhuma)", () => {
  expect(primaryAction({ ...base, stageKind: "atendido" }, "eu", now)).toBe("fechar");
  expect(primaryAction({ ...base, stageKind: "atendido" }, "eu", now, { canClose: false })).toBeNull();
});
it("'Compareceu?' continua para corrigir depois que a conversa foi para Atendida ou Aguardando", () => {
  const now = Date.parse("2026-10-15T15:00:00Z");
  expect(askAttendance({ stageKind: "atendido", scheduledAt: "2026-10-15T13:00:00Z", attendance: "compareceu" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "followup", scheduledAt: "2026-10-15T13:00:00Z", attendance: "faltou" }, now)).toBe(true);
  expect(askAttendance({ stageKind: "followup", scheduledAt: null, attendance: null }, now)).toBe(false);
});
```

Rodar: `npx vitest run src/server/domain/funnel-attended.test.ts src/server/domain/bulk.test.ts src/lib/primary-action.test.ts`
Esperado: FAIL.

- [ ] **Passo 2: `tasks.ts`: cancelar por origem**

Substituir `cancelRemarcarTx`:

```ts
/** Marca da próxima ação que a Atendida cria (agradecer, pedir foto e avaliação). */
export const POS_ATENDIMENTO_META = { origem: "pos_atendimento" } as const;

/** Cancela as tarefas abertas que nasceram com essa marca (`origem` no evento de criação), nunca pelo título. Quem já trocou a ação não é tocado. */
export async function cancelOpenTasksByOriginTx(tx: Tx, dealId: string, origem: string, userId: string | null): Promise<number> {
  const open = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt),
    sql`exists (select 1 from deal_events e where e.deal_id = ${tasks.dealId} and e.type = 'tarefa' and e.payload->>'acao' = 'criada'
      and e.payload->>'tarefa' = ${tasks.id}::text and e.payload->>'origem' = ${origem})`));
  for (const t of open) await completeTaskTx(tx, t.id, userId, "cancelada");
  return open.length;
}

/** Cancela o "Remarcar" aberto que o Faltou criou. */
export const cancelRemarcarTx = (tx: Tx, dealId: string, userId: string | null) => cancelOpenTasksByOriginTx(tx, dealId, REMARCAR_META.origem, userId);
```

- [ ] **Passo 3: `funnel.ts`: Atendida, Faltou e fechar como ganho**

Imports adicionais (juntar com os existentes): `asc` e `lte` de `drizzle-orm`, `tasks` de `../db/schema`, e `import { cancelOpenTasksByOriginTx, nextDayMorning, POS_ATENDIMENTO_META, REMARCAR_META, remarcarDueAt } from "./tasks";`.

```ts
export const ATTENDED_CLOSE_DAYS = 3;
const POST_TASK_MAX_AGE_MS = 48 * 3_600_000;

async function openNextActionTx(tx: Tx, dealId: string) {
  const [t] = await tx.select({ id: tasks.id, dueAt: tasks.dueAt }).from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))).orderBy(asc(tasks.dueAt)).limit(1);
  return t ?? null;
}

/**
 * Compareceu (CRM, Agenda ou Avec): Atendida. Visita recente (até 48 h) e sem próxima ação combinada: abre o pós-atendimento
 * para a dona (agradecer, pedir foto e avaliação) no dia seguinte, 9h. A migração passa `postTask: false` (visitas antigas).
 */
export async function enterAttendedTx(tx: Tx, dealId: string, userId: string | null, reason: string, at: Date, opts: { visitAt?: Date; postTask?: boolean } = {}) {
  const deal = await moveToKindTx(tx, dealId, "atendido", userId, reason, at);
  const visit = opts.visitAt ?? at;
  if (opts.postTask === false || at.getTime() - visit.getTime() > POST_TASK_MAX_AGE_MS || await openNextActionTx(tx, dealId)) return deal;
  const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
  const next = nextDayMorning(visit);
  await setNextActionTx(tx, dealId, {
    title: `Pós-atendimento de ${clientFirstName(c?.name)}: agradecer, pedir foto e avaliação`,
    dueAt: next.getTime() > at.getTime() ? next : new Date(at.getTime() + 3_600_000),
    assigneeId: await activeOwnerTx(tx, deal.ownerId), meta: { ...POS_ATENDIMENTO_META },
  }, userId, at);
  return deal;
}

/** Faltou ou cancelou sem horário novo: Aguardando cliente com "Remarcar" como 1ª tentativa (ou a próxima ação futura que já estava combinada). */
export async function enterMissedTx(tx: Tx, dealId: string, userId: string | null, reason: string, now: Date): Promise<{ remarcar: boolean }> {
  const [d] = await tx.select({ name: contacts.name, ownerId: deals.ownerId }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  await cancelOpenTasksByOriginTx(tx, dealId, POS_ATENDIMENTO_META.origem, userId); // era um Compareceu corrigido: o pós não vale mais
  const open = await openNextActionTx(tx, dealId);
  const keep = !!open && open.dueAt.getTime() >= now.getTime();
  await moveToKindTx(tx, dealId, "followup", userId, reason, now, keep ? {} : {
    resumeAt: remarcarDueAt(now), taskTitle: `Remarcar com ${d?.name?.trim() || "a cliente"}`, taskMeta: { ...REMARCAR_META },
    assigneeId: await activeOwnerTx(tx, d?.ownerId ?? null),
  });
  return { remarcar: !keep };
}

/** Fechado (ganho) depois do atendimento. Sem valor no lead, usa o total das comandas da cliente no dia da visita (Avec). */
export async function closeAsWonTx(tx: Tx, dealId: string, userId: string | null, reason: string, at: Date, opts: { visitAt?: Date | null } = {}) {
  const [d] = await tx.select({ valueCents: deals.valueCents, contactId: deals.contactId, attendanceAt: deals.attendanceAt, enteredAt: deals.stageEnteredAt })
    .from(deals).where(eq(deals.id, dealId));
  if (!d) throw new Error("Lead não encontrado");
  if (d.valueCents == null) {
    const visit = opts.visitAt ?? d.attendanceAt ?? d.enteredAt;
    const [s] = (await tx.execute(sql`select sum(total_cents)::int as cents from sales_items where contact_id = ${d.contactId}
      and sold_on = (${visit.toISOString()}::timestamptz at time zone 'America/Bahia')::date`)).rows as { cents: number | null }[];
    if (s?.cents) await tx.update(deals).set({ valueCents: s.cents }).where(eq(deals.id, dealId));
  }
  return moveToKindTx(tx, dealId, "fechado", userId, reason, at);
}

/** Worker: Atendida há 3 dias vira Fechado (ganho). */
export async function closeAttendedDeals(now = new Date()): Promise<{ closed: number; errors: string[] }> {
  const limit = new Date(now.getTime() - ATTENDED_CLOSE_DAYS * 86_400_000);
  const rows = await db.select({ id: deals.id }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId))
    .where(and(eq(stages.kind, "atendido"), isNull(deals.closedAt), isNull(deals.archivedAt), lte(deals.stageEnteredAt, limit)));
  const out = { closed: 0, errors: [] as string[] };
  for (const r of rows) {
    try {
      await db.transaction((tx) => closeAsWonTx(tx, r.id, null, "atendida_3_dias", now));
      await emit("etapa_alterada", { dealId: r.id });
      out.closed++;
    } catch (e) { out.errors.push(`${r.id}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
```

- [ ] **Passo 4: `markAttendance` (updates.ts)**

Import: `import { enterAttendedTx, enterMissedTx } from "./funnel";`. Substituir o comentário e a função:

```ts
/**
 * "Compareceu" / "Faltou" na Fila e no painel (Lote 1C): Compareceu → Atendida (com o pós-atendimento); Faltou → Aguardando cliente
 * com o Remarcar como 1ª tentativa (mantém a próxima ação futura que já estava combinada). Vale para Agendado e para a correção de um
 * Compareceu/Faltou já marcado (a conversa já está em Atendida ou Aguardando). Repetir o mesmo valor não faz nada.
 */
export async function markAttendance(dealId: string, status: "compareceu" | "faltou", userId: string, now = new Date()): Promise<{ changed: boolean; remarcar: boolean }> {
  const value = z.enum(["compareceu", "faltou"]).parse(status);
  const r = await db.transaction(async (tx) => {
    const [row] = await tx.select({ attendance: deals.attendance, archivedAt: deals.archivedAt, kind: stages.kind })
      .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    if (!row) throw new UserFacingError("Lead não encontrado");
    if (row.archivedAt) throw new UserFacingError("Esse lead saiu da fila.");
    const correcting = !!row.attendance && (row.kind === "atendido" || row.kind === "followup");
    if (row.kind !== "agendado" && !correcting) throw new UserFacingError("Só dá para conferir o comparecimento de um lead agendado.");
    if (row.attendance === value) return { changed: false, remarcar: false };
    await setAttendanceTx(tx, dealId, value, userId);
    if (value === "compareceu") { await enterAttendedTx(tx, dealId, userId, "compareceu", now, { visitAt: now }); return { changed: true, remarcar: false }; }
    return { changed: true, ...(await enterMissedTx(tx, dealId, userId, "faltou", now)) };
  });
  if (r.changed) { await emit("lead_atualizado", { dealId }); await emit("etapa_alterada", { dealId }); }
  return r;
}
```

Remova de `updates.ts` os imports que sobrarem sem uso (`REMARCAR_META`, `remarcarDueAt`, `setNextActionTx` se nada mais usar). O `npm run lint` acusa.

- [ ] **Passo 5: Encerrar conversa em Atendida**

Em `src/server/domain/conversation-archive.ts`:
- import: `import { stages } from "../db/schema";` e `import { closeAsWonTx } from "./funnel";`;
- dentro da transação de `archiveConversation`, depois do `logEvent(... "conversa_arquivada" ...)`:

```ts
    // Atendida: encerrar a conversa é o fim do atendimento → Fechado (ganho), sem esperar os 3 dias.
    const [s] = await tx.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    if (s?.kind === "atendido") await closeAsWonTx(tx, dealId, userId, "conversa_encerrada", now);
```

- [ ] **Passo 6: `recordInbound` (deals.ts:187-189)**

Acima de `recordInbound`:

```ts
/** Etapas em que a bola está com a cliente: se ela escreve de verdade, a conversa volta para Em conversa (spec 1C, etapas 2, 3 e 6). */
export const BACK_TO_CONVERSATION_KINDS = ["followup", "proposta", "retorno"] as const;
```

Trocar as linhas do `if (stage?.kind === "followup") await moveDealTx(...)`:

```ts
    // A cliente escreveu com a bola com ela (Aguardando, Orçamento, Retorno sugerido): volta para Em conversa.
    // "Obrigada!"/figurinha logo depois da Casa não conta: continua aguardando.
    const [stage] = await tx.select().from(stages).where(eq(stages.id, deal.stageId));
    const onlyClosing = closesConversation(input.kind ?? "text", input.body) && !created && !!deal.lastOutboundAt;
    if (stage && (BACK_TO_CONVERSATION_KINDS as readonly string[]).includes(stage.kind) && !onlyClosing) await moveToKindTx(tx, deal.id, "atendimento", null, "cliente_respondeu", at);
```

- [ ] **Passo 7: Ação principal, barra de comparecimento e worker**

`src/lib/primary-action.ts`, logo depois da linha do `fechado || perdido`:

```ts
  if (d.stageKind === "atendido") return opts.canClose === false ? null : "fechar";
```

No mesmo arquivo, `askAttendance` (B7) passa a aceitar a correção depois da mudança de etapa:

```ts
/** "Compareceu?" só depois do horário (antes, a pergunta não faz sentido). Já marcado (compareceu/faltou), continua para poder corrigir,
 * inclusive depois que a conversa foi para Atendida ou Aguardando cliente (Lote 1C). */
export function askAttendance(d: { stageKind: string; scheduledAt: string | Date | null; attendance: string | null }, now: number): boolean {
  if (d.attendance === "compareceu" || d.attendance === "faltou") return ["agendado", "atendido", "followup"].includes(d.stageKind);
  if (d.stageKind !== "agendado") return false;
  return !!d.scheduledAt && new Date(d.scheduledAt).getTime() <= now;
}
```

`src/components/queue/client-pane.tsx`: a linha do `AttendanceBar` (da B7) continua `{showAttendance && <AttendanceBar … />}`; não muda, porque a regra nova está em `askAttendance`.

`worker/index.ts`: importar `closeAttendedDeals` junto com `sweepAttempts` e, logo depois do bloco das tentativas:

```ts
    // Atendida há 3 dias vira Fechado (ganho).
    const ca = await closeAttendedDeals().catch((e) => { console.error("[atendidas]", e); return { closed: 0, errors: [] as string[] }; });
    if (ca.closed || ca.errors.length) console.log("[atendidas → fechado]", ca);
```

- [ ] **Passo 8: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/funnel-attended.test.ts src/server/domain/bulk.test.ts src/lib/primary-action.test.ts src/server/domain/conversation-archive.test.ts`
Esperado: PASS (inclusive o teste do `askAttendance` da B7).

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 9: Commit**

```bash
git add src/server/domain/tasks.ts src/server/domain/funnel.ts src/server/domain/updates.ts src/server/domain/conversation-archive.ts src/server/domain/deals.ts \
  src/lib/primary-action.ts src/lib/primary-action.test.ts worker/index.ts \
  src/server/domain/funnel-attended.test.ts src/server/domain/bulk.test.ts
git commit -m "feat(funil): Compareceu vai para Atendida (fecha sozinha em 3 dias), Faltou para Aguardando com Remarcar; cliente que escreve volta para Em conversa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C6: Motor: gatilho "Casa falou por último há X horas de expediente", ação "aguardar cliente" e "parado" com um aviso por conversa

**Arquivos:**
- Modificar: `src/server/rules/types.ts`
- Modificar: `src/server/rules/engine.ts` (candidatos e janela; ações; o texto fixo da B8 fica)
- Modificar: `src/server/db/seed-data.ts` (`casa_falou_4h`, `parado_etapa`)
- Modificar: `src/components/config/automations.tsx:20-38`, `:130`
- Testes: `src/server/rules/engine.test.ts`, `src/server/db/seed.test.ts`

**Interfaces:**
- Consome (C2): `moveToKindTx`.
- Produz:
  - gatilho `{ type: "casa_falou_por_ultimo_horas", hours: 1..72 }`;
  - ação `{ type: "aguardar_cliente" }`;
  - `mover_para_proximo_followup` passa a fazer o mesmo que `aguardar_cliente`, sem nunca ir para Follow-up 2–4;
  - janela do `parado_dias` = `etapa:<chave>:<entrada>`, um aviso por permanência na etapa;
  - seed: `casa_falou_4h` e `parado_etapa`, ligadas.

- [ ] **Passo 1: Testes**

Em `src/server/rules/engine.test.ts`:
- import: acrescentar `outbox` ao import do schema;
- substituir o teste "cliente sumiu…" e o "parado há mais de 1 dia gera aviso" por:

```ts
  it("Casa falou por último há 4 h de expediente: vai para Aguardando cliente com a tentativa 1 (nada é enviado)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    await runRules(min(1 + 4 * 60 - 2));
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(min(1 + 4 * 60 + 1));
    expect(await stageOf(id)).toBe("followup_1");
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.followupAttempt).toBe(1);
    expect(await db.select().from(outbox)).toHaveLength(0);
    await runRules(day(4)); // já aguardando: não repete nem pula etapa
    expect(await stageOf(id)).toBe("followup_1");
  });

  it("as 4 h contam só o expediente: resposta às 19h de terça vira Aguardando às 11h de quarta", async () => {
    const id = await lead("71999812266", new Date("2026-10-13T21:30:00Z"));
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: new Date("2026-10-13T22:00:00Z") });
    await runRules(new Date("2026-10-14T13:59:00Z"));
    expect(await stageOf(id)).toBe("atendimento");
    await runRules(new Date("2026-10-14T14:01:00Z"));
    expect(await stageOf(id)).toBe("followup_1");
  });

  it("cliente falou por último: fica em Em conversa (é a vez da Casa)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "qual dia?", at: min(1) });
    await recordInbound({ channelId: null, externalId: "x-cliente", phoneRaw: "71999812244", body: "quero sexta", at: min(2) });
    await runRules(day(2));
    expect(await stageOf(id)).toBe("atendimento");
  });

  it("'próximo follow-up' (legado) nunca leva para Follow-up 2: Aguardando cliente fica onde está", async () => {
    await db.update(automations).set({ enabled: true }).where(eq(automations.key, "followup_diario"));
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "oi", at: min(1) });
    await runRules(day(2));
    expect(await stageOf(id)).toBe("followup_1");
    await runRules(day(4));
    expect(await stageOf(id)).toBe("followup_1");
  });

  it("parado: um aviso só por conversa na etapa (nada de repetir todo dia)", async () => {
    const id = await lead();
    await recordOutbound({ dealId: id, channelId: null, body: "qual dia?", at: min(1) });
    await recordInbound({ channelId: null, externalId: "x-parado", phoneRaw: "71999812244", body: "quero sexta", at: min(2) });
    await runRules(day(3));
    await runRules(day(4));
    const parados = (await db.select().from(alerts)).filter((a) => a.type === "parado_dias");
    expect(parados).toHaveLength(1);
    expect(parados[0].message).toContain("Em conversa");
  });
```

Em `src/server/db/seed.test.ts`, linha 14: `toBe(10)` → `toBe(12)`.

Rodar: `npx vitest run src/server/rules/engine.test.ts src/server/db/seed.test.ts`
Esperado: FAIL.

- [ ] **Passo 2: Tipos (`rules/types.ts`)**

No `triggerSchema`, depois de `sem_retorno_cliente_dias`:

```ts
  /** A Casa respondeu e a cliente não voltou: X horas de EXPEDIENTE desde a última mensagem da Casa (Lote 1C). */
  z.object({ type: z.literal("casa_falou_por_ultimo_horas"), hours: z.number().int().min(1).max(72) }),
```

No `actionSchema`, depois de `mover_para_proximo_followup`:

```ts
  /** Aguardando cliente com as tentativas D+1, D+3, D+7 (tarefas com aviso; nunca mensagem). Só sai de Novo contato / Em conversa. */
  z.object({ type: z.literal("aguardar_cliente") }),
```

Nos rótulos:

```ts
  casa_falou_por_ultimo_horas: "A Casa falou por último há X horas de expediente",
```

```ts
  mover_para_proximo_followup: "Mover para Aguardando cliente (antigo 'próximo follow-up')",
  aguardar_cliente: "Marcar como aguardando cliente (tentativas D+1, D+3, D+7)",
```

- [ ] **Passo 3: Motor (`engine.ts`)**

- Import: `import { moveDealTx, moveToKindTx } from "../domain/deals";`.
- Em `candidatesFor`, novo `case`, antes de `aniversario_em_dias`:

```ts
    case "casa_falou_por_ultimo_horas":
      // A Casa falou por último e a cliente não voltou (a conta em horas de expediente é feita depois). Com lembrete para a frente, não age.
      q = sql`${base}, d.last_outbound_at as since ${from}
        where ${live} and d.closed_at is null and d.awaiting_reply_since is null and d.last_outbound_at is not null
          and (d.last_inbound_at is null or d.last_inbound_at < d.last_outbound_at)
          and d.last_outbound_at <= ${new Date(now.getTime() - trigger.hours * 3_600_000).toISOString()}::timestamptz
          and ${noFutureTask(now)}`;
      break;
```

- Depois do filtro de `sem_resposta_minutos`:

```ts
  if (trigger.type === "casa_falou_por_ultimo_horas") {
    // Horas de EXPEDIENTE: noite e dias com a Casa fechada não contam.
    rows = rows.filter((r) => businessMinutesBetween(new Date(r.since!).getTime(), now.getTime(), bh) >= trigger.hours * 60);
  }
```

- Janela (o bloco `if/else` do `windowKey`):

```ts
    // parado: um aviso por permanência na etapa (Lote 1C: nada de repetir todo dia)
    else if (trigger.type === "parado_dias") windowKey = `etapa:${r.stageKey}:${since!.toISOString()}`;
    else if (trigger.type === "sem_retorno_cliente_dias") windowKey = `silencio:${r.stageKey}:${since!.toISOString()}`;
    else if (trigger.type === "casa_falou_por_ultimo_horas") windowKey = `casa_ultima:${since!.toISOString()}`;
```

- Apagar `NEXT_FOLLOWUP` e trocar o `case "mover_para_proximo_followup"` por:

```ts
    case "aguardar_cliente":
    case "mover_para_proximo_followup": {
      // Follow-up 2 a 4 deixaram de existir (decisão de 15/10): os dois viram "aguardando cliente", com as tentativas como tarefas.
      // Só sai de Novo contato / Em conversa; quem já aguarda (ou está agendada, atendida…) fica.
      const [cur] = await tx.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, c.dealId));
      if (cur?.kind !== "lead" && cur?.kind !== "atendimento") return null;
      const moved = await moveToKindTx(tx, c.dealId, "followup", null, `automacao:${auto.key ?? auto.id}`, now);
      const [s] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.id, moved.stageId));
      ctx.stageName = s?.name ?? ctx.stageName;
      return "movido";
    }
```

Se `businessMinutesBetween` ainda não estiver importado de `../../lib/business-hours`, acrescente.

- [ ] **Passo 4: Seed das automações novas**

Em `src/server/db/seed-data.ts`, depois de `parado_1dia`:

```ts
  {
    // Lote 1C: substitui o followup_diario. Sem mensagem: a conversa passa a aguardar a cliente e as tentativas viram combinados.
    key: "casa_falou_4h", name: "Casa falou por último há 4 h de expediente: aguardando cliente", enabled: true,
    trigger: { type: "casa_falou_por_ultimo_horas", hours: 4 },
    conditions: [{ type: "etapa_em", stages: ["atendimento"] }],
    actions: [{ type: "aguardar_cliente" }],
  },
  {
    // Lote 1C: substitui o parado_1dia. Só Novo contato e Em conversa (Aguardando é controlado pelas tentativas); um aviso por conversa.
    key: "parado_etapa", name: "Conversa parada além do limite da etapa (um aviso por conversa)", enabled: true,
    trigger: { type: "parado_dias", days: 1, useStageLimit: true },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} está em {etapa} há {dias} dia(s) sem próximo passo. Agende, marque Aguardando cliente ou encerre." }],
  },
```

- [ ] **Passo 5: Tela de Automações (`automations.tsx`)**

```ts
const unitOf = (t: Trigger["type"]) => (t === "sem_resposta_minutos" ? "minutos" : t === "agendamento_em_horas" || t === "casa_falou_por_ultimo_horas" ? "horas" : t === "data_cobranca" || t === "data_recontato" ? null : "dias");
```

Em `describeTrigger`:

```ts
    case "casa_falou_por_ultimo_horas": return `a Casa falar por último e passar ${t.hours} h de expediente`;
```

Em `describeAction`, acrescentar antes do último `:`: `a.type === "aguardar_cliente" ? "marcar como aguardando cliente" :`. Trocar o texto de `mover_para_proximo_followup` por `"marcar como aguardando cliente"`.

Em `GROUPS`, trocar o grupo "Follow-up" por:

```ts
  { title: "Aguardando cliente", hint: "quando a bola está com a cliente", types: ["casa_falou_por_ultimo_horas", "sem_retorno_cliente_dias"], icon: "flow" },
```

Em `newAction` (linha 130): `type === "mover_para_proximo_followup" || type === "escalar_gestao" || type === "aguardar_cliente" ? { type }`.

No ícone da linha 70: incluir `t.type === "casa_falou_por_ultimo_horas"` junto com `sem_retorno_cliente_dias` (ícone `IconRefresh`).

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/rules src/server/db/seed.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde. Testes que gravam uma mensagem da Casa e rodam o motor dias depois podem ver a conversa ir para Aguardando cliente (`today.test.ts`, `queue.test.ts`, `resume-later.test.ts`). Se a expectativa era "continua em Atendimento", desligue `casa_falou_4h` no começo daquele teste:

```ts
await db.update(automations).set({ enabled: false }).where(eq(automations.key, "casa_falou_4h"));
```

O teste fica descrevendo só o que ele testa.

- [ ] **Passo 7: Commit**

```bash
git add src/server/rules/types.ts src/server/rules/engine.ts src/server/rules/engine.test.ts src/server/db/seed-data.ts src/server/db/seed.test.ts src/components/config/automations.tsx
git commit -m "feat(motor): Casa falou por último há 4 h de expediente vira Aguardando cliente; parado só uma vez por conversa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C7: `sweepOverdueWaits` não manda mais para Follow-up quando quem espera é a cliente

**Arquivos:**
- Modificar: `src/server/domain/overdue-waits.ts:11-41`
- Modificar: `worker/index.ts:53-54` (rótulo do log)
- Teste: `src/server/domain/overdue-waits.test.ts:25-68`

**Interfaces:**
- Consome (C2): `moveToKindTx`.
- Produz: `sweepOverdueWaits(now?): Promise<{ moved: number; cleared: number }>`. A assinatura não muda; a regra muda:
  - Novo contato e Em conversa com a cliente esperando: **nada muda** (continuam atrasadas);
  - Aguardando cliente ou Orçamento com a cliente esperando: voltam para Em conversa **mantendo a espera**;
  - Agendado: como antes.
  - Evento `espera_vencida`.

- [ ] **Passo 1: Reescrever os testes do `describe` "espera que passou do dia…"**

Substituir o bloco das linhas 25-69 por:

```ts
describe("espera vencida: quem espera é a CLIENTE, então a conversa nunca vai para Aguardando (Lote 1C)", () => {
  it("Em conversa com a cliente sem resposta desde ontem: continua em Em conversa e atrasada (espera e aviso ficam)", async () => {
    const d = await lead("atendimento", bahia(13, 15));
    await db.insert(alerts).values({ dealId: d.id, userId: ana, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `espera:${d.id}` });
    expect(await sweepOverdueWaits(NOW)).toEqual({ moved: 0, cleared: 0 });
    expect(await stageOf(d.id)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).not.toBeNull();
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, d.id), isNull(alerts.resolvedAt)))).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.dealId, d.id))).toHaveLength(0);
  });

  it("Novo contato com espera antiga também fica onde está", async () => {
    const d = await lead("lead", new Date(Date.UTC(2026, 8, 1, 12)));
    await sweepOverdueWaits(NOW);
    expect(await stageOf(d.id)).toBe("lead");
  });

  it("Aguardando cliente com a cliente esperando (sobra de antes da regra): volta já para Em conversa, mantendo a espera", async () => {
    const d = await lead("followup", bahia(14, 8));
    expect((await sweepOverdueWaits(NOW)).moved).toBe(1);
    expect(await stageOf(d.id)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).not.toBeNull();
  });

  it("agendada não perde o horário: só sai da espera, sem mudar de etapa", async () => {
    const d = await lead("agendado", bahia(13, 15));
    expect((await sweepOverdueWaits(NOW)).cleared).toBe(1);
    expect(await stageOf(d.id)).toBe("agendado");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).toBeNull();
  });
});
```

O helper `lead(kind, …)` faz `select … where kind` e pega a 1ª etapa. Para `followup` isso é `followup_1`, porque é a menor posição com o seed novo.

Rodar: `npx vitest run src/server/domain/overdue-waits.test.ts`
Esperado: FAIL (o 1º teste vê `moved: 1`).

- [ ] **Passo 2: Implementar**

Substituir o comentário e a função `sweepOverdueWaits`:

```ts
/**
 * Espera vencida (Lote 1C, decisão do dono): a CLIENTE escreveu e ninguém respondeu. Quem deve é a Casa, então:
 * - Novo contato / Em conversa: nada muda; continuam atrasadas, com a espera e os avisos (antes iam para Follow-up, o sentido invertido);
 * - Aguardando cliente / Orçamento enviado com a cliente esperando (sobra de antes da regra do recordInbound): voltam para
 *   Em conversa na hora, mantendo a espera;
 * - Agendado, espera de um dia que já passou: só sai da espera (não perde o horário).
 */
export async function sweepOverdueWaits(now = new Date()): Promise<{ moved: number; cleared: number }> {
  const today = sql`(${now.toISOString()}::timestamptz - ${sql.raw(OFFSET)})::date`;
  const rows = await db.select({ id: deals.id, kind: stages.kind })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), isNull(deals.conversationArchivedAt), isNotNull(deals.awaitingReplySince),
      or(inArray(stages.kind, ["followup", "proposta"]),
        and(eq(stages.kind, "agendado"), sql`(${deals.awaitingReplySince} - ${sql.raw(OFFSET)})::date < ${today}`))));
  let moved = 0, cleared = 0;
  for (const r of rows) {
    await db.transaction(async (tx) => {
      if (r.kind === "agendado") {
        await tx.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, r.id));
        await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
          .where(and(eq(alerts.dealId, r.id), isNull(alerts.resolvedAt)));
        cleared++;
        await logEvent(tx, r.id, "espera_vencida", { etapaAntes: r.kind, acao: "encerrada" });
      } else {
        await moveToKindTx(tx, r.id, "atendimento", null, "cliente_esperando", now);
        moved++;
        await logEvent(tx, r.id, "espera_vencida", { etapaAntes: r.kind, acao: "voltou_para_conversa" });
      }
    });
    await emit("lead_atualizado", { dealId: r.id });
  }
  return { moved, cleared };
}
```

Imports de `overdue-waits.ts`:
- `drizzle-orm`: trocar por `and, eq, gte, inArray, isNotNull, isNull, or, sql`;
- trocar `moveDealTx` por `moveToKindTx`;
- tirar `setNextActionTx` (sem uso).

Em `worker/index.ts`, trocar o rótulo `"[espera vencida → follow-up]"` por `"[espera vencida]"` e o comentário acima por `// Espera vencida: Aguardando/Orçamento com a cliente esperando volta para Em conversa; Agendado sai da espera.`

- [ ] **Passo 3: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/overdue-waits.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck`
Esperado: verde.

- [ ] **Passo 4: Commit**

```bash
git add src/server/domain/overdue-waits.ts src/server/domain/overdue-waits.test.ts worker/index.ts
git commit -m "fix(funil): espera vencida da cliente não manda mais para Follow-up; fica em Em conversa como atrasada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C8: Avec e Agenda movem o funil (só contatos com conversa nos últimos 30 dias)

**Arquivos:**
- Criar: `src/server/domain/avec/funnel-sync.ts`, `src/server/domain/avec/funnel-sync.test.ts`
- Modificar: `src/server/domain/avec/apply.ts:15-19` (comentário), `:22-29` (tipo), `:94-117` (`applyAvecFiles`)
- Modificar: `src/server/domain/appointments.ts:15-27`
- Modificar: `scripts/importar-avec.ts:35-43`
- Modificar: `src/components/relatorios-avec/format.ts` (`funnelLine`), `src/components/relatorios-avec/upload-button.tsx:71-84`, `src/app/api/relatorios/avec/route.ts:43-51`
- Teste: `src/components/relatorios-avec/format.test.ts`

**Interfaces:**
- Consome (C2/C5): `findOpenDeal`, `moveToKindTx`, `stageByKind`, `activeOwnerTx`, `enterAttendedTx`, `enterMissedTx`, `setAttendanceTx`, `replaceOpenTaskTx`, `nextDayMorning`, `clientFirstName` (de `src/lib/attempts.ts`).
- Produz:
  - `FUTURE_MAX_DAYS = 180`, `RECENT_CONVERSATION_DAYS = 30`;
  - `type FunnelSyncResult = { agendados: number; datasAtualizadas: number; atendidas: number; aguardando: number; cartoesNovos: number; erros: string[] }`;
  - `emptyFunnelSync(): FunnelSyncResult`;
  - `applyAppointmentTx(tx, deal: Deal, appt: Appointment, now: Date, reason: string): Promise<Deal>`;
  - `createScheduledDealTx(tx, contactId: string, appt: Appointment, now: Date): Promise<string>`;
  - `syncContactFunnelTx(tx, contactId, now): Promise<{ result: keyof Omit<FunnelSyncResult, "erros"> | null; dealId: string | null }>`;
  - `syncFunnelFromAgenda(opts?: { now?: Date; contactIds?: string[] }): Promise<FunnelSyncResult>`;
  - `applyAvecFiles(files, opts?: { now?: Date }): Promise<AvecBatchResult & { funil: FunnelSyncResult }>`;
  - `funnelLine(f?: FunnelSyncResult | null): string | null`.

- [ ] **Passo 1: Testes**

`src/server/domain/avec/funnel-sync.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments, contacts, deals, messages, stages, tasks } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { syncFunnelFromAgenda } from "./funnel-sync";
import { applyAvecFiles } from "./apply";
import { buildXlsx, readXlsx } from "./xlsx";
import { setAppointmentStatus } from "../appointments";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const DAY = 86_400_000;
const rel = (days: number) => new Date(NOW.getTime() + days * DAY);
let n = 0;

beforeEach(async () => { n = 0; await resetDb(); });

async function cliente(o: { conversaHa?: number | null; stage?: string | null; scheduledAt?: Date | null; phone?: string } = {}) {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente${n} Teste`, phoneE164: o.phone ?? `+5571977${String(n).padStart(6, "0")}` }).returning();
  let dealId: string | null = null;
  if (o.stage !== null) {
    const [st] = await db.select().from(stages).where(eq(stages.key, o.stage ?? "atendimento"));
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, scheduledAt: o.scheduledAt ?? null, stageEnteredAt: rel(-5), createdAt: rel(-5) }).returning();
    dealId = d.id;
  }
  if (o.conversaHa !== null) await db.insert(messages).values({ contactId: c.id, dealId, direction: "in", body: "oi", status: "received", createdAt: rel(-(o.conversaHa ?? 2)) });
  return { contactId: c.id, dealId };
}
const horario = async (contactId: string, startsAt: Date, status: string) =>
  (await db.insert(appointments).values({ contactId, serviceLabel: "Corte", startsAt, status, externalKey: `t:${contactId}:${startsAt.toISOString()}:${status}` }).returning())[0];
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

describe("Avec → funil", () => {
  it("horário futuro (até 180 dias) leva para Agendado com a data do mais próximo; liga o horário ao lead", async () => {
    const c = await cliente();
    const a = await horario(c.contactId, rel(3), "agendado");
    await horario(c.contactId, rel(10), "confirmado");
    const r = await syncFunnelFromAgenda({ now: NOW });
    expect(r).toMatchObject({ agendados: 1, erros: [] });
    expect(await stageOf(c.dealId!)).toBe("agendado");
    expect((await dealOf(c.dealId!)).scheduledAt?.toISOString()).toBe(a.startsAt.toISOString());
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].dealId).toBe(c.dealId);
    expect(await db.select().from(tasks).where(and(eq(tasks.dealId, c.dealId!), eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)))).toHaveLength(1);
    expect(await syncFunnelFromAgenda({ now: NOW })).toMatchObject({ agendados: 0, datasAtualizadas: 0 }); // idempotente
  });

  it("horário a mais de 180 dias (data absurda do Avec) não conta", async () => {
    const c = await cliente();
    await horario(c.contactId, rel(400), "agendado");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("atendimento");
  });

  it("decisão 4: sem conversa nos últimos 30 dias, não mexe", async () => {
    const c = await cliente({ conversaHa: 40 });
    await horario(c.contactId, rel(3), "agendado");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("atendimento");
  });

  it("decisão 4: sem conversa aberta, ganha cartão em Agendado só se conversou nos últimos 30 dias", async () => {
    const com = await cliente({ stage: null, conversaHa: 2 });
    const sem = await cliente({ stage: null, conversaHa: 45 });
    await horario(com.contactId, rel(3), "agendado");
    await horario(sem.contactId, rel(3), "agendado");
    expect((await syncFunnelFromAgenda({ now: NOW })).cartoesNovos).toBe(1);
    const [novo] = await db.select().from(deals).where(eq(deals.contactId, com.contactId));
    expect(await stageOf(novo.id)).toBe("agendado");
    expect(await db.select().from(deals).where(eq(deals.contactId, sem.contactId))).toHaveLength(0);
  });

  it("compareceu no horário do lead → Atendida, com o pós-atendimento (visita recente)", async () => {
    const c = await cliente({ stage: "agendado", scheduledAt: rel(-1) });
    await horario(c.contactId, rel(-1), "compareceu");
    expect((await syncFunnelFromAgenda({ now: NOW })).atendidas).toBe(1);
    expect(await stageOf(c.dealId!)).toBe("atendida");
    expect((await dealOf(c.dealId!)).attendance).toBe("compareceu");
    expect((await db.select().from(tasks).where(and(eq(tasks.dealId, c.dealId!), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))))[0].title).toMatch(/^Pós-atendimento/);
  });

  it("faltou → Aguardando cliente com Remarcar; cancelou (mesmo no futuro) → Aguardando, sem marcar falta", async () => {
    const f = await cliente({ stage: "agendado", scheduledAt: rel(-1) });
    await horario(f.contactId, rel(-1), "faltou");
    const k = await cliente({ stage: "agendado", scheduledAt: rel(2) });
    await horario(k.contactId, rel(2), "cancelado");
    expect((await syncFunnelFromAgenda({ now: NOW })).aguardando).toBe(2);
    expect(await stageOf(f.dealId!)).toBe("followup_1");
    expect((await dealOf(f.dealId!)).attendance).toBe("faltou");
    expect(await stageOf(k.dealId!)).toBe("followup_1");
    expect((await dealOf(k.dealId!)).attendance).toBeNull();
  });

  it("Agendado feito só no CRM não é derrubado por uma falta antiga de outro dia", async () => {
    const c = await cliente({ stage: "agendado", scheduledAt: rel(5) });
    await horario(c.contactId, rel(-10), "faltou");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("agendado");
  });

  it("applyAvecFiles devolve o que mudou no funil", async () => {
    const c = await cliente({ phone: "+5571988880001" });
    const rows = await readXlsx(await buildXlsx([
      ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
      ["01/10/2026 10:00", "20/10/2026", "09:30", "Cliente1 Teste", 71988880001, "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "", "", "", "Recepção"],
    ]));
    const r = await applyAvecFiles([{ fileName: "reservas.xlsx", rows }], { now: NOW });
    expect(r.funil).toMatchObject({ agendados: 1 });
    expect(await stageOf(c.dealId!)).toBe("agendado");
  });

  it("Compareceu marcado na Agenda move o funil da cliente", async () => {
    const now = new Date();
    const c = await cliente({ stage: "agendado", scheduledAt: new Date(now.getTime() - 3_600_000) });
    await db.update(messages).set({ createdAt: new Date(now.getTime() - DAY) }).where(eq(messages.contactId, c.contactId));
    const a = await horario(c.contactId, new Date(now.getTime() - 3_600_000), "agendado");
    await setAppointmentStatus(a.id, "compareceu", null);
    expect(await stageOf(c.dealId!)).toBe("atendida");
  });
});
```

Em `src/components/relatorios-avec/format.test.ts`, acrescentar `funnelLine` ao import e:

```ts
it("funnelLine: o que a importação mudou no funil, em uma frase", () => {
  expect(funnelLine(null)).toBeNull();
  expect(funnelLine({ agendados: 0, datasAtualizadas: 0, atendidas: 0, aguardando: 0, cartoesNovos: 0, erros: [] })).toBeNull();
  expect(funnelLine({ agendados: 2, datasAtualizadas: 1, atendidas: 1, aguardando: 0, cartoesNovos: 1, erros: [] }))
    .toBe("No funil: 2 foram para Agendado, 1 teve a data do horário atualizada, 1 foi para Atendida, 1 cartão novo em Agendado.");
});
```

Rodar: `npx vitest run src/server/domain/avec/funnel-sync.test.ts src/components/relatorios-avec/format.test.ts`
Esperado: FAIL.

- [ ] **Passo 2: `src/server/domain/avec/funnel-sync.ts`**

```ts
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, contacts, deals, messages, stages, type Appointment, type Deal } from "../../db/schema";
import { findOpenDeal, moveToKindTx, stageByKind } from "../deals";
import { emit, logEvent } from "../events";
import { nextDayMorning, replaceOpenTaskTx } from "../tasks";
import { activeOwnerTx } from "../attempts";
import { enterAttendedTx, enterMissedTx } from "../funnel";
import { setAttendanceTx } from "../updates";
import { clientFirstName } from "../../../lib/attempts";

/**
 * A agenda (Avec ou marcada na Agenda do CRM) move o funil da cliente (Lote 1C). Decisão 4 do dono: só para quem conversou nos
 * últimos 30 dias; quem não conversou aparece só na Agenda e na ficha. Nunca envia mensagem.
 * - horário futuro (até 180 dias) → Agendado, com a data do mais próximo (sem conversa aberta: cartão novo em Agendado);
 * - compareceu no horário do lead → Atendida; faltou ou cancelou o horário do lead → Aguardando cliente com Remarcar.
 */
export const FUTURE_MAX_DAYS = 180;
export const RECENT_CONVERSATION_DAYS = 30;
const DAY = 86_400_000;
const SAME_VISIT_MS = 12 * 3_600_000;
const OUTCOME_DAYS = 30;

export type FunnelSyncResult = { agendados: number; datasAtualizadas: number; atendidas: number; aguardando: number; cartoesNovos: number; erros: string[] };
type Counter = Exclude<keyof FunnelSyncResult, "erros">;
export const emptyFunnelSync = (): FunnelSyncResult => ({ agendados: 0, datasAtualizadas: 0, atendidas: 0, aguardando: 0, cartoesNovos: 0, erros: [] });

/** O horário vira a data do lead (profissional e serviço só preenchem o que está vazio), com a conferência de comparecimento, e o lead vai para Agendado. */
export async function applyAppointmentTx(tx: Tx, deal: Deal, appt: Appointment, now: Date, reason: string) {
  const changed = deal.scheduledAt?.getTime() !== appt.startsAt.getTime();
  await tx.update(deals).set({
    scheduledAt: appt.startsAt, professionalId: deal.professionalId ?? appt.professionalId, serviceId: deal.serviceId ?? appt.serviceId,
    ...(changed ? { attendance: null, attendanceAt: null } : {}), // horário novo: o Compareceu/Faltou do anterior não vale
  }).where(eq(deals.id, deal.id));
  await tx.update(appointments).set({ dealId: deal.id }).where(and(eq(appointments.id, appt.id), isNull(appointments.dealId)));
  if (changed) {
    const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, deal.contactId));
    await replaceOpenTaskTx(tx, deal.id, deal.contactId, "comparecimento",
      { title: `Conferir se ${clientFirstName(c?.name)} compareceu`, dueAt: nextDayMorning(appt.startsAt), assigneeId: await activeOwnerTx(tx, deal.ownerId) }, null);
    await logEvent(tx, deal.id, "campo_alterado", { campos: [{ campo: "scheduledAt", de: deal.scheduledAt?.toISOString() ?? null, para: appt.startsAt.toISOString() }], origem: "avec" });
  }
  return moveToKindTx(tx, deal.id, "agendado", null, reason, now);
}

/** Cartão novo em Agendado (contato sem conversa aberta). A dona é a da última conversa dela. */
export async function createScheduledDealTx(tx: Tx, contactId: string, appt: Appointment, now: Date): Promise<string> {
  const [last] = await tx.select({ ownerId: deals.ownerId, channelId: deals.channelId }).from(deals).where(eq(deals.contactId, contactId)).orderBy(desc(deals.createdAt)).limit(1);
  const stage = await stageByKind("agendado", tx);
  const [d] = await tx.insert(deals).values({ contactId, stageId: stage.id, ownerId: last?.ownerId ?? null, channelId: last?.channelId ?? null, origin: "Avec", stageEnteredAt: now, createdAt: now }).returning();
  await logEvent(tx, d.id, "lead_criado", { origin: "Avec", initialStage: stage.key, historico: false, avec: true });
  await applyAppointmentTx(tx, d, appt, now, "avec_horario");
  return d.id;
}

export async function syncContactFunnelTx(tx: Tx, contactId: string, now: Date): Promise<{ result: Counter | null; dealId: string | null }> {
  const [future] = await tx.select().from(appointments)
    .where(and(eq(appointments.contactId, contactId), inArray(appointments.status, ["agendado", "confirmado"]),
      gt(appointments.startsAt, now), lte(appointments.startsAt, new Date(now.getTime() + FUTURE_MAX_DAYS * DAY))))
    .orderBy(asc(appointments.startsAt)).limit(1);
  const deal = await findOpenDeal(contactId, tx);
  if (future) {
    if (!deal) return { result: "cartoesNovos", dealId: await createScheduledDealTx(tx, contactId, future, now) };
    const [st] = await tx.select({ kind: stages.kind }).from(stages).where(eq(stages.id, deal.stageId));
    if (st.kind === "agendado" && deal.scheduledAt?.getTime() === future.startsAt.getTime()) return { result: null, dealId: null };
    await applyAppointmentTx(tx, deal, future, now, "avec_horario");
    return { result: st.kind === "agendado" ? "datasAtualizadas" : "agendados", dealId: deal.id };
  }
  if (!deal) return { result: null, dealId: null };
  const [st] = await tx.select({ kind: stages.kind }).from(stages).where(eq(stages.id, deal.stageId));
  const sameVisit = (a: Appointment) => st.kind !== "agendado"
    ? a.startsAt.getTime() > deal.stageEnteredAt.getTime()
    : deal.scheduledAt ? Math.abs(a.startsAt.getTime() - deal.scheduledAt.getTime()) <= SAME_VISIT_MS : a.startsAt.getTime() >= deal.stageEnteredAt.getTime() - SAME_VISIT_MS;
  const since = new Date(now.getTime() - OUTCOME_DAYS * DAY);
  const visits = await tx.select().from(appointments).where(and(eq(appointments.contactId, contactId), eq(appointments.status, "compareceu"),
    gte(appointments.startsAt, since), lte(appointments.startsAt, now))).orderBy(desc(appointments.startsAt));
  const visit = visits.find(sameVisit);
  if (visit && st.kind !== "atendido") {
    await setAttendanceTx(tx, deal.id, "compareceu", null);
    await tx.update(deals).set({ attendanceAt: visit.startsAt }).where(eq(deals.id, deal.id));
    await enterAttendedTx(tx, deal.id, null, "avec_compareceu", now, { visitAt: visit.startsAt });
    return { result: "atendidas", dealId: deal.id };
  }
  if (st.kind !== "agendado") return { result: null, dealId: null };
  const misses = await tx.select().from(appointments).where(and(eq(appointments.contactId, contactId), inArray(appointments.status, ["faltou", "cancelado"]),
    gte(appointments.startsAt, since), lte(appointments.startsAt, new Date(now.getTime() + FUTURE_MAX_DAYS * DAY)))).orderBy(desc(appointments.startsAt));
  const miss = misses.find(sameVisit);
  if (!miss) return { result: null, dealId: null };
  if (miss.status === "faltou") await setAttendanceTx(tx, deal.id, "faltou", null);
  else await replaceOpenTaskTx(tx, deal.id, deal.contactId, "comparecimento", null, null); // cancelou: não há o que conferir
  await enterMissedTx(tx, deal.id, null, "avec_faltou", now);
  return { result: "aguardando", dealId: deal.id };
}

/** Roda a regra para quem conversou nos últimos 30 dias (ou só para `contactIds`). Uma transação por cliente; um erro não para as outras. */
export async function syncFunnelFromAgenda(opts: { now?: Date; contactIds?: string[] } = {}): Promise<FunnelSyncResult> {
  const now = opts.now ?? new Date();
  const out = emptyFunnelSync();
  if (opts.contactIds && !opts.contactIds.length) return out;
  const since = new Date(now.getTime() - RECENT_CONVERSATION_DAYS * DAY);
  const ids = (await db.selectDistinct({ id: messages.contactId }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(gte(messages.createdAt, since), eq(contacts.ignored, false), opts.contactIds ? inArray(messages.contactId, opts.contactIds) : undefined))).map((r) => r.id);
  for (const contactId of ids) {
    try {
      const r = await db.transaction((tx) => syncContactFunnelTx(tx, contactId, now));
      if (r.result) { out[r.result]++; if (r.dealId) await emit("etapa_alterada", { dealId: r.dealId }); }
    } catch (e) { out.erros.push(`${contactId}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
```

- [ ] **Passo 3: `apply.ts`**

- Comentário das linhas 15-19: trocar "Não mexe em leads/etapas/Fila e não envia nada no WhatsApp." por "Depois do lote, a agenda move o funil de quem conversou nos últimos 30 dias (`syncFunnelFromAgenda`). Não envia nada no WhatsApp."
- Imports: `import { emptyFunnelSync, syncFunnelFromAgenda, type FunnelSyncResult } from "./funnel-sync";`.
- Tipo: `export type AvecBatchResult = { files: AvecFileResult[]; summary: AvecSummary; funil?: FunnelSyncResult };`.
- `applyAvecFiles`:

```ts
export async function applyAvecFiles(files: AvecFileInput[], opts: { now?: Date } = {}): Promise<AvecBatchResult & { funil: FunnelSyncResult }> {
```

  e trocar o `return { files: results, summary };` por:

```ts
  // A agenda que entrou move o funil (decisão 4: só de quem conversou nos últimos 30 dias). Falhar aqui não desfaz a importação.
  const funil = await syncFunnelFromAgenda({ now: opts.now }).catch((e) => ({ ...emptyFunnelSync(), erros: [e instanceof Error ? e.message : String(e)] }));
  return { files: results, summary, funil };
```

- [ ] **Passo 4: Agenda (`appointments.ts`)**

Substituir `setAppointmentStatus`:

```ts
import { syncFunnelFromAgenda } from "./avec/funnel-sync";

/**
 * Muda a situação de um agendamento da agenda (Avec ou da Casa), com auditoria de/para. Repetir o mesmo valor não faz nada.
 * Pedido da lista de espera não passa por aqui (ainda não é horário). Depois, o funil da cliente acompanha (Compareceu → Atendida,
 * Faltou/Cancelado → Aguardando), como na importação do Avec. Nunca manda nada no WhatsApp.
 */
export async function setAppointmentStatus(id: string, status: AppointmentMark, userId: string | null): Promise<{ changed: boolean }> {
  const value = z.enum(APPOINTMENT_MARKS).parse(status);
  const r = await db.transaction(async (tx) => {
    const [a] = await tx.select({ status: appointments.status, contactId: appointments.contactId }).from(appointments).where(eq(appointments.id, z.string().uuid().parse(id))).for("update");
    if (!a) throw new UserFacingError("Horário não encontrado.");
    if (a.status === "espera") throw new UserFacingError("Esse pedido está na lista de espera: marque um horário antes.");
    if (a.status === value) return { changed: false, contactId: a.contactId };
    await tx.update(appointments).set({ status: value, updatedAt: new Date() }).where(eq(appointments.id, id));
    await tx.insert(auditLog).values({ userId, action: "agendamento_situacao", entity: "appointment", entityId: id, data: { de: a.status, para: value } });
    return { changed: true, contactId: a.contactId };
  });
  if (r.changed && r.contactId) await syncFunnelFromAgenda({ contactIds: [r.contactId] }).catch((e) => console.error("[agenda → funil]", e));
  return { changed: r.changed };
}
```

- [ ] **Passo 5: Texto da tela e do script**

Em `src/components/relatorios-avec/format.ts`, depois de `summaryLines`:

```ts
import type { FunnelSyncResult } from "@/server/domain/avec/funnel-sync";

/** O que a importação mudou no funil, em uma frase (null quando nada mudou). */
export function funnelLine(f: FunnelSyncResult | null | undefined): string | null {
  if (!f) return null;
  const n = (v: number, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null);
  const parts = [
    n(f.agendados, "foi para Agendado", "foram para Agendado"),
    n(f.datasAtualizadas, "teve a data do horário atualizada", "tiveram a data do horário atualizada"),
    n(f.atendidas, "foi para Atendida", "foram para Atendida"),
    n(f.aguardando, "foi para Aguardando cliente (faltou ou cancelou)", "foram para Aguardando cliente (faltaram ou cancelaram)"),
    n(f.cartoesNovos, "cartão novo em Agendado", "cartões novos em Agendado"),
  ].filter(Boolean);
  return parts.length ? `No funil: ${parts.join(", ")}.` : null;
}
```

A forma singular sem número no texto ("1 foi…") é a esperada no teste.

Em `format.ts`, o tipo `AvecUploadResult` ganha `funil?: FunnelSyncResult`.

Em `src/app/api/relatorios/avec/route.ts`:
- o lote vazio: `{ files: [], summary: emptySummary(), funil: undefined }`;
- em `result`, acrescentar `funil: batch.funil`.

Em `upload-button.tsx`, logo depois do bloco `{lines.length ? (...) : (...)}`:

```tsx
            {funnelLine(result.funil) && <p className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{funnelLine(result.funil)}</p>}
```

Acrescentar `funnelLine` ao import de `./format`.

Em `scripts/importar-avec.ts`, depois de `console.log(\`\nTotal …\`)`:

```ts
  const f = res.funil;
  console.log(`Funil (só quem conversou nos últimos 30 dias): ${f.agendados} → Agendado, ${f.datasAtualizadas} datas atualizadas, ${f.atendidas} → Atendida, ${f.aguardando} → Aguardando, ${f.cartoesNovos} cartões novos${f.erros.length ? `, ${f.erros.length} erro(s)` : ""}`);
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/avec src/components/relatorios-avec src/server/domain/appointments.test.ts`
Esperado: PASS. O teste antigo "importar não mexe em leads" continua: lá não há mensagens, então nada entra na regra.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 7: Commit**

```bash
git add src/server/domain/avec/funnel-sync.ts src/server/domain/avec/funnel-sync.test.ts src/server/domain/avec/apply.ts src/server/domain/appointments.ts \
  scripts/importar-avec.ts src/components/relatorios-avec/format.ts src/components/relatorios-avec/format.test.ts src/components/relatorios-avec/upload-button.tsx \
  src/app/api/relatorios/avec/route.ts
git commit -m "feat(funil): Avec e Agenda movem o funil (horário futuro → Agendado, compareceu → Atendida, faltou/cancelou → Aguardando), só com conversa nos últimos 30 dias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C9: Quadro e Jornada sem conversas encerradas, selo de tentativa e de pacote, colunas pelo tipo

**Arquivos:**
- Modificar: `src/server/queries/board.ts` (tipo `BoardCard`, `boardConds` e o `map` dos cards que a A6 já mexeu)
- Modificar: `src/server/queries/journey.ts:23-32`, `:67`, `:83-88`
- Modificar: `src/server/queries/queue.ts` (`queueStageLabel` e as opções do em massa)
- Modificar: `src/server/domain/bulk.ts:14`
- Modificar: `src/components/pipeline/board.tsx:23-34`, `:128-153`; `src/components/pipeline/deal-card.tsx` (a linha do selo de Follow-up); `src/components/queue/stage-path.tsx:15-18`
- Modificar: `src/lib/alert-copy.ts` (ajuda: selos de tentativa e de pacote), `src/lib/alert-copy.test.ts`
- Testes: `src/server/queries/board.test.ts`, `src/server/queries/journey.test.ts`, `src/server/queries/queue.test.ts` (o teste do `queueStageLabel`)

**Interfaces:**
- Consome (C1/C2): colunas de tentativa, `attemptLabel`. Da A6: o `map` dos cards com `lastReplyById`/`lastReplyName`. Do 1B: `helpCatalog`.
- Produz:
  - `BoardCard` ganha `followupAttempt: number` e `pkg: { used: number; total: number } | null`;
  - `boardConds` deixa fora as conversas encerradas de lead aberto;
  - `BULK_STAGE_KINDS = ["lead", "atendimento", "followup", "proposta", "retorno"]`;
  - entradas de ajuda `linha-tentativa` e `linha-pacote` em `/ajuda/avisos`.

- [ ] **Passo 1: Testes**

Em `src/server/queries/board.test.ts`:
- import: acrescentar `clientPackages` ao import do schema;
- no fim do arquivo:

```ts
describe("getBoard: Lote 1C", () => {
  beforeEach(resetDb);
  const mk = async (n: number) => { const r = await recordInbound({ channelId: null, externalId: `E${n}`, phoneRaw: `7199977100${n}`, pushName: `Cli ${n}`, body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };

  it("conversa encerrada sai do Quadro enquanto o lead está aberto; Fechado com conversa encerrada continua na coluna", async () => {
    const encerrada = await mk(1), fechada = await mk(2), aberta = await mk(3);
    await db.update(deals).set({ conversationArchivedAt: new Date() }).where(eq(deals.id, encerrada));
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    await db.update(deals).set({ conversationArchivedAt: new Date(), stageId: fechado.id, closedAt: new Date() }).where(eq(deals.id, fechada));
    const b = await getBoard({});
    expect(ids(b)).not.toContain(encerrada);
    expect(ids(b)).toContain(aberta);
    expect(b.find((s) => s.kind === "fechado")!.cards.map((c) => c.id)).toEqual([fechada]);
  });

  it("card traz a tentativa e o pacote ativo (esgotado não conta)", async () => {
    const id = await mk(4);
    const [fu] = await db.select().from(stages).where(eq(stages.key, "followup_1"));
    await db.update(deals).set({ stageId: fu.id, followupAttempt: 2 }).where(eq(deals.id, id));
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    await db.insert(clientPackages).values([
      { contactId: d.contactId, packageName: "Hidratação 10x", totalSessions: 10, usedSessions: 3, externalKey: "t:pk1" },
      { contactId: d.contactId, packageName: "Antigo", totalSessions: 4, usedSessions: 4, externalKey: "t:pk2" },
    ]);
    const card = (await getBoard({})).flatMap((s) => s.cards).find((c) => c.id === id)!;
    expect(card.followupAttempt).toBe(2);
    expect(card.pkg).toEqual({ used: 3, total: 10 });
  });
});
```

Em `src/server/queries/journey.test.ts`, no teste "as estações seguem a ordem…", acrescentar:

```ts
    expect(j.stations.find((s) => s.key === "followup")!.name).toBe("Aguardando cliente");
```

E um teste novo:

```ts
  it("conversa encerrada não conta na Jornada (mesma regra do Quadro)", async () => {
    const d = await mk("atendimento");
    await mk("atendimento");
    await db.update(deals).set({ conversationArchivedAt: new Date() }).where(eq(deals.id, d.id));
    expect((await getJourney()).stations.find((s) => s.key === "atendimento")!.count).toBe(1);
  });
```

Em `src/server/queries/queue.test.ts`, no teste do `queueStageLabel`: `expect(await queueStageLabel("followup")).toBe("Aguardando cliente");`.

Em `src/lib/alert-copy.test.ts`, dentro do `describe("ajuda e sino")`:

```ts
  it("a ajuda explica os selos do funil novo (tentativa e pacote)", () => {
    const ids = helpCatalog().flatMap((g) => g.entries.map((e) => e.id));
    expect(ids).toEqual(expect.arrayContaining(["linha-tentativa", "linha-pacote"]));
  });
```

Rodar: `npx vitest run src/server/queries/board.test.ts src/server/queries/journey.test.ts src/server/queries/queue.test.ts src/lib/alert-copy.test.ts`
Esperado: FAIL.

- [ ] **Passo 2: `board.ts`**

- Imports: acrescentar `clientPackages` ao import do schema.
- Tipo `BoardCard`, acrescentar:

```ts
  /** Aguardando cliente / Orçamento: em que tentativa está (0 = nenhuma). */ followupAttempt: number;
  /** Pacote ativo da cliente (selo "Pacote 3/10"; o pacote não é etapa). */ pkg: { used: number; total: number } | null;
```

- Em `boardConds`:

```ts
  const conds: SQL[] = [or(isNull(deals.closedAt), gte(deals.closedAt, since))!, isNull(deals.archivedAt), eq(contacts.ignored, false),
    // Conversa encerrada (Encerrar conversa) sai do Quadro e da Jornada enquanto o lead está aberto; fechados e perdidos seguem na coluna deles.
    or(isNotNull(deals.closedAt), isNull(deals.conversationArchivedAt))!];
```

  E atualizar o comentário de `boardConds`: "…sem arquivados, sem contato ignorado e sem conversa encerrada de lead aberto…". Se `isNotNull` não estiver no import de `drizzle-orm`, acrescente.
- No `select` de `getBoard`, acrescentar `followupAttempt: deals.followupAttempt, pkgUsed: sql<number | null>\`pk.used\`, pkgTotal: sql<number | null>\`pk.total\``. Depois do `leftJoin` do `lm`:

```ts
    .leftJoin(sql`lateral (select p.used_sessions as used, p.total_sessions as total from ${clientPackages} p
      where p.contact_id = ${deals.contactId} and p.used_sessions < p.total_sessions
        and (p.valid_until is null or p.valid_until >= (now() at time zone 'America/Bahia')::date)
      order by p.valid_until asc nulls last limit 1) pk`, sql`true`)
```

- No `map` dos cards (o da A6), trocar a desestruturação `const { lastReplyById, lastReplyName, ...rest } = r;` por:

```ts
        const { lastReplyById, lastReplyName, pkgUsed, pkgTotal, ...rest } = r;
```

  e acrescentar no objeto devolvido, logo depois de `repliedByName: …,`:

```ts
          pkg: pkgUsed != null && pkgTotal != null ? { used: pkgUsed, total: pkgTotal } : null,
```

- [ ] **Passo 3: Jornada e Fila**

`journey.ts`:
- linha 23 (comentário): "Chave da etapa (`etapa=` da Fila). As etapas do tipo Aguardando cliente formam uma estação só: "followup".";
- linha 31: "A chave da estação de uma etapa: o tipo Aguardando cliente vira "followup" (como a coluna do Quadro).";
- trocar `name: s.kind === "followup" ? "Follow-up" : s.name` por `name: s.name`.

`queue.ts`:
- comentário acima de `queueStageLabel`: "`etapa=followup` (a estação "Aguardando cliente" da Jornada) é a etapa desse tipo, como a coluna do Quadro.";
- substituir a linha `if (etapa === FOLLOWUP_STATION) return "Follow-up";` por:

```ts
  if (etapa === FOLLOWUP_STATION) {
    const [s] = await db.select({ name: stages.name }).from(stages).where(and(eq(stages.kind, "followup"), eq(stages.active, true))).orderBy(asc(stages.position)).limit(1);
    return s?.name ?? "Aguardando cliente";
  }
```

- nas opções do em massa: `inArray(stages.kind, ["lead", "atendimento", "followup", "proposta", "retorno"])`.

`bulk.ts:14`: `export const BULK_STAGE_KINDS = ["lead", "atendimento", "followup", "proposta", "retorno"] as const;`.

- [ ] **Passo 4: Telas do Quadro**

`board.tsx`:
- linha 24: `/** Id da coluna que junta as etapas do tipo Aguardando cliente (hoje uma só; Follow-up 2 a 4 estão desativados). */`;
- em `toColumns`, trocar `out.push({ ...fus[0], id: FOLLOWUP_COLUMN, key: "followup_1", name: "Follow-up", virtual: true,` por `out.push({ ...fus[0], id: FOLLOWUP_COLUMN, virtual: true,`;
- linha 129: `const to = toId === FOLLOWUP_COLUMN ? board.find((s) => s.kind === "followup") : board.find((s) => s.id === toId);`;
- linhas 140 e 153: trocar `f.stage.kind === "followup" ? "Follow-up" : f.stage.name` por `f.stage.name`.

`deal-card.tsx`:
- import: `import { attemptLabel } from "@/lib/attempts";`;
- substituir a linha do selo de Follow-up (ache com `grep -n "followup" src/components/pipeline/deal-card.tsx`) por:

```tsx
          {(stageKind === "followup" || stageKind === "proposta") && attemptLabel(card.followupAttempt) && (
            <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-[10.5px] font-semibold grid place-items-center whitespace-nowrap">{attemptLabel(card.followupAttempt)}</span>
          )}
          {card.pkg && <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-[10.5px] font-semibold grid place-items-center whitespace-nowrap">Pacote {card.pkg.used}/{card.pkg.total}</span>}
```

O prefixo "Cati:", o "respondida por" (A6) e o `alert` do relógio (B3) ficam como estão.

`stage-path.tsx:18`: trocar `label: s.key === currentKey ? s.name : "Follow-up"` por `label: s.name`. Comentário da linha 11: "As etapas na ordem da configuração; as do tipo Aguardando cliente formam um passo só."

- [ ] **Passo 5: Ajuda dos selos (`src/lib/alert-copy.ts`)**

No `helpCatalog()`, grupo `linha`, logo depois da entrada `linha-parado`:

```ts
      { id: "linha-tentativa", title: "Tentativa 1/3", text: "A Casa está retomando uma cliente que não respondeu: até 3 tentativas (amanhã, em 3 e em 7 dias; depois de um orçamento, em 2, 4 e 8 dias), cada uma em Combinados no dia. Conta quando alguém da Casa escreve no dia ou conclui o combinado. Depois da 3ª, se ela não responder em 2 dias, a conversa vai para Perdido (Não respondeu mais). Nada é enviado sozinho." },
      { id: "linha-pacote", title: "Pacote 3/10", text: "A cliente tem um pacote ativo no Avec: sessões usadas do total. O pacote não é etapa do funil." },
```

- [ ] **Passo 6: Rodar e ver passar**

Rodar: `npx vitest run src/server/queries src/lib/alert-copy.test.ts`
Esperado: PASS.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

Conferência na tela (`npm run dev`, banco de desenvolvimento, navegador headless em segundo plano, sem foco):
- o Quadro mostra 9 colunas na ordem nova;
- o card em Aguardando mostra "Tentativa 1/3";
- uma conversa encerrada some do Quadro;
- `/ajuda/avisos` tem "Tentativa 1/3" e "Pacote 3/10".

**Nunca** abrir conversa de número real.

- [ ] **Passo 7: Commit**

```bash
git add src/server/queries/board.ts src/server/queries/journey.ts src/server/queries/queue.ts src/server/domain/bulk.ts \
  src/components/pipeline/board.tsx src/components/pipeline/deal-card.tsx src/components/queue/stage-path.tsx src/lib/alert-copy.ts src/lib/alert-copy.test.ts \
  src/server/queries/board.test.ts src/server/queries/journey.test.ts src/server/queries/queue.test.ts
git commit -m "feat(quadro): sem conversas encerradas, selo de tentativa e de pacote, colunas pelo tipo da etapa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C10: Trocar as chaves de etapa escritas à mão pelo tipo (servidor, telas, relatórios e histórico)

**Arquivos:**
- Criar: `src/lib/stage-kinds.ts`, `src/server/stage-keys.test.ts`
- Modificar (os números são de antes dos lotes; ache cada um com o `grep` do Passo 1):
  - `src/server/domain/updates.ts` (as chamadas com `"agendado"`, `"perdido"`, `"atendimento"` e `"fechado"`);
  - `src/server/domain/start-conversation.ts:41`;
  - `src/server/domain/deals.ts` (`stageByKey("lead")` em `recordInbound` e na criação pela Casa dentro de `recordOutbound` da A3; o `moveDealTx(… "atendimento" …)` no fim de `recordOutbound`; o `stageByKey(lastOut ? …)` de `importHistoryChat`);
  - `src/server/queries/today.ts:54`, `:76-77`;
  - `src/server/reports/common.ts:65`;
  - `src/server/reports/queries.ts:40`, `:95`;
  - `src/server/reports/team.ts:36`;
  - `src/components/queue/pane-header.tsx:73-91`;
  - `src/components/lead/lead-sheet.tsx:251-253`;
  - `src/lib/history.ts` (`etapa_alterada` e os casos novos)
- Teste: `src/lib/history.test.ts`

**Interfaces:**
- Consome (C1/C2): `stageByKind`, `moveToKindTx`.
- Produz:
  - `SCHEDULABLE_KINDS: readonly string[]`, `CLOSED_STAGE_KINDS`, `isSchedulable(kind)`, `keyOfKind(stages: { key: string; kind: string }[], kind: string): string | null` (em `src/lib/stage-kinds.ts`);
  - textos do histórico para os motivos e eventos novos.

- [ ] **Passo 1: Teste de guarda e de histórico**

Antes, liste o que a guarda vai pegar: `grep -rnE '(stageByKey|moveDealTx|moveDeal)\([^)]*"(lead|atendimento|agendado|followup_[1-4]|fechado|perdido)"|"followup_[1-4]"' src/server | grep -v '\.test\.ts'`. Hoje (antes dos lotes) a lista é: `rules/engine.ts:125` (sai na C6), `rules/templates.ts` (permitido), `domain/resume-later.ts` (sai na C3), `db/seed-data.ts` (permitido), `domain/start-conversation.ts:41`, `domain/updates.ts:152,173,189,228`, `domain/overdue-waits.ts:30` (sai na C7) e `domain/deals.ts:152,189,248,306,377`.

`src/server/stage-keys.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * Lote 1C: o servidor decide pela ETAPA (tipo), nunca pela chave escrita à mão. Só o seed, a migração do funil e os modelos
 * de automação (configuráveis pela gestão) citam chaves.
 */
const ROOT = __dirname;
const ALLOWED = new Set(["db/seed-data.ts", "domain/funnel-migration.ts", "rules/templates.ts"]);
const KEY_CALL = /\b(stageByKey|moveDealTx|moveDeal)\([^)]*["'](lead|atendimento|agendado|followup_[1-4]|orcamento|atendida|retorno|fechado|perdido)["']/;
const FOLLOWUP_KEY = /["']followup_[1-4]["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

it("nenhum código de servidor busca ou move etapa pela chave escrita à mão", () => {
  const bad = files(ROOT).map((f) => path.relative(ROOT, f)).filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => { const src = readFileSync(path.join(ROOT, rel), "utf8"); return KEY_CALL.test(src) || FOLLOWUP_KEY.test(src); });
  expect(bad).toEqual([]);
});
```

Em `src/lib/history.test.ts`, acrescentar:

```ts
it("funil novo: motivos e passos em português (nunca o código)", () => {
  const es = historyEntries([
    ev("1", "etapa_alterada", { de: "atendimento", para: "followup_1", motivo: "automacao:casa_falou_4h" }, "2026-10-13T17:00:00Z"),
    ev("2", "etapa_alterada", { de: "agendado", para: "atendida", motivo: "avec_compareceu" }, "2026-10-13T17:01:00Z"),
    ev("3", "etapa_alterada", { de: "followup_1", para: "perdido", motivo: "nao_respondeu" }, "2026-10-13T17:02:00Z"),
    ev("4", "tentativa", { feita: 2, por: "mensagem" }, "2026-10-13T17:03:00Z"),
    ev("5", "aguardando_cliente", { automatico: true }, "2026-10-13T17:04:00Z"),
    ev("6", "orcamento_enviado", {}, "2026-10-13T17:05:00Z"),
  ], { ...lookup, stages: { followup_1: "Aguardando cliente", atendida: "Atendida", perdido: "Perdido" } });
  expect(es.map((e) => e.text)).toEqual([
    "Orçamento enviado",
    "Marcado como aguardando cliente (tentativas automáticas)",
    "Tentativa 2 de 3 feita (mensagem da Casa)",
    "Movido para Perdido (3 tentativas sem resposta)",
    "Movido para Atendida (compareceu, pelo Avec)",
    "Movido para Aguardando cliente (automático)",
  ]);
});
```

Rodar: `npx vitest run src/server/stage-keys.test.ts src/lib/history.test.ts`
Esperado: FAIL. A lista de "bad" deve citar no mínimo `domain/updates.ts`, `domain/deals.ts` e `domain/start-conversation.ts`; e o histórico mostra "Outro registro do sistema" (o padrão da B12) no lugar de "tentativa".

- [ ] **Passo 2: Servidor pelo tipo**

`src/server/domain/updates.ts`:
- import: `import { findOpenDeal, moveToKindTx, stageByKind } from "./deals";` (tirar `stageByKey` e `moveDealTx` se ficarem sem uso);
- `await moveDealTx(tx, dealId, "agendado", userId, "manual");` → `await moveToKindTx(tx, dealId, "agendado", userId, "manual");`;
- `await moveDealTx(tx, dealId, "perdido", userId, "manual");` → `await moveToKindTx(tx, dealId, "perdido", userId, "manual");`;
- `const lead = await stageByKey("atendimento", tx);` → `const lead = await stageByKind("atendimento", tx);`;
- `await moveDealTx(tx, dealId, "fechado", userId, "venda", now);` → `await moveToKindTx(tx, dealId, "fechado", userId, "venda", now);`.

`src/server/domain/start-conversation.ts:41`: `const stage = await stageByKind("atendimento", tx);` (import de `stageByKind`).

`src/server/domain/deals.ts`:
- em `recordInbound`: `const lead = await stageByKind("lead", tx);`;
- em `recordOutbound` (A3), na criação da conversa pela Casa: `const lead = await stageByKind("lead", tx);`;
- no fim de `recordOutbound`: `if (stage?.kind === "lead") await moveToKindTx(tx, dealId, "atendimento", input.userId ?? null, "respondido", at);`;
- em `importHistoryChat`: `const stage = await stageByKind(lastOut ? "atendimento" : "lead", tx);`.

`src/server/queries/today.ts`:
- linha 54: `q(sql\`d.closed_at is null and s.kind in ('followup', 'proposta')\`, …)`;
- linhas 76-77: trocar as duas ocorrências de `(select sla_minutes from stages where key = 'lead')` por `(select sla_minutes from stages where kind = 'lead' and active order by position limit 1)`.

`src/server/reports/common.ts:65`:

```ts
export const SLA_FALLBACK_SECONDS = sql`coalesce((select nullif(sla_minutes, 0) * 60 from stages where kind = 'lead' and active order by position limit 1), 120)`;
```

`src/server/reports/queries.ts`:
- linha 40: `r.kind in ('agendado', 'atendido', 'fechado')` (Atendida passou por Agendado ou foi atendida: chegou ao marco);
- linha 95: `r.kind in ('atendimento', 'agendado', 'followup', 'proposta', 'atendido', 'retorno', 'fechado')`.

`src/server/reports/team.ts:36`: `s.kind in ('agendado', 'atendido', 'fechado')`.

- [ ] **Passo 3: Telas pelo tipo**

`src/lib/stage-kinds.ts`:

```ts
/** Tipos de etapa para as telas (o navegador não lê o banco): decidir pelo tipo, nunca pela chave. */
export const CLOSED_STAGE_KINDS = ["fechado", "perdido"] as const;
/** Etapas de onde se agenda (Agendar abre a folha de data e hora). */
export const SCHEDULABLE_KINDS = ["lead", "atendimento", "followup", "proposta", "retorno", "atendido"] as const;
export const isSchedulable = (kind: string | null | undefined) => (SCHEDULABLE_KINDS as readonly string[]).includes(kind ?? "");
/** A chave da etapa de um tipo (a 1ª da lista, que já vem na ordem e só com as ativas). */
export const keyOfKind = (stages: readonly { key: string; kind: string }[], kind: string): string | null => stages.find((s) => s.kind === kind)?.key ?? null;
```

`src/components/queue/pane-header.tsx`:
- import: `import { isSchedulable } from "@/lib/stage-kinds";`;
- `const canSchedule = isSchedulable(kind);`;
- `const canClose = kind === "agendado" || kind === "atendido";`;
- na lista do menu de etapas, trocar `s.key === "agendado"`, `s.key === "fechado"` e `s.key === "perdido"` por `s.kind === "agendado"`, `s.kind === "fechado"` e `s.kind === "perdido"`. O item "Encerrar conversa" (B5) fica.

`src/components/lead/lead-sheet.tsx`:
- import: `import { isSchedulable, keyOfKind } from "@/lib/stage-kinds";`;
- botão Agendar: condição `isSchedulable(d.stage.kind)` e `onClick={() => moveTo(keyOfKind(d.stages, "agendado") ?? d.stage.key)}`;
- botão Fechar: condição `(d.stage.kind === "agendado" || d.stage.kind === "atendido")` e `onClick={() => moveTo(keyOfKind(d.stages, "fechado") ?? d.stage.key)}`;
- botão Perdido: `onClick={() => moveTo(keyOfKind(d.stages, "perdido") ?? d.stage.key)}`.

- [ ] **Passo 4: Histórico em português (`src/lib/history.ts`)**

Antes de `lines`:

```ts
/** Por que a conversa mudou de etapa (motivos do funil do Lote 1C e os antigos). Motivo desconhecido: sem parêntese, nunca o código. */
const MOTIVO: Record<string, string> = {
  respondido: " (respondido)", cliente_respondeu: " (cliente respondeu)", cliente_esperando: " (a cliente está esperando resposta)",
  aguardando_cliente: " (marcado como aguardando cliente)", orcamento_enviado: " (orçamento enviado)",
  compareceu: " (compareceu)", faltou: " (faltou: remarcar)", nao_respondeu: " (3 tentativas sem resposta)",
  atendida_3_dias: " (3 dias depois do atendimento)", conversa_encerrada: " (conversa encerrada)",
  avec_horario: " (horário no Avec)", avec_compareceu: " (compareceu, pelo Avec)", avec_faltou: " (faltou ou cancelou, pelo Avec)",
  migracao_lote1c: " (organização do funil)",
};
```

No `case "etapa_alterada"`, trocar a linha do `return one(...)` por:

```ts
      return one(`Movido para ${nome}${motivo.startsWith("automacao") ? " (automático)" : MOTIVO[motivo] ?? ""}`, "etapa");
```

Antes do `default:` (o "Outro registro do sistema" da B12 continua sendo o padrão):

```ts
    case "tentativa": return one(`Tentativa ${Number(p.feita ?? 0)} de 3 feita${p.por === "tarefa" ? " (combinado concluído)" : " (mensagem da Casa)"}`);
    case "aguardando_cliente": return one(`Marcado como aguardando cliente${p.automatico ? " (tentativas automáticas)" : ""}`);
    case "orcamento_enviado": return one("Orçamento enviado");
    case "espera_vencida": return one(p.acao === "voltou_para_conversa" ? "A cliente estava esperando: voltou para Em conversa" : "Espera encerrada (agendada)");
```

- [ ] **Passo 5: Rodar e ver passar**

Rodar: `npx vitest run src/server/stage-keys.test.ts src/lib/history.test.ts`
Esperado: PASS. Se a guarda acusar outro arquivo, troque a chave pelo tipo do mesmo jeito; não acrescente o arquivo à lista `ALLOWED`.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/stage-kinds.ts src/server/stage-keys.test.ts src/server/domain/updates.ts src/server/domain/start-conversation.ts src/server/domain/deals.ts \
  src/server/queries/today.ts src/server/reports/common.ts src/server/reports/queries.ts src/server/reports/team.ts \
  src/components/queue/pane-header.tsx src/components/lead/lead-sheet.tsx src/lib/history.ts src/lib/history.test.ts
git commit -m "refactor(funil): código decide pela etapa (tipo), não pela chave; histórico explica os passos novos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C11: Script de migração das conversas atuais (ensaio, backup JSON e conferência)

**Arquivos:**
- Criar: `src/server/domain/funnel-migration.ts`, `src/server/domain/funnel-migration.test.ts`
- Criar: `scripts/migrar-funil-lote1c.ts`

**Interfaces:**
- Consome:
  - C2: `moveToKindTx`, `adoptWaitingTx`, `activeOwnerTx`;
  - C5: `enterAttendedTx`, `closeAsWonTx`;
  - C8: `applyAppointmentTx`, `createScheduledDealTx`, `FUTURE_MAX_DAYS`, `RECENT_CONVERSATION_DAYS`;
  - `setNextActionTx`, `clientFirstName` (de `src/lib/attempts.ts`).
- Produz:
  - `type Target = "agendado" | "fechado" | "atendido" | "followup" | "atendimento" | "fica" | "revisar"`;
  - `type Situation`;
  - `type PlanRow = { dealId: string | null; contactId: string; name: string; stageKey: string | null; stageName: string; kind: string | null; attempt: number; situation: Situation; target: Target; appointmentId: string | null; visitAt: Date | null }`;
  - `classify(r): { situation; target }`;
  - `planFunnelMigration(now: Date): Promise<PlanRow[]>`;
  - `summarize(rows): { hoje: string; situacao: string; conversas: number; vaiPara: string }[]`;
  - `migrateStagesConfig(apply: boolean): Promise<string[]>`;
  - `applyFunnelMigration(rows, now): Promise<{ applied: number; failed: { dealId: string | null; name: string; error: string }[] }>`;
  - `backupSnapshot(rows): Promise<Record<string, unknown>>`;
  - `openByStage(): Promise<{ etapa: string; conversas: number }[]>`.

- [ ] **Passo 1: Testes**

`src/server/domain/funnel-migration.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contacts, deals, messages, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyFunnelMigration, classify, migrateStagesConfig, planFunnelMigration, summarize } from "./funnel-migration";

const NOW = new Date("2026-10-15T15:00:00Z");
const DAY = 86_400_000;
const rel = (d: number) => new Date(NOW.getTime() + d * DAY);
let n = 0;

beforeEach(async () => { n = 0; await resetDb(); });

async function conversa(stage: string, o: { last?: "in" | "out"; encerrada?: boolean; futuro?: number; veio?: number; pacote?: boolean; tarefaVencida?: boolean } = {}) {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente${n} Teste`, phoneE164: `+5571966${String(n).padStart(6, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, stage));
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, stageEnteredAt: rel(-3), createdAt: rel(-10), conversationArchivedAt: o.encerrada ? rel(-1) : null,
    scheduledAt: stage === "agendado" ? rel(o.futuro ?? 2) : null }).returning();
  if (o.last) await db.insert(messages).values({ contactId: c.id, dealId: d.id, direction: o.last, body: "x", status: o.last === "in" ? "received" : "sent", createdAt: rel(-1) });
  if (o.futuro != null) await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(o.futuro), status: "agendado", externalKey: `m:${n}:f` });
  if (o.veio != null) await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(-o.veio), status: "compareceu", externalKey: `m:${n}:v` });
  if (o.pacote) await db.insert(clientPackages).values({ contactId: c.id, packageName: "Hidratação", totalSessions: 10, usedSessions: 3, externalKey: `m:${n}:p` });
  if (o.tarefaVencida) await db.insert(tasks).values({ dealId: d.id, contactId: c.id, kind: "proxima_acao", title: "Retomar", dueAt: rel(-2) });
  return d.id;
}
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const target = (rows: Awaited<ReturnType<typeof planFunnelMigration>>, id: string) => rows.find((r) => r.dealId === id)!.target;

it("classify: horário futuro > veio em 30 dias > pacote > quem falou por último; Agendado sem horário vai para revisão", () => {
  const base = { kind: "atendimento", encerrada: false, attempt: 0, lastDir: "out" as const, futureId: null, visitAt: null, pacote: false };
  expect(classify({ ...base, futureId: "a", visitAt: new Date(), pacote: true }).target).toBe("agendado");
  expect(classify({ ...base, visitAt: new Date(), encerrada: true }).target).toBe("fechado");
  expect(classify({ ...base, visitAt: new Date() }).target).toBe("atendido");
  expect(classify({ ...base, pacote: true, lastDir: "in" }).target).toBe("followup");
  expect(classify({ ...base, lastDir: "in" }).target).toBe("fica");
  expect(classify({ ...base, kind: "followup", lastDir: "in" }).target).toBe("atendimento");
  expect(classify({ ...base, kind: "followup", attempt: 1 }).target).toBe("fica");
  expect(classify({ ...base, kind: "agendado" }).target).toBe("revisar");
  expect(classify({ ...base, kind: "agendado", futureId: "a" }).target).toBe("fica");
});

describe("migração das conversas (tabela da spec)", () => {
  it("ensaio não grava nada; aplicar põe cada conversa no lugar; rodar de novo não move mais nada", async () => {
    const futuro = await conversa("atendimento", { last: "out", futuro: 3 });
    const veioEnc = await conversa("atendimento", { last: "out", veio: 10, encerrada: true });
    const veio = await conversa("atendimento", { last: "out", veio: 10 });
    const pacote = await conversa("atendimento", { last: "in", pacote: true });
    const casa = await conversa("atendimento", { last: "out" });
    const cliente = await conversa("atendimento", { last: "in" });
    const fuCasa = await conversa("followup_1", { last: "out", tarefaVencida: true });
    const fuCliente = await conversa("followup_1", { last: "in" });
    const agOk = await conversa("agendado", { last: "out", futuro: 2 });
    const agSem = await conversa("agendado", { last: "out" });

    const plan = await planFunnelMigration(NOW);
    expect(Object.fromEntries([futuro, veioEnc, veio, pacote, casa, cliente, fuCasa, fuCliente, agOk, agSem].map((id) => [id, target(plan, id)]))).toEqual({
      [futuro]: "agendado", [veioEnc]: "fechado", [veio]: "atendido", [pacote]: "followup", [casa]: "followup",
      [cliente]: "fica", [fuCasa]: "followup", [fuCliente]: "atendimento", [agOk]: "fica", [agSem]: "revisar",
    });
    expect(summarize(plan).reduce((s, r) => s + r.conversas, 0)).toBe(10);
    expect(await stageOf(casa)).toBe("atendimento"); // ensaio: nada mudou

    const r = await applyFunnelMigration(plan, NOW);
    expect(r.failed).toEqual([]);
    expect(await stageOf(futuro)).toBe("agendado");
    expect(await stageOf(veioEnc)).toBe("fechado");
    expect(await stageOf(veio)).toBe("atendida");
    expect(await db.select().from(tasks).where(and(eq(tasks.dealId, veio), isNull(tasks.doneAt), eq(tasks.kind, "proxima_acao")))).toHaveLength(0); // visita antiga: sem pós
    expect(await stageOf(pacote)).toBe("followup_1");
    expect(await stageOf(casa)).toBe("followup_1");
    expect(await stageOf(cliente)).toBe("atendimento");
    const [fc] = await db.select().from(deals).where(eq(deals.id, fuCasa));
    const [kept] = await db.select().from(tasks).where(eq(tasks.id, fc.followupTaskId!));
    expect(kept).toMatchObject({ title: "Retomar", doneAt: null }); // "mantendo a tarefa"
    expect(await stageOf(fuCliente)).toBe("atendimento");
    expect((await db.select().from(tasks).where(and(eq(tasks.dealId, fuCliente), isNull(tasks.doneAt))))[0].title).toBe(`Responder Cliente8`);
    expect(await stageOf(agSem)).toBe("agendado");

    const again = (await planFunnelMigration(NOW)).filter((x) => x.target !== "fica" && x.target !== "revisar");
    expect(again).toEqual([]);
  });

  it("decisão 4: sem conversa aberta, com horário e conversa nos últimos 30 dias, ganha cartão em Agendado", async () => {
    const [c] = await db.insert(contacts).values({ name: "Solta", phoneE164: "+5571966999999" }).returning();
    await db.insert(messages).values({ contactId: c.id, direction: "in", body: "oi", status: "received", createdAt: rel(-5) });
    await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(4), status: "agendado", externalKey: "m:solta" });
    const plan = await planFunnelMigration(NOW);
    expect(plan.find((r) => r.contactId === c.id)).toMatchObject({ dealId: null, target: "agendado", situation: "sem_conversa_aberta" });
    await applyFunnelMigration(plan, NOW);
    const [d] = await db.select().from(deals).where(eq(deals.contactId, c.id));
    expect(await stageOf(d.id)).toBe("agendado");
  });
});

describe("etapas", () => {
  it("renomeia, reordena e desativa Follow-up 2–4 só onde está no padrão antigo; o ensaio não grava; idempotente", async () => {
    // banco como o de produção antes do Lote 1C
    await db.update(stages).set({ name: "Lead" }).where(eq(stages.key, "lead"));
    await db.update(stages).set({ name: "Atendimento", staleDays: 1 }).where(eq(stages.key, "atendimento"));
    await db.update(stages).set({ name: "Follow-up 1", staleDays: 1, position: 3 }).where(eq(stages.key, "followup_1"));
    await db.update(stages).set({ active: true, staleDays: 1 }).where(eq(stages.key, "followup_2"));
    const dry = await migrateStagesConfig(false);
    expect(dry).toEqual(expect.arrayContaining(['Renomear "Lead" → "Novo contato"', 'Desativar "Follow-up 2"', "Limite parado de Em conversa: 1 → 2 dias"]));
    expect((await db.select().from(stages).where(eq(stages.key, "lead")))[0].name).toBe("Lead");
    await migrateStagesConfig(true);
    const rows = await db.select().from(stages);
    expect(rows.find((s) => s.key === "atendimento")).toMatchObject({ name: "Em conversa", staleDays: 2 });
    expect(rows.find((s) => s.key === "followup_1")).toMatchObject({ name: "Aguardando cliente", staleDays: null, position: 2 });
    expect(rows.find((s) => s.key === "followup_2")!.active).toBe(false);
    expect(await migrateStagesConfig(true)).toEqual([]);
  });

  it("nome editado pela gestão não é trocado", async () => {
    await db.update(stages).set({ name: "Conversando" }).where(eq(stages.key, "atendimento"));
    await migrateStagesConfig(true);
    expect((await db.select().from(stages).where(eq(stages.key, "atendimento")))[0].name).toBe("Conversando");
  });
});
```

Rodar: `npx vitest run src/server/domain/funnel-migration.test.ts`
Esperado: FAIL ("Failed to resolve import ./funnel-migration").

- [ ] **Passo 2: `src/server/domain/funnel-migration.ts`**

```ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals, stages, tasks } from "../db/schema";
import { moveToKindTx } from "./deals";
import { activeOwnerTx, adoptWaitingTx } from "./attempts";
import { closeAsWonTx, enterAttendedTx } from "./funnel";
import { applyAppointmentTx, createScheduledDealTx, FUTURE_MAX_DAYS, RECENT_CONVERSATION_DAYS } from "./avec/funnel-sync";
import { setNextActionTx } from "./tasks";
import { clientFirstName } from "../../lib/attempts";

/**
 * Lote 1C: leva as conversas abertas de hoje para o funil novo, seguindo a tabela "Migração" da spec
 * (docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md). Idempotente: depois de aplicado, um novo plano não move nada.
 * Nunca envia mensagem. Quem chama (scripts/migrar-funil-lote1c.ts) faz o ensaio, o backup JSON e a conferência.
 */
export const MIGRATION_REASON = "migracao_lote1c";
const DAY = 86_400_000;

/* ── 1. Etapas ── */
const RENAMES: [key: string, from: string, to: string][] = [["lead", "Lead", "Novo contato"], ["atendimento", "Atendimento", "Em conversa"], ["followup_1", "Follow-up 1", "Aguardando cliente"]];
const POSITIONS: Record<string, number> = { lead: 0, atendimento: 1, followup_1: 2, orcamento: 3, agendado: 4, atendida: 5, retorno: 6, fechado: 7, perdido: 8, followup_2: 20, followup_3: 21, followup_4: 22 };
const RETIRED = ["followup_2", "followup_3", "followup_4"];
const NEW_KEYS = ["orcamento", "atendida", "retorno"];

/** Nomes, ordem, limite parado e Follow-up 2–4 desativados. Só troca o nome que ainda está no padrão antigo. Devolve o que mudou (ou mudaria). */
export async function migrateStagesConfig(apply: boolean): Promise<string[]> {
  return db.transaction(async (tx) => {
    const byKey = new Map((await tx.select().from(stages)).map((s) => [s.key, s]));
    const missing = NEW_KEYS.filter((k) => !byKey.has(k));
    if (missing.length) throw new Error(`Faltam as etapas ${missing.join(", ")}: rode "npm run db:seed" antes.`);
    const changes: string[] = [];
    const set = async (id: string, patch: Partial<typeof stages.$inferInsert>, text: string) => { changes.push(text); if (apply) await tx.update(stages).set(patch).where(eq(stages.id, id)); };
    for (const [key, from, to] of RENAMES) { const s = byKey.get(key); if (s?.name === from) await set(s.id, { name: to }, `Renomear "${from}" → "${to}"`); }
    for (const [key, pos] of Object.entries(POSITIONS)) { const s = byKey.get(key); if (s && s.position !== pos) await set(s.id, { position: pos }, `Ordem de "${s.name}": ${s.position} → ${pos}`); }
    const atend = byKey.get("atendimento");
    if (atend?.staleDays === 1) await set(atend.id, { staleDays: 2 }, "Limite parado de Em conversa: 1 → 2 dias");
    for (const key of ["followup_1", ...RETIRED]) {
      const s = byKey.get(key);
      if (s && s.staleDays != null) await set(s.id, { staleDays: null }, `Limite parado de "${s.name}": ${s.staleDays} dia(s) → sem limite (as tentativas controlam)`);
    }
    for (const key of RETIRED) {
      const s = byKey.get(key);
      if (!s?.active) continue;
      const [{ n }] = (await tx.execute(sql`select count(*)::int as n from deals where stage_id = ${s.id} and closed_at is null and archived_at is null`)).rows as { n: number }[];
      if (n > 0) throw new Error(`"${s.name}" ainda tem ${n} conversa(s) aberta(s): mova para Aguardando cliente antes.`);
      await set(s.id, { active: false }, `Desativar "${s.name}"`);
    }
    return changes;
  });
}

/* ── 2. Conversas ── */
export type Target = "agendado" | "fechado" | "atendido" | "followup" | "atendimento" | "fica" | "revisar";
export type Situation = "horario_futuro" | "veio_30d_encerrada" | "veio_30d" | "pacote" | "casa_ultimo" | "cliente_ultimo" | "sem_mensagem"
  | "agendado_confere" | "agendado_sem_horario" | "ja_no_funil_novo" | "sem_conversa_aberta";
export type PlanRow = {
  dealId: string | null; contactId: string; name: string; stageKey: string | null; stageName: string; kind: string | null; attempt: number;
  situation: Situation; target: Target; appointmentId: string | null; visitAt: Date | null;
};
type Raw = { kind: string; encerrada: boolean; attempt: number; lastDir: "in" | "out" | null; futureId: string | null; visitAt: Date | null; pacote: boolean };

export const SITUATION_LABEL: Record<Situation, string> = {
  horario_futuro: "tem horário futuro no Avec", veio_30d_encerrada: "compareceu em 30 dias, conversa encerrada", veio_30d: "compareceu em 30 dias",
  pacote: "pacote ativo", casa_ultimo: "Casa falou por último", cliente_ultimo: "cliente falou por último", sem_mensagem: "sem mensagem",
  agendado_confere: "horário confere com o Avec", agendado_sem_horario: "sem horário no Avec", ja_no_funil_novo: "já no funil novo",
  sem_conversa_aberta: "sem conversa aberta, horário futuro e conversa em 30 dias",
};
export const TARGET_LABEL: Record<Target, string> = {
  agendado: "Agendado (data do Avec)", fechado: "Fechado (ganho)", atendido: "Atendida", followup: "Aguardando cliente, tentativa 1",
  atendimento: "Em conversa + tarefa \"Responder\"", fica: "fica onde está", revisar: "REVISÃO MANUAL",
};

/** A tabela da spec, sem sobreposição: horário futuro > veio em 30 dias > pacote > quem falou por último. */
export function classify(r: Raw): { situation: Situation; target: Target } {
  if (r.kind === "agendado") return r.futureId ? { situation: "agendado_confere", target: "fica" } : { situation: "agendado_sem_horario", target: "revisar" };
  if (r.kind === "proposta" || r.kind === "atendido" || r.kind === "retorno") return { situation: "ja_no_funil_novo", target: "fica" };
  if (r.futureId) return { situation: "horario_futuro", target: "agendado" };
  if (r.visitAt) return r.encerrada ? { situation: "veio_30d_encerrada", target: "fechado" } : { situation: "veio_30d", target: "atendido" };
  const counted = r.kind === "followup" && r.attempt > 0;
  if (r.pacote) return { situation: "pacote", target: counted ? "fica" : "followup" };
  if (r.lastDir === "out") return { situation: "casa_ultimo", target: counted ? "fica" : "followup" };
  if (r.lastDir === "in") return { situation: "cliente_ultimo", target: r.kind === "followup" ? "atendimento" : "fica" };
  return { situation: "sem_mensagem", target: "fica" };
}

export async function planFunnelMigration(now: Date): Promise<PlanRow[]> {
  const nowIso = now.toISOString();
  const max = new Date(now.getTime() + FUTURE_MAX_DAYS * DAY).toISOString();
  const from30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const recent = new Date(now.getTime() - RECENT_CONVERSATION_DAYS * DAY).toISOString();
  const future = (contact: string) => sql.raw(`(select a.id from appointments a where a.contact_id = ${contact} and a.status in ('agendado', 'confirmado')
    and a.starts_at > '${nowIso}'::timestamptz and a.starts_at <= '${max}'::timestamptz order by a.starts_at limit 1)`);
  const open = (await db.execute(sql`
    select d.id as "dealId", d.contact_id as "contactId", coalesce(nullif(trim(c.name), ''), c.phone_e164) as name, s.key as "stageKey", s.name as "stageName",
      s.kind::text as kind, d.conversation_archived_at is not null as encerrada, d.followup_attempt as attempt,
      (select m.direction::text from messages m where m.deal_id = d.id order by m.created_at desc, m.id desc limit 1) as "lastDir",
      ${future("d.contact_id")} as "futureId",
      (select max(a.starts_at) from appointments a where a.contact_id = d.contact_id and a.status = 'compareceu'
        and a.starts_at > ${from30}::timestamptz and a.starts_at <= ${nowIso}::timestamptz) as "visitAt",
      exists (select 1 from client_packages p where p.contact_id = d.contact_id and p.used_sessions < p.total_sessions
        and (p.valid_until is null or p.valid_until >= (${nowIso}::timestamptz at time zone 'America/Bahia')::date)) as pacote
    from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    where d.closed_at is null and d.archived_at is null and c.ignored = false
    order by s.position, name`)).rows as (Omit<Raw, "visitAt"> & { visitAt: string | Date | null; dealId: string; contactId: string; name: string; stageKey: string; stageName: string })[];
  const rows: PlanRow[] = open.map((r) => {
    const visitAt = r.visitAt ? new Date(r.visitAt) : null;
    return { dealId: r.dealId, contactId: r.contactId, name: r.name, stageKey: r.stageKey, stageName: r.stageName, kind: r.kind, attempt: r.attempt,
      appointmentId: r.futureId, visitAt, ...classify({ ...r, visitAt }) };
  });
  // Decisão 4: sem conversa aberta, com horário futuro E conversa nos últimos 30 dias → cartão novo em Agendado.
  const loose = (await db.execute(sql`
    select c.id as "contactId", coalesce(nullif(trim(c.name), ''), c.phone_e164) as name, ${future("c.id")} as "futureId"
    from contacts c
    where c.ignored = false
      and not exists (select 1 from deals d where d.contact_id = c.id and d.closed_at is null and d.archived_at is null)
      and exists (select 1 from messages m where m.contact_id = c.id and m.created_at > ${recent}::timestamptz)
      and ${future("c.id")} is not null`)).rows as { contactId: string; name: string; futureId: string }[];
  for (const l of loose) rows.push({ dealId: null, contactId: l.contactId, name: l.name, stageKey: null, stageName: "(sem conversa aberta)", kind: null, attempt: 0,
    situation: "sem_conversa_aberta", target: "agendado", appointmentId: l.futureId, visitAt: null });
  return rows;
}

/** A tabela do ensaio: etapa de hoje × situação × quantas × para onde vai. */
export function summarize(rows: PlanRow[]) {
  const m = new Map<string, { hoje: string; situacao: string; conversas: number; vaiPara: string }>();
  for (const r of rows) {
    const k = `${r.stageName}|${r.situation}|${r.target}`;
    const cur = m.get(k) ?? { hoje: r.stageName, situacao: SITUATION_LABEL[r.situation], conversas: 0, vaiPara: TARGET_LABEL[r.target] };
    cur.conversas++;
    m.set(k, cur);
  }
  return [...m.values()];
}

/** Aplica o plano: uma transação por conversa; um erro não para as outras (volta na lista). */
export async function applyFunnelMigration(rows: PlanRow[], now: Date) {
  let applied = 0;
  const failed: { dealId: string | null; name: string; error: string }[] = [];
  for (const r of rows) {
    if (r.target === "fica" || r.target === "revisar") continue;
    try {
      await db.transaction(async (tx) => {
        const [deal] = r.dealId ? await tx.select().from(deals).where(eq(deals.id, r.dealId)) : [];
        switch (r.target) {
          case "agendado": {
            const [appt] = await tx.select().from(appointments).where(eq(appointments.id, r.appointmentId!));
            if (deal) await applyAppointmentTx(tx, deal, appt, now, MIGRATION_REASON); else await createScheduledDealTx(tx, r.contactId, appt, now);
            break;
          }
          case "fechado":
            await tx.update(deals).set({ attendance: "compareceu", attendanceAt: r.visitAt }).where(eq(deals.id, deal.id));
            await closeAsWonTx(tx, deal.id, null, MIGRATION_REASON, now, { visitAt: r.visitAt });
            break;
          case "atendido":
            await tx.update(deals).set({ attendance: "compareceu", attendanceAt: r.visitAt }).where(eq(deals.id, deal.id));
            await enterAttendedTx(tx, deal.id, null, MIGRATION_REASON, now, { visitAt: r.visitAt ?? undefined, postTask: false });
            break;
          case "followup":
            if (r.kind === "followup") await adoptWaitingTx(tx, deal, "followup", now); // "mantendo a tarefa"
            else await moveToKindTx(tx, deal.id, "followup", null, MIGRATION_REASON, now);
            break;
          case "atendimento":
            await moveToKindTx(tx, deal.id, "atendimento", null, MIGRATION_REASON, now);
            await setNextActionTx(tx, deal.id, { title: `Responder ${clientFirstName(r.name)}`, dueAt: now, assigneeId: await activeOwnerTx(tx, deal.ownerId) }, null, now);
            break;
        }
      });
      applied++;
    } catch (e) { failed.push({ dealId: r.dealId, name: r.name, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { applied, failed };
}

/** O que guardar ANTES de aplicar: etapas, as conversas abertas (linha inteira), as tarefas abertas delas e o plano. */
export async function backupSnapshot(rows: PlanRow[]) {
  const ids = rows.map((r) => r.dealId).filter((x): x is string => !!x);
  return {
    geradoEm: new Date().toISOString(), lote: "1C",
    stages: await db.select().from(stages),
    deals: ids.length ? await db.select().from(deals).where(inArray(deals.id, ids)) : [],
    tarefasAbertas: ids.length ? await db.select().from(tasks).where(and(inArray(tasks.dealId, ids), isNull(tasks.doneAt))) : [],
    plano: rows,
  };
}

export async function openByStage(): Promise<{ etapa: string; conversas: number }[]> {
  return (await db.execute(sql`select s.name as etapa, count(d.id)::int as conversas from stages s
    left join deals d on d.stage_id = s.id and d.closed_at is null and d.archived_at is null
    where s.active group by s.id order by s.position`)).rows as { etapa: string; conversas: number }[];
}
```

Nota: o nome "Cliente8" no teste vem de `clientFirstName("Cliente8 Teste")` (8ª conversa criada).

- [ ] **Passo 3: `scripts/migrar-funil-lote1c.ts`**

```ts
import "dotenv/config";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pool } from "../src/server/db";
import { applyFunnelMigration, backupSnapshot, migrateStagesConfig, openByStage, planFunnelMigration, summarize } from "../src/server/domain/funnel-migration";

// Lote 1C: organiza as conversas abertas no funil novo, pela tabela "Migração" da spec (docs/superpowers/specs/2026-10-15-crm-sistema-completo-design.md).
// Ensaio (não grava nada):  npx tsx scripts/migrar-funil-lote1c.ts --dry-run
// Aplicar (com backup):     npx tsx scripts/migrar-funil-lote1c.ts --aplicar --backup /home/crm/backups/funil-lote1c-AAAA-MM-DD-antes.json
// Antes: npm run db:migrate && npm run db:seed (as etapas novas nascem no seed). Idempotente. Nunca envia mensagem.

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

function table(rows: Record<string, string | number>[]) {
  if (!rows.length) { console.log("  (nada)"); return; }
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (vals: (string | number)[]) => "| " + vals.map((v, i) => String(v).padEnd(w[i])).join(" | ") + " |";
  console.log(line(cols));
  console.log("|" + w.map((x) => "-".repeat(x + 2)).join("|") + "|");
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}
const stageTable = async () => table((await openByStage()).map((r) => ({ Etapa: r.etapa, Conversas: r.conversas })));

async function main() {
  const dry = has("--dry-run"), apply = has("--aplicar");
  if (dry === apply) throw new Error("Use --dry-run (ensaio) ou --aplicar --backup <arquivo.json>.");
  const file = arg("--backup");
  if (apply && !file) throw new Error("Informe --backup <arquivo.json> (ex.: /home/crm/backups/funil-lote1c-2026-10-16-antes.json).");
  if (file && existsSync(file)) throw new Error(`${file} já existe: escolha outro nome (o backup nunca é sobrescrito).`);
  const now = new Date();
  console.log(`Funil novo (Lote 1C) · ${apply ? "APLICANDO" : "ENSAIO, nada é gravado"} · ${now.toISOString()}\n`);
  console.log("ANTES: conversas abertas por etapa"); await stageTable();
  console.log("\n1. Etapas"); for (const c of await migrateStagesConfig(false)) console.log(`  - ${c}`);
  const plan = await planFunnelMigration(now);
  console.log("\n2. Conversas (compare com a tabela da spec)");
  table(summarize(plan).map((r) => ({ Hoje: r.hoje, Situação: r.situacao, Conversas: r.conversas, "Vai para": r.vaiPara })));
  const review = plan.filter((r) => r.target === "revisar");
  if (review.length) { console.log("\nRevisão manual (Agendado sem horário no Avec; ficam em Agendado):"); for (const r of review) console.log(`  - ${r.name.split(/\s+/)[0]} · lead ${r.dealId}`); }
  const tomorrow = plan.filter((r) => r.target === "followup").length;
  console.log(`\nCombinados "Tentativa 1 de 3" que vão vencer no próximo dia de expediente (viram aviso): até ${tomorrow}`);
  if (dry) return;

  await writeFile(file!, JSON.stringify(await backupSnapshot(plan), null, 1), { mode: 0o600 });
  console.log(`\nBackup: ${file}`);
  console.log(`Etapas: ${(await migrateStagesConfig(true)).length} ajuste(s)`);
  const r = await applyFunnelMigration(plan, now);
  console.log(`Conversas movidas: ${r.applied}`);
  for (const f of r.failed) console.log(`  ✗ ${f.name.split(/\s+/)[0]} (${f.dealId ?? "sem conversa"}): ${f.error}`);
  // Conferência: depois de aplicar, um novo ensaio não pode querer mover mais nada.
  const again = (await planFunnelMigration(now)).filter((x) => x.target !== "fica" && x.target !== "revisar");
  console.log("\nDEPOIS: conversas abertas por etapa"); await stageTable();
  if (r.failed.length || again.length) {
    console.log(`\nCONFERÊNCIA FALHOU: ${r.failed.length} erro(s), ${again.length} conversa(s) ainda fora do lugar. Nada foi desfeito; o backup está em ${file}.`);
    process.exitCode = 1;
  } else console.log("\nConferência OK: nenhuma conversa fora do lugar.");
}
main().then(() => pool.end()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await pool.end(); process.exit(1); });
```

- [ ] **Passo 4: Rodar e ver passar**

Rodar: `npx vitest run src/server/domain/funnel-migration.test.ts`
Esperado: PASS.

Ensaio no banco de desenvolvimento: `npx tsx scripts/migrar-funil-lote1c.ts --dry-run`
Esperado: a tabela ANTES, a lista de ajustes de etapa, a tabela de conversas e "Combinados…". Nenhuma escrita. Para conferir, rodar de novo: a saída é igual.

Rodar: `npm test && npm run typecheck && npm run lint`
Esperado: verde.

- [ ] **Passo 5: Commit**

```bash
git add src/server/domain/funnel-migration.ts src/server/domain/funnel-migration.test.ts scripts/migrar-funil-lote1c.ts
git commit -m "feat(funil): migração das conversas atuais para o funil novo com ensaio, backup JSON e conferência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa C12: Ensaio do motor num dia inteiro (só leitura), roteiro de produção no `docs/deploy-contabo.md` e verificação final

**Arquivos:**
- Criar: `scripts/simular-motor.ts`
- Modificar: `docs/deploy-contabo.md` (seção nova "Lotes 1A, 1B e 1C: publicar e acertar os dados")
- Modificar (e2e, nomes novos das etapas): `e2e/quadro.spec.ts`, `e2e/fluxo.spec.ts`, `e2e/jornada.spec.ts`, `e2e/acoes-fila.spec.ts`, `e2e/cliente.spec.ts`, `e2e/conversa.spec.ts`

**Interfaces:**
- Consome: `candidatesFor`, `triggerSchema`, `conditionSchema`, `actionSchema`, `getBusinessHours`, `isOpen`, `bahiaAt`.
- Produz: o script `npx tsx scripts/simular-motor.ts [AAAA-MM-DD]`, só leitura.

- [ ] **Passo 1: `scripts/simular-motor.ts`**

```ts
import "dotenv/config";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { automationRuns, automations, deals, tasks } from "../src/server/db/schema";
import { candidatesFor } from "../src/server/rules/engine";
import { actionSchema, conditionSchema, triggerSchema } from "../src/server/rules/types";
import { getBusinessHours } from "../src/server/domain/hours";
import { isOpen } from "../src/lib/business-hours";
import { bahiaAt } from "../src/lib/next-action";

// Ensaio do motor, SÓ LEITURA (nenhuma escrita, nenhum envio): quantos movimentos e avisos as automações LIGADAS gerariam num dia,
// de 5 em 5 min no expediente, com o banco como está agora (não acompanha o que mudaria durante o dia). Conta também os combinados
// (tarefas) que vencem no dia e viram aviso, as Atendidas que fecham sozinhas e as conversas que viram Perdido depois das 3 tentativas.
// Uso: npx tsx scripts/simular-motor.ts [AAAA-MM-DD]   (padrão: amanhã, no fuso de Salvador)

async function main() {
  const arg = process.argv[2];
  const base = arg ? new Date(`${arg}T12:00:00-03:00`) : bahiaAt(Date.now(), 1, 12);
  const start = bahiaAt(base.getTime(), 0, 0), end = bahiaAt(base.getTime(), 1, 0);
  const hours = await getBusinessHours();
  const autos = await db.select().from(automations).where(eq(automations.enabled, true));
  const done = new Set((await db.select({ a: automationRuns.automationId, d: automationRuns.dealId, w: automationRuns.windowKey }).from(automationRuns)).map((r) => `${r.a}|${r.d}|${r.w}`));
  const rows: { Automação: string; Disparos: number; Avisos: number; Movimentos: number }[] = [];
  for (const auto of autos) {
    const trigger = triggerSchema.safeParse(auto.trigger), conds = conditionSchema.array().safeParse(auto.conditions), acts = actionSchema.array().safeParse(auto.actions);
    if (!trigger.success || !conds.success || !acts.success) { rows.push({ Automação: `${auto.key ?? auto.name} (configuração inválida)`, Disparos: 0, Avisos: 0, Movimentos: 0 }); continue; }
    const seen = new Set<string>();
    for (let t = start.getTime(); t < end.getTime(); t += 5 * 60_000) {
      if (!isOpen(t, hours)) continue;
      let c = await candidatesFor(trigger.data, new Date(t), hours);
      for (const cond of conds.data) if (cond.type === "etapa_em") c = c.filter((x) => cond.stages.includes(x.stageKey));
      for (const x of c) { const k = `${auto.id}|${x.dealId}|${x.windowKey}`; if (!done.has(k)) seen.add(k); }
    }
    const alerts = acts.data.filter((a) => a.type.startsWith("alertar_") || a.type === "escalar_gestao").length;
    const moves = acts.data.filter((a) => a.type.startsWith("mover_") || a.type === "aguardar_cliente").length;
    rows.push({ Automação: auto.key ?? auto.name, Disparos: seen.size, Avisos: seen.size * alerts, Movimentos: seen.size * moves });
  }
  const [{ n: combinados }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tasks).leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(isNull(tasks.doneAt), gte(tasks.dueAt, start), lt(tasks.dueAt, end), isNull(deals.archivedAt))));
  const [{ n: fecham }] = (await db.execute(sql`select count(*)::int as n from deals d join stages s on s.id = d.stage_id
    where s.kind = 'atendido' and d.closed_at is null and d.archived_at is null
      and d.stage_entered_at + interval '3 days' >= ${start.toISOString()}::timestamptz and d.stage_entered_at + interval '3 days' < ${end.toISOString()}::timestamptz`)).rows as { n: number }[];
  const [{ n: perdem }] = (await db.execute(sql`select count(*)::int as n from deals d join stages s on s.id = d.stage_id
    where s.kind in ('followup', 'proposta') and d.closed_at is null and d.followup_attempt > 3 and d.followup_due_at < ${end.toISOString()}::timestamptz`)).rows as { n: number }[];
  console.log(`Ensaio do motor (só leitura) · ${start.toISOString().slice(0, 10)} (Salvador) · expediente: ${JSON.stringify(hours)}\n`);
  console.table(rows);
  const avisos = rows.reduce((s, r) => s + r.Avisos, 0);
  console.log(`Combinados (tarefas) que vencem no dia e viram aviso: ${combinados}`);
  console.log(`Atendidas que fecham sozinhas (ganho): ${fecham} · Conversas que viram Perdido "Não respondeu mais": ${perdem}`);
  console.log(`\nTOTAL de avisos previstos no dia: ${avisos + combinados} (automações ${avisos} + combinados ${combinados})`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
```

Rodar no banco de desenvolvimento: `npx tsx scripts/simular-motor.ts`
Esperado:
- a tabela por automação, sem `followup_diario` e sem `parado_1dia` (desligadas);
- as linhas `casa_falou_4h` e `parado_etapa`;
- o total no fim.

Conferir que nada foi gravado:

```bash
psql "$DATABASE_URL" -Atc "select count(*) from automation_runs"
```

Rodar antes e depois do ensaio: o número tem de ser igual.

- [ ] **Passo 2: Roteiro de produção no `docs/deploy-contabo.md`**

Acrescentar no fim a seção abaixo. Ela é o mesmo roteiro da seção **Implantação** deste plano, guardado junto dos outros roteiros de servidor:

````markdown
## Lotes 1A, 1B e 1C (15/10): publicar e acertar os dados (só com o ok do dono)

Publicação por pacote em pasta nova (`/opt/crm-rN`; aqui, r14) e troca de pasta, como desde 14/10: `/opt/crm` não é repositório git e nunca guarda estado
(mídia em `MEDIA_DIR=/home/crm/crm-media`, relatórios em `REPORTS_DIR=/home/crm/crm-relatorios`). Fora do expediente (a Casa abre ter–sáb, 9–18h).
Nada aqui envia WhatsApp. Ordem: código → assinaturas → acerto do 1A → tarefas do 1B → funil do 1C → ensaio do motor → worker.

1. No Mac, com tudo verde (`npm test && npm run typecheck && npm run lint && npm run build && npx playwright test`):
   ```bash
   git archive --format=tar.gz -o /tmp/crm-r14.tgz HEAD && scp /tmp/crm-r14.tgz casafiaes:~/ && rm /tmp/crm-r14.tgz
   ```
2. No servidor (`ssh casafiaes`): pasta nova, `.env` copiado e build sem parar o que está no ar.
   ```bash
   ls -d /opt/crm*                                    # confere o número: no ar é a r13 → a nova é r14 (se for outro, troque 14/13 em todos os comandos)
   sudo mkdir /opt/crm-r14 && sudo tar -xzf ~/crm-r14.tgz -C /opt/crm-r14 && sudo chown -R crm:crm /opt/crm-r14 && rm ~/crm-r14.tgz
   sudo -u crm cp /opt/crm/.env /opt/crm-r14/.env && grep -E "MEDIA_DIR|REPORTS_DIR" /opt/crm-r14/.env
   diff -rq --exclude=node_modules --exclude=.next --exclude=.env /opt/crm /opt/crm-r14 | grep "^Only in /opt/crm:"   # esperado: vazio (nada no ar que não esteja no repositório)
   cd /opt/crm-r14 && sudo -u crm npm ci && sudo -u crm npm run build
   ```
3. Backup e parada: `cd /opt/crm && sudo -u crm bash scripts/backup.sh` (anote a pasta) e `sudo -u crm pm2 stop crm-web crm-worker`.
4. Banco, com o código novo: `cd /opt/crm-r14 && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed` (aplica `0023_quem_atende` e `0024_funil_novo`; o seed cria Orçamento enviado, Atendida, Retorno sugerido, `casa_falou_4h` e `parado_etapa`).
5. Troca de pasta e só a web de volta (o worker fica parado até o fim do passo 9):
   ```bash
   sudo mv /opt/crm /opt/crm-anterior-r13 && sudo mv /opt/crm-r14 /opt/crm
   cd /opt/crm && sudo -u crm pm2 start crm-web && curl -s https://crm.217-76-54-18.sslip.io/api/health   # web ok; worker.ok false é esperado aqui
   ```
6. Assinaturas, pela tela (Configurações › Equipe): SARA em "Daniela Rezende" e CATI em "Natália Campos".
7. Lote 1A: `cd /opt/crm && sudo -u crm npx tsx scripts/autoria-assinaturas.ts --dry-run` → mostrar as tabelas ao dono → `sudo -u crm npx tsx scripts/autoria-assinaturas.ts --aplicar` (tem de terminar em "Conferência: nada pendente.").
8. Lote 1B: `sudo -u crm npx tsx scripts/tarefas-sem-responsavel.ts --dry-run` → ok do dono → `sudo -u crm env BACKUP_DIR=/home/crm/backups npx tsx scripts/tarefas-sem-responsavel.ts --aplicar`.
9. Lote 1C: `sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --dry-run` (comparar com a tabela "Migração" da spec; até 3 de diferença por linha é normal) → ok do dono →
   `sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --aplicar --backup /home/crm/backups/funil-lote1c-$(date +%F)-antes.json` (tem de terminar em "Conferência OK").
10. Ensaio do motor no próximo dia de expediente: `sudo -u crm npx tsx scripts/simular-motor.ts`. Mais de 60 avisos previstos: não ligar o worker, revisar com o dono.
11. Worker: `sudo -u crm pm2 start crm-worker && sudo -u crm pm2 save` e `curl -s https://crm.217-76-54-18.sslip.io/api/health` com `status: "ok"` e `worker.ok: true` em até 1 minuto.
12. No dia seguinte (só leitura):
    ```bash
    docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select a.key, count(*) from automation_runs r join automations a on a.id = r.automation_id where r.created_at > now() - interval '1 day' group by 1 order by 2 desc"
    docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select s.name, count(d.id) from stages s left join deals d on d.stage_id = s.id and d.closed_at is null and d.archived_at is null where s.active group by s.id order by s.position"
    ```
    Esperado: nenhum `followup_diario` nem `parado_1dia`; Em conversa perto de 5 (era 92).

Voltar o código: `sudo -u crm pm2 stop crm-web crm-worker && sudo mv /opt/crm /opt/crm-r14-falhou && sudo mv /opt/crm-anterior-r13 /opt/crm && sudo -u crm pm2 start crm-web crm-worker`.
As migrações são aditivas, então a versão anterior funciona com o banco novo; mas as conversas já movidas para Orçamento enviado/Atendida/Retorno
aparecem nessas colunas sem as ações novas. Dados: `autoria-assinaturas.ts --desfazer <backup>` desfaz o 1A; os JSON do 1B e do 1C guardam o estado
de antes de cada linha (restaurar à mão, com aprovação). Restaurar o backup do passo 3 só se houver dano: perde o que entrou depois.
````

- [ ] **Passo 3: e2e com os nomes novos das etapas**

O e2e recria o banco `crm_e2e` com o seed (`e2e/reset.ts`), então desde a C1 as colunas e estações se chamam Novo contato, Em conversa e Aguardando cliente, e Follow-up 2 está desativado. Só os **nomes de etapa** mudam: o menu/página "Atendimento" e os rótulos `Lead <nome>` das folhas e regiões da conversa ficam como estão.

- `e2e/quadro.spec.ts` (linhas 35, 48, 67, 78, 89, 93, 112, 136): `coluna(page, /^Lead,/)` → `coluna(page, /^Novo contato,/)`; (56, 59): `/^Atendimento,/` → `/^Em conversa,/`.
- `e2e/fluxo.spec.ts` (28, 59, 61): `{ name: /^Lead,/ }` → `{ name: /^Novo contato,/ }`; (42, 50, 69): `/^Atendimento,/` → `/^Em conversa,/`.
- `e2e/jornada.spec.ts`:
  - linha 29: `await noEstagio(8, "followup_2", …)` → `await noEstagio(8, "followup_1", …)` (Follow-up 2 não existe mais; a estação continua com 2 conversas);
  - linhas 57, 86, 114 e 163: `/^Lead: N leads…/` → `/^Novo contato: N leads…/` (mesmo número);
  - linhas 61 e 97: `/^Follow-up: 2 leads/` → `/^Aguardando cliente: 2 leads/`; o comentário da linha 95 vira `// Aguardando cliente: uma estação só`;
  - linha 81: `noQuadro(/^Lead,/)` → `noQuadro(/^Novo contato,/)`, `noQuadro(/^Atendimento,/)` → `noQuadro(/^Em conversa,/)`, `noQuadro(/^Follow-up,/)` → `noQuadro(/^Aguardando cliente,/)`. Rode o spec: se o objeto `jornada` passar a trazer as estações novas vazias, acrescente `orcamento: 0, atendida: 0, retorno: 0` ao esperado.
- `e2e/acoes-fila.spec.ts` (125-126): `{ name: "Follow-up 1" }` → `{ name: "Aguardando cliente" }` e `/2 leads movidos para Follow-up 1/` → `/2 leads movidos para Aguardando cliente/` (a linha 128, com `followup_1`, fica).
- `e2e/cliente.spec.ts`:
  - linha 52 (comentário): `// Etapas: Aguardando cliente é um passo só, tocável (bloco "Etapa", recolhido por padrão)`;
  - linha 55: `toHaveText(["Novo contato (etapa atual)", "Em conversa", "Aguardando cliente", "Orçamento enviado", "Agendado", "Atendida", "Retorno sugerido", "Fechado", "Perdido"])`;
  - linha 56: `toContainText("Novo contato")`; linha 71: `toContainText("Em conversa")`;
  - linha 77: `{ name: "Mover para Aguardando cliente" }`; linha 78: `toContainText("Aguardando cliente")` (79 e 88, com `followup_1`, ficam).
- `e2e/conversa.spec.ts` linha 61: `toContainText("Em conversa")`; o título do teste da linha 38 vira "…responder pela conversa move para Em conversa…".

Para conferir que não sobrou nome antigo de etapa: `grep -nE "/\^Lead[,:]|/\^Atendimento,|Follow-up|followup_[2-4]" e2e/*.ts` deve voltar vazio.

Rodar: `npx playwright test e2e/quadro.spec.ts e2e/fluxo.spec.ts e2e/jornada.spec.ts e2e/acoes-fila.spec.ts e2e/cliente.spec.ts e2e/conversa.spec.ts`
Esperado: PASS.

- [ ] **Passo 4: Verificação final dos três lotes**

Rodar: `npm test && npm run typecheck && npm run lint && npm run build && npx playwright test`
Esperado: tudo PASS.

Rodar: `npx vitest run test/evolution-guard.test.ts`
Esperado: PASS (nenhum teste fala com WhatsApp de verdade).

Rodar: `git status --short`
Esperado: só os arquivos que já estavam soltos antes do plano (`e2e/shots/relatorios-pdf/*.pdf`, `tsconfig.json`, `.next-copia/`, `emoji-*.png`).

- [ ] **Passo 5: Commit**

```bash
git add scripts/simular-motor.ts docs/deploy-contabo.md e2e/quadro.spec.ts e2e/fluxo.spec.ts e2e/jornada.spec.ts e2e/acoes-fila.spec.ts e2e/cliente.spec.ts e2e/conversa.spec.ts
git commit -m "feat(ops): ensaio do motor num dia (só leitura) e roteiro de produção dos Lotes 1A, 1B e 1C

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Interfaces que o Lote 1C expõe

**`src/lib/attempts.ts` (puro, servidor e navegador)**
- `WAITING_KINDS = ["followup", "proposta"]`, `type WaitingKind`, `isWaitingKind(k: string | null | undefined): k is WaitingKind`
- `MAX_ATTEMPTS = 3`
- `ATTEMPT_DAYS: Record<WaitingKind, readonly [number, number, number]>` = `{ followup: [1,3,7], proposta: [2,4,8] }`
- `LAST_REPLY_DAYS = 2`, `RECONTACT_DAYS = 30`, `ATTEMPT_HOUR = 10`
- `attemptDueAt(fromMs: number, days: number, hours: BusinessHours): Date`
- `attemptTitle(n: number, name: string | null | undefined): string`
- `attemptLabel(attempt: number): string | null`
- `clientFirstName(name: string | null | undefined): string` (com "a cliente" de reserva)

**`src/lib/stage-kinds.ts`**
- `CLOSED_STAGE_KINDS`, `SCHEDULABLE_KINDS`
- `isSchedulable(kind): boolean`
- `keyOfKind(stages, kind): string | null`

**`src/lib/alert-copy.ts` (do 1B)**
- `PARADOS_ACTIONS = "Agendar, Aguardar cliente ou Encerrar"`
- ajuda: `linha-tentativa`, `linha-pacote`

**`src/lib/primary-action.ts`**
- `askAttendance` mostra "Compareceu?" também em Atendida e Aguardando cliente quando já há marcação (para corrigir)

**`src/server/domain/deals.ts`**
- `type StageKind = Stage["kind"]`
- `stageByKind(kind: StageKind, tx?): Promise<Stage>`
- `moveDealTx(tx, dealId, stageKey, userId, reason, at?, opts?: AttemptStart): Promise<Deal>`. Entra e sai das tentativas; recusa etapa inativa.
- `moveToKindTx(tx, dealId, kind: StageKind, userId, reason, at?, opts?: AttemptStart): Promise<Deal>`
- `BACK_TO_CONVERSATION_KINDS = ["followup", "proposta", "retorno"]`

**`src/server/domain/attempts.ts`**
- `ATTEMPT_META = { origem: "tentativa" }`
- `type AttemptStart = { resumeAt?: Date | null; taskTitle?: string; assigneeId?: string | null; taskMeta?: Record<string, unknown> }`
- `activeOwnerTx(tx, ownerId): Promise<string | null>`
- `startAttemptsTx(tx, deal, kind, userId, at, opts?): Promise<Deal>`
- `cancelAttemptTaskTx(tx, deal, userId, at): Promise<void>`
- `rescheduleAttemptTx(tx, dealId, { resumeAt, title?, assigneeId? }, userId, now): Promise<{ dueAt: Date }>`
- `adoptWaitingTx(tx, deal, kind, at): Promise<Deal>`

**`src/server/domain/funnel.ts`**
- `markWaitingForClient(dealId, { resumeAt?, title?, assigneeId? }, userId, now?): Promise<{ dueAt: Date }>`
- `markProposalSent(dealId, userId, now?, input?): Promise<{ dueAt: Date }>`
- `enterAttendedTx(tx, dealId, userId, reason, at, { visitAt?, postTask? }?): Promise<Deal>`
- `enterMissedTx(tx, dealId, userId, reason, now): Promise<{ remarcar: boolean }>`
- `closeAsWonTx(tx, dealId, userId, reason, at, { visitAt? }?): Promise<Deal>`
- `closeAttendedDeals(now?): Promise<{ closed: number; errors: string[] }>`
- `sweepAttempts(now?): Promise<{ advanced: number; adopted: number; lost: number; errors: string[] }>`
- `ATTENDED_CLOSE_DAYS = 3`, `NO_REPLY_REASON = "Não respondeu mais"`

**`src/server/domain/tasks.ts`**
- `POS_ATENDIMENTO_META = { origem: "pos_atendimento" }`
- `cancelOpenTasksByOriginTx(tx, dealId, origem, userId): Promise<number>`
- `cancelRemarcarTx` mantém a assinatura.

**`src/server/domain/avec/funnel-sync.ts`**
- `FUTURE_MAX_DAYS = 180`, `RECENT_CONVERSATION_DAYS = 30`
- `type FunnelSyncResult`, `emptyFunnelSync()`
- `applyAppointmentTx(tx, deal, appt, now, reason): Promise<Deal>`
- `createScheduledDealTx(tx, contactId, appt, now): Promise<string>`
- `syncContactFunnelTx(tx, contactId, now)`
- `syncFunnelFromAgenda({ now?, contactIds? }?): Promise<FunnelSyncResult>`

**`src/server/domain/avec/apply.ts`**
- `applyAvecFiles(files, { now? }?): Promise<AvecBatchResult & { funil: FunnelSyncResult }>`

**`src/server/domain/funnel-migration.ts`**
- `classify(raw)`
- `planFunnelMigration(now): Promise<PlanRow[]>`
- `summarize(rows)`
- `migrateStagesConfig(apply): Promise<string[]>`
- `applyFunnelMigration(rows, now)`
- `backupSnapshot(rows)`
- `openByStage()`
- tipos `PlanRow`, `Target`, `Situation`

**Motor (`src/server/rules/types.ts`)**
- gatilho `{ type: "casa_falou_por_ultimo_horas", hours: 1..72 }`
- ação `{ type: "aguardar_cliente" }`
- `mover_para_proximo_followup` passa a equivaler a `aguardar_cliente`
- janela do `parado_dias`: um aviso por permanência na etapa

**Banco**
- enum `stage_kind` + `proposta | atendido | retorno`
- `deals.followup_attempt | followup_due_at | followup_task_id`
- etapas `orcamento`, `atendida`, `retorno`
- automações `casa_falou_4h`, `parado_etapa`
- eventos `aguardando_cliente | orcamento_enviado | tentativa | espera_vencida`

**Telas e actions**
- `waitForClientAction`, `proposalSentAction` (sai `resumeLaterAction`)
- `LeadActions.proposalSent`
- `ResumeLaterSheet` com `mode: "aguardar" | "nova-data" | "lembrete"`
- `BoardCard.followupAttempt`, `BoardCard.pkg`
- `funnelLine(f)`

### Arquivos que o Lote 1C mexe

**Criados**
- `drizzle/0024_funil_novo.sql`, `drizzle/meta/0024_snapshot.json`
- `src/lib/attempts.ts`, `src/lib/attempts.test.ts`
- `src/lib/stage-kinds.ts`
- `src/server/domain/attempts.ts`, `src/server/domain/attempts.test.ts`
- `src/server/domain/funnel.ts`, `src/server/domain/funnel-waiting.test.ts`, `src/server/domain/funnel-attempts.test.ts`, `src/server/domain/funnel-attended.test.ts`
- `src/server/domain/funnel-migration.ts`, `src/server/domain/funnel-migration.test.ts`
- `src/server/domain/stage-kind.test.ts`
- `src/server/domain/avec/funnel-sync.ts`, `src/server/domain/avec/funnel-sync.test.ts`
- `src/server/stage-keys.test.ts`
- `scripts/migrar-funil-lote1c.ts`, `scripts/simular-motor.ts`

**Modificados: servidor**
- `src/server/db/schema.ts`, `src/server/db/seed-data.ts`
- `src/server/domain/deals.ts`, `src/server/domain/tasks.ts`, `src/server/domain/updates.ts`
- `src/server/domain/resume-later.ts`, `src/server/domain/overdue-waits.ts`, `src/server/domain/conversation-archive.ts`
- `src/server/domain/start-conversation.ts`, `src/server/domain/appointments.ts`, `src/server/domain/bulk.ts`, `src/server/domain/events.ts`
- `src/server/domain/avec/apply.ts`
- `src/server/rules/types.ts`, `src/server/rules/engine.ts`
- `src/server/queries/board.ts`, `src/server/queries/journey.ts`, `src/server/queries/queue.ts`, `src/server/queries/today.ts`
- `src/server/reports/common.ts`, `src/server/reports/queries.ts`, `src/server/reports/team.ts`
- `worker/index.ts`

**Modificados: telas e rotas**
- `src/app/(app)/funil/actions.ts`, `src/app/api/relatorios/avec/route.ts`
- `src/components/queue/resume-later-sheet.tsx`, `src/components/queue/use-lead-actions.tsx`, `src/components/queue/client-pane.tsx`
- `src/components/queue/pane-header.tsx`, `src/components/queue/stage-path.tsx`
- `src/components/pipeline/board.tsx`, `src/components/pipeline/deal-card.tsx`
- `src/components/lead/lead-sheet.tsx`
- `src/components/config/stages.tsx`, `src/components/config/automations.tsx`
- `src/components/relatorios-avec/format.ts`, `src/components/relatorios-avec/upload-button.tsx`
- `src/lib/history.ts`, `src/lib/primary-action.ts`, `src/lib/alert-copy.ts`

**Modificados: scripts, documentação e e2e**
- `scripts/importar-avec.ts`
- `docs/deploy-contabo.md`
- `e2e/quadro.spec.ts`, `e2e/fluxo.spec.ts`, `e2e/jornada.spec.ts`, `e2e/acoes-fila.spec.ts`, `e2e/cliente.spec.ts`, `e2e/conversa.spec.ts`

**Testes ajustados**
- `src/server/db/schema.test.ts`, `src/server/db/seed.test.ts`
- `src/server/rules/engine.test.ts`
- `src/server/queries/journey.test.ts`, `src/server/queries/board.test.ts`, `src/server/queries/queue.test.ts`
- `src/server/domain/deals.test.ts`, `src/server/domain/bulk.test.ts`, `src/server/domain/overdue-waits.test.ts`
- `src/lib/history.test.ts`, `src/lib/primary-action.test.ts`, `src/lib/alert-copy.test.ts`
- `src/components/queue/queue-list.render.test.tsx`
- `src/components/relatorios-avec/format.test.ts`

**Pontos de contato com os Lotes 1A e 1B (já feitos antes deste)**
- `deals.ts`: a A3 reescreveu `recordOutbound` e o `importHistoryChat`; a C2 troca `moveDealTx`, a C5 mexe em `recordInbound` e a C10 troca as chaves pelo tipo nas versões da A3.
- `board.ts` e `deal-card.tsx`: a A6 mexeu no `map` dos cards e no prefixo "Cati:"; a B3 no relógio; a C9 só acrescenta `pkg`/`followupAttempt` e o selo.
- `client-pane.tsx`: a A6 pôs "Respondida por", a B7 o "Responsável" com dica e o `askAttendance`; a C3 acrescenta os botões e a situação das tentativas.
- `alert-copy.ts`: a C3 troca `PARADOS_ACTIONS` e a C9 acrescenta os selos à ajuda.
- `engine.ts` e `engine.test.ts`: a B8 pôs o texto fixo da espera; a C1 ajusta o teste para a escalada em 30 min e a C6 troca a ação de follow-up.

---

## Implantação

Só depois das tarefas A1 a C12 commitadas e com o ok do dono para cada passo que grava em produção. Fora do expediente da Casa (ter–sáb, 9h–18h): de preferência depois das 18h ou no domingo/segunda. Nada aqui envia WhatsApp. O mesmo roteiro fica em `docs/deploy-contabo.md` (Tarefa C12, Passo 2).

**I0. Testes verdes (no Mac, na branch `rodada-2`)**

```bash
npm test && npm run typecheck && npm run lint && npm run build && npx playwright test
npx vitest run test/evolution-guard.test.ts
git status --short   # só os arquivos que já estavam soltos antes do plano
npm run db:migrate   # aplica 0023 e 0024 também no banco local de desenvolvimento (o next dev da pasta crm usa ele)
```
Esperado: tudo PASS. Qualquer falha: parar aqui.

**I1. Pacote do código (só o que está commitado)**

```bash
git archive --format=tar.gz -o /tmp/crm-r14.tgz HEAD && scp /tmp/crm-r14.tgz casafiaes:~/ && rm /tmp/crm-r14.tgz
```
`git archive` deixa de fora `.env`, `.next-copia/`, as imagens soltas e qualquer arquivo não commitado.

**I2. Build em pasta nova, sem parar o que está no ar (`ssh casafiaes`)**

```bash
ls -d /opt/crm*        # no ar é a r13 → a nova é r14 (se for outro número, troque 14/13 em todos os comandos)
sudo mkdir /opt/crm-r14 && sudo tar -xzf ~/crm-r14.tgz -C /opt/crm-r14 && sudo chown -R crm:crm /opt/crm-r14 && rm ~/crm-r14.tgz
sudo -u crm cp /opt/crm/.env /opt/crm-r14/.env && grep -E "MEDIA_DIR|REPORTS_DIR" /opt/crm-r14/.env
diff -rq --exclude=node_modules --exclude=.next --exclude=.env /opt/crm /opt/crm-r14 | grep "^Only in /opt/crm:"
cd /opt/crm-r14 && sudo -u crm npm ci && sudo -u crm npm run build
```
Esperado:
- `MEDIA_DIR=/home/crm/crm-media` e `REPORTS_DIR=/home/crm/crm-relatorios` (fora das pastas de versão; senão a mídia some na troca);
- o `diff` sem nenhuma linha (nada no ar que não esteja no repositório; se aparecer arquivo, parar e trazer para o repositório antes);
- `next build` termina sem erro.

**I3. Backup** (com a versão antiga ainda no ar)

```bash
cd /opt/crm && sudo -u crm bash scripts/backup.sh
```
Esperado: a última linha imprime a pasta do backup em `/home/crm/backups/casa-fiaes-crm/…`. Anotar.

**I4. Parar web e worker**

```bash
sudo -u crm pm2 stop crm-web crm-worker
```

**I5. Migrar e semear com o código novo**

```bash
cd /opt/crm-r14 && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key, enabled, trigger->>'minutes' as minutos from automations where key in ('gestao_10min','followup_diario','parado_1dia','casa_falou_4h','parado_etapa') order by key"
```
Esperado: migrations `0023_quem_atende` e `0024_funil_novo` aplicadas; `gestao_10min` com 30, `followup_diario` e `parado_1dia` com `f`, `casa_falou_4h` e `parado_etapa` com `t`.

**I6. Troca de pasta e só a web de volta**

```bash
sudo mv /opt/crm /opt/crm-anterior-r13 && sudo mv /opt/crm-r14 /opt/crm
cd /opt/crm && sudo -u crm pm2 start crm-web
curl -s https://crm.217-76-54-18.sslip.io/api/health
```
Esperado: a web responde; `worker.ok: false` é esperado (o worker fica parado até o fim do I10, para o motor não rodar contra o funil ainda não migrado). Abas abertas na Casa: recarregar a página (evita "Failed to find Server Action").

**I7. Assinaturas e acerto do Lote 1A (ensaio → aplicar)**

1. Em Configurações › Equipe (pela tela, como gestão): SARA em "Daniela Rezende" e CATI em "Natália Campos".
2. Ensaio, só leitura:
   ```bash
   cd /opt/crm && sudo -u crm npx tsx scripts/autoria-assinaturas.ts --dry-run
   ```
   Esperado: a tabela ANTES perto da auditoria de 15/10 (Sem dono × Sara ≈ 89, Sem dono × Cati ≈ 51, Sem dono × ninguém ≈ 15, Sara × Sara ≈ 16, Sara × Cati ≈ 10, Sara × ninguém ≈ 4; varia com as conversas novas) e o "Sem dono" do DEPOIS perto de 15 mais as conversas novas.
3. Mostrar ao dono as duas tabelas e o aviso de mudança: com a Cati (Gestão) dona de cerca de 51 conversas, elas **saem da Fila da Sara** (Atendente vê as dela e as sem dono); a Cati passa a receber os avisos de espera dessas conversas; o "visto azul" deixa de sair quando a gestão só abre a conversa.
4. Com o ok:
   ```bash
   sudo -u crm npx tsx scripts/autoria-assinaturas.ts --aplicar
   ```
   Esperado: `Backup: /home/crm/backups/autoria-assinaturas-…-antes.json`, "A tabela bate com o DEPOIS do ensaio." e "Conferência: nada pendente.". Para voltar: `sudo -u crm npx tsx scripts/autoria-assinaturas.ts --desfazer <esse arquivo>`.

**I8. Tarefas sem responsável do Lote 1B (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/tarefas-sem-responsavel.ts --dry-run
```
Esperado: a tabela por tipo e destino; a auditoria de 15/10 contou 72 `proxima_acao` e 28 `comparecimento` sem responsável. Depois do I7, a maioria tem destino ("dona" ou "última resposta"). Mostrar ao dono; com o ok:
```bash
sudo -u crm env BACKUP_DIR=/home/crm/backups npx tsx scripts/tarefas-sem-responsavel.ts --aplicar
```
Esperado: "Backup: /home/crm/backups/tarefas-sem-responsavel-…-antes.json" e "Conferência: N continuam sem responsável", com N igual ao "sem destino" do ensaio.

**I9. Funil do Lote 1C (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --dry-run
```
Esperado: comparar a tabela de conversas com a tabela "Migração" da spec (Atendimento: 7 → Agendado, 32 → Atendida/Fechado, 1 → Aguardando com pacote, 47 → Aguardando tentativa 1, 5 ficam; Follow-up 1: 41 → Aguardando mantendo a tarefa, 9 → Em conversa com "Responder", 6 → Atendida; Agendado: 25 ficam, 4 em revisão manual; contatos sem conversa com horário: só os que conversaram nos últimos 30 dias). Até 3 de diferença por linha é normal (conversas novas desde 15/10); mais que isso: parar e conferir. Mostrar ao dono a tabela e a lista de revisão manual; com o ok:
```bash
sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --aplicar --backup /home/crm/backups/funil-lote1c-$(date +%F)-antes.json
```
Esperado: "Conferência OK: nenhuma conversa fora do lugar." e a tabela DEPOIS com Em conversa perto de 5.

**I10. Ensaio do motor e worker**

```bash
sudo -u crm npx tsx scripts/simular-motor.ts
```
Esperado: nenhuma linha de `followup_diario` nem `parado_1dia`; o total de avisos previstos no próximo dia de expediente. Mais de 60: não ligar o worker, revisar com o dono. Até 60:
```bash
sudo -u crm pm2 start crm-worker && sudo -u crm pm2 save
curl -s https://crm.217-76-54-18.sslip.io/api/health
```
Esperado: `status: "ok"` e `worker.ok: true` em até 1 minuto.

**I11. Conferir os números (só leitura)**

```bash
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as sem_dono from deals d join contacts c on c.id=d.contact_id where d.owner_id is null and d.closed_at is null and d.archived_at is null and not c.ignored"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) filter (where sent_by_user_id is not null) as com_autora, count(*) as enviadas from messages where direction='out' and created_at > now()-interval '30 days'"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select kind, count(*) from tasks where done_at is null and assignee_id is null group by 1"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as combinados_vencidos from tasks t left join deals d on d.id=t.deal_id where t.done_at is null and t.kind='proxima_acao' and t.due_at < now() and (d.id is null or d.archived_at is null)"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select s.name, count(d.id) from stages s left join deals d on d.stage_id=s.id and d.closed_at is null and d.archived_at is null where s.active group by s.id order by s.position"
```
Esperado:
- `sem_dono` ≤ 15 + conversas novas desde o ensaio (spec 1A);
- `com_autora` perto das cerca de 2.154 assinadas (spec 1A);
- tarefas sem responsável = o "sem destino" do I8;
- `combinados_vencidos` igual ao número "N combinados vencidos" do resumo da Fila (a spec contou 45 em 15/10; muda com as tentativas novas);
- Em conversa perto de 5 (era 92), Follow-up 2–4 fora da lista.

No dia seguinte, a consulta de `automation_runs` do `docs/deploy-contabo.md` (passo 12): nenhum `followup_diario` nem `parado_1dia`.

**I12. Prints**

Navegador headless em segundo plano (sem abrir janela nem tomar o foco), logado como gestão (Joaquim, que não é dona de nenhuma conversa: com a A4, abrir conversa não manda visto). Desktop 1440 px e celular 390 px:
- Hoje: "Equipe agora", "Minhas próximas ações" com a aba "Sem responsável", Aniversários da semana;
- Fila: seções com a frase e o "?", resumo do topo, "Equipe agora", uma linha com "Cati:" e "Dona: Sara · respondida por Cati";
- uma conversa de outra dona: balão "Cati · pelo celular", relógio "Esperando há … (prazo …)", "Responsável" com a dica, "Tentativa 1/3" quando houver;
- Quadro (9 colunas, selo de tentativa e de pacote), Jornada (iniciais da dona), Agenda ("Conversa com: Sara");
- sino aberto (grupos, filtros, Resolver, legenda) e `/ajuda/avisos`;
- Configurações › Equipe com as assinaturas.

Salvar numa pasta só, `~/ClaudeGerado/casa-fiaes-crm-lotes-1-AAAA-MM-DD/`, mandar ao usuário e apagar a pasta depois de entregue.

**Voltar, se precisar**

- Código: `sudo -u crm pm2 stop crm-web crm-worker && sudo mv /opt/crm /opt/crm-r14-falhou && sudo mv /opt/crm-anterior-r13 /opt/crm && sudo -u crm pm2 start crm-web crm-worker`. As migrations são aditivas: a versão anterior funciona com o banco novo, mas as conversas já movidas para Orçamento enviado, Atendida ou Retorno sugerido aparecem nessas colunas sem as ações novas.
- Dados do 1A: `autoria-assinaturas.ts --desfazer <backup>`. Dados do 1B e do 1C: os JSON de backup guardam o estado de antes de cada linha (restauração à mão, com aprovação).
- Banco inteiro: o backup do I3, só se houver dano (perde o que entrou depois).

---

## Autoconferência (skill writing-plans)

### 1. Cobertura da spec

| Spec | Onde no plano |
|---|---|
| 1A · ler a assinatura `*NOME - CASA FIAES:*` (celular e ChatGuru) | A1 (regex aceita também minúscula, acento e travessão), A3 |
| 1A · campo "Assinatura" em Configurações › Equipe | A2 |
| 1A · `sent_by_user_id` + `sent_via` | A2, A3, A4 |
| 1A · dona automática pela assinatura, também Gestão (`deals.ts:50`, `:280`) | A3 (`pickOwner` fica; ver interpretação no topo do 1A) |
| 1A · com dona: não muda, selo "Respondida por" e aviso à dona | A3 (aviso `respondida_por_outra`), A6 (selo), B2/B8 (texto e grupo no sino), B10 (Resolver) |
| 1A · envio pelo CRM com a assinatura | A4 |
| 1A · visto só da dona ou ao responder (G27) | A4 |
| 1A · balão, Fila/Quadro, Jornada, Agenda | A5, A6, A7 |
| 1A · "Equipe agora" (Fila e Hoje) | A8 |
| 1A · "Fulana está nesta conversa" | **fora** (lacuna 1) |
| 1A · acerto para trás (30 dias, ~140 donas, backup JSON) e como testar (89/51/15/16/10/4; Sem dono ≤ 15) | A9, I7, I11 |
| 1B · 60% numa função, vermelho só com alerta, mesmas cores | B3 |
| 1B · "Prazo estourado" entra em Atrasados | B4 |
| 1B · seções com "?" e frase; Parados "Agendar, Aguardar cliente ou Encerrar" | B2, B5; frase final na C3 |
| 1B · resumo do topo | B4, B5 |
| 1B · linha (um prazo, Sem dono com dica, selos retirados, sinais ≤ 2 e só enquanto não respondidos, etiquetas à parte, "te passou") | B1, B4, B6 |
| 1B · cabeçalho e painel (relógio, WhyLate, Responsável, Compareceu? depois do horário) | B7 (e C5 para corrigir depois da mudança de etapa) |
| 1B · sino (grupos, filtros, Resolver, legenda) | B10 |
| 1B · textos dos alertas | B8 |
| 1B · tarefa sem responsável → dona/quem respondeu; aba "Sem responsável"; aniversários | B9, B11 |
| 1B · Histórico sem códigos crus | B12 (e C10 para os eventos do funil) |
| 1B · página "O que cada aviso quer dizer" | B13 (e C9 para os selos novos) |
| 1B · Push | **fora** (lacuna 2) |
| 1B · prints antes e depois; 45 combinados com o dia | B0, B14, I11, I12 |
| 1C · etapas novas e nomes (decisão 3) | C1, C11 (`migrateStagesConfig`) |
| 1C · Aguardando cliente: regra das 4 h, botão com "retomar em", Faltou/cancelou com Remarcar, 3 tentativas D+1/D+3/D+7, Perdido "Não respondeu mais" + recontato 30 dias | C6, C3, C5/C8, C2/C4 |
| 1C · Orçamento enviado (prazo de 2 dias) | C2, C3 |
| 1C · Agendado pelo Avec/CRM até 180 dias, data do mais próximo | C8 |
| 1C · Atendida (pós, 3 dias ou Encerrar → Fechado) | C5 |
| 1C · Retorno sugerido | C1 (etapa e entrada manual); automático no Lote 2 (lacuna 3) |
| 1C · pacote como selo | C9 |
| 1C · mudanças técnicas 1–8 | 1: C1 · 2: C5 · 3: C8 · 4: C7 · 5 e 6: C6 · 7: C9 · 8: C10 |
| 1C · migração com ensaio, backup e conferência; "Em conversa ≈ 5" | C11, I9, I11 |
| 1C · simular um dia do motor; Quadro sem encerradas | C12, I10; C9 |
| 1C · visibilidade por perfil | **fora** (lacuna 3; Atendente = Recepção) |
| Seção 4 · decisão 1 (Lote 0 não pode ser desfeito) | C1 (teste do seed), Global Constraints |
| Seção 4 · decisão 2 | A3, A9 |
| Seção 4 · decisão 3 | C1–C11 |
| Seção 4 · decisão 4 | C8, C11 |
| Seção 4 · decisão 5 | já aplicada no Lote 0 (fora deste plano) |
| Seção 5 · `nextWaitingId` ignora conversa encerrada | B4 |

### 2. Placeholders

Procurados: "TBD", "TODO", "implementar depois", "similar à Tarefa", "tratar erros adequadamente". Nenhum. Os únicos pontos condicionais são de conferência explícita com o comando a rodar (A2 Step 4 e C1 Passo 4: parar se o drizzle-kit gerar `DROP`; C12 Passo 3: o objeto `jornada` do e2e).

### 3. Consistência de nomes e tipos entre lotes

- `firstName`: um só em `src/lib/authorship.ts` (A5); `alert-copy.ts` (B2) reexporta; `src/lib/attempts.ts` (C2) usa `clientFirstName` (com "a cliente" de reserva).
- `QueueItem`: os campos da A6 (`ownerShort`, `lastAuthorName`, `repliedByName`) estão no tipo e na montagem reescritos pela B4; a B6 usa `lastMessagePrefix`/`ownerLine`/`stripSignature` da A6 na linha nova.
- `BoardCard`: o `map` da A6 (`lastReplyById`/`lastReplyName`) recebe `pkgUsed`/`pkgTotal` na C9.
- `client-pane.tsx` (`Owner`): "Respondida por" (A6) dentro do bloco reescrito pela B7; `askAttendance` (B7) ganha a correção pós-etapa na C5, sem segunda regra na tela.
- `warnOwnerRepliedByOther` (A3) passa a usar `alertText.repliedByOther` (B8); o grupo e a ajuda do tipo `respondida_por_outra` estão na B2; o teste de texto da A3 continua igual.
- `defaultAssignee` (B9) usa `deals.lastReplyById` (A2/A3/A9) antes das mensagens.
- `PARADOS_ACTIONS` (B2) trocado na C3 junto com os dois testes que o citam.
- Teste do escalado da B8 (`min(10)`) ajustado na C1 para os 30 min do Lote 0.
- Migrations: `0023_quem_atende` (A2) e `0024_funil_novo` (C1).

### 4. Review Focus

Os cinco itens do topo têm teste: B3 Passo 1, A4 Step 1, A1 Step 1 + A3 Step 1, A3 Step 1, C4 Passo 1.

### Lacunas que o plano não cobre

1. **"Fulana está nesta conversa"** (presença em tempo real, 1A): fora, como recomenda `docs/analise-2026-10-15/critica.md` (d).
2. **Push** de tarefas e transferências e o pedido de inscrição no primeiro login (1B): fora.
3. **Visibilidade de etapas por perfil** (1C) fica fora porque Atendente = Recepção; **Retorno sugerido automático** fica para o Lote 2; **"Fechado/Perdido e a cliente escreve → Em conversa"** fica para o Lote 3.
4. **Rotina diária de importação do Avec** (risco da spec 1C): é operação, não código; sem ela, as regras do C8 só valem a cada importação manual.
5. **Desfazer pronto só no 1A.** Os scripts do 1B e do 1C guardam backup JSON do estado anterior, mas não têm `--desfazer`; voltar é restauração à mão.
6. **"Sem responsável" escolhido na folha** ("Quem retoma") vira dona/quem respondeu por último, porque `createTaskTx` (B9) não distingue `null` escolhido de `null` por falta de dona.
7. **`scripts/seed-demo.ts`** ainda cria conversas em Follow-up 2–4 (etapas desativadas pela C1); a demo está desligada e o plano não a ajusta.
8. Os números de linha citados vêm das três partes, escritas sobre o código antes dos lotes; as tarefas que mexem em arquivo já tocado por um lote anterior pedem `grep -n` para achar o ponto.
