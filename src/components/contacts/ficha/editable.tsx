"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactProfileAction } from "@/app/(app)/contatos/actions";
import type { ContactProfilePatch } from "@/server/domain/contact-profile";

type Kind = "text" | "email" | "textarea" | "birthday" | "select" | "date";

/** Campo da ficha que salva sozinho ao sair (ou ao escolher, no select). Mostra "salvo" por um instante e o erro do servidor embaixo. */
export function ProfileField({ contactId, name, label, value, kind = "text", options, placeholder, hint }: {
  contactId: string; name: keyof ContactProfilePatch; label: string; value: string; kind?: Kind;
  options?: { value: string; label: string }[]; placeholder?: string; hint?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (value !== prev) { setPrev(value); setV(value); }

  const save = (next = v) => {
    if (next === value) { setErr(null); return; }
    start(async () => {
      const r = await updateContactProfileAction(contactId, { [name]: next === "" ? null : next } as ContactProfilePatch);
      if (!r.ok) { setErr(r.error); return; }
      setErr(null); setSaved(true); setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  };
  const cls = "w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-md outline-offset-2 sm:text-base disabled:opacity-60 aria-[invalid=true]:border-alert";
  const common = { id, disabled: pending, "aria-invalid": err ? true : undefined, "aria-describedby": err || hint ? `${id}-d` : undefined } as const;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">{label}{saved && <span role="status" className="ml-2 font-medium text-ok">salvo</span>}</label>
      {kind === "textarea" ? (
        <textarea {...common} rows={3} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => save()} className={cls} />
      ) : kind === "date" ? (
        <input {...common} type="date" min="2000-01-01" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => save()} className={cls} />
      ) : kind === "select" ? (
        <select {...common} value={v} onChange={(e) => { setV(e.target.value); save(e.target.value); }} className={cls}>
          {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input {...common} type={kind === "email" ? "email" : "text"} inputMode={kind === "birthday" ? "numeric" : undefined} value={v} placeholder={placeholder}
          onChange={(e) => setV(e.target.value)} onBlur={() => save()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className={cls} />
      )}
      {(err || hint) && <p id={`${id}-d`} role={err ? "alert" : undefined} className={err ? "text-sm text-alert" : "text-xs text-muted"}>{err ?? hint}</p>}
    </div>
  );
}
