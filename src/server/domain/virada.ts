import { and, eq, gte, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, contacts, deals, settings, users } from "../db/schema";
import { UserFacingError } from "./errors";
import { normalizePhone } from "./phone";
import { funcaoParam } from "./funcoes";
import { deliverAutomated, resolveChannel, SendError } from "./send";
import { ensureTeamConversation } from "./summary-whatsapp";
import { getCasaInfo, getLembreteD1 } from "./client-link/settings";
import { renderReminder } from "@/lib/reminder-d1";
import { hourText, mapsLink, onlyFirstName, serviceParts, shortDay } from "@/lib/client-link";
import { bahiaParts, slotMs } from "@/lib/schedule";
import { shiftDay } from "@/lib/agenda";
import {
  TESTE_VIRADA, VIRADA_FALTA, VIRADA_FUNCAO, VIRADA_HORAS_PARAM, VIRADA_ITENS, isViradaAlvo, viradaKey, viradaPronta, viradaTesteVencido,
  type Virada, type ViradaAlvo, type ViradaModo, type ViradaPreview,
} from "@/lib/virada";

export type { ViradaModo, ViradaPreview } from "@/lib/virada";

/**
 * Virada (Fase B, Task 10): o checklist que libera ligar o lembrete da véspera e o Depois do atendimento. `saveLembreteD1` e
 * `saveAfterVisit` conferem, dentro da transação, com {@link assertViradaParaLigar} (ligar) e {@link assertViradaPronta} (salvar ligado).
 * Desligar nunca pede nada e zera o checklist ({@link desfazerVirada}): voltar atrás é religar o do ChatGuru/Avec.
 */
type Q = Tx | typeof db;
const H = 3_600_000;
const NO_LINK = "Ponha o link da Avaliação no Google para ligar o agradecimento.";

/** O checklist gravado do alvo, ou null se ninguém começou. */
export async function getVirada(alvo: ViradaAlvo, q: Q = db): Promise<Virada | null> {
  const [row] = await q.select({ value: settings.value }).from(settings).where(eq(settings.key, viradaKey(alvo)));
  const v = row?.value as Partial<Virada> | undefined;
  if (!v || typeof v !== "object") return null;
  return {
    alvo, marcados: Array.isArray(v.marcados) ? v.marcados.filter((x): x is string => typeof x === "string") : [],
    quem: typeof v.quem === "string" ? v.quem : "", quando: typeof v.quando === "string" ? v.quando : "",
  };
}

/** Por quantas horas o teste vale (Configurações › Troca do ChatGuru para o CRM, padrão 24). */
export const horasValidadeTeste = () => funcaoParam(VIRADA_FUNCAO, VIRADA_HORAS_PARAM);

/**
 * Houve um teste de verdade (audit `teste_virada`) do alvo nas últimas `horas_validade_teste` horas? No Depois do atendimento, `modo` exige
 * que o teste tenha sido do mesmo modo (o do agradecimento não vale para ligar a pesquisa).
 */
export async function testeRecente(q: Q, alvo: ViradaAlvo, now: Date, modo?: ViradaModo): Promise<boolean> {
  const since = new Date(now.getTime() - (await horasValidadeTeste()) * H);
  const [row] = await q.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.action, TESTE_VIRADA), eq(auditLog.entity, "virada"), eq(auditLog.entityId, alvo), gte(auditLog.createdAt, since),
      modo ? sql`${auditLog.data}->>'modo' = ${modo}` : undefined)).limit(1);
  return !!row;
}

async function write(q: Q, alvo: ViradaAlvo, marcados: string[], userId: string, now: Date, action: string) {
  const value: Virada = { alvo, marcados, quem: userId, quando: now.toISOString() };
  await q.insert(settings).values({ key: viradaKey(alvo), value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  await q.insert(auditLog).values({ userId, action, entity: "settings", entityId: viradaKey(alvo), data: value });
}

/**
 * Marca (ou desmarca) os passos da troca do ChatGuru para o CRM. Só aceita os itens do alvo; `teste_enviado` só com um teste de verdade dentro do prazo
 * ("O teste vale por", Funções › Virada). A permissão `virada.fazer` é conferida na action.
 */
export async function saveVirada(alvo: ViradaAlvo, marcados: string[], userId: string, now = new Date()): Promise<void> {
  if (!isViradaAlvo(alvo)) throw new UserFacingError("Troca desconhecida.");
  const itens: readonly string[] = VIRADA_ITENS[alvo];
  if (!Array.isArray(marcados) || marcados.some((m) => !itens.includes(m))) throw new UserFacingError("Passo desconhecido.");
  const sorted = itens.filter((i) => marcados.includes(i));
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${viradaKey(alvo)}))`);
    if (sorted.includes("teste_enviado") && !(await testeRecente(tx, alvo, now))) throw new UserFacingError(viradaTesteVencido(await horasValidadeTeste()));
    await write(tx, alvo, sorted, userId, now, "editou");
  });
}

/** Salvar ligado: o checklist do alvo tem de estar completo. */
export async function assertViradaPronta(q: Q, alvo: ViradaAlvo): Promise<void> {
  if (!viradaPronta(alvo, (await getVirada(alvo, q))?.marcados ?? [])) throw new UserFacingError(VIRADA_FALTA[alvo]);
}

/** Ligar (de desligado para ligado): checklist completo e um teste de verdade dentro do prazo, agora (do mesmo modo, no Depois do atendimento). */
export async function assertViradaParaLigar(q: Q, alvo: ViradaAlvo, now: Date, modo?: ViradaModo): Promise<void> {
  await assertViradaPronta(q, alvo);
  if (!(await testeRecente(q, alvo, now, modo))) throw new UserFacingError(viradaTesteVencido(await horasValidadeTeste()));
}

/** Desligou: o checklist volta a zero (ligar de novo pede a troca do ChatGuru para o CRM outra vez, porque voltar atrás é religar o do ChatGuru/Avec). */
export async function desfazerVirada(q: Q, alvo: ViradaAlvo, userId: string, now = new Date()): Promise<void> {
  const v = await getVirada(alvo, q);
  if (v?.marcados.length) await write(q, alvo, [], userId, now, "desfez");
}

/**
 * O texto de verdade montado com uma visita de exemplo: no lembrete, a visita de amanhã às 10h (Escova), com o endereço e o mapa da
 * Página da cliente; no Depois do atendimento, o agradecimento ou a enquete da Pesquisa de satisfação. O nome é o de quem faz a troca do ChatGuru para o CRM.
 */
export async function viradaPreview(alvo: ViradaAlvo, o: { nome: string | null; now: Date; modo?: ViradaModo }): Promise<ViradaPreview> {
  const primeiro = onlyFirstName(o.nome) ?? "Maria";
  if (alvo === "lembrete") {
    const [cfg, casa] = await Promise.all([getLembreteD1(), getCasaInfo()]);
    const start = new Date(slotMs(shiftDay(bahiaParts(o.now.getTime()).date, 1), "10:00"));
    const text = renderReminder(cfg.texto, {
      primeiro_nome: primeiro, data: shortDay(start), hora: hourText(start), servicos: serviceParts([{ service: "Escova", pro: null }]),
      endereco: casa.endereco ?? "", mapa: casa.mapa ?? (casa.endereco ? mapsLink(casa.endereco) : ""),
    }, cfg.comLink ? "(o link da cliente)" : null);
    return { kind: "text", text };
  }
  const { getAfterVisit, afterVisitMessageFor } = await import("./after-visit");
  const cfg = await getAfterVisit();
  const mode = o.modo ?? (cfg.mode === "desligado" ? "agradecimento" : cfg.mode);
  return afterVisitMessageFor({ ...cfg, mode, linkGoogle: cfg.linkGoogle ?? "(link do Google)" }, primeiro);
}

/**
 * Manda o texto de verdade (a prévia) para o WhatsApp digitado na tela, pelo caminho normal de envio (`deliverAutomated`: aparece na conversa).
 * Só para número novo ou já de Equipe (vira/continua contato de Equipe via `ensureTeamConversation`): número de cliente ou fornecedor é
 * recusado sem mudar nada (a cliente receberia um lembrete falso e viraria Equipe para sempre); Spam também. Grava `audit_log`
 * `teste_virada` só quando saiu. A permissão `virada.fazer` é conferida na action.
 */
export async function sendViradaTest(alvo: ViradaAlvo, phone: string, userId: string, opts: { modo?: ViradaModo; now?: Date } = {}):
  Promise<{ dealId: string }> {
  if (!isViradaAlvo(alvo)) throw new UserFacingError("Troca desconhecida.");
  const now = opts.now ?? new Date();
  let modo: ViradaModo | undefined;
  if (alvo === "depois") {
    const { getAfterVisit } = await import("./after-visit");
    const cfg = await getAfterVisit();
    modo = opts.modo ?? (cfg.mode === "desligado" ? "agradecimento" : cfg.mode);
    if (modo === "agradecimento" && !cfg.linkGoogle) throw new UserFacingError(NO_LINK);
  }
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  const preview = await viradaPreview(alvo, { nome: u?.name ?? null, now, modo });
  const e164 = normalizePhone(phone);
  const [before] = e164 ? await db.select({ kind: contacts.kind, name: contacts.name }).from(contacts).where(eq(contacts.phoneE164, e164)).limit(1) : [];
  if (before?.kind === "cliente" || before?.kind === "fornecedor") {
    const quem = before.name?.trim() || e164;
    throw new UserFacingError(`Esse número é de ${before.kind === "cliente" ? "uma cliente" : "um fornecedor"} (${quem}). Use o WhatsApp da gestora.`);
  }
  const { dealId } = await ensureTeamConversation(phone); // número inválido ou Spam: recusa aqui
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  try {
    const channel = await resolveChannel(dealId, deal);
    if (!channel) throw new UserFacingError("Nenhum WhatsApp conectado: o teste não sai.");
    await deliverAutomated(dealId, channel, preview.kind === "poll" ? preview : { ...preview, options: [] }, true);
  } catch (e) {
    if (e instanceof SendError) throw new UserFacingError(e.message);
    throw e;
  }
  await db.insert(auditLog).values({ userId, action: TESTE_VIRADA, entity: "virada", entityId: alvo, data: { phone: e164, dealId, ...(modo ? { modo } : {}) }, createdAt: now });
  return { dealId };
}
