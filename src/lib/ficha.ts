/**
 * A ficha da cliente (refeita 16/10, layout de computador): os pedaços de lógica pura das abas.
 * Nada aqui muda regra de negócio: só junta e nomeia o que a ficha já carrega (Avec + conversa).
 */
import { normText } from "@/server/domain/avec/normalize";
import { displayName } from "@/lib/client-rhythm";
import { dueLabel } from "@/lib/next-action";
import { conversationStatus, STATUS_LABEL, statusTone } from "@/lib/conversation-status";
import type { PackageSituation } from "@/server/queries/avec";

export type FichaTab = "resumo" | "horarios" | "pacotes" | "consultoria" | "pagamentos" | "conversas" | "notas";
export const FICHA_TABS: { value: FichaTab; label: string }[] = [
  { value: "resumo", label: "Resumo" }, { value: "horarios", label: "Horários" }, { value: "pacotes", label: "Pacotes" },
  { value: "consultoria", label: "Consultoria" }, { value: "pagamentos", label: "Pagamentos" }, { value: "conversas", label: "Conversas" }, { value: "notas", label: "Notas" },
];
/**
 * Pagamentos só para quem vê valores (o servidor nem manda os valores para os outros). Consultoria só para quem vê as fichas (fichas.ver)
 * com a função "fichas" ligada: sem isso a aba não existe e o servidor nem carrega as respostas e as fotos.
 */
export const fichaTabs = (money: boolean, consultoria = false) => FICHA_TABS.filter((t) => (money || t.value !== "pagamentos") && (consultoria || t.value !== "consultoria"));
export const isFichaTab = (v: string | null | undefined, money: boolean, consultoria = false): v is FichaTab => !!v && fichaTabs(money, consultoria).some((t) => t.value === v);

type Pkg = {
  id: string; packageName: string; serviceLabel: string | null; purchasedOn: string | null; validUntil: string | null; situation: PackageSituation; usedSessions: number; totalSessions: number;
  /** Compra agrupada (src/lib/package-purchases.ts): os serviços dela. */ services?: { label: string }[];
};
const CLOSED: PackageSituation[] = ["vencido", "esgotado"];
export const isOpenPackage = (p: { situation: PackageSituation }) => !CLOSED.includes(p.situation);

/** Em uso primeiro (na ordem que vieram), encerrados (vencido, sessões usadas) no fim. */
export function orderPackages<T extends { situation: PackageSituation }>(items: T[]): { open: T[]; closed: T[] } {
  return { open: items.filter(isOpenPackage), closed: items.filter((p) => !isOpenPackage(p)) };
}

/** O selo do topo da ficha: "Pacote: 3 de 4" do primeiro pacote em uso; null sem pacote em uso. */
export function packageSeal(items: Pkg[]): string | null {
  const p = items.find(isOpenPackage);
  return p ? `Pacote: ${p.usedSessions} de ${p.totalSessions}` : null;
}

export type PackageSession = { id: string; day: string; service: string; professional: string | null };
type HistItem = { id: string; soldOn: string; item: string; fromPackage: boolean; professionalName: string | null };

/**
 * As sessões usadas de cada pacote: os itens "do pacote" das comandas do Avec cujo serviço é um dos do pacote (ou o nome do pacote, sem serviço),
 * vendidos entre a compra e a validade. Cada sessão conta para um pacote só: o comprado mais perto antes dela. Mais novas primeiro.
 */
export function packageSessions(packages: Pkg[], history: HistItem[]): Map<string, PackageSession[]> {
  const out = new Map<string, PackageSession[]>(packages.map((p) => [p.id, []]));
  // Compra com vários serviços: a sessão de qualquer um deles é da compra.
  const keys = new Map(packages.map((p) => [p.id, new Set(p.services?.length ? p.services.map((s) => normText(s.label)) : [normText(p.serviceLabel || p.packageName)])]));
  for (const h of history) {
    if (!h.fromPackage) continue;
    const name = normText(h.item);
    const owner = packages
      .filter((p) => keys.get(p.id)!.has(name) && (!p.purchasedOn || p.purchasedOn <= h.soldOn) && (!p.validUntil || h.soldOn <= p.validUntil))
      .sort((a, b) => (b.purchasedOn ?? "").localeCompare(a.purchasedOn ?? ""))[0];
    if (owner) out.get(owner.id)!.push({ id: h.id, day: h.soldOn, service: h.item, professional: displayName(h.professionalName) });
  }
  for (const list of out.values()) list.sort((a, b) => b.day.localeCompare(a.day));
  return out;
}

type Conv = {
  stageName: string; ownerName: string | null; awaitingSince: string | null; late: boolean; closedConversation: boolean;
  nextAction: { title: string; dueAt: string } | null;
};
/** A situação da conversa com os termos de hoje: etapa, status (Aberto/Aguardando/Resolvido), "Com: Fulana" e a Retomada marcada. */
export function conversationFacts(c: Conv, now: number) {
  const st = conversationStatus({ archivedAt: c.closedConversation ? "x" : null, awaitingSince: c.awaitingSince });
  const due = c.nextAction ? Date.parse(c.nextAction.dueAt) : null;
  return {
    stage: c.stageName,
    /** Aberto que passou do prazo aparece como "Atrasado" (vermelho), como no resto do CRM. */
    status: st === "aberto" && c.late ? "Atrasado" : STATUS_LABEL[st],
    late: st === "aberto" && c.late,
    color: statusTone(st, c.late),
    with: c.ownerName ? `Com: ${displayName(c.ownerName)}` : "Com: ninguém ainda",
    retomada: c.nextAction && due != null ? `${c.nextAction.title} · ${due < now ? "atrasada, " : ""}${dueLabel(due, now)}` : null,
  };
}

/** A última visita pelas comandas: o dia mais recente, os serviços (sem repetir, sem produto) e as profissionais em Título. */
export function lastVisit(history: { soldOn: string; item: string; kind: string; professionalName: string | null }[]) {
  const day = history.reduce<string | null>((m, h) => (!m || h.soldOn > m ? h.soldOn : m), null);
  if (!day) return null;
  const same = history.filter((h) => h.soldOn === day);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    day,
    services: uniq(same.filter((h) => h.kind !== "produto").map((h) => h.item)),
    professionals: uniq(same.map((h) => displayName(h.professionalName))),
  };
}
