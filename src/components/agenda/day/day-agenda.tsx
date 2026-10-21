"use client";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/server/queries/agenda";
import type { DayAck } from "@/server/domain/pro/acks";
import { instantOf, minuteOfDay } from "@/lib/agenda";
import { canPlace, highlightOpenKey, hm, LEGEND, VIEW_STATUS, type PlaceCtx } from "@/lib/agenda-day";
import { activeView, clickPro, orderedIds, visibleIds, visibleRange, type AgendaPrefs } from "@/lib/agenda-view-prefs";
import { matchesPreference } from "@/lib/appointment-preference";
import { ACTIVE_STATUSES } from "@/lib/appointment-status";
import type { AgendaMode } from "@/lib/agenda-settings";
import { leadHref } from "@/lib/lead-href";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { moveAppointmentAction, saveAgendaPrefsAction } from "@/app/(app)/agenda/actions";
import { offerDraft } from "@/components/lead/composer-draft";
import { ProAvatar } from "../pro-avatar";
import { EntrySheet } from "../entry-sheet";
import { BlockSheet, type EditableBlock } from "../block-sheet";
import { canBookIn, useAgendaSheets } from "../agenda-sheets";
import { shownName, useAgendaActions } from "../use-agenda-actions";
import { useAgendaShell } from "./shell";
import { DayGrid, type DayPro, type DragState, type GridBlock, type GridColumn, type OverState } from "./day-grid";
import { Personalize } from "./personalize";
import { MoveConfirm, MovePicker, type MoveRequest } from "./move";

export type { DayPro } from "./day-grid";
const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";
/** Celular (< 640 px): uma profissional por vez, escolhida na fileira de fotos (que rola para o lado). */
const NARROW = "(max-width: 639px)";
const narrowSub = (cb: () => void) => { const m = window.matchMedia(NARROW); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useNarrow = () => useSyncExternalStore(narrowSub, () => window.matchMedia(NARROW).matches, () => false);

/**
 * Agenda › Dia (nova, aprovada em 16/10): a fileira de fotos (clique = só ela; "Todas"; Shift/⌘+clique ou "Juntar" = algumas lado a
 * lado), as visões salvas em abas pequenas, a grade e o arrastar com confirmação. A escolha de quem aparece fica também na URL (?p=).
 */
export function DayAgenda(props: {
  day: string; today: string; nowMs: number; pros: DayPro[]; items: AgendaItem[]; blocks: GridBlock[]; casa: { start: number; end: number } | null;
  prefs: AgendaPrefs; urlSel: string[] | null; highlight: string | null; acks?: Record<string, DayAck>; caixaOn: boolean;
  prices: Record<string, number> | null; editBlocks?: { mode: AgendaMode; pros: { id: string; name: string }[]; blocks: EditableBlock[] };
}) {
  const { day, today, nowMs, pros } = props;
  const router = useRouter();
  const toast = useToast();
  const { catalog, book } = useAgendaSheets();
  const canBook = canBookIn(catalog);
  const { q, persoOpen, setPersoOpen } = useAgendaShell();
  const actions = useAgendaActions(nowMs);
  const [prefs, setPrefs] = useState(props.prefs);
  const view = activeView(prefs);
  const cfg = view.cfg;
  const [sel, setSel] = useState<string[]>(props.urlSel ?? view.sel);
  const [juntar, setJuntar] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);
  const [over, setOver] = useState<OverState>(null);
  const [confirm, setConfirm] = useState<MoveRequest | null>(null);
  const [picking, setPicking] = useState<AgendaItem | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(() => highlightOpenKey(props.highlight, props.items));
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  // Depois de mover, o cartão já aparece no lugar novo enquanto a página recarrega.
  const [movedState, setMovedState] = useState<{ base: AgendaItem[]; map: Record<string, { professionalId: string; scheduledAt: string }> }>({ base: props.items, map: {} });
  const moved = movedState.base === props.items ? movedState.map : {}; // a página recarregou: vale o que veio do servidor
  const setMoved = (key: string, v: { professionalId: string; scheduledAt: string }) =>
    setMovedState((s) => ({ base: props.items, map: { ...(s.base === props.items ? s.map : {}), [key]: v } }));

  const items = actions.apply(props.items).map((i) => (moved[i.key] ? { ...i, ...moved[i.key], professionalName: pros.find((p) => p.id === moved[i.key].professionalId)?.name ?? i.professionalName } : i))
    .filter((i) => matchesPreference(i.preference, cfg.pref));
  const allIds = pros.map((p) => p.id);
  const byId = new Map(pros.map((p) => [p.id, p]));
  const strip = visibleIds(cfg, allIds);
  const live = items.filter((i) => i.status !== "cancelado");
  const counts: Record<string, number> = {};
  for (const i of live) if (i.professionalId) counts[i.professionalId] = (counts[i.professionalId] ?? 0) + 1;
  const narrow = useNarrow();
  const wide = sel.length ? orderedIds(cfg, allIds).filter((id) => sel.includes(id)) : strip.filter((id) => !byId.get(id)!.off || counts[id]);
  const ids = narrow ? wide.slice(0, 1) : wide;
  const columns: GridColumn[] = ids.map((id) => ({ key: id, pro: byId.get(id)! }));
  for (const i of live) if (!sel.length && !narrow && i.professionalId && !byId.has(i.professionalId) && !columns.some((c) => c.key === i.professionalId)) {
    columns.push({ key: i.professionalId, pro: { id: i.professionalId, name: i.professionalName ?? "Profissional", role: null, color: i.professionalColor, photoUrl: i.professionalPhotoUrl ?? null, ranges: [], off: false, serviceIds: [] } });
  }
  if (!sel.length && !narrow && live.some((i) => !i.professionalId)) columns.push({ key: "_sem", pro: null });
  const range = visibleRange(cfg, props.casa);
  const ctx: PlaceCtx = {
    nowMs, day, today, items: props.items.map((i) => (moved[i.key] ? { ...i, ...moved[i.key] } : i)),
    names: Object.fromEntries(pros.map((p) => [p.id, p.name])),
    hours: Object.fromEntries(pros.map((p) => [p.id, { ranges: p.ranges, off: p.off }])),
    blocks: props.blocks,
    doers: pros.reduce<Record<string, string[]>>((m, p) => { for (const sid of p.serviceIds) (m[sid] ??= []).push(p.id); return m; }, {}),
  };
  const outside = live.filter((i) => !i.noTime && (minuteOfDay(i.scheduledAt) >= range.end || minuteOfDay(i.scheduledAt) + i.durationMin <= range.start));

  // Personalizar e visões: tudo por usuário, salvo no banco (sem botão Salvar; meio segundo depois da última mudança).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePrefs = (next: AgendaPrefs) => {
    setPrefs(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const r = await saveAgendaPrefsAction(next);
      if (!r.ok) toast(r.error, "error");
    }, 500);
  };
  const urlFor = (s: string[]) => {
    const u = new URL(window.location.href);
    if (s.length) u.searchParams.set("p", s.join(",")); else u.searchParams.delete("p");
    u.searchParams.delete("destaque");
    return `${u.pathname}${u.search}`;
  };
  const choose = (s: string[]) => { setSel(s); window.history.replaceState(null, "", urlFor(s)); };
  const pickView = (id: string) => {
    const v = prefs.visoes.find((x) => x.id === id);
    if (!v) return;
    savePrefs({ ...prefs, ativa: id });
    setJuntar(false);
    choose(v.sel.filter((x) => allIds.includes(x)));
  };

  // Mover: a mesma regra no arrastar e no "Mover…"; a tela pergunta antes, o servidor decide.
  const requestMove = (i: AgendaItem, to: string, t: number) => {
    if (i.professionalId === to && minuteOfDay(i.scheduledAt) === t) return;
    const r = canPlace(i, to, t, ctx);
    if (!r.ok) { toast(`Não dá: ${r.why}`, "error"); return; }
    setConfirm({ item: i, to, t, avisar: false });
  };
  const doMove = (m: MoveRequest) => startMove(async () => {
    const i = m.item;
    const from = { professionalId: i.professionalId, startsAt: i.scheduledAt };
    const startsAt = instantOf(day, m.t).toISOString();
    const r = await moveAppointmentAction(i.appointmentId!, { startsAt, professionalId: m.to, confirmProChange: true, avisar: m.avisar });
    if (!r.ok) { toast(r.error, "error"); return; }
    setConfirm(null);
    setMoved(i.key, { professionalId: m.to, scheduledAt: startsAt });
    const name = first(shownName(i));
    const same = i.professionalId === m.to;
    const avec = catalog?.agendaMode === "dupla" ? " Mude também no Avec." : "";
    toast(`${same ? `${name} mudou para as ${hm(m.t)}.` : `${name} passou para a ${first(byId.get(m.to)?.name)} às ${hm(m.t)}.`}${avec}`, "ok", from.professionalId ? {
      label: "Desfazer", onClick: () => startMove(async () => {
        const u = await moveAppointmentAction(i.appointmentId!, { startsAt: from.startsAt, professionalId: from.professionalId!, confirmProChange: true });
        if (!u.ok) { toast(u.error, "error"); return; }
        setMoved(i.key, { professionalId: from.professionalId!, scheduledAt: from.startsAt });
        toast(`Desfeito: ${name} voltou para as ${hm(minuteOfDay(from.startsAt))}.`);
        router.refresh();
      }),
    } : undefined);
    const draft = r.data?.draft;
    if (m.avisar) {
      if (draft) {
        offerDraft(draft.dealId, draft.text);
        toast(`A mensagem para ${name} ficou pronta na conversa. Nada foi enviado.`, "info", { label: "Abrir conversa", onClick: () => router.push(leadHref(draft.dealId)) });
      } else toast(`${name} não tem conversa com a Casa: avise por outro meio.`, "info");
    }
    router.refresh();
  });

  const opened = items.find((i) => i.key === openKey) ?? null;
  const editing = props.editBlocks?.blocks.find((b) => b.id === editingBlock) ?? null;
  const pressed = (id: string) => (narrow ? ids[0] === id : sel.includes(id));
  const allOn = !sel.length;

  return (
    <div className="flex flex-col gap-2.5 px-4 pb-10 lg:px-6">
      <div role="group" aria-label="Quem aparece na grade" className="flex min-h-16 items-end gap-1">
        <button type="button" aria-pressed={allOn} onClick={() => { setJuntar(false); choose([]); }} title="Todas lado a lado"
          className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-[12px] px-0 pt-1 pb-0.5 hover:bg-paper-2 max-sm:hidden">
          <span className={cn("grid size-9 place-items-center rounded-full text-xs font-semibold", allOn ? "bg-ink text-paper" : "bg-paper-2 text-ink-2")} aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z" /></svg>
          </span>
          <span className={cn("max-w-14 truncate text-xs leading-[13px]", allOn ? "font-semibold text-ink" : "font-medium text-ink-2")}>Todas</span>
        </button>
        <span aria-hidden className="mx-1.5 my-2.5 w-px self-stretch bg-[#ece9e3] max-sm:hidden" />
        <div className="scroll-thin flex min-w-0 items-start gap-0.5 max-sm:overflow-x-auto">
          {strip.map((id) => {
            const p = byId.get(id)!;
            const on = pressed(id);
            return (
              <button key={id} type="button" aria-pressed={on} onClick={(e) => choose(narrow ? [id] : clickPro(sel, id, juntar || e.shiftKey || e.metaKey || e.ctrlKey))}
                aria-label={juntar ? (on ? `Tirar ${p.name} da grade` : `Juntar ${p.name} lado a lado`) : on && sel.length === 1 ? `Voltar para todas. Agora só ${p.name}` : `Ver só a agenda de ${p.name}`}
                title={`${p.name}${p.off ? " · folga" : ""}. Shift ou Command e clique junta lado a lado.`}
                className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-[12px] pt-1 pb-0.5 hover:bg-paper-2">
                <span className={cn("rounded-full transition-shadow", on && "shadow-[0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-ink)]", p.off && !on && "opacity-50")}>
                  <ProAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={36} soft />
                </span>
                <span className={cn("max-w-14 truncate text-xs leading-[13px]", on ? "font-semibold text-ink" : "font-medium text-ink-2")}>{first(p.name)}</span>
              </button>
            );
          })}
        </div>
        <button type="button" aria-pressed={juntar} onClick={() => setJuntar((j) => !j)} aria-label={juntar ? "Terminar de juntar" : "Juntar algumas lado a lado"} title="Juntar algumas lado a lado. Também dá com Shift ou Command e clique."
          className="flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-[12px] pt-1 pb-0.5 hover:bg-paper-2 max-sm:hidden">
          <span aria-hidden className={cn("grid size-9 place-items-center rounded-full", juntar ? "bg-gold-soft text-gold-ink shadow-[inset_0_0_0_1.5px_var(--color-gold)]" : "bg-paper text-ink-2 shadow-[inset_0_0_0_1.5px_var(--color-control)]")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{juntar ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}</svg>
          </span>
          <span className={cn("max-w-14 truncate text-xs leading-[13px]", juntar ? "font-semibold text-gold-ink" : "font-medium text-ink-2")}>{juntar ? "Pronto" : "Juntar"}</span>
        </button>
        {prefs.visoes.length > 1 && (
          <div role="group" aria-label="Suas visões salvas" className="ml-auto flex items-center gap-0.5 pb-2.5 max-sm:hidden">
            {prefs.visoes.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === view.id} onClick={() => pickView(v.id)}
                className={cn("min-h-8 whitespace-nowrap rounded-[8px] px-2.5 text-sm", v.id === view.id ? "bg-paper-2 font-semibold text-ink" : "font-medium text-muted hover:bg-paper-2 hover:text-ink")}>{v.nome}</button>
            ))}
          </div>
        )}
      </div>

      {cfg.legenda && (
        <ul aria-label="Cores do horário" className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-medium text-graphite">
          {LEGEND.filter((s) => props.caixaOn || s !== "finalizado").map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-3.5 rounded-[4px]" style={{ background: VIEW_STATUS[s].bg, boxShadow: `inset 0 0 0 1px ${VIEW_STATUS[s].bar}` }} />{s === "pago" ? "Finalizado" : VIEW_STATUS[s].label}</li>
          ))}
        </ul>
      )}
      {outside.length > 0 && (
        <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">
          Fora do horário visível: {outside.map((i) => `${hm(minuteOfDay(i.scheduledAt))} ${shownName(i)}`).join(" · ")}.{" "}
          <button type="button" className="font-medium text-gold-ink underline-offset-4 hover:underline" onClick={() => setPersoOpen(true)}>Mudar em Personalizar</button>
        </p>
      )}

      {columns.length ? (
        <DayGrid columns={columns} items={items} cfg={cfg} range={range} ctx={ctx} nowMs={nowMs} isToday={day === today} q={q} caixaOn={props.caixaOn}
          prices={props.prices} canBook={canBook} acks={props.acks} highlight={props.highlight} blocks={props.blocks} counts={counts}
          editableBlocks={new Set(props.editBlocks?.blocks.map((b) => b.id) ?? [])}
          drag={drag} over={over} setDrag={setDrag} setOver={setOver} onDrop={requestMove}
          onOpen={(i) => setOpenKey(i.key)} onBook={(proId, t) => book({ day, time: hm(t), professionalId: proId, preference: proId ? "escolhida" : null })} onBlock={setEditingBlock}
          onHeader={(id) => choose(clickPro(sel, id, false))} onAll={() => choose([])} />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong p-7">
          <p className="text-md">{pros.length ? "Ninguém trabalha neste dia nesta visão." : "Nenhuma profissional cadastrada."}</p>
          {pros.length > 0 && <Button variant="secondary" onClick={() => setPersoOpen(true)}>Escolher em Personalizar</Button>}
        </div>
      )}

      <EntrySheet item={opened} onClose={() => setOpenKey(null)} actions={actions} nowMs={nowMs}
        visitCount={opened?.visitId ? items.filter((x) => x.visitId === opened.visitId && ACTIVE_STATUSES.includes(x.dbStatus ?? "")).length : 1}
        onMove={canBook ? (i) => { setOpenKey(null); setPicking(i); } : undefined} />
      <MovePicker item={picking} onClose={() => setPicking(null)} pros={pros} ctx={ctx} onPick={(to, t) => { const i = picking!; setPicking(null); requestMove(i, to, t); }} />
      <MoveConfirm req={confirm} pending={moving} pros={pros} mode={catalog?.agendaMode ?? "consulta"} onChange={setConfirm} onCancel={() => setConfirm(null)} onConfirm={doMove} />
      <Personalize open={persoOpen} onClose={() => setPersoOpen(false)} prefs={prefs} pros={pros} sel={sel} withValues={!!props.prices} casa={props.casa} onChange={savePrefs}
        onPickView={pickView} />
      {props.editBlocks && <BlockSheet open={!!editing} onClose={() => setEditingBlock(null)} pros={props.editBlocks.pros} mode={props.editBlocks.mode} day={day} block={editing} />}
    </div>
  );
}
