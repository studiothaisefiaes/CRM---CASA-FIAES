import { isUuid } from "./uuid";

/** Filtros, ordenação e a URL da lista de Contatos (Lote 2). Puro: a página, o CSV e o servidor leem a URL do mesmo jeito. */
export const CONTACT_FILTERS = ["sumidas", "na_hora", "aniversario_semana", "aniversario_mes", "com_pacote", "com_horario", "sem_dono", "nunca_voltou", "vip", "faltosas"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];
export const CONTACT_FILTER_LABEL: Record<ContactFilter, string> = {
  sumidas: "Sumidas", na_hora: "Hora de voltar", aniversario_semana: "Aniversário na semana", aniversario_mes: "Aniversário no mês",
  com_pacote: "Com pacote", com_horario: "Com horário", sem_dono: "Sem dono", nunca_voltou: "Nunca voltou", vip: "VIP", faltosas: "Faltosas",
};
export const CONTACT_FILTER_HELP: Record<ContactFilter, string> = {
  sumidas: "Passou de 1,5 vez o ritmo dela sem voltar, sem horário marcado e há menos de 1 ano.",
  na_hora: "Está entre 0,8 e 1,5 vez o ritmo dela desde a última visita e não tem horário marcado.",
  aniversario_semana: "Faz aniversário hoje ou nos próximos 7 dias.",
  aniversario_mes: "Faz aniversário neste mês.",
  com_pacote: "Tem pacote com sessão sobrando e dentro da validade.",
  com_horario: "Tem horário marcado nos próximos 180 dias.",
  sem_dono: "Tem conversa aberta e ninguém assumiu.",
  nunca_voltou: "Veio uma vez só.",
  vip: "12 visitas ou mais, ou entre as 10% que mais gastaram.",
  faltosas: "Faltou 2 vezes ou mais.",
};
export const CONTACT_SORTS = ["chegada", "ultima_visita", "visitas", "nome"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];
export const CONTACT_SORT_LABEL: Record<ContactSort, string> = { chegada: "Chegada no CRM", ultima_visita: "Última visita", visitas: "Mais visitas", nome: "Nome" };

/** Abas do topo de Clientes (pedido do dono, 15/10): Todas · Método Fiaes · Serviços gerais. null = Todas. */
export const CONTACT_TABS = ["metodo", "gerais"] as const;
export type ContactTab = (typeof CONTACT_TABS)[number];
export const CONTACT_TAB_LABEL: Record<"todas" | ContactTab, string> = { todas: "Todas", metodo: "Método Fiaes®", gerais: "Serviços gerais" };

export type ContactListParams = {
  q: string; tab: ContactTab | null; onlyClients: boolean; includeIgnored: boolean; page: number;
  filter: ContactFilter | null; professionalId: string | null; service: string | null; tagId: string | null; origin: string | null; sort: ContactSort | null;
};

const one = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends string>(list: readonly T[], v: string): T | null => ((list as readonly string[]).includes(v) ? (v as T) : null);
const text = (v: string, max = 80) => v.trim().slice(0, max) || null;

export function parseContactListParams(sp: URLSearchParams | Record<string, string | string[] | undefined>): ContactListParams {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) ?? "" : one(sp[k]));
  const page = Math.floor(Number(get("p")));
  return {
    q: get("q").trim().slice(0, 80), tab: pick(CONTACT_TABS, get("aba")), onlyClients: get("clientes") === "1", includeIgnored: get("ignorados") === "1", page: page >= 1 ? page : 1,
    filter: pick(CONTACT_FILTERS, get("f")), sort: pick(CONTACT_SORTS, get("ordem")),
    professionalId: isUuid(get("pro")) ? get("pro") : null, tagId: isUuid(get("tag")) ? get("tag") : null,
    service: text(get("svc")), origin: text(get("origem")),
  };
}

/** O `?…` da lista com os mesmos parâmetros (mais as trocas de `over`); página 1 e vazios não entram. */
export function contactListQuery(p: ContactListParams, over: Partial<ContactListParams> = {}): string {
  const v = { ...p, ...over };
  const s = new URLSearchParams();
  if (v.q) s.set("q", v.q);
  if (v.tab) s.set("aba", v.tab);
  if (v.onlyClients) s.set("clientes", "1");
  if (v.includeIgnored) s.set("ignorados", "1");
  if (v.filter) s.set("f", v.filter);
  if (v.professionalId) s.set("pro", v.professionalId);
  if (v.service) s.set("svc", v.service);
  if (v.tagId) s.set("tag", v.tagId);
  if (v.origin) s.set("origem", v.origin);
  if (v.sort) s.set("ordem", v.sort);
  if (v.page > 1) s.set("p", String(v.page));
  return s.size ? `?${s}` : "";
}
