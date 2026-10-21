import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { clientPackages, packageUses, salesItems, salesPayments } from "../../db/schema";
import { COLS } from "./formats";
import { bahiaAt, clean, comandaOf, dateIso, intOrNull, itemKind, moneyCents, normHeader, normText, pctOrNull, timeHm, type ItemKind } from "./normalize";
import { fillEmpty, upsertKeyed } from "./keyed";
import { inChunks, occurrenceKeys, type ImportCtx } from "./context";

/** Pacotes, uso de sessões, itens de comanda e pagamentos. Dinheiro sempre em centavos. */

const NO = new Set(["nao", "n", "0", "false"]);
const yes = (v: string) => !!v.trim() && !NO.has(normHeader(v));

async function clientRef(ctx: ImportCtx, row: string[]) {
  const { name, imageUse, completeProfile } = ctx.clientOf(row);
  const contactId = await ctx.contactOf(row);
  if (contactId && imageUse) await ctx.tagImageUse(contactId);
  if (contactId && completeProfile) await ctx.tagCompleteProfile(contactId);
  return { name, contactId };
}

/** Pacotes por cliente (e7894755): Total, Utilizados, Valor de venda, Validade, Compra. Sessões usadas só avançam. */
export async function importPackages(ctx: ImportCtx) {
  const ix = { pkg: ctx.col("pacote"), service: ctx.col("servico"), total: ctx.col("total"), used: ctx.col("utilizados"), price: ctx.col("valor de venda"), valid: ctx.col("validade"), bought: ctx.col("compra") };
  type NewPackage = typeof clientPackages.$inferInsert & { externalKey: string };
  const out: NewPackage[] = [];
  for (const row of ctx.rows) {
    const pkg = clean(ctx.cell(row, ix.pkg)), total = intOrNull(ctx.cell(row, ix.total));
    const c = await clientRef(ctx, row);
    if (!pkg || total == null || !c.name) continue;
    const service = clean(ctx.cell(row, ix.service)), bought = dateIso(ctx.cell(row, ix.bought));
    out.push({
      externalKey: `avec:pac:${normText(c.name)}|${normText(pkg)}|${normText(service)}|${bought ?? ""}`, contactId: c.contactId, clientName: c.name,
      packageName: pkg, serviceLabel: service, totalSessions: total, usedSessions: intOrNull(ctx.cell(row, ix.used)) ?? 0,
      priceCents: moneyCents(ctx.cell(row, ix.price)), purchasedOn: bought, validUntil: dateIso(ctx.cell(row, ix.valid)), origin: "avec",
    });
  }
  ctx.summary.pacotes += (await upsertKeyed(ctx.tx, clientPackages, out, (old, inc) => {
    const patch: Partial<NewPackage> = fillEmpty(old, inc, ["contactId", "serviceLabel", "priceCents", "purchasedOn", "validUntil"]);
    if ((inc.usedSessions ?? 0) > (old.usedSessions as number)) patch.usedSessions = inc.usedSessions;
    if (inc.totalSessions > (old.totalSessions as number)) patch.totalSessions = inc.totalSessions;
    return patch;
  })).changed; // sessões usadas avançando contam
}

/** Uso de sessão de pacote (40ca3312, 10599ac5). Liga ao pacote da cliente quando há exatamente um que combina. */
export async function importPackageUses(ctx: ImportCtx) {
  const ix = { day: ctx.col("data"), num: ctx.col("numero"), item: ctx.col("item"), pro: ctx.col("profissional"), pkg: ctx.col("do pacote") };
  type NewUse = typeof packageUses.$inferInsert & { externalKey: string };
  const key = occurrenceKeys();
  const out: NewUse[] = [];
  const pkgsOf = new Map<string, (typeof clientPackages.$inferSelect)[]>();
  for (const row of ctx.rows) {
    const day = dateIso(ctx.cell(row, ix.day)), item = clean(ctx.cell(row, ix.item)), pkgRaw = ctx.cell(row, ix.pkg);
    if (!day || !item || (ix.pkg >= 0 && !yes(pkgRaw))) continue;
    const c = await clientRef(ctx, row);
    ctx.evidence(c.contactId, day);
    const ref = c.contactId ?? `nome:${normText(c.name)}`;
    if (!pkgsOf.has(ref)) {
      // Pacote da cliente pelo contato ou, se o pacote entrou antes de a cliente virar contato, pelo nome.
      const byName = and(isNull(clientPackages.contactId), eq(clientPackages.clientName, c.name ?? ""));
      pkgsOf.set(ref, await ctx.tx.select().from(clientPackages).where(c.contactId ? or(eq(clientPackages.contactId, c.contactId), byName) : byName));
    }
    const candidates = pkgsOf.get(ref)!.filter((p) =>
      (normText(p.serviceLabel) === normText(item) || normText(p.packageName) === normText(pkgRaw))
      && (!p.purchasedOn || p.purchasedOn <= day) && (!p.validUntil || p.validUntil >= day));
    const comanda = comandaOf(ctx.cell(row, ix.num));
    out.push({
      externalKey: key(`avec:uso:${day}|${comanda ?? ""}|${normText(c.name)}|${normText(item)}`), clientPackageId: candidates.length === 1 ? candidates[0].id : null,
      contactId: c.contactId, clientName: c.name, usedOn: day, item, professionalName: clean(ctx.cell(row, ix.pro)), comanda,
    });
  }
  ctx.summary.usosPacote += (await upsertKeyed(ctx.tx, packageUses, out, (old, inc) => fillEmpty(old, inc, ["clientPackageId", "contactId", "professionalName", "comanda"]))).created;
}

type NewItem = typeof salesItems.$inferInsert & { externalKey: string };

/**
 * Itens de comanda (63d414a7 e parecidos). Chave: avec:item:<data>|<comanda>|<item>|<profissional>|<valor>. Formatos sem
 * profissional (ou com o nome escrito de outro jeito) caem no item já gravado da mesma data, comanda, item e valor.
 */
export async function importSalesItems(ctx: ImportCtx) {
  const itemIx = ctx.col(...COLS.item);
  const ix = {
    day: ctx.col(...COLS.itemDate), comanda: ctx.col(...COLS.comanda), item: itemIx, kind: ctx.col("tipo", "tipo item"), category: ctx.col("categoria"),
    pro: ctx.col(...COLS.professional), qty: ctx.col("qtd.", "quantidade", "qtd"), value: ctx.col("valor", "valor cobrado", "valor r$"),
    discount: ctx.col("desconto", "total desconto"), total: ctx.col("total", "total cobrado"), pkg: ctx.col("pacote", "do pacote"),
    commissionPct: ctx.col("comissao (%)"), commission: ctx.col("comissao"),
  };
  const itemIsService = normHeader(ctx.columns[itemIx]) === "servico";
  const key = occurrenceKeys();
  const out: (NewItem & { proKey: string })[] = [];
  for (const row of ctx.rows) {
    const day = dateIso(ctx.cell(row, ix.day)), item = clean(ctx.cell(row, ix.item));
    if (!day || !item) continue;
    const c = await clientRef(ctx, row);
    ctx.evidence(c.contactId, day);
    if (c.contactId) ctx.salesDays.push({ contactId: c.contactId, day });
    const proRaw = clean(ctx.cell(row, ix.pro));
    const category = clean(ctx.cell(row, ix.category));
    let kind: ItemKind = ix.kind >= 0 ? itemKind(ctx.cell(row, ix.kind)) : itemIsService ? "servico" : "outro";
    if (kind === "outro" && ix.kind < 0 && (await ctx.serviceId(item))) kind = "servico";
    if (kind === "servico") await ctx.serviceId(item, { category }); // só liga (e completa a categoria) se já estiver no cadastro
    const comanda = comandaOf(ctx.cell(row, ix.comanda));
    const valueCents = moneyCents(ctx.cell(row, ix.value)), totalCents = moneyCents(ctx.cell(row, ix.total));
    const qty = Number(ctx.cell(row, ix.qty).replace(",", "."));
    const discountCents = ix.discount >= 0 && !ctx.columns[ix.discount].includes("%") ? moneyCents(ctx.cell(row, ix.discount)) : null;
    const units = Number.isFinite(qty) && qty > 0 ? qty : 1;
    // Sem coluna de total: no Avec o "Valor" já é o total da linha (Corte, Qtd. 2 → Valor 300 = Líquido 300; mega hair vem em gramas).
    const total = totalCents ?? (valueCents != null ? valueCents - (discountCents ?? 0) : null);
    // Comissão do item ("Comissão (%)" e "Comissão" do relatório "Itens de comanda"): só o que veio; nunca calculada aqui.
    const commissionPct = pctOrNull(ctx.cell(row, ix.commissionPct));
    const commissionCents = ix.commission >= 0 ? moneyCents(ctx.cell(row, ix.commission)) : null;
    out.push({
      externalKey: key(`avec:item:${day}|${comanda ?? ""}|${normText(item)}|${normText(proRaw)}|${valueCents ?? totalCents ?? ""}`), proKey: normText(proRaw),
      contactId: c.contactId, clientName: c.name, soldOn: day, comanda, item, kind, category, professionalId: proRaw ? await ctx.professionalId(proRaw) : null,
      professionalName: proRaw, qty: units, valueCents, discountCents,
      totalCents: total, fromPackage: ix.pkg >= 0 && yes(ctx.cell(row, ix.pkg)), origin: "avec", commissionPct, commissionCents,
    });
  }
  await reuseEquivalentItems(ctx, out);
  const rows = out.map(({ proKey: _, ...r }) => r);
  ctx.summary.itensVenda += (await upsertKeyed(ctx.tx, salesItems, rows, (old, inc) => {
    const patch: Partial<NewItem> = fillEmpty(old, inc, ["contactId", "clientName", "category", "professionalId", "professionalName", "valueCents", "discountCents", "totalCents", "commissionPct", "commissionCents"]);
    if (old.kind === "outro" && inc.kind !== "outro") patch.kind = inc.kind;
    if (!old.fromPackage && inc.fromPackage) patch.fromPackage = true;
    return patch;
  })).created;
}

/** O mesmo item visto por outro relatório (sem profissional, ou com apelido em vez de nome completo) usa a chave do que já está gravado. */
async function reuseEquivalentItems(ctx: ImportCtx, out: (NewItem & { proKey: string })[]) {
  const comandas = [...new Set(out.map((o) => o.comanda).filter((c): c is string => !!c))];
  if (!comandas.length) return;
  const existing = await inChunks(comandas, 1000, (chunk) => ctx.tx.select().from(salesItems).where(inArray(salesItems.comanda, chunk)));
  const keys = new Set(existing.map((e) => e.externalKey));
  const taken = new Set<string>();
  for (const o of out) {
    if (keys.has(o.externalKey)) { taken.add(o.externalKey); continue; }
    for (const e of existing) {
      if (taken.has(e.externalKey) || e.soldOn !== o.soldOn || e.comanda !== o.comanda || normText(e.item) !== normText(o.item)) continue;
      if ((e.valueCents ?? e.totalCents) !== (o.valueCents ?? o.totalCents)) continue;
      const samePro = !o.proKey || !e.professionalName || normText(e.professionalName) === o.proKey
        || (!!o.professionalId && (e.professionalId === o.professionalId || (await ctx.professionalId(e.professionalName)) === o.professionalId));
      if (!samePro) continue;
      o.externalKey = e.externalKey;
      taken.add(e.externalKey);
      break;
    }
  }
}

/** Pagamentos de comanda (d1e9f12d): forma, valor, data da comanda e do pagamento. */
export async function importPayments(ctx: ImportCtx) {
  const ix = { comandaOn: ctx.col("data comanda"), comanda: ctx.col(...COLS.comanda), value: ctx.col("valor"), method: ctx.col("forma de pagamento"), detail: ctx.col("detalhe"), paidOn: ctx.col("data pagamento") };
  type NewPayment = typeof salesPayments.$inferInsert & { externalKey: string };
  const key = occurrenceKeys();
  const out: NewPayment[] = [];
  for (const row of ctx.rows) {
    const valueCents = moneyCents(ctx.cell(row, ix.value));
    if (valueCents == null) continue;
    const c = await clientRef(ctx, row);
    const comandaOn = dateIso(ctx.cell(row, ix.comandaOn)), paidOn = dateIso(ctx.cell(row, ix.paidOn));
    ctx.evidence(c.contactId, comandaOn ?? paidOn);
    // A hora do pagamento (quando o relatório traz) diz quais horários do dia já tinham começado; pago em outro dia não diz nada.
    const paidHm = timeHm(ctx.cell(row, ix.paidOn)), day = comandaOn ?? paidOn;
    const soldAt = paidOn && paidOn === day && paidHm && paidHm !== "00:00" ? bahiaAt(paidOn, paidHm) : null;
    if (c.contactId && day) ctx.salesDays.push({ contactId: c.contactId, day, soldAt });
    const method = clean(ctx.cell(row, ix.method)), detail = clean(ctx.cell(row, ix.detail));
    const comanda = comandaOf(ctx.cell(row, ix.comanda));
    out.push({
      externalKey: key(`avec:pag:${comandaOn ?? ""}|${comanda ?? ""}|${normText(method)}|${valueCents}|${paidOn ?? ""}`), contactId: c.contactId, clientName: c.name,
      comanda, comandaOn, paidOn, method: method && detail && normText(detail) !== normText(method) ? `${method} (${detail})` : method, valueCents,
    });
  }
  ctx.summary.pagamentos += (await upsertKeyed(ctx.tx, salesPayments, out, (old, inc) => fillEmpty(old, inc, ["contactId", "clientName", "method"]))).created;
}
