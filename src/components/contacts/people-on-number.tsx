"use client";
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addPersonAction } from "@/app/(app)/contatos/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { IconPlus } from "@/components/icons";
import { contactHref } from "@/lib/lead-href";
import { displayName } from "@/lib/client-rhythm";
import { PHONE_RELATIONS } from "@/lib/phone-client";
import { cn } from "@/lib/cn";

export type NumberPerson = { id: string; name: string | null; relation: string | null; isHolder: boolean };

const personLabel = (p: NumberPerson) => displayName(p.name) || "Sem nome";

/**
 * "Pessoas neste número" (17/10, caso Cati: mãe e filha no mesmo celular). Lista quem usa o número, cada uma com a própria ficha, e
 * "+ Adicionar pessoa" (nome obrigatório, relação opcional). A conversa do WhatsApp é sempre a do titular do número.
 * Na ficha (`variant="ficha"`) e no painel Cliente da conversa (`variant="painel"`, mais compacto).
 */
export function PeopleOnNumber({ contactId, people, variant = "ficha" }: { contactId: string; people: NumberPerson[]; variant?: "ficha" | "painel" }) {
  const [list, setList] = useState(people);
  const [open, setOpen] = useState(false);
  const painel = variant === "painel";
  const others = list.filter((p) => p.id !== contactId);
  // Só ela no número (ficha): nada de caixa, título e explicação; só um botão discreto (r66 #20). O painel da conversa já era assim.
  if (!painel && others.length === 0) return (
    <div data-testid="pessoas-numero">
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-gold-ink underline-offset-4 hover:underline">
        <IconPlus size={14} aria-hidden />Adicionar outra pessoa neste número
      </button>
      {open && <AddPersonDialog contactId={contactId} onClose={() => setOpen(false)} onAdded={(p) => setList((l) => [...l, p])} />}
    </div>
  );
  return (
    <section aria-label="Pessoas neste número" data-testid="pessoas-numero" className={cn("flex flex-col", painel ? "gap-1" : "gap-2 rounded-[var(--radius-card)] bg-paper-2 px-4 py-3")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={painel ? "text-xs font-semibold text-graphite" : "text-sm font-semibold text-graphite"}>Pessoas neste número</h2>
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-gold-ink underline-offset-4 hover:underline pointer-coarse:min-h-11">
          <IconPlus size={14} aria-hidden />Adicionar pessoa
        </button>
      </div>
      {others.length === 0 ? (painel ? null :
        <p className="text-sm text-muted">Só ela usa este número. Mãe e filha no mesmo celular? Adicione a outra pessoa, com a ficha dela.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/70">
          {list.map((p) => {
            const here = p.id === contactId;
            const role = p.isHolder ? "titular, a conversa é dela" : p.relation;
            return (
              <li key={p.id} className="flex min-h-10 items-center justify-between gap-2 py-1 text-sm">
                {here
                  ? <span className="min-w-0 truncate font-semibold text-ink">{personLabel(p)} <span className="font-normal text-muted">(esta ficha)</span></span>
                  : <Link href={contactHref(p.id)} className="min-w-0 truncate font-medium text-ink underline-offset-4 hover:underline">{personLabel(p)}</Link>}
                {role && <span className="shrink-0 text-xs text-muted">{role}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {open && <AddPersonDialog contactId={contactId} onClose={() => setOpen(false)} onAdded={(p) => setList((l) => [...l, p])} />}
    </section>
  );
}

/** O formulário de "Adicionar pessoa": nome (obrigatório) e relação (opcional, com sugestões). */
export function AddPersonDialog({ contactId, initialName = "", extra, onClose, onAdded }: {
  contactId: string; initialName?: string; extra?: { email?: string; birthday?: string; cpf?: string };
  onClose: () => void; onAdded?: (p: NumberPerson) => void;
}) {
  const [name, setName] = useState(initialName);
  const [relation, setRelation] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter(); const toast = useToast();
  const listId = useId();
  const submit = () => start(async () => {
    if (name.trim().length < 2) { setErr("Informe o nome da pessoa."); return; }
    const r = await addPersonAction({ contactId, name, relation, ...(extra ?? {}) });
    if (!r.ok) { setErr(r.error); return; }
    onAdded?.({ id: r.data!.contactId, name: name.trim(), relation: relation.trim().toLocaleLowerCase("pt-BR") || null, isHolder: false });
    toast(`${name.trim()} adicionada neste número`, "ok");
    onClose();
    router.refresh();
  });
  return (
    <Dialog open onClose={onClose} title="Adicionar pessoa neste número"
      description="Outra pessoa que usa o mesmo WhatsApp (filha, mãe, marido…). Ela ganha ficha própria; as mensagens continuam na conversa deste número."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={pending}>Adicionar</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Nome" htmlFor="pn-nome"><Input id="pn-nome" autoComplete="off" autoFocus value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setErr(null); }} required /></Field>
        <Field label="Quem ela é (opcional)" htmlFor="pn-rel" hint="Ex.: filha, mãe, marido">
          <Input id="pn-rel" autoComplete="off" list={listId} value={relation} maxLength={40} onChange={(e) => setRelation(e.target.value)} />
        </Field>
        <datalist id={listId}>{PHONE_RELATIONS.map((r) => <option key={r} value={r} />)}</datalist>
        {err && <p role="alert" className="text-sm text-alert">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
