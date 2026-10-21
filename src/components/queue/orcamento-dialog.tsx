"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { parseMoneyInput } from "@/lib/money-input";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";

/** O texto pronto do orçamento (vai para o campo de mensagem; quem envia é a atendente). */
export function orcamentoText(first: string, service: string | null, cents: number): string {
  const valor = formatBRL(cents).replace(/ /g, " ");
  return `${first ? `Oi, ${first}! ` : ""}${service ? `${service} fica ${valor}` : `Fica ${valor}`}. Quer que eu veja um horário para você?`;
}

/**
 * "Mandar orçamento" (nova organização, 16/10): o serviço (opcional) e o valor viram uma mensagem pronta NO CAMPO de mensagem.
 * NÃO envia sozinho: quem envia é a atendente. Ao confirmar, a etapa vai para Orçamento (com Desfazer, quem chama cuida).
 */
export function OrcamentoDialog({ open, onClose, name, services, initialServiceId, onConfirm }: {
  open: boolean; onClose: () => void; name: string; services: { id: string; label: string }[]; initialServiceId?: string | null;
  onConfirm: (r: { text: string; serviceId: string | null; cents: number }) => void;
}) {
  const [svc, setSvc] = useState<string | null>(initialServiceId ?? null);
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const first = name.trim().split(/\s+/)[0] && !/^\(?\d/.test(name.trim()) ? name.trim().split(/\s+/)[0] : "";
  const cents = parseMoneyInput(valor);
  const label = services.find((s) => s.id === svc)?.label ?? null;
  const preview = cents ? orcamentoText(first, label, cents) : null;
  const confirm = () => {
    if (!cents || cents <= 0) { setError("Informe o valor."); return; }
    onConfirm({ text: preview!, serviceId: svc, cents });
  };
  return (
    <Dialog open={open} onClose={onClose} width={460} title="Mandar orçamento" description="A mensagem vai para o campo de texto: confira e envie. A etapa muda para Orçamento."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={confirm}>Colocar no campo</Button></>}>
      <div className="flex max-h-[min(60vh,460px)] flex-col gap-4 overflow-y-auto pr-1">
        {services.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-graphite" id="orc-servico">Serviço (opcional)</span>
            <div role="radiogroup" aria-labelledby="orc-servico" className="flex flex-wrap gap-1.5">
              {services.slice(0, 12).map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={svc === s.id} onClick={() => setSvc(svc === s.id ? null : s.id)}
                  className={cn("min-h-9 rounded-full border px-3 text-sm pointer-coarse:min-h-11", svc === s.id ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-2 hover:bg-paper-2")}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-graphite">Valor (R$)</span>
          <Input inputMode="decimal" autoComplete="off" placeholder="Ex.: 380" value={valor} onChange={(e) => { setValor(e.target.value); setError(null); }} className="h-11" />
        </label>
        {preview && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-ink" data-testid="orcamento-previa">{preview}</p>}
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
