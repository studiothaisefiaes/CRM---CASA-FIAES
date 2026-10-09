import { env } from "../env";
import { toWhatsappNumber } from "../domain/phone";
import { ProviderError, type ConnState, type QrResult, type WhatsAppProvider } from "./provider";

export const WEBHOOK_EVENTS = ["QRCODE_UPDATED", "MESSAGES_UPSERT", "SEND_MESSAGE", "CONNECTION_UPDATE"] as const;

export class EvolutionProvider implements WhatsAppProvider {
  constructor(private baseUrl: string, private apiKey: string, private webhookUrl: string, private webhookSecret: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method, headers: { apikey: this.apiKey, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000), cache: "no-store",
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

  async sendText(instanceName: string, toE164: string, text: string) {
    const r = await this.req<{ key?: { id?: string } }>("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number: toWhatsappNumber(toE164), text, delay: 0, linkPreview: true,
    });
    return { externalId: r?.key?.id ?? null };
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
