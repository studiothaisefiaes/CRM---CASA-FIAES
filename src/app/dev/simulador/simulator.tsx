"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { simulateAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

export function Simulator({ defaults }: { defaults: { phone: string; name: string; text: string } }) {
  const [phone, setPhone] = useState(defaults.phone); const [name, setName] = useState(defaults.name);
  const [text, setText] = useState(defaults.text); const [fromMe, setFromMe] = useState(false); const [ad, setAd] = useState(false);
  const [out, setOut] = useState<string>(""); const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <Field label="Telefone do cliente" htmlFor="s-phone"><Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Nome no WhatsApp" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mensagem" htmlFor="s-text"><Textarea id="s-text" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-base"><input type="checkbox" checked={fromMe} onChange={(e) => setFromMe(e.target.checked)} /> Enviada pela Casa pelo celular (fromMe)</label>
      <label className="flex items-center gap-2 text-base"><input type="checkbox" checked={ad} onChange={(e) => setAd(e.target.checked)} /> Veio de anúncio (Click-to-WhatsApp)</label>
      <div className="flex gap-2">
        <Button loading={pending} onClick={() => start(async () => setOut(JSON.stringify(await simulateAction({ phone, name, text, fromMe, ad }), null, 2)))}>Enviar evento</Button>
        <Link href="/atendimento" className="h-10 px-4 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong text-base">Abrir a fila</Link>
      </div>
      {out && <pre className="text-xs bg-paper-2 rounded-[var(--radius-control)] p-3 overflow-auto">{out}</pre>}
    </div>
  );
}
