"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveCasaInfoAction, saveClientLinkSettingsAction } from "@/app/(app)/config/pagina-cliente/actions";
import type { CasaInfo, ClientLinkSettings } from "@/server/domain/client-link/settings";

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-5";

/** Página da cliente: endereço e WhatsApp da Casa, texto modelo do link e prazo para cancelar pelo link. */
export function ClientPageSettings({ casa, link }: { casa: CasaInfo; link: ClientLinkSettings }) {
  const [endereco, setEndereco] = useState(casa.endereco ?? "");
  const [whatsapp, setWhatsapp] = useState(casa.whatsapp ?? "");
  const [mapa, setMapa] = useState(casa.mapa ?? "");
  const [lat, setLat] = useState(casa.latitude === null ? "" : String(casa.latitude));
  const [lng, setLng] = useState(casa.longitude === null ? "" : String(casa.longitude));
  const [horas, setHoras] = useState(String(link.cancelarAteHoras));
  const [texto, setTexto] = useState(link.texto);
  const [pending, start] = useTransition();
  const toast = useToast();
  const num = (v: string) => (v.trim() === "" ? null : Number(v.trim().replace(",", ".")));
  const saveCasa = () => start(async () => { const r = await saveCasaInfoAction({ endereco, whatsapp, mapa, latitude: num(lat), longitude: num(lng) }); toast(r.ok ? "Salvo" : r.error, r.ok ? "ok" : "error"); });
  const saveLink = () => start(async () => { const r = await saveClientLinkSettingsAction({ cancelarAteHoras: horas.trim() === "" ? NaN : Number(horas), texto }); toast(r.ok ? "Salvo" : r.error, r.ok ? "ok" : "error"); });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form className={CARD} onSubmit={(e) => { e.preventDefault(); saveCasa(); }}>
        <h2 className="text-lg font-semibold">A Casa na página</h2>
        <p className="mt-1 text-sm text-graphite">Sem endereço, a página não mostra &quot;Como chegar&quot;. O WhatsApp aparece em &quot;Falar com a Casa&quot;.</p>
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Endereço" htmlFor="pc-endereco"><Input id="pc-endereco" value={endereco} maxLength={200} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número - bairro" /></Field>
          <Field label="Link do mapa" htmlFor="pc-mapa" hint="Vai na confirmação da véspera, embaixo do endereço. Vazio: a busca do endereço no Google Maps.">
            <Input id="pc-mapa" value={mapa} maxLength={300} onChange={(e) => setMapa(e.target.value)} placeholder="https://maps.app.goo.gl/…" inputMode="url" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pino da Casa: latitude" htmlFor="pc-lat" hint="No Google Maps, toque e segure no ponto da Casa: os dois números aparecem no alto. Usado no “Como chegar” da conversa.">
              <Input id="pc-lat" value={lat} maxLength={20} onChange={(e) => setLat(e.target.value)} placeholder="-12.9714" inputMode="decimal" />
            </Field>
            <Field label="Pino da Casa: longitude" htmlFor="pc-lng"><Input id="pc-lng" value={lng} maxLength={20} onChange={(e) => setLng(e.target.value)} placeholder="-38.5014" inputMode="decimal" /></Field>
          </div>
          <Field label="WhatsApp da Casa" htmlFor="pc-whats"><Input id="pc-whats" value={whatsapp} maxLength={30} onChange={(e) => setWhatsapp(e.target.value)} placeholder="71 99999-9999" inputMode="tel" /></Field>
          <Button type="submit" loading={pending} className="self-start">Salvar</Button>
        </div>
      </form>
      <form className={CARD} onSubmit={(e) => { e.preventDefault(); saveLink(); }}>
        <h2 className="text-lg font-semibold">O link da cliente</h2>
        <p className="mt-1 text-sm text-graphite">O botão &quot;Enviar link de confirmação&quot; da conversa só preenche este texto: quem envia é a atendente.</p>
        <div className="mt-4 flex flex-col gap-3">
          <Field label="Texto da mensagem" htmlFor="pc-texto" hint="Use {primeiro_nome}, {data} (quinta-feira, 22/10), {hora} (14h), {servicos} e {link}. Sem {link}, o link vai no fim. *texto* sai em negrito no WhatsApp.">
            <Textarea id="pc-texto" value={texto} maxLength={600} onChange={(e) => setTexto(e.target.value)} />
          </Field>
          <Field label="A cliente cancela pelo link até quantas horas antes?" htmlFor="pc-horas" hint="Depois disso, a página mostra 'Falar com a Casa'. 0 = até a hora.">
            <Input id="pc-horas" type="number" inputMode="numeric" min={0} max={168} value={horas} onChange={(e) => setHoras(e.target.value)} className="w-32" />
          </Field>
          <Button type="submit" loading={pending} className="self-start">Salvar</Button>
        </div>
      </form>
    </div>
  );
}
