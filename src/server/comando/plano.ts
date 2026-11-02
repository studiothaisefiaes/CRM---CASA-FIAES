import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { appointments, contacts, deals, lists, professionals } from "../db/schema";
import { UserFacingError } from "../domain/errors";
import { funcaoLigada } from "../domain/funcoes";
import { listBookableServices } from "../queries/agenda";
import { listProfessionals } from "../domain/professionals";
import { createVisit, cancelAppointments, rescheduleAppointment } from "../domain/agenda/visits";
import { resume } from "../domain/retomada";
import { addNote } from "../domain/notes";
import { archiveConversation } from "../domain/conversation-archive";
import { can } from "../../lib/permissions";
import { interpretar, type Acao, type Caller, type Catalogo, type Interpretacao } from "./interpretar";

/** Cliente candidata (nome parecido): a tela pede para escolher quando há mais de uma. */
export type Candidata = { contactId: string; name: string; phone: string | null; dealId: string | null };
export type Plano = {
  acao: Acao; frase: string;
  candidatas: Candidata[];
  servicoId: string | null; servico: string | null; profissionalId: string | null; profissional: string | null;
  /** ISO do início (marcar, remarcar, retomar). */ inicio: string | null; duracaoMin: number | null;
  texto: string | null;
  /** O horário que vai ser mexido (remarcar, cancelar), por cliente. */ horarios: Record<string, { id: string; label: string } | null>;
  /** O que impede de confirmar (a tela mostra e não deixa confirmar). */ faltando: string[];
  aviso: string | null;
};

const PERM: Record<Acao, string | null> = { marcar: "agenda.marcar", remarcar: "agenda.marcar", cancelar: "agenda.marcar", retomar: "atendimento.ver", nota: "atendimento.ver", resolver: "atendimento.ver", abrir: "atendimento.ver", nao_entendi: null };
const fmt = (d: Date) => d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" }).replace(/,/g, "");
const toIso = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);

export async function catalogo(): Promise<Catalogo> {
  const [pros, svcs] = await Promise.all([listProfessionals(), listBookableServices()]);
  return { profissionais: pros.map((p) => ({ id: p.id, name: p.name })), servicos: svcs.map((s) => ({ id: s.id, label: s.label })) };
}

/** Clientes pelo nome (todas as palavras, sem acento) ou pelo telefone; até 5, as com conversa mais recente primeiro. */
export async function buscarClientes(nome: string | null, telefone: string | null): Promise<Candidata[]> {
  const digits = (telefone ?? "").replace(/\D/g, "");
  const words = (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  if (!words.length && digits.length < 8) return [];
  const norm = sql`translate(lower(coalesce(${contacts.name}, '') || ' ' || coalesce(${contacts.nickname}, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
  const conds = digits.length >= 8 ? [sql`regexp_replace(coalesce(${contacts.phoneE164}, ''), '\\D', '', 'g') like ${"%" + digits.slice(-8)}`]
    : words.map((w) => sql`${norm} like ${"%" + w + "%"}`);
  const rows = await db.select({ contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164 }).from(contacts)
    .where(and(eq(contacts.kind, "cliente"), eq(contacts.ignored, false), ...conds))
    .orderBy(desc(sql`(select max(coalesce(d.last_inbound_at, d.created_at)) from deals d where d.contact_id = ${contacts.id})`)).limit(5);
  const out: Candidata[] = [];
  for (const r of rows) {
    const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, r.contactId), isNull(deals.archivedAt)))
      .orderBy(sql`${deals.closedAt} is not null`, desc(deals.createdAt)).limit(1);
    out.push({ contactId: r.contactId, name: r.name ?? r.phone ?? "Sem nome", phone: r.phone, dealId: d?.id ?? null });
  }
  return out;
}

/** O próximo horário ativo da cliente (o que remarcar/cancelar mexe). */
async function proximoHorario(contactId: string, now: Date) {
  const [a] = await db.select({ id: appointments.id, startsAt: appointments.startsAt, label: appointments.serviceLabel, pro: professionals.name }).from(appointments)
    .leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .where(and(eq(appointments.contactId, contactId), inArray(appointments.status, ["solicitado", "agendado", "confirmado"]), isNull(appointments.avecTwinOf), gte(appointments.startsAt, new Date(now.getTime() - 3_600_000))))
    .orderBy(asc(appointments.startsAt)).limit(1);
  return a ? { id: a.id, label: `${a.label}${a.pro ? ` com ${a.pro}` : ""}, ${fmt(a.startsAt)}` } : null;
}

export async function montarPlano(i: Interpretacao, frase: string, cat: Catalogo, now = new Date()): Promise<Plano> {
  const svc = cat.servicos.find((s) => s.id === i.servico_id) ?? null;
  const pro = cat.profissionais.find((p) => p.id === i.profissional_id) ?? null;
  const inicio = i.data && i.hora ? toIso(i.data, i.hora) : i.data && i.acao === "retomar" ? toIso(i.data, "10:00") : null;
  const fim = i.data && i.hora_fim ? toIso(i.data, i.hora_fim) : null;
  const duracaoMin = inicio && fim && fim > inicio ? Math.round((fim.getTime() - inicio.getTime()) / 60_000) : null;
  const candidatas = i.acao === "nao_entendi" ? [] : await buscarClientes(i.cliente, i.telefone);
  const faltando: string[] = [];
  if (i.acao === "nao_entendi") faltando.push(i.duvida ?? "Não entendi o pedido. Fale de novo dizendo o que fazer e com quem.");
  else if (!candidatas.length) faltando.push(i.cliente ? `Não achei a cliente "${i.cliente}". Diga o nome completo ou o telefone.` : "Diga o nome da cliente.");
  if (i.acao === "marcar") {
    if (!svc) faltando.push("Qual serviço?");
    if (!pro) faltando.push("Com qual profissional?");
    if (!inicio) faltando.push("Que dia e hora?");
  }
  if (i.acao === "remarcar" && !inicio) faltando.push("Para que dia e hora?");
  if (i.acao === "retomar" && !inicio) faltando.push("Retomar em que dia?");
  if (i.acao === "nota" && !i.texto?.trim()) faltando.push("O que anotar?");
  if (inicio && inicio.getTime() < now.getTime() - 60_000 && i.acao !== "nota") faltando.push(`${fmt(inicio)} já passou.`);
  const horarios: Plano["horarios"] = {};
  if (i.acao === "remarcar" || i.acao === "cancelar") {
    for (const c of candidatas) horarios[c.contactId] = await proximoHorario(c.contactId, now);
    if (candidatas.length === 1 && !horarios[candidatas[0].contactId]) faltando.push(`${candidatas[0].name} não tem horário marcado para ${i.acao === "cancelar" ? "cancelar" : "remarcar"}.`);
  }
  const aviso = i.acao === "retomar" && await funcaoLigada("retomada_ia") ? "Com a Retomada pela IA ligada, no dia a IA escreve e envia a mensagem sozinha." : null;
  return { acao: i.acao, frase, candidatas, servicoId: svc?.id ?? null, servico: svc?.label ?? null, profissionalId: pro?.id ?? null, profissional: pro?.name ?? null,
    inicio: inicio?.toISOString() ?? null, duracaoMin, texto: i.texto?.trim() || null, horarios, faltando, aviso };
}

export async function planejar(frase: string, userId: string, now = new Date(), caller?: Caller): Promise<Plano> {
  const cat = await catalogo();
  return montarPlano(await interpretar(frase, cat, userId, now, caller), frase, cat, now);
}

export type Quem = { id: string; perms: readonly string[] };
export type Feito = { mensagem: string; dealId: string | null; url: string | null };

/** Executa o plano confirmado. Tudo é reconferido aqui (a tela só manda o plano e a cliente escolhida). */
export async function executar(p: Plano, contactId: string, quem: Quem, now = new Date()): Promise<Feito> {
  const perm = PERM[p.acao];
  if (!perm) throw new UserFacingError("Não entendi o pedido.");
  if (!can(quem.perms, perm as never)) throw new UserFacingError("Você não tem permissão para isso.");
  const c = (await buscarPorId(contactId));
  const dealId = c.dealId;
  const inicio = p.inicio ? new Date(p.inicio) : null;
  const url = dealId ? `/atendimento?lead=${dealId}` : null;
  switch (p.acao) {
    case "marcar": {
      if (!p.servicoId || !p.profissionalId || !inicio) throw new UserFacingError("Falta serviço, profissional ou horário.");
      const [s] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.id, p.servicoId), eq(lists.kind, "service"), eq(lists.active, true)));
      if (!s) throw new UserFacingError("Esse serviço não está mais ativo.");
      const r = await createVisit({ requestKey: randomUUID(), client: { contactId }, dealId, startsAt: inicio.toISOString(),
        items: [{ serviceId: p.servicoId, professionalId: p.profissionalId, ...(p.duracaoMin ? { durationMin: p.duracaoMin } : {}) }] }, quem, now);
      return { mensagem: `Marcado: ${c.name}, ${p.servico} com ${p.profissional}, ${fmt(inicio)}.`, dealId, url: `/agenda?d=${r.day}&destaque=${r.appointmentIds[0] ?? ""}` };
    }
    case "remarcar": case "cancelar": {
      const h = await proximoHorario(contactId, now);
      if (!h) throw new UserFacingError(`${c.name} não tem horário marcado.`);
      if (p.acao === "cancelar") {
        await cancelAppointments({ appointmentId: h.id, reason: "cliente_desmarcou", note: p.texto?.slice(0, 200) || null }, quem, now);
        return { mensagem: `Cancelado: ${h.label}.`, dealId, url };
      }
      if (!inicio) throw new UserFacingError("Falta o novo horário.");
      await rescheduleAppointment(h.id, { startsAt: inicio.toISOString(), ...(p.profissionalId ? { professionalId: p.profissionalId, confirmProChange: true } : {}), ...(p.duracaoMin ? { durationMin: p.duracaoMin } : {}) }, quem, now);
      return { mensagem: `Remarcado para ${fmt(inicio)}.`, dealId, url };
    }
    case "retomar": {
      if (!dealId || !inicio) throw new UserFacingError("Falta a conversa ou o dia.");
      await resume(dealId, { dueAt: inicio, motivo: p.texto ? p.texto.slice(0, 200) : null, ia: p.texto }, quem.id, now);
      return { mensagem: `Retomada marcada para ${fmt(inicio)}.`, dealId, url };
    }
    case "nota": {
      if (!dealId || !p.texto) throw new UserFacingError("Falta a conversa ou o texto.");
      await addNote({ dealId, body: p.texto.slice(0, 4000) }, quem.id, now);
      return { mensagem: `Nota salva em ${c.name}.`, dealId, url };
    }
    case "resolver": {
      if (!dealId) throw new UserFacingError("Essa cliente não tem conversa aberta.");
      await archiveConversation(dealId, quem.id);
      return { mensagem: `Conversa de ${c.name} resolvida.`, dealId, url };
    }
    case "abrir":
      if (!url) throw new UserFacingError("Essa cliente não tem conversa.");
      return { mensagem: `Abrindo ${c.name}.`, dealId, url };
    default:
      throw new UserFacingError("Não entendi o pedido.");
  }
}

async function buscarPorId(contactId: string): Promise<Candidata> {
  const [r] = await db.select({ contactId: contacts.id, name: contacts.name, phone: contacts.phoneE164, ignored: contacts.ignored }).from(contacts).where(eq(contacts.id, contactId));
  if (!r || r.ignored) throw new UserFacingError("Cliente não encontrada.");
  const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.contactId, contactId), isNull(deals.archivedAt)))
    .orderBy(sql`${deals.closedAt} is not null`, desc(deals.createdAt)).limit(1);
  return { contactId: r.contactId, name: r.name ?? r.phone ?? "Sem nome", phone: r.phone, dealId: d?.id ?? null };
}
