"use client";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { redeemLoyaltyAction } from "@/app/(app)/caixa/actions";
import { faltamParaPremio, loyaltyLine, type LoyaltyStatusView } from "@/lib/loyalty";
import { prettyName } from "@/lib/services-view";

type Item = { id: string; kind: string; label: string; serviceId?: string | null; discountCents: number; professionalName: string | null };
type Svc = { id: string; label: string };
type Pro = { id: string; name: string; active: boolean };
type Choice = { key: string; label: string; hint?: string; itemId?: string; serviceId?: string };

/**
 * Fidelidade na comanda (item 22): uma linha por programa em que a cliente tem pontos ou prêmio ("Fiel da Fiaes: 12 de 12 · Usar o prêmio").
 * Usar o prêmio pergunta UMA coisa por tela: o serviço → a profissional (só se o serviço ainda não está na comanda) → confirmar.
 * Sem a permissão de usar o prêmio, o botão não aparece.
 */
export function LoyaltyBanner({ comandaId, programs, items, services, professionals, canRedeem, onDone }: {
  comandaId: string; programs: LoyaltyStatusView[]; items: Item[]; services: Svc[]; professionals: Pro[]; canRedeem: boolean; onDone: () => Promise<void> | void;
}) {
  const [using, setUsing] = useState<LoyaltyStatusView | null>(null);
  const shown = programs.filter((p) => p.ready || (p.kind === "contagem" && p.balance > 0));
  if (!shown.length) return null;
  return (
    <section aria-label="Fidelidade" data-bloco="fidelidade" className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-paper-2 px-4 py-3">
      <ul className="flex flex-col gap-1.5">
        {shown.map((p) => (
          <li key={p.programId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="font-semibold">{p.name}:</span><span className="tabular">{loyaltyLine(p)}</span>
              {p.ready ? <Badge tone="ok">Prêmio disponível</Badge> : p.goal != null && <span className="text-graphite">· {faltamParaPremio(Math.max(1, p.goal - p.balance))}</span>}
            </span>
            {p.ready && canRedeem && <Button size="sm" variant="secondary" onClick={() => setUsing(p)}>Usar o prêmio</Button>}
          </li>
        ))}
      </ul>
      {using && <RedeemDialog key={using.programId} comandaId={comandaId} program={using} items={items} services={services} professionals={professionals}
        onClose={() => setUsing(null)} onDone={async () => { setUsing(null); await onDone(); }} />}
    </section>
  );
}

function RedeemDialog({ comandaId, program, items, services, professionals, onClose, onDone }: {
  comandaId: string; program: LoyaltyStatusView; items: Item[]; services: Svc[]; professionals: Pro[]; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [step, setStep] = useState<"servico" | "profissional" | "confirmar">("servico");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [proId, setProId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // O que já está na comanda e é prêmio do programa (sem desconto) vem primeiro; depois os outros serviços do prêmio.
  const inComanda: Choice[] = items.filter((i) => i.kind === "servico" && i.serviceId && program.rewardServiceIds.includes(i.serviceId) && i.discountCents === 0)
    .map((i) => ({ key: `item:${i.id}`, label: prettyName(i.label), hint: `Já está na comanda${i.professionalName ? ` · ${i.professionalName}` : ""}`, itemId: i.id }));
  const taken = new Set(items.filter((i) => i.serviceId).map((i) => i.serviceId));
  const novos: Choice[] = program.rewardServiceIds.filter((id) => !taken.has(id)).flatMap((id) => {
    const s = services.find((x) => x.id === id);
    return s ? [{ key: `svc:${id}`, label: prettyName(s.label), hint: "Entra na comanda", serviceId: id }] : [];
  });
  const choices = [...inComanda, ...novos];
  const pro = professionals.find((p) => p.id === proId) ?? null;

  const pick = (c: Choice) => { setChoice(c); setError(null); setStep(c.itemId ? "confirmar" : "profissional"); };
  const back = () => { setError(null); setStep(step === "confirmar" && !choice?.itemId ? "profissional" : "servico"); };
  const confirm = () => start(async () => {
    if (!choice) return;
    setError(null);
    const target = choice.itemId ? { itemId: choice.itemId } : { serviceId: choice.serviceId ?? "", professionalId: proId ?? "" };
    const r = await redeemLoyaltyAction(comandaId, program.programId, target);
    if (!r.ok) { setError(r.error); return; }
    await onDone();
  });

  const title = step === "servico" ? "Qual serviço é o prêmio?" : step === "profissional" ? "Com quem?" : "Usar o prêmio?";
  const footer = (
    <>
      {step === "servico" ? <Button variant="ghost" onClick={onClose}>Cancelar</Button> : <Button variant="ghost" onClick={back} disabled={pending}>Voltar</Button>}
      {step === "profissional" && <Button variant="gold" disabled={!proId} onClick={() => { setError(null); setStep("confirmar"); }}>Continuar</Button>}
      {step === "confirmar" && <Button variant="gold" loading={pending} onClick={confirm}>Usar o prêmio</Button>}
    </>
  );
  return (
    <Dialog open onClose={onClose} title={title} description={`${program.name} · ${loyaltyLine(program)}`} footer={footer}>
      {step === "servico" && (
        choices.length === 0 ? <p className="text-sm text-graphite">Nenhum serviço do prêmio pode entrar nesta comanda agora.</p> : (
          <ul className="flex flex-col gap-2" aria-label="Serviços do prêmio">
            {choices.map((c) => (
              <li key={c.key}>
                <button type="button" onClick={() => pick(c)} className="flex w-full flex-col rounded-[var(--radius-control)] border border-line px-4 py-3 text-left hover:border-graphite pointer-coarse:min-h-11">
                  <span className="text-base font-medium text-ink">{c.label}</span>{c.hint && <span className="text-sm text-muted">{c.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {step === "profissional" && (
        <ul className="flex flex-col gap-2" aria-label="Profissionais">
          {professionals.filter((p) => p.active).map((p) => (
            <li key={p.id}>
              <button type="button" role="radio" aria-checked={proId === p.id} onClick={() => setProId(p.id)}
                className={`flex w-full rounded-[var(--radius-control)] border px-4 py-3 text-left text-base font-medium pointer-coarse:min-h-11 ${proId === p.id ? "border-ink bg-paper-2 text-ink" : "border-line text-ink hover:border-graphite"}`}>{p.name}</button>
            </li>
          ))}
        </ul>
      )}
      {step === "confirmar" && choice && (
        <p className="text-base text-ink">
          {choice.itemId
            ? `O desconto do prêmio vai no ${choice.label} que já está na comanda, e a cliente gasta os pontos do ${program.name}.`
            : `${choice.label}${pro ? ` com ${pro.name}` : ""} entra na comanda com o desconto do prêmio, e a cliente gasta os pontos do ${program.name}. Dá para desfazer tirando esse item da comanda.`}
        </p>
      )}
      {error && <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
    </Dialog>
  );
}
