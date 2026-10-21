/** As frases da Agenda (conflito, recusa, aviso de cancelamento). Horas sempre em Salvador, qualquer que seja o fuso do aparelho. */
import { firstName } from "./authorship";

const HM = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
export const hourOf = (iso: string | Date) => HM.format(new Date(iso));

/** O lembrete do modo dupla (6.1): no formulário Marcar e em "Conferir com o Avec". */
export const DUPLA_NOTE = "Enquanto o Avec estiver ligado, marque, remarque e cancele também lá.";

/** Um horário que atrapalha o candidato: da mesma profissional ou da mesma cliente (com outra profissional). */
export type ConflictDetail = {
  id: string; clientName: string; serviceLabel: string; professionalName: string | null;
  startsAt: string; endsAt: string; sameClient: boolean; createdByName: string | null; createdAt: string | null;
};
export type SlotRefusal = "sem_duracao" | "duracao_invalida" | "passou" | "atravessa_meia_noite" | "bloqueado" | "conflito" | "fora_do_horario" | "nao_trabalha";

/** "Ana já tem Paula das 10:00 às 11:20" (mesma profissional) ou "Paula já tem Escova às 10:00 com a Bia" (mesma cliente). */
export function conflictText(proName: string, c: ConflictDetail): string {
  const client = firstName(c.clientName) ?? "a cliente";
  if (c.sameClient) return `${client} já tem ${c.serviceLabel} às ${hourOf(c.startsAt)}${c.professionalName ? ` com a ${firstName(c.professionalName)}` : ""}`;
  return `${firstName(proName) ?? proName} já tem ${client} das ${hourOf(c.startsAt)} às ${hourOf(c.endsAt)}`;
}

/** Quem perdeu a disputa pelo mesmo horário (6.6). */
export function justTakenText(c: ConflictDetail): string {
  const at = c.createdAt ? ` às ${hourOf(c.createdAt)}` : "";
  return `Esse horário acabou de ser ocupado (${firstName(c.createdByName) ?? "Alguém"} marcou ${firstName(c.clientName) ?? "uma cliente"}${at}). Escolha outro.`;
}

export function refusalText(reason: SlotRefusal, ctx: { proName: string; serviceLabel: string; blockedBy?: string | null }): string {
  const pro = firstName(ctx.proName) ?? ctx.proName;
  switch (reason) {
    case "sem_duracao": return `${ctx.serviceLabel} não tem duração cadastrada. Diga quanto tempo leva desta vez.`;
    case "duracao_invalida": return "Confira a duração: de 5 em 5 minutos, até 12 horas.";
    case "passou": return "Esse horário já passou. Escolha outro.";
    case "atravessa_meia_noite": return "Esse horário passa da meia-noite";
    case "bloqueado": return `${pro} está com a agenda bloqueada nesse horário${ctx.blockedBy ? ` (${ctx.blockedBy})` : ""}.`;
    case "conflito": return `${pro} já tem cliente nesse horário.`;
    case "fora_do_horario": case "nao_trabalha": return `Fora do horário de trabalho de ${pro}.`;
  }
}

/** "Avisar a cliente" no cancelamento: o texto que a recepção cola na conversa. */
export function cancelNoticeText(c: { clientName: string | null; startsAt: string; services: string[] }): string {
  const nome = firstName(c.clientName);
  return `Oi${nome ? `, ${nome}` : ""}! Seu horário de ${DAY.format(new Date(c.startsAt))} às ${hourOf(c.startsAt)} (${c.services.join(" e ")}) foi cancelado. Quer marcar outro dia? É só responder aqui.`;
}
