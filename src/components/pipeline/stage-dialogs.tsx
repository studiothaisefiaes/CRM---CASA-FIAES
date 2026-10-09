"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

export type PendingMove = { cardId: string; name: string; to: { id: string; key: string; name: string; kind: string } };

function localInput(d: Date) { const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
export const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

/** Pede o que falta antes de mover para Agendado, Perdido ou Fechado. */
export function StageDialogs({ pending, lostReasons, onCancel, onConfirm }: {
  pending: PendingMove | null; lostReasons: { id: string; label: string }[]; onCancel: () => void; onConfirm: (extra: Record<string, unknown>) => void;
}) {
  const kind = pending?.to.kind;
  const [when, setWhen] = useState(""); const [reason, setReason] = useState(""); const [recontact, setRecontact] = useState("");
  const [value, setValue] = useState(""); const [pay, setPay] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (pending) {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
      setWhen(localInput(d)); setReason(""); setRecontact(""); setValue(""); setPay(""); setErr(null);
    }
  }

  const confirm = () => {
    if (kind === "agendado") {
      if (!when) return setErr("Escolha a data e o horário.");
      return onConfirm({ scheduledAt: toIso(when) });
    }
    if (kind === "perdido") {
      if (!reason) return setErr("Escolha o motivo da perda.");
      return onConfirm({ lostReasonId: reason, recontactAt: recontact ? toIso(recontact + "T10:00") : null });
    }
    const cents = value ? Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100) : null;
    if (value && (cents == null || Number.isNaN(cents) || cents < 0)) return setErr("Valor inválido. Ex.: 1.158,00");
    onConfirm({ valueCents: cents, paymentMethod: pay || null });
  };
  const titles: Record<string, string> = { agendado: "Agendar", perdido: "Marcar como perdido", fechado: "Fechar venda" };
  return (
    <Dialog open={!!pending && !!kind && kind in titles} onClose={onCancel} title={titles[kind ?? ""] ?? ""}
      description={pending ? <>Lead: <b className="text-ink">{pending.name}</b></> : null}
      footer={<><Button variant="secondary" onClick={onCancel}>Cancelar</Button><Button onClick={confirm} variant={kind === "perdido" ? "danger" : "primary"}>{kind === "agendado" ? "Agendar" : kind === "perdido" ? "Marcar como perdido" : "Fechar venda"}</Button></>}>
      <div className="flex flex-col gap-4" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "SELECT") confirm(); }}>
        {kind === "agendado" && <Field label="Data e horário da avaliação" htmlFor="when"><Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>}
        {kind === "perdido" && (
          <>
            <Field label="Motivo" htmlFor="reason">
              <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Escolha…</option>{lostReasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="Retomar contato em (opcional)" hint="No dia, o lead volta sozinho para Atendimento." htmlFor="rec">
              <Input id="rec" type="date" value={recontact} onChange={(e) => setRecontact(e.target.value)} />
            </Field>
          </>
        )}
        {kind === "fechado" && (
          <>
            <Field label="Valor fechado (R$)" hint="Opcional. Pode preencher depois no card." htmlFor="val"><Input id="val" inputMode="decimal" placeholder="1.158,00" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label="Forma de pagamento" htmlFor="pay">
              <Select id="pay" value={pay} onChange={(e) => setPay(e.target.value)}><option value="">—</option><option value="pix">Pix</option><option value="cartao">Cartão</option><option value="boleto">Boleto</option><option value="dinheiro">Dinheiro</option></Select>
            </Field>
          </>
        )}
        {err && <p className="text-[13px] text-alert" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}
