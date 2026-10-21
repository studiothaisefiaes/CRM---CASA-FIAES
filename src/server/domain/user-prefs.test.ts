import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userPreferences, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { DEFAULT_CFG, defaultPrefs, saveAsView } from "@/lib/agenda-view-prefs";
import { getAgendaPrefs, saveAgendaPrefs } from "./user-prefs";

let ana: string, bia: string;
beforeEach(async () => {
  await resetDb();
  [ana, bia] = (await db.insert(users).values([{ name: "Ana", email: "ana@c.com", passwordHash: "x" }, { name: "Bia", email: "bia@c.com", passwordHash: "x" }]).returning()).map((u) => u.id);
});

describe("preferências da Agenda por usuário", () => {
  it("sem nada gravado: a visão Padrão", async () => {
    expect(await getAgendaPrefs(ana)).toEqual(defaultPrefs());
  });

  it("grava e lê de volta; cada pessoa tem as suas; gravar de novo substitui", async () => {
    const unhas = saveAsView(defaultPrefs(), "Unhas", { ...DEFAULT_CFG, tam: "grande", ocultas: ["x"] }, []).prefs;
    await saveAgendaPrefs(ana, unhas);
    expect(await getAgendaPrefs(ana)).toEqual(unhas);
    expect(await getAgendaPrefs(bia)).toEqual(defaultPrefs());
    await saveAgendaPrefs(ana, defaultPrefs());
    expect(await getAgendaPrefs(ana)).toEqual(defaultPrefs());
    expect(await db.select().from(userPreferences)).toHaveLength(1);
  });

  it("recusa o que não é preferência válida (nunca grava lixo)", async () => {
    await expect(saveAgendaPrefs(ana, { visoes: [], ativa: "x" })).rejects.toThrow("Não deu para salvar");
    await expect(saveAgendaPrefs(ana, { visoes: [{ id: "a", nome: "x".repeat(41), cfg: DEFAULT_CFG, sel: [] }], ativa: "a" })).rejects.toThrow();
    expect(await db.select().from(userPreferences)).toHaveLength(0);
  });

  it("apagar a usuária leva as preferências junto", async () => {
    await saveAgendaPrefs(bia, defaultPrefs());
    await db.delete(users).where(eq(users.id, bia));
    expect(await db.select().from(userPreferences)).toHaveLength(0);
  });
});
