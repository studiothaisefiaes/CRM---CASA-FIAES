"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { applyReapplyAction, previewReapplyAction } from "@/app/(app)/caixa/comissao/actions";
import { setCommissionAction } from "@/app/(app)/caixa/actions";
import { percentToBp } from "@/lib/comanda-math";
import { formatBRL } from "@/lib/money";
import type { MissingRule, ReapplyPreview } from "@/server/domain/caixa/commission-reapply";

const brDay = (d: string) => d.split("-").reverse().join("/");
const itensText = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;

/**
 * Aplicar a regra de hoje às comandas já fechadas do período: primeiro a prévia ("o que mudaria"), depois a confirmação. O que já foi pago
 * em recibo não muda.
 */
export function ApplyClosed({ from, to, professionalId = null, label = "Aplicar às comandas já fechadas deste período" }: { from: string; to: string; professionalId?: string | null; label?: string }) {
  const [range, setRange] = useState({ from, to });
  const [preview, setPreview] = useState<ReapplyPreview | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const input = { ...range, professionalId };
  const look = () => start(async () => {
    const r = await previewReapplyAction(input);
    if (!r.ok) { toast(r.error, "error"); return; }
    setPreview(r.data ?? null);
  });
  const apply = () => start(async () => {
    const r = await applyReapplyAction(input);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`Regra aplicada: ${itensText(r.data?.items ?? 0)} em ${r.data?.comandas ?? 0} comandas`, "ok");
    setPreview(null);
    router.refresh();
  });
  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper px-4 py-4">
      <h3 className="text-md font-medium">{label}</h3>
      <p className="text-sm text-graphite">Usa a regra de hoje nas comandas fechadas do período que ainda não foram pagas em recibo. O que já foi pago não muda.</p>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 text-graphite">De<Input type="date" aria-label="De" value={range.from} className="h-10 w-40" onChange={(e) => { setRange({ ...range, from: e.target.value }); setPreview(null); }} /></label>
        <label className="flex flex-col gap-1 text-graphite">Até<Input type="date" aria-label="Até" value={range.to} className="h-10 w-40" onChange={(e) => { setRange({ ...range, to: e.target.value }); setPreview(null); }} /></label>
        <Button size="md" variant="secondary" loading={pending && !preview} onClick={look}>Ver o que mudaria</Button>
      </div>
      {preview && (preview.items === 0
        ? <p role="status" className="text-sm text-graphite">Nada mudaria neste período ({brDay(range.from)} a {brDay(range.to)}).</p>
        : (
          <div role="status" className="flex flex-col gap-2 text-sm">
            <p>{`Mudaria ${itensText(preview.items)} em ${preview.comandas} ${preview.comandas === 1 ? "comanda" : "comandas"}:`}</p>
            <ul className="divide-y divide-line/70 rounded-[var(--radius-control)] border border-line bg-white">
              {preview.byProfessional.map((p) => (
                <li key={p.professionalId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <span className="font-medium">{p.name} <span className="font-normal text-graphite">· {itensText(p.items)}</span></span>
                  <span className="tabular">{formatBRL(p.beforeCents)} → {formatBRL(p.afterCents)}</span>
                </li>
              ))}
            </ul>
            <div><Button size="md" loading={pending} onClick={apply}>Confirmar e aplicar</Button></div>
          </div>
        ))}
    </section>
  );
}

function GapRow({ gap, from, to, canEdit }: { gap: MissingRule; from: string; to: string; canEdit: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const where = `${gap.professionalName}${gap.serviceLabel ? ` no serviço ${gap.serviceLabel}` : ""}`;
  const define = () => start(async () => {
    const bp = percentToBp(text);
    if (bp == null || !gap.serviceId) { toast("Digite o % de 0 a 100.", "error"); return; }
    const r = await setCommissionAction({ professionalId: gap.professionalId, serviceId: gap.serviceId, bp });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`Regra de ${gap.professionalName} salva. Aplique às comandas já fechadas.`, "ok");
    router.refresh();
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <p className="text-md"><span className="font-medium">Falta definir a regra de comissão de {where}.</span>{" "}
        <span className="text-graphite">{itensText(gap.items)} sem regra · base {formatBRL(gap.baseCents)}.</span></p>
      {canEdit && !gap.hasRuleNow && gap.serviceId && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pct-${gap.professionalId}-${gap.serviceId}`}>{`% de ${gap.professionalName} em ${gap.serviceLabel}`}</label>
          <Input id={`pct-${gap.professionalId}-${gap.serviceId}`} inputMode="decimal" placeholder="%" value={text} className="h-10 w-24" onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} />
          <Button size="md" loading={pending} disabled={!text} onClick={define}>Definir regra</Button>
        </div>
      )}
      {gap.hasRuleNow && canEdit && <ApplyClosed from={from} to={to} professionalId={gap.professionalId} label={`Aplicar a regra de ${gap.professionalName} às comandas já fechadas`} />}
      {!canEdit && <p className="text-sm text-graphite">Só quem edita as regras de comissão define isto.</p>}
    </li>
  );
}

/** "A pagar" com comissão sem regra: em vez de "Nada a pagar", diz o que falta e dá o botão para definir (psico r68 #19). */
export function MissingRules({ gaps, from, to, canEdit }: { gaps: MissingRule[]; from: string; to: string; canEdit: boolean }) {
  if (!gaps.length) return null;
  return (
    <section aria-label="Falta definir regra de comissão" className="mb-6 overflow-hidden rounded-[var(--radius-card)] border border-gold bg-gold-soft/40">
      <h2 className="px-4 pt-4 text-lg font-semibold">Falta definir a regra de comissão</h2>
      <p className="px-4 pb-2 text-sm text-graphite">Enquanto não houver regra, estas comissões não entram no que falta pagar.</p>
      <ul className="divide-y divide-line/70">{gaps.map((g) => <GapRow key={`${g.professionalId}:${g.serviceId ?? g.serviceLabel}`} gap={g} from={from} to={to} canEdit={canEdit} />)}</ul>
      {canEdit && <p className="px-4 pb-4 pt-2 text-sm"><Link href="/caixa/comissao?aba=regras" className="font-medium text-gold-ink underline underline-offset-4">Ver todas as regras</Link></p>}
    </section>
  );
}
