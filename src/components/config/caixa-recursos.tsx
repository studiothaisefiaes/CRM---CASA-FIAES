"use client";
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveCaixaRecursosAction } from "@/app/(app)/caixa/actions";
import { RECIBO_TEXTO_MAX, RECIBO_TEXTO_SUGERIDO, RECIBO_VARIAVEIS, RECURSO_HELP, RECURSO_KEYS, RECURSO_LABEL, type CaixaRecursos } from "@/lib/caixa-recursos";

/** Configurações › Caixa › "O que o caixa usa": liga/desliga de cada funcionalidade da Fase A, os limites, o corte do A pagar e o texto do recibo da comissão. */
export function CaixaRecursosForm({ value }: { value: CaixaRecursos }) {
  const [v, setV] = useState(value);
  const [nums, setNums] = useState({ assistentesMax: String(value.assistentesMax), valeSenhaTentativas: String(value.valeSenhaTentativas), valeSenhaJanelaMin: String(value.valeSenhaJanelaMin) });
  const [pending, start] = useTransition();
  const toast = useToast();
  const id = useId();
  const num = (k: keyof typeof nums, label: string, hint: string) => (
    <Field label={label} hint={hint} htmlFor={`${id}-${k}`}>
      <Input id={`${id}-${k}`} type="number" inputMode="numeric" value={nums[k]} onChange={(e) => setNums((n) => ({ ...n, [k]: e.target.value }))} />
    </Field>
  );
  const save = () => start(async () => {
    const r = await saveCaixaRecursosAction({ ...v, assistentesMax: Number(nums.assistentesMax), valeSenhaTentativas: Number(nums.valeSenhaTentativas), valeSenhaJanelaMin: Number(nums.valeSenhaJanelaMin) });
    toast(r.ok ? "Caixa salvo" : r.error, r.ok ? "ok" : "error");
  });
  return (
    <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-paper p-5">
      <h2 className="text-lg font-semibold">O que o caixa usa</h2>
      <div className="mt-4 grid gap-2.5">
        {RECURSO_KEYS.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
            <span className="text-sm">{RECURSO_LABEL[k]}<span className="block text-xs text-muted">{RECURSO_HELP[k]}</span></span>
            <Switch checked={v[k]} label={RECURSO_LABEL[k]} onChange={(on) => setV((x) => ({ ...x, [k]: on }))} />
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {num("assistentesMax", "Assistentes por serviço", "De 1 a 20.")}
        {num("valeSenhaTentativas", "Tentativas de senha do vale", "De 1 a 20.")}
        {num("valeSenhaJanelaMin", "Minutos de espera", "De 1 a 120.")}
      </div>
      <div className="mt-5 sm:max-w-xs">
        <Field label="Pagar comissão a partir de" htmlFor={`${id}-desde`} hint="Comandas antes desta data não entram no A pagar, para não pagar de novo o que já foi pago fora do CRM.">
          <Input id={`${id}-desde`} type="date" value={v.pagarComissaoDesde ?? ""} onChange={(e) => setV((x) => ({ ...x, pagarComissaoDesde: e.target.value || null }))} />
        </Field>
      </div>
      <div className="mt-5">
        <Field label="Texto do recibo" htmlFor={`${id}-recibo`} hint={`Use ${RECIBO_VARIAVEIS.map((n) => `{${n}}`).join(" ")}.`}>
          <Textarea id={`${id}-recibo`} className="min-h-24" maxLength={RECIBO_TEXTO_MAX} value={v.reciboTexto} onChange={(e) => setV((x) => ({ ...x, reciboTexto: e.target.value }))} />
        </Field>
        <Button variant="ghost" className="mt-2" onClick={() => setV((x) => ({ ...x, reciboTexto: RECIBO_TEXTO_SUGERIDO }))}>Usar o texto sugerido</Button>
      </div>
      <p className="mt-4 flex flex-wrap gap-4 text-sm">
        <Link href="/servicos?aba=formas" className="font-medium text-gold-ink hover:underline">Taxas do cartão</Link>
        <Link href="/caixa/comissao?aba=regras" className="font-medium text-gold-ink hover:underline">Como calcular a comissão</Link>
      </p>
      <div className="mt-5 flex justify-end"><Button loading={pending} onClick={save}>Salvar</Button></div>
    </section>
  );
}
