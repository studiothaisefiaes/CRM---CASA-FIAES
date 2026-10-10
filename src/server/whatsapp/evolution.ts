import { env } from "../env";
import { toWhatsappNumber } from "../domain/phone";
import { ProviderError, type ConnState, type QrResult, type QuotedMessage, type WhatsAppProvider } from "./provider";

export const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_SET", "SEND_MESSAGE", "CONNECTION_UPDATE"] as const;

export class EvolutionProvider implements WhatsAppProvider {
  constructor(private baseUrl: string, private apiKey: string, private webhookUrl: string, private webhookSecret: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method, headers: { apikey: this.apiKey, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(path.includes("/message/send") ? 60_000 : 15_000), cache: "no-store",
      });
    } catch {
      throw new ProviderError("O serviço do WhatsApp (Evolution) não respondeu. Ele está ligado?");
    }
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const msg = JSON.stringify((data as { response?: { message?: unknown } })?.response?.message ?? data ?? res.statusText);
      throw new ProviderError(`Evolution respondeu ${res.status}: ${msg.slice(0, 200)}`, res.status);
    }
    return data as T;
  }

  async createInstance(instanceName: string) {
    await this.req("POST", "/instance/create", {
      instanceName, integration: "WHATSAPP-BAILEYS", qrcode: false, groupsIgnore: true, syncFullHistory: false,
      alwaysOnline: false, readMessages: false, rejectCall: false,
      webhook: {
        enabled: true, url: this.webhookUrl, byEvents: false, base64: false,
        headers: { "x-webhook-secret": this.webhookSecret, "content-type": "application/json" },
        events: [...WEBHOOK_EVENTS],
      },
    });
  }

  private webhookConfig() {
    return { enabled: true, url: this.webhookUrl, byEvents: false, base64: false,
      headers: { "x-webhook-secret": this.webhookSecret, "content-type": "application/json" }, events: [...WEBHOOK_EVENTS] };
  }

  async syncWebhook(instanceName: string) {
    await this.req("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, { webhook: this.webhookConfig() });
  }

  async connect(instanceName: string): Promise<QrResult> {
    const st = await this.state(instanceName).catch(() => "desconectado" as ConnState);
    if (st === "conectado") return { status: "conectado" };
    const r = await this.req<{ base64?: string; code?: string }>("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
    if (!r?.base64) return { status: "erro", message: "A Evolution não devolveu o QR code. Tente gerar de novo." };
    return { status: "aguardando_qr", qrBase64: r.base64, code: r.code };
  }

  async state(instanceName: string): Promise<ConnState> {
    const r = await this.req<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const s = r?.instance?.state;
    return s === "open" ? "conectado" : s === "connecting" ? "aguardando_qr" : "desconectado";
  }

  /** Citação completa (chave + conteúdo): sem `message`, a Evolution procura no próprio banco e a citação some para mensagens do histórico. */
  private quotedPayload(toE164: string, q?: QuotedMessage) {
    if (!q) return {};
    return { quoted: { key: { id: q.externalId, remoteJid: `${toWhatsappNumber(toE164)}@s.whatsapp.net`, fromMe: q.fromMe }, message: { conversation: q.text } } };
  }

  async sendText(instanceName: string, toE164: string, text: string, quoted?: QuotedMessage) {
    const r = await this.req<{ key?: { id?: string } }>("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: toWhatsappNumber(toE164), text, delay: 0, linkPreview: true,
      ...this.quotedPayload(toE164, quoted),
    });
    return { externalId: r?.key?.id ?? null };
  }

  async sendMedia(instanceName: string, toE164: string, file: { name: string; mime: string; data: Buffer; mediatype: "image" | "video" | "document" }, caption: string | null, quoted?: QuotedMessage) {
    const r = await this.req<{ key?: { id?: string } }>("POST", `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      number: toWhatsappNumber(toE164), mediatype: file.mediatype, mimetype: file.mime, media: file.data.toString("base64"), fileName: file.name,
      // Sem legenda, o campo não vai: legenda "" faria o eco do WhatsApp não casar com a mensagem pendente.
      ...(caption ? { caption } : {}),
      ...this.quotedPayload(toE164, quoted),
    });
    return { externalId: r?.key?.id ?? null };
  }

  async sendAudio(instanceName: string, toE164: string, data: Buffer, quoted?: QuotedMessage) {
    const r = await this.req<{ key?: { id?: string } }>("POST", `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      number: toWhatsappNumber(toE164), audio: data.toString("base64"),
      ...this.quotedPayload(toE164, quoted),
    });
    return { externalId: r?.key?.id ?? null };
  }

  async markRead(instanceName: string, toE164: string, externalIds: string[]) {
    const remoteJid = `${toWhatsappNumber(toE164)}@s.whatsapp.net`;
    await this.req("POST", `/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
      readMessages: externalIds.map((id) => ({ remoteJid, fromMe: false, id })),
    });
  }

  async downloadMedia(instanceName: string, node: { key: Record<string, unknown>; message: Record<string, unknown> }) {
    const r = await this.req<{ base64?: string; mimetype?: string; fileName?: string }>("POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      { message: node, convertToMp4: false });
    if (!r?.base64) throw new ProviderError("A Evolution não devolveu a mídia.");
    return { base64: r.base64, mimetype: r.mimetype ?? null, fileName: r.fileName ?? null };
  }

  async profilePictureUrl(instanceName: string, toE164: string) {
    const r = await this.req<{ profilePictureUrl?: string | null }>("POST", `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, { number: toWhatsappNumber(toE164) });
    return r?.profilePictureUrl || null;
  }

  async logout(instanceName: string) { await this.req("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`); }
  async remove(instanceName: string) { await this.req("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`); }
}

let provider: WhatsAppProvider | null = null;
export function whatsapp(): WhatsAppProvider {
  if (provider) return provider;
  const e = env();
  provider = new EvolutionProvider(e.EVOLUTION_URL, e.EVOLUTION_API_KEY, `${e.WEBHOOK_PUBLIC_URL}/api/webhooks/evolution`, e.WEBHOOK_SECRET);
  return provider;
}
/** Só para testes. */
export function setWhatsappProvider(p: WhatsAppProvider | null) { provider = p; }
