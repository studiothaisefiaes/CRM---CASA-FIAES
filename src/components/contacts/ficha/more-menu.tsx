"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamContactAction } from "@/app/(app)/funil/actions";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconMore } from "@/components/icons";
import { ProfileField } from "./editable";
import { CpfField } from "./cpf-field";
import { CampoField } from "./campo-field";
import type { StepQuestion } from "@/lib/ficha-view";
import { imageUseLabel, type ImageUse } from "@/lib/client-alert";

export type EditableData = {
  name: string; nickname: string; email: string; instagram: string; /** WhatsApp principal, formatado; vazio quando é número oculto ou "pessoa a mais" no número de outra. */ phone?: string; phoneHidden?: boolean; phoneAlt: string; birthday: string; hairType: string; cpf: string | null;
  preferredId: string; preferredHint: string; preferredAuto: string; professionals: { id: string; name: string }[];
  /** Uso de imagem (item 20): "sim" | "nao" | "" (não informado), a data "AAAA-MM-DD", e o que a pessoa pode: sem a função some, sem a permissão só lê. */
  imageUse?: string; imageUseOn?: string; imageUseMode?: "off" | "read" | "edit";
  /** Campos da ficha (item 25b) em uso, com a resposta: só vêm para quem pode responder (fichas.responder) com a função ligada. */
  campos?: StepQuestion[];
};
const IMAGE_USE_OPTIONS = [{ value: "", label: "Não informado" }, { value: "sim", label: "Sim, autorizou" }, { value: "nao", label: "Não autorizou" }];

/**
 * O "⋯" da ficha: Exportar conversa (texto, PDF, com notas internas), É da equipe e Editar dados.
 * As ações são as mesmas de antes (mesmas Server Actions); só mudaram de lugar. Editar dados salva cada campo ao sair dele.
 */
export function FichaMoreMenu({ contactId, canExport, canTeam, canMerge = false, isTeam, data, phone = null }: { /** Celular: Ligar e WhatsApp saem dos botões da ficha e moram aqui (um botão principal só). */ phone?: string | null; contactId: string; canExport: boolean; canTeam: boolean; canMerge?: boolean; isTeam: boolean; data: EditableData }) {
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  // Download de arquivo (não é navegação de página): um link temporário baixa sem sair da ficha.
  const exportar = (q: string) => { const a = document.createElement("a"); a.href = `/api/contatos/${contactId}/conversa?${q}`; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); };
  const team = () => start(async () => {
    const r = await setTeamContactAction(contactId, !isTeam);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(isTeam ? "Voltou a ser cliente" : "Marcada como Equipe · a conversa fica na aba Equipe das Conversas", "ok");
  });
  const items: MenuItem[] = [
    ...(phone ? [
      { label: "Ligar", onSelect: () => { window.location.href = `tel:${phone}`; } },
      { label: "Abrir no WhatsApp", onSelect: () => { window.open(`https://wa.me/${phone.replace(/\D/g, "")}`, "_blank", "noopener"); } },
    ] : []),
    { label: "Editar dados", detail: "Nome, aniversário, e-mail, CPF, preferida…", onSelect: () => setEditing(true) },
    ...(canExport ? [
      { label: "Exportar conversa (texto)", onSelect: () => exportar("formato=txt") },
      { label: "Exportar conversa (PDF)", onSelect: () => exportar("formato=pdf") },
      { label: "Exportar com notas internas", detail: "Só para uso da equipe", onSelect: () => exportar("formato=txt&notas=1") },
    ] : []),
    { label: "Trazer conversa antiga do WhatsApp", detail: "Pelo “Exportar conversa” do celular. Não envia nada", onSelect: () => router.push(`/contatos/${contactId}/trazer-conversa`) },
    ...(canMerge ? [{ label: "Unir com…", detail: "Junta dois cadastros da mesma cliente", onSelect: () => router.push(`/contatos/${contactId}/unir`) }] : []),
    ...(canTeam ? [{ label: isTeam ? "Não é da equipe" : "É da equipe", detail: isTeam ? "Volta a ser cliente" : "Número de funcionária: sai das etapas e das métricas", onSelect: team }] : []),
  ];
  return (
    <>
      <Menu label="Mais ações" items={items} trigger={<IconMore size={20} />}
        triggerClassName="size-11 border border-line-strong bg-paper text-ink hover:bg-paper-2 lg:size-10" />
      <Dialog open={editing} onClose={() => setEditing(false)} title="Editar dados" width={560}
        description="Cada campo salva sozinho quando você sai dele."
        footer={<Button onClick={() => setEditing(false)}>Pronto</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ProfileField contactId={contactId} name="name" label="Nome" value={data.name} placeholder="Nome da cliente" />
          <ProfileField contactId={contactId} name="nickname" label="Como gosta de ser chamada" value={data.nickname} placeholder="Ex.: Bia" />
          <ProfileField contactId={contactId} name="birthday" label="Aniversário" kind="birthday" value={data.birthday} placeholder="dd/mm ou dd/mm/aaaa" />
          <ProfileField contactId={contactId} name="email" label="E-mail" kind="email" value={data.email} placeholder="nome@exemplo.com" />
          <ProfileField contactId={contactId} name="instagram" label="Instagram" value={data.instagram} placeholder="@perfil" />
          {!data.phoneHidden && <ProfileField contactId={contactId} name="phone" label="WhatsApp" value={data.phone ?? ""} placeholder="(71) 99999-9999"
            hint={data.phone ? undefined : "Ela usa o número de outra pessoa. Escreva o WhatsApp dela para ter conversa própria."} />}
          <ProfileField contactId={contactId} name="phoneAlt" label="Outro telefone" value={data.phoneAlt} placeholder="(71) 9…" />
          <ProfileField contactId={contactId} name="hairType" label="Tipo de cabelo" value={data.hairType} placeholder="Ex.: cacheado 3B" />
          <ProfileField contactId={contactId} name="preferredProfessionalId" label="Profissional preferida" kind="select" value={data.preferredId} hint={data.preferredHint}
            options={[{ value: "", label: data.preferredAuto }, ...data.professionals.map((x) => ({ value: x.id, label: x.name }))]} />
          {data.imageUseMode === "edit" && (
            <>
              <ProfileField contactId={contactId} name="imageUse" label="Uso de imagem" kind="select" value={data.imageUse ?? ""} options={IMAGE_USE_OPTIONS} />
              {data.imageUse === "sim" && <ProfileField contactId={contactId} name="imageUseOn" label="Autorizou desde" kind="date" value={data.imageUseOn ?? ""} />}
            </>
          )}
          {data.imageUseMode === "read" && (
            <p className="text-sm text-graphite sm:col-span-2">Uso de imagem: <span className="font-medium text-ink">{imageUseLabel((data.imageUse || null) as ImageUse | null, data.imageUseOn || null)}</span>. Só quem tem a permissão de uso de imagem muda.</p>
          )}
          <div className="sm:col-span-2"><CpfField contactId={contactId} value={data.cpf} /></div>
          {data.campos && data.campos.length > 0 && (
            <fieldset className="grid gap-3 border-t border-line pt-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="pr-2 text-sm font-semibold text-graphite">Campos da ficha</legend>
              {data.campos.map((q) => <CampoField key={q.id} contactId={contactId} q={q} />)}
            </fieldset>
          )}
        </div>
      </Dialog>
    </>
  );
}
