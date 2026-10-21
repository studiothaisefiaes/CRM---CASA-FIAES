import { describe, expect, it } from "vitest";
import { dayTableVisits, type DayVisit, type DayVisitService } from "./day-visit";
import { buildLiveBoard, minText, serviceTitle, type LivePro } from "./ao-vivo";

/** Instante de 17/10/2026, h:m em Salvador (UTC−3). */
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 17, h + 3, m)).toISOString();
const ms = (h: number, m = 0) => Date.parse(at(h, m));

const THAISE: LivePro = { id: "p-thaise", name: "Thaise", photoUrl: "/api/profissionais/p-thaise/foto?v=1", color: "rosa", assistantOf: null };
const SIDNEY: LivePro = { id: "p-sidney", name: "Sidney", photoUrl: null, color: null, assistantOf: "p-thaise" };
const MAIARA: LivePro = { id: "p-maiara", name: "Maiara", photoUrl: null, color: null, assistantOf: null };
const CARLA: LivePro = { id: "p-carla", name: "Carla", photoUrl: null, color: null, assistantOf: null };
const PROS = [THAISE, SIDNEY, MAIARA, CARLA];

let n = 0;
const svc = (o: Partial<DayVisitService> & { start: string }): DayVisitService => ({
  appointmentId: `a${++n}`, serviceId: null, service: "Corte", professionalId: THAISE.id, pro: "Thaise", assistant: null, end: null, status: "agendado", priceCents: null, ...o,
});
const visit = (name: string, services: DayVisitService[], o: Partial<DayVisit> = {}): DayVisit => ({
  key: `${name}|2026-10-17`, visitId: null, contactId: null, dealId: null, name, day: "2026-10-17", entry: services[0]?.start ?? at(0), services, cancelled: [],
  comanda: null, values: false, ...o,
});
const board = (visits: DayVisit[], nowMs: number, o: { startedAt?: Record<string, string>; caixaOn?: boolean } = {}) =>
  buildLiveBoard({ visits, pros: PROS, startedAt: o.startedAt ?? {}, nowMs, caixaOn: o.caixaOn ?? true });

describe("Ao vivo: colunas por profissional (pedido do dono: 'controle total do que está acontecendo aqui na Casa')", () => {
  it("uma coluna por principal com horário hoje, na ordem da Agenda; a assistente fica junto da principal; quem não tem horário não aparece", () => {
    const sid = svc({ start: at(10), professionalId: SIDNEY.id, pro: "Thaise", assistant: "Sidney", service: "Escova" });
    const b = board([visit("Paula", [svc({ start: at(11), professionalId: MAIARA.id, pro: "Maiara" })]), visit("Rita", [sid])], ms(9));
    expect(b.columns.map((c) => c.name)).toEqual(["Thaise", "Maiara"]);
    expect(b.columns[0]).toMatchObject({ id: THAISE.id, photoUrl: THAISE.photoUrl, assistants: [{ id: SIDNEY.id, name: "Sidney", photoUrl: null }] });
    expect(b.columns[0].next).toMatchObject({ client: "Rita", service: "Escova", doer: "Sidney" });
  });

  it("Agora: há quanto tempo começou e quanto falta, pela duração prevista (início real do started_at)", () => {
    const s = svc({ start: at(10), end: at(11), status: "em_atendimento", service: "LUZES E MECHAS" });
    const b = board([visit("Cristiana", [s])], ms(10, 20), { startedAt: { [s.appointmentId]: at(10) } });
    const [now] = b.columns[0].now;
    expect(now).toMatchObject({ client: "Cristiana", service: "Luzes e Mechas", elapsedMin: 20, remainingMin: 40, overMin: 0, doer: null });
    expect(now.progress).toBeCloseTo(1 / 3, 3);
  });

  it("Agora: começou depois da hora marcada, a conta é pelo início real (a duração continua a prevista)", () => {
    const s = svc({ start: at(10), end: at(11), status: "em_atendimento" });
    const [now] = board([visit("Cris", [s])], ms(10, 40), { startedAt: { [s.appointmentId]: at(10, 30) } }).columns[0].now;
    expect(now).toMatchObject({ elapsedMin: 10, remainingMin: 50 });
  });

  it("em atendimento vindo do Avec sem started_at: conta da hora marcada", () => {
    const s = svc({ start: at(10), end: at(11), status: "em_atendimento" });
    const [now] = board([visit("Cris", [s])], ms(10, 15)).columns[0].now;
    expect(now).toMatchObject({ elapsedMin: 15, remainingMin: 45 });
  });

  it("sem duração prevista: só o tempo desde o início, sem barra e sem 'faltam'", () => {
    const s = svc({ start: at(10), end: null, status: "em_atendimento" });
    const [now] = board([visit("Cris", [s])], ms(10, 15)).columns[0].now;
    expect(now).toMatchObject({ elapsedMin: 15, remainingMin: null, progress: null, overMin: 0 });
  });

  it("passou do previsto: faltam 0, os minutos a mais e a barra cheia", () => {
    const s = svc({ start: at(10), end: at(11), status: "em_atendimento" });
    const [now] = board([visit("Cris", [s])], ms(11, 15), { startedAt: { [s.appointmentId]: at(10) } }).columns[0].now;
    expect(now).toMatchObject({ elapsedMin: 75, remainingMin: 0, overMin: 15, progress: 1 });
  });

  it("Próxima é a primeira por hora entre as que ainda não começaram; Depois conta o resto; os finalizados contam à parte", () => {
    const b = board([
      visit("Ana Clara", [svc({ start: at(9), status: "compareceu" })]),
      visit("Bruna", [svc({ start: at(12) })]),
      visit("Dora", [svc({ start: at(14) })]),
      visit("Celia", [svc({ start: at(11), status: "chegou" })]),
      visit("Eva", [svc({ start: at(16), status: "confirmado" })]),
    ], ms(10, 50));
    const c = b.columns[0];
    expect(c.now).toEqual([]);
    expect(c.next).toMatchObject({ client: "Celia", start: at(11), inHouse: true });
    expect(c.later).toBe(3);
    expect(c.done).toBe(1);
  });

  it("Próxima que passou da hora sem Chegou traz os minutos (texto discreto); quem já está na Casa não", () => {
    const b = board([visit("Suzana", [svc({ start: at(10) })]), visit("Celia", [svc({ start: at(9, 50), status: "chegou", professionalId: MAIARA.id, pro: "Maiara" })])], ms(10, 20));
    expect(b.columns.find((c) => c.name === "Thaise")!.next).toMatchObject({ client: "Suzana", lateMin: 20 });
    expect(b.columns.find((c) => c.name === "Maiara")!.next).toMatchObject({ client: "Celia", lateMin: null });
  });

  it("fica de fora: CLIENTE PADRÃO, espera às 00:00, faltou e cancelado", () => {
    const b = board([
      visit("CLIENTE PADRÃO", [svc({ start: at(10), status: "em_atendimento" })]),
      visit("Lista de Espera", [svc({ start: at(0) })]),
      visit("Faltosa", [svc({ start: at(9), status: "faltou" })]),
      visit("Cancelou", [], { cancelled: [svc({ start: at(13), status: "cancelado" })] }),
      visit("Paula", [svc({ start: at(15), professionalId: MAIARA.id, pro: "Maiara" })]),
    ], ms(10));
    expect(b.columns.map((c) => c.name)).toEqual(["Maiara"]);
    expect(b.top).toEqual({ late: [], waiting: [], toPay: [] });
  });

  it("horário sem profissional vai para a coluna 'Sem profissional', no fim", () => {
    const b = board([visit("Rita", [svc({ start: at(11), professionalId: null, pro: null })]), visit("Paula", [svc({ start: at(12), professionalId: CARLA.id, pro: "Carla" })])], ms(10));
    expect(b.columns.map((c) => [c.id, c.name])).toEqual([[CARLA.id, "Carla"], [null, "Sem profissional"]]);
  });

  it("assistente atendendo sem a principal ter horário: a coluna da principal aparece com a assistente", () => {
    const b = board([visit("Rita", [svc({ start: at(11), professionalId: SIDNEY.id, pro: "Thaise", assistant: "Sidney" })])], ms(10));
    expect(b.columns).toHaveLength(1);
    expect(b.columns[0]).toMatchObject({ id: THAISE.id, name: "Thaise", assistants: [{ name: "Sidney" }] });
  });
});

describe("Ao vivo: o topo", () => {
  const dia = (caixaOn: boolean) => board([
    visit("Atrasada", [svc({ start: at(9, 30) })]),
    visit("No Horário", [svc({ start: at(11) })]),
    visit("Esperando", [svc({ start: at(10), status: "chegou" })]),
    visit("Sendo Atendida", [svc({ start: at(9), status: "em_atendimento" })]),
    visit("Pronta Sem Pagar", [svc({ start: at(8), status: "compareceu" })], { comanda: { id: "c1", number: 3, status: "aberta" } }),
    visit("Pronta Sem Comanda", [svc({ start: at(8, 30), status: "compareceu" })]),
    visit("Paga", [svc({ start: at(8), status: "compareceu" })], { comanda: { id: "c2", number: 4, status: "fechada" } }),
  ], ms(10, 15), { caixaOn });

  it("atrasadas para chegar, esperando começar (chegou e não começou) e a receber (finalizou e não pagou)", () => {
    expect(dia(true).top).toEqual({ late: ["Atrasada"], waiting: ["Esperando"], toPay: ["Pronta Sem Pagar", "Pronta Sem Comanda"] });
  });
  it("visita com um horário às 00:00 e outro às 15:00 não conta como atrasada de manhã (a entrada passa a ser o horário de verdade)", () => {
    const v = visit("Rita", [svc({ start: at(0) }), svc({ start: at(15) })]);
    expect(v.entry).toBe(at(0));
    expect(board([v], ms(10, 20)).top.late).toEqual([]);
  });
  it("sem o caixa no CRM, não há 'a receber'", () => expect(dia(false).top.toPay).toBeNull());
});

describe("Ao vivo: textos", () => {
  it("a mesma régua do Hoje: CLIENTE PADRÃO (com ou sem acento, com complemento) e espera às 00:00 ficam fora dos dois", () => {
    const visits = [
      visit("Cliente Padrao", [svc({ start: at(10) })]),
      visit("CLIENTE PADRÃO (balcão)", [svc({ start: at(11) })]),
      visit("Rita", [svc({ start: at(0), status: "espera" })]),
      visit("Paula", [svc({ start: at(0) }), svc({ start: at(15) })]),
    ];
    const live = board(visits, ms(9)).columns.flatMap((c) => [...c.now, ...(c.next ? [c.next] : [])].map((x) => x.client));
    expect(live).toEqual(["Paula"]);
    expect(dayTableVisits(visits, "2026-10-17").map((v) => [v.name, v.entry])).toEqual([["Paula", at(15)]]);
  });
  it("serviço com a primeira letra maiúscula", () => {
    expect(serviceTitle("LUZES E MECHAS")).toBe("Luzes e Mechas");
    expect(serviceTitle("escova progressiva")).toBe("Escova progressiva");
    expect(serviceTitle("Corte")).toBe("Corte");
  });
  it("minutos para ler de longe", () => {
    expect(minText(8)).toBe("8 min");
    expect(minText(65)).toBe("1h05");
    expect(minText(120)).toBe("2h");
  });
});
