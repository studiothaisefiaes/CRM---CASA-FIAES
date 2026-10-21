import { describe, expect, it } from "vitest";
import { checkStart, freeSlots, pickAny, planVisit, type DayRules, type SlotQuery } from "./free-slots";
import { bahiaParts } from "./schedule";
import { minuteOfDay } from "./agenda";

// Minutos do dia em Salvador: 540 = 09:00, 720 = 12:00, 780 = 13:00, 1080 = 18:00.
const DIA: DayRules = { ranges: [[540, 720], [780, 1080]], blocks: [], busy: [], name: "Ana" };
const MANHA: DayRules = { ranges: [[540, 720]], blocks: [], busy: [], name: "Ana" };
const with_ = (over: Partial<DayRules>): DayRules => ({ ...DIA, ...over });
const starts = (r: ReturnType<typeof freeSlots>) => (r.ok ? r.slots.map((s) => s.start) : r.reason);

describe("freeSlots: horários livres de um dia", () => {
  it("dia simples: começa nos múltiplos do passo e a ocupação inteira cabe na faixa", () => {
    const r = freeSlots(MANHA, { durationMin: 60 });
    expect(starts(r)).toEqual([540, 570, 600, 630, 660]);
    expect(r.ok && r.slots[0]).toEqual({ start: 540, end: 600, kind: "livre", conflicts: [], warnings: [] });
  });

  it("intervalo de almoço não recebe horário; a folga entra na ocupação da profissional", () => {
    const sem = starts(freeSlots(DIA, { durationMin: 60 })) as number[];
    expect(sem).toContain(660); // 11:00–12:00 cabe
    expect(sem).not.toContain(720); // 12:00 é o intervalo
    expect(sem).toContain(1020);
    const com = starts(freeSlots(DIA, { durationMin: 60, bufferMin: 15 })) as number[];
    expect(com).toContain(630);
    expect(com).not.toContain(660); // 11:00 + 1h + 15 min passa do meio-dia
    expect(com).not.toContain(1020);
    expect(com.at(-1)).toBe(990);
  });

  it("passo de 15 e de 30, contados da meia-noite", () => {
    expect(starts(freeSlots(MANHA, { durationMin: 60, stepMin: 15 }))).toEqual([540, 555, 570, 585, 600, 615, 630, 645, 660]);
    expect(starts(freeSlots({ ...MANHA, ranges: [[550, 720]] }, { durationMin: 60 }))).toEqual([570, 600, 630, 660]);
  });

  it("passado: nada antes de notBeforeMin", () => {
    expect(starts(freeSlots(MANHA, { durationMin: 60, notBeforeMin: 615 }))).toEqual([630, 660]);
    expect(checkStart(MANHA, 600, { durationMin: 60, notBeforeMin: 615 })).toMatchObject({ ok: false, reason: "passou" });
  });

  it("duração vazia não vira 60 min: sem_duracao; zero ou mais de um dia: duracao_invalida", () => {
    expect(freeSlots(DIA, { durationMin: null })).toEqual({ ok: false, reason: "sem_duracao" });
    expect(checkStart(DIA, 600, { durationMin: null })).toMatchObject({ ok: false, reason: "sem_duracao" });
    expect(freeSlots(DIA, { durationMin: 0 })).toEqual({ ok: false, reason: "duracao_invalida" });
    expect(freeSlots(DIA, { durationMin: 1441 })).toEqual({ ok: false, reason: "duracao_invalida" });
  });
});

describe("bloqueios", () => {
  const FERIADO = with_({ blocks: [{ id: "b1", title: "Feriado", start: 600, end: 660 }] });
  it("bloqueio (de uma ou de todas) recusa; terminar às 10:00 e começar às 10:00 não é sobreposição", () => {
    const s = starts(freeSlots(FERIADO, { durationMin: 60 })) as number[];
    expect(s).toContain(540); // 09:00–10:00 encosta no bloqueio
    expect(s).not.toContain(570);
    expect(s).not.toContain(630);
    expect(s).toContain(660); // começa quando o bloqueio termina
    expect(checkStart(FERIADO, 600, { durationMin: 60 })).toEqual({ ok: false, reason: "bloqueado", conflicts: [], blockedBy: "Feriado" });
  });
  it("bloqueio vence até o encaixe", () => {
    expect(checkStart(FERIADO, 600, { durationMin: 60, allowFitIn: true, allowOutsideHours: true })).toMatchObject({ ok: false, reason: "bloqueado" });
  });
  it("pedido de folga ainda não aprovado não recusa: só avisa", () => {
    const dia = with_({ blocks: [{ id: "p1", title: "Folga", start: 780, end: 1080, pending: true }] });
    expect(checkStart(dia, 780, { durationMin: 60 })).toEqual({ ok: true, kind: "livre", conflicts: [], warnings: ["Ana pediu folga nesse horário"] });
  });
});

describe("conflitos, encaixe e fora do horário", () => {
  const OCUPADA = with_({ busy: [{ id: "a1", label: "Paula · Corte", start: 600, end: 660, clientId: "c1" }] });
  it("conflito com a mesma profissional: some das sugestões e checkStart diz com quem", () => {
    const s = starts(freeSlots(OCUPADA, { durationMin: 60 })) as number[];
    expect(s).toEqual(expect.arrayContaining([540, 660]));
    expect(s.filter((x) => x > 540 && x < 660)).toEqual([]); // 09:30, 10:00 e 10:30 batem nela
    expect(checkStart(OCUPADA, 600, { durationMin: 60 })).toEqual({ ok: false, reason: "conflito", conflicts: [{ id: "a1", label: "Paula · Corte" }] });
  });
  it("conflito com a mesma cliente em outra profissional conta só a duração (a folga é da profissional)", () => {
    const dia = with_({ busy: [{ id: "a2", label: "Paula · Escova", start: 840, end: 915, clientEnd: 900, clientId: "c1", otherPro: true }] });
    expect(checkStart(dia, 870, { durationMin: 60, clientId: "c1" })).toEqual({ ok: false, reason: "conflito", conflicts: [{ id: "a2", label: "Paula · Escova" }] });
    expect(checkStart(dia, 900, { durationMin: 60, clientId: "c1" })).toMatchObject({ ok: true, kind: "livre" }); // ela sai da escova às 15:00
    expect(checkStart(dia, 870, { durationMin: 60, clientId: "c2" })).toMatchObject({ ok: true }); // outra cliente: a profissional está livre
    expect(checkStart(dia, 870, { durationMin: 60 })).toMatchObject({ ok: true });
  });
  it("'Pode ser feito junto com outro' (0084): o conflito da mesma cliente com outra profissional não conta só quando os dois lados são true", () => {
    const dia = (parallelOk?: boolean) => with_({ busy: [{ id: "a2", label: "Paula · Escova", start: 840, end: 915, clientEnd: 900, clientId: "c1", otherPro: true, parallelOk }] });
    expect(checkStart(dia(true), 870, { durationMin: 60, clientId: "c1", parallelOk: true })).toMatchObject({ ok: true, kind: "livre", conflicts: [] });
    expect(checkStart(dia(true), 870, { durationMin: 60, clientId: "c1", parallelOk: false })).toMatchObject({ ok: false, reason: "conflito" });
    expect(checkStart(dia(true), 870, { durationMin: 60, clientId: "c1", parallelOk: null })).toMatchObject({ ok: false, reason: "conflito" });
    expect(checkStart(dia(undefined), 870, { durationMin: 60, clientId: "c1", parallelOk: true })).toMatchObject({ ok: false, reason: "conflito" });
    // A mesma profissional nunca: parallelOk só vale para o conflito de cliente.
    const mine = with_({ busy: [{ id: "a3", label: "Joana · Corte", start: 840, end: 900, clientId: "c2", parallelOk: true }] });
    expect(checkStart(mine, 870, { durationMin: 60, clientId: "c1", parallelOk: true })).toMatchObject({ ok: false, reason: "conflito" });
  });
  it("encaixe só com allowFitIn, listando com quem conflita", () => {
    const r = freeSlots(OCUPADA, { durationMin: 60, allowFitIn: true });
    expect(r.ok && r.slots.find((x) => x.start === 600)).toMatchObject({ kind: "encaixe", conflicts: [{ id: "a1", label: "Paula · Corte" }] });
    expect(checkStart(OCUPADA, 600, { durationMin: 60, allowFitIn: true })).toMatchObject({ ok: true, kind: "encaixe" });
  });
  it("fora do horário de trabalho só com allowOutsideHours", () => {
    expect(starts(freeSlots(DIA, { durationMin: 60 }))).not.toContain(1080);
    const r = freeSlots(DIA, { durationMin: 60, allowOutsideHours: true });
    expect(r.ok && r.slots.find((x) => x.start === 1080)?.kind).toBe("fora_do_horario");
    expect(r.ok && r.slots.find((x) => x.start === 720)?.kind).toBe("fora_do_horario"); // almoço
    expect(checkStart(DIA, 1080, { durationMin: 60 })).toMatchObject({ ok: false, reason: "fora_do_horario" });
    expect(checkStart(DIA, 1080, { durationMin: 60, allowOutsideHours: true })).toMatchObject({ ok: true, kind: "fora_do_horario" });
  });
  it("conflito e fora do horário juntos pedem as duas permissões", () => {
    const dia = with_({ busy: [{ id: "a4", label: "Rita · Unha", start: 1080, end: 1140 }] });
    expect(checkStart(dia, 1080, { durationMin: 60, allowOutsideHours: true })).toMatchObject({ ok: false, reason: "conflito" });
    expect(checkStart(dia, 1080, { durationMin: 60, allowFitIn: true })).toMatchObject({ ok: false, reason: "fora_do_horario" });
    expect(checkStart(dia, 1080, { durationMin: 60, allowFitIn: true, allowOutsideHours: true })).toMatchObject({ ok: true, kind: "fora_do_horario" });
  });
});

describe("duração desconhecida num horário que já existe", () => {
  // Quem monta o dia põe um passo (10:00–10:30) no lugar da duração que falta.
  const dia = with_({ busy: [{ id: "a3", label: "Paula · Corte", start: 600, end: 630, unknownDuration: true }] });
  const aviso = "Ana tem Paula · Corte às 10:00 sem duração informada: confira antes";
  it("ocupa só um passo e avisa quem começa até 3 h depois, sem bloquear", () => {
    const r = freeSlots(dia, { durationMin: 30 });
    if (!r.ok) throw new Error(r.reason);
    const at = (m: number) => r.slots.find((x) => x.start === m);
    expect(at(600)).toBeUndefined();
    expect(at(630)).toEqual({ start: 630, end: 660, kind: "livre", conflicts: [], warnings: [aviso] });
    expect(at(780)?.warnings).toEqual([aviso]); // 13:00 = 3 h depois
    expect(at(810)?.warnings).toEqual([]);
    expect(at(540)?.warnings).toEqual([]); // antes dele não há o que conferir
  });
});

describe("meia-noite e Casa fechada", () => {
  it("23:30 por 60 min passa da meia-noite: recusado", () => {
    const noite: DayRules = { ranges: [[1080, 1440]], blocks: [], busy: [] };
    expect(checkStart(noite, 1410, { durationMin: 60 })).toMatchObject({ ok: false, reason: "atravessa_meia_noite" });
    expect(checkStart(noite, 1410, { durationMin: 60, allowOutsideHours: true, allowFitIn: true })).toMatchObject({ ok: false, reason: "atravessa_meia_noite" });
    expect((starts(freeSlots(noite, { durationMin: 60 })) as number[]).at(-1)).toBe(1380);
  });
  it("sem faixa no dia (segunda com a Casa fechada): 'não trabalha' sem erro; marcar só como fora do horário", () => {
    const folga: DayRules = { ranges: [], blocks: [], busy: [], name: "Ana" };
    expect(freeSlots(folga, { durationMin: 60 })).toEqual({ ok: false, reason: "nao_trabalha" });
    expect(checkStart(folga, 600, { durationMin: 60 })).toMatchObject({ ok: false, reason: "fora_do_horario" });
    expect(checkStart(folga, 600, { durationMin: 60, allowOutsideHours: true })).toMatchObject({ ok: true, kind: "fora_do_horario" });
    const r = freeSlots(folga, { durationMin: 60, allowOutsideHours: true });
    expect(r.ok && r.slots[0]).toMatchObject({ start: 0, kind: "fora_do_horario" });
  });
});

describe("'Qualquer uma'", () => {
  it("entre as livres, a que tem menos horários no dia; no empate, a ordem na agenda e depois o nome", () => {
    expect(pickAny([
      { id: "bia", name: "Bia", position: 2, dayCount: 3, kind: "livre" },
      { id: "ana", name: "Ana", position: null, dayCount: 2, kind: "livre" },
      { id: "cati", name: "Cati", position: 1, dayCount: 2, kind: "livre" },
      { id: "dani", name: "Dani", position: 0, dayCount: 0, kind: "encaixe" },
    ])).toBe("cati");
    expect(pickAny([{ id: "lia", name: "Lia", position: null, dayCount: 1, kind: "livre" }, { id: "ana", name: "Ana", position: null, dayCount: 1, kind: "livre" }])).toBe("ana");
    expect(pickAny([{ id: "x", name: "X", position: 1, dayCount: 0, kind: null }])).toBeNull();
  });
});

describe("planVisit", () => {
  const OUTRA: DayRules = { ranges: [[540, 1080]], blocks: [], busy: [], name: "Bia" };
  it("'depois' começa no fim da duração do anterior (a folga não segura a cliente)", () => {
    const p = planVisit([{ day: DIA, durationMin: 60, bufferMin: 15, mode: "depois" }, { day: OUTRA, durationMin: 30, mode: "depois" }], 600, {});
    expect(p.map(({ start, end }) => [start, end])).toEqual([[600, 660], [660, 690]]);
    expect(p.every((x) => x.check.ok)).toBe(true);
  });
  it("'junto' começa junto com o anterior", () => {
    const p = planVisit([{ day: DIA, durationMin: 60, mode: "depois" }, { day: OUTRA, durationMin: 45, mode: "junto" }], 600, {});
    expect(p.map(({ start, end }) => [start, end])).toEqual([[600, 660], [600, 645]]);
  });
  it("serviço sem duração aparece no check, sem inventar o fim", () => {
    const p = planVisit([{ day: DIA, durationMin: null, mode: "depois" }], 600, {});
    expect(p[0]).toMatchObject({ start: 600, end: 600, check: { ok: false, reason: "sem_duracao" } });
  });
});

describe("fuso", () => {
  it("as mesmas entradas dão o mesmo resultado com TZ=UTC, America/Sao_Paulo e Asia/Tokyo", () => {
    const dia = with_({
      blocks: [{ id: "b1", title: "Almoço", start: 720, end: 780 }, { id: "p1", title: "Folga", start: 1020, end: 1080, pending: true }],
      busy: [{ id: "a1", label: "Paula · Corte", start: 600, end: 630, unknownDuration: true }, { id: "a2", label: "Rita · Escova", start: 840, end: 900 }],
    });
    const q: SlotQuery = { durationMin: 45, bufferMin: 10, stepMin: 15, allowFitIn: true };
    // 17/10/2026 02:30 UTC = 16/10 23:30 em Salvador.
    const run = () => JSON.stringify([freeSlots(dia, q), checkStart(dia, 1410, { durationMin: 60 }), minuteOfDay("2026-10-17T02:30:00Z"), bahiaParts(Date.parse("2026-10-17T02:30:00Z"))]);
    const original = process.env.TZ;
    const offsets: number[] = [];
    try {
      const out = ["UTC", "America/Sao_Paulo", "Asia/Tokyo"].map((tz) => { process.env.TZ = tz; offsets.push(new Date(0).getTimezoneOffset()); return run(); });
      expect(new Set(offsets).size).toBe(3); // o fuso do processo mudou de verdade
      expect(new Set(out).size).toBe(1);
      expect(JSON.parse(out[0])[2]).toBe(1410);
      expect(JSON.parse(out[0])[3]).toEqual({ date: "2026-10-16", time: "23:30" });
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});
