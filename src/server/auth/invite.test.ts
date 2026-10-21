import { it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../../../test/db";

const hashes = vi.hoisted(() => ({ n: 0 }));
vi.mock("./password", async (importOriginal) => {
  const m = await importOriginal<typeof import("./password")>();
  return { ...m, hashPassword: async (p: string) => { hashes.n++; return m.hashPassword(p); } };
});
import { acceptInvite, createInvite } from "./users";

beforeEach(async () => { hashes.n = 0; await resetDb(); });

it("token inválido ou expirado é recusado ANTES do argon2 (não gasta CPU com quem chuta tokens)", async () => {
  await expect(acceptInvite("token-que-nao-existe", "senha-boa-123")).rejects.toThrow(/expirou ou já foi usado/);
  expect(hashes.n).toBe(0);
});

it("token válido: calcula o hash uma vez e aceita; reusar o token é recusado sem novo hash", async () => {
  const token = await createInvite({ name: "Bruna", email: "bruna@casa.com", role: "atendente" });
  await acceptInvite(token, "senha-boa-123");
  expect(hashes.n).toBe(1);
  await expect(acceptInvite(token, "senha-boa-123")).rejects.toThrow(/expirou/);
  expect(hashes.n).toBe(1);
});
