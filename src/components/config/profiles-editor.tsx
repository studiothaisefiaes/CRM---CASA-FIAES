"use client";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { IconPlus } from "@/components/icons";
import { GESTAO_OPTIONAL, PERMS, PERM_GROUPS, PERM_GROUP, PERM_HELP, PERM_LABEL, PERM_OTHERS, PROFILE_ABOUT, type Perm, type SystemProfileKey } from "@/lib/permissions";
import { deleteProfileAction, duplicateProfileAction, saveProfileAction } from "@/app/(app)/config/actions";
import { cn } from "@/lib/cn";

export type ProfileView = { id: string; key: string | null; name: string; permissions: Perm[]; isSystem: boolean; members: number };

/** Perfis de acesso: lista à esquerda (no celular, em cima) e o editor com as caixinhas agrupadas por área. */
export function ProfilesEditor({ profiles }: { profiles: ProfileView[] }) {
  const [selId, setSelId] = useState<string | null>(profiles[0]?.id ?? null);
  const sel = profiles.find((p) => p.id === selId) ?? null;
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        <ul className="rounded-[var(--radius-card)] border border-line bg-paper divide-y divide-line/70" aria-label="Perfis">
          {profiles.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { setSelId(p.id); setCreating(false); }} aria-current={p.id === selId && !creating ? "true" : undefined}
                className={cn("flex w-full items-center justify-between gap-3 px-4 min-h-12 text-left", p.id === selId && !creating ? "bg-paper-2 font-medium" : "hover:bg-paper-2/60")}>
                <span className="truncate">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">{p.isSystem && <Badge>padrão</Badge>}{p.members} {p.members === 1 ? "pessoa" : "pessoas"}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" className="h-10 pointer-coarse:min-h-11" onClick={() => setCreating(true)}><IconPlus size={16} />Novo perfil</Button>
      </div>
      {creating
        ? <ProfileForm key="novo" initial={{ name: "", permissions: ["atendimento.ver"] }} onSaved={(id) => { setCreating(false); setSelId(id); }} />
        : sel && <ProfileForm key={sel.id} profile={sel} initial={{ name: sel.name, permissions: sel.permissions }} onSaved={() => {}} onRemoved={() => setSelId(profiles.find((p) => p.id !== sel.id)?.id ?? null)} onDuplicated={setSelId} />}
    </div>
  );
}

function ProfileForm({ profile, initial, onSaved, onRemoved, onDuplicated }: {
  profile?: ProfileView; initial: { name: string; permissions: Perm[] };
  onSaved: (id: string) => void; onRemoved?: () => void; onDuplicated?: (id: string) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [perms, setPerms] = useState<Set<Perm>>(new Set(initial.permissions));
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const locked = profile?.key === "gestao";
  const fixed = (p: Perm) => locked && !GESTAO_OPTIONAL.includes(p);
  const dirty = useMemo(() => name.trim() !== initial.name || perms.size !== initial.permissions.length || initial.permissions.some((p) => !perms.has(p)), [name, perms, initial]);
  const toggle = (p: Perm) => setPerms((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const save = () => start(async () => {
    const r = await saveProfileAction({ id: profile?.id, name, permissions: PERMS.filter((p) => perms.has(p)) });
    if (r.ok) { setErr(null); toast(profile ? "Perfil salvo" : "Perfil criado", "ok"); onSaved(r.data!.id); } else setErr(r.error);
  });
  return (
    <section aria-label={profile ? `Perfil ${profile.name}` : "Novo perfil"} className="rounded-[var(--radius-card)] border border-line bg-paper p-4 lg:p-5">
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-5">
        <Field label="Nome do perfil" htmlFor="pf-name"><Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} disabled={profile?.isSystem && profile.key === "gestao"} /></Field>
        {locked && <p className="text-sm text-graphite rounded-[var(--radius-control)] bg-paper-2 px-3 py-2">Gestão sempre tem acesso a tudo, para ninguém ficar trancado para fora. Só dá para escolher se a gestão entra no rodízio de conversas.</p>}
        {profile?.key && PROFILE_ABOUT[profile.key as SystemProfileKey] && <p role="note" className="text-sm text-graphite rounded-[var(--radius-control)] bg-paper-2 px-3 py-2">{PROFILE_ABOUT[profile.key as SystemProfileKey]}</p>}
        {PERM_GROUPS.map((g) => (
          <fieldset key={g} className="flex flex-col gap-1">
            <legend className="text-xs font-semibold text-muted mb-1.5">{g}</legend>
            {PERMS.filter((p) => PERM_GROUP[p] === g).map((p) => (
              <label key={p} className={cn("flex items-start gap-3 rounded-[var(--radius-control)] px-2 py-2 min-h-11", fixed(p) ? "opacity-70" : "cursor-pointer hover:bg-paper-2")}>
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-ink)]" checked={fixed(p) || perms.has(p)} disabled={fixed(p)} onChange={() => toggle(p)} />
                <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-base">{PERM_LABEL[p]}{PERM_OTHERS[g] === p && <Badge tone="neutral">ver de outras</Badge>}</span><span className="block text-sm text-muted">{PERM_HELP[p]}</span></span>
              </label>
            ))}
          </fieldset>
        ))}
        {err && <p role="alert" className="text-sm text-alert">{err}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending} disabled={!dirty && !!profile}>{profile ? "Salvar" : "Criar perfil"}</Button>
          {profile && <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await duplicateProfileAction(profile.id); if (r.ok) { toast("Cópia criada", "ok"); onDuplicated?.(r.data!.id); } else toast(r.error, "error"); })}>Duplicar</Button>}
          {profile && !profile.isSystem && <Button type="button" variant="ghost" className="text-alert" disabled={pending} onClick={() => setConfirmDel(true)}>Apagar</Button>}
        </div>
      </form>
      {profile && (
        <Dialog open={confirmDel} onClose={() => setConfirmDel(false)} title={`Apagar o perfil ${profile.name}?`}
          description={profile.members ? `${profile.members} ${profile.members === 1 ? "pessoa usa" : "pessoas usam"} este perfil: mova antes de apagar.` : "Ninguém usa este perfil. Não dá para desfazer."}
          footer={<><Button variant="secondary" onClick={() => setConfirmDel(false)}>Cancelar</Button>
            <Button variant="danger" loading={pending} onClick={() => start(async () => { const r = await deleteProfileAction(profile.id); setConfirmDel(false); if (r.ok) { toast("Perfil apagado", "ok"); onRemoved?.(); } else toast(r.error, "error"); })}>Apagar perfil</Button></>} />
      )}
    </section>
  );
}
