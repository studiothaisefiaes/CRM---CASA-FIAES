"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { decideOnlineRequestAction } from "@/app/(app)/agenda/pedidos-actions";
import type { OnlineRequestItem } from "@/server/domain/client-link/online";
import { formatPhoneClient } from "@/lib/phone-client";

const WHEN = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * "Pedidos do site (n)": confirmar vira Agendado (e avisa a profissional); recusar cancela. Nada é enviado à cliente: a Casa chama no WhatsApp.
 * QA r58, I-6: Recusar pede confirmação e o motivo (não volta atrás: o horário é liberado).
 */
export function OnlineRequestsButton({ items, openInitially }: { items: OnlineRequestItem[]; openInitially: boolean }) {
  const [open, setOpen] = useState(openInitially && items.length > 0);
  const [refusing, setRefusing] = useState<OnlineRequestItem | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  if (!items.length) return null;
  const decide = (visitId: string, d: "confirmar" | "recusar", why?: string) => start(async () => {
    const r = await decideOnlineRequestAction(visitId, d, why);
    if (!r.ok) { if (d === "recusar") setError(r.error); else toast(r.error, "error"); return; }
    setRefusing(null);
    toast(d === "confirmar" ? "Confirmado. Avise a cliente no WhatsApp." : "Recusado. Avise a cliente no WhatsApp.");
    router.refresh();
  });
  const askRefuse = (r: OnlineRequestItem) => { setRefusing(r); setMotivo(""); setError(null); };
  const refuse = () => {
    if (!refusing) return;
    if (!motivo.trim()) { setError("Escreva o motivo da recusa."); return; }
    decide(refusing.visitId, "recusar", motivo);
  };
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Pedidos do site ({items.length})</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pedidos do site">
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.visitId} className="rounded-[var(--radius-card)] border border-line p-3">
              <p className="font-medium">{r.client} · {r.service}</p>
              <p className="text-sm text-graphite">{WHEN.format(new Date(r.startsAt))} · com {r.professional}{r.phone ? ` · ${formatPhoneClient(r.phone)}` : ""}</p>
              {r.note && <p className="mt-1 text-sm">{r.note}</p>}
              <div className="mt-2 flex gap-2"><Button loading={pending} onClick={() => decide(r.visitId, "confirmar")}>Confirmar</Button><Button variant="secondary" disabled={pending} onClick={() => askRefuse(r)}>Recusar</Button></div>
            </li>
          ))}
        </ul>
      </Sheet>
      <Dialog open={!!refusing} onClose={() => setRefusing(null)} title="Recusar o pedido?"
        description={refusing ? `${refusing.client} · ${refusing.service} · ${WHEN.format(new Date(refusing.startsAt))}. O horário fica livre de novo e não dá para desfazer. A cliente não recebe nada: avise pelo WhatsApp.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setRefusing(null)}>Voltar</Button><Button variant="danger" loading={pending} onClick={refuse}>Recusar pedido</Button></>}>
        <Field label="Motivo" htmlFor="recusa-motivo" error={error}>
          <Textarea id="recusa-motivo" rows={2} maxLength={300} required aria-required="true" value={motivo} onChange={(e) => { setMotivo(e.target.value); setError(null); }}
            placeholder="Ex.: a profissional está de folga nesse dia" />
        </Field>
      </Dialog>
    </>
  );
}
