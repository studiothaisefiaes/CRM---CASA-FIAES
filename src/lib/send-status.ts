/** O provider não respondeu (timeout, rede): a mensagem PODE ter saído. A tela pede para conferir no WhatsApp antes de reenviar. */
export const UNCERTAIN_SEND_MESSAGE = "Envio incerto: a Evolution não respondeu. Confira no WhatsApp antes de reenviar.";
export const isUncertainSend = (m: { status: string; error?: string | null }) => m.status === "failed" && m.error === UNCERTAIN_SEND_MESSAGE;
