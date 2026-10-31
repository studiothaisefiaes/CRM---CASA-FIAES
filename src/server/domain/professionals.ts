import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { appointments, auditLog, contacts, lists, professionals, professionalServices } from "../db/schema";
import { UserFacingError } from "./errors";
import { isPaletteKey, type PaletteKey } from "../../lib/palette";
import { workHoursSchema, type WorkHours } from "../../lib/work-hours";
import { isUuid } from "../../lib/uuid";
import { firstName } from "@/lib/authorship";
import { displayName } from "@/lib/display-name";
import { photoVersionOf } from "@/lib/pro-photo";
import { revokeUserTx } from "./pro/access";
import { assertFuncao } from "./funcoes";
import { SERVICE_DURATION_MAX, SERVICE_PRICE_MAX_CENTS } from "./service-details";
import { cnpjDigits, isValidCnpj } from "@/lib/cnpj";
import { PAYOUT_PERIODS, type PayoutPeriod } from "@/lib/payout-period";

/**
 * `name` é o nome de tela (no Avec, o apelido: "MAIARA"); `fullName` e `role` (cargo) são opcionais. Nunca CPF/banco.
 * `workHours` vazio = segue o horário da Casa; `color` é uma chave da paleta; `agendaPosition` vazio = pelo nome.
 */
export type Professional = {
  id: string; name: string; fullName: string | null; role: string | null; active: boolean; serviceIds: string[];
  workHours: WorkHours | null; color: PaletteKey | null; agendaPosition: number | null;
  /** Versão da foto (6B.16); null = sem foto. */ photoVersion: string | null;
  /** De quem é assistente (17/10); null = atende em nome próprio. */ assistantOf: string | null;
  /** Assistente só quando atende junto (29/10, Maiara com Thaise): na visita com esta principal, a cliente vê a principal. */ assistsWith: string | null;
  /** Dados fiscais (Fase D): vínculo, CNPJ (14 dígitos) e razão social da parceira. */ bond: Bond | null; cnpj: string | null; legalName: string | null;
  /** Período do repasse da comissão (Fase A): a data sugerida no "A pagar" é o fim do último período fechado. */ payoutPeriod: PayoutPeriod;
};
export type Bond = "parceira" | "clt" | "outro";
const BONDS: readonly string[] = ["parceira", "clt", "outro"];
const LEGAL_NAME_MAX = 150;

const toProfessional = (p: typeof professionals.$inferSelect, serviceIds: string[]): Professional => ({
  id: p.id, name: p.name, fullName: p.fullName, role: p.role, active: p.active, serviceIds,
  workHours: p.workHours ?? null, color: isPaletteKey(p.color) ? p.color : null, agendaPosition: p.agendaPosition,
  photoVersion: photoVersionOf(p.photoPath), assistantOf: p.assistantOf ?? null, assistsWith: p.assistsWith ?? null, payoutPeriod: isPayoutPeriod(p.payoutPeriod) ? p.payoutPeriod : "mensal",
  bond: (BONDS.includes(p.bond ?? "") ? p.bond : null) as Bond | null, cnpj: p.cnpj ?? null, legalName: p.legalName ?? null,
});
const isPayoutPeriod = (v: unknown): v is PayoutPeriod => PAYOUT_PERIODS.includes(v as PayoutPeriod);

/**
 * Profissionais do salão (quem faz o serviço), na ordem da agenda: primeiro as que têm ordem, depois pelo nome.
 * Por padrão só as ativas; `all` traz também as desativadas (Configurações).
 */
export async function listProfessionals(opts: { all?: boolean } = {}): Promise<Professional[]> {
  const [rows, links] = await Promise.all([
    db.select().from(professionals).where(opts.all ? undefined : eq(professionals.active, true))
      .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name)),
    db.select({ professionalId: professionalServices.professionalId, serviceId: professionalServices.serviceId }).from(professionalServices),
  ]);
  return rows.map((p) => toProfessional(p, links.filter((l) => l.professionalId === p.id).map((l) => l.serviceId)));
}

async function lockProfessional(tx: Tx, id: string) {
  const [p] = isUuid(id) ? await tx.select().from(professionals).where(eq(professionals.id, id)).for("update") : [];
  if (!p) throw new UserFacingError("Profissional não encontrada.");
  return p;
}

/**
 * Horário de trabalho próprio (validado: até 2 faixas por dia, entre 06:00 e 24:00). `null` = "Igual ao da Casa".
 * Duas pessoas salvando ao mesmo tempo: vale o último, e as duas gravações ficam na auditoria com o de/para.
 */
export async function setWorkHours(id: string, hours: unknown, userId: string): Promise<void> {
  let value: WorkHours | null = null;
  if (hours != null) {
    const r = workHoursSchema.safeParse(hours);
    if (!r.success) throw new UserFacingError(r.error.issues[0]?.message ?? "Confira o horário de trabalho.");
    value = r.data;
  }
  await db.transaction(async (tx) => {
    const p = await lockProfessional(tx, id);
    await tx.update(professionals).set({ workHours: value }).where(eq(professionals.id, id));
    await tx.insert(auditLog).values({ userId, action: "horario_profissional", entity: "professional", entityId: id, data: { de: p.workHours ?? null, para: value } });
  });
}

/** Cor (da paleta fechada) e ordem na agenda (1 a 999). `null` apaga: sem cor, e a ordem volta a ser pelo nome. */
export async function setAppearance(id: string, patch: { color?: string | null; agendaPosition?: number | null }, userId: string): Promise<void> {
  const set: Partial<typeof professionals.$inferInsert> = {};
  if (patch.color !== undefined) {
    if (patch.color !== null && !isPaletteKey(patch.color)) throw new UserFacingError("Escolha uma cor da paleta.");
    set.color = patch.color;
  }
  if (patch.agendaPosition !== undefined) {
    const v = patch.agendaPosition;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 999)) throw new UserFacingError("Use um número de 1 a 999 na ordem.");
    set.agendaPosition = v;
  }
  await db.transaction(async (tx) => {
    const p = await lockProfessional(tx, id);
    if (!Object.keys(set).length) return;
    await tx.update(professionals).set(set).where(eq(professionals.id, id));
    await tx.insert(auditLog).values({ userId, action: "aparencia_profissional", entity: "professional", entityId: id, data: { de: { color: p.color, agendaPosition: p.agendaPosition }, para: set } });
  });
}

/** Marca ou desmarca UM serviço da profissional (matriz Quem faz o quê). Vínculo feito aqui é manual; repetir não muda nada. */
export async function setProfessionalService(professionalId: string, serviceId: string, on: boolean, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockProfessional(tx, professionalId);
    await assertServices(tx, [serviceId]);
    const changed = on
      ? await tx.insert(professionalServices).values({ professionalId, serviceId, source: "manual", createdBy: userId }).onConflictDoNothing().returning()
      : await tx.delete(professionalServices).where(and(eq(professionalServices.professionalId, professionalId), eq(professionalServices.serviceId, serviceId))).returning();
    if (!changed.length) return;
    await tx.insert(auditLog).values({ userId, action: "profissional_servico", entity: "professional", entityId: professionalId, data: { serviceId, faz: on } });
  });
}

/** Aba Tempos (Cati 30/10): cada serviço de cada profissional ativa, com o tempo dela e o do serviço. Assistente fica de fora: não tem horário próprio. */
export type ProServiceTime = { professionalId: string; professionalName: string; serviceId: string; serviceLabel: string; category: string | null; own: number | null; base: number | null };
export async function listProServiceTimes(): Promise<ProServiceTime[]> {
  return db.select({ professionalId: professionals.id, professionalName: professionals.name, serviceId: lists.id, serviceLabel: lists.label, category: lists.category, own: professionalServices.durationMin, base: lists.durationMin })
    .from(professionalServices).innerJoin(professionals, eq(professionals.id, professionalServices.professionalId)).innerJoin(lists, eq(lists.id, professionalServices.serviceId))
    .where(and(eq(professionals.active, true), isNull(professionals.assistantOf), eq(lists.active, true))).orderBy(asc(professionals.name), asc(lists.label));
}

/** Tempo próprio da profissional: de 5 min (o passo da Agenda) a 12 h, como o CHECK do 0084. */
export const PRO_DURATION_MIN = 5;

/**
 * Preço e tempo próprios da profissional num serviço que ela faz (0084, Fase C item 24; Serviços › Quem faz). Cada campo é opcional:
 * `undefined` não mexe, `null` volta ao do serviço. Precisa da função "Preço e tempo por profissional" ligada; a action confere a
 * permissão `servicos.por_profissional`. Fica na auditoria com o de/para.
 */
export async function setProfessionalServiceTerms(professionalId: string, serviceId: string, patch: { priceCents?: number | null; durationMin?: number | null }, userId: string): Promise<void> {
  const set: { priceCents?: number | null; durationMin?: number | null } = {};
  if (patch.priceCents !== undefined) {
    const v = patch.priceCents;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > SERVICE_PRICE_MAX_CENTS)) throw new UserFacingError("Confira o preço: use um valor como 150,00.");
    set.priceCents = v;
  }
  if (patch.durationMin !== undefined) {
    const v = patch.durationMin;
    if (v !== null && (!Number.isInteger(v) || v < PRO_DURATION_MIN || v > SERVICE_DURATION_MAX)) throw new UserFacingError(`Confira o tempo: de ${PRO_DURATION_MIN} a ${SERVICE_DURATION_MAX} minutos.`);
    set.durationMin = v;
  }
  if (!isUuid(serviceId)) throw new UserFacingError("Escolha só serviços da lista de Serviços.");
  await db.transaction(async (tx) => {
    await assertFuncao("preco_por_profissional", tx);
    const p = await lockProfessional(tx, professionalId);
    await assertServices(tx, [serviceId]);
    const where = and(eq(professionalServices.professionalId, professionalId), eq(professionalServices.serviceId, serviceId));
    const [link] = await tx.select({ priceCents: professionalServices.priceCents, durationMin: professionalServices.durationMin }).from(professionalServices).where(where).for("update");
    if (!link) throw new UserFacingError(`${displayName(p.name)} não faz esse serviço. Marque em Quem faz antes.`);
    if (!Object.keys(set).length) return;
    await tx.update(professionalServices).set(set).where(where);
    await tx.insert(auditLog).values({ userId, action: "profissional_servico_valores", entity: "professional", entityId: professionalId, data: { serviceId, de: link, para: { ...link, ...set } } });
  });
}

async function assertServices(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: lists.id }).from(lists).where(and(inArray(lists.id, ids), eq(lists.kind, "service")));
  if (found.length !== new Set(ids).size) throw new UserFacingError("Escolha só serviços da lista de Serviços.");
}

const cleanName = (n: string) => {
  const name = n.trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da profissional.");
  if (name.length > 60) throw new UserFacingError("Use até 60 caracteres no nome.");
  return name;
};

/** Campo opcional (nome completo, cargo): espaços únicos; vazio = não informado. */
const cleanOptional = (v: string | null | undefined, max: number, what: string) => {
  const s = (v ?? "").trim().replace(/\s+/g, " ");
  if (s.length > max) throw new UserFacingError(`Use até ${max} caracteres no ${what}.`);
  return s || null;
};
const FULL_NAME_MAX = 120, ROLE_MAX = 60;

export async function createProfessional(input: { name: string; fullName?: string | null; role?: string | null; serviceIds: string[] }, userId: string): Promise<Professional> {
  const name = cleanName(input.name);
  const fullName = cleanOptional(input.fullName, FULL_NAME_MAX, "nome completo");
  const role = cleanOptional(input.role, ROLE_MAX, "cargo");
  const serviceIds = [...new Set(input.serviceIds)];
  return db.transaction(async (tx) => {
    await assertServices(tx, serviceIds);
    const [p] = await tx.insert(professionals).values({ name, fullName, role }).returning();
    if (serviceIds.length) await tx.insert(professionalServices).values(serviceIds.map((serviceId) => ({ professionalId: p.id, serviceId, createdBy: userId })));
    await tx.insert(auditLog).values({ userId, action: "criou_profissional", entity: "professional", entityId: p.id, data: { name, fullName, role, serviceIds } });
    return toProfessional(p, serviceIds);
  });
}

const DM_HM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/**
 * Assistente de outra profissional (17/10). Recusa: a própria; principal que já é assistente (sem cadeia); e virar assistente quem já
 * tem assistente. A principal precisa estar ativa.
 */
async function assertAssistantOf(tx: Tx, id: string, principalId: string) {
  if (principalId === id) throw new UserFacingError("Escolha outra profissional: ela não pode ser assistente de si mesma.");
  const [p] = isUuid(principalId) ? await tx.select({ name: professionals.name, active: professionals.active, assistantOf: professionals.assistantOf }).from(professionals).where(eq(professionals.id, principalId)) : [];
  if (!p || !p.active) throw new UserFacingError("Essa profissional não está mais disponível. Escolha outra.");
  if (p.assistantOf) {
    const [boss] = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, p.assistantOf));
    throw new UserFacingError(`${displayName(p.name)} já é assistente de ${displayName(boss?.name ?? "outra profissional")}. Escolha a principal.`);
  }
  const helpers = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.assistantOf, id));
  if (helpers.length) {
    const [me] = await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, id));
    throw new UserFacingError(`${displayName(me?.name ?? "Ela")} tem assistente (${helpers.map((h) => displayName(h.name)).join(", ")}): tire antes esse vínculo.`);
  }
}

export async function updateProfessional(id: string, input: { name?: string; fullName?: string | null; role?: string | null; serviceIds?: string[]; active?: boolean; force?: boolean; assistantOf?: string | null; assistsWith?: string | null; bond?: Bond | null; cnpj?: string | null; legalName?: string | null; payoutPeriod?: PayoutPeriod }, userId: string, now = new Date()): Promise<void> {
  if (input.payoutPeriod !== undefined && !isPayoutPeriod(input.payoutPeriod)) throw new UserFacingError("Escolha Mensal, Quinzenal ou Semanal.");
  await db.transaction(async (tx) => {
    // 6.4, regra 14: desativar com horários futuros é recusado com a lista; a gestão pode forçar, e fica registrado.
    if (input.active === false) {
      const future = await tx.select({ startsAt: appointments.startsAt, clientName: appointments.clientName, contactName: contacts.name })
        .from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId))
        .where(and(eq(appointments.professionalId, id), gt(appointments.startsAt, now), inArray(appointments.status, ["agendado", "confirmado", "solicitado", "conferir"]), isNull(appointments.avecTwinOf)))
        .orderBy(asc(appointments.startsAt));
      if (future.length && !input.force) {
        const lista = future.slice(0, 5).map((f) => `${firstName(f.contactName ?? f.clientName) ?? "Cliente"} ${DM_HM.format(f.startsAt).replace(",", "")}`).join(", ");
        throw new UserFacingError(`Ela tem ${future.length} ${future.length === 1 ? "horário marcado" : "horários marcados"}: remarque antes. ${lista}${future.length > 5 ? ", …" : ""}`);
      }
      if (future.length) await tx.insert(auditLog).values({ userId, action: "profissional_desativada_com_horarios", entity: "professional", entityId: id, data: { horarios: future.length } });
    }
    const { force: _force, ...patch } = input;
    const set: Partial<typeof professionals.$inferInsert> = {};
    if (patch.name !== undefined) set.name = cleanName(patch.name);
    if (patch.fullName !== undefined) set.fullName = cleanOptional(patch.fullName, FULL_NAME_MAX, "nome completo");
    if (patch.role !== undefined) set.role = cleanOptional(patch.role, ROLE_MAX, "cargo");
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.assistantOf !== undefined) {
      if (patch.assistantOf) await assertAssistantOf(tx, id, patch.assistantOf);
      set.assistantOf = patch.assistantOf;
    }
    if (patch.assistsWith !== undefined) {
      if (patch.assistsWith === id) throw new UserFacingError("Escolha outra profissional.");
      if (patch.assistsWith) { const [p] = await tx.select({ id: professionals.id }).from(professionals).where(eq(professionals.id, patch.assistsWith)); if (!p) throw new UserFacingError("Essa profissional não existe mais."); }
      set.assistsWith = patch.assistsWith;
    }
    // Dados fiscais: vínculo "parceira" (salão-parceiro, Lei 13.352/2016) exige o CNPJ válido dela, o que já está gravado ou o novo.
    if (patch.bond !== undefined || patch.cnpj !== undefined || patch.legalName !== undefined) {
      const [cur] = await tx.select({ bond: professionals.bond, cnpj: professionals.cnpj }).from(professionals).where(eq(professionals.id, id));
      if (patch.bond !== undefined && patch.bond !== null && !BONDS.includes(patch.bond)) throw new UserFacingError("Escolha Parceira, CLT ou Outro.");
      const cnpj = patch.cnpj !== undefined ? (patch.cnpj ? cnpjDigits(patch.cnpj) : null) : cur?.cnpj ?? null;
      const bond = patch.bond !== undefined ? patch.bond : cur?.bond ?? null;
      if (cnpj && !isValidCnpj(cnpj)) throw new UserFacingError("CNPJ inválido.");
      if (bond === "parceira" && !cnpj) throw new UserFacingError("Parceira precisa do CNPJ dela.");
      if (patch.bond !== undefined) set.bond = patch.bond;
      if (patch.cnpj !== undefined) { set.cnpj = cnpj; patch.cnpj = cnpj; }
      if (patch.legalName !== undefined) {
        const n = (patch.legalName ?? "").trim().replace(/\s+/g, " ");
        if (n.length > LEGAL_NAME_MAX) throw new UserFacingError(`Use até ${LEGAL_NAME_MAX} caracteres na razão social.`);
        set.legalName = n || null; patch.legalName = n || null;
      }
    }
    // Período do repasse (Fase A): mexe na data sugerida para pagar a comissão, então grava de/para (a ação pede comissao.pagar).
    if (patch.payoutPeriod !== undefined) {
      const [old] = await tx.select({ v: professionals.payoutPeriod }).from(professionals).where(eq(professionals.id, id)).for("update");
      if (old && old.v !== patch.payoutPeriod) {
        set.payoutPeriod = patch.payoutPeriod;
        await tx.insert(auditLog).values({ userId, action: "profissional_repasse", entity: "professional", entityId: id, data: { de: old.v, para: patch.payoutPeriod } });
      }
    }
    if (Object.keys(set).length) await tx.update(professionals).set(set).where(eq(professionals.id, id));
    if (patch.serviceIds) {
      // Só a diferença: o vínculo que continua mantém de onde veio (à mão ou sugestão do Avec) e quando.
      const serviceIds = [...new Set(patch.serviceIds)];
      await assertServices(tx, serviceIds);
      await tx.delete(professionalServices).where(and(eq(professionalServices.professionalId, id), serviceIds.length ? notInArray(professionalServices.serviceId, serviceIds) : undefined));
      if (serviceIds.length) await tx.insert(professionalServices).values(serviceIds.map((serviceId) => ({ professionalId: id, serviceId, createdBy: userId }))).onConflictDoNothing();
    }
    // Lote 7A: profissional desativada perde o acesso ao app na hora (sessão cai, convite antigo morre).
    if (patch.active === false) {
      const [linked] = await tx.select({ userId: professionals.userId }).from(professionals).where(eq(professionals.id, id));
      if (linked?.userId) await revokeUserTx(tx, linked.userId);
    }
    await tx.insert(auditLog).values({ userId, action: "editou_profissional", entity: "professional", entityId: id, data: patch });
  });
}

/** Ao agendar: a profissional existe, está ativa e (se veio serviço) faz aquele serviço. */
export async function assertProfessionalFor(tx: Tx, professionalId: string, serviceId: string | null) {
  const [p] = await tx.select({ active: professionals.active, name: professionals.name }).from(professionals).where(eq(professionals.id, professionalId));
  if (!p || !p.active) throw new UserFacingError("Essa profissional não está mais disponível. Escolha outra.");
  if (!serviceId) return;
  const links = await tx.select({ professionalId: professionalServices.professionalId }).from(professionalServices).where(eq(professionalServices.serviceId, serviceId));
  // Serviço que ainda ninguém cadastrou como "faz" (ex.: Método Fiaes antes do cadastro de quem faz o quê): qualquer profissional ativa pode.
  if (links.length && !links.some((l) => l.professionalId === professionalId)) throw new UserFacingError(`${p.name.split(" ")[0]} não faz esse serviço. Escolha outra profissional ou outro serviço.`);
}
