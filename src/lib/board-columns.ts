import type { BoardCard, BoardStage } from "@/server/queries/board";
import { orderByUrgency } from "./board-order";

/** As colunas do Quadro a partir das etapas (módulo puro, testável sem a tela). */
export type Column = BoardStage & { virtual?: boolean };
/** Id da coluna que junta as etapas do tipo Aguardando cliente (hoje uma só; Follow-up 2 a 4 estão desativados). */
export const FOLLOWUP_COLUMN = "followup";
/** Mantido para quem ainda importa o nome antigo da coluna separada (hoje ela fica dentro de "Em conversa"). */
export const ESPERANDO_COLUMN = "esperando";
/** Coluna "Para retomar" (20/10): a Casa já respondeu e combinou voltar a falar numa data; roxa, ao lado de "Em conversa". */
export const RETOMAR_COLUMN = "retomar";
const RETOMAR_FROM = ["lead", "atendimento", "followup"];

/**
 * "Em conversa" mostra, no topo, quem escreveu e ainda não foi respondida, de QUALQUER etapa (20/10, pedido do dono: "agendado fica lá em
 * agendado; mandou mensagem vem em conversando; depois volta para agendado ou resolvido"). A mais antiga primeiro, com a etapa de origem no
 * selo. É só a visão: a etapa de verdade não muda (o Veio/Faltou depende dela). Respondida, a conversa volta sozinha para a coluna dela.
 * Sem uma etapa "Em conversa" ativa, nada muda.
 */
export function toColumns(stages: BoardStage[]): Column[] {
  const conversa = stages.find((s) => s.kind === "atendimento");
  let rest = stages;
  if (conversa) {
    const waiting = stages.filter((s) => s.kind !== "fechado" && s.kind !== "perdido")
      .flatMap((s) => s.cards.filter((c) => c.awaitingReplySince).map((c): BoardCard => ({ ...c, esperando: true, ...(s.id === conversa.id ? {} : { stageName: s.name }) })))
      .sort((a, b) => new Date(a.awaitingReplySince!).getTime() - new Date(b.awaitingReplySince!).getTime());
    const ids = new Set(waiting.map((c) => c.id));
    rest = stages.map((s) => {
      if (s.kind === "fechado" || s.kind === "perdido") return s;
      const own = s.cards.filter((c) => !ids.has(c.id));
      return s.id === conversa.id ? { ...s, cards: [...waiting, ...own] } : { ...s, cards: own };
    });
  }
  // Para retomar: quem tem retomada aberta e não está esperando a Casa, de qualquer etapa aberta, a data mais próxima primeiro.
  // Só das etapas de conversa: Orçamento, Agendado e Na Casa têm o próprio lugar (o card mostra a data lá).
  const retomar = rest.filter((s) => RETOMAR_FROM.includes(s.kind))
    .flatMap((s) => s.cards.filter((c) => c.retomarAt && !c.awaitingReplySince).map((c): BoardCard => ({ ...c, ...(s.kind === "atendimento" ? {} : { stageName: s.name }) })))
    .sort((a, b) => new Date(a.retomarAt!).getTime() - new Date(b.retomarAt!).getTime());
  if (retomar.length) {
    const ids = new Set(retomar.map((c) => c.id));
    rest = rest.map((s) => (RETOMAR_FROM.includes(s.kind) ? { ...s, cards: s.cards.filter((c) => !ids.has(c.id)) } : s));
  }
  const retomarCol: Column | null = retomar.length
    ? { id: RETOMAR_COLUMN, key: RETOMAR_COLUMN, name: "Para retomar", kind: RETOMAR_COLUMN, slaMinutes: null, color: "#6b4fa3", virtual: true, cards: retomar } : null;
  const fus = rest.filter((s) => s.kind === "followup");
  const out: Column[] = [];
  for (const s of rest) {
    if (s.kind !== "followup") { out.push(s); if (s.kind === "atendimento" && retomarCol) out.push(retomarCol); continue; }
    if (s.id !== fus[0].id) continue;
    out.push({ ...fus[0], id: FOLLOWUP_COLUMN, virtual: true,
      cards: orderByUrgency(fus.flatMap((f) => f.cards)) });
  }
  if (retomarCol && !out.includes(retomarCol)) out.unshift(retomarCol);
  return out;
}
