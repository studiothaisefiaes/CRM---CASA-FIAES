"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

type Result = { ok: boolean; error?: string };

/** Botão "Cancelar comanda" visível no cartão da lista: abre o motivo ali mesmo e só cancela com motivo escrito. */
export function CancelInline({ label, run, onDone, text = "Cancelar comanda" }: { /** O texto visível do botão: "Cancelar comanda" na fila, "Cancelar horário" nas agendadas. */ text?: string; label: string; run: (reason: string) => Promise<Result>; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    setError(null);
    if (!reason.trim()) { setError("Escreva o motivo."); return; }
    const r = await run(reason.trim());
    if (!r.ok) { setError(r.error ?? "Não foi possível cancelar."); return; }
    setOpen(false); setReason(""); onDone?.(); router.refresh();
  });
  if (!open) return <button type="button" aria-label={`Cancelar ${label}`} onClick={() => setOpen(true)} className="mx-4 mb-1 mt-1 inline-flex min-h-11 items-center text-xs font-medium text-alert underline-offset-2 hover:underline sm:min-h-8">{text}</button>;
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <Input aria-label={`Motivo do cancelamento de ${label}`} placeholder="Motivo do cancelamento" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      {error && <p role="alert" className="text-xs text-alert">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={go}>Confirmar cancelamento</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setOpen(false); setError(null); }}>Voltar</Button>
      </div>
    </div>
  );
}
