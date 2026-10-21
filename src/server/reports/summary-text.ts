import { sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import type { SessionUser } from "../auth/sessions-store";
import { summaryMode } from "../../lib/daily-summary";
import { countLateLeads } from "../queries/late-count";
import { dealScope, iso, MIN_SAMPLE, periodStart, periodWindow, rows, WON_SQL, type ReportFilter } from "./common";
import { firstResponse, funnelMilestones, REMAINING, salesAgg, staleNow } from "./queries";

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
 * Com "números de toda a equipe" vê a Casa toda; sem, só os próprios leads. Valores em reais só com "ver valores". Os links são relativos.
 */
export async function dailySummaryText(user: Pick<SessionUser, "id" | "perms" | "name" | "email">, now: Date = new Date()): Promise<DailySummary> {
  const gestor = can(user.perms, "relatorios.equipe"), money = can(user.perms, "valores.ver");
  const f: ReportFilter = { period: "hoje", now, ownerId: gestor ? null : user.id };
  const w = periodWindow(f);
  const tomorrow = { from: new Date(periodStart("hoje", now).getTime() + 86_400_000), to: new Date(periodStart("hoje", now).getTime() + 2 * 86_400_000) };
  const [mi, fr, sales, stale, waiting, late, [tk], [tm]] = await Promise.all([
    funnelMilestones(f), firstResponse(f), salesAgg(f, w), staleNow({ now, ownerId: f.ownerId }),
    rows<{ id: string }>(sql`
      select d.id from deals d
      where d.closed_at is null and d.awaiting_reply_since is not null and d.awaiting_reply_since <= ${iso(now)}::timestamptz and ${dealScope(f)}`),
    // "Atrasado" é uma definição só, a do motor e do shell: alerta de espera aberto (a mesma condição do sino e da lista /atendimento?filtro=atrasados; aqui, para a atendente, só os dela).
    countLateLeads(user, { onlyOwn: true }), // "os seus": o link filtro=atrasados da Fila (vindo do relatório) também fica só com os dela
    rows<{ n: number }>(sql`
      select count(*)::int as n from tasks t left join deals d on d.id = t.deal_id
      where t.done_at is null and t.due_at < ${iso(now)}::timestamptz
        and ((t.deal_id is null and not exists (select 1 from contacts ic where ic.id = t.contact_id and ic.kind in ('fornecedor', 'spam'))) or (t.deal_id is not null and ${dealScope({ period: "hoje" })}))
        ${gestor ? sql`` : sql`and t.assignee_id = ${user.id}`}`),
    rows<{ agendados: number; cobrancas: number; cobrancasCents: number }>(sql`
      select count(*) filter (where d.scheduled_at >= ${iso(tomorrow.from)}::timestamptz and d.scheduled_at < ${iso(tomorrow.to)}::timestamptz and d.closed_at is null)::int as agendados,
        count(*) filter (where ${sql.raw(WON_SQL)} and d.charge_at >= ${iso(tomorrow.from)}::timestamptz and d.charge_at < ${iso(tomorrow.to)}::timestamptz and ${REMAINING} > 0)::int as cobrancas,
        coalesce(sum(${REMAINING}) filter (where ${sql.raw(WON_SQL)} and d.charge_at >= ${iso(tomorrow.from)}::timestamptz and d.charge_at < ${iso(tomorrow.to)}::timestamptz), 0)::float8 as "cobrancasCents"
      from deals d join stages s on s.id = d.stage_id where ${dealScope(f)}`),
  ]);
  const parados = stale.reduce((a, s) => a + s.parados, 0);
  const tasksLate = tk?.n ?? 0;
  const day = now.toLocaleDateString("pt-BR", { timeZone: "America/Bahia", weekday: "long", day: "2-digit", month: "2-digit" });

  const lines = [`Resumo de hoje (${day})`];
  lines.push(mi.leads ? `• ${plural(mi.leads, "conversa nova", "conversas novas")}: ${mi.respondidos} com resposta, ${plural(mi.agendados, "agendado", "agendados")}` : "• Nenhuma conversa nova hoje");
  // Amostra pequena: "3 de 9 dentro do prazo", nunca um % que parece firme.
  if (fr.n) lines.push(`• Primeira resposta: mediana de ${span(fr.p50 ?? 0)}, ${fr.n >= MIN_SAMPLE ? `${fr.slaHitPct}%` : `${fr.slaHit} de ${fr.n}`} dentro do prazo`);
  if (sales.n) lines.push(`• ${plural(sales.n, "venda fechada", "vendas fechadas")}${money ? ` (${brl(sales.cents)})` : ""}`);
  lines.push(waiting.length ? `• ${waiting.length} esperando resposta agora${late ? ` (${late} fora do prazo)` : ""}` : "• Ninguém esperando resposta agora");
  if (tasksLate) lines.push(`• ${plural(tasksLate, "tarefa atrasada", "tarefas atrasadas")}`);
  if (parados) lines.push(`• ${plural(parados, "conversa parada", "conversas paradas")} além do limite da etapa`);
  const amanhaAgendados = tm?.agendados ?? 0, amanhaCobrancas = tm?.cobrancas ?? 0;
  if (amanhaAgendados) lines.push(`• Amanhã: ${plural(amanhaAgendados, "agendado", "agendados")}`);
  if (amanhaCobrancas) lines.push(`• Cobranças de amanhã: ${amanhaCobrancas}${money ? ` (${brl(tm.cobrancasCents)})` : ""}`);

  const links: DailySummary["links"] = [];
  if (mi.leads) links.push({ label: "Ver as conversas novas de hoje", href: "/atendimento?filtro=novos" });
  if (late) links.push({ label: `Ver atrasados (${late})`, href: "/atendimento?filtro=atrasados" });
  else if (waiting.length) links.push({ label: "Ver quem espera resposta", href: "/atendimento?filtro=esperando" });
  if (tasksLate) links.push({ label: "Ver tarefas atrasadas", href: "/atendimento?filtro=tarefas-atrasadas" });
  if (amanhaAgendados) links.push({ label: "Ver agendados de amanhã", href: "/atendimento?filtro=agendados-amanha" });
  if (amanhaCobrancas) links.push({ label: "Ver cobranças de amanhã", href: "/atendimento?filtro=cobrancas-amanha" });
  if (parados) links.push({ label: "Ver parados", href: "/atendimento?filtro=parados" });
  if (gestor) links.push({ label: "Abrir relatórios de hoje", href: "/relatorios?periodo=hoje" });
  return { text: lines.join("\n"), links, highlight: summaryMode(now).highlight };
}
