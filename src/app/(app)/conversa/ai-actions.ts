"use server";
import { aiFailureMessage } from "@/lib/ai-failure";
import { after } from "next/server";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { BULK_MAX } from "@/server/domain/bulk";
import { generateProgramada, programadaAvailable } from "@/server/ai/programada";
import { bookingFromSuggestion, claimSuggestion, fillSuggestion, generateForDeal, markSuggestion, suggestionState, type SkipReason, type SuggestionState } from "@/server/ai/suggest";
import type { ProposedSlot } from "@/lib/proposed-slot";
import { assertCanActOnDeal } from "@/server/domain/deal-scope";
import { resumeFromSuggestion } from "@/server/domain/retomada";
import { transcreverDitado } from "@/server/ai/ditado";
import { revalidatePath } from "next/cache";

/** Sugestão de resposta por IA na conversa. Nenhuma destas ações envia mensagem: "Usar" só marca (o texto vai para a caixa no navegador). */
export type AiResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: userErrorMessage(e, "sugestão por IA") });
const uuid = z.string().uuid();

/** `agendaAt`: ISO de quando os horários oferecidos foram lidos da agenda (a tela pede para conferir). */
export type AiSuggestionView = { id: string; resumo: string; sugestao: string; precisaHumano: boolean; motivo: string | null; agendaAt: string | null; horario: ProposedSlot | null;
  /** Cancelou sem nova data: ISO de quando retomar (botão "Programar retomada"). */ retomarEm: string | null;
  /** A resposta pronta com foto/vídeo que a IA indicou para ir junto (o "Usar" prende o anexo na caixa). */ material?: { replyId: string; name: string; kind: string } | null };
export type AiView = { state: "pronta"; suggestion: AiSuggestionView } | { state: "pode_pedir"; again?: boolean } | { state: "escrevendo" | "nada" };
const view = (s: SuggestionState): AiView => (s.state === "pronta"
  ? { state: "pronta", suggestion: { id: s.suggestion.id, resumo: s.suggestion.resumo, sugestao: s.suggestion.sugestao, precisaHumano: s.suggestion.precisaHumano, motivo: s.suggestion.motivo,
    agendaAt: s.suggestion.agendaAt?.toISOString() ?? null, horario: s.suggestion.horario, retomarEm: s.suggestion.retomarEm?.toISOString() ?? null, material: s.suggestion.material } }
  : s.state === "pode_pedir" ? { state: "pode_pedir", again: s.again } : { state: s.state });

/**
 * O estado da sugestão da conversa. `open` (a conversa acabou de ser aberta): sem sugestão para a última mensagem da cliente
 * (e ela esperando a Casa), reserva UMA e gera depois da resposta (`after`): a tela fica em "escrevendo" e o tempo real traz o texto.
 * As atualizações ao vivo chamam sem `open`: só leem, nunca geram (economia).
 */
export async function getAiSuggestionAction(dealId: string, open = false): Promise<AiResult<AiView>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const st = await suggestionState(id);
    if (open && st.state === "pode_pedir") {
      const c = await claimSuggestion(id, { origin: "auto", requireWaiting: true, userId: user.id });
      if (c.status === "reservada") { after(() => fillSuggestion(c.claim).then(() => {})); return { ok: true, data: { state: "escrevendo" } }; }
    }
    return { ok: true, data: view(st) };
  } catch (e) { return fail(e); }
}

const WHY: Partial<Record<SkipReason, string>> = {
  desligada: "A sugestão por IA está desligada em Configurações.",
  sem_chave: "A IA não está configurada no servidor.",
  teto_mes: "Chegou ao limite de gasto do mês com a IA.",
  teto_dia: "Chegou ao limite de sugestões de hoje.",
  conversa_fechada: "Esta conversa não está aberta.",
  citada_sumiu: "A mensagem marcada para responder não está mais na conversa.",
};

const pedidoSchema = z.object({ tema: z.string().max(1000).nullish(), quotedId: z.string().nullish() }).nullish();

/**
 * "Sugerir resposta" e "Outra", a qualquer momento (a última pode ser da Casa): gera na hora (respeitando o teto) e devolve para a tela trocar.
 * `pedido`: o tema opcional e a mensagem marcada para responder (id de mensagem ainda não gravada é ignorado). O mesmo pedido reaproveita a guardada.
 */
export async function requestAiSuggestionAction(dealId: string, kind: "primeira" | "outra", pedido?: { tema?: string | null; quotedId?: string | null } | null): Promise<AiResult<AiView>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const id = uuid.parse(dealId);
    await assertCanActOnDeal(user, id);
    const p = pedidoSchema.parse(pedido) ?? {};
    const ped = { tema: p.tema ?? null, quotedId: p.quotedId && uuid.safeParse(p.quotedId).success ? p.quotedId : null };
    // Pedido da atendente: nunca exige a cliente por último (17/10: vale com a última da Casa, Resolvida ou encerrada).
    const r = await generateForDeal(id, { origin: z.enum(["primeira", "outra"]).parse(kind) === "outra" ? "outra" : "auto", requireWaiting: false, userId: user.id, ...ped });
    if (r.status === "pulada" && r.motivo !== "ja_tem") return { ok: false, error: WHY[r.motivo] ?? "Não deu para gerar agora." };
    if (r.status === "falhou") return { ok: false, error: aiFailureMessage(r.erro) };
    return { ok: true, data: view(await suggestionState(id, undefined, ped)) };
  } catch (e) { return fail(e); }
}

export async function markAiSuggestionAction(input: { id: string; dealId: string; what: "usada" | "fechada" }): Promise<AiResult> {
  try {
    const user = await assertPerm("atendimento.ver");
    await assertCanActOnDeal(user, uuid.parse(input.dealId));
    await markSuggestion(uuid.parse(input.id), uuid.parse(input.dealId), z.enum(["usada", "fechada"]).parse(input.what));
    return { ok: true, data: undefined };
  } catch (e) { return fail(e); }
}

/* ---------- "Escrever com IA" no Retomar/Programar mensagem: só devolve o texto; nada é programado aqui ---------- */
export async function aiProgramadaAvailableAction(): Promise<AiResult<boolean>> {
  try { await assertPerm("atendimento.ver"); return { ok: true, data: await programadaAvailable() }; } catch (e) { return fail(e); }
}

const WHY_PROG: Partial<Record<SkipReason | "sem_tema", string>> = { ...WHY, sem_tema: "Diga em poucas palavras sobre o que é a mensagem.", conversa_fechada: "Não achei esta conversa." };

/** Uma conversa: lê a conversa. Lote (2+): um modelo com {primeiro_nome}, sem ler conversa nenhuma. */
export async function aiProgramadaAction(input: { dealIds: string[]; tema: string; sendAt: string; anterior?: string | null }): Promise<AiResult<{ texto: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const sendAt = new Date(z.string().min(10).max(40).parse(input.sendAt));
    if (!Number.isFinite(sendAt.getTime())) return { ok: false, error: "Escolha o dia e a hora." };
    const dealIds = z.array(uuid).min(1).max(BULK_MAX).parse(input.dealIds);
    for (const id of dealIds) await assertCanActOnDeal(user, id);
    const r = await generateProgramada({ dealIds, tema: z.string().max(1000).parse(input.tema), sendAt,
      anterior: z.string().max(4000).nullish().parse(input.anterior), userId: user.id });
    if (r.status === "pulada") return { ok: false, error: WHY_PROG[r.motivo] ?? "Não deu para gerar agora." };
    if (r.status === "falhou") return { ok: false, error: aiFailureMessage(r.erro) };
    return { ok: true, data: { texto: r.texto } };
  } catch (e) { return fail(e); }
}

/**
 * "Marcar este horário" da sugestão: confere de novo (o horário é desta conversa e continua livre AGORA) e devolve o que a folha "Marcar horário"
 * precisa para abrir preenchida. Não marca nada: quem marca é a atendente, no botão Marcar da folha. Só quem pode marcar na agenda.
 */
export type AiBooking = { suggestionId: string; slot: ProposedSlot; livre: boolean | null; confirm: string };
export async function prepareAiBookingAction(input: { id: string; dealId: string }): Promise<AiResult<AiBooking>> {
  try {
    const user = await assertPerm("agenda.marcar");
    const id = uuid.parse(input.id);
    await assertCanActOnDeal(user, uuid.parse(input.dealId));
    const b = await bookingFromSuggestion(id, uuid.parse(input.dealId));
    if (!b) return { ok: false, error: "Esta sugestão não tem horário para marcar." };
    return { ok: true, data: { suggestionId: id, ...b } };
  } catch (e) { return fail(e); }
}

/**
 * "Programar retomada" da sugestão (Cati 17/10: a cliente cancelou sem nova data): cria o lembrete no dia proposto pelo mesmo caminho do
 * "Retomar…". Só no toque da atendente; nenhuma mensagem é programada nem enviada.
 */
export async function programarRetomadaAction(input: { id: string; dealId: string }): Promise<AiResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("atendimento.ver");
    const dealId = uuid.parse(input.dealId);
    await assertCanActOnDeal(user, dealId);
    const r = await resumeFromSuggestion(uuid.parse(input.id), dealId, user.id);
    revalidatePath("/atendimento"); revalidatePath("/");
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return fail(e); }
}

/**
 * "Falar" (Cati 16/10): o áudio que a atendente gravou no "Sobre o quê?" (ou no "Escrever com IA") volta como texto, pelo mesmo transcritor dos
 * áudios do WhatsApp. Não guarda o áudio, não gera nada e não envia nada: quem decide o que fazer com o texto é a tela.
 */
export async function transcreverDitadoAction(form: FormData): Promise<AiResult<{ texto: string }>> {
  try {
    await assertPerm("atendimento.ver");
    const f = form.get("audio");
    if (!(f instanceof Blob)) return { ok: false, error: "Grave o áudio de novo." };
    return { ok: true, data: { texto: await transcreverDitado(new Uint8Array(await f.arrayBuffer()), f.type || "audio/webm") } };
  } catch (e) { return fail(e); }
}
