"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { scheduleAction } from "@/app/(app)/funil/actions";
import { useClock, useHours } from "@/components/pipeline/timer";
import { bahiaParts, checkSlot, defaultSlot, slotMs } from "@/lib/schedule";
import { IconClock } from "@/components/icons";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

/**
 * Agendar (ou remarcar): data e hora lidas no horário de Salvador. Passado é erro; fora do expediente só avisa (a Casa decide).
 * Nasce nova a cada abertura (`key` de quem a monta). A hora de referência é a do momento da abertura.
 */
type Pro = { id: string; name: string; active: boolean; serviceIds: string[] };
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/** O aviso de horário da mesma profissional a menos de 1 hora (não impede o agendamento). */
export const conflictText = (pro: string, cs: { name: string; at: string }[]) =>
  `Atenção: ${pro} já tem ${cs.map((c) => `${c.name} às ${HORA.format(new Date(c.at))}`).join(" e ")}.`;

export function ScheduleSheet({ open, onClose, dealId, name, scheduledAt, reschedule, onDone, services = [], professionals = [], initial }: {
  open: boolean; onClose: () => void; dealId: string; name: string; scheduledAt: string | null; reschedule: boolean;
  onDone: (scheduledAt: string, warning: string | null) => void;
  services?: { id: string; label: string }[]; professionals?: Pro[]; initial?: { serviceId: string | null; professionalId: string | null };
}) {
  const hours = useHours();
  const [openedAt] = useState(() => Date.now());
  const [slot, setSlot] = useState(() => defaultSlot(openedAt, hours, scheduledAt ? new Date(scheduledAt).getTime() : null));
  const [serverError, setServerError] = useState<string | null>(null);
  const active = professionals.filter((p) => p.active);
  const [service, setService] = useState<string>(() => (initial?.serviceId && services.some((x) => x.id === initial.serviceId) ? initial.serviceId : ""));
  const [pro, setPro] = useState<string>(() => (initial?.professionalId && active.some((p) => p.id === initial.professionalId) ? initial.professionalId : ""));
  const linked = service ? active.filter((p) => p.serviceIds.includes(service)) : [];
  // Ninguém cadastrado para esse serviço ainda: mostra todas (o cadastro de quem faz o quê vem depois).
  const pros = service && linked.length ? linked : active;
  const [pending, start] = useTransition();
  const dateRef = useRef<HTMLInputElement>(null);

  const ms = slotMs(slot.date, slot.time);
  // A validação "horário já passou" só precisa do minuto: o formulário não re-renderiza por segundo.
  const now = useClock((n) => Math.floor(n / 60_000) * 60_000);
  const check = checkSlot(ms, now, hours);
  const error = serverError ?? (check.ok ? null : check.error);
  const warning = check.ok ? check.outsideHours : null;
  const pretty = Number.isFinite(ms) ? new Date(ms).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" }) + ` às ${slot.time}` : null;

  const confirm = () => {
    if (!check.ok) return;
    start(async () => {
      const iso = new Date(ms).toISOString();
      const r = await scheduleAction(dealId, iso, { serviceId: service || null, professionalId: pro || null });
      if (!r.ok) { setServerError(r.error); return; }
      const cs = r.data?.conflicts ?? [];
      onDone(iso, cs.length ? conflictText(active.find((p) => p.id === pro)?.name.split(" ")[0] ?? "A profissional", cs) : null);
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
        {(services.length > 0 || active.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {services.length > 0 && (
              <div>
                <SheetLabel><label htmlFor="agenda-servico">Serviço</label></SheetLabel>
                <Select id="agenda-servico" value={service} className="h-12 w-full"
                  onChange={(e) => { const v = e.target.value; setService(v); if (pro && v && !active.find((p) => p.id === pro)?.serviceIds.includes(v)) setPro(""); setServerError(null); }}>
                  <option value="">Escolher depois</option>
                  {services.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </Select>
              </div>
            )}
            {active.length > 0 && (
              <div>
                <SheetLabel><label htmlFor="agenda-profissional">Profissional</label></SheetLabel>
                <Select id="agenda-profissional" value={pro} className="h-12 w-full" onChange={(e) => { setPro(e.target.value); setServerError(null); }}>
                  <option value="">{pros.length ? "Qualquer uma" : "Ninguém faz esse serviço"}</option>
                  {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            )}
          </div>
        )}
        <div id="agenda-aviso" className="flex flex-col gap-3">
          {pretty && !error && <p className="font-display text-xl leading-snug first-letter:uppercase">{pretty}</p>}
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
