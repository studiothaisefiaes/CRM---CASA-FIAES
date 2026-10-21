import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { stageByKind } from "./deals";

beforeEach(async () => { await resetDb(); await etapasAntigasAtivas(); });

it("stageByKind: a primeira etapa ATIVA do tipo, pela ordem (Follow-up 2 a 4 desativadas não contam)", async () => {
  expect((await stageByKind("followup")).key).toBe("followup_1");
  expect((await stageByKind("proposta")).name).toBe("Orçamento");
  expect((await stageByKind("atendido")).key).toBe("atendida");
  await db.update(stages).set({ active: false }).where(eq(stages.key, "retorno"));
  await expect(stageByKind("retorno")).rejects.toThrow(/retorno/);
});
