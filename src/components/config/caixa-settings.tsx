"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveCaixaSettingsAction } from "@/app/(app)/caixa/actions";
import type { CaixaMode } from "@/lib/caixa-settings";
import { cn } from "@/lib/cn";

const MODES: { value: CaixaMode; title: string; text: string }[] = [
  { value: "avec", title: "No Avec (como hoje)", text: "A comanda e o caixa do CRM ficam desligados. Pacotes à venda e comissão já podem ser preparados." },
  { value: "crm", title: "No CRM", text: "A recepção abre a comanda pelo horário, recebe e finaliza no CRM. Não lance a mesma venda no Avec, senão os relatórios dobram." },
];

/** Configurações › Caixa (3.1): onde a Casa recebe e se fechar comanda exige o caixa aberto (7.9: por padrão, não exige). */
/** `parts` mostra só um lado (F5: onde a Casa recebe fica na Área de cuidado; o resto em Agenda e caixa); o que não aparece é salvo como está. */
export function CaixaSettingsForm({ mode, exigeCaixaAberto, parts = "tudo" }: { mode: CaixaMode; exigeCaixaAberto: boolean; parts?: "tudo" | "modo" | "regras" }) {
  const [m, setM] = useState(mode);
  const [exige, setExige] = useState(exigeCaixaAberto);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
      {parts !== "regras" && <>
      <h2 className="text-lg font-semibold">Onde a Casa recebe</h2>
      <fieldset className="mt-4 grid gap-2.5">
        <legend className="sr-only">Modo do caixa</legend>
        {MODES.map((o) => (
          <label key={o.value} className={cn("flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3", m === o.value ? "border-ink bg-paper-2/70" : "border-line-strong hover:bg-paper-2/50")}>
            <input type="radio" name="caixa-modo" value={o.value} checked={m === o.value} onChange={() => setM(o.value)} aria-label={`${o.title}. ${o.text}`} className="mt-1" />
            <span><span className="font-medium">{o.title}</span><span className="block text-sm text-graphite">{o.text}</span></span>
          </label>
        ))}
      </fieldset>
      </>}
      {parts !== "modo" && <>
      <div className={cn("flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3", parts !== "regras" && "mt-4")}>
        <span className="text-sm">Exigir caixa aberto para fechar comanda<span className="block text-xs text-muted">Desligado: o caixa do dia é só para conferir o dinheiro, quando a Casa quiser.</span></span>
        <Switch checked={exige} label="Exigir caixa aberto para fechar comanda" onChange={setExige} />
      </div>
      <p className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href="/servicos?aba=pacotes" className="font-medium text-gold-ink hover:underline">Pacotes à venda</Link>
        <Link href="/caixa/comissao?aba=regras" className="font-medium text-gold-ink hover:underline">Regras de comissão</Link>
      </p>
      </>}
      <div className="mt-5 flex justify-end">
        <Button loading={pending} disabled={m === mode && exige === exigeCaixaAberto} onClick={() => start(async () => {
          const r = await saveCaixaSettingsAction({ mode: m, exigeCaixaAberto: exige });
          toast(r.ok ? "Caixa salvo" : r.error, r.ok ? "ok" : "error");
        })}>Salvar</Button>
      </div>
    </section>
  );
}
