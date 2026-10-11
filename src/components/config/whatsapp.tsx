"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { IconWhatsApp, IconPlus, IconCheck, IconRefresh } from "@/components/icons";
import { createChannelAction, channelQrAction, channelStateAction, disconnectChannelAction } from "@/app/(app)/config/actions";
import { useLiveRefresh } from "@/components/shell/live";
import { SPRING_UI, EASE } from "@/lib/motion";
import { relTime } from "@/lib/format";
import { formatPhoneClient } from "@/lib/phone-client";

type Ch = { id: string; name: string; status: "desconectado" | "aguardando_qr" | "conectado" | "erro"; phone: string | null; lastEventAt: string | null };
const STATUS: Record<Ch["status"], [string, "ok" | "gold" | "neutral" | "alert"]> = { conectado: ["Conectado", "ok"], aguardando_qr: ["Aguardando leitura", "gold"], desconectado: ["Desconectado", "neutral"], erro: ["Erro", "alert"] };

export function WhatsAppChannels({ channels }: { channels: Ch[] }) {
  const [naming, setNaming] = useState(false); const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<Ch | null>(null); const [confirm, setConfirm] = useState<{ ch: Ch; remove: boolean } | null>(null);
  const [pending, start] = useTransition(); const toast = useToast(); const router = useRouter();
  useLiveRefresh(["channels"]);
  const create = () => start(async () => {
    const r = await createChannelAction(name);
    if (!r.ok) return setErr(r.error);
    setNaming(false); setName(""); router.refresh();
    setQrFor({ id: r.data!.id, name, status: "aguardando_qr", phone: null, lastEventAt: null });
  });
  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-graphite max-w-[64ch]">Cada número conecta escaneando um QR code com o celular, como no WhatsApp Web. O número continua funcionando normalmente no celular, e as conversas passam a aparecer no CRM.</p>
        <Button size="sm" className="h-9 shrink-0" onClick={() => { setErr(null); setNaming(true); }}><IconPlus size={16} />Conectar número</Button>
      </div>
      {channels.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-paper"><Empty title="Nenhum número conectado" action={<Button onClick={() => setNaming(true)}>Conectar o primeiro número</Button>}>Conecte o WhatsApp da Casa para os leads entrarem sozinhos no funil.</Empty></div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {channels.map((c) => (
            <motion.li key={c.id} layout transition={SPRING_UI} className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`size-10 rounded-[var(--radius-control)] grid place-items-center ${c.status === "conectado" ? "bg-ok-soft text-ok" : "bg-paper-2 text-muted"}`}><IconWhatsApp /></span>
                  <div><p className="font-medium">{c.name}</p><p className="text-sm text-muted">{c.phone ? formatPhoneClient(c.phone) : "número aparece ao conectar"}</p></div>
                </div>
                <Badge tone={STATUS[c.status][1]}>{c.status === "conectado" && <span className="size-1.5 rounded-full bg-ok" />}{STATUS[c.status][0]}</Badge>
              </div>
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-muted">{c.lastEventAt ? `Último sinal ${relTime(c.lastEventAt)}` : "Sem sinal ainda"}</p>
                <div className="flex gap-2">
                  {c.status !== "conectado" && <Button size="sm" onClick={() => setQrFor(c)}>Ler QR code</Button>}
                  {c.status === "conectado" && <Button size="sm" variant="secondary" onClick={() => setConfirm({ ch: c, remove: false })}>Desconectar</Button>}
                  <Button size="sm" variant="ghost" className="text-alert" onClick={() => setConfirm({ ch: c, remove: true })}>Remover</Button>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      <Dialog open={naming} onClose={() => setNaming(false)} title="Conectar número" description="Dê um nome para reconhecer este número no CRM."
        footer={<><Button variant="secondary" onClick={() => setNaming(false)}>Cancelar</Button><Button loading={pending} onClick={create}>Gerar QR code</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); create(); }}><Field label="Nome" htmlFor="ch-name" error={err}><Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Recepção, Comercial" /></Field></form>
      </Dialog>
      <QrDialog key={qrFor?.id ?? "nenhum"} channel={qrFor} onClose={() => { setQrFor(null); router.refresh(); }} />
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.remove ? "Remover número?" : "Desconectar número?"}
        description={confirm?.remove ? "O número sai do CRM. As conversas e leads que já entraram continuam guardados." : "O CRM para de receber mensagens deste número até ler o QR code de novo."}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" loading={pending} onClick={() => start(async () => { const r = await disconnectChannelAction(confirm!.ch.id, confirm!.remove); setConfirm(null); toast(r.ok ? (confirm!.remove ? "Número removido" : "Número desconectado") : r.error, r.ok ? "ok" : "error"); router.refresh(); })}>{confirm?.remove ? "Remover" : "Desconectar"}</Button></>} />
    </div>
  );
}

type QrState = { s: "gerando" } | { s: "aguardando"; qr: string; refreshes: number } | { s: "conectado" } | { s: "expirado" } | { s: "erro"; msg: string };

/** Módulo de leitura do QR: gera, renova sozinho, detecta a conexão e trata erros. */
function QrDialog({ channel, onClose }: { channel: Ch | null; onClose: () => void }) {
  const [st, setSt] = useState<QrState>({ s: "gerando" });
  const [left, setLeft] = useState(40);
  const refreshes = useRef(0);
  const apply = useCallback((r: Awaited<ReturnType<typeof channelQrAction>>) => {
    if (!r.ok) return setSt({ s: "erro", msg: r.error });
    const q = r.data!;
    if (q.status === "conectado") return setSt({ s: "conectado" });
    if (q.status === "erro") return setSt({ s: "erro", msg: q.message });
    refreshes.current += 1; setLeft(40); setSt({ s: "aguardando", qr: q.qrBase64, refreshes: refreshes.current });
  }, []);
  const load = useCallback(() => {
    if (!channel) return;
    setSt({ s: "gerando" });
    void channelQrAction(channel.id).then(apply);
  }, [channel, apply]);
  useEffect(() => {
    if (!channel) return;
    refreshes.current = 0;
    void channelQrAction(channel.id).then(apply);
  }, [channel, apply]);
  // contagem regressiva + renovação automática (até 4 vezes)
  useEffect(() => {
    if (st.s !== "aguardando") return;
    const t = setInterval(() => setLeft((l) => {
      if (l <= 1) { clearInterval(t); if (refreshes.current >= 4) setSt({ s: "expirado" }); else load(); return 40; }
      return l - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [st.s, load]);
  // checa a conexão a cada 3 s
  useEffect(() => {
    if (!channel || st.s !== "aguardando") return;
    const t = setInterval(async () => { const r = await channelStateAction(channel.id); if (r.ok && r.data === "conectado") setSt({ s: "conectado" }); }, 3000);
    return () => clearInterval(t);
  }, [channel, st.s]);

  return (
    <Dialog open={!!channel} onClose={onClose} title={channel ? `Conectar ${channel.name}` : ""} width={560}
      footer={st.s === "conectado" ? <Button onClick={onClose}>Concluir</Button> : <Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="grid sm:grid-cols-[240px_1fr] gap-6 items-center">
        <div className="relative size-[240px] mx-auto rounded-[var(--radius-panel)] border border-line bg-white grid place-items-center overflow-hidden">
          <AnimatePresence mode="wait">
            {st.s === "gerando" && <motion.div key="g" exit={{ opacity: 0 }} className="skeleton size-[200px]" aria-label="Gerando QR code" />}
            {st.s === "aguardando" && (
              <motion.div key={`q${st.refreshes}`} initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={st.qr} alt="QR code para conectar o WhatsApp" className="size-[208px]" />
                <motion.span className="absolute left-0 right-0 top-0 h-[2px] bg-gold/70 shadow-[0_0_12px_rgb(184_134_63)]" animate={{ y: [8, 198, 8] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} aria-hidden />
              </motion.div>
            )}
            {st.s === "conectado" && (
              <motion.div key="ok" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING_UI} className="size-24 rounded-full bg-ok text-white grid place-items-center">
                <IconCheck size={44} />
              </motion.div>
            )}
            {(st.s === "expirado" || st.s === "erro") && (
              <motion.div key="x" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center px-6">
                <p className="text-sm text-graphite">{st.s === "expirado" ? "O QR code expirou sem leitura." : st.msg}</p>
                <Button size="sm" className="mt-3" onClick={() => { refreshes.current = 0; load(); }}><IconRefresh size={15} />Gerar de novo</Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div>
          {st.s === "conectado" ? (
            <><p className="font-serif text-[24px] font-light">Número conectado.</p><p className="text-sm text-graphite mt-2">As próximas mensagens deste WhatsApp já entram no funil como leads.</p></>
          ) : (
            <>
              <ol className="flex flex-col gap-2.5 text-sm">
                {["Abra o WhatsApp no celular deste número", "Toque em Configurações › Aparelhos conectados", "Toque em Conectar um aparelho", "Aponte a câmera para este QR code"].map((t, i) => (
                  <li key={t} className="flex gap-3"><span className="size-6 shrink-0 rounded-full bg-paper-2 text-xs font-semibold grid place-items-center">{i + 1}</span><span className="pt-0.5">{t}</span></li>
                ))}
              </ol>
              {st.s === "aguardando" && <p className="text-xs text-muted mt-4 tabular" aria-live="polite">Novo código em {left}s · aguardando leitura…</p>}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
