"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { CARD_BRAND_LABEL, CARD_BRANDS, changeFor, isCardMethod, PAY_LABEL, type CardBrand, type PayMethod } from "@/lib/comanda-math";
import { money } from "@/lib/format";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";
import type { ComandaDetail } from "@/server/queries/caixa";

export type NewPayment = { method: PayMethod; valueCents: number; installments: number | null; brand: CardBrand | null; customMethodId: string | null; note: string | null };
const ORDER: PayMethod[] = ["pix", "credito", "debito", "dinheiro", "cortesia", "credito_cliente", "outra"];

/** "Crédito · Visa · 3x", "Outra forma · Transferência". */
export function paymentTitle(p: { method: string; brand: string | null; installments: number | null; customLabel?: string | null }): string {
  const parts = [PAY_LABEL[p.method as PayMethod] ?? p.method];
  if (p.brand) parts.push(CARD_BRAND_LABEL[p.brand as CardBrand] ?? p.brand);
  if (p.installments && p.installments > 1) parts.push(`${p.installments}x`);
  if (p.method === "outra" && p.customLabel) parts.push(p.customLabel);
  return parts.join(" · ");
}

/**
 * Receber (Norte Vendas, PaymentCaptureFields, sem taxa de serviço): as formas lançadas uma a uma, com "Restante a pagar"; bandeira
 * obrigatória no cartão e parcelas de 1x a 12x no crédito; o troco só sobre o dinheiro; cortesia com motivo; "Outra forma" cadastrada pela
 * gestão; observação. Receber menos que o restante deixa a comanda em aberto com saldo.
 *
 * Dívida (Fase A, item 6): com o que falta, a cliente escolhida e os itens com preço, "Deixar R$ X como dívida" (quem tem caixa.divida,
 * com o recurso ligado) libera o Fechar comanda sem receber o resto.
 */
export function PaymentPanel({ detail, paymentOptions, pending, saveChange, onSaveChange, onAdd, onRemove, canLeaveDebt = false, leaveDebt = false, onLeaveDebt, notaPending = false, closesWhenFull = false }: {
  /** Psico r68 #4: o pagamento que completa o total também fecha a comanda (um passo só, "Receber e fechar"). */ closesWhenFull?: boolean;
  /** A nota fiscal ainda não foi escolhida (padrão "Perguntar"): o Receber espera a escolha. */ notaPending?: boolean;
  detail: ComandaDetail; paymentOptions: { id: string; label: string }[]; pending: boolean; saveChange: boolean; onSaveChange: (v: boolean) => void;
  onAdd: (p: NewPayment) => void; onRemove: (paymentId: string, reason: string | null) => void;
  /** caixa.divida de quem opera. */ canLeaveDebt?: boolean; leaveDebt?: boolean; onLeaveDebt?: (v: boolean) => void;
}) {
  const fid = useId();
  const [method, setMethod] = useState<PayMethod>("pix");
  const [brand, setBrand] = useState<CardBrand | null>(null);
  const [installments, setInstallments] = useState("1");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [value, setValue] = useState(moneyInputValue(detail.remainingCents));
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  // O valor volta ao restante quando ele muda, mas nunca por cima do que a recepção digitou enquanto a comanda recarregava.
  const [edited, setEdited] = useState(false);
  const [seenRemaining, setSeenRemaining] = useState(detail.remainingCents);
  if (seenRemaining !== detail.remainingCents) { setSeenRemaining(detail.remainingCents); if (!edited) setValue(moneyInputValue(detail.remainingCents)); }

  const open = detail.status === "aberta";
  // Comanda que quita dívida não deixa dívida nova (a dívida não "rola").
  const offerDebt = canLeaveDebt && detail.dividaOn && open && detail.remainingCents > 0 && !!detail.contactId && detail.items.length > 0 && detail.totals.missingPrice.length === 0
    && !detail.items.some((i) => i.kind === "divida");
  const cents = parseMoneyInput(value);
  const methods = ORDER.filter((m) => (m !== "credito_cliente" || (detail.creditBalance ?? 0) > 0) && (m !== "outra" || paymentOptions.length > 0));
  const candidate = method === "dinheiro" && cents ? [{ method, valueCents: cents }] : [];
  const change = changeFor([...detail.payments, ...candidate], detail.totals.totalCents);
  const blocker = !open || detail.remainingCents <= 0 ? "paga"
    : notaPending ? "Escolha a nota fiscal acima."
    : isCardMethod(method) && !brand ? "Escolha a bandeira."
    : method === "outra" && !custom ? "Escolha qual é a outra forma."
    : method === "cortesia" && !note.trim() ? "Escreva o motivo da cortesia."
    : !cents || cents <= 0 ? "Digite o valor."
    : method !== "dinheiro" && cents > detail.remainingCents ? `Passa do que falta (${money(detail.remainingCents)}). Só o dinheiro pode passar e virar troco.`
    : null;
  const pick = (m: PayMethod) => { setMethod(m); if (!isCardMethod(m)) setBrand(null); if (m === "cortesia" || method === "cortesia") setNote(""); }; // o motivo da cortesia não vira observação de outra forma
  const submit = () => {
    if (blocker || !cents) return;
    setEdited(false);
    onAdd({ method, valueCents: cents, installments: method === "credito" ? Number(installments) : null, brand: isCardMethod(method) ? brand : null,
      customMethodId: method === "outra" ? custom : null, note: note.trim() || null });
    setNote("");
  };

  return (
    <section aria-label="Pagamento" className="flex flex-col gap-3">
      {detail.payments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {detail.payments.map((p) => (
            <li key={p.id} className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 font-medium">{paymentTitle(p)}</span>
                <span className="flex items-center gap-3 tabular">{money(p.valueCents)}
                  {/* 44 px no toque (QA r58, I-9): no celular era 48×18. */}
                  {open && removing !== p.id && <button type="button" className="inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 text-xs text-alert hover:underline" onClick={() => { setRemoving(p.id); setRemoveReason(""); }}>Estornar</button>}
                </span>
              </div>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                <span>{p.sessionOwnerName ? `Caixa de ${p.sessionOwnerName}` : `Sem caixa aberto${p.createdByName ? ` · ${p.createdByName}` : ""}`}</span>
                {p.feeCents != null && p.feeCents > 0 && <span>{`taxa ${money(p.feeCents)}`}</span>}
                {p.changeCents > 0 && <span>{`troco ${money(p.changeCents)}`}</span>}
                {p.note && <span>{p.note}</span>}
              </p>
              {removing === p.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-graphite">Motivo do estorno (opcional)
                    <Input value={removeReason} maxLength={300} onChange={(e) => setRemoveReason(e.target.value)} className="h-9" />
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Voltar</Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => { onRemove(p.id, removeReason.trim() || null); setRemoving(null); }}>Confirmar estorno</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt>Total</dt><dd className="font-semibold tabular">{money(detail.totals.totalCents)}</dd>
        <dt>Recebido</dt><dd className="tabular">{money(detail.paidCents)}</dd>
        <dt className={detail.remainingCents > 0 ? "font-medium text-alert" : "text-muted"}>Restante a pagar</dt>
        <dd className={detail.remainingCents > 0 ? "font-semibold text-alert tabular" : "tabular text-muted"}>{money(detail.remainingCents)}</dd>
        {detail.feeCents > 0 && <><dt className="text-graphite">Taxas do cartão</dt><dd className="tabular text-graphite">{money(detail.feeCents)}</dd>
          <dt className="text-graphite">Líquido</dt><dd className="tabular text-graphite">{money(detail.netCents)}</dd></>}
      </dl>
      {detail.missingFeeBrands.length > 0 && <p className="text-xs text-muted">{`Sem taxa cadastrada: ${detail.missingFeeBrands.join(", ")}`}</p>}
      {offerDebt && (
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">
          <input type="checkbox" checked={leaveDebt} onChange={(e) => onLeaveDebt?.(e.target.checked)} />{`Deixar ${money(detail.remainingCents)} como dívida`}
        </label>
      )}
      {detail.status === "fechada" && detail.debtCents > 0 && <p className="text-sm text-alert">{`Ficou ${money(detail.debtCents)} de dívida.`}</p>}
      {change > 0 && (
        <div className="rounded-[var(--radius-control)] bg-ok-soft px-3 py-2 text-sm text-ok">
          <p className="font-semibold">{`Troco: ${money(change)}`}</p>
          {detail.contactId && open && detail.changePreviewCents > 0 && (
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={saveChange} onChange={(e) => onSaveChange(e.target.checked)} />Guardar o troco como crédito da cliente</label>
          )}
        </div>
      )}
      {open && detail.remainingCents > 0 && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3">
          <Segmented label="Forma de pagamento" value={method} onChange={pick} options={methods.map((m) => ({ value: m, label: PAY_LABEL[m] }))} />
          {isCardMethod(method) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-graphite">Bandeira</span>
              <Segmented label="Bandeira" value={brand} onChange={(b) => setBrand(b)} options={CARD_BRANDS.map((b) => ({ value: b, label: CARD_BRAND_LABEL[b] }))} className="[&_button]:h-8 [&_button]:px-3 [&_button]:text-xs" />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-graphite">Valor recebido (R$)
              <Input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setEdited(true); }} className="h-11" />
            </label>
            {method === "credito" && (
              <label className="flex flex-col gap-1 text-sm text-graphite">Parcelas
                <Select value={installments} onChange={(e) => setInstallments(e.target.value)} className="h-11">
                  {Array.from({ length: 12 }, (_, k) => <option key={k} value={String(k + 1)}>{k + 1}x</option>)}
                </Select>
              </label>
            )}
            {method === "outra" && (
              <label className="flex flex-col gap-1 text-sm text-graphite">Qual forma
                <Select value={custom} onChange={(e) => setCustom(e.target.value)} className="h-11">
                  <option value="">Escolher</option>
                  {paymentOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              </label>
            )}
            {method === "credito_cliente" && <p className="self-end pb-3 text-xs text-muted">{`Saldo de crédito: ${money(detail.creditBalance ?? 0)}`}</p>}
            <div className="flex flex-col gap-1 text-sm text-graphite sm:col-span-2">
              <span className="flex items-baseline gap-1.5"><label htmlFor={`${fid}-nota`}>{method === "cortesia" ? "Motivo da cortesia" : "Observação"}</label>
                {method === "cortesia" && <span className="text-xs font-medium text-alert">obrigatório</span>}</span>
              <Input id={`${fid}-nota`} value={note} maxLength={200} aria-required={method === "cortesia" ? "true" : undefined} onChange={(e) => setNote(e.target.value)} className="h-11" placeholder={method === "cortesia" ? "ex.: aniversário, retoque" : "opcional"} />
            </div>
          </div>
          {/* Por que o Receber está cinza (QA r58, I-7): toda trava aparece, ligada ao botão. */}
          {blocker && blocker !== "paga" && <p id={`${fid}-falta`} className="text-sm text-graphite">{blocker}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">{cents && cents < detail.remainingCents ? `Fica faltando ${money(detail.remainingCents - cents)}` : ""}</span>
            <Button disabled={pending || !!blocker} aria-describedby={blocker && blocker !== "paga" ? `${fid}-falta` : undefined} onClick={submit}>{closesWhenFull && cents && cents >= detail.remainingCents ? "Receber e fechar" : "Receber"}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
