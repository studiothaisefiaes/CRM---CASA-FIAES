import { describe, expect, it } from "vitest";
import { holdUntil, leaveDecisionDraft, notifyDedupeKey, planProNotifications, whenText, type ApptSnap } from "./pro-notify";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const snap = (o: Partial<ApptSnap> = {}): ApptSnap => ({ id: "ap1", professionalId: "pA", startsAt: bahia("2026-10-16", "10:00"), status: "agendado", clientName: "Paula Souza", serviceLabel: "Corte feminino", ...o });
const ctx = { names: {}, avisaConfirmacao: false };

describe("o que cada mudança avisa (seção 8.4.6)", () => {
  it("novo: primeiro nome, serviço e quando; pedido do site não avisa", () => {
    expect(whenText(bahia("2026-10-16", "10:00"))).toBe("sex 16/10 às 10:00");
    expect(planProNotifications({ kind: "novo", appointment: snap() }, ctx)).toEqual([
      { professionalId: "pA", kind: "novo", appointmentId: "ap1", title: "Horário novo", body: "Paula · Corte feminino · sex 16/10 às 10:00", url: "/pro/dia/2026-10-16?h=ap1", noHold: false },
    ]);
    expect(planProNotifications({ kind: "novo", appointment: snap({ status: "solicitado" }) }, ctx)).toEqual([]);
  });

  it("remarcado: a de antes e a de depois (sem detalhes da outra); mesma profissional com outra hora; nada mudou, nada avisa", () => {
    const moved = planProNotifications({ kind: "remarcado", before: snap(), after: snap({ professionalId: "pB", startsAt: bahia("2026-10-17", "14:00") }) }, { names: { pB: "BIA" }, avisaConfirmacao: false });
    expect(moved.map((d) => [d.professionalId, d.title, d.body, d.url])).toEqual([
      ["pA", "Saiu da sua agenda", "Paula saiu da sua agenda (passou para a Bia)", "/pro/dia/2026-10-16"],
      ["pB", "Horário novo", "Paula passou para você: Corte feminino · sáb 17/10 às 14:00", "/pro/dia/2026-10-17?h=ap1"],
    ]);
    expect(planProNotifications({ kind: "remarcado", before: snap(), after: snap({ startsAt: bahia("2026-10-16", "15:00") }) }, ctx)[0].body)
      .toBe("Paula: era sex 16/10 às 10:00, agora sex 16/10 às 15:00");
    expect(planProNotifications({ kind: "remarcado", before: snap(), after: snap() }, ctx)).toEqual([]);
  });

  it("cancelado avisa; chegou sai sem silêncio; confirmou só com a chave; site confirmado vira 'Horário novo'; o resto não avisa", () => {
    expect(planProNotifications({ kind: "cancelado", appointment: snap() }, ctx)[0].body).toBe("Paula · Corte feminino · sex 16/10 às 10:00 foi cancelado");
    expect(planProNotifications({ kind: "cancelado", appointment: snap({ status: "solicitado" }) }, ctx)).toEqual([]);
    expect(planProNotifications({ kind: "status", from: "agendado", appointment: snap({ status: "chegou" }) }, ctx).map((d) => [d.kind, d.body, d.url, d.noHold]))
      .toEqual([["chegou", "Paula chegou (10:00 · Corte feminino)", "/pro/horario/ap1", true]]);
    expect(planProNotifications({ kind: "status", from: "agendado", appointment: snap({ status: "confirmado" }) }, ctx)).toEqual([]);
    expect(planProNotifications({ kind: "status", from: "agendado", appointment: snap({ status: "confirmado" }) }, { names: {}, avisaConfirmacao: true })[0].kind).toBe("confirmou");
    expect(planProNotifications({ kind: "status", from: "solicitado", appointment: snap({ status: "agendado" }) }, ctx)[0].kind).toBe("novo");
    expect(planProNotifications({ kind: "status", from: "chegou", appointment: snap({ status: "em_atendimento" }) }, { names: {}, avisaConfirmacao: true })).toEqual([]);
  });

  it("folga decidida e a chave que não deixa repetir no mesmo minuto", () => {
    expect(leaveDecisionDraft({ professionalId: "pA", approved: false, period: "20/10 (dia todo)", note: "Dia de muito movimento" }).body).toBe("Sua folga de 20/10 (dia todo) não foi aprovada: Dia de muito movimento");
    expect(leaveDecisionDraft({ professionalId: "pA", approved: true, period: "20/10 (dia todo)", note: null }).body).toBe("Sua folga de 20/10 (dia todo) foi aprovada.");
    expect(notifyDedupeKey({ ref: "ap1", kind: "novo", professionalId: "pA" }, new Date("2026-10-16T13:05:42.123Z"))).toBe("ap1:novo:pA:2026-10-16T13:05");
  });
});

describe("silêncio fora do expediente dela (seção 12, item 3)", () => {
  const casa = (day: string): [number, number][] => { const wd = new Date(`${day}T12:00:00Z`).getUTCDay(); return wd >= 2 && wd <= 6 ? [[540, 1080]] : []; };
  it("dentro da faixa sai na hora; antes do expediente espera abrir; sábado 19h espera terça 9h; segunda (Casa fechada) espera terça", () => {
    expect(holdUntil(bahia("2026-10-16", "10:00").getTime(), casa)).toBeNull();
    expect(holdUntil(bahia("2026-10-16", "07:30").getTime(), casa)?.toISOString()).toBe(bahia("2026-10-16", "09:00").toISOString());
    expect(holdUntil(bahia("2026-10-17", "19:00").getTime(), casa)?.toISOString()).toBe(bahia("2026-10-20", "09:00").toISOString());
    expect(holdUntil(bahia("2026-10-19", "10:00").getTime(), casa)?.toISOString()).toBe(bahia("2026-10-20", "09:00").toISOString());
  });
  it("horário próprio na segunda vale o dela; sem faixa nenhuma em 14 dias, não espera", () => {
    const segunda = (day: string): [number, number][] => (new Date(`${day}T12:00:00Z`).getUTCDay() === 1 ? [[600, 840]] : []);
    expect(holdUntil(bahia("2026-10-19", "11:00").getTime(), segunda)).toBeNull();
    expect(holdUntil(bahia("2026-10-19", "15:00").getTime(), segunda)?.toISOString()).toBe(bahia("2026-10-26", "10:00").toISOString());
    expect(holdUntil(bahia("2026-10-19", "15:00").getTime(), () => [])).toBeNull();
  });
});
