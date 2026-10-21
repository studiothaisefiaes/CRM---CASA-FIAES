"use client";
import { useState, useTransition } from "react";
import { setSuggestedReturnAction } from "@/app/(app)/config/actions";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

/** Liga e desliga o Retorno sugerido automático (nasce desligado). Diz em uma frase o que acontece e que nada é enviado. */
export function SuggestedReturnSwitch({ initial }: { initial: { ativo: boolean; maxPorDia: number } }) {
  const [on, setOn] = useState(initial.ativo);
  const [pending, start] = useTransition();
  const toast = useToast();
  const change = (v: boolean) => start(async () => {
    const r = await setSuggestedReturnAction(v);
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(v);
    toast(v ? "Hora de voltar automática ligada: no próximo dia de expediente, às 8h, entram as clientes do dia." : "Hora de voltar automática desligada.", "ok");
  });
  return (
    <section aria-labelledby="retorno-sugerido" className="mb-6 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="retorno-sugerido" className="text-lg font-semibold">Hora de voltar automática</h2>
          <p className="mt-1 text-sm text-graphite">
            Todo dia de expediente, às 8h, a cliente cuja volta prevista chegou entra na etapa Hora de voltar com o combinado
            &quot;Chamar para voltar&quot; (até {initial.maxPorDia} por dia). Só quem conversou com a Casa pelo WhatsApp no último ano,
            sem horário marcado e sem conversa aberta. Nada é enviado para a cliente.
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{on ? "Ligada" : "Desligada"}</p>
        </div>
        <Switch checked={on} onChange={change} label="Hora de voltar automática" disabled={pending} />
      </div>
    </section>
  );
}
