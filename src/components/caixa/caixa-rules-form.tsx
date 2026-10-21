"use client";
import { useId, useState, useTransition } from "react";
import { SaveButton } from "@/components/ui/save-button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveCaixaRulesAction } from "@/app/(app)/caixa/actions";
import type { CaixaRules } from "@/lib/caixa-settings";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";
import { bpToPercent, percentToBp } from "@/lib/comanda-math";

/**
 * Regras do caixa (gestão): tolerância da diferença, contagem cega, a partir de quanto a sangria vai para a auditoria e o limite opcional
 * de cortesia e desconto que pede a gestão (QA r58, I-11; desligado por padrão: todos podem, sempre com motivo).
 */
export function CaixaRulesForm({ rules }: { rules: CaixaRules }) {
  const id = useId();
  const [tol, setTol] = useState(moneyInputValue(rules.toleranciaCents));
  const [cega, setCega] = useState(rules.contagemCega);
  const [grande, setGrande] = useState(moneyInputValue(rules.sangriaGrandeCents));
  const [limitOn, setLimitOn] = useState(rules.aprovacaoDescontoBp != null);
  const [limit, setLimit] = useState(bpToPercent(rules.aprovacaoDescontoBp));
  const [notaPadrao, setNotaPadrao] = useState(rules.notaPadrao);
  const [pending, start] = useTransition();
  const toast = useToast();
  const tolC = parseMoneyInput(tol || "0"), grandeC = parseMoneyInput(grande || "0");
  const limitBp = limitOn ? percentToBp(limit) : null;
  const limitBad = limitOn && (limitBp == null || limitBp < 100);
  const changed = tolC !== rules.toleranciaCents || cega !== rules.contagemCega || grandeC !== rules.sangriaGrandeCents || notaPadrao !== rules.notaPadrao || (!limitBad && limitBp !== rules.aprovacaoDescontoBp);
  return (
    <section aria-label="Regras do fechamento" className="max-w-2xl rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">Regras do fechamento</h2>
      {/* Padrão da nota (psico r68 #3): a Casa decide uma vez; a recepção só escolhe em cada comanda com "Perguntar". */}
      <div className="mt-4 flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-line px-4 py-3">
        <label htmlFor={`${id}-nota`} className="text-sm font-medium text-ink">Padrão da nota</label>
        <select id={`${id}-nota`} value={notaPadrao} onChange={(e) => setNotaPadrao(e.target.value as typeof notaPadrao)} className="h-11 max-w-xs rounded-[var(--radius-control)] border border-line-strong bg-paper px-3">
          <option value="perguntar">Perguntar a cada comanda</option><option value="nao">Não emitir</option><option value="sem_cpf">Emitir sem CPF</option>
        </select>
        <span className="text-xs text-muted">Vale para toda comanda nova, já marcado. A recepção ainda pode trocar numa comanda (por exemplo, para pôr o CPF). Com “Perguntar”, ela escolhe em cada uma antes de receber.</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-graphite">Tolerância da diferença (R$)
          <Input inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} className="h-11" />
          <span className="text-xs text-muted">Acima disso, para mais ou para menos, a gestão aprova o fechamento.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Sangria grande a partir de (R$)
          <Input inputMode="decimal" value={grande} onChange={(e) => setGrande(e.target.value)} className="h-11" />
          <span className="text-xs text-muted">Aparece nas exceções do Financeiro.</span>
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
        <span className="text-sm">Contar sem ver o valor esperado<span className="block text-xs text-muted">Quem conta o caixa não vê quanto deveria ter antes de fechar. A gestão sempre vê.</span></span>
        <Switch checked={cega} label="Contar sem ver o valor esperado" onChange={setCega} />
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Pedir a gestão para cortesia ou desconto alto
            <span className="block text-xs text-muted">Todos podem mudar preço, dar desconto e cortesia, sempre com motivo. Ligado, acima do limite a gestão aprova, como no fechamento.</span></span>
          <Switch checked={limitOn} label="Cortesia ou desconto acima de um limite pede aprovação da gestão" onChange={(v) => { setLimitOn(v); if (v && !limit) setLimit("20"); }} />
        </div>
        {limitOn && (
          <div className="flex max-w-sm flex-col gap-1 text-sm text-graphite">
            <label htmlFor={`${id}-lim`}>Acima de (%)</label>
            <Input id={`${id}-lim`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-11" aria-describedby={`${id}-lim-d`} />
            <span id={`${id}-lim-d`} className={limitBad ? "text-xs text-alert" : "text-xs text-muted"}>{limitBad ? "Use de 1% a 100%." : `Cortesia ou desconto acima de ${limit.trim()}% pede aprovação da gestão.`}</span>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <SaveButton loading={pending} dirty={changed || limitBad} blocked={tolC == null || grandeC == null ? "Confira os valores em reais." : limitBad ? "O limite precisa ser de pelo menos 1%." : null} onClick={() => start(async () => {
          const r = await saveCaixaRulesAction({ toleranciaCents: tolC!, contagemCega: cega, sangriaGrandeCents: grandeC!, aprovacaoDescontoBp: limitBp, notaPadrao });
          toast(r.ok ? "Regras salvas" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</SaveButton>
      </div>
    </section>
  );
}
