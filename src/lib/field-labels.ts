/** Nome em português de cada campo do lead, para a auditoria e o histórico. */
export const FIELD_LABELS: Record<string, string> = {
  name: "Nome", email: "E-mail", instagram: "Instagram", birthday: "Aniversário", observations: "Observações", objectionId: "Objeção",
  lostReasonId: "Motivo de perda", ownerId: "Responsável", origin: "Origem", sourceId: "Origem", valueCents: "Valor", paymentMethod: "Forma de pagamento",
  scheduledAt: "Agendamento", chargeAt: "Data de cobrança", recontactAt: "Data de recontato", serviceId: "Serviço",
  paidAt: "Data do pagamento", paidCents: "Valor pago", attendance: "Comparecimento",
};

/** Valores de `deals.attendance`: confirmado (enquete D-1) → compareceu | faltou | remarcou (conferência do dia). */
export const ATTENDANCE_LABELS: Record<string, string> = { confirmado: "Confirmado", compareceu: "Compareceu", faltou: "Faltou", remarcou: "Remarcou" };
export const attendanceLabel = (v: unknown) => (v == null || v === "" ? "removido" : ATTENDANCE_LABELS[String(v)] ?? String(v));
