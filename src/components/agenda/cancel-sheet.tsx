"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { AgendaItem } from "@/server/queries/agenda";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { ActionSheet, FieldError, SheetLabel } from "@/components/queue/action-sheet";
import { cancelAction } from "@/app/(app)/agenda/actions";
import { CANCEL_REASON_LABEL, RECEPTION_CANCEL_REASONS, type CancelReason } from "@/lib/appointment-status";
import { cancelNoticeText } from "@/lib/agenda-text";
import { leadHref } from "@/lib/lead-href";
import type { AgendaMode } from "@/lib/agenda-settings";

/**
 * Cancelar (6.1): motivo obrigatório ("Outro" pede o texto); visita com mais de um serviço pergunta "Só este serviço" ou "A visita toda";
 * horário que se repete (item 23a) pergunta também "Este e os próximos" (vale mesmo com a função repetir desligada).
 * "Avisar a cliente" copia o texto pronto e oferece abrir a conversa: nada é enviado sozinho. Nada é apagado.
 */
export function CancelSheet({ open, onClose, item, visitCount, agendaMode, onDone }: {
  open: boolean; onClose: () => void; item: Pick<AgendaItem, "appointmentId" | "name" | "scheduledAt" | "service" | "dealId" | "series">; visitCount: number; agendaMode: AgendaMode;
  onDone: (r: { cancelled: number; waitlist: number }) => void;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"este" | "visita" | "serie">("este");
  const scopes: { value: "este" | "visita" | "serie"; label: string }[] = [
    { value: "este", label: visitCount > 1 ? "Só este serviço" : "Só este" },
    ...(visitCount > 1 ? [{ value: "visita" as const, label: "A visita toda" }] : []),
    ...(item.series ? [{ value: "serie" as const, label: "Este e os próximos" }] : []),
  ];
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const notice = cancelNoticeText({ clientName: item.name, startsAt: item.scheduledAt, services: [item.service ?? "seu serviço"] });

  const confirm = () => {
    if (!reason) { setError("Escolha o motivo."); return; }
    if (reason === "outro" && !note.trim()) { setError("Escreva o motivo."); return; }
    setError(null);
    start(async () => {
      const r = await cancelAction({ appointmentId: item.appointmentId!, scope, reason, note: note.trim() || null });
      if (!r.ok) { setError(r.error); return; }
      onDone({ cancelled: r.data!.cancelled, waitlist: r.data!.waitlist });
    });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(notice); setCopied(true); } catch { setCopied(false); setError("Não deu para copiar. Selecione o texto e copie."); }
  };

  return (
    <ActionSheet open={open} onClose={onClose} title="Cancelar horário"
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Voltar</Button>
        <Button variant="danger" size="lg" loading={pending} onClick={confirm}>Cancelar horário</Button>
      </>}>
      <div className="flex flex-col gap-5">
        {agendaMode !== "so_crm" && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">Enquanto o Avec estiver ligado, cancele também lá.</p>}
        <div>
          <SheetLabel id="cancelar-motivo">Motivo</SheetLabel>
          <Segmented labelledBy="cancelar-motivo" value={reason} onChange={(v) => { setReason(v); setError(null); }}
            options={RECEPTION_CANCEL_REASONS.map((r) => ({ value: r, label: CANCEL_REASON_LABEL[r] }))} />
        </div>
        <div>
          <SheetLabel><label htmlFor="cancelar-nota">{reason === "outro" ? "Qual o motivo?" : "Observação (opcional)"}</label></SheetLabel>
          <Textarea id="cancelar-nota" value={note} maxLength={200} onChange={(e) => { setNote(e.target.value); setError(null); }} />
        </div>
        {scopes.length > 1 && (
          <div>
            <SheetLabel id="cancelar-escopo">O que cancelar</SheetLabel>
            <Segmented labelledBy="cancelar-escopo" value={scope} onChange={setScope} options={scopes} />
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line px-3 py-3">
          <p className="text-sm text-graphite">{notice}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={copy}>Avisar a cliente</Button>
            {item.dealId && <Link href={leadHref(item.dealId)} className="text-sm font-medium text-gold-ink underline-offset-4 hover:underline">Abrir conversa</Link>}
          </div>
          {copied && <p role="status" className="text-sm text-ok">Texto copiado: cole na conversa da cliente.</p>}
        </div>
        <FieldError>{error}</FieldError>
      </div>
    </ActionSheet>
  );
}
