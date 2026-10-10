export type QrResult = { status: "aguardando_qr"; qrBase64: string; code?: string } | { status: "conectado" } | { status: "erro"; message: string };
export type ConnState = "conectado" | "aguardando_qr" | "desconectado";

/** Mensagem que está sendo respondida. A Evolution precisa do conteúdo: mensagem importada do histórico não existe no banco dela. */
export type QuotedMessage = { externalId: string; fromMe: boolean; text: string };

export interface WhatsAppProvider {
  createInstance(instanceName: string): Promise<void>;
  /** Reaplica webhook e eventos (instâncias criadas antes de uma atualização). */
  syncWebhook?(instanceName: string): Promise<void>;
  connect(instanceName: string): Promise<QrResult>;
  state(instanceName: string): Promise<ConnState>;
  /** `quoted`: mensagem do WhatsApp que esta responde (citação). */
  sendText(instanceName: string, toE164: string, text: string, quoted?: QuotedMessage): Promise<{ externalId: string | null }>;
  /** Foto, vídeo ou documento (`mediatype` da Evolution: image, video, document). */
  sendMedia?(instanceName: string, toE164: string, file: { name: string; mime: string; data: Buffer; mediatype: "image" | "video" | "document" }, caption: string | null, quoted?: QuotedMessage): Promise<{ externalId: string | null }>;
  /** Mensagem de voz (a Evolution converte para OGG/Opus). */
  sendAudio?(instanceName: string, toE164: string, data: Buffer, quoted?: QuotedMessage): Promise<{ externalId: string | null }>;
  /** Enquete de escolha única (`selectableCount: 1`). O voto volta pelo webhook (messages.upsert / messages.update com `pollUpdates`). */
  sendPoll?(instanceName: string, toE164: string, name: string, options: string[]): Promise<{ externalId: string | null }>;
  /** Marca como lidas (visto azul) as mensagens recebidas com estes ids. */
  markRead?(instanceName: string, toE164: string, externalIds: string[]): Promise<void>;
  logout(instanceName: string): Promise<void>;
  /** Baixa a mídia de uma mensagem ({ key, message } do WhatsApp). */
  downloadMedia?(instanceName: string, node: { key: Record<string, unknown>; message: Record<string, unknown> }): Promise<{ base64: string; mimetype: string | null; fileName: string | null }>;
  /** URL da foto de perfil (null se a pessoa não tem ou esconde). */
  profilePictureUrl?(instanceName: string, toE164: string): Promise<string | null>;
  remove(instanceName: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}
