"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { BoardCard, BoardStage } from "@/server/queries/board";
import { DealCard } from "./deal-card";
import { moveDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { StageDialogs, type PendingMove } from "./stage-dialogs";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";

type ListOpt = { id: string; label: string };

export function Board({ stages, lostReasons }: { stages: BoardStage[]; lostReasons: ListOpt[] }) {
  const [board, setBoard] = useState(stages);
  useEffect(() => setBoard(stages), [stages]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const filtersQs = useMemo(() => { const p = new URLSearchParams(sp.toString()); p.delete("lead"); return p.toString(); }, [sp]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));

  const findCard = (id: string) => { for (const s of board) { const c = s.cards.find((x) => x.id === id); if (c) return { card: c, stage: s }; } return null; };
  const active = activeId ? findCard(activeId) : null;

  function applyMove(cardId: string, toStageId: string) {
    setBoard((b) => {
      const from = b.find((s) => s.cards.some((c) => c.id === cardId)); if (!from) return b;
      const card = from.cards.find((c) => c.id === cardId)!;
      return b.map((s) => s.id === from.id ? { ...s, cards: s.cards.filter((c) => c.id !== cardId) }
        : s.id === toStageId ? { ...s, cards: [{ ...card, stageId: toStageId, stageEnteredAt: new Date().toISOString() }, ...s.cards] } : s);
    });
  }

  function commit(move: PendingMove, extra?: Record<string, unknown>) {
    const snapshot = board;
    applyMove(move.cardId, move.to.id);
    start(async () => {
      const r = await moveDealAction(move.cardId, move.to.key, extra);
      if (!r.ok) { setBoard(snapshot); toast(r.error, "error"); }
      else { toast(`Movido para ${move.to.name}`); router.refresh(); }
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const toId = e.over?.id as string | undefined; const cardId = e.active.id as string;
    const from = findCard(cardId); if (!toId || !from || from.stage.id === toId) return;
    const to = board.find((s) => s.id === toId)!;
    const move: PendingMove = { cardId, name: from.card.contactName ?? "Lead", to: { id: to.id, key: to.key, name: to.name, kind: to.kind } };
    if (to.kind === "agendado" || to.kind === "perdido" || to.kind === "fechado") setPending(move);
    else commit(move);
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <LayoutGroup>
          <div className="flex gap-3 overflow-x-auto scroll-thin px-5 lg:px-8 pb-6 snap-x snap-mandatory lg:snap-none" style={{ height: "calc(100dvh - 190px)" }}>
            {board.map((s) => <Column key={s.id} stage={s} activeId={activeId} filtersQs={filtersQs} />)}
          </div>
        </LayoutGroup>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
          {active && <div className="w-[272px]"><DealCard card={active.card} slaMinutes={active.stage.slaMinutes} stageKind={active.stage.kind} dragging filtersQs={filtersQs} /></div>}
        </DragOverlay>
      </DndContext>
      <StageDialogs pending={pending} lostReasons={lostReasons} onCancel={() => setPending(null)} onConfirm={(extra) => { const m = pending!; setPending(null); commit(m, extra); }} />
    </>
  );
}

function Column({ stage, activeId, filtersQs }: { stage: BoardStage; activeId: string | null; filtersQs: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const late = stage.cards.filter((c) => c.awaitingReplySince && stage.slaMinutes && Date.now() - new Date(c.awaitingReplySince).getTime() >= stage.slaMinutes * 60_000).length;
  return (
    <section ref={setNodeRef} aria-label={`${stage.name}, ${stage.cards.length} leads`}
      className={cn("snap-start shrink-0 w-[288px] flex flex-col rounded-[16px] transition-colors duration-200", isOver ? "bg-gold-soft/70 ring-1 ring-gold/40" : "bg-paper-2")}>
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: stage.color }} />
          <h2 className="text-[13px] font-semibold">{stage.name}</h2>
          <span className="text-[12px] text-muted tabular">{stage.cards.length}</span>
        </div>
        {late > 0 && <span className="text-[11px] font-semibold text-alert bg-alert-soft rounded-[6px] px-1.5 h-5 grid place-items-center">{late} atrasado{late > 1 ? "s" : ""}</span>}
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2 flex flex-col gap-2 min-h-24">
        <AnimatePresence initial={false}>
          {stage.cards.map((c) => (
            <motion.div key={c.id} layout layoutId={c.id} transition={SPRING}
              initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: c.id === activeId ? 0.35 : 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
              <Draggable id={c.id}><DealCard card={c} slaMinutes={stage.slaMinutes} stageKind={stage.kind} filtersQs={filtersQs} /></Draggable>
            </motion.div>
          ))}
        </AnimatePresence>
        {stage.cards.length === 0 && <p className="text-[12px] text-muted text-center py-6 px-4">Arraste um lead para cá</p>}
      </div>
    </section>
  );
}

function Draggable({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id });
  return <div ref={setNodeRef} {...listeners} {...attributes} role="listitem" className="touch-manipulation outline-none">{children}</div>;
}

export type { BoardCard };
