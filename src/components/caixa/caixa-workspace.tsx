"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionSheet } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import type { CaixaHoje } from "@/server/queries/caixa";
import { DRAWER_METHODS, PAY_LABEL } from "@/lib/comanda-math";
import { money } from "@/lib/format";
import { useComanda } from "./comanda-provider";
import { CaixaQueueList } from "./caixa-queue";
import { ComandaPanel, type ComandaCatalog } from "./comanda-panel";
import { NewComanda } from "./new-comanda";
import { AgendadasList } from "./caixa-agendadas";
import { DevendoList } from "./caixa-devendo";

const WIDE = "(min-width: 1024px)";
const wide = () => typeof window !== "undefined" && window.matchMedia?.(WIDE).matches;

/**
 * O Caixa no computador (Plano 3): à esquerda a fila (A receber, Em atendimento, Pagas hoje); à direita a comanda escolhida, com os itens
 * editáveis e o pagamento. No celular, tocar na fila abre a mesma comanda numa folha.
 */
export function CaixaWorkspace({ data, catalog, nowIso }: { data: CaixaHoje; catalog: ComandaCatalog; nowIso: string }) {
  const comanda = useComanda();
  const [selected, setSelected] = useState<string | null>(data.queue.aReceber[0]?.id ?? null);
  /** "Nova comanda" em rascunho: nada é criado até o primeiro item (QA r58, I-8). A chave remonta o formulário a cada abertura. */
  const [draft, setDraft] = useState<{ key: number; sheet: boolean } | null>(null);
  const router = useRouter();
  const [tab, setTab] = useState<"fila" | "devendo">("fila");
  const pick = (id: string) => { setDraft(null); if (wide()) setSelected(id); else comanda?.openById(id); };
  const created = (id: string) => { setDraft(null); setTab("fila"); router.refresh(); pick(id); };
  const newDraft = <NewComanda key={draft?.key ?? 0} catalog={catalog} onCreated={created} onCancel={() => setDraft(null)} />;
  const totals = data.totals;
  const entered = totals ? DRAWER_METHODS.filter((m) => totals.byMethod[m] > 0) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(320px,380px)_1fr] lg:items-start">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          {totals ? (
            <p className="text-sm text-graphite">
              <span className="font-semibold text-ink tabular">{money(totals.totalCents)}</span> entrou hoje
              {entered.length > 0 && <span className="block text-xs text-muted">{entered.map((m) => `${PAY_LABEL[m]} ${money(totals.byMethod[m])}`).join(" · ")}</span>}
            </p>
          ) : <span />}
          <Button variant="secondary" size="sm" aria-expanded={draft != null} onClick={() => setDraft({ key: Date.now(), sheet: !wide() })}>Nova comanda</Button>
        </div>
        {data.devendo && (
          <div role="tablist" aria-label="Lista do caixa" className="flex gap-1 rounded-full bg-paper-2 p-1 text-sm">
            {([["fila", "Do dia"], ["devendo", `Devendo (${data.devendo.length})`]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`flex-1 rounded-full px-3 py-1.5 pointer-coarse:min-h-11 font-medium ${tab === k ? "bg-paper text-ink shadow-sm" : "text-muted"}`}>{label}</button>
            ))}
          </div>
        )}
        {tab === "devendo" && data.devendo ? <DevendoList rows={data.devendo} onOpened={created} /> : (
          <>
            <CaixaQueueList queue={data.queue} selectedId={selected} onPick={pick} now={new Date(nowIso)} today={data.day} canCancel={data.canCancelar}
              agendadas={<AgendadasList rows={data.agendadas} onOpened={created} canCancel={data.canCancelar} />} />
          </>
        )}
      </div>
      <div className="hidden lg:sticky lg:top-6 lg:block">
        {draft && !draft.sheet ? (
          <section aria-label="Nova comanda" className="rounded-[var(--radius-card)] border border-line bg-paper">
            <header className="border-b border-line px-5 py-4"><h2 className="text-lg font-semibold">Nova comanda</h2></header>
            <div className="px-5 py-4">{newDraft}</div>
          </section>
        ) : selected ? <ComandaPanel key={selected} comandaId={selected} catalog={catalog} onChanged={() => router.refresh()} />
          : <div className="grid min-h-64 place-items-center rounded-[var(--radius-card)] border border-dashed border-line-strong p-8 text-center text-sm text-muted">Escolha uma comanda na lista.</div>}
      </div>
      {/* No celular, a Nova comanda abre numa folha (o painel da direita não aparece). */}
      <ActionSheet open={!!draft?.sheet} onClose={() => setDraft(null)} title="Nova comanda" footer={null}>{draft?.sheet ? newDraft : null}</ActionSheet>
    </div>
  );
}

