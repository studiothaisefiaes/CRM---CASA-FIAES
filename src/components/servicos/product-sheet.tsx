"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { movimentarEstoque, movimentosDoProduto, salvarProduto } from "@/app/(app)/servicos/actions";
import { formatBRL, parseBRL } from "@/lib/money";
import { qtyText } from "@/lib/estoque-view";
import type { ProductRow, StockMovementRow } from "@/server/domain/estoque/produtos";


const centsText = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const REASON: Record<string, string> = { venda: "Venda", entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", saldo_avec: "Saldo do Avec" };
type Kind = "entrada" | "saida" | "ajuste";
const KINDS: [Kind, string][] = [["entrada", "Entrada"], ["saida", "Saída"], ["ajuste", "Ajustar"]];

/**
 * Folha do produto, um bloco por pergunta: "Dados" (o que é e quanto custa), "Nota fiscal" (NCM, código de barras, CFOP e CSOSN; o produto
 * novo vem com o CFOP e o CSOSN padrão de Configurações › Estoque) e "Estoque" (quanto tem, os últimos 20 movimentos e Entrada / Saída / Ajustar).
 * `can.produtos` muda os dados; `can.movimentar` mexe no estoque.
 */
export function ProductSheet({ open, product, categories, can, padrao, onClose }: {
  open: boolean; product: ProductRow | null; categories: string[]; can: { produtos: boolean; movimentar: boolean }; padrao?: { cfop: string; csosn: string }; onClose: () => void;
}) {
  const p = product;
  const edit = can.produtos;
  const [name, setName] = useState(p?.name ?? "");
  const [brand, setBrand] = useState(p?.brand ?? "");
  const [cat, setCat] = useState(p?.category ?? "");
  const [price, setPrice] = useState(centsText(p?.priceCents ?? null));
  const [cost, setCost] = useState(centsText(p?.costCents ?? null));
  const [use, setUse] = useState<"venda" | "consumo">(p?.use === "consumo" ? "consumo" : "venda");
  const [min, setMin] = useState(p?.minQty != null ? String(p.minQty).replace(".", ",") : "");
  const [ncm, setNcm] = useState(p?.ncm ?? "");
  const [barcode, setBarcode] = useState(p?.barcode ?? "");
  const [cfop, setCfop] = useState(p?.cfop ?? padrao?.cfop ?? "");
  const [csosn, setCsosn] = useState(p?.csosn ?? padrao?.csosn ?? "");
  const [active, setActive] = useState(p?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const save = () => {
    setError(null);
    let priceCents: number | null = null, costCents: number | null = null;
    if (price.trim()) { const r = parseBRL(price); if (!r.ok) { setError(`Preço: ${r.error}`); return; } priceCents = r.cents; }
    if (cost.trim()) { const r = parseBRL(cost); if (!r.ok) { setError(`Custo: ${r.error}`); return; } costCents = r.cents; }
    const minQty = min.trim() ? Number(min.replace(",", ".")) : null;
    if (minQty != null && !Number.isFinite(minQty)) { setError("O estoque mínimo é um número."); return; }
    if (cfop && cfop.length !== 4) { setError("O CFOP tem 4 números."); return; }
    if (csosn && csosn.length !== 3) { setError("O CSOSN tem 3 números."); return; }
    start(async () => {
      const r = await salvarProduto({ ...(p ? { id: p.id } : {}), name, brand: brand || null, category: cat || null, barcode: barcode || null, ncm: ncm || null, cfop: cfop || null, csosn: csosn || null, priceCents, costCents, use, minQty, ...(p ? { active } : {}) });
      if (!r.ok) { setError(r.error); return; }
      toast(`${name.trim()} ${p ? "salvo" : "cadastrado"}`, "ok"); router.refresh(); onClose();
    });
  };

  const footer = edit ? (
    <>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="gold" onClick={save} loading={pending} disabled={!name.trim()}>{p ? "Salvar" : "Cadastrar produto"}</Button>
    </>
  ) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={p?.name ?? "Novo produto"} footer={footer} className="max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="pr-dados" className="flex flex-col gap-4">
          <h2 id="pr-dados" className="text-lg font-semibold">Dados</h2>
          {edit ? (
            <>
              <Field label="Nome" htmlFor="pr-nome"><Input id="pr-nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Shampoo Hidratante 300 ml" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Marca" htmlFor="pr-marca"><Input id="pr-marca" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} /></Field>
                <Field label="Categoria" htmlFor="pr-cat"><Input id="pr-cat" list="pr-cats" value={cat} onChange={(e) => setCat(e.target.value)} maxLength={120} /><datalist id="pr-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
                <Field label="Preço (R$)" htmlFor="pr-preco" hint="Vazio = sem preço"><Input id="pr-preco" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="tabular-nums" /></Field>
                <Field label="Custo (R$)" htmlFor="pr-custo"><Input id="pr-custo" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" className="tabular-nums" /></Field>
                <Field label="Uso" htmlFor="pr-uso" hint={use === "consumo" ? "Consumo: usado no atendimento, não aparece para vender." : "Venda: aparece na comanda."}>
                  <Select id="pr-uso" value={use} onChange={(e) => setUse(e.target.value === "consumo" ? "consumo" : "venda")}><option value="venda">Venda</option><option value="consumo">Consumo</option></Select>
                </Field>
                <Field label="Estoque mínimo" htmlFor="pr-min" hint="Abaixo disso, o produto aparece em Abaixo do mínimo."><Input id="pr-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Ex.: 5" className="tabular-nums" /></Field>
              </div>
              {p && (
                <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
                  <div>
                    <p className="text-base font-medium text-ink">{active ? "Ativo" : "Desativado"}</p>
                    <p className="text-sm text-muted">{active ? "Aparece na comanda." : "Some da comanda. O histórico e o estoque ficam."}</p>
                  </div>
                  <Switch checked={active} onChange={setActive} label={active ? "Desativar o produto" : "Ativar o produto"} />
                </div>
              )}
            </>
          ) : p && (
            <dl className="grid gap-3 text-base sm:grid-cols-2">
              <Info label="Marca" value={p.brand} /><Info label="Categoria" value={p.category} />
              <Info label="Preço" value={p.priceCents == null ? null : formatBRL(p.priceCents)} /><Info label="Custo" value={p.costCents == null ? null : formatBRL(p.costCents)} />
              <Info label="Uso" value={p.use === "consumo" ? "Consumo" : "Venda"} /><Info label="Estoque mínimo" value={p.minQty == null ? null : qtyText(p.minQty)} />
            </dl>
          )}
        </section>

        <section aria-labelledby="pr-nota" className="flex flex-col gap-4">
          <h2 id="pr-nota" className="text-lg font-semibold">Nota fiscal</h2>
          {edit ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="NCM" htmlFor="pr-ncm" hint="8 números. Vazio se ainda não souber."><Input id="pr-ncm" inputMode="numeric" value={ncm} onChange={(e) => setNcm(e.target.value.replace(/\D/g, "").slice(0, 8))} className="tabular-nums" /></Field>
              <Field label="Código de barras" htmlFor="pr-barras"><Input id="pr-barras" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} maxLength={60} className="tabular-nums" /></Field>
              <Field label="CFOP" htmlFor="pr-cfop" hint="4 números. Vazio = o padrão de Configurações › Estoque."><Input id="pr-cfop" inputMode="numeric" value={cfop} onChange={(e) => setCfop(e.target.value.replace(/\D/g, "").slice(0, 4))} className="tabular-nums" /></Field>
              <Field label="CSOSN" htmlFor="pr-csosn" hint="3 números. O contador confere."><Input id="pr-csosn" inputMode="numeric" value={csosn} onChange={(e) => setCsosn(e.target.value.replace(/\D/g, "").slice(0, 3))} className="tabular-nums" /></Field>
            </div>
          ) : p && <dl className="grid gap-3 text-base sm:grid-cols-2"><Info label="NCM" value={p.ncm} /><Info label="Código de barras" value={p.barcode} /><Info label="CFOP" value={p.cfop} /><Info label="CSOSN" value={p.csosn} /></dl>}
          {p ? (
            <dl className="grid gap-3 text-base sm:grid-cols-3"><Info label="Unidade" value={p.unit} /></dl>
          ) : <p className="text-sm text-muted">A unidade nasce com o padrão de Configurações › Estoque.</p>}
          {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
        </section>

        {p && <StockBlock key={p.id} p={p} canMove={can.movimentar} />}
      </div>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return <div><dt className="text-sm text-graphite">{label}</dt><dd className="text-base text-ink">{value || "—"}</dd></div>;
}

/** Estoque do produto: posição, últimos 20 movimentos e Entrada / Saída / Ajustar (só com estoque.movimentar). */
function StockBlock({ p, canMove }: { p: ProductRow; canMove: boolean }) {
  const [moves, setMoves] = useState<StockMovementRow[] | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const load = useCallback(() => movimentosDoProduto(p.id).then((r) => setMoves(r.ok ? r.data ?? [] : [])), [p.id]);
  useEffect(() => { void load(); }, [load]);

  const qtyN = qty.trim() ? Number(qty.replace(",", ".")) : NaN;
  const qtyOk = Number.isFinite(qtyN) && (kind === "ajuste" ? qtyN >= 0 : qtyN > 0);
  const needsNote = kind !== "entrada";
  const submit = () => {
    if (!kind) return;
    setError(null);
    let unitCostCents: number | null = null;
    if (kind === "entrada" && cost.trim()) { const c = parseBRL(cost); if (!c.ok) { setError(`Custo: ${c.error}`); return; } unitCostCents = c.cents; }
    start(async () => {
      const r = await movimentarEstoque({ productId: p.id, kind, qty: qtyN, unitCostCents, note: note.trim() || null });
      if (!r.ok) { setError(r.error); return; }
      toast("Estoque atualizado", "ok");
      setKind(null); setQty(""); setCost(""); setNote("");
      void load(); router.refresh();
    });
  };
  const pick = (k: Kind) => { setKind(k); setQty(""); setCost(""); setNote(""); setError(null); };
  return (
    <section aria-labelledby="pr-estoque" className="flex flex-col gap-4">
      <h2 id="pr-estoque" className="text-lg font-semibold">Estoque</h2>
      <p className="text-base text-ink">
        <span className="font-display text-2xl font-medium tabular-nums">{qtyText(p.stockQty)}</span>
        <span className="ml-2 text-graphite">{p.unit.toLowerCase()} em estoque{p.minQty != null ? ` · mínimo ${qtyText(p.minQty)}` : ""}</span>
      </p>
      {p.negative && <p className="text-sm text-alert">Estoque negativo: houve venda sem estoque. Dê entrada ou ajuste pela contagem.</p>}
      {canMove && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {KINDS.map(([k, label]) => <Button key={k} variant={kind === k ? "primary" : "secondary"} size="sm" onClick={() => pick(k)}>{label}</Button>)}
          </div>
          {kind && (
            <div className="grid gap-3 rounded-[var(--radius-control)] bg-paper-2/70 p-3 sm:grid-cols-2">
              <Field label={kind === "ajuste" ? "Quantidade contada" : "Quantidade"} htmlFor="mv-qtd" hint={kind === "ajuste" ? "O estoque passa a ser este número." : undefined}>
                <Input id="mv-qtd" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="tabular-nums" />
              </Field>
              {kind === "entrada" && <Field label="Custo por unidade (R$)" htmlFor="mv-custo"><Input id="mv-custo" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opcional" className="tabular-nums" /></Field>}
              <div className="sm:col-span-2">
                <Field label={needsNote ? "Motivo" : "Observação"} htmlFor="mv-motivo" hint={needsNote ? "Obrigatório. Fica na auditoria." : undefined}>
                  <Input id="mv-motivo" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={kind === "saida" ? "ex.: quebrou, uso no salão" : kind === "ajuste" ? "ex.: contagem do mês" : "ex.: nota 1234"} />
                </Field>
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button variant="ghost" size="sm" onClick={() => setKind(null)}>Cancelar</Button>
                <Button size="sm" loading={pending} disabled={!qtyOk || (needsNote && !note.trim())} onClick={submit}>Registrar</Button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        </div>
      )}
      <div>
        <h3 className="mb-1 text-sm font-medium text-graphite">Últimos movimentos</h3>
        {moves == null ? <p className="text-sm text-muted">Carregando…</p> : moves.length ? (
          <ul className="divide-y divide-line/70 rounded-[var(--radius-control)] border border-line">
            {moves.map((m) => (
              <li key={m.id} className={`flex items-baseline justify-between gap-3 px-3 py-2 text-sm ${m.cancelled ? "text-muted line-through" : ""}`}>
                <span className="min-w-0"><span className="font-medium text-ink">{REASON[m.reason] ?? m.reason}</span>{m.note ? ` · ${m.note}` : ""}{m.cancelled ? " · estornado" : ""}
                  <span className="block text-xs text-muted">{m.createdAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" })}</span></span>
                <span className="shrink-0 tabular-nums">{m.deltaQty > 0 ? "+" : ""}{qtyText(m.deltaQty)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Nenhum movimento ainda.</p>}
      </div>
    </section>
  );
}
