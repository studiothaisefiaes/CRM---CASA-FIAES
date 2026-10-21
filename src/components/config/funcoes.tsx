"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { SendConfirmDialog } from "@/components/config/send-confirm";
import { saveFuncaoAction } from "@/app/(app)/config/funcoes/actions";
import type { FuncaoDef } from "@/lib/funcoes";

type Value = { on: boolean; params: Record<string, number>; textos: Record<string, string> };
export type FuncaoItem = { def: FuncaoDef; value: Value };

/** Os assuntos de Recursos: cada seção responde uma pergunta e tem um Salvar só. As funções fora da lista caem em "Outros". */
export const FUNCAO_GRUPOS: { id: string; title: string; pergunta: string; keys: string[] }[] = [
  { id: "conversas", title: "Conversas", pergunta: "O que a atendente pode fazer na conversa?",
    keys: ["setores", "pausa_automaticas", "regras_acontecimento", "virada", "reagir", "editar_mensagem", "como_chegar", "mandar_contato", "encaminhar", "marcar_nao_lida", "acompanhar", "biblioteca"] },
  { id: "agenda", title: "Agenda", pergunta: "O que a Agenda mostra e permite?",
    keys: ["dias_especiais", "marcadores", "tipo_horario", "aviso_salta", "junto_com_outro", "repetir", "passar_dia", "preco_por_profissional"] },
  { id: "clientes", title: "Clientes", pergunta: "O que a ficha da cliente guarda?", keys: ["consentimento", "uso_imagem", "fichas", "fotos", "unir"] },
  { id: "caixa", title: "Caixa", pergunta: "O que a comanda e o caixa oferecem?", keys: ["fidelidade"] },
];

/** O que a Gestão vê em Configurações › Recursos: quatro seções por assunto, cada uma com interruptores, números e textos e um Salvar só. */
export function FuncoesEditor({ items }: { items: FuncaoItem[] }) {
  const usados = new Set(FUNCAO_GRUPOS.flatMap((g) => g.keys));
  const grupos = [...FUNCAO_GRUPOS, { id: "outros", title: "Outros", pergunta: "O que mais pode ser ligado?", keys: items.filter((i) => !usados.has(i.def.key)).map((i) => i.def.key) }]
    .map((g) => ({ ...g, items: g.keys.map((k) => items.find((i) => i.def.key === k)).filter((x): x is FuncaoItem => !!x) }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-8 text-center text-sm text-muted">Nenhum recurso novo por aqui ainda.</p>}
      {grupos.map((g, i) => <Grupo key={g.id} id={g.id} title={g.title} pergunta={g.pergunta} items={g.items} first={i === 0} />)}
    </div>
  );
}

type Draft = { params: Record<string, string>; textos: Record<string, string> };

/**
 * Uma seção de Recursos (r68 #9): acordeão (só a primeira nasce aberta, a página deixa de ter 6.000 px). Os interruptores salvam na hora;
 * números e textos ganham um Salvar por seção, que só aparece quando algo mudou (nunca cinza parado).
 */
function Grupo({ id, title, pergunta, items, first }: { id: string; title: string; pergunta: string; items: FuncaoItem[]; first: boolean }) {
  const [saved, setSaved] = useState<Record<string, Value>>(() => Object.fromEntries(items.map((i) => [i.def.key, i.value])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((i) => [i.def.key, { params: Object.fromEntries(Object.entries(i.value.params).map(([k, v]) => [k, String(v)])), textos: { ...i.value.textos } }])));
  const [confirm, setConfirm] = useState<FuncaoItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mudou, setMudou] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();

  const dirtyOf = (it: FuncaoItem) => {
    const d = drafts[it.def.key], sv = saved[it.def.key];
    const params = Object.fromEntries((it.def.params ?? []).filter((p) => d.params[p.key].trim() !== String(sv.params[p.key])).map((p) => [p.key, Number(d.params[p.key].replace(",", "."))]));
    const textos = Object.fromEntries((it.def.textos ?? []).filter((t) => d.textos[t.key].trim() !== sv.textos[t.key]).map((t) => [t.key, d.textos[t.key]]));
    return { params, textos, any: Object.keys(params).length + Object.keys(textos).length > 0 };
  };
  const sujos = items.filter((it) => dirtyOf(it).any);
  const setDraft = (key: string, f: (d: Draft) => Draft) => { setMudou(null); setDrafts((all) => ({ ...all, [key]: f(all[key]) })); };

  const toggle = (it: FuncaoItem, on: boolean, confirmou = false) => start(async () => {
    setErr(null);
    const r = await saveFuncaoAction(it.def.key, { on }, confirmou);
    setConfirm(null);
    if (!r.ok) return setErr(r.error);
    setSaved((s) => ({ ...s, [it.def.key]: { ...s[it.def.key], on } }));
    toast(on ? `${it.def.label} ligado` : `${it.def.label} desligado`, "ok");
  });
  /** Um Salvar por seção: grava, uma a uma, só as funções que mudaram, e diz quais. */
  const salvar = () => start(async () => {
    setErr(null);
    const feitos: string[] = [];
    for (const it of sujos) {
      const d = dirtyOf(it);
      const r = await saveFuncaoAction(it.def.key, { ...(Object.keys(d.params).length ? { params: d.params } : {}), ...(Object.keys(d.textos).length ? { textos: d.textos } : {}) }, false);
      if (!r.ok) { setErr(`${it.def.label}: ${r.error}`); break; }
      feitos.push(it.def.label);
      setSaved((s) => ({ ...s, [it.def.key]: { ...s[it.def.key], params: { ...s[it.def.key].params, ...d.params }, textos: { ...s[it.def.key].textos, ...Object.fromEntries(Object.entries(d.textos).map(([k, v]) => [k, v.trim()])) } } }));
      setDrafts((all) => ({ ...all, [it.def.key]: { ...all[it.def.key], textos: Object.fromEntries(Object.entries(all[it.def.key].textos).map(([k, v]) => [k, v.trim()])) } }));
    }
    if (feitos.length) { setMudou(`Salvo: ${feitos.join(", ")}.`); toast("Salvo", "ok"); }
  });

  const editavel = items.some((it) => (it.def.params ?? []).length > 0 || (it.def.textos ?? []).length > 0);
  const ligados = items.filter((it) => !it.def.ligaEm && saved[it.def.key].on).length, comChave = items.filter((it) => !it.def.ligaEm).length;
  return (
    <details open={first || sujos.length > 0 || undefined} className="group/sec rounded-[var(--radius-card)] border border-line bg-paper">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <h2 id={`grp-${id}`} className="text-lg font-semibold">{title}</h2>
          <span className="block text-sm text-graphite">{pergunta}</span>
        </span>
        {comChave > 0 && <span className="shrink-0 text-sm text-muted tabular">{ligados} de {comChave} {ligados === 1 ? "ligado" : "ligados"}</span>}
        <span aria-hidden className="shrink-0 text-graphite transition-transform group-open/sec:rotate-180">▾</span>
      </summary>
      <section aria-labelledby={`grp-${id}`} className="flex flex-col gap-4 border-t border-line px-5 pb-5 pt-4">
        {items.map((it) => (
          <FuncaoCard key={it.def.key} item={it} on={saved[it.def.key].on} draft={drafts[it.def.key]} pending={pending}
            onToggle={(on) => (on && it.def.enviaParaCliente ? setConfirm(it) : toggle(it, on))} onDraft={(f) => setDraft(it.def.key, f)} />
        ))}
        {err && <p className="text-sm text-alert" role="alert">{err}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-sm text-graphite" role="status">{mudou ?? (sujos.length ? `Vai mudar: ${sujos.map((i) => i.def.label).join(", ")}.` : editavel ? "" : "Os interruptores salvam na hora.")}</p>
          {(sujos.length > 0 || (pending && !confirm)) && <Button aria-label={`Salvar ${title}`} loading={pending && !confirm} onClick={salvar}>Salvar</Button>}
        </div>
      </section>
      <SendConfirmDialog open={!!confirm} pending={pending} onClose={() => setConfirm(null)} onConfirm={() => confirm && toggle(confirm, true, true)}
        what={confirm ? `${confirm.def.label}: ${confirm.def.description}` : ""} />
    </details>
  );
}

function FuncaoCard({ item: { def }, on, draft, pending, onToggle, onDraft }: { item: FuncaoItem; on: boolean; draft: Draft; pending: boolean; onToggle: (on: boolean) => void; onDraft: (f: (d: Draft) => Draft) => void }) {
  const params = draft.params, textos = draft.textos;
  return (
    <div role="group" aria-labelledby={`fn-${def.key}`} className="rounded-[var(--radius-control)] bg-paper-2/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id={`fn-${def.key}`} className="text-base font-semibold">{def.label}</h3>
          <p className="mt-1 max-w-[60ch] text-sm text-graphite">{def.description}</p>
          {def.enviaParaCliente && <p className="mt-1 text-xs text-muted">Manda mensagem para a cliente. Nasce desligado.</p>}
        </div>
        {def.ligaEm
          ? <Link href={def.ligaEm} className="shrink-0 text-sm font-medium text-ink underline underline-offset-2">Abrir</Link>
          : <Switch checked={on} label={on ? `Desligar ${def.label}` : `Ligar ${def.label}`} disabled={pending} onChange={onToggle} />}
      </div>
      {(def.params ?? []).length > 0 && (
        <div className="mt-4 grid gap-3 @min-[40rem]:grid-cols-2">
          {def.params!.map((p) => (
            <div key={p.key}>
              <label className="block text-sm font-medium text-graphite" htmlFor={`fn-${def.key}-${p.key}`}>{p.label}{p.unit ? ` (${p.unit})` : ""}</label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input id={`fn-${def.key}-${p.key}`} inputMode="decimal" className="w-28" value={params[p.key]} onChange={(e) => onDraft((d) => ({ ...d, params: { ...d.params, [p.key]: e.target.value } }))} />
                <Button size="sm" variant="ghost" disabled={params[p.key] === String(p.default)} aria-label={`Usar o padrão de ${p.label}`} onClick={() => onDraft((d) => ({ ...d, params: { ...d.params, [p.key]: String(p.default) } }))}>Usar o padrão ({p.default})</Button>
              </div>
              <p className="mt-1 text-xs text-muted">De {p.min} a {p.max}.</p>
            </div>
          ))}
        </div>
      )}
      {(def.textos ?? []).map((t) => (
        <div key={t.key} className="mt-4">
          <label className="block text-sm font-medium text-graphite" htmlFor={`fn-${def.key}-${t.key}`}>{t.label}</label>
          {t.help && <p className="text-xs text-muted">{t.help}</p>}
          <Textarea id={`fn-${def.key}-${t.key}`} className="mt-1.5 min-h-24" value={textos[t.key]} onChange={(e) => onDraft((d) => ({ ...d, textos: { ...d.textos, [t.key]: e.target.value } }))} />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {t.vars.length > 0 && <span className="text-xs text-muted">Variáveis:</span>}
            {t.vars.map((v) => <code key={v} className="rounded bg-paper-2 px-1.5 py-0.5 text-xs">{`{${v}}`}</code>)}
            <Button size="sm" variant="ghost" className="ml-auto" disabled={textos[t.key] === t.default} onClick={() => onDraft((d) => ({ ...d, textos: { ...d.textos, [t.key]: t.default } }))}>Usar o texto sugerido</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
