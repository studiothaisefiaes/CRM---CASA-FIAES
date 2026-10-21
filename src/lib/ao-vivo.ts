/**
 * Ao vivo (`/ao-vivo`, subtópico do Hoje; spec 17/10). Pedido do dono: "uma tela ao vivo… para ter o controle total do que está
 * acontecendo aqui na Casa". Uma coluna por profissional com horário hoje (a assistente junto da principal), com quem está sendo atendida
 * agora (há quanto tempo começou, quanto falta e a barra pela duração), a próxima e quantas vêm depois; no topo, as atrasadas para chegar,
 * quem espera começar e quem falta pagar (só com o caixa no CRM). Puro: o servidor manda as visitas do dia e a tela recalcula com o relógio.
 * Fora (a mesma régua do Hoje, `visitOfDay`): "CLIENTE PADRÃO" do Avec, esperas às 00:00 e o status `conferir`; e aqui também faltou e cancelado.
 */
import { displayName } from "./display-name";
import { visitColumn, visitLateMin, visitOfDay, type DayVisit } from "./day-visit";

export type LivePro = { id: string; name: string; photoUrl: string | null; color: string | null; assistantOf: string | null };
export type LiveSlot = {
  appointmentId: string; visitKey: string; client: string; service: string; start: string; end: string | null; status: string;
  /** Quem faz, quando é a assistente (a coluna é da principal). */ doer: string | null;
  /** A cliente já está na Casa (chegou ou está em outro serviço). */ inHouse: boolean;
  /** Minutos depois da hora sem Chegou (texto discreto: a chegada ainda é marcada no Avec); null = no horário ou já na Casa. */ lateMin: number | null;
};
export type LiveNow = LiveSlot & { elapsedMin: number; remainingMin: number | null; overMin: number; progress: number | null };
export type LiveColumn = {
  /** A principal; null = horários sem profissional. */ id: string | null; name: string; photoUrl: string | null; color: string | null;
  assistants: { id: string; name: string; photoUrl: string | null }[];
  now: LiveNow[]; next: LiveSlot | null; later: number; done: number;
};
/** Os nomes das clientes de cada número do topo. `toPay` null: o caixa não está no CRM. */
export type LiveTop = { late: string[]; waiting: string[]; toPay: string[] | null };


/** Nome do serviço com a primeira letra maiúscula ("LUZES E MECHAS" → "Luzes e Mechas", "escova" → "Escova"). */
export function serviceTitle(label: string): string {
  const s = displayName(label.trim());
  return s ? s[0].toLocaleUpperCase("pt-BR") + s.slice(1) : s;
}

/** "8 min", "1h05", "2h". */
export function minText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

const PLANNED = new Set(["agendado", "confirmado", "solicitado", "chegou"]);
const MIN = 60_000;

/** A visita pela régua do Hoje (`visitOfDay`), com a entrada recalculada; null quando é CLIENTE PADRÃO ou não sobra serviço. */
function clean(raw: DayVisit): DayVisit | null {
  const v = visitOfDay(raw);
  return v?.services.length ? { ...v, entry: v.services[0].start } : null; // a entrada é o primeiro horário de verdade
}

export function buildLiveBoard(input: { visits: DayVisit[]; pros: LivePro[]; startedAt: Record<string, string>; nowMs: number; caixaOn: boolean }): { columns: LiveColumn[]; top: LiveTop } {
  const { pros, startedAt, nowMs, caixaOn } = input;
  const visits = input.visits.map(clean).filter((v): v is DayVisit => !!v);
  const byId = new Map(pros.map((p) => [p.id, p]));
  const principalOf = (id: string | null) => {
    const p = id ? byId.get(id) : undefined;
    return p?.assistantOf && byId.has(p.assistantOf) ? p.assistantOf : p ? p.id : null;
  };

  type Acc = { slots: (LiveSlot & { started: string | null })[]; assistants: Set<string> };
  const acc = new Map<string | null, Acc>();
  for (const v of visits) {
    const inHouse = visitColumn(v) === "na_casa";
    for (const s of v.services) {
      if (s.status === "faltou" || s.status === "cancelado") continue;
      const key = principalOf(s.professionalId);
      const a = acc.get(key) ?? { slots: [], assistants: new Set<string>() };
      acc.set(key, a);
      const isAssistant = !!s.professionalId && key !== s.professionalId && key !== null;
      if (isAssistant) a.assistants.add(s.professionalId!);
      a.slots.push({
        appointmentId: s.appointmentId, visitKey: v.key, client: v.name, service: serviceTitle(s.service), start: s.start, end: s.end, status: s.status,
        doer: isAssistant ? (byId.get(s.professionalId!)?.name ?? s.assistant) : null, inHouse, started: startedAt[s.appointmentId] ?? null,
        lateMin: !inHouse && s.status !== "chegou" && PLANNED.has(s.status) && nowMs > Date.parse(s.start) ? Math.floor((nowMs - Date.parse(s.start)) / MIN) || null : null,
      });
    }
  }

  const column = (key: string | null, a: Acc): LiveColumn => {
    const slots = [...a.slots].sort((x, y) => x.start.localeCompare(y.start) || x.client.localeCompare(y.client, "pt-BR"));
    const now: LiveNow[] = slots.filter((s) => s.status === "em_atendimento").map(({ started, ...s }) => {
      const from = Date.parse(started ?? s.start);
      const elapsedMin = Math.max(0, Math.floor((nowMs - from) / MIN));
      const durMin = s.end ? Math.round((Date.parse(s.end) - Date.parse(s.start)) / MIN) : null;
      if (durMin == null || durMin <= 0) return { ...s, elapsedMin, remainingMin: null, overMin: 0, progress: null };
      return { ...s, elapsedMin, remainingMin: Math.max(0, durMin - elapsedMin), overMin: Math.max(0, elapsedMin - durMin), progress: Math.min(1, elapsedMin / durMin) };
    });
    const queue = slots.filter((s) => PLANNED.has(s.status)).map(({ started: _started, ...s }) => s);
    const pro = key ? byId.get(key) : undefined;
    return {
      id: key, name: pro?.name ?? "Sem profissional", photoUrl: pro?.photoUrl ?? null, color: pro?.color ?? null,
      assistants: pros.filter((p) => a.assistants.has(p.id)).map((p) => ({ id: p.id, name: p.name, photoUrl: p.photoUrl })),
      now, next: queue[0] ?? null, later: Math.max(0, queue.length - 1), done: slots.filter((s) => s.status === "compareceu").length,
    };
  };
  const columns = [...pros.filter((p) => acc.has(p.id)).map((p) => column(p.id, acc.get(p.id)!)), ...(acc.has(null) ? [column(null, acc.get(null)!)] : [])];

  const names = (f: (v: DayVisit) => boolean) => visits.filter(f).map((v) => v.name);
  const top: LiveTop = {
    late: names((v) => visitLateMin(v, nowMs) != null),
    waiting: names((v) => visitColumn(v) === "na_casa" && !v.services.some((s) => s.status === "em_atendimento")),
    toPay: caixaOn ? names((v) => visitColumn(v) === "finalizou" && v.comanda?.status !== "fechada") : null,
  };
  return { columns, top };
}
