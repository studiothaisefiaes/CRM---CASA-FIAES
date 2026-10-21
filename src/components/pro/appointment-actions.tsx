"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { proActAction, proUndoNoShowAction } from "@/app/(pro)/pro/actions";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { PRO_ACTION_LABEL, type ProAction } from "@/lib/pro-day";
import { ExtrasSheet } from "./extras-sheet";

/** Os botões do horário, com o próximo passo em destaque. Depois de Finalizar, com o caixa no CRM, pergunta "Fez algo a mais?". */
export function AppointmentActions({ appointmentId, actions, services, clientName }: { appointmentId: string; actions: ProAction[]; services: { id: string; label: string; priceCents: number | null }[]; clientName?: string }) {
  const [pending, start] = useTransition();
  const [extras, setExtras] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const run = (a: ProAction) => start(async () => {
    const r = await proActAction(appointmentId, a);
    if (!r.ok) { toast(r.error, "error"); return; }
    if (a === "finalizar") {
      if (r.data?.comanda === "alimentada" && services.length) setExtras(true);
      toast(r.data?.comanda === "falhou" ? "Finalizado. A comanda não foi alimentada: avise a recepção." : "Finalizado");
    } else if (a === "faltou") {
      // Faltou pede confirmação e tem Desfazer (QA r58, M-2).
      toast("Marcado como falta", "ok", { label: "Desfazer", onClick: () => start(async () => {
        const u = await proUndoNoShowAction(appointmentId);
        toast(u.ok ? "Desfeito" : u.error, u.ok ? "ok" : "error");
        router.refresh();
      }) });
    } else toast(PRO_ACTION_LABEL[a]);
    router.refresh();
  });
  const confirmNoShow = useConfirmNoShow();
  const tap = (a: ProAction) => (a === "faltou" ? confirmNoShow({ who: clientName || "A cliente", onConfirm: () => run(a) }) : run(a));
  if (!actions.length) return null;
  return (
    <>
      <div className="flex flex-col gap-2">
        {actions.map((a, i) => (
          <Button key={a} size="lg" variant={i === 0 ? "primary" : "secondary"} className={a === "faltou" ? "text-alert" : undefined} disabled={pending} onClick={() => tap(a)}>
            {PRO_ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      <ExtrasSheet appointmentId={appointmentId} services={services} open={extras} onClose={() => setExtras(false)} />
    </>
  );
}
