"use client";
import { useState, useTransition } from "react";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { AVAILABILITY, AVAILABILITY_LABEL, type Availability } from "@/lib/availability";
import { setAvailabilityAction } from "@/app/(app)/presenca/actions";
import { cn } from "@/lib/cn";

const DOT: Record<Availability, string> = { disponivel: "bg-ok", pausa: "bg-gold", ausente: "bg-control" };
const asAvailability = (v: string): Availability => (AVAILABILITY.includes(v as Availability) ? (v as Availability) : "ausente");

/** O próprio estado na distribuição: Disponível recebe conversas novas; Em pausa e Ausente devolvem as que ainda não tiveram resposta. */
export function useAvailability(initial: string) {
  const [state, setState] = useState<Availability>(asAvailability(initial));
  // O servidor manda o estado novo (abrir o CRM liga; o worker marca ausente): acompanha, ajustando no próprio render.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setState(asAvailability(initial)); }
  const [pending, start] = useTransition();
  const toast = useToast();
  const change = (a: Availability) => start(async () => {
    const before = state;
    setState(a);
    const r = await setAvailabilityAction(a);
    if (!r.ok) { setState(before); toast(r.error, "error"); return; }
    const volta = r.returned ? ` · ${r.returned} ${r.returned === 1 ? "conversa voltou" : "conversas voltaram"} para a fila` : "";
    toast(`${AVAILABILITY_LABEL[a]}${volta}`, "ok");
  });
  return { state, pending, change };
}

export function AvailabilityDot({ state, className }: { state: Availability; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", DOT[state], className)} />;
}

/** `compact`: menu lateral encolhido, só a bolinha do estado (o nome fica no rótulo acessível e na dica). */
export function AvailabilityMenu({ initial, compact = false }: { initial: string; compact?: boolean }) {
  const { state, pending, change } = useAvailability(initial);
  return (
    <Menu label={`Meu estado: ${AVAILABILITY_LABEL[state]}`} up align="left"
      trigger={compact
        ? <span title={`Meu estado: ${AVAILABILITY_LABEL[state]}`} className={cn("grid size-8 place-items-center", pending && "opacity-60")}><AvailabilityDot state={state} className="size-3" /></span>
        : <span className={cn("inline-flex items-center gap-1.5 text-xs text-graphite", pending && "opacity-60")}><AvailabilityDot state={state} />{AVAILABILITY_LABEL[state]} ▾</span>}
      triggerClassName={compact ? "size-8 hover:bg-paper-3 rounded-[8px]" : "h-7 -ml-1 px-1 hover:bg-paper-3 pointer-coarse:min-h-11"}
      items={AVAILABILITY.map((a) => ({ label: AVAILABILITY_LABEL[a], current: a === state, onSelect: () => change(a) }))} />
  );
}

/** No celular (folha "Mais"): os três estados como botões grandes. */
export function MobileAvailability({ initial }: { initial: string }) {
  const { state, pending, change } = useAvailability(initial);
  return (
    <fieldset className="mt-3 border-t border-line pt-3">
      <legend className="text-xs font-semibold text-muted">Meu estado</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {AVAILABILITY.map((a) => (
          <button key={a} type="button" disabled={pending} aria-pressed={a === state} onClick={() => change(a)}
            className={cn("min-h-11 rounded-[var(--radius-control)] border text-sm font-medium inline-flex items-center justify-center gap-1.5",
              a === state ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control")}>
            <AvailabilityDot state={a} />{AVAILABILITY_LABEL[a]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
