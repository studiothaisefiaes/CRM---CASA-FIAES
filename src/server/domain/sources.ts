import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, leadSources, type LeadSource } from "../db/schema";

import { SOURCE_KINDS } from "../../lib/source-kinds";
export { SOURCE_KINDS, SOURCE_KIND_LABEL, type SourceKind } from "../../lib/source-kinds";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LEN = 8;
const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const createSchema = z.object({
  label: z.string().trim().min(1, "Dê um nome para a origem.").max(60, "Nome muito longo."),
  kind: z.enum(SOURCE_KINDS),
  prefill: z.string().trim().max(160, "Frase muito longa.").nullish(),
  referrerContactId: z.string().uuid().nullish(),
});

export async function createSource(input: z.input<typeof createSchema>, userId: string): Promise<{ id: string; code: string; label: string; prefill: string | null }> {
  const v = createSchema.parse(input);
  for (let attempt = 0; attempt < 8; attempt++) {
    const [row] = await db.insert(leadSources).values({
      code: newCode(), label: v.label, kind: v.kind, prefill: v.prefill || null, referrerContactId: v.referrerContactId ?? null,
    }).onConflictDoNothing({ target: leadSources.code }).returning();
    if (row) {
      await db.insert(auditLog).values({ userId, action: "criou", entity: "lead_source", entityId: row.id, data: { label: row.label, kind: row.kind, code: row.code } });
      return { id: row.id, code: row.code, label: row.label, prefill: row.prefill };
    }
  }
  throw new Error("Não foi possível gerar um código único. Tente de novo.");
}

export async function setSourceActive(id: string, active: boolean, userId: string) {
  z.string().uuid().parse(id);
  await db.update(leadSources).set({ active }).where(eq(leadSources.id, id));
  await db.insert(auditLog).values({ userId, action: active ? "ativou" : "desativou", entity: "lead_source", entityId: id, data: {} });
}

export const listSources = (): Promise<LeadSource[]> => db.select().from(leadSources).orderBy(desc(leadSources.createdAt));

/** Link do WhatsApp com a frase pronta + o código da origem. `phoneE164` aceita "+55 71 …": só os dígitos entram. */
export function sourceLink(source: { code: string; prefill?: string | null }, phoneE164: string): string {
  const text = `${source.prefill?.trim() ? `${source.prefill.trim()} ` : ""}#${source.code}`;
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

const MIN_PHRASE = 12;
/** Minúsculas, sem acento, espaços colapsados: a comparação da frase do link. */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Reconhece a origem pela 1ª mensagem do lead: `#código` em qualquer ponto; se a cliente apagou o código,
 * a frase do link (sem diferenciar maiúsculas, acentos nem espaços). Origens desativadas não reconhecem.
 */
export async function matchSource(firstMessage: string | null | undefined, tx: Tx | typeof db = db): Promise<{ id: string; label: string } | null> {
  if (!firstMessage?.trim()) return null;
  const active = await tx.select().from(leadSources).where(eq(leadSources.active, true));
  if (!active.length) return null;
  for (const m of firstMessage.toLowerCase().matchAll(/#([a-z0-9]{6,12})(?![a-z0-9])/g)) {
    const hit = active.find((s) => s.code === m[1]);
    if (hit) return { id: hit.id, label: hit.label };
  }
  const text = norm(firstMessage);
  // Reserva por frase: mínimo de 12 caracteres (frases curtas casam em conversa comum); a mais longa vence
  // e, se duas origens ativas empatam no maior comprimento, não atribui nenhuma (melhor sem origem que errada).
  const hits = active
    .filter((s) => s.prefill && norm(s.prefill).length >= MIN_PHRASE && text.includes(norm(s.prefill)))
    .map((s) => ({ s, len: norm(s.prefill!).length }));
  const best = Math.max(0, ...hits.map((h) => h.len));
  const top = hits.filter((h) => h.len === best);
  const byPhrase = top.length === 1 ? top[0].s : null;
  return byPhrase ? { id: byPhrase.id, label: byPhrase.label } : null;
}
