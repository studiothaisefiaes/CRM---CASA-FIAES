"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { loseAction } from "@/app/(app)/funil/actions";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

const OTHER = "outro";

/**
 * Perdido pede o motivo (obrigatório, da lista de motivos de perda, ou "Outro" com "Qual o motivo?" escrito).
 * "Retomar contato em" é opcional: no dia, a conversa volta sozinha para Conversas.
 */
export function LoseSheet({ open, onClose, dealId, name, reasons, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; reasons: { id: string; label: string }[]; onDone: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [recontact, setRecontact] = useState("");
  const [error, setError] = useState<{ reason?: string; detail?: string; recontact?: string; form?: string }>({});
  const other = reason === OTHER;
  // "Outro" da lista (se a gestão cadastrou) vira a opção que pede o texto; nunca aparece duas vezes.
  const options = [...reasons.filter((r) => r.label.trim().toLowerCase() !== "outro").map((r) => ({ value: r.id, label: r.label })), { value: OTHER, label: "Outro" }];
  const [openedAt] = useState(() => Date.now());
  const [pending, start] = useTransition();

  const confirm = () => {
    const next: typeof error = {};
    if (!reason) next.reason = "Escolha o motivo da perda.";
    if (other && !detail.trim()) next.detail = "Escreva qual é o motivo.";
    const at = recontact ? slotMs(recontact, "10:00") : null;
    if (recontact && (at === null || !Number.isFinite(at) || at <= openedAt)) next.recontact = "Escolha uma data futura para retomar o contato.";
    setError(next);
    if (Object.keys(next).length) return;
    start(async () => {
      const r = await loseAction(dealId, reason!, at ? new Date(at).toISOString() : null, other ? detail.trim() : null);
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
        <p className="text-sm text-graphite">Conversa com <b className="font-medium text-ink">{name}</b></p>
        <div>
          <SheetLabel id="perdido-motivo">Motivo</SheetLabel>
          <Segmented labelledBy="perdido-motivo" options={options} value={reason} onChange={(v) => { setReason(v); setError((e) => ({ ...e, reason: undefined, detail: undefined, form: undefined })); }} />
          <FieldError>{error.reason}</FieldError>
          {other && (
            <div className="mt-3">
              <SheetLabel><label htmlFor="perdido-outro">Qual o motivo?</label></SheetLabel>
              <Input id="perdido-outro" value={detail} maxLength={200} autoComplete="off" autoFocus aria-invalid={error.detail ? true : undefined} aria-required
                onChange={(e) => { setDetail(e.target.value); setError((x) => ({ ...x, detail: undefined })); }} className="h-12" />
              <FieldError>{error.detail}</FieldError>
            </div>
          )}
        </div>
        <div>
          <SheetLabel hint="Opcional"><label htmlFor="perdido-retomar">Retomar contato em</label></SheetLabel>
          <Input id="perdido-retomar" type="date" min={bahiaParts(openedAt + 86_400_000).date} value={recontact} onChange={(e) => { setRecontact(e.target.value); setError((x) => ({ ...x, recontact: undefined })); }}
            aria-invalid={error.recontact ? true : undefined} className="h-12" />
          <p className="mt-1.5 text-sm text-muted">No dia, a conversa volta sozinha para Conversas.</p>
          <FieldError>{error.recontact}</FieldError>
        </div>
        <FieldError>{error.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
