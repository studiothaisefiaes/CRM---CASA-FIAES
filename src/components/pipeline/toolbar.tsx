"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconPlus, IconSearch } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { createLeadAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";

export function Toolbar({ people, origins }: { people: { id: string; name: string }[]; origins: string[] }) {
  const router = useRouter(); const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const set = (k: string, v: string) => { const p = new URLSearchParams(sp.toString()); if (v) p.set(k, v); else p.delete(k); p.delete("lead"); router.replace(`/funil${p.size ? `?${p}` : ""}`, { scroll: false }); };
  useEffect(() => { const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q); }, 280); return () => clearTimeout(t); }); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = "h-9 rounded-[10px] border border-line-strong bg-paper px-3 pr-7 text-[13px] appearance-none cursor-pointer";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <span className="sr-only">Buscar</span>
        <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome ou telefone" className="h-9 w-56 pl-9 pr-3 rounded-[10px] border border-line-strong bg-paper text-[13px] outline-none focus:border-ink" />
      </label>
      <select aria-label="Responsável" value={sp.get("dono") ?? ""} onChange={(e) => set("dono", e.target.value)} className={sel}>
        <option value="">Toda a equipe</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select aria-label="Origem" value={sp.get("origem") ?? ""} onChange={(e) => set("origem", e.target.value)} className={sel}>
        <option value="">Todas as origens</option>{origins.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <Button onClick={() => setOpen(true)} size="sm" className="h-9"><IconPlus size={16} />Novo lead</Button>
      <NewLeadDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phone, setPhone] = useState(""); const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const router = useRouter(); const toast = useToast();
  useEffect(() => { if (open) { setPhone(""); setName(""); setErr(null); } }, [open]);
  const submit = () => start(async () => {
    const r = await createLeadAction({ phone, name });
    if (!r.ok) return setErr(r.error);
    onClose(); toast("Lead criado"); router.push(`/funil?lead=${r.data!.dealId}`, { scroll: false });
  });
  return (
    <Dialog open={open} onClose={onClose} title="Novo lead" description="Para quem ligou ou chegou pela recepção. Leads do WhatsApp entram sozinhos."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Criar lead</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Telefone (WhatsApp)" htmlFor="nl-phone" error={err}><Input id="nl-phone" inputMode="tel" placeholder="71 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!err} /></Field>
        <Field label="Nome" htmlFor="nl-name"><Input id="nl-name" placeholder="Opcional" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
