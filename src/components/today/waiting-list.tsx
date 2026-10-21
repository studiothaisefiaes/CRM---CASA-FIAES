"use client";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TodayItem } from "@/server/queries/today";
import { useClock, useHours } from "@/components/pipeline/timer";
import { useCrossedThreshold } from "@/components/motion/use-crossed-threshold";
import { businessSecondsBetween } from "@/lib/business-hours";
import { ringState, slaStatus } from "@/lib/queue";
import { clientLabel } from "@/lib/alert-copy";
import { displayName } from "@/lib/display-name";
import { IconClock, IconArrowRight } from "@/components/icons";
import { Empty } from "@/components/ui/empty";
import { EASE, SPRING_UI } from "@/lib/motion";
import { leadHref } from "@/lib/lead-href";
import { ClientLink } from "@/components/contacts/client-link";

const capFirst = (s: string) => s[0].toLocaleUpperCase("pt-BR") + s.slice(1);
const LIMIT = 8; // o Hoje resume; a lista inteira mora na Fila

export function WaitingList({ items, limit = LIMIT, showRest = true }: { items: TodayItem[]; limit?: number; showRest?: boolean }) {
  if (!items.length) return <Empty title="Ninguém esperando">Todas as conversas foram respondidas. Conversas novas aparecem aqui na hora.</Empty>;
  // atrasados primeiro (como na Fila), depois quem espera há mais tempo
  const shown = [...items.filter((i) => i.late), ...items.filter((i) => !i.late)].slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <ul className="px-2 pb-2">
      <AnimatePresence initial={false}>
        {shown.map((item, idx) => <motion.li key={item.id} layout layoutDependency={idx} transition={SPRING_UI} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}><Row i={item} /></motion.li>)}
      </AnimatePresence>
      {showRest && rest > 0 && <li><Link href="/atendimento" className="flex min-h-11 items-center px-3 text-sm text-gold-ink hover:underline">e mais {rest} na Fila</Link></li>}
    </ul>
  );
}

/**
 * A regra única (`slaLevel`): vermelho é o alerta de espera aberto (`late`, o mesmo do contador); passou do prazo sem alerta ainda: dourado.
 * O texto vem de `slaStatus`, o mesmo da linha da Fila.
 */
function Row({ i }: { i: TodayItem }) {
  const hours = useHours();
  const at = i.at ? new Date(i.at).getTime() : null;
  const wait = (now: number) => (at != null ? businessSecondsBetween(at, now, hours) : 0);
  // O relógio entra como valor derivado: a linha só re-renderiza quando o anel muda de estado; o texto do prazo é uma folha.
  const level = useClock((now) => ringState({ awaiting: true, late: !!i.late, waitSeconds: wait(now), slaMinutes: i.slaMinutes }));
  const red = !!i.late, gold = !red && level === "near";
  const pulse = useCrossedThreshold(red ? 1 : 0, 1);
  const reduced = useReducedMotion();
  const name = i.name ? displayName(i.name) : capFirst(clientLabel(null, i.phone));
  return (
    <div data-late={red ? "sim" : "nao"} className={`group relative flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-[var(--radius-control)] transition-colors ${red ? "bg-alert-soft hover:bg-alert-soft/80" : "hover:bg-paper-2"}`}>
      {/* A linha inteira abre a conversa (link esticado); o nome, por cima, abre a ficha. */}
      <Link href={leadHref(i.id)} aria-label={`Abrir conversa com ${name}`} className="absolute inset-0 rounded-[var(--radius-control)]" />
      <span className={`pointer-events-none relative size-2 rounded-full shrink-0 ${red ? "bg-alert" : gold ? "bg-gold" : "bg-line-strong"}`}>
        {/* Pulso único ao atrasar (2 ciclos, ~1,2 s); depois fica parado. Nada de pulso infinito (WCAG 2.2.2). */}
        {pulse && <motion.span aria-hidden data-testid="pulso-atraso" className="absolute inset-0 rounded-full bg-alert" initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: reduced ? 1 : 3 }} transition={{ duration: 0.6, ease: EASE, repeat: 1 }} />}
      </span>
      <span className="pointer-events-none min-w-0 flex-1">
        <ClientLink contactId={i.contactId} name={name} className="pointer-events-auto block truncate text-base font-medium">{name}</ClientLink>
        <span className="block text-xs text-muted">{i.stageName}</span>
        <span className={`sm:hidden flex items-center gap-1 mt-0.5 text-xs font-semibold tabular ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={12} className="shrink-0" /><WaitStatusText i={i} /></span>
      </span>
      <span className={`pointer-events-none hidden sm:inline-flex items-center gap-1 text-sm font-semibold tabular text-right ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={14} className="shrink-0" /><WaitStatusText i={i} /></span>
      <IconArrowRight size={15} className="pointer-events-none text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </div>
  );
}

/** O texto do prazo ("atrasado 4 min"): folha, re-renderiza só quando o texto muda. */
export function WaitStatusText({ i }: { i: TodayItem }) {
  const hours = useHours();
  const at = i.at ? new Date(i.at).getTime() : null;
  const text = useClock((now) => {
    const waitSeconds = at != null ? businessSecondsBetween(at, now, hours) : 0;
    const ring = ringState({ awaiting: true, late: !!i.late, waitSeconds, slaMinutes: i.slaMinutes });
    return slaStatus({ ring, alert: !!i.late, waitSeconds, slaMinutes: i.slaMinutes })?.text ?? "Esperando resposta";
  });
  return <>{text}</>;
}
