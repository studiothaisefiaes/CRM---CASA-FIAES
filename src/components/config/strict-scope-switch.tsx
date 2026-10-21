"use client";
import { useState, useTransition } from "react";
import { setStrictScopeAction } from "@/app/(app)/config/actions";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";

/**
 * Configurações › Equipe › Perfis: "Atendente só mexe nas próprias conversas e nas sem dono" (nasce desligada).
 * Ligada, quem não tem "Ver conversas de todas" não abre nem age na conversa de uma colega (a não ser que a chamem: menção, tarefa ou oferta).
 */
export function StrictScopeSwitch({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const toast = useToast();
  const change = (v: boolean) => start(async () => {
    const r = await setStrictScopeAction(v);
    if (!r.ok) { toast(r.error, "error"); return; }
    setOn(v);
    toast(v ? "Ligado: a atendente só mexe nas próprias conversas e nas sem dono." : "Desligado: a equipe mexe em qualquer conversa.", "ok");
  });
  return (
    <section aria-labelledby="escopo-estrito" className="mb-6 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="escopo-estrito" className="text-lg font-semibold">Atendente só mexe nas próprias conversas e nas sem dono</h2>
          <p className="mt-1 text-sm text-graphite">
            Vale para quem não tem &quot;Ver conversas de todas&quot;. Ligado, ela não abre nem responde a conversa de uma colega pela Agenda ou pela
            ficha, a não ser que a chamem nela (menção, combinado ou oferta da distribuição). Desligado, a equipe passa conversas de uma para a outra à vontade.
          </p>
          <p className="mt-1 text-sm font-medium text-ink">{on ? "Ligado" : "Desligado"}</p>
        </div>
        <Switch checked={on} onChange={change} label="Atendente só mexe nas próprias conversas e nas sem dono" disabled={pending} />
      </div>
    </section>
  );
}
