"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Área de cuidado: dá para ver como está, mas mexer só depois de "Quero mexer aqui" e "Sim, liberar" (confirmação em duas etapas). Enquanto trava, o formulário fica `inert`
 * (nem clique nem teclado chegam nele). O formulário de dentro é o de sempre; aqui só a trava.
 */
export function DangerGate({ risk, children }: { risk: string; children: ReactNode }) {
  const [step, setStep] = useState<"travado" | "pergunta" | "liberado">("travado");
  const open = step === "liberado";
  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="rounded-[var(--radius-card)] border border-alert/30 bg-alert-soft/60 px-4 py-3.5">
        <p className="text-sm font-semibold text-ink">Mexer aqui pode parar o atendimento.</p>
        <p className="mt-0.5 text-sm text-ink-2">{risk}</p>
        {open ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-alert" role="status">Liberado para mudar.</p>
            <Button size="sm" variant="secondary" onClick={() => setStep("travado")}>Travar de novo</Button>
          </div>
        ) : step === "pergunta" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="w-full text-sm font-medium text-ink">Tem certeza? Mexer aqui pode parar o atendimento.</p>
            <Button size="sm" variant="danger" onClick={() => setStep("liberado")}>Sim, liberar</Button>
            <Button size="sm" variant="secondary" onClick={() => setStep("travado")}>Não</Button>
          </div>
        ) : (
          <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => setStep("pergunta")}>Quero mexer aqui</Button></div>
        )}
      </div>
      <div inert={!open} aria-disabled={!open} data-travado={!open || undefined} className={open ? undefined : "cursor-not-allowed select-none grayscale"}>{children}</div>
    </div>
  );
}
