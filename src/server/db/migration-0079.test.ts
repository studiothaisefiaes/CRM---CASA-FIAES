import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { appointmentLabels, appointments } from "./schema";
import { resetDb } from "../../../test/db";
import { ap, bahia } from "../../../test/agenda-fixtures";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0079_marcador_tipo_horario.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL.replaceAll("--> statement-breakpoint", "")));

describe("0080: marcador e tipo do horário", () => {
  beforeEach(resetDb);

  it("traz os 9 marcadores da Casa, na ordem, sem duplicar na 2ª vez", async () => {
    await run(); await run();
    expect((await db.select().from(appointmentLabels).orderBy(appointmentLabels.position)).map((l) => l.name)).toEqual(
      ["Foi Atendida", "08H", "VER OBS", "Atrasada", "Não Cobrar", "revisão", "Representantes", "ON LINE", "CLIENTE DOENTE - VAI REMARCAR"]);
  });

  it("o tipo só aceita indicacao ou noiva, e apagar o marcador solta o horário (SET NULL)", async () => {
    await run();
    const [l] = await db.select().from(appointmentLabels).limit(1);
    const a = await ap({ startsAt: bahia(16, 10), labelId: l.id, visitType: "noiva" });
    await expect(ap({ startsAt: bahia(16, 11), visitType: "primeira_vez" })).rejects.toThrow();
    await db.delete(appointmentLabels);
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].labelId).toBeNull();
  });
});
