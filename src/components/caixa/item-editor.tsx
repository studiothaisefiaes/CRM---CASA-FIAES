"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { money } from "@/lib/format";
import { moneyInputValue, parseMoneyInput } from "@/lib/money-input";

export type EditableItem = { id: string; label: string; qty: number; unitCents: number | null; discountCents: number; originalUnitCents: number | null };
export type ItemSave = { unitCents?: number; discountCents?: number; discountPercent?: number; reason?: string };

/**
 * Ajustar um item (decisão do dono, 17/10: todos podem): preço e desconto em R$ ou %. Mudar um preço que já existia ou dar desconto pede
 * o motivo, que vai para a auditoria com quem fez e o valor anterior. Preencher um preço que estava vazio não pede.
 */
export function ItemEditor({ item, pending, onSave, onCancel }: { item: EditableItem; pending: boolean; onSave: (p: ItemSave) => void; onCancel: () => void }) {
  const id = useId();
  const [price, setPrice] = useState(moneyInputValue(item.unitCents));
  const [mode, setMode] = useState<"rs" | "pct">("rs");
  const [disc, setDisc] = useState(item.discountCents ? moneyInputValue(item.discountCents) : "");
  const [reason, setReason] = useState("");
  const priceCents = price.trim() ? parseMoneyInput(price) : null;
  const pct = mode === "pct" && disc.trim() ? Number(disc.replace(",", ".")) : null;
  const discCents = mode === "rs" ? (disc.trim() ? parseMoneyInput(disc) : 0) : null;
  const priceChanged = priceCents != null && priceCents !== item.unitCents;
  const discChanged = mode === "pct" ? pct != null && pct > 0 : discCents != null && discCents !== item.discountCents;
  const needsReason = (priceChanged && item.unitCents != null) || (discChanged && (mode === "pct" ? (pct ?? 0) > 0 : (discCents ?? 0) > 0));
  const invalid = (price.trim() && priceCents == null) || (mode === "rs" && discCents == null) || (mode === "pct" && disc.trim() && !(pct != null && pct >= 0 && pct <= 100));
  const nothing = !priceChanged && !discChanged;
  /** Por que o Salvar está cinza (QA r58, I-7; P16 do Registrar ligação): a frase fica embaixo, ligada ao botão. */
  const missing = invalid ? "Para salvar, confira os valores." : nothing ? "Para salvar, mude o preço ou o desconto." : needsReason && !reason.trim() ? "Para salvar, escreva o motivo." : null;
  const save = () => {
    const p: ItemSave = {};
    if (priceChanged) p.unitCents = priceCents!;
    if (discChanged) { if (mode === "pct") p.discountPercent = pct!; else p.discountCents = discCents!; }
    if (needsReason) p.reason = reason.trim();
    onSave(p);
  };
  return (
    <div className="mt-2 grid gap-2 rounded-[var(--radius-control)] bg-paper-2/70 p-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-graphite">{`Preço de ${item.label} (R$)`}
        <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="h-10" />
        {item.originalUnitCents != null && item.originalUnitCents !== item.unitCents && <span className="text-muted">{`Tabela: ${moneyInputValue(item.originalUnitCents)}`}</span>}
      </label>
      {item.unitCents != null && (
        <div className="flex flex-col gap-1 text-xs text-graphite">
          <span className="flex items-center justify-between gap-2">Desconto
            <Segmented label="Desconto em" value={mode} onChange={(v) => { setMode(v); setDisc(""); }} options={[{ value: "rs", label: "R$" }, { value: "pct", label: "%" }]} className="[&_button]:h-7 [&_button]:px-2.5 [&_button]:text-xs" />
          </span>
          <Input aria-label={`Desconto em ${item.label} (${mode === "pct" ? "%" : "R$"})`} inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} className="h-10" placeholder={mode === "pct" ? "ex.: 10" : "0,00"} />
        </div>
      )}
      {needsReason && (
        <div className="flex flex-col gap-1 text-xs text-graphite sm:col-span-2">
          <span className="flex items-baseline gap-1.5"><label htmlFor={`${id}-m`}>Motivo</label><span className="text-xs font-medium text-alert">obrigatório</span></span>
          <Input id={`${id}-m`} value={reason} maxLength={300} aria-required="true" onChange={(e) => setReason(e.target.value)} className="h-10" placeholder="ex.: cliente antiga, promoção do mês" />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
        {missing && <p id={`${id}-falta`} className="mr-auto text-xs text-graphite">{missing}</p>}
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={pending || !!missing} aria-describedby={missing ? `${id}-falta` : undefined} onClick={save}>Salvar</Button>
      </div>
    </div>
  );
}

export type CatalogProduct = { id: string; name: string; priceCents: number | null; barcode: string | null; stockQty: number };
const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const stockText = (n: number) => `${Number.isInteger(n) ? n : n.toLocaleString("pt-BR")} em estoque`;

/**
 * Escolher o produto do catálogo na comanda (Produtos e estoque ligado): busca por nome ou código de barras. O preço e o nome vêm do
 * catálogo. Sem estoque não trava: avisa que a venda fecha e o estoque fica negativo.
 */
export function ProductPicker({ products, value, onPick }: { products: CatalogProduct[]; value: CatalogProduct | null; onPick: (p: CatalogProduct | null) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  if (value) {
    return (
      <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-base font-medium text-ink">{value.name}</span>
          <button type="button" onClick={() => onPick(null)} className="shrink-0 text-sm font-medium text-gold-ink underline underline-offset-4">Trocar</button>
        </div>
        <p className="text-sm text-graphite tabular-nums">{value.priceCents != null ? money(value.priceCents) : "Sem preço no catálogo"} · {stockText(value.stockQty)}</p>
        {value.stockQty <= 0 && <p role="status" className="text-sm text-alert">Sem estoque: a venda fecha e o estoque fica negativo.</p>}
      </div>
    );
  }
  const t = fold(q.trim());
  const found = (t ? products.filter((p) => fold(p.name).includes(t) || (p.barcode ?? "").includes(q.trim())) : products).slice(0, 8);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-q`} className="sr-only">Buscar produto</label>
      <Input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto por nome ou código de barras" autoComplete="off" className="h-11" />
      {found.length ? (
        <ul role="listbox" aria-label="Produtos" className="divide-y divide-line/70 rounded-[var(--radius-control)] border border-line">
          {found.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onPick(p)} className="flex min-h-11 w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-paper-2/60">
                <span className="min-w-0 text-base text-ink">{p.name}</span>
                <span className="shrink-0 text-sm text-graphite tabular-nums">{p.priceCents != null ? money(p.priceCents) : "sem preço"} · {p.stockQty}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{q.trim() ? `Nenhum produto com “${q.trim()}”.` : "Nenhum produto cadastrado ainda."}</p>}
    </div>
  );
}
