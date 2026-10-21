"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { newConversationAction } from "@/app/(app)/funil/actions";
import { cn } from "@/lib/cn";

/**
 * "Nova conversa" (Atendimento): telefone e nome. Acha a cliente pelo telefone (ou cadastra) e abre a conversa com o campo de mensagem pronto.
 * Não envia nada sozinho: quem escreve é a Casa. Já há conversa aberta com ela: leva a essa.
 */
export function NewConversationButton({ compact = false, className }: { /** Só o "+" (celular, ao lado de Filtros). */ compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Nova conversa" title="Nova conversa"
        className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 bg-ink font-medium text-paper hover:bg-ink-2",
          compact ? "size-11 rounded-[12px]" : "ml-auto h-9 rounded-full px-3 text-sm pointer-coarse:min-h-11", className)}>
        <IconPlus size={compact ? 18 : 16} aria-hidden />{!compact && "Nova conversa"}
      </button>
      <NewConversationDialog key={open ? "aberto" : "fechado"} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewConversationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phone, setPhone] = useState(""); const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const router = useRouter(); const toast = useToast();
  const submit = () => start(async () => {
    if (!phone.trim()) { setErr("Informe o telefone."); return; }
    const r = await newConversationAction({ phone, name });
    if (!r.ok) { setErr(r.error); return; }
    onClose();
    toast(r.data!.created ? "Conversa aberta. Nada foi enviado: escreva a mensagem." : "Ela já tinha uma conversa aberta: abrimos essa.", "ok");
    router.push(`/atendimento/${r.data!.dealId}?compose=1`);
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nova conversa" description="Abre a conversa pronta para você escrever. Nada é enviado sozinho."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Abrir conversa</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Telefone (WhatsApp)" htmlFor="nconv-fone" error={err}>
          <Input id="nconv-fone" inputMode="tel" placeholder="71 99999-9999" value={phone} onChange={(e) => { setPhone(e.target.value); setErr(null); }} aria-invalid={!!err} />
        </Field>
        <Field label="Nome" htmlFor="nconv-nome" hint="Se ela já estiver cadastrada, vale o nome da ficha."><Input id="nconv-nome" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
