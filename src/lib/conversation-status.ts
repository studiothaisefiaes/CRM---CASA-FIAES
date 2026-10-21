/**
 * O status da conversa (pedido do dono, 16/10; os nomes que a equipe já usa no ChatGuru), separado da etapa do funil. Módulo puro.
 * - Resolvido: a conversa foi resolvida (o antigo "Encerrar", `conversationArchivedAt`). Volta sozinha se a cliente escrever.
 * - Aberto: a cliente espera a Casa (`awaitingReplySince`). A cliente escreveu: Aberto.
 * - Aguardando: ninguém espera a Casa; a Casa falou por último (ou marcou que não precisa responder). A Casa respondeu: Aguardando.
 * Aberto que passou do prazo aparece como "Atrasado" (vermelho), para a cor nunca precisar de explicação.
 * Tudo é derivado do que já existe: trocar à mão só mexe na espera ou no resolvido.
 */
export const CONVERSATION_STATUSES = ["aberto", "aguardando", "resolvido"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const STATUS_LABEL: Record<ConversationStatus, string> = { aberto: "Aberto", aguardando: "Aguardando", resolvido: "Resolvido" };
export const STATUS_HINT: Record<ConversationStatus, string> = {
  aberto: "A cliente espera a resposta da Casa.",
  aguardando: "A Casa já respondeu: agora é a vez da cliente.",
  resolvido: "Conversa resolvida. Volta para Aberto sozinha se a cliente escrever.",
};
/** Cores só do status (nenhuma é cor de etapa): azul, verde-água e cinza-azulado. Atraso real pinta o Aberto de vermelho. */
export const STATUS_COLOR: Record<ConversationStatus, string> = { aberto: "#2a55a3", aguardando: "#0a6166", resolvido: "#566070" };
export const LATE_COLOR = "#b3261e";
export const statusTone = (s: ConversationStatus, late: boolean) => (s === "aberto" && late ? LATE_COLOR : STATUS_COLOR[s]);

type When = string | Date | null | undefined;
export function conversationStatus(o: { archivedAt: When; awaitingSince: When }): ConversationStatus {
  if (o.archivedAt) return "resolvido";
  return o.awaitingSince ? "aberto" : "aguardando";
}

/**
 * "Para retomar" (20/10, pedido do dono): um estado de verdade, com cor própria. Vale quando a Casa não está devendo resposta e há um combinado
 * de voltar a falar numa data, mesmo que alguém tenha clicado em Resolver depois (caso Aline: a Sara marcou a retomada e resolveu; a conversa
 * sumia). Devolve o dia e a hora ("sáb. 24/10 10:00") ou null.
 */
export const RETOMAR_LABEL = "Para retomar";
export const RETOMAR_COLOR = "#6b4fa3";
export function retomarWhen(o: { awaitingSince: When; dueAt: When; lastAt?: When }, now = Date.now()): string | null {
  if (o.awaitingSince || !o.dueAt || retomadaSuperada(o.dueAt, o.lastAt, now)) return null;
  return new Date(o.dueAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" }).replace(/,/g, "");
}

/**
 * Combinado vencido que já teve conversa depois (20/10, Cati: a cliente de sábado falando com ela e a tela "Para retomar · venceu 18/10"):
 * a conversa já foi retomada, então não é mais "Para retomar". O combinado segue aberto no Próximo passo para concluir.
 */
export function retomadaSuperada(dueAt: When, lastAt: When, now = Date.now()): boolean {
  if (!dueAt || !lastAt) return false;
  const due = new Date(dueAt).getTime();
  return due < now && new Date(lastAt).getTime() > due;
}

/** Retomada vencida (a data já passou): vermelha, "venceu 14/10", para separar do roxo com data à frente (20/10). */
export function retomarVencida(dueAt: When, now = Date.now()): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  return d.getTime() < now ? `venceu ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" })}` : null;
}
