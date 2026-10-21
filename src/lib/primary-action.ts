/** A ação principal do lead ("O que fazer"), pelo momento: quem é a dona, a etapa e o agendamento. As outras viram links. */
export type PrimaryAction = "assumir" | "agendar" | "remarcar" | "conferir" | "fechar";

export function primaryAction(d: { ownerId: string | null; stageKind: string; scheduledAt: string | Date | null; attendance: string | null }, viewerId: string | null, now: Date = new Date(), opts: { canClose?: boolean } = {}): PrimaryAction | null {
  if (d.stageKind === "fechado" || d.stageKind === "perdido") return null;
  if (d.stageKind === "atendido") return opts.canClose === false ? null : "fechar";
  if (d.stageKind === "na_casa") return null; // a cliente está no salão: a Agenda (Finalizar/comanda) leva para Atendida
  if (viewerId && d.ownerId !== viewerId) return "assumir";
  if (d.stageKind === "agendado") {
    if (d.attendance === "compareceu") return opts.canClose === false ? null : "fechar";
    const past = !!d.scheduledAt && new Date(d.scheduledAt).getTime() <= now.getTime();
    return past ? "conferir" : "remarcar";
  }
  return "agendar";
}

export const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  assumir: "Assumir e responder", agendar: "Agendar", remarcar: "Remarcar", conferir: "Conferir comparecimento", fechar: "Fechar venda",
};

/** "Compareceu?" só depois do horário (antes, a pergunta não faz sentido). Já marcado (compareceu/faltou), continua para poder corrigir,
 * inclusive depois que a conversa foi para Atendida ou (Faltou) para Em conversa esperando a cliente. */
export function askAttendance(d: { stageKind: string; scheduledAt: string | Date | null; attendance: string | null }, now: number): boolean {
  if (d.attendance === "faltou" && d.stageKind === "atendimento") return true; // Faltou leva para Em conversa esperando a cliente
  if (d.attendance === "compareceu" || d.attendance === "faltou") return ["agendado", "atendido", "followup"].includes(d.stageKind);
  if (d.stageKind !== "agendado") return false;
  return !!d.scheduledAt && new Date(d.scheduledAt).getTime() <= now;
}
