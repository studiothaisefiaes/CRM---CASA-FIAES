"use client";
import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SaveButton } from "@/components/ui/save-button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createStageAction, deleteStageAction, moveStageAction, setStageAttemptDaysAction, setStageProfilesAction, updateStageAction } from "@/app/(app)/config/actions";
import { ATTEMPT_DAYS, isAttemptKind } from "@/lib/attempts";
import { SPRING_UI } from "@/lib/motion";
import { KIND_LABEL, STAGE_KINDS, type StageKindName } from "@/lib/stage-kind-labels";

type S = {
  id: string; key: string; name: string; kind: StageKindName; slaMinutes: number | null; staleDays: number | null; color: string; active: boolean;
  visibleProfileIds: string[] | null; attemptDays: number[] | null;
};
type P = { id: string; name: string };
const GRID = "lg:grid-cols-[64px_1.4fr_120px_130px_120px_70px_auto]";

/** Etapas: nome, ordem, tipo, prazo, limite e cor; criar, apagar e quem vê no Quadro (Lote 4). As desativadas ficam recolhidas. */
export function StagesEditor({ stages, profiles }: { stages: S[]; profiles: P[] }) {
  const active = stages.filter((s) => s.active), inactive = stages.filter((s) => !s.active);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-graphite mb-4 max-w-[70ch]">O <b>prazo de resposta</b> é quando o card fica vermelho para quem atende. O <b>limite parado</b> é usado pela automação de conversa parada. Deixe em branco para não usar. A <b>primeira etapa de cada tipo</b> é a que o sistema usa (novo contato, agendado, atendida…); uma etapa extra do mesmo tipo fica depois dela e serve para mover à mão.</p>
        <div className="rounded-[var(--radius-card)] border border-line bg-paper">
          <div className={`hidden lg:grid ${GRID} gap-3 px-4 py-2.5 text-xs text-muted border-b border-line`}>
            <span>Ordem</span><span>Nome</span><span>Tipo</span><span>Prazo de resposta</span><span>Limite parado</span><span>Cor</span><span />
          </div>
          {active.map((s, i) => <Row key={s.id} s={s} profiles={profiles} first={i === 0} last={i === active.length - 1} />)}
        </div>
      </div>
      <NewStage stages={active} profiles={profiles} />
      {inactive.length > 0 && (
        <details className="rounded-[var(--radius-card)] border border-line bg-paper-2/60">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm text-graphite">Desativadas ({inactive.length}): somem das telas; o histórico antigo continua com o nome</summary>
          <ul className="border-t border-line px-4 py-2 text-sm text-graphite">{inactive.map((s) => <li key={s.id} className="py-1">{s.name} · {KIND_LABEL[s.kind]}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Row({ s, profiles, first, last }: { s: S; profiles: P[]; first: boolean; last: boolean }) {
  const [v, setV] = useState({ name: s.name, sla: s.slaMinutes?.toString() ?? "", stale: s.staleDays?.toString() ?? "", color: s.color });
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = v.name !== s.name || v.sla !== (s.slaMinutes?.toString() ?? "") || v.stale !== (s.staleDays?.toString() ?? "") || v.color !== s.color;
  const save = () => start(async () => {
    const r = await updateStageAction(s.id, { name: v.name, slaMinutes: v.sla ? Number(v.sla) : null, staleDays: v.stale ? Number(v.stale) : null, color: v.color });
    toast(r.ok ? `Etapa "${v.name}" salva` : r.error, r.ok ? "ok" : "error");
  });
  const move = (dir: -1 | 1) => start(async () => { const r = await moveStageAction(s.id, dir); if (!r.ok) toast(r.error, "error"); });
  const remove = () => start(async () => {
    const r = await deleteStageAction(s.id);
    setConfirm(false);
    toast(r.ok ? (r.data?.mode === "desativada" ? `"${s.name}" desativada (já teve conversas)` : `"${s.name}" apagada`) : r.error, r.ok ? "ok" : "error");
  });
  return (
    <motion.div layout transition={SPRING_UI} className="border-b border-line/70 last:border-0">
      <div className={`flex flex-wrap lg:grid ${GRID} gap-3 px-4 py-3 lg:py-2.5 items-center`}>
        <div className="flex gap-1">
          <button disabled={first || pending} aria-label={`Subir ${s.name}`} onClick={() => move(-1)} className="size-7 pointer-coarse:size-11 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↑</button>
          <button disabled={last || pending} aria-label={`Descer ${s.name}`} onClick={() => move(1)} className="size-7 pointer-coarse:size-11 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↓</button>
        </div>
        <Input className="flex-1 min-w-[160px] lg:flex-none" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Nome da etapa" />
        <span className="text-sm text-graphite">{KIND_LABEL[s.kind]}</span>
        <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.sla} onChange={(e) => setV({ ...v, sla: e.target.value })} className="w-20" aria-label="Prazo de resposta em minutos" /><span className="text-xs text-muted">min</span></label>
        <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.stale} onChange={(e) => setV({ ...v, stale: e.target.value })} className="w-16" aria-label="Limite parado em dias" /><span className="text-xs text-muted">dias</span></label>
        <input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} aria-label="Cor" className="size-9 rounded-[8px] border border-line cursor-pointer bg-transparent" />
        <div className="flex gap-1.5">
          <SaveButton size="sm" savedText="" dirty={dirty} loading={pending} onClick={save}>Salvar</SaveButton>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Apagar a etapa ${s.name}`}>Apagar</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-3 text-sm">
        <WhoSees s={s} profiles={profiles} />
        {isAttemptKind(s.kind) && <AttemptDays s={s} />}
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Apagar "${s.name}"?`}
        description="Se alguma conversa já passou por ela, a etapa é desativada: some das telas e o histórico continua com o nome. Conversas abertas nela precisam ser movidas antes."
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={remove}>Apagar</Button></>} />
    </motion.div>
  );
}

function WhoSees({ s, profiles }: { s: S; profiles: P[] }) {
  const [ids, setIds] = useState<string[]>(s.visibleProfileIds ?? []);
  const [pending, start] = useTransition(); const toast = useToast();
  const toggle = (id: string) => {
    const before = ids, next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setIds(next);
    start(async () => { const r = await setStageProfilesAction(s.id, next.length ? next : null); if (!r.ok) { toast(r.error, "error"); setIds(before); } });
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1" disabled={pending}>
      <legend className="sr-only">Quem vê {s.name} no Quadro</legend>
      <span className="text-muted">No Quadro, quem vê: {ids.length ? "" : "todos"}</span>
      {profiles.map((p) => (
        <label key={p.id} className="inline-flex min-h-11 lg:min-h-0 items-center gap-1.5">
          <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`${p.name} vê ${s.name}`} />{p.name}
        </label>
      ))}
      <span className="text-xs text-muted">(a gestão vê todas; a Fila mostra toda conversa esperando resposta)</span>
    </fieldset>
  );
}

function NewStage({ stages, profiles }: { stages: S[]; profiles: P[] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StageKindName>("atendimento");
  const [after, setAfter] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [pending, start] = useTransition(); const toast = useToast();
  const submit = () => start(async () => {
    const r = await createStageAction({ name, kind, afterId: after || null, visibleProfileIds: ids.length ? ids : null });
    if (r.ok) { toast(`Etapa "${name.trim()}" criada`); setName(""); setIds([]); setAfter(""); } else toast(r.error, "error");
  });
  return (
    <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4 max-w-[760px]" aria-label="Nova etapa"
      onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-base font-medium">Nova etapa</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-graphite">Nome<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex.: Avaliação marcada" /></label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Tipo
          <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as StageKindName)}>{STAGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Depois de
          <Select aria-label="Depois de" value={after} onChange={(e) => setAfter(e.target.value)}><option value="">a primeira do mesmo tipo</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <legend className="mb-1 text-graphite">Quem vê no Quadro (nenhum marcado = todos)</legend>
        {profiles.map((p) => (
          <label key={p.id} className="inline-flex min-h-11 lg:min-h-0 items-center gap-1.5">
            <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={ids.includes(p.id)} onChange={() => setIds((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} />{p.name}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-muted">A etapa nova copia o prazo, o limite e a cor da primeira do mesmo tipo e entra nos mesmos avisos de espera.</p>
      <div><Button type="submit" loading={pending} disabled={name.trim().length < 2}>Criar etapa</Button></div>
    </form>
  );
}

function AttemptDays({ s }: { s: S }) {
  const def = ATTEMPT_DAYS[s.kind as keyof typeof ATTEMPT_DAYS];
  const [d, setD] = useState((s.attemptDays ?? [...def]).map(String));
  const [pending, start] = useTransition(); const toast = useToast();
  const nums = d.map(Number);
  const isDefault = nums.every((n, i) => n === def[i]);
  const dirty = nums.some((n, i) => n !== (s.attemptDays ?? def)[i]);
  const save = () => start(async () => {
    const r = await setStageAttemptDaysAction(s.id, isDefault ? null : nums);
    toast(r.ok ? "Tentativas salvas" : r.error, r.ok ? "ok" : "error");
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-muted">Tentativas:</span>
      {d.map((x, i) => (
        <label key={i} className="inline-flex items-center gap-1">D+<Input type="number" min={1} max={60} value={x} className="w-16 h-9" aria-label={`Dias até a tentativa ${i + 1} em ${s.name}`}
          onChange={(e) => setD(d.map((y, j) => (j === i ? e.target.value : y)))} /></label>
      ))}
      <SaveButton size="sm" savedText="" dirty={dirty} loading={pending} onClick={save}>Salvar</SaveButton>
      <span className="text-xs text-muted">padrão {def.map((n) => `D+${n}`).join(", ")}; depois da 3ª, 2 dias para a cliente responder</span>
    </span>
  );
}
