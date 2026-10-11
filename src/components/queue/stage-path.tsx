"use client";
import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { IconCheck } from "@/components/icons";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type PathStage = { id: string; key: string; name: string; kind: string };
type PathNode = { id: string; label: string; kind: string; /** A etapa para onde o toque leva (o 1º follow-up, no grupo). */ pick: string; current: boolean };

/** As etapas na ordem da configuração, com os Follow-ups agrupados num passo só (que mostra o follow-up atual quando o lead está nele). */
export function pathNodes(stages: PathStage[], currentKey: string): PathNode[] {
  const out: PathNode[] = [];
  for (const s of stages) {
    if (s.kind === "followup") {
      const group = out.find((n) => n.kind === "followup");
      if (group) { if (s.key === currentKey) { group.current = true; group.label = s.name; } continue; }
      out.push({ id: "followup", label: s.key === currentKey ? s.name : "Follow-up", kind: "followup", pick: s.key, current: s.key === currentKey });
    } else out.push({ id: s.id, label: s.name, kind: s.kind, pick: s.key, current: s.key === currentKey });
  }
  return out;
}

/**
 * A barra de etapas do lead (estilo Path): vertical, cabe nos 300 px do painel e nos 390 do celular. Tocar numa etapa move o lead.
 * Fechado, Perdido e Agendado pedem os dados antes (quem usa decide, em `onPick`). O trecho já percorrido fica em dourado.
 */
export function StagePath({ stages, currentKey, onPick, busy }: { stages: PathStage[]; currentKey: string; onPick: (stageKey: string) => void; busy?: boolean }) {
  const nodes = pathNodes(stages, currentKey);
  const curIdx = nodes.findIndex((n) => n.current);
  const lost = nodes[curIdx]?.kind === "perdido";
  // O trilho liga os passos do caminho; Perdido é um desvio e fica fora dele.
  const main = nodes.filter((n) => n.kind !== "perdido");
  const lostNode = nodes.find((n) => n.kind === "perdido");
  const progress = lost || curIdx < 0 || main.length < 2 ? 0 : Math.min(curIdx, main.length - 1) / (main.length - 1);

  const row = (n: PathNode, i: number, className?: string) => {
    const done = !lost && curIdx >= 0 && i < curIdx;
    const isLost = n.kind === "perdido", isWon = n.kind === "fechado";
    const dot = n.current
      ? isLost ? "bg-alert border-alert text-white" : isWon ? "bg-ok border-ok text-white" : "bg-paper border-gold shadow-[0_0_0_4px_rgb(184_134_63/0.2)]"
      : done ? "bg-ink border-ink text-paper" : isLost ? "bg-paper border-alert/60" : "bg-paper border-control";
    const inner = (
      <>
        <span aria-hidden className={cn("relative z-10 grid size-[18px] shrink-0 place-items-center rounded-full border-2", n.current && !isLost && !isWon && "border-[5px]", dot)}>
          {(done || (n.current && (isWon || isLost))) && (isLost ? <span className="h-0.5 w-2 rounded-full bg-white" /> : <IconCheck size={11} strokeWidth={3} />)}
        </span>
        <span className={cn("min-w-0 truncate text-md lg:text-base", n.current ? "font-semibold text-ink" : isLost ? "text-alert" : "text-graphite group-hover:text-ink")}>{n.label}</span>
      </>
    );
    return (
      <li key={n.id} className={className}>
        {n.current ? (
          <div aria-current="step" className="flex min-h-[var(--row)] items-center gap-3 px-1">{inner}<span className="sr-only"> (etapa atual)</span></div>
        ) : (
          <button type="button" disabled={busy} aria-label={`Mover para ${n.label}`} onClick={() => onPick(n.pick)}
            className="group flex min-h-[var(--row)] w-full items-center gap-3 rounded-[var(--radius-control)] px-1 text-left transition-colors hover:bg-paper-2 disabled:opacity-60">
            {inner}
          </button>
        )}
      </li>
    );
  };

  // O trilho acaba no centro do último passo do caminho; Perdido (com a margem, a linha e o respiro) vem depois.
  const railEnd = lostNode ? "calc(var(--row) / 2 + var(--row) + 0.5rem + 1px)" : "calc(var(--row) / 2)";
  return (
    <div className="[--row:2.25rem] pointer-coarse:[--row:2.75rem]" style={{ "--rail-end": railEnd } as CSSProperties}>
      <ol aria-label="Etapas" className="relative">
        <span aria-hidden className="absolute left-[calc(0.25rem+9px-0.5px)] top-[calc(var(--row)/2)] bottom-[var(--rail-end)] w-px bg-line-strong" />
        <motion.span aria-hidden className="absolute left-[calc(0.25rem+9px-1px)] top-[calc(var(--row)/2)] bottom-[var(--rail-end)] w-0.5 origin-top rounded-full bg-gold"
          initial={false} animate={{ scaleY: progress }} transition={{ duration: T.slow, ease: EASE }} />
        {main.map((n) => row(n, nodes.indexOf(n)))}
        {lostNode && row(lostNode, nodes.indexOf(lostNode), "mt-1 border-t border-line pt-1")}
      </ol>
    </div>
  );
}
