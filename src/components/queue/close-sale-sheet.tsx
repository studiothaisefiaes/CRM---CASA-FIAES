"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { closeSaleAction } from "@/app/(app)/funil/actions";
import { formatBRL, parseBRL } from "@/lib/money";
import { PAYMENT_LABEL } from "@/lib/format";
import { ActionSheet, FieldError, SheetLabel } from "./action-sheet";

type Payment = "pix" | "cartao" | "boleto" | "dinheiro";
const PAYMENTS = (Object.keys(PAYMENT_LABEL) as Payment[]).map((value) => ({ value, label: PAYMENT_LABEL[value] }));
const centsToInput = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, useGrouping: false }));

/**
 * Fechar venda em poucos toques: Fechar venda → forma de pagamento → serviço → Confirmar. O valor já abre com o cursor (teclado numérico) e mostra
 * o total formatado ao vivo; "Pago agora?" vem em "Sim". Uma transação só no servidor; se outra pessoa já fechou (`alreadyClosed`), nada é duplicado.
 * A folha nasce nova a cada abertura (`key` de quem a monta), então os campos começam do zero.
 */
export function CloseSaleSheet({ open, onClose, dealId, name, services, initial, canManage, onDone }: {
  open: boolean; onClose: () => void; dealId: string; name: string;
  services: { id: string; label: string }[];
  initial: { serviceId: string | null; valueCents: number | null; paymentMethod: string | null };
  /** Gestão: o aviso de "nenhum serviço" leva à tela que resolve. */
  canManage: boolean;
  onDone: (r: { alreadyClosed: boolean; valueCents: number }) => void;
}) {
  const [value, setValue] = useState(centsToInput(initial.valueCents));
  const [pay, setPay] = useState<Payment | null>(PAYMENTS.find((p) => p.value === initial.paymentMethod)?.value ?? null);
  const [service, setService] = useState<string | null>(services.some((s) => s.id === initial.serviceId) ? initial.serviceId : null);
  const [paidNow, setPaidNow] = useState<"sim" | "nao">("sim");
  const [errors, setErrors] = useState<{ value?: string; pay?: string; service?: string; form?: string }>({});
  const [pending, start] = useTransition();
  const valueRef = useRef<HTMLInputElement>(null);

  const parsed = value.trim() ? parseBRL(value) : null;
  const live = parsed?.ok ? formatBRL(parsed.cents) : null;

  const confirm = () => {
    const next: typeof errors = {};
    let cents = 0;
    if (!value.trim()) next.value = "Digite o valor da venda, ex.: 1.158,50.";
    else if (!parsed?.ok) next.value = parsed?.error ?? "Valor inválido";
    else cents = parsed.cents;
    if (!pay) next.pay = "Escolha a forma de pagamento.";
    if (!service) next.service = services.length ? "Escolha o serviço." : "Cadastre ao menos um serviço para fechar a venda.";
    setErrors(next);
    if (Object.keys(next).length) { if (next.value) valueRef.current?.focus(); return; }
    start(async () => {
      const r = await closeSaleAction(dealId, { serviceId: service!, valueCents: cents, paymentMethod: pay!, paidNow: paidNow === "sim" });
      if (!r.ok) { setErrors({ form: r.error }); return; }
      onDone({ alreadyClosed: !!r.data?.alreadyClosed, valueCents: cents });
    });
  };

  return (
    <ActionSheet open={open} onClose={onClose} title="Fechar venda" initialFocusRef={valueRef}
      footer={<>
        <Button variant="ghost" size="lg" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button size="lg" onClick={confirm} loading={pending}>Fechar venda</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-graphite">Venda para <b className="font-medium text-ink">{name}</b></p>

        <div>
          <SheetLabel hint={<span aria-live="polite" className={live ? "font-serif text-xl text-ink tabular" : "text-muted"}>{live ?? "R$ 0,00"}</span>}>
            <label htmlFor="venda-valor">Valor</label>
          </SheetLabel>
          <div className="relative">
            <span aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 font-medium text-graphite">R$</span>
            <Input id="venda-valor" ref={valueRef} inputMode="decimal" enterKeyHint="done" autoComplete="off" placeholder="1.158,50" value={value}
              aria-invalid={errors.value ? true : undefined} aria-describedby={errors.value ? "venda-valor-erro" : undefined}
              onChange={(e) => { setValue(e.target.value); setErrors((x) => ({ ...x, value: undefined, form: undefined })); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
              className="h-12 pl-11 text-xl tabular" />
          </div>
          <div id="venda-valor-erro"><FieldError>{errors.value}</FieldError></div>
        </div>

        <div>
          <SheetLabel id="venda-pagamento">Forma de pagamento</SheetLabel>
          <Segmented<Payment> labelledBy="venda-pagamento" options={PAYMENTS} value={pay} onChange={(v) => { setPay(v); setErrors((x) => ({ ...x, pay: undefined, form: undefined })); }} />
          <FieldError>{errors.pay}</FieldError>
        </div>

        <div>
          <SheetLabel id="venda-servico">Serviço</SheetLabel>
          {services.length ? (
            <Segmented labelledBy="venda-servico" options={services.map((s) => ({ value: s.id, label: s.label }))} value={service} onChange={(v) => { setService(v); setErrors((x) => ({ ...x, service: undefined, form: undefined })); }} />
          ) : (
            <p className="text-sm text-graphite">Nenhum serviço cadastrado.{canManage ? <> <Link href="/config/listas" className="font-medium text-ink underline underline-offset-2">Cadastrar serviços</Link></> : " Peça à gestão para cadastrar."}</p>
          )}
          <FieldError>{errors.service}</FieldError>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p id="venda-pago" className="text-sm font-medium text-graphite">Pago agora?</p>
            <p className="text-xs text-muted">Registra o pagamento de hoje.</p>
          </div>
          <Segmented<"sim" | "nao"> labelledBy="venda-pago" options={[{ value: "sim", label: "Sim" }, { value: "nao", label: "Não" }]} value={paidNow} onChange={setPaidNow} className="shrink-0 flex-nowrap" />
        </div>

        <FieldError>{errors.form}</FieldError>
      </div>
    </ActionSheet>
  );
}
