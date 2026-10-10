import { sql } from "drizzle-orm";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "../domain/hours";
import { businessSecondsBetween } from "../../lib/business-hours";
import { dealScope, iso, periodWindow, rows, type ReportFilter } from "./common";
import { firstResponse, funnelMilestones, salesAgg, staleNow } from "./queries";

export type DailySummary = { text: string; links: { label: string; href: string }[]; highlight: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const brl = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function span(sec: number) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Resumo do dia em texto curto, para colar no WhatsApp ou mostrar no topo. Vale para "hoje" até `now` (destaque a partir das 19h).
 * Gestão vê a Casa toda; atendente vê só os leads dela. Só a gestão vê valores em reais. Os links são relativos.
 */
export async function dailySummaryText(user: Pick<SessionUser, "id" | "role" | "name" | "email">, now: Date = new Date()): Promise<DailySummary> {
  const gestor = user.role === "gestor";
  const f: ReportFilter = { period: "hoje", now, ownerId: gestor ? null : user.id };
  const w = periodWindow(f);
  const [mi, fr, sales, stale, waiting, hours, [tk]] = await Promise.all([
    funnelMilestones(f), firstResponse(f), salesAgg(f, w), staleNow({ now, ownerId: f.ownerId }),
    rows<{ since: Date; sla: number | null }>(sql`
      select d.awaiting_reply_since as since, s.sla_minutes as sla from deals d join stages s on s.id = d.stage_id
      where d.closed_at is null and d.awaiting_reply_since is not null and d.awaiting_reply_since <= ${iso(now)}::timestamptz and ${dealScope(f)}`),
    getBusinessHours(),
    rows<{ n: number }>(sql`
      select count(*)::int as n from tasks t left join deals d on d.id = t.deal_id
      where t.done_at is null and t.due_at < ${iso(now)}::timestamptz and (t.deal_id is null or (${dealScope({ period: "hoje" })}))
        ${gestor ? sql`` : sql`and t.assignee_id = ${user.id}`}`),
  ]);
  const late = waiting.filter((x) => x.sla && businessSecondsBetween(new Date(x.since).getTime(), now.getTime(), hours) >= x.sla * 60).length;
  const parados = stale.reduce((a, s) => a + s.parados, 0);
  const tasksLate = tk?.n ?? 0;
  const day = now.toLocaleDateString("pt-BR", { timeZone: "America/Bahia", weekday: "long", day: "2-digit", month: "2-digit" });
  const hourLocal = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bahia", hour: "2-digit", hour12: false }).format(now)) % 24;

  const lines = [`Resumo de hoje (${day})`];
  lines.push(mi.leads ? `• ${plural(mi.leads, "lead novo", "leads novos")}: ${mi.respondidos} com resposta, ${plural(mi.agendados, "agendado", "agendados")}` : "• Nenhum lead novo hoje");
  if (fr.n) lines.push(`• Primeira resposta: mediana de ${span(fr.p50 ?? 0)}, ${fr.slaHitPct}% dentro do prazo (${fr.n} ${fr.n === 1 ? "lead" : "leads"})`);
  if (sales.n) lines.push(`• ${plural(sales.n, "venda fechada", "vendas fechadas")}${gestor ? ` (${brl(sales.cents)})` : ""}`);
  lines.push(waiting.length ? `• ${waiting.length} esperando resposta agora${late ? ` (${late} fora do prazo)` : ""}` : "• Ninguém esperando resposta agora");
  if (tasksLate) lines.push(`• ${plural(tasksLate, "tarefa atrasada", "tarefas atrasadas")}`);
  if (parados) lines.push(`• ${plural(parados, "lead parado", "leads parados")} além do limite da etapa`);

  const links: DailySummary["links"] = [];
  if (late) links.push({ label: `Ver atrasados (${late})`, href: "/atendimento?filtro=atrasados" });
  else if (waiting.length) links.push({ label: "Ver quem espera resposta", href: "/atendimento?filtro=esperando" });
  if (tasksLate) links.push({ label: "Ver tarefas atrasadas", href: "/atendimento?filtro=tarefas-atrasadas" });
  if (parados) links.push({ label: "Ver parados", href: "/funil?filtro=parados" });
  if (gestor) links.push({ label: "Abrir relatórios de hoje", href: "/relatorios?periodo=hoje" });
  return { text: lines.join("\n"), links, highlight: hourLocal >= 19 };
}
