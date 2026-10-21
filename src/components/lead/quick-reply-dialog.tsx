"use client";
import { useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { createQuickReplyAction, updateQuickReplyAction } from "@/app/(app)/conversa/actions";
import { renderReply, type ReplyVars } from "@/lib/quick-reply";
import { VarButtons } from "./var-buttons";

export type EditableReply = { id: string; label: string; body: string | null };

/**
 * Nova resposta pronta (ou editar uma minha) pela conversa. Prévia com os dados desta cliente.
 * Escopo: "Só minha" (só quem criou vê) ou "Universal" (todas usam; só a gestão). Montado só enquanto aberto.
 */
export function QuickReplyDialog({ onClose, vars, canShare, editing, onSaved }: {
  onClose: () => void; vars: ReplyVars; canShare: boolean; editing?: EditableReply | null; onSaved: () => void;
}) {
  const [label, setLabel] = useState(editing?.label ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [folder, setFolder] = useState("");
  const [scope, setScope] = useState<"minha" | "universal">("minha");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const preview = renderReply(body, vars);
  const save = () => {
    if (!label.trim() || !body.trim()) { setError("Preencha o atalho e o texto."); return; }
    start(async () => {
      const r = editing
        ? await updateQuickReplyAction(editing.id, { label, body })
        : await createQuickReplyAction({ label, body, scope, folder: folder.trim() || null });
      if (!r.ok) { setError(r.error); return; }
      onSaved(); onClose();
    });
  };
  return (
    <Dialog open onClose={onClose} title={editing ? "Editar resposta pronta" : "Nova resposta pronta"} width={520}
      description="Aparece ao digitar / na conversa. As variáveis trocam pelos dados de cada cliente."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={save} loading={pending}>Salvar resposta</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Atalho" htmlFor="qr-atalho" hint="O que se digita depois da /. Ex.: confirmar">
          <Input id="qr-atalho" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="confirmar" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-graphite">Texto</span>
          <VarButtons target={ref} value={body} onChange={setBody} />
          <Textarea ref={ref} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Texto da resposta" rows={4} maxLength={4000} placeholder="{saudacao}, {primeiro_nome}! …" />
        </div>
        {!editing && (
          <>
            <Field label="Pasta (opcional)" htmlFor="qr-pasta"><Input id="qr-pasta" value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={40} placeholder="Ex.: Agendamento" /></Field>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-graphite mb-1">Quem usa</legend>
              <label className="flex items-center gap-2 text-sm min-h-9">
                <input type="radio" name="qr-escopo" checked={scope === "minha"} onChange={() => setScope("minha")} className="size-4" />
                Só minha <span className="text-muted">(só você vê)</span>
              </label>
              <label className={`flex items-center gap-2 text-sm min-h-9 ${canShare ? "" : "opacity-60"}`}>
                <input type="radio" name="qr-escopo" checked={scope === "universal"} disabled={!canShare} onChange={() => setScope("universal")} className="size-4" />
                Universal <span className="text-muted">(todas usam{canShare ? "" : "; só a gestão cria"})</span>
              </label>
            </fieldset>
          </>
        )}
        <div className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2">
          <p className="text-xs font-semibold text-gold-ink">Prévia com esta cliente</p>
          <p data-testid="previa-resposta" className="mt-1 whitespace-pre-wrap text-sm text-ink">{preview.text}</p>
          {preview.missing.length > 0 && <p className="mt-1 text-xs text-muted">Sem dado nesta conversa: {preview.missing.join(", ")}. Na hora de enviar, o campo pede para preencher.</p>}
        </div>
        {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      </div>
    </Dialog>
  );
}
