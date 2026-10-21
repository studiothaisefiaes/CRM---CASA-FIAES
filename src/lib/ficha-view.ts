import type { AnswerValue, QuestionKind } from "@/lib/fichas";

/** Uma pergunta em uso com a resposta que a cliente já tem (ou null): o que a tela de preencher mostra. */
export type StepQuestion = { id: string; label: string; kind: QuestionKind; options: string[]; value: AnswerValue | null };
/** Uma resposta para ler (a pergunta pode ter saído de uso depois). */
export type AnsweredItem = { label: string; value: AnswerValue; kind?: QuestionKind };
/** A consultoria de uma visita: o que já foi respondido (para ler) e as perguntas em uso (para preencher). */
export type ConsultoriaVisit = { visitId: string; day: string; answered: AnsweredItem[]; fill: StepQuestion[] };

const brDate = (d: string) => d.split("-").reverse().join("/");

/** A resposta em texto: lista com vírgula, Sim/Não, data dia/mês/ano. */
export function answerText(value: AnswerValue, kind?: QuestionKind): string {
  if (Array.isArray(value)) return value.join(", ");
  if (kind === "sim_nao") return value === "sim" ? "Sim" : value === "nao" ? "Não" : value;
  if (kind === "data" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return brDate(value);
  return value;
}

/** "18 de 32": quantas das perguntas em uso já têm resposta. */
export const progress = (qs: { value: AnswerValue | null }[]) => ({ answered: qs.filter((q) => q.value != null).length, total: qs.length });

/** O vazio de cada tipo conta como "sem resposta" (é o que o servidor apaga). */
export const blankAnswer = (v: AnswerValue | null | undefined) => v == null || (typeof v === "string" ? !v.trim() : v.length === 0);
export const sameAnswer = (a: AnswerValue | null | undefined, b: AnswerValue | null | undefined) =>
  blankAnswer(a) ? blankAnswer(b) : !blankAnswer(b) && JSON.stringify(a) === JSON.stringify(b);

type FichaItem = { questionId: string; label: string; kind: QuestionKind; value: AnswerValue | null };
/** Junta as consultorias respondidas (mais nova primeiro) com a visita de "Nova", que entra vazia se ainda não tem resposta. */
export function consultoriaVisits(
  done: { visitId: string; day: string; items: FichaItem[] }[], active: { id: string; label: string; kind: QuestionKind; options: string[] }[], fresh: { visitId: string; day: string } | null,
): ConsultoriaVisit[] {
  const mk = (v: { visitId: string; day: string }, items: FichaItem[]): ConsultoriaVisit => {
    const byQ = new Map(items.map((i) => [i.questionId, i]));
    return {
      visitId: v.visitId, day: v.day,
      answered: items.filter((i) => i.value != null).map((i) => ({ label: i.label, value: i.value!, kind: i.kind })),
      fill: active.map((q) => ({ id: q.id, label: q.label, kind: q.kind, options: q.options, value: byQ.get(q.id)?.value ?? null })),
    };
  };
  const list = done.map((v) => mk(v, v.items));
  if (fresh && !list.some((v) => v.visitId === fresh.visitId)) list.push(mk(fresh, []));
  return list.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}
