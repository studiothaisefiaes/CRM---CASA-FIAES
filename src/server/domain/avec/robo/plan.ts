import type { AvecRole } from "../formats";

/** Um relatório que o robô pede ao Avec. `params` sobrescreve os campos do formulário do relatório (datas dd/mm/aaaa, status etc.). */
export type RoboReport = { code: string; title: string; expect: AvecRole; params: Record<string, string>; weekly: boolean };

export const DEFAULT_ROBO = { ativo: true, hora: 20 } as const;

const DAY = 86_400_000;
/** Data civil de Salvador (America/Bahia, UTC-3 fixo) em aaaa-mm-dd. */
export function bahiaDay(now: Date): string { return new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10); }
export function bahiaHour(now: Date): number { return new Date(now.getTime() - 3 * 3_600_000).getUTCHours(); }
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const range = (from: string, to: string) => ({ inicio: br(from), fim: br(to) });

/** Os completos (cadastros, pacotes, saldos) rodam 1x por semana: na primeira vez, ou 7 dias depois do último. */
export function weeklyDue(lastWeekly: string | null | undefined, today: string): boolean {
  if (!lastWeekly || !/^\d{4}-\d{2}-\d{2}$/.test(lastWeekly)) return true;
  return Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastWeekly}T12:00:00Z`) >= 7 * DAY;
}

/** Quais relatórios baixar hoje e em que período. Os mesmos que o CRM já sabe importar (`rolesOf`). */
export function planReports(now: Date, opts: { weekly: boolean; only?: string[] }): RoboReport[] {
  const today = bahiaDay(now);
  const ontem = shift(today, -1);
  const all: RoboReport[] = [
    // Diários
    { code: "0051", title: "Reservas", expect: "agendamentos", params: range(ontem, shift(today, 30)), weekly: false },
    { code: "0052", title: "Cancelamentos", expect: "cancelamentos", params: range(shift(today, -7), shift(today, 30)), weekly: false },
    { code: "0159", title: "Bloqueios da agenda", expect: "bloqueios", params: range(ontem, shift(today, 30)), weekly: false },
    { code: "0248", title: "Reservas em aberto no Avec", expect: "sem_baixa", params: { ...range(shift(today, -30), ontem), status: "1" }, weekly: false },
    { code: "0064", title: "Uso de pacotes", expect: "usos_pacote", params: range(shift(today, -7), today), weekly: false },
    { code: "0186", title: "Itens de comanda", expect: "itens", params: range(shift(today, -7), today), weekly: false },
    { code: "0388", title: "Pagamentos", expect: "pagamentos", params: range(shift(today, -7), today), weekly: false },
    { code: "0116", title: "Prontuário", expect: "fichas", params: range(shift(today, -7), today), weekly: false },
    // Semanais (completos)
    { code: "0229", title: "Profissionais", expect: "profissionais", params: {}, weekly: true },
    { code: "0033", title: "Serviços", expect: "servicos", params: {}, weekly: true },
    { code: "0004", title: "Clientes", expect: "contatos", params: {}, weekly: true },
    { code: "0063", title: "Pacotes ativos", expect: "pacotes", params: {}, weekly: true },
    { code: "0113", title: "Fidelidade", expect: "fidelidade", params: range("2020-01-01", today), weekly: true },
    { code: "0149", title: "Posição de estoque", expect: "produtos", params: { inicio: br(today) }, weekly: true },
    { code: "0115", title: "Anamnese", expect: "fichas", params: { idStart: "0" }, weekly: true },
  ];
  return all.filter((r) => (opts.only?.length ? opts.only.includes(r.code) : opts.weekly || !r.weekly));
}
