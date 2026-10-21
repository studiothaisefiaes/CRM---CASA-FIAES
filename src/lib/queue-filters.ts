import { parseDias, parseEtiquetaRegra, queueHref, type QueueParams } from "./queue";
import { FILTER_LABEL, parseQueueFilter } from "./report-links";

/**
 * O topo da Fila (desenho aprovado): só três abas (Todas, Não lidas, Encerradas); o resto mora no botão "Filtros"
 * e, ligado, aparece como chip com ✕ embaixo da busca. Módulo puro (servidor e navegador).
 */
export const QUEUE_TABS = ["todas", "esperando", "nao-lidas", "retomar", "resolvidas"] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];
/** "Para retomar" (20/10): a Casa já respondeu e combinou de voltar a falar numa data; a conversa não some como as Resolvidas e fica com o lembrete à parte. */
/** "Esperando" (20/10): só quem espera a Casa responder, a mais antiga primeiro (a Todas segue a ordem do WhatsApp). */
export const TAB_LABEL: Record<QueueTab, string> = { todas: "Todas", esperando: "Esperando", "nao-lidas": "Não lidas", retomar: "Para retomar", resolvidas: "Resolvidas" };

export function queueTab(p: QueueParams): QueueTab {
  if (p.view === "arquivadas" || p.view === "resolvidas" || p.view === "encerradas") return "resolvidas";
  if (p.foco === "retomar") return "retomar";
  if (p.foco === "aguardando") return "esperando";
  return p.aba === "nao-lidas" ? "nao-lidas" : "todas";
}

/** Sem nenhum parâmetro a Fila volta aos filtros da última vez (QueueRestore): "view=todos" segura a lista pedida. */
const hrefOf = (p: QueueParams) => {
  const h = queueHref(p);
  return h === "/atendimento" ? "/atendimento?view=todos" : h;
};
// Listas à parte (Encerradas, Equipe, Não é cliente) não passam para as outras abas.
const open = (view: string | null | undefined) => (view === "arquivadas" || view === "resolvidas" || view === "encerradas" || view === "todos" || view === "equipe" || view === "fornecedores" || view === "nao-cliente" ? null : view ?? null);

export function tabHref(tab: QueueTab, p: QueueParams): string {
  if (tab === "resolvidas") return hrefOf({ view: "arquivadas", etiqueta: p.etiqueta, q: p.q });
  if (tab === "retomar" || tab === "esperando") return hrefOf({ ...p, lead: null, view: open(p.view), aba: null, foco: tab === "retomar" ? "retomar" : "aguardando" });
  return hrefOf({ ...p, lead: null, view: open(p.view), aba: tab === "nao-lidas" ? "nao-lidas" : null, foco: p.foco === "retomar" || p.foco === "aguardando" ? null : p.foco });
}

/** O nome curto de cada visão e de cada foco no chip (e no painel Filtros). */
export const VIEW_CHIP: Record<string, string> = {
  meus: "Minhas", "sem-dono": "Sem dono", parados: "Parados", "agendados-hoje": "Horários hoje", "clientes-ativos": "Clientes ativos", "sem-contato-90d": "Sem contato há 90 dias",
  equipe: "Equipe", fornecedores: "Fornecedores", "nao-cliente": "Spam",
};

/** Equipe (números de funcionárias) e "Não é cliente": listas fora do funil, no painel Filtros; a Equipe acende embaixo das abas quando tem mensagem nova. */
export const OUTSIDE_VIEWS = ["equipe", "fornecedores", "nao-cliente"] as const;
export const equipeHref = (p: QueueParams) => hrefOf({ view: "equipe", q: p.q });
export const FOCO_CHIP: Record<string, string> = { aguardando: "Esperando", atrasados: "Atrasados", combinados: "Combinados vencidos", reclamacao: "Reclamações", evento: "Eventos/noivas", retomar: "Para retomar" };

export type FilterChip = { key: keyof QueueParams; label: string; href: string };

/**
 * Os filtros ligados, na ordem da URL, cada um com o link que tira só ele. Abas e busca não são chips (têm lugar próprio).
 * `names`: o nome legível da etapa, da dona e da etiqueta (o que a URL traz é a chave/id).
 */
export function activeFilters(p: QueueParams, names: { etapa?: string | null; dono?: string | null; etiqueta?: string | null; /** Nomes das etiquetas de `etiquetas`, na mesma ordem (id sem nome = removida). */ etiquetas?: (string | null)[] }, opts: { onlyOwn?: boolean } = {}): FilterChip[] {
  const without = (k: keyof QueueParams) => hrefOf({ ...p, lead: null, [k]: null });
  const out: FilterChip[] = [];
  if (p.view && VIEW_CHIP[p.view]) out.push({ key: "view", label: VIEW_CHIP[p.view], href: without("view") });
  if (p.foco && FOCO_CHIP[p.foco]) out.push({ key: "foco", label: FOCO_CHIP[p.foco], href: without("foco") });
  const filtro = parseQueueFilter(p.filtro);
  if (filtro) out.push({ key: "filtro", label: `${FILTER_LABEL[filtro]}${opts.onlyOwn ? " (só as suas)" : ""}`, href: without("filtro") });
  if (p.etapa) out.push({ key: "etapa", label: `Etapa: ${names.etapa ?? p.etapa}`, href: without("etapa") });
  if (p.dono === "sem") out.push({ key: "dono", label: "Sem dona", href: without("dono") });
  else if (p.dono) out.push({ key: "dono", label: `Dona: ${names.dono ?? "outra pessoa"}`, href: without("dono") });
  if (p.fonte) out.push({ key: "fonte", label: `Origem: ${p.fonte}`, href: without("fonte") });
  if (p.etiqueta) out.push({ key: "etiqueta", label: `Etiqueta: ${names.etiqueta ?? "removida"}`, href: without("etiqueta") });
  const many = (p.etiquetas ?? "").split(",").filter(Boolean);
  if (many.length) {
    const list = many.map((id, i) => names.etiquetas?.[i] ?? "removida").join(", ");
    const regra = parseEtiquetaRegra(p.regra);
    out.push({ key: "etiquetas", label: regra === "nao_tem" ? `Sem as etiquetas: ${list}` : `Etiquetas: ${list} (${regra === "todas" ? "todas" : "qualquer"})`, href: hrefOf({ ...p, lead: null, etiquetas: null, regra: null }) });
  }
  const dias = parseDias(p.dias);
  if (dias) out.push({ key: "dias", label: `${dias} ${dias === 1 ? "dia" : "dias"} sem conversar`, href: without("dias") });
  return out;
}
