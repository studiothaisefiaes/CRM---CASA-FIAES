"use client";
import Link from "next/link";
import { useMemo, useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { IconSearch } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ProAvatar } from "@/components/agenda/pro-avatar";
import { updateServiceAction } from "@/app/(app)/servicos/actions";
import { durationText, groupServices, packageLine, prettyName } from "@/lib/services-view";
import { formatBRL, parseBRL } from "@/lib/money";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/display-name";
import type { ServicePro, ServiceRow } from "@/server/domain/services";
import type { PackageCard } from "@/server/domain/caixa/packages";
import { NO_SHEET_OPTS, ServiceSheet, type ServiceSheetOpts } from "./service-sheet";
import { PackageSheet } from "./package-sheet";
import { PackageCards } from "./package-cards";

import type { ServicosTab } from "@/lib/servicos-tabs";
export type { ServicosTab };

type Filter = "todos" | "sem_duracao" | "sem_preco" | "desativados";
const centsText = (c: number | null) => (c == null ? "" : (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Serviços (pedido do dono, 16/10): a casa dos serviços e dos pacotes, numa tela só, com abas no topo (?aba=):
 * Serviços ("quanto custa e quem faz?"; cada serviço mostra os pacotes em que entra) · Pacotes (o catálogo: preço do pacote inteiro,
 * por sessão, sessões, validade). (Clientes com pacote agora é Clientes › Com pacote.)
 * Uma ação dourada por aba ("Novo serviço" / "Novo pacote"). Quem não pode mudar (atendente) só consulta.
 */
export function ServicesPage({ services, packages = [], professionals, canEdit, initialOpen, initialPackage = null, tab = "servicos", formas, fidelidade, produtos, soProdutos = false, sheetOpts = NO_SHEET_OPTS }: {
  services: ServiceRow[]; packages?: PackageCard[]; professionals: ServicePro[]; canEdit: boolean; initialOpen: string | null; initialPackage?: string | null;
  tab?: ServicosTab;
  /** Aba Formas de pagamento (Plano 3), só para quem gere o caixa: vem pronta do servidor. */ formas?: ReactNode;
  /** Aba Fidelidade (item 22): os programas da Casa; vem pronta do servidor. */ fidelidade?: ReactNode;
  /** Aba Produtos (Produtos e estoque ligado), para quem vê o catálogo ou mexe nele: vem pronta do servidor. */ produtos?: ReactNode;
  /** Perfil só com estoque (M-5): a página mostra só a aba Produtos. */ soProdutos?: boolean;
  /** Ficha do serviço (0084): custo, preço e tempo por profissional e "junto com outro", conforme permissões e funções. */ sheetOpts?: ServiceSheetOpts;
}) {
  const [pkgOpen, setPkgOpen] = useState<string | "novo" | null>(packages.some((p) => p.id === initialPackage) ? initialPackage : null);
  const currentPkg = pkgOpen && pkgOpen !== "novo" ? packages.find((p) => p.id === pkgOpen) ?? null : null;
  const activePkgs = packages.filter((p) => p.active);
  const tabs: [ServicosTab, string, string, number | null][] = soProdutos ? [["produtos", "Produtos", "/servicos?aba=produtos", null]] : [
    ["servicos", "Serviços", "/servicos", services.filter((s) => s.active).length],
    ["pacotes", "Pacotes", "/servicos?aba=pacotes", activePkgs.length],
    ...(produtos ? [["produtos", "Produtos", "/servicos?aba=produtos", null] as [ServicosTab, string, string, null]] : []),
    ["fidelidade", "Fidelidade", "/servicos?aba=fidelidade", null],
    ...(formas ? [["formas", "Formas de pagamento", "/servicos?aba=formas", null] as [ServicosTab, string, string, null]] : []),
  ];
  const subtitle = tab === "pacotes" ? `${activePkgs.length} ${activePkgs.length === 1 ? "pacote à venda" : "pacotes à venda"}${canEdit ? "" : " · só consulta"}`
    : tab === "formas" ? "As outras formas que o caixa aceita" : tab === "fidelidade" ? "Os programas de pontos e prêmios da Casa" : tab === "produtos" ? "O que a Casa vende e quanto tem" : null;
  const action = !canEdit || tab === "formas" || tab === "fidelidade" || tab === "produtos" ? undefined
    : tab === "pacotes" ? <Button variant="gold" onClick={() => setPkgOpen("novo")}>Novo pacote</Button> : undefined;

  return (
    <main className="pb-16">
      {tab === "servicos" ? <ServicesTab services={services} packages={activePkgs} professionals={professionals} canEdit={canEdit} initialOpen={initialOpen} tabs={<Tabs tabs={tabs} current={tab} />} sheetOpts={sheetOpts} /> : (
        <>
          <PageHeader title="Serviços" subtitle={subtitle} actions={action} tabs={<Tabs tabs={tabs} current={tab} />} />
          <div className="flex flex-col gap-6 px-5 lg:px-8">
            {tab === "pacotes" ? <><PackageCards packages={packages} onOpen={setPkgOpen} />{canEdit && <p className="mt-4 text-sm text-graphite">Pacotes de clientes que venceram ou estão sem valor: <Link href="/caixa/pacotes" className="font-medium text-gold-ink underline underline-offset-4">dar novo prazo e valor por sessão</Link>.</p>}</> : tab === "formas" ? formas : tab === "fidelidade" ? fidelidade : produtos}
          </div>
        </>
      )}
      {tab === "pacotes" && <PackageSheet key={pkgOpen ?? "fechado"} open={!!pkgOpen} pkg={currentPkg} services={services} canEdit={canEdit} onClose={() => setPkgOpen(null)} />}
    </main>
  );
}

/** As três abas da tela (links: a aba fica no endereço e o "voltar" funciona). */
function Tabs({ tabs, current }: { tabs: [ServicosTab, string, string, number | null][]; current: ServicosTab }) {
  return (
    <nav aria-label="Serviços e pacotes" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 scroll-thin lg:mx-0 lg:px-0">
      {tabs.map(([k, label, href, n]) => (
        <Link key={k} href={href} aria-current={k === current ? "page" : undefined}
          className={cn("-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-base font-medium transition-colors",
            k === current ? "border-ink text-ink" : "border-transparent text-graphite hover:text-ink")}>
          {label}{n != null && <span className={cn("text-sm tabular-nums", k === current ? "text-graphite" : "text-muted")}>{n}</span>}
        </Link>
      ))}
    </nav>
  );
}

function ServicesTab({ services, packages, professionals, canEdit, initialOpen, tabs, sheetOpts }: { services: ServiceRow[]; packages: PackageCard[]; professionals: ServicePro[]; canEdit: boolean; initialOpen: string | null; tabs: ReactNode; sheetOpts: ServiceSheetOpts }) {
  const inPackages = useMemo(() => {
    const m = new Map<string, PackageCard[]>();
    for (const p of packages) for (const i of p.items) m.set(i.serviceId, [...(m.get(i.serviceId) ?? []), p]);
    return m;
  }, [packages]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [open, setOpen] = useState<string | "novo" | null>(services.some((s) => s.id === initialOpen) ? initialOpen : null);
  const pros = useMemo(() => new Map(professionals.map((p) => [p.id, p])), [professionals]);
  const active = services.filter((s) => s.active);
  const counts = { sem_duracao: active.filter((s) => !s.durationMin).length, sem_preco: active.filter((s) => s.priceCents == null).length, desativados: services.length - active.length };
  const base = filter === "desativados" ? services.filter((s) => !s.active)
    : filter === "sem_duracao" ? active.filter((s) => !s.durationMin)
    : filter === "sem_preco" ? active.filter((s) => s.priceCents == null) : active;
  const groups = groupServices(base, q, filter === "desativados");
  const categories = useMemo(() => [...new Set(services.map((s) => s.category).filter((c): c is string => !!c?.trim()))], [services]);
  const current = open && open !== "novo" ? services.find((s) => s.id === open) ?? null : null;
  const chips: [Filter, string, number | null][] = [["todos", "Todos", active.length], ["sem_duracao", "Sem duração", counts.sem_duracao], ["sem_preco", "Sem preço", counts.sem_preco], ["desativados", "Desativados", counts.desativados]];

  return (
    <>
      <PageHeader title="Serviços"
        subtitle={`${active.length} ${active.length === 1 ? "serviço ativo" : "serviços ativos"}${canEdit ? "" : " · só consulta"}`}
        actions={canEdit ? <Button variant="gold" onClick={() => setOpen("novo")}>Novo serviço</Button> : undefined} tabs={tabs} />
      <div className="flex flex-col gap-6 px-5 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="search" className="relative w-full lg:max-w-md">
            <label htmlFor="servicos-q" className="sr-only">Buscar serviço</label>
            <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id="servicos-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar serviço" autoComplete="off" enterKeyHint="search"
              className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-md text-ink outline-none transition-[border-color,box-shadow] focus:border-ink focus:shadow-[0_0_0_3px_rgb(184_134_63/0.22)] lg:h-10 lg:text-base" />
          </div>
          <nav aria-label="Mostrar" className="flex flex-wrap gap-2">
            {chips.filter(([k, , n]) => k === "todos" || n).map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors lg:h-9",
                  filter === k ? "border-ink bg-ink text-paper" : "border-line bg-paper text-graphite hover:border-line-strong hover:text-ink")}>
                {label}<span className={cn("tabular-nums", filter === k ? "text-paper/70" : "text-muted")}>{n}</span>
              </button>
            ))}
          </nav>
        </div>
        {filter === "sem_duracao" && <p className="-mt-2 text-sm text-graphite">Sem a duração, a Agenda não sugere horário livre para o serviço.</p>}

        {groups.map((g) => (
          <section key={g.label} aria-labelledby={`cat-${g.label}`} className="flex flex-col gap-2">
            <h2 id={`cat-${g.label}`} className="flex items-baseline gap-2 text-base font-semibold text-ink">
              {g.label}<span className="text-sm font-normal text-muted tabular-nums">{g.items.length}</span>
            </h2>
            <ul className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-card)]">
              {g.items.map((s) => <Row key={`${s.id}:${s.priceCents}:${s.active}`} s={s} packages={inPackages.get(s.id) ?? []} pros={s.professionalIds.map((id) => pros.get(id)).filter((p): p is ServicePro => !!p)} canEdit={canEdit} onOpen={() => setOpen(s.id)} />)}
            </ul>
          </section>
        ))}
        {!groups.length && (
          <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-10 text-center">
            <p className="text-base text-ink">{q ? `Nenhum serviço com “${q}”.` : "Nada aqui."}</p>
            {q && <button type="button" onClick={() => setQ("")} className="mt-2 text-sm font-medium text-gold-ink underline underline-offset-4">Limpar a busca</button>}
          </div>
        )}
      </div>
      <ServiceSheet key={open ?? "fechado"} open={!!open} service={current} professionals={professionals} categories={categories} canEdit={canEdit} onClose={() => setOpen(null)}
        packages={current ? inPackages.get(current.id) ?? [] : []} opts={sheetOpts} />
    </>
  );
}

function Row({ s, packages, pros, canEdit, onOpen }: { s: ServiceRow; packages: PackageCard[]; pros: ServicePro[]; canEdit: boolean; onOpen: () => void }) {
  const name = prettyName(s.label);
  // Clique em qualquer parte vazia da linha abre o painel; o preço e o interruptor têm o próprio clique.
  const rowClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("input,button,label")) onOpen(); };
  return (
    <li onClick={rowClick} className={cn("grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-paper-2/60",
      "lg:grid-cols-[minmax(0,1fr)_132px_92px_150px_48px] lg:gap-x-5", !s.active && "text-muted")}>
      <button type="button" onClick={onOpen} className="col-start-1 row-start-1 min-h-11 min-w-0 text-left lg:min-h-0">
        <span className={cn("block text-base font-medium leading-snug", s.active ? "text-ink" : "text-muted")}>{name}</span>
        {s.description && <span className="mt-0.5 block text-sm leading-snug text-muted">{s.description}</span>}
        {packages.length > 0 && <span className="mt-1 block text-sm leading-snug text-gold-ink">Também em pacote: {packages.map(packageLine).join("; ")}</span>}
        {!s.active && <span className="mt-1 inline-block rounded-full bg-paper-3 px-2 py-0.5 text-xs font-medium text-graphite">Desativado</span>}
      </button>
      <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
        <Who pros={pros} />
        <span className={cn("whitespace-nowrap text-sm tabular-nums lg:text-right", s.durationMin ? "text-graphite" : "text-muted")}>{durationText(s.durationMin)}</span>
      </div>
      <div className="col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto">
        {canEdit ? <PriceInput s={s} name={name} /> : <span className={cn("text-lg font-semibold tabular-nums", s.priceCents == null ? "text-muted" : "text-ink")}>{s.priceCents == null ? "Sem preço" : formatBRL(s.priceCents)}</span>}
      </div>
      <div className="col-start-2 row-start-2 justify-self-end lg:col-start-auto lg:row-start-auto">
        {canEdit && <ActiveSwitch s={s} name={name} />}
      </div>
    </li>
  );
}

/** Quem faz: as fotos (ou iniciais) das profissionais: até 4; com mais, 3 e quantas mais. */
function Who({ pros }: { pros: ServicePro[] }) {
  if (!pros.length) return <span className="text-sm text-muted">Ninguém marcado</span>;
  const shown = pros.length > 4 ? pros.slice(0, 3) : pros;
  return (
    <span className="flex items-center gap-1" title={pros.map((p) => displayName(p.name)).join(", ")} aria-label={`Quem faz: ${pros.map((p) => displayName(p.name)).join(", ")}`} role="img">
      {shown.map((p) => <ProAvatar key={p.id} name={p.name} color={p.color} photoUrl={p.photoUrl} size={28} soft className="ring-1 ring-paper" />)}
      {pros.length > shown.length && <span className="grid size-7 place-items-center rounded-full bg-paper-3 text-xs font-semibold text-graphite tabular-nums">+{pros.length - shown.length}</span>}
    </span>
  );
}

/**
 * Preço na própria linha: digita e sai do campo (ou Enter) para ver "R$ 150 → R$ 180" com Salvar e Cancelar; só grava em Salvar (psico r68 #20:
 * "600" no lugar de "60" valia para toda comanda nova sem ninguém perceber). Esc ou Cancelar volta ao preço de antes. Vazio = sem preço.
 */
function PriceInput({ s, name }: { s: ServiceRow; name: string }) {
  const [v, setV] = useState(centsText(s.priceCents));
  const [saved, setSaved] = useState(centsText(s.priceCents));
  const [draft, setDraft] = useState<{ cents: number | null } | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const was = () => { const p = saved.trim() ? parseBRL(saved) : null; return p && p.ok ? formatBRL(p.cents) : "sem preço"; };
  const commit = () => {
    if (draft) return;
    const t = v.trim();
    if (t === saved) return;
    let cents: number | null = null;
    if (t) { const p = parseBRL(t); if (!p.ok) { toast(p.error, "error"); setV(saved); return; } cents = p.cents; }
    setDraft({ cents });
  };
  const cancel = () => { setDraft(null); setV(saved); };
  const confirm = () => {
    if (!draft) return;
    const { cents } = draft;
    start(async () => {
      const r = await updateServiceAction(s.id, { priceCents: cents });
      if (!r.ok) { toast(r.error, "error"); cancel(); return; }
      const clean = centsText(cents); setV(clean); setSaved(clean); setDraft(null);
      toast(cents == null ? `${name}: sem preço` : `${name}: ${formatBRL(cents)}`, "ok");
    });
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancel(); e.currentTarget.blur(); } };
  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center justify-end gap-1">
        <span className="text-sm text-muted">R$</span>
        <input inputMode="decimal" value={v} placeholder="sem preço" disabled={pending} readOnly={!!draft} aria-label={`Preço de ${name}`}
          onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={key}
          className="h-11 w-[104px] rounded-[9px] lg:h-10 lg:w-[112px] border border-transparent bg-transparent px-2 text-right text-lg font-semibold tabular-nums text-ink outline-none transition-colors placeholder:text-sm placeholder:font-normal placeholder:text-muted hover:border-line-strong focus:border-ink focus:bg-paper" />
      </label>
      {draft && (
        <div role="group" aria-label={`Confirmar novo preço de ${name}`} className="flex flex-wrap items-center justify-end gap-2 rounded-[var(--radius-control)] bg-gold-soft/60 px-2 py-1.5 text-sm">
          <span className="tabular-nums">{was()} → <strong>{draft.cents == null ? "sem preço" : formatBRL(draft.cents)}</strong></span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>Cancelar</Button>
          <Button size="sm" loading={pending} onClick={confirm}>Salvar</Button>
        </div>
      )}
    </div>
  );
}

function ActiveSwitch({ s, name }: { s: ServiceRow; name: string }) {
  const [on, setOn] = useState(s.active);
  const [pending, start] = useTransition();
  const toast = useToast();
  return <Switch checked={on} disabled={pending} label={on ? `Desativar ${name}` : `Ativar ${name}`} onChange={(v) => {
    setOn(v);
    start(async () => {
      const r = await updateServiceAction(s.id, { active: v });
      if (!r.ok) { setOn(!v); toast(r.error, "error"); return; }
      toast(v ? `${name} ativado` : `${name} desativado: some da Agenda e da IA`, "ok");
    });
  }} />;
}

