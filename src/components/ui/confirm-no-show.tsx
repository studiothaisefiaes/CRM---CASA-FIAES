"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

/**
 * "Faltou" pede confirmação em todo lugar (QA r58, M-2): na Fila, no Hoje, na Agenda, nas Pendências, no Fechar o dia, na visita do dia e no
 * app da profissional. Um diálogo só, no alto do app (como os avisos). Depois de marcar, o aviso de cada tela oferece Desfazer.
 * Sem o provider (testes de um componente solto), confirma direto.
 */
export type NoShowAsk = { /** Quem faltou, ou "3 horários". */ who: string; /** Hora ou serviço, quando ajuda a conferir. */ detail?: string | null; onConfirm: () => void };
const Ctx = createContext<(a: NoShowAsk) => void>((a) => a.onConfirm());
export const useConfirmNoShow = () => useContext(Ctx);

export function ConfirmNoShowProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<NoShowAsk | null>(null);
  // O que houve (20/10): só não veio, ou cancelou? E a conversa fica para remarcar? O servidor lê a escolha de um cookie curto (casa_falta).
  const [tipo, setTipo] = useState<"faltou" | "cancelou">("faltou");
  const [remarcar, setRemarcar] = useState(true);
  const open = useCallback((a: NoShowAsk) => { setTipo("faltou"); setRemarcar(true); setAsk(a); }, []);
  const close = useCallback(() => setAsk(null), []);
  const confirm = () => {
    const a = ask; setAsk(null);
    try { document.cookie = `casa_falta=${encodeURIComponent(JSON.stringify({ t: tipo, r: remarcar }))}; path=/; max-age=30; samesite=lax`; } catch { /* sem cookie: só não veio e remarcar, como sempre */ }
    a?.onConfirm();
  };
  return (
    <Ctx.Provider value={open}>
      {children}
      <Dialog open={!!ask} onClose={close} title="O que aconteceu?"
        description={ask ? `${ask.who}${ask.detail ? ` (${ask.detail})` : ""}. Logo depois, o aviso deixa desfazer.` : undefined}
        footer={<><Button variant="ghost" onClick={close}>Voltar</Button><Button variant="danger" onClick={confirm}>{tipo === "cancelou" ? "Marcar cancelou" : "Marcar que não veio"}</Button></>}>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">O que aconteceu</legend>
          {([["faltou", "Não veio", "Faltou sem avisar."], ["cancelou", "Cancelou", "Ela avisou que não vem."]] as const).map(([v, t, d]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 ${tipo === v ? "border-ink bg-paper-2" : "border-line"}`}>
              <input type="radio" name="falta-tipo" className="mt-1" checked={tipo === v} onChange={() => setTipo(v)} />
              <span className="text-sm"><span className="font-semibold text-ink">{t}</span><span className="block text-muted">{d}</span></span>
            </label>
          ))}
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={remarcar} onChange={(e) => setRemarcar(e.target.checked)} />
            Marcar para remarcar (a conversa fica com “Remarcar”)
          </label>
        </fieldset>
      </Dialog>
    </Ctx.Provider>
  );
}
