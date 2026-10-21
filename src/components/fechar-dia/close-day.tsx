"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-styles";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { useComanda } from "@/components/caixa/comanda-provider";
import { markManyAction, undoManyAction } from "@/app/(app)/agenda/actions";
import { CAIXA_OFF } from "@/lib/caixa-settings";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { pendingSummary } from "@/lib/fechar-dia-steps";
import type { AvecHint, CashStep, NoOutcomeRow, OpenComandaRow } from "@/server/queries/fechar-dia";
import type { TeamCashRow } from "@/server/queries/caixa";
import { CashCloseSheet } from "@/components/caixa/cash-close-sheet";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DM = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const HINT: Record<AvecHint["status"], string> = { compareceu: "Avec: veio", faltou: "Avec: faltou", cancelado: "Avec: cancelado", aberto: "Avec: sem desfecho" };
const hintText = (h: AvecHint) => (h.status === "compareceu" && h.why === "comanda" ? "Avec: veio (tem comanda)" : HINT[h.status]);
const hintTone = (h: AvecHint) => (h.status === "compareceu" ? "bg-ok-soft text-ok" : h.status === "aberto" ? "bg-paper-2 text-ink-2" : "bg-alert-soft text-alert");
const first = (s: string | null) => s?.trim().split(/\s+/)[0] ?? "";

export type CloseDayStep = 1 | 2 | 3;

/**
 * Caixa › Fechar o dia (plano 4): três passos, cada um na sua tela. 1) horários de hoje sem desfecho, com o que o Avec diz e
 * Compareceu/Faltou em lote; 2) comandas abertas; 3) fechar o caixa (com o caixa no Avec, só o aviso).
 */
export function CloseDay({ today, noOutcome, comandas, cash, step, hasOptions = false }: {
  today: string; noOutcome: NoOutcomeRow[]; comandas: OpenComandaRow[]; cash: CashStep; step: CloseDayStep; /** Há "Outra forma" cadastrada (fechar o caixa da equipe). */ hasOptions?: boolean;
}) {
  const steps: { n: CloseDayStep; label: string; count: number | null }[] = [
    { n: 1, label: "Horários sem desfecho", count: noOutcome.length },
    { n: 2, label: "Comandas abertas", count: comandas.length },
    { n: 3, label: "Fechar o caixa", count: null },
  ];
  // Pula o passo vazio: do 1 vai direto ao 2 só se houver comandas; senão ao caixa.
  const next = (step === 1 && comandas.length === 0 ? 3 : step + 1) as CloseDayStep;
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="text-base font-medium">{pendingSummary(noOutcome.length, comandas.length)}</p>
      <nav aria-label="Passos do fechamento" className="grid gap-2 sm:grid-cols-3">
        {steps.map((s) => (
          <Link key={s.n} href={`/caixa/fechar-dia?passo=${s.n}`} aria-current={step === s.n ? "step" : undefined} scroll={false}
            className={cn("flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border px-4 py-2", step === s.n ? "border-ink bg-ink text-paper" : "border-line bg-paper hover:bg-paper-2")}>
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold tabular", step === s.n ? "bg-paper text-ink" : "bg-paper-2 text-ink-2")}>{s.n}</span>
            <span className="min-w-0 flex-1 font-medium">{s.label}</span>
            {s.count != null && <span className={cn("tabular text-sm font-semibold", s.count && step !== s.n ? "text-alert" : "")}>{s.count}</span>}
          </Link>
        ))}
      </nav>
      {step === 1 && <NoOutcomeStep rows={noOutcome} />}
      {step === 2 && <ComandasStep rows={comandas} today={today} />}
      {step === 3 && <CashStepView cash={cash} hasOptions={hasOptions} today={today} />}
      {step < 3 && (
        <div className="flex justify-end">
          <Link href={`/caixa/fechar-dia?passo=${next}`} scroll={false} className={buttonClass({ variant: "primary" })}>
            Próximo passo: {steps[next - 1].label}
          </Link>
        </div>
      )}
    </div>
  );
}

function NoOutcomeStep({ rows }: { rows: NoOutcomeRow[] }) {
  const [chk, setChk] = useState<string[]>([]);
  const [gone, setGone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const list = rows.filter((r) => !gone.includes(r.id));
  const sel = chk.filter((id) => list.some((r) => r.id === id));
  const cameAvec = list.filter((r) => r.suggest === "compareceu").map((r) => r.id);

  const run = (ids: string[], status: "compareceu" | "faltou") => start(async () => {
    const r = await markManyAction(ids, status);
    if (!r.ok) { toast(r.error, "error"); return; }
    const { done, failed } = r.data!;
    setGone((g) => [...g, ...done]);
    setChk((c) => c.filter((x) => !done.includes(x)));
    const n = done.length;
    if (n) toast(status === "compareceu" ? (n === 1 ? "Marcado: veio." : `${n} marcados: vieram.`) : (n === 1 ? "Marcado como falta." : `${n} marcados como falta.`), "ok", {
      label: "Desfazer", onClick: () => start(async () => {
        const u = await undoManyAction(done);
        if (!u.ok) { toast(u.error, "error"); return; }
        setGone((g) => g.filter((x) => !u.data!.done.includes(x)));
        toast("Desfeito"); router.refresh();
      }),
    });
    if (failed.length) toast(`${failed.length === 1 ? "Um não foi" : `${failed.length} não foram`}: ${failed[0].error}`, "error");
    router.refresh();
  });

  /** Faltou pede confirmação (QA r58, M-2); o aviso depois tem Desfazer. */
  const confirmNoShow = useConfirmNoShow();
  const noShow = (ids: string[]) => {
    const one = ids.length === 1 ? list.find((r) => r.id === ids[0]) : null;
    confirmNoShow({ who: one ? one.clientName : `${ids.length} horários`, detail: one ? one.service : null, onConfirm: () => run(ids, "faltou") });
  };

  if (!list.length) return <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong"><Empty title="Todos os horários de hoje têm desfecho.">Nada para marcar.</Empty></div>;
  return (
    <section aria-labelledby="fd-1" className="flex flex-col gap-3">
      <h2 id="fd-1" className="text-lg font-semibold">{list.length === 1 ? "1 horário de hoje já acabou sem desfecho" : `${list.length} horários de hoje já acabaram sem desfecho`}</h2>
      <p className="-mt-1 text-sm text-graphite">Ninguém marcou Veio nem Faltou. Ao lado, o que o Avec diz: confira e marque, um por um ou em lote.</p>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-paper-2 px-3 py-2">
        <span className="text-sm font-medium tabular">{sel.length ? `${sel.length} de ${list.length} marcados` : "Nenhum marcado"}</span>
        {cameAvec.length > 0 && <Button variant="secondary" size="sm" onClick={() => setChk(cameAvec)}>{`Selecionar as que o Avec diz que vieram (${cameAvec.length})`}</Button>}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button disabled={!sel.length || pending} onClick={() => run(sel, "compareceu")}>Veio</Button>
          <Button variant="secondary" disabled={!sel.length || pending} onClick={() => noShow(sel)}>Faltou</Button>
        </span>
      </div>
      <ul>
        {list.map((r) => {
          const on = sel.includes(r.id);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line/80 py-3">
              <label className="grid size-11 cursor-pointer place-items-center">
                <input type="checkbox" checked={on} aria-label={`${r.clientName}, ${r.service}`} className="size-5 accent-[var(--color-ink)]"
                  onChange={() => setChk((c) => (on ? c.filter((x) => x !== r.id) : [...c, r.id]))} />
              </label>
              <span className="w-28 shrink-0 font-semibold tabular">{HORA.format(new Date(r.startsAt))}–{HORA.format(new Date(r.endsAt))}</span>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                <span className="font-semibold">{r.clientName}</span>
                <span className="text-sm text-graphite">{[r.service, r.professional && `com ${first(r.professional)}`].filter(Boolean).join(" ")}</span>
              </span>
              {r.avec ? <span className={cn("inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-semibold", hintTone(r.avec))}>{hintText(r.avec)}</span>
                : <span className="inline-flex h-[26px] items-center rounded-full bg-paper-2 px-2.5 text-xs font-medium text-ink-2">Só no CRM</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ComandasStep({ rows, today }: { rows: OpenComandaRow[]; today: string }) {
  const comanda = useComanda();
  if (!rows.length) return <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong"><Empty title="Nenhuma comanda aberta.">Tudo recebido ou cancelado.</Empty></div>;
  return (
    <section aria-labelledby="fd-2" className="flex flex-col gap-3">
      <h2 id="fd-2" className="text-lg font-semibold">{rows.length === 1 ? "1 comanda aberta" : `${rows.length} comandas abertas`}</h2>
      <p className="-mt-1 text-sm text-graphite">Receba ou cancele antes de fechar o caixa. As que ficarem abertas passam para o próximo caixa.</p>
      <ul className="rounded-[var(--radius-card)] border border-line bg-paper">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
            <span className="flex min-w-0 flex-[1_1_200px] flex-col">
              <span className="font-semibold">{`Comanda ${c.number} · ${c.clientName}`}</span>
              <span className="text-sm text-graphite tabular">{[c.day !== today && `de ${DM(c.day)}`, `${c.itens} ${c.itens === 1 ? "item" : "itens"}`, c.paidCents ? `pago ${money(c.paidCents)}` : null].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="font-medium tabular">{money(c.totalCents ?? 0)}</span>
            {comanda && <Button variant="secondary" onClick={() => comanda.openById(c.id)}>Abrir</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CashStepView({ cash, hasOptions, today }: { cash: CashStep; hasOptions: boolean; today: string }) {
  // O caixa cujo fechamento está na tela: a atualização ao vivo tira o caixa de "aberto" logo depois de fechar, e o resultado da contagem
  // (esperado × contado) precisa continuar à vista até "Concluir".
  const [held, setHeld] = useState<NonNullable<Extract<CashStep, { mode: "crm" }>["open"]> | null>(null);
  if (cash.mode === "avec") return (
    <section aria-labelledby="fd-3" className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-6">
      <h2 id="fd-3" className="text-lg font-semibold">{CAIXA_OFF}</h2>
      <p className="mt-1 text-sm text-graphite">Feche o caixa no Avec, como sempre. Os passos 1 e 2 já ficam feitos aqui.</p>
    </section>
  );
  const team = cash.team.length > 0 && <TeamOpenCash rows={cash.team} hasOptions={hasOptions} today={today} />;
  const mine = cash.open ?? held;
  if (!mine) return (
    <div className="flex flex-col gap-4">
      {team}
      <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong">
        <Empty title="Você não tem caixa aberto agora.">{cash.team.length ? "Os caixas da equipe estão acima." : "Nada para fechar."}</Empty>
      </div>
    </div>
  );
  return <div className="flex flex-col gap-4">{team}<MyCashStep o={mine} hasOptions={hasOptions} canGerir={!!cash.canGerir} onSheet={(on) => setHeld(on ? mine : null)} /></div>;
}

/** A gestão vê os caixas abertos da equipe (QA r58, I-3): de quem, desde quando, e fecha dali com a contagem. */
function TeamOpenCash({ rows, hasOptions, today }: { rows: TeamCashRow[]; hasOptions: boolean; today: string }) {
  const [closing, setClosing] = useState<TeamCashRow | null>(null);
  return (
    <section aria-label="Caixas abertos da equipe" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper px-5 py-5">
      <h2 className="text-lg font-semibold">{rows.length === 1 ? "1 caixa da equipe aberto" : `${rows.length} caixas da equipe abertos`}</h2>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 border-t border-line/70 py-3 first:border-t-0">
            <span className="flex min-w-0 flex-[1_1_200px] flex-col">
              <span className="font-semibold">{`Caixa de ${r.personName}`}</span>
              <span className="text-sm text-graphite tabular">{`aberto desde ${HORA.format(new Date(r.openedAt))}${r.day !== today ? ` de ${DM(r.day)}` : ""}`}</span>
            </span>
            <Button variant="secondary" onClick={() => setClosing(r)} aria-label={`Fechar o caixa de ${r.personName}`}>{`Fechar o caixa de ${r.personName}`}</Button>
          </li>
        ))}
      </ul>
      {closing && <CashCloseSheet open onClose={() => setClosing(null)} ownerName={closing.personName} sessionId={closing.id} blind={false} canGerir hasOptions={hasOptions}
        summary={{ expected: closing.expected, byBrand: closing.byBrand, openComandas: closing.openComandas }} />}
    </section>
  );
}

function MyCashStep({ o, hasOptions, canGerir, onSheet }: { o: NonNullable<Extract<CashStep, { mode: "crm" }>["open"]>; hasOptions: boolean; canGerir: boolean; onSheet?: (open: boolean) => void }) {
  const [closing, setClosingState] = useState(false);
  const setClosing = (v: boolean) => { setClosingState(v); onSheet?.(v); };
  return (
    <section aria-labelledby="fd-3" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-paper px-5 py-5">
      <div>
        <h2 id="fd-3" className="text-lg font-semibold">Fechar o caixa</h2>
        <p className="text-sm text-graphite">{`Aberto por ${o.openedByName} às ${HORA.format(new Date(o.openedAt))}`}.</p>
      </div>
      {o.openComandas > 0 && <p className="rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">{`${o.openComandas} ${o.openComandas === 1 ? "comanda aberta fica" : "comandas abertas ficam"} para o próximo caixa.`}</p>}
      <div><Button onClick={() => setClosing(true)}>Fechar meu caixa</Button></div>
      {closing && <CashCloseSheet open onClose={() => setClosing(false)} ownerName={o.openedByName} sessionId={null} blind={o.blind ?? true} canGerir={canGerir} hasOptions={hasOptions}
        summary={{ expected: o.expected ?? null, byBrand: o.byBrand ?? [], openComandas: o.openComandas }} />}
    </section>
  );
}
