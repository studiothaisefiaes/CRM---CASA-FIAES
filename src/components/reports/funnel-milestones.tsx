"use client";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { compareMetric, insufficientText, shareText } from "@/lib/report-format";
import type { Milestones } from "@/server/reports/queries";
import { Delta } from "./delta";

type Step = { key: string; label: string; n: number; prev: number | null; base: number; baseLabel: string };

/**
 * Funil por marcos: Leads novos, Respondidos, Agendados, Fechados. Os degraus só descem (a base é sempre a mesma coorte).
 * Cada degrau mostra a conversão sobre o degrau de cima ("3 de 9" com menos de 20, % a partir de 20). Perdidos ficam à parte.
 */
export function FunnelMilestones({ m }: { m: Milestones & { previous?: Milestones } }) {
  if (m.leads === 0) return <p className="text-sm text-muted py-2">{insufficientText(0)}</p>;
  const p = m.previous;
  const steps: Step[] = [
    { key: "leads", label: "Leads novos", n: m.leads, prev: p?.leads ?? null, base: 0, baseLabel: "" },
    { key: "resp", label: "Respondidos", n: m.respondidos, prev: p?.respondidos ?? null, base: m.leads, baseLabel: "dos leads novos" },
    { key: "agend", label: "Agendados", n: m.agendados, prev: p?.agendados ?? null, base: m.respondidos, baseLabel: "dos respondidos" },
    { key: "fech", label: "Fechados", n: m.fechados, prev: p?.fechados ?? null, base: m.agendados, baseLabel: "dos agendados" },
  ];
  return (
    <div>
      <ol className="flex flex-col gap-4">
        {steps.map((s, i) => {
          const conv = i === 0 ? null : shareText(s.n, s.base);
          const cmp = p ? compareMetric(s.n, s.prev, { kind: "count", n: m.leads, nPrev: p.leads }) : null;
          return (
            <li key={s.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[16px] font-medium">{s.label}</span>
                <span className="tabular text-right"><b className="text-[22px] font-semibold">{s.n}</b>
                  {conv && <span className="text-[13px] text-graphite"> · {conv} {s.base ? s.baseLabel : ""}</span>}
                </span>
              </div>
              <div className="relative h-3 mt-1.5 rounded-full bg-paper-3" role="img" aria-label={`${s.label}: ${s.n} de ${m.leads} leads novos`}>
                <motion.div className={`h-full w-full rounded-full ${s.key === "fech" ? "bg-ok" : "bg-gold"}`} style={{ transformOrigin: "left center" }}
                  initial={{ scaleX: 0 }} animate={{ scaleX: m.leads ? s.n / m.leads : 0 }} transition={{ duration: 0.7, delay: i * 0.07, ease: EASE }} />
              </div>
              {cmp && cmp.direction !== "none" && <div className="mt-1"><Delta c={cmp} prevText={`antes: ${s.prev}`} /></div>}
            </li>
          );
        })}
      </ol>
      <div className="mt-5 pt-4 border-t border-dashed border-line-strong flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[16px] font-medium text-graphite">Perdidos <span className="text-[13px] font-normal text-muted">(à parte)</span></span>
        <span className="tabular"><b className="text-[22px] font-semibold text-alert">{m.perdidos}</b><span className="text-[13px] text-graphite"> · {shareText(m.perdidos, m.leads)} dos leads novos</span></span>
      </div>
      {m.emAberto > 0 && (
        <p className="mt-3 text-[13px] text-graphite bg-paper-2 rounded-[var(--radius-control)] px-3 py-2.5" role="note">
          <b className="text-ink tabular">{m.emAberto}</b> {m.emAberto === 1 ? "lead ainda em aberto" : "leads ainda em aberto"}: podem avançar ou ser perdidos, então os números acima ainda mudam.
        </p>
      )}
    </div>
  );
}
