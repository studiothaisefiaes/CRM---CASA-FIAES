"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { saveCommissionRulesAction } from "@/app/(app)/caixa/comissao/actions";
import { DEDUCT_LABEL, type CommissionRules, type DeductMode } from "@/lib/commission-rules";
import { bpToPercent, percentToBp } from "@/lib/comanda-math";

const MODES = (Object.keys(DEDUCT_LABEL) as DeductMode[]).map((value) => ({ value, label: DEDUCT_LABEL[value] }));

/** "Como calcular a comissão" (Fase A, decisões 3, 4 e 6): as regras da Casa no topo da aba Regras. Valem para as comandas fechadas depois. */
export function CommissionHow({ rules, descontosLigados = true }: { rules: CommissionRules; descontosLigados?: boolean }) {
  const [r, setR] = useState(rules);
  const [antecipacao, setAntecipacao] = useState(bpToPercent(rules.antecipacaoBp));
  const [sai, setSai] = useState(bpToPercent(rules.assistenteSaiDaPrincipalBp));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = () => {
    const antecipacaoBp = percentToBp(antecipacao), assistenteSaiDaPrincipalBp = percentToBp(sai);
    if (antecipacaoBp == null || assistenteSaiDaPrincipalBp == null) { toast("Use de 0% a 100%.", "error"); return; }
    start(async () => {
      const res = await saveCommissionRulesAction({ ...r, antecipacaoBp, assistenteSaiDaPrincipalBp });
      if (!res.ok) { toast(res.error, "error"); return; }
      toast("Regras salvas. Valem para as comandas fechadas daqui para a frente.", "ok"); router.refresh();
    });
  };
  const deduct = (key: "cartao" | "antecipacao" | "custo", label: string) => (
    <Question label={label}><Segmented label={label} options={MODES} value={r[key]} onChange={(v) => setR({ ...r, [key]: v })} /></Question>
  );
  return (
    <section aria-label="Como calcular a comissão" className="mb-6 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <h2 className="font-semibold">Como calcular a comissão</h2>
      <p className="mb-3 text-sm text-muted">Vale para as comandas fechadas daqui para a frente. O que já fechou não muda.</p>
      {!descontosLigados && (
        <p role="status" className="mb-3 rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">
          A comissão com taxa, antecipação e custo está desligada em <Link href="/config/caixa" className="underline">Configurações › Caixa</Link>. Você pode ajustar aqui; só vale quando ligar.
        </p>
      )}
      <div className="flex flex-col gap-4">
        {deduct("cartao", "Taxa do cartão")}
        <div className="flex flex-col gap-2">
          {deduct("antecipacao", `Antecipação (${bpToPercent(percentToBp(antecipacao) ?? r.antecipacaoBp)}%)`)}
          <label className="flex items-center gap-2 text-sm text-graphite">Taxa de antecipação (%)
            <Input inputMode="decimal" value={antecipacao} onChange={(e) => setAntecipacao(e.target.value)} className="h-9 w-20 text-right" />
          </label>
        </div>
        {deduct("custo", "Custo do serviço")}
        <Question label="Duas assistentes">
          <Segmented label="Duas assistentes" options={[{ value: "total", label: "Sobre o total" }, { value: "metade", label: "Metade" }]} value={r.doisAssistentes} onChange={(v) => setR({ ...r, doisAssistentes: v })} />
        </Question>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Quanto da assistente sai da principal
          <span className="flex items-center gap-2 font-normal"><Input aria-label="Quanto da assistente sai da principal" inputMode="decimal" value={sai} onChange={(e) => setSai(e.target.value)} className="h-9 w-20 text-right" />%</span>
        </label>
        <Question label="Comissão de comanda com dívida">
          <Segmented label="Comissão de comanda com dívida" options={[{ value: "agora", label: "Na hora" }, { value: "quitacao", label: "Quando ela pagar" }]} value={r.divida} onChange={(v) => setR({ ...r, divida: v })} />
        </Question>
      </div>
      <div className="mt-4"><Button onClick={save} loading={pending}>Salvar regras</Button></div>
    </section>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><p className="text-sm font-medium text-graphite">{label}</p>{children}</div>;
}
