"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { requestLeaveAction } from "@/app/(pro)/pro/actions";
import { LEAVE_REASONS } from "@/lib/leave-request";

/** Pedir folga ou bloqueio: dia ou período, das … às … e motivo. Quem decide é a recepção. */
export function LeaveForm({ today }: { today: string }) {
  const [v, setV] = useState({ startsOn: today, endsOn: today, allDay: true, startTime: "09:00", endTime: "18:00", reason: "folga", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const submit = () => start(async () => {
    setError(null);
    const r = await requestLeaveAction(v);
    if (!r.ok) { setError(r.error); return; }
    toast("Pedido enviado. Fica 'Aguardando a recepção'.");
    router.refresh();
  });
  return (
    <form noValidate className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Dia" htmlFor="folga-ini"><Input id="folga-ini" type="date" min={today} value={v.startsOn} onChange={(e) => set({ startsOn: e.target.value, endsOn: v.endsOn < e.target.value ? e.target.value : v.endsOn })} /></Field>
        <Field label="Até" htmlFor="folga-fim"><Input id="folga-fim" type="date" min={v.startsOn} value={v.endsOn} onChange={(e) => set({ endsOn: e.target.value })} /></Field>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={v.allDay} onChange={(e) => set({ allDay: e.target.checked })} />Dia todo</label>
      {!v.allDay && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Das" htmlFor="folga-das"><Input id="folga-das" type="time" step={900} value={v.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
          <Field label="Às" htmlFor="folga-as"><Input id="folga-as" type="time" step={900} value={v.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Motivo" htmlFor="folga-motivo">
        <Select id="folga-motivo" value={v.reason} onChange={(e) => set({ reason: e.target.value })}>
          {Object.entries(LEAVE_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <Field label={v.reason === "outro" ? "Qual o motivo?" : "Observação (opcional)"} htmlFor="folga-obs" error={error}>
        <Input id="folga-obs" value={v.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} aria-invalid={!!error} />
      </Field>
      <Button type="submit" size="lg" loading={pending}>Pedir</Button>
    </form>
  );
}
