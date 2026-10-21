import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { auditLog, avecRejectedRows, contactTags, contacts, lists, professionals, tags } from "../../db/schema";
import { COMPLETE_PROFILE_TAG, stripCompleteProfile } from "@/lib/complete-profile";
import { normalizePhone } from "../phone";
import { addPersonTx } from "../people-on-number";
import { allMerges, mergedPersonFor, mergedRecordsFor, type MergedRecord } from "../merge-contacts";
import { isUsableName, nameTokens, samePerson } from "@/lib/same-person";
import { COLS, colOf, type AvecRole } from "./formats";
import { dateIso, normText, splitClientName } from "./normalize";
import type { SaleDay } from "./sales-close";

/**
 * Estado de UMA importação (um arquivo, dentro da transação dele): a tabela saneada, o resumo do que entrou e os caches
 * de profissionais, serviços e clientes, para que cada importador ache/crie a mesma coisa do mesmo jeito.
 */

/** Resumo do que entrou. Contatos: novos e completados; o resto conta linhas criadas ou alteradas (reimportar o mesmo arquivo dá zero). */
export type AvecSummary = {
  contatosNovos: number; contatosCompletados: number; agendamentos: number; bloqueios: number; pacotes: number; usosPacote: number;
  itensVenda: number; pagamentos: number; profissionais: number; servicos: number;
  produtos: number; saldosEstoque: number; produtosIgnorados: number;
  /** Reservas que o 0248 diz Agendado sem baixa no Avec e que bateram com uma reserva da agenda. */ semBaixa: number;
  /** Respostas das fichas (anamnese e consultoria) criadas ou atualizadas a partir do Avec. */ fichas: number;
  /** Linhas de ficha ignoradas (consultoria sem data; pergunta da anamnese que a Casa não tem). */ fichasIgnoradas: number;
  /** 1 quando o arquivo é de fichas e a função Fichas está desligada: nada foi gravado. */ fichasDesligada: number;
  /** Saldos de fidelidade (0113) gravados ou trocados. */ saldosFidelidade: number;
  /** 1 quando o arquivo é de saldos de fidelidade e a função Fidelidade está desligada: nada foi gravado. */ fidelidadeDesligada: number;
};
export const emptySummary = (): AvecSummary => ({
  contatosNovos: 0, contatosCompletados: 0, agendamentos: 0, bloqueios: 0, pacotes: 0, usosPacote: 0, itensVenda: 0, pagamentos: 0, profissionais: 0, servicos: 0, produtos: 0, saldosEstoque: 0, produtosIgnorados: 0, semBaixa: 0, fichas: 0, fichasIgnoradas: 0, fichasDesligada: 0, saldosFidelidade: 0, fidelidadeDesligada: 0,
});

/** A etiqueta antiga "Uso de imagem" (a importação não a cria mais: o dado vive em `contacts.image_use`, 0081); quem já tem fica como está. */
export const IMAGE_USE_TAG = "Uso de imagem";
/** "(T. USO DE IMAGEM)" no fim do nome (regex do Postgres, sem diferenciar maiúsculas). */
const IMAGE_USE_SUFFIX = String.raw`\(\s*t\.?\s*uso\s*de\s*imagem\s*\)\s*$`;

type Pro = { id: string; name: string; fullName: string | null; role: string | null; avecId: string | null; active?: boolean };
/** As pessoas de um número (0051): o titular, se o nome dele é o de uma cliente do Avec (`confirmed`), e as pessoas a mais. */
type NumberPeople = { holderId: string; holderName: string | null; confirmed: boolean; people: { id: string; name: string | null }[] };
/**
 * O contato da linha e a "identidade do Avec" dela (`keyId`): o próprio contato ou, quando a linha é de uma cliente que saiu num
 * "Unir cadastros" (0086), o id da que saiu. As chaves por cliente (`avec:ficha:`, `avec:fid:`) usam o `keyId`: a linha da que saiu continua
 * achando a resposta e o saldo dela, sem trocar nem duplicar os da que ficou.
 */
export type ContactRef = { id: string; keyId: string };
export type PersonData = { email?: string | null; birthDay?: number | null; birthMonth?: number | null; birthYear?: number | null; clientSince?: Date | null };
type Service = { id: string; label: string; category: string | null; priceCents: number | null; durationMin: number | null };

export class ImportCtx {
  readonly summary = emptySummary();
  /** Contatos criados / completados neste arquivo (para não contar duas vezes). */
  readonly newContacts = new Set<string>();
  readonly completedContacts = new Set<string>();
  /** Evidência de que a pessoa é cliente (comanda, visita, reserva em que compareceu): contato → dia mais recente (ou null sem data). */
  readonly clientEvidence = new Map<string, string | null>();
  readonly contactsByPhone = new Map<string, string>();
  /** Cliente + dia com item de comanda ou pagamento neste arquivo: o horário que bate com a venda ganha baixa (`closeFromAvecSales`, 17/10 e 18/10). */
  readonly salesDays: SaleDay[] = [];
  private byName: Map<string, string[]> | null = null;
  private pros: Pro[] | null = null;
  private services: Map<string, Service> | null = null;
  private completeTagId: string | null = null;
  private numbers = new Map<string, NumberPeople>();
  private fileNames: Map<string, string[]> | null = null;
  /** Telefones de clientes que saíram num "Unir cadastros": telefone → junção (null = o telefone nunca saiu). */
  private merged = new Map<string, MergedRecord | null>();
  private mergedNames: Map<string, MergedRecord[]> | null = null;

  /** O relógio da importação (datas fora do limite, varredura), o relatório guardado e a assinatura do formato. */
  readonly now: Date;
  readonly reportId: string | null;
  readonly signature: string | null;
  /** O relatório é novo (não estava guardado com o mesmo conteúdo): só relatório novo varre o que sumiu. */
  readonly newReport: boolean;
  /** Quem importou (movimentos de estoque e auditoria); null em script. */
  readonly userId: string | null;

  constructor(readonly tx: Tx, readonly columns: string[], readonly rows: string[][], readonly roles: AvecRole[],
    opts: { now?: Date; reportId?: string | null; signature?: string | null; newReport?: boolean; userId?: string | null } = {}) {
    this.userId = opts.userId ?? null;
    this.newReport = opts.newReport ?? true;
    this.now = opts.now ?? new Date();
    this.reportId = opts.reportId ?? null;
    this.signature = opts.signature ?? null;
  }

  /**
   * Linha recusada (17/10): não vira horário, fica em `avec_rejected_rows` (uma por chave) e aparece em "Conferir com o Avec" enquanto
   * continuar vindo nas importações.
   */
  async reject(r: { key: string; reason: "data_fora_do_limite" | "cliente_nao_encontrada"; day: string; hm: string | null; name: string | null; contactId: string | null; pro: string | null; service: string | null }) {
    await this.tx.insert(avecRejectedRows).values({
      externalKey: `avec:rej:${r.key}`, reason: r.reason, reportId: this.reportId, day: r.day, hm: r.hm, clientName: r.name, contactId: r.contactId,
      professionalName: r.pro, serviceLabel: r.service, lastSeenAt: this.now,
    }).onConflictDoUpdate({ target: avecRejectedRows.externalKey, set: { lastSeenAt: this.now, reportId: this.reportId } });
  }

  col(...names: readonly string[]) { return colOf(this.columns, ...names); }
  /** Valor da célula (texto aparado) ou "" se a coluna não existe. */
  cell(row: string[], ix: number) { return ix >= 0 ? (row[ix] ?? "").trim() : ""; }

  /* ── clientes ── */

  /** Telefone da linha: celular primeiro, depois telefone. */
  phoneOf(row: string[]): string | null {
    for (const n of COLS.phone) { const p = normalizePhone(this.cell(row, this.col(n))); if (p) return p; }
    return null;
  }
  clientOf(row: string[]) { return splitClientName(this.cell(row, this.col(...COLS.client))); }

  /**
   * Contato da linha: pelo telefone; sem telefone, pelo nome (só se houver exatamente um contato com esse nome).
   * Várias pessoas no mesmo número (0051): nome de OUTRA pessoa no telefone (mãe e filha no mesmo celular) vai para a pessoa a mais
   * desse número (criada se faltar), em vez de cair na ficha do titular. Ver `personFor`.
   */
  async contactOf(row: string[]): Promise<string | null> {
    return (await this.contactRefOf(row))?.id ?? null;
  }

  /**
   * O mesmo que `contactOf`, com a identidade do Avec (`ContactRef`). Telefone ou nome de uma cliente que saiu num "Unir cadastros" (0086)
   * cai na que ficou: a importação nunca recria a que saiu.
   */
  async contactRefOf(row: string[]): Promise<ContactRef | null> {
    const phone = this.phoneOf(row);
    const { name } = this.clientOf(row);
    if (phone) {
      let holderId = this.contactsByPhone.get(phone);
      if (!holderId) {
        const [c] = await this.tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneE164, phone));
        if (c) { this.contactsByPhone.set(phone, c.id); holderId = c.id; }
        else {
          const m = await this.mergedPhone(phone);
          if (m) { this.contactsByPhone.set(phone, m.keptId); holderId = m.keptId; }
        }
      }
      if (holderId) return this.personRef(phone, holderId, name);
    }
    return name ? this.contactRefByName(name) : null;
  }

  /** As junções destes telefones de uma vez (lista de clientes). */
  async loadMergedPhones(phones: string[]): Promise<Map<string, MergedRecord>> {
    const todo = phones.filter((p) => !this.merged.has(p));
    const found = todo.length ? await mergedRecordsFor(this.tx, todo) : new Map<string, MergedRecord>();
    for (const p of todo) this.merged.set(p, found.get(p) ?? null);
    return new Map(phones.flatMap((p) => { const m = this.merged.get(p); return m ? [[p, m] as const] : []; }));
  }

  /** A junção do telefone de uma cliente que saiu (null se o telefone nunca saiu). */
  async mergedPhone(phone: string): Promise<MergedRecord | null> {
    if (!this.merged.has(phone)) await this.loadMergedPhones([phone]);
    return this.merged.get(phone) ?? null;
  }

  /** Os nomes de cliente que este arquivo traz para cada telefone. */
  namesInFile(phone: string): string[] {
    if (!this.fileNames) {
      this.fileNames = new Map();
      for (const row of this.rows) {
        const p = this.phoneOf(row), n = this.clientOf(row).name;
        if (p && n) this.fileNames.set(p, [...(this.fileNames.get(p) ?? []), n]);
      }
    }
    return this.fileNames.get(phone) ?? [];
  }

  /** As pessoas do número (cache por telefone). Titular "confirmado": o nome dele já veio do Avec (cadastro, horário, pacote ou este arquivo). */
  private async numberOf(phone: string, holderId: string): Promise<NumberPeople> {
    const hit = this.numbers.get(phone);
    if (hit && hit.holderId === holderId) return hit;
    const [h] = await this.tx.select({ name: contacts.name, imported: contacts.importedFields }).from(contacts).where(eq(contacts.id, holderId));
    const people = await this.tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.sharesPhoneWith, holderId));
    let confirmed = !!h?.name && (!!h.imported?.avec || this.namesInFile(phone).some((n) => samePerson(n, h.name)));
    if (h?.name && !confirmed) {
      const r = await this.tx.execute(sql`select distinct client_name from appointments where contact_id = ${holderId} and origin = 'avec' and client_name is not null
        union select distinct client_name from client_packages where contact_id = ${holderId} and client_name is not null limit 200`);
      confirmed = (r.rows as { client_name: string }[]).some((x) => samePerson(x.client_name, h.name));
    }
    const n: NumberPeople = { holderId, holderName: h?.name ?? null, confirmed, people };
    this.numbers.set(phone, n);
    return n;
  }

  /**
   * A ficha da pessoa `name` no número de `holderId`: o titular (mesmo nome, apelido ou erro de digitação: `samePerson`), uma pessoa a mais
   * que já existe, ou uma pessoa a mais NOVA quando o nome é claramente de outra pessoa e o titular é uma cliente do Avec (`confirmed`).
   * Titular sem nome, ou com nome que não veio do Avec (o do WhatsApp, "Mãezinha"): fica no titular, como antes (na dúvida, não divide a cliente).
   */
  async personFor(phone: string, holderId: string, name: string | null, data: PersonData = {}): Promise<string> {
    return (await this.personRef(phone, holderId, name, data)).id;
  }

  /**
   * `personFor` com a identidade do Avec. Nome de uma cliente que saiu num "Unir cadastros" (com este telefone, ou pessoa a mais deste
   * titular): a que ficou, em vez de uma pessoa a mais nova.
   */
  async personRef(phone: string, holderId: string, name: string | null, data: PersonData = {}): Promise<ContactRef> {
    const m = this.merged.get(phone);
    const holder: ContactRef = { id: holderId, keyId: m && m.keptId === holderId ? m.droppedId : holderId };
    if (!name || !isUsableName(name)) return holder;
    const n = await this.numberOf(phone, holderId);
    const key = nameTokens(name).join(" ");
    const exact = n.people.find((p) => nameTokens(p.name).join(" ") === key);
    if (exact) return { id: exact.id, keyId: exact.id };
    if (!n.holderName || samePerson(name, n.holderName)) return holder;
    const similar = n.people.find((p) => samePerson(name, p.name));
    if (similar) return { id: similar.id, keyId: similar.id };
    const gone = await mergedPersonFor(this.tx, { phone, holderId, name });
    if (gone) return { id: gone.keptId, keyId: gone.droppedId };
    if (!n.confirmed) return holder;
    const r = await addPersonTx(this.tx, holderId, { name, ...data });
    n.people.push({ id: r.id, name });
    if (r.created) { this.newContacts.add(r.id); this.rememberName(r.id, name); this.summary.contatosNovos++; }
    return { id: r.id, keyId: r.id };
  }

  async contactByName(name: string): Promise<string | null> {
    return (await this.contactRefByName(name))?.id ?? null;
  }

  /**
   * Contato pelo nome (só se houver exatamente um). O nome de uma cliente que saiu num "Unir cadastros" conta como da que ficou: o mesmo
   * nome em outra cliente deixa ambíguo (null), como era antes de unir.
   */
  async contactRefByName(name: string): Promise<ContactRef | null> {
    if (!this.byName) {
      this.byName = new Map();
      const all = await this.tx.select({ id: contacts.id, name: contacts.name }).from(contacts);
      for (const c of all) {
        const k = normText(c.name);
        if (k) this.byName.set(k, [...(this.byName.get(k) ?? []), c.id]);
      }
    }
    if (!this.mergedNames) {
      this.mergedNames = new Map();
      for (const m of await allMerges(this.tx)) {
        const k = normText(m.droppedName);
        if (k) this.mergedNames.set(k, [...(this.mergedNames.get(k) ?? []), m]);
      }
    }
    const k = normText(name);
    const live = this.byName.get(k) ?? [], gone = this.mergedNames.get(k) ?? [];
    const ids = new Set([...live, ...gone.map((m) => m.keptId)]);
    if (ids.size !== 1) return null;
    const [id] = ids;
    return live.includes(id) ? { id, keyId: id } : { id, keyId: gone[0].droppedId };
  }
  /** Contato criado agora entra no índice por nome (se o índice já estiver carregado). */
  rememberName(id: string, name: string | null) {
    const k = normText(name);
    if (this.byName && k) this.byName.set(k, [...(this.byName.get(k) ?? []), id]);
  }

  /** Marca que a pessoa é cliente (e a data do atendimento, se houver). */
  evidence(contactId: string | null, day: string | null) {
    if (!contactId) return;
    const prev = this.clientEvidence.get(contactId);
    if (prev === undefined || (day && (!prev || day > prev))) this.clientEvidence.set(contactId, day ?? prev ?? null);
  }

  /** Etiqueta "Completar cadastro" (17/10): o Avec marcou o cadastro como incompleto no nome. */
  async tagCompleteProfile(contactId: string) {
    if (!this.completeTagId) {
      await this.tx.insert(tags).values({ name: COMPLETE_PROFILE_TAG }).onConflictDoNothing();
      const [t] = await this.tx.select({ id: tags.id }).from(tags).where(sql`lower(${tags.name}) = lower(${COMPLETE_PROFILE_TAG})`);
      this.completeTagId = t.id;
    }
    await this.tx.insert(contactTags).values({ contactId, tagId: this.completeTagId }).onConflictDoNothing();
  }

  /**
   * Contatos com o "(completar cadastro)" do Avec no nome (52 em 17/10): o sufixo sai (a mesma regra do script de dados 02), o contato
   * ganha a etiqueta "Completar cadastro", o recado entre parênteses vai para a observação e o nome antigo fica na auditoria. A importação
   * só preenche nome vazio, então o sufixo não volta. "completar" no meio do nome: fica para a recepção corrigir à mão.
   */
  async cleanCompleteProfileNames(): Promise<number> {
    const rows = await this.tx.select({ id: contacts.id, name: contacts.name, notes: contacts.notes }).from(contacts).where(sql`${contacts.name} ~* 'completar'`);
    let n = 0;
    for (const r of rows) {
      if (!r.name) continue;
      const s = stripCompleteProfile(r.name);
      if (!s.hit) continue;
      const notes = !s.note || (r.notes ?? "").toLowerCase().includes(s.note.toLowerCase()) ? r.notes : [r.notes?.trim(), `Do Avec: ${s.note}`].filter(Boolean).join("\n");
      await this.tx.update(contacts).set({ name: s.name, notes }).where(eq(contacts.id, r.id));
      await this.tagCompleteProfile(r.id);
      await this.tx.insert(auditLog).values({ userId: null, action: "corrigiu_nome", entity: "contacts", entityId: r.id, data: { antes: r.name, depois: s.name, motivo: "sufixo completar cadastro (Avec)" } });
      n++;
    }
    return n;
  }

  /** "(T. USO DE IMAGEM)" do Avec: grava o campo Uso de imagem = "sim" (data vazia). Quem já tem valor no CRM (sim ou não) não muda. */
  async tagImageUse(contactId: string) {
    await this.tx.update(contacts).set({ imageUse: "sim" }).where(and(eq(contacts.id, contactId), isNull(contacts.imageUse)));
  }

  /**
   * Contatos que ficaram com a observação do Avec no nome ("Fulana (T. USO DE IMAGEM)", do cadastro importado antes): nome limpo
   * e o campo Uso de imagem. Só mexe nesse sufixo; o resto do nome fica como está.
   */
  async cleanImageUseNames() {
    const rows = await this.tx.select({ id: contacts.id, name: contacts.name }).from(contacts)
      .where(sql`${contacts.name} ~* ${IMAGE_USE_SUFFIX}`);
    for (const r of rows) {
      const { name, imageUse } = splitClientName(r.name);
      if (!imageUse || !name) continue;
      await this.tx.update(contacts).set({ name }).where(eq(contacts.id, r.id));
      await this.tagImageUse(r.id);
    }
  }

  markCompleted(contactId: string) {
    if (this.newContacts.has(contactId) || this.completedContacts.has(contactId)) return;
    this.completedContacts.add(contactId);
    this.summary.contatosCompletados++;
  }

  /* ── profissionais ── */

  async professionals(): Promise<Pro[]> {
    if (!this.pros) this.pros = await this.tx.select({ id: professionals.id, name: professionals.name, fullName: professionals.fullName, role: professionals.role, avecId: professionals.avecId, active: professionals.active }).from(professionals);
    return this.pros;
  }

  /**
   * Profissional pelo nome como veio: apelido ("MAIARA") ou nome completo ("MAIARA DA SILVA SANTANA"). Se só o primeiro nome do
   * completo bate com um único apelido, vale ele. `create` cadastra pelo nome de tela quando não acha (agenda, bloqueios).
   */
  async professionalId(raw: string, opts: { create?: boolean } = {}): Promise<string | null> {
    const k = normText(raw);
    if (!k) return null;
    const pros = await this.professionals();
    const exact = pros.filter((p) => normText(p.name) === k || normText(p.fullName) === k);
    if (exact.length === 1) return exact[0].id;
    if (exact.length > 1) return exact.find((p) => normText(p.name) === k)?.id ?? null;
    const first = k.split(" ")[0];
    const byFirst = pros.filter((p) => normText(p.name) === first);
    if (k.includes(" ") && byFirst.length === 1) return byFirst[0].id;
    if (!opts.create) return null;
    const name = raw.trim().replace(/\s+/g, " ");
    // Nome que só aparece no histórico (agenda antiga, bloqueio): entra inativa, para não aparecer nas colunas da agenda nem ao Agendar.
    const [p] = await this.tx.insert(professionals).values({ name, active: false }).returning();
    pros.push({ id: p.id, name: p.name, fullName: null, role: null, avecId: null, active: false });
    this.summary.profissionais++;
    return p.id;
  }

  /* ── serviços ── */

  async serviceMap(): Promise<Map<string, Service>> {
    if (!this.services) {
      const all = await this.tx.select({ id: lists.id, label: lists.label, category: lists.category, priceCents: lists.priceCents, durationMin: lists.durationMin })
        .from(lists).where(eq(lists.kind, "service"));
      this.services = new Map(all.map((s) => [normText(s.label), s]));
    }
    return this.services;
  }

  /** Serviço pelo nome (sem diferenciar acento/caixa). `create` cadastra o que falta, com a categoria se vier. */
  async serviceId(raw: string, opts: { create?: boolean; category?: string | null } = {}): Promise<string | null> {
    const k = normText(raw);
    if (!k) return null;
    const map = await this.serviceMap();
    const found = map.get(k);
    if (found) {
      if (!found.category && opts.category) {
        await this.tx.update(lists).set({ category: opts.category }).where(and(eq(lists.id, found.id), sql`${lists.category} is null`));
        found.category = opts.category;
        this.summary.servicos++;
      }
      return found.id;
    }
    if (!opts.create) return null;
    const label = raw.trim().replace(/\s+/g, " ");
    const [{ max }] = await this.tx.select({ max: sql<number>`coalesce(max(${lists.position}), -1)::int` }).from(lists).where(eq(lists.kind, "service"));
    const [s] = await this.tx.insert(lists).values({ kind: "service", label, position: max + 1, category: opts.category ?? null }).onConflictDoNothing().returning();
    if (!s) return null;
    map.set(k, { id: s.id, label: s.label, category: s.category, priceCents: null, durationMin: null });
    this.summary.servicos++;
    return s.id;
  }

  /** Dia (aaaa-mm-dd) da primeira coluna de data encontrada na linha. */
  dayOf(row: string[], ...names: string[]) { return dateIso(this.cell(row, this.col(...names))); }
}

/** Busca em pedaços (o Postgres aceita muitos parâmetros, mas não infinitos). */
export async function inChunks<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

/** Conta ocorrências da mesma chave no arquivo: a 2ª linha idêntica vira "chave#2" (duas escovas iguais na mesma comanda são duas vendas). */
export function occurrenceKeys() {
  const seen = new Map<string, number>();
  return (base: string) => { const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return n > 1 ? `${base}#${n}` : base; };
}

