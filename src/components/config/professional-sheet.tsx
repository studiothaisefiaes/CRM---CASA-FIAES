"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Input, Select } from "@/components/ui/field";
import { displayName } from "@/lib/display-name";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { acceptSuggestionsAction, setAppearanceAction, setProfessionalServiceAction, updateProfessionalAction } from "@/app/(app)/config/actions";
import type { WhoSuggestion } from "@/server/domain/agenda/who-does-what";
import type { BusinessHours } from "@/lib/business-hours";
import type { WorkHours } from "@/lib/work-hours";
import { PALETTE, textOn } from "@/lib/palette";
import { proPhotoUrl } from "@/lib/pro-photo";
import { cn } from "@/lib/cn";
import { formatCnpj } from "@/lib/cnpj";
import { PAYOUT_PERIODS, PAYOUT_PERIOD_LABEL, type PayoutPeriod } from "@/lib/payout-period";
import { WorkHoursEditor } from "./work-hours-editor";
import { PhotoField } from "./photo-field";
import { ServicesByCategory } from "./services-by-category";

export type Pro = {
  id: string; name: string; fullName: string | null; role: string | null; active: boolean; serviceIds: string[];
  workHours: WorkHours | null; color: string | null; agendaPosition: number | null; photoVersion: string | null;
  /** De quem é assistente (17/10); vazio = atende em nome próprio. */ assistantOf?: string | null;
  /** Dados fiscais (Fase D). */ bond?: "parceira" | "clt" | "outro" | null; cnpj?: string | null; legalName?: string | null;
  /** Período do repasse da comissão (Fase A); vazio = mensal. */ payoutPeriod?: PayoutPeriod;
};
const BOND_OPTIONS: { value: "parceira" | "clt" | "outro"; label: string }[] = [
  { value: "parceira", label: "Parceira (salão-parceiro)" }, { value: "clt", label: "CLT" }, { value: "outro", label: "Outro" },
];
export type Service = { id: string; label: string; category?: string | null };

/** Marca/desmarca serviços em botões (o "Adicionar profissional" e a matriz do 6A usam). */
export function ServicePicker({ services, value, onToggle, disabled }: { services: Service[]; value: string[]; onToggle: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => {
        const on = value.includes(s.id);
        return (
          <button key={s.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => onToggle(s.id)}
            className={cn("min-h-11 rounded-full border px-3 text-sm transition-colors disabled:opacity-60 lg:min-h-8",
              on ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{s.label}</button>
        );
      })}
    </div>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5">
      <h2 id={id} className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const same = (a: string, b: string | null) => a.trim().replace(/\s+/g, " ") === (b ?? "");

/**
 * A ficha da profissional (6.10), em blocos: Foto; Dados (nome na agenda, cargo, nome completo, cor e ordem); Dias e horário de trabalho
 * (sem horário próprio, segue o da Casa, e a tela diz); Serviços que faz (por categoria, com as sugestões do Avec); Salvar e Desativar.
 * Foto, horário e serviços gravam na hora; "Salvar" grava os Dados. O e-mail para o app dela entra com o 7A.
 */
export function ProfessionalPanel({ pro, services, casa, suggestions, team = [], canPayout = false }: {
  pro: Pro; services: Service[]; casa: BusinessHours; suggestions: WhoSuggestion[];
  /** Quem pode ser a principal dela (ativas, sem ser assistente). */ team?: { id: string; name: string }[];
  /** Quem paga a comissão (`comissao.pagar`) vê e muda o período do repasse. */ canPayout?: boolean;
}) {
  const [name, setName] = useState(pro.name);
  const [fullName, setFullName] = useState(pro.fullName ?? "");
  const [role, setRole] = useState(pro.role ?? "");
  const [color, setColor] = useState<string | null>(pro.color);
  const [position, setPosition] = useState(pro.agendaPosition ? String(pro.agendaPosition) : "");
  const [ids, setIds] = useState(pro.serviceIds);
  const [assistantOf, setAssistantOf] = useState(pro.assistantOf ?? "");
  const [bond, setBond] = useState<"parceira" | "clt" | "outro" | null>(pro.bond ?? null);
  const [cnpj, setCnpj] = useState(formatCnpj(pro.cnpj));
  const [legalName, setLegalName] = useState(pro.legalName ?? "");
  const [payout, setPayout] = useState<PayoutPeriod>(pro.payoutPeriod ?? "mensal");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const pos = position.trim() === "" ? null : Number(position);
  const dirtyAssistant = (assistantOf || null) !== (pro.assistantOf ?? null);
  const dirtyBond = bond !== (pro.bond ?? null);
  const dirtyCnpj = cnpj.replace(/\D/g, "") !== (pro.cnpj ?? "");
  const dirtyLegal = !same(legalName, pro.legalName ?? null);
  const dirtyPayout = canPayout && payout !== (pro.payoutPeriod ?? "mensal");
  const dirtyData = !same(name, pro.name) || !same(fullName, pro.fullName) || !same(role, pro.role) || dirtyAssistant || dirtyBond || dirtyCnpj || dirtyLegal || dirtyPayout;
  const dirtyLook = color !== pro.color || pos !== pro.agendaPosition;

  const save = () => start(async () => {
    if (pos !== null && (!Number.isInteger(pos) || pos < 1 || pos > 999)) { toast("Use um número de 1 a 999 na ordem.", "error"); return; }
    if (dirtyData) {
      const r = await updateProfessionalAction(pro.id, {
        name, fullName, role, ...(dirtyAssistant ? { assistantOf: assistantOf || null } : {}),
        ...(dirtyBond ? { bond } : {}), ...(dirtyCnpj ? { cnpj: cnpj.replace(/\D/g, "") || null } : {}), ...(dirtyLegal ? { legalName: legalName.trim() || null } : {}),
        ...(dirtyPayout ? { payoutPeriod: payout } : {}),
      });
      if (!r.ok) { toast(r.error, "error"); return; }
    }
    if (dirtyLook) { const r = await setAppearanceAction(pro.id, { color, agendaPosition: pos }); if (!r.ok) { toast(r.error, "error"); return; } }
    toast("Dados salvos");
    router.refresh();
  });
  const setActive = (active: boolean) => start(async () => {
    const r = await updateProfessionalAction(pro.id, { active });
    if (r.ok) { toast(active ? `${pro.name} reativada` : `${pro.name} desativada: não aparece mais ao marcar`); router.refresh(); return; }
    if (active || !r.error.includes("remarque antes")) { toast(r.error, "error"); return; }
    // 6.4, regra 14: com horários marcados o servidor recusa com a lista; forçar fica registrado.
    toast(r.error, "error", { label: "Desativar mesmo assim", onClick: () => start(async () => {
      const f = await updateProfessionalAction(pro.id, { active: false, force: true });
      toast(f.ok ? `${pro.name} desativada (os horários dela continuam na agenda)` : f.error, f.ok ? "ok" : "error");
      router.refresh();
    }) });
  });
  const toggle = (id: string) => {
    const on = !ids.includes(id);
    setIds((x) => (on ? [...x, id] : x.filter((s) => s !== id)));
    start(async () => {
      const r = await setProfessionalServiceAction(pro.id, id, on);
      if (!r.ok) { setIds((x) => (on ? x.filter((s) => s !== id) : [...x, id])); toast(r.error, "error"); }
    });
  };
  const acceptAll = () => start(async () => {
    const r = await acceptSuggestionsAction({ professionalId: pro.id });
    if (!r.ok) { toast(r.error, "error"); return; }
    setIds((x) => [...new Set([...x, ...suggestions.map((s) => s.serviceId)])]);
    toast("Serviços marcados");
  });
  const label = "flex flex-col gap-1.5 text-sm font-medium text-graphite";

  return (
    <section aria-label={`Ficha de ${pro.name}`} className="flex flex-col gap-4">
      <Block id={`foto-${pro.id}`} title="Foto">
        <PhotoField professionalId={pro.id} name={pro.name} color={color} photoUrl={proPhotoUrl(pro.id, pro.photoVersion, "full")} />
      </Block>
      <Block id={`dados-${pro.id}`} title="Dados">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Nome na agenda<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
          <label className={label}>Cargo<Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="não informado" maxLength={60} /></label>
          <label className={cn(label, "sm:col-span-2")}>Nome completo
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="não informado" maxLength={120} />
            <span className="font-normal text-muted">Liga com as vendas que vêm do Avec.</span>
          </label>
          <label className={cn(label, "sm:col-span-2")}>Assistente de
            <Select value={assistantOf} onChange={(e) => setAssistantOf(e.target.value)}>
              <option value="">Ninguém: atende em nome próprio</option>
              {(pro.assistantOf && !team.some((t) => t.id === pro.assistantOf) ? [{ id: pro.assistantOf, name: "a principal atual" }, ...team] : team)
                .map((t) => <option key={t.id} value={t.id}>{displayName(t.name)}</option>)}
            </Select>
            <span className="font-normal text-muted">Para a cliente, quem atende é a principal: o lembrete, a página da cliente e a IA usam o nome dela.</span>
          </label>
          {canPayout && (
            <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <label className={label}>Repasse
                <Select value={payout} onChange={(e) => setPayout(e.target.value as PayoutPeriod)}>
                  {PAYOUT_PERIODS.map((p) => <option key={p} value={p}>{PAYOUT_PERIOD_LABEL[p]}</option>)}
                </Select>
              </label>
              <span className="text-muted">De quanto em quanto tempo ela recebe a comissão: o A pagar sugere pagar até o fim do último período fechado.</span>
            </div>
          )}
        </div>
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium text-graphite">Cor na agenda</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor na agenda">
            {PALETTE.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={color === c.key} aria-label={c.label} title={c.label} onClick={() => setColor(c.key)}
                className={cn("grid size-11 place-items-center rounded-full border-2 transition-transform lg:size-9", color === c.key ? "scale-110 border-ink" : "border-transparent")}
                style={{ background: c.hex, color: textOn(c.hex) }}>{color === c.key ? "✓" : ""}</button>
            ))}
            <button type="button" role="radio" aria-checked={color === null} onClick={() => setColor(null)}
              className={cn("h-11 rounded-full border px-3 text-sm lg:h-9", color === null ? "border-ink bg-paper-2" : "border-line-strong text-graphite")}>Sem cor</button>
          </div>
        </fieldset>
        <label className={cn(label, "mt-4")}>Ordem na agenda
          <Input type="number" inputMode="numeric" min={1} max={999} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="pelo nome" className="w-32" />
        </label>
      </Block>
      <Block id={`vinculo-${pro.id}`} title="Vínculo">
        <div role="radiogroup" aria-label="Vínculo" className="flex flex-wrap gap-2">
          {BOND_OPTIONS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={bond === o.value} onClick={() => setBond(bond === o.value ? null : o.value)}
              className={cn("min-h-11 rounded-full border px-3 text-sm transition-colors lg:min-h-8", bond === o.value ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{o.label}</button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{bond === "parceira" ? "A nota mostra a parte dela como cota-parte, com o CNPJ." : "Só a parceira precisa de CNPJ. Para as outras, deixe como está."}</p>
        {bond === "parceira" && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className={label}>CNPJ da parceira<Input inputMode="numeric" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" /></label>
            <label className={label}>Razão social da parceira<Input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={150} placeholder="como está no CNPJ" /></label>
          </div>
        )}
      </Block>
      <Block id={`horario-${pro.id}`} title="Dias e horário de trabalho">
        <WorkHoursEditor professionalId={pro.id} name={pro.name} value={pro.workHours} casa={casa} />
      </Block>
      <Block id={`servicos-${pro.id}`} title="Serviços que faz">
        <ServicesByCategory services={services} value={ids} onToggle={toggle} suggestions={suggestions} onAcceptAll={acceptAll} pending={pending} />
      </Block>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant={pro.active ? "danger" : "secondary"} loading={pending} onClick={() => setActive(!pro.active)}>{pro.active ? "Desativar" : "Reativar"}</Button>
        <Button loading={pending} disabled={!dirtyData && !dirtyLook} onClick={save}>Salvar</Button>
      </div>
    </section>
  );
}
