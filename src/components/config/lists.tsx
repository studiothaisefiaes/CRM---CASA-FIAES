"use client";
import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addListItemAction, updateListItemAction } from "@/app/(app)/config/actions";
import { SPRING } from "@/lib/motion";

type Item = { id: string; kind: "objection" | "lost_reason" | "quick_reply" | "origin"; label: string; body: string | null; active: boolean };
const TABS = [["quick_reply", "Respostas prontas", "Aparecem ao digitar / no card. Use {nome} para o primeiro nome da cliente."], ["objection", "Objeções", "O que a cliente diz quando hesita. Viram relatório."], ["lost_reason", "Motivos de perda", "Pedidos ao marcar um lead como perdido."], ["origin", "Origens", "De onde vêm os leads."]] as const;

export function ListsEditor({ items }: { items: Item[] }) {
  const [tab, setTab] = useState<Item["kind"]>("quick_reply");
  const [label, setLabel] = useState(""); const [body, setBody] = useState("");
  const [pending, start] = useTransition(); const toast = useToast();
  const current = items.filter((i) => i.kind === tab);
  const meta = TABS.find((t) => t[0] === tab)!;
  return (
    <div>
      <div className="flex flex-wrap gap-1 bg-paper-2 border border-line rounded-[12px] p-1 w-fit" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`relative h-8 px-3 text-[13px] rounded-[9px] ${tab === k ? "text-ink font-medium" : "text-graphite"}`}>
            {tab === k && <motion.span layoutId="list-tab" transition={SPRING} className="absolute inset-0 bg-paper rounded-[9px] shadow-[var(--shadow-card)]" />}<span className="relative">{l}</span>
          </button>
        ))}
      </div>
      <p className="text-[13px] text-graphite mt-3 mb-4">{meta[2]}</p>
      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <ul className="rounded-[16px] border border-line bg-paper divide-y divide-line/70">
          <AnimatePresence initial={false}>{current.map((i) => <motion.li key={i.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Row i={i} /></motion.li>)}</AnimatePresence>
          {current.length === 0 && <li className="px-4 py-8 text-center text-muted text-[13px]">Nada aqui ainda.</li>}
        </ul>
        <form className="rounded-[16px] border border-line bg-paper-2/60 p-4 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addListItemAction(tab, label, tab === "quick_reply" ? body : null); if (r.ok) { setLabel(""); setBody(""); toast("Adicionado"); } else toast(r.error, "error"); }); }}>
          <p className="font-medium text-[14px]">Adicionar</p>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tab === "quick_reply" ? "Atalho, ex.: promocao" : "Texto"} aria-label="Nome" />
          {tab === "quick_reply" && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Oi, {nome}! …" aria-label="Texto da resposta" />}
          <Button type="submit" loading={pending} disabled={!label.trim()}>Adicionar</Button>
        </form>
      </div>
    </div>
  );
}

function Row({ i }: { i: Item }) {
  const [label, setLabel] = useState(i.label); const [body, setBody] = useState(i.body ?? "");
  const [pending, start] = useTransition(); const toast = useToast();
  const save = (active = i.active) => start(async () => { const r = await updateListItemAction(i.id, label, i.kind === "quick_reply" ? body : null, active); if (!r.ok) toast(r.error, "error"); });
  return (
    <div className={`px-4 py-3 flex gap-3 items-start ${i.active ? "" : "opacity-50"}`}>
      <div className="flex-1 flex flex-col gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== i.label && save()} className="font-medium text-[14px] bg-transparent outline-none rounded px-1 -mx-1 focus:bg-paper-2" aria-label="Nome" />
        {i.kind === "quick_reply" && <textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== (i.body ?? "") && save()} rows={2} className="text-[13px] text-graphite bg-transparent outline-none resize-none rounded px-1 -mx-1 focus:bg-paper-2" aria-label="Texto" />}
      </div>
      <Switch checked={i.active} label={i.active ? "Desativar" : "Ativar"} disabled={pending} onChange={(v) => save(v)} />
    </div>
  );
}
