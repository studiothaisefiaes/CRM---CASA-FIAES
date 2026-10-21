"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppointmentItem } from "@/server/queries/avec";
import { dayOf } from "@/lib/agenda";
import { WAIT_WINDOW_LABEL, type WaitWindow } from "@/lib/appointment-status";
import { formatPhoneClient } from "@/lib/phone-client";
import { initials } from "@/lib/format";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { resolveWaitlistAction } from "@/app/(app)/agenda/actions";
import { cn } from "@/lib/cn";
import { AvecTag } from "./status-chip";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";

const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WINDOW_TIME: Record<WaitWindow, string> = { manha: "09:00", tarde: "14:00", dia: "09:00" };

/**
 * Aba Lista de espera: quem pediu horário e ainda não tem, pelo dia pedido. "Encaixar" abre o Marcar já preenchido (cliente, serviço,
 * profissional e período) e o pedido sai da lista; "Desistiu" tira sem apagar. Dia que já passou fica marcado.
 */
export function Waitlist({ items, today }: { items: AppointmentItem[]; today: string }) {
  const { catalog, book } = useAgendaSheets();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!items.length) return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
      <Empty title="Ninguém na lista de espera">Quem pedir horário sem vaga aparece aqui, pelo dia pedido.</Empty>
    </div>
  );
  const giveUp = (i: AppointmentItem) => start(async () => {
    const r = await resolveWaitlistAction(i.id, { result: "desistiu" });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`${i.clientName} saiu da lista de espera`);
    router.refresh();
  });
  const groups = new Map<string, AppointmentItem[]>();
  for (const i of items) { const d = dayOf(i.startsAt); groups.set(d, [...(groups.get(d) ?? []), i]); }
  return (
    <div className="flex flex-col gap-5">
      {[...groups].map(([d, its]) => {
        const past = d < today;
        return (
          <section key={d} aria-label={`Pedidos para ${d}`}>
            <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
              <span className={past ? "text-muted" : "text-ink"}>{cap(DIA.format(new Date(`${d}T12:00:00Z`)))}</span>
              {d === today && <span className="text-xs font-semibold text-gold-ink">hoje</span>}
              {past && <span className="text-xs font-medium text-alert">dia já passou</span>}
              <span className="ml-auto text-xs font-normal text-muted tabular">{its.length} {its.length === 1 ? "pedido" : "pedidos"}</span>
            </h3>
            <ul className="rounded-[var(--radius-panel)] border border-line bg-paper">
              {its.map((i) => {
                const win = (i.waitWindow ?? "dia") as WaitWindow;
                const who = (
                  <>
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-sm font-semibold text-gold-ink">{initials(i.clientName)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><span className="truncate text-base font-medium">{i.clientName}</span>{i.origin === "avec" && <AvecTag />}</span>
                      <span className="block truncate text-sm text-graphite">
                        {[i.serviceLabel || "Serviço não informado", i.professionalName ? `com ${i.professionalName.split(" ")[0]}` : "qualquer profissional", WAIT_WINDOW_LABEL[win] ?? null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={i.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line/70 px-4 py-3 first:border-t-0 sm:px-5", past && "bg-paper-2/40")}>
                    {i.contactId
                      ? <Link href={`/contatos/${i.contactId}`} className="flex min-h-11 min-w-0 flex-1 basis-56 items-center gap-3 rounded-[var(--radius-control)] hover:text-gold-ink">{who}</Link>
                      : <span className="flex min-h-11 min-w-0 flex-1 basis-56 items-center gap-3">{who}</span>}
                    {i.phone && <span className="text-sm text-graphite tabular">{formatPhoneClient(i.phone)}</span>}
                    <span className="flex gap-2">
                      {canBookIn(catalog) && i.contactId && (
                        <Button size="sm" onClick={() => book({ day: past ? today : d, time: WINDOW_TIME[win] ?? "09:00", serviceId: i.serviceId, professionalId: i.professionalId,
                          client: { contactId: i.contactId!, name: i.clientName }, waitlistId: i.id })}>Encaixar</Button>
                      )}
                      {catalog?.canMark && <Button size="sm" variant="ghost" disabled={pending} onClick={() => giveUp(i)}>Desistiu</Button>}
                    </span>
                    {i.notes && <p className="w-full pl-[52px] text-sm text-muted">“{i.notes}”</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
