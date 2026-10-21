"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { IconArrowRight, IconTrash } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  activeView, CARD_FIELD_LABEL, CARD_FIELDS, CARD_SIZE_LABEL, CARD_SIZES, DEFAULT_CFG, DEFAULT_VIEW_ID, deleteView, GRID_FLAG_LABEL, GRID_FLAGS, GRID_STEPS,
  moveInOrder, orderedIds, patchActive, saveAsView, stepRange, visibleRange, type AgendaPrefs,
} from "@/lib/agenda-view-prefs";
import { hm } from "@/lib/agenda-day";
import { PREFERENCE_FILTERS } from "@/lib/appointment-preference";
import { ProAvatar } from "../pro-avatar";
import type { DayPro } from "./day-grid";

const H3 = "text-base font-semibold text-ink";
const SEG = "inline-flex min-h-[34px] items-center justify-center rounded-[8px] px-3 text-sm font-medium";
const segCls = (on: boolean) => cn(SEG, on ? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgb(18_18_18/0.12)]" : "text-ink-2 hover:text-ink");

/**
 * Personalizar (gaveta à direita): quem aparece e a ordem, tamanho dos horários, intervalo, horário visível, o que vai no cartão, o que
 * aparece na grade, o filtro de preferência e "Salvar como visão". Vale para a visão aberta e fica salvo para a pessoa.
 */
export function Personalize({ open, onClose, prefs, pros, sel, withValues, casa, onChange, onPickView }: {
  open: boolean; onClose: () => void; prefs: AgendaPrefs; pros: DayPro[]; sel: string[]; withValues: boolean; casa: { start: number; end: number } | null;
  onChange: (p: AgendaPrefs) => void; onPickView: (id: string) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const view = activeView(prefs);
  const cfg = view.cfg;
  const all = pros.map((p) => p.id);
  const order = orderedIds(cfg, all);
  const byId = new Map(pros.map((p) => [p.id, p]));
  const set = (patch: Parameters<typeof patchActive>[1]) => onChange(patchActive(prefs, patch));
  const shownRange = visibleRange(cfg, casa);
  const step = (edge: "ini" | "fim", d: -30 | 30) => set(stepRange(shownRange, edge, d));
  const salvar = () => {
    const r = saveAsView(prefs, nome, cfg, sel);
    if (r.result === "nome_vazio") { toast("Dê um nome para a visão.", "error"); return; }
    if (r.result === "limite") { toast("Já são 12 visões. Apague uma antes.", "error"); return; }
    onChange(r.prefs);
    setNome("");
    toast(r.result === "criada" ? `Visão ${r.view!.nome} salva. Ela aparece nas abas em cima da grade.` : `Visão ${r.view!.nome} atualizada.`);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Personalizar" className="max-w-[440px]">
      <div className="flex flex-col gap-6">
        <p className="-mt-2 text-sm text-graphite">Vale para a visão <strong className="font-semibold text-ink">{view.nome}</strong> e fica salvo só para você.</p>

        <section aria-labelledby="pz-pro" className="flex flex-col gap-1.5">
          <h3 id="pz-pro" className={H3}>Profissionais e ordem</h3>
          <p className="text-sm text-graphite">Arraste pela alça ou use as setas. Desligue quem não precisa aparecer.</p>
          <ul>
            {order.map((id, k) => {
              const p = byId.get(id)!;
              const on = !cfg.ocultas.includes(id);
              return (
                <li key={id} draggable onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }}
                  onDragOver={(e) => { if (dragId && dragId !== id) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== id) set({ ordem: moveInOrder(cfg, all, dragId, { before: id }) }); setDragId(null); }}
                  onDragEnd={() => setDragId(null)}
                  className={cn("flex min-h-11 cursor-grab items-center gap-2 rounded-[var(--radius-control)] pr-1", dragId === id && "opacity-40")}>
                  <span aria-hidden className="grid w-5 place-items-center text-control">⋮⋮</span>
                  <ProAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={28} className={on ? "" : "opacity-40"} soft />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-base font-medium", !on && "text-muted")}>{p.name}</span>
                    {p.role && <span className="truncate text-xs text-muted">{p.role}</span>}
                  </span>
                  <IconButton label={`Subir ${p.name}`} disabled={k === 0} onClick={() => set({ ordem: moveInOrder(cfg, all, id, k - 1) })}><IconArrowRight size={14} className="-rotate-90" /></IconButton>
                  <IconButton label={`Descer ${p.name}`} disabled={k === order.length - 1} onClick={() => set({ ordem: moveInOrder(cfg, all, id, k + 1) })}><IconArrowRight size={14} className="rotate-90" /></IconButton>
                  <Switch checked={on} label={`Mostrar ${p.name}`} onChange={(v) => set({ ocultas: v ? cfg.ocultas.filter((x) => x !== id) : [...cfg.ocultas, id] })} />
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="pz-tam" className="flex flex-col gap-2">
          <h3 id="pz-tam" className={H3}>Tamanho dos horários</h3>
          <div role="group" aria-labelledby="pz-tam" className="inline-flex gap-0.5 self-start rounded-[11px] bg-paper-2 p-[3px]">
            {CARD_SIZES.map((t) => <button key={t} type="button" aria-pressed={cfg.tam === t} className={segCls(cfg.tam === t)} onClick={() => set({ tam: t })}>{CARD_SIZE_LABEL[t]}</button>)}
          </div>
        </section>

        <section aria-labelledby="pz-int" className="flex flex-col gap-2">
          <h3 id="pz-int" className={H3}>Intervalo da grade</h3>
          <div role="group" aria-labelledby="pz-int" className="inline-flex gap-0.5 self-start rounded-[11px] bg-paper-2 p-[3px]">
            {GRID_STEPS.map((n) => <button key={n} type="button" aria-pressed={cfg.passo === n} className={segCls(cfg.passo === n)} onClick={() => set({ passo: n })}>{n} min</button>)}
          </div>
        </section>

        <section aria-labelledby="pz-hor" className="flex flex-col gap-2">
          <h3 id="pz-hor" className={H3}>Horário visível</h3>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-base">
            <span className="flex items-center gap-1.5"><span className="text-graphite">De</span>
              <IconButton label="Começar mais cedo" onClick={() => step("ini", -30)}>−</IconButton>
              <span className="min-w-12 text-center font-semibold tabular">{hm(shownRange.start)}</span>
              <IconButton label="Começar mais tarde" onClick={() => step("ini", 30)}>+</IconButton>
            </span>
            <span className="flex items-center gap-1.5"><span className="text-graphite">até</span>
              <IconButton label="Terminar mais cedo" onClick={() => step("fim", -30)}>−</IconButton>
              <span className="min-w-12 text-center font-semibold tabular">{hm(shownRange.end)}</span>
              <IconButton label="Terminar mais tarde" onClick={() => step("fim", 30)}>+</IconButton>
            </span>
          </div>
          {cfg.ini != null && <button type="button" className="self-start text-sm font-medium text-gold-ink hover:underline" onClick={() => set({ ini: null, fim: null })}>Usar o horário da Casa</button>}
        </section>

        <section aria-labelledby="pz-card" className="flex flex-col gap-1">
          <h3 id="pz-card" className={H3}>No cartão do horário</h3>
          <p className="text-sm text-graphite">Hora e nome da cliente sempre aparecem.</p>
          {CARD_FIELDS.filter((f) => f !== "valor" || withValues).map((f) => (
            <label key={f} className="flex min-h-10 items-center justify-between gap-3 text-base font-medium">
              {CARD_FIELD_LABEL[f]}
              <Switch checked={cfg.card[f]} label={CARD_FIELD_LABEL[f]} onChange={(v) => set({ card: { ...cfg.card, [f]: v } })} />
            </label>
          ))}
        </section>

        <section aria-labelledby="pz-grade" className="flex flex-col gap-1">
          <h3 id="pz-grade" className={H3}>Na grade</h3>
          {GRID_FLAGS.map((f) => (
            <label key={f} className="flex min-h-10 items-center justify-between gap-3 text-base font-medium">
              {GRID_FLAG_LABEL[f]}
              <Switch checked={cfg[f]} label={GRID_FLAG_LABEL[f]} onChange={(v) => set({ [f]: v })} />
            </label>
          ))}
        </section>

        <section aria-labelledby="pz-pref" className="flex flex-col gap-2">
          <h3 id="pz-pref" className={H3}>Só os horários de quem…</h3>
          <div role="group" aria-labelledby="pz-pref" className="flex flex-wrap gap-0.5 self-start rounded-[11px] bg-paper-2 p-[3px]">
            {[{ value: null, label: "Todas" }, ...PREFERENCE_FILTERS].map((f) => (
              <button key={f.label} type="button" aria-pressed={cfg.pref === f.value} className={segCls(cfg.pref === f.value)} onClick={() => set({ pref: f.value })}>{f.value === "escolhida" ? "Pediu a profissional" : f.label}</button>
            ))}
          </div>
        </section>

        <section aria-labelledby="pz-vis" className="flex flex-col gap-2">
          <h3 id="pz-vis" className={H3}>Salvar como visão</h3>
          <p className="text-sm text-graphite">Fica como uma aba pequena em cima da grade, com estas escolhas e quem está aparecendo agora.</p>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
            <Input aria-label="Nome da visão" placeholder="Ex.: Cabelo, Unhas, Só a Lívia" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} className="h-11 flex-1" />
            <Button type="submit">Salvar</Button>
          </form>
          <ul>
            {prefs.visoes.map((v) => (
              <li key={v.id} className="flex min-h-11 items-center gap-2">
                <button type="button" onClick={() => onPickView(v.id)} aria-current={v.id === view.id ? "true" : undefined} className={cn("text-left text-base hover:underline", v.id === view.id ? "font-semibold" : "font-medium")}>{v.nome}</button>
                <span className="text-xs text-muted">{v.sel.length ? `${v.sel.length} ${v.sel.length === 1 ? "profissional" : "lado a lado"}` : "Todas"}</span>
                <span className="flex-1" />
                {v.id !== DEFAULT_VIEW_ID && <IconButton label={`Apagar a visão ${v.nome}`} onClick={() => { onChange(deleteView(prefs, v.id)); toast(`Visão ${v.nome} apagada.`); }}><IconTrash size={15} /></IconButton>}
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="self-start" onClick={() => set({ ...DEFAULT_CFG })}>Voltar ao padrão nesta visão</Button>
        </section>
      </div>
    </Sheet>
  );
}
