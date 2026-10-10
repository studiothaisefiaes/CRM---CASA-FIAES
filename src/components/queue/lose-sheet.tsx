"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { loseAction } from "@/app/(app)/funil/actions";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

/** Perdido pede o motivo (obrigatório, da lista de motivos de perda). "Retomar contato em" é opcional: no dia, o lead volta sozinho para Atendimento. */
export function LoseSheet({ open, onClose, dealId, name, reasons, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; reasons: { id: string; label: string }[]; onDone: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [recontact, setRecontact] = useState("");
  const [error, setError] = useState<{ reason?: string; recontact?: string; form?: string }>({});
  const [openedAt] = useState(() => Date.now());
  const [pending, start] = useTransition();

  const confirm = () => {
    const next: typeof error = {};
    if (!reason) next.reason = "Escolha o motivo da perda.";
    const at = recontact ? slotMs(recontact, "10:00") : null;
    if (recontact && (at === null || !Number.isFinite(at) || at <= openedAt)) next.recontact = "Escolha uma data futura para retomar o contato.";
    setError(next);
    if (Object.keys(next).length) return;
    start(async () => {
      const r = await loseAction(dealId, reason!, at ? new Date(at).toISOString() : null);
      if (!r.ok) { setError({ form: r.error }); return; }
      onDone();
    });
  };

  return (
    <ActionSheet open={open} onClose={onClose} title="Marcar como perdido"
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button variant="danger" size="lg" onClick={confirm} loading={pending}>Marcar como perdido</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-graphite">Lead de <b className="font-medium text-ink">{name}</b></p>
        <div>
          <SheetLabel id="perdido-motivo">Motivo</SheetLabel>
          {reasons.length ? (
            <Segmented labelledBy="perdido-motivo" options={reasons.map((r) => ({ value: r.id, label: r.label }))} value={reason} onChange={(v) => { setReason(v); setError((e) => ({ ...e, reason: undefined, form: undefined })); }} />
          ) : <p className="text-sm text-graphite">Nenhum motivo cadastrado. Peça à gestão para cadastrar em Listas e respostas.</p>}
          <FieldError>{error.reason}</FieldError>
        </div>
        <div>
          <SheetLabel hint="Opcional"><label htmlFor="perdido-retomar">Retomar contato em</label></SheetLabel>
          <Input id="perdido-retomar" type="date" min={bahiaParts(openedAt + 86_400_000).date} value={recontact} onChange={(e) => { setRecontact(e.target.value); setError((x) => ({ ...x, recontact: undefined })); }}
            aria-invalid={error.recontact ? true : undefined} className="h-12" />
          <p className="mt-1.5 text-sm text-muted">No dia, o lead volta sozinho para Atendimento.</p>
          <FieldError>{error.recontact}</FieldError>
        </div>
        <FieldError>{error.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
