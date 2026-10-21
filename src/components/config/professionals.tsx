"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { createProfessionalAction } from "@/app/(app)/config/actions";
import type { WhoSuggestion } from "@/server/domain/agenda/who-does-what";
import type { BusinessHours } from "@/lib/business-hours";
import { proPhotoUrl } from "@/lib/pro-photo";
import { cn } from "@/lib/cn";
import { ProAvatar } from "@/components/agenda/pro-avatar";
import { displayName } from "@/lib/display-name";
import { ProfessionalPanel, ServicePicker, type Pro, type Service } from "./professional-sheet";
import { WhoDoesWhat } from "./who-does-what";
import { ProAccessPanel } from "./pro-access";
import type { ProAccess } from "@/server/domain/pro/access";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const BASE = "/config/profissionais";

/**
 * Profissionais (6.10): à esquerda as ativas (foto, nome, "Cargo · N serviços") e "Desativadas · N" recolhido; à direita a ficha da
 * escolhida (`?id=`), em blocos. No celular, uma coisa de cada vez: a lista, ou a ficha com "‹ Profissionais". A aba "Quem faz o quê" (6A)
 * continua igual.
 */
export function ProfessionalsEditor({ tab, items, services, casa, suggestions, selectedId, access, canPayout = false }: {
  tab: "lista" | "matriz"; items: Pro[]; services: Service[]; casa: BusinessHours; suggestions: WhoSuggestion[]; selectedId: string | null;
  /** Lote 7A: "Acesso ao app" de cada profissional; só vem para quem gere a equipe. */
  access?: Record<string, ProAccess> | null;
  /** Fase A: quem paga a comissão (`comissao.pagar`) vê o período do repasse na ficha. */ canPayout?: boolean;
}) {
  const opened = items.find((p) => p.id === selectedId) ?? null;
  const active = items.filter((p) => p.active), inactive = items.filter((p) => !p.active);
  const suggestionsOf = (id: string) => suggestions.filter((s) => s.professionalId === id);

  if (!services.length) return (
    <p className="rounded-[var(--radius-card)] border border-line bg-paper px-4 py-6 text-sm text-graphite">
      Cadastre primeiro os serviços da Casa em <Link className="font-medium text-gold-ink underline underline-offset-4" href="/servicos">Serviços</Link>.
    </p>
  );
  const nameOf = (id: string | null) => items.find((x) => x.id === id)?.name ?? null;
  // 17/10: a equipe vê quem é assistente de quem ("Sidney (assistente de Thaise)"); a cliente vê só a principal.
  const assistantLine = (p: Pro) => (p.assistantOf && nameOf(p.assistantOf) ? `assistente de ${displayName(nameOf(p.assistantOf)!)}` : null);
  const row = (p: Pro) => (
    <li key={p.id}>
      <Link href={`${BASE}?id=${p.id}`} aria-label={`Abrir ${p.name}`} aria-current={p.id === selectedId ? "page" : undefined}
        className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors", p.id === selectedId ? "bg-paper-2" : "hover:bg-paper-2/70")}>
        <ProAvatar name={p.name} color={p.color} photoUrl={proPhotoUrl(p.id, p.photoVersion)} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block truncate text-sm text-graphite">{[assistantLine(p), p.role, plural(p.serviceIds.length, "serviço", "serviços")].filter(Boolean).join(" · ")}</span>
        </span>
      </Link>
    </li>
  );

  return (
    <div>
      <nav aria-label="Profissionais e serviços" className="mb-4 inline-flex rounded-[var(--radius-control)] border border-line-strong p-1">
        {([["lista", "Profissionais", BASE], ["matriz", "Quem faz o quê", `${BASE}?aba=matriz`]] as const).map(([v, label, href]) => (
          <Link key={v} href={href} aria-current={tab === v ? "page" : undefined}
            className={cn("inline-flex h-11 items-center gap-1.5 rounded-[calc(var(--radius-control)-4px)] px-3.5 text-sm font-medium transition-colors sm:h-8",
              tab === v ? "bg-ink text-paper" : "text-graphite hover:text-ink")}>
            {label}{v === "matriz" && suggestions.length > 0 && <span className={cn("rounded-full px-1.5 text-xs tabular", tab === v ? "bg-paper/20" : "bg-gold-soft text-gold-ink")}>{suggestions.length}</span>}
          </Link>
        ))}
      </nav>
      {tab === "matriz" ? <WhoDoesWhat pros={active} services={services} suggestions={suggestions} /> : (
        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={cn("flex flex-col gap-3", selectedId && "hidden lg:flex")}>
            <Link href={`${BASE}?id=nova`} aria-label="+ Adicionar profissional"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-line-strong text-sm font-medium hover:bg-paper-2 lg:min-h-10">+ Adicionar profissional</Link>
            <ul aria-label="Profissionais ativas" className="divide-y divide-line/70 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper">
              {active.map(row)}
              {active.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nenhuma profissional ativa.</li>}
            </ul>
            {inactive.length > 0 && (
              <details className="rounded-[var(--radius-card)] border border-line bg-paper">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-graphite">{`Desativadas · ${inactive.length}`}</summary>
                <ul aria-label="Profissionais desativadas" className="divide-y divide-line/70 border-t border-line opacity-80">{inactive.map(row)}</ul>
              </details>
            )}
          </aside>
          <div className={cn("min-w-0", !selectedId && "hidden lg:block")}>
            {selectedId && <Link href={BASE} className="mb-3 inline-flex min-h-11 items-center text-sm font-medium text-graphite lg:hidden">‹ Profissionais</Link>}
            {selectedId === "nova" ? <AddForm services={services} />
              : opened ? (
                <div className="flex flex-col gap-4">
                  <ProfessionalPanel key={opened.id} pro={opened} services={services} casa={casa} suggestions={suggestionsOf(opened.id)} canPayout={canPayout}
                    team={items.filter((x) => x.active && x.id !== opened.id && !x.assistantOf).map((x) => ({ id: x.id, name: x.name }))} />
                  {access && <ProAccessPanel key={`acesso-${opened.id}`} professionalId={opened.id} name={opened.name} access={access[opened.id] ?? null} />}
                </div>
              )
              : <div className="rounded-[var(--radius-card)] border border-line bg-paper"><Empty title="Escolha uma profissional na lista">A ficha dela abre aqui: foto, dados, horário de trabalho e serviços.</Empty></div>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ services }: { services: Service[] }) {
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4"
      onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = await createProfessionalAction({ name, fullName, role, serviceIds: picked });
        if (r.ok) { setName(""); setFullName(""); setRole(""); setPicked([]); toast("Profissional adicionada"); } else toast(r.error, "error");
      }); }}>
      <p className="text-base font-medium">Adicionar profissional</p>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apelido (nome na agenda), ex.: Carla" aria-label="Apelido da profissional (nome na agenda)" maxLength={60} />
      <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo (opcional)" aria-label="Nome completo da profissional" maxLength={120} />
      <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Cargo (opcional), ex.: Cabeleireira" aria-label="Cargo da profissional" maxLength={60} />
      <p className="text-sm text-graphite">Serviços que ela faz</p>
      <ServicePicker services={services} value={picked} onToggle={toggle} />
      <Button type="submit" loading={pending} disabled={!name.trim()}>Adicionar</Button>
    </form>
  );
}
