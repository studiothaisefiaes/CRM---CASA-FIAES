"use client";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { forwardMessagesAction, forwardTargetsAction, type ForwardTo } from "@/app/(app)/conversa/actions";
import { formatPhoneClient } from "@/lib/phone-client";
import type { ForwardTarget } from "@/server/queries/forward-targets";
import type { Msg } from "./conversation";

const conversas = (n: number) => `${n} conversa${n === 1 ? "" : "s"}`;

/**
 * "Para quem?": busca a conversa por nome ou telefone, Equipe no topo, e encaminha para até `max` de uma vez. Uma mensagem ou várias
 * (selecionadas na conversa, 24/10): várias saem juntas, na ordem da conversa. `onClose(true)`: o servidor aceitou (a seleção acaba);
 * `onClose(false)`: voltou sem encaminhar (a seleção continua, como no WhatsApp).
 */
export function ForwardDialog({ messages, dealId, max, onClose }: { messages: Msg[] | null; dealId: string | null; max: number; onClose: (sent: boolean) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<ForwardTarget[]>([]);
  const [picked, setPicked] = useState<ForwardTarget[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const open = !!messages?.length;
  const many = (messages?.length ?? 0) > 1;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => { void forwardTargetsAction(q, dealId).then((r) => { if (alive && r.ok) setList(r.data ?? []); }); }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, dealId]);
  // Número digitado que não está na lista: encaminhar para ele abre uma conversa nova (20/10, "para outras pessoas").
  const digits = q.replace(/\D/g, "");
  const typed: ForwardTarget | null = digits.length >= 10 && !list.some((t) => t.phone.replace(/\D/g, "").endsWith(digits.slice(-8)))
    ? { dealId: null, contactId: `numero:${digits}`, name: `Número ${formatPhoneClient(`+55${digits.replace(/^55/, "")}`) || q}`, phone: digits, team: false } : null;
  const shown = typed ? [...list, typed] : list;
  const keyOf = (t: ForwardTarget) => t.dealId ?? t.contactId;
  const has = (t: ForwardTarget) => picked.some((p) => keyOf(p) === keyOf(t));
  const toggle = (t: ForwardTarget) => setPicked((cur) => (has(t) ? cur.filter((p) => keyOf(p) !== keyOf(t)) : cur.length >= max ? cur : [...cur, t]));
  const toOf = (t: ForwardTarget): ForwardTo => (t.dealId ? t.dealId : t.contactId.startsWith("numero:") ? { phone: t.phone } : { contactId: t.contactId });
  // O servidor confere tudo e devolve na hora; os envios seguem depois da resposta (revisão 24/10: o diálogo ficava minutos no spinner com
  // vídeos para várias conversas). Cada um aparece na conversa de destino como sempre; o que não sair vira aviso no sino.
  const send = () => messages?.length && start(async () => {
    const r = await forwardMessagesAction(messages.map((m) => m.id), picked.map(toOf));
    if (!r.ok) { toast(r.error, "error"); return; }
    const n = r.data?.targets ?? picked.length;
    toast(many ? `Encaminhando ${messages.length} mensagens para ${conversas(n)}. Se alguma não sair, aviso no sino.` : `Encaminhando para ${conversas(n)}. Se não sair, aviso no sino.`, "ok");
    onClose(true);
  });
  return (
    <Dialog open={open} onClose={() => !pending && onClose(false)} title="Para quem?"
      description={`${many ? `${messages!.length} mensagens, na ordem da conversa. ` : ""}Escolha até ${max} conversas. Para uma cliente vai só o conteúdo, sem o nome de quem estava na conversa.`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)} disabled={pending}>Voltar</Button><Button loading={pending} disabled={!picked.length} onClick={send}>{picked.length > 1 ? `Encaminhar para ${picked.length}` : "Encaminhar"}</Button></>}>
      <Input aria-label="Buscar conversa" placeholder="Nome, telefone ou um número novo com DDD" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-3 max-h-64 overflow-y-auto divide-y divide-line" aria-label="Conversas">
        {shown.map((t) => (
          <li key={keyOf(t)}>
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <input type="checkbox" checked={has(t)} onChange={() => toggle(t)} disabled={!has(t) && picked.length >= max} aria-label={t.name} />
              <span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
              {t.team && <span className="shrink-0 rounded-full border border-line px-2 text-xs text-muted">Equipe</span>}
              {!t.dealId && <span className="shrink-0 text-xs text-muted">{t.contactId.startsWith("numero:") ? "conversa nova" : "sem conversa aberta"}</span>}
            </label>
          </li>
        ))}
        {!shown.length && <li className="py-3 text-sm text-muted">Ninguém encontrado. Busque pelo nome ou digite o número com DDD.</li>}
      </ul>
    </Dialog>
  );
}
