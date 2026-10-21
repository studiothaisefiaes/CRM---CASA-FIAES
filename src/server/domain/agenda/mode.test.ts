import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, settings, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { assertCanBook, getAgendaMode, getAgendaRules, saveAgendaSettings } from "./mode";

let g = "";
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
});

describe("modo da agenda", () => {
  it("sem nada salvo (como em produção): só consulta, passo de 30 min", async () => {
    expect(await getAgendaMode()).toBe("consulta");
    expect(await getAgendaRules()).toEqual({ passoMin: 30 });
  });
  it("no modo consulta, criar ocupação nova é recusado com a frase da tela; em dupla e só CRM, passa", async () => {
    await expect(assertCanBook()).rejects.toThrow("A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda.");
    await saveAgendaSettings({ mode: "dupla", passoMin: 30 }, g);
    expect(await assertCanBook()).toBe("dupla");
    await saveAgendaSettings({ mode: "so_crm", passoMin: 15 }, g);
    expect(await assertCanBook()).toBe("so_crm");
    expect(await getAgendaRules()).toEqual({ passoMin: 15 });
  });
  it("salvar grava as duas chaves e audita; modo ou passo fora da lista é recusado", async () => {
    await saveAgendaSettings({ mode: "dupla", passoMin: 20 }, g);
    const rows = Object.fromEntries((await db.select().from(settings)).map((r) => [r.key, r.value]));
    expect(rows.agenda_modo).toBe("dupla");
    expect(rows.agenda_regras).toEqual({ passoMin: 20 });
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, "agenda_modo"))).toHaveLength(1);
    await expect(saveAgendaSettings({ mode: "tudo" as never, passoMin: 30 }, g)).rejects.toThrow("Escolha consulta, dupla ou só CRM.");
    await expect(saveAgendaSettings({ mode: "dupla", passoMin: 7 }, g)).rejects.toThrow("Escolha um passo de 10, 15, 20, 30 ou 60 minutos.");
  });
  it("valor estranho no banco cai no padrão seguro", async () => {
    await db.insert(settings).values([{ key: "agenda_modo", value: "qualquer" }, { key: "agenda_regras", value: { passoMin: 7 } }]);
    expect(await getAgendaMode()).toBe("consulta");
    expect(await getAgendaRules()).toEqual({ passoMin: 30 });
  });
});
