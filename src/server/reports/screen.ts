import type { SessionUser } from "../auth/sessions-store";
import { summaryLinkHref } from "../../lib/report-links";
import type { ReportFilter } from "./common";
import {
  crmVsPhone, dataQuality, demandHeatmap, executiveNumbers, financeWithPaid, firstResponse, followupEfficacy, funnelMilestones, lossesByReasonAndStage,
  personVsGoal, sourceToSale, staleNow, type ExecutiveNumbers, type SourceRow,
} from "./queries";
import { dailySummaryText } from "./summary-text";

export type ScreenUser = Pick<SessionUser, "id" | "role" | "name" | "email">;

/** Atendente só enxerga os próprios leads; a gestão filtra por pessoa se quiser. */
export const scopedFilter = (user: ScreenUser, f: ReportFilter): ReportFilter => ({ ...f, compare: true, ownerId: user.role === "gestor" ? f.ownerId ?? null : user.id });

/** Valores em R$ só para a gestão: para o atendente o dado nem chega à tela. */
export type ExecutiveView = Omit<ExecutiveNumbers, "vendas" | "ticketMedio"> & {
  vendas: { atual: { n: number; cents: number | null }; anterior: { n: number; cents: number | null } };
  ticketMedio: ExecutiveNumbers["ticketMedio"] | null;
};
export type SourceView = Omit<SourceRow, "receitaCents"> & { receitaCents: number | null };

export function hideMoney(n: ExecutiveNumbers, gestor: boolean): ExecutiveView {
  if (gestor) return n;
  return { ...n, vendas: { atual: { n: n.vendas.atual.n, cents: null }, anterior: { n: n.vendas.anterior.n, cents: null } }, ticketMedio: null };
}

export async function loadOverview(user: ScreenUser, filter: ReportFilter) {
  const gestor = user.role === "gestor";
  const f = scopedFilter(user, filter);
  const [summary, numbers, response, funnel, stale, sources, losses, channel, quality] = await Promise.all([
    dailySummaryText(user, f.now), executiveNumbers(f), firstResponse(f), funnelMilestones(f), staleNow({ now: f.now, ownerId: f.ownerId }),
    sourceToSale(f), lossesByReasonAndStage(f), crmVsPhone(f), dataQuality(),
  ]);
  return {
    summary: {
      text: summary.text, highlight: summary.highlight,
      links: summary.links.flatMap((l) => { const href = summaryLinkHref(l.href); return href && !href.startsWith("/relatorios") ? [{ label: l.label, href }] : []; }),
    },
    numbers: hideMoney(numbers, gestor), response, funnel, stale, losses, channel, quality,
    sources: sources.map((s): SourceView => ({ ...s, receitaCents: gestor ? s.receitaCents : null })),
  };
}

export async function loadAnalysis(user: ScreenUser, filter: ReportFilter) {
  const gestor = user.role === "gestor";
  const f = scopedFilter(user, filter);
  const [followup, heatmap, people, finance] = await Promise.all([
    followupEfficacy(f), demandHeatmap(f), gestor ? personVsGoal(f) : null, gestor ? financeWithPaid(f) : null,
  ]);
  return { followup, heatmap, people, finance };
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>;
export type Analysis = Awaited<ReturnType<typeof loadAnalysis>>;
