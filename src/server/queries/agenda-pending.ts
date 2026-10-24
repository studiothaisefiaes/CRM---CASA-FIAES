import { can } from "@/lib/permissions";
import { agendaRange, todayBahia } from "@/lib/agenda";
import { noBaixa, noBaixaRange } from "@/lib/agenda-day";
import { getAgenda } from "./agenda";
import { listWaitlist } from "./avec";
import { listConfirmByPhone } from "./confirm-by-phone";
import { listLeaveRequests } from "../domain/pro/leave";
import { listOnlineRequests } from "../domain/client-link/online";

export type AgendaPendingItem = { key: string; label: string; n: number; href: string };

/**
 * As pendências da Agenda à vista no Hoje › Recepção (dono 24/10: "fora do sino"): as mesmas contas do painel da Agenda, cada uma com o
 * link da aba. Pedidos só para quem marca (como na Agenda). Falta pagar fica de fora: a Casa fecha no Avec por enquanto. Só o que tem alguma coisa.
 */
export async function agendaPendingSummary(user: { id: string; perms: readonly string[] }, now = new Date()): Promise<AgendaPendingItem[]> {
  const canBook = can(user.perms, "agenda.marcar");
  const [week, waitlist, leave, online, phone] = await Promise.all([
    getAgenda(noBaixaRange(todayBahia(now)), now), listWaitlist({ from: agendaRange({}, now).from }),
    canBook ? listLeaveRequests() : [], canBook ? listOnlineRequests() : [], listConfirmByPhone(now),
  ]);
  const items: AgendaPendingItem[] = [
    { key: "semBaixa", label: "Sem desfecho", n: noBaixa(week, now.getTime()).length, href: "/agenda?aba=semBaixa" },
    { key: "site", label: "Pedidos do site", n: online.length, href: "/agenda?pedidos=site" },
    { key: "folga", label: "Pedidos de folga", n: leave.length, href: "/agenda?pedidos=folga" },
    { key: "telefone", label: "Confirmar por telefone", n: phone.length, href: "/agenda?aba=telefone" },
    { key: "espera", label: "Lista de espera", n: waitlist.length, href: "/agenda?aba=espera" },
  ];
  return items.filter((i) => i.n > 0);
}
