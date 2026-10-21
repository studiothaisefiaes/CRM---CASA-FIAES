"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { bpToPercent, CARD_BRAND_LABEL, CARD_BRANDS, percentToBp, type CardBrand } from "@/lib/comanda-math";
import { savePaymentFeeAction } from "@/app/(app)/servicos/actions";

export type CardFee = { method: "credito" | "debito"; brand: string; parcelado: boolean; feeBp: number };
const MAIN: CardBrand[] = ["visa", "mastercard", "elo", "hipercard", "amex"];
const COLS = [
  { key: "debito", label: "Débito", method: "debito", parcelado: false },
  { key: "avista", label: "Crédito à vista", method: "credito", parcelado: false },
  { key: "parcelado", label: "Crédito parcelado", method: "credito", parcelado: true },
] as const;
const cellKey = (method: string, brand: string, parcelado: boolean) => `${method}|${brand}|${parcelado ? 1 : 0}`;
const brandName = (b: string) => CARD_BRAND_LABEL[b as CardBrand] ?? b;

/**
 * Serviços › Formas de pagamento › Taxas do cartão: a taxa que a Casa paga por bandeira e parcela. Vale só para os pagamentos novos
 * (cada pagamento guarda a taxa do momento). Célula vazia = sem taxa cadastrada. Quem não tem "Mudar as taxas do cartão" só vê.
 */
export function CardFeesEditor({ fees, canEdit = true }: { fees: CardFee[]; canEdit?: boolean }) {
  const saved = new Map(fees.map((f) => [cellKey(f.method, f.brand, f.parcelado), f.feeBp]));
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(fees.map((f) => [cellKey(f.method, f.brand, f.parcelado), bpToPercent(f.feeBp)])));
  const [extra, setExtra] = useState<string[]>([]);
  const [, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const others = [...new Set(fees.map((f) => f.brand).filter((b) => !(MAIN as string[]).includes(b)))];
  const brands: string[] = [...MAIN, ...others, ...extra.filter((b) => !others.includes(b))];
  const addable = CARD_BRANDS.filter((b) => !brands.includes(b));

  const commit = (method: "credito" | "debito", brand: string, parcelado: boolean) => {
    const k = cellKey(method, brand, parcelado);
    const text = (vals[k] ?? "").trim();
    const before = saved.get(k) ?? null;
    const bp = text === "" ? null : percentToBp(text);
    if (text !== "" && bp == null) { toast("Use de 0% a 100%.", "error"); setVals((v) => ({ ...v, [k]: bpToPercent(before) })); return; }
    if (bp === before) return;
    start(async () => {
      const r = await savePaymentFeeAction({ method, brand, parcelado, feeBp: bp });
      if (!r.ok) { toast(r.error, "error"); setVals((v) => ({ ...v, [k]: bpToPercent(before) })); return; }
      toast("Taxa salva");
      router.refresh();
    });
  };

  return (
    <section aria-label="Taxas do cartão" className="flex max-w-2xl flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Taxas do cartão</h2>
        <p className="mt-0.5 text-sm text-graphite">O que a maquininha cobra da Casa, em %. Vale só para os pagamentos novos; o que já foi recebido guarda a taxa do dia. Bandeira sem taxa entra sem desconto.</p>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-paper">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-medium">Bandeira</th>
              {COLS.map((c) => <th key={c.key} scope="col" className="px-2 py-2 font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {brands.map((b) => (
              <tr key={b}>
                <th scope="row" className="px-4 py-2 text-left font-medium">{brandName(b)}</th>
                {COLS.map((c) => {
                  const k = cellKey(c.method, b, c.parcelado);
                  return (
                    <td key={c.key} className="px-2 py-1.5">
                      <Input aria-label={`${brandName(b)} ${c.label}`} inputMode="decimal" value={vals[k] ?? ""} placeholder="—" disabled={!canEdit} readOnly={!canEdit} className="h-10 w-24"
                        onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} onBlur={() => canEdit && commit(c.method, b, c.parcelado)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && addable.length > 0 && (
        <label className="flex max-w-xs flex-col gap-1 text-sm text-graphite">Adicionar bandeira
          <Select value="" onChange={(e) => { if (e.target.value) setExtra((x) => [...x, e.target.value]); }} className="h-10 pointer-coarse:h-11">
            <option value="">Escolher</option>
            {addable.map((b) => <option key={b} value={b}>{brandName(b)}</option>)}
          </Select>
        </label>
      )}
      {!canEdit && <p className="text-xs text-muted">Só quem tem a permissão de mudar as taxas do cartão pode editar.</p>}
    </section>
  );
}
