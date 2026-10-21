"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { remindReturnAction, scheduleFromContactAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { bahiaAt, dueLabel } from "@/lib/next-action";

/** Agendar (abre a conversa com a folha Agendar) e Lembrar (um combinado para quem tocou). Nada é enviado à cliente. */
export function ReturnActions({ contactId, dueOn, canSchedule }: { contactId: string; dueOn: string | null; canSchedule: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const agendar = () => start(async () => { const r = await scheduleFromContactAction(contactId); if (r && !r.ok) toast(r.error, "error"); });
  const lembrar = (dueAt?: Date) => start(async () => {
    const r = await remindReturnAction(contactId, dueAt ? { dueAt: dueAt.toISOString() } : { dueOn });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`Lembrete criado para ${dueLabel(Date.parse(r.data!.dueAt), Date.now())}. Aparece no Hoje.`, "ok");
    router.refresh();
  });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {canSchedule && <Button size="sm" onClick={agendar} loading={pending}>Agendar</Button>}
      <Button size="sm" variant="secondary" onClick={() => lembrar()} disabled={pending}>{dueOn ? "Lembrar no dia previsto" : "Lembrar amanhã"}</Button>
      <Button size="sm" variant="ghost" onClick={() => lembrar(bahiaAt(Date.now(), 7, 10))} disabled={pending}>Lembrar em 1 semana</Button>
    </div>
  );
}
