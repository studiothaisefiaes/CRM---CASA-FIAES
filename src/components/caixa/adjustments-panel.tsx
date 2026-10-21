"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { addAdjustmentAction, cancelAdjustmentAction, saveAdjustmentRuleAction } from "@/app/(app)/caixa/comissao/actions";
import { ADJUSTMENT_KINDS, ADJUSTMENT_LABEL, type AdjustmentKind, type AdjustmentRow, type AdjustmentRuleRow } from "@/lib/adjustments";
import { money } from "@/lib/format";
import { parseMoneyInput } from "@/lib/money-input";

const KIND_OPTIONS = ADJUSTMENT_KINDS.map((value) => ({ value, label: ADJUSTMENT_LABEL[value] }));
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const br = (d: string) => d.split("-").reverse().join("/");

/** Caixa › Comissão › Lançamentos: vale, bônus e desconto na comissão do período, avulsos ou "todo mês". Só com `comissao.lancar`. */
export function AdjustmentsPanel({ rows, rules, professionals, from, to, today }: {
  rows: AdjustmentRow[]; rules: AdjustmentRuleRow[]; professionals: { id: string; name: string }[]; from: string; to: string; today: string;
}) {
  const live = rows.filter((r) => !r.cancelledAt);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {ADJUSTMENT_KINDS.map((k) => (
          <p key={k} className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-3 text-sm text-graphite">
            {ADJUSTMENT_LABEL[k]}
            <span data-testid={`total-${k}`} className="mt-1 block text-lg font-semibold text-ink tabular">{money(live.filter((r) => r.kind === k).reduce((a, r) => a + r.valueCents, 0))}</span>
          </p>
        ))}
      </div>
      <NewAdjustment professionals={professionals} today={today} />
      <section aria-label="Lançamentos do período" className="rounded-[var(--radius-card)] border border-line bg-paper">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{`Lançamentos de ${br(from)} a ${br(to)}`}</h2>
        {rows.length === 0 ? <p className="px-4 py-4 text-sm text-graphite">Nada lançado no período.</p> : (
          <ul className="divide-y divide-line">{rows.map((r) => <Line key={r.id} r={r} />)}</ul>
        )}
      </section>
      {rules.length > 0 && (
        <section aria-label="Todo mês" className="rounded-[var(--radius-card)] border border-line bg-paper">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Todo mês</h2>
          <ul className="divide-y divide-line">{rules.map((r) => <RuleLine key={r.id} r={r} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Line({ r }: { r: AdjustmentRow }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const cancel = () => start(async () => {
    const res = await cancelAdjustmentAction(r.id, { reason });
    if (!res.ok) { setError(res.error); return; }
    toast("Lançamento cancelado"); router.refresh();
  });
  const sign = r.kind === "bonus" ? "+" : "−";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <div className={r.cancelledAt ? "text-muted line-through" : ""}>
        <p className="font-medium">{`${r.professionalName} · ${ADJUSTMENT_LABEL[r.kind]} · ${br(r.day)}`}</p>
        <p className="text-graphite">{r.note}{r.createdByName ? ` · ${r.createdByName}` : ""}</p>
      </div>
      <div className="flex items-center gap-3">
        {r.cancelledAt && <span className="text-xs text-muted">Cancelado</span>}
        {r.fromSangria && <span className="text-xs text-graphite">Pela sangria</span>}
        {r.ruleId && <span className="text-xs text-graphite">Todo mês</span>}
        {r.paid && <span className="text-xs text-graphite">Já pago</span>}
        <span className="font-semibold tabular">{`${sign} ${money(r.valueCents)}`}</span>
        {!r.cancelledAt && !r.paid && !r.fromSangria && !asking && <Button variant="secondary" aria-label={`Cancelar lançamento de ${r.note}`} onClick={() => setAsking(true)}>Cancelar</Button>}
      </div>
      {asking && (
        <div className="flex w-full flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-graphite">Motivo do cancelamento<Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <Button loading={pending} onClick={cancel}>Confirmar cancelamento</Button>
          {error && <p role="alert" className="w-full text-sm text-alert">{error}</p>}
        </div>
      )}
    </li>
  );
}

function RuleLine({ r }: { r: AdjustmentRuleRow }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const toggle = () => start(async () => {
    const res = await saveAdjustmentRuleAction({ id: r.id, professionalId: r.professionalId, kind: r.kind, valueCents: r.valueCents, dayOfMonth: r.dayOfMonth, startsOn: r.startsOn, endsOn: r.endsOn, note: r.note, active: !r.active });
    if (!res.ok) { toast(res.error, "error"); return; }
    toast(r.active ? "Desligado" : "Ligado"); router.refresh();
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <div className={r.active ? "" : "text-muted"}>
        <p className="font-medium">{`${r.professionalName} · ${ADJUSTMENT_LABEL[r.kind]} · ${money(r.valueCents)}`}</p>
        <p className="text-graphite">{`Todo dia ${r.dayOfMonth}, desde ${br(r.startsOn)}${r.endsOn ? ` até ${br(r.endsOn)}` : ""} · ${r.note}`}{r.active ? "" : " · desligado"}</p>
      </div>
      <Button variant="secondary" loading={pending} aria-label={`${r.active ? "Desligar" : "Ligar"} ${r.note}`} onClick={toggle}>{r.active ? "Desligar" : "Ligar"}</Button>
    </li>
  );
}

function NewAdjustment({ professionals, today }: { professionals: { id: string; name: string }[]; today: string }) {
  const [pro, setPro] = useState(professionals[0]?.id ?? "");
  const [kind, setKind] = useState<AdjustmentKind>("vale");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today);
  const [monthly, setMonthly] = useState(false);
  const [dom, setDom] = useState(5);
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const submit = () => start(async () => {
    setError(null);
    const cents = parseMoneyInput(value);
    if (!pro) { setError("Escolha a profissional."); return; }
    if (!cents) { setError("Digite um valor maior que zero."); return; }
    if (!note.trim()) { setError("Escreva o motivo."); return; }
    const r = monthly
      ? await saveAdjustmentRuleAction({ professionalId: pro, kind, valueCents: cents, dayOfMonth: dom, startsOn: day, endsOn: endsOn || null, note, active: true })
      : await addAdjustmentAction({ professionalId: pro, kind, valueCents: cents, day, note });
    if (!r.ok) { setError(r.error); return; }
    toast(monthly ? "Lançamento todo mês salvo" : "Lançado"); setValue(""); setNote(""); router.refresh();
  });
  return (
    <section aria-label="Novo lançamento" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <h2 className="text-sm font-semibold">Novo lançamento</h2>
      <Segmented label="Tipo" options={KIND_OPTIONS} value={kind} onChange={setKind} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-graphite">Profissional
          <Select value={pro} onChange={(e) => setPro(e.target.value)}>{professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Valor (R$)<Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm text-graphite">{monthly ? "Começa em" : "Data"}<Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-graphite">Motivo<Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="ex.: adiantamento, meta de pacotes" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />Todo mês</label>
      {monthly && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-graphite">No dia
            <Select value={String(dom)} onChange={(e) => setDom(Number(e.target.value))}>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-sm text-graphite">Termina em (opcional)<Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></label>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      <div><Button loading={pending} onClick={submit}>Lançar</Button></div>
    </section>
  );
}
