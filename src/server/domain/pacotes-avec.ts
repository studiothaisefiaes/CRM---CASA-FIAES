import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, clientPackages, lists, packageDefs, type PackageDefItem } from "../db/schema";
import { formatBRL } from "@/lib/money";
import { normText } from "./avec/normalize";

/*
 * Pacotes do Avec para a aba Serviços › Pacotes (scripts/pacotes-do-avec.ts). Fonte: os pacotes vendidos que vieram do Avec
 * (client_packages) e, se houver, o catálogo de pacotes do Avec (JSON gerado na máquina, fora do repositório: nome, preço oficial,
 * descrição, serviços × sessões). Só acrescenta: cria o pacote que falta, completa o que está vazio e liga as vendas do Avec ao
 * pacote (package_def_id). Preço diferente do que está no CRM não é trocado (aparece como divergência).
 */

export type AvecPackageRow = { id: string; contactKey: string; packageName: string; serviceLabel: string | null; totalSessions: number; priceCents: number | null; purchasedOn: string | null; validUntil: string | null; packageDefId: string | null };
export type ExistingPackageDef = { id: string; name: string; avecName: string | null; priceCents: number | null; validityDays: number | null; description: string | null; items: PackageDefItem[]; active: boolean };

const item = z.object({ servico: z.string().min(1).max(200), sessoes: z.number().int().min(1).max(100), unitCents: z.number().int().min(0).nullish() });
const entry = z.object({
  avec: z.string().min(1).max(200), nome: z.string().max(120).nullish(), descricao: z.string().max(2000).nullish(),
  precoCents: z.number().int().min(0).nullish(), validadeDias: z.number().int().min(1).max(3650).nullish(), itens: z.array(item).max(20).nullish(),
});
export type AvecCatalogEntry = z.infer<typeof entry>;
export const parseAvecCatalog = (json: unknown): AvecCatalogEntry[] => z.object({ pacotes: z.array(entry) }).parse(json).pacotes;

export type PackageDraft = { avecName: string; name: string; priceCents: number | null; validityDays: number | null; description: string | null; items: PackageDefItem[]; vendas: number };
export type AvecPackagePlan = {
  criar: PackageDraft[];
  completar: { id: string; name: string; set: Partial<Pick<ExistingPackageDef, "priceCents" | "validityDays" | "description" | "avecName">> }[];
  divergencias: { name: string; campo: "preço" | "validade"; crm: number; avec: number }[];
  /** Vendas do Avec sem pacote para ligar (defId null = o pacote que vai ser criado). */
  ligar: { avecName: string; defId: string | null; rowIds: string[] }[];
  avisos: string[];
  iguais: number;
  /** O que o pacote fica sendo, para o relatório. */
  resumo: (PackageDraft & { serviceLabels: string[]; existe: boolean })[];
};
export type AvecPackageBackup = { criadoEm: string; defsAntes: ExistingPackageDef[]; ligados: string[] };

const DESC_MAX = 600;
const ACCENTS: Record<string, string> = { sessoes: "sessões", sessao: "sessão", manutencao: "manutenção", metodo: "Método", fiaes: "Fiaes", aplicacao: "aplicação", coloracao: "coloração", finalizacao: "finalização" };
const brl = (c: number) => formatBRL(c);
const cleanDesc = (d: string | null | undefined) => {
  const v = (d ?? "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  return v ? (v.length > DESC_MAX ? `${v.slice(0, DESC_MAX - 1).trimEnd()}…` : v) : null;
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** Nome legível: sem maiúsculas gritadas (com os acentos que o Avec perdeu), sem espaço duplo, "4Escova" → "4 Escova". */
export function packageTitle(avecName: string): string {
  let s = avecName.replace(/\s+/g, " ").trim().replace(/(\d)(\p{L})/gu, "$1 $2");
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters && letters === letters.toUpperCase()) {
    s = s.toLowerCase().split(" ").map((w) => ACCENTS[normText(w)] ?? w).join(" ");
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

/** O valor mais frequente; empate = o da venda mais recente. `xs` vem em ordem de compra (mais antiga primeiro). */
function mostFrequent<T>(xs: T[], key: (x: T) => string): T | null {
  const count = new Map<string, number>();
  for (const x of xs) count.set(key(x), (count.get(key(x)) ?? 0) + 1);
  let best: T | null = null, bestN = 0;
  for (const x of xs) { const n = count.get(key(x))!; if (n >= bestN) { best = x; bestN = n; } }
  return best;
}

export function planAvecPackages(input: { rows: AvecPackageRow[]; catalog: AvecCatalogEntry[]; defs: ExistingPackageDef[]; services: { id: string; label: string }[] }): AvecPackagePlan {
  const plan: AvecPackagePlan = { criar: [], completar: [], divergencias: [], ligar: [], avisos: [], iguais: 0, resumo: [] };
  const svcByKey = new Map<string, { id: string; label: string }>();
  for (const s of input.services) if (!svcByKey.has(normText(s.label))) svcByKey.set(normText(s.label), s);
  const svcLabel = new Map(input.services.map((s) => [s.id, s.label]));
  const groups = new Map<string, { avecName: string; rows: AvecPackageRow[]; cat: AvecCatalogEntry | null }>();
  for (const r of input.rows) {
    const k = normText(r.packageName);
    const g = groups.get(k) ?? { avecName: r.packageName.replace(/\s+/g, " ").trim(), rows: [], cat: null };
    g.rows.push(r); groups.set(k, g);
  }
  for (const c of input.catalog) {
    const k = normText(c.avec);
    const g = groups.get(k) ?? { avecName: c.avec.replace(/\s+/g, " ").trim(), rows: [], cat: null };
    g.cat = c; groups.set(k, g);
  }

  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].avecName.localeCompare(b[1].avecName, "pt-BR"))) {
    const name = g.cat?.nome?.trim() || packageTitle(g.avecName);
    // Vendas = (cliente, dia da compra); cada linha do Avec é um serviço do pacote.
    const sales = new Map<string, AvecPackageRow[]>();
    for (const r of [...g.rows].sort((a, b) => (a.purchasedOn ?? "").localeCompare(b.purchasedOn ?? ""))) {
      const k = `${r.contactKey}|${r.purchasedOn ?? ""}`;
      sales.set(k, [...(sales.get(k) ?? []), r]);
    }
    const saleList = [...sales.values()];
    const itemsOf = (sale: AvecPackageRow[]) => {
      const m = new Map<string, { label: string; sessions: number }>();
      for (const r of sale) { if (!r.serviceLabel?.trim()) continue; const k = normText(r.serviceLabel); m.set(k, { label: r.serviceLabel, sessions: (m.get(k)?.sessions ?? 0) + r.totalSessions }); }
      return [...m.values()];
    };
    const sig = (its: { label: string; sessions: number }[]) => its.map((i) => `${normText(i.label)}×${i.sessions}`).sort().join("+");
    const fromSales = mostFrequent(saleList.map(itemsOf).filter((i) => i.length), sig) ?? [];
    const wanted = g.cat?.itens?.length ? g.cat.itens.map((i) => ({ label: i.servico, sessions: i.sessoes, unitCents: i.unitCents ?? null })) : fromSales.map((i) => ({ ...i, unitCents: null }));
    const items: PackageDefItem[] = [];
    for (const w of wanted) {
      const s = svcByKey.get(normText(w.label));
      if (!s) { plan.avisos.push(`${name}: o serviço "${w.label}" não está no cadastro (fica fora do pacote).`); continue; }
      if (!items.some((i) => i.serviceId === s.id)) items.push({ serviceId: s.id, sessions: w.sessions, unitCents: w.unitCents });
    }
    const salesSessions = Math.max(0, ...fromSales.map((i) => i.sessions));
    const catSessions = Math.max(0, ...(g.cat?.itens ?? []).map((i) => i.sessoes));
    if (g.cat?.itens?.length && fromSales.length && catSessions !== salesSessions) plan.avisos.push(`${name}: sessões do catálogo (${catSessions}) ≠ das vendas (${salesSessions}); ficou o do catálogo.`);

    const salePrice = mostFrequent(saleList.map((s) => s[0].priceCents).filter((p): p is number => p != null && p > 0), String);
    const priceCents = g.cat?.precoCents ?? salePrice;
    if (g.cat?.precoCents != null && salePrice != null && salePrice !== g.cat.precoCents) plan.avisos.push(`${name}: preço do catálogo ${brl(g.cat.precoCents)}; nas vendas ${brl(salePrice)} (mais frequente). Ficou o do catálogo.`);
    const validityDays = g.cat?.validadeDias ?? median(saleList.map((s) => s[0]).filter((r) => r.purchasedOn && r.validUntil).map((r) => days(r.purchasedOn!, r.validUntil!)).filter((d) => d > 0));
    const draft: PackageDraft = { avecName: g.avecName, name, priceCents: priceCents ?? null, validityDays, description: cleanDesc(g.cat?.descricao), items, vendas: saleList.length };

    // Pacote que já existe: pelo nome do Avec gravado; senão pelo pacote a que as vendas já estão ligadas; senão pelo nome.
    const linked = mostFrequent(g.rows.map((r) => r.packageDefId).filter((id): id is string => !!id && input.defs.some((d) => d.id === id)), String);
    const def = input.defs.find((d) => d.avecName && normText(d.avecName) === key)
      ?? (linked ? input.defs.find((d) => d.id === linked) : undefined)
      ?? input.defs.find((d) => normText(d.name) === key || normText(d.name) === normText(name));
    const toLink = g.rows.filter((r) => !r.packageDefId).map((r) => r.id);

    if (!def) {
      if (!items.length) { plan.avisos.push(`${name}: sem serviço no cadastro; não criado.`); continue; }
      plan.criar.push(draft);
      if (toLink.length) plan.ligar.push({ avecName: g.avecName, defId: null, rowIds: toLink });
      plan.resumo.push({ ...draft, serviceLabels: items.map((i) => svcLabel.get(i.serviceId)!), existe: false });
      continue;
    }
    const set: AvecPackagePlan["completar"][number]["set"] = {};
    if (!def.avecName) set.avecName = g.avecName;
    if (def.priceCents == null && draft.priceCents != null) set.priceCents = draft.priceCents;
    if (def.priceCents != null && draft.priceCents != null && def.priceCents !== draft.priceCents) plan.divergencias.push({ name: def.name, campo: "preço", crm: def.priceCents, avec: draft.priceCents });
    if (def.validityDays == null && draft.validityDays != null) set.validityDays = draft.validityDays;
    if (def.validityDays != null && draft.validityDays != null && def.validityDays !== draft.validityDays) plan.divergencias.push({ name: def.name, campo: "validade", crm: def.validityDays, avec: draft.validityDays });
    if (!def.description && draft.description) set.description = draft.description;
    if (Object.keys(set).length) plan.completar.push({ id: def.id, name: def.name, set });
    if (toLink.length) plan.ligar.push({ avecName: g.avecName, defId: def.id, rowIds: toLink });
    if (!Object.keys(set).length && !toLink.length) plan.iguais++;
    plan.resumo.push({ avecName: g.avecName, name: def.name, priceCents: def.priceCents ?? set.priceCents ?? null, validityDays: def.validityDays ?? set.validityDays ?? null,
      description: def.description ?? set.description ?? null, items: def.items, vendas: saleList.length, serviceLabels: def.items.map((i) => svcLabel.get(i.serviceId) ?? "Serviço removido"), existe: true });
  }
  return plan;
}

/** O estado do banco para o plano: vendas do Avec (não canceladas), pacotes do CRM e serviços (ativos primeiro, para o nome repetido). */
export async function loadAvecPackageInput(catalog: AvecCatalogEntry[]) {
  const [rows, defs, services] = await Promise.all([
    db.select({ id: clientPackages.id, contactId: clientPackages.contactId, clientName: clientPackages.clientName, packageName: clientPackages.packageName, serviceLabel: clientPackages.serviceLabel,
      totalSessions: clientPackages.totalSessions, priceCents: clientPackages.priceCents, purchasedOn: clientPackages.purchasedOn, validUntil: clientPackages.validUntil, packageDefId: clientPackages.packageDefId })
      .from(clientPackages).where(and(eq(clientPackages.origin, "avec"), isNull(clientPackages.cancelledAt))),
    db.select({ id: packageDefs.id, name: packageDefs.name, avecName: packageDefs.avecName, priceCents: packageDefs.priceCents, validityDays: packageDefs.validityDays, description: packageDefs.description, items: packageDefs.items, active: packageDefs.active }).from(packageDefs),
    db.select({ id: lists.id, label: lists.label, active: lists.active }).from(lists).where(eq(lists.kind, "service")),
  ]);
  return {
    rows: rows.map(({ contactId, clientName, ...r }) => ({ ...r, contactKey: contactId ?? clientName ?? r.id })),
    catalog, defs, services: services.sort((a, b) => Number(b.active) - Number(a.active)).map(({ id, label }) => ({ id, label })),
  };
}

/** Grava o backup (pacotes que mudam + vendas que vão ser ligadas) e só então aplica, numa transação. */
export async function applyAvecPackages(plan: AvecPackagePlan, writeBackup: (b: AvecPackageBackup) => Promise<void>): Promise<{ criados: number; completados: number; ligados: number }> {
  const ids = plan.completar.map((c) => c.id);
  const defsAntes = ids.length ? await db.select({ id: packageDefs.id, name: packageDefs.name, avecName: packageDefs.avecName, priceCents: packageDefs.priceCents, validityDays: packageDefs.validityDays,
    description: packageDefs.description, items: packageDefs.items, active: packageDefs.active }).from(packageDefs).where(inArray(packageDefs.id, ids)) : [];
  await writeBackup({ criadoEm: new Date().toISOString(), defsAntes, ligados: plan.ligar.flatMap((l) => l.rowIds).sort() });
  return db.transaction(async (tx) => {
    const created = new Map<string, string>();
    for (const c of plan.criar) {
      const [d] = await tx.insert(packageDefs).values({ name: c.name, avecName: c.avecName, priceCents: c.priceCents, validityDays: c.validityDays, description: c.description, items: c.items, active: true }).returning({ id: packageDefs.id });
      created.set(c.avecName, d.id);
    }
    for (const c of plan.completar) await tx.update(packageDefs).set(c.set).where(eq(packageDefs.id, c.id));
    let ligados = 0;
    for (const l of plan.ligar) {
      const defId = l.defId ?? created.get(l.avecName);
      if (!defId) continue;
      // Só o package_def_id (nem o updated_at): o resto da venda do Avec fica como veio.
      ligados += (await tx.update(clientPackages).set({ packageDefId: defId }).where(and(inArray(clientPackages.id, l.rowIds), isNull(clientPackages.packageDefId))).returning({ id: clientPackages.id })).length;
    }
    await tx.insert(auditLog).values({ userId: null, action: "importou", entity: "package_def", entityId: null,
      data: { origem: "avec-pacotes", criados: plan.criar.map((c) => c.name), completados: plan.completar.map((c) => ({ nome: c.name, ...c.set })), ligados } });
    return { criados: plan.criar.length, completados: plan.completar.length, ligados };
  });
}
