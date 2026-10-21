"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ProAvatar } from "@/components/agenda/pro-avatar";
import { createServiceAction, setProServiceTermsAction, updateServiceAction } from "@/app/(app)/servicos/actions";
import { durationText, packageLine, prettyCategory, prettyName } from "@/lib/services-view";
import { formatBRL, parseBRL } from "@/lib/money";
import { PRICE_KIND_LABEL, PRICE_KINDS, priceText, type PriceKind } from "@/lib/service-price";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/display-name";
import type { ServicePro, ServiceRow } from "@/server/domain/services";
import type { PackageCard } from "@/server/domain/caixa/packages";

const DESC_MAX = 300;
const NEW_CATEGORY = "__nova__";
const centsText = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const numOrNull = (t: string) => (t.trim() === "" ? null : Number(t));

/**
 * O que a ficha do serviço mostra além do básico (0084, Fase C item 24): `canCost` = servicos.custo (sem ela o custo nem vem no payload);
 * `canProTerms` = servicos.por_profissional; `precoPorPro` e `juntoComOutro` = as funções ligadas em Configurações › Recursos.
 */
export type ServiceSheetOpts = { canCost: boolean; canProTerms: boolean; precoPorPro: boolean; juntoComOutro: boolean };
export const NO_SHEET_OPTS: ServiceSheetOpts = { canCost: false, canProTerms: false, precoPorPro: false, juntoComOutro: false };
/** Tempo próprio da profissional: de 5 a 720 min (o mesmo do servidor). */
const PRO_DUR_MIN = 5, PRO_DUR_MAX = 720;
const parallelText = (v: boolean | null | undefined) => (v === true ? "sim" : v === false ? "nao" : "");
const parallelOf = (t: string): boolean | null => (t === "sim" ? true : t === "nao" ? false : null);
type TermsText = { price: string; dur: string };

/**
 * Painel grande do serviço (padrão "painel grande": 70% no computador, tela cheia no celular). Tudo do serviço num lugar:
 * nome, categoria, preço, duração, descrição curta (a IA usa), quem faz, folga depois, retorno e ativo. "Salvar" é a ação principal.
 * Quem só consulta (atendente) vê os mesmos dados, sem campos.
 */
export function ServiceSheet({ open, service, professionals, categories, canEdit, onClose, packages = [], opts = NO_SHEET_OPTS }: {
  open: boolean; service: ServiceRow | null; professionals: ServicePro[]; categories: string[]; canEdit: boolean; onClose: () => void; packages?: PackageCard[];
  opts?: ServiceSheetOpts;
}) {
  const s = service;
  const title = s ? prettyName(s.label) : "Novo serviço";
  const [label, setLabel] = useState(s?.label ?? "");
  const [cat, setCat] = useState(s?.category ?? "");
  const [newCat, setNewCat] = useState("");
  const [price, setPrice] = useState(centsText(s?.priceCents ?? null));
  const [dur, setDur] = useState(s?.durationMin ? String(s.durationMin) : "");
  const [desc, setDesc] = useState(s?.description ?? "");
  const [who, setWho] = useState<string[]>(s?.professionalIds ?? []);
  const [buffer, setBuffer] = useState(s?.bufferMin != null ? String(s.bufferMin) : "");
  const [cycle, setCycle] = useState(s?.cycleDays ? String(s.cycleDays) : "");
  const [ctrib, setCtrib] = useState(s?.fiscalCtribNac ?? "");
  const [nbs, setNbs] = useState(s?.fiscalNbs ?? "");
  const [active, setActive] = useState(s?.active ?? true);
  const [aiPros, setAiPros] = useState<string[]>(s?.aiProIds ?? []);
  const [aiScope, setAiScope] = useState<"sempre" | "metodo">(s?.aiProScope ?? "sempre");
  const [aiCitavel, setAiCitavel] = useState(s?.aiCitavel ?? true);
  const [cost, setCost] = useState(centsText(s?.costCents ?? null));
  const [priceKind, setPriceKind] = useState<PriceKind>(s?.priceKind ?? "fixo");
  const [parallel, setParallel] = useState(parallelText(s?.parallelOk));
  const [terms, setTerms] = useState<Record<string, TermsText>>(() => Object.fromEntries(Object.entries(s?.proTerms ?? {})
    .map(([id, t]) => [id, { price: centsText(t.priceCents), dur: t.durationMin != null ? String(t.durationMin) : "" }])));
  const showTerms = opts.canProTerms && opts.precoPorPro;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const save = () => {
    setError(null);
    let priceCents: number | null = null;
    if (price.trim()) { const p = parseBRL(price); if (!p.ok) { setError(`Preço: ${p.error}`); return; } priceCents = p.cents; }
    const category = cat === NEW_CATEGORY ? newCat.trim() || null : cat || null;
    const durationMin = numOrNull(dur), bufferMin = numOrNull(buffer), cycleDays = numOrNull(cycle);
    if ([durationMin, bufferMin, cycleDays].some((n) => n != null && !Number.isInteger(n))) { setError("Duração, folga e retorno são números inteiros (minutos e dias)."); return; }
    let costCents: number | null = null;
    if (opts.canCost && cost.trim()) { const p = parseBRL(cost); if (!p.ok) { setError(`Custo: ${p.error}`); return; } costCents = p.cents; }
    // Preço e tempo próprios de quem faz (0084): só o que mudou; vazio volta ao do serviço.
    const termChanges: { proId: string; priceCents: number | null; durationMin: number | null }[] = [];
    if (showTerms) for (const proId of who) {
      const t = terms[proId] ?? { price: "", dur: "" };
      const name = displayName(professionals.find((p) => p.id === proId)?.name ?? "");
      let own: number | null = null;
      if (t.price.trim()) { const p = parseBRL(t.price); if (!p.ok) { setError(`Preço próprio de ${name}: ${p.error}`); return; } own = p.cents; }
      const dm = numOrNull(t.dur);
      if (dm != null && (!Number.isInteger(dm) || dm < PRO_DUR_MIN || dm > PRO_DUR_MAX)) { setError(`Tempo próprio de ${name}: de ${PRO_DUR_MIN} a ${PRO_DUR_MAX} minutos.`); return; }
      const was = s?.proTerms[proId];
      if (own !== (was?.priceCents ?? null) || dm !== (was?.durationMin ?? null)) termChanges.push({ proId, priceCents: own, durationMin: dm });
    }
    const kind = priceKind === "fixo" ? null : priceKind;
    const all = {
      label, category, priceCents, durationMin, description: desc, professionalIds: who, bufferMin, cycleDays, active, aiCitavel, priceKind: kind, fiscalCtribNac: ctrib.trim() || null, fiscalNbs: nbs.trim() || null,
      ...(opts.juntoComOutro ? { parallelOk: parallelOf(parallel) } : {}), ...(opts.canCost ? { costCents } : {}),
    };
    const aiRule = { aiProIds: aiPros, aiProScope: aiPros.length ? aiScope : null };
    const saveTerms = async (serviceId: string) => {
      for (const t of termChanges) {
        const r = await setProServiceTermsAction(t.proId, serviceId, { priceCents: t.priceCents, durationMin: t.durationMin });
        if (!r.ok) return r.error;
      }
      return null;
    };
    start(async () => {
      if (!s) {
        // Novo: só manda custo e "junto com outro" quando preenchidos.
        const { costCents: c, parallelOk: par, ...rest } = all as typeof all & { costCents?: number | null; parallelOk?: boolean | null };
        const input = { ...rest, ...(c != null ? { costCents: c } : {}), ...(par != null ? { parallelOk: par } : {}) };
        const r = await createServiceAction(aiPros.length ? { ...input, ...aiRule } : input);
        if (!r.ok) { setError(r.error); return; }
        const termsError = r.data ? await saveTerms(r.data.id) : null;
        if (termsError) { setError(termsError); return; }
        toast(`${prettyName(label.trim())} criado`, "ok"); onClose(); return;
      }
      // Só o que mudou (outra pessoa pode ter mudado o resto).
      const before = {
        label: s.label, category: s.category, priceCents: s.priceCents, durationMin: s.durationMin, description: s.description ?? "", bufferMin: s.bufferMin, cycleDays: s.cycleDays, active: s.active, aiCitavel: s.aiCitavel,
        priceKind: s.priceKind ?? null, parallelOk: s.parallelOk ?? null, costCents: s.costCents ?? null,
        fiscalCtribNac: s.fiscalCtribNac ?? null, fiscalNbs: s.fiscalNbs ?? null,
      };
      const patch = Object.fromEntries(Object.entries(all).filter(([k, v]) => k !== "professionalIds" && v !== before[k as keyof typeof before]));
      const prosChanged = [...who].sort().join() !== [...s.professionalIds].sort().join();
      const aiChanged = [...aiPros].sort().join() !== [...s.aiProIds].sort().join() || (aiPros.length > 0 && aiScope !== (s.aiProScope ?? "sempre"));
      if (!Object.keys(patch).length && !prosChanged && !aiChanged && !termChanges.length) { onClose(); return; }
      if (Object.keys(patch).length || prosChanged || aiChanged) {
        const r = await updateServiceAction(s.id, { ...patch, ...(prosChanged ? { professionalIds: who } : {}), ...(aiChanged ? aiRule : {}) });
        if (!r.ok) { setError(r.error); return; }
      }
      const termsError = await saveTerms(s.id);
      if (termsError) { setError(termsError); return; }
      toast(`${prettyName(label.trim() || s.label)} salvo`, "ok"); onClose();
    });
  };

  const footer = canEdit ? (
    <>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="gold" onClick={save} loading={pending} disabled={!label.trim()}>{s ? "Salvar" : "Criar serviço"}</Button>
    </>
  ) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={title} footer={footer} className="max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]">
      {!canEdit && s ? <ReadOnly s={s} professionals={professionals} packages={packages} showTerms={opts.precoPorPro} showCost={opts.canCost} /> : (
        <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-8" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Nome" htmlFor="sv-nome">
              <Input id="sv-nome" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Ex.: Manutenção Método Fiaes®" />
            </Field>
            <Field label="Categoria" htmlFor="sv-cat">
              <Select id="sv-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.map((c) => <option key={c} value={c}>{prettyCategory(c)}</option>)}
                <option value={NEW_CATEGORY}>Nova categoria…</option>
              </Select>
            </Field>
            {cat === NEW_CATEGORY && (
              <Field label="Nome da nova categoria" htmlFor="sv-cat-nova">
                <Input id="sv-cat-nova" value={newCat} onChange={(e) => setNewCat(e.target.value)} maxLength={60} placeholder="Ex.: Estética" />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço (R$)" htmlFor="sv-preco" hint="Vazio = sem preço">
                <Input id="sv-preco" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="text-lg font-semibold tabular-nums" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Duração (min)" htmlFor="sv-dur" hint={dur && Number(dur) > 0 ? durationText(Number(dur)) : "A Agenda usa para achar horário"}>
                <Input id="sv-dur" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 90" className="tabular-nums" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço" htmlFor="sv-preco-tipo" hint={priceKind === "fixo" ? "A IA e o site mostram o valor" : priceKind === "a_partir_de" ? "Aparece “a partir de” o valor" : "Aparece “sob consulta”, sem valor"}>
                <Select id="sv-preco-tipo" value={priceKind} onChange={(e) => setPriceKind(e.target.value as PriceKind)}>
                  {PRICE_KINDS.map((k) => <option key={k} value={k}>{PRICE_KIND_LABEL[k]}</option>)}
                </Select>
              </Field>
              {opts.canCost && (
                <Field label="Custo (R$)" htmlFor="sv-custo" hint="Só a gestão vê; nunca vai para a cliente nem para a IA">
                  <Input id="sv-custo" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" className="tabular-nums" />
                </Field>
              )}
            </div>
            <Field label="Descrição curta" htmlFor="sv-desc" hint={`A IA usa este texto para explicar o serviço: o que inclui, para quem é, quem faz. ${desc.length}/${DESC_MAX}`}>
              <Textarea id="sv-desc" value={desc} onChange={(e) => setDesc(e.target.value.slice(0, DESC_MAX))} rows={3} placeholder="Ex.: Inclui remoção, confecção com queratina nova, lavagem especial, aplicação e finalização." />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Folga depois (min)" htmlFor="sv-folga" hint="Arrumar o posto; opcional">
                <Input id="sv-folga" inputMode="numeric" value={buffer} onChange={(e) => setBuffer(e.target.value.replace(/\D/g, ""))} placeholder="0" className="tabular-nums" />
              </Field>
              <Field label="Lembrar retorno em (dias)" htmlFor="sv-ciclo" hint="Vazio = não lembrar">
                <Input id="sv-ciclo" inputMode="numeric" value={cycle} onChange={(e) => setCycle(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 90" className="tabular-nums" />
              </Field>
            </div>
            {opts.juntoComOutro && (
              <Field label="Pode ser feito junto com outro" htmlFor="sv-junto" hint={parallel === "sim" ? "Com outra profissional ao mesmo tempo, sem virar encaixe (se o outro também puder)" : parallel === "nao" ? "A Agenda recusa marcar ao mesmo tempo que outro serviço" : "Como hoje: ao mesmo tempo que outro horário dela vira encaixe"}>
                <Select id="sv-junto" value={parallel} onChange={(e) => setParallel(e.target.value)}>
                  <option value="">Não informado</option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Código do serviço na nota (cTribNac)" htmlFor="sv-ctrib" hint="6 números; opcional. Vazio = o padrão de Configurações › Nota fiscal.">
                <Input id="sv-ctrib" inputMode="numeric" value={ctrib} onChange={(e) => setCtrib(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Ex.: 060101" className="tabular-nums" />
              </Field>
              <Field label="NBS" htmlFor="sv-nbs" hint="9 números; opcional. Vazio = o padrão.">
                <Input id="sv-nbs" inputMode="numeric" value={nbs} onChange={(e) => setNbs(e.target.value.replace(/\D/g, "").slice(0, 9))} className="tabular-nums" />
              </Field>
            </div>
            {s && (
              <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
                <div>
                  <p className="text-base font-medium text-ink">{active ? "Ativo" : "Desativado"}</p>
                  <p className="text-sm text-muted">{active ? "Aparece na Agenda, no caixa e para a IA." : "Some da Agenda, do caixa e da IA. O histórico fica."}</p>
                </div>
                <Switch checked={active} onChange={setActive} label={active ? "Desativar o serviço" : "Ativar o serviço"} />
              </div>
            )}
            <InPackages packages={packages} />
            {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
          </div>
          <div className="flex min-w-0 flex-col">
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-graphite">Quem faz <span className="font-normal text-muted">({who.length})</span></legend>
              <p className="text-sm text-muted">A Agenda oferece o serviço só para quem está marcada.{showTerms ? " Preço e tempo próprios são opcionais: vazio usa os do serviço." : ""}</p>
              <ul className="flex flex-col divide-y divide-line/70 rounded-[var(--radius-control)] border border-line">
                {professionals.map((p) => {
                  const on = who.includes(p.id);
                  const t = terms[p.id] ?? { price: "", dur: "" };
                  const setT = (patch: Partial<TermsText>) => setTerms((m) => ({ ...m, [p.id]: { ...t, ...patch } }));
                  return (
                    <li key={p.id} className={cn(on && "bg-paper-2/70")}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                        <input type="checkbox" checked={on} onChange={() => setWho((w) => (on ? w.filter((x) => x !== p.id) : [...w, p.id]))} className="size-5 accent-[var(--color-ink)]" />
                        <ProAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={32} soft />
                        <span className="text-base text-ink">{displayName(p.name)}</span>
                      </label>
                      {on && showTerms && (
                        <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                          <Field label="Preço próprio (R$)" htmlFor={`sv-pp-${p.id}`}>
                            <Input id={`sv-pp-${p.id}`} aria-label={`Preço próprio de ${displayName(p.name)}`} inputMode="decimal" value={t.price} onChange={(e) => setT({ price: e.target.value })}
                              placeholder={price.trim() || "Igual ao serviço"} className="tabular-nums" />
                          </Field>
                          <Field label="Tempo próprio (min)" htmlFor={`sv-tp-${p.id}`}>
                            <Input id={`sv-tp-${p.id}`} aria-label={`Tempo próprio de ${displayName(p.name)}`} inputMode="numeric" value={t.dur} onChange={(e) => setT({ dur: e.target.value.replace(/\D/g, "") })}
                              placeholder={dur || "Igual ao serviço"} className="tabular-nums" />
                          </Field>
                        </div>
                      )}
                    </li>
                  );
                })}
                {!professionals.length && <li className="px-3 py-4 text-sm text-muted">Nenhuma profissional ativa.</li>}
              </ul>
            </fieldset>
            <AiCanCite value={aiCitavel} onChange={setAiCitavel} />
            <AiOnlyWith professionals={professionals} value={aiPros} onChange={setAiPros} scope={aiScope} onScope={setAiScope} />
          </div>
        </form>
      )}
    </Sheet>
  );
}

/** "A IA pode citar" (IA v3, 17/10): não = item interno (reunião, sessão de pacote, parte do Método) ou sem especialista; some da lista da IA. */
function AiCanCite({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
      <div>
        <p className="text-base font-medium text-ink">A IA pode citar</p>
        <p className="text-sm text-muted">{value ? "Entra na lista de serviços e preços da IA." : "Fica fora da lista da IA (item interno ou sem especialista). A Agenda não muda."}</p>
      </div>
      <Switch checked={value} onChange={onChange} label={value ? "Tirar da lista da IA" : "Deixar a IA citar"} />
    </div>
  );
}

const SCOPE_TEXT = { sempre: "sempre", metodo: "só quando o assunto é o Método Fiaes®" } as const;

/**
 * "A IA oferece só com" (pedido do dono, 17/10): a sugestão por IA só oferece horário deste serviço com estas profissionais (ex.: a
 * avaliação do Método é só com a Thaise). Vazio = com quem faz o serviço. Não muda a Agenda nem quem faz.
 */
function AiOnlyWith({ professionals, value, onChange, scope, onScope }: { professionals: ServicePro[]; value: string[]; onChange: (v: string[]) => void; scope: "sempre" | "metodo"; onScope: (v: "sempre" | "metodo") => void }) {
  return (
    <div role="group" aria-labelledby="sv-ia-titulo" className="mt-4 flex flex-col gap-2">
      <p id="sv-ia-titulo" className="text-sm font-medium text-graphite">A IA oferece só com: <span className="font-normal text-muted">(opcional)</span></p>
      <p className="text-sm text-muted">Vazio: a IA oferece horário com quem faz o serviço. A Agenda não muda.</p>
      <ul className="flex flex-wrap gap-2">
        {professionals.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id}>
              <label className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", on ? "border-ink bg-paper-2 text-ink" : "border-line text-graphite")}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className="size-4 accent-[var(--color-ink)]"
                  aria-label={`A IA oferece com ${displayName(p.name)}`} />
                {displayName(p.name)}
              </label>
            </li>
          );
        })}
      </ul>
      {value.length > 0 && (
        <Field label="Quando vale" htmlFor="sv-ia-quando">
          <Select id="sv-ia-quando" value={scope} onChange={(e) => onScope(e.target.value === "metodo" ? "metodo" : "sempre")}>
            <option value="sempre">Sempre</option>
            <option value="metodo">Só quando o assunto é o Método Fiaes®</option>
          </Select>
        </Field>
      )}
    </div>
  );
}

/** Os pacotes à venda que usam o serviço; cada um abre na aba Pacotes. */
function InPackages({ packages }: { packages: PackageCard[] }) {
  if (!packages.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-graphite">Também em pacote</p>
      <ul className="flex flex-col gap-1">
        {packages.map((p) => <li key={p.id}><Link href={`/servicos?aba=pacotes&pacote=${p.id}`} className="text-base text-gold-ink underline-offset-4 hover:underline">{packageLine(p)}</Link></li>)}
      </ul>
    </div>
  );
}

/** O preço e o tempo próprios de uma profissional, para quem só consulta ("R$ 300,00 · 2h30"). */
function termsLine(t: { priceCents: number | null; durationMin: number | null } | undefined): string | null {
  if (!t || (t.priceCents == null && t.durationMin == null)) return null;
  return [t.priceCents != null ? formatBRL(t.priceCents) : null, t.durationMin != null ? durationText(t.durationMin) : null].filter(Boolean).join(" · ");
}

function ReadOnly({ s, professionals, packages, showTerms, showCost }: { s: ServiceRow; professionals: ServicePro[]; packages: PackageCard[]; showTerms: boolean; showCost: boolean }) {
  const pros = professionals.filter((p) => s.professionalIds.includes(p.id));
  const price = priceText(s.priceCents, s.priceKind ?? null);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-semibold tabular-nums text-ink">{price ? price.charAt(0).toUpperCase() + price.slice(1) : "Sem preço"}</p>
        <p className="text-base text-graphite">{durationText(s.durationMin)} · {prettyCategory(s.category)}</p>
      </div>
      {showCost && s.costCents != null && <p className="text-sm text-graphite"><span className="font-medium text-ink">Custo:</span> {formatBRL(s.costCents)}</p>}
      {s.description && <p className="max-w-[65ch] text-base leading-relaxed text-ink">{s.description}</p>}
      <div>
        <p className="mb-2 text-sm font-medium text-graphite">Quem faz</p>
        {pros.length ? (
          <ul className="flex flex-wrap gap-3">
            {pros.map((p) => {
              const own = showTerms ? termsLine(s.proTerms[p.id]) : null;
              return <li key={p.id} className="flex items-center gap-2"><ProAvatar name={p.name} color={p.color} photoUrl={p.photoUrl} size={32} soft /><span className="text-base">{displayName(p.name)}</span>{own && <span className="text-sm text-graphite">{own}</span>}</li>;
            })}
          </ul>
        ) : <p className="text-sm text-muted">Ninguém marcado.</p>}
      </div>
      {!s.aiCitavel && <p className="text-sm text-graphite"><span className="font-medium text-ink">A IA não cita este serviço</span> (item interno ou sem especialista).</p>}
      {s.aiProIds.length > 0 && (
        <p className="text-sm text-graphite"><span className="font-medium text-ink">A IA oferece só com:</span> {professionals.filter((p) => s.aiProIds.includes(p.id)).map((p) => displayName(p.name)).join(", ") || "profissional desativada"} ({SCOPE_TEXT[s.aiProScope ?? "sempre"]})</p>
      )}
      <InPackages packages={packages} />
      <p className="text-sm text-muted">Para mudar preço ou serviço, fale com a recepção ou a gestão.</p>
    </div>
  );
}
