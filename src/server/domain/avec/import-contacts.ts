import { inArray, eq } from "drizzle-orm";
import { contacts } from "../../db/schema";
import { COLS } from "./formats";
import { dateIso, intOrNull, noonUtc } from "./normalize";
import { inChunks, type ImportCtx } from "./context";
import { groupNames, samePerson } from "@/lib/same-person";

/**
 * Contatos de qualquer relatório que tenha nome + telefone: cria quem não existe e completa o que está vazio em quem existe
 * (nome, e-mail, aniversário, cliente desde). Nunca sobrescreve o que já está preenchido. Nome gravado sem o parêntese do Avec;
 * "(T. USO DE IMAGEM)" vira o campo Uso de imagem da cliente (sem etiqueta).
 * Várias pessoas no mesmo número (0051): duas clientes de nomes diferentes com o mesmo celular (mãe e filha) não se fundem: a que não é o
 * titular vira pessoa a mais do número, com os dados dela (`ImportCtx.personFor`); os dados de uma nunca completam a ficha da outra.
 */

type Incoming = {
  phone: string; name: string | null; email: string | null; imageUse: boolean; completeProfile: boolean;
  birthDay: number | null; birthMonth: number | null; birthYear: number | null;
  clientSince: string | null; visit: string | null; isClient: boolean;
};

function birthdayOf(s: string): { day: number; month: number; year: number | null } | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/) ?? s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = s.includes("-");
  const day = Number(iso ? m[3] : m[1]), month = Number(m[2]);
  const y = iso ? Number(m[1]) : m[3] ? Number(m[3]) : null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const year = y == null ? null : y < 100 ? 1900 + y : y;
  return { day, month, year: year && year > 1900 ? year : null };
}

const validEmail = (s: string) => (/^\S+@\S+\.\S+$/.test(s) ? s.toLowerCase() : null);

export async function importContacts(ctx: ImportCtx) {
  const ix = {
    email: ctx.col(...COLS.email), birthday: ctx.col(...COLS.birthday), lastVisit: ctx.col(...COLS.lastVisit),
    since: ctx.roles.length === 1 ? ctx.col(...COLS.clientSinceAny, ...COLS.clientSinceList) : ctx.col(...COLS.clientSinceAny),
    firstVisit: ctx.col("primeira visita"),
    visits: ctx.col("numero de visitas", "total visitas", "nº comandas", "nº total comandas", "visita"),
  };
  const rowsByPhone = new Map<string, Incoming[]>();
  for (const row of ctx.rows) {
    const phone = ctx.phoneOf(row);
    if (!phone) continue;
    const { name, imageUse, completeProfile } = ctx.clientOf(row);
    const bd = birthdayOf(ctx.cell(row, ix.birthday));
    const visit = dateIso(ctx.cell(row, ix.lastVisit)) ?? dateIso(ctx.cell(row, ix.visits)) ?? dateIso(ctx.cell(row, ix.firstVisit));
    const visits = intOrNull(ctx.cell(row, ix.visits));
    rowsByPhone.set(phone, [...(rowsByPhone.get(phone) ?? []), {
      phone, name, imageUse, completeProfile, email: validEmail(ctx.cell(row, ix.email)),
      birthDay: bd?.day ?? null, birthMonth: bd?.month ?? null, birthYear: bd?.year ?? null,
      clientSince: dateIso(ctx.cell(row, ix.since)), visit, isClient: !!visit || (visits ?? 0) > 0,
    }]);
  }
  if (!rowsByPhone.size) return;
  // Cada telefone: uma entrada por PESSOA (nomes da mesma pessoa juntos; linha sem nome vai com a primeira).
  const peopleByPhone = new Map<string, Incoming[]>();
  for (const [phone, incs] of rowsByPhone) {
    const named = incs.filter((i) => i.name);
    const groups = named.length ? groupNames(named.map((i) => ({ ...i, name: i.name! }))) : [];
    const unnamed = incs.filter((i) => !i.name);
    if (!groups.length) groups.push(unnamed.splice(0, 1).map((i) => ({ ...i, name: "" })));
    groups[0].push(...unnamed.map((i) => ({ ...i, name: "" })));
    peopleByPhone.set(phone, groups.map((g) => g.map((i) => ({ ...i, name: i.name || null })).reduce(mergeIncoming)));
  }

  const phones = [...peopleByPhone.keys()];
  const existing = await inChunks(phones, 1000, (chunk) => ctx.tx.select().from(contacts).where(inArray(contacts.phoneE164, chunk)));
  const old = new Map(existing.map((c) => [c.phoneE164, c]));
  // Telefone de uma cliente que saiu num "Unir cadastros" (0086): é a que ficou (não recria a que saiu nem completa a ficha com os dados dela).
  const merged = await ctx.loadMergedPhones(phones.filter((p) => !old.has(p)));
  const kept = merged.size ? await inChunks([...new Set([...merged.values()].map((m) => m.keptId))], 1000, (chunk) => ctx.tx.select().from(contacts).where(inArray(contacts.id, chunk))) : [];
  for (const [phone, m] of merged) {
    const c = kept.find((k) => k.id === m.keptId);
    if (c) old.set(phone, c);
  }

  // O titular: o contato que já existe (com a entrada do mesmo nome) ou, número novo, a primeira pessoa do arquivo.
  const holderOf = (phone: string) => {
    const list = peopleByPhone.get(phone)!;
    const c = old.get(phone);
    const k = c?.name?.trim() ? list.findIndex((i) => samePerson(i.name, c.name)) : 0;
    return { index: Math.max(0, k) };
  };

  const fresh = phones.filter((p) => !old.has(p)).map((p) => peopleByPhone.get(p)![0]);
  const created = await inChunks(fresh, 500, (chunk) => ctx.tx.insert(contacts).values(chunk.map((c) => ({
    phoneE164: c.phone, name: c.name, email: c.email, birthDay: c.birthDay, birthMonth: c.birthMonth, birthYear: c.birthYear,
    clientSince: c.clientSince ? noonUtc(c.clientSince) : null,
  }))).onConflictDoNothing().returning({ id: contacts.id, phone: contacts.phoneE164, name: contacts.name }));
  for (const c of created) {
    ctx.contactsByPhone.set(c.phone, c.id);
    ctx.newContacts.add(c.id);
    ctx.rememberName(c.id, c.name);
    ctx.summary.contatosNovos++;
  }

  for (const [phone, c] of old) {
    ctx.contactsByPhone.set(phone, c.id);
    if (merged.has(phone)) continue;
    const h = holderOf(phone);
    // Várias pessoas no número e nenhuma com o nome do titular (o do WhatsApp): só a primeira completa a ficha, como antes.
    const inc = peopleByPhone.get(phone)![h.index];
    await completeContact(ctx, c, inc);
  }

  for (const [phone, list] of peopleByPhone) {
    const holderId = ctx.contactsByPhone.get(phone);
    if (!holderId) continue;
    const h = old.has(phone) ? holderOf(phone) : { index: 0 };
    for (const [k, inc] of list.entries()) {
      let id: string = holderId;
      if (k !== h.index) {
        id = await ctx.personFor(phone, holderId, inc.name, {
          email: inc.email, birthDay: inc.birthDay, birthMonth: inc.birthMonth, birthYear: inc.birthYear, clientSince: inc.clientSince ? noonUtc(inc.clientSince) : null,
        });
        if (id === holderId) continue; // não deu para separar com segurança: não mistura os dados dela na ficha do titular
        const [p] = await ctx.tx.select().from(contacts).where(eq(contacts.id, id));
        if (p) await completeContact(ctx, p, inc);
      }
      if (inc.imageUse) await ctx.tagImageUse(id);
      if (inc.completeProfile) await ctx.tagCompleteProfile(id);
      if (inc.isClient) ctx.evidence(id, inc.visit);
    }
  }
}

/** Junta duas linhas da MESMA pessoa: o que falta numa vem da outra; cliente desde, a mais antiga; última visita, a mais recente. */
function mergeIncoming(prev: Incoming, inc: Incoming): Incoming {
  const out = { ...prev };
  out.name ??= inc.name; out.email ??= inc.email; out.imageUse ||= inc.imageUse; out.completeProfile ||= inc.completeProfile; out.isClient ||= inc.isClient;
  if (out.birthDay == null) Object.assign(out, { birthDay: inc.birthDay, birthMonth: inc.birthMonth, birthYear: inc.birthYear });
  if (inc.clientSince && (!out.clientSince || inc.clientSince < out.clientSince)) out.clientSince = inc.clientSince;
  if (inc.visit && (!out.visit || inc.visit > out.visit)) out.visit = inc.visit;
  return out;
}

/** Completa o que está vazio na ficha (nunca sobrescreve). */
async function completeContact(ctx: ImportCtx, c: typeof contacts.$inferSelect, inc: Incoming) {
  const patch: Partial<typeof contacts.$inferInsert> = {};
  if (!c.name?.trim() && inc.name) patch.name = inc.name;
  if (!c.email && inc.email) patch.email = inc.email;
  if (c.birthDay == null && c.birthMonth == null && inc.birthDay != null) Object.assign(patch, { birthDay: inc.birthDay, birthMonth: inc.birthMonth, birthYear: inc.birthYear });
  else if (c.birthYear == null && inc.birthYear != null && c.birthDay === inc.birthDay && c.birthMonth === inc.birthMonth) patch.birthYear = inc.birthYear;
  if (!c.clientSince && inc.clientSince) patch.clientSince = noonUtc(inc.clientSince);
  if (Object.keys(patch).length) {
    await ctx.tx.update(contacts).set(patch).where(eq(contacts.id, c.id));
    ctx.markCompleted(c.id);
  }
}

/**
 * Fecha a importação dos contatos: quem apareceu em comanda, visita ou reserva em que compareceu vira cliente, e a data do
 * último atendimento avança (nunca volta).
 */
export async function applyClientEvidence(ctx: ImportCtx) {
  const ids = [...ctx.clientEvidence.keys()];
  if (!ids.length) return;
  const rows = await inChunks(ids, 1000, (chunk) => ctx.tx.select({ id: contacts.id, isClient: contacts.isClient, lastServiceAt: contacts.lastServiceAt }).from(contacts).where(inArray(contacts.id, chunk)));
  for (const c of rows) {
    const day = ctx.clientEvidence.get(c.id) ?? null;
    const patch: Partial<typeof contacts.$inferInsert> = {};
    if (!c.isClient) patch.isClient = true;
    const at = day ? noonUtc(day) : null;
    if (at && (!c.lastServiceAt || at.getTime() > c.lastServiceAt.getTime())) patch.lastServiceAt = at;
    if (!Object.keys(patch).length) continue;
    await ctx.tx.update(contacts).set(patch).where(eq(contacts.id, c.id));
    ctx.markCompleted(c.id);
  }
}
