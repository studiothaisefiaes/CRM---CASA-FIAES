"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactProfileAction } from "@/app/(app)/contatos/actions";
import { cpfDigits, formatCpf, isValidCpf } from "@/lib/cpf";

/**
 * CPF na ficha (pedido do dono, 16/10): visível para a equipe; editar abre o campo com a máscara 000.000.000-00.
 * Dígitos verificadores conferidos antes de salvar ("CPF inválido" e nada muda). Quem chega aqui já pode editar o contato.
 */
export function CpfField({ contactId, value }: { contactId: string; value: string | null }) {
  const id = useId();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(formatCpf(value));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    const d = cpfDigits(v);
    if (d === (value ?? "")) { setEditing(false); setErr(null); return; }
    if (d && !isValidCpf(d)) { setErr("CPF inválido."); return; }
    start(async () => {
      const r = await updateContactProfileAction(contactId, { cpf: d || null });
      if (!r.ok) { setErr(r.error); return; }
      setErr(null); setEditing(false); router.refresh();
    });
  };
  const link = "min-h-11 lg:min-h-8 text-sm font-medium text-gold-ink underline-offset-4 hover:underline";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">CPF</label>
      {editing ? (
        <div className="flex items-center gap-2">
          <input id={id} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={v} disabled={pending} aria-invalid={err ? true : undefined}
            onChange={(e) => { setV(formatCpf(e.target.value)); setErr(null); }} onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            className="w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 py-2 text-md tabular sm:text-base aria-[invalid=true]:border-alert" />
          <button type="button" onClick={save} disabled={pending} className={link}>Salvar</button>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-3 text-md tabular">
          <span data-testid="cpf">{value ? formatCpf(value) : <span className="text-muted">Não informado</span>}</span>
          <button type="button" onClick={() => { setEditing(true); setV(formatCpf(value)); }} className={link}>{value ? "Editar" : "Adicionar"}</button>
        </p>
      )}
      {err && <p role="alert" className="text-sm text-alert">{err}</p>}
    </div>
  );
}
