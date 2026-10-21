"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionSheet } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cancelarDespesa, lancarDespesa, pagarDespesa } from "@/app/(app)/relatorios/financeiro-actions";
import type { BankAccount, FinanceCategory } from "@/server/db/schema";
import type { ExpenseRow } from "@/server/domain/financeiro/despesas";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";
import { PAY_LABEL, type PayMethod } from "@/lib/comanda-math";

const label = "flex flex-col gap-1 text-sm text-graphite";
/** Formas que servem para pagar uma despesa (cortesia e crédito da cliente não pagam conta). */
export const EXPENSE_PAY_METHODS: { value: string; label: string }[] = [
  ...(["pix", "dinheiro", "debito", "credito", "outra"] as PayMethod[]).map((m) => ({ value: m, label: PAY_LABEL[m] })),
  { value: "boleto", label: "Boleto" }, { value: "transferencia", label: "Transferência" },
];

function useSubmit(onClose: () => void, done: string) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const submit = (fn: () => Promise<{ ok: boolean; error?: string } | string>) => start(async () => {
    const r = await fn();
    if (typeof r === "string") { setError(r); return; }
    if (!r.ok) { setError(r.error ?? "Não deu certo. Tente de novo."); return; }
    toast(done); onClose(); router.refresh();
  });
  return { error, pending, submit, setError };
}

/** "Lançar despesa": avulsa ou repetida por vários meses. */
export function ExpenseSheet({ open, onClose, categories, accounts, repetirMaxMeses }: { open: boolean; onClose: () => void; categories: FinanceCategory[]; accounts: BankAccount[]; repetirMaxMeses: number }) {
  const [f, setF] = useState({ title: "", categoryId: "", supplier: "", value: "", dueOn: "", repeat: "1", bankAccountId: "", notes: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { error, pending, submit, setError } = useSubmit(onClose, "Despesa lançada");
  const go = () => submit(async () => {
    const amountCents = parseMoneyInput(f.value);
    if (!amountCents) return "Digite o valor da despesa.";
    return lancarDespesa({ title: f.title, categoryId: f.categoryId, supplier: f.supplier || null, amountCents, dueOn: f.dueOn, repeatMonths: Number(f.repeat) || 1, bankAccountId: f.bankAccountId || null, notes: f.notes || null });
  });
  return (
    <ActionSheet open={open} onClose={() => { setError(null); onClose(); }} title="Lançar despesa" footer={<Button loading={pending} onClick={go}>Lançar</Button>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        <label className={label}>Despesa<Input value={f.title} maxLength={200} onChange={set("title")} placeholder="ex.: Aluguel da loja" /></label>
        <label className={label}>Categoria
          <Select value={f.categoryId} onChange={set("categoryId")}><option value="">Escolha</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </label>
        <label className={label}>Fornecedor<Input value={f.supplier} maxLength={200} onChange={set("supplier")} /></label>
        <label className={label}>Valor (R$)<Input inputMode="decimal" value={f.value} onChange={set("value")} /></label>
        <label className={label}>Vencimento<Input type="date" value={f.dueOn} onChange={set("dueOn")} /></label>
        <label className={label}>Repetir por (meses)<Input type="number" inputMode="numeric" min={1} max={repetirMaxMeses} value={f.repeat} onChange={set("repeat")} /></label>
        <label className={label}>Conta<Select value={f.bankAccountId} onChange={set("bankAccountId")}><option value="">Sem conta definida</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
        <label className={label}>Observação<Textarea value={f.notes} maxLength={1000} onChange={set("notes")} /></label>
      </div>
    </ActionSheet>
  );
}

/** "Pagar": data, valor, conta e forma. */
export function PaySheet({ row, onClose, accounts, today }: { row: ExpenseRow | null; onClose: () => void; accounts: BankAccount[]; today: string }) {
  return <ActionSheet open={!!row} onClose={onClose} title={row ? `Pagar ${row.title}` : "Pagar"} footer={null}>{row && <PayForm key={row.id} row={row} onClose={onClose} accounts={accounts} today={today} />}</ActionSheet>;
}
function PayForm({ row, onClose, accounts, today }: { row: ExpenseRow; onClose: () => void; accounts: BankAccount[]; today: string }) {
  const [f, setF] = useState({ paidOn: today, value: moneyInputValue(row.amountCents), bankAccountId: row.bankAccountId ?? "", method: "pix" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { error, pending, submit } = useSubmit(onClose, "Pagamento registrado");
  const go = () => submit(async () => {
    const paidCents = parseMoneyInput(f.value);
    if (!paidCents) return "Digite o valor pago.";
    return pagarDespesa(row.id, { paidOn: f.paidOn, paidCents, bankAccountId: f.bankAccountId || null, method: f.method });
  });
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      <label className={label}>Data do pagamento<Input type="date" value={f.paidOn} onChange={set("paidOn")} /></label>
      <label className={label}>Valor pago (R$)<Input inputMode="decimal" value={f.value} onChange={set("value")} /></label>
      <label className={label}>Conta<Select value={f.bankAccountId} onChange={set("bankAccountId")}><option value="">Sem conta definida</option>{accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
      <label className={label}>Forma de pagamento<Select value={f.method} onChange={set("method")}>{EXPENSE_PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select></label>
      <div className="flex justify-end"><Button loading={pending} onClick={go}>Registrar pagamento</Button></div>
    </div>
  );
}

/** "Cancelar despesa": sempre com motivo; parcela de série pergunta se vale para as próximas. */
export function CancelSheet({ row, onClose }: { row: ExpenseRow | null; onClose: () => void }) {
  return <ActionSheet open={!!row} onClose={onClose} title={row ? `Cancelar ${row.title}` : "Cancelar"} footer={null}>{row && <CancelForm key={row.id} row={row} onClose={onClose} />}</ActionSheet>;
}
function CancelForm({ row, onClose }: { row: ExpenseRow; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"esta" | "proximas">("esta");
  const { error, pending, submit } = useSubmit(onClose, "Despesa cancelada");
  const serie = !!row.seriesId && row.installments > 1;
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {serie && (
        <fieldset className="grid gap-2">
          <legend className="sr-only">O que cancelar</legend>
          {([["esta", "Só esta parcela"], ["proximas", "Esta e as próximas parcelas não pagas"]] as const).map(([v, t]) => (
            <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name="cancel-scope" checked={scope === v} onChange={() => setScope(v)} aria-label={t} />{t}</label>
          ))}
        </fieldset>
      )}
      <label className={label}>Motivo<Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="ex.: contrato encerrado" /></label>
      <div className="flex justify-end"><Button variant="danger" loading={pending} onClick={() => submit(() => cancelarDespesa(row.id, { reason, scope: serie ? scope : "esta" }))}>Cancelar despesa</Button></div>
    </div>
  );
}
