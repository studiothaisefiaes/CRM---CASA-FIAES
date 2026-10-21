"use client";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { proExtrasAction } from "@/app/(pro)/pro/actions";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";

/** "Fez algo a mais?" depois de Finalizar (caixa no CRM): os serviços dela, com o preço do cadastro; sem preço, a recepção completa. */
export function ExtrasSheet({ appointmentId, services, open, onClose }: { appointmentId: string; services: { id: string; label: string; priceCents: number | null }[]; open: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => start(async () => {
    if (!picked.length) { onClose(); return; }
    const r = await proExtrasAction(appointmentId, picked);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(r.data?.comanda === "falhou" ? "A comanda não foi alimentada: avise a recepção." : "Acrescentado na comanda");
    setPicked([]); onClose();
  });
  return (
    <Sheet open={open} onClose={onClose} side="bottom" title="Fez algo a mais?"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="ghost" onClick={onClose}>Nada a mais</Button><Button loading={pending} onClick={save} disabled={!picked.length}>Acrescentar</Button></div>}>
      <div className="flex flex-col gap-2">
        {services.map((s) => (
          <button key={s.id} type="button" aria-pressed={picked.includes(s.id)} onClick={() => toggle(s.id)}
            className={cn("flex min-h-12 items-center justify-between rounded-[var(--radius-control)] border px-3 text-left", picked.includes(s.id) ? "border-ink bg-ink text-paper" : "border-line-strong")}>
            <span>{s.label}</span><span className="text-sm opacity-80">{s.priceCents != null ? formatBRL(s.priceCents) : "preço a completar"}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
