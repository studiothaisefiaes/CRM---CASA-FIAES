import { beforeEach, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1", perms: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", async () => {
  const { UserFacingError } = await import("@/server/domain/errors");
  const check = async (p: string) => { if (!user.perms.includes(p)) throw new UserFacingError("Você não tem permissão para isso."); return user; };
  return { assertPerm: check };
});
vi.mock("@/server/domain/caixa/payment-fees", () => ({ savePaymentFee: vi.fn(async () => {}) }));
import { savePaymentFee } from "@/server/domain/caixa/payment-fees";
import { savePaymentFeeAction } from "./actions";

beforeEach(() => { user.perms = []; vi.clearAllMocks(); });
const input = { method: "credito" as const, brand: "visa", parcelado: false, feeBp: 243 };

it("sem caixa.taxas, mudar a taxa do cartão é recusado no servidor (caixa.gerir não basta)", async () => {
  user.perms = ["caixa.gerir"];
  expect(await savePaymentFeeAction(input)).toEqual({ ok: false, error: "Você não tem permissão para isso." });
  expect(savePaymentFee).not.toHaveBeenCalled();
});

it("com caixa.taxas, salva", async () => {
  user.perms = ["caixa.taxas"];
  expect(await savePaymentFeeAction(input)).toEqual({ ok: true });
  expect(savePaymentFee).toHaveBeenCalledWith(input, expect.objectContaining({ id: "u1" }));
});

it("entrada inválida não chega ao domínio", async () => {
  user.perms = ["caixa.taxas"];
  expect((await savePaymentFeeAction({ ...input, method: "pix" as never })).ok).toBe(false);
  expect(savePaymentFee).not.toHaveBeenCalled();
});
