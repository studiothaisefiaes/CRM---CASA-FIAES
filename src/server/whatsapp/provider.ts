export type QrResult = { status: "aguardando_qr"; qrBase64: string; code?: string } | { status: "conectado" } | { status: "erro"; message: string };
export type ConnState = "conectado" | "aguardando_qr" | "desconectado";

export interface WhatsAppProvider {
  createInstance(instanceName: string): Promise<void>;
  /** Reaplica webhook e eventos (instâncias criadas antes de uma atualização). */
  syncWebhook?(instanceName: string): Promise<void>;
  connect(instanceName: string): Promise<QrResult>;
  state(instanceName: string): Promise<ConnState>;
  sendText(instanceName: string, toE164: string, text: string): Promise<{ externalId: string | null }>;
  logout(instanceName: string): Promise<void>;
  remove(instanceName: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}
