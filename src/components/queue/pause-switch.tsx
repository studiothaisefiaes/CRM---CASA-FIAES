"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pauseAutomationsAction } from "@/app/(app)/atendimento/pause-actions";
import { cn } from "@/lib/cn";

const LABEL = "Pausar automáticas desta cliente";
const BTN = "min-h-9 flex-1 rounded-[10px] border border-line-strong bg-paper text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11";

function untilText(pausedUntil: string): string {
  if (pausedUntil === "sempre") return "Automáticas pausadas até alguém religar.";
  const d = new Date(pausedUntil);
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
  return hora === "00:00" ? `Automáticas pausadas até amanhã (${dia}).` : `Automáticas pausadas até ${dia} às ${hora}.`;
}

/**
 * Interruptor da conversa: enquanto ligado, nada automático sai para esta cliente (menu, regras, lembrete, Depois do atendimento, massa).
 * A mensagem programada à mão continua saindo. Ligar pergunta "Até quando?" antes de gravar; desligar religa na hora.
 * `pausedUntil`: "sempre", uma data (ISO) ou null.
 */
export function PauseSwitch({ contactId, pausedUntil }: { contactId: string; pausedUntil: string | null }) {
  const id = useId();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = pausedUntil !== null;
  const run = (until: "sempre" | "amanha" | null) => start(async () => {
    const r = await pauseAutomationsAction(contactId, until);
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); setAsking(false); router.refresh();
  });
  return (
    <section aria-label="Automáticas pausadas" className="flex flex-col gap-1.5" data-testid="pausa-automaticas">
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-sm font-medium text-ink">{LABEL}</span>
        <button type="button" role="switch" aria-checked={on || asking} aria-labelledby={id} disabled={pending}
          onClick={() => { if (on) run(null); else setAsking((v) => !v); }}
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 pointer-coarse:h-7 pointer-coarse:w-12", on || asking ? "bg-gold-ink" : "bg-paper-3")}>
          <span aria-hidden className={cn("absolute left-0.5 top-0.5 size-5 rounded-full bg-paper shadow transition-transform pointer-coarse:size-6", (on || asking) && "translate-x-5")} />
        </button>
      </div>
      {on && <p className="text-sm text-graphite">{untilText(pausedUntil)}</p>}
      {asking && !on && (
        <div role="group" aria-label="Até quando?" className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-ink">Até quando?</p>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => run("sempre")} className={BTN}>Até eu religar</button>
            <button type="button" disabled={pending} onClick={() => run("amanha")} className={BTN}>Até amanhã</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-alert">{err}</p>}
    </section>
  );
}
