"use client";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { savePackageAction } from "@/app/(app)/servicos/actions";
import { packageValidityText, prettyName, sessionsText } from "@/lib/services-view";
import { formatBRL, parseBRL } from "@/lib/money";
import type { ServiceRow } from "@/server/domain/services";
import type { PackageCard } from "@/server/domain/caixa/packages";

const DESC_MAX = 600;
const centsText = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** `unit`: valor por sessão daquele serviço, em texto ("50,00"); vazio = sem valor (base da comissão da sessão usada). */
type Item = { serviceId: string; sessions: string; unit: string };

/**
 * Painel grande do pacote (mesmo padrão do serviço: 70% no computador, tela cheia no celular): nome, serviços × sessões, preço do
 * pacote inteiro (com o preço por sessão ao lado), validade, descrição para a IA e ativo. Quem só consulta vê os dados, sem campos.
 */
export function PackageSheet({ open, pkg, services, canEdit, onClose }: { open: boolean; pkg: PackageCard | null; services: ServiceRow[]; canEdit: boolean; onClose: () => void }) {
  const p = pkg;
  const [name, setName] = useState(p?.name ?? "");
  const [items, setItems] = useState<Item[]>(p?.items.map((i) => ({ serviceId: i.serviceId, sessions: String(i.sessions), unit: centsText(i.unitCents) })) ?? [{ serviceId: "", sessions: "4", unit: "" }]);
  const [price, setPrice] = useState(centsText(p?.priceCents ?? null));
  const [validity, setValidity] = useState(p?.validityDays ? String(p.validityDays) : "");
  const [desc, setDesc] = useState(p?.description ?? "");
  const [active, setActive] = useState(p?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  // Serviço desativado que o pacote já usa continua na lista (senão o campo ficaria vazio).
  const options = services.filter((s) => s.active || items.some((i) => i.serviceId === s.id));
  const label = (id: string) => { const s = services.find((x) => x.id === id); return s ? prettyName(s.label) : ""; };
  const parsed = price.trim() ? parseBRL(price) : null;
  const sessions = Math.max(0, ...items.map((i) => Number(i.sessions) || 0));
  const perSession = parsed?.ok && sessions ? formatBRL(Math.round(parsed.cents / sessions)) : null;
  const setItem = (k: number, v: Partial<Item>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...v } : x)));

  const save = () => {
    setError(null);
    if (parsed && !parsed.ok) { setError(`Preço: ${parsed.error}`); return; }
    const chosen = items.filter((i) => i.serviceId);
    if (!chosen.length) { setError("Escolha o serviço do pacote."); return; }
    if (chosen.some((i) => !/^\d+$/.test(i.sessions) || Number(i.sessions) < 1)) { setError("Sessões: um número a partir de 1."); return; }
    if (validity && !/^\d+$/.test(validity)) { setError("Validade: número de dias."); return; }
    const units = chosen.map((i) => (i.unit.trim() ? parseBRL(i.unit) : null));
    const badUnit = units.find((u) => u && !u.ok);
    if (badUnit && !badUnit.ok) { setError(`Valor por sessão: ${badUnit.error}`); return; }
    const input = {
      id: p?.id ?? null, name: name.trim(), priceCents: parsed?.ok ? parsed.cents : null, validityDays: validity ? Number(validity) : null,
      description: desc.trim() || null, active, items: chosen.map((i, k) => { const u = units[k]; return { serviceId: i.serviceId, sessions: Number(i.sessions), unitCents: u?.ok ? u.cents : null }; }),
    };
    start(async () => {
      const r = await savePackageAction(input);
      if (!r.ok) { setError(r.error); return; }
      toast(p ? `${input.name} salvo` : `${input.name} criado`, "ok"); onClose();
    });
  };

  const footer = canEdit ? (
    <>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="gold" onClick={save} loading={pending} disabled={!name.trim()}>{p ? "Salvar" : "Criar pacote"}</Button>
    </>
  ) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={p ? p.name : "Novo pacote"} footer={footer} className="max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]">
      {!canEdit && p ? <ReadOnly p={p} /> : (
        <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:gap-8" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Nome" htmlFor="pk-nome">
              <Input id="pk-nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Combo Manutenção Método Fiaes®" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço do pacote (R$)" htmlFor="pk-preco" hint={perSession ? `${perSession} por sessão` : "O pacote inteiro; vazio = sem preço"}>
                <Input id="pk-preco" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="text-lg font-semibold tabular-nums" />
              </Field>
              <Field label="Validade (dias)" htmlFor="pk-validade" hint={validity ? packageValidityText(Number(validity)) : "Da compra até vencer; vazio = sem validade"}>
                <Input id="pk-validade" inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 365" className="tabular-nums" />
              </Field>
            </div>
            <Field label="Descrição para a IA" htmlFor="pk-desc" hint={`A IA usa este texto para explicar o pacote: o que inclui, a cada quanto tempo, parcelamento. ${desc.length}/${DESC_MAX}`}>
              <Textarea id="pk-desc" value={desc} onChange={(e) => setDesc(e.target.value.slice(0, DESC_MAX))} rows={3} placeholder="Ex.: 4 manutenções completas, uma a cada 3 meses. Parcela em até 10x sem juros." />
            </Field>
            {p && (
              <div className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line px-4 py-3">
                <div>
                  <p className="text-base font-medium text-ink">{active ? "Ativo" : "Desativado"}</p>
                  <p className="text-sm text-muted">{active ? "Aparece no caixa para vender e para a IA." : "Some do caixa e da IA. Quem já comprou continua com o pacote."}</p>
                </div>
                <Switch checked={active} onChange={setActive} label={active ? "Desativar o pacote" : "Ativar o pacote"} />
              </div>
            )}
            {error && <p role="alert" className="rounded-[var(--radius-control)] bg-alert-soft px-3 py-2 text-sm text-alert">{error}</p>}
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-graphite">Serviços do pacote</legend>
            <p className="text-sm text-muted">Com mais de um serviço, cada visita usa uma sessão de cada.</p>
            <ul className="flex flex-col gap-2">
              {items.map((it, k) => {
                const nm = label(it.serviceId);
                return (
                  <li key={k} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-[var(--radius-control)] border border-line p-2.5">
                    <div className="col-span-3 min-w-0">
                      <label htmlFor={`pk-svc-${k}`} className="sr-only">Serviço {k + 1}</label>
                      <Select id={`pk-svc-${k}`} value={it.serviceId} onChange={(e) => setItem(k, { serviceId: e.target.value, unit: "" })}>
                        <option value="">Escolha o serviço</option>
                        {options.filter((s) => s.id === it.serviceId || !items.some((x) => x.serviceId === s.id)).map((s) => <option key={s.id} value={s.id}>{prettyName(s.label)}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label htmlFor={`pk-ses-${k}`} className="sr-only">Sessões{nm ? ` de ${nm}` : ""}</label>
                      <Input id={`pk-ses-${k}`} inputMode="numeric" value={it.sessions} onChange={(e) => setItem(k, { sessions: e.target.value.replace(/\D/g, "") })} className="text-center tabular-nums" aria-describedby={`pk-ses-u-${k}`} />
                    </div>
                    <span id={`pk-ses-u-${k}`} className="text-sm text-graphite">{Number(it.sessions) === 1 ? "sessão" : "sessões"}</span>
                    <button type="button" onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((_, i) => i !== k) : [{ serviceId: "", sessions: "4", unit: "" }]))}
                      aria-label={`Tirar ${nm || `a linha ${k + 1}`}`} className="h-10 rounded-[9px] px-2.5 text-sm text-graphite hover:bg-paper-2 hover:text-ink pointer-coarse:min-h-11">Tirar</button>
                    {/* Valor de cada sessão deste serviço (base da comissão quando a cliente usa a sessão). Antes só em /caixa/pacotes (Plano 5). */}
                    <div className="col-span-3 flex items-center gap-2">
                      <label htmlFor={`pk-unit-${k}`} className="text-sm text-graphite">Valor por sessão</label>
                      <Input id={`pk-unit-${k}`} aria-label={`Valor por sessão${nm ? ` de ${nm}` : ""} (R$)`} inputMode="decimal" value={it.unit} placeholder="opcional"
                        onChange={(e) => setItem(k, { unit: e.target.value })} className="max-w-[140px] tabular-nums" />
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setItems((xs) => [...xs, { serviceId: "", sessions: String(sessions || 4), unit: "" }])}>Adicionar serviço</Button>
          </fieldset>
        </form>
      )}
    </Sheet>
  );
}

function ReadOnly({ p }: { p: PackageCard }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-semibold tabular-nums text-ink">{p.priceCents == null ? "Sem preço" : formatBRL(p.priceCents)}</p>
        <p className="text-base text-graphite">{sessionsText(p.sessions)}{p.priceCents != null ? ` · ${formatBRL(Math.round(p.priceCents / p.sessions))} por sessão` : ""} · {packageValidityText(p.validityDays)}</p>
      </div>
      <p className="text-base text-ink">{p.items.map((i, k) => `${sessionsText(i.sessions)} de ${prettyName(p.serviceLabels[k] ?? "")}`).join(" + ")}</p>
      {p.description && <p className="max-w-[65ch] text-base leading-relaxed text-ink">{p.description}</p>}
      <p className="text-sm text-muted">Para mudar o pacote, fale com a recepção ou a gestão.</p>
    </div>
  );
}
