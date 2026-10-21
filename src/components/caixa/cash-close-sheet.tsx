"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionSheet } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { closeCashAction } from "@/app/(app)/caixa/actions";
import { CARD_BRAND_LABEL, cashDifference, differencesText, nonZeroDifferences, PAY_LABEL, type CardBrand, type DrawerMethod } from "@/lib/comanda-math";
import { CASH_DENOMINATIONS_CENTS, denominationLabel, sumDenominations } from "@/lib/cash-denominations";
import { money } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/cn";

type Other = Exclude<DrawerMethod, "dinheiro">;
export type CloseSummary = { expected: Record<DrawerMethod, number> | null; byBrand: { method: "credito" | "debito"; brand: string; valueCents: number }[]; openComandas: number };
type Approval = { self: true } | { email: string; password: string };
type ByMethod = Record<DrawerMethod, number>;
type Result = { expected: number; counted: number; differenceCents: number; byForm: { method: DrawerMethod; expected: number; counted: number; cents: number }[] };

/**
 * Fechar o caixa (Norte Vendas): dinheiro contado por cédula e moeda; Pix, Crédito, Débito e Outra pelo total; o sistema ao lado e a
 * diferença. Contagem cega: quem conta não vê o esperado até fechar. Acima da tolerância, a gestão aprova (ela mesma com um clique; para
 * a equipe, alguém da gestão digita e-mail e senha ali). A gestão também fecha o caixa de outra pessoa (`sessionId`).
 */
export function CashCloseSheet({ open, onClose, ownerName, sessionId, summary, blind, canGerir, hasOptions }: {
  open: boolean; onClose: () => void; ownerName: string; sessionId: string | null; summary: CloseSummary; blind: boolean; canGerir: boolean; hasOptions: boolean;
}) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [text, setText] = useState<Record<Other, string>>({ pix: "", credito: "", debito: "", outra: "" });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<null | { differenceCents: number | null; differences: ByMethod | null }>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<null | Result>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const breakdown = Object.fromEntries(CASH_DENOMINATIONS_CENTS.map((c) => [String(c), Number.parseInt(qty[String(c)] ?? "", 10)]).filter(([, n]) => Number.isInteger(n) && (n as number) > 0)) as Record<string, number>;
  const cash = sumDenominations(breakdown);
  const others: Other[] = hasOptions || (summary.expected?.outra ?? 0) > 0 ? ["pix", "credito", "debito", "outra"] : ["pix", "credito", "debito"];
  const counted = { dinheiro: cash, ...Object.fromEntries((["pix", "credito", "debito", "outra"] as Other[]).map((m) => [m, text[m] ? parseMoneyInput(text[m]) ?? 0 : 0])) } as Record<DrawerMethod, number>;
  const diff = summary.expected ? cashDifference(summary.expected, counted) : null;
  const rows: DrawerMethod[] = ["dinheiro", ...others];

  const submit = (approve: Approval | null) => start(async () => {
    setError(null);
    const r = await closeCashAction({ sessionId, cashBreakdown: breakdown, counted: { pix: counted.pix, credito: counted.credito, debito: counted.debito, outra: counted.outra }, notes: notes.trim() || null, approval: approve });
    if (!r.ok) { setError(r.error); return; }
    const data = r.data!;
    if (data.status === "precisa_aprovacao") { setApproval({ differenceCents: data.differenceCents, differences: data.differences ?? null }); return; }
    // Forma por forma (QA r58, C-1): com duas ou mais formas diferentes, cada uma aparece (a soma pode dar zero).
    const forms = nonZeroDifferences(data.differences);
    toast(forms.length > 1 ? `Caixa fechado. Diferenças: ${differencesText(forms)}` : `Caixa fechado. Diferença: ${money(data.differenceCents)}`, data.differenceCents === 0 && forms.length === 0 ? "ok" : "info");
    if (blind) {
      setApproval(null);
      setResult({ expected: data.expected.dinheiro, counted: data.counted.dinheiro ?? cash, differenceCents: data.differenceCents,
        byForm: forms.map((f) => ({ method: f.method, expected: data.expected[f.method] ?? 0, counted: data.counted[f.method] ?? 0, cents: f.cents })) });
      return;
    }
    onClose();
    router.refresh();
  });
  const done = () => { onClose(); router.refresh(); };

  const footer = result ? <Button onClick={done}>Concluir</Button>
    : approval ? null
    : <Button loading={pending} onClick={() => submit(null)}>Fechar caixa</Button>;

  return (
    <ActionSheet open={open} onClose={result ? done : onClose} title={sessionId ? `Fechar o caixa de ${ownerName}` : "Fechar caixa"} footer={footer}>
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-graphite">Caixa fechado. Agora você vê o que o sistema esperava:</p>
          {result.byForm.length > 1 ? (
            <ul className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-paper-2 px-4 py-3 text-sm" aria-label="Diferenças por forma">
              {result.byForm.map((f) => <li key={f.method} className="font-semibold text-alert">{`${PAY_LABEL[f.method]}: esperado ${money(f.expected)}, contado ${money(f.counted)}, diferença ${money(f.cents)}`}</li>)}
            </ul>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-[var(--radius-control)] bg-paper-2 px-4 py-3 text-sm">
              <dt className="sr-only">Esperado</dt><dd className="col-span-2">{`Esperado em dinheiro: ${money(result.expected)}`}</dd>
              <dt className="sr-only">Contado</dt><dd className="col-span-2">{`Contado em dinheiro: ${money(result.counted)}`}</dd>
              <dt className="sr-only">Diferença</dt><dd className={cn("col-span-2 font-semibold", result.differenceCents ? "text-alert" : "text-ok")}>{`Diferença: ${money(result.differenceCents)}`}</dd>
            </dl>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {summary.openComandas > 0 && <p className="rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">{`${summary.openComandas} ${summary.openComandas === 1 ? "comanda aberta fica" : "comandas abertas ficam"} para o próximo caixa.`}</p>}
          {blind && <p className="text-sm text-graphite">Conte e digite o que tem. O valor esperado só aparece depois de fechar.</p>}
          {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}

          <section aria-label="Dinheiro por cédula e moeda" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Dinheiro na gaveta</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CASH_DENOMINATIONS_CENTS.map((c) => (
                <label key={c} className="flex flex-col items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1.5 text-xs text-graphite">
                  <span className="font-medium tabular">{denominationLabel(c)}</span>
                  <Input aria-label={`Quantidade de ${denominationLabel(c)}`} inputMode="numeric" value={qty[String(c)] ?? ""} placeholder="0"
                    onChange={(e) => { setError(null); setApproval(null); setQty((q) => ({ ...q, [String(c)]: e.target.value.replace(/\D/g, "").slice(0, 5) })); }} className="h-9 text-center tabular" />
                </label>
              ))}
            </div>
          </section>

          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Forma</th>{summary.expected && <th className="font-medium">Sistema</th>}<th className="font-medium">Contado</th>{diff && <th className="text-right font-medium">Diferença</th>}</tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m} className="border-t border-line/70">
                  <td className="py-2">{PAY_LABEL[m]}</td>
                  {summary.expected && <td className="tabular">{money(summary.expected[m])}</td>}
                  <td>{m === "dinheiro"
                    ? <span data-testid="contado-dinheiro" className="font-semibold tabular">{money(cash)}</span>
                    : <Input aria-label={`${PAY_LABEL[m]} contado (R$)`} inputMode="decimal" value={text[m as Other]} placeholder="0,00"
                        onChange={(e) => { setError(null); setApproval(null); setText((t) => ({ ...t, [m]: e.target.value })); }} className="h-9 w-28" />}</td>
                  {diff && <td className={cn("text-right tabular", diff.byMethod[m] ? "font-medium text-alert" : "text-muted")}>{money(diff.byMethod[m])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {summary.byBrand.length > 0 && !blind && (
            <p className="text-xs text-muted">{`Cartões por bandeira: ${summary.byBrand.map((b) => `${PAY_LABEL[b.method]} ${CARD_BRAND_LABEL[b.brand as CardBrand] ?? b.brand} ${money(b.valueCents)}`).join(" · ")}`}</p>
          )}
          {diff && (() => {
            const forms = nonZeroDifferences(diff.byMethod);
            return <p className={forms.length === 0 ? "text-sm text-ok" : "text-sm font-semibold text-alert"}>{forms.length > 1 ? `Diferenças: ${differencesText(forms)}` : `Diferença: ${money(diff.totalCents)}`}</p>;
          })()}
          <label className="flex flex-col gap-1 text-sm text-graphite">Observação (opcional)<Input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>

          {approval && (
            <section aria-label="Aprovação da gestão" className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-gold/50 bg-gold-soft/40 p-3">
              <p className="text-sm font-medium text-gold-ink">{nonZeroDifferences(approval.differences).length > 1
                ? `Diferenças acima da tolerância: ${differencesText(nonZeroDifferences(approval.differences))}.`
                : approval.differenceCents != null
                ? `Diferença de ${money(nonZeroDifferences(approval.differences)[0]?.cents ?? approval.differenceCents)} acima da tolerância.`
                : "Diferença acima da tolerância. O valor aparece depois de fechar."}</p>
              {canGerir ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setApproval(null)}>Contar de novo</Button>
                  <Button variant="gold" loading={pending} onClick={() => submit({ self: true })}>Aprovar a diferença</Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-graphite">Chame alguém da gestão para aprovar aqui, com o login dela.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm text-graphite">E-mail da gestão<Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                    <label className="flex flex-col gap-1 text-sm text-graphite">Senha da gestão<Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={() => setApproval(null)}>Contar de novo</Button>
                    <Button variant="gold" loading={pending} disabled={!email.trim() || !password} onClick={() => submit({ email: email.trim(), password })}>Aprovar e fechar</Button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </ActionSheet>
  );
}
