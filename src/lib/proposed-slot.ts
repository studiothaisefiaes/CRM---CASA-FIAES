import { displayName } from "./display-name";
import { prettyName } from "./services-view";

/**
 * O horário que a sugestão da IA propôs (pedido do dono, 17/10: "quero ela até MARCANDO, tudo como sugestão"). Módulo puro, tela e servidor.
 * Vem de uma opção da linha "Horários livres" (id h1…h8) ou do horário que a Casa ofereceu e a cliente aceitou ("hc", combinado).
 * Nada é marcado com isto: o botão "Marcar este horário" só abre a folha "Marcar horário" preenchida, e a atendente confirma.
 */
export type ProposedSlot = {
  /** "h3" (opção da lista) ou "hc" (combinado com a cliente). */
  id: string;
  /** Dia em Salvador (AAAA-MM-DD) e hora (HH:MM). */
  day: string;
  time: string;
  professionalId: string | null;
  /** Nome de cadastro da profissional ("THAISE FIAES"); a tela mostra bonito. */
  professionalName: string | null;
  serviceId: string | null;
  serviceLabel: string | null;
  durationMin: number;
  origem: "lista" | "combinado";
};

const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekday = (day: string) => WD[new Date(`${day}T12:00:00Z`).getUTCDay()];
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** "15:00" → "15h"; "16:30" → "16h30". */
export const hourText = (time: string) => { const [h, m] = time.split(":"); return `${Number(h)}h${m === "00" ? "" : m}`; };
const firstWord = (name: string) => displayName(name.trim().split(/\s+/)[0] ?? "");

/** "ter 20/10 às 15h · Thaise Fiaes · Avaliação" (o cartão da sugestão). */
export function slotLabel(s: ProposedSlot): string {
  return [`${weekday(s.day)} ${ddmm(s.day)} às ${hourText(s.time)}`, s.professionalName ? displayName(s.professionalName) : null, s.serviceLabel ? prettyName(s.serviceLabel) : null]
    .filter(Boolean).join(" · ");
}

/** O padrão da Casa: "Confirmado agendamento de Avaliação dia 20/10 às 15:00h com Thaise." Só vai para a caixa de mensagem (nunca sai sozinho). */
export function confirmText(s: Pick<ProposedSlot, "day" | "time" | "professionalName" | "serviceLabel">): string {
  const svc = s.serviceLabel ? ` de ${prettyName(s.serviceLabel)}` : "";
  const pro = s.professionalName ? ` com ${firstWord(s.professionalName)}` : "";
  return `Confirmado agendamento${svc} dia ${ddmm(s.day)} às ${s.time}h${pro}.`;
}

/** A sugestão já é a confirmação no padrão da Casa? Então é ela que vai para a caixa depois de marcar. */
export const isConfirmation = (text: string) => /confirmad[oa] (o )?agendamento/i.test(text);
