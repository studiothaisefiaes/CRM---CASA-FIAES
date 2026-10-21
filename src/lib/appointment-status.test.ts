import { describe, expect, it } from "vitest";
import { canMarkNoShow, checkCancel, checkTransition, nextStep, OCCUPYING_STATUSES, statusGroup } from "./appointment-status";

const at = (h: number, m = 0, day = 16) => new Date(Date.UTC(2026, 9, day, h + 3, m)); // Salvador
const ctx = (now: Date, startsAt = at(10), via: "recepcao" | "profissional" | "comanda" = "recepcao") => ({ startsAt, now, via });

describe("transições (spec 4.3)", () => {
  it("confirmar: só agendado e antes do início", () => {
    expect(checkTransition("agendado", "confirmado", ctx(at(9))).ok).toBe(true);
    expect(checkTransition("agendado", "confirmado", ctx(at(10, 1)))).toEqual({ ok: false, error: "Esse horário já começou: não dá mais para confirmar." });
    expect(checkTransition("chegou", "confirmado", ctx(at(9))).ok).toBe(false);
  });
  it("chegou: agendado ou confirmado, no dia do horário, a qualquer hora", () => {
    expect(checkTransition("confirmado", "chegou", ctx(at(7))).ok).toBe(true);
    expect(checkTransition("agendado", "chegou", ctx(at(9, 0, 15)))).toEqual({ ok: false, error: "Só dá para marcar Chegou no dia do horário." });
  });
  it("iniciar: de chegou; direto de agendado/confirmado só no dia", () => {
    expect(checkTransition("chegou", "em_atendimento", ctx(at(9))).ok).toBe(true);
    expect(checkTransition("agendado", "em_atendimento", ctx(at(9, 50))).ok).toBe(true);
    expect(checkTransition("agendado", "em_atendimento", ctx(at(9, 0, 15))).ok).toBe(false);
  });
  it("finalizar: de chegou ou em atendimento; direto de agendado só depois do início", () => {
    expect(checkTransition("em_atendimento", "compareceu", ctx(at(9))).ok).toBe(true);
    expect(checkTransition("agendado", "compareceu", ctx(at(9, 59)))).toEqual({ ok: false, error: "Só dá para finalizar depois do horário de início." });
    expect(checkTransition("agendado", "compareceu", ctx(at(10))).ok).toBe(true);
  });
  it("faltou: só depois do início; a profissional, só 15 min depois", () => {
    expect(checkTransition("agendado", "faltou", ctx(at(9, 59)))).toEqual({ ok: false, error: "Só dá para marcar falta depois do horário" });
    expect(checkTransition("agendado", "faltou", ctx(at(10, 10), at(10), "profissional"))).toEqual({ ok: false, error: "Só dá para marcar falta 15 min depois do horário." });
    expect(checkTransition("confirmado", "faltou", ctx(at(10, 15), at(10), "profissional")).ok).toBe(true);
    expect(canMarkNoShow({ status: "agendado", startsAt: at(10) }, at(10, 1))).toBe(true);
  });
  it("agendado só para aceitar o pedido do site; voltar atrás é Desfazer", () => {
    expect(checkTransition("solicitado", "agendado", ctx(at(9))).ok).toBe(true);
    expect(checkTransition("cancelado", "agendado", ctx(at(9)))).toEqual({ ok: false, error: "Para voltar atrás, use Desfazer." });
  });
  it("lista de espera nunca muda por aqui", () => {
    expect(checkTransition("espera", "chegou", ctx(at(9)))).toEqual({ ok: false, error: "Esse pedido está na lista de espera: marque um horário antes." });
  });
  it("a comanda finaliza qualquer horário aberto, a qualquer hora (pagar prova a visita)", () => {
    expect(checkTransition("agendado", "compareceu", ctx(at(9), at(10), "comanda")).ok).toBe(true);
    expect(checkTransition("faltou", "compareceu", ctx(at(11), at(10), "comanda")).ok).toBe(false);
  });
  it("cancelar: agendado, confirmado, chegou ou pedido do site; em atendimento e encerrados não", () => {
    for (const s of ["agendado", "confirmado", "chegou", "solicitado"]) expect(checkCancel(s).ok).toBe(true);
    expect(checkCancel("em_atendimento")).toEqual({ ok: false, error: "A cliente já está em atendimento: finalize ou desfaça antes." });
    expect(checkCancel("compareceu").ok).toBe(false);
    expect(checkCancel("cancelado")).toEqual({ ok: false, error: "Esse horário já está cancelado." });
  });
});

describe("próximo passo no card", () => {
  it("Confirmar antes do dia; Chegou no dia; Iniciar; Finalizar; depois do início sem Chegou, Finalizar", () => {
    expect(nextStep({ status: "agendado", startsAt: at(10) }, at(9, 0, 15))).toBe("confirmado");
    expect(nextStep({ status: "confirmado", startsAt: at(10) }, at(9, 0, 15))).toBeNull();
    expect(nextStep({ status: "agendado", startsAt: at(10) }, at(8))).toBe("chegou");
    expect(nextStep({ status: "chegou", startsAt: at(10) }, at(9))).toBe("em_atendimento");
    expect(nextStep({ status: "em_atendimento", startsAt: at(10) }, at(9))).toBe("compareceu");
    expect(nextStep({ status: "confirmado", startsAt: at(10) }, at(10, 5))).toBe("compareceu");
    expect(nextStep({ status: "solicitado", startsAt: at(10) }, at(8))).toBe("agendado");
    expect(nextStep({ status: "compareceu", startsAt: at(10) }, at(11))).toBeNull();
  });
});

it("quem ocupa a agenda e os grupos de status (para comparar com o Avec)", () => {
  expect(OCCUPYING_STATUSES).toEqual(["solicitado", "agendado", "confirmado", "chegou", "em_atendimento", "compareceu", "conferir"]);
  expect([statusGroup("chegou"), statusGroup("confirmado"), statusGroup("compareceu"), statusGroup("faltou"), statusGroup("cancelado"), statusGroup("Pago estranho")])
    .toEqual(["ativo", "ativo", "feito", "faltou", "cancelado", "outro"]);
});

describe("conferir: situação do Avec que o CRM não conhece (17/10)", () => {
  it("não ocupa o lugar de agendado: Veio, Faltou, Chegou e Cancelar resolvem; Confirmar não", () => {
    expect(checkTransition("conferir", "compareceu", ctx(at(11)))).toEqual({ ok: true });
    expect(checkTransition("conferir", "faltou", ctx(at(11)))).toEqual({ ok: true });
    expect(checkTransition("conferir", "chegou", ctx(at(9)))).toEqual({ ok: true });
    expect(checkTransition("conferir", "confirmado", ctx(at(9))).ok).toBe(false);
    expect(checkTransition("conferir", "compareceu", ctx(at(11), at(10), "comanda"))).toEqual({ ok: true });
    expect(checkCancel("conferir")).toEqual({ ok: true });
  });
  it("ocupa a grade (o Avec diz que tem alguém ali) e conta como 'outro' na comparação", () => {
    expect(OCCUPYING_STATUSES).toContain("conferir");
    expect(statusGroup("conferir")).toBe("outro");
  });
});

it("revisão final: conferir aparece no app da profissional", async () => {
  const { PRO_VISIBLE_STATUSES } = await import("./pro-day");
  expect(PRO_VISIBLE_STATUSES).toContain("conferir");
});
