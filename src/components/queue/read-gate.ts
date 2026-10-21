/**
 * Mensagem que chega com a conversa aberta só conta como lida se a pessoa está olhando: aba visível E janela em foco.
 * Conversa largada aberta (outra janela na frente, o computador da recepção sem ninguém) não pode engolir a não lida nem o aviso.
 */
export const canMarkReadNow = (d: Pick<Document, "visibilityState"> & { hasFocus: () => boolean }): boolean => d.visibilityState === "visible" && d.hasFocus();
