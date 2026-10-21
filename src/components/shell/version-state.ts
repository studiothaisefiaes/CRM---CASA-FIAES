import { DEV_BUILD, isVersionSkewError, NEW_VERSION_TEXT } from "@/lib/version-skew";

/**
 * A versão do CRM que esta aba carregou x a do servidor (20/10, Cati: atualização derrubava a tela). Um estado só por aba, fora do React:
 * o `VersionWatch` pergunta de tempos em tempos, o tempo real (`LiveProvider`) pergunta antes de recarregar e a caixa de mensagem avisa
 * quando o envio falha por versão. Sabendo da versão nova, o aviso "Versão nova do CRM. Atualizar" aparece e nada recarrega sozinho.
 */
export type VersionStatus = "igual" | "nova" | "falhou";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

let loaded: string | null = null;
let stale = false;
let inflight: Promise<VersionStatus> | null = null;
let last: { at: number; status: VersionStatus } | null = null;
const listeners = new Set<() => void>();

/** A versão que veio com a página. Só a primeira vale: um refresh que já veio do servidor novo não pode esconder a troca. */
export function setLoadedVersion(id: string): void { loaded ??= id; }
export const newVersionKnown = () => stale;

/** Sabe-se que há versão nova (pela pergunta ou porque uma ação falhou por versão): avisa uma vez. */
export function announceNewVersion(): void {
  if (stale) return;
  stale = true;
  listeners.forEach((l) => l());
}
export function onNewVersion(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Pergunta ao servidor a versão dele (`/api/versao`). Pedidos juntos viram um só; `maxAgeMs` aceita a resposta recente.
 * "falhou": servidor fora do ar (reiniciando na troca de versão), sessão vencida (o proxy manda para o login) ou resposta estranha.
 */
export function checkVersion(o: { fetcher?: Fetcher; maxAgeMs?: number; now?: () => number } = {}): Promise<VersionStatus> {
  if (stale) return Promise.resolve("nova");
  if (!loaded || loaded === DEV_BUILD) return Promise.resolve("igual");
  const now = o.now ?? Date.now;
  if (o.maxAgeMs && last && last.status === "igual" && now() - last.at <= o.maxAgeMs) return Promise.resolve(last.status);
  if (inflight) return inflight;
  const fetcher = o.fetcher ?? ((url, init) => fetch(url, init));
  const mine = loaded;
  inflight = (async (): Promise<VersionStatus> => {
    try {
      const r = await fetcher("/api/versao", { cache: "no-store", redirect: "manual", headers: { accept: "application/json" } });
      if (!r.ok) return "falhou";
      const v = ((await r.json()) as { versao?: unknown } | null)?.versao;
      if (typeof v !== "string" || !v) return "falhou";
      if (v !== mine && v !== DEV_BUILD) { announceNewVersion(); return "nova"; }
      return "igual";
    } catch { return "falhou"; }
  })().then((status) => { last = { at: now(), status }; inflight = null; return status; });
  return inflight;
}

/** Só testes. */
export function resetVersionState(): void { loaded = null; stale = false; inflight = null; last = null; listeners.clear(); }

/**
 * Para quem chama uma ação e trata o erro (caixa de mensagem): erro de versão vira o aviso e um resultado "não deu" com o texto certo
 * (quem chama devolve o texto ao campo). Outro erro segue adiante.
 */
export function versionFailure(e: unknown): { ok: false; error: string } {
  if (!isVersionSkewError(e)) throw e;
  announceNewVersion();
  return { ok: false, error: NEW_VERSION_TEXT.enviar };
}
