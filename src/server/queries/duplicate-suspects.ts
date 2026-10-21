import { and, asc, ilike, ne, or } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";
import { isPersonPhone } from "@/lib/phone-client";
import { phoneHint } from "@/lib/merge-view";
import { samePerson } from "@/lib/same-person";

export type DuplicateSignal = "cpf" | "email" | "aniversario" | "final8" | "pessoa_a_mais" | "codigo_avec";
export type DuplicateSuspect = { aId: string; bId: string; aName: string | null; bName: string | null; aHint: string; bHint: string; signals: DuplicateSignal[] };

/** Mesmo e-mail em mais de 3 cadastros é de casa/empresa, não da cliente: não é sinal. */
const EMAIL_MAX = 3;
const plain = (s: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
const hidden = (p: string) => p.startsWith("lid:") || isPersonPhone(p);

/**
 * Possíveis duplicadas para a tela de unir (Fase C, item 25a). Três fontes, juntas por par:
 * - mesmo nome (sem acento e maiúsculas, 2+ palavras, sem `pessoa:` nem `lid:`) com pelo menos um sinal: CPF, e-mail, aniversário ou final do telefone;
 * - "pessoa a mais" cujo nome é o de outro cadastro com número próprio;
 * - código do Avec repetido.
 * Só sugere: quem decide é a pessoa, na tela. Não devolve CPF nem telefone.
 */
export async function listDuplicateSuspects(opts: { contactId?: string } = {}): Promise<DuplicateSuspect[]> {
  const rows = await db.select({
    id: contacts.id, name: contacts.name, phone: contacts.phoneE164, email: contacts.email, cpf: contacts.cpf,
    d: contacts.birthDay, m: contacts.birthMonth, y: contacts.birthYear, kind: contacts.kind, imp: contacts.importedFields, holder: contacts.sharesPhoneWith,
  }).from(contacts).where(ne(contacts.kind, "spam"));
  type R = (typeof rows)[number];

  const found = new Map<string, { a: R; b: R; signals: Set<DuplicateSignal> }>();
  const add = (a: R, b: R, s: DuplicateSignal) => {
    if (a.id === b.id || a.kind !== b.kind) return;
    if (opts.contactId && a.id !== opts.contactId && b.id !== opts.contactId) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const k = `${x.id}|${y.id}`;
    (found.get(k) ?? found.set(k, { a: x, b: y, signals: new Set() }).get(k)!).signals.add(s);
  };

  const emailCount = new Map<string, number>();
  for (const r of rows) if (r.email) emailCount.set(r.email.toLowerCase(), (emailCount.get(r.email.toLowerCase()) ?? 0) + 1);

  // 1) Mesmo nome, com sinal.
  const byName = new Map<string, R[]>();
  for (const r of rows) {
    const n = plain(r.name);
    if (n.split(" ").length < 2 || hidden(r.phone)) continue;
    (byName.get(n) ?? byName.set(n, []).get(n)!).push(r);
  }
  for (const g of byName.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i], b = g[j];
    if (a.cpf && a.cpf === b.cpf) add(a, b, "cpf");
    if (a.email && a.email.toLowerCase() === b.email?.toLowerCase() && (emailCount.get(a.email.toLowerCase()) ?? 0) <= EMAIL_MAX) add(a, b, "email");
    if (a.d != null && a.d === b.d && a.m === b.m && (a.y == null || b.y == null || a.y === b.y)) add(a, b, "aniversario");
    const da = digits(a.phone), db8 = digits(b.phone);
    if (da.length >= 8 && da.slice(-8) === db8.slice(-8)) add(a, b, "final8");
  }

  // 2) "Pessoa a mais" que também tem contato próprio.
  const own = rows.filter((r) => !hidden(r.phone) && r.name);
  for (const p of rows.filter((r) => isPersonPhone(r.phone) && r.name)) {
    for (const o of own) if (o.id !== p.holder && samePerson(p.name, o.name)) add(p, o, "pessoa_a_mais");
  }

  // 3) Código do Avec repetido.
  const byCode = new Map<string, R[]>();
  for (const r of rows) { const c = r.imp?.avec?.codigo?.trim(); if (c) (byCode.get(c) ?? byCode.set(c, []).get(c)!).push(r); }
  for (const g of byCode.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) add(g[i], g[j], "codigo_avec");

  return [...found.values()].map((f) => ({ aId: f.a.id, bId: f.b.id, aName: f.a.name, bName: f.b.name, aHint: phoneHint(f.a.phone), bHint: phoneHint(f.b.phone), signals: [...f.signals] }))
    .sort((x, y) => y.signals.length - x.signals.length || (x.aName ?? "").localeCompare(y.aName ?? "", "pt-BR"));
}

/** Busca do passo "Com quem?": nome ou telefone; devolve nome e final do número. Não inclui o próprio cadastro nem Spam. */
export async function searchMergeTargets(exceptId: string, q: string): Promise<{ id: string; name: string | null; hint: string }[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const dig = term.replace(/\D/g, "");
  const rows = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts)
    .where(and(ne(contacts.id, exceptId), ne(contacts.kind, "spam"),
      or(ilike(contacts.name, like), dig.length >= 4 ? like2(dig) : undefined)))
    .orderBy(asc(contacts.name)).limit(12);
  return rows.map((r) => ({ id: r.id, name: r.name, hint: phoneHint(r.phone) }));
}
const like2 = (dig: string) => ilike(contacts.phoneE164, `%${dig}%`);
