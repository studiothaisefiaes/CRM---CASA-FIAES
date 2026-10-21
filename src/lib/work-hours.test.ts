import { describe, expect, it } from "vitest";
import type { BusinessHours } from "./business-hours";
import { casaAsWorkHours, dayOff, daysOutsideCasa, describeWorkHours, effectiveRanges, summarizeWorkHours, workHoursSchema, type WorkHours } from "./work-hours";

// Horário da Casa desde o Lote 0: terça a sábado, 9h às 18h.
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const closed: WorkHours = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null };
const week = (over: Partial<WorkHours>): WorkHours => ({ ...closed, ...over });
const errorOf = (v: unknown) => { const r = workHoursSchema.safeParse(v); return r.success ? null : r.error.issues[0]?.message; };

// 12/10/2026 é segunda; 13/10, terça.
const SEGUNDA = "2026-10-12", TERCA = "2026-10-13";

describe("workHoursSchema", () => {
  it("aceita 1 ou 2 faixas por dia e null para quem não trabalha", () => {
    expect(errorOf(week({ "2": [["09:00", "12:00"], ["13:00", "18:00"]], "3": [["09:00", "18:00"]] }))).toBeNull();
    expect(errorOf(closed)).toBeNull();
  });
  it("recusa com o dia e a faixa errados escritos", () => {
    expect(errorOf(week({ "2": [["09:00", "12:00"], ["13:00", "12:30"]] }))).toBe("Terça, 2ª faixa: o fim precisa ser depois do início.");
    expect(errorOf(week({ "2": [["09:00", "13:00"], ["12:00", "18:00"]] }))).toBe("Terça: as faixas se sobrepõem.");
    expect(errorOf(week({ "4": [["05:00", "12:00"]] }))).toBe("Quinta, 1ª faixa: use horários entre 06:00 e 24:00.");
    expect(errorOf(week({ "6": [["09:00", "25:00"]] }))).toBe("Sábado, 1ª faixa: use horários entre 06:00 e 24:00.");
    expect(errorOf(week({ "1": [["9h", "18:00"]] }))).toBe("Segunda, 1ª faixa: use horários entre 06:00 e 24:00.");
    expect(errorOf(week({ "2": [["09:00", "11:00"], ["12:00", "14:00"], ["15:00", "18:00"]] }))).toBe("Terça: no máximo 2 faixas (use o intervalo para o almoço).");
  });
  it("dia sem faixa vira 'não trabalha' e as faixas ficam em ordem", () => {
    const r = workHoursSchema.parse(week({ "2": [["13:00", "18:00"], ["09:00", "12:00"]], "3": [] }));
    expect(r["2"]).toEqual([["09:00", "12:00"], ["13:00", "18:00"]]);
    expect(r["3"]).toBeNull();
  });
  it("dia que falta conta como 'não trabalha'", () => {
    expect(workHoursSchema.parse({ "2": [["09:00", "18:00"]] })).toEqual(week({ "2": [["09:00", "18:00"]] }));
  });
});

describe("effectiveRanges", () => {
  it("sem horário próprio, herda o da Casa; na segunda a Casa fecha e ela também", () => {
    expect(effectiveRanges(TERCA, null, CASA)).toEqual([[540, 1080]]);
    expect(effectiveRanges(SEGUNDA, null, CASA)).toEqual([]);
  });
  it("horário próprio vence o da Casa, inclusive num dia em que a Casa fecha", () => {
    const pro = week({ "1": [["10:00", "14:00"]], "3": [["09:00", "12:00"], ["13:00", "18:00"]] });
    expect(effectiveRanges(SEGUNDA, pro, CASA)).toEqual([[600, 840]]);
    expect(effectiveRanges(TERCA, pro, CASA)).toEqual([]); // terça é folga dela, mesmo com a Casa aberta
    expect(effectiveRanges("2026-10-14", pro, CASA)).toEqual([[540, 720], [780, 1080]]);
  });
  it("Casa aberta 24 horas vai de 0 a 1440", () => {
    const allDay: [string, string] = ["00:00", "24:00"];
    expect(effectiveRanges(TERCA, null, { ...CASA, "2": allDay })).toEqual([[0, 1440]]);
  });
});

describe("descrição", () => {
  it("sem horário próprio: o da Casa, dito como igual ao da Casa", () => {
    expect(describeWorkHours(null, CASA)).toBe("ter–sáb, 9h–18h · igual ao da Casa");
    expect(summarizeWorkHours(casaAsWorkHours(CASA))).toBe("ter–sáb, 9h–18h");
  });
  it("horário próprio com intervalo e dias diferentes", () => {
    const pro = week({ "2": [["09:00", "12:00"], ["13:00", "18:00"]], "3": [["09:00", "12:00"], ["13:00", "18:00"]], "6": [["09:30", "14:00"]] });
    expect(describeWorkHours(pro, CASA)).toBe("ter–qua, 9h–12h e 13h–18h; sáb, 9h30–14h");
    expect(summarizeWorkHours(closed)).toBe("não trabalha");
  });
  it("lista os dias em que ela trabalha e a Casa não abre", () => {
    expect(daysOutsideCasa(week({ "1": [["10:00", "14:00"]], "2": [["09:00", "18:00"]] }), CASA)).toEqual(["segunda"]);
    expect(daysOutsideCasa(week({ "2": [["09:00", "18:00"]] }), CASA)).toEqual([]);
  });
});

describe("folga do dia inteiro", () => {
  it("sem faixa, ou com todas as faixas cobertas por bloqueios, é folga", () => {
    expect(dayOff([], [])).toBe(true);
    expect(dayOff([[540, 1080]], [[0, 1440]])).toBe(true);
    expect(dayOff([[540, 720], [780, 1080]], [[540, 700], [700, 720], [760, 1080]])).toBe(true);
    expect(dayOff([[540, 1080]], [[720, 780]])).toBe(false); // só o almoço
    expect(dayOff([[540, 1080]], [])).toBe(false);
  });
});

