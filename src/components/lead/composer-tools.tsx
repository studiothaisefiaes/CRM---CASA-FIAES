"use client";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { sendContactAction, sendLocationAction } from "@/app/(app)/conversa/actions";

/** "Como chegar": confirma e manda o pino da Casa. Só sai quando a atendente toca em Mandar. */
export function LocationDialog({ dealId, open, onClose, onSent }: { dealId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const send = () => start(async () => {
    const r = await sendLocationAction(dealId);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Pino da Casa enviado", "ok"); onClose(); onSent();
  });
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} title="Mandar o pino da Casa?" description="A cliente recebe o pino no mapa com o nome e o endereço da Casa."
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Voltar</Button><Button loading={pending} onClick={send}>Mandar</Button></>}>{null}</Dialog>
  );
}

/** "Mandar contato": nome e telefone do cartão. */
export function ContactDialog({ dealId, open, onClose, onSent }: { dealId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const send = () => start(async () => {
    const r = await sendContactAction(dealId, { fullName: name, phone });
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Contato enviado", "ok"); setName(""); setPhone(""); onClose(); onSent();
  });
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} title="Qual contato mandar?" description="A cliente recebe um cartão de contato com o nome e o telefone."
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Voltar</Button><Button loading={pending} disabled={!name.trim() || !phone.trim()} onClick={send}>Mandar</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Nome" htmlFor="ct-nome"><Input id="ct-nome" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Recepção Casa Fiaes" /></Field>
        <Field label="Telefone" htmlFor="ct-fone"><Input id="ct-fone" value={phone} maxLength={30} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="71 99999-9999" /></Field>
      </div>
    </Dialog>
  );
}
