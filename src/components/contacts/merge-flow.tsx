"use client";
import { StepDots } from "@/components/ui/step-dots";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeContactsAction, previewMergeAction, searchMergeTargetsAction, type MergeViews } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { suggestKeep, type MergeSideView } from "@/lib/merge-view";
import { SIGNAL_LABEL } from "@/lib/merge-signals";
import type { DuplicateSignal } from "@/server/queries/duplicate-suspects";

export type SuspectOption = { id: string; name: string | null; hint: string; signals: DuplicateSignal[] };
type Candidate = { id: string; name: string | null; hint: string };

const LABEL: Record<string, [string, string]> = {
  conversas: ["conversa", "conversas"], mensagens: ["mensagem", "mensagens"], horarios: ["horário", "horários"], comandas: ["comanda", "comandas"], vendas: ["venda", "vendas"],
  pacotes: ["pacote", "pacotes"], pontos: ["ponto", "pontos"], fichas: ["ficha", "fichas"], fotos: ["foto", "fotos"], notas: ["nota", "notas"],
};
/** "3 conversas, 12 horários…": só o que tem. */
export function goesAlong(m: Record<string, number>): string {
  const parts = Object.entries(LABEL).filter(([k]) => (m[k] ?? 0) !== 0).map(([k, [one, many]]) => `${m[k]} ${Math.abs(m[k]) === 1 ? one : many}`);
  return parts.length ? parts.join(", ") : "nada além do cadastro";
}
const name = (s: { name: string | null }) => s.name?.trim() || "Sem nome";

/**
 * Unir cadastros, um passo por tela: Com quem? → Qual cadastro fica? → o que vai junto + "Estou ciente" → Unir.
 * O telefone aparece só como "final 1234" e o CPF nunca aparece.
 */
export function MergeFlow({ base, suspects }: { base: { id: string; name: string | null; hint: string }; suspects: SuspectOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [views, setViews] = useState<MergeViews | null>(null);
  const [keep, setKeep] = useState<"a" | "b">("a");
  const [ciente, setCiente] = useState(false);
  const [pending, start] = useTransition();

  const search = (v: string) => { setQ(v); start(async () => { const r = await searchMergeTargetsAction(base.id, v); setFound(r.ok ? (r.data ?? []) : []); }); };
  const choose = (other: Candidate) => start(async () => {
    const r = await previewMergeAction(base.id, other.id);
    if (!r.ok || !r.data) { toast(r.ok ? "Não foi possível conferir." : r.error, "error"); return; }
    setViews(r.data);
    setKeep(suggestKeep({ hasWhatsapp: r.data.a.side.hasWhatsapp, moving: r.data.a.ifDropped }, { hasWhatsapp: r.data.b.side.hasWhatsapp, moving: r.data.b.ifDropped }) === "a" ? "a" : "b");
    // `ifDropped` de cada lado = o histórico dele (o que leva consigo quando é ele quem sai).
    setCiente(false); setStep(2);
  });
  const unir = () => start(async () => {
    if (!views) return;
    const [k, d] = keep === "a" ? [views.a.side, views.b.side] : [views.b.side, views.a.side];
    const r = await mergeContactsAction(k.id, d.id, ciente);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Cadastros unidos", "ok");
    router.push(`/contatos/${k.id}`);
  });

  const side = (s: "a" | "b"): { v: MergeSideView; carries: Record<string, number>; blockers: string[] } | null => views && { v: views[s].side, carries: views[s].ifDropped, blockers: views[s].blockers };
  const dropKey = keep === "a" ? "b" : "a";
  const dropSide = side(dropKey);
  const keepSide = side(keep);

  return (
    // No computador (r68 #22): o assistente à esquerda e, ao lado, o que vai acontecer; nada de formulário de celular perdido na tela larga.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,640px)_minmax(240px,340px)] lg:items-start">
    <div className="min-w-0 space-y-5">
      <StepDots current={step} total={3} />

      {step === 1 && (
        <section aria-labelledby="mf-1" className="space-y-4">
          <h2 id="mf-1" className="text-lg font-semibold">Com quem unir {name(base)}?</h2>
          {suspects.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-graphite">Parecem a mesma pessoa</h3>
              <ul className="space-y-2">
                {suspects.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => choose(s)} disabled={pending}
                      className="flex min-h-11 w-full flex-col items-start rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2 text-left hover:bg-paper-2">
                      <span className="font-medium">{name(s)} <span className="font-normal text-muted">· {s.hint}</span></span>
                      <span className="text-xs text-muted">{s.signals.map((x) => SIGNAL_LABEL[x]).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            {suspects.length === 0 && <p className="mb-2 text-sm text-graphite">Nenhuma sugestão. Procure pelo nome ou telefone.</p>}
            <label htmlFor="mf-busca" className="mb-1 block text-sm font-semibold text-graphite">{suspects.length > 0 ? "Ou procure por nome ou telefone" : "Nome ou telefone"}</label>
            <input id="mf-busca" value={q} onChange={(e) => search(e.target.value)} autoComplete="off" placeholder="Nome ou parte do telefone"
              className="h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-md sm:text-sm" />
            {found && q.trim().length >= 2 && (
              found.length === 0 ? <p className="mt-2 text-sm text-muted">Ninguém encontrada.</p> : (
                <ul className="mt-2 space-y-2" aria-label="Resultados">
                  {found.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => choose(c)} disabled={pending}
                      className="min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2 text-left hover:bg-paper-2">{name(c)} <span className="text-muted">· {c.hint}</span></button></li>
                  ))}
                </ul>
              )
            )}
          </div>
        </section>
      )}

      {step === 2 && views && (
        <section aria-labelledby="mf-2" className="space-y-4">
          <h2 id="mf-2" className="text-lg font-semibold">Qual cadastro fica?</h2>
          <p className="text-sm text-graphite">O outro some e tudo dele passa para o que ficar.</p>
          <div role="radiogroup" aria-label="Cadastro que fica" className="space-y-2">
            {(["a", "b"] as const).map((k) => {
              const s = views[k].side;
              return (
                <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-line-strong px-3.5 py-2 has-[:checked]:border-ink has-[:checked]:bg-paper-2">
                  <input type="radio" name="mf-keep" checked={keep === k} onChange={() => setKeep(k)} />
                  <span><span className="font-medium">{name(s)}</span> <span className="text-muted">· {s.hint}</span></span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted">Sugestão: o que tem WhatsApp e mais histórico.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>Voltar</Button>
            <Button onClick={() => setStep(3)}>Continuar</Button>
          </div>
        </section>
      )}

      {step === 3 && keepSide && dropSide && (
        <section aria-labelledby="mf-3" className="space-y-4">
          <h2 id="mf-3" className="text-lg font-semibold">Conferir e unir</h2>
          <p>Fica <strong>{name(keepSide.v)}</strong> ({keepSide.v.hint}). Sai <strong>{name(dropSide.v)}</strong> ({dropSide.v.hint}).</p>
          <p data-testid="vai-junto">Vai junto: {goesAlong(dropSide.carries)}.</p>
          {dropSide.blockers.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-[var(--radius-control)] border border-alert/40 bg-alert/5 p-3 text-sm">
              {dropSide.blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
            <span>Estou ciente: não dá para desfazer.</span>
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(2)}>Voltar</Button>
            <Button variant="danger" onClick={unir} disabled={!ciente || pending || dropSide.blockers.length > 0}>Unir</Button>
          </div>
        </section>
      )}
    </div>
    <aside aria-label="Como funciona" className="rounded-[var(--radius-card)] bg-paper-2 p-5 max-lg:hidden lg:sticky lg:top-6">
      <h2 className="text-base font-semibold">Como funciona</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-graphite">
        <li>Escolha a outra ficha da mesma pessoa.</li>
        <li>Confira qual fica e o que vem junto: horários, conversas, pacotes e pagamentos.</li>
        <li>Una. A ficha que sai passa a fazer parte da que fica.</li>
      </ol>
      <p className="mt-4 text-sm font-medium text-ink">Depois de unir, não dá para desfazer.</p>
    </aside>
    </div>
  );
}
