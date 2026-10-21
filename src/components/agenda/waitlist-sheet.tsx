"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { ActionSheet, FieldError, SheetLabel } from "@/components/queue/action-sheet";
import { waitlistAction } from "@/app/(app)/agenda/actions";
import { WAIT_WINDOW_LABEL, WAIT_WINDOWS, type WaitWindow } from "@/lib/appointment-status";
import { ClientPicker, type PickedClient } from "./client-picker";
import type { BookingPro, BookingService } from "./booking-sheet";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";

/** "+ Lista de espera" (6.1): cliente, serviço, profissional preferida ou qualquer uma, dia desejado, manhã/tarde/dia todo e observação. */
export function WaitlistSheet({ open, onClose, services, professionals, today, onDone }: {
  open: boolean; onClose: () => void; services: BookingService[]; professionals: BookingPro[]; today: string; onDone: () => void;
}) {
  const [client, setClient] = useState<PickedClient | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [pro, setPro] = useState("");
  const [day, setDay] = useState(today);
  const [win, setWin] = useState<WaitWindow>("dia");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pros = professionals.filter((p) => p.active && (!serviceId || p.serviceIds.includes(serviceId)));
  const save = () => {
    if (!client) { setError("Escolha a cliente."); return; }
    setError(null);
    start(async () => {
      const r = await waitlistAction({
        client: client.kind === "contato" ? { contactId: client.contactId } : { name: client.name, phone: client.phone },
        serviceId: serviceId || null, professionalId: pro || null, day, window: win, notes: notes.trim() || null,
      });
      if (!r.ok) { setError(r.error); return; }
      onDone();
    });
  };
  return (
    <ActionSheet open={open} onClose={onClose} title="Lista de espera"
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Voltar</Button>
        <Button size="lg" loading={pending} onClick={save}>Pôr na lista de espera</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <section aria-label="Cliente"><SheetLabel>Cliente</SheetLabel><ClientPicker value={client} onChange={(c) => { setClient(c); setError(null); }} /></section>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select aria-label="Serviço desejado" value={serviceId} className="h-12" onChange={(e) => { setServiceId(e.target.value); setPro(""); }}>
            <option value="">Qualquer serviço</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Select aria-label="Profissional preferida" value={pro} className="h-12" onChange={(e) => setPro(e.target.value)}>
            <option value="">Qualquer uma</option>
            {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div>
          <SheetLabel><label htmlFor="espera-dia">Dia desejado</label></SheetLabel>
          <Input id="espera-dia" type="date" min={today} value={day} className="h-12" onChange={(e) => setDay(e.target.value)} />
        </div>
        <div>
          <SheetLabel id="espera-periodo">Período</SheetLabel>
          <Segmented labelledBy="espera-periodo" value={win} onChange={setWin} options={WAIT_WINDOWS.map((w) => ({ value: w, label: WAIT_WINDOW_LABEL[w] }))} />
        </div>
        <div>
          <SheetLabel><label htmlFor="espera-obs">Observação</label></SheetLabel>
          <Textarea id="espera-obs" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <FieldError>{error}</FieldError>
      </div>
    </ActionSheet>
  );
}

/** O botão da aba Lista de espera (some no modo consulta e para quem não marca). */
export function WaitlistAdd({ today }: { today: string }) {
  const { catalog } = useAgendaSheets();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ n: number; open: boolean } | null>(null);
  if (!canBookIn(catalog) || !catalog) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setSheet((s) => ({ n: (s?.n ?? 0) + 1, open: true }))}>+ Lista de espera</Button>
      {sheet && (
        <WaitlistSheet key={sheet.n} open={sheet.open} onClose={() => setSheet((s) => s && { ...s, open: false })} today={today}
          services={catalog.services} professionals={catalog.professionals}
          onDone={() => { setSheet((s) => s && { ...s, open: false }); toast("Pedido na lista de espera"); router.refresh(); }} />
      )}
    </>
  );
}
