import { eq, inArray, sql } from "drizzle-orm";
import { contacts, loyaltyEntries } from "../../db/schema";
import { isFuncaoOn } from "../funcoes";
import { UserFacingError } from "../errors";
import { getAvecLoyaltyProgramId } from "../fidelidade-programas";
import type { ContactRef, ImportCtx } from "./context";
import { mergedPersonFor } from "../merge-contacts";
import { normText } from "./normalize";

/**
 * Saldos de fidelidade do Avec: 0113 "Pontos de fidelidade acumulados por cliente" (Cliente, Celular, E-mail, Última Pontuação, Pontos Gerados,
 * Saldo Atual). Cada cliente achada PELO TELEFONE com Saldo Atual > 0 ganha uma linha `saldo_avec` no extrato, de chave `avec:fid:<contato>`
 * (depois de um "Unir cadastros", a da que saiu continua com a chave dela, na que ficou):
 * importar de novo TROCA o valor (não soma). Saldo 0 tira a linha antiga. Não cria cliente e não usa o nome para achá-la.
 * O programa que recebe é o de Serviços › Fidelidade (setting `fidelidade_programa_avec`); o padrão é o "Fiel da Fiaes".
 * Função Fidelidade desligada: não grava nada.
 */

/** "23", "23,00", "1.234" ou "23.0" → inteiro; o que não é número vira 0. */
function pointsOf(raw: string): number {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return 0;
  const n = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export async function importLoyaltyBalances(ctx: ImportCtx): Promise<void> {
  if (!(await isFuncaoOn("fidelidade", ctx.tx))) { ctx.summary.fidelidadeDesligada = 1; return; }
  const tx = ctx.tx;
  const programId = await getAvecLoyaltyProgramId(tx);
  if (!programId) throw new UserFacingError("Fidelidade: não há programa para receber os saldos. Crie ou escolha um em Serviços › Fidelidade.");
  const ix = { saldo: ctx.col("saldo atual") };
  if (ix.saldo < 0) return;

  /**
   * Contato do telefone: a pessoa do número cujo nome é o da linha; senão, o titular. Telefone ou nome de uma cliente que saiu num "Unir
   * cadastros" (0086): a que ficou, com a chave da que saiu (`keyId`): as duas linhas de saldo continuam, cada uma trocada pela sua linha do Avec.
   */
  const byPhone = new Map<string, { id: string; keyId: string; people: { id: string; name: string | null }[] } | null>();
  const contactOf = async (row: string[]): Promise<ContactRef | null> => {
    const phone = ctx.phoneOf(row);
    if (!phone) return null;
    let hit = byPhone.get(phone);
    if (hit === undefined) {
      const [h] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
      const m = h ? null : await ctx.mergedPhone(phone);
      const holder = h ? { id: h.id, keyId: h.id } : m ? { id: m.keptId, keyId: m.droppedId } : null;
      hit = holder ? { ...holder, people: await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.sharesPhoneWith, holder.id)) } : null;
      byPhone.set(phone, hit);
    }
    if (!hit) return null;
    const { name } = ctx.clientOf(row);
    const key = normText(name);
    const person = key ? hit.people.find((p) => normText(p.name) === key) : undefined;
    if (person) return { id: person.id, keyId: person.id };
    const gone = key ? await mergedPersonFor(tx, { phone, holderId: hit.id, name }) : null;
    if (gone) return { id: gone.keptId, keyId: gone.droppedId };
    return { id: hit.id, keyId: hit.keyId };
  };

  // O saldo de cada cliente do Avec (a última linha do arquivo vale).
  const balances = new Map<string, { contactId: string; saldo: number }>();
  for (const row of ctx.rows) {
    const ref = await contactOf(row);
    if (ref) balances.set(`avec:fid:${ref.keyId}`, { contactId: ref.id, saldo: pointsOf(ctx.cell(row, ix.saldo)) });
  }
  if (!balances.size) return;

  const old = new Map((await tx.select().from(loyaltyEntries).where(inArray(loyaltyEntries.externalKey, [...balances.keys()])))
    .map((e) => [e.externalKey!, e]));
  for (const [externalKey, { contactId, saldo }] of balances) {
    const before = old.get(externalKey);
    if (saldo <= 0) {
      if (before) await tx.delete(loyaltyEntries).where(eq(loyaltyEntries.id, before.id));
      continue;
    }
    if (before && before.delta === saldo && before.programId === programId && before.contactId === contactId) continue;
    await tx.insert(loyaltyEntries).values({ contactId, programId, delta: saldo, reason: "saldo_avec", note: "Saldo trazido do Avec", externalKey, createdAt: ctx.now })
      .onConflictDoUpdate({ target: loyaltyEntries.externalKey, targetWhere: sql`${loyaltyEntries.externalKey} is not null`, set: { delta: saldo, programId, contactId } });
    ctx.summary.saldosFidelidade++;
  }
}
