"use client";
import Link from "next/link";
import { IconCalendar } from "@/components/icons";
import { VIEW_STATUS, type ViewStatus } from "@/lib/agenda-day";
import type { TodayAgendaItem } from "@/server/queries/today";
import { HojeBlock } from "./hoje-block";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "numeric", minute: "2-digit", timeZone: "America/Bahia" });
const PREVIA = 3;
/** Já resolvidos no dia: saem da prévia (continuam no painel). */
const DONE = new Set<ViewStatus>(["pago", "finalizado", "faltou", "encerrado", "cancelado"]);
const NA_CASA = new Set<ViewStatus>(["chegou", "atendendo"]);
const POR_VIR = new Set<ViewStatus>(["marcado", "confirmado", "pedido"]);

const servico = (x: TodayAgendaItem) => [x.service, x.professional ? `com ${x.professional}` : null].filter(Boolean).join(" · ");

function Row({ x, small }: { x: TodayAgendaItem; small?: boolean }) {
  const cor = VIEW_STATUS[x.state];
  return (
    <li>
      <Link href={x.href} className={`flex min-h-11 items-start gap-3 hover:text-gold-ink transition-colors ${small ? "py-1.5" : "py-2"}`}>
        <span className="w-11 shrink-0 pt-px text-sm text-graphite tabular">{x.noTime ? "sem hora" : HORA.format(new Date(x.at))}</span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{x.name}</span>
          {servico(x) && <span className="block break-words text-sm text-graphite">{servico(x)}</span>}
        </span>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: cor.bg, color: cor.fg }}>{x.stateLabel}</span>
      </Link>
    </li>
  );
}

/**
 * "Agenda de hoje" no Hoje (P1, 17/10): os horários de hoje da Agenda, com hora, cliente, serviço, profissional e o estado (a mesma cor do
 * cartão na grade). A prévia mostra os 3 próximos que ainda pedem algo; "Ver todos" abre o dia inteiro. Cada linha abre o horário na Agenda.
 */
export function AgendaToday({ items }: { items: TodayAgendaItem[] }) {
  const open = items.filter((x) => !DONE.has(x.state));
  const preview = (open.length ? open : items).slice(0, PREVIA);
  const n = (s: Set<ViewStatus>) => items.filter((x) => s.has(x.state)).length;
  const semBaixa = items.filter((x) => x.state === "sembaixa").length;
  const context = items.length
    ? [n(POR_VIR) ? `${n(POR_VIR)} por vir` : null, n(NA_CASA) ? `${n(NA_CASA)} na Casa` : null, semBaixa ? `${semBaixa} sem desfecho` : null].filter(Boolean).join(" · ") || "Todos já atendidos"
    : "Nenhum horário na Agenda hoje.";
  return (
    <HojeBlock id="agenda-hoje" title="Agenda de hoje" icon={<IconCalendar size={16} />} count={items.length} context={context} alert={semBaixa > 0}
      hidden={Math.max(0, items.length - preview.length)}
      panel={items.length > preview.length ? <ul className="divide-y divide-line/70">{items.map((x) => <Row key={x.key} x={x} />)}</ul> : undefined}
      panelPhrase="Os horários de hoje na Agenda, em ordem. Tocar abre o horário."
      panelFooter={<Link href="/agenda" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-ink px-4 text-sm font-semibold text-paper lg:min-h-10">Abrir a Agenda</Link>}>
      {preview.length > 0 && <ul className="divide-y divide-line/70 px-5 pb-2">{preview.map((x) => <Row key={x.key} x={x} small />)}</ul>}
    </HojeBlock>
  );
}
