"use client";
import { useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { updateClientDataAction } from "@/app/(app)/conversa/actions";
import { updateDealAction } from "@/app/(app)/funil/actions";
import type { ContactProfilePatch } from "@/server/domain/contact-profile";
import type { DealDetail } from "@/server/queries/deal";
import { formatPhoneClient, isHiddenNumber } from "@/lib/phone-client";
import { birthdayText } from "@/lib/birthday";
import { formatCpf, isValidCpf, cpfDigits } from "@/lib/cpf";
import { originChoices } from "@/lib/origin-choices";
import { NOT_IDENTIFIED, isChannelOrigin } from "@/lib/source-kinds";
import { cn } from "@/lib/cn";
import { originLabel } from "@/lib/origin-label";


type Form = { name: string; nickname: string; phone: string; phoneAlt: string; birthday: string; email: string; instagram: string; preferredProfessionalId: string;
  hairType: string; alertNotes: string; notes: string; cpf: string };

/**
 * "Editar dados" da cliente (painel da conversa, 16/10): TODOS os campos num lugar só. Nada é obrigatório além do nome e do WhatsApp.
 * Grava só o que mudou (auditoria por campo; o CPF entra só pelo nome do campo). "Alergias e cuidados" vira aviso fixo no topo da conversa e da ficha.
 * "Como conheceu a Casa" e a "Objeção" são da conversa, salvas junto.
 */
export function DadosDialog({ open, onClose, d, onSaved, setOrigin }: {
  open: boolean; onClose: () => void; d: DealDetail; onSaved: (changed: number) => void;
  setOrigin: (choice: { sourceId: string } | { origin: string }) => Promise<boolean>;
}) {
  const c = d.contact;
  const initial: Form = useMemo(() => ({
    name: c.name ?? "", nickname: c.nickname ?? "", phone: isHiddenNumber(c.phoneE164) ? "" : formatPhoneClient(c.phoneE164), phoneAlt: c.phoneAlt ?? "",
    birthday: birthdayText(c), email: c.email ?? "", instagram: c.instagram ? `@${c.instagram}` : "", preferredProfessionalId: c.preferredProfessionalId ?? "",
    hairType: c.hairType ?? "", alertNotes: c.alertNotes ?? "", notes: c.notes ?? "", cpf: formatCpf(c.cpf),
  }), [c]);
  const [f, setF] = useState<Form>(initial);
  const choices = useMemo(() => originChoices(d.sources, d.origins), [d.sources, d.origins]);
  const known = d.sourceLabel !== NOT_IDENTIFIED && !isChannelOrigin(d.sourceLabel) ? d.sourceLabel : null;
  const [origem, setOrigem] = useState<string | null>(known);
  // Objeção da conversa (Plano 5: saiu do LeadSheet do Quadro; alimenta o relatório de perdas e objeções).
  const [objecao, setObjecao] = useState(d.deal.objectionId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: k === "cpf" ? formatCpf(e.target.value) : e.target.value })); setError(null); };
  const hidden = isHiddenNumber(c.phoneE164);
  const pros = d.professionals.filter((p) => p.active || p.id === c.preferredProfessionalId);

  const save = () => {
    if (!f.name.trim()) { setError("O nome é obrigatório."); return; }
    if (!hidden && !f.phone.trim()) { setError("O WhatsApp é obrigatório."); return; }
    if (cpfDigits(f.cpf) && !isValidCpf(f.cpf)) { setError("CPF inválido."); return; }
    const patch: ContactProfilePatch = {};
    (Object.keys(f) as (keyof Form)[]).forEach((k) => {
      if (f[k] === initial[k]) return;
      if (k === "phone" && hidden) return;
      if (k === "cpf") return; // o CPF vai pelo histórico da conversa ("informado"/"trocado", sem o número)
      (patch as Record<string, string | null>)[k] = f[k].trim() === "" ? null : f[k];
    });
    start(async () => {
      let changed = 0;
      if (f.cpf !== initial.cpf) {
        const r = await updateDealAction(d.deal.id, { cpf: cpfDigits(f.cpf) || null });
        if (!r.ok) { setError(r.error); return; }
        changed++;
      }
      if (objecao !== (d.deal.objectionId ?? "")) {
        const r = await updateDealAction(d.deal.id, { objectionId: objecao || null });
        if (!r.ok) { setError(r.error); return; }
        changed++;
      }
      if (Object.keys(patch).length) {
        const r = await updateClientDataAction(c.id, patch);
        if (!r.ok) { setError(r.error); return; }
        changed += r.data?.changed.length ?? 0;
      }
      if (origem && origem !== known) {
        const ch = choices.find((x) => x.label === origem);
        if (!(await setOrigin(ch?.sourceId ? { sourceId: ch.sourceId } : { origin: origem }))) { setError("Não deu para salvar como conheceu a Casa."); return; }
        changed++;
      }
      onSaved(changed);
    });
  };

  const field = (k: keyof Form, label: string, extra: Record<string, unknown> = {}) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-graphite">{label}</span>
      <Input value={f[k]} onChange={set(k)} autoComplete="off" className="h-11" {...extra} />
    </label>
  );

  return (
    <Dialog open={open} onClose={onClose} width={620} title={`Dados de ${(c.name ?? "").trim().split(/\s+/)[0] || "cliente"}`}
      description="Preencha o que souber. Nada é obrigatório além do nome e do WhatsApp."
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button><Button onClick={save} loading={pending}>Salvar dados</Button></>}>
      <div className="grid max-h-[min(60vh,520px)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {field("name", "Nome", { maxLength: 120 })}
        {field("nickname", "Como ela gosta de ser chamada", { placeholder: "Ex.: Bia", maxLength: 60 })}
        {hidden ? (
          <p className="flex flex-col gap-1 text-sm"><span className="text-xs font-semibold text-graphite">WhatsApp</span><span className="text-graphite">—</span></p>
        ) : field("phone", "WhatsApp", { type: "tel", inputMode: "tel" })}
        {field("phoneAlt", "Outro telefone (opcional)", { type: "tel", inputMode: "tel", placeholder: "(71) 3333-0000" })}
        {field("birthday", "Aniversário", { inputMode: "numeric", placeholder: "dd/mm ou dd/mm/aaaa", maxLength: 10 })}
        {field("email", "E-mail", { type: "email", inputMode: "email", placeholder: "nome@email.com" })}
        {field("instagram", "Instagram", { placeholder: "@usuario", maxLength: 60 })}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-graphite">Profissional preferida</span>
          <Select value={f.preferredProfessionalId} onChange={set("preferredProfessionalId")} className="h-11">
            <option value="">Ainda não tem</option>
            {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-semibold text-graphite" id="dados-origem">Como conheceu a Casa</span>
          <div role="radiogroup" aria-labelledby="dados-origem" className="flex flex-wrap gap-1.5">
            {[...choices.map((x) => x.label), ...(origem && !choices.some((x) => x.label === origem) ? [origem] : [])].map((label) => (
              <button key={label} type="button" role="radio" aria-checked={origem === label} onClick={() => setOrigem(label)}
                className={cn("min-h-9 rounded-full border px-3 text-sm pointer-coarse:min-h-11", origem === label ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:bg-paper-2")}>{originLabel(label)}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-graphite">Objeção</span>
          <Select value={objecao} onChange={(e) => { setObjecao(e.target.value); setError(null); }} className="h-11">
            <option value="">Nenhuma</option>
            {d.objections.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </label>
        {field("hairType", "Tipo de cabelo", { placeholder: "Ex.: cacheado 3B, com química", maxLength: 120 })}
        {field("cpf", "CPF (opcional)", { inputMode: "numeric", placeholder: "000.000.000-00" })}
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold text-graphite">Alergias e cuidados</span>
          <textarea value={f.alertNotes} onChange={set("alertNotes")} rows={2} maxLength={300} placeholder="Ex.: alergia a amônia (uma por linha)"
            className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-[16px] lg:text-sm" />
          <span className="text-xs text-muted">Aparece como aviso fixo no topo da conversa e da ficha.</span>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold text-graphite">Observações</span>
          <textarea value={f.notes} onChange={set("notes")} rows={3} maxLength={4000} placeholder="Tudo o que a equipe precisa saber dela"
            className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-[16px] lg:text-sm" />
        </label>
        {error && <p role="alert" className="text-sm text-alert sm:col-span-2">{error}</p>}
      </div>
    </Dialog>
  );
}
