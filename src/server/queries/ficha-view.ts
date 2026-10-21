import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { visits } from "../db/schema";
import { fichaOf, listQuestions } from "../domain/fichas";
import { getPhotoConfig, listClientPhotos } from "../domain/client-photos";
import { bahiaDay } from "@/lib/client-rhythm";
import { consultoriaVisits, progress, type ConsultoriaVisit, type StepQuestion } from "@/lib/ficha-view";
import type { ClientPhotoItem } from "@/lib/client-photos";
import type { AnswerValue } from "@/lib/fichas";

export type FichaView = {
  anamnese: StepQuestion[];
  visits: ConsultoriaVisit[];
  newVisitId: string | null;
  /** Os Campos da ficha para ler (os em uso e os já respondidos) e para preencher (só os em uso). */
  campos: { items: { label: string; kind: StepQuestion["kind"]; value: AnswerValue | null }[]; fill: StepQuestion[] };
  photos: ClientPhotoItem[] | null;
  photoMaxMb: number;
  summary: { answered: number; total: number; lastDay: string | null };
};

/**
 * Tudo que a aba Consultoria, o cartão do Resumo e os Campos da ficha precisam, numa leitura só. Dado da cliente: a página só chama
 * isto para quem tem fichas.ver e com a função "fichas" ligada (as fotos, também com "fotos"). "Nova" usa a visita de hoje ou a última.
 */
export async function getFichaView(contactId: string, opts: { photos: boolean; /** "AAAA-MM-DD" em Salvador; padrão: hoje. */ today?: string }): Promise<FichaView> {
  const today = opts.today ?? bahiaDay(Date.now());
  const [ficha, qAna, qCon, qCampos, [fresh], photos, { maxMb }] = await Promise.all([
    fichaOf(contactId), listQuestions("anamnese"), listQuestions("consultoria"), listQuestions("campos"),
    db.select({ visitId: visits.id, day: visits.day }).from(visits).where(and(eq(visits.contactId, contactId), lte(visits.day, today))).orderBy(desc(visits.day), desc(visits.createdAt)).limit(1),
    opts.photos ? listClientPhotos(contactId) : Promise.resolve(null),
    getPhotoConfig(),
  ]);
  const byId = (items: { questionId: string; value: AnswerValue | null }[]) => new Map(items.map((i) => [i.questionId, i.value]));
  const step = (qs: typeof qAna, answers: Map<string, AnswerValue | null>): StepQuestion[] => qs.map((q) => ({ id: q.id, label: q.label, kind: q.kind, options: q.options, value: answers.get(q.id) ?? null }));
  const anamnese = step(qAna, byId(ficha.anamnese));
  const all = consultoriaVisits(ficha.consultorias, qCon, fresh ?? null);
  return {
    anamnese,
    visits: all,
    newVisitId: fresh?.visitId ?? null,
    campos: { items: ficha.campos.map((c) => ({ label: c.label, kind: c.kind, value: c.value })), fill: step(qCampos, byId(ficha.campos)) },
    photos,
    photoMaxMb: maxMb,
    summary: { ...progress(anamnese), lastDay: ficha.consultorias[0]?.day ?? null },
  };
}
