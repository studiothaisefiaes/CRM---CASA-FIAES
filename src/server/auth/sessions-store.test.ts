import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { __clearSessionCache, deleteSession, findSessionUserCached, insertSession, PRO_SESSION_DAYS, renewSession, SESSION_CACHE_MS, SESSION_DAYS } from "./sessions-store";

const DAY = 86_400_000;
const T0 = new Date("2026-10-15T15:00:00Z");
let uid = "";
beforeEach(async () => {
  await resetDb();
  uid = (await db.insert(users).values({ name: "Maiara", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

describe("renovar a sessão (seção 8.3)", () => {
  it("profissional: vai para agora + 90 dias", async () => {
    const { token } = await insertSession(uid, T0);
    const now = new Date(T0.getTime() + 10 * DAY);
    expect((await renewSession(token, now, PRO_SESSION_DAYS))?.toISOString()).toBe(new Date(now.getTime() + 90 * DAY).toISOString());
  });

  it("equipe: agora + 30 dias; renovar nunca encurta", async () => {
    const { token } = await insertSession(uid, T0);
    const now = new Date(T0.getTime() + DAY);
    expect((await renewSession(token, now, SESSION_DAYS))?.toISOString()).toBe(new Date(now.getTime() + 30 * DAY).toISOString());
    await renewSession(token, now, PRO_SESSION_DAYS);
    expect((await renewSession(token, now, SESSION_DAYS))?.toISOString()).toBe(new Date(now.getTime() + 90 * DAY).toISOString());
  });

  it("sessão vencida ou que não existe não renova", async () => {
    const { token } = await insertSession(uid, T0);
    expect(await renewSession(token, new Date(T0.getTime() + 31 * DAY), PRO_SESSION_DAYS)).toBeNull();
    expect(await renewSession("nao-existe", T0, PRO_SESSION_DAYS)).toBeNull();
  });
});

describe("sessão guardada por 5 s (rotas de foto e mídia)", () => {
  it("a mesma sessão não vai ao banco de novo dentro de 5 s; depois, sim; sair apaga na hora", async () => {
    __clearSessionCache();
    const { token } = await insertSession(uid);
    const t = Date.now();
    expect((await findSessionUserCached(token, t))?.id).toBe(uid);
    // Sessão removida direto no banco: dentro da janela ainda vale (guardada), depois não.
    await db.delete(sessions);
    expect((await findSessionUserCached(token, t + 1000))?.id).toBe(uid);
    expect(await findSessionUserCached(token, t + SESSION_CACHE_MS + 1)).toBeNull();
    // Sair (deleteSession) apaga a guardada na hora.
    const s2 = await insertSession(uid);
    expect((await findSessionUserCached(s2.token, t))?.id).toBe(uid);
    await deleteSession(s2.token);
    expect(await findSessionUserCached(s2.token, t + 1)).toBeNull();
    expect(await findSessionUserCached(undefined)).toBeNull();
    expect(await findSessionUserCached("token-que-nao-existe")).toBeNull();
  });
});
