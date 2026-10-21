"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addListItemAction, updateListItemAction } from "@/app/(app)/config/actions";
import { NewSource } from "./sources";

type O = { id: string; label: string; active: boolean };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Origens numa lista só (Lote 4): as de "Como conheceu?" (só o nome) e, abaixo, as que têm link e QR. "Criar link e QR" abre a origem com
 * link já com o nome. Na conversa as duas aparecem juntas (`originChoices`).
 */
export function SimpleOrigins({ items, linked }: { items: O[]; linked: string[] }) {
  const [label, setLabel] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const hasLink = new Set(linked.map(norm));
  return (
    <section aria-labelledby="origens-simples">
      <h2 id="origens-simples" className="text-lg font-semibold">Origens</h2>
      <p className="mt-1 mb-4 max-w-[70ch] text-sm text-graphite">De onde as clientes vêm, para escolher em “Como conheceu?”. Para medir de verdade, crie um link e um QR: a cliente que chega por ele já entra com a origem certa.</p>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
          {items.map((o) => <li key={o.id}><OriginRow o={o} linked={hasLink.has(norm(o.label))} onLink={() => setLinking(o.label)} /></li>)}
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nenhuma origem ainda.</li>}
        </ul>
        <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4"
          onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addListItemAction("origin", label, null); if (r.ok) { setLabel(""); toast("Origem adicionada"); } else toast(r.error, "error"); }); }}>
          <p className="text-base font-medium">Adicionar origem</p>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Instagram" aria-label="Nome da nova origem" maxLength={60} />
          <Button type="submit" loading={pending} disabled={!label.trim()}>Adicionar</Button>
        </form>
      </div>
      <NewSource key={linking ?? "nova"} open={linking !== null} onClose={() => setLinking(null)} initialLabel={linking ?? ""} />
    </section>
  );
}

function OriginRow({ o, linked, onLink }: { o: O; linked: boolean; onLink: () => void }) {
  const [label, setLabel] = useState(o.label);
  const [pending, start] = useTransition(); const toast = useToast();
  const save = (active = o.active) => start(async () => { const r = await updateListItemAction(o.id, label, null, active); if (!r.ok) { toast(r.error, "error"); setLabel(o.label); } });
  return (
    <div className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${o.active ? "" : "opacity-60"}`}>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (label.trim() && label !== o.label) save(); }}
        aria-label={`Nome da origem ${o.label}`} className="h-9 max-w-[16rem] flex-1" maxLength={60} />
      {linked ? <span className="text-sm text-ok">Tem link e QR</span>
        : <Button size="sm" variant="secondary" onClick={onLink} aria-label={`Criar link e QR para ${o.label}`}>Criar link e QR</Button>}
      <Switch checked={o.active} disabled={pending} label={o.active ? `Desativar ${o.label}` : `Ativar ${o.label}`} onChange={(v) => save(v)} />
    </div>
  );
}
