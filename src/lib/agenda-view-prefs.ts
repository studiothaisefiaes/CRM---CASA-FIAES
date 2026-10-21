import { z } from "zod";
import { PREFERENCE_FILTERS, type PreferenceFilter } from "./appointment-preference";

/**
 * Agenda › Dia "do seu jeito" (nova agenda, 16/10): o que cada pessoa escolhe em Personalizar fica numa visão; "Salvar como visão" cria
 * outra com nome, que vira uma aba pequena em cima da grade. Tudo por usuário (tabela user_preferences, chave "agenda"). Funções puras.
 */
export const CARD_SIZES = ["compacto", "conforto", "grande"] as const;
export type CardSize = (typeof CARD_SIZES)[number];
export const CARD_SIZE_LABEL: Record<CardSize, string> = { compacto: "Compacto", conforto: "Confortável", grande: "Grande" };
/** Pixels por minuto de cada tamanho. */
export const PX_PER_MIN: Record<CardSize, number> = { compacto: 1.1, conforto: 1.5, grande: 2.2 };
export const GRID_STEPS = [15, 30, 60] as const;
export type GridStep = (typeof GRID_STEPS)[number];

export const CARD_FIELDS = ["serv", "tel", "valor", "pref", "obs"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
export const CARD_FIELD_LABEL: Record<CardField, string> = { serv: "Serviço", tel: "Telefone", valor: "Valor", pref: "Preferência pela profissional", obs: "Observação" };
export const GRID_FLAGS = ["livres", "ocup", "bloq", "legenda"] as const;
export type GridFlag = (typeof GRID_FLAGS)[number];
export const GRID_FLAG_LABEL: Record<GridFlag, string> = { livres: "Mostrar horários livres", ocup: "Mostrar ocupação de cada uma", bloq: "Mostrar almoço, bloqueio e folga", legenda: "Mostrar a legenda das cores" };

export type AgendaViewCfg = {
  /** Ordem das colunas (ids das profissionais); quem não está aqui entra no fim, na ordem do cadastro. */ ordem: string[];
  /** Quem não aparece nesta visão. */ ocultas: string[];
  tam: CardSize; passo: GridStep;
  /** Horário visível em minutos do dia; null = o horário da Casa no dia. */ ini: number | null; fim: number | null;
  card: Record<CardField, boolean>;
  livres: boolean; ocup: boolean; bloq: boolean; legenda: boolean;
  /** Filtro escondido da preferência (6.11): saiu do alto da tela. null = todas. */ pref: PreferenceFilter | null;
};
export type SavedView = { id: string; nome: string; cfg: AgendaViewCfg; /** Quem estava aparecendo ao salvar ([] = todas). */ sel: string[] };
export type AgendaPrefs = { visoes: SavedView[]; ativa: string };

export const DEFAULT_VIEW_ID = "padrao";
export const MAX_VIEWS = 12;
export const DEFAULT_CFG: AgendaViewCfg = {
  ordem: [], ocultas: [], tam: "conforto", passo: 30, ini: null, fim: null,
  card: { serv: false, tel: false, valor: false, pref: false, obs: false },
  livres: false, ocup: false, bloq: true, legenda: true, pref: null, // legenda ligada por padrão (17/10: "o que é o verde?")
};
export const defaultPrefs = (): AgendaPrefs => ({ visoes: [{ id: DEFAULT_VIEW_ID, nome: "Padrão", cfg: DEFAULT_CFG, sel: [] }], ativa: DEFAULT_VIEW_ID });

const ids = z.array(z.string().max(64)).max(200);
const minute = z.number().int().min(0).max(1440).nullable();
const cfgSchema = z.object({
  ordem: ids.catch([]), ocultas: ids.catch([]),
  tam: z.enum(CARD_SIZES).catch("conforto"),
  passo: z.union([z.literal(15), z.literal(30), z.literal(60)]).catch(30),
  ini: minute.catch(null), fim: minute.catch(null),
  card: z.object(Object.fromEntries(CARD_FIELDS.map((k) => [k, z.boolean().catch(false)])) as Record<CardField, z.ZodCatch<z.ZodBoolean>>).catch(DEFAULT_CFG.card),
  livres: z.boolean().catch(false), ocup: z.boolean().catch(false), bloq: z.boolean().catch(true), legenda: z.boolean().catch(true),
  pref: z.enum(PREFERENCE_FILTERS.map((f) => f.value) as [PreferenceFilter, ...PreferenceFilter[]]).nullable().catch(null),
});
const viewSchema = z.object({ id: z.string().min(1).max(40), nome: z.string().trim().min(1).max(40), cfg: cfgSchema, sel: ids.catch([]) });
/** O que a tela manda para salvar: validado e com teto (nunca guarda lixo nem um JSON enorme). */
export const prefsSchema = z.object({ visoes: z.array(viewSchema).min(1).max(MAX_VIEWS), ativa: z.string().max(40) });

/** Lê o que está gravado (pode ser de uma versão antiga ou estar vazio): sempre devolve preferências válidas, com a visão Padrão. */
export function normalizePrefs(raw: unknown): AgendaPrefs {
  const r = prefsSchema.safeParse(raw);
  if (!r.success) return defaultPrefs();
  const visoes = r.data.visoes.filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i);
  if (!visoes.some((v) => v.id === DEFAULT_VIEW_ID)) visoes.unshift(defaultPrefs().visoes[0]);
  const fixed = visoes.map((v) => ({ ...v, cfg: fixRange(v.cfg) }));
  return { visoes: fixed, ativa: fixed.some((v) => v.id === r.data.ativa) ? r.data.ativa : DEFAULT_VIEW_ID };
}

/** Horário visível sem sentido (fim antes do início, menos de 1 h) volta para o horário da Casa. */
function fixRange(c: AgendaViewCfg): AgendaViewCfg {
  if (c.ini == null || c.fim == null) return { ...c, ini: null, fim: null };
  return c.fim - c.ini >= 60 ? c : { ...c, ini: null, fim: null };
}

export const activeView = (p: AgendaPrefs): SavedView => p.visoes.find((v) => v.id === p.ativa) ?? p.visoes[0];

/** Muda a visão ativa (o que se mexe em Personalizar vale para a visão aberta, como no protótipo aprovado). */
export function patchActive(p: AgendaPrefs, patch: Partial<AgendaViewCfg>): AgendaPrefs {
  const a = activeView(p);
  return { ...p, visoes: p.visoes.map((v) => (v.id === a.id ? { ...v, cfg: fixRange({ ...v.cfg, ...patch }) } : v)) };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "visao";

/**
 * "Salvar como visão": com o mesmo nome (sem acento/maiúscula) atualiza a que existe; senão cria uma nova e ela vira a ativa.
 * Devolve também o que aconteceu, para o aviso da tela.
 */
export function saveAsView(p: AgendaPrefs, nome: string, cfg: AgendaViewCfg, sel: string[]): { prefs: AgendaPrefs; result: "criada" | "atualizada" | "nome_vazio" | "limite"; view?: SavedView } {
  const n = nome.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!n) return { prefs: p, result: "nome_vazio" };
  const same = p.visoes.find((v) => fold(v.nome) === fold(n));
  if (same) {
    const view = { ...same, cfg, sel: [...sel] };
    return { prefs: { visoes: p.visoes.map((v) => (v.id === same.id ? view : v)), ativa: same.id }, result: "atualizada", view };
  }
  if (p.visoes.length >= MAX_VIEWS) return { prefs: p, result: "limite" };
  let id = slug(n);
  for (let k = 2; p.visoes.some((v) => v.id === id) || id === DEFAULT_VIEW_ID; k++) id = `${slug(n)}-${k}`;
  const view = { id, nome: n, cfg, sel: [...sel] };
  return { prefs: { visoes: [...p.visoes, view], ativa: id }, result: "criada", view };
}

/** Apagar uma visão (a Padrão nunca sai); se era a ativa, volta para a Padrão. */
export function deleteView(p: AgendaPrefs, id: string): AgendaPrefs {
  if (id === DEFAULT_VIEW_ID) return p;
  return { visoes: p.visoes.filter((v) => v.id !== id), ativa: p.ativa === id ? DEFAULT_VIEW_ID : p.ativa };
}

/** As profissionais na ordem da visão: as da ordem salva primeiro (se ainda existem), depois as outras na ordem do cadastro. */
export function orderedIds(cfg: AgendaViewCfg, all: readonly string[]): string[] {
  const set = new Set(all);
  const head = cfg.ordem.filter((id, i) => set.has(id) && cfg.ordem.indexOf(id) === i);
  return [...head, ...all.filter((id) => !head.includes(id))];
}
/** Quem aparece na fileira de fotos (ordem da visão, sem as ocultas). */
export const visibleIds = (cfg: AgendaViewCfg, all: readonly string[]) => orderedIds(cfg, all).filter((id) => !cfg.ocultas.includes(id));

/** Sobe/desce uma profissional na ordem (setas de Personalizar) ou a põe antes de outra (arrastar pela alça). */
export function moveInOrder(cfg: AgendaViewCfg, all: readonly string[], id: string, to: number | { before: string }): string[] {
  const list = orderedIds(cfg, all).filter((x) => x !== id);
  const at = typeof to === "number" ? Math.max(0, Math.min(list.length, to)) : Math.max(0, list.indexOf(to.before));
  list.splice(at, 0, id);
  return list;
}

/**
 * Tocar numa foto: sem "Juntar" (nem Shift/⌘), mostra só ela (tocar de novo volta para todas). Com "Juntar", põe ou tira do lado a lado.
 */
export function clickPro(sel: readonly string[], id: string, multi: boolean): string[] {
  if (multi) return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
  return sel.length === 1 && sel[0] === id ? [] : [id];
}

/** O horário visível da visão: o salvo, senão o da Casa (arredondado à hora), dentro de 0h–24h. */
export function visibleRange(cfg: AgendaViewCfg, casa: { start: number; end: number } | null): { start: number; end: number } {
  if (cfg.ini != null && cfg.fim != null) return { start: cfg.ini, end: cfg.fim };
  if (!casa || casa.end - casa.start >= 20 * 60) return { start: 7 * 60, end: 21 * 60 }; // Casa sem horário ou "24 h": o dia útil
  return { start: Math.floor(casa.start / 60) * 60, end: Math.ceil(casa.end / 60) * 60 };
}
/** Os botões − e + do horário visível: passo de 30 min, pelo menos 2 h na tela. */
export function stepRange(r: { start: number; end: number }, edge: "ini" | "fim", delta: -30 | 30): { ini: number; fim: number } {
  let { start, end } = r;
  if (edge === "ini") start = Math.max(0, Math.min(end - 120, start + delta));
  else end = Math.min(1440, Math.max(start + 120, end + delta));
  return { ini: start, fim: end };
}
