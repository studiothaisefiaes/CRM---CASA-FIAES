"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { BoardCard, BoardStage } from "@/server/queries/board";
import { DealCard } from "./deal-card";
import { useNow } from "./timer";
import { moveDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { StageDialogs, type PendingMove } from "./stage-dialogs";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";

type ListOpt = { id: string; label: string };

type Column = BoardStage & { virtual?: boolean; stageNames?: Record<string, string> };

/** Junta Follow-up 1–4 numa coluna só (lei de Hick): o número vai no card. */
function toColumns(stages: BoardStage[]): Column[] {
  const fus = stages.filter((s) => s.kind === "followup");
  const out: Column[] = [];
  for (const s of stages) {
    if (s.kind !== "followup") { out.push(s); continue; }
    if (s.id !== fus[0].id) continue;
    out.push({ ...fus[0], id: "followup", key: "followup_1", name: "Follow-up", virtual: true,
      stageNames: Object.fromEntries(fus.map((f) => [f.id, f.name])),
      cards: fus.flatMap((f) => f.cards).sort((a, b) => (a.stageEnteredAt < b.stageEnteredAt ? -1 : 1)) });
  }
  return out;
}

export function Board({ stages, lostReasons }: { stages: BoardStage[]; lostReasons: ListOpt[] }) {
  const [board, setBoard] = useState(stages);
  const [prevStages, setPrevStages] = useState(stages);
  if (stages !== prevStages) { setPrevStages(stages); setBoard(stages); }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const filtersQs = useMemo(() => { const p = new URLSearchParams(sp.toString()); p.delete("lead"); return p.toString(); }, [sp]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }));

  const [openClosed, setOpenClosed] = useState<Record<string, boolean>>({});
  const columns = useMemo(() => toColumns(board), [board]);
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
    const from = findCard(move.cardId)?.stage;
    applyMove(move.cardId, move.to.id);
    start(async () => {
      const r = await moveDealAction(move.cardId, move.to.key, extra);
      if (!r.ok) { setBoard(snapshot); toast(r.error, "error"); return; }
      router.refresh();
      // Movimento comum e reversível: desfazer em vez de pedir confirmação (Apple HIG).
      toast(`${move.name} foi para ${move.to.name}`, "ok", from ? { label: "Desfazer", onClick: () => {
        setBoard(snapshot);
        start(async () => { const u = await moveDealAction(move.cardId, from.key); if (!u.ok) toast(u.error, "error"); router.refresh(); });
      } } : undefined);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const toId = e.over?.id as string | undefined; const cardId = e.active.id as string;
    const from = findCard(cardId); if (!toId || !from || from.stage.id === toId) return;
    if (toId === "followup" && from.stage.kind === "followup") return;
    const to = toId === "followup" ? board.find((s) => s.key === "followup_1")! : board.find((s) => s.id === toId)!;
    const move: PendingMove = { cardId, name: from.card.contactName ?? "Lead", to: { id: to.id, key: to.key, name: to.name, kind: to.kind } };
    if (to.kind === "agendado" || to.kind === "perdido" || to.kind === "fechado") setPending(move);
    else commit(move);
  }

  return (
    <>
      <DndContext id="funil" sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(e.active.id as string)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <LayoutGroup>
          <div className="flex gap-3 overflow-x-auto scroll-thin px-5 lg:px-8 pb-6 snap-x snap-mandatory lg:snap-none" style={{ height: "calc(100dvh - 190px)" }}>
            {columns.map((s) => (s.kind === "fechado" || s.kind === "perdido") && !openClosed[s.id]
              ? <CollapsedColumn key={s.id} stage={s} onOpen={() => setOpenClosed((o) => ({ ...o, [s.id]: true }))} />
              : <ColumnView key={s.id} stage={s} activeId={activeId} filtersQs={filtersQs} onCollapse={s.kind === "fechado" || s.kind === "perdido" ? () => setOpenClosed((o) => ({ ...o, [s.id]: false })) : undefined} />)}
          </div>
        </LayoutGroup>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
          {active && <div className="w-[272px]"><DealCard card={active.card} slaMinutes={active.stage.slaMinutes} stageKind={active.stage.kind} stageName={active.stage.name} dragging filtersQs={filtersQs} /></div>}
        </DragOverlay>
      </DndContext>
      <StageDialogs pending={pending} lostReasons={lostReasons} onCancel={() => setPending(null)} onConfirm={(extra) => { const m = pending!; setPending(null); commit(m, extra); }} />
    </>
  );
}

function CollapsedColumn({ stage, onOpen }: { stage: Column; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <button ref={setNodeRef} type="button" onClick={onOpen} aria-label={`Mostrar ${stage.name}, ${stage.cards.length} leads`}
      className={cn("shrink-0 w-12 rounded-[16px] flex flex-col items-center gap-3 pt-3 transition-colors", isOver ? "bg-gold-soft ring-1 ring-gold/40" : "bg-paper-2 hover:bg-paper-3")}>
      <span className="size-2 rounded-full" style={{ background: stage.color }} />
      <span className="text-[12px] text-muted tabular">{stage.cards.length}</span>
      <span className="text-[12.5px] font-semibold [writing-mode:vertical-rl] rotate-180">{stage.name}</span>
    </button>
  );
}

function ColumnView({ stage, activeId, filtersQs, onCollapse }: { stage: Column; activeId: string | null; filtersQs: string; onCollapse?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const now = useNow();
  const late = stage.cards.filter((c) => c.awaitingReplySince && stage.slaMinutes && now - new Date(c.awaitingReplySince).getTime() >= stage.slaMinutes * 60_000).length;
  return (
    <section ref={setNodeRef} aria-label={`${stage.name}, ${stage.cards.length} leads`}
      className={cn("snap-start shrink-0 w-[288px] flex flex-col rounded-[16px] transition-colors duration-200", isOver ? "bg-gold-soft/70 ring-1 ring-gold/40" : "bg-paper-2")}>
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: stage.color }} />
          <h2 className="text-[13px] font-semibold">{stage.name}</h2>
          <span className="text-[12px] text-muted tabular">{stage.cards.length}</span>
          {onCollapse && <button type="button" onClick={onCollapse} className="text-[11.5px] text-muted hover:text-ink ml-1" aria-label={`Recolher ${stage.name}`}>recolher</button>}
        </div>
        {late > 0 && <span suppressHydrationWarning className="text-[11px] font-semibold text-alert bg-alert-soft rounded-[6px] px-1.5 h-5 grid place-items-center">{late} atrasado{late > 1 ? "s" : ""}</span>}
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2 flex flex-col gap-2 min-h-24">
        <AnimatePresence initial={false}>
          {stage.cards.map((c) => (
            <motion.div key={c.id} layout layoutId={c.id} transition={SPRING}
              initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: c.id === activeId ? 0.35 : 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
              <Draggable id={c.id}><DealCard card={c} slaMinutes={stage.slaMinutes} stageKind={stage.kind} stageName={stage.stageNames?.[c.stageId]} filtersQs={filtersQs} /></Draggable>
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
