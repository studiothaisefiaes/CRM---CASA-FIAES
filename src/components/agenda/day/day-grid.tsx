"use client";
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { AgendaItem } from "@/server/queries/agenda";
import { layoutLanes, minuteOfDay, timeRange } from "@/lib/agenda";
import { canPlace, freeGaps, hm, isMovable, minuteAt, occupancy, VIEW_STATUS, viewStatus, type PlaceCtx } from "@/lib/agenda-day";
import { PX_PER_MIN, type AgendaViewCfg } from "@/lib/agenda-view-prefs";
import { formatPhoneClient } from "@/lib/phone-client";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DayAck } from "@/server/domain/pro/acks";
import { ProAvatar } from "../pro-avatar";
import { ProAckLine } from "../pro-ack";
import { shownName } from "../use-agenda-actions";
import { FIRST_VISIT_LABEL } from "@/lib/visit-type";

export type DayPro = { id: string; name: string; role: string | null; color: string | null; photoUrl: string | null; ranges: [number, number][]; off: boolean; serviceIds: string[] };
export type GridBlock = { id: string; professionalId: string | null; title: string; start: number; end: number; label: string };
export type GridColumn = { pro: DayPro | null; key: string };
export type DragState = { key: string; from: string | null } | null;
export type OverState = { pro: string; t: number } | null;

const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";
/** "Mirela Campos" → "Mirela C." (coluna estreita). */
const short = (s: string) => { const p = s.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };
const hh = (m: number) => (m % 60 ? hm(m) : `${m / 60}h`);
/** Tipo do dado arrastado: a coluna aceita na hora (o estado do React chega um instante depois do dragstart). */
const DRAG_TYPE = "application/x-cf-horario";
const isOurDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
const noSub = () => () => {};
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const STRIPES: CSSProperties = { backgroundImage: "repeating-linear-gradient(135deg, #f7f5f1 0 6px, #f0ede7 6px 12px)" };
const HATCH: CSSProperties = { backgroundColor: "rgb(244 242 238 / 0.55)" };

/**
 * A grade do dia: uma coluna por profissional (todas cabem na largura; com muitas, rola só dentro da grade), cartões limpos (hora,
 * nome, o cartão pintado com a cor do status, como no Avec), e arrastar um horário para outra pessoa ou hora (a regra é a mesma do "Mover…").
 */
export function DayGrid(p: {
  columns: GridColumn[]; items: AgendaItem[]; cfg: AgendaViewCfg; range: { start: number; end: number };
  ctx: PlaceCtx; nowMs: number; isToday: boolean; q: string; caixaOn: boolean; prices: Record<string, number> | null;
  canBook: boolean; acks?: Record<string, DayAck>; highlight: string | null; editableBlocks: Set<string>;
  blocks: GridBlock[]; counts: Record<string, number>;
  drag: DragState; over: OverState; setDrag: (d: DragState) => void; setOver: (o: OverState) => void;
  onDrop: (item: AgendaItem, toPro: string, t: number) => void;
  onOpen: (i: AgendaItem) => void; onBook: (proId: string | null, t: number) => void; onBlock: (id: string) => void;
  onHeader: (proId: string) => void; onAll: () => void;
}) {
  const { columns, cfg, range, ctx, nowMs, isToday } = p;
  const PX = PX_PER_MIN[cfg.tam];
  const snap = Math.min(cfg.passo, 30);
  const height = Math.round((range.end - range.start) * PX);
  const y = (m: number) => (Math.min(Math.max(m, range.start), range.end) - range.start) * PX;
  const solo = columns.length === 1;
  const few = columns.length <= 6; // até 6 colunas o nome vai inteiro; mais que isso, "Mirela C."
  const nowMin = isToday ? minuteOfDay(new Date(nowMs)) : null;
  const nowIn = nowMin != null && nowMin > range.start && nowMin < range.end;
  const scroller = useRef<HTMLDivElement>(null);
  // "data-pronta": a grade já responde a clique e arrastar (hidratada). Os testes esperam por ela.
  const ready = useSyncExternalStore(noSub, () => true, () => false);
  const dragItem = p.drag ? p.items.find((i) => i.key === p.drag!.key) ?? null : null;
  const q = fold(p.q.trim());
  const matches = (i: AgendaItem) => !q || fold(shownName(i)).includes(q) || fold(i.service ?? "").includes(q);

  // Abre no agora (hoje) ou no primeiro horário, uma vez por dia (o recarregar ao vivo não mexe na rolagem de quem está olhando).
  const firstMin = p.items.filter((i) => i.status !== "cancelado").reduce((m, i) => Math.min(m, minuteOfDay(i.scheduledAt)), Infinity);
  const focus = nowIn ? y(nowMin!) : Number.isFinite(firstMin) ? y(firstMin) : 0;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el || scrolledFor.current === ctx.day) return;
    scrolledFor.current = ctx.day;
    el.scrollTop = Math.max(0, focus - 90 * PX); // hora e meia antes do agora: quem passou da hora sem baixa fica à vista
  }, [ctx.day, focus, PX]);
  useEffect(() => { if (p.highlight) document.querySelector(`[data-highlight="true"]`)?.scrollIntoView({ block: "center", inline: "center" }); }, [p.highlight]);

  const template = `44px ${columns.map((c) => (c.pro?.off && !solo ? "minmax(56px,.45fr)" : "minmax(112px,1fr)")).join(" ")}`;
  const grid = `linear-gradient(#ece9e3 1px, transparent 1px) 0 0/100% ${60 * PX}px${cfg.passo < 60 ? `, linear-gradient(#f5f3ef 1px, transparent 1px) 0 0/100% ${cfg.passo * PX}px` : ""}`;

  const overAt = (e: DragEvent<HTMLDivElement>) => minuteAt(e.clientY - e.currentTarget.getBoundingClientRect().top, PX, range, snap);
  const hours: number[] = [];
  for (let m = Math.ceil(range.start / 60) * 60; m < range.end; m += 60) hours.push(m);

  return (
    <section ref={scroller} aria-label="Agenda do dia por profissional" data-pronta={ready || undefined}
      className={cn("scroll-thin relative max-h-[calc(100dvh-150px)] min-h-[360px] overflow-auto rounded-[var(--radius-card)] bg-paper shadow-[inset_0_0_0_1px_#ece9e3]", p.drag && "[&_[data-ev]]:pointer-events-none [&_[data-gap]]:pointer-events-none [&_[data-blk]]:pointer-events-none")}>
      <div className="grid min-w-full [grid-template-columns:var(--cols)] max-sm:[grid-template-columns:40px_minmax(0,1fr)]" style={{ "--cols": template } as CSSProperties}>
        {/* Cabeçalho preso */}
        <div className="sticky top-0 z-20 border-b border-[#ece9e3] bg-paper" />
        {columns.map((c, k) => {
          const pro = c.pro;
          const n = pro ? p.counts[pro.id] ?? 0 : 0;
          const occ = pro && cfg.ocup ? occupancy(pro.id, ctx) : null;
          const sub = !pro ? null : solo
            ? [pro.role, pro.off ? "folga neste dia" : `${n} ${n === 1 ? "horário" : "horários"}`, occ != null && !pro.off ? `${occ}% ocupada` : null].filter(Boolean).join(" · ")
            : pro.off ? "Folga" : occ != null ? `${occ}%` : null;
          return (
            <div key={c.key} data-coluna-cabecalho={c.key} className={cn("sticky top-0 z-20 flex min-w-0 border-b border-[#ece9e3] bg-paper p-0.5", k > 0 && "max-sm:hidden")}>
              {pro ? (
                <button type="button" onClick={() => (solo ? p.onAll() : p.onHeader(pro.id))} aria-label={solo ? "Voltar para todas lado a lado" : `Ver só a agenda de ${pro.name}`}
                  className="flex min-h-10 min-w-0 flex-1 flex-col justify-center gap-1 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-paper-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {solo && <ProAvatar name={pro.name} color={pro.color} photoUrl={pro.photoUrl} size={32} soft />}
                    <span className={cn("truncate font-semibold", solo ? "text-md text-ink" : "text-sm text-ink-2")}>{solo ? pro.name : first(pro.name)}</span>
                  </span>
                  {sub && <span className="truncate text-xs text-muted tabular">{sub}</span>}
                  {occ != null && !pro.off && <span aria-hidden className="block h-[3px] overflow-hidden rounded-full bg-paper-3"><span className="block h-full rounded-full bg-muted" style={{ width: `${occ}%` }} /></span>}
                  {solo && <ProAckLine ack={p.acks?.[pro.id]} nowMs={nowMs} />}
                </button>
              ) : <span className="flex min-h-10 items-center px-2 text-sm font-semibold text-graphite">Sem profissional</span>}
            </div>
          );
        })}

        {/* Horas */}
        <div className="relative" style={{ height }} aria-hidden>
          {hours.map((m) => <span key={m} className="absolute right-2 text-xs font-medium text-muted tabular" style={{ top: y(m) + 3 }}>{hh(m)}</span>)}
          {nowIn && <span className="absolute right-0.5 z-10 -translate-y-1/2 rounded-[4px] bg-paper px-0.5 text-xs font-bold text-gold-ink tabular" style={{ top: y(nowMin!) }}>{hm(nowMin!)}</span>}
        </div>

        {columns.map((c, k) => {
          const pro = c.pro;
          const pid = pro?.id ?? null;
          const mine = p.items.filter((i) => (i.professionalId ?? null) === pid && i.status !== "cancelado" && !i.noTime)
            .filter((i) => minuteOfDay(i.scheduledAt) < range.end && minuteOfDay(i.scheduledAt) + i.durationMin > range.start);
          // 0089: onde ela é auxiliar, o horário aparece na coluna dela com o selo (abre o horário da principal; não arrasta).
          const helping = pid ? p.items.filter((i) => i.assistants?.some((a) => a.id === pid) && i.status !== "cancelado" && !i.noTime)
            .filter((i) => minuteOfDay(i.scheduledAt) < range.end && minuteOfDay(i.scheduledAt) + i.durationMin > range.start) : [];
          const lanes = layoutLanes([...mine.map((i) => ({ key: i.key, start: minuteOfDay(i.scheduledAt), end: minuteOfDay(i.scheduledAt) + i.durationMin })),
            ...helping.map((i) => ({ key: `aux:${i.key}`, start: minuteOfDay(i.scheduledAt), end: minuteOfDay(i.scheduledAt) + i.durationMin }))]);
          const outside: [number, number][] = [];
          if (pro && !pro.off) {
            let cur = range.start;
            for (const [a, b] of [...pro.ranges].sort((x, z) => x[0] - z[0])) { if (a > cur) outside.push([cur, Math.min(a, range.end)]); cur = Math.max(cur, b); }
            if (cur < range.end) outside.push([cur, range.end]);
          }
          const myBlocks = cfg.bloq ? p.blocks.filter((b) => b.professionalId === null || b.professionalId === pid) : [];
          const gaps = cfg.livres && pro && !pro.off ? freeGaps(pro.id, ctx).filter(([a, b]) => b > range.start && a < range.end) : [];
          const cells: number[] = [];
          if (p.canBook && pro) for (let t = range.start; t < range.end; t += snap) cells.push(t);
          let ghost: ReactNode = null;
          if (dragItem && p.over && pro && p.over.pro === pro.id) {
            const r = canPlace(dragItem, pro.id, p.over.t, ctx);
            const same = pro.id === (p.drag!.from ?? "");
            ghost = (
              <div data-ghost aria-hidden className={cn("pointer-events-none absolute inset-x-1 z-30 flex flex-col gap-0.5 overflow-hidden rounded-[8px] border-2 border-dashed px-2 py-1 text-xs font-semibold leading-tight", r.ok ? "border-gold bg-gold/10 text-gold-ink" : "border-alert bg-alert/5 text-alert")}
                style={{ top: y(p.over.t) + 1, height: Math.max(18, dragItem.durationMin * PX - 2) }}>
                <span className="tabular">{hm(p.over.t)} · {first(shownName(dragItem))}</span>
                <span>{r.ok ? (same ? "Soltar para mudar a hora" : `Soltar para passar para a ${first(pro.name)}`) : r.why.charAt(0).toUpperCase() + r.why.slice(1)}</span>
              </div>
            );
          }
          return (
            <div key={c.key} data-coluna={c.key} className={cn("relative min-w-0 border-l border-[#f1efea]", k > 0 && "max-sm:hidden")}
              style={{ height, background: grid }}
              onDragOver={pro ? (e) => { if (!p.drag && !isOurDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const t = overAt(e); if (!p.over || p.over.pro !== pro.id || p.over.t !== t) p.setOver({ pro: pro.id, t }); } : undefined}
              onDrop={pro ? (e) => { e.preventDefault(); const key = e.dataTransfer.getData(DRAG_TYPE) || p.drag?.key; const it = p.items.find((i) => i.key === key); const t = overAt(e); p.setDrag(null); p.setOver(null); if (it) p.onDrop(it, pro.id, t); } : undefined}>
              {isToday && nowMin != null && nowMin > range.start && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-paper-2/45" style={{ height: y(nowMin) }} />}
              {outside.map(([a, b]) => <div key={a} data-fora aria-hidden className="pointer-events-none absolute inset-x-0" style={{ ...HATCH, top: y(a), height: y(b) - y(a) }} />)}
              {cells.map((t) => (
                <button key={t} type="button" tabIndex={-1} aria-label={`Marcar com ${pro!.name} às ${hm(t)}`} onClick={() => p.onBook(pro!.id, t)}
                  className="group absolute inset-x-0 z-[1] flex items-start px-2 pt-0.5 text-left text-xs font-medium text-gold-ink tabular hover:bg-[#faf6ef]"
                  style={{ top: y(t), height: snap * PX }}>
                  <span className="opacity-0 group-hover:opacity-100">+ {hm(t)}</span>
                </button>
              ))}
              {pro?.off && cfg.bloq && (
                <div data-blk className="pointer-events-none absolute inset-x-1 top-0 z-[2] grid place-items-center rounded-[8px] text-xs font-medium text-muted" style={{ ...STRIPES, height }}>
                  <span className={cn(!solo && "[writing-mode:vertical-rl] rotate-180")}>Folga</span>
                </div>
              )}
              {myBlocks.map((b) => {
                const top = y(b.start), h = y(b.end) - top;
                if (h <= 0) return null;
                const cls = "absolute inset-x-1 z-[2] grid place-items-center overflow-hidden rounded-[8px] px-1 text-center text-xs font-medium text-muted";
                const label = <span className="flex min-w-0 flex-col items-center leading-tight"><span className="max-w-full truncate">{b.title}</span>{h >= 34 && <span className="max-w-full truncate tabular">{b.label}</span>}</span>;
                return p.editableBlocks.has(b.id)
                  ? <button key={b.id} data-blk type="button" aria-haspopup="dialog" aria-label={`Bloqueado: ${b.title}, ${b.label}`} onClick={() => p.onBlock(b.id)} className={cn(cls, "hover:brightness-95")} style={{ ...STRIPES, top: top + 1, height: h - 2 }}>{label}</button>
                  : <div key={b.id} data-blk aria-label={`Bloqueado: ${b.title}, ${b.label}`} className={cn(cls, "pointer-events-none")} style={{ ...STRIPES, top: top + 1, height: h - 2 }}>{label}</div>;
              })}
              {gaps.map(([a, b]) => {
                const h = y(b) - y(a);
                return (
                  <button key={a} data-gap type="button" aria-label={`Marcar com ${pro!.name} às ${hm(a)}, livre até ${hm(b)}`} onClick={() => p.onBook(pro!.id, a)}
                    className="absolute inset-x-1 z-[3] flex items-center justify-center rounded-[8px] border border-dashed border-line-strong text-xs font-medium text-muted tabular hover:border-gold hover:bg-gold-soft hover:text-gold-ink"
                    style={{ top: y(a) + 1, height: h - 2 }}>{h >= 34 ? `Livre ${hh(a)}–${hh(b)}` : "Livre"}</button>
                );
              })}
              {mine.map((i) => <Card key={i.key} i={i} pid={pid} lane={lanes.get(i.key) ?? { lane: 0, lanes: 1 }} {...{ cfg, PX, y, range, solo, few, nowMs }} p={p} dim={!matches(i)} />)}
              {helping.map((i) => <AuxCard key={`aux:${i.key}`} i={i} lane={lanes.get(`aux:${i.key}`) ?? { lane: 0, lanes: 1 }} {...{ PX, y, range, solo, few, nowMs }} p={p} dim={!matches(i)} />)}
              {ghost}
              {nowIn && <span aria-hidden className="pointer-events-none absolute inset-x-0 z-[15] border-t-[1.5px] border-gold" style={{ top: y(nowMin!) }} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({ i, pid, lane, cfg, PX, y, range, solo, few, nowMs, p, dim }: {
  i: AgendaItem; pid: string | null; lane: { lane: number; lanes: number }; cfg: AgendaViewCfg; PX: number; y: (m: number) => number;
  range: { start: number; end: number }; solo: boolean; few: boolean; nowMs: number; dim: boolean; p: Parameters<typeof DayGrid>[0];
}) {
  const st = viewStatus(i, nowMs, { caixaOn: p.caixaOn });
  const s = Math.max(minuteOfDay(i.scheduledAt), range.start), e = Math.min(minuteOfDay(i.scheduledAt) + i.durationMin, range.end);
  const h = Math.max(14, Math.round((e - s) * PX) - 2);
  const lines = Math.max(1, Math.floor((h - 6) / 16));
  const one = !solo && lines < 2;
  const start = hm(minuteOfDay(i.scheduledAt)), end = hm((minuteOfDay(i.scheduledAt) + i.durationMin) % 1440);
  const price = p.prices && i.serviceId && p.prices[i.serviceId] != null ? money(p.prices[i.serviceId]) : null;
  const tel = i.phone && i.phone !== i.name ? formatPhoneClient(i.phone) : null;
  const movable = p.canBook && isMovable(i);
  const dragging = p.drag?.key === i.key;
  const hi = !!p.highlight && i.appointmentId === p.highlight;
  const extras: string[] = [];
  // Fase C (item 19): marcador, tipo e Primeira vez em texto, para a cor do marcador não ser a única pista.
  const marks = [i.label?.name, i.visitTypeLabel, i.firstVisit ? FIRST_VISIT_LABEL : null].filter(Boolean).join(" · ");
  let line1 = start;
  if (solo) {
    line1 = `${start}–${end}`;
    extras.push(i.service || "Serviço não informado");
    if (cfg.card.tel && tel) extras.push(tel);
    if (cfg.card.valor && price) extras.push(price);
    if (marks) extras.push(marks);
    if (cfg.card.obs && i.notes) extras.push(i.notes);
  } else {
    if (cfg.card.valor && price) line1 += ` · ${price}`;
    const want: string[] = [];
    if (i.service && (cfg.card.serv || lines >= 3)) want.push(i.service);
    if (marks) want.push(marks);
    if (cfg.card.tel && tel) want.push(tel);
    if (cfg.card.obs && i.notes) want.push(i.notes);
    const room = Math.max(0, lines - 2);
    extras.push(...want.slice(0, room));
    if (cfg.card.serv && room === 0 && !one && i.service) line1 += ` · ${i.service}`;
  }
  const heart = cfg.card.pref && i.preference === "escolhida";
  const name = solo || few ? shownName(i) : short(shownName(i));
  return (
    <button type="button" data-ev data-status={st} draggable={movable}
      onClick={() => p.onOpen(i)}
      onDragStart={(ev) => {
        if (!movable) { ev.preventDefault(); return; }
        ev.dataTransfer.setData(DRAG_TYPE, i.key); ev.dataTransfer.setData("text/plain", shownName(i)); ev.dataTransfer.effectAllowed = "move";
        setTimeout(() => p.setDrag({ key: i.key, from: pid }), 0);
      }}
      onDragEnd={() => { p.setDrag(null); p.setOver(null); }}
      aria-haspopup="dialog" data-highlight={hi || undefined}
      aria-label={`${timeRange(i.scheduledAt, i.durationMin)}, ${shownName(i)}${i.service ? `, ${i.service}` : ""}${marks ? `, ${marks}` : ""}, ${VIEW_STATUS[st].label}. Abrir detalhes${movable ? ". Dá para arrastar para outra pessoa ou hora" : ""}`}
      title={`${shownName(i)} · ${i.service ?? "Serviço não informado"} · ${VIEW_STATUS[st].label}`}
      className={cn("absolute z-[4] flex overflow-hidden rounded-[8px] text-left transition-[opacity,box-shadow] duration-150 hover:z-[6] hover:shadow-[0_4px_14px_rgb(18_18_18/0.14)]",
        movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        one ? "flex-row items-center gap-1.5 whitespace-nowrap pl-[9px] pr-2" : solo ? "flex-row flex-wrap content-start items-baseline gap-x-4 gap-y-0.5 py-2 pl-3.5 pr-4" : "flex-col gap-px py-[3px] pl-[9px] pr-2",
        (dim || dragging) && "opacity-30", hi && "ring-2 ring-gold", i.durationEstimated && "shadow-[inset_0_0_0_1px_#d3cfc7] [border-style:dashed]")}
      style={{ backgroundColor: VIEW_STATUS[st].bg, color: VIEW_STATUS[st].fg, boxShadow: `inset 0 0 0 1px ${VIEW_STATUS[st].bar}40`, top: y(s) + 1, height: h, left: `calc(${(lane.lane / lane.lanes) * 100}% + ${solo ? 6 : 3}px)`, width: `calc(${100 / lane.lanes}% - ${solo ? 12 : 6}px)` }}>
      {one ? (
        <>
          <span className="text-xs font-medium opacity-80 tabular">{start}</span>
          <span className={cn("truncate text-sm font-semibold", st === "faltou" && "line-through")}>{name}</span>
        </>
      ) : (
        <>
          <span className={cn("flex items-center gap-1.5 overflow-hidden whitespace-nowrap tabular", solo ? "text-sm font-semibold leading-5" : "text-xs font-medium leading-[14px] opacity-80")}>
            <span className="truncate">{line1}</span>
            {heart && <span aria-label="Pediu esta profissional">♥</span>}
            {i.label?.color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: i.label.color }} />}
          </span>
          <span className={cn("truncate font-semibold", solo ? "text-[15px] leading-5" : "text-sm leading-4", st === "faltou" && "line-through")}>{name}</span>
          {extras.map((t, k) => <span key={k} className={cn("truncate opacity-85", solo ? "text-sm leading-5" : "text-xs leading-[15px]")}>{t}</span>)}
        </>
      )}
    </button>
  );
}

/**
 * 0089: o horário em que esta profissional é auxiliar, na coluna dela: o período ocupado, a cliente e o selo "auxiliar de <principal>".
 * Mais claro que o cartão de quem atende (borda tracejada), abre o mesmo horário e não arrasta (quem muda é a principal).
 */
function AuxCard({ i, lane, PX, y, range, solo, few, nowMs, p, dim }: {
  i: AgendaItem; lane: { lane: number; lanes: number }; PX: number; y: (m: number) => number;
  range: { start: number; end: number }; solo: boolean; few: boolean; nowMs: number; dim: boolean; p: Parameters<typeof DayGrid>[0];
}) {
  const st = viewStatus(i, nowMs, { caixaOn: p.caixaOn });
  const s = Math.max(minuteOfDay(i.scheduledAt), range.start), e = Math.min(minuteOfDay(i.scheduledAt) + i.durationMin, range.end);
  const h = Math.max(14, Math.round((e - s) * PX) - 2);
  const one = !solo && h < 34;
  const start = hm(minuteOfDay(i.scheduledAt)), end = hm((minuteOfDay(i.scheduledAt) + i.durationMin) % 1440);
  const boss = first(i.professionalName) || "outra profissional";
  const seal = `auxiliar de ${boss}`;
  const name = solo || few ? shownName(i) : short(shownName(i));
  return (
    <button type="button" data-ev data-aux onClick={() => p.onOpen(i)} aria-haspopup="dialog"
      aria-label={`${timeRange(i.scheduledAt, i.durationMin)}, ${shownName(i)}${i.service ? `, ${i.service}` : ""}, ${seal}. Abrir detalhes`}
      title={`${shownName(i)} · ${i.service ?? "Serviço não informado"} · ${seal}`}
      className={cn("absolute z-[4] flex overflow-hidden rounded-[8px] border border-dashed bg-paper text-left transition-[opacity,box-shadow] duration-150 hover:z-[6] hover:shadow-[0_4px_14px_rgb(18_18_18/0.14)]",
        one ? "flex-row items-center gap-1.5 whitespace-nowrap pl-[9px] pr-2" : solo ? "flex-row flex-wrap content-start items-baseline gap-x-4 gap-y-0.5 py-2 pl-3.5 pr-4" : "flex-col gap-px py-[3px] pl-[9px] pr-2",
        dim && "opacity-30")}
      style={{ borderColor: VIEW_STATUS[st].bar, color: VIEW_STATUS[st].fg, top: y(s) + 1, height: h, left: `calc(${(lane.lane / lane.lanes) * 100}% + ${solo ? 6 : 3}px)`, width: `calc(${100 / lane.lanes}% - ${solo ? 12 : 6}px)` }}>
      {one ? (
        <>
          <span className="text-xs font-medium opacity-80 tabular">{start}</span>
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="truncate text-xs opacity-80">· {seal}</span>
        </>
      ) : (
        <>
          <span className={cn("truncate tabular", solo ? "text-sm font-semibold leading-5" : "text-xs font-medium leading-[14px] opacity-80")}>{solo ? `${start}–${end}` : start}</span>
          <span className={cn("truncate font-semibold", solo ? "text-[15px] leading-5" : "text-sm leading-4")}>{name}</span>
          <span data-selo-auxiliar className={cn("self-start truncate rounded-full bg-paper-2 px-1.5 font-medium text-graphite", solo ? "text-sm leading-5" : "text-xs leading-[15px]")}>{seal}</span>
        </>
      )}
    </button>
  );
}
