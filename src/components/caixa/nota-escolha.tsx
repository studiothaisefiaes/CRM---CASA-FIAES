"use client";
import { useState } from "react";
import { Input } from "@/components/ui/field";
import { formatCpf } from "@/lib/cpf";
import { NOTA_ESCOLHA_LABEL, type NotaEscolha } from "@/lib/caixa-settings";
import type { ComandaDetail } from "@/server/queries/caixa";

const ORDER: NotaEscolha[] = ["nao", "sem_cpf", "com_cpf"];

/** "Nota fiscal" antes de receber: Não emitir, Emitir sem CPF ou Emitir com CPF. Só registra a escolha na comanda (nada é emitido aqui). */
export function NotaEscolhaBlock({ detail, pending, onSave }: { detail: ComandaDetail; pending: boolean; onSave: (escolha: NotaEscolha, cpf: string | null) => void }) {
  const n = detail.notaEscolha;
  const [cpf, setCpf] = useState(formatCpf(detail.cpf ?? n.clientCpf));
  const [choice, setChoice] = useState<NotaEscolha | null>(n.escolha);
  const digits = cpf.replace(/\D/g, "");
  const recusou = n.consentCpf === false;
  const pick = (e: NotaEscolha) => {
    setChoice(e);
    if (e !== "com_cpf") onSave(e, null);
    else if (digits.length === 11) onSave(e, digits);
  };
  return (
    <section aria-label="Nota fiscal" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line p-3">
      <h3 className="text-sm font-semibold">Nota fiscal{choice == null && <span className="ml-2 text-xs font-normal text-graphite">escolha uma opção para receber</span>}</h3>
      <div role="radiogroup" aria-label="Nota fiscal" className="flex flex-wrap gap-2">
        {ORDER.map((e) => (
          <label key={e} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm lg:min-h-9 ${choice === e ? "border-gold bg-paper-2 font-medium" : "border-line-strong"} ${e === "com_cpf" && recusou ? "opacity-50" : ""}`}>
            <input type="radio" name={`nota-${detail.id}`} className="accent-[var(--color-gold)]" checked={choice === e} disabled={pending || (e === "com_cpf" && recusou)} onChange={() => pick(e)} />
            {NOTA_ESCOLHA_LABEL[e]}
          </label>
        ))}
      </div>
      {recusou && <p className="text-xs text-muted">A cliente não autorizou o CPF na nota.</p>}
      {choice === "com_cpf" && (
        <label className="flex max-w-xs flex-col gap-1 text-sm text-graphite">CPF na nota
          <Input inputMode="numeric" value={cpf} disabled={pending} placeholder="000.000.000-00" className="h-11" onChange={(e) => setCpf(formatCpf(e.target.value))}
            onBlur={() => { if (digits.length === 11) onSave("com_cpf", digits); }} aria-invalid={digits.length > 0 && digits.length < 11} />
          {digits.length > 0 && digits.length < 11 && <span className="text-xs text-alert">CPF incompleto.</span>}
          {n.consentCpf == null && <span className="text-xs text-muted">Consentimento da cliente ainda não registrado.</span>}
        </label>
      )}
    </section>
  );
}
