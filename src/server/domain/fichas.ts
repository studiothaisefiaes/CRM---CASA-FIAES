import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../db";
import { auditLog, contacts, formAnswers, formQuestions, visits } from "../db/schema";
import { UserFacingError } from "./errors";
import { assertFuncao } from "./funcoes";
import { isUuid } from "@/lib/uuid";
import {
  FICHA_FORMS, OPTION_MAX, QUESTION_KINDS, QUESTION_LABEL_MAX, hasOptions, validateAnswer,
  type AnswerValue, type FichaForm, type QuestionKind,
} from "@/lib/fichas";

type Q = Tx | typeof db;
export type FormQuestion = { id: string; form: FichaForm; position: number; label: string; kind: QuestionKind; options: string[]; active: boolean;
  /** Já tem alguma resposta: o tipo não pode mais mudar. */ answered: boolean };
export type FichaQA = { questionId: string; label: string; kind: QuestionKind; options: string[]; value: AnswerValue | null; answeredAt: string | null };
export type Ficha = { anamnese: FichaQA[]; consultorias: { visitId: string; day: string; items: FichaQA[] }[]; campos: FichaQA[] };

/** Valor da resposta que a recepção limpou no CRM mas veio do Avec: fica gravada (para a importação não repor) e conta como sem resposta. */
export const CLEARED = "";
const NOT_FOUND = "Pergunta não encontrada.";
const toQuestion = (r: typeof formQuestions.$inferSelect, answered = false): FormQuestion => ({
  id: r.id, form: r.form as FichaForm, position: r.position, label: r.label, kind: r.kind as QuestionKind, options: r.options, active: r.active, answered,
});

/** As perguntas de uma ficha, na ordem. Por padrão só as em uso (o que se preenche); `all` traz também as desativadas (Configurações). */
export async function listQuestions(form: FichaForm, opts: { all?: boolean } = {}, q: Q = db): Promise<FormQuestion[]> {
  const rows = await q.select().from(formQuestions).where(eq(formQuestions.form, form)).orderBy(asc(formQuestions.position), asc(formQuestions.createdAt));
  const ids = rows.map((r) => r.id);
  const done = ids.length ? new Set((await q.selectDistinct({ id: formAnswers.questionId }).from(formAnswers).where(inArray(formAnswers.questionId, ids))).map((r) => r.id)) : new Set<string>();
  return rows.filter((r) => opts.all || r.active).map((r) => toQuestion(r, done.has(r.id)));
}

const saveSchema = z.object({
  // Sem `.uuid()` estrito: as perguntas da Casa nascem na migration com id md5, que não é UUID v4.
  id: z.string().refine(isUuid, "Pergunta não encontrada.").optional(),
  form: z.enum(FICHA_FORMS),
  label: z.string().trim().min(1, "Escreva a pergunta.").max(QUESTION_LABEL_MAX, `Use até ${QUESTION_LABEL_MAX} caracteres na pergunta.`),
  kind: z.enum(QUESTION_KINDS),
  options: z.array(z.string()).optional(),
});

/** Opções limpas: espaços ajustados, sem vazias nem repetidas (igualdade exata). */
function cleanOptions(raw: string[]): string[] {
  const out: string[] = [];
  for (const o of raw) {
    const v = o.replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (v.length > OPTION_MAX) throw new UserFacingError(`Use até ${OPTION_MAX} caracteres em cada opção.`);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Cria (sem id, no fim da ficha) ou edita uma pergunta. A pergunta não muda de ficha. Não existe apagar: a resposta antiga fica.
 * Só quem tem config.fichas (a action confere) e com a função fichas ligada.
 */
export async function saveQuestion(input: { id?: string; form: FichaForm; label: string; kind: QuestionKind; options?: string[] }, userId: string): Promise<{ id: string }> {
  await assertFuncao("fichas");
  const v = saveSchema.parse({ ...input, label: input.label.replace(/\s+/g, " ") });
  const options = hasOptions(v.kind) ? cleanOptions(v.options ?? []) : [];
  if (hasOptions(v.kind) && options.length < 2) throw new UserFacingError("Escreva ao menos duas opções.");
  return db.transaction(async (tx) => {
    if (v.id) {
      const [old] = await tx.select().from(formQuestions).where(eq(formQuestions.id, v.id));
      if (!old) throw new UserFacingError(NOT_FOUND);
      if (old.form !== v.form) throw new UserFacingError("Não dá para mudar a pergunta de ficha.");
      if (old.kind !== v.kind) {
        const [has] = await tx.select({ id: formAnswers.id }).from(formAnswers).where(eq(formAnswers.questionId, v.id)).limit(1);
        if (has) throw new UserFacingError("Essa pergunta já tem respostas. Crie uma nova e tire esta de uso.");
      }
      await tx.update(formQuestions).set({ label: v.label, kind: v.kind, options }).where(eq(formQuestions.id, v.id));
      await tx.insert(auditLog).values({ userId, action: "ficha_pergunta_editada", entity: "form_question", entityId: v.id, data: { form: v.form, de: { label: old.label, kind: old.kind, options: old.options }, para: { label: v.label, kind: v.kind, options } } });
      return { id: v.id };
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('form_questions:' || ${v.form}))`);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${formQuestions.position}) + 1, 0)::int` }).from(formQuestions).where(eq(formQuestions.form, v.form));
    const [n] = await tx.insert(formQuestions).values({ form: v.form, position: next, label: v.label, kind: v.kind, options, createdBy: userId }).returning({ id: formQuestions.id });
    await tx.insert(auditLog).values({ userId, action: "ficha_pergunta_editada", entity: "form_question", entityId: n.id, data: { form: v.form, criou: true, label: v.label, kind: v.kind, options } });
    return { id: n.id };
  });
}

/** Sobe ou desce a pergunta, trocando de lugar com a vizinha da mesma ficha (as desativadas contam). No limite não faz nada. */
export async function moveQuestion(id: string, dir: "up" | "down", userId: string): Promise<void> {
  await assertFuncao("fichas");
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(formQuestions).where(eq(formQuestions.id, id));
    if (!cur) throw new UserFacingError(NOT_FOUND);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('form_questions:' || ${cur.form}))`);
    const list = await tx.select({ id: formQuestions.id, position: formQuestions.position }).from(formQuestions).where(eq(formQuestions.form, cur.form))
      .orderBy(asc(formQuestions.position), asc(formQuestions.createdAt));
    const i = list.findIndex((r) => r.id === id), j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    // Renumera a ficha toda (0..n-1) já com a troca: garante posições distintas mesmo se alguma estiver repetida.
    const order = list.map((r) => r.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [pos, qid] of order.entries()) await tx.update(formQuestions).set({ position: pos }).where(eq(formQuestions.id, qid));
    await tx.insert(auditLog).values({ userId, action: "ficha_pergunta_editada", entity: "form_question", entityId: id, data: { form: cur.form, moveu: dir } });
  });
}

/** Põe a pergunta em uso ou tira de uso. Quem já respondeu continua com a resposta na ficha. */
export async function setQuestionActive(id: string, active: boolean, userId: string): Promise<void> {
  await assertFuncao("fichas");
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(formQuestions).where(eq(formQuestions.id, id));
    if (!old) throw new UserFacingError(NOT_FOUND);
    if (old.active === active) return;
    await tx.update(formQuestions).set({ active }).where(eq(formQuestions.id, id));
    await tx.insert(auditLog).values({ userId, action: "ficha_pergunta_editada", entity: "form_question", entityId: id, data: { form: old.form, de: { active: old.active }, para: { active } } });
  });
}

/**
 * Grava (ou troca) a resposta de uma pergunta. Vazio apaga a resposta. A consultoria exige a visita (e ela tem que ser da cliente);
 * a anamnese e os campos recusam visita. Pergunta fora de uso não recebe resposta nova. A auditoria guarda só o id da pergunta, nunca o valor.
 * Quem pode responder (fichas.responder) a action confere.
 */
export async function saveAnswer(input: { contactId: string; questionId: string; visitId?: string | null; value: unknown }, userId: string): Promise<void> {
  await assertFuncao("fichas");
  await db.transaction(async (tx) => {
    const [question] = await tx.select().from(formQuestions).where(eq(formQuestions.id, input.questionId));
    if (!question) throw new UserFacingError(NOT_FOUND);
    if (!question.active) throw new UserFacingError("Essa pergunta não está mais em uso.");
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
    if (!contact) throw new UserFacingError("Cliente não encontrada.");
    let visitId: string | null = null;
    if (question.form === "consultoria") {
      if (!input.visitId) throw new UserFacingError("A consultoria de imagem é de uma visita. Escolha a visita.");
      const [visit] = await tx.select({ id: visits.id, contactId: visits.contactId }).from(visits).where(eq(visits.id, input.visitId));
      if (!visit) throw new UserFacingError("Visita não encontrada.");
      if (visit.contactId !== input.contactId) throw new UserFacingError("Essa visita não é desta cliente.");
      visitId = visit.id;
    } else if (input.visitId) {
      throw new UserFacingError("Essa ficha é da cliente, não de uma visita.");
    }
    const value = validateAnswer(question.kind as QuestionKind, question.options, input.value);
    const same = and(eq(formAnswers.contactId, input.contactId), eq(formAnswers.questionId, input.questionId), visitId ? eq(formAnswers.visitId, visitId) : sql`${formAnswers.visitId} is null`);
    if (value === null) {
      // Resposta que veio do Avec (tem external_key) não é apagada: vira "limpa" (valor vazio, do CRM). Assim a importação não a traz de volta.
      const [old] = await tx.select({ id: formAnswers.id, externalKey: formAnswers.externalKey }).from(formAnswers).where(same);
      if (old?.externalKey) await tx.update(formAnswers).set({ value: CLEARED, source: "crm", answeredBy: userId, answeredAt: new Date() }).where(eq(formAnswers.id, old.id));
      else if (old) await tx.delete(formAnswers).where(eq(formAnswers.id, old.id));
    } else {
      await tx.insert(formAnswers).values({ contactId: input.contactId, questionId: input.questionId, visitId, value, source: "crm", answeredBy: userId })
        .onConflictDoUpdate({
          target: [formAnswers.contactId, formAnswers.questionId, formAnswers.visitId],
          set: { value, source: "crm", answeredBy: userId, answeredAt: new Date(), },
        });
    }
    await tx.insert(auditLog).values({ userId, action: "ficha_respondida", entity: "contact", entityId: input.contactId, data: { questionId: input.questionId, visitId, ...(value === null ? { apagou: true } : {}) } });
  });
}

/**
 * A ficha inteira da cliente. Anamnese e campos: todas as perguntas em uso (com a resposta, ou null) e as desativadas que ela já respondeu.
 * Consultorias: uma por visita com resposta, a mais nova primeiro, com as mesmas regras de perguntas. Só lê (quem pode ver, a action confere).
 */
export async function fichaOf(contactId: string, q: Q = db): Promise<Ficha> {
  const [questions, answers] = await Promise.all([
    q.select().from(formQuestions).orderBy(asc(formQuestions.position), asc(formQuestions.createdAt)),
    q.select().from(formAnswers).where(eq(formAnswers.contactId, contactId)),
  ]).then(([qs, as]) => [qs, as.filter((a) => a.value !== CLEARED)] as const);
  const byQ = new Map<string, typeof answers>();
  for (const a of answers) byQ.set(a.questionId, [...(byQ.get(a.questionId) ?? []), a]);
  const qa = (fq: typeof formQuestions.$inferSelect, a?: (typeof answers)[number]): FichaQA => ({
    questionId: fq.id, label: fq.label, kind: fq.kind as QuestionKind, options: fq.options, value: (a?.value as AnswerValue | undefined) ?? null, answeredAt: a ? a.answeredAt.toISOString() : null,
  });
  const own = (form: FichaForm) => questions.filter((x) => x.form === form).flatMap((x) => {
    const a = (byQ.get(x.id) ?? []).find((r) => r.visitId == null);
    return x.active || a ? [qa(x, a)] : [];
  });
  const withVisit = answers.filter((a) => a.visitId != null);
  const visitIds = [...new Set(withVisit.map((a) => a.visitId!))];
  const days = visitIds.length ? await q.select({ id: visits.id, day: visits.day }).from(visits).where(inArray(visits.id, visitIds)) : [];
  const consultoria = questions.filter((x) => x.form === "consultoria");
  const consultorias = days
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .map((v) => ({
      visitId: v.id, day: v.day,
      items: consultoria.flatMap((x) => {
        const a = withVisit.find((r) => r.visitId === v.id && r.questionId === x.id);
        return x.active || a ? [qa(x, a)] : [];
      }),
    }));
  return { anamnese: own("anamnese"), consultorias, campos: own("campos") };
}
