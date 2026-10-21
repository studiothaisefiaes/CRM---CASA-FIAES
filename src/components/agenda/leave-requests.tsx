"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { decideLeaveAction } from "@/app/(app)/agenda/profissional-actions";
import type { LeaveRequestItem } from "@/server/domain/pro/leave";

/** "Pedidos (n)" na Agenda: os pedidos de folga das profissionais, com quem está marcada no período. Nada é remarcado sozinho. */
export function LeaveRequestsButton({ items, openInitially }: { items: LeaveRequestItem[]; openInitially: boolean }) {
  const [open, setOpen] = useState(openInitially && items.length > 0);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  if (!items.length) return null;
  const decide = (id: string, d: "aprovar" | "recusar") => start(async () => {
    const r = await decideLeaveAction(id, d, d === "recusar" ? note : "");
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(d === "recusar" ? "Recusado" : r.data?.clients.length ? `Aprovado. Remarque: ${r.data.clients.join(", ")}` : "Aprovado");
    setRefusing(null); setNote(""); router.refresh();
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Pedidos ({items.length})</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pedidos de folga">
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-line p-3">
              <p className="font-medium">{r.professional} · {r.title}</p>
              <p className="text-sm text-graphite">{r.period}{r.notes ? ` · ${r.notes}` : ""}</p>
              {r.clients.length > 0 && <p className="mt-1 text-sm text-alert">{r.clients.length === 1 ? "1 cliente marcada" : `${r.clients.length} clientes marcadas`}: {r.clients.join(", ")}. Remarque antes ou depois de aprovar.</p>}
              {refusing === r.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Input aria-label={`Motivo da recusa para ${r.professional}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (ela vai ver)" maxLength={200} />
                  <div className="flex gap-2"><Button variant="ghost" onClick={() => setRefusing(null)}>Voltar</Button><Button variant="danger" loading={pending} onClick={() => decide(r.id, "recusar")}>Recusar</Button></div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2"><Button loading={pending} onClick={() => decide(r.id, "aprovar")}>Aprovar</Button><Button variant="secondary" onClick={() => { setNote(""); setRefusing(r.id); }}>Recusar</Button></div>
              )}
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
