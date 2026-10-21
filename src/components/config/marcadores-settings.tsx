"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { TagDot } from "@/components/tags/tag-dot";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/cn";
import { VISIT_TYPE_LABEL, VISIT_TYPE_MAX, type VisitType, type VisitTypeOption } from "@/lib/visit-type";
import { saveAppointmentLabelAction, saveVisitTypesAction } from "@/app/(app)/config/marcadores/actions";

type Label = { id: string; name: string; color: string | null; active: boolean };
const OFF = "Essa função está desligada em Configurações › Recursos. O que já foi posto nos horários continua aparecendo.";

/**
 * Configurações › Agenda e caixa › Marcadores do horário: a lista de marcadores (nome, cor da paleta, em uso, novo) e os tipos do horário
 * (nome e em uso; "Usar o texto sugerido" volta ao nome de fábrica). Salva a cada mudança. Marcador em desuso some da escolha, não dos horários.
 */
export function MarcadoresSettings({ labels, types, marcadoresOn, tiposOn }: { labels: Label[]; types: VisitTypeOption[]; marcadoresOn: boolean; tiposOn: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <LabelsSection labels={labels} on={marcadoresOn} />
      <TypesSection types={types} on={tiposOn} />
    </div>
  );
}

function LabelsSection({ labels, on }: { labels: Label[]; on: boolean }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const add = () => start(async () => {
    const r = await saveAppointmentLabelAction({ name });
    if (!r.ok) { toast(r.error, "error"); return; }
    setName(""); toast("Marcador criado"); router.refresh();
  });
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="marcadores-titulo">
      <div className="px-5 pt-5">
        <h2 id="marcadores-titulo" className="text-lg font-semibold">Marcadores</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-graphite">A etiqueta do horário. A equipe escolhe ao marcar e ao abrir o horário. Desativar tira da escolha, mas não dos horários que já têm.</p>
        {!on && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{OFF}</p>}
      </div>
      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {labels.map((l) => <li key={l.id}><LabelRow l={l} on={on} /></li>)}
      </ul>
      <form className="flex flex-wrap items-end gap-3 border-t border-line/70 px-5 py-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Novo marcador
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={!on || pending} className="h-10 w-72 max-w-full" />
        </label>
        <Button type="submit" loading={pending} disabled={!on || !name.trim()}>Adicionar</Button>
      </form>
    </section>
  );
}

function LabelRow({ l, on }: { l: Label; on: boolean }) {
  const [name, setName] = useState(l.name);
  const [color, setColor] = useState(l.color);
  const [active, setActive] = useState(l.active);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const save = (patch: { name?: string; color?: string | null; active?: boolean }, undo: () => void, ok: string) => start(async () => {
    const r = await saveAppointmentLabelAction({ id: l.id, name: patch.name ?? l.name, color: patch.color === undefined ? color : patch.color, active: patch.active ?? active });
    if (!r.ok) { toast(r.error, "error"); undo(); return; }
    toast(ok); router.refresh();
  });
  const rename = () => {
    const v = name.trim().replace(/\s+/g, " ");
    if (!v || v === l.name) { setName(l.name); return; }
    save({ name: v }, () => setName(l.name), "Marcador renomeado");
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !active && "bg-paper-2/40")}>
      <span className="flex min-w-[12rem] flex-1 items-center gap-2">
        <TagDot color={color} />
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          maxLength={40} aria-label={`Nome do marcador ${l.name}`} className="h-9 max-w-[22rem]" disabled={!on || pending} />
      </span>
      <span role="radiogroup" aria-label={`Cor de ${l.name}`} className="flex flex-wrap items-center gap-1">
        <button type="button" role="radio" aria-checked={!color} aria-label={`Sem cor em ${l.name}`} disabled={!on || pending}
          onClick={() => { const old = color; setColor(null); save({ color: null }, () => setColor(old), "Cor salva"); }}
          className={cn("grid size-8 place-items-center rounded-full border text-xs text-muted", !color ? "border-ink" : "border-line")}>–</button>
        {TAG_COLORS.map((c, i) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${i + 1} de ${l.name}`} disabled={!on || pending}
            onClick={() => { const old = color; setColor(c); save({ color: c }, () => setColor(old), "Cor salva"); }}
            className={cn("grid size-8 place-items-center rounded-full border", color === c ? "border-ink" : "border-transparent")}>
            <span className="size-4 rounded-full" style={{ background: c }} />
          </button>
        ))}
      </span>
      <Switch checked={active} label={`${active ? "Tirar de uso" : "Pôr em uso"} ${l.name}`} disabled={!on || pending}
        onChange={(v) => { setActive(v); save({ active: v }, () => setActive(!v), v ? "Marcador em uso" : "Marcador fora de uso"); }} />
    </div>
  );
}

function TypesSection({ types, on }: { types: VisitTypeOption[]; on: boolean }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="tipos-titulo">
      <div className="px-5 pt-5">
        <h2 id="tipos-titulo" className="text-lg font-semibold">Tipos do horário</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-graphite">Indicação e Noiva. Dá para mudar o nome e tirar de uso. “Primeira vez” e a preferência pela profissional (“Pediu ela”, “Tanto faz”) o sistema já sabe sozinho.</p>
        {!on && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{OFF}</p>}
      </div>
      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {types.map((t) => <li key={t.value}><TypeRow t={t} on={on} /></li>)}
      </ul>
    </section>
  );
}

function TypeRow({ t, on }: { t: VisitTypeOption; on: boolean }) {
  const [label, setLabel] = useState(t.label);
  const [active, setActive] = useState(t.active);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const suggested = VISIT_TYPE_LABEL[t.value as VisitType];
  const save = (patch: { label?: string; active?: boolean }, undo: () => void, ok: string) => start(async () => {
    const r = await saveVisitTypesAction({ [t.value]: patch });
    if (!r.ok) { toast(r.error, "error"); undo(); return; }
    toast(ok); router.refresh();
  });
  const rename = () => {
    const v = label.trim().replace(/\s+/g, " ");
    if (!v || v === t.label) { setLabel(t.label); return; }
    save({ label: v }, () => setLabel(t.label), "Nome salvo");
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !active && "bg-paper-2/40")}>
      <span className="flex min-w-[12rem] flex-1 items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          maxLength={VISIT_TYPE_MAX} aria-label={`Nome do tipo ${suggested}`} className="h-9 max-w-[16rem]" disabled={!on || pending} />
        {label !== suggested && (
          <Button variant="ghost" size="sm" disabled={!on || pending} onClick={() => { const old = label; setLabel(suggested); save({ label: "" }, () => setLabel(old), "Voltou ao texto sugerido"); }}>Usar o texto sugerido</Button>
        )}
      </span>
      <Switch checked={active} label={`${active ? "Tirar de uso" : "Pôr em uso"} ${suggested}`} disabled={!on || pending}
        onChange={(v) => { setActive(v); save({ active: v }, () => setActive(!v), v ? "Tipo em uso" : "Tipo fora de uso"); }} />
    </div>
  );
}
