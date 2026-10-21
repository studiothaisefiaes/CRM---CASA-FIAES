"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/server/queries/agenda";
import { dayOf, minuteOfDay } from "@/lib/agenda";
import { hhmm } from "@/lib/free-slots";
import { useToast } from "@/components/ui/toast";
import type { AgendaMode } from "@/lib/agenda-settings";
import { BookingSheet, type BookingInitial, type BookingPro, type BookingService, type RescheduleTarget } from "./booking-sheet";
import { CancelSheet } from "./cancel-sheet";
import type { MarkerLabel, MarkerType } from "./marker-fields";
import type { ClientAlertConfig } from "@/lib/client-alert";
import type { RepetirConfig } from "@/lib/repetir";

export type AgendaCatalog = { services: BookingService[]; professionals: BookingPro[]; canMark: boolean; canFitIn: boolean; canEditConfig: boolean; agendaMode: AgendaMode;
  /** caixa.operar e caixa no CRM (6C). */ canCaixa?: boolean;
  /** Fase C (item 19): os marcadores ativos e os tipos em uso que a pessoa pode pôr. Vazio = a linha some (função desligada ou sem agenda.marcador). */
  labels?: MarkerLabel[]; visitTypes?: MarkerType[];
  /** Item 20: o Aviso da cliente salta ao abrir o horário (função + configuração) e o texto de quem não autorizou imagem. Ausente = não salta. */
  clientAlert?: ClientAlertConfig;
  /** Item 23a: os limites do Repetir, só com agenda.repetir e a função ligada. Ausente = a chave Repetir some. */
  repeat?: RepetirConfig | null;
  /** 20/10: "Preço e tempo por profissional" ligada (Guardar como padrão vai para a profissional) e o limite de assistentes da comanda (null = não avisa). */
  perProTerms?: boolean; comandaAssistantsMax?: number | null };
/** O que Remarcar e Cancelar leem do horário (a visita do dia monta isso sem ter o AgendaItem inteiro). */
export type RescheduleItem = Pick<AgendaItem, "scheduledAt" | "professionalId" | "serviceId" | "appointmentId" | "service" | "durationEstimated" | "durationMin" | "name" | "contactId" | "preference" | "professionalName" | "assistants">;
export type CancelItem = Pick<AgendaItem, "appointmentId" | "name" | "scheduledAt" | "service" | "dealId" | "series">;
type Ctx = { catalog: AgendaCatalog | null; book: (i: BookingInitial) => void; reschedule: (item: RescheduleItem) => void; cancel: (item: CancelItem, visitCount?: number) => void };
const AgendaSheetsCtx = createContext<Ctx>({ catalog: null, book: () => {}, reschedule: () => {}, cancel: () => {} });
export const useAgendaSheets = () => useContext(AgendaSheetsCtx);
/** Marcar, remarcar e lista de espera: com `agenda.marcar` e fora do modo consulta. */
export const canBookIn = (c: AgendaCatalog | null) => !!c && c.canMark && c.agendaMode !== "consulta";

/** As folhas da Agenda (Marcar/Remarcar e Cancelar) num lugar só: qualquer card, a grade e a faixa "Agora" abrem a mesma folha. */
export function AgendaSheetsProvider({ catalog, children }: { catalog: AgendaCatalog; children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [booking, setBooking] = useState<{ n: number; open: boolean; initial: BookingInitial; target: RescheduleTarget | null } | null>(null);
  const [cancelling, setCancelling] = useState<{ n: number; open: boolean; item: CancelItem; visitCount: number } | null>(null);
  const book = useCallback((initial: BookingInitial) => setBooking((b) => ({ n: (b?.n ?? 0) + 1, open: true, initial, target: null })), []);
  const reschedule = useCallback((item: RescheduleItem) => setBooking((b) => ({
    n: (b?.n ?? 0) + 1, open: true,
    initial: { day: dayOf(item.scheduledAt), time: hhmm(minuteOfDay(item.scheduledAt)), professionalId: item.professionalId, serviceId: item.serviceId },
    target: { appointmentId: item.appointmentId!, serviceId: item.serviceId, serviceLabel: item.service ?? "Serviço", professionalId: item.professionalId,
      durationMin: item.durationEstimated ? null : item.durationMin, clientName: item.name, contactId: item.contactId,
      preference: item.preference ?? null, professionalName: item.professionalName, assistantIds: item.assistants?.map((a) => a.id) ?? [] },
  })), []);
  const cancel = useCallback((item: CancelItem, visitCount = 1) => setCancelling((c) => ({ n: (c?.n ?? 0) + 1, open: true, item, visitCount })), []);
  const value = useMemo(() => ({ catalog, book, reschedule, cancel }), [catalog, book, reschedule, cancel]);
  return (
    <AgendaSheetsCtx.Provider value={value}>
      {children}
      {booking && (
        <BookingSheet key={`b${booking.n}`} open={booking.open} onClose={() => setBooking((b) => b && { ...b, open: false })}
          services={catalog.services} professionals={catalog.professionals} initial={booking.initial} reschedule={booking.target}
          canFitIn={catalog.canFitIn} canEditConfig={catalog.canEditConfig} agendaMode={catalog.agendaMode} labels={catalog.labels} visitTypes={catalog.visitTypes} repeat={catalog.repeat ?? null}
          perProTerms={catalog.perProTerms} comandaAssistantsMax={catalog.comandaAssistantsMax ?? null}
          onDone={(r) => { setBooking((b) => b && { ...b, open: false }); toast(r.message); router.refresh(); }} />
      )}
      {cancelling && (
        <CancelSheet key={`c${cancelling.n}`} open={cancelling.open} onClose={() => setCancelling((c) => c && { ...c, open: false })}
          item={cancelling.item} visitCount={cancelling.visitCount} agendaMode={catalog.agendaMode}
          onDone={(r) => {
            setCancelling((c) => c && { ...c, open: false });
            const many = r.cancelled > 1 ? `${r.cancelled} horários cancelados` : "Horário cancelado";
            if (r.waitlist) toast(`${many} · ${r.waitlist} na espera querem este dia`, "ok", { label: "Ver", onClick: () => router.push("/agenda?aba=espera") });
            else toast(many);
            router.refresh();
          }} />
      )}
    </AgendaSheetsCtx.Provider>
  );
}
