"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { addPersonAction, createClientAction } from "@/app/(app)/contatos/actions";
import { contactHref } from "@/lib/lead-href";
import { formatCpf, isValidCpf } from "@/lib/cpf";

/**
 * "Nova cliente" (Clientes): nome e telefone obrigatórios; e-mail, CPF e aniversário opcionais. Não abre conversa nem manda mensagem.
 * Telefone que já existe não duplica: o aviso leva à ficha que existe e oferece "Adicionar como outra pessoa neste número" (mãe e filha no
 * mesmo celular, 17/10): ela ganha ficha própria e a conversa continua a do número.
 */
export function NewClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="h-10 pointer-coarse:min-h-11" onClick={() => setOpen(true)}><IconPlus size={16} />Nova cliente</Button>
      <NewClientDialog key={open ? "aberto" : "fechado"} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", birthday: "", cpf: "" });
  const [err, setErr] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string | null } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter(); const toast = useToast();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErr(null); setExisting(null); };
  const submit = () => start(async () => {
    if (!form.name.trim() || !form.phone.trim()) { setErr("Nome e telefone são obrigatórios."); return; }
    if (form.cpf && !isValidCpf(form.cpf)) { setErr("CPF inválido."); return; }
    const r = await createClientAction(form);
    if (!r.ok) { setErr(r.error); setExisting("existing" in r ? r.existing : null); return; }
    onClose(); toast(`${form.name.trim()} cadastrada`, "ok"); router.push(contactHref(r.data!.contactId));
  });
  const addToNumber = () => start(async () => {
    if (!existing?.id) return;
    const r = await addPersonAction({ contactId: existing.id, name: form.name, email: form.email, birthday: form.birthday, cpf: form.cpf });
    if (!r.ok) { setErr(r.error); return; }
    onClose(); toast(`${form.name.trim()} cadastrada no mesmo número${existing.name ? ` de ${existing.name}` : ""}`, "ok"); router.push(contactHref(r.data!.contactId));
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nova cliente" description="Cadastra a cliente sem mandar mensagem. Para conversar, use “Iniciar conversa” na ficha."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Cadastrar</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Nome" htmlFor="nc-nome"><Input id="nc-nome" autoComplete="off" value={form.name} onChange={set("name")} required /></Field>
        <Field label="Telefone (WhatsApp)" htmlFor="nc-fone"><Input id="nc-fone" inputMode="tel" placeholder="71 99999-9999" value={form.phone} onChange={set("phone")} required /></Field>
        <Field label="E-mail (opcional)" htmlFor="nc-email"><Input id="nc-email" type="email" inputMode="email" value={form.email} onChange={set("email")} /></Field>
        <Field label="CPF (opcional)" htmlFor="nc-cpf"><Input id="nc-cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={form.cpf}
          onChange={(e) => { setForm((f) => ({ ...f, cpf: formatCpf(e.target.value) })); setErr(null); }} /></Field>
        <Field label="Aniversário (opcional)" htmlFor="nc-aniv" hint="Dia/mês, ex.: 14/11 ou 14/11/1990"><Input id="nc-aniv" inputMode="numeric" placeholder="dd/mm" value={form.birthday} onChange={set("birthday")} /></Field>
        {err && (
          <p role="alert" className="text-sm text-alert">
            {err}{existing?.id && <> <Link href={contactHref(existing.id)} className="font-semibold underline underline-offset-2">Abrir a ficha{existing.name ? ` de ${existing.name}` : ""}</Link></>}
          </p>
        )}
        {existing?.id && (
          <div className="flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-paper-2 px-3 py-2.5">
            <p className="text-sm text-graphite">É outra pessoa que usa o mesmo WhatsApp (filha, mãe, marido…)?</p>
            <Button variant="secondary" onClick={addToNumber} loading={pending} className="self-start">Adicionar como outra pessoa neste número</Button>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
