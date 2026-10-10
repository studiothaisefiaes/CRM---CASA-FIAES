/**
 * Escopos do tempo real. Cada aviso (`type`) mexe em certas partes do app; cada tela diz quais partes mostra
 * e só se atualiza quando um aviso toca nelas. Módulo puro: o servidor (emit, stream) e o navegador usam o mesmo mapa.
 *
 * Escopos: `queue` (Fila, Hoje, Funil, contatos), `deal:<id>` (um lead aberto), `alerts` (sino e avisos),
 * `channels` (canais de WhatsApp e banners) e `reports` (Relatórios).
 */
export const GLOBAL_SCOPES = ["queue", "alerts", "channels", "reports"] as const;

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
    if (s === "deal:<id>") { for (const id of ids) out.push(`deal:${id}`); } else out.push(s);
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

/** Junta uma rajada de chamadas numa só, `ms` depois da última. `cancel` descarta a pendente. */
export function coalesce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = () => { clearTimeout(timer); timer = setTimeout(() => { timer = undefined; fn(); }, ms); };
  call.cancel = () => { clearTimeout(timer); timer = undefined; };
  return call;
}
