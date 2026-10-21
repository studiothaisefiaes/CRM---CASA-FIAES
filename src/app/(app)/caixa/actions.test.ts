import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1", perms: [] as string[] }));
const creds = vi.hoisted(() => ({ ok: null as null | { id: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: string) => { if (!user.perms.includes(p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check, assertAnyPerm: check, assertUser: async () => user };
});
vi.mock("@/server/auth/users", () => ({ checkCredentials: vi.fn(async () => creds.ok) }));
vi.mock("@/server/domain/caixa/comandas", async (orig) => {
  const m = await orig<typeof import("@/server/domain/caixa/comandas")>();
  return { ...m, addPayment: vi.fn(async () => { throw new m.CashClosedError(); }), cancelComanda: vi.fn(async () => {}), closeComanda: vi.fn(async () => ({ number: 1 })), openWalkInComanda: vi.fn(async () => ({ comandaId: "c1", number: 1 })),
    setComandaDiscount: vi.fn(async (_id: string, input: { approverId?: string | null }) => { if (!input.approverId) throw new m.ApprovalNeededError("Desconto de 30% passa do limite de 20%: a gestão aprova."); }) };
});
vi.mock("@/server/domain/caixa/cash", async (orig) => {
  const m = await orig<typeof import("@/server/domain/caixa/cash")>();
  return { ...m, cancelMovement: vi.fn(async () => {}), addMovement: vi.fn(async () => ({ id: "m1" })), closeCash: vi.fn(async (input: { approverId?: string | null }) => ({ status: "fechado", approverId: input.approverId ?? null })), userHasPerm: vi.fn(async (id: string) => id === "gestora") };
});
vi.mock("@/server/domain/fiscal/nfse", () => ({ emitNfse: vi.fn(async () => ({ id: "n1", status: "autorizada" })), cancelNfse: vi.fn(async () => {}) }));
vi.mock("@/server/domain/fiscal/nfce/nfce", () => ({ emitNfce: vi.fn(async () => ({ id: "p1", status: "autorizada" })), cancelNfce: vi.fn(async () => {}) }));
import { cancelMovementAction, movementAction, addPaymentAction, cancelarNota, cancelarNotaProduto, cancelComandaAction, closeCashAction, emitirNota, emitirNotaProduto, openWalkInAction, setDiscountAction } from "./actions";

beforeEach(() => { user.perms = []; user.id = `u${Math.random()}`; creds.ok = null; });
const ID = "11111111-1111-4111-8111-111111111111";
const close = { cashBreakdown: { "5000": 1 }, counted: {} };

it("sem caixa.operar, abrir comanda é recusado no servidor", async () => {
  expect(await openWalkInAction({ requestKey: ID, item: { kind: "produto", label: "Kit", unitCents: 100 } })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
});

it("Nova comanda (QA r58, I-8): a ação só abre com o primeiro item (nunca vazia)", async () => {
  user.perms = ["caixa.operar"];
  const { openWalkInComanda } = await import("@/server/domain/caixa/comandas");
  expect((await openWalkInAction({ requestKey: ID } as Parameters<typeof openWalkInAction>[0])).ok).toBe(false);
  expect(openWalkInComanda).not.toHaveBeenCalled();
  const item = { kind: "produto" as const, label: "Kit", unitCents: 5000 };
  expect(await openWalkInAction({ requestKey: ID, clientName: "Moça do café", item })).toEqual({ ok: true, data: { comandaId: "c1", number: 1 } });
  expect(openWalkInComanda).toHaveBeenCalledWith(expect.objectContaining({ requestKey: ID, clientName: "Moça do café", item: expect.objectContaining(item) }), expect.anything());
});

it("receber sem caixa aberto (quando exigido): a tela recebe needsCash para oferecer 'Abrir caixa'", async () => {
  user.perms = ["caixa.operar"];
  expect(await addPaymentAction(ID, { method: "pix", valueCents: 100 })).toEqual({ ok: false, error: "Abra o seu caixa para receber.", needsCash: true });
});

it("cancelar comanda fechada é só da gestão (caixa.gerir)", async () => {
  user.perms = ["caixa.operar"];
  expect((await cancelComandaAction(ID, { reason: "x" })).ok).toBe(false);
  user.perms = ["caixa.gerir"];
  expect(await cancelComandaAction(ID, { reason: "x" })).toEqual({ ok: true });
});

it("aprovação da diferença: senha errada, pessoa sem a gestão do caixa e a gestão aprovando", async () => {
  user.perms = ["caixa.operar"];
  expect(await closeCashAction({ ...close, approval: { email: "g@c.com", password: "errada" } })).toEqual({ ok: false, error: "E-mail ou senha da gestão não conferem." });
  creds.ok = { id: "cati" };
  expect(await closeCashAction({ ...close, approval: { email: "cati@c.com", password: "x" } })).toEqual({ ok: false, error: "Essa pessoa não aprova diferença de caixa. Chame alguém da gestão." });
  creds.ok = { id: "gestora" };
  expect(await closeCashAction({ ...close, approval: { email: "g@c.com", password: "certa" } })).toEqual({ ok: true, data: { status: "fechado", approverId: "gestora" } });
});

it("aprovar a própria diferença só com caixa.gerir; sem aprovação, nada de aprovador", async () => {
  user.perms = ["caixa.operar"];
  expect(await closeCashAction({ ...close, approval: { self: true } })).toEqual({ ok: false, error: "Peça a aprovação de alguém da gestão." });
  expect(await closeCashAction(close)).toEqual({ ok: true, data: { status: "fechado", approverId: null } });
  user.perms = ["caixa.operar", "caixa.gerir"];
  expect(await closeCashAction({ ...close, approval: { self: true } })).toEqual({ ok: true, data: { status: "fechado", approverId: user.id } });
});

it("muitas tentativas de senha da gestão: espera", async () => {
  user.perms = ["caixa.operar"];
  for (let i = 0; i < 5; i++) await closeCashAction({ ...close, approval: { email: "g@c.com", password: "errada" } });
  expect(await closeCashAction({ ...close, approval: { email: "g@c.com", password: "errada" } })).toEqual({ ok: false, error: "Muitas tentativas. Espere alguns minutos." });
});

it("desconto acima do limite (QA r58, I-11): a tela recebe needsApproval; a gestão aprova com e-mail e senha, como no fechamento", async () => {
  user.perms = ["caixa.operar"];
  const { setComandaDiscount } = await import("@/server/domain/caixa/comandas");
  const input = { percent: 30, reason: "promoção" };
  expect(await setDiscountAction(ID, input)).toEqual({ ok: false, error: "Desconto de 30% passa do limite de 20%: a gestão aprova.", needsApproval: true });
  expect(await setDiscountAction(ID, { ...input, approval: { self: true } })).toEqual({ ok: false, error: "Peça a aprovação de alguém da gestão." });
  creds.ok = { id: "gestora" };
  expect(await setDiscountAction(ID, { ...input, approval: { email: "g@c.com", password: "certa" } })).toEqual({ ok: true });
  expect(setComandaDiscount).toHaveBeenLastCalledWith(ID, expect.objectContaining({ percent: 30, approverId: "gestora" }), expect.anything());
});

it("Regra do dono: emitir nota pede nota.emitir (caixa.operar não basta), no servidor", async () => {
  const { emitNfse } = await import("@/server/domain/fiscal/nfse");
  user.perms = ["caixa.operar", "caixa.gerir"];
  expect(await emitirNota(ID)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(emitNfse).not.toHaveBeenCalled();
  user.perms = ["nota.emitir"];
  expect(await emitirNota(ID)).toEqual({ ok: true, data: { id: "n1", status: "autorizada" } });
  expect(emitNfse).toHaveBeenCalledWith(ID, { id: user.id, perms: ["nota.emitir"] });
});

it("Regra do dono: cancelar nota pede nota.cancelar (caixa.gerir não basta), no servidor", async () => {
  const { cancelNfse } = await import("@/server/domain/fiscal/nfse");
  user.perms = ["caixa.operar", "caixa.gerir", "nota.emitir"];
  expect((await cancelarNota(ID, { reason: "Serviço lançado errado" })).ok).toBe(false);
  expect(cancelNfse).not.toHaveBeenCalled();
  user.perms = ["nota.cancelar"];
  expect(await cancelarNota(ID, { reason: "Serviço lançado errado" })).toEqual({ ok: true });
  expect(cancelNfse).toHaveBeenCalledWith(ID, { reason: "Serviço lançado errado" }, { id: user.id, perms: ["nota.cancelar"] });
});

it("Regra do dono: emitir NFC-e pede nota.emitir e cancelar NFC-e pede nota.cancelar, no servidor", async () => {
  const { emitNfce, cancelNfce } = await import("@/server/domain/fiscal/nfce/nfce");
  user.perms = ["caixa.operar", "caixa.gerir", "nota.ver"];
  expect(await emitirNotaProduto(ID)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect((await cancelarNotaProduto(ID, { reason: "Produto lançado errado" })).ok).toBe(false);
  expect(emitNfce).not.toHaveBeenCalled();
  expect(cancelNfce).not.toHaveBeenCalled();
  user.perms = ["nota.emitir"];
  expect(await emitirNotaProduto(ID)).toEqual({ ok: true, data: { id: "p1", status: "autorizada" } });
  expect(emitNfce).toHaveBeenCalledWith(ID, { id: user.id, perms: ["nota.emitir"] });
  expect((await cancelarNotaProduto(ID, { reason: "Produto lançado errado" })).ok).toBe(false);
  user.perms = ["nota.cancelar"];
  expect(await cancelarNotaProduto(ID, { reason: "Produto lançado errado" })).toEqual({ ok: true });
  expect(cancelNfce).toHaveBeenCalledWith(ID, { reason: "Produto lançado errado" }, { id: user.id, perms: ["nota.cancelar"] });
});

it("sem config.sistema, salvar o liga/desliga do caixa é recusado no servidor", async () => {
  const { CAIXA_RECURSOS_PADRAO } = await import("@/lib/caixa-recursos");
  const { saveCaixaRecursosAction } = await import("./actions");
  expect(await saveCaixaRecursosAction(CAIXA_RECURSOS_PADRAO)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
});

it("assistente na comanda: sem caixa.assistente a ação é recusada no servidor (só caixa.operar não basta)", async () => {
  const { setAssistantsAction } = await import("./actions");
  user.perms = ["caixa.operar"];
  expect(await setAssistantsAction(ID, { professionalIds: [] })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  user.perms = ["caixa.assistente"];
  const r = await setAssistantsAction(ID, { professionalIds: [] });
  expect(r.ok === false ? r.error : null).not.toBe("Você não tem permissão para isso."); // passou da permissão (o item de teste não existe)
});

it("dívida: Finalizar deixando dívida pede caixa.divida além de caixa.operar (recusado no servidor); sem dívida, só caixa.operar", async () => {
  const { closeComandaAction } = await import("./actions");
  const { closeComanda } = await import("@/server/domain/caixa/comandas");
  user.perms = ["caixa.operar"];
  expect(await closeComandaAction(ID, { leaveDebt: true })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(closeComanda).not.toHaveBeenCalled();
  expect(await closeComandaAction(ID, {})).toEqual({ ok: true, data: { number: 1 } });
  expect(closeComanda).toHaveBeenLastCalledWith(ID, { saveChangeAsCredit: false, leaveDebt: false }, expect.anything());
  user.perms = ["caixa.divida"];
  expect(await closeComandaAction(ID, { leaveDebt: true })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  user.perms = ["caixa.operar", "caixa.divida"];
  expect(await closeComandaAction(ID, { leaveDebt: true })).toEqual({ ok: true, data: { number: 1 } });
  expect(closeComanda).toHaveBeenLastCalledWith(ID, { saveChangeAsCredit: false, leaveDebt: true }, expect.anything());
});

it("sangria com vale pede caixa.vale além de caixa.operar (no servidor); sem vale segue como hoje", async () => {
  const { addMovement } = await import("@/server/domain/caixa/cash");
  const base = { kind: "sangria" as const, valueCents: 5000, reason: "vale" };
  user.perms = ["caixa.operar"];
  expect(await movementAction(base)).toMatchObject({ ok: true });
  expect(await movementAction({ ...base, vale: { professionalId: ID, password: "x" } })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(addMovement).toHaveBeenCalledTimes(1);
  user.perms = ["caixa.operar", "caixa.vale"];
  expect(await movementAction({ ...base, vale: { professionalId: ID, password: "x" } })).toMatchObject({ ok: true });
  expect(addMovement).toHaveBeenCalledTimes(2);
});

it("cancelar sangria: sem caixa.operar recusa no servidor; com, chama o domínio com o motivo", async () => {
  const { cancelMovement } = await import("@/server/domain/caixa/cash");
  expect(await cancelMovementAction(ID, { reason: "Errei" })).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(cancelMovement).not.toHaveBeenCalled();
  user.perms = ["caixa.operar"];
  expect(await cancelMovementAction(ID, { reason: "Errei" })).toMatchObject({ ok: true });
  expect(cancelMovement).toHaveBeenCalledWith(ID, { reason: "Errei" }, expect.anything());
});
