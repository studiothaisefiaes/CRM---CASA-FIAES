import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { APPOINTMENT_MARKS, checkCancel, checkTransition, RECEPTION_CANCEL_REASONS } from "@/lib/appointment-status";
import { PREFERENCES } from "@/lib/appointment-preference";
import { VISIT_TYPES } from "@/lib/visit-type";
import { displayName } from "@/lib/display-name";
import { db } from "../../db";
import { appointments, deals } from "../../db/schema";
import { listAppointments, type AppointmentItem } from "../../queries/avec";
import { listBookableServices, listServicePrices } from "../../queries/agenda";
import { listProfessionals } from "../../domain/professionals";
import { cancelAppointments, createVisit, ExistingAppointmentError, MAX_ITEMS, rescheduleAppointment } from "../../domain/agenda/visits";
import { setAppointmentStatus, updateAppointmentNotes } from "../../domain/appointments";
import { getLembreteD1 } from "../../domain/client-link/settings";
import { afterVisitOn, getAfterVisit } from "../../domain/after-visit";
import { ApiErro, fimDe, inicioDe, isoBahia, rotaApi, zDiaOuInstante, zId, zInstante, zLista, zUm, zUuid, zInstanteSaida } from "../rota";
import { zPessoa } from "./comum";
import { noEscopoDaLista } from "./conversas";

/**
 * Agenda pela API: os mesmos caminhos da tela da Agenda (createVisit, rescheduleAppointment, setAppointmentStatus, cancelAppointments,
 * updateAppointmentNotes), com o mesmo "ator" ({ id, perms } da pessoa da chave): encaixe só com agenda.encaixar, marcador só com
 * agenda.marcador, modo "só consulta" recusa marcar e remarcar. Ler a agenda pede Ver Conversas (atendimento.ver), como a tela.
 */
const GRUPO = "Agenda";
/** O valor do Finalizado (a tela fala Finalizado; o valor guardado é outro). */
const FINALIZADO = "compareceu";
const SITUACOES = ["solicitado", "agendado", "confirmado", "chegou", "em_atendimento", FINALIZADO, "faltou", "cancelado"];
const MAX_DIAS = 62;

const zHorario = z.object({
  id: z.uuid(),
  inicio: zInstanteSaida,
  duracao_min: z.number().int().nullable(),
  status: z.string().meta({ description: `Situação do horário: ${SITUACOES.join(", ")}… (o Finalizado da tela é ${FINALIZADO}).` }),
  contato: z.object({ id: z.uuid().nullable(), nome: z.string(), telefone: z.string().nullable() }),
  profissional: zPessoa,
  qualquer_profissional: z.boolean(),
  preferencia: z.enum(PREFERENCES).nullable(),
  servico: z.object({ id: z.uuid().nullable(), nome: z.string() }),
  valor_centavos: z.number().int().nullable(),
  observacao: z.string().nullable(),
  origem: z.string().meta({ description: "crm ou avec." }),
  conversa_id: z.uuid().nullable(),
  visita_id: z.uuid().nullable(),
  encaixe: z.boolean(),
  fora_do_horario: z.boolean(),
  confirmado_via: z.string().nullable(),
  motivo_cancelamento: z.string().nullable(),
  nota_cancelamento: z.string().nullable(),
  marcado_por: z.string().nullable(),
});
const horarioDe = (a: AppointmentItem) => ({
  id: a.id, inicio: isoBahia(new Date(a.startsAt)), duracao_min: a.durationMin, status: a.status,
  contato: { id: a.contactId, nome: a.clientName, telefone: a.phone?.startsWith("+") ? a.phone : null },
  profissional: a.professionalId && a.professionalName ? { id: a.professionalId, nome: displayName(a.professionalName) } : null,
  qualquer_profissional: a.anyPro, preferencia: (PREFERENCES as readonly string[]).includes(a.preference ?? "") ? a.preference as (typeof PREFERENCES)[number] : null,
  servico: { id: a.serviceId, nome: a.serviceLabel }, valor_centavos: a.priceCents, observacao: a.notes, origem: a.origin, conversa_id: a.dealId, visita_id: a.visitId,
  encaixe: a.fitIn, fora_do_horario: a.outsideHours, confirmado_via: a.confirmedVia, motivo_cancelamento: a.cancelReason, nota_cancelamento: a.cancelNote, marcado_por: a.bookedByName,
});

/** Um horário pelo id, com os mesmos campos da lista (lê pela mesma consulta da Agenda, no minuto do horário). */
async function horarioPorId(id: string, withValues: boolean) {
  const [a] = await db.select({ startsAt: appointments.startsAt, professionalId: appointments.professionalId }).from(appointments).where(eq(appointments.id, id));
  if (!a) throw new ApiErro(404, "Esse horário não existe.");
  const lista = await listAppointments({ from: a.startsAt, to: new Date(a.startsAt.getTime() + 60_000) }, { withValues });
  const h = lista.find((x) => x.id === id);
  if (!h) throw new ApiErro(404, "Esse horário não aparece na agenda (lista de espera ou cópia do Avec).");
  return horarioDe(h);
}

export const listarAgenda = rotaApi({
  metodo: "GET", caminho: "/agenda", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Horários de um período",
  descricao: `Os horários (inclusive cancelados) com início entre \`de\` e \`ate\`, em ordem. Dia (2026-10-26) vale o dia inteiro em Salvador; até ${MAX_DIAS} dias por pedido. A lista de espera não vem. Valores só para quem vê valores. \`conversa_id\` vem null quando a conversa é de outra pessoa e a pessoa da chave não vê as de todas.`,
  query: z.object({
    de: zDiaOuInstante, ate: zDiaOuInstante,
    profissional: zUuid.optional().meta({ description: "Só os horários desta profissional." }),
  }),
  resposta: zLista(zHorario),
  handler: async ({ user, query }) => {
    const from = inicioDe(query.de), to = fimDe(query.ate);
    if (to <= from) throw new ApiErro(400, "ate: precisa ser depois de `de`.");
    if (to.getTime() - from.getTime() > MAX_DIAS * 86_400_000) throw new ApiErro(400, `Período longo demais: até ${MAX_DIAS} dias por pedido.`);
    const rows = await listAppointments({ from, to }, { professionalId: query.profissional ?? null, withValues: can(user.perms, "valores.ver") });
    // Revisão de segurança 26/10: o id da conversa só vai se a conversa está no escopo da pessoa (o mesmo filtro de GET /conversas).
    const ids = [...new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))];
    const donas = new Map(ids.length && !can(user.perms, "atendimento.todas")
      ? (await db.select({ id: deals.id, ownerId: deals.ownerId }).from(deals).where(inArray(deals.id, ids))).map((d) => [d.id, d.ownerId] as const)
      : []);
    const visivel = (dealId: string | null) => dealId && (!donas.has(dealId) || noEscopoDaLista(user, donas.get(dealId) ?? null)) ? dealId : null;
    return { dados: rows.map((r) => ({ ...horarioDe(r), conversa_id: visivel(r.dealId) })), proximo_cursor: null };
  },
});

const zItem = z.object({
  servico_id: zUuid,
  profissional_id: zUuid.nullable().meta({ description: "null = \"Qualquer uma\" (o sistema escolhe quem está livre)." }),
  preferencia: z.enum(PREFERENCES).meta({ description: "escolhida (ela quer esta profissional) ou sem_preferencia (tanto faz). Obrigatório, como na tela." }),
  duracao_min: z.number().int().min(5).max(720).optional().meta({ description: "Sem isso: o tempo da profissional ou do serviço." }),
  modo: z.enum(["depois", "junto"]).optional().meta({ description: "Com mais de um serviço: depois (padrão) ou junto com o anterior." }),
  auxiliares: z.array(zUuid).max(6).optional(),
});

export const marcarHorario = rotaApi({
  metodo: "POST", caminho: "/agenda", escopo: "escrever", perm: "agenda.marcar", grupo: GRUPO, status: 201,
  resumo: "Marca horário",
  descricao: [
    "O mesmo Marcar da Agenda: confere conflito, horário de trabalho e se a profissional faz o serviço. Por cima de outro horário ou fora do horário só com `encaixe: true` e a permissão de encaixar. Não manda nada para a cliente (o lembrete da véspera, se ligado, sai depois sozinho).",
    "`cliente`: `{ \"contato_id\" }` ou `{ \"nome\", \"telefone\" }` (acha pelo telefone; nunca duplica). `chave_pedido` (uuid) evita marcar duas vezes se o script repetir o pedido.",
  ].join("\n\n"),
  corpo: z.object({
    cliente: z.union([z.object({ contato_id: zUuid }), z.object({ nome: z.string().trim().min(1).max(120), telefone: z.string().trim().min(1).max(40) })]),
    inicio: zInstante,
    servicos: z.array(zItem).min(1).max(MAX_ITEMS),
    observacao: z.string().trim().max(1000).optional(),
    encaixe: z.boolean().optional(),
    conversa_id: zUuid.optional(),
    marcador_id: zUuid.optional(),
    tipo: z.enum(VISIT_TYPES).optional(),
    chave_pedido: zUuid.optional(),
  }),
  resposta: zUm(z.object({ visita_id: z.uuid(), dia: z.string(), reaproveitado: z.boolean(), horarios: z.array(zHorario) })),
  handler: async ({ user, body, alvo }) => {
    if ((body.marcador_id || body.tipo) && !can(user.perms, "agenda.marcador")) throw new ApiErro(403, "Você não tem permissão para pôr marcador ou tipo no horário.");
    try {
      const r = await createVisit({
        requestKey: body.chave_pedido ?? randomUUID(),
        client: "contato_id" in body.cliente ? { contactId: body.cliente.contato_id } : { name: body.cliente.nome, phone: body.cliente.telefone },
        dealId: body.conversa_id ?? null, startsAt: body.inicio.toISOString(), notes: body.observacao ?? null, fitIn: body.encaixe, labelId: body.marcador_id ?? null, visitType: body.tipo ?? null,
        items: body.servicos.map((s) => ({ serviceId: s.servico_id, professionalId: s.profissional_id, preference: s.preferencia, durationMin: s.duracao_min ?? null, mode: s.modo, assistantIds: s.auxiliares })),
      }, { id: user.id, perms: user.perms });
      alvo(r.visitId);
      const money = can(user.perms, "valores.ver");
      return { dados: { visita_id: r.visitId, dia: r.day, reaproveitado: r.reused, horarios: await Promise.all(r.appointmentIds.map((id) => horarioPorId(id, money))) } };
    } catch (e) {
      if (e instanceof ExistingAppointmentError) throw new ApiErro(409, `${e.message} (horário ${e.appointmentId})`);
      throw e;
    }
  },
});

export const alterarHorario = rotaApi({
  metodo: "PATCH", caminho: "/agenda/{id}", escopo: "escrever", perm: ["agenda.marcar", "atendimento.ver"], grupo: GRUPO,
  resumo: "Remarca, muda a situação ou a observação",
  descricao: [
    "Tudo é conferido antes de gravar: uma parte recusada não deixa outra gravada. Remarcar (`inicio` e/ou `profissional_id`) e mudar o `status` vão em pedidos separados; a `observacao` vai junto com qualquer um.",
    "**Remarcar** pede \"Marcar, remarcar…\" (agenda.marcar). Com o lembrete do horário ligado, a cliente recebe \"Seu horário foi remarcado…\" pelo WhatsApp: a chave precisa do escopo `enviar`. Para remarcar sem avisar (como arrastar na tela), mande `avisar_cliente: false` (aí basta `escrever`; o lembrete da véspera passa para o horário novo).",
    `**status**: ${["confirmado", "chegou", "em_atendimento", "agendado"].join(", ")} (agendado = aceitar o pedido) pedem Ver Conversas; ${FINALIZADO} (Finalizado) e faltou pedem agenda.marcar; cancelado pede agenda.marcar e \`motivo\`. Finalizar manda o "Depois do atendimento" quando ele está ligado: aí a chave precisa de \`enviar\`.`,
  ].join("\n\n"),
  params: zId,
  corpo: z.object({
    observacao: z.string().max(1000).nullable().optional(),
    inicio: zInstante.optional(),
    profissional_id: zUuid.optional(),
    duracao_min: z.number().int().min(5).max(720).optional(),
    encaixe: z.boolean().optional(),
    confirmar_troca_profissional: z.boolean().optional().meta({ description: "Ela escolheu a profissional: trocar pede esta confirmação." }),
    avisar_cliente: z.boolean().default(true),
    status: z.enum([...APPOINTMENT_MARKS, "cancelado"]).optional(),
    motivo: z.enum(RECEPTION_CANCEL_REASONS as [string, ...string[]]).optional().meta({ description: "Cancelado: cliente_desmarcou, casa_desmarcou, nao_confirmou, engano ou outro (com `nota`)." }),
    nota: z.string().trim().max(200).optional(),
    cancelar: z.enum(["este", "visita", "serie"]).default("este").meta({ description: "Cancelado: só este horário, a visita inteira do dia ou a série." }),
  }).refine((b) => b.observacao !== undefined || b.inicio || b.profissional_id || b.status, { message: "Mande pelo menos um campo: observacao, inicio, profissional_id ou status." }),
  resposta: zUm(zHorario),
  handler: async ({ user, params, body, alvo, exigirEnvio }) => {
    const id = params.id;
    alvo(id);
    const [atual] = await db.select({ startsAt: appointments.startsAt, status: appointments.status }).from(appointments).where(eq(appointments.id, id));
    if (!atual) throw new ApiErro(404, "Esse horário não existe.");
    const ator = { id: user.id, perms: user.perms };
    const precisa = (perm: "agenda.marcar" | "atendimento.ver") => { if (!can(user.perms, perm)) throw new ApiErro(403, `Você não tem permissão para isso (${perm}).`); };
    const remarcar = !!(body.inicio || body.profissional_id);

    // Revisão de segurança 26/10: tudo conferido antes da primeira escrita (permissões, escopo de envio, motivo, se a situação pode mudar),
    // e a observação, que não falha, é gravada por último: uma parte recusada não deixa outra gravada.
    if (remarcar && body.status) throw new ApiErro(400, "Remarque e mude a situação em pedidos separados (a situação depende do horário novo).");
    if (body.observacao !== undefined) precisa("agenda.marcar");
    let avisa = false;
    if (remarcar) {
      precisa("agenda.marcar");
      // O "remarcado" só sai com o lembrete ligado (afterRescheduleReminder): só então é mandar WhatsApp.
      avisa = body.avisar_cliente && (await getLembreteD1()).enabled;
    }
    let finalizaAvisando = false;
    if (body.status === "cancelado") {
      precisa("agenda.marcar");
      if (!body.motivo) throw new ApiErro(400, "motivo: escolha o motivo do cancelamento.");
      const c = checkCancel(atual.status);
      if (!c.ok) throw new ApiErro(400, c.error);
    } else if (body.status) {
      precisa(body.status === "compareceu" || body.status === "faltou" ? "agenda.marcar" : "atendimento.ver");
      if (atual.status !== body.status) {
        const t = checkTransition(atual.status, body.status, { startsAt: atual.startsAt, now: new Date(), via: "recepcao" });
        if (!t.ok) throw new ApiErro(400, t.error);
      }
      finalizaAvisando = body.status === "compareceu" && afterVisitOn(await getAfterVisit());
    }
    if (avisa || finalizaAvisando) exigirEnvio();

    if (remarcar) {
      await rescheduleAppointment(id, {
        startsAt: (body.inicio ?? atual.startsAt).toISOString(), professionalId: body.profissional_id, durationMin: body.duracao_min, fitIn: body.encaixe, confirmProChange: body.confirmar_troca_profissional,
      }, ator, new Date(), { clientMessage: body.avisar_cliente });
    }
    if (body.status === "cancelado") {
      await cancelAppointments({ appointmentId: id, scope: body.cancelar, reason: body.motivo as (typeof RECEPTION_CANCEL_REASONS)[number], note: body.nota ?? null, via: "recepcao" }, ator);
    } else if (body.status) {
      await setAppointmentStatus(id, body.status, user.id, { via: "recepcao" });
    }
    if (body.observacao !== undefined) await updateAppointmentNotes(id, body.observacao, user.id);
    return { dados: await horarioPorId(id, can(user.perms, "valores.ver")) };
  },
});

export const listarProfissionais = rotaApi({
  metodo: "GET", caminho: "/profissionais", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Profissionais ativas", descricao: "Na ordem da Agenda, com os serviços que cada uma faz.",
  resposta: zLista(z.object({ id: z.uuid(), nome: z.string(), nome_completo: z.string().nullable(), funcao: z.string().nullable(), servico_ids: z.array(z.uuid()) })),
  handler: async () => ({
    dados: (await listProfessionals()).map((p) => ({ id: p.id, nome: displayName(p.name), nome_completo: p.fullName, funcao: p.role, servico_ids: p.serviceIds })),
    proximo_cursor: null,
  }),
});

export const listarServicos = rotaApi({
  metodo: "GET", caminho: "/servicos", escopo: "ler", perm: "atendimento.ver", grupo: GRUPO,
  resumo: "Serviços que dá para marcar", descricao: "Os ativos, na ordem da lista. Preço só para quem vê valores.",
  resposta: zLista(z.object({ id: z.uuid(), nome: z.string(), duracao_min: z.number().int().nullable(), categoria: z.string().nullable(), preco_centavos: z.number().int().nullable() })),
  handler: async ({ user }) => {
    const [servicos, precos] = await Promise.all([listBookableServices(), can(user.perms, "valores.ver") ? listServicePrices() : Promise.resolve({} as Record<string, number>)]);
    return { dados: servicos.map((s) => ({ id: s.id, nome: s.label, duracao_min: s.durationMin, categoria: s.category, preco_centavos: precos[s.id] ?? null })), proximo_cursor: null };
  },
});
