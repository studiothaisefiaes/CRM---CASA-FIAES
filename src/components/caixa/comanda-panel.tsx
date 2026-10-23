"use client";
import { Menu } from "@/components/ui/menu";
import { andList } from "@/lib/after-visit";
import { CancelComandaDialog } from "./cancel-comanda";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { FieldError, SheetLabel } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import {
  addItemAction, addPaymentAction, cancelComandaAction, clientPackagesAction, closeComandaAction, comandaDetailAction, undoCancelarComandaAction, joinTodayAction,
  openCashAction, removeItemAction, removePaymentAction, reopenComandaAction, setAssistantsAction, setClientAction, setCpfAction, setNotaAction, setDiscountAction, updateItemAction,
} from "@/app/(app)/caixa/actions";
import { ClientPicker, type PickedClient } from "@/components/agenda/client-picker";
import type { Approval } from "@/app/(app)/caixa/actions";
import type { ComandaDetail } from "@/server/queries/caixa";
import { todayBahia } from "@/lib/agenda";
import { formatCpf } from "@/lib/cpf";
import { money } from "@/lib/format";
import { PAY_LABEL } from "@/lib/comanda-math";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/cn";
import { ApprovalBox } from "./approval-box";
import { ClientAlertPopup } from "@/components/contacts/client-alert-popup";
import type { ClientAlertConfig } from "@/lib/client-alert";
import { NotaFiscalBlock } from "./nota-fiscal-block";
import { AssistantsField } from "./assistants-field";
import { ServicePicker } from "./service-picker";
import { ItemEditor, ProductPicker, type CatalogProduct } from "./item-editor";
import { LoyaltyBanner } from "./loyalty-banner";
import { NotaEscolhaBlock } from "./nota-escolha";
import { PaymentPanel, type NewPayment } from "./payment-panel";

/** O desfazer do cancelamento vale 10 minutos (o servidor confere: UNDO_DISCARD_MS). */
const UNDO_MS = 10 * 60_000;

export type ComandaCatalog = {
  /** Com o preço de tabela (22/10: aparece na busca de serviço). */ services: { id: string; label: string; priceCents?: number | null }[]; professionals: { id: string; name: string; active: boolean; assistantOf?: string | null }[];
  /** Quem faz o quê (`professional_services`): a busca de serviço põe os da profissional escolhida no topo (22/10). */ proServices?: Record<string, string[]>;
  packageDefs: { id: string; name: string; priceCents: number | null }[]; canGerir: boolean;
  /** Pôr e tirar assistente (caixa.assistente). Sem isso o campo é só leitura. */ canAssistente?: boolean;
  /** Deixar o que falta como dívida da cliente (caixa.divida). Quitar dívida antiga não depende disto. */ canDivida?: boolean;
  /** Cancelar comanda aberta, com motivo e desfazer (caixa.cancelar). */ canCancelar?: boolean;
  /** "Outra forma" ativas (Serviços e pacotes › Formas de pagamento). */ paymentOptions?: { id: string; label: string }[];
  /** Hoje em Salvador (reabrir comanda de outro dia é da gestão). */ today?: string;
  /** Item 20: o Aviso da cliente salta ao abrir a comanda (função + configuração) e o texto de quem não autorizou imagem. Ausente = não salta. */ clientAlert?: ClientAlertConfig;
  /** Item 22: quem tem fidelidade.resgatar vê o botão "Usar o prêmio" no aviso da fidelidade da comanda. */ canRedeemLoyalty?: boolean;
  /** Produtos ativos de venda, com o estoque (só com Produtos e estoque ligado). */ products?: CatalogProduct[];
  /** Produtos e estoque ligado: Produto vira escolha do catálogo; desligado, texto livre. */ estoqueLigado?: boolean;
};
type Kind = "servico" | "produto" | "pacote_venda" | "pacote_sessao";
const KIND_LABEL: Record<Kind, string> = { servico: "Serviço", produto: "Produto", pacote_venda: "Pacote", pacote_sessao: "Sessão de pacote" };
type Result = { ok: boolean; error?: string; needsCash?: boolean; needsApproval?: boolean };
/** Uma ação que pode pedir a gestão (desconto ou cortesia acima do limite, QA r58, I-11): roda de novo com a aprovação. */
type Run = (approval?: Approval) => Promise<Result>;

/** Busca a comanda quando abre (ou troca) e recarrega a cada ação. */
export function useComandaDetail(comandaId: string | null, open: boolean) {
  const [d, setD] = useState<ComandaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownFor = open ? comandaId : null;
  const [resetFor, setResetFor] = useState<string | null>(null);
  if (resetFor !== shownFor) { setResetFor(shownFor); setD(null); setError(null); }
  const load = useCallback(async () => {
    if (!comandaId) return;
    const r = await comandaDetailAction(comandaId);
    if (r.ok) setD(r.data ?? null); else setError(r.error);
  }, [comandaId]);
  useEffect(() => {
    if (!open || !comandaId) return;
    let live = true;
    void comandaDetailAction(comandaId).then((r) => { if (!live) return; if (r.ok) setD(r.data ?? null); else setError(r.error); });
    return () => { live = false; };
  }, [open, comandaId]);
  return { d, error, setError, load };
}

/**
 * A comanda (7.1, Plano 3): itens editáveis (preço e desconto com motivo, profissional, tirar), somar item, desconto na comanda em R$ ou %,
 * CPF na nota, o pagamento novo e Fechar comanda. Fechada: Reabrir com motivo (do dia: quem opera; outro dia: gestão); Cancelar é da gestão.
 */
export function ComandaBody({ d, catalog, error, setError, reload, onChanged }: {
  d: ComandaDetail; catalog: ComandaCatalog; error: string | null; setError: (e: string | null) => void; reload: () => Promise<void>; onChanged?: () => void;
}) {
  const [pending, start] = useTransition();
  const [saveChange, setSaveChange] = useState(false);
  const [leaveDebt, setLeaveDebt] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [retry, setRetry] = useState<NewPayment | null>(null);
  const [opening, setOpening] = useState("");
  const [reopen, setReopen] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [seenAt] = useState(() => Date.now()); // hora em que o painel abriu: o "Desfazer cancelamento" some depois de 10 min (o servidor confere)
  const [more, setMore] = useState<null | "item" | "extra">(null);
  const [approval, setApproval] = useState<null | { message: string; run: Run; done?: string; after?: () => void; error?: string | null }>(null);
  const toast = useToast();
  const isOpen = d.status === "aberta";
  /** Finalizar com falta só deixando a dívida (cliente escolhida, recurso ligado, caixa.divida). */
  const debtNow = leaveDebt && !!catalog.canDivida && d.dividaOn && !!d.contactId && d.remainingCents > 0 && !d.items.some((i) => i.kind === "divida");
  const today = catalog.today ?? todayBahia(new Date());
  /** Padrão "Perguntar": a nota fiscal precisa ser escolhida antes de receber e de fechar. */
  const notaPending = isOpen && d.notaEscolha.escolha == null;
  /** Pode fechar sozinha quando o pagamento completa o total: itens com preço, nota resolvida. */
  const canAutoClose = isOpen && !notaPending && d.items.length > 0 && d.totals.missingPrice.length === 0;
  /** Por que o "Fechar comanda" está cinza (psico r68 #4): nunca um cinza sem frase. */
  const closeBlocker = !isOpen ? null : !d.items.length ? "Some um item para fechar."
    : notaPending ? "Escolha a nota fiscal para fechar."
    : d.totals.missingPrice.length ? "Ponha o preço que falta para fechar."
    : d.remainingCents > 0 && !debtNow ? `Falta receber ${money(d.remainingCents)}.` : null;

  /** Roda uma ação e recarrega; o erro aparece no alto. Acima do limite de desconto ou cortesia, abre a aprovação da gestão e espera. */
  const act = (fn: Run, done?: string, after?: () => void) => start(async () => {
    setError(null);
    setApproval(null); // uma aprovação pendente é só da ação que a pediu

    const r = await fn();
    if (!r.ok && r.needsApproval) { setApproval({ message: r.error ?? "A gestão aprova.", run: fn, done, after }); return; }
    if (!r.ok) { setError(r.error ?? "Não foi possível registrar. Tente de novo."); return; }
    setApproval(null);
    if (done) toast(done);
    after?.();
    await reload();
    onChanged?.();
  });
  const approve = (ap: NonNullable<Approval>) => start(async () => {
    if (!approval) return;
    const r = await approval.run(ap);
    if (!r.ok) { setApproval({ ...approval, error: r.error ?? "Não foi possível registrar. Tente de novo." }); return; }
    setApproval(null);
    if (approval.done) toast(approval.done);
    approval.after?.();
    await reload();
    onChanged?.();
  });
  const receive = (p: NewPayment) => start(async () => {
    setError(null);
    setApproval(null);
    const r = await addPaymentAction(d.id, p);
    if (!r.ok && r.needsApproval) { setApproval({ message: r.error, run: (ap) => (ap ? addPaymentAction(d.id, p, ap) : addPaymentAction(d.id, p)) }); return; }
    if (!r.ok) { setError(r.error); if (r.needsCash) setRetry(p); return; }
    setRetry(null);
    await afterPaid(p);
  });
  /** Psico r68 #4: o pagamento que completa o total fecha a comanda junto (um passo só); o aviso diz o que entrou e o que aconteceu. */
  const afterPaid = async (p: NewPayment) => {
    const paid = `${money(p.valueCents)} ${p.method === "dinheiro" ? "em" : "no"} ${PAY_LABEL[p.method]}`;
    if (canAutoClose && p.valueCents >= d.remainingCents) {
      const c = await closeComandaAction(d.id, { saveChangeAsCredit: saveChange });
      if (c.ok) toast(`${paid} · comanda ${d.number} fechada`);
      else setError(c.error);
    } else toast(d.remainingCents > p.valueCents ? `${paid} · falta ${money(d.remainingCents - p.valueCents)}` : paid);
    await reload();
    onChanged?.();
  };
  const openCashAndReceive = () => start(async () => {
    const cents = parseMoneyInput(opening || "0");
    if (cents == null || !retry) { setError("Digite o fundo de troco (pode ser zero)."); return; }
    const o = await openCashAction({ openingCents: cents });
    if (!o.ok) { setError(o.error); return; }
    const r = await addPaymentAction(d.id, retry);
    if (!r.ok) { setError(r.error); return; }
    setRetry(null); setError(null);
    toast("Caixa aberto");
    await afterPaid(retry);
  });
  const finish = () => start(async () => {
    setError(null);
    const r = await closeComandaAction(d.id, { saveChangeAsCredit: saveChange, ...(debtNow ? { leaveDebt: true } : {}) });
    if (!r.ok) { setError(r.error); return; }
    setLeaveDebt(false);
    toast(`Comanda ${d.number} fechada`);
    await reload();
    onChanged?.();
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Item 20: o aviso da cliente salta ao abrir a comanda (uma vez por comanda). */}
      {d.contactId && catalog.clientAlert?.on && (
        <ClientAlertPopup key={d.id} contactId={d.contactId} scope={d.id} alertNotes={d.alertNotes ?? null} imageUse={d.imageUse ?? null} noImageText={catalog.clientAlert.text} />
      )}
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
      {isOpen && !d.visitId && <ChangeClient comandaId={d.id} clientName={d.clientName} onDone={async () => { await reload(); onChanged?.(); }} setError={setError} />}
      {isOpen && d.contactId && d.loyalty && (
        <LoyaltyBanner comandaId={d.id} programs={d.loyalty} items={d.items} services={catalog.services} professionals={catalog.professionals}
          canRedeem={!!catalog.canRedeemLoyalty} onDone={async () => { await reload(); onChanged?.(); }} />
      )}
      {approval && <ApprovalBox message={approval.message} error={approval.error} canGerir={catalog.canGerir} pending={pending} onApprove={approve} onCancel={() => setApproval(null)} />}
      {retry && (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-control)] border border-gold/40 bg-gold-soft/40 p-3">
          <label className="flex flex-col gap-1 text-sm text-graphite">Fundo de troco (R$)<Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="h-11 w-36" /></label>
          <Button variant="gold" disabled={pending} onClick={openCashAndReceive}>Abrir caixa e receber</Button>
        </div>
      )}
      {d.status !== "aberta" && (
        <p className="text-sm text-graphite">{d.status === "fechada" ? `Fechada${d.closedByName ? ` por ${d.closedByName}` : ""}.` : `Cancelada: ${d.cancelReason ?? ""}`}</p>
      )}
      {d.status === "cancelada" && !d.closedAt && catalog.canCancelar && d.cancelledAt && seenAt - new Date(d.cancelledAt).getTime() < UNDO_MS && (
        <div><Button variant="secondary" disabled={pending} onClick={() => act(() => undoCancelarComandaAction(d.id), "A comanda voltou")}>Desfazer cancelamento</Button></div>
      )}
      {d.status === "aberta" && d.reopenReason && <p className="text-xs text-muted">{`Reaberta: ${d.reopenReason}`}</p>}

      <section aria-label="Itens" className="flex flex-col gap-2">
        {d.items.map((i) => (
          <div key={i.id} className="rounded-[var(--radius-control)] border border-line px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{i.label}{i.qty !== 1 ? ` × ${i.qty}` : ""}</p>
                <p className="text-xs text-muted">
                  {[isOpen ? null : i.assistants.length ? `${i.professionalName ?? ""} com ${andList(i.assistants.map((a) => a.name))}` : i.professionalName, i.kind === "produto" ? "produto" : null].filter(Boolean).join(" · ")}
                  {i.originalUnitCents != null && i.unitCents != null && i.originalUnitCents !== i.unitCents && <> · <s>{money(i.originalUnitCents)}</s>{i.priceReason ? ` (${i.priceReason})` : ""}</>}
                  {i.discountCents > 0 && <> · {`desconto ${money(i.discountCents)}`}{i.discountReason ? ` (${i.discountReason})` : ""}</>}
                </p>
              </div>
              <span className="shrink-0 tabular">{i.totalCents == null ? "—" : money(i.totalCents)}</span>
            </div>
            {isOpen && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {(i.kind === "servico" || i.kind === "pacote_sessao") && (
                  <Select aria-label={`Profissional de ${i.label}`} value={i.professionalId ?? ""} className="h-9 text-sm" onChange={(e) => act(() => updateItemAction(i.id, { professionalId: e.target.value || null }))}>
                    <option value="">Escolher profissional</option>
                    {catalog.professionals.filter((p) => p.active || p.id === i.professionalId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                )}
                {(i.kind === "servico" || i.kind === "pacote_sessao") && d.assistentes.on && (
                  <AssistantsField item={i} professionals={catalog.professionals} max={d.assistentes.max} disabled={!catalog.canAssistente || pending}
                    onChange={(professionalIds) => act(() => setAssistantsAction(i.id, { professionalIds }))} />
                )}
                {i.unitCents == null && i.kind !== "pacote_sessao" && <PriceField label={i.label} onCommit={(unitCents) => act(() => updateItemAction(i.id, { unitCents }))} />}
                {/* Ações de dinheiro com 44 px no toque (QA r58, I-9): no celular eram 29×20 (Tirar) e 44×20 (Ajustar). */}
                <span className="ml-auto flex gap-3 pointer-coarse:gap-1">
                  {i.unitCents != null && i.kind !== "pacote_sessao" && i.kind !== "divida" && editing !== i.id && (
                    <button type="button" aria-label={`Ajustar ${i.label}`} className="inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 text-sm font-medium text-gold-ink hover:underline" onClick={() => setEditing(i.id)}>Ajustar</button>
                  )}
                  <button type="button" aria-label={`Tirar ${i.label}`} className="inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-2 text-sm text-alert hover:underline" onClick={() => setRemoving({ id: i.id, reason: "" })}>Tirar</button>
                </span>
              </div>
            )}
            {isOpen && editing === i.id && (
              <ItemEditor item={i} pending={pending} onCancel={() => setEditing(null)}
                onSave={(patch) => act((ap) => (ap ? updateItemAction(i.id, patch, ap) : updateItemAction(i.id, patch)), undefined, () => setEditing(null))} />
            )}
            {isOpen && removing?.id === i.id && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-graphite">Motivo (opcional)
                  <Input value={removing.reason} maxLength={300} onChange={(e) => setRemoving({ id: i.id, reason: e.target.value })} className="h-9" />
                </label>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Voltar</Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => act(() => removeItemAction(i.id, { reason: removing.reason.trim() || null }), undefined, () => setRemoving(null))}>Tirar da comanda</Button>
              </div>
            )}
          </div>
        ))}
        {!d.items.length && <p className="text-sm text-muted">Nenhum item ainda.</p>}
        {d.totals.missingPrice.map((l) => <p key={l} className="text-sm text-alert">{`Falta o preço de ${l}.`}</p>)}
        {isOpen && d.contactId && <button type="button" className="self-start text-sm font-medium text-gold-ink hover:underline" onClick={() => act(() => joinTodayAction(d.id), "Horário juntado")}>Juntar horário de hoje</button>}
        {isOpen && d.debts.map((debt) => (
          <DebtRow key={debt.comandaId} debt={debt} pending={pending} onCharge={(unitCents) => act(() => addItemAction(d.id, { kind: "divida", settlesComandaId: debt.comandaId, unitCents }), "Dívida somada à comanda")} />
        ))}
      </section>

      {isOpen && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-expanded={more === "item"} onClick={() => setMore(more === "item" ? null : "item")}>Somar item</Button>
          <Button variant="secondary" size="sm" aria-expanded={more === "extra"} onClick={() => setMore(more === "extra" ? null : "extra")}>Desconto</Button>
        </div>
      )}
      {isOpen && more === "item" && <AddItem comanda={d} catalog={catalog} pending={pending} onAdd={(input) => {
        const item = input as Parameters<typeof addItemAction>[1];
        act((ap) => (ap ? addItemAction(d.id, item, ap) : addItemAction(d.id, item)), undefined, () => setMore(null));
      }} />}
      {isOpen && more === "extra" && d.totals.subtotalCents > 0 && <DiscountField comanda={d} pending={pending} onApply={(input) => act((ap) => setDiscountAction(d.id, ap ? { ...input, approval: ap } : input))} />}
      {isOpen && <NotaEscolhaBlock key={`${d.id}-${d.notaEscolha.escolha ?? "nada"}`} detail={d} pending={pending} onSave={(escolha, cpf) => act(() => setNotaAction(d.id, { escolha, cpf }), "Nota fiscal registrada")} />}

      {/* O pagamento logo depois dos itens (a pergunta da tela é "quanto falta e como paga?"); o resto fica recolhido. */}
      <PaymentPanel detail={d} paymentOptions={catalog.paymentOptions ?? []} pending={pending} saveChange={saveChange} onSaveChange={setSaveChange}
        canLeaveDebt={!!catalog.canDivida} leaveDebt={leaveDebt} onLeaveDebt={setLeaveDebt} notaPending={notaPending} closesWhenFull={canAutoClose}
        onAdd={receive} onRemove={(id, reason) => act(() => removePaymentAction(id, { reason }), "Pagamento estornado")} />

      {(!isOpen && d.status !== "cancelada") && <CpfField cpf={d.cpf} pending={pending} onSave={(cpf) => act(() => setCpfAction(d.id, cpf), cpf ? "CPF guardado" : undefined)} />}

      {reopen !== null && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line-strong p-3">
          <SheetLabel><label htmlFor={`reabrir-${d.id}`}>Motivo da reabertura</label></SheetLabel>
          <Input id={`reabrir-${d.id}`} value={reopen} maxLength={300} onChange={(e) => setReopen(e.target.value)} placeholder="ex.: esqueceu o produto, forma errada" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReopen(null)}>Voltar</Button>
            <Button size="sm" disabled={pending || !reopen.trim()} onClick={() => act(() => reopenComandaAction(d.id, { reason: reopen }), "Comanda reaberta", () => setReopen(null))}>Reabrir a comanda</Button>
          </div>
        </div>
      )}
      {cancelReason !== null && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-alert/40 p-3">
          <SheetLabel><label htmlFor={`cancelar-${d.id}`}>Motivo do cancelamento</label></SheetLabel>
          <Input id={`cancelar-${d.id}`} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
          <FieldError>{!cancelReason.trim() ? "Escreva o motivo." : null}</FieldError>
          <Button variant="danger" disabled={pending || !cancelReason.trim()} onClick={() => act(() => cancelComandaAction(d.id, { reason: cancelReason }), "Comanda cancelada", () => setCancelReason(null))}>Cancelar a comanda (estorna os pagamentos e desfaz pacote, crédito e comissão)</Button>
        </div>
      )}

      {d.status === "fechada" && <NotaFiscalBlock info={d.notaFiscal} comandaId={d.id} onChanged={async () => { await reload(); onChanged?.(); }} />}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
        {/* Cancelar saiu de perto do Fechar (psico r68 #1): mora no "⋯", com confirmação, motivo e desfazer. */}
        {isOpen && catalog.canCancelar && <Menu label="Mais da comanda" className="mr-auto" trigger={<span aria-hidden className="text-xl leading-none">⋯</span>} triggerClassName="h-10 min-w-10 border border-line-strong" up
          items={[{ label: "Cancelar comanda", danger: true, onSelect: () => setCancelOpen(true) }]} />}
        {isOpen && closeBlocker && <span id={`fechar-falta-${d.id}`} className="self-center text-sm text-graphite">{closeBlocker}</span>}
        {isOpen && <Button variant={closeBlocker ? "secondary" : "primary"} disabled={pending || !!closeBlocker} aria-describedby={closeBlocker ? `fechar-falta-${d.id}` : undefined} onClick={finish}>Fechar comanda</Button>}
        {d.status === "fechada" && (d.day === today || catalog.canGerir) && reopen === null && <Button variant="secondary" disabled={pending} onClick={() => setReopen("")}>Reabrir</Button>}
        {d.status === "fechada" && catalog.canGerir && cancelReason === null && <Button variant="secondary" disabled={pending} onClick={() => setCancelReason("")}>Cancelar comanda</Button>}
      </div>
      <CancelComandaDialog open={cancelOpen} comandaId={d.id} label={`Comanda ${d.number}${d.clientName ? ` · ${d.clientName}` : ""}`} onClose={() => setCancelOpen(false)}
        onDone={async () => { await reload(); onChanged?.(); }} />
    </div>
  );
}

/** Dívida de outra comanda da cliente: "Cobrar junto" soma o item "Dívida da comanda N de dd/mm" (todo o que falta, ou uma parte). */
function DebtRow({ debt, pending, onCharge }: { debt: ComandaDetail["debts"][number]; pending: boolean; onCharge: (unitCents: number) => void }) {
  const id = useId();
  const [v, setV] = useState(moneyInputValue(debt.remainingCents));
  const [seen, setSeen] = useState(debt.remainingCents);
  if (seen !== debt.remainingCents) { setSeen(debt.remainingCents); setV(moneyInputValue(debt.remainingCents)); }
  const cents = parseMoneyInput(v);
  const bad = cents == null || cents <= 0 ? "Digite o valor." : cents > debt.remainingCents ? `Passa do que falta da dívida (${money(debt.remainingCents)}).` : null;
  const dmy = `${debt.day.slice(8, 10)}/${debt.day.slice(5, 7)}`;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-alert/30 bg-alert-soft/40 px-3 py-2">
      <p className="text-sm font-medium text-alert">{`Dívida anterior: ${money(debt.remainingCents)} (comanda ${debt.number} de ${dmy})`}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-graphite">{`Quanto cobrar da comanda ${debt.number} (R$)`}
          <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-28" aria-describedby={bad ? `${id}-falta` : undefined} />
        </label>
        <Button size="sm" variant="secondary" disabled={pending || !!bad} onClick={() => { if (cents) onCharge(cents); }}>Cobrar junto</Button>
      </div>
      {bad && <p id={`${id}-falta`} className="text-xs text-alert">{bad}</p>}
    </div>
  );
}

function PriceField({ label, onCommit }: { label: string; onCommit: (cents: number) => void }) {
  const [v, setV] = useState("");
  return (
    <label className="flex flex-col gap-1 text-xs text-graphite">{`Preço de ${label} (R$)`}
      <Input inputMode="decimal" value={v} className="h-9 w-28" onChange={(e) => setV(e.target.value)} onBlur={() => { const c = parseMoneyInput(v); if (c != null) onCommit(c); }} />
    </label>
  );
}

function DiscountField({ comanda, pending, onApply }: { comanda: ComandaDetail; pending: boolean; onApply: (i: { cents?: number; percent?: number; reason: string | null }) => void }) {
  const [mode, setMode] = useState<"rs" | "pct">("rs");
  const [v, setV] = useState(moneyInputValue(comanda.discountCents || null));
  const [reason, setReason] = useState(comanda.discountReason ?? "");
  const cents = mode === "rs" ? (v.trim() ? parseMoneyInput(v) : 0) : null;
  const pct = mode === "pct" && v.trim() ? Number(v.replace(",", ".")) : null;
  const positive = mode === "rs" ? (cents ?? 0) > 0 : (pct ?? 0) > 0;
  const valid = mode === "rs" ? cents != null : pct != null && pct >= 0 && pct <= 100;
  return (
    <section aria-label="Desconto na comanda" className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
      <Segmented label="Desconto na comanda em" value={mode} onChange={(m) => { setMode(m); setV(""); }} options={[{ value: "rs", label: "R$" }, { value: "pct", label: "%" }]} className="[&_button]:h-10" />
      <label className="flex flex-col gap-1 text-sm text-graphite">{`Desconto na comanda (${mode === "pct" ? "%" : "R$"})`}
        <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className="h-11" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-graphite">Motivo do desconto
        <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="h-11" />
      </label>
      <Button variant="secondary" disabled={pending || !valid || (positive && !reason.trim())}
        onClick={() => onApply(mode === "pct" ? { percent: pct ?? 0, reason: reason.trim() || null } : { cents: cents ?? 0, reason: reason.trim() || null })}>Aplicar</Button>
    </section>
  );
}

function CpfField({ cpf, pending, onSave }: { cpf: string | null; pending: boolean; onSave: (cpf: string | null) => void }) {
  const [v, setV] = useState(formatCpf(cpf));
  const [seen, setSeen] = useState(cpf);
  if (seen !== cpf) { setSeen(cpf); setV(formatCpf(cpf)); }
  const digits = v.replace(/\D/g, "");
  return (
    <label className="flex max-w-xs flex-col gap-1 text-sm text-graphite">CPF na nota (opcional)
      <Input inputMode="numeric" value={v} disabled={pending} placeholder="000.000.000-00" className="h-11" onChange={(e) => setV(formatCpf(e.target.value))}
        onBlur={() => { if (digits !== (cpf ?? "") && (digits.length === 11 || digits.length === 0)) onSave(digits || null); }} />
    </label>
  );
}

/** A cliente da comanda aberta: "Trocar cliente" (22/10) busca a ficha (nome, telefone, CPF) ou cadastra a cliente nova. */
function ChangeClient({ comandaId, clientName, onDone, setError }: { comandaId: string; clientName: string; onDone: () => Promise<void>; setError: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedClient | null>(null);
  const [pending, start] = useTransition();
  if (!open) return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-graphite">Cliente: <span className="font-medium text-ink">{clientName}</span></span>
      <button type="button" className="text-gold-ink hover:underline pointer-coarse:min-h-11" onClick={() => setOpen(true)}>Trocar cliente</button>
    </div>
  );
  const save = () => start(async () => {
    if (!picked) return;
    const r = await setClientAction(comandaId, { client: picked.kind === "contato" ? { contactId: picked.contactId } : { name: picked.name, phone: picked.phone } });
    if (!r.ok) { setError(r.error); return; }
    setOpen(false); setPicked(null); await onDone();
  });
  return (
    <section aria-label="Trocar cliente" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line p-3">
      <ClientPicker value={picked} onChange={setPicked} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { setOpen(false); setPicked(null); }}>Cancelar</Button>
        <Button variant="secondary" disabled={!picked || pending} onClick={save}>Salvar cliente</Button>
      </div>
    </section>
  );
}

/** Somar item: na comanda aberta e na "Nova comanda" (que só nasce com o primeiro item: QA r58, I-8). `defaultProfessionalId`: a profissional da comanda (22/10). */
export function AddItem({ comanda, catalog, pending, onAdd, defaultProfessionalId = null }: { comanda: Pick<ComandaDetail, "contactId" | "day">; catalog: ComandaCatalog; pending: boolean; onAdd: (i: Record<string, unknown> & { kind: Kind }) => void; defaultProfessionalId?: string | null }) {
  const fid = useId();
  const [kind, setKind] = useState<Kind>("servico");
  const [serviceId, setServiceId] = useState("");
  const [pro, setPro] = useState(defaultProfessionalId ?? "");
  useEffect(() => { setPro(defaultProfessionalId ?? ""); }, [defaultProfessionalId]);
  const [label, setLabel] = useState("");
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [defId, setDefId] = useState("");
  const [pkgId, setPkgId] = useState("");
  const [pkgs, setPkgs] = useState<{ id: string; label: string; remaining: number; expired: boolean }[]>([]);
  useEffect(() => {
    if (kind !== "pacote_sessao" || !comanda.contactId) return;
    void clientPackagesAction(comanda.contactId, comanda.day).then((r) => setPkgs(r.ok ? r.data ?? [] : []));
  }, [kind, comanda.contactId, comanda.day]);
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => comanda.contactId || (k !== "pacote_venda" && k !== "pacote_sessao"));
  const catalogMode = !!catalog.estoqueLigado;
  /** Produto do catálogo com preço diferente do cadastrado: pede o motivo (como no serviço). */
  const productPriceChanged = kind === "produto" && catalogMode && !!price.trim() && parseMoneyInput(price) !== product?.priceCents;
  const addBlocked = kind === "produto" && catalogMode && (!product || (productPriceChanged && !reason.trim()));
  const submit = () => {
    const unitCents = price ? parseMoneyInput(price) : undefined;
    const why = reason.trim() ? { reason: reason.trim() } : {};
    if (kind === "servico") onAdd({ kind, serviceId, professionalId: pro || null, qty: 1, ...(unitCents != null ? { unitCents } : {}), ...why });
    else if (kind === "produto" && catalogMode) onAdd({ kind, productId: product!.id, qty: 1, ...(unitCents != null ? { unitCents } : {}), ...why, ...(pro ? { professionalId: pro } : {}) });
    else if (kind === "produto") onAdd({ kind, label, unitCents: unitCents ?? null, qty: 1, ...(pro ? { professionalId: pro } : {}) });
    else if (kind === "pacote_venda") onAdd({ kind, packageDefId: defId, qty: 1 });
    else onAdd({ kind, clientPackageId: pkgId, professionalId: pro || null, qty: 1 });
  };
  return (
    <section aria-label="Somar item" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line p-3">
      <Segmented label="Tipo do item" value={kind} onChange={(v) => setKind(v)} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
      {kind === "servico" && <ServicePicker services={catalog.services} proServices={catalog.proServices ?? {}} professionalId={pro || null} value={serviceId || null} onPick={(v) => setServiceId(v ?? "")} />}
      {kind === "produto" && catalogMode && <ProductPicker products={catalog.products ?? []} value={product} onPick={(p) => { setProduct(p); setPrice(""); setReason(""); }} />}
      {kind === "produto" && !catalogMode && <label className="flex flex-col gap-1 text-sm text-graphite">Produto<Input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} className="h-11" /></label>}
      {kind === "pacote_venda" && (
        <Select aria-label="Pacote" value={defId} onChange={(e) => setDefId(e.target.value)} className="h-11">
          <option value="">Escolher pacote</option>
          {catalog.packageDefs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.priceCents != null ? ` · ${money(p.priceCents)}` : ""}</option>)}
        </Select>
      )}
      {kind === "pacote_sessao" && (
        <Select aria-label="Pacote da cliente" value={pkgId} onChange={(e) => setPkgId(e.target.value)} className="h-11">
          <option value="">{pkgs.length ? "Escolher pacote" : "A cliente não tem pacote com sessão"}</option>
          {pkgs.map((p) => <option key={p.id} value={p.id} disabled={p.expired}>{p.label} · faltam {p.remaining}{p.expired ? " (vencido)" : ""}</option>)}
        </Select>
      )}
      {(kind === "servico" || kind === "pacote_sessao" || kind === "produto") && (
        <Select aria-label="Profissional" value={pro} onChange={(e) => setPro(e.target.value)} className="h-11">
          <option value="">{kind === "produto" ? "Profissional (opcional)" : "Escolher profissional"}</option>
          {catalog.professionals.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      {(kind === "servico" || kind === "produto") && (
        <div className={cn("grid gap-2", kind === "servico" && price && "sm:grid-cols-[9rem_1fr]")}>
          <label className="flex flex-col gap-1 text-sm text-graphite">Preço (R$)<Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={kind === "servico" ? "o do serviço" : catalogMode ? "o do produto" : ""} className="h-11 w-36" /></label>
          {(kind === "servico" || (kind === "produto" && catalogMode && productPriceChanged)) && price && (
            <div className="flex flex-col gap-1 text-sm text-graphite">
              <span className="flex items-baseline gap-1.5"><label htmlFor={`${fid}-motivo`}>Motivo do preço</label><span className="text-xs font-medium text-alert">obrigatório</span></span>
              <Input id={`${fid}-motivo`} value={reason} maxLength={300} aria-required="true" onChange={(e) => setReason(e.target.value)} className="h-11" />
            </div>
          )}
        </div>
      )}
      <Button variant="secondary" disabled={pending || addBlocked} onClick={submit}>Somar à comanda</Button>
    </section>
  );
}

/** A comanda ao lado da fila (Caixa no computador): título, estado e o corpo. */
export function ComandaPanel({ comandaId, catalog, onChanged }: { comandaId: string; catalog: ComandaCatalog; onChanged?: () => void }) {
  const { d, error, setError, load } = useComandaDetail(comandaId, true);
  const status = d?.status === "aberta" ? (d.remainingCents > 0 && d.paidCents > 0 ? "Com saldo" : "Aberta") : d?.status === "fechada" ? "Paga" : d ? "Cancelada" : "";
  return (
    <section aria-label={d ? `Comanda ${d.number} · ${d.clientName}` : "Comanda"} className="rounded-[var(--radius-card)] border border-line bg-paper">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{d ? `Comanda ${d.number} · ${d.clientName}` : "Comanda"}</h2>
        {d && <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", d.status === "aberta" ? "bg-gold-soft text-gold-ink" : d.status === "fechada" ? "bg-ok-soft text-ok" : "bg-paper-2 text-muted")}>{status}</span>}
      </header>
      <div className="px-5 py-4">
        {!d ? (error ? <p role="alert" className="text-sm text-alert">{error}</p> : <p className="text-sm text-muted">Carregando…</p>)
          : <ComandaBody d={d} catalog={catalog} error={error} setError={setError} reload={load} onChanged={onChanged} />}
      </div>
    </section>
  );
}
