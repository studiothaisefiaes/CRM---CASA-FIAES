/**
 * Escopos do tempo real. Cada aviso (`type`) mexe em certas partes do app; cada tela diz quais partes mostra
 * e só se atualiza quando um aviso toca nelas. Módulo puro: o servidor (emit, stream) e o navegador usam o mesmo mapa.
 *
 * Escopos: `queue` (Fila, Hoje, Funil, contatos), `deal:<id>` (um lead aberto), `alerts` (sino e avisos),
 * `channels` (canais de WhatsApp e banners), `reports` (Relatórios), `agenda` (Agenda, Caixa e app da profissional) e `caixa` (Caixa e comandas).
 */
import { isProOnly } from "./permissions";

export const GLOBAL_SCOPES = ["queue", "alerts", "channels", "reports", "agenda", "caixa"] as const;

export type LiveEventLike = { type: string; scope?: string | string[]; dealId?: string; deals?: unknown; [k: string]: unknown };

/** `<id>` vira o `dealId` do aviso. Quem não está no mapa cai no fail-open (todos os escopos). */
export const SCOPE_OF: Record<string, string[]> = {
  // mensagens, respostas e leads
  lead_criado: ["queue", "deal:<id>"],
  lead_atualizado: ["queue", "deal:<id>"],
  mensagem_recebida: ["queue", "deal:<id>"],
  mensagem_enviada: ["queue", "deal:<id>"],
  mensagem_enviando: ["queue", "deal:<id>"],
  mensagem_falhou: ["queue", "deal:<id>"],
  mensagem_atualizada: ["queue", "deal:<id>"],
  nota_criada: ["deal:<id>"],
  // "Fulana está escrevendo…" (colisão, 20/10): escopo próprio, para a conversa aberta não recarregar a cada tecla.
  escrevendo: ["escrevendo:<id>"],
  // sugestão de resposta por IA (gerada, usada, fechada): só a conversa aberta
  ia_sugestao: ["deal:<id>"],
  // abrir a conversa tira as "não lidas" da Fila (só a lista; a conversa aberta já está em dia)
  conversa_lida: ["queue"],
  agendada: ["queue", "deal:<id>"],
  status_mensagem: ["queue", "deal:<id>"],
  resposta: ["queue", "deal:<id>"],
  // venda e fechamento mexem nos números; fechar/arquivar também resolve avisos (sino)
  etapa_alterada: ["queue", "deal:<id>", "alerts", "reports"],
  venda: ["queue", "deal:<id>", "alerts", "reports"],
  fechamento: ["queue", "deal:<id>", "alerts", "reports"],
  lead_arquivado: ["queue", "deal:<id>", "alerts", "reports"],
  lead_restaurado: ["queue", "deal:<id>", "alerts", "reports"],
  historico_importado: ["queue", "reports"],
  // motor de regras: cria avisos e tarefas (`deals` = leads tocados)
  regras: ["alerts", "queue", "deal:<id>"],
  alerta: ["alerts"],
  // canais
  canal_atualizado: ["channels"],
  // equipe: quem está disponível, em pausa ou ausente (distribuição)
  equipe_atualizada: ["team"],
  // agenda (Lote 6B): marcar, remarcar, cancelar, status, lista de espera e bloqueios; `day` diz o dia tocado
  agenda_alterada: ["agenda"],
  // caixa (Lote 6C): comanda aberta, item, pagamento, fechamento e caixa do dia; a Agenda mostra o selo R$ e o "falta fechar"
  caixa_alterado: ["agenda", "caixa"],
};

/** Escopos que um aviso toca. Tipo desconhecido: todos (a tela nunca fica velha por falta de mapa). */
export function scopesOf(e: LiveEventLike): string[] {
  const map = SCOPE_OF[e.type];
  const ids = new Set<string>();
  if (typeof e.dealId === "string" && e.dealId) ids.add(e.dealId);
  if (Array.isArray(e.deals)) for (const d of e.deals) if (typeof d === "string" && d) ids.add(d);
  if (!map) return [...GLOBAL_SCOPES, ...[...ids].map((id) => `deal:${id}`)];
  const out: string[] = [];
  for (const s of map) {
    if (s.endsWith(":<id>")) { const prefix = s.slice(0, -"<id>".length); for (const id of ids) out.push(`${prefix}${id}`); } else out.push(s);
  }
  return out;
}

function declared(e: LiveEventLike): string[] | null {
  const s = e.scope;
  if (typeof s === "string" && s) return [s];
  if (Array.isArray(s) && s.length && s.every((x) => typeof x === "string")) return s as string[];
  return null;
}

/** A tela que mostra `scopes` deve se atualizar com este aviso? */
export function shouldRefresh(e: LiveEventLike, scopes: string[]): boolean {
  if (!scopes.length) return false;
  if (!declared(e) && !(e.type in SCOPE_OF)) return true; // fail-open: tipo que o mapa não conhece
  const touched = declared(e) ?? scopesOf(e);
  return touched.some((s) => scopes.includes(s));
}

/**
 * Junta uma rajada de chamadas numa só, `ms` depois da última. Com `maxWait`, um fluxo contínuo não adia para sempre:
 * a chamada sai no máximo `maxWait` depois da primeira da rajada. `cancel` descarta a pendente.
 */
export function coalesce(fn: () => void, ms: number, maxWait?: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstAt = 0;
  const call = () => {
    const now = Date.now();
    if (timer === undefined) firstAt = now;
    clearTimeout(timer);
    const wait = maxWait === undefined ? ms : Math.max(0, Math.min(ms, firstAt + maxWait - now));
    timer = setTimeout(() => { timer = undefined; fn(); }, wait);
  };
  call.cancel = () => { clearTimeout(timer); timer = undefined; };
  return call;
}

/** Garante o escopo no aviso (um NOTIFY direto no banco, sem `emit`, também é roteado). Fora do formato: repassa como veio. */
export function withScope(payload: string): string {
  try {
    const e = JSON.parse(payload);
    if (!e || typeof e !== "object" || typeof e.type !== "string") return payload;
    if (Array.isArray(e.scope) || typeof e.scope === "string") return payload;
    return JSON.stringify({ ...e, scope: scopesOf(e) });
  } catch { return payload; }
}

/**
 * O que cada pessoa recebe no tempo real. Quem só tem o app da profissional recebe só "a agenda mudou", sem dados:
 * a tela recarrega com as permissões dela (seção 8.6). Os demais recebem o aviso como sempre.
 */
export function viewerEvent(payload: string, perms: readonly string[]): string | null {
  const scoped = withScope(payload);
  if (!isProOnly(perms)) return scoped;
  try {
    const e = JSON.parse(scoped) as { scope?: unknown };
    return Array.isArray(e?.scope) && e.scope.includes("agenda") ? JSON.stringify({ type: "agenda_alterada", scope: ["agenda"] }) : null;
  } catch { return null; }
}
