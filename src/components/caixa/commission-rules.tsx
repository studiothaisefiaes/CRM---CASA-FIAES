"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { Segmented } from "@/components/ui/segmented";
import { applyCommissionCategoryAction, setCommissionAction } from "@/app/(app)/caixa/actions";
import { saveProCommissionRulesAction, setAssistantCommissionAction } from "@/app/(app)/caixa/comissao/actions";
import { DEDUCT_LABEL, effectiveRules, type CommissionRules as CasaRules, type DeductMode, type ProCommissionRules } from "@/lib/commission-rules";
import type { CommissionRuleRow } from "@/server/domain/caixa/commission";
import { bpToPercent, percentToBp } from "@/lib/comanda-math";

/** Caixa › Comissão › Regras (decisão 13): % por profissional nos serviços que ela faz, agrupados por categoria, com "Aplicar a …". */
export function CommissionRules({ rows, casa, assistentesLigado = true }: { rows: CommissionRuleRow[]; casa: CasaRules; assistentesLigado?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {!assistentesLigado && (
        <p role="status" className="rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">
          Assistente na comanda está desligado em <Link href="/config/caixa" className="underline">Configurações › Caixa</Link>. O % da assistente fica guardado, mas só vale quando ligar.
        </p>
      )}
      {rows.map((r) => <ProRules key={r.professionalId} row={r} casa={casa} />)}
    </div>
  );
}

const MODES = (Object.keys(DEDUCT_LABEL) as DeductMode[]).map((value) => ({ value, label: DEDUCT_LABEL[value] }));
const OWN = [["cartao", "Taxa do cartão"], ["antecipacao", "Antecipação"], ["custo", "Custo do serviço"]] as const;

/** "Segue a Casa" ou "Regra própria" (cartão, antecipação e custo). Começa pela regra da Casa; salvar manda os três ou null. */
function OwnRule({ row, casa }: { row: CommissionRuleRow; casa: CasaRules }) {
  const [own, setOwn] = useState(row.rules !== null);
  const [v, setV] = useState<ProCommissionRules>(() => { const e = effectiveRules(casa, row.rules); return { cartao: e.cartao, antecipacao: e.antecipacao, custo: e.custo }; });
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const save = () => start(async () => {
    const r = await saveProCommissionRulesAction(row.professionalId, own ? { cartao: v.cartao, antecipacao: v.antecipacao, custo: v.custo } : null);
    if (!r.ok) toast(r.error, "error"); else { toast(own ? `Regra própria de ${row.name} salva` : `${row.name} segue a regra da Casa`, "ok"); router.refresh(); }
  });
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-[var(--radius-control)] border border-line px-3 py-3">
      <Segmented label={`Regra de ${row.name}`} options={[{ value: "casa", label: "Segue a Casa" }, { value: "propria", label: "Regra própria" }]} value={own ? "propria" : "casa"} onChange={(x) => setOwn(x === "propria")} />
      {own && OWN.map(([k, label]) => (
        <div key={k} className="flex flex-col gap-1.5"><p className="text-sm text-graphite">{label}</p>
          <Segmented label={`${label} de ${row.name}`} options={MODES} value={v[k]} onChange={(m) => setV({ ...v, [k]: m })} /></div>
      ))}
      <div><Button size="sm" variant="secondary" loading={pending} onClick={save}>{`Salvar a regra de ${row.name}`}</Button></div>
    </div>
  );
}

function ProRules({ row, casa }: { row: CommissionRuleRow; casa: CasaRules }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const cats = [...new Set(row.services.map((s) => s.category?.trim() || "Outros"))];
  const save = (serviceId: string, text: string, before: number | null, assistant = false) => {
    const bp = text.trim() === "" ? null : percentToBp(text);
    if (text.trim() !== "" && bp == null) { toast("Use de 0% a 100%.", "error"); return; }
    if (bp === before) return;
    start(async () => {
      const input = { professionalId: row.professionalId, serviceId, bp };
      const r = await (assistant ? setAssistantCommissionAction(input) : setCommissionAction(input));
      if (!r.ok) toast(r.error, "error"); else router.refresh();
    });
  };
  return (
    <section aria-label={`Comissão de ${row.name}`} className="rounded-[var(--radius-card)] border border-line bg-paper p-4">
      <h2 className="mb-3 font-semibold">{row.name}{!row.active && <span className="ml-2 text-xs font-normal text-muted">desativada</span>}</h2>
      <OwnRule row={row} casa={casa} />
      {cats.map((cat) => <Category key={cat} cat={cat} row={row} pending={pending} onSave={save} onApply={(bp) => start(async () => {
        const r = await applyCommissionCategoryAction({ professionalId: row.professionalId, category: cat, bp });
        if (!r.ok) { toast(r.error, "error"); return; }
        toast(`${cat}: ${bp == null ? "sem regra" : `${bpToPercent(bp)}%`} em ${r.data!.updated} serviços`); router.refresh();
      })} />)}
    </section>
  );
}

function Category({ cat, row, pending, onSave, onApply }: { cat: string; row: CommissionRuleRow; pending: boolean; onSave: (serviceId: string, text: string, before: number | null, assistant?: boolean) => void; onApply: (bp: number | null) => void }) {
  const [all, setAll] = useState("");
  const toast = useToast();
  const services = row.services.filter((s) => (s.category?.trim() || "Outros") === cat);
  return (
    <div className="mb-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted">{cat}</h3>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-graphite">{`% para todos de ${cat}`}<Input inputMode="decimal" value={all} onChange={(e) => setAll(e.target.value)} className="h-9 w-20" /></label>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => {
            const bp = all.trim() === "" ? null : percentToBp(all);
            if (all.trim() !== "" && bp == null) { toast("Use de 0% a 100%.", "error"); return; }
            onApply(bp);
          }}>{`Aplicar a ${cat}`}</Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s) => <Percent key={s.serviceId} label={s.label} bp={s.bp} assistantBp={s.assistantBp} onCommit={(t) => onSave(s.serviceId, t, s.bp)} onCommitAssistant={(t) => onSave(s.serviceId, t, s.assistantBp, true)} />)}
      </div>
    </div>
  );
}

function Percent({ label, bp, assistantBp, onCommit, onCommitAssistant }: { label: string; bp: number | null; assistantBp: number | null; onCommit: (text: string) => void; onCommitAssistant: (text: string) => void }) {
  const [v, setV] = useState(bpToPercent(bp));
  const [a, setA] = useState(bpToPercent(assistantBp));
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
      <span className="min-w-0 truncate font-medium">{label}</span>
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-graphite">%
          <Input aria-label={`${label} (%)`} inputMode="decimal" value={v} placeholder="sem regra" onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} className="h-9 w-24 text-right" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-graphite">% da assistente
          <Input aria-label={`${label} (% da assistente)`} inputMode="decimal" value={a} placeholder="sem regra" onChange={(e) => setA(e.target.value)} onBlur={() => onCommitAssistant(a)} className="h-9 w-24 text-right" />
        </label>
      </div>
    </div>
  );
}
