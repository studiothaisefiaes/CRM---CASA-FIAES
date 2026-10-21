"use client";
import Link from "next/link";
import { useTransition } from "react";
import { moveDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ActionSheet } from "./action-sheet";

export type QuickStage = { key: string; name: string; color?: string | null };
export type StageTarget = { dealId: string; name: string; stageKey: string };

/**
 * Trocar a etapa pela etiqueta da Fila: as etapas que mudam com um toque (Em conversa, Aguardando, Orçamento, Retorno…), cada uma com a sua cor.
 * Agendado, Fechado e Perdido pedem dados (data, venda, motivo): esses abrem a conversa, onde a folha certa pede o que falta.
 */
export function StageQuickMenu({ target, stages, onClose, onDone, openHref }: {
  target: StageTarget | null; stages: QuickStage[]; onClose: () => void; onDone: () => void; openHref: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const pick = (s: QuickStage) => {
    if (!target || s.key === target.stageKey) { onClose(); return; }
    start(async () => {
      const r = await moveDealAction(target.dealId, s.key);
      toast(r.ok ? `${target.name} foi para ${s.name}` : r.error, r.ok ? "ok" : "error");
      if (r.ok) onDone();
    });
  };
  return (
    <ActionSheet open={!!target} onClose={onClose} title={target ? `Etapa de ${target.name}` : "Etapa"}
      footer={<Button variant="secondary" onClick={onClose}>Cancelar</Button>}>
      <ul className="flex flex-col gap-1">
        {stages.map((s) => {
          const c = /^#[0-9a-f]{6}$/i.test(s.color ?? "") ? s.color! : "#5c5c5c";
          const current = s.key === target?.stageKey;
          return (
            <li key={s.key}>
              <button type="button" disabled={pending} aria-current={current ? "true" : undefined} onClick={() => pick(s)}
                className={cn("flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-base transition-colors hover:bg-paper-2 disabled:opacity-60", current && "font-semibold")}>
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ backgroundColor: c }} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {current && <span className="text-xs font-normal text-muted">atual</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <Link href={openHref} onClick={onClose} className="mt-3 flex min-h-11 items-center px-3 text-sm text-graphite underline underline-offset-2 hover:text-ink">
        Agendar, fechar venda ou perdido: abrir a conversa
      </Link>
    </ActionSheet>
  );
}
