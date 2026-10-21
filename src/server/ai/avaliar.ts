import { sql } from "drizzle-orm";
import { db } from "../db";
import { AiError, callLegivel, callSuggestion } from "./client";
import type { ManualSections } from "@/lib/ai-manual";
import { messageText } from "./prompt";
import { costMicros, formatUsd } from "./pricing";
import { redact } from "./redact";
import { asksForSlots, isAgreement, mentionsTime } from "./horarios";
import { finalizar, loadCasaData, loadConversation, prepareRequest, roboResult, saysWillCheck, type Caller } from "./suggest";
import { stripSignature } from "@/lib/signature";
import { slotLabel } from "@/lib/proposed-slot";

/**
 * Avaliação da sugestão por IA com conversas reais, SEM GRAVAR NADA (nenhuma linha em ai_suggestions, nada enviado). Usada por scripts/ai-avaliar.ts.
 * - padrão: os N momentos mais recentes em que a cliente escreveu e a equipe respondeu; a conversa é cortada logo antes da resposta.
 * - `soHorario`: só pedidos de horário (ou "pode ser" depois de a Casa oferecer horário): pedido da cliente → sugestão → horário proposto,
 *   com a linha de horários que a IA recebeu e alertas ("vou verificar" com horários na mão, horário fora da lista).
 * Igual à tela (IA v3, 17/10): o pedido sai de `prepareRequest` (com a linha "Horários livres" quando a cliente pede horário, nos dois modos)
 * e o texto passa pelo mesmo pós-processamento e nova tentativa de `callLegivel`; quando o pós-processamento mudou algo, o texto cru vai junto.
 * `manual`: avalia com outro Manual da Casa (um arquivo, sem gravar em settings) para comparar versões medindo a agenda direito.
 * Só o primeiro nome; CPF, telefone e e-mail viram marcadores. A chamada é injetável (`caller`): os testes nunca falam com a Anthropic.
 */
export type AvaliarOpts = { n: number; dias: number; soHorario?: boolean; apiKey: string; model: string; baseUrl?: string; caller?: Caller; now?: Date; manual?: Partial<ManualSections> | null };
type Moment = { dealId: string; until: Date | null; reply: string | null };

const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");
const defaultCaller: Caller = (input, o) => callSuggestion(input, o);

/** Os momentos do modo padrão: a resposta mais recente da equipe em cada conversa, logo depois de uma mensagem da cliente. */
async function replyMoments(n: number, dias: number): Promise<Moment[]> {
  const r = await db.execute(sql`
    select * from (
      select distinct on (m.deal_id) m.deal_id, m.created_at as reply_at, m.body as reply_body
      from messages m
      join deals d on d.id = m.deal_id
      join contacts c on c.id = d.contact_id
      where m.direction = 'out' and m.kind = 'text' and m.body is not null and (m.sent_by_user_id is not null or m.from_phone)
        and m.created_at >= now() - make_interval(days => ${dias})
        and c.kind = 'cliente'
        and (select p.direction from messages p where p.deal_id = m.deal_id and p.created_at < m.created_at order by p.created_at desc, p.id desc limit 1) = 'in'
      order by m.deal_id, m.created_at desc
    ) x order by reply_at desc limit ${n}`);
  return (r.rows as { deal_id: string; reply_at: Date | string; reply_body: string }[]).map((x) => ({ dealId: x.deal_id, until: new Date(x.reply_at), reply: x.reply_body }));
}

/**
 * Os momentos do `--so-horario`: a mensagem mais recente da cliente em cada conversa que pede horário (ou concorda com um horário que a
 * Casa ofereceu); a conversa é cortada logo depois dela (antes da resposta da Casa, que vai lado a lado se existir).
 */
async function slotMoments(n: number, dias: number): Promise<Moment[]> {
  const r = await db.execute(sql`
    select m.deal_id, m.created_at, coalesce(m.body, m.transcript) as text,
      (select p.body from messages p where p.deal_id = m.deal_id and p.created_at < m.created_at and p.direction = 'out' and p.kind <> 'call' order by p.created_at desc limit 1) as casa_before,
      (select row_to_json(nx) from (select q.created_at, q.body from messages q where q.deal_id = m.deal_id and q.created_at > m.created_at and q.direction = 'out' and q.kind <> 'call'
        order by q.created_at asc limit 1) nx) as reply
    from messages m
    join deals d on d.id = m.deal_id
    join contacts c on c.id = d.contact_id
    where m.direction = 'in' and m.kind in ('text', 'audio') and coalesce(m.body, m.transcript) is not null
      and m.created_at >= now() - make_interval(days => ${dias}) and c.kind = 'cliente' and d.archived_at is null
    order by m.created_at desc limit 2000`);
  const seen = new Set<string>(), out: Moment[] = [];
  for (const x of r.rows as { deal_id: string; created_at: Date | string; text: string; casa_before: string | null; reply: { created_at: string; body: string | null } | null }[]) {
    if (out.length >= n || seen.has(x.deal_id)) continue;
    const agreed = !!x.casa_before && mentionsTime(stripSignature(x.casa_before)) && isAgreement([x.text]);
    if (!asksForSlots([x.text]) && !agreed) continue;
    seen.add(x.deal_id);
    out.push({ dealId: x.deal_id, until: x.reply ? new Date(x.reply.created_at) : null, reply: x.reply?.body ?? null });
  }
  return out;
}

export async function avaliar(o: AvaliarOpts): Promise<{ markdown: string; totals: Record<string, number> }> {
  const moments = o.soHorario ? await slotMoments(o.n, o.dias) : await replyMoments(o.n, o.dias);
  const casa = await loadCasaData();
  if (o.manual) casa.manual = o.manual;
  const call = o.caller ?? defaultCaller;
  const tot = { conversas: 0, ok: 0, humano: 0, falhas: 0, micros: 0, input: 0, cached: 0, write: 0, output: 0, comOpcoes: 0, comHorario: 0, vouVerificar: 0, vouVerificarCru: 0, garantidas: 0, combinado: 0, posProcessadas: 0 };
  const parts: string[] = [];
  for (const [i, m] of moments.entries()) {
    // O "agora" da conversa é o momento cortado (sem resposta ainda: agora de verdade).
    const now = m.until ?? o.now ?? new Date();
    const conv = await loadConversation(m.dealId, now, m.until ?? undefined);
    if (!conv || conv.last?.direction !== "in") continue;
    const burst: string[] = [];
    for (const msg of [...conv.data.messages].reverse()) { if (msg.direction !== "in") break; burst.unshift(messageText(msg)); }
    const head = `## ${i + 1}. ${conv.data.firstName ?? "Cliente"} · ${conv.data.stage}`;
    const casaReal = m.reply ? quote(redact(stripSignature(m.reply).trim())) : "_(ainda sem resposta da Casa)_";
    tot.conversas++;
    try {
      const robo = roboResult(conv.data, o.model);
      const req = robo ? { system: "", user: "", free: null, combinado: null, greet: null } : await prepareRequest(conv.deal, conv.data, casa, now);
      let raw = "";
      const res = robo ?? await callLegivel(async () => { const r = await call({ system: req.system, user: req.user }, { apiKey: o.apiKey, model: o.model, baseUrl: o.baseUrl }); raw = r.data.sugestao; return r; }, casa.nomes);
      // O mesmo acabamento da tela (garantia do horário concreto): o que a avaliação mede é o que a atendente veria.
      const cru = res.data.sugestao;
      const fim = robo ? { sugestao: cru, horario: null, garantido: false } : finalizar(cru, res.data.horario, req, now, casa.assistentes);
      res.data.sugestao = fim.sugestao;
      const mudou = !robo && raw.trim() !== res.data.sugestao;
      if (mudou) tot.posProcessadas++;
      if (fim.garantido) tot.garantidas++;
      const options = req.free?.options ?? [];
      const horario = fim.horario;
      tot.ok++; if (res.data.precisa_humano) tot.humano++;
      if (options.length) tot.comOpcoes++;
      if (horario) tot.comHorario++;
      if (req.combinado) tot.combinado++;
      const alerts: string[] = [];
      if (options.length && saysWillCheck(cru)) {
        tot.vouVerificarCru++;
        if (!saysWillCheck(res.data.sugestao)) alerts.push("a IA disse \"vou verificar\" com horários livres na mão; o servidor trocou pela proposta");
      }
      if (options.length && saysWillCheck(res.data.sugestao)) { tot.vouVerificar++; alerts.push("disse \"vou verificar\" com horários livres na mão"); }
      if (options.length && mentionsTime(res.data.sugestao) && !horario) alerts.push("citou horário que não bate com nenhuma opção da lista");
      if (res.data.horario && !horario) alerts.push(`devolveu horario "${res.data.horario}", que não existe ou não está no texto`);
      tot.micros += res.costMicros; tot.input += res.usage.inputTokens; tot.cached += res.usage.cachedTokens; tot.write += res.usage.cacheWriteTokens; tot.output += res.usage.outputTokens;
      parts.push([head, "", "**Cliente escreveu:**", quote(burst.join("\n")), "",
        // A linha de horários como a tela manda: no --so-horario sempre (mesmo sem linha); no padrão, quando houve.
        ...(o.soHorario || req.free?.line || req.combinado ? [`**Horários que a IA recebeu:** ${req.free?.line ? `\`${req.free.line}\`` : "_(nenhuma linha)_"}`, ...(req.combinado ? [`**Combinado:** ${req.combinado.prompt.status === "ambiguo" ? `ambíguo (${req.combinado.prompt.opcoes})` : req.combinado.prompt.label} · ${req.combinado.prompt.status}`] : []), ""] : []),
        `**Sugestão da IA**${res.data.precisa_humano ? ` (pede alguém da equipe: ${res.data.motivo || "sem motivo"})` : ""}:`, quote(res.data.sugestao), "",
        ...(mudou ? ["**Texto cru da IA (antes do pós-processamento):**", quote(raw.trim()), ""] : []),
        `**Horário proposto:** ${horario ? `${slotLabel(horario)} (${horario.id})` : "nenhum"}`,
        ...(alerts.length ? [`**Atenção:** ${alerts.join("; ")}`] : []), "",
        "**A Casa respondeu de verdade:**", casaReal, "",
        `Resumo: ${res.data.resumo} · tokens: ${res.usage.inputTokens} entrada + ${res.usage.cachedTokens} cache + ${res.usage.cacheWriteTokens} gravação, ${res.usage.outputTokens} saída · ${formatUsd(res.costMicros)}`, ""].join("\n"));
    } catch (e) {
      tot.falhas++;
      if (e instanceof AiError && e.usage) tot.micros += costMicros(e.usage);
      parts.push([head, "", "**Cliente escreveu:**", quote(burst.join("\n")), "", `_A IA não respondeu: ${e instanceof AiError ? e.code : String(e)}_`, ""].join("\n"));
    }
  }
  const avg = (v: number) => (tot.ok ? Math.round(v / tot.ok) : 0);
  const header = [
    `# Avaliação da sugestão de resposta por IA${o.soHorario ? " · só pedidos de horário" : ""}`,
    "",
    `Gerado em ${(o.now ?? new Date()).toLocaleString("pt-BR", { timeZone: "America/Bahia" })} · modelo ${o.model} · ${tot.conversas} conversas (${tot.ok} com sugestão, ${tot.humano} pedindo alguém da equipe, ${tot.falhas} falhas).`,
    `Com horários livres na mão: ${tot.comOpcoes} · com horário proposto (botão "Marcar este horário"): ${tot.comHorario} · concordância da cliente: ${tot.combinado} · "vou verificar" com horários: ${tot.vouVerificar} (a IA escreveu ${tot.vouVerificarCru}; garantidas pelo servidor: ${tot.garantidas}) · corrigidas pelo pós-processamento: ${tot.posProcessadas}.`,
    ...(o.manual ? ["Manual da Casa: o do arquivo (não o gravado em Configurações)."] : []),
    `Custo total: ${formatUsd(tot.micros)} · por chamada: ${formatUsd(tot.ok ? Math.round(tot.micros / tot.ok) : 0)} · tokens médios: ${avg(tot.input)} entrada, ${avg(tot.cached)} cache, ${avg(tot.write)} gravação, ${avg(tot.output)} saída.`,
    "",
    "Nada foi gravado na tabela de sugestões nem enviado para ninguém. Só o primeiro nome aparece; CPF, telefone e e-mail viram marcadores.",
    "",
  ].join("\n");
  return { markdown: `${header}\n${parts.join("\n")}`, totals: tot };
}
