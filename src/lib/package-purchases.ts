/**
 * Uma COMPRA de pacote a partir das linhas de `client_packages`. O Avec (e a comanda do CRM) grava uma linha por serviço do pacote:
 * o "Combo Manutenção Método Fiaes" vira 2 a 4 linhas com o mesmo nome, data de compra, preço e validade, uma para cada serviço.
 * Na tela isso é UM pacote: nome, preço uma vez, validade e, dentro, o uso de cada serviço. Só desenho: o banco fica como veio.
 *
 * Mesma compra = mesma cliente (contato; sem contato, o nome) + mesmo nome de pacote (normalizado) + mesma data de compra + mesmo preço
 * + mesma validade. Sem data de compra a linha fica sozinha (não dá para saber se é a mesma venda). Pacote com outro nome ou comprado
 * em outro dia continua separado.
 */
import { normText } from "@/server/domain/avec/normalize";

export type PackageRowLike = {
  id: string; contactId: string | null; clientName: string | null; packageName: string; serviceLabel: string | null;
  totalSessions: number; usedSessions: number; priceCents: number | null; purchasedOn: string | null; validUntil: string | null;
};
export type PurchaseService = { id: string; label: string; usedSessions: number; totalSessions: number };
export type PackagePurchase<R extends PackageRowLike = PackageRowLike> = {
  /** O id da primeira linha (estável para chave de lista e para ligar as sessões usadas). */ id: string;
  rowIds: string[]; rows: R[]; contactId: string | null; clientName: string | null; packageName: string;
  priceCents: number | null; purchasedOn: string | null; validUntil: string | null;
  /**
   * As sessões da COMPRA: total = o maior total entre os serviços; usadas = o maior "usado" entre eles. Cada ida da cliente gasta
   * uma sessão de cada serviço que ela faz naquele dia, então o serviço mais usado é o que conta as idas (somar contaria a mesma
   * ida 2 a 4 vezes). É o que a barra, o selo "Pacote: X de Y", os filtros Acabando/Vencem e a frase da conversa usam.
   */
  totalSessions: number; usedSessions: number;
  services: PurchaseService[];
};

const SMALL = new Set(["de", "da", "do", "das", "dos", "e", "com", "em", "a", "o"]);
/** Os acentos que o Avec perdeu nos nomes de serviço/pacote. */
const ACCENTS: Record<string, string> = {
  metodo: "método", manutencao: "manutenção", aplicacao: "aplicação", coloracao: "coloração", finalizacao: "finalização",
  sessao: "sessão", sessoes: "sessões", confeccao: "confecção", confecao: "confeção", hidratacao: "hidratação", reconstrucao: "reconstrução",
};

/** Nome de serviço em Título: "Sessão de pacote metodo" → "Sessão de Pacote Método" (partículas minúsculas, acento de volta). */
export function serviceTitle(label: string): string {
  return label.trim().split(/\s+/).filter(Boolean).map((w, i) => {
    const low = w.toLocaleLowerCase("pt-BR");
    const fixed = low === normText(low) ? ACCENTS[low] ?? low : low;
    return i > 0 && SMALL.has(fixed) ? fixed : fixed.charAt(0).toLocaleUpperCase("pt-BR") + fixed.slice(1);
  }).join(" ");
}

const keyOf = (r: PackageRowLike) => r.purchasedOn
  ? [r.contactId ?? `nome:${normText(r.clientName)}`, normText(r.packageName), r.purchasedOn, r.priceCents ?? "", r.validUntil ?? ""].join("|")
  : `linha:${r.id}`;

/** Junta as linhas de cada compra, na ordem em que a primeira linha de cada uma aparece. */
export function groupPackagePurchases<R extends PackageRowLike>(rows: R[]): PackagePurchase<R>[] {
  const groups = new Map<string, R[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return [...groups.values()].map((rs) => {
    const first = rs[0];
    const services: PurchaseService[] = rs.map((r) => ({
      id: r.id, label: serviceTitle(r.serviceLabel?.trim() || r.packageName), usedSessions: r.usedSessions, totalSessions: r.totalSessions,
    })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")); // ordem fixa (o banco não tem ordem entre as linhas da compra)
    return {
      id: first.id, rowIds: rs.map((r) => r.id), rows: rs, contactId: first.contactId, clientName: first.clientName, packageName: first.packageName,
      priceCents: first.priceCents, purchasedOn: first.purchasedOn, validUntil: first.validUntil,
      totalSessions: Math.max(...rs.map((r) => r.totalSessions)), usedSessions: Math.max(...rs.map((r) => r.usedSessions)), services,
    };
  });
}

/**
 * Os serviços da compra numa linha. Vários: "Sessão de Pacote Método 0 de 4 · Finalização Método Fiaes 0 de 4". Um só: o nome do
 * serviço (o uso já está na barra), ou nada quando ele é o próprio nome do pacote.
 */
export function servicesLine(p: { packageName: string; services: Pick<PurchaseService, "label" | "usedSessions" | "totalSessions">[] }): string | null {
  if (p.services.length > 1) return p.services.map((s) => `${s.label} ${s.usedSessions} de ${s.totalSessions}`).join(" · ");
  const s = p.services[0];
  return s && normText(s.label) !== normText(p.packageName) ? s.label : null;
}
