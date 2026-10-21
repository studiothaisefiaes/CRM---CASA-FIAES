import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { clientAlertFor, getClientAlertConfig, saveClientAlertConfig } from "./client-alert";
import { saveFuncoes } from "./funcoes";

let ana = "";
beforeEach(async () => { await resetDb(); ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id; });

it("padrão: salta no horário e na comanda, com o texto sugerido", async () => {
  expect(await getClientAlertConfig()).toEqual({ noHorario: true, naComanda: true, textoSemUsoImagem: "Não autorizou uso de imagem" });
});
it("salva só o que veio, audita; texto vazio volta ao sugerido; lixo no banco cai no padrão", async () => {
  await saveClientAlertConfig({ noHorario: false, textoSemUsoImagem: "  Sem foto,   por favor " }, ana);
  expect(await getClientAlertConfig()).toEqual({ noHorario: false, naComanda: true, textoSemUsoImagem: "Sem foto, por favor" });
  expect(await db.select().from(auditLog).where(eq(auditLog.entityId, "aviso_cliente"))).toHaveLength(1);
  await saveClientAlertConfig({ textoSemUsoImagem: "" }, ana);
  expect((await getClientAlertConfig()).textoSemUsoImagem).toBe("Não autorizou uso de imagem");
  await expect(saveClientAlertConfig({ textoSemUsoImagem: "x".repeat(81) }, ana)).rejects.toThrow("Use até 80 caracteres.");
  await expect(saveClientAlertConfig({ outra: 1 } as never, ana)).rejects.toThrow();
});
it("função aviso_salta desligada recusa salvar a configuração", async () => {
  await saveFuncoes({ aviso_salta: false }, ana);
  await expect(saveClientAlertConfig({ noHorario: false }, ana)).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
});
it("clientAlertFor: noHorario=false não salta no horário (e a comanda segue); aviso_salta desligada não salta em nenhum lugar", async () => {
  expect(await clientAlertFor("horario")).toEqual({ on: true, text: "Não autorizou uso de imagem" });
  await saveClientAlertConfig({ noHorario: false, textoSemUsoImagem: "Sem foto" }, ana);
  expect(await clientAlertFor("horario")).toEqual({ on: false, text: "Sem foto" });
  expect((await clientAlertFor("comanda")).on).toBe(true);
  await saveClientAlertConfig({ noHorario: true, naComanda: false }, ana);
  expect([(await clientAlertFor("horario")).on, (await clientAlertFor("comanda")).on]).toEqual([true, false]);
  await saveClientAlertConfig({ naComanda: true }, ana);
  await saveFuncoes({ aviso_salta: false }, ana);
  expect([(await clientAlertFor("horario")).on, (await clientAlertFor("comanda")).on]).toEqual([false, false]);
});
