import { and, eq, sql } from "drizzle-orm";
import { formAnswers, formQuestions } from "../../db/schema";
import { visitForDayTx } from "../agenda/visits";
import { isFuncaoOn } from "../funcoes";
import type { FichaForm } from "@/lib/fichas";
import type { ContactRef, ImportCtx } from "./context";
import { COLS } from "./formats";
import { dateIso, normText } from "./normalize";

/**
 * Fichas do Avec: 0115 e 2115 (anamnese, uma resposta por cliente) e 0116 (prontuário, com a coluna Comanda: vai para a consultoria de
 * imagem da visita do dia). Uma linha = uma resposta (Campo, Slug, Valor). O valor entra como texto, como veio do Avec.
 * A chave `avec:ficha:<cliente>:<pergunta>:<dia|->` deixa reimportar sem duplicar. Resposta dada ou mexida no CRM nunca é sobrescrita.
 * Função Fichas desligada: não grava nada (e as linhas não viram recusadas).
 */

/** Rótulo para casar: sem acento, caixa, pontuação nem espaços a mais ("Como conheceu a Casa?" = "como conheceu a casa"). */
const labelKey = (s: string | null | undefined) => normText(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

type Question = { id: string; label: string; avecSlug: string | null; position: number };

export async function importFichas(ctx: ImportCtx): Promise<void> {
  if (!(await isFuncaoOn("fichas", ctx.tx))) { ctx.summary.fichasDesligada = 1; return; }
  const tx = ctx.tx;
  const ix = { campo: ctx.col("campo"), slug: ctx.col("slug"), valor: ctx.col("valor"), day: ctx.col("data"), comanda: ctx.col(...COLS.comanda), since: ctx.col("data cadastro") };
  const form: FichaForm = ix.comanda >= 0 ? "consultoria" : "anamnese";

  const loaded = await tx.select({ id: formQuestions.id, label: formQuestions.label, avecSlug: formQuestions.avecSlug, position: formQuestions.position })
    .from(formQuestions).where(eq(formQuestions.form, form));
  const questions: Question[] = [...loaded];
  const findQuestion = (label: string, slug: string) => {
    const bySlug = slug ? questions.find((q) => q.avecSlug && labelKey(q.avecSlug) === labelKey(slug)) : undefined;
    return bySlug ?? questions.find((q) => labelKey(q.label) === labelKey(label));
  };
  /** A consultoria cria a pergunta que falta (rótulo exato do Campo), no fim da ficha, na ordem em que aparece no arquivo. */
  const createQuestion = async (label: string, slug: string): Promise<Question> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('form_questions:' || ${form}))`);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${formQuestions.position}) + 1, 0)::int` }).from(formQuestions).where(eq(formQuestions.form, form));
    const [n] = await tx.insert(formQuestions).values({ form, position: next, label, kind: "texto_longo", avecSlug: slug || null }).returning({ id: formQuestions.id, label: formQuestions.label, avecSlug: formQuestions.avecSlug, position: formQuestions.position });
    questions.push(n);
    return n;
  };

  const contactCache = new Map<string, ContactRef | null>();
  for (const row of ctx.rows) {
    const label = ctx.cell(row, ix.campo).replace(/\s+/g, " ");
    const value = ctx.cell(row, ix.valor);
    if (!label || !value) continue; // valor vazio não grava
    const { name } = ctx.clientOf(row);
    if (!name) continue;

    let ref = contactCache.get(normText(name));
    if (ref === undefined) { ref = await ctx.contactRefOf(row); contactCache.set(normText(name), ref); }
    const since = dateIso(ctx.cell(row, ix.since));
    if (!ref) {
      await ctx.reject({ key: `ficha:${normText(name)}`, reason: "cliente_nao_encontrada", day: since ?? dateIso(ctx.cell(row, ix.day)) ?? ctx.now.toISOString().slice(0, 10), hm: null, name, contactId: null, pro: null, service: null });
      continue;
    }

    const contactId = ref.id;
    let visitId: string | null = null;
    if (form === "consultoria") {
      const day = dateIso(ctx.cell(row, ix.day)) ?? since;
      if (!day) { ctx.summary.fichasIgnoradas++; continue; }
      visitId = await visitForDayTx(tx, { contactId, clientName: name }, day, null, ctx.now, "avec");
    }

    const slug = ctx.cell(row, ix.slug);
    const question = findQuestion(label, slug) ?? (form === "consultoria" ? await createQuestion(label, slug) : undefined);
    if (!question) { ctx.summary.fichasIgnoradas++; continue; } // anamnese: pergunta que a Casa não tem não é criada

    const where = and(eq(formAnswers.contactId, contactId), eq(formAnswers.questionId, question.id),
      visitId ? eq(formAnswers.visitId, visitId) : sql`${formAnswers.visitId} is null`);
    // A chave é da cliente do Avec (`keyId`): depois de um "Unir cadastros", a da que saiu continua sendo a dela.
    const externalKey = `avec:ficha:${ref.keyId}:${question.id}:${visitId ? (dateIso(ctx.cell(row, ix.day)) ?? since ?? "-") : "-"}`;
    const [old] = await tx.select({ id: formAnswers.id, source: formAnswers.source, value: formAnswers.value, externalKey: formAnswers.externalKey }).from(formAnswers).where(where);
    if (old) {
      // Já tem resposta da cliente nesta pergunta (e visita): a do CRM nunca é tocada (com ou sem chave); a do Avec só muda se o valor mudou
      // e só pela mesma linha do Avec (cadastros unidos: a resposta da que ficou não é trocada pela da que saiu).
      if (old.source !== "avec" || old.value === value || (old.externalKey && old.externalKey !== externalKey)) continue;
      await tx.update(formAnswers).set({ value, answeredAt: since ? new Date(`${since}T12:00:00Z`) : ctx.now }).where(and(eq(formAnswers.id, old.id), eq(formAnswers.source, "avec")));
      ctx.summary.fichas++;
      continue;
    }
    const done = await tx.insert(formAnswers).values({ contactId, questionId: question.id, visitId, value, source: "avec", externalKey, answeredAt: since ? new Date(`${since}T12:00:00Z`) : ctx.now })
      .onConflictDoUpdate({ target: formAnswers.externalKey, targetWhere: sql`${formAnswers.externalKey} is not null`, set: { value, answeredAt: sql`excluded.answered_at` }, setWhere: sql`${formAnswers.source} = 'avec'` })
      .returning({ id: formAnswers.id });
    if (done.length) ctx.summary.fichas++;
  }
}

