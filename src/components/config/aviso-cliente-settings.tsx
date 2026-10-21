"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { NO_IMAGE_USE_MAX, NO_IMAGE_USE_TEXT } from "@/lib/client-alert";
import { saveClientAlertAction } from "@/app/(app)/config/aviso-cliente/actions";

type Config = { noHorario: boolean; naComanda: boolean; textoSemUsoImagem: string };
const OFF = "Essa função está desligada em Configurações › Recursos. Os Avisos continuam na ficha da cliente.";

/**
 * Configurações › Agenda e caixa › Aviso da cliente: onde o aviso salta (ao abrir o horário, ao abrir a comanda) e o texto da linha de quem
 * não autorizou uso de imagem ("Usar o texto sugerido" volta ao de fábrica). Salva a cada mudança.
 */
export function AvisoClienteSettings({ config, avisoOn }: { config: Config; avisoOn: boolean }) {
  const [horario, setHorario] = useState(config.noHorario);
  const [comanda, setComanda] = useState(config.naComanda);
  const [texto, setTexto] = useState(config.textoSemUsoImagem);
  const [pending, start] = useTransition();
  const toast = useToast(); const router = useRouter();
  const save = (patch: Parameters<typeof saveClientAlertAction>[0], undo: () => void, ok: string) => start(async () => {
    const r = await saveClientAlertAction(patch);
    if (!r.ok) { toast(r.error, "error"); undo(); return; }
    toast(ok); router.refresh();
  });
  const rename = () => {
    const v = texto.trim().replace(/\s+/g, " ");
    if (!v) { setTexto(NO_IMAGE_USE_TEXT); save({ textoSemUsoImagem: "" }, () => setTexto(config.textoSemUsoImagem), "Voltou ao texto sugerido"); return; }
    if (v === config.textoSemUsoImagem) { setTexto(v); return; }
    save({ textoSemUsoImagem: v }, () => setTexto(config.textoSemUsoImagem), "Texto salvo");
  };
  const dis = !avisoOn || pending;
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-card)] border border-line bg-paper" aria-labelledby="aviso-onde">
        <div className="px-5 pt-5">
          <h2 id="aviso-onde" className="text-lg font-semibold">Onde o aviso salta</h2>
          <p className="mt-1 max-w-[62ch] text-sm text-graphite">Os Avisos da cliente (alergias e cuidados) saltam numa janela, uma vez por visita, até a equipe tocar em “Entendi”.</p>
          {!avisoOn && <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3 py-2.5 text-sm text-gold-ink">{OFF}</p>}
        </div>
        <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
          <li className="flex items-center justify-between gap-4 px-5 py-3">
            <span className="text-sm text-ink">Ao abrir o horário na Agenda</span>
            <Switch checked={horario} label="Saltar ao abrir o horário" disabled={dis}
              onChange={(v) => { setHorario(v); save({ noHorario: v }, () => setHorario(!v), v ? "Salta ao abrir o horário" : "Não salta ao abrir o horário"); }} />
          </li>
          <li className="flex items-center justify-between gap-4 px-5 py-3">
            <span className="text-sm text-ink">Ao abrir a comanda</span>
            <Switch checked={comanda} label="Saltar ao abrir a comanda" disabled={dis}
              onChange={(v) => { setComanda(v); save({ naComanda: v }, () => setComanda(!v), v ? "Salta ao abrir a comanda" : "Não salta ao abrir a comanda"); }} />
          </li>
        </ul>
      </section>
      <section className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-5" aria-labelledby="aviso-texto">
        <h2 id="aviso-texto" className="text-lg font-semibold">Quem não autorizou uso de imagem</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-graphite">Quando a cliente está marcada como “Não” em Uso de imagem, esta linha entra no aviso.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-graphite">Texto de quem não autorizou uso de imagem
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              maxLength={NO_IMAGE_USE_MAX} disabled={dis} className="h-10 w-96 max-w-full" />
          </label>
          {texto !== NO_IMAGE_USE_TEXT && (
            <Button variant="ghost" size="sm" disabled={dis} onClick={() => { const old = texto; setTexto(NO_IMAGE_USE_TEXT); save({ textoSemUsoImagem: "" }, () => setTexto(old), "Voltou ao texto sugerido"); }}>Usar o texto sugerido</Button>
          )}
        </div>
      </section>
    </div>
  );
}
