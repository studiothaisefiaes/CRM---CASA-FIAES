import { attendanceLabel, FIELD_LABELS } from "./field-labels";
import { PAYMENT_LABEL } from "./format";
import { formatBRL } from "./money";
import { dueLabel } from "./next-action";
import { isChannelOrigin, NOT_IDENTIFIED } from "./source-kinds";

/** O histórico do lead (aba/seção "Histórico"): eventos legíveis, com o de/para dos campos. Puro, no relógio de Salvador. */
export type HistoryEvent = { id: string; type: string; payload: unknown; createdAt: string | Date; user: string | null };
/** Nomes para trocar os ids dos campos (responsável, serviço, motivo, origem de link) por texto. */
export type HistoryLookup = { users: Record<string, string>; lists: Record<string, string>; sources: Record<string, string> };
export type HistoryEntry = {
  id: string; at: string; /** Ex.: "Valor: R$ 100,00 → R$ 150,00". */ text: string; /** Ex.: "Ana, 14:02". */ meta: string;
  tone: "default" | "etapa" | "alerta" | "ok";
};
export type HistoryDay = { key: string; label: string; entries: HistoryEntry[] };

/** Eventos que a conversa já mostra: ficam fora do histórico. */
const HIDDEN = new Set(["mensagem_recebida", "mensagem_enviada", "lido"]);
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TASK_KIND: Record<string, string> = { proxima_acao: "Próxima ação", retorno: "Retorno", comparecimento: "Conferência", geral: "Tarefa" };
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
    case "origin": return isChannelOrigin(s) ? NOT_IDENTIFIED.toLowerCase() : clip(s);
    case "paymentMethod": return PAYMENT_LABEL[s] ?? s;
    case "attendance": return attendanceLabel(v);
    default: return clip(s);
  }
}

type Campo = { campo: string; de?: unknown; para?: unknown };
const asCampos = (p: Record<string, unknown>): (Campo | string)[] => (Array.isArray(p.campos) ? (p.campos as (Campo | string)[]) : []);

function lines(e: HistoryEvent, lk: HistoryLookup): { text: string; tone: HistoryEntry["tone"] }[] {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const one = (text: string, tone: HistoryEntry["tone"] = "default") => [{ text, tone }];
  switch (e.type) {
    case "lead_criado": return one(`Lead criado${p.origin && !isChannelOrigin(String(p.origin)) ? ` (${p.origin})` : ""}`);
    case "etapa_alterada": {
      const nome = String(p.para ?? "").replace("followup_", "Follow-up ").replace(/^\w/, (c) => c.toUpperCase());
      const motivo = String(p.motivo ?? "");
      return one(`Movido para ${nome}${motivo.startsWith("automacao") ? " (automático)" : motivo === "respondido" ? " (respondido)" : motivo === "cliente_respondeu" ? " (cliente respondeu)" : ""}`, "etapa");
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
    case "assumiu": return one("Assumiu o lead");
    case "venda": return one(`Venda fechada${typeof p.valueCents === "number" ? ` · ${formatBRL(p.valueCents)}` : ""}`, "ok");
    case "comparecimento": return one(`Comparecimento: ${attendanceLabel(p.para)}`);
    case "tarefa": {
      const tipo = TASK_KIND[String(p.tipo)] ?? "Tarefa";
      const acao = p.acao === "concluida" ? "concluída" : p.acao === "cancelada" ? "cancelada" : "criada";
      const quando = acao === "criada" && typeof p.para === "string" ? ` · ${dueLabel(Date.parse(p.para), ms(e.createdAt))}` : "";
      return one(`${tipo} ${acao}: ${String(p.titulo ?? "")}${quando}`, acao === "concluída" ? "ok" : "default");
    }
    case "arquivado": return one("Marcado como não é cliente");
    case "restaurado": return one("Voltou para a fila");
    case "alerta": return one(String(p.mensagem ?? "Alerta"), "alerta");
    default: return one(e.type);
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
export function groupByDay(entries: HistoryEntry[], now: number): HistoryDay[] {
  const today = Math.floor((now - OFFSET_MS) / DAY_MS);
  const days: HistoryDay[] = [];
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
