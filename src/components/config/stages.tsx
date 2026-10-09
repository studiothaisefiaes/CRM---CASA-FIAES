"use client";
import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateStageAction, moveStageAction } from "@/app/(app)/config/actions";
import { SPRING } from "@/lib/motion";

type S = { id: string; key: string; name: string; kind: string; slaMinutes: number | null; staleDays: number | null; color: string };
const KIND: Record<string, string> = { lead: "Entrada", atendimento: "Atendimento", agendado: "Agendado", followup: "Follow-up", fechado: "Ganho", perdido: "Perda" };

export function StagesEditor({ stages }: { stages: S[] }) {
  return (
    <div>
      <p className="text-[13.5px] text-graphite mb-4 max-w-[70ch]">O <b>prazo de resposta</b> é quando o card fica vermelho para quem atende. O <b>limite parado</b> é usado pela automação &quot;Lead parado&quot;. Deixe em branco para não usar.</p>
      <div className="rounded-[16px] border border-line bg-paper overflow-x-auto">
        <div className="grid grid-cols-[64px_1.4fr_110px_130px_120px_70px_90px] gap-3 px-4 py-2.5 text-[12px] text-muted border-b border-line min-w-[760px]">
          <span>Ordem</span><span>Nome</span><span>Tipo</span><span>Prazo de resposta</span><span>Limite parado</span><span>Cor</span><span />
        </div>
        {stages.map((s, i) => <Row key={s.id} s={s} first={i === 0} last={i === stages.length - 1} />)}
      </div>
    </div>
  );
}

function Row({ s, first, last }: { s: S; first: boolean; last: boolean }) {
  const [v, setV] = useState({ name: s.name, sla: s.slaMinutes?.toString() ?? "", stale: s.staleDays?.toString() ?? "", color: s.color });
  const [pending, start] = useTransition(); const toast = useToast();
  const dirty = v.name !== s.name || v.sla !== (s.slaMinutes?.toString() ?? "") || v.stale !== (s.staleDays?.toString() ?? "") || v.color !== s.color;
  const save = () => start(async () => {
    const r = await updateStageAction(s.id, { name: v.name, slaMinutes: v.sla ? Number(v.sla) : null, staleDays: v.stale ? Number(v.stale) : null, color: v.color });
    toast(r.ok ? `Etapa "${v.name}" salva` : r.error, r.ok ? "ok" : "error");
  });
  return (
    <motion.div layout transition={SPRING} className="grid grid-cols-[64px_1.4fr_110px_130px_120px_70px_90px] gap-3 px-4 py-2.5 items-center border-b border-line/70 last:border-0 min-w-[760px]">
      <div className="flex gap-1">
        <button disabled={first || pending} aria-label="Subir" onClick={() => start(async () => { await moveStageAction(s.id, -1); })} className="size-7 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↑</button>
        <button disabled={last || pending} aria-label="Descer" onClick={() => start(async () => { await moveStageAction(s.id, 1); })} className="size-7 rounded-[7px] border border-line disabled:opacity-30 hover:bg-paper-2">↓</button>
      </div>
      <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Nome da etapa" />
      <span className="text-[12.5px] text-graphite">{KIND[s.kind]}</span>
      <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.sla} onChange={(e) => setV({ ...v, sla: e.target.value })} className="w-20" aria-label="Prazo de resposta em minutos" /><span className="text-[12px] text-muted">min</span></label>
      <label className="flex items-center gap-1.5"><Input type="number" min={1} value={v.stale} onChange={(e) => setV({ ...v, stale: e.target.value })} className="w-16" aria-label="Limite parado em dias" /><span className="text-[12px] text-muted">dias</span></label>
      <input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} aria-label="Cor" className="size-9 rounded-[8px] border border-line cursor-pointer bg-transparent" />
      <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={pending} onClick={save}>Salvar</Button>
    </motion.div>
  );
}
