"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconCheck, IconClock, IconSearch } from "@/components/icons";
import { Sheet } from "@/components/ui/sheet";
import { ChangeFlash } from "@/components/motion/change-flash";
import { TeamNowStrip } from "@/components/team/team-now";
import { HELP_HREF } from "@/lib/alert-copy";
import { parseEtiquetaRegra, queueQuery, type QueueParams } from "@/lib/queue";
import { activeFilters, equipeHref, FOCO_CHIP, OUTSIDE_VIEWS, QUEUE_TABS, TAB_LABEL, VIEW_CHIP, queueTab, tabHref, type QueueTab } from "@/lib/queue-filters";
import { cn } from "@/lib/cn";
import type { QueueCounts } from "@/server/queries/queue";
import type { TeamNow } from "@/server/queries/team-now";
import { HideWhileSelecting, SelectToggle } from "./queue-selection";
import { useDesktop } from "./use-desktop";
import { NewConversationButton } from "./new-conversation";

export type QueueFilterOptions = {
  /** Etapas do funil que podem estar na Fila (a Casa tem um funil só: o filtro é a etapa dele). */
  stages: { key: string; name: string; color?: string | null; kind?: string }[];
  /** Pessoas para o filtro por dona; vazio = quem vê não filtra por dona (sem "ver conversas de todas"). */
  owners: { id: string; name: string }[];
  tags: { id: string; name: string; uses: number }[];
  /** Campanhas para o filtro "Veio de anúncio" (uma por nome; o valor é um id de anúncio). */
  ads?: { id: string; label: string }[];
};

const TAB_N = (tab: QueueTab, c: QueueCounts) => (tab === "todas" ? c.todasTotal ?? c.views.todos ?? c.total : tab === "nao-lidas" ? c.naoLidas ?? 0 : tab === "retomar" ? c.retomar ?? 0 : tab === "esperando" ? c.aguardando : c.views.arquivadas ?? 0);
const VIEWS = ["meus", "sem-dono", "parados", "agendados-hoje", "clientes-ativos", "sem-contato-90d"] as const;
const FOCOS = ["aguardando", "atrasados", "combinados", "reclamacao", "evento", "retomar"] as const;
const FOCO_N: Record<(typeof FOCOS)[number], (c: QueueCounts) => number> = {
  aguardando: (c) => c.aguardando, atrasados: (c) => c.atrasados, combinados: (c) => c.tarefasAtrasadas, reclamacao: (c) => c.reclamacoes ?? 0, evento: (c) => c.eventos ?? 0, retomar: (c) => c.retomar ?? 0,
};
const SELECT = "h-11 lg:h-10 w-full rounded-[var(--radius-control)] border border-control bg-paper px-3 text-[16px] lg:text-sm";

/** Botão de escolha do painel (liga/desliga): mesmo desenho das abas, com o número. */
function Choice({ label, n, on, onClick }: { label: string; n?: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors lg:min-h-9",
        on ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:brightness-[0.97]")}>
      {label}{n != null && <> <b className="font-semibold tabular">{n}</b></>}
    </button>
  );
}

/**
 * O topo da Fila no desenho aprovado: busca e "Filtros" na mesma linha; embaixo só três abas (Todas, Não lidas, Resolvidas) e "Selecionar";
 * os filtros ligados aparecem como chips com ✕. Minhas, Esperando, Sem dono, Atrasados, Combinados, etapa, dona e etiqueta moram no painel "Filtros"
 * (folha lateral no computador, de baixo no celular), que aplica na hora. Tudo troca a URL; o servidor refaz a lista.
 */
export function QueueTop({ params, counts, options, team, onlyOwn = false, programadas, progress = null }: {
  params: QueueParams; counts: QueueCounts; options: QueueFilterOptions; team?: TeamNow;
  /** "(só os seus)" no chip do filtro vindo de relatório, para a atendente. */ onlyOwn?: boolean;
  /** Aba "Programadas N" (outra tela: Mensagens programadas). */ programadas?: number;
  /** Progresso do dia da Casa toda (`dayProgressText`, montado no servidor): número neutro, sem ranking. */ progress?: { text: string; done: boolean } | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const desktop = useDesktop();
  const [text, setText] = useState(params.q ?? "");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (patch: Partial<Record<keyof QueueParams, string | null>>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = queueQuery(Object.fromEntries(next) as Record<string, string>);
    router.replace(qs ? `/atendimento?${qs}` : "/atendimento?view=todos", { scroll: false });
  };
  const onText = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 300);
  };

  const tab = queueTab(params);
  const names = {
    // "followup" é a estação Aguardando cliente da Jornada (a etapa desse tipo).
    etapa: options.stages.find((s) => s.key === params.etapa)?.name ?? (params.etapa === "followup" ? options.stages.find((s) => s.kind === "followup")?.name ?? "Aguardando cliente" : null),
    dono: options.owners.find((o) => o.id === params.dono)?.name ?? null,
    anuncio: options.ads?.find((a) => a.id === params.anuncio)?.label ?? null,
    etiqueta: options.tags.find((t) => t.id === params.etiqueta)?.name ?? null,
    etiquetas: (params.etiquetas ?? "").split(",").filter(Boolean).map((id) => options.tags.find((t) => t.id === id)?.name ?? null),
  };
  const picked = (params.etiquetas ?? "").split(",").filter(Boolean);
  const regra = parseEtiquetaRegra(params.regra);
  const toggleTag = (id: string) => { const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, 10); go({ etiquetas: next.length ? next.join(",") : null, regra: next.length ? params.regra ?? null : null }); };
  const chips = activeFilters(params, names, { onlyOwn });
  const closed = tab === "resolvidas";
  const view = params.view && params.view !== "todos" && params.view !== "arquivadas" && params.view !== "resolvidas" ? params.view : null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="sr-only">Fila</h2>
      <HideWhileSelecting className="flex gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Buscar na fila</span>
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input type="search" value={text} onChange={(e) => onText(e.target.value)} placeholder={desktop ? "Nome, telefone ou mensagem" : "Buscar"} autoComplete="off" enterKeyHint="search"
            className="w-full h-11 lg:h-10 pl-9 pr-3 rounded-[12px] border-0 bg-paper-2 text-[16px] lg:text-sm placeholder:text-muted" />
        </label>
        <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} aria-label={chips.length ? `Filtros · ${chips.length} ${chips.length === 1 ? "ligado" : "ligados"}` : "Filtros"}
          className={cn("h-11 lg:h-10 shrink-0 rounded-[12px] border px-3 text-[16px] lg:text-sm font-medium transition-colors",
            chips.length ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-paper-2")}>
          Filtros{chips.length ? ` · ${chips.length}` : ""}
        </button>
        {/* Celular: o "Nova conversa" (no computador fica na barra do Atendimento, que no celular não tem lugar). */}
        <NewConversationButton compact className="lg:hidden" />
      </HideWhileSelecting>
      <div className="flex items-center gap-2">
        {/* As abas quebram linha (20/10: no computador "Para retomar" e "Resolvidas" ficavam cortadas, escondidas fora da tela). */}
        <nav aria-label="Abas da fila" className="-mx-1 -my-1 flex min-w-0 flex-1 flex-wrap items-center gap-1 px-1">
          {QUEUE_TABS.map((t) => {
            const on = t === tab;
            return (
              // O alvo de toque é a linha de 44 px (a aba desenhada tem 34 px).
              <Link key={t} href={tabHref(t, params)} replace scroll={false} aria-current={on ? "page" : undefined} className="group inline-flex min-h-11 shrink-0 items-center rounded-full outline-none lg:min-h-9">
                <span className={cn("inline-flex h-[34px] items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-sm font-medium transition-colors",
                  "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-gold", on ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 group-hover:brightness-[0.97]")}>
                  {TAB_LABEL[t]} <ChangeFlash value={TAB_N(t, counts)} disabled={on}><b className="font-semibold tabular">{TAB_N(t, counts)}</b></ChangeFlash>
                </span>
              </Link>
            );
          })}
        </nav>
        <SelectToggle compact className="-mr-1.5 shrink-0" />
      </div>
      {/* Progresso do dia (pesquisa 20/10): "12 de 15 respondidas hoje"; sem ninguém esperando, o estado vazio positivo. Da Casa toda, sem nomes. */}
      {progress && (
        <HideWhileSelecting className="flex">
          <p data-testid="progresso-dia" className={cn("inline-flex items-center gap-1.5 px-1 text-xs tabular", progress.done ? "font-medium text-ok" : "text-graphite")}>
            {progress.done && <IconCheck size={13} aria-hidden />}{progress.text}
          </p>
        </HideWhileSelecting>
      )}
      {/* Mensagens programadas (outra tela): a linha só aparece com alguma esperando para sair; no computador também fica na barra do Atendimento. */}
      {(programadas ?? 0) > 0 && (
        <HideWhileSelecting className="flex">
          <Link href="/atendimento/programadas" aria-label={`Programadas ${programadas}`}
            className="inline-flex min-h-9 items-center gap-2 rounded-full bg-paper-2 px-3 text-sm font-medium text-ink-2 hover:brightness-[0.97] pointer-coarse:min-h-11">
            <IconClock size={14} aria-hidden className="text-gold" />
            {programadas === 1 ? "1 mensagem programada" : `${programadas} mensagens programadas`} ›
          </Link>
        </HideWhileSelecting>
      )}
      {/* Mensagem nova de alguém da Equipe: acende aqui (a Equipe fica fora da lista de clientes, no painel Filtros). */}
      {(counts.equipeNaoLidas ?? 0) > 0 && params.view !== "equipe" && (
        <HideWhileSelecting className="flex">
          <Link href={equipeHref(params)} replace scroll={false} data-equipe-nao-lidas=""
            className="inline-flex min-h-9 items-center gap-2 rounded-full bg-ok-soft px-3 text-sm font-medium text-ok pointer-coarse:min-h-11">
            <span aria-hidden className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ok px-1 text-xs font-bold leading-none text-white tabular">{counts.equipeNaoLidas}</span>
            Equipe: {counts.equipeNaoLidas === 1 ? "1 conversa não lida" : `${counts.equipeNaoLidas} conversas não lidas`} ›
          </Link>
        </HideWhileSelecting>
      )}
      {chips.length > 0 && (
        <HideWhileSelecting className="flex flex-wrap items-center gap-1.5 text-xs text-graphite">
          <span>Filtro:</span>
          <span role="group" aria-label="Filtros ligados" className="contents">
            {chips.map((c) => (
              <Link key={c.key} href={c.href} replace scroll={false} aria-label={`Tirar o filtro ${c.label}`}
                className="group inline-flex min-h-8 items-center rounded-full outline-none pointer-coarse:min-h-11">
                <span className="inline-flex items-center gap-1 rounded-full bg-paper-3/60 px-2.5 py-1 font-medium text-ink-2 group-hover:bg-paper-3 group-focus-visible:outline-2 group-focus-visible:outline-gold">
                  {c.label}<span aria-hidden className="text-muted">✕</span>
                </span>
              </Link>
            ))}
          </span>
          <Link href={tabHref(tab, { q: params.q })} replace scroll={false} className="inline-flex min-h-8 items-center underline underline-offset-2 hover:text-ink pointer-coarse:min-h-11">Mostrar todos</Link>
        </HideWhileSelecting>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Filtros" side={desktop ? "right" : "bottom"}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <Link href={tabHref(tab, { q: params.q })} replace scroll={false} className="inline-flex min-h-11 items-center text-sm font-medium text-graphite underline underline-offset-2 hover:text-ink">Limpar filtros</Link>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-[var(--radius-control)] bg-ink px-5 text-sm font-semibold text-paper">Pronto</button>
          </div>
        }>
        <div className="flex flex-col gap-5">
          {closed && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">Nas Resolvidas valem a busca e a etiqueta. Os outros filtros são da aba Todas.</p>}
          <section role="group" aria-label="Quem" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted" aria-hidden>Quem</h3>
            <div className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => <Choice key={v} label={VIEW_CHIP[v]} n={counts.views[v]} on={view === v} onClick={() => go({ view: view === v ? null : v, aba: v === "sem-contato-90d" ? null : params.aba ?? null })} />)}
            </div>
          </section>
          <section role="group" aria-label="Fora das etapas" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted" aria-hidden>Fora das etapas</h3>
            <div className="flex flex-wrap gap-1.5">
              {OUTSIDE_VIEWS.map((v) => <Choice key={v} label={VIEW_CHIP[v]} n={counts.views[v]} on={view === v} onClick={() => go({ view: view === v ? null : v, aba: null, foco: null, etapa: null, dono: null, filtro: null })} />)}
            </div>
            <p className="text-xs text-muted">Equipe: números de funcionárias (avisam, mas não contam nas etapas). Fornecedores: conversas de fornecedor, fora da Fila e dos números. Spam: guardado; o número mostra quem mandou mensagem nova.</p>
          </section>
          <section role="group" aria-label="Situação" className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-muted" aria-hidden>Situação</h3>
            <div className="flex flex-wrap gap-1.5">
              {FOCOS.filter((f) => f === "aguardando" || f === "atrasados" || f === "combinados" || FOCO_N[f](counts) > 0 || params.foco === f).map((f) => (
                <Choice key={f} label={FOCO_CHIP[f]} n={FOCO_N[f](counts)} on={params.foco === f} onClick={() => go({ foco: params.foco === f ? null : f })} />
              ))}
            </div>
          </section>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Etapa da conversa</span>
            <select aria-label="Etapa da conversa" value={params.etapa ?? ""} onChange={(e) => go({ etapa: e.target.value || null })} className={SELECT}>
              <option value="">Todas as etapas</option>
              {options.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </label>
          {options.owners.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Dona</span>
              <select aria-label="Dona" value={params.dono ?? ""} onChange={(e) => go({ dono: e.target.value || null })} className={SELECT}>
                <option value="">Qualquer pessoa</option>
                <option value="sem">Sem dona</option>
                {options.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Veio de anúncio</span>
            <select aria-label="Veio de anúncio" value={params.anuncio ?? ""} onChange={(e) => go({ anuncio: e.target.value || null })} className={SELECT}>
              <option value="">Qualquer</option>
              <option value="sim">Veio de anúncio</option>
              <option value="nao">Não veio de anúncio</option>
              {(options.ads ?? []).length > 0 && <optgroup label="Campanha">{options.ads!.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>}
            </select>
          </label>
          {options.tags.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">Etiqueta</span>
              <select aria-label="Filtrar por etiqueta" value={params.etiqueta ?? ""} onChange={(e) => go({ etiqueta: e.target.value || null })} className={SELECT}>
                <option value="">Todas as etiquetas</option>
                {options.tags.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.uses})</option>)}
              </select>
            </label>
          )}
          {options.tags.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-semibold text-muted">Mais etiquetas</legend>
              <div role="group" aria-label="Regra das etiquetas" className="flex gap-1.5">
                {([["qualquer", "Tem qualquer"], ["todas", "Tem todas"], ["nao_tem", "Não tem"]] as const).map(([v, label]) => (
                  <Choice key={v} label={label} on={regra === v} onClick={() => go({ regra: v === "qualquer" ? null : v })} />
                ))}
              </div>
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto" aria-label="Etiquetas">
                {options.tags.map((t) => (
                  <li key={t.id}>
                    <label className="flex min-h-11 items-center gap-2.5 text-sm lg:min-h-8">
                      <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggleTag(t.id)} aria-label={t.name} />
                      <span className="min-w-0 flex-1 truncate">{t.name}</span><span className="text-muted tabular">{t.uses}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Dias sem conversar</span>
            <select aria-label="Dias sem conversar" value={params.dias ?? ""} onChange={(e) => go({ dias: e.target.value || null })} className={SELECT}>
              <option value="">Qualquer</option>
              {[7, 15, 30, 60, 90, 180].map((n) => <option key={n} value={n}>{n} dias ou mais</option>)}
            </select>
          </label>
          {team && <section aria-label="Equipe agora" className="flex flex-col gap-1 border-t border-line pt-4"><h3 className="text-xs font-semibold text-muted" aria-hidden>Equipe agora</h3><TeamNowStrip team={team} now={new Date()} /></section>}
          <Link href={HELP_HREF} className="text-sm font-medium text-gold-ink underline-offset-4 hover:underline">O que cada aviso quer dizer</Link>
        </div>
      </Sheet>
    </div>
  );
}
