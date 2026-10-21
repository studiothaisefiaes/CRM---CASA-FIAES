import { randomUUID } from "node:crypto";
import type { WhatsAppProvider } from "./provider";

type Req<K extends keyof WhatsAppProvider> = NonNullable<WhatsAppProvider[K]>;
const newId = () => `DEMO-${randomUUID()}`;

/**
 * WhatsApp de mentira da demonstração (DEMO=true): nunca abre conexão de rede.
 * Envio "dá certo" (a mensagem aparece como enviada na conversa) e o número fica sempre conectado.
 * Mensagens novas chegando entram pelo simulador (/dev/simulador), como no e2e.
 */
export class DemoProvider implements WhatsAppProvider {
  createInstance: Req<"createInstance"> = async () => {};
  syncWebhook: Req<"syncWebhook"> = async () => {};
  connect: Req<"connect"> = async () => ({ status: "conectado" });
  state: Req<"state"> = async () => "conectado";
  sendText: Req<"sendText"> = async () => ({ externalId: newId() });
  sendMedia: Req<"sendMedia"> = async () => ({ externalId: newId() });
  sendAudio: Req<"sendAudio"> = async () => ({ externalId: newId() });
  sendPoll: Req<"sendPoll"> = async () => ({ externalId: newId() });
  markRead: Req<"markRead"> = async () => {};
  deleteForEveryone: Req<"deleteForEveryone"> = async () => {};
  sendReaction: Req<"sendReaction"> = async () => {};
  editText: Req<"editText"> = async () => {};
  sendLocation: Req<"sendLocation"> = async () => ({ externalId: newId() });
  sendContact: Req<"sendContact"> = async () => ({ externalId: newId() });
  logout: Req<"logout"> = async () => {};
  profilePictureUrl: Req<"profilePictureUrl"> = async () => null;
  remove: Req<"remove"> = async () => {};
}
