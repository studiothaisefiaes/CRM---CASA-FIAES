import { UserFacingError } from "@/server/domain/errors";

/**
 * As fichas da cliente (Fase C, itens 21 e 25b). Anamnese e Campos da ficha têm uma resposta por cliente; a Consultoria de imagem tem
 * uma por visita. Respostas das fichas são dado da cliente: ficam fora de exportação, da IA e do Avec.
 */
export const FICHA_FORMS = ["anamnese", "consultoria", "campos"] as const;
export type FichaForm = (typeof FICHA_FORMS)[number];
export const FICHA_FORM_LABEL: Record<FichaForm, string> = { anamnese: "Anamnese", consultoria: "Consultoria de imagem", campos: "Campos da ficha" };
export const isFichaForm = (v: unknown): v is FichaForm => typeof v === "string" && (FICHA_FORMS as readonly string[]).includes(v);

export const QUESTION_KINDS = ["opcao", "caixas", "texto", "texto_longo", "sim_nao", "data"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  opcao: "Uma opção", caixas: "Várias opções", texto: "Texto curto", texto_longo: "Texto longo", sim_nao: "Sim ou não", data: "Data",
};
/** Pergunta que escolhe entre opções escritas pela Casa. */
export const hasOptions = (k: QuestionKind) => k === "opcao" || k === "caixas";

/** Limites técnicos (não são configuração da Casa). */
export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 4000;
export const QUESTION_LABEL_MAX = 300;
export const OPTION_MAX = 80;

/** Uma resposta: texto (inclui "sim"/"nao" e a data AAAA-MM-DD) ou a lista de opções marcadas. */
export type AnswerValue = string | string[];

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Confere a resposta pelo tipo da pergunta. Vazio (nada, texto só de espaços, lista vazia) devolve null: apaga a resposta.
 * Valor fora da lista de opções, texto grande demais ou data que não existe lança UserFacingError.
 */
export function validateAnswer(kind: QuestionKind, options: string[], raw: unknown): AnswerValue | null {
  if (raw == null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  if (Array.isArray(raw) && raw.length === 0) return null;
  if (kind === "caixas") {
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new UserFacingError("Escolha só opções da pergunta.");
    const list = [...new Set(raw as string[])];
    if (list.some((x) => !options.includes(x))) throw new UserFacingError("Escolha só opções da pergunta.");
    return list;
  }
  if (typeof raw !== "string") throw new UserFacingError("Resposta inválida.");
  const v = raw.trim();
  switch (kind) {
    case "opcao":
      if (!options.includes(v)) throw new UserFacingError("Escolha uma das opções da pergunta.");
      return v;
    case "texto":
      if (v.length > TEXT_MAX) throw new UserFacingError(`Use até ${TEXT_MAX} caracteres.`);
      return v;
    case "texto_longo":
      if (v.length > LONG_TEXT_MAX) throw new UserFacingError(`Use até ${LONG_TEXT_MAX} caracteres.`);
      return v;
    case "sim_nao":
      if (v !== "sim" && v !== "nao") throw new UserFacingError("Responda sim ou não.");
      return v;
    case "data":
      if (!isRealDate(v)) throw new UserFacingError("Use uma data válida.");
      return v;
  }
}
