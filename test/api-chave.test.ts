import { beforeEach, expect, it } from "vitest";
import { db } from "@/server/db";
import { apiKeys } from "@/server/db/schema";
import { autenticarChave } from "@/server/api/chaves";
import { apiChave } from "../scripts/api-chave";
import { resetDb } from "./db";
import { pessoa } from "./api-fixtures";

beforeEach(async () => { await resetDb(); });

it("scripts/api-chave.ts: cria (imprime a chave só aí), lista sem a chave e revoga pelo prefixo", async () => {
  const u = await pessoa("atendente");
  const linhas: string[] = [];
  const out = (s: string) => linhas.push(s);
  await apiChave(["criar", "--nome", "Script", "--email", u.email.toUpperCase(), "--escopos", "ler,escrever"], out);
  const chave = linhas.join("\n").match(/cf_[A-Za-z0-9_-]{43}/)![0];
  expect(await autenticarChave(`Bearer ${chave}`)).toMatchObject({ user: { id: u.id }, chave: { escopos: ["ler", "escrever"] } });
  linhas.length = 0;
  await apiChave(["listar"], out);
  expect(linhas.join("\n")).not.toContain(chave);
  expect(linhas.join("\n")).toContain(`${chave.slice(0, 8)}…`);
  linhas.length = 0;
  await apiChave(["revogar", chave.slice(0, 8)], out);
  expect(linhas).toEqual(['Chave "Script" revogada.']);
  expect((await db.select().from(apiKeys))[0].revokedAt).not.toBeNull();
  await expect(apiChave(["criar", "--nome", "x", "--email", u.email, "--escopos", "tudo"], out)).rejects.toThrow(/Escopo desconhecido/);
  await expect(apiChave(["criar", "--nome", "x", "--email", "ninguem@x.com", "--escopos", "ler"], out)).rejects.toThrow(/Ninguém/);
  await expect(apiChave(["outra"], out)).rejects.toThrow(/Uso:/);
});
