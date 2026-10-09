"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { inviteMemberAction, setMemberAction } from "@/app/(app)/config/actions";
import { initials } from "@/lib/format";
import { IconPlus } from "@/components/icons";

type M = { id: string; name: string; email: string; role: "gestor" | "atendente"; active: boolean; pending: boolean };

export function TeamEditor({ me, members }: { me: string; members: M[] }) {
  const [open, setOpen] = useState(false); const [link, setLink] = useState<string | null>(null);
  const [v, setV] = useState({ name: "", email: "", role: "atendente" as M["role"] }); const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const [confirmOff, setConfirmOff] = useState<M | null>(null);
  const invite = () => start(async () => { const r = await inviteMemberAction(v); if (r.ok) { setLink(r.data!); setErr(null); } else setErr(r.error); });
  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-[13.5px] text-graphite max-w-[60ch]"><b>Gestão</b> vê tudo e mexe nas configurações. <b>Atendimento</b> vê o funil, atende e vê os próprios números.</p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => { setOpen(true); setLink(null); setV({ name: "", email: "", role: "atendente" }); }}><IconPlus size={16} />Convidar pessoa</Button>
      </div>
      <ul className="rounded-[16px] border border-line bg-paper divide-y divide-line/70">
        {members.map((m) => (
          <li key={m.id} className={`grid grid-cols-[36px_1fr] sm:grid-cols-[36px_1fr_auto_150px_110px] items-center gap-3 px-4 py-3 ${m.active ? "" : "opacity-55"}`}>
            <span className="size-9 rounded-full bg-paper-3 grid place-items-center text-[12px] font-semibold">{initials(m.name)}</span>
            <div className="min-w-0 flex-1"><p className="font-medium text-[14px]">{m.name}{m.id === me && <span className="text-muted font-normal"> (você)</span>}</p><p className="text-[12.5px] text-muted">{m.email}</p></div>
            <span className="col-start-2 sm:col-start-auto flex gap-1.5">{m.pending && <Badge tone="gold">Convite pendente</Badge>}{!m.active && <Badge>Desativado</Badge>}</span>
            <Select className="col-start-2 sm:col-start-auto w-full h-9" aria-label={`Papel de ${m.name}`} value={m.role} disabled={pending} onChange={(e) => start(async () => { const r = await setMemberAction(m.id, { role: e.target.value as M["role"] }); toast(r.ok ? "Papel alterado" : r.error, r.ok ? "ok" : "error"); })}>
              <option value="atendente">Atendimento</option><option value="gestor">Gestão</option>
            </Select>
            <Button size="sm" variant={m.active ? "ghost" : "secondary"} className={m.active ? "text-alert" : ""} disabled={pending || m.id === me}
              onClick={() => m.active ? setConfirmOff(m) : start(async () => { const r = await setMemberAction(m.id, { active: true }); toast(r.ok ? "Acesso reativado" : r.error, r.ok ? "ok" : "error"); })}>{m.active ? "Desativar" : "Reativar"}</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!confirmOff} onClose={() => setConfirmOff(null)} title={`Desativar ${confirmOff?.name.split(" ")[0] ?? ""}?`}
        description="A pessoa sai do CRM agora e não consegue mais entrar. Os leads e o histórico dela continuam guardados. Dá para reativar depois."
        footer={<><Button variant="secondary" onClick={() => setConfirmOff(null)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={() => start(async () => { const r = await setMemberAction(confirmOff!.id, { active: false }); setConfirmOff(null); toast(r.ok ? "Acesso desativado" : r.error, r.ok ? "ok" : "error"); })}>Desativar acesso</Button></>} />
      <Dialog open={open} onClose={() => setOpen(false)} title={link ? "Convite criado" : "Convidar pessoa"}
        description={link ? "Envie este link para a pessoa criar a senha. Vale por 7 dias." : "A pessoa recebe um link para criar a própria senha."}
        footer={link ? <Button onClick={() => setOpen(false)}>Concluir</Button> : <><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={pending} onClick={invite}>Criar convite</Button></>}>
        {link ? (
          <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
            <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link); toast("Link copiado"); }}>Copiar</Button></div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); invite(); }}>
            <Field label="Nome" htmlFor="t-name"><Input id="t-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="E-mail" htmlFor="t-email"><Input id="t-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Papel" htmlFor="t-role"><Select id="t-role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as M["role"] })}><option value="atendente">Atendimento</option><option value="gestor">Gestão</option></Select></Field>
            {err && <p className="text-[13px] text-alert" role="alert">{err}</p>}
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>
    </div>
  );
}
