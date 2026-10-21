"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { saveAvecLoyaltyProgramAction, saveLoyaltyProgramAction } from "@/app/(app)/servicos/actions";
import { prettyName } from "@/lib/services-view";
import { DEFAULT_REWARD_REASON } from "@/lib/loyalty";

export type LoyaltyProgramView = {
  id: string; name: string; description: string | null; kind: "contagem" | "aniversario"; goal: number | null;
  /** null = todos os serviços contam. */ countsServiceIds: string[] | null; rewardServiceIds: string[];
  rewardDiscountBp: number; maxDiscountBp: number | null; countsPackageSessions: boolean; rewardReasonTemplate: string; active: boolean;
};
type Svc = { id: string; label: string };

const pct = (bp: number) => String(bp / 100).replace(".", ",");
const parsePct = (t: string): number | null => {
  const n = Number(t.trim().replace(",", "."));
  return t.trim() && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
};
const names = (ids: string[], services: Svc[]) => ids.map((id) => services.find((s) => s.id === id)?.label).filter((x): x is string => !!x).map(prettyName);
const listText = (ids: string[], services: Svc[]) => { const n = names(ids, services); return n.length ? (n.length > 3 ? `${n.slice(0, 3).join(", ")} e mais ${n.length - 3}` : n.join(", ")) : "nenhum serviço"; };

/**
 * Serviços › Fidelidade: os programas da Casa em cartões ("Fiel da Fiaes", "10x Você", "Aniversário"). Quem tem fidelidade.programas abre o
 * painel e muda tudo; a recepção só consulta. Embaixo, o programa que recebe o saldo trazido do Avec (relatório 0113).
 */
export function LoyaltyPrograms({ programs, services, avecProgramId, canEdit, funcaoOn }: { programs: LoyaltyProgramView[]; services: Svc[]; avecProgramId: string | null; canEdit: boolean; funcaoOn: boolean }) {
  const [open, setOpen] = useState<string | "novo" | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const current = open && open !== "novo" ? programs.find((p) => p.id === open) ?? null : null;
  const counting = programs.filter((p) => p.kind === "contagem");
  const edit = canEdit && funcaoOn;

  const chooseAvec = (id: string) => start(async () => {
    const r = await saveAvecLoyaltyProgramAction(id);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Programa do saldo do Avec salvo"); router.refresh();
  });

  return (
    <div className="flex flex-col gap-6">
      {!funcaoOn && <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">A função Fidelidade está desligada em Configurações › Recursos. Nada pontua, nem aparece na comanda e na ficha.</p>}
      {funcaoOn && !canEdit && <p className="text-sm text-graphite">Só consulta: quem muda os programas é a gestão.</p>}
      {edit && <div><Button variant="gold" onClick={() => setOpen("novo")}>Novo programa</Button></div>}
      {programs.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-10 text-center"><p className="text-base text-ink">Nenhum programa de fidelidade.</p></div>
      ) : (
        <ul aria-label="Programas de fidelidade" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <li key={p.id} className="flex">
              <button type="button" onClick={() => setOpen(p.id)} aria-label={`Abrir ${p.name}`}
                className="flex w-full flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-paper p-4 text-left transition-colors hover:border-graphite">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold tracking-[-0.01em] text-ink">{p.name}</span>
                  {!p.active && <Badge>Desativado</Badge>}
                </span>
                <span className="text-sm text-ink">{p.kind === "contagem" ? `A cada ${p.goal} serviços, um prêmio` : "Prêmio no mês do aniversário, uma vez por ano"}</span>
                {p.description && <span className="text-sm text-graphite">{p.description}</span>}
                {p.kind === "contagem" && <span className="text-sm text-graphite">Contam: {p.countsServiceIds ? listText(p.countsServiceIds, services) : "todos os serviços"}</span>}
                <span className="text-sm text-graphite">Prêmio ({pct(p.rewardDiscountBp)}% de desconto): {listText(p.rewardServiceIds, services)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="fid-avec" className="rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5">
        <h2 id="fid-avec" className="text-lg font-semibold tracking-[-0.01em]">Saldo trazido do Avec</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-graphite">No Avec, abra o relatório 0113 “Pontos de fidelidade acumulados por cliente”, ponha o período de 01/01/2020 até hoje, exporte em Excel e importe em Configurações › Avec. O saldo de cada cliente entra neste programa e, se você importar de novo, o valor é trocado (não soma).</p>
        <div className="mt-3 max-w-sm">
          <Field label="Programa que recebe o saldo" htmlFor="fid-avec-prog" hint={counting.find((p) => p.id === avecProgramId) ? `Hoje o saldo do Avec entra em ${counting.find((p) => p.id === avecProgramId)?.name}.` : "Não há programa de contagem para receber o saldo."}>
            <Select id="fid-avec-prog" value={avecProgramId ?? counting[0]?.id ?? ""} disabled={!edit || pending} onChange={(e) => chooseAvec(e.target.value)}>
              {counting.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
      </section>
      {open && <ProgramSheet key={open} program={current} services={services} canEdit={edit} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ServicePicker({ id, legend, hint, services, selected, onChange, disabled }: { id: string; legend: string; hint?: string; services: Svc[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => services.filter((s) => !q.trim() || prettyName(s.label).toLowerCase().includes(q.trim().toLowerCase()) || selected.includes(s.id)), [services, q, selected]);
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-graphite">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <Input aria-label={`Buscar serviço em ${legend}`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar serviço" />
      <ul className="max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-line scroll-thin">
        {shown.map((s) => (
          <li key={s.id} className="border-b border-line/70 last:border-0">
            <label htmlFor={`${id}-${s.id}`} className="flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-ink pointer-coarse:min-h-11">
              <input id={`${id}-${s.id}`} type="checkbox" className="size-4 accent-[var(--color-ink)]" disabled={disabled} checked={selected.includes(s.id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
              {prettyName(s.label)}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function ProgramSheet({ program: p, services, canEdit, onClose }: { program: LoyaltyProgramView | null; services: Svc[]; canEdit: boolean; onClose: () => void }) {
  const [name, setName] = useState(p?.name ?? "");
  const [desc, setDesc] = useState(p?.description ?? "");
  const [goal, setGoal] = useState(p?.goal ? String(p.goal) : "");
  const [all, setAll] = useState(!p?.countsServiceIds?.length);
  const [counts, setCounts] = useState<string[]>(p?.countsServiceIds ?? []);
  const [rewards, setRewards] = useState<string[]>(p?.rewardServiceIds ?? []);
  const [maxPct, setMaxPct] = useState(p?.maxDiscountBp != null ? pct(p.maxDiscountBp) : "");
  const [rewardPct, setRewardPct] = useState(pct(p?.rewardDiscountBp ?? 10000));
  const [pkg, setPkg] = useState(p?.countsPackageSessions ?? false);
  const [reason, setReason] = useState(p?.rewardReasonTemplate ?? DEFAULT_REWARD_REASON);
  const [active, setActive] = useState(p?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const kind = p?.kind ?? "contagem";
  const sorted = useMemo(() => [...services].sort((a, b) => prettyName(a.label).localeCompare(prettyName(b.label), "pt-BR")), [services]);

  const save = () => {
    setError(null);
    const rp = parsePct(rewardPct), mp = maxPct.trim() ? parsePct(maxPct) : null;
    if (rp == null || rp < 1) { setError("Desconto do prêmio: uma porcentagem entre 0,01 e 100."); return; }
    if (maxPct.trim() && mp == null) { setError("Desconto máximo que ainda pontua: uma porcentagem entre 0 e 100."); return; }
    if (kind === "contagem" && !/^\d+$/.test(goal)) { setError("Meta: um número de serviços a partir de 1."); return; }
    if (kind === "contagem" && !all && !counts.length) { setError("Escolha os serviços que contam ou marque “Todos os serviços”."); return; }
    start(async () => {
      const r = await saveLoyaltyProgramAction({
        id: p?.id ?? null, name, description: desc.trim() || null, goal: kind === "contagem" ? Number(goal) : null,
        countsServiceIds: kind === "contagem" && !all ? counts : null, rewardServiceIds: rewards, rewardDiscountBp: rp, maxDiscountBp: kind === "contagem" ? mp : null,
        countsPackageSessions: pkg, rewardReasonTemplate: reason.trim() === DEFAULT_REWARD_REASON ? "" : reason, active,
      });
      if (!r.ok) { setError(r.error); return; }
      toast(`${name.trim()} salvo`); router.refresh(); onClose();
    });
  };

  const footer = canEdit ? (
    <>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="gold" onClick={save} loading={pending} disabled={!name.trim()}>{p ? "Salvar" : "Criar programa"}</Button>
    </>
  ) : undefined;
  const dis = !canEdit;

  return (
    <Sheet open onClose={onClose} title={p ? p.name : "Novo programa"} footer={footer} className="max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]">
      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8" onSubmit={(e) => { e.preventDefault(); if (canEdit) save(); }}>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Nome" htmlFor="fp-nome"><Input id="fp-nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={dis} /></Field>
          <Field label="Descrição" htmlFor="fp-desc" hint="Aparece para a equipe, na ficha e na comanda."><Textarea id="fp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={500} disabled={dis} /></Field>
          {kind === "contagem" && (
            <Field label="Meta (quantos serviços valem o prêmio)" htmlFor="fp-meta">
              <Input id="fp-meta" inputMode="numeric" value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ""))} disabled={dis} className="max-w-[140px] tabular-nums" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Desconto do prêmio (%)" htmlFor="fp-premio" hint="100 = o serviço sai de graça"><Input id="fp-premio" inputMode="decimal" value={rewardPct} onChange={(e) => setRewardPct(e.target.value)} disabled={dis} className="tabular-nums" /></Field>
            {kind === "contagem" && (
              <Field label="Desconto máximo que ainda pontua (%)" htmlFor="fp-max" hint="Vazio = pontua com qualquer desconto"><Input id="fp-max" inputMode="decimal" value={maxPct} onChange={(e) => setMaxPct(e.target.value)} disabled={dis} placeholder="Ex.: 20" className="tabular-nums" /></Field>
            )}
          </div>
          <Field label="Motivo do desconto do prêmio" htmlFor="fp-motivo" hint="Aparece na comanda. {programa} vira o nome do programa.">
            <Input id="fp-motivo" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} disabled={dis} />
          </Field>
          {canEdit && reason !== DEFAULT_REWARD_REASON && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setReason(DEFAULT_REWARD_REASON)}>Usar o texto sugerido</Button>}
          {kind === "contagem" && (
            <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
              <div>
                <p className="text-base font-medium text-ink">Sessão de pacote pontua</p>
                <p className="text-sm text-muted">{pkg ? "Usar uma sessão do pacote conta como serviço." : "Sessão de pacote não conta (o pacote já foi pago)."}</p>
              </div>
              <Switch checked={pkg} onChange={setPkg} label="Sessão de pacote pontua" disabled={dis} />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
            <div>
              <p className="text-base font-medium text-ink">{active ? "Ativo" : "Desativado"}</p>
              <p className="text-sm text-muted">{active ? "Pontua e aparece na comanda e na ficha." : "Não pontua e some da comanda e da ficha. Os pontos ficam guardados."}</p>
            </div>
            <Switch checked={active} onChange={setActive} label={active ? "Desativar o programa" : "Ativar o programa"} disabled={dis} />
          </div>
          {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {kind === "contagem" && (
            <div className="flex flex-col gap-2">
              <span id="fp-contam" className="text-sm font-medium text-graphite">Quais serviços contam</span>
              {dis ? <p aria-labelledby="fp-contam" className="text-sm text-ink">{all ? "Todos os serviços" : "Só alguns"}</p> : (
                <Segmented labelledBy="fp-contam" value={all ? "todos" : "alguns"} onChange={(v) => setAll(v === "todos")}
                  options={[{ value: "todos", label: "Todos os serviços" }, { value: "alguns", label: "Só alguns" }]} />
              )}
              {!all && <ServicePicker id="fp-conta" legend="Serviços que contam" services={sorted} selected={counts} onChange={setCounts} disabled={dis} />}
            </div>
          )}
          <ServicePicker id="fp-premio-svc" legend="Serviços do prêmio" hint="O prêmio vale para um destes serviços." services={sorted} selected={rewards} onChange={setRewards} disabled={dis} />
        </div>
      </form>
    </Sheet>
  );
}
