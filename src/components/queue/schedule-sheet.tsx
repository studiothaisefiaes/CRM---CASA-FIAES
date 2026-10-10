"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { scheduleAction } from "@/app/(app)/funil/actions";
import { useHours, useNow } from "@/components/pipeline/timer";
import { bahiaParts, checkSlot, defaultSlot, slotMs } from "@/lib/schedule";
import { IconClock } from "@/components/icons";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

/**
 * Agendar (ou remarcar): data e hora lidas no horário de Salvador. Passado é erro; fora do expediente só avisa (a Casa decide).
 * Nasce nova a cada abertura (`key` de quem a monta). A hora de referência é a do momento da abertura.
 */
export function ScheduleSheet({ open, onClose, dealId, name, scheduledAt, reschedule, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string; scheduledAt: string | null; reschedule: boolean; onDone: (scheduledAt: string) => void;
}) {
  const hours = useHours();
  const [openedAt] = useState(() => Date.now());
  const [slot, setSlot] = useState(() => defaultSlot(openedAt, hours, scheduledAt ? new Date(scheduledAt).getTime() : null));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dateRef = useRef<HTMLInputElement>(null);

  const ms = slotMs(slot.date, slot.time);
  const now = useNow();
  const check = checkSlot(ms, now, hours);
  const error = serverError ?? (check.ok ? null : check.error);
  const warning = check.ok ? check.outsideHours : null;
  const pretty = Number.isFinite(ms) ? new Date(ms).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" }) + ` às ${slot.time}` : null;

  const confirm = () => {
    if (!check.ok) return;
    start(async () => {
      const iso = new Date(ms).toISOString();
      const r = await scheduleAction(dealId, iso);
      if (!r.ok) { setServerError(r.error); return; }
      onDone(iso);
    });
  };
  const set = (patch: Partial<typeof slot>) => { setSlot((s) => ({ ...s, ...patch })); setServerError(null); };

  return (
    <ActionSheet open={open} onClose={onClose} title={reschedule ? "Remarcar avaliação" : "Agendar avaliação"} initialFocusRef={dateRef}
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button size="lg" onClick={confirm} loading={pending}>{reschedule ? "Remarcar" : "Agendar"}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-graphite">Avaliação de <b className="font-medium text-ink">{name}</b></p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SheetLabel><label htmlFor="agenda-data">Dia</label></SheetLabel>
            <Input id="agenda-data" ref={dateRef} type="date" min={bahiaParts(openedAt).date} value={slot.date} onChange={(e) => set({ date: e.target.value })}
              aria-invalid={error ? true : undefined} aria-describedby="agenda-aviso" className="h-12" />
          </div>
          <div>
            <SheetLabel><label htmlFor="agenda-hora">Hora</label></SheetLabel>
            <Input id="agenda-hora" type="time" step={300} value={slot.time} onChange={(e) => set({ time: e.target.value })}
              aria-invalid={error ? true : undefined} aria-describedby="agenda-aviso" className="h-12" />
          </div>
        </div>
        <div id="agenda-aviso" className="flex flex-col gap-3">
          {pretty && !error && <p className="font-serif text-xl leading-snug first-letter:uppercase">{pretty}</p>}
          <FieldError>{error}</FieldError>
          {warning && !error && (
            <p role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">
              <IconClock size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{warning}</span>
            </p>
          )}
        </div>
      </div>
    </ActionSheet>
  );
}
