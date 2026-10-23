import { attendanceLabel, FIELD_LABELS } from "./field-labels";
import { originLabel } from "./origin-label";
import { PAYMENT_LABEL } from "./format";
import { formatBRL } from "./money";
import { dueLabel } from "./next-action";
import { isChannelOrigin, NOT_IDENTIFIED } from "./source-kinds";

/** O histórico do lead (aba/seção "Histórico"): eventos legíveis, com o de/para dos campos. Puro, no relógio de Salvador. */
export type HistoryEvent = { id: string; type: string; payload: unknown; createdAt: string | Date; user: string | null };
/** Nomes para trocar os ids dos campos (responsável, serviço, motivo, origem de link) por texto. */
export type HistoryLookup = { users: Record<string, string>; lists: Record<string, string>; sources: Record<string, string>; professionals?: Record<string, string>; /** Nome da etapa pela chave (`followup_1` → "Follow-up 1"). */ stages?: Record<string, string> };
/** Quantos eventos o servidor entrega por lead. Chegou nisto, o histórico está cortado e a tela avisa. */
export const HISTORY_EVENT_LIMIT = 300;
export type HistoryEntry = {
  id: string; at: string; /** Ex.: "Valor: R$ 100,00 → R$ 150,00". */ text: string; /** Ex.: "Ana, 14:02". */ meta: string;
  tone: "default" | "etapa" | "alerta" | "ok";
};
export type HistoryDay<E extends { at: string } = HistoryEntry> = { key: string; label: string; entries: E[] };

/** Eventos que a conversa já mostra: ficam fora do histórico. */
const HIDDEN = new Set(["mensagem_recebida", "mensagem_enviada", "lido", "falta_marcada"]);
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** O nome de cada tipo de tarefa na tela e se é masculino (concorda com "concluído/concluída"). */
const TASK_KIND: Record<string, { label: string; m?: true }> = { proxima_acao: { label: "Combinado", m: true }, retorno: { label: "Retorno", m: true }, comparecimento: { label: "Conferência" }, geral: { label: "Tarefa" } };
const MAX_VALUE = 40;

const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const wall = (t: number) => new Date(t - OFFSET_MS);
const hhmm = (t: number) => { const d = wall(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const dayKey = (t: number) => { const d = wall(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const dateTime = (iso: string) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return iso; const d = wall(t); return `${WEEKDAY_SHORT[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${hhmm(t)}`; };
const dateOnly = (iso: string) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return iso; const d = wall(t); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1).trimEnd()}…` : s);
const first = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : null);

/** O valor de um campo como a pessoa lê: dinheiro em reais, datas no horário de Salvador, ids pelo nome, vazio como "vazio". */
export function fieldValue(campo: string, v: unknown, lk: HistoryLookup): string {
  if (v == null || v === "") return campo === "ownerId" ? "sem dono" : campo === "origin" || campo === "sourceId" ? NOT_IDENTIFIED.toLowerCase() : "vazio";
  const s = String(v);
  switch (campo) {
    case "valueCents": case "paidCents": return typeof v === "number" ? formatBRL(v) : s;
    case "scheduledAt": case "chargeAt": case "paidAt": return dateTime(s);
    case "recontactAt": return dateOnly(s);
    case "ownerId": return lk.users[s] ?? "outra pessoa";
    case "serviceId": case "objectionId": case "lostReasonId": return lk.lists[s] ?? "removido";
    case "sourceId": return lk.sources[s] ?? "removida";
    case "professionalId": return lk.professionals?.[s] ?? "removida";
    case "origin": return isChannelOrigin(s) ? NOT_IDENTIFIED.toLowerCase() : clip(s);
    case "paymentMethod": return PAYMENT_LABEL[s] ?? s;
    case "attendance": return attendanceLabel(v);
    default: return clip(s);
  }
}

type Campo = { campo: string; de?: unknown; para?: unknown };
const asCampos = (p: Record<string, unknown>): (Campo | string)[] => (Array.isArray(p.campos) ? (p.campos as (Campo | string)[]) : []);

/** Por que a conversa mudou de etapa (motivos do funil do Lote 1C e os antigos). Motivo desconhecido: sem parêntese, nunca o código. */
const MOTIVO: Record<string, string> = {
  respondido: " (respondido)", cliente_respondeu: " (cliente respondeu)", casa_retomou: " (a Casa retomou a conversa)", cliente_esperando: " (a cliente está esperando resposta)",
  aguardando_cliente: " (marcado como aguardando cliente)", orcamento_enviado: " (orçamento enviado)",
  compareceu: " (veio)", faltou: " (faltou: remarcar)", nao_respondeu: " (3 tentativas sem resposta)",
  atendida_3_dias: " (3 dias depois do atendimento)", conversa_encerrada: " (conversa resolvida)",
  avec_horario: " (horário no Avec)", avec_compareceu: " (veio, pelo Avec)", avec_faltou: " (faltou ou cancelou, pelo Avec)",
  migracao_lote1c: " (organização das etapas)",
};

function lines(e: HistoryEvent, lk: HistoryLookup): { text: string; tone: HistoryEntry["tone"] }[] {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const one = (text: string, tone: HistoryEntry["tone"] = "default") => [{ text, tone }];
  switch (e.type) {
    case "lead_criado": return one(`Conversa criada${p.origin && !isChannelOrigin(String(p.origin)) ? ` (${originLabel(String(p.origin))})` : ""}`);
    case "etapa_alterada": {
      const chave = String(p.para ?? "");
      const nome = lk.stages?.[chave] ?? chave.replace("followup_", "Follow-up ").replace(/^\w/, (c) => c.toUpperCase());
      const motivo = String(p.motivo ?? "");
      return one(`Movido para ${nome}${motivo.startsWith("automacao") ? " (automático)" : MOTIVO[motivo] ?? ""}`, "etapa");
    }
    case "resposta": { const s = Number(p.waitedSeconds ?? 0); return one(`Respondido em ${s < 60 ? `${s}s` : `${Math.round(s / 60)} min`}${p.fromPhone ? " pelo celular" : ""}`); }
    case "campo_alterado": case "responsavel_alterado": {
      const campos = asCampos(p);
      if (!campos.length) return one(e.type === "responsavel_alterado" ? "Trocou o responsável" : "Alterou dados");
      const old = campos.filter((c): c is string => typeof c === "string");
      const rich = campos.filter((c): c is Campo => typeof c !== "string");
      return [
        ...rich.map((c) => ({ text: `${FIELD_LABELS[c.campo] ?? c.campo}: ${fieldValue(c.campo, c.de, lk)} → ${fieldValue(c.campo, c.para, lk)}`, tone: "default" as const })),
        ...(old.length ? [{ text: `Alterou ${old.map((c) => FIELD_LABELS[c] ?? c).join(", ")}`, tone: "default" as const }] : []),
      ];
    }
    case "assumiu":
      if (p.motivo === "assinatura") return one(`Virou a dona: respondeu assinando pelo celular${p.migracao ? " (acerto das conversas antigas)" : ""}`);
      if (p.motivo === "resposta_crm") return one("Virou a dona: respondeu pelo CRM");
      return one(p.porOferta ? "Assumiu a conversa pela oferta" : "Assumiu a conversa");
    case "passado_para_setor": {
      const setor = typeof p.setor === "string" ? p.setor : "um setor";
      const quem = typeof p.para === "string" ? lk.users[p.para] ?? "outra pessoa" : null;
      return one(quem ? `Passou para o setor ${setor}: ficou com ${quem}` : `Passou para o setor ${setor}: ninguém livre, ficou sem dona`);
    }
    case "distribuido": {
      const quem = typeof p.para === "string" ? lk.users[p.para] ?? "outra pessoa" : null;
      if (!quem) return one("Ninguém disponível: ficou na fila sem dona");
      return one(`Distribuído para ${quem}${p.motivo === "retorno" ? " (atendeu da última vez)" : p.motivo === "fila" ? " (estava na fila sem dona)" : ""}`);
    }
    case "oferecido": return one(`Oferecido para ${typeof p.para === "string" ? lk.users[p.para] ?? "outra pessoa" : "outra pessoa"} assumir`);
    case "devolvido_a_fila": {
      const quem = typeof p.de === "string" ? lk.users[p.de] ?? "a responsável" : "a responsável";
      return one(`Voltou para a fila (${quem} ${p.motivo === "pausa" ? "entrou em pausa" : "ficou ausente"})`);
    }
    case "venda": return one(`Venda fechada${typeof p.valueCents === "number" ? ` · ${formatBRL(p.valueCents)}` : ""}`, "ok");
    case "comparecimento": return one(`Comparecimento: ${attendanceLabel(p.para)}`);
    case "tarefa": {
      const kind = TASK_KIND[String(p.tipo)] ?? TASK_KIND.geral;
      const acao = p.acao === "concluida" ? "concluid" : p.acao === "cancelada" ? "cancelad" : "criad";
      const quando = acao === "criad" && typeof p.para === "string" ? ` · ${dueLabel(Date.parse(p.para), ms(e.createdAt))}` : "";
      const verbo = (acao === "concluid" ? "concluíd" : acao) + (kind.m ? "o" : "a");
      return one(`${kind.label} ${verbo}: ${String(p.titulo ?? "")}${quando}`, acao === "concluid" ? "ok" : "default");
    }
    case "arquivado": return one("Marcado como não é cliente");
    case "restaurado": return one("Voltou para a fila");
    case "alerta": return one(String(p.mensagem ?? "Alerta"), "alerta");
    case "conversa_arquivada": return one(p.motivo === "convite_sem_resposta" ? `Conversa resolvida: ${p.dias ?? 14} dias sem resposta ao convite de retorno` : "Conversa resolvida (saiu da lista)");
    case "conversa_desarquivada": return one(p.motivo === "cliente_escreveu" ? "Conversa reaberta: a cliente escreveu" : p.motivo === "convite_retorno" ? "Conversa reaberta pelo convite de retorno" : "Conversa reaberta");
    case "convite_retorno": return one("Convite de retorno enviado (mensagem em massa): aguardando a cliente");
    case "contato_mesclado": return one("Contatos juntados (mesmo número)");
    case "espera_virou_followup": return one("Ninguém respondeu até o fim do dia: virou follow-up", "etapa");
    case "espera_encerrada_agradecimento": return one("Espera encerrada: a cliente só agradeceu");
    case "retomar_depois": return one(`Retomar depois${typeof p.dueAt === "string" ? `: lembrete para ${dueLabel(Date.parse(p.dueAt), ms(e.createdAt))}` : ""}`);
    case "tentativa": return one(`Tentativa ${Number(p.feita ?? 0)} de 3 feita${p.por === "tarefa" ? " (combinado concluído)" : " (mensagem da Casa)"}`);
    case "aguardando_cliente": return one(`Marcado como aguardando cliente${p.automatico ? " (tentativas automáticas)" : ""}`);
    case "orcamento_enviado": return one("Orçamento enviado");
    case "espera_vencida": return one(p.acao === "voltou_para_conversa" ? "A cliente estava esperando: voltou para Em conversa" : "Espera encerrada (agendada)");
    // Código novo sem frase ainda: nunca mostrar o código cru para a equipe.
    case "mensagem_agendada": return one(`Mensagem agendada para ${typeof p.para === "string" ? dueLabel(Date.parse(p.para), ms(e.createdAt)) : "depois"}`);
    case "agendada_cancelada": return one("Mensagem agendada cancelada");
    case "resolvida": return one("Resolvida sem resposta (não precisava responder)");
    case "resolvida_desfeita": return one("“Resolvida” desfeita: voltou a esperar resposta");
    case "falta_desfeita": return one("Falta desfeita: a conversa voltou como estava");
    case "link_cliente": {
      if (p.acao === "confirmou") return one("Confirmou pelo link", "ok");
      if (p.acao === "cancelou") return one(`Cancelou pelo link${p.motivo ? ` (${clip(String(p.motivo))})` : ""}`, "alerta");
      if (p.acao === "pediu_remarcar") return one(`Pediu para remarcar pelo link${p.sugestao ? `: ${clip(String(p.sugestao))}` : ""}`, "etapa");
      return one("Mexeu no horário pelo link");
    }
    default: return one("Outro registro do sistema");
  }
}

/** Os eventos viram linhas legíveis, do mais novo para o mais antigo. Mensagens ficam de fora. Uma mudança de vários campos vira uma linha por campo. */
export function historyEntries(events: HistoryEvent[], lk: HistoryLookup): HistoryEntry[] {
  return [...events]
    .filter((e) => !HIDDEN.has(e.type))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .flatMap((e) => {
      const t = ms(e.createdAt);
      const meta = [first(e.user), hhmm(t)].filter(Boolean).join(", ");
      return lines(e, lk).map((l, i) => ({ id: `${e.id}:${i}`, at: new Date(t).toISOString(), text: l.text, meta, tone: l.tone }));
    });
}

/** Agrupa por dia de Salvador: "Hoje", "Ontem" e depois "sábado, 10 de outubro". */
export function groupByDay<E extends { at: string }>(entries: E[], now: number): HistoryDay<E>[] {
  const today = Math.floor((now - OFFSET_MS) / DAY_MS);
  const days: HistoryDay<E>[] = [];
  for (const e of entries) {
    const t = Date.parse(e.at);
    const key = dayKey(t);
    let day = days.at(-1);
    if (!day || day.key !== key) {
      const diff = today - Math.floor((t - OFFSET_MS) / DAY_MS);
      const d = wall(t);
      day = { key, label: diff === 0 ? "Hoje" : diff === 1 ? "Ontem" : `${WEEKDAY[d.getUTCDay()].replace("-feira", "")}, ${d.getUTCDate()} de ${MONTH[d.getUTCMonth()]}${d.getUTCFullYear() !== wall(now).getUTCFullYear() ? ` de ${d.getUTCFullYear()}` : ""}`, entries: [] };
      days.push(day);
    }
    day.entries.push(e);
  }
  return days;
}
