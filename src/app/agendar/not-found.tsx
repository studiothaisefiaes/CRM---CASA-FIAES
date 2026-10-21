import { getCasaInfo } from "@/server/domain/client-link/settings";
import { waLink } from "@/lib/client-link";
import { LinkUnavailable } from "@/components/client-link/unavailable";

export const metadata = { title: "Agendamento online indisponível", robots: { index: false, follow: false } };

/** `/agendar` com o agendamento online desligado (o `notFound()` da página cai aqui): português, a marca e o WhatsApp da Casa. */
export default async function AgendarIndisponivel() {
  const wa = waLink((await getCasaInfo()).whatsapp, "Oi! Quero marcar um horário.");
  return <LinkUnavailable title="Agendamento online indisponível agora" text="Por aqui ainda não dá para marcar. Fale com a Casa pelo WhatsApp e a gente cuida do seu horário." waHref={wa} />;
}
