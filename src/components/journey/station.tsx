"use client";
import Link from "next/link";
import { motion } from "motion/react";
import type { JourneyPerson, JourneyStation } from "@/server/queries/journey";
import { useClock, useHours } from "@/components/pipeline/timer";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { leadHref } from "@/lib/lead-href";
import { personStatus } from "@/lib/journey-status";
import type { RingState } from "@/lib/queue";
import { BOARD_CLOSED_DAYS } from "@/lib/board-order";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

const SIZE = 76, R = 35, C = 2 * Math.PI * R;
const RING_COLOR: Record<RingState, string> = { none: "transparent", ok: "var(--color-ok)", near: "var(--color-gold)", late: "var(--color-alert)" };
const SUB_TONE: Record<RingState, string> = { none: "text-muted", ok: "text-muted", near: "text-gold-ink", late: "text-alert" };

/** "Juliana B.": o nome curto cabe nos 96 px de cada pessoa. Nome que não é de gente (telefone) aparece inteiro. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return !/^\p{L}/u.test(first) ? name.trim() : last && /^\p{L}/u.test(last) ? `${first} ${last[0].toUpperCase()}.` : first;
};

/**
 * Uma pessoa na estação. O texto de baixo (`personStatus`) é o mesmo no rótulo acessível, que começa pelo nome que está na tela e traz o nome inteiro depois.
 * O anel mostra quanto do prazo da etapa já passou (verde, dourado, vermelho) e só existe para quem espera resposta: Fechado e Perdido não têm prazo.
 */
function Person({ p, stageKind, index }: { p: JourneyPerson; stageKind: string; index: number }) {
  const hours = useHours();
  // O relógio entra como valor derivado: a pessoa só re-renderiza quando o texto ou 1% do anel muda, não a cada segundo.
  const key = useClock((now) => { const r = personStatus({ stageKind, awaitingSince: p.awaitingSince, urgency: p.urgency, slaMinutes: p.slaMinutes, scheduledAt: p.scheduledAt, closedAt: p.closedAt }, now, hours); return `${r.ring}|${Math.round(r.progress * 100)}|${r.text}`; });
  const [ringKey, pct, ...rest] = key.split("|");
  const ring = ringKey as RingState, progress = Number(pct) / 100, text = rest.join("|");
  const short = shortName(p.name);
  const label = `${short}${short === p.name.trim() ? "" : ` (${p.name})`}, ${text}`;
  return (
    <motion.li initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: T.base, ease: EASE, delay: Math.min(index, 11) * 0.025 }}>
      <Link href={leadHref(p.dealId)} aria-label={label} suppressHydrationWarning className="group flex w-24 flex-col items-center gap-2 rounded-[var(--radius-control)] py-1 outline-offset-2">
        <span className="relative block" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0" aria-hidden>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-line)" strokeWidth={3} />
            <circle suppressHydrationWarning cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={RING_COLOR[ring]} strokeWidth={3} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
          </svg>
          <ContactAvatar contactId={p.contactId} hasAvatar={p.hasAvatar} name={p.name} size={SIZE - 14} className="absolute inset-[7px] font-serif font-normal transition-transform duration-200 group-hover:scale-[1.04]" />
          {ring === "late" && <span aria-hidden className="absolute -right-0.5 -top-0.5 grid size-[22px] place-items-center rounded-full border-2 border-paper bg-alert text-[13px] font-bold leading-none text-white">!</span>}
        </span>
        <span className="text-center text-[12.5px] font-medium leading-tight">{short}</span>
        <span suppressHydrationWarning className={cn("-mt-1.5 text-center text-xs font-semibold leading-tight", SUB_TONE[ring])}>{text}</span>
      </Link>
    </motion.li>
  );
}

/** Para onde a estação leva: a Fila filtrada na etapa. Fechado e Perdido já saíram da Fila, então vão para o Quadro, que ainda mostra os últimos 30 dias. */
const stationHref = (s: JourneyStation) => (s.kind === "fechado" || s.kind === "perdido" ? "/funil" : `/atendimento?etapa=${s.key}`);

export function Station({ station: s, index }: { station: JourneyStation; index: number }) {
  const href = stationHref(s);
  const hot = s.late > 0;
  const empty = s.count === 0;
  const done = s.kind === "fechado" || s.kind === "perdido";
  return (
    <motion.li initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: T.slow, ease: EASE, delay: 0.04 + index * 0.06 }}
      className="relative flex min-w-0 flex-col gap-3" data-station={s.key}>
      <Link href={href} aria-label={`${s.name}: ${s.count} ${s.count === 1 ? "lead" : "leads"}${done ? ` nos últimos ${BOARD_CLOSED_DAYS} dias` : ""}${hot ? `, ${s.late} ${s.late === 1 ? "atrasado" : "atrasados"}` : ""}. ${done ? "Ver no Quadro" : "Abrir na Fila"}`}
        className="relative z-10 flex min-h-11 w-fit max-w-full items-center gap-2 rounded-[var(--radius-control)] bg-paper px-1.5 outline-offset-2 hover:bg-paper-2">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full shadow-[0_0_0_4px_var(--color-paper)]" style={{ background: s.color }} />
        <span className="font-semibold">{s.name}</span>
        <span className="tabular text-muted">{s.count}</span>
        {hot && <span className="ml-1 rounded-full bg-alert-soft px-2 py-0.5 text-xs font-semibold text-alert">{s.late} {s.late === 1 ? "atrasado" : "atrasados"}</span>}
      </Link>
      <div className={cn("relative z-10 flex-1 rounded-[22px] px-2.5 pb-4 pt-5", hot ? "border border-alert/25 bg-alert-soft" : empty ? "border border-dashed border-line-strong bg-paper" : "bg-paper-2")}>
        {done && <p className="mb-3 text-center text-xs text-muted">últimos {BOARD_CLOSED_DAYS} dias</p>}
        {empty ? (
          <p className="px-1.5 py-6 text-center text-[12.5px] text-muted">Ninguém aqui ainda</p>
        ) : (
          <ul aria-label={`Pessoas em ${s.name}`} className="flex flex-wrap content-start justify-center gap-x-2.5 gap-y-4">
            {s.people.map((p, i) => <Person key={p.dealId} p={p} stageKind={s.kind} index={i} />)}
            {s.more > 0 && (
              <li className="grid w-24 place-items-center">
                <Link href={href} aria-label={`Mais ${s.more} em ${s.name}`} className="grid size-[76px] place-items-center rounded-full border border-dashed border-line-strong text-base font-semibold text-graphite hover:bg-paper-3">+{s.more}</Link>
              </li>
            )}
          </ul>
        )}
      </div>
    </motion.li>
  );
}
