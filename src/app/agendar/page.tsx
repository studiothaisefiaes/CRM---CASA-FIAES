import { notFound } from "next/navigation";
import { issueFormToken, onlineOptions } from "@/server/domain/client-link/online";
import { BookingWizard } from "@/components/online/booking-wizard";

export const metadata = { title: "Agendar horário", robots: { index: false, follow: false } };

/**
 * Agendamento online (seção 9.4.12): só existe ligado (e com a agenda fora do modo consulta). Desligado: 404 com a página própria (`not-found.tsx`). Do serviço, o navegador
 * recebe só o nome e o preço como a cliente vê (`priceText`: "a partir de R$ 150,00", "sob consulta"); custo e centavos ficam no servidor.
 */
export default async function AgendarPage() {
  const options = await onlineOptions();
  if (!options) notFound();
  const services = options.services.map((s) => ({ id: s.id, label: s.label, priceText: s.priceText }));
  return <BookingWizard options={{ ...options, services }} formToken={issueFormToken()} />;
}
