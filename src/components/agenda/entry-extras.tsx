"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { addNoteForProAction, entryExtrasAction } from "@/app/(app)/agenda/profissional-actions";
import { createClientLinkAction } from "@/app/(app)/agenda/actions";
import type { EntryExtras as Extras } from "@/server/queries/entry-extras";

/** No card do horário: "Finalizado por Ana", a ficha técnica e "Anotar para a profissional". Carrega ao abrir o card. */
export function EntryExtras({ appointmentId }: { appointmentId: string }) {
  const [data, setData] = useState<Extras | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const load = () => entryExtrasAction(appointmentId).then((r) => { if (r.ok && r.data) setData(r.data); });
  useEffect(() => { let alive = true; entryExtrasAction(appointmentId).then((r) => { if (alive && r.ok && r.data) setData(r.data); }); return () => { alive = false; }; }, [appointmentId]);
  if (!data) return null;
  const save = () => start(async () => {
    const r = await addNoteForProAction(appointmentId, text);
    if (!r.ok) { toast(r.error, "error"); return; }
    toast("Anotado na ficha"); setText(""); setWriting(false); await load();
  });
  const copyLink = () => start(async () => {
    const r = await createClientLinkAction({ appointmentId });
    if (!r.ok || !r.data) { toast(r.ok ? "Não deu para gerar o link." : r.error, "error"); return; }
    try { await navigator.clipboard.writeText(r.data.url); toast("Link copiado. Nada foi enviado: cole na conversa com a cliente."); }
    catch { toast(r.data.url); }
  });
  return (
    <div className="flex flex-col gap-2 text-sm">
      {data.finishedBy && <p className="text-graphite">Finalizado por {data.finishedBy}</p>}
      {data.link.activity && <p className="font-medium text-ok">{data.link.activity}</p>}
      {data.link.canCreate && <button type="button" disabled={pending} onClick={copyLink} className="self-start min-h-11 font-medium text-gold-ink underline-offset-4 hover:underline">Copiar link</button>}
      {data.notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {data.notes.map((n) => <li key={n.id} className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-1.5">{n.body}{n.author ? <span className="text-graphite"> · {n.author}</span> : null}</li>)}
        </ul>
      )}
      {data.canNote && (writing ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Anotar para a profissional" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Ela vê na próxima cliente (ex.: alérgica a amônia)" />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setWriting(false)}>Voltar</Button><Button loading={pending} disabled={!text.trim()} onClick={save}>Salvar</Button></div>
        </div>
      ) : <button type="button" className="self-start min-h-11 font-medium text-gold-ink underline-offset-4 hover:underline" onClick={() => setWriting(true)}>Anotar para a profissional</button>)}
    </div>
  );
}
