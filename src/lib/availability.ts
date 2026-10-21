/** Estados da atendente na distribuição (usado no servidor e na tela). */
export type Availability = "disponivel" | "pausa" | "ausente";
export const AVAILABILITY: Availability[] = ["disponivel", "pausa", "ausente"];
export const AVAILABILITY_LABEL: Record<Availability, string> = { disponivel: "Disponível", pausa: "Em pausa", ausente: "Ausente" };
