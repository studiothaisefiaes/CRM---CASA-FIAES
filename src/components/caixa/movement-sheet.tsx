"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionSheet } from "@/components/queue/action-sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { movementAction } from "@/app/(app)/caixa/actions";
import { parseMoneyInput } from "@/lib/money-input";

/**
 * Sangria (tira dinheiro do caixa) ou Suprimento (põe), sempre com motivo. Na sangria, "É vale de uma profissional?" (só quando
 * `valeProfessionals` vem: ligado em Configurações › Caixa e a pessoa tem caixa.vale) pede a profissional e a senha DELA.
 */
export function MovementSheet({ open, onClose, kind, valeProfessionals }: { open: boolean; onClose: () => void; kind: "sangria" | "suprimento"; valeProfessionals?: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [isVale, setIsVale] = useState(false);
  const [pro, setPro] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const title = kind === "sangria" ? "Sangria" : "Suprimento";
  const submit = () => start(async () => {
    const cents = parseMoneyInput(value);
    if (!cents) { setError("Digite um valor maior que zero."); return; }
    const asVale = kind === "sangria" && isVale;
    if (asVale && !pro) { setError("Escolha a profissional."); return; }
    if (asVale && !password) { setError("Digite a senha dela."); return; }
    const r = await movementAction({ kind, valueCents: cents, reason, ...(asVale ? { vale: { professionalId: pro, password } } : {}) });
    if (!r.ok) { setError(r.error); return; }
    toast(`${title} registrada`); onClose(); router.refresh();
  });
  return (
    <ActionSheet open={open} onClose={onClose} title={title} footer={<Button loading={pending} onClick={submit}>Registrar</Button>}>
      <div className="flex flex-col gap-3">
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
        <label className="flex flex-col gap-1 text-sm text-graphite">Valor (R$)<Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm text-graphite">Motivo<Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={kind === "sangria" ? "ex.: depósito no banco" : "ex.: troco"} /></label>
        {kind === "sangria" && valeProfessionals && valeProfessionals.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isVale} onChange={(e) => setIsVale(e.target.checked)} />É vale de uma profissional?</label>
            {isVale && (
              <>
                <label className="flex flex-col gap-1 text-sm text-graphite">Profissional
                  <Select value={pro} onChange={(e) => setPro(e.target.value)}><option value="">Escolha</option>{valeProfessionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
                <label className="flex flex-col gap-1 text-sm text-graphite">Senha dela<Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                <p className="text-xs text-graphite">Ela digita a própria senha do app. Só profissional com acesso ao app pode ter vale pela sangria.</p>
              </>
            )}
          </>
        )}
      </div>
    </ActionSheet>
  );
}
