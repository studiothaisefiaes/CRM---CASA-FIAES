import { bahiaDay, daysBetween, type ReturnInfo } from "./client-rhythm";

/**
 * "Situação" do painel da cliente (desenho aprovado): uma frase só com quem ela é para a Casa, pacote, última visita e se está na hora de voltar.
 * A espera (há quanto tempo e o prazo) fica na linha logo abaixo, e o próximo horário no cartão dele: não se repetem aqui. Módulo puro.
 */
export type PaneSituationInput = {
  isFirstContact: boolean; firstContactAt: string; knownSince: string | null;
  lastVisit: { at: string } | null; activePackage: { usedSessions: number; totalSessions: number } | null; retorno: ReturnInfo | null;
};

const year = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { year: "numeric", timeZone: "America/Bahia" });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "America/Bahia" }).replace(". de ", "/").replace(" de ", "/").replace(".", "");
export function paneSituation(c: PaneSituationInput, o: { isClient: boolean }, nowMs: number): string {
  const since = c.knownSince ?? c.firstContactAt;
  const who = o.isClient ? `Cliente desde ${year(since)}` : c.isFirstContact ? "Primeira conversa" : `Fala com a Casa desde ${monthYear(since)}`;
  const pkg = c.activePackage ? `pacote ${c.activePackage.usedSessions} de ${c.activePackage.totalSessions}` : null;
  const days = c.lastVisit ? Math.max(0, daysBetween(bahiaDay(Date.parse(c.lastVisit.at)), bahiaDay(nowMs))) : null;
  const visit = days == null ? "ainda não veio à Casa" : days === 0 ? "veio hoje" : days === 1 ? "última visita ontem" : `última visita há ${days} dias`;
  const back = c.retorno?.status === "na_hora" ? "hora de voltar" : c.retorno?.status === "sumida" ? "sumida" : null;
  return [who, pkg, visit, back].filter(Boolean).join(" · ");
}
