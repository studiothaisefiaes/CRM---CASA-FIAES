"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { desfazerPagamento, salvarCategoria, salvarConta, salvarContaPorForma } from "@/app/(app)/relatorios/financeiro-actions";
import type { BankAccount, FinanceCategory } from "@/server/db/schema";
import type { ExpenseRow } from "@/server/domain/financeiro/despesas";
import { expenseStatusLabel, type ExpenseStatus } from "@/lib/expense-status";
import { DRE_EXPENSE_GROUPS, DRE_LABEL } from "@/lib/dre";
import { PAY_LABEL, PAY_METHODS, type PayMethod } from "@/lib/comanda-math";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";
import { brDay } from "@/lib/salon-period";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DataList, type Col } from "./data-list";
import { Fig } from "./fig";
import { Muted, Section } from "./section";
import { CancelSheet, ExpenseSheet, PaySheet } from "./expense-sheet";

export type ContasCan = { lancar: boolean; pagar: boolean; cancelar: boolean; cadastros: boolean };
const STATUSES: ExpenseStatus[] = ["atrasada", "vence_7d", "em_aberto", "paga"];
/** Formas que recebem dinheiro de verdade (cortesia e crédito da cliente não caem em conta). */
const FORMAS = PAY_METHODS.filter((m) => m !== "cortesia" && m !== "credito_cliente");
const sum = (rows: ExpenseRow[], pick: (r: ExpenseRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
const small = "inline-flex items-center min-h-11 lg:min-h-8 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm font-medium hover:bg-paper-2";

/**
 * Relatórios › Financeiro › Contas a pagar: "O que a Casa tem para pagar?". Cada botão aparece só com a permissão dele;
 * o servidor confere de novo em cada ação.
 */
export function ContasAPagar({ rows, categories, accounts, methodAccounts = {}, can, venceEmDias, repetirMaxMeses = 24, today }: {
  rows: ExpenseRow[]; categories: FinanceCategory[]; accounts: BankAccount[]; methodAccounts?: Partial<Record<PayMethod, string>>;
  can: ContasCan; venceEmDias: number; repetirMaxMeses?: number; today: string;
}) {
  const [filter, setFilter] = useState<ExpenseStatus | "todas">("todas");
  const [sheet, setSheet] = useState<"lancar" | null>(null);
  const [paying, setPaying] = useState<ExpenseRow | null>(null);
  const [cancelling, setCancelling] = useState<ExpenseRow | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast(); const router = useRouter();
  const shown = filter === "todas" ? rows : rows.filter((r) => r.status === filter);
  const aPagar = sum(rows.filter((r) => r.status !== "paga"), (r) => r.amountCents);
  const atrasadas = sum(rows.filter((r) => r.status === "atrasada"), (r) => r.amountCents);
  const pagas = sum(rows.filter((r) => r.status === "paga"), (r) => r.paidCents ?? r.amountCents);
  const undo = (r: ExpenseRow) => start(async () => {
    const res = await desfazerPagamento(r.id);
    if (!res.ok) { setError(res.error); return; }
    setError(null); toast("Pagamento desfeito"); router.refresh();
  });
  const cols: Col<ExpenseRow>[] = [
    { key: "v", label: "Vencimento", render: (r) => brDay(r.dueOn) },
    { key: "t", label: "Despesa", render: (r) => (r.installments > 1 ? `${r.title} (${r.installment}/${r.installments})` : r.title) },
    { key: "c", label: "Categoria", render: (r) => r.categoryName },
    { key: "f", label: "Fornecedor", render: (r) => r.supplier ?? "—" },
    { key: "m", label: "Valor", align: "right", render: (r) => money(r.amountCents) },
    { key: "s", label: "Situação", render: (r) => <span className={r.status === "atrasada" ? "text-alert font-medium" : r.status === "paga" ? "text-muted" : ""}>{expenseStatusLabel(r.status, venceEmDias)}{r.paidOn ? ` em ${brDay(r.paidOn)}` : ""}</span> },
    { key: "a", label: "Ação", render: (r) => (
      <span className="flex flex-wrap gap-1.5">
        {can.pagar && r.status !== "paga" && <button type="button" className={small} aria-label={`Pagar ${r.title}`} onClick={() => setPaying(r)}>Pagar</button>}
        {can.pagar && r.status === "paga" && <button type="button" className={small} aria-label={`Desfazer pagamento de ${r.title}`} disabled={pending} onClick={() => undo(r)}>Desfazer</button>}
        {can.cancelar && r.status !== "paga" && <button type="button" className={small} aria-label={`Cancelar ${r.title}`} onClick={() => setCancelling(r)}>Cancelar</button>}
      </span>
    ) },
  ];
  return (
    <div className="flex flex-col gap-10">
      <Section id="fin-contas" title="O que a Casa tem para pagar?" lead="Despesas com vencimento no período." legend="finContas">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <Fig label="A pagar no período" value={money(aPagar)} />
          <Fig label="Atrasadas" value={money(atrasadas)} />
          <Fig label="Pagas no período" value={money(pagas)} />
        </dl>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Situação">
            {(["todas", ...STATUSES] as const).map((s) => (
              <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
                className={cn("min-h-11 lg:min-h-8 rounded-full border px-3 text-sm font-medium transition-colors", filter === s ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>
                {s === "todas" ? "Todas" : expenseStatusLabel(s, venceEmDias)}
              </button>
            ))}
          </div>
          {can.lancar && <Button onClick={() => setSheet("lancar")}>Lançar despesa</Button>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-alert">{error}</p>}
        <div className="mt-4">{shown.length === 0 ? <Muted>Nenhuma despesa no período.</Muted> : <DataList rows={shown} cols={cols} rowKey={(r) => r.id} caption="Despesas do período" />}</div>
      </Section>
      {can.cadastros && <Cadastros categories={categories} accounts={accounts} methodAccounts={methodAccounts} />}
      {can.lancar && <ExpenseSheet open={sheet === "lancar"} onClose={() => setSheet(null)} categories={categories} accounts={accounts} repetirMaxMeses={repetirMaxMeses} />}
      <PaySheet row={paying} onClose={() => setPaying(null)} accounts={accounts} today={today} />
      <CancelSheet row={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

type SaveResult = { ok: true } | { ok: false; error: string };
/** Uma linha editável que salva sozinha; mostra a frase de erro do servidor. */
function EditRow({ children, onSave, button, label }: { children: React.ReactNode; onSave: () => Promise<SaveResult>; button: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast(); const router = useRouter();
  return (
    <li className="py-3 border-t border-line">
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <Button size="sm" variant="secondary" loading={pending} aria-label={label} onClick={() => start(async () => {
          const r = await onSave();
          if (!r.ok) { setError(r.error); return; }
          setError(null); toast("Salvo"); router.refresh();
        })}>{button}</Button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-sm text-alert">{error}</p>}
    </li>
  );
}

function CategoriaRow({ c }: { c?: FinanceCategory }) {
  const [name, setName] = useState(c?.name ?? "");
  const [group, setGroup] = useState<string>(c?.dreGroup ?? "outras");
  const [active, setActive] = useState(c?.active ?? true);
  return (
    <EditRow button={c ? "Salvar" : "Adicionar"} label={c ? `Salvar categoria ${c.name}` : "Adicionar categoria"}
      onSave={async () => { const r = await salvarCategoria({ id: c?.id, name, dreGroup: group, active }); if (r.ok && !c) setName(""); return r; }}>
      <label className="flex flex-col gap-1 text-sm text-graphite">{c ? "Categoria" : "Nova categoria"}<Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="w-56" /></label>
      <label className="flex flex-col gap-1 text-sm text-graphite">Linha do Resultado<Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-48">{DRE_EXPENSE_GROUPS.map((g) => <option key={g} value={g}>{DRE_LABEL[g]}</option>)}</Select></label>
      {c && <Switch checked={active} label={`Categoria ${c.name} ativa`} onChange={setActive} />}
    </EditRow>
  );
}

function ContaRow({ a }: { a?: BankAccount }) {
  const [name, setName] = useState(a?.name ?? "");
  const [bank, setBank] = useState(a?.bank ?? "");
  const [opening, setOpening] = useState(moneyInputValue(a?.openingCents ?? 0));
  const [active, setActive] = useState(a?.active ?? true);
  return (
    <EditRow button={a ? "Salvar" : "Adicionar"} label={a ? `Salvar conta ${a.name}` : "Adicionar conta"}
      onSave={async () => {
        const openingCents = parseMoneyInput(opening);
        if (openingCents == null) return { ok: false as const, error: "Digite o saldo inicial da conta (pode ser zero)." };
        const r = await salvarConta({ id: a?.id, name, bank: bank || null, openingCents, active });
        if (r.ok && !a) { setName(""); setBank(""); setOpening("0,00"); }
        return r;
      }}>
      <label className="flex flex-col gap-1 text-sm text-graphite">{a ? "Conta" : "Nova conta"}<Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="w-48" /></label>
      <label className="flex flex-col gap-1 text-sm text-graphite">Banco<Input value={bank} maxLength={120} onChange={(e) => setBank(e.target.value)} className="w-40" /></label>
      <label className="flex flex-col gap-1 text-sm text-graphite">Saldo inicial (R$)<Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="w-32" /></label>
      {a && <Switch checked={active} label={`Conta ${a.name} ativa`} onChange={setActive} />}
    </EditRow>
  );
}

function Cadastros({ categories, accounts, methodAccounts }: { categories: FinanceCategory[]; accounts: BankAccount[]; methodAccounts: Partial<Record<PayMethod, string>> }) {
  const [map, setMap] = useState<Partial<Record<PayMethod, string>>>(methodAccounts);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast(); const router = useRouter();
  return (
    <Section id="fin-cadastros" title="Categorias e contas" lead="Para onde vai cada despesa e de onde ela sai." legend="finCadastros">
      <div className="grid gap-8">
        <div>
          <h3 className="text-sm font-medium text-graphite">Categorias</h3>
          <ul>{categories.map((c) => <CategoriaRow key={`${c.id}:${c.name}:${c.dreGroup}:${c.active}`} c={c} />)}<CategoriaRow /></ul>
        </div>
        <div>
          <h3 className="text-sm font-medium text-graphite">Contas bancárias</h3>
          <ul>{accounts.map((a) => <ContaRow key={`${a.id}:${a.name}:${a.openingCents}:${a.active}`} a={a} />)}<ContaRow /></ul>
        </div>
        <div>
          <h3 className="text-sm font-medium text-graphite">Em qual conta cai cada forma de pagamento</h3>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FORMAS.map((m) => (
              <label key={m} className="flex flex-col gap-1 text-sm text-graphite" htmlFor={`forma-${m}`}>
                <span>Conta do {PAY_LABEL[m]}</span>
                <Select id={`forma-${m}`} aria-label={`Conta do ${PAY_LABEL[m]}`} value={map[m] ?? ""} onChange={(e) => setMap((x) => ({ ...x, [m]: e.target.value || undefined }))}>
                  <option value="">Sem conta definida</option>{accounts.filter((a) => a.active || a.id === map[m]).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </label>
            ))}
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-alert">{error}</p>}
          <div className="mt-3"><Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => {
            const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v)) as Partial<Record<PayMethod, string>>;
            const r = await salvarContaPorForma(clean);
            if (!r.ok) { setError(r.error); return; }
            setError(null); toast("Contas por forma salvas"); router.refresh();
          })}>Salvar contas por forma</Button></div>
        </div>
      </div>
    </Section>
  );
}
