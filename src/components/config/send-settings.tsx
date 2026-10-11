"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { saveSendCapAction, saveMediaRetentionAction } from "@/app/(app)/config/actions";
import type { Retention } from "@/components/config/whatsapp";

const RET_OPTIONS = [{ value: "6", label: "6 meses" }, { value: "12", label: "12 meses" }, { value: "24", label: "24 meses" }, { value: "nunca", label: "Nunca apagar" }];

/** Limite de envios automáticos por hora e prazo de guarda das mídias (fotos, áudios, vídeos e documentos). */
export function SendSettings({ sendCap, retention }: { sendCap: number; retention: Retention }) {
  const [cap, setCap] = useState(String(sendCap)); const [capSaved, setCapSaved] = useState(sendCap); const [capErr, setCapErr] = useState<string | null>(null);
  const [ret, setRet] = useState<string>(String(retention)); const [retSaved, setRetSaved] = useState<string>(String(retention)); const [retErr, setRetErr] = useState<string | null>(null);
  const [pendingCap, startCap] = useTransition(); const [pendingRet, startRet] = useTransition(); const toast = useToast();
  const saveCap = () => startCap(async () => {
    setCapErr(null);
    const r = await saveSendCapAction(cap.trim() === "" ? NaN : Number(cap));
    if (!r.ok) return setCapErr(r.error);
    setCapSaved(Number(cap)); toast("Limite por hora salvo", "ok");
  });
  const saveRet = () => startRet(async () => {
    setRetErr(null);
    const r = await saveMediaRetentionAction(ret === "nunca" ? "nunca" : Number(ret));
    if (!r.ok) return setRetErr(r.error);
    setRetSaved(ret); toast("Prazo das mídias salvo", "ok");
  });
  return (
    <div className="grid lg:grid-cols-2 gap-4 mt-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <h2 className="font-serif text-[22px] font-light">Limite de envios por hora</h2>
        <p className="text-sm text-graphite mt-1">Vale para as mensagens automáticas (lembretes, enquetes, resposta fora do horário). Ao passar do limite, o resto espera a hora seguinte; protege o número contra bloqueio.</p>
        <form noValidate className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); saveCap(); }}>
          <label className="block"><span className="text-sm font-medium text-graphite">Mensagens por hora (1 a 200)</span>
            <Input className="mt-1.5 w-32 pointer-coarse:h-11" type="number" inputMode="numeric" min={1} max={200} step={1} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={!!capErr} /></label>
          <Button type="submit" className="pointer-coarse:min-h-11" disabled={cap === String(capSaved)} loading={pendingCap}>Salvar limite</Button>
        </form>
        {capErr && <p className="text-sm text-alert mt-2" role="alert">{capErr}</p>}
      </section>
      <section className="rounded-[var(--radius-card)] border border-line bg-paper p-5">
        <h2 className="font-serif text-[22px] font-light">Guardar fotos, áudios e documentos</h2>
        <p className="text-sm text-graphite mt-1">Arquivos mais antigos que o prazo são apagados do disco. A mensagem continua na conversa, só o arquivo some. Quanto menor o prazo, menos espaço o servidor usa.</p>
        <div className="mt-4"><Segmented label="Prazo para guardar as mídias" options={RET_OPTIONS} value={ret} onChange={setRet} /></div>
        <div className="mt-4"><Button className="pointer-coarse:min-h-11" disabled={ret === retSaved} loading={pendingRet} onClick={saveRet}>Salvar prazo</Button></div>
        {retErr && <p className="text-sm text-alert mt-2" role="alert">{retErr}</p>}
      </section>
    </div>
  );
}
