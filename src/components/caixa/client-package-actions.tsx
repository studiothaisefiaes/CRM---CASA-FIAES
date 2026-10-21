"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { extendPackageAction, setPackageSessionValueAction } from "@/app/(app)/caixa/actions";
import type { AttentionPackage } from "@/server/queries/caixa";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/** Pacotes das clientes que pedem a gestão: vencidos com sessão (dar novo prazo, `caixa.gerir`) e sem valor por sessão (`config.sistema`). */
export function ClientPackageActions({ vencidos, semValor, canExtend, canValue }: { vencidos: AttentionPackage[]; semValor: AttentionPackage[]; canExtend: boolean; canValue: boolean }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {canExtend && <List title="Vencidos com sessão" empty="Nenhum pacote vencido com sessão." items={vencidos} render={(p) => <Extend p={p} />} />}
      {canValue && <List title="Sem valor por sessão" empty="Todos os pacotes têm valor por sessão." items={semValor} render={(p) => <Unit p={p} />} />}
    </div>
  );
}

function List({ title, empty, items, render }: { title: string; empty: string; items: AttentionPackage[]; render: (p: AttentionPackage) => React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-line bg-paper">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">{title} · {items.length}</h2>
      {items.length ? <ul className="divide-y divide-line/70">{items.map((p) => <li key={p.id} className="px-4 py-3">{render(p)}</li>)}</ul> : <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>}
    </section>
  );
}

const Head = ({ p }: { p: AttentionPackage }) => (
  <p className="text-sm"><span className="font-medium">{p.clientName}</span> · {p.packageName}{p.serviceLabel ? ` (${p.serviceLabel})` : ""} · faltam {p.remaining}{p.validUntil ? ` · venceu em ${DM.format(new Date(`${p.validUntil}T12:00:00Z`))}` : ""}</p>
);

function Extend({ p }: { p: AttentionPackage }) {
  const [day, setDay] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2"><Head p={p} />
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-graphite">Novo prazo<Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-10" /></label>
        <Button size="sm" variant="secondary" loading={pending} disabled={!day} onClick={() => start(async () => { const r = await extendPackageAction(p.id, { validUntil: day }); toast(r.ok ? "Novo prazo dado" : r.error, r.ok ? "ok" : "error"); router.refresh(); })}>Dar novo prazo</Button>
      </div>
    </div>
  );
}

function Unit({ p }: { p: AttentionPackage }) {
  const [v, setV] = useState(moneyInputValue(p.unitCents));
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2"><Head p={p} />
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-graphite">Valor por sessão (R$)<Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} className="h-10 w-28" /></label>
        <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { const c = parseMoneyInput(v); if (c == null) { toast("Digite o valor.", "error"); return; } const r = await setPackageSessionValueAction(p.id, c); toast(r.ok ? "Valor salvo" : r.error, r.ok ? "ok" : "error"); router.refresh(); })}>Salvar</Button>
      </div>
    </div>
  );
}
