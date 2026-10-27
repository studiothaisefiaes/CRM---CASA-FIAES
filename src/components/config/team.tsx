"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { createMemberAction, resetMemberPasswordAction, setMemberActiveAction, setMemberProfileAction, setMemberSignatureAction } from "@/app/(app)/config/actions";
import { defaultSignature, signatureLine } from "@/lib/signature";
import { initials } from "@/lib/format";
import { IconPlus } from "@/components/icons";

/** `atende`: o perfil abre as Conversas. Quem não atende (o Contador) não manda mensagem: sem assinatura e fora do aviso. */
type M = { id: string; name: string; email: string; profileId: string | null; active: boolean; pending: boolean; signature: string | null; atende?: boolean };

/** Senha fácil de ditar: sem letras que se confundem (l/1, O/0). */
const ALFA = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newPassword = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => ALFA[n % ALFA.length]).join("");
export type ProfileOption = { id: string; name: string; key: string | null };

export function TeamEditor({ me, members, profiles }: { me: string; members: M[]; profiles: ProfileOption[] }) {
  const defaultProfile = profiles.find((p) => p.key === "atendente")?.id ?? profiles[0]?.id ?? "";
  const [open, setOpen] = useState(false); const [done, setDone] = useState<{ email: string; password: string } | null>(null);
  const [v, setV] = useState({ name: "", email: "", password: "", profileId: defaultProfile }); const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition(); const toast = useToast();
  const unsigned = members.filter((m) => m.active && !m.signature && m.atende !== false).length;
  const [confirmOff, setConfirmOff] = useState<M | null>(null);
  const [resetFor, setResetFor] = useState<M | null>(null); const [newPw, setNewPw] = useState(""); const [myPw, setMyPw] = useState(""); const [resetDone, setResetDone] = useState(false);
  const [sigFor, setSigFor] = useState<M | null>(null); const [sigValue, setSigValue] = useState("");
  const saveSig = () => start(async () => {
    const r = await setMemberSignatureAction(sigFor!.id, sigValue);
    if (r.ok) { toast(sigValue.trim() ? "Assinatura salva" : "Assinatura removida", "ok"); setSigFor(null); setErr(null); } else setErr(r.error);
  });
  const create = () => start(async () => { const r = await createMemberAction(v); if (r.ok) { setDone({ email: r.data!.email, password: v.password }); setErr(null); } else setErr(r.error); });
  const reset = () => start(async () => { const r = await resetMemberPasswordAction(resetFor!.id, newPw, myPw); setMyPw(""); if (r.ok) { setResetDone(true); setErr(null); } else setErr(r.error); });
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/login`;
  const copy = async (text: string) => { await navigator.clipboard.writeText(text); toast("Copiado"); };
  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-graphite max-w-[60ch]">Cada pessoa tem um <b>perfil</b>, que diz o que ela vê e pode fazer. Os perfis se editam na aba <b>Perfis de acesso</b>. A <b>assinatura</b> de cada pessoa diz quem respondeu, inclusive pelo celular.</p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => { setOpen(true); setDone(null); setErr(null); setV({ name: "", email: "", password: newPassword(), profileId: defaultProfile }); }}><IconPlus size={16} />Criar acesso</Button>
      </div>
      {unsigned > 0 && (
        <p role="note" className="rounded-[var(--radius-control)] border border-gold/50 bg-gold-soft/60 px-3.5 py-2 text-sm text-ink">
          {unsigned === 1 ? "1 pessoa sem assinatura cadastrada" : `${unsigned} pessoas sem assinatura cadastrada`}: pelo CRM, as mensagens saem com o 1º nome em maiúsculas (o que aparece com “padrão”). Toque nele para escolher a que ela já usa no ChatGuru.
        </p>
      )}
      <ul className="rounded-[var(--radius-card)] border border-line bg-paper divide-y divide-line/70">
        {members.map((m) => (
          <li key={m.id} className={`grid grid-cols-[36px_1fr] sm:grid-cols-[36px_1fr_auto_150px_150px_auto_110px] items-center gap-3 px-4 py-3 ${m.active ? "" : "opacity-55"}`}>
            <span className="size-9 rounded-full bg-paper-3 grid place-items-center text-xs font-semibold">{initials(m.name)}</span>
            <div className="min-w-0 flex-1"><p className="font-medium text-base">{m.name}{m.id === me && <span className="text-muted font-normal"> (você)</span>}</p><p className="text-sm text-muted">{m.email}</p></div>
            <span className="col-start-2 sm:col-start-auto flex gap-1.5">{m.pending && <Badge tone="gold">Convite pendente</Badge>}{!m.active && <Badge>Desativado</Badge>}</span>
            <Select className="col-start-2 sm:col-start-auto w-full h-9" aria-label={`Perfil de ${m.name}`} value={m.profileId ?? ""} disabled={pending} onChange={(e) => start(async () => { const r = await setMemberProfileAction(m.id, e.target.value); toast(r.ok ? "Perfil alterado" : r.error, r.ok ? "ok" : "error"); })}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {m.atende === false ? <span className="col-start-2 sm:col-start-auto text-sm text-muted">Não conversa com clientes</span> : (
            <Button size="sm" variant="ghost" className={`col-start-2 sm:col-start-auto justify-self-start ${m.signature ? "" : "text-gold-ink"}`} disabled={pending}
              aria-label={`Assinatura de ${m.name}: ${m.signature ?? "sem assinatura"}`}
              onClick={() => { setSigFor(m); setSigValue(m.signature ?? ""); setErr(null); }}>{m.signature ?? (defaultSignature(m.name) ? `${defaultSignature(m.name)} (padrão)` : "Sem assinatura")}</Button>)}
            <Button size="sm" variant="ghost" className="col-start-2 sm:col-start-auto justify-self-start" disabled={pending}
              onClick={() => { setResetFor(m); setNewPw(newPassword()); setMyPw(""); setResetDone(false); setErr(null); }}>Trocar senha</Button>
            <Button size="sm" variant={m.active ? "ghost" : "secondary"} className={m.active ? "text-alert" : ""} disabled={pending || m.id === me}
              onClick={() => m.active ? setConfirmOff(m) : start(async () => { const r = await setMemberActiveAction(m.id, true); toast(r.ok ? "Acesso reativado" : r.error, r.ok ? "ok" : "error"); })}>{m.active ? "Desativar" : "Reativar"}</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!confirmOff} onClose={() => setConfirmOff(null)} title={`Desativar ${confirmOff?.name.split(" ")[0] ?? ""}?`}
        description="A pessoa sai do CRM agora e não consegue mais entrar. As conversas e o histórico dela continuam guardados. Dá para reativar depois."
        footer={<><Button variant="secondary" onClick={() => setConfirmOff(null)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={() => start(async () => { const r = await setMemberActiveAction(confirmOff!.id, false); setConfirmOff(null); toast(r.ok ? "Acesso desativado" : r.error, r.ok ? "ok" : "error"); })}>Desativar acesso</Button></>} />
      <Dialog open={open} onClose={() => setOpen(false)} title={done ? "Acesso criado" : "Criar acesso"}
        description={done ? "Passe estes dados para a pessoa. Ela já consegue entrar." : "Você escolhe o e-mail e a senha e passa para a pessoa. Ela pode entrar na hora."}
        footer={done ? <Button onClick={() => setOpen(false)}>Concluir</Button> : <><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={pending} onClick={create}>Criar acesso</Button></>}>
        {done ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[var(--radius-control)] bg-paper-2 px-4 py-3 text-base">
              <dt className="text-graphite">Endereço</dt><dd className="break-all">{loginUrl}</dd>
              <dt className="text-graphite">E-mail</dt><dd className="break-all">{done.email}</dd>
              <dt className="text-graphite">Senha</dt><dd className="font-mono">{done.password}</dd>
            </dl>
            <Button variant="secondary" onClick={() => copy(`Seu acesso ao CRM da Casa Fiaes\n${loginUrl}\nE-mail: ${done.email}\nSenha: ${done.password}`)}>Copiar tudo para mandar</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <Field label="Nome" htmlFor="t-name"><Input id="t-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="E-mail" htmlFor="t-email"><Input id="t-email" type="email" autoComplete="off" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Senha" htmlFor="t-pass" hint="Pelo menos 8 caracteres. Já vem uma gerada; pode trocar.">
              <div className="flex gap-2">
                <Input id="t-pass" type="text" autoComplete="off" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} className="font-mono" />
                <Button type="button" variant="secondary" onClick={() => setV({ ...v, password: newPassword() })}>Gerar outra</Button>
              </div>
            </Field>
            <Field label="Perfil" htmlFor="t-role"><Select id="t-role" value={v.profileId} onChange={(e) => setV({ ...v, profileId: e.target.value })}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            {err && <p className="text-sm text-alert" role="alert">{err}</p>}
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>
      <Dialog open={!!sigFor} onClose={() => setSigFor(null)} title={`Assinatura de ${sigFor?.name.split(" ")[0] ?? ""}`}
        description="Vai no começo das mensagens que ela manda pelo CRM, como no ChatGuru. O CRM também usa a assinatura para saber quem respondeu pelo celular ou pelo ChatGuru e quem é a dona da conversa."
        footer={<><Button variant="secondary" onClick={() => setSigFor(null)}>Cancelar</Button><Button loading={pending} onClick={saveSig}>Salvar assinatura</Button></>}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); saveSig(); }}>
          <Field label="Assinatura" htmlFor="t-sig" hint="Use o mesmo nome que ela já usa no ChatGuru, por exemplo SARA ou CATI. Deixe vazio para ela mandar sem assinatura.">
            <Input id="t-sig" autoComplete="off" maxLength={30} value={sigValue} onChange={(e) => setSigValue(e.target.value.toLocaleUpperCase("pt-BR"))} />
          </Field>
          <p className="text-sm text-graphite">Como a cliente vê: <span className="font-mono">{sigValue.trim() ? signatureLine(sigValue) : "sem assinatura"}</span></p>
          {err && <p className="text-sm text-alert" role="alert">{err}</p>}
          <button type="submit" hidden />
        </form>
      </Dialog>
      <Dialog open={!!resetFor} onClose={() => setResetFor(null)} title={resetDone ? "Senha trocada" : `Trocar a senha de ${resetFor?.name.split(" ")[0] ?? ""}`}
        description={resetDone ? "A senha antiga parou de valer. Passe a nova para a pessoa." : "A pessoa sai das sessões abertas e entra de novo com a senha nova."}
        footer={resetDone ? <Button onClick={() => setResetFor(null)}>Concluir</Button> : <><Button variant="secondary" onClick={() => setResetFor(null)}>Cancelar</Button><Button loading={pending} onClick={reset}>Trocar senha</Button></>}>
        {resetDone ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[var(--radius-control)] bg-paper-2 px-4 py-3 text-base">
              <dt className="text-graphite">E-mail</dt><dd className="break-all">{resetFor?.email}</dd>
              <dt className="text-graphite">Senha nova</dt><dd className="font-mono">{newPw}</dd>
            </dl>
            <Button variant="secondary" onClick={() => copy(`CRM da Casa Fiaes\n${loginUrl}\nE-mail: ${resetFor?.email}\nSenha: ${newPw}`)}>Copiar tudo para mandar</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); reset(); }}>
            <Field label="Senha nova" htmlFor="t-newpass" hint="Pelo menos 8 caracteres.">
              <div className="flex gap-2">
                <Input id="t-newpass" type="text" autoComplete="off" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="font-mono" />
                <Button type="button" variant="secondary" onClick={() => setNewPw(newPassword())}>Gerar outra</Button>
              </div>
            </Field>
            <Field label="Sua senha" htmlFor="t-mypass" hint="A senha com que você entra no CRM, para confirmar que é você.">
              <Input id="t-mypass" type="password" autoComplete="current-password" value={myPw} onChange={(e) => setMyPw(e.target.value)} />
            </Field>
            {err && <p className="text-sm text-alert" role="alert">{err}</p>}
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>
    </div>
  );
}
