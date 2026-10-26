/** Marca de "já respondeu ao convite de avisos" neste navegador. */
export const OPTIN_KEY = "cf-push-optin";

export const rememberPushOptIn = () => { try { localStorage.setItem(OPTIN_KEY, "1"); } catch { /* sem storage */ } };
export const pushOptInRemembered = () => { try { return localStorage.getItem(OPTIN_KEY) === "1"; } catch { return false; } };
/** Ao sair: o próximo usuário deste aparelho volta a ver o convite. */
export const forgetPushOptIn = () => { try { localStorage.removeItem(OPTIN_KEY); } catch { /* sem storage */ } };

/** Chave VAPID (base64url) no formato que o `pushManager.subscribe` aceita. */
export function keyBytes(b64url: string) {
  const b64 = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushSub = { endpoint: string; toJSON: () => { keys?: Record<string, string | undefined> } };
type Registration = {
  pushManager: {
    getSubscription: () => Promise<PushSub | null>;
    subscribe: (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }) => Promise<PushSub>;
  };
};
export type SavedSubscription = { endpoint: string; p256dh: string; auth: string };

/** Garante a inscrição de push deste aparelho e a salva para quem está logado. Lança se o navegador ou o servidor recusar. */
export async function subscribeAndSave<R extends { ok: boolean }>(reg: Registration, publicKey: string, save: (s: SavedSubscription) => Promise<R>): Promise<R> {
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON();
  return save({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" });
}

/**
 * Sair apaga a inscrição deste aparelho, mas a permissão do navegador continua "concedida" e o convite não aparece mais.
 * Ao abrir o app com a permissão já concedida, refaz a inscrição em silêncio para o usuário atual.
 * Sem chave VAPID ou sem service worker registrado não faz nada. Nunca lança.
 */
export async function resubscribeIfGranted(opts: {
  permission: NotificationPermission; publicKey: string;
  getRegistration: () => Promise<Registration | undefined>;
  save: (s: SavedSubscription) => Promise<{ ok: boolean }>;
}): Promise<"skipped" | "saved" | "failed"> {
  if (opts.permission !== "granted" || !opts.publicKey) return "skipped";
  try {
    const reg = await opts.getRegistration();
    if (!reg?.pushManager) return "skipped";
    return (await subscribeAndSave(reg, opts.publicKey, opts.save)).ok ? "saved" : "failed";
  } catch {
    return "failed";
  }
}

type Notice = { title: string; body: string; url: string; tag: string };
/**
 * "A cliente escreveu" na tela de cada pessoa da equipe (Cati 24/10: só a dona recebia): mostra a notificação do sistema quando
 * a janela do CRM não está em foco (Avec na frente, aba escondida). Com o push ativo neste aparelho o service worker já mostra:
 * a tela não repete. Nunca lança.
 */
export async function showClientNotice(n: Notice, deps: { permission: string; focused: boolean; hasPush: () => Promise<boolean>; show: (n: Notice) => void }): Promise<boolean> {
  if (deps.permission !== "granted" || deps.focused) return false;
  try {
    if (await deps.hasPush()) return false;
    deps.show(n);
    return true;
  } catch {
    return false;
  }
}
