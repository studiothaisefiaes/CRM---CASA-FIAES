import { db } from "@/server/db";
import { automations } from "@/server/db/schema";

/**
 * Automação de agendamento (faltar 24 h) criada pelo próprio teste. As do seed (`lembrete_agendamento`, `confirmacao_d1`) foram aposentadas
 * no Plano 5: o lembrete da véspera é só o de Configurações › Mensagens. O gatilho e a enquete continuam valendo para automação personalizada.
 */
export async function scheduleAutomation(kind: "texto" | "enquete", over: { enabled?: boolean; key?: string; message?: string } = {}) {
  const message = over.message ?? (kind === "texto"
    ? "Oi, {nome}! Passando para lembrar do seu horário na Casa Fiaes: {data}, às {hora}. Pode confirmar respondendo esta mensagem?"
    : "Oi, {nome}! Seu horário na Casa Fiaes é {data}, às {hora}. Você confirma?");
  const [a] = await db.insert(automations).values({
    key: over.key ?? null, name: kind === "texto" ? "Lembrete do agendamento (teste)" : "Enquete de confirmação (teste)", enabled: over.enabled ?? true,
    trigger: { type: "agendamento_em_horas", hours: 24 }, conditions: [{ type: "etapa_em", stages: ["agendado"] }],
    actions: [{ type: kind === "texto" ? "enviar_mensagem" : "enviar_enquete_confirmacao", message }],
  }).returning();
  return a;
}
