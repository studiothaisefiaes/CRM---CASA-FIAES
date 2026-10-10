"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent, type KeyboardCoordinateGetter, type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { BoardCard, BoardStage } from "@/server/queries/board";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { DealCard } from "./deal-card";
import { StageSheets } from "./stage-sheets";
import { moveDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { orderByUrgency } from "@/lib/board-order";
import { formatPhoneClient } from "@/lib/phone-client";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Column = BoardStage & { virtual?: boolean; stageNames?: Record<string, string> };

/** Agendado, Fechado e Perdido pedem dados (data, venda, motivo): soltar ali abre a folha da Fila em vez de mover direto. */
const OWN_ACTION_KINDS = ["agendado", "fechado", "perdido"];
/** Id da coluna que junta Follow-up 1 a 4 (lei de Hick): o número do follow-up vai no card. */
const FOLLOWUP_COLUMN = "followup";

function toColumns(stages: BoardStage[]): Column[] {
  const fus = stages.filter((s) => s.kind === "followup");
  const out: Column[] = [];
  for (const s of stages) {
    if (s.kind !== "followup") { out.push(s); continue; }
    if (s.id !== fus[0].id) continue;
    out.push({ ...fus[0], id: FOLLOWUP_COLUMN, key: "followup_1", name: "Follow-up", virtual: true,
      stageNames: Object.fromEntries(fus.map((f) => [f.id, f.name])),
      cards: orderByUrgency(fus.flatMap((f) => f.cards)) });
  }
  return out;
}

const cardName = (c: BoardCard) => c.contactName?.trim() || formatPhoneClient(c.phone);

/** Anúncios do leitor de tela (pt-BR) e as instruções de quem usa o teclado. */
const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "Para mudar este lead de coluna, aperte Espaço. Depois use as setas para a esquerda e para a direita para escolher a coluna, Espaço para soltar e Esc para cancelar.",
};

/** Teclado: cada seta move o card para o centro da coluna vizinha (o padrão do dnd-kit andaria 25 px por vez). */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context: { active, droppableRects, droppableContainers, collisionRect } }) => {
  if (!active || !collisionRect) return undefined;
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (event.code.startsWith("Arrow")) event.preventDefault(); // as setas não rolam a página enquanto o card está na mão
  if (!dir) return undefined;
  const cols = droppableContainers.getEnabled().flatMap((c) => { const r = droppableRects.get(c.id); return r ? [{ id: c.id, rect: r }] : []; }).sort((a, b) => a.rect.left - b.rect.left);
  if (!cols.length) return undefined;
  const cx = collisionRect.left + collisionRect.width / 2;
  const here = cols.reduce((best, c, i) => (Math.abs(c.rect.left + c.rect.width / 2 - cx) < Math.abs(cols[best].rect.left + cols[best].rect.width / 2 - cx) ? i : best), 0);
  const target = cols[Math.min(cols.length - 1, Math.max(0, here + dir))].rect;
  return { x: target.left + target.width / 2 - collisionRect.width / 2, y: Math.max(target.top, 0) + 12 };
};

/** Ponteiro: a coluna sob o dedo. Teclado (sem ponteiro): a coluna de centro mais próximo. */
const collision: CollisionDetection = (args) => {
  if (args.pointerCoordinates) { const hit = pointerWithin(args); if (hit.length) return hit; }
  return closestCenter(args);
};

export function Board({ stages, viewer }: { stages: BoardStage[]; viewer: Viewer }) {
  const [board, setBoard] = useState(stages);
  const [prevStages, setPrevStages] = useState(stages);
  if (stages !== prevStages) { setPrevStages(stages); setBoard(stages); }
  const [activeId, setActiveId] = useState<string | null>(null);
  // Soltou em Agendado/Fechado/Perdido: a folha da Fila abre; `n` renova a folha a cada soltura.
  const [sheet, setSheet] = useState<{ n: number; cardId: string; name: string; to: { id: string; key: string } } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // O card que está esperando a folha abrir (a busca do lead leva um instante): mostra "Abrindo…".
  const [openingId, setOpeningId] = useState<string | null>(null);
  const sheetReady = useCallback(() => setOpeningId(null), []);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const reduced = useReducedMotion();
  const sp = useSearchParams();
  const filtersQs = useMemo(() => { const p = new URLSearchParams(sp.toString()); p.delete("lead"); return p.toString(); }, [sp]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    // Espaço pega e solta (Enter segue abrindo o lead, que é um link); Esc cancela.
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const [openClosed, setOpenClosed] = useState<Record<string, boolean>>({});
  const columns = useMemo(() => toColumns(board), [board]);
  const findCard = (id: string) => { for (const s of board) { const c = s.cards.find((x) => x.id === id); if (c) return { card: c, stage: s }; } return null; };
  const active = activeId ? findCard(activeId) : null;
  const columnName = (id: unknown) => columns.find((c) => c.id === id)?.name ?? null;

  function applyMove(cardId: string, toStageId: string) {
    setBoard((b) => {
      const from = b.find((s) => s.cards.some((c) => c.id === cardId)); if (!from) return b;
      const card = from.cards.find((c) => c.id === cardId)!;
      return b.map((s) => s.id === from.id ? { ...s, cards: s.cards.filter((c) => c.id !== cardId) }
        : s.id === toStageId ? { ...s, cards: orderByUrgency([{ ...card, stageId: toStageId, stageEnteredAt: new Date().toISOString() }, ...s.cards]) } : s);
    });
  }

  function commit(cardId: string, name: string, to: { id: string; key: string; name: string }) {
    const snapshot = board;
    const from = findCard(cardId)?.stage;
    applyMove(cardId, to.id);
    start(async () => {
      const r = await moveDealAction(cardId, to.key);
      if (!r.ok) { setBoard(snapshot); toast(r.error, "error"); return; }
      router.refresh();
      // Movimento comum e reversível: desfazer em vez de pedir confirmação (Apple HIG). Sair de Agendado, Fechado ou Perdido não se desfaz aqui:
      // voltar exigiria a ação própria (data, venda, motivo).
      const undo = from && !OWN_ACTION_KINDS.includes(from.kind) ? { label: "Desfazer", onClick: () => {
        setBoard(snapshot);
        start(async () => { const u = await moveDealAction(cardId, from.key); if (!u.ok) toast(u.error, "error"); router.refresh(); });
      } } : undefined;
      toast(`${name} foi para ${to.name}`, "ok", undo);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const toId = e.over?.id as string | undefined; const cardId = e.active.id as string;
    const from = findCard(cardId); if (!toId || !from || from.stage.id === toId) return;
    if (toId === FOLLOWUP_COLUMN && from.stage.kind === "followup") return;
    const to = toId === FOLLOWUP_COLUMN ? board.find((s) => s.key === "followup_1") : board.find((s) => s.id === toId);
    if (!to) return;
    const name = cardName(from.card);
    if (e.activatorEvent instanceof KeyboardEvent) setFocusId(cardId);
    if (OWN_ACTION_KINDS.includes(to.kind)) { setOpeningId(cardId); setSheet((s) => ({ n: (s?.n ?? 0) + 1, cardId, name, to: { id: to.id, key: to.key } })); }
    else commit(cardId, name, to);
  }

  // O dnd-kit anuncia "sobre a coluna X" logo depois de pegar, o que cobriria o "Pegou…": o primeiro aviso de "sobre" (a coluna de origem) fica de fora.
  const justPicked = useRef(false);
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => { justPicked.current = true; const f = findCard(a.id as string); return f ? `Pegou ${cardName(f.card)}, da coluna ${f.stage.kind === "followup" ? "Follow-up" : f.stage.name}.` : undefined; },
    onDragOver: ({ active: a, over }) => {
      const f = findCard(a.id as string); if (!f) return undefined;
      if (justPicked.current) { justPicked.current = false; if (over && (over.id === f.stage.id || (over.id === FOLLOWUP_COLUMN && f.stage.kind === "followup"))) return undefined; }
      return over ? `${cardName(f.card)} está sobre a coluna ${columnName(over.id) ?? "?"}.` : `${cardName(f.card)} está fora das colunas.`;
    },
    onDragEnd: ({ active: a, over }) => {
      const f = findCard(a.id as string); if (!f) return undefined;
      const to = over ? columns.find((c) => c.id === over.id) : null;
      if (!to) return `${cardName(f.card)} foi solto fora das colunas e ficou onde estava.`;
      if (to.id === f.stage.id || (to.id === FOLLOWUP_COLUMN && f.stage.kind === "followup")) return `${cardName(f.card)} ficou em ${to.name}.`;
      return OWN_ACTION_KINDS.includes(to.kind) ? `${cardName(f.card)} solto em ${to.name}. Preencha os dados para confirmar.` : `${cardName(f.card)} foi para ${to.name}.`;
    },
    onDragCancel: ({ active: a }) => { const f = findCard(a.id as string); return f ? `Movimento cancelado. ${cardName(f.card)} continua em ${f.stage.kind === "followup" ? "Follow-up" : f.stage.name}.` : undefined; },
  };

  return (
    <>
      <DndContext id="funil" sensors={sensors} collisionDetection={collision} accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS, restoreFocus: false }}
        onDragStart={(e: DragStartEvent) => { setActiveId(e.active.id as string); setFocusId(null); }} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <LayoutGroup>
          <div className="flex gap-3 overflow-x-auto scroll-thin px-5 lg:px-8 pb-6 snap-x snap-mandatory lg:snap-none" style={{ height: "calc(100dvh - 190px)" }}>
            {columns.map((s) => (s.kind === "fechado" || s.kind === "perdido") && !openClosed[s.id]
              ? <CollapsedColumn key={s.id} stage={s} onOpen={() => setOpenClosed((o) => ({ ...o, [s.id]: true }))} />
              : <ColumnView key={s.id} stage={s} activeId={activeId} focusId={focusId} openingId={openingId} filtersQs={filtersQs} onCollapse={s.kind === "fechado" || s.kind === "perdido" ? () => setOpenClosed((o) => ({ ...o, [s.id]: false })) : undefined} />)}
          </div>
        </LayoutGroup>
        {/* "Reduzir movimento": o card solta e pronto, sem o voo de volta. */}
        <DragOverlay dropAnimation={reduced ? null : { duration: 220, easing: "cubic-bezier(0.22,1,0.36,1)" }}>
          {active && <div className="w-[272px]"><DealCard card={active.card} slaMinutes={active.stage.slaMinutes} stageKind={active.stage.kind} stageName={active.stage.name} dragging filtersQs={filtersQs} /></div>}
        </DragOverlay>
      </DndContext>
      {sheet && <StageSheets key={sheet.n} dealId={sheet.cardId} name={sheet.name} toKey={sheet.to.key} viewer={viewer} onMoved={() => { applyMove(sheet.cardId, sheet.to.id); router.refresh(); }} onReady={sheetReady} />}
    </>
  );
}

function CollapsedColumn({ stage, onOpen }: { stage: Column; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <button ref={setNodeRef} type="button" onClick={onOpen} aria-label={`Mostrar ${stage.name}, ${stage.cards.length} leads`}
      className={cn("shrink-0 w-12 rounded-[var(--radius-card)] flex flex-col items-center gap-3 pt-3 transition-colors", isOver ? "bg-gold-soft ring-1 ring-gold/40" : "bg-paper-2 hover:bg-paper-3")}>
      <span className="size-2 rounded-full" style={{ background: stage.color }} />
      <span className="text-xs text-muted tabular">{stage.cards.length}</span>
      <span className="text-sm font-semibold [writing-mode:vertical-rl] rotate-180">{stage.name}</span>
    </button>
  );
}

function ColumnView({ stage, activeId, focusId, openingId, filtersQs, onCollapse }: { stage: Column; activeId: string | null; focusId: string | null; openingId: string | null; filtersQs: string; onCollapse?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // Atrasado = alerta de espera aberto (a regra da Fila e da Jornada), não o relógio da tela.
  const late = stage.cards.filter((c) => c.urgency === "late").length;
  return (
    <section ref={setNodeRef} aria-label={`${stage.name}, ${stage.cards.length} leads`}
      className={cn("snap-start shrink-0 w-[288px] flex flex-col rounded-[var(--radius-card)] transition-colors duration-200", isOver ? "bg-gold-soft/70 ring-1 ring-gold/40" : "bg-paper-2")}>
      <header className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: stage.color }} />
          <h2 className="text-sm font-semibold">{stage.name}</h2>
          <span className="text-xs text-muted tabular">{stage.cards.length}</span>
          {onCollapse && <button type="button" onClick={onCollapse} className="text-xs text-muted hover:text-ink ml-1" aria-label={`Recolher ${stage.name}`}>recolher</button>}
        </div>
        {late > 0 && <span className="text-xs font-semibold text-alert bg-alert-soft rounded-[6px] px-1.5 h-5 grid place-items-center">{late} atrasado{late > 1 ? "s" : ""}</span>}
      </header>
      <div role="list" aria-label={`Leads em ${stage.name}`} className="flex-1 overflow-y-auto scroll-thin px-2 pb-2 flex flex-col gap-2 min-h-24">
        <AnimatePresence initial={false}>
          {stage.cards.map((c) => (
            <motion.div key={c.id} layout layoutId={c.id} transition={SPRING}
              initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: c.id === activeId ? 0.35 : 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
              <Draggable id={c.id} refocus={c.id === focusId}>
                {(a11y) => <DealCard card={c} slaMinutes={stage.slaMinutes} stageKind={stage.kind} stageName={stage.stageNames?.[c.stageId]} filtersQs={filtersQs} a11y={a11y} opening={c.id === openingId} />}
              </Draggable>
            </motion.div>
          ))}
        </AnimatePresence>
        {stage.cards.length === 0 && <p className="text-xs text-muted text-center py-6 px-4">Arraste um lead para cá</p>}
      </div>
    </section>
  );
}

/**
 * O card arrastável. O foco fica no link (Enter abre o lead, Espaço pega o card); o resto dos atributos do dnd-kit
 * (instruções para o leitor de tela) vai para o link também. `refocus`: depois de soltar pelo teclado, o foco volta ao card, que mudou de coluna.
 */
function Draggable({ id, refocus, children }: { id: string; refocus: boolean; children: (a11y: { "aria-describedby"?: string; "aria-roledescription": string }) => React.ReactNode }) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id });
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (refocus) box.current?.querySelector("a")?.focus(); }, [refocus]);
  return (
    <div ref={(el) => { box.current = el; setNodeRef(el); }} {...listeners} role="listitem" data-deal-id={id} className="touch-manipulation outline-none">
      {children({ "aria-describedby": attributes["aria-describedby"], "aria-roledescription": "lead arrastável" })}
    </div>
  );
}

export type { BoardCard };
