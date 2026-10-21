"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { salvarRelatoriosConfig } from "@/app/(app)/config/relatorios/actions";
import type { RelatoriosConfig } from "@/lib/relatorios-settings";

/** Configurações › Relatórios: "O que os Relatórios mostram?" Liga/desliga cada vista opcional. */
export function RelatoriosSettingsForm({ config }: { config: RelatoriosConfig }) {
  const [ocupacao, setOcupacao] = useState(config.ocupacao);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const row = "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3";
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">O que os Relatórios mostram?</h2>
      <div className="mt-4 grid gap-2.5">
        <div className={row}>
          <span className="text-sm">Ocupação (mapa de calor e ocupação por profissional)<span className="block text-xs text-muted">Desligado: a vista Ocupação some de Relatórios › Salão e fica só o Resumo.</span></span>
          <Switch checked={ocupacao} label="Ocupação (mapa de calor e ocupação por profissional)" onChange={setOcupacao} />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
      <div className="mt-5 flex justify-end">
        <Button loading={pending} disabled={ocupacao === config.ocupacao} onClick={() => start(async () => {
          const r = await salvarRelatoriosConfig({ ocupacao });
          setError(r.ok ? null : r.error);
          toast(r.ok ? "Relatórios salvo" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</Button>
      </div>
    </section>
  );
}
