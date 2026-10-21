"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { salvarFinanceiroConfig } from "@/app/(app)/config/financeiro/actions";
import { REPETIR_MAX_MESES_LIMITS, VENCE_EM_DIAS_LIMITS, type FinanceiroConfig } from "@/lib/financeiro-settings";

/** Configurações › Financeiro: "Como a Casa controla as contas?" Liga/desliga cada função e os dois números de regra. */
export function FinanceiroSettingsForm({ config }: { config: FinanceiroConfig }) {
  const [on, setOn] = useState(config.contasAPagar);
  const [res, setRes] = useState(config.resultado);
  const [dias, setDias] = useState(String(config.venceEmDias));
  const [meses, setMeses] = useState(String(config.repetirMaxMeses));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const next = { contasAPagar: on, resultado: res, venceEmDias: Number(dias), repetirMaxMeses: Number(meses) };
  const same = next.contasAPagar === config.contasAPagar && next.resultado === config.resultado && next.venceEmDias === config.venceEmDias && next.repetirMaxMeses === config.repetirMaxMeses;
  const row = "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3";
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">Como a Casa controla as contas?</h2>
      <div className="mt-4 grid gap-2.5">
        <div className={row}>
          <span className="text-sm">Contas a pagar<span className="block text-xs text-muted">Desligado: a vista some de Relatórios › Financeiro e não dá para lançar, pagar nem cancelar despesas.</span></span>
          <Switch checked={on} label="Contas a pagar" onChange={setOn} />
        </div>
        <div className={row}>
          <span className="text-sm">Resultado (fluxo de caixa e DRE)<span className="block text-xs text-muted">Desligado: a vista Quanto sobrou no mês? some de Relatórios › Financeiro.</span></span>
          <Switch checked={res} label="Resultado (fluxo de caixa e DRE)" onChange={setRes} />
        </div>
        <label className={row}>
          <span className="text-sm">Avisar vencimento com quantos dias?<span className="block text-xs text-muted">Despesa que vence dentro desse prazo aparece como “Vence em até N dias”. De {VENCE_EM_DIAS_LIMITS.min} a {VENCE_EM_DIAS_LIMITS.max}.</span></span>
          <Input type="number" inputMode="numeric" className="w-24" min={VENCE_EM_DIAS_LIMITS.min} max={VENCE_EM_DIAS_LIMITS.max} value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Avisar vencimento com quantos dias" />
        </label>
        <label className={row}>
          <span className="text-sm">Repetir despesa por até quantos meses?<span className="block text-xs text-muted">O limite do campo “Repetir por” ao lançar uma despesa. De {REPETIR_MAX_MESES_LIMITS.min} a {REPETIR_MAX_MESES_LIMITS.max}.</span></span>
          <Input type="number" inputMode="numeric" className="w-24" min={REPETIR_MAX_MESES_LIMITS.min} max={REPETIR_MAX_MESES_LIMITS.max} value={meses} onChange={(e) => setMeses(e.target.value)} aria-label="Repetir despesa por até quantos meses" />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
      <div className="mt-5 flex justify-end">
        <Button loading={pending} disabled={same} onClick={() => start(async () => {
          const r = await salvarFinanceiroConfig(next);
          setError(r.ok ? null : r.error);
          toast(r.ok ? "Financeiro salvo" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</Button>
      </div>
    </section>
  );
}
